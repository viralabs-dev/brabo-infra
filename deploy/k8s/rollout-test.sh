#!/usr/bin/env bash
# Critério de aceite do item 4 da Fase 5: rollout com sessões ativas não deixa
# nenhuma sessão órfã.
#
# ## O que é uma sessão órfã, operacionalmente
#
# Uma sessão que a api considera `active` e para a qual não existe processo em
# réplica nenhuma. Ela nunca mais recebe heartbeat, nunca mais avança, e nunca
# fecha — fica pendurada para sempre. Era o estado em que TODA sessão ativa
# ficava depois de um rollout antes desta sessão.
#
# ## O que este teste exige de cada sessão
#
#   (a) `active` na api E com dono `:global` vivo no engine  -> foi adotada
#   (b) `closed_abnormally` com causa `node_shutdown`        -> foi drenada
#
# Qualquer outra combinação é falha. Em especial `active` sem dono, que é
# exatamente a órfã.
#
# Uso:
#   bash deploy/k8s/rollout-test.sh
#   ROLLOUT_SESSIONS=8 bash deploy/k8s/rollout-test.sh
set -euo pipefail

NS="${BRABO_NAMESPACE:-brabo}"
API="${API_URL:-http://localhost:3000}"
SMOKE_USER="${SMOKE_USER:-owner@brabo.dev}"
SMOKE_PASSWORD="${BRABO_SMOKE_PASSWORD:-senha de dev do brabo}"
COUNT="${ROLLOUT_SESSIONS:-5}"

info() { printf '\n\033[1m[rollout-test]\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }
warn() { printf '  \033[33maviso\033[0m %s\n' "$*"; }

fail() {
  printf '\n\033[31m[rollout-test] FALHOU: %s\033[0m\n' "$*" >&2
  printf '\n--- pods ---\n' >&2
  kubectl -n "${NS}" get pods -o wide >&2 || true
  printf '\n--- engine (últimas linhas) ---\n' >&2
  kubectl -n "${NS}" logs -l app.kubernetes.io/name=engine --tail=60 --prefix >&2 || true
  exit 1
}

# --------------------------------------------------------------------------
info "abrindo ${COUNT} sessões ativas"

token_response="$(curl -sS --max-time 30 \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${SMOKE_USER}\",\"senha\":\"${SMOKE_PASSWORD}\"}" \
  "${API}/auth/login")" \
  || fail "api não respondeu em ${API}/auth/login"
TOKEN="$(printf '%s' "${token_response}" | jq -r '.accessToken // empty')"
[[ -n "${TOKEN}" ]] || fail "sem accessToken: ${token_response}"

