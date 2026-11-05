#!/usr/bin/env bash
# `docker compose config` de cada compose, com os clones irmãos (BRABO_IRMAOS) como contexto de build.
# Não sobe nada. Usa o .env.example como ambiente e os valores obrigatórios de teste do install.
set -euo pipefail
cd "$(dirname "$0")/../.."
export BRABO_IRMAOS="${BRABO_IRMAOS:-$PWD/..}"
cp .env.example /tmp/brabo.env
# O compose de instalação exige as cinco imagens por digest (o install.sh as grava no .env).
D="sha256:$(printf '0%.0s' {1..64})"
for i in API ENGINE WEB BROKER BACKUP; do export "BRABO_${i}_IMAGE=ghcr.io/viralabs-dev/brabo-${i,,}:1.0.0@${D}"; done
compor() { echo "== $*"; docker compose --env-file /tmp/brabo.env "$@" config -q; }
compor -f docker/docker-compose.yml
compor -f docker/docker-compose.yml -f docker/docker-compose.observability.yml
compor -f docker/docker-compose.yml -f docker/docker-compose.gpu.yml
compor -f docker/docker-compose.prod.yml
compor -f docker/docker-compose.install.yml
