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
#   1. cria, pela API, um projeto NOVO com uma sessão de quatro eventos (uma
#      mensagem, um handoff, uma hipótese do Psicólogo e um perfil da
#      Anamnese) levada até `closed` — fechar sessão não deixa evento no log,
#      e a `Interacao` só nasce de sessão que teve algum;
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
# Só o subgrafo do cenário é apagado (o que `escopo()` seleciona); o `Usuario`
# do login é compartilhado e fica. O `Usuario` do perfil da Anamnese NÃO é o do
# login: é um id próprio do cenário, e por isso entra no escopo e é apagado e
# reconstruído junto.
#
# ## Os quatro caminhos do tradutor (AT-191)
#
# `GraphEventTranslator.projetarEvento` traduz três tipos do log
# (`handoff.offered`, `psychologist.hypothesis_proposed`,
# `anamnese.profile_updated`) e `projetarFechamentoDeSessao` o quarto (a
# `Interacao`). Até a AT-191 o cenário exercitava só dois — a `Hipotese` e o
# `PerfilAnamnese` ficavam provados apenas no spec contra o Neo4j de dev. Os
# dois eventos entram pela MESMA rota de append que os outros; o Psicólogo e a
# Anamnese seguem PAUSADOS (`PSYCHOLOGIST_ENABLED`/`ANAMNESE_ENABLED`), e a
# prova não depende deles: o que se prova é a TRADUÇÃO do evento que eles
# gravariam, que é o que a reprojeção reconstrói.
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

# Cypher pelo driver que a PRÓPRIA api já tem (`neo4j-driver`, com `NEO4J_URI`,
# `NEO4J_USER` e `NEO4J_PASSWORD` do ambiente do pod) — nenhuma senha passa por
# este script. Não é `cypher-shell` no pod do Neo4j: o container dele tem teto de
# 1Gi, quase todo de heap e pagecache, e uma segunda JVM ali morreu com 137
# (medido, run 35469877869).
JS_CYPHER='const n=require("neo4j-driver");(async()=>{const d=n.driver(process.env.NEO4J_URI,n.auth.basic(process.env.NEO4J_USER,process.env.NEO4J_PASSWORD));try{const r=await d.session().run(process.argv[1]);for(const x of r.records)console.log(x.keys.map(k=>{const v=x.get(k);return n.isInt(v)?v.toNumber():v}).join("|"))}finally{await d.close()}})().catch(e=>{console.error(e.message);process.exit(1)})'
cypher() {
  kubectl -n "${NS}" exec deploy/api -- node -e "${JS_CYPHER}" "$1"
}

# O subgrafo do cenário: o Projeto, a Interacao, o Handoff, a Hipotese e o
# Evento que ela cita, os dois Agente de slug aleatório, o PerfilAnamnese e o
# Usuario PRÓPRIO dele. O Usuario do login é compartilhado e NÃO entra.
# O argumento é o nome da variável do Cypher (`n`, `a`, `b`).
escopo() {
  local v="${1:-n}"
  printf "(%s:Projeto AND %s.id = '%s') OR ((%s:Interacao OR %s:Handoff OR %s:Hipotese OR %s:Evento) AND %s.sessionId = '%s') OR (%s:Agente AND %s.slug IN ['%s','%s']) OR (%s:PerfilAnamnese AND %s.userId = '%s') OR (%s:Usuario AND %s.id = '%s')" \
    "$v" "$v" "${PROJ_ID}" "$v" "$v" "$v" "$v" "$v" "${SESS_ID}" "$v" "$v" "${SLUG_X}" "${SLUG_Y}" \
    "$v" "$v" "${UID_ANAMNESE}" "$v" "$v" "${UID_ANAMNESE}"
}

