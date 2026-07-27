#!/bin/sh
# Restaura o último backup numa database NOVA e valida (Fase 5, item 6).
#
# É o motor do `make test-restore` e o mesmo caminho que o
# docs/runbooks/restore.md manda seguir num incidente de verdade — o runbook não
# descreve um procedimento paralelo que ninguém nunca rodou.
#
# Não toca na database de origem em nenhum momento: cria `brabo_restore_test`,
# restaura ali, valida e derruba.
set -eu

: "${DATABASE_URL:?DATABASE_URL é obrigatória}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT é obrigatória}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET é obrigatória}"
: "${BACKUP_S3_ACCESS_KEY:?BACKUP_S3_ACCESS_KEY é obrigatória}"
: "${BACKUP_S3_SECRET_KEY:?BACKUP_S3_SECRET_KEY é obrigatória}"

RESTORE_DB="${RESTORE_DB:-brabo_restore_test}"
PREFIXO="${RESTORE_PREFIX:-daily/}"
DUMP=/tmp/restore.dump

# Credencial e endpoint pelo ambiente: nada escrito em disco, nada em linha de
# comando (que `ps` mostraria).
export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY}"
export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY}"
export AWS_ENDPOINT_URL="${BACKUP_S3_ENDPOINT}"
export AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-us-east-1}"

BUCKET="s3://${BACKUP_S3_BUCKET}"

# Tabelas cujo conteúdo é conferido linha a linha. Todas têm `created_at`, que é
# o que permite a comparação exata descrita mais abaixo.
CRITICAS="users projects sessions session_events proposed_actions"

falhas=0
log()   { printf '[restore] %s\n' "$*"; }
ok()    { printf '[restore]   \033[32mok\033[0m    %s\n' "$*"; }
falha() { printf '[restore]   \033[31mFALHA\033[0m %s\n' "$*"; falhas=$((falhas + 1)); }

# --- URLs ------------------------------------------------------------------
# Deriva a URL de manutenção (database `postgres`) e a de destino a partir da
# DATABASE_URL. Assume que a senha não contém `/` — se contiver, o split abaixo
# quebra e o runbook manda passar RESTORE_ADMIN_URL explicitamente.
sem_query="${DATABASE_URL%%\?*}"
query=""
case "${DATABASE_URL}" in *\?*) query="?${DATABASE_URL#*\?}" ;; esac
prefixo_conn="${sem_query%/*}"
ADMIN_URL="${RESTORE_ADMIN_URL:-${prefixo_conn}/postgres${query}}"
RESTORE_URL="${prefixo_conn}/${RESTORE_DB}${query}"

psql_origem()  { psql "${DATABASE_URL}" --quiet --no-align --tuples-only --set ON_ERROR_STOP=1 "$@"; }
psql_destino() { psql "${RESTORE_URL}"  --quiet --no-align --tuples-only --set ON_ERROR_STOP=1 "$@"; }

limpar() {
  rc=$?
  rm -f "${DUMP}"
  # A database de teste some SEMPRE, inclusive quando a validação falha: deixá-la
  # para trás faz a próxima execução falhar no `createdb` por um motivo que não
  # tem nada a ver com o backup.
  psql "${ADMIN_URL}" --quiet --set ON_ERROR_STOP=1 \
    --command "drop database if exists ${RESTORE_DB} with (force)" >/dev/null 2>&1 \
    || log "AVISO: não foi possível derrubar ${RESTORE_DB}"
  exit "${rc}"
}
trap limpar EXIT

# --- baixar o último objeto ------------------------------------------------
# Saída do aws preservada na mensagem, e espera pelo destino — mesma razão do
# backup.sh: o k3s programa a NetworkPolicy depois de o pod ganhar IP, e um Job
# que fala na primeira instrução recebe `connection refused` de uma regra que
# vai existir daqui a um segundo.
tentativa=1
while :; do
  if saida="$(aws s3 ls "${BUCKET}/" 2>&1)"; then
    break
  fi
  if [ "${tentativa}" -ge "${BACKUP_S3_RETRIES:-10}" ]; then
    log "erro: destino S3 inacessível (${BACKUP_S3_ENDPOINT}): ${saida}"
    exit 1
  fi
  log "destino indisponível (tentativa ${tentativa}): ${saida}"
  tentativa=$((tentativa + 1))
  sleep 3
