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
# desenvolvimento, que ocupa 3000/4000.
API_PORT="${API_PORT:-3000}"
ENGINE_PORT="${ENGINE_PORT:-4000}"
WEB_PORT="${WEB_PORT:-8088}"
SMOKE_USER="${SMOKE_USER:-owner@brabo.dev}"
# A política do domínio exige 12 caracteres — "admin123" não passaria.
SMOKE_PASSWORD="${SMOKE_PASSWORD:-brabo12345678}"

# Este compose roda com NODE_ENV=production, e desde o ADR 0059 a api recusa
# subir sem uma chave própria para assinar o `state` do OAuth de git. Gerada
# aqui, e descartada com o stack: o smoke não conecta git em provider nenhum,
# só precisa que o boot passe. Um valor fixo no script seria mais um literal
# público — exatamente o que a checagem existe para impedir.
export GIT_OAUTH_STATE_SECRET="${GIT_OAUTH_STATE_SECRET:-$(openssl rand -base64 32)}"

# Os quatro segredos irmãos (RN-114, mesmo padrão do ADR 0059/RN-093): a api
# recusa subir com o literal de exemplo, e o compose de produção parou de
# suprir esses defaults. Mesma lógica do de cima — gerados aqui, descartados
# com o stack.
export AUTH_JWT_SECRET="${AUTH_JWT_SECRET:-$(openssl rand -base64 32)}"
export BRABO_SERVICE_TOKEN="${BRABO_SERVICE_TOKEN:-$(openssl rand -base64 32)}"
export CREDENTIALS_MASTER_KEY="${CREDENTIALS_MASTER_KEY:-$(openssl rand -base64 32)}"
# Phoenix quer pelo menos 64 bytes — o dobro do tamanho dos outros três.
export SECRET_KEY_BASE="${SECRET_KEY_BASE:-$(openssl rand -base64 64)}"

# Grafo de conhecimento (ADR 0099/RN-413): NEO4J_URI e NEO4J_USER já têm
# default de dev no compose (bolt://neo4j:7687, neo4j — não são segredo).
# NEO4J_PASSWORD segue o mesmo padrão dos quatro segredos acima: sem valor
# aqui, o entrypoint do próprio Neo4j recusa subir (senha < 8 caracteres) e a
# api recusa o boot em produção (neo4j-config.ts) — gerada aqui e descartada
# com o stack. HEX, não base64: o entrypoint do Neo4j lê NEO4J_AUTH como
# "usuario/senha" e divide na PRIMEIRA barra — um base64 com `/` (achado
# testando de verdade, o smoke reprovava com "Invalid value for NEO4J_AUTH")
# quebra esse parse. Hex não tem `/`, `+` nem `=`.
export NEO4J_PASSWORD="${NEO4J_PASSWORD:-$(openssl rand -hex 24)}"

API="http://localhost:${API_PORT}"
ENGINE="http://localhost:${ENGINE_PORT}"
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

# A checagem dos TRÊS corpos do registro de gates (AT-086, AT-109) é a MESMA
# para as duas rotas que o servem, `GET /gates` (usuário) e `GET
# /internal/gates` (service token). Ela imprime o motivo e devolve 1, e quem
# chama decide o `fail`. As três respostas que ela separa:
#   - o registro, com `"gates":[` e o gate `merge-protegida`: passa;
#   - o 500 do Nest (`{"statusCode":500,...}`), que é o que a imagem devolvia
#     com o loader cobrando arquivo de prova em runtime: reprova;
#   - uma lista VAZIA, que passaria no primeiro grep e significaria o mesmo
#     que a rota não funcionar: reprova.
# É função, e não linha solta, para ser exercitada sem subir o stack
# (`scripts/ci/smoke-gates.spec.ts`).
checar_registro_de_gates() {
  local rota="$1" corpo="$2"
  if ! printf '%s' "${corpo}" | grep -q '"gates":\['; then
    printf '%s não devolveu o registro (500 por evidência ausente na imagem?): %s' "${rota}" "${corpo}"
    return 1
  fi
  if ! printf '%s' "${corpo}" | grep -q '"merge-protegida"'; then
    printf '%s respondeu sem o gate merge-protegida: %s' "${rota}" "${corpo}"
    return 1
  fi
}