# "nós|arestas" do subgrafo. Aresta é contada UMA vez (direcionada, DISTINCT)
# se ao menos uma ponta está no escopo — o `PARTICIPOU` do Usuario do login
# para a Interacao entra, porque a ponta de chegada é do cenário.
medir() {
  cypher "MATCH (n) WHERE $(escopo n) WITH count(n) AS nos OPTIONAL MATCH (a)-[r]->(b) WHERE $(escopo a) OR $(escopo b) RETURN nos, count(DISTINCT r)"
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

# Quatro eventos no log: sem evento a sessão fechada não vira Interacao
# (`nextSeq` 1, `seqFim < 1`) e a prova mediria um grafo vazio — medido no run
# 35469877869. A hipótese cita a MENSAGEM como evidência pelo id que o append
# devolve, que é o que o Psicólogo grava (`evidenceEventIds`); o tradutor a
# resolve para o `seq` e cria o `Evento` da aresta `EVIDENCIA`.
SLUG_X="${sufixo}-x"; SLUG_Y="${sufixo}-y"
UID_ANAMNESE="${sufixo}-usuario"
transitar() {
  local r
  r="$(curl -sS --max-time 60 -X POST "${auth[@]}" -d "{\"status\":\"$1\"}" \
    "${API}/projects/${PROJ_ID}/sessions/${SESS_ID}/transition")"
  [[ "$(printf '%s' "${r}" | jq -r '.status // empty')" == "$1" ]] \
    || fail "sessão não foi para $1: ${r}"
}
transitar active
gravar_evento() {
  local r id
  r="$(curl -sS --max-time 60 -X POST "${auth[@]}" -d "$1" "${API}/projects/${PROJ_ID}/sessions/${SESS_ID}/events")"
  id="$(printf '%s' "${r}" | jq -r '.id // empty')"
  [[ -n "${id}" ]] || fail "evento não gravado: ${r}"
  printf '%s' "${id}"
}
MSG_ID="$(gravar_evento '{"type":"user.message","actor":{"kind":"system","id":"reprojecao"},"payload":{"text":"oi"}}')"
gravar_evento "{\"type\":\"handoff.offered\",\"actor\":{\"kind\":\"agent\",\"id\":\"${SLUG_X}\"},\"payload\":{\"toAgent\":\"${SLUG_Y}\"}}" >/dev/null
gravar_evento "{\"type\":\"psychologist.hypothesis_proposed\",\"actor\":{\"kind\":\"agent\",\"id\":\"psychologist\"},\"payload\":{\"hypothesisId\":\"${sufixo}-hipotese\",\"hipotese\":\"prova de reprojeção\",\"evidenceEventIds\":[\"${MSG_ID}\"]}}" >/dev/null
gravar_evento "{\"type\":\"anamnese.profile_updated\",\"actor\":{\"kind\":\"agent\",\"id\":\"anamnese\"},\"payload\":{\"userId\":\"${UID_ANAMNESE}\",\"competency\":\"reprojecao\",\"level\":\"avancado\"}}" >/dev/null

transitar closing
transitar closed
ok "projeto ${PROJ_ID}, sessão ${SESS_ID} fechada"

# --- 2. reprojeta e mede -----------------------------------------------------
info "reprojetando o projeto e medindo o subgrafo"
reprojetar "primeira"
ANTES="$(medir)"
ok "subgrafo (nós|arestas): ${ANTES}"
# Medida vazia seria prova vazia: o cenário TEM de ter projetado a Interacao.
[[ "${ANTES}" == "9|6" ]] || fail "subgrafo inesperado depois da reprojeção: ${ANTES} (esperado 9|6: Projeto, Interacao, Handoff, 2 Agente, Hipotese, Evento, PerfilAnamnese, Usuario; PARTICIPOU, NO_PROJETO, DE, PARA, EVIDENCIA, SOBRE)"

# --- 3. apaga o subgrafo e reconstrói ---------------------------------------
info "apagando o subgrafo do cenário e reprojetando"
cypher "MATCH (n) WHERE $(escopo n) DETACH DELETE n" >/dev/null
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
