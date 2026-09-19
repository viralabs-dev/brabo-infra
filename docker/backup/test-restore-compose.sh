#!/usr/bin/env bash
# O `make test-restore` de quem NÃO tem cluster (ADR 0152, decisão 3).
#
# ## Por que existe um segundo invólucro
#
# `deploy/k8s/test-restore.sh` exige `kubectl`, um cluster e o CronJob
# `brabo-backup` no namespace. Uma instalação por compose não tem nenhum dos
# três — e era por isso que migrar uma instalação existente não tinha caminho
# provado. Este script prova o mesmo, com `docker compose run`.
#
# Os dois arquivos FICAM SEPARADOS de propósito. Unificá-los faria o caminho de
# compose depender de `kubectl`, que é exatamente a dependência que ele existe
# para não ter. O que NÃO está duplicado é o julgamento: os dois disparam o
# MESMO `brabo-restore`, com as MESMAS três validações (lista de tabelas,
# contagem das críticas na janela do backup, continuidade densa da `seq` de
# `session_events`). Muda o invólucro, nunca o veredito.
#
# ## O que ele faz
#
#   1. dispara um backup REAL pela mesma imagem e o mesmo comando que rodam em
#      produção — não um `pg_dump` ad hoc, que testaria um caminho que ninguém
#      usa;
#   2. restaura o último dump numa database NOVA e roda as três validações;
#   3. verifica o arquivo dos bare repos SEM escrever nada.
#
# O passo 3 é o que este ambiente pode cobrar e o k8s não: no cluster o volume
# `git_local_repos` nem é montado no pod de backup, e lá o passo é pulado. Aqui
# ele é montado, então pular seria falso verde.
#
# Uso:
#   bash docker/backup/test-restore-compose.sh
#   BACKUP_DIR=/backups bash docker/backup/test-restore-compose.sh
#   BRABO_ENV_FILE=/caminho/.env BRABO_COMPOSE_FILE=... bash docker/backup/test-restore-compose.sh
#
# ## Onde o `.env` mora (AT-102)
#
# O Compose procura o `.env` na pasta do PROJETO, que por padrão é a do arquivo
# de compose. Na instalação por Release o compose vive em `docker/` e o `.env`
# uma pasta acima — então, sem ajuda, `${BRABO_BACKUP_IMAGE:?…}` recusava a
# leitura do arquivo e a prova reprovava por ambiente, não por backup. A
# escolha foi `--env-file` (variável `BRABO_ENV_FILE`) e não
# `--project-directory`: o segundo também mudaria a base dos caminhos
# relativos do compose e o nome do projeto — o que faria a prova subir volumes
# de OUTRO projeto —, e o instalador já usa `--env-file` em toda chamada. Sem
# a variável o comportamento é o de sempre (checkout: `.env` ao lado do
# compose); com ela, o arquivo tem que existir — nunca cai em silêncio para
# outro.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${BRABO_COMPOSE_FILE:-${RAIZ}/docker/docker-compose.prod.yml}"

info() { printf '\n\033[1m[test-restore-compose]\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }
fail() { printf '\n\033[31m[test-restore-compose] FALHOU: %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || fail "docker não encontrado no PATH"
docker compose version >/dev/null 2>&1 || fail "'docker compose' (v2) não disponível"
[[ -f "${COMPOSE_FILE}" ]] || fail "compose não encontrado: ${COMPOSE_FILE}"

ENV_FILE="${BRABO_ENV_FILE:-}"
[[ -z "${ENV_FILE}" || -f "${ENV_FILE}" ]] || fail "BRABO_ENV_FILE não existe: ${ENV_FILE}"

# `--env-file` é opção GLOBAL do `docker compose`, e por isso vem antes do
# subcomando. Array e não string: o caminho pode ter espaço.
compose() {
  local flags=(-f "${COMPOSE_FILE}")
  [[ -n "${ENV_FILE}" ]] && flags+=(--env-file "${ENV_FILE}")
  docker compose "${flags[@]}" "$@"
}

# `run --rm` liga sozinho o profile do serviço alvo (Compose v2), então o
# `backup` não precisa estar de pé — nem deve: ele é um Job, não um daemon.
executar() { compose run --rm --quiet-pull backup "$@"; }

# O serviço tem que existir ANTES de qualquer coisa: sem esta checagem o erro
# vira um "no such service" no meio da saída do compose, que é a mesma coisa que
# o `test-restore.sh` do k8s evita conferindo o CronJob antes de disparar nada.
#
# `--profile backup` é obrigatório AQUI e não no `run`: `config` lista só o que
# está ativo, enquanto `run` liga o profile do alvo sozinho. Medido — sem a
# flag, `config --services` não traz o serviço e a checagem reprovaria um
# compose correto.
compose --profile backup config --services | grep -qx backup \
  || fail "o compose ${COMPOSE_FILE} não tem serviço 'backup'"

info "1/3 — disparando um backup REAL (mesma imagem, mesmo comando de produção)"
executar brabo-backup || fail "o backup falhou; a linha correspondente ficou em backup_runs com status='failed'"
ok "backup concluído"

info "2/3 — restaurando o último dump numa database nova e validando"
executar brabo-restore || fail "o restore não completou ou uma validação reprovou (a saída acima diz qual)"
ok "restore validado"

info "3/3 — verificando o arquivo dos bare repos (sem escrever nada)"
executar brabo-restore-git || fail "o arquivo de ${GIT_REPOS_DIR:-/data/git-repos} está ausente ou ilegível"
ok "bare repos verificados"

printf '\n\033[32m[test-restore-compose] backup restaurado e íntegro\033[0m\n'
