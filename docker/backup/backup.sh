#!/bin/sh
# Backup do Postgres para destino S3-compatível (Fase 5, item 6).
#
# Roda como CronJob (deploy/k8s/base/backup/cronjob.yaml). O resultado — sucesso
# ou falha — é sempre gravado em `backup_runs`, e é dessa tabela que saem as
# métricas `brabo_backup_*` que o DomainGaugesCollector publica. Um backup que
# falha em silêncio é pior do que backup nenhum: este script existe para que a
# falha vire série temporal e alerta.
set -eu

: "${DATABASE_URL:?DATABASE_URL é obrigatória}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT é obrigatória}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET é obrigatória}"
: "${BACKUP_S3_ACCESS_KEY:?BACKUP_S3_ACCESS_KEY é obrigatória}"
: "${BACKUP_S3_SECRET_KEY:?BACKUP_S3_SECRET_KEY é obrigatória}"

KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
# Dia da semana que também vira cópia semanal (1=segunda … 7=domingo).
WEEKLY_DOW="${BACKUP_WEEKLY_DOW:-7}"

ALIAS=destino
BASE="${ALIAS}/${BACKUP_S3_BUCKET}"

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
# `mc alias set` grava a credencial em ${MC_CONFIG_DIR}, que é tmpfs. Preferido
# sobre a variável MC_HOST_<alias> porque esta última põe usuário e senha numa
# URL, e URL vaza com muito mais facilidade (log de erro, `ps`, mensagem do mc).
#
# A saída do mc é PRESERVADA e entra na mensagem de erro. Engolir stderr aqui
# custou caro na primeira execução real: "não foi possível autenticar" escondia
# um `connection refused`, e o diagnóstico começou procurando credencial errada
# quando o problema era o endpoint ainda não estar alcançável.
#
# E daí a espera. Duas razões, uma de cada ambiente:
#
#   * no cluster, o k3s programa as regras de NetworkPolicy DEPOIS de o pod
#     ganhar IP. Um Job que fala na primeira instrução pega a janela em que o
#     default-deny já vale e o allow ainda não — e o sintoma é `connection
#     refused`, não timeout, porque a implementação usa REJECT;
#   * em produção, object storage tem indisponibilidade transitória, e um
#     backup diário que desiste no primeiro erro de rede vira um dia sem
#     backup por causa de um segundo de instabilidade.
#
# O `backoffLimit` do Job cobriria o caso, mas ao preço de um pod novo e de uma
# linha `failed` em `backup_runs` que dispararia alerta sem haver problema.
esperar_destino() {
  tentativa=1
  while [ "${tentativa}" -le "${BACKUP_S3_RETRIES:-10}" ]; do
    if saida="$(mc --quiet alias set "${ALIAS}" \
        "${BACKUP_S3_ENDPOINT}" "${BACKUP_S3_ACCESS_KEY}" "${BACKUP_S3_SECRET_KEY}" 2>&1)" \
      && saida="$(mc --quiet ls "${BASE}" 2>&1)"; then
      [ "${tentativa}" -gt 1 ] && log "destino disponível na tentativa ${tentativa}"
      return 0
    fi
    log "destino indisponível (tentativa ${tentativa}): ${saida}"
    tentativa=$((tentativa + 1))
    sleep 3
  done
  return 1
}

esperar_destino \
  || falhar "destino S3 inacessível após as tentativas (${BACKUP_S3_ENDPOINT}): ${saida}"

# --- dump ------------------------------------------------------------------
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
object_key="daily/brabo-${timestamp}.dump"

# `--format=custom` já sai comprimido (zlib) e é o único formato que o
# pg_restore lê seletivamente — restaurar uma tabela só de um dump plano
# significa editar SQL à mão no meio de um incidente.
#
# Vai direto para `mc pipe`, sem tocar disco: um dump intermediário exigiria um
# PVC dimensionado pelo tamanho do banco, que cresce sem ninguém revisar.
#
# `set -o pipefail` não existe em POSIX sh; o teste explícito do tamanho no
# passo seguinte é o que pega um pg_dump que morreu no meio do cano.
log "gerando dump para ${object_key}"
pg_dump --format=custom --compress=9 --no-owner --no-privileges "${DATABASE_URL}" \
  | mc --quiet pipe "${BASE}/${object_key}" \
  || falhar "pg_dump ou upload falhou"

size_bytes="$(mc --json stat "${BASE}/${object_key}" 2>/dev/null | jq -r '.size // 0')"
[ "${size_bytes}" -gt 0 ] 2>/dev/null \
  || falhar "objeto ${object_key} ficou vazio — o dump não chegou ao destino"

# --- cópia semanal ---------------------------------------------------------
if [ "$(date -u +%u)" = "${WEEKLY_DOW}" ]; then
  kind=weekly
  mc --quiet cp "${BASE}/${object_key}" "${BASE}/weekly/brabo-${timestamp}.dump" \
    || falhar "falha ao copiar para a retenção semanal"
  log "cópia semanal criada"
fi

# --- retenção --------------------------------------------------------------
# Por CONTAGEM, não por idade. `mc rm --older-than 7d` apaga backup bom quando o
# CronJob passou dias sem rodar — exatamente a situação em que ele mais importa.
# Manter os N mais recentes degrada bem: sem execução nova, nada é apagado.
podar() {
  prefixo="$1"
  manter="$2"

  # `mc ls --json` emite um objeto por linha; a chave vem em `.key`. Ordena
  # decrescente (o nome carrega o timestamp ISO, então ordem lexicográfica é
  # ordem cronológica) e apaga tudo depois dos `manter` primeiros.
  mc --json ls "${BASE}/${prefixo}" 2>/dev/null \
    | jq -r 'select(.type == "file") | .key' \
    | sort -r \
    | tail -n "+$((manter + 1))" \
    | while IFS= read -r chave; do
        [ -n "${chave}" ] || continue
        log "retenção: apagando ${prefixo}${chave}"
        mc --quiet rm "${BASE}/${prefixo}${chave}" >/dev/null 2>&1 \
          || log "AVISO: não foi possível apagar ${prefixo}${chave}"
      done
}

podar daily/  "${KEEP_DAILY}"
podar weekly/ "${KEEP_WEEKLY}"
