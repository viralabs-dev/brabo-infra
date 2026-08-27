#!/usr/bin/env bash
# Imprime `--profile local-llm` quando o `.env` atual NÃO tem
# OLLAMA_MODE=host, e nada quando tem.
#
# POR QUE EXISTE: desde que `ollama`/`ollama-model-loader` entraram em
# `profiles: ["local-llm"]` no docker-compose.yml (evitar o choque de porta
# 11434 com uma instalação nativa, ver scripts/dev/preflight.mjs), um
# `docker compose up` sem `--profile` simplesmente não sobe os dois. Isso é o
# que se quer quando OLLAMA_MODE=host (o usuário já tem Ollama rodando fora
# do Docker); é o OPOSTO do que se quer no resto dos casos — inclusive antes
# da primeira detecção, quando OLLAMA_MODE ainda nem existe em `.env` e o
# comportamento de sempre (ollama sobe com o resto da stack) precisa
# continuar valendo.
#
# Script PRÓPRIO, não inline em cada CMD do bootstrap.sh nem duplicado em
# reset-total.sh: os quatro chamadores (Docker › Deploy › All, Docker ›
# Create, Docker › Destroy e reset-total.sh) precisam da MESMA decisão —
# Destroy usa o mesmo `--profile` do `up` para poder derrubar exatamente o
# que ele subiu — e um `grep` levemente diferente em cada lugar é
# exatamente o tipo de divergência que este arquivo existe para evitar.
#
# Uso:
#   ${COMPOSE} $(bash scripts/dev/perfil-ollama.sh) up -d
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

modo=""
if [[ -f "${ENV_FILE}" ]]; then
  # `|| true`: sob `pipefail`, um `grep` sem match faria a pipeline inteira
  # (e o script, com `set -e`) sair com falha — e "OLLAMA_MODE ainda não
  # definido" é o caso NORMAL, não um erro.
  modo="$(grep -E '^OLLAMA_MODE=' "${ENV_FILE}" 2>/dev/null | tail -n1 | cut -d '=' -f2- || true)"
fi

[[ "${modo}" == "host" ]] && exit 0

printf -- '--profile local-llm'