done

# O nome carrega o timestamp ISO, então ordem lexicográfica é ordem cronológica.
OBJETO="$(aws s3api list-objects-v2 \
  --bucket "${BACKUP_S3_BUCKET}" --prefix "${PREFIXO}" \
  --query 'Contents[].Key' --output text 2>/dev/null \
  | tr '\t' '\n' | grep -v '^None$' | sort -r | head -n 1)"
[ -n "${OBJETO}" ] || { log "erro: nenhum backup em ${BUCKET}/${PREFIXO}"; exit 1; }

log "último backup: ${OBJETO}"
aws s3 cp "${BUCKET}/${OBJETO}" "${DUMP}" --quiet \
  || { log "erro: falha ao baixar ${OBJETO}"; exit 1; }

# Um dump truncado no meio do upload tem tamanho > 0 e só se revela no
# pg_restore, depois de já ter criado meia database. `--list` lê o índice do
# formato custom e falha barato se o arquivo não estiver íntegro.
pg_restore --list "${DUMP}" >/dev/null \
  || { log "erro: ${OBJETO} não é um dump custom íntegro"; exit 1; }
ok "dump íntegro ($(wc -c < "${DUMP}") bytes)"

# --- janela do dump --------------------------------------------------------
# `started_at` e `finished_at` da execução que gerou ESTE objeto delimitam o
# instante do snapshot. É o que torna a comparação de contagens exata mesmo com
# escrita concorrente: tudo criado até `started_at` TEM que estar no dump, nada
# criado depois de `finished_at` pode estar.
JANELA="$(psql_origem --command \
  "select coalesce(to_char(started_at,'YYYY-MM-DD\"T\"HH24:MI:SSOF'), '') || '|' ||
          coalesce(to_char(finished_at,'YYYY-MM-DD\"T\"HH24:MI:SSOF'), '')
     from backup_runs
    where object_key = '${OBJETO}' and status = 'ok'
    order by finished_at desc limit 1" 2>/dev/null || true)"
INICIO="${JANELA%%|*}"
FIM="${JANELA##*|}"

# --- restaurar -------------------------------------------------------------
psql "${ADMIN_URL}" --quiet --set ON_ERROR_STOP=1 \
  --command "drop database if exists ${RESTORE_DB} with (force)" >/dev/null
psql "${ADMIN_URL}" --quiet --set ON_ERROR_STOP=1 \
  --command "create database ${RESTORE_DB}" >/dev/null
log "restaurando em ${RESTORE_DB}"

# `--no-owner --no-privileges` porque o dump foi gerado assim; `--exit-on-error`
# para uma falha no meio não virar database meio restaurada com saída zero.
pg_restore --dbname="${RESTORE_URL}" --no-owner --no-privileges --exit-on-error "${DUMP}" \
  || { log "erro: pg_restore falhou"; exit 1; }
ok "pg_restore concluído"

# --- validação 1: estrutura ------------------------------------------------
# A lista esperada vem da ORIGEM, não de um número fixo no script.
#
# A primeira versão tinha `TABELAS_ESPERADAS=32` e envelheceu na mesma sessão em
# que foi escrita — duas tabelas novas e o teste reprovava um restore correto.
# Pior: o inverso também vale, e um número fixo maior que a realidade aprovaria
# um dump com tabela faltando. Comparar as duas LISTAS diz também QUAL tabela
# não veio, que é a informação de que se precisa num incidente.
listar_tabelas() {
  "$1" --command \
    "select string_agg(table_name, ' ' order by table_name)
       from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'"
}

tabelas_origem="$(listar_tabelas psql_origem)"
tabelas_destino="$(listar_tabelas psql_destino)"

if [ "${tabelas_origem}" = "${tabelas_destino}" ]; then
  ok "$(echo "${tabelas_destino}" | wc -w) tabelas restauradas, idênticas à origem"
