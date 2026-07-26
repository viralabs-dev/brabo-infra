#!/usr/bin/env bash
# Teste de fumaça das IMAGENS DE PRODUÇÃO (Fase 5, item 5).
#
# Sobe o docker-compose.prod.yml, espera os healthchecks, exercita 3 caminhos
# essenciais e derruba tudo. É o que o job `smoke` do CI roda.
#
# O que ele NÃO é: teste funcional. As suites (vitest/ExUnit) cobrem
# comportamento. Aqui a pergunta é outra — "as imagens de produção, sem bind
# mount, non-root e read-only, sobem e conversam entre si?". É o tipo de falha
# que passa por toda a suite verde e só aparece no primeiro deploy.
#
# Uso:
#   bash docker/smoke.sh                     # sobe, testa e derruba
#   SMOKE_KEEP_UP=1 bash docker/smoke.sh     # deixa de pé pra investigar
#   SMOKE_NO_BUILD=1 bash docker/smoke.sh    # usa as imagens já construídas
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker/docker-compose.prod.yml"
COMPOSE=(docker compose -f "${COMPOSE_FILE}")

# Portas: os defaults do compose. Sobrescrevíveis pra rodar ao lado do stack de
# desenvolvimento, que ocupa 3000/4000/8080.
API_PORT="${API_PORT:-3000}"
ENGINE_PORT="${ENGINE_PORT:-4000}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-8080}"
WEB_PORT="${WEB_PORT:-8088}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-brabo-dev}"
SMOKE_USER="${SMOKE_USER:-admin}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-admin123}"

API="http://localhost:${API_PORT}"
ENGINE="http://localhost:${ENGINE_PORT}"
KEYCLOAK="http://localhost:${KEYCLOAK_PORT}"
WEB="http://localhost:${WEB_PORT}"

step=0
info() { printf '\n\033[1m[smoke]\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }

fail() {
  printf '\n\033[31m[smoke] FALHOU no passo %s: %s\033[0m\n' "${step}" "$*" >&2
  printf '\n--- estado dos serviços ---\n' >&2
  "${COMPOSE[@]}" ps >&2 || true
  printf '\n--- últimas linhas de cada serviço ---\n' >&2
  "${COMPOSE[@]}" logs --tail=40 >&2 || true
  exit 1
}

# trap ANTES do `up`: se o build ou o healthcheck falhar, ainda assim derruba.
cleanup() {
  local code=$?
  if [[ "${SMOKE_KEEP_UP:-}" == "1" ]]; then
    info "SMOKE_KEEP_UP=1 — stack mantido de pé (derrube com: ${COMPOSE[*]} down -v)"
    return
  fi
  info 'derrubando o stack'
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  exit "${code}"
}
trap cleanup EXIT

# --------------------------------------------------------------------------
step=0
info 'subindo o compose de produção (aguardando healthchecks)'
up_args=(up -d --wait)
[[ "${SMOKE_NO_BUILD:-}" == "1" ]] || up_args+=(--build)
"${COMPOSE[@]}" "${up_args[@]}" || fail 'algum serviço não chegou a healthy'
ok 'todos os serviços healthy'

# --------------------------------------------------------------------------
# Verificação estrutural — é o critério de aceite explícito da sessão, e o
# lugar certo pra checar é aqui: uma imagem que volte a rodar como root
# passaria por toda a suite sem ninguém notar.
step=0.5
info 'conferindo que as três imagens rodam non-root'
for svc in api engine web; do
  cid="$("${COMPOSE[@]}" ps -q "${svc}")"
  [[ -n "${cid}" ]] || fail "container do serviço ${svc} não encontrado"
  uid="$(docker exec "${cid}" id -u 2>/dev/null || echo 'erro')"
  [[ "${uid}" != "0" && "${uid}" != "erro" ]] || fail "serviço ${svc} está rodando como root (uid=${uid})"
  ok "${svc} roda com uid ${uid}"
done

# --------------------------------------------------------------------------
step=1
info '1/3 — login (password grant no client brabo-web)'
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

# --------------------------------------------------------------------------
step=2
info '2/3 — criar sessão (workspace -> projeto -> sessão)'
# A cadeia inteira é necessária num banco novo: o RolesGuard resolve o papel
# `developer` PELO PROJETO, e quem cria o workspace vira owner dele.
suffix="$(date +%s)"

ws="$(curl -sS --max-time 30 -X POST "${auth[@]}" \
  -d "{\"name\":\"Smoke ${suffix}\",\"slug\":\"smoke-${suffix}\"}" \
  "${API}/workspaces")" || fail "POST /workspaces não respondeu"
WS_ID="$(printf '%s' "${ws}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
[[ -n "${WS_ID}" ]] || fail "workspace sem id na resposta: ${ws}"
ok "workspace ${WS_ID}"

proj="$(curl -sS --max-time 30 -X POST "${auth[@]}" \
  -d "{\"name\":\"Smoke ${suffix}\",\"slug\":\"smoke-${suffix}\"}" \
  "${API}/workspaces/${WS_ID}/projects")" || fail "POST /workspaces/:id/projects não respondeu"
PROJ_ID="$(printf '%s' "${proj}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
[[ -n "${PROJ_ID}" ]] || fail "projeto sem id na resposta: ${proj}"
ok "projeto ${PROJ_ID}"

sess="$(curl -sS --max-time 60 -X POST "${auth[@]}" \
  "${API}/projects/${PROJ_ID}/sessions")" || fail "POST /projects/:id/sessions não respondeu"
SESS_ID="$(printf '%s' "${sess}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
[[ -n "${SESS_ID}" ]] || fail "sessão sem id na resposta: ${sess}"
# Criar sessão faz a api chamar o engine por HTTP interno com token de client
# credentials: este passo prova o caminho api -> Keycloak -> engine inteiro.
printf '%s' "${sess}" | grep -q '"status":"created"' \
  || fail "sessão criada em status inesperado: ${sess}"
ok "sessão ${SESS_ID} em status created"

# --------------------------------------------------------------------------
step=3
info '3/3 — health do engine e do web'
engine_health="$(curl -sS --max-time 15 "${ENGINE}/health")" || fail "engine não respondeu em ${ENGINE}"
printf '%s' "${engine_health}" | grep -q '"status":"ok"' \
  || fail "engine /health não veio ok: ${engine_health}"
ok "engine /health ok"

# O web é estático: basta provar que o nginx serve o index do bundle real.
web_index="$(curl -sS --max-time 15 "${WEB}/")" || fail "web não respondeu em ${WEB}"
printf '%s' "${web_index}" | grep -q '/assets/' \
  || fail "index.html servido não referencia /assets/ (bundle não entrou na imagem?)"
ok "web serve o index com os assets do build"

step=0
printf '\n\033[32m[smoke] os 3 passos passaram\033[0m\n'
