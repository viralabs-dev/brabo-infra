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
# ## Evidência (AT-078)
#
# Antes do `rollout restart`, `rollout-evidencia.sh` passa a gravar em
# `ROLLOUT_EVIDENCE_DIR` (senão num `mktemp -d`, dito no fim) o log de TODO pod
# do engine — os antigos, que morrem no rollout levando o log, inclusive —, os
# eventos do namespace, as réplicas do Deployment/HPA a cada 2s e cada leitura
# de dono. Numa órfã, a falha cita toda linha que menciona a sessão em todos
# esses arquivos e diz se ela ficou sem dono ANTES ou DEPOIS do scale-down do
# HPA. Nada disso muda o que conta como adotada ou drenada, nem o teto.
#
# Uso:
#   bash deploy/k8s/rollout-test.sh
#   ROLLOUT_SESSIONS=8 bash deploy/k8s/rollout-test.sh
#   ROLLOUT_EVIDENCE_DIR=/tmp/evidencia bash deploy/k8s/rollout-test.sh
set -euo pipefail

# shellcheck source=deploy/k8s/rollout-evidencia.sh
source "$(dirname "${BASH_SOURCE[0]}")/rollout-evidencia.sh"

NS="${BRABO_NAMESPACE:-brabo}"
API="${API_URL:-http://localhost:3000}"
SMOKE_USER="${SMOKE_USER:-owner@brabo.dev}"
SMOKE_PASSWORD="${BRABO_SMOKE_PASSWORD:-brabo12345678}"
COUNT="${ROLLOUT_SESSIONS:-5}"
SELETOR_ENGINE='app.kubernetes.io/name=engine'
EVIDENCIA="${ROLLOUT_EVIDENCE_DIR:-$(mktemp -d -t rollout-evidencia.XXXXXX)}"

encerrar_evidencia() {
  evidencia_parar
  printf '\n[rollout-test] evidência em %s\n' "${EVIDENCIA}" >&2
}
trap encerrar_evidencia EXIT

# Dono da sessão pelo `:global`, perguntado a qualquer réplica: o NÓ que a
# hospeda, ou `-` sem dono. A leitura vai para `donos.log`. Dono = um nome de nó
# Erlang (`nome@host`); qualquer outra saída (exec falhou, rpc caiu) conta como
# sem dono, igual ao `sim`/`nao` de antes.
dono_de() {
  local sid="$1" destino="${2:-donos.log}" saida
  saida="$(kubectl -n "${NS}" exec deploy/engine -- /app/bin/engine rpc \
    "case Engine.Sessions.SessionServer.whereis(\"${sid}\") do nil -> IO.puts(\"-\"); pid -> IO.puts(node(pid)) end" \
    2>/dev/null | tr -d '\r' | tail -n 1 || true)"
  [[ "${saida}" =~ ^[^@[:space:]]+@[^[:space:]]+$ ]] || saida='-'
  printf '%s %s %s\n' "$(date +%s)" "${sid}" "${saida}" >> "${EVIDENCIA}/${destino}"
  printf '%s' "${saida}"
}

