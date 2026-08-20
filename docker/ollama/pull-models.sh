#!/bin/sh
# Puxa os modelos Ollama que o produto exige no boot (RAG em grafo + os dois
# modelos garantidos, PROGRAMA neo4j-rag-fundacao).
#
# Roda dentro do container `ollama-model-loader` (docker-compose.yml), que é
# um CLIENTE puro: nunca inicia `ollama serve` aqui, só fala com o daemon do
# container `ollama` vizinho via OLLAMA_HOST (a CLI `ollama` usa HTTP contra
# ${OLLAMA_HOST}/api/*, então funciona sem servidor local — é o mesmo
# mecanismo que faz `ollama pull`/`ollama list` funcionarem de uma máquina
# cliente contra um Ollama remoto).
#
# Sem isto, `nomic-embed-text` nunca é puxado automaticamente e o Chat RAG
# degrada em silêncio para busca léxico-only em qualquer ambiente limpo — é um
# bug real de hoje (ver RAG_EMBEDDING_MODEL em
# apps/api/src/domain/rag/rag-search-limits.ts), não só desta feature.
set -eu

OLLAMA_HOST="${OLLAMA_HOST:-http://ollama:11434}"
OLLAMA_REQUIRED_MODELS="${OLLAMA_REQUIRED_MODELS:-gemma:1b,yi-coder:1.5b,nomic-embed-text}"

echo "[ollama-model-loader] aguardando o daemon em ${OLLAMA_HOST}..."
until ollama list >/dev/null 2>&1; do
  sleep 2
done
echo "[ollama-model-loader] daemon disponível."

status=0
old_ifs=$IFS
IFS=","
for modelo in $OLLAMA_REQUIRED_MODELS; do
  IFS="$old_ifs"
  # Campo vazio (ex.: vírgula dupla ou sobrando na ponta) não é modelo.
  if [ -z "$modelo" ]; then
    IFS=","
    continue
  fi
  echo "[ollama-model-loader] puxando ${modelo}..."
  if ! ollama pull "$modelo"; then
    echo "[ollama-model-loader] FALHOU ao puxar ${modelo}" >&2
    status=1
  fi
  IFS=","
done
IFS="$old_ifs"

if [ "$status" -eq 0 ]; then
  echo "[ollama-model-loader] todos os modelos exigidos estão presentes."
else
  echo "[ollama-model-loader] terminou com pelo menos uma falha — ver acima." >&2
fi
exit "$status"
