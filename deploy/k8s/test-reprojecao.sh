#!/usr/bin/env bash
# BRB-018 / AT-127 — a reprojeção do grafo a partir do event log, PROVADA NO
# CLUSTER (RN-569). Até aqui só rodava no compose, por `make test-reprojecao`
# (o spec `apps/api/test/scripts/reprojetar-grafo.spec.ts`, contra o Neo4j de
# dev). O que muda aqui é o ambiente: o binário é o MESMO que o runbook manda
# rodar num incidente — `kubectl exec deploy/api -- node scripts/reprojetar-grafo.js`
# — sobre o Postgres e o Neo4j do cluster, dentro da imagem de produção.
#
# ## O que ele faz
#
#   1. cria, pela API, um projeto NOVO com uma sessão levada até `closed` (é o
#      que dá `Interacao` à reprojeção: fechar sessão não deixa evento no log);
#   2. reprojeta esse projeto e mede o subgrafo dele (nós e arestas);
#   3. APAGA esse subgrafo e reprojeta: tem de voltar IGUAL;
#   4. reprojeta de novo por cima: idempotente, mesma medida.
#
# ## Por que não depende da ordem dos alvos (AT-078)
#
# Os alvos do `propriedades.yml` rodam em série e um altera o cluster para o
# seguinte (o `hpa-test` deixa o engine com mais réplicas; o `rollout-test` o
# reinicia). Este alvo NÃO lê nem depende de nada disso: usa um projeto que ele
# mesmo cria, escopa medida e remoção a ele, e só fala com `api` e `neo4j`.
# Também NÃO depende de um backup ter acontecido — proibição da AT-032: não é
# acoplado ao `test-restore`.
#
# Só o subgrafo do cenário é apagado (`Interacao` da sessão e `Projeto` do
# projeto criados aqui); o `Usuario` é compartilhado e fica.
#
# Uso: bash deploy/k8s/test-reprojecao.sh
set -euo pipefail

NS="${BRABO_NAMESPACE:-brabo}"
API="${API_URL:-http://localhost:3000}"
SMOKE_USER="${SMOKE_USER:-owner@brabo.dev}"
SMOKE_PASSWORD="${BRABO_SMOKE_PASSWORD:-brabo12345678}"

