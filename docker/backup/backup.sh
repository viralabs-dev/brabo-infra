#!/bin/sh
# Backup do Postgres e dos bare repos locais (Fase 5 item 6; ADR 0152).
#
# Roda como CronJob no k8s (deploy/k8s/base/backup/cronjob.yaml) e como
# `docker compose run --rm backup brabo-backup` numa instalação por compose. O
# resultado — sucesso ou falha — é sempre gravado em `backup_runs`, e é dessa
# tabela que saem as métricas `brabo_backup_*` que o DomainGaugesCollector
# publica. Um backup que falha em silêncio é pior do que backup nenhum: este
# script existe para que a falha vire série temporal e alerta.
#
# ## O que entra, e por que não é "todos os volumes" (ADR 0152, decisão 1)
#
# Dos sete volumes nomeados, DOIS são fonte de verdade: `pgdata` (aqui, como
# dump lógico) e `git_local_repos` (aqui, como tar). `neo4j_data` e
# `project_workspaces` são DERIVADOS — a resposta para memória derivada é
# reprojetar da fonte, não restaurar uma projeção de outro instante;
# `ollama_data` é re-obtenível; `brabo_projects_base` é do usuário. Copiar os
# sete daria impressão de cobertura sem acrescentar recuperação.
set -eu

: "${DATABASE_URL:?DATABASE_URL é obrigatória}"

# shellcheck source=docker/backup/lib.sh
. "${BRABO_BACKUP_LIB:-/usr/local/lib/brabo-backup-lib.sh}"

# As cinco variáveis de S3 deixaram de ser obrigatórias (ADR 0152, decisão 2):
# elas passaram a ser a configuração de UM dos destinos. Numa instalação de
# máquina única, exigir um bucket para poder migrar é exigir infraestrutura que
# o instalador acabou de dizer que não precisa. `destino_preparar` ainda as
# exige quando o destino É o S3 — o que muda é quando a exigência vale.
destino_preparar

KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
# Dia da semana que também vira cópia semanal (1=segunda … 7=domingo).
WEEKLY_DOW="${BACKUP_WEEKLY_DOW:-7}"

# Raiz dos bare repos do LocalGitProvider. É o MESMO caminho que api e engine
# montam (`git_local_repos:/data/git-repos`). Ausente = volume não montado, que
# é o caso do CronJob do k8s e é tratado como PULO explícito, nunca como falha.
GIT_REPOS_DIR="${GIT_REPOS_DIR:-/data/git-repos}"

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
kind=daily
object_key=""
size_bytes=0
status=failed
error_message=""

log() { printf '[backup] %s\n' "$*"; }

# O registro no banco é feito no EXIT, não no fim do caminho feliz: qualquer
# `set -e` no meio (dump, upload, poda) também tem que virar linha na tabela,
# senão a métrica de idade continua verde enquanto o backup está quebrado há
# dias — o modo de falha exato que este item existe para evitar.
registrar() {
  rc=$?
  [ "${rc}" -eq 0 ] && status=ok

  # O SQL vem por STDIN, não por `--command`: o psql só interpola `:'variável'`
  # em entrada de arquivo/stdin. Com `-c` a string vai crua para o servidor e o
  # erro é `syntax error at or near ":"` — que foi exatamente como este bug
  # apareceu na primeira execução real.
  #
  # ON_ERROR_STOP para o registro falhar alto: um backup que gravou o objeto
  # mas não registrou é invisível para o alerta de idade.
  PGAPPNAME=brabo-backup psql "${DATABASE_URL}" \
    --quiet --no-align --tuples-only \
    --set ON_ERROR_STOP=1 \
    --set started_at="${started_at}" \
    --set kind="${kind}" \
    --set status="${status}" \
    --set object_key="${object_key}" \
    --set size_bytes="${size_bytes}" \
    --set error_message="${error_message}" <<'SQL' \
    || log "AVISO: não foi possível registrar a execução em backup_runs"
insert into backup_runs
  (started_at, finished_at, kind, status, object_key, size_bytes, error_message)
values
  (:'started_at'::timestamptz, now(), :'kind', :'status',
   nullif(:'object_key', ''), :'size_bytes'::bigint,
   nullif(:'error_message', ''));
SQL

  if [ "${rc}" -eq 0 ]; then
    log "concluído: ${object_key} (${size_bytes} bytes)"
  else
    log "FALHOU (${error_message:-sem detalhe}); código ${rc}"
  fi
  exit "${rc}"
}
trap registrar EXIT

falhar() {
  error_message="$1"
  log "erro: $1"
  exit 1
}

# --- destino ---------------------------------------------------------------
# A saída do destino é PRESERVADA e entra na mensagem de erro. Engolir stderr
# aqui custou caro na primeira execução real: "não foi possível autenticar"
# escondia um `connection refused`, e o diagnóstico começou procurando
# credencial errada quando o problema era o endpoint ainda não estar alcançável.
#
# A espera com retentativa continua existindo no caminho S3, pelas duas razões
# que já estavam documentadas (NetworkPolicy do k3s programada depois de o pod
# ganhar IP; indisponibilidade transitória de object storage). No destino em
# DISCO ela não faz sentido — disco não fica alcançável sozinho —, e lá a
# checagem é outra: que o diretório aceite ESCRITA, não que exista.
log "destino: $(destino_descricao)"
destino_esperar \
  || falhar "destino inacessível ($(destino_descricao)): ${destino_saida}"

# --- dump ------------------------------------------------------------------
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
object_key="daily/brabo-${timestamp}.dump"