# `GET /internal/gates` com o service token. O token NUNCA vai para o argv
# (`ps` o mostraria a qualquer usuário da máquina) nem para o log: o cabeçalho
# chega ao curl por `--config -`, pelo stdin, escrito por um `printf` que é
# builtin do bash. Nenhum processo o recebe como argumento.
gates_internos() {
  printf 'header = "x-brabo-service-token: %s"\n' "${BRABO_SERVICE_TOKEN}" \
    | curl -sS --max-time 30 --config - "${API}/internal/gates"
}

# Carregado com `source` (pelo spec acima), o script para aqui e entrega só as
# funções. Executado, segue para o stack.
[[ "${BASH_SOURCE[0]}" == "$0" ]] || return 0

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
info '1/3 — login no auth próprio da api'
# O usuário de smoke é provisionado pelo seed (senha conhecida, e-mail já
# verificado) — sem IdP externo não existe mais credencial pronta. Ver
# apps/api/src/scripts/provisionar-usuario.ts, que recusa rodar em produção.
"${COMPOSE[@]}" exec -T api node -e "process.exit(0)" >/dev/null 2>&1 \
  || fail "api não está de pé no compose"

# `node db/seed.js`, e não `pnpm seed`: o script do package.json é
# `ts-node src/db/seed.ts`, e a imagem de produção não tem pnpm, nem ts-node,
# nem `src/` — só o `dist` achatado em /app. O compilado do seed está em
# /app/db/seed.js.
#
# `BRABO_FORCE_SEED=1` porque este compose roda com NODE_ENV=production, e o
# `provisionarUsuario` recusa criar conta com senha conhecida e e-mail já
# verificado nesse modo. A recusa é de propósito, e este é o único lugar que
# tem motivo para burlá-la: banco efêmero, derrubado com `down -v` no fim.
seed_saida="$("${COMPOSE[@]}" exec -T \
  -e BRABO_SEED_PASSWORD="${SMOKE_PASSWORD}" \
  -e BRABO_FORCE_SEED=1 \
  api node db/seed.js 2>&1)" || {
  # Não aborta: com SMOKE_KEEP_UP o banco sobrevive entre execuções e o seed
  # reprova ao recriar o workspace, mas o login seguinte funciona igual.
  #
  # IMPRIME, porém. Engolir esta saída em `>/dev/null 2>&1` foi o que fez um
  # seed que nunca rodava aparecer três passos depois como um 401 sem
  # explicação — a causa ficava invisível justamente onde ela estava.
  info 'seed não completou (esperado se o banco já estava semeado):'
  printf '%s\n' "${seed_saida}" | tail -20
}

token_response="$(curl -sS --max-time 30 \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${SMOKE_USER}\",\"senha\":\"${SMOKE_PASSWORD}\"}" \
  "${API}/auth/login")" \
  || fail "api não respondeu em ${API}/auth/login"

TOKEN="$(printf '%s' "${token_response}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')"
[[ -n "${TOKEN}" ]] || fail "sem accessToken na resposta do login: ${token_response}"
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

# `kind` é OBRIGATÓRIO desde a FASE 20: o tipo da sessão é escolha de quem a
# abre, e a rota recusa com 400 sem ele. Esta linha é a prova de que a mudança
# tem consumidor fora do web — foi ela que reprovou o smoke quando o campo
# nasceu sem que ninguém aqui soubesse.
#
# `consultiva` porque o smoke só exercita criar → ativar → encerrar; ele nunca
# ativa EXECUÇÃO, e `execution.activated` numa consultiva é 409 por desenho.
sess="$(curl -sS --max-time 60 -X POST "${auth[@]}" \
  -d '{"kind":"consultiva"}' \
  "${API}/projects/${PROJ_ID}/sessions")" || fail "POST /projects/:id/sessions não respondeu"