info() { printf '\n\033[1m[test-reprojecao]\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }

fail() {
  printf '\n\033[31m[test-reprojecao] FALHOU: %s\033[0m\n' "$*" >&2
  printf '\n--- pods ---\n' >&2
  kubectl -n "${NS}" get pods -o wide >&2 || true
  printf '\n--- log recente da api ---\n' >&2
  kubectl -n "${NS}" logs deploy/api --tail=40 >&2 2>/dev/null || true
  exit 1
}

command -v kubectl >/dev/null || fail "kubectl não encontrado no PATH"
command -v jq >/dev/null || fail "jq não encontrado no PATH"

# Cypher no pod do Neo4j, com a credencial que ELE já tem (`PASSWORD_ARG`, a
# mesma que a readinessProbe usa) — nenhuma senha passa por este script.
cypher() {
  kubectl -n "${NS}" exec neo4j-0 -- sh -c \
    'cypher-shell -u neo4j -p "$PASSWORD_ARG" --format plain "$1"' _ "$1" \
    | tail -n +2 | tr -d '"\r'
}

# Medida do subgrafo do cenário, "nós|arestas": o Projeto mais as Interacao dele,
# e as arestas (PARTICIPOU, NO_PROJETO) da Interacao da sessão.
medir() {
  local nos arestas
  nos="$(cypher "MATCH (p:Projeto {id: '${PROJ_ID}'}) OPTIONAL MATCH (i:Interacao)-[:NO_PROJETO]->(p) RETURN 1 + count(DISTINCT i)")"
  arestas="$(cypher "MATCH (i:Interacao {sessionId: '${SESS_ID}'}) OPTIONAL MATCH (i)-[r]-() RETURN count(r)")"
  printf '%s|%s' "${nos}" "${arestas}"
}

reprojetar() {
  local saida
  saida="$(kubectl -n "${NS}" exec deploy/api -- node scripts/reprojetar-grafo.js --project "${PROJ_ID}" 2>&1)" \
    || { printf '%s\n' "${saida}" | sed 's/^/    /' >&2; fail "reprojetar-grafo.js saiu com erro (${1})"; }
  printf '%s\n' "${saida}" | sed 's/^/    /'
}

# --- 1. cenário, pela API ----------------------------------------------------
info "criando o cenário pela API (projeto novo, sessão fechada)"
resposta="$(curl -sS --max-time 30 -H 'Content-Type: application/json' \
  -d "{\"email\":\"${SMOKE_USER}\",\"senha\":\"${SMOKE_PASSWORD}\"}" "${API}/auth/login")" \
  || fail "api não respondeu em ${API}/auth/login"
TOKEN="$(printf '%s' "${resposta}" | jq -r '.accessToken // empty')"
[[ -n "${TOKEN}" ]] || fail "sem accessToken no login: ${resposta}"
auth=(-H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json')

sufixo="reproj-$(date +%s)"
ws="$(curl -sS --max-time 30 -X POST "${auth[@]}" \
  -d "{\"name\":\"Reproj ${sufixo}\",\"slug\":\"${sufixo}\"}" "${API}/workspaces")"
WS_ID="$(printf '%s' "${ws}" | jq -r '.id // empty')"
[[ -n "${WS_ID}" ]] || fail "workspace sem id: ${ws}"
proj="$(curl -sS --max-time 30 -X POST "${auth[@]}" \
  -d "{\"name\":\"Reproj ${sufixo}\",\"slug\":\"${sufixo}\"}" "${API}/workspaces/${WS_ID}/projects")"
PROJ_ID="$(printf '%s' "${proj}" | jq -r '.id // empty')"
[[ -n "${PROJ_ID}" ]] || fail "projeto sem id: ${proj}"
sess="$(curl -sS --max-time 60 -X POST "${auth[@]}" -d '{"kind":"consultiva"}' \
  "${API}/projects/${PROJ_ID}/sessions")"
SESS_ID="$(printf '%s' "${sess}" | jq -r '.id // empty')"
[[ -n "${SESS_ID}" ]] || fail "sessão sem id: ${sess}"

for estado in active closing closed; do
  r="$(curl -sS --max-time 60 -X POST "${auth[@]}" -d "{\"status\":\"${estado}\"}" \
    "${API}/projects/${PROJ_ID}/sessions/${SESS_ID}/transition")"
  [[ "$(printf '%s' "${r}" | jq -r '.status // empty')" == "${estado}" ]] \
    || fail "sessão não foi para ${estado}: ${r}"
done
ok "projeto ${PROJ_ID}, sessão ${SESS_ID} fechada"

# --- 2. reprojeta e mede -----------------------------------------------------
info "reprojetando o projeto e medindo o subgrafo"
reprojetar "primeira"
ANTES="$(medir)"
ok "subgrafo (nós|arestas): ${ANTES}"
# Medida vazia seria prova vazia: o cenário TEM de ter projetado a Interacao.
[[ "${ANTES#*|}" -ge 2 ]] || fail "a reprojeção não gravou a Interacao do cenário (${ANTES})"

# --- 3. apaga o subgrafo e reconstrói ---------------------------------------
info "apagando o subgrafo do cenário e reprojetando"
cypher "MATCH (i:Interacao {sessionId: '${SESS_ID}'}) DETACH DELETE i" >/dev/null
cypher "MATCH (p:Projeto {id: '${PROJ_ID}'}) DETACH DELETE p" >/dev/null
VAZIO="$(medir)"
[[ "${VAZIO}" != "${ANTES}" ]] || fail "o subgrafo não foi apagado (${VAZIO})"
ok "apagado (nós|arestas): ${VAZIO}"
reprojetar "reconstrução"
DEPOIS="$(medir)"
[[ "${DEPOIS}" == "${ANTES}" ]] || fail "reconstruiu diferente: antes ${ANTES}, depois ${DEPOIS}"
ok "reconstruído igual: ${DEPOIS}"

# --- 4. idempotência ---------------------------------------------------------
info "reprojetando por cima"
reprojetar "segunda"
DE_NOVO="$(medir)"
[[ "${DE_NOVO}" == "${ANTES}" ]] || fail "a segunda reprojeção mudou o grafo: ${ANTES} -> ${DE_NOVO}"
ok "idempotente: ${DE_NOVO}"

printf '\n\033[32m[test-reprojecao] o grafo foi apagado e reconstruído a partir do event log, no cluster\033[0m\n'
