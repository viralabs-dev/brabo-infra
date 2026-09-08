#!/usr/bin/env bash
# Reset total do ambiente de dev: reconstrói as imagens, apaga o banco, sobe
# o compose de novo até tudo ficar saudável, migra (api + engine) e semeia —
# incluindo as credenciais de provider já salvas em `.env`, pelas MESMAS
# variáveis `<PROVIDER>_TEST_KEY` que os smokes de LLM já usam
# (apps/api/test/infrastructure/llm/*.smoke.spec.ts). Uma convenção de nome
# só, dois consumidores: testar o provider de verdade e, aqui, poupar quem
# reseta o banco local de recadastrar a chave na UI toda vez.
#
# A ORDEM é o coração deste script, e ela mudou depois de uma execução real
# que terminou dizendo "reset completo" com o ambiente quebrado. Antes, o
# `DROP SCHEMA` acontecia com api e engine DE PÉ — e o engine morre na hora
# (`Engine.Sessions.Rehydrator` consulta `engine.session_states`, que acabou
# de sumir: `ERROR 42P01 relation "engine.session_states" does not exist`).
# As migrations recriavam tudo depois, mas nada reerguia o processo morto, e
# o seed falhava no passo que ativa a sessão (api -> engine) com
# `ECONNREFUSED`. O registro anterior do mesmo fenômeno visto do outro lado
# ("o reset derruba a api") tem esta mesma causa raiz: o script destruía o
# banco embaixo de processos vivos.
#
# Agora: parar os DOIS processos que têm conexão viva com o banco, apagar,
# migrar, subir os dois de novo e só então semear — com a saúde de cada um
# VERIFICADA antes de o script afirmar qualquer coisa.
#
# Chamado pelo item "Docker › Reset total" do bootstrap.sh; roda sozinho
# também: bash scripts/dev/reset-total.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

COMPOSE=(docker compose -f docker/docker-compose.yml --env-file .env)

# Os DOIS serviços que este script para antes de apagar o banco, e nenhum a
# mais. O critério é objetivo: quem mantém conexão viva com o Postgres do
# compose. A api (pool do Drizzle, schemas `public`/`drizzle`) e o engine
# (Ecto/Oban, schema `engine`) mantêm; `web` é servidor do Vite e não fala com
# banco nenhum, `neo4j` é OUTRO banco e este reset não o toca, `broker` só fala
# HTTP com a api. Parar de menos deixa o defeito; parar de mais transforma um
# reset de banco numa derrubada do ambiente inteiro.
SERVICOS_COM_BANCO=(api engine)

# O que o script afirma no fim: cada um destes três precisa RESPONDER, e é a
# resposta — não o "running" do Docker — que autoriza a frase final.
# `/health` da api e do engine tocam o Postgres de propósito (`/live` não
# tocaria, e é justamente o banco que este script acabou de recriar); o `web`
# não tem probe própria, então a pergunta honesta é se o Vite entrega a página.
SERVICOS_VERIFICADOS=("api 3000 /health" "engine 4000 /health" "web 5173 /")

# O passo em curso, para o `trap` abaixo poder dizer ONDE parou. Sem isto, uma
# falha no meio deixa o usuário com a última linha de log de um comando
# qualquer e nenhuma frase que diga o que ficou pela metade.
PASSO="iniciando"
concluido=0

# Lê UMA chave do `.env` sem `source` — a mesma disciplina de
# scripts/dev/perfil-ollama.sh e do laço de `*_TEST_KEY` no fim deste arquivo.
# `source .env` aqui é proibido: metade do arquivo aponta para hostnames que só
# existem DENTRO do compose (`postgres`, `engine`), e tudo daqui para baixo que
# não é `docker compose` roda no HOST.
valor_do_env() {
  local chave="$1" padrao="$2" valor=''
  if [[ -f .env ]]; then
    # `|| true` porque `grep` sem match, sob `pipefail`, derrubaria o script — e
    # "a chave não está no .env" é o caso normal (o compose tem os defaults).
    valor="$(grep -E "^${chave}=" .env 2>/dev/null | tail -n1 | cut -d '=' -f2- || true)"
  fi
  printf '%s' "${valor:-${padrao}}"
}