auth=(-H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json')
suffix="$(date +%s)"

ws="$(curl -sS --max-time 30 -X POST "${auth[@]}" \
  -d "{\"name\":\"Rollout ${suffix}\",\"slug\":\"rollout-${suffix}\"}" \
  "${API}/workspaces")" || fail "POST /workspaces falhou"
WS_ID="$(jq -r '.id // empty' <<<"${ws}")"
[[ -n "${WS_ID}" ]] || fail "workspace sem id: ${ws}"

proj="$(curl -sS --max-time 30 -X POST "${auth[@]}" \
  -d "{\"name\":\"Rollout ${suffix}\",\"slug\":\"rollout-${suffix}\"}" \
  "${API}/workspaces/${WS_ID}/projects")" || fail "POST projects falhou"
PROJ_ID="$(jq -r '.id // empty' <<<"${proj}")"
[[ -n "${PROJ_ID}" ]] || fail "projeto sem id: ${proj}"

SESSIONS=()
for i in $(seq 1 "${COUNT}"); do
  sess="$(curl -sS --max-time 60 -X POST "${auth[@]}" \
    "${API}/projects/${PROJ_ID}/sessions")" || fail "POST sessions falhou"
  SID="$(jq -r '.id // empty' <<<"${sess}")"
  [[ -n "${SID}" ]] || fail "sessão ${i} sem id: ${sess}"

  # `created` -> `active` é o que faz o engine criar o processo supervisionado.
  act="$(curl -sS --max-time 60 -X POST "${auth[@]}" -d '{"status":"active"}' \
    "${API}/projects/${PROJ_ID}/sessions/${SID}/transition")" \
    || fail "transição para active falhou na sessão ${SID}"
  [[ "$(jq -r '.status // empty' <<<"${act}")" == "active" ]] \
    || fail "sessão ${SID} não ficou active: ${act}"

  SESSIONS+=("${SID}")
done
ok "${#SESSIONS[@]} sessões ativas"

# Pré-condição: todas com dono no engine. Se isto falhar, o teste do rollout
# não significaria nada — não haveria o que preservar.
owned_before=0
for sid in "${SESSIONS[@]}"; do
  if kubectl -n "${NS}" exec deploy/engine -- /app/bin/engine rpc \
      "IO.puts(if Engine.Sessions.SessionServer.whereis(\"${sid}\"), do: \"sim\", else: \"nao\")" \
      2>/dev/null | tr -d '\r' | grep -q sim; then
    owned_before=$(( owned_before + 1 ))
  fi
done
[[ "${owned_before}" -eq "${#SESSIONS[@]}" ]] \
  || fail "só ${owned_before}/${#SESSIONS[@]} sessões têm dono no engine ANTES do rollout"
ok "todas com dono no engine antes do rollout"

# --------------------------------------------------------------------------
info 'rollout restart do engine'
kubectl -n "${NS}" rollout restart deployment/engine >/dev/null
kubectl -n "${NS}" rollout status deployment/engine --timeout=300s >/dev/null \
  || fail 'o rollout não completou'
ok 'rollout completo'

# Dá tempo de o adopter/handoff assentar e de a api processar os relatos.
sleep 15

# --------------------------------------------------------------------------
info 'verificando que nenhuma sessão ficou órfã'

adopted=0
drained=0
for sid in "${SESSIONS[@]}"; do
  body="$(curl -sS --max-time 30 "${auth[@]}" \
    "${API}/projects/${PROJ_ID}/sessions/${sid}")" || fail "GET da sessão ${sid} falhou"
  status="$(jq -r '.status // empty' <<<"${body}")"
  reason="$(jq -r '.terminationReason // ""' <<<"${body}")"

  owned="$(kubectl -n "${NS}" exec deploy/engine -- /app/bin/engine rpc \
    "IO.puts(if Engine.Sessions.SessionServer.whereis(\"${sid}\"), do: \"sim\", else: \"nao\")" \
    2>/dev/null | tr -d '\r' || echo nao)"

  case "${status}" in
    active)
      [[ "${owned}" == "sim" ]] \
        || fail "SESSÃO ÓRFÃ: ${sid} está 'active' na api e sem dono em réplica nenhuma"
      adopted=$(( adopted + 1 ))
      ;;
    closed_abnormally)
      [[ "${reason}" == *node_shutdown* ]] \
        || fail "sessão ${sid} encerrou como '${status}' com causa '${reason}' — esperava node_shutdown"
      drained=$(( drained + 1 ))
      ;;
    *)
      fail "sessão ${sid} em estado inesperado '${status}' (causa: '${reason}')"
      ;;
  esac
done

ok "${adopted} adotada(s) por outra réplica, ${drained} drenada(s) com node_shutdown"
[[ $(( adopted + drained )) -eq ${#SESSIONS[@]} ]] \
  || fail "contagem não fecha: ${adopted}+${drained} != ${#SESSIONS[@]}"

if [[ "${drained}" -gt 0 ]]; then
  warn "com uma réplica só não há par para adotar — drenar com causa conhecida é o desfecho correto"
fi

printf '\n\033[32m[rollout-test] zero sessões órfãs\033[0m\n'
