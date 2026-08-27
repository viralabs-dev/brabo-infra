#!/usr/bin/env bash
# Esquece a decisão host/container do Ollama gravada em `.env` por
# scripts/dev/preflight.mjs, forçando a pergunta de novo na próxima subida
# (Docker › Create ou Docker › Reset total).
#
# Não é destrutivo a dado nenhum — só mexe em até três linhas de `.env` —,
# por isso o item "Docker › Reconfigurar Ollama" do bootstrap.sh não pede
# confirmação: mesmo idioma dos outros itens não-triviais-mas-não-destrutivos
# do menu (Generate, Migrate, Seed...), que executam direto ao apertar o
# dígito.
#
# Chamado pelo bootstrap.sh; roda sozinho também:
#   bash scripts/dev/reconfigurar-ollama.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "sem .env — nada para reconfigurar."
  exit 0
fi

modo_atual="$(grep -E '^OLLAMA_MODE=' "${ENV_FILE}" 2>/dev/null | tail -n1 | cut -d '=' -f2- || true)"

# OLLAMA_PORT só sai junto quando o modo era "container": foi neste caso que
# o preflight ESCOLHEU a porta alternativa (11500+) sozinho. No modo "host" a
# porta em `.env` é a de uma instalação nativa, gravada por quem a instalou —
# apagá-la faria a próxima subida "esquecer" um valor que não é dela.
chaves=("OLLAMA_MODE" "OLLAMA_HOST")
if [[ "${modo_atual}" == "container" ]]; then
  chaves+=("OLLAMA_PORT")
fi

padrao=""
for chave in "${chaves[@]}"; do
  padrao="${padrao:+${padrao}|}${chave}"
done

tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
trap 'rm -f "${tmp}"' EXIT
grep -vE "^(${padrao})=" "${ENV_FILE}" > "${tmp}" || true
mv "${tmp}" "${ENV_FILE}"
trap - EXIT

echo "Ollama reconfigurado: ${chaves[*]} removidas de .env — a próxima subida pergunta de novo."
