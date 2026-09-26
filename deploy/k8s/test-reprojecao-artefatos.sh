#!/usr/bin/env bash
# AT-198 — a reprojeção da pasta `docs/` dos artefatos a partir do event log,
# PROVADA NO CLUSTER (RN-590). Irmã de `test-reprojecao.sh` (o grafo, AT-127):
# o binário é o MESMO que o runbook manda rodar num incidente —
# `kubectl exec deploy/api -- node scripts/reprojetar-artefatos.js` —, dentro da
# imagem de produção, sobre o Postgres do cluster e o volume que a api monta.
# Até aqui só o spec `apps/api/test/scripts/reprojetar-artefatos.spec.ts` a
# provava, contra um diretório temporário: nunca a imagem, nunca o PVC.
#
# ## O que ele faz
#
#   1. cria, pela API, um projeto NOVO com uma sessão e um `artifact.note`
#      (um agente de slug aleatório, então a pasta `docs/<agente>/` é só dele);
#   2. espera o `ArtifactProjector` vivo escrever o arquivo e guarda o sha256;
#   3. APAGA a pasta `docs/<agente>/` e reprojeta: o arquivo tem de voltar com
#      o MESMO sha256 — o projetor vivo e a reprojeção são o mesmo tradutor;
#   4. reprojeta de novo por cima: idempotente, mesmo sha256.
#
# ## Por que não depende da ordem dos alvos (AT-078)
#
# Mesmo desenho do irmão: projeto próprio, escopo e remoção limitados a ele,
# só fala com a `api`. Não depende de backup nem de outro alvo.
#
# ## Onde o arquivo mora
#
# Quem sabe é `pastaDeArtefatosDoProjeto` (modo `container`, o padrão:
# `<PROJECT_WORKSPACES_ROOT>/<workspaceDirName>/docs/`). O script NÃO deriva o
# caminho: procura o arquivo pelo nome da pasta do agente, que é única desta
# rodada. Derivar aqui seria uma segunda régua do mesmo caminho.
#
# Uso: bash deploy/k8s/test-reprojecao-artefatos.sh
set -euo pipefail

NS="${BRABO_NAMESPACE:-brabo}"
API="${API_URL:-http://localhost:3000}"
SMOKE_USER="${SMOKE_USER:-owner@brabo.dev}"
SMOKE_PASSWORD="${BRABO_SMOKE_PASSWORD:-brabo12345678}"
RAIZ_NO_POD="${PROJECT_WORKSPACES_ROOT_NO_POD:-/data/project-workspaces}"