else
  faltando=""
  for t in ${tabelas_origem}; do
    case " ${tabelas_destino} " in *" ${t} "*) ;; *) faltando="${faltando} ${t}" ;; esac
  done
  sobrando=""
  for t in ${tabelas_destino}; do
    case " ${tabelas_origem} " in *" ${t} "*) ;; *) sobrando="${sobrando} ${t}" ;; esac
  done
  falha "estrutura difere da origem —${faltando:+ faltando:${faltando}}${sobrando:+ sobrando:${sobrando}}"
fi

# --- validação 2: contagens das tabelas críticas ---------------------------
# Guarda contra o falso verde. Num banco vazio, TODA comparação de contagem
# fica "0 == 0" e o event log é trivialmente íntegro: o teste passaria inteiro
# sem ter exercitado nada. Já aconteceu nesta sessão, num cluster recém-criado
# antes do smoke — e a saída era verde.
total_origem=0
for tabela in ${CRITICAS}; do
  n="$(psql_origem --command "select count(*) from ${tabela}")"
  total_origem=$((total_origem + n))
done

if [ "${total_origem}" -eq 0 ]; then
  falha "a origem não tem NENHUMA linha nas tabelas críticas — este teste não prova nada.
         Rode 'make smoke-k8s' (ou use o sistema) para gerar dados antes."
fi

if [ -z "${INICIO}" ] || [ -z "${FIM}" ]; then
  falha "não achei a execução de ${OBJETO} em backup_runs — sem janela, a contagem não é verificável"
else
  for tabela in ${CRITICAS}; do
    restaurado="$(psql_destino --command "select count(*) from ${tabela}")"
    piso="$(psql_origem  --command "select count(*) from ${tabela} where created_at <= '${INICIO}'::timestamptz")"
    teto="$(psql_origem  --command "select count(*) from ${tabela} where created_at <= '${FIM}'::timestamptz")"

    if [ "${restaurado}" -ge "${piso}" ] && [ "${restaurado}" -le "${teto}" ]; then
      ok "${tabela}: ${restaurado} linhas (janela ${piso}–${teto})"
    else
      falha "${tabela}: ${restaurado} linhas, fora da janela ${piso}–${teto}"
    fi
  done
fi

# --- validação 3: integridade do event log por seq -------------------------
# O event log é imutável e a `seq` é densa por sessão. Um dump que perdeu linha
# no meio ainda restaura sem erro e ainda tem contagem plausível — só a
# continuidade da seq denuncia. A unique (session_id, seq) já barra duplicata;
# o que se procura aqui é BURACO.
total="$(psql_destino --command "select count(*) from session_events")"

if [ "${total}" -eq 0 ]; then
  # Segunda guarda contra falso verde, específica desta validação: com zero
  # eventos a consulta abaixo devolve zero buracos e a checagem mais importante
  # do teste — a continuidade da seq — passa sem ter olhado nada.
  falha "o dump não tem NENHUM session_event; a integridade da seq não foi verificada.
         Gere atividade na origem (um turno de agente, ou o smoke seguido de
         POST /internal/sessions/<id>/events) e rode de novo."
else
  buracos="$(psql_destino --command \
    "select count(*) from (
       select session_id
         from session_events
        group by session_id
       having count(*) <> max(seq) - min(seq) + 1
          or min(seq) <> 1
     ) t")"
  if [ "${buracos}" -eq 0 ]; then
    sessoes="$(psql_destino --command "select count(distinct session_id) from session_events")"
    ok "event log íntegro: ${total} eventos em ${sessoes} sessões, seq densa a partir de 1"
  else
    falha "${buracos} sessões com seq descontínua ou não começando em 1"
  fi
fi

# --- veredito --------------------------------------------------------------
echo
if [ "${falhas}" -eq 0 ]; then
  log "RESTORE VALIDADO — todas as verificações passaram"
  exit 0
fi
log "RESTORE REPROVADO — ${falhas} verificação(ões) falharam"
exit 1
