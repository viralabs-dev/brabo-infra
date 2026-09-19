#!/usr/bin/env bash
# Critério de aceite do item 6 da Fase 5: o backup restaura, e o que volta é
# íntegro.
#
# ## Por que este teste existe
#
# Backup que nunca foi restaurado não é backup — é um arquivo. O modo de falha
# clássico não é "o dump não existe": é o dump existir, ter tamanho plausível, e
# só na hora do incidente se descobrir que faltava uma extensão, que o formato
# não bate com a versão do servidor, ou que metade das linhas não veio.
#
# ## O que ele faz
#
#   1. dispara o CronJob REAL (não um pg_dump ad hoc) e espera terminar;
#   2. roda um Job que baixa o último objeto do S3, cria uma database nova e
#      restaura ali;
#   3. valida estrutura, contagem das tabelas críticas e a continuidade da
#      `seq` do event log;
#   4. derruba a database de teste.
#
# Os passos 2–4 são o mesmo `brabo-restore` que o docs/runbook.md (seção "Restore") manda
# rodar num incidente: o runbook não descreve um procedimento paralelo que
# ninguém nunca exercitou.
#
# ## O modo de MUTAÇÃO (AT-126, BRB-009)
#
# `RESTORE_MUTACAO=tabela-faltando` inverte a pergunta: em vez de "o restore
# passa?", "o restore REPROVA quando o backup não tem uma tabela que a origem
# tem?". Depois do backup real, cria `zz_mutacao_restore` na ORIGEM — o dump já
# está tirado e não a contém, é exatamente o "dump sem uma tabela" — e roda o
# MESMO restore. Sai 0 só se ele reprovar e disser QUAL tabela faltou; sai 1 se
# ele aprovar (a quebra passou sem ser pega) ou reprovar por outro motivo. A
# tabela é derrubada na saída. Um verde da prova normal não diz que ela ainda
# enxerga uma falha; este modo diz.
#
# Uso:
#   bash deploy/k8s/test-restore.sh
#   RESTORE_KEEP_JOB=1 bash deploy/k8s/test-restore.sh   # mantém o Job para depurar
#   RESTORE_MUTACAO=tabela-faltando bash deploy/k8s/test-restore.sh
set -euo pipefail

NS="${BRABO_NAMESPACE:-brabo}"
SUFIXO="$(date +%s)"
JOB_BACKUP="brabo-backup-test-${SUFIXO}"
JOB_RESTORE="brabo-restore-test-${SUFIXO}"
JOB_MUTACAO="brabo-restore-mutacao-${SUFIXO}"
JOB_MUTACAO_LIMPA="brabo-restore-mutacao-limpa-${SUFIXO}"
MUTACAO="${RESTORE_MUTACAO:-}"
TABELA_MUTACAO="zz_mutacao_restore"
mutacao_aplicada=0

info() { printf '\n\033[1m[test-restore]\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }

fail() {
  printf '\n\033[31m[test-restore] FALHOU: %s\033[0m\n' "$*" >&2
  printf '\n--- jobs ---\n' >&2
  kubectl -n "${NS}" get jobs >&2 || true
  printf '\n--- log do backup ---\n' >&2
  kubectl -n "${NS}" logs "job/${JOB_BACKUP}" --tail=60 >&2 2>/dev/null || true
  printf '\n--- log do restore ---\n' >&2
  kubectl -n "${NS}" logs "job/${JOB_RESTORE}" --tail=80 >&2 2>/dev/null || true
  exit 1
}

# Espera o Job terminar para QUALQUER lado. `kubectl wait --for=condition=complete`
# sozinho nunca vê um Job que FALHOU — ele fica `Failed`, jamais `Complete` — e
# espera o teto inteiro: um restore quebrado em segundos custava 30 minutos para
# dizer o que o log do Job já dizia (medido no primeiro run agendado, BRB-009).
# Devolve 0 (Complete), 1 (Failed) ou 2 (teto esgotado).
esperar_job() {
  local job="$1" teto="$2" inicio=${SECONDS} condicoes
  while (( SECONDS - inicio < teto )); do
    condicoes="$(kubectl -n "${NS}" get "job/${job}" \
      -o jsonpath='{range .status.conditions[?(@.status=="True")]}{.type}{" "}{end}' 2>/dev/null || true)"
    case " ${condicoes} " in
      *" Complete "*) return 0 ;;
      *" Failed "*)   return 1 ;;
    esac
    sleep 5
  done
  return 2
}

# Job efêmero da MESMA imagem do backup, com o mesmo securityContext do CronJob
# (inclusive rootfs read-only), trocando só o comando — JSON de lista, como o
# `command:` do YAML. Serve ao restore e, no modo de mutação, ao SQL na origem.
aplicar_job() {
  local nome="$1" comando="$2"
  kubectl -n "${NS}" apply -f - >/dev/null <<YAML
apiVersion: batch/v1
kind: Job
metadata:
  name: ${nome}
  labels:
    app.kubernetes.io/name: brabo-restore
    app.kubernetes.io/part-of: brabo
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 1800
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels:
        app.kubernetes.io/name: brabo-restore
        app.kubernetes.io/part-of: brabo
    spec:
      restartPolicy: Never
      securityContext:
        runAsNonRoot: true
        runAsUser: 70
        runAsGroup: 70
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: restore
          image: brabo-backup:prod
          imagePullPolicy: IfNotPresent
          command: ${comando}
          envFrom:
            - secretRef:
                name: brabo-secrets
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              memory: 1Gi
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 4Gi
YAML
}