info() { printf '\n\033[1m[test-reprojecao-artefatos]\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }

fail() {
  printf '\n\033[31m[test-reprojecao-artefatos] FALHOU: %s\033[0m\n' "$*" >&2
  printf '\n--- pods ---\n' >&2
  kubectl -n "${NS}" get pods -o wide >&2 || true
  printf '\n--- log recente da api ---\n' >&2
  kubectl -n "${NS}" logs deploy/api --tail=40 >&2 2>/dev/null || true
  exit 1
}

command -v kubectl >/dev/null || fail "kubectl não encontrado no PATH"
command -v jq >/dev/null || fail "jq não encontrado no PATH"

no_pod() { kubectl -n "${NS}" exec deploy/api -- "$@"; }

# O caminho do arquivo do artefato, achado pela pasta do agente (única da
# rodada). Vazio quando não existe.
achar() {
  no_pod find "${RAIZ_NO_POD}" -path "*/docs/${AGENTE}/*.md" -type f 2>/dev/null | head -1
}

# sha256 do arquivo, lido de DENTRO do pod: é o que a api enxerga.
hash_de() {
  no_pod node -e 'const c=require("crypto"),f=require("fs");process.stdout.write(c.createHash("sha256").update(f.readFileSync(process.argv[1])).digest("hex"))' "$1"
}

reprojetar() {
  local saida
  saida="$(no_pod node scripts/reprojetar-artefatos.js --project "${PROJ_ID}" 2>&1)" \
    || { printf '%s\n' "${saida}" | sed 's/^/    /' >&2; fail "reprojetar-artefatos.js saiu com erro (${1})"; }
  printf '%s\n' "${saida}" | sed 's/^/    /'
}

# --- 1. cenário, pela API ----------------------------------------------------
info "criando o cenário pela API (projeto novo, um artifact.note)"
resposta="$(curl -sS --max-time 30 -H 'Content-Type: application/json' \
  -d "{\"email\":\"${SMOKE_USER}\",\"senha\":\"${SMOKE_PASSWORD}\"}" "${API}/auth/login")" \
  || fail "api não respondeu em ${API}/auth/login"
TOKEN="$(printf '%s' "${resposta}" | jq -r '.accessToken // empty')"
[[ -n "${TOKEN}" ]] || fail "sem accessToken no login: ${resposta}"
auth=(-H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json')

sufixo="artef-$(date +%s)"
AGENTE="${sufixo}-agente"
ws="$(curl -sS --max-time 30 -X POST "${auth[@]}" \
  -d "{\"name\":\"Artef ${sufixo}\",\"slug\":\"${sufixo}\"}" "${API}/workspaces")"
WS_ID="$(printf '%s' "${ws}" | jq -r '.id // empty')"
[[ -n "${WS_ID}" ]] || fail "workspace sem id: ${ws}"
proj="$(curl -sS --max-time 30 -X POST "${auth[@]}" \
  -d "{\"name\":\"Artef ${sufixo}\",\"slug\":\"${sufixo}\"}" "${API}/workspaces/${WS_ID}/projects")"
PROJ_ID="$(printf '%s' "${proj}" | jq -r '.id // empty')"
[[ -n "${PROJ_ID}" ]] || fail "projeto sem id: ${proj}"
sess="$(curl -sS --max-time 60 -X POST "${auth[@]}" -d '{"kind":"consultiva"}' \
  "${API}/projects/${PROJ_ID}/sessions")"
SESS_ID="$(printf '%s' "${sess}" | jq -r '.id // empty')"
[[ -n "${SESS_ID}" ]] || fail "sessão sem id: ${sess}"

r="$(curl -sS --max-time 60 -X POST "${auth[@]}" -d '{"status":"active"}' \
  "${API}/projects/${PROJ_ID}/sessions/${SESS_ID}/transition")"
[[ "$(printf '%s' "${r}" | jq -r '.status // empty')" == "active" ]] || fail "sessão não foi para active: ${r}"

corpo="{\"type\":\"artifact.note\",\"actor\":{\"kind\":\"agent\",\"id\":\"${AGENTE}\"},\"payload\":{\"title\":\"Prova de reprojecao\",\"body\":\"o arquivo volta igual\"}}"
r="$(curl -sS --max-time 60 -X POST "${auth[@]}" -d "${corpo}" "${API}/projects/${PROJ_ID}/sessions/${SESS_ID}/events")"
[[ -n "$(printf '%s' "${r}" | jq -r '.id // empty')" ]] || fail "evento não gravado: ${r}"
ok "projeto ${PROJ_ID}, artifact.note de ${AGENTE}"

# --- 2. o projetor vivo escreve ---------------------------------------------
# Com teto: o `ArtifactProjector` drena a outbox por intervalo. Se ele não
# escrever, a reprojeção ainda é provada no passo 3 — mas a comparação de
# conteúdo com o projetor vivo não, e isso é dito em vez de pulado calado.
info "esperando o ArtifactProjector vivo escrever o arquivo"
ARQUIVO=""
for _ in $(seq 1 30); do
  ARQUIVO="$(achar)"
  [[ -n "${ARQUIVO}" ]] && break
  sleep 2
done
if [[ -n "${ARQUIVO}" ]]; then
  VIVO="$(hash_de "${ARQUIVO}")"
  ok "projetor vivo escreveu ${ARQUIVO} (sha256 ${VIVO:0:12}…)"
else
  fail "o ArtifactProjector não escreveu docs/${AGENTE}/ em 60s — o caminho vivo da projeção está parado"
fi

# --- 3. apaga e reconstrói ---------------------------------------------------
info "apagando docs/${AGENTE}/ e reprojetando"
no_pod rm -rf "$(dirname "${ARQUIVO}")"
[[ -z "$(achar)" ]] || fail "a pasta do agente não foi apagada"
ok "apagado"
reprojetar "reconstrução"
DEPOIS_ARQ="$(achar)"
[[ "${DEPOIS_ARQ}" == "${ARQUIVO}" ]] || fail "reconstruiu em outro caminho: antes ${ARQUIVO}, depois ${DEPOIS_ARQ:-nenhum}"
DEPOIS="$(hash_de "${DEPOIS_ARQ}")"
[[ "${DEPOIS}" == "${VIVO}" ]] || fail "reconstruiu diferente do projetor vivo: ${VIVO} -> ${DEPOIS}"
ok "reconstruído igual ao do projetor vivo"

# --- 4. idempotência ---------------------------------------------------------
info "reprojetando por cima"
reprojetar "segunda"
DE_NOVO="$(hash_de "${ARQUIVO}")"
[[ "${DE_NOVO}" == "${VIVO}" ]] || fail "a segunda reprojeção mudou o arquivo: ${VIVO} -> ${DE_NOVO}"
ok "idempotente"

printf '\n\033[32m[test-reprojecao-artefatos] a pasta de artefatos foi apagada e reconstruída a partir do event log, no cluster\033[0m\n'
