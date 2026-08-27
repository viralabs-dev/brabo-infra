#!/usr/bin/env bash
# Reset total do ambiente de dev: reconstrói as imagens, apaga o banco, sobe
# o compose de novo até tudo ficar saudável, migra (api + engine) e semeia —
# incluindo as credenciais de provider já salvas em `.env`, pelas MESMAS
# variáveis `<PROVIDER>_TEST_KEY` que os smokes de LLM já usam
# (apps/api/test/infrastructure/llm/*.smoke.spec.ts). Uma convenção de nome
# só, dois consumidores: testar o provider de verdade e, aqui, poupar quem
# reseta o banco local de recadastrar a chave na UI toda vez.
#
# Chamado pelo item "Docker › Reset total" do bootstrap.sh; roda sozinho
# também: bash scripts/dev/reset-total.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

COMPOSE="docker compose -f docker/docker-compose.yml --env-file .env"

echo "==> preflight de portas…"
# Entre outras coisas, detecta um Ollama nativo já rodando na porta de
# OLLAMA_PORT e, se for o caso, grava OLLAMA_MODE/OLLAMA_HOST em .env — é
# essa gravação que scripts/dev/perfil-ollama.sh lê logo abaixo.
node scripts/dev/preflight.mjs

echo "==> reconstruindo imagens e subindo até tudo saudável (--wait)…"
# `$(bash scripts/dev/perfil-ollama.sh)` some com --profile local-llm quando
# `.env` (já atualizado pelo preflight, acima) tem OLLAMA_MODE=host — sem
# isto o `up` tentaria publicar a 11434 de novo e chocaria com a instalação
# nativa que o preflight acabou de detectar.
${COMPOSE} $(bash scripts/dev/perfil-ollama.sh) up -d --build --wait --wait-timeout "${BRABO_RESET_WAIT_TIMEOUT:-180}"

echo "==> apagando engine, drizzle e public (api e engine dividem o mesmo banco)…"
# Mesmo SQL do item Database › Delete — as TRÊS armadilhas documentadas ali:
# pgvector só é criada na primeira inicialização do volume (por isso é
# recriada aqui); `engine.*` é schema PRÓPRIO do Ecto/Oban, que um DROP só de
# `public` não alcança (mix ecto.migrate falharia com `duplicate_table`); e
# `drizzle.__drizzle_migrations` é o controle PRÓPRIO do drizzle-kit, também
# fora de `public` — sem apagá-lo, `pnpm db:migrate` acha que já rodou tudo e
# não recria nenhuma tabela da api.
${COMPOSE} exec -T postgres psql -v ON_ERROR_STOP=1 \
  -U "${POSTGRES_USER:-brabo}" -d "${POSTGRES_DB:-brabo}" \
  -c 'DROP SCHEMA IF EXISTS engine CASCADE;' \
  -c 'DROP SCHEMA IF EXISTS drizzle CASCADE;' \
  -c 'DROP SCHEMA public CASCADE;' \
  -c 'CREATE SCHEMA public;' \
  -c 'CREATE EXTENSION IF NOT EXISTS vector;'

echo "==> aplicando migrations (api + engine)…"
pnpm db:migrate
pnpm engine:migrate

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
pnpm --filter api seed

echo ""
echo "reset completo."