limpar() {
  # A tabela da mutação sai da origem MESMO com RESTORE_KEEP_JOB=1: deixá-la
  # faria a próxima prova real ver uma tabela que ninguém criou.
  if [[ "${mutacao_aplicada}" == "1" ]]; then
    aplicar_job "${JOB_MUTACAO_LIMPA}" \
      "[\"sh\", \"-c\", \"psql \\\"\$DATABASE_URL\\\" --set ON_ERROR_STOP=1 --command 'drop table if exists ${TABELA_MUTACAO}'\"]" \
      >/dev/null 2>&1 || true
    esperar_job "${JOB_MUTACAO_LIMPA}" 60 || printf '[test-restore] AVISO: não consegui derrubar %s da origem\n' "${TABELA_MUTACAO}" >&2
  fi
  [[ "${RESTORE_KEEP_JOB:-}" == "1" ]] && return 0
  kubectl -n "${NS}" delete job "${JOB_BACKUP}" "${JOB_RESTORE}" "${JOB_MUTACAO}" "${JOB_MUTACAO_LIMPA}" \
    --ignore-not-found --wait=false >/dev/null 2>&1 || true
}
trap limpar EXIT

case "${MUTACAO}" in
  ""|tabela-faltando) ;;
  *) fail "RESTORE_MUTACAO='${MUTACAO}' desconhecida (única aceita: tabela-faltando)" ;;
esac

command -v kubectl >/dev/null || fail "kubectl não encontrado no PATH"
kubectl -n "${NS}" get cronjob brabo-backup >/dev/null 2>&1 \
  || fail "CronJob brabo-backup não existe no namespace ${NS} — rode 'make deploy-local' antes"

# --- 1. backup real --------------------------------------------------------
# `--from=cronjob/...` clona o jobTemplate: mesma imagem, mesmo comando, mesmas
# variáveis. Um Job escrito à mão aqui testaria um caminho que não é o que roda
# às 03:17.
info "disparando o CronJob de backup"
kubectl -n "${NS}" create job "${JOB_BACKUP}" --from=cronjob/brabo-backup >/dev/null \
  || fail "não foi possível criar o Job de backup"

# O comentário que estava aqui prometia um `wait --for=condition=failed` em
# paralelo que o código nunca fez; `esperar_job` é essa promessa cumprida.
esperar_job "${JOB_BACKUP}" 600 || case $? in
  1) fail "o Job de backup falhou" ;;
  *) fail "o Job de backup não completou em 10 minutos" ;;
esac
kubectl -n "${NS}" logs "job/${JOB_BACKUP}" --tail=20 | sed 's/^/    /'
ok "backup concluído"

# --- 2. restore + validação ------------------------------------------------
# Job efêmero a partir da MESMA imagem, trocando só o comando. Roda com o mesmo
# securityContext do CronJob — inclusive rootfs read-only, para que o teste não
# passe num ambiente mais permissivo do que o de produção.
info "restaurando o último backup numa database nova"
if [[ -n "${MUTACAO}" ]]; then
  info "MUTAÇÃO ${MUTACAO}: criando ${TABELA_MUTACAO} na origem, DEPOIS do backup"
  mutacao_aplicada=1
  aplicar_job "${JOB_MUTACAO}" \
    "[\"sh\", \"-c\", \"psql \\\"\$DATABASE_URL\\\" --set ON_ERROR_STOP=1 --command 'create table ${TABELA_MUTACAO}(id int)'\"]" \
    || fail "não foi possível criar o Job da mutação"
  esperar_job "${JOB_MUTACAO}" 120 \
    || fail "a mutação não pôde ser aplicada na origem — a prova não mediu nada"
  ok "origem tem ${TABELA_MUTACAO}; o dump, não"
fi

aplicar_job "${JOB_RESTORE}" '["brabo-restore"]' || fail "não foi possível criar o Job de restore"

if esperar_job "${JOB_RESTORE}" 1800; then
  if [[ -n "${MUTACAO}" ]]; then
    kubectl -n "${NS}" logs "job/${JOB_RESTORE}" | sed 's/^/    /' || true
    fail "MUTAÇÃO NÃO PEGA: o restore APROVOU um backup sem ${TABELA_MUTACAO} — a prova não enxerga tabela faltando"
  fi
else
  desfecho=$?
  # O log do restore é a mensagem de erro útil (qual validação reprovou), então
  # ele é impresso antes do fail genérico.
  kubectl -n "${NS}" logs "job/${JOB_RESTORE}" --tail=100 | sed 's/^/    /' || true
  if [[ "${desfecho}" -eq 1 && -n "${MUTACAO}" ]]; then
    if kubectl -n "${NS}" logs "job/${JOB_RESTORE}" | grep -qF "faltando: ${TABELA_MUTACAO}"; then
      printf '\n\033[32m[test-restore] mutação PEGA: o restore reprovou nomeando %s\033[0m\n' "${TABELA_MUTACAO}"
      exit 0
    fi
    fail "o restore reprovou, mas NÃO nomeando ${TABELA_MUTACAO} — reprovou por outro motivo, a mutação não foi o que pegou"
  fi
  if [[ "${desfecho}" -eq 1 ]]; then
    fail "o restore falhou ou uma validação reprovou"
  fi
  fail "o restore não terminou em 30 minutos"
fi

kubectl -n "${NS}" logs "job/${JOB_RESTORE}" | sed 's/^/    /'
ok "restore validado"

printf '\n\033[32m[test-restore] backup restaurado e íntegro\033[0m\n'