# O endereço pelo qual o HOST alcança um serviço do compose: a porta que o
# PRÓPRIO compose publicou, perguntada a ele.
#
# Isto conserta um defeito silencioso e independente da ordem: os três passos
# de host abaixo (`db:migrate`, `engine:migrate`, `seed`) caíam nos defaults
# embutidos do código — `localhost:5432` no drizzle.config.ts, `localhost:4000`
# no ApiToEngineClient. Com `API_PORT`/`ENGINE_PORT` trocados no `.env` — knobs
# que este compose oferece — o seed conversava com QUALQUER engine que
# estivesse na 4000, não com o desta stack. E qualquer `DATABASE_URL` exportado
# no shell de quem chama (o valor do `.env` aponta para o hostname `postgres`,
# que não resolve no host) quebrava as migrations com `EAI_AGAIN`.
endereco_publicado() {
  local servico="$1" porta="$2" publicado
  publicado="$("${COMPOSE[@]}" port "${servico}" "${porta}" | tail -n1)"
  if [[ -z "${publicado}" ]]; then
    echo "não descobri a porta publicada de ${servico}:${porta}" >&2
    return 1
  fi
  # `0.0.0.0:5432`, `[::]:5432` ou `127.0.0.1:5432` — só a porta importa, e
  # `localhost` é o nome certo para o lado de cá.
  printf 'localhost:%s' "${publicado##*:}"
}

ao_sair() {
  local codigo=$?
  (( concluido == 1 )) && return 0
  echo ""
  echo "RESET INCOMPLETO — parou em: ${PASSO} (código ${codigo})."
  echo "O banco pode estar apagado e não semeado. Rode este script de novo:"
  echo "  bash scripts/dev/reset-total.sh"
  return 0
}
trap ao_sair EXIT

PASSO="preflight de portas"
echo "==> preflight de portas…"
# Entre outras coisas, detecta um Ollama nativo já rodando na porta de
# OLLAMA_PORT e, se for o caso, grava OLLAMA_MODE/OLLAMA_HOST em .env — é
# essa gravação que scripts/dev/perfil-ollama.sh lê logo abaixo.
node scripts/dev/preflight.mjs

# `--profile local-llm` some quando `.env` (já atualizado pelo preflight,
# acima) tem OLLAMA_MODE=host — sem isto o `up` tentaria publicar a 11434 de
# novo e chocaria com a instalação nativa que o preflight acabou de detectar.
# ARRAY e não string: `$(...)` solto no meio do comando é o SC2046 que o
# linter de shell reprovava aqui, e a lista vazia (o caso OLLAMA_MODE=host)
# só desaparece de verdade com `${VAR[@]}`.
PERFIL=()
read -r -a PERFIL <<< "$(bash scripts/dev/perfil-ollama.sh)" || true

PASSO="build das imagens"
echo "==> reconstruindo imagens…"
# Separado do `up`: o build é a parte demorada e não tem nada a ver com o
# banco, então ele acontece ANTES de qualquer processo ser parado — o
# ambiente do usuário fica de pé o máximo de tempo possível.
"${COMPOSE[@]}" "${PERFIL[@]}" build

PASSO="parando api e engine"
echo "==> parando ${SERVICOS_COM_BANCO[*]} (as duas com conexão viva no banco)…"
# ESTE é o passo que faltava. Sem ele o `DROP SCHEMA` abaixo derruba os dois
# processos, e nada os reergue — ver o cabeçalho deste arquivo. `stop` é
# no-op silencioso quando o serviço nem existe (primeira subida da máquina).
"${COMPOSE[@]}" stop "${SERVICOS_COM_BANCO[@]}"

PASSO="subindo o postgres"
echo "==> subindo o postgres…"
# Só o postgres: é tudo o que o `DROP SCHEMA` abaixo precisa, e subir api ou
# engine aqui reabriria exatamente as conexões que a linha de cima fechou.
"${COMPOSE[@]}" up -d --wait --wait-timeout "${BRABO_RESET_WAIT_TIMEOUT:-600}" postgres

PASSO="apagando os schemas"
echo "==> apagando engine, drizzle e public (api e engine dividem o mesmo banco)…"
# Mesmo SQL do item Database › Delete — as TRÊS armadilhas documentadas ali:
# pgvector só é criada na primeira inicialização do volume (por isso é
# recriada aqui); `engine.*` é schema PRÓPRIO do Ecto/Oban, que um DROP só de
# `public` não alcança (mix ecto.migrate falharia com `duplicate_table`); e
# `drizzle.__drizzle_migrations` é o controle PRÓPRIO do drizzle-kit, também
# fora de `public` — sem apagá-lo, `pnpm db:migrate` acha que já rodou tudo e
# não recria nenhuma tabela da api.
"${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 \
  -U "$(valor_do_env POSTGRES_USER brabo)" -d "$(valor_do_env POSTGRES_DB brabo)" \
  -c 'DROP SCHEMA IF EXISTS engine CASCADE;' \
  -c 'DROP SCHEMA IF EXISTS drizzle CASCADE;' \
  -c 'DROP SCHEMA public CASCADE;' \
  -c 'CREATE SCHEMA public;' \
  -c 'CREATE EXTENSION IF NOT EXISTS vector;'