# `--format=custom` já sai comprimido (zlib) e é o único formato que o
# pg_restore lê seletivamente — restaurar uma tabela só de um dump plano
# significa editar SQL à mão no meio de um incidente.
#
# Vai direto para o destino, sem tocar disco intermediário: um dump temporário
# exigiria um PVC dimensionado pelo tamanho do banco, que cresce sem ninguém
# revisar.
#
# `set -o pipefail` não existe em POSIX sh; o teste explícito do tamanho no
# passo seguinte é o que pega um pg_dump que morreu no meio do cano.
log "gerando dump para ${object_key}"
pg_dump --format=custom --compress=9 --no-owner --no-privileges "${DATABASE_URL}" \
  | destino_enviar "${object_key}" \
  || falhar "pg_dump ou upload falhou"

size_bytes="$(destino_tamanho "${object_key}")"
[ "${size_bytes}" -gt 0 ] 2>/dev/null \
  || falhar "objeto ${object_key} ficou vazio — o dump não chegou ao destino"

# --- bare repos do LocalGitProvider ----------------------------------------
# O achado do ADR 0152. A garantia exata que este passo dá (consistência por
# REFERÊNCIA, não por instante) e a que ele NÃO dá (sem quiesce, sem instante
# global) estão escritas em `lib.sh`, junto do código que as produz.
#
# Prefixos PRÓPRIOS (`git-daily/`, `git-weekly/`) e não `daily/`: a retenção é
# por CONTAGEM, e dois tipos de arquivo no mesmo prefixo fariam "manter 7"
# significar três backups e meio. Também mantém `RESTORE_PREFIX=daily/` e a
# consulta de janela do `restore.sh` valendo byte a byte.
git_object_key="git-daily/brabo-git-${timestamp}.tar.gz"

if ! repos="$(git_repos_presentes "${GIT_REPOS_DIR}")"; then
  # Volume não montado. É o CronJob do k8s, que esta sessão não toca — e o
  # pulo é DITO, porque pular calado é como um backup passa anos parecendo
  # cobrir o que nunca cobriu.
  log "PULANDO os bare repos: ${GIT_REPOS_DIR} não existe neste container"
  git_object_key=""
elif [ -z "${repos}" ]; then
  # Diretório montado e vazio é estado NORMAL (instalação sem projeto de
  # provider `local`), e é diferente de "não montado". Não colapsar os dois.
  log "nenhum bare repo em ${GIT_REPOS_DIR} — nada a arquivar"
  git_object_key=""
else
  log "arquivando $(echo "${repos}" | wc -l) bare repo(s) para ${git_object_key}"
  status_tar="$(mktemp)"
  git_arquivar "${GIT_REPOS_DIR}" "${status_tar}" | destino_enviar "${git_object_key}" \
    || { rm -f "${status_tar}"; falhar "falha ao enviar ${git_object_key}"; }

  # O status do `tar` NÃO é o `$?` do cano (que é o do último comando). Sem esta
  # conferência, um `git gc` concorrente apagando um packfile no meio da leitura
  # produziria um arquivo incompleto que se anuncia como bom — e um backup que
  # mente é pior do que um que falha, porque só o segundo vira alerta.
  rc_tar="$(cat "${status_tar}" 2>/dev/null || echo 1)"
  rm -f "${status_tar}"
  [ "${rc_tar}" = "0" ] \
    || falhar "tar dos bare repos saiu com ${rc_tar} — arquivo possivelmente parcial (gc concorrente?). Rode de novo."

  git_size="$(destino_tamanho "${git_object_key}")"
  [ "${git_size}" -gt 0 ] 2>/dev/null \
    || falhar "objeto ${git_object_key} ficou vazio"
  log "bare repos arquivados: ${git_object_key} (${git_size} bytes)"
fi

# `backup_runs.object_key` continua sendo o DUMP, deliberadamente: é a chave que
# `restore.sh` procura para achar a janela do snapshot, e é do dump que o
# runbook fala quando diz que uma queda de `size_bytes` denuncia truncamento. O
# arquivo dos repos é encontrado pelo MESMO timestamp, no prefixo irmão — o
# vínculo é o nome, não uma coluna nova.

# --- cópia semanal ---------------------------------------------------------
if [ "$(date -u +%u)" = "${WEEKLY_DOW}" ]; then
  kind=weekly
  destino_copiar "${object_key}" "weekly/brabo-${timestamp}.dump" \
    || falhar "falha ao copiar para a retenção semanal"
  if [ -n "${git_object_key}" ]; then
    destino_copiar "${git_object_key}" "git-weekly/brabo-git-${timestamp}.tar.gz" \
      || falhar "falha ao copiar os bare repos para a retenção semanal"
  fi
  log "cópia semanal criada"
fi

# --- retenção --------------------------------------------------------------
# Por CONTAGEM, não por idade. `--older-than 7d` apaga backup bom quando o
# CronJob passou dias sem rodar — exatamente a situação em que ele mais importa.
# Manter os N mais recentes degrada bem: sem execução nova, nada é apagado.
podar() {
  prefixo="$1"
  manter="$2"

  # Ordena decrescente: o nome carrega o timestamp ISO, então ordem
  # lexicográfica é ordem cronológica. Apaga tudo depois dos `manter` primeiros.
  destino_listar "${prefixo}" \
    | sort -r \
    | tail -n "+$((manter + 1))" \
    | while IFS= read -r chave; do
        [ -n "${chave}" ] || continue
        log "retenção: apagando ${chave}"
        destino_remover "${chave}" \
          || log "AVISO: não foi possível apagar ${chave}"
      done
}

podar daily/      "${KEEP_DAILY}"
podar weekly/     "${KEEP_WEEKLY}"
podar git-daily/  "${KEEP_DAILY}"
podar git-weekly/ "${KEEP_WEEKLY}"
