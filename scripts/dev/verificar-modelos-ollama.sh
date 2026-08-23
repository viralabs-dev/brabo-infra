#!/usr/bin/env bash
# Verifica que o `ollama-model-loader` (docker-compose.yml) realmente deixa
# os modelos exigidos presentes no daemon `ollama`, sem passo manual.
#
# O que ele NÃO é: teste de que os modelos FUNCIONAM (isso é o caminho do
# provider de LLM, já coberto pela suite de contrato da api). Aqui a pergunta
# é só "depois do loader rodar, `ollama list` dentro do container `ollama`
# contém os modelos de OLLAMA_REQUIRED_MODELS?" — o mesmo espírito estreito do
# docker/smoke.sh, mas para este mecanismo específico.
#
# Uso:
#   bash scripts/dev/verificar-modelos-ollama.sh
#   VERIFICAR_KEEP_UP=1 bash scripts/dev/verificar-modelos-ollama.sh   # não derruba no final
#   OLLAMA_REQUIRED_MODELS=all-minilm bash scripts/dev/verificar-modelos-ollama.sh
#     # troca a lista por algo pequeno pra um smoke rápido, sem baixar os
#     # ~3-4GB da lista real de produto (gemma3:1b + yi-coder:1.5b + nomic-embed-text)
#
# Como isto entraria no bootstrap (scripts/dev/bootstrap.sh): um item novo em
# Docker › Test, chamando este script — não foi feito aqui porque o corte
# desta frente é só docker/ + deploy/k8s/ + .env.example (ver CLAUDE.md, esta
# branch é `feature/neo4j-rag-fundacao`), e bootstrap.sh tem teste próprio
# (bootstrap.spec.ts) que cobre a árvore de menu inteira — mexer nele é outra
# revisão.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker/docker-compose.yml"
COMPOSE=(docker compose -f "${COMPOSE_FILE}")

# Mesmo default do compose — mantido em UM lugar seria melhor, mas o valor
# vem de env do compose (interpolado no `docker compose config`), não de um
# arquivo que este script possa importar; duplicar o literal aqui é o mesmo
# padrão que RAG_EMBEDDING_MODEL aceita em rag-search-limits.ts (constante,
# não config lida em runtime).
OLLAMA_REQUIRED_MODELS="${OLLAMA_REQUIRED_MODELS:-gemma3:1b,yi-coder:1.5b,nomic-embed-text}"

info() { printf '\n\033[1m[verificar-modelos-ollama]\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }
die()  { printf '\n\033[31m[verificar-modelos-ollama] %s\033[0m\n' "$*" >&2; exit 1; }

cleanup() {
  if [ "${VERIFICAR_KEEP_UP:-0}" != "1" ]; then
    info "derrubando ollama/ollama-model-loader"
    "${COMPOSE[@]}" rm -sf ollama-model-loader >/dev/null 2>&1 || true
    "${COMPOSE[@]}" stop ollama >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

info "subindo o daemon ollama"
OLLAMA_REQUIRED_MODELS="${OLLAMA_REQUIRED_MODELS}" "${COMPOSE[@]}" up -d ollama

info "rodando o loader (OLLAMA_REQUIRED_MODELS=${OLLAMA_REQUIRED_MODELS})"
OLLAMA_REQUIRED_MODELS="${OLLAMA_REQUIRED_MODELS}" "${COMPOSE[@]}" run --rm ollama-model-loader \
  || die "ollama-model-loader terminou com falha — ver saída acima"

info "conferindo 'ollama list' dentro do container ollama"
lista="$(docker exec "$("${COMPOSE[@]}" ps -q ollama)" ollama list)"
echo "${lista}"

faltando=""
old_ifs="${IFS}"
IFS=","
for modelo in ${OLLAMA_REQUIRED_MODELS}; do
  IFS="${old_ifs}"
  [ -z "${modelo}" ] && continue
  if echo "${lista}" | grep -qF "${modelo}"; then
    ok "${modelo} presente"
  else
    faltando="${faltando} ${modelo}"
  fi
  IFS=","
done
IFS="${old_ifs}"

if [ -n "${faltando}" ]; then
  die "modelo(s) ausente(s) em 'ollama list':${faltando}"
fi

printf '\n\033[32m[verificar-modelos-ollama] todos os modelos exigidos estão presentes\033[0m\n'