PASSO="migrations (api + engine)"
echo "==> aplicando migrations (api + engine)…"
# Do HOST, contra a porta publicada do postgres — e com api e engine ainda
# parados, de propósito: o `up` seguinte encontra o banco já migrado em vez de
# duas migrations correndo ao mesmo tempo (o CMD de dev dos dois containers
# roda `pnpm db:migrate` / `mix ecto.migrate` no boot).
#
# `DATABASE_URL` na FRENTE do comando, nunca `export`: exportá-la contaminaria
# a interpolação do `docker compose up` logo abaixo, e a api dentro do
# container receberia um `localhost` que, lá dentro, é ela mesma.
DATABASE_URL_HOST="postgres://$(valor_do_env POSTGRES_USER brabo):$(valor_do_env POSTGRES_PASSWORD brabo)@$(endereco_publicado postgres 5432)/$(valor_do_env POSTGRES_DB brabo)"
DATABASE_URL="${DATABASE_URL_HOST}" pnpm db:migrate
DATABASE_URL="${DATABASE_URL_HOST}" pnpm engine:migrate

PASSO="subindo o ambiente e esperando ficar saudável"
echo "==> subindo tudo e esperando ficar saudável (--wait)…"
# `--wait` só passou a significar alguma coisa para api/engine/web quando os
# três ganharam `healthcheck` no docker-compose.yml. Antes, ele esperava
# "running" e seguia em frente — foi assim que o broker morreu em silêncio
# antes de ganhar o dele, e é por isso que este script conseguia terminar com
# a api em `Exited (1)`.
"${COMPOSE[@]}" "${PERFIL[@]}" up -d --wait --wait-timeout "${BRABO_RESET_WAIT_TIMEOUT:-600}"

PASSO="semeando dados de demonstração"
echo "==> semeando dados de demonstração…"
# Exporta SÓ as chaves de provider (*_TEST_KEY) de `.env` — nunca o arquivo
# inteiro via `source`: `DATABASE_URL` e afins ali apontam para hostnames
# Docker-internos (`postgres`, `engine`...), e o seed roda no HOST (achado
# rodando pela primeira vez: `source .env` aqui quebrava com `getaddrinfo
# EAI_AGAIN postgres`, mesmo depois de `db:migrate`/`engine:migrate` terem
# rodado certinho ANTES desta linha, sem nada exportado). O seed
# (apps/api/src/db/seed.ts) já sabe ler cada `*_TEST_KEY` e ativar como
# credencial do owner; provider sem variável definida simplesmente não entra.
while IFS='=' read -r chave valor; do
  [[ -n "${chave}" ]] || continue
  export "${chave}=${valor}"
done < <(grep -E '^[A-Z0-9_]+_TEST_KEY=' .env || true)
# `ENGINE_URL` pelo mesmo motivo de `DATABASE_URL` acima: o seed ATIVA a sessão,
# e ativar sessão é uma chamada api -> engine. Sem isto ele cai no
# `http://localhost:4000` embutido no `ApiToEngineClient` — o engine DESTA
# stack só por acaso, e o de outra pessoa se `ENGINE_PORT` estiver trocado.
DATABASE_URL="${DATABASE_URL_HOST}" \
  ENGINE_URL="http://$(endereco_publicado engine 4000)" \
  pnpm --filter api seed

PASSO="verificando a saúde de api, engine e web"
echo ""
echo "==> conferindo quem ficou de pé…"
# A frase final é uma AFIRMAÇÃO sobre o ambiente, então ela vem depois de
# perguntar — e a pergunta é feita DENTRO de cada container, o mesmo teste do
# healthcheck, sem depender de porta publicada nem de ferramenta no host.
falhas=()
verificados=()
for linha in "${SERVICOS_VERIFICADOS[@]}"; do
  read -r servico porta caminho <<< "${linha}"
  verificados+=("${servico}")
  if "${COMPOSE[@]}" exec -T "${servico}" \
      wget -qO- "http://127.0.0.1:${porta}${caminho}" >/dev/null 2>&1; then
    echo "  ✓ ${servico} responde em ${caminho}"
  else
    echo "  ✗ ${servico} NÃO responde em ${caminho}"
    falhas+=("${servico}")
  fi
done

echo ""
"${COMPOSE[@]}" ps

concluido=1
echo ""
if (( ${#falhas[@]} > 0 )); then
  echo "RESET INCOMPLETO — banco apagado, migrado e semeado, mas estes serviços não responderam: ${falhas[*]}."
  echo "Veja o log com: docker compose -f docker/docker-compose.yml --env-file .env logs ${falhas[*]}"
  exit 1
fi

echo "reset completo — banco recriado e semeado; ${verificados[*]} de pé e respondendo."