# Leitura, só leitura, do que o engine guarda sobre cada sessão: a linha em
# `engine.session_states` (sem ela, nem o drain nem o Adopter enxergam a sessão)
# e os últimos jobs do `SessionAdoptionWorker` (a varredura de 30s que deveria
# adotar uma órfã com linha). Vai para `engine-estado.txt` nos dois desfechos —
# numa rodada verde, é o que prova que a consulta funciona.
estado_do_engine() {
  local ids
  ids="$(printf '"%s",' "${SESSIONS[@]}")"
  kubectl -n "${NS}" exec deploy/engine -- /app/bin/engine rpc "
    import Ecto.Query
    ids = [${ids%,}]
    IO.puts(\"--- engine.session_states das sessões do teste ---\")
    Engine.Repo.all(from s in Engine.Sessions.SessionState, where: s.session_id in ^ids)
    |> Enum.each(&IO.puts(\"#{&1.session_id} #{&1.status} #{&1.closing_cause} atualizada=#{&1.updated_at}\"))
    IO.puts(\"(#{length(ids)} sessões no teste; as ausentes acima não têm linha)\")
    IO.puts(\"--- últimos jobs do SessionAdoptionWorker ---\")
    {:ok, r} = Ecto.Adapters.SQL.query(Engine.Repo, \"SELECT id, state, attempted_at, scheduled_at, completed_at, attempted_by FROM engine.oban_jobs WHERE worker = 'Engine.Workers.SessionAdoptionWorker' ORDER BY id DESC LIMIT 6\", [])
    Enum.each(r.rows, &IO.puts(inspect(&1)))
    IO.puts(\"--- nós: #{node()} vê #{inspect(Node.list())} ---\")
  " > "${EVIDENCIA}/engine-estado.txt" 2>&1 || true
}

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
  # `kind` é obrigatório desde a FASE 20 (400 sem ele), e este script nunca o
  # recebeu. Não muda o que o teste prova: ele exige sessão `active` com dono
  # no engine, e a ativação é a mesma para os dois tipos. `consultiva` porque
  # nada aqui ativa EXECUÇÃO — a mesma escolha de `docker/smoke.sh`.
  sess="$(curl -sS --max-time 60 -X POST "${auth[@]}" \
    -d '{"kind":"consultiva"}' \
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
#
# A evidência começa AQUI, antes de qualquer leitura de dono: os pods que
# existem agora são os que o rollout vai matar, e é o log deles que se perdia.
evidencia_iniciar "${EVIDENCIA}" "${NS}" "${SELETOR_ENGINE}"

# Evidência para quando a verificação reprovar: EM QUE réplica cada sessão
# morava, e quantas réplicas havia.
kubectl -n "${NS}" get pods -l "${SELETOR_ENGINE}" --no-headers \
  -o custom-columns=POD:.metadata.name,IP:.status.podIP | sed 's/^/    engine /'
owned_before=0
for sid in "${SESSIONS[@]}"; do
  no="$(dono_de "${sid}")"
  printf '    sessão %s em %s\n' "${sid}" "${no}"
  if [[ "${no}" != '-' ]]; then owned_before=$(( owned_before + 1 )); fi
done
[[ "${owned_before}" -eq "${#SESSIONS[@]}" ]] \
  || fail "só ${owned_before}/${#SESSIONS[@]} sessões têm dono no engine ANTES do rollout"
ok "todas com dono no engine antes do rollout"

# --------------------------------------------------------------------------
info 'rollout restart do engine'
# Os pods do engine no instante zero: é contra eles que se lê "morava num pod
# antigo" na evidência.
kubectl -n "${NS}" get pods -l "${SELETOR_ENGINE}" -o wide > "${EVIDENCIA}/pods-antes.txt" 2>&1 || true
T0="$(date +%s)"
marco "rollout-restart"
# Dono de cada sessão DURANTE o rollout, em arquivo à parte: é aqui que se vê
# para qual réplica cada handoff foi (um pod antigo que também vai morrer? um
# novo?). Arquivo separado de `donos.log` porque uma leitura no meio do rollout
# cai às vezes num pod saindo, e não pode entrar no diagnóstico da verificação.
( while [[ ! -e "${EVIDENCIA}/.rollout-concluido" ]]; do
    for sid in "${SESSIONS[@]}"; do dono_de "${sid}" donos-durante-rollout.log >/dev/null; done
  done ) &
AMOSTRADOR_DO_ROLLOUT=$!
echo "${AMOSTRADOR_DO_ROLLOUT}" >> "${EVIDENCIA}/.pids"
kubectl -n "${NS}" rollout restart deployment/engine >/dev/null
kubectl -n "${NS}" rollout status deployment/engine --timeout=300s >/dev/null \
  || fail 'o rollout não completou'
: > "${EVIDENCIA}/.rollout-concluido"
wait "${AMOSTRADOR_DO_ROLLOUT}" 2>/dev/null || true
marco "rollout-status-ok"
ok "rollout completo em $(( $(date +%s) - T0 ))s"

# --------------------------------------------------------------------------
info 'verificando que nenhuma sessão ficou órfã'

# Convergência com TETO, e não um `sleep` fixo. Adotar e drenar são assíncronos
# — o adopter espera o cluster sincronizar, o relato de `node_shutdown`
# atravessa a api —, e um `sleep 15` confunde "ainda assentando" com "órfã para
# sempre". Desfecho definitivo errado (encerrada com outra causa, estado
# inesperado) reprova na hora; `active` sem dono só reprova quando o teto
# esgota, e a mensagem diz quanto se esperou — é o que separa atraso de órfã.
CONVERGENCIA="${ROLLOUT_CONVERGENCE_SECONDS:-120}"
inicio=${SECONDS}
while :; do
  adopted=0
  drained=0
  orfas=()
  for sid in "${SESSIONS[@]}"; do
    body="$(curl -sS --max-time 30 "${auth[@]}" \
      "${API}/projects/${PROJ_ID}/sessions/${sid}")" || fail "GET da sessão ${sid} falhou"
    status="$(jq -r '.status // empty' <<<"${body}")"
    reason="$(jq -r '.terminationReason // ""' <<<"${body}")"

    owned="$(dono_de "${sid}")"

    case "${status}" in
      active)
        if [[ "${owned}" != '-' ]]; then
          adopted=$(( adopted + 1 ))
        else
          orfas+=("${sid}")
        fi
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

  [[ ${#orfas[@]} -eq 0 ]] && break

  if (( SECONDS - inicio >= CONVERGENCIA )); then
    marco "teto-esgotado"
    estado_do_engine
    # Para os coletores antes de citar: o que foi gravado até aqui é o que há.
    evidencia_parar
    queda="$(primeiro_scale_down "${EVIDENCIA}/replicas.log" "${T0}")"
    printf '\n--- réplicas do engine (T+0 = rollout restart) ---\n' >&2
    mudancas_de_replicas "${EVIDENCIA}/replicas.log" "${T0}" >&2 || true
    [[ -n "${queda}" ]] || printf '(nenhum scale-down do HPA gravado)\n' >&2
    diagnosticos=()
    for sid in "${orfas[@]}"; do
      d="$(diagnostico_da_orfa "${EVIDENCIA}/donos.log" "${sid}" "${T0}" "${queda}")"
      diagnosticos+=("${sid}: ${d}")
      printf '\n--- tudo que cita a órfã %s (pods antigos inclusive) ---\n' "${sid}" >&2
      citar_orfa "${EVIDENCIA}" "${sid}" >&2
    done
    printf '\n--- estado do engine (session_states, varredura de adoção) ---\n' >&2
    cat "${EVIDENCIA}/engine-estado.txt" >&2 || true
    printf '\n--- diagnóstico por órfã ---\n' >&2
    printf '  %s\n' "${diagnosticos[@]}" >&2
    fail "SESSÃO ÓRFÃ: ${orfas[*]} segue 'active' na api e sem dono em réplica nenhuma ${CONVERGENCIA}s depois do rollout (${adopted} adotada(s), ${drained} drenada(s)) — ${diagnosticos[*]}"
  fi
  sleep 5
done

marco "convergiu"
estado_do_engine
ok "convergiu em $(( SECONDS - inicio ))s depois do rollout"
mudancas_de_replicas "${EVIDENCIA}/replicas.log" "${T0}" | sed 's/^/    réplicas /' || true
ok "${adopted} adotada(s) por outra réplica, ${drained} drenada(s) com node_shutdown"
[[ $(( adopted + drained )) -eq ${#SESSIONS[@]} ]] \
  || fail "contagem não fecha: ${adopted}+${drained} != ${#SESSIONS[@]}"

if [[ "${drained}" -gt 0 ]]; then
  warn "com uma réplica só não há par para adotar — drenar com causa conhecida é o desfecho correto"
fi

printf '\n\033[32m[rollout-test] zero sessões órfãs\033[0m\n'
