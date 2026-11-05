#!/usr/bin/env bash
# `docker compose config` de cada compose, com os clones irmãos (BRABO_IRMAOS) como contexto de build.
# Não sobe nada. Usa o .env.example como ambiente e os valores obrigatórios de teste do install.
set -euo pipefail
cd "$(dirname "$0")/../.."
export BRABO_IRMAOS="${BRABO_IRMAOS:-$PWD/..}"
cp .env.example /tmp/brabo.env
compor() { echo "== $*"; docker compose --env-file /tmp/brabo.env "$@" config -q; }
compor -f docker/docker-compose.yml
compor -f docker/docker-compose.yml -f docker/docker-compose.observability.yml
compor -f docker/docker-compose.yml -f docker/docker-compose.gpu.yml
compor -f docker/docker-compose.prod.yml
compor -f docker/docker-compose.install.yml