SESS_ID="$(printf '%s' "${sess}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
[[ -n "${SESS_ID}" ]] || fail "sessão sem id na resposta: ${sess}"
# Criar sessão NÃO chama o engine — só grava a linha e o evento de outbox.
# Quem exercita api -> engine é a ativação, logo abaixo.
printf '%s' "${sess}" | grep -q '"status":"created"' \
  || fail "sessão criada em status inesperado: ${sess}"
ok "sessão ${SESS_ID} em status created"

# É a ativação que faz a api chamar o engine por HTTP interno com token de
# client credentials — este passo, e não o anterior, prova o caminho
# api -> auth próprio -> engine inteiro.
act="$(curl -sS --max-time 60 -X POST "${auth[@]}" -d '{"status":"active"}' \
  "${API}/projects/${PROJ_ID}/sessions/${SESS_ID}/transition")" \
  || fail "POST transition não respondeu"
printf '%s' "${act}" | grep -q '"status":"active"' \
  || fail "sessão não ativou (api -> engine quebrado?): ${act}"
ok "sessão ativada — api -> engine ok"

# --------------------------------------------------------------------------
step=2.5
info 'registro de gates servido pela IMAGEM (GET /gates e /internal/gates)'
# Por que aqui, e não numa suite: o registro é o único arquivo de `docs/` que
# a imagem carrega, e o que quebrava não era o conteúdo dele — era o loader
# cobrando, EM RUNTIME, que os arquivos de prova citados existissem no disco.
# `apps/api/test/`, `scripts/ci/` e `.github/` nunca entram na imagem, então o
# registro era inválido em TODA instalação e a rota respondia 500. Medido na
# v6.1.0: 12 respostas 5xx em ~55min.
#
# Nenhuma suite pegava isso, e não por descuido: vitest e ExUnit rodam DE UM
# CHECKOUT, onde os alvos existem. A pergunta "a árvore da imagem tem o que a
# api lê em runtime?" é a mesma classe do `kind` obrigatório no passo 2 — só o
# smoke a faz, como cliente externo, sem mock, contra a imagem de produção.
gates="$(curl -sS --max-time 30 "${auth[@]}" "${API}/gates")" \
  || fail "GET /gates não respondeu"
motivo="$(checar_registro_de_gates 'GET /gates' "${gates}")" || fail "${motivo}"
ok 'GET /gates serve o registro de dentro da imagem'

# A rota interna lê o MESMO loader e sofria do MESMO 500 (corrigida junto no
# #584), mas estava sem smoke: o `GET /gates` acima não a exercita, e ela tem
# guard próprio (service token, não JWT). O token é o que este script exportou
# lá em cima para o compose, o mesmo que a api compara.
gates_int="$(gates_internos)" || fail "GET /internal/gates não respondeu"
motivo="$(checar_registro_de_gates 'GET /internal/gates' "${gates_int}")" || fail "${motivo}"
ok 'GET /internal/gates serve o registro de dentro da imagem'

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

# A configuração de runtime é a única coisa da imagem do web que muda por
# ambiente. Se o entrypoint parar de gerá-la, a app não quebra: ela cai no
# fallback compile-time e passa a apontar pro ambiente ERRADO, em silêncio.
web_config="$(curl -sS --max-time 15 "${WEB}/config.js")" || fail "web não serviu /config.js"
printf '%s' "${web_config}" | grep -q '__BRABO_CONFIG__' \
  || fail "/config.js não define __BRABO_CONFIG__: ${web_config}"
printf '%s' "${web_config}" | grep -q "apiUrl" \
  || fail "/config.js sem apiUrl — a app cairia no fallback compile-time sem avisar"
ok "web serve /config.js com a configuração de runtime"

step=0
printf '\n\033[32m[smoke] os 3 passos passaram\033[0m\n'
