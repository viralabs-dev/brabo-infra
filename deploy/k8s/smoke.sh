#!/usr/bin/env bash
# Teste de fumaça do deploy em Kubernetes (Fase 5, item 6).
#
# É o docker/smoke.sh traduzido para o cluster: os mesmos três passos que
# provam o caminho api -> Keycloak -> engine, mais o que só existe aqui —
# probes distintas, métrica de fila e a External Metrics API que o HPA consome.
#
# As URLs são as mesmas do compose de produção porque o overlay local mapeia as
# NodePorts para as mesmas portas do host. Nada de port-forward: um
# `kubectl port-forward` em background mascara falha de Service e de
# NetworkPolicy, que é metade do que este teste existe para pegar.
set -euo pipefail

NS="${BRABO_NAMESPACE:-brabo}"
API="${API_URL:-http://localhost:3000}"
ENGINE="${ENGINE_URL:-http://localhost:4000}"
KEYCLOAK="${KEYCLOAK_URL:-http://localhost:8080}"
WEB="${WEB_URL:-http://localhost:8088}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-brabo-dev}"
SMOKE_USER="${SMOKE_USER:-admin}"
SMOKE_PASSWORD="${BRABO_SMOKE_PASSWORD:-admin123}"

step=0
info() { printf '\n\033[1m[smoke-k8s]\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }
warn() { printf '  \033[33maviso\033[0m %s\n' "$*"; }

fail() {
  printf '\n\033[31m[smoke-k8s] FALHOU no passo %s: %s\033[0m\n' "${step}" "$*" >&2
  printf '\n--- pods ---\n' >&2
  kubectl -n "${NS}" get pods -o wide >&2 || true
  printf '\n--- eventos recentes ---\n' >&2
  kubectl -n "${NS}" get events --sort-by=.lastTimestamp | tail -20 >&2 || true
  exit 1
}

# ---------------------------------------------------------------------------
step=1
info '1/7 — todos os pods Ready'
not_ready="$(kubectl -n "${NS}" get pods --no-headers 2>/dev/null \
  | awk '$3 != "Running" && $3 != "Completed" { print $1" ("$3")" }')"
[[ -z "${not_ready}" ]] || fail "pods fora de Running/Completed: ${not_ready}"

# `Running` não é `Ready`: um pod cujo readiness falha fica Running para sempre
# e não recebe tráfego. É exatamente o modo de falha do /ready do engine.
unready="$(kubectl -n "${NS}" get pods --no-headers --field-selector=status.phase=Running 2>/dev/null \
  | awk '{split($2,a,"/"); if (a[1] != a[2]) print $1" ("$2")"}')"
[[ -z "${unready}" ]] || fail "pods Running mas não Ready: ${unready}"
ok "todos os pods Running e Ready"

# ---------------------------------------------------------------------------
step=2
info '2/7 — nenhum container roda como root'
# Mesma verificação estrutural do docker/smoke.sh: uma imagem que volte a rodar
# como root passaria por toda a suite sem ninguém notar.
root_containers="$(kubectl -n "${NS}" get pods -o json \
  | jq -r '.items[] | select(.status.phase=="Running") | . as $p
           | ($p.spec.securityContext.runAsUser // empty) as $pod_uid
           | $p.spec.containers[]
           | select(((.securityContext.runAsUser // $pod_uid) // 0) == 0)
           | "\($p.metadata.name)/\(.name)"')"
[[ -z "${root_containers}" ]] || fail "containers rodando como root: ${root_containers}"
ok "todos os containers com runAsUser != 0"

# ---------------------------------------------------------------------------
step=3
info '3/7 — login (password grant no client brabo-web)'
token_response="$(curl -sS --max-time 30 \
  -d "client_id=brabo-web" \
  -d "grant_type=password" \
  -d "username=${SMOKE_USER}" \
  -d "password=${SMOKE_PASSWORD}" \
  "${KEYCLOAK}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token")" \
  || fail "Keycloak não respondeu em ${KEYCLOAK}"

TOKEN="$(printf '%s' "${token_response}" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')"
[[ -n "${TOKEN}" ]] || fail "sem access_token na resposta do Keycloak: ${token_response}"
ok "token obtido (${#TOKEN} chars)"

auth=(-H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json')

# ---------------------------------------------------------------------------
step=4
info '4/7 — criar sessão (workspace -> projeto -> sessão)'
# Este passo atravessa as NetworkPolicies inteiras: criar sessão faz a api
# pedir token client-credentials ao Keycloak e chamar o engine por HTTP
# interno. É o teste real de api->keycloak e api->engine.
suffix="$(date +%s)"

ws="$(curl -sS --max-time 30 -X POST "${auth[@]}" \
  -d "{\"name\":\"Smoke ${suffix}\",\"slug\":\"smoke-${suffix}\"}" \
  "${API}/workspaces")" || fail "POST /workspaces não respondeu"
WS_ID="$(printf '%s' "${ws}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
[[ -n "${WS_ID}" ]] || fail "workspace sem id na resposta: ${ws}"
ok "workspace ${WS_ID}"

proj="$(curl -sS --max-time 30 -X POST "${auth[@]}" \
  -d "{\"name\":\"Smoke ${suffix}\",\"slug\":\"smoke-${suffix}\"}" \
  "${API}/workspaces/${WS_ID}/projects")" || fail "POST projects não respondeu"
PROJ_ID="$(printf '%s' "${proj}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
[[ -n "${PROJ_ID}" ]] || fail "projeto sem id na resposta: ${proj}"
ok "projeto ${PROJ_ID}"

sess="$(curl -sS --max-time 60 -X POST "${auth[@]}" \
  "${API}/projects/${PROJ_ID}/sessions")" || fail "POST sessions não respondeu"
SESS_ID="$(printf '%s' "${sess}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
printf '%s' "${sess}" | grep -q '"status":"created"' \
  || fail "sessão criada em status inesperado: ${sess}"
ok "sessão ${SESS_ID} criada"

# ATIVAR é o que exercita api -> engine. Criar a sessão NÃO chama o engine —
# só grava a linha e o evento de outbox. Enquanto o smoke parava em `created`,
# o caminho interno ficou quebrado por um rollout inteiro sem ninguém ver: o
# `force_ssl` respondia 301 em /internal/*, e nada aqui percebia.
act="$(curl -sS --max-time 60 -X POST "${auth[@]}" -d '{"status":"active"}' \
  "${API}/projects/${PROJ_ID}/sessions/${SESS_ID}/transition")" \
  || fail "POST transition não respondeu"
printf '%s' "${act}" | grep -q '"status":"active"' \
  || fail "sessão não ativou (api -> engine quebrado?): ${act}"
ok "sessão ativada — api -> Keycloak -> engine funciona no cluster"

# ---------------------------------------------------------------------------
step=5
info '5/7 — probes distintas do engine e da api'
# Liveness NÃO pode depender do banco; readiness do engine só libera depois da
# reidratação. Se as três respondessem igual, a separação teria sido desfeita.
curl -sS --max-time 15 "${ENGINE}/live"  | grep -q '"status":"ok"' || fail "engine /live não veio ok"
curl -sS --max-time 15 "${ENGINE}/ready" | grep -q '"status":"ok"' || fail "engine /ready não veio ok"
curl -sS --max-time 15 "${API}/live"     | grep -q '"status":"ok"' || fail "api /live não veio ok"
ok "engine /live e /ready, api /live"

web_index="$(curl -sS --max-time 15 "${WEB}/")" || fail "web não respondeu em ${WEB}"
printf '%s' "${web_index}" | grep -q '/assets/' || fail "index.html sem referência a /assets/"
config_js="$(curl -sS --max-time 15 "${WEB}/config.js")" || fail "web não serviu /config.js"
printf '%s' "${config_js}" | grep -q "${KEYCLOAK}" \
  || fail "/config.js não aponta para ${KEYCLOAK}: ${config_js}"
ok "web serve o bundle e a config de runtime do cluster"

# ---------------------------------------------------------------------------
step=6
info '6/7 — métrica de fila exposta pelo engine'
metrics="$(kubectl -n "${NS}" exec deploy/engine -- \
  wget -qO- http://127.0.0.1:4000/metrics 2>/dev/null)" \
  || fail "engine não serviu /metrics"
printf '%s' "${metrics}" | grep -q 'oban_queue_depth' \
  || fail "/metrics não expõe oban_queue_depth"
printf '%s' "${metrics}" | grep -q 'oban_queue_depth{.*state="available"' \
  || fail "oban_queue_depth sem o rótulo state — o HPA não conseguiria filtrar"
ok "oban_queue_depth com os rótulos queue e state"

# ---------------------------------------------------------------------------
step=7
info '7/7 — External Metrics API responde (a peça frágil do prometheus-adapter)'
# O modo de falha do adapter é SILENCIOSO: se a regra não casar, o HPA fica em
# <unknown> e nunca escala, com todo o resto verde. Perguntar direto à API
# agregada é o que transforma isso em falha visível.
raw="$(kubectl get --raw \
  "/apis/external.metrics.k8s.io/v1beta1/namespaces/${NS}/oban_queue_depth?labelSelector=state%3Davailable" \
  2>/dev/null)" || fail "External Metrics API não respondeu — prometheus-adapter não está servindo oban_queue_depth"
printf '%s' "${raw}" | grep -q 'oban_queue_depth' \
  || fail "External Metrics API respondeu sem a métrica: ${raw}"
ok "external.metrics.k8s.io serve oban_queue_depth"

hpa_target="$(kubectl -n "${NS}" get hpa engine -o jsonpath='{.status.currentMetrics[0].external.current.value}' 2>/dev/null || true)"
if [[ -z "${hpa_target}" ]]; then
  warn "o HPA do engine ainda não leu a métrica (pode levar até ~1min após o deploy)"
else
  ok "HPA do engine lendo a métrica (valor atual: ${hpa_target})"
fi

# Enforcement de NetworkPolicy: informativo, porque depende da CNI.
if kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.osImage}' 2>/dev/null | grep -qi k3s; then
  ok "cluster k3s/k3d — NetworkPolicies com enforcement real"
else
  warn "cluster não-k3s: se for kind com kindnet, as NetworkPolicies NÃO são aplicadas"
fi

step=0
printf '\n\033[32m[smoke-k8s] os 7 passos passaram\033[0m\n'
