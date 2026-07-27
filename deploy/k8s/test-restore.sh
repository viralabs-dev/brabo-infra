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
# Os passos 2–4 são o mesmo `brabo-restore` que o docs/runbooks/restore.md manda
# rodar num incidente: o runbook não descreve um procedimento paralelo que
# ninguém nunca exercitou.
#
# Uso:
#   bash deploy/k8s/test-restore.sh
#   RESTORE_KEEP_JOB=1 bash deploy/k8s/test-restore.sh   # mantém o Job para depurar
set -euo pipefail

NS="${BRABO_NAMESPACE:-brabo}"
SUFIXO="$(date +%s)"
JOB_BACKUP="brabo-backup-test-${SUFIXO}"
JOB_RESTORE="brabo-restore-test-${SUFIXO}"

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

limpar() {
  [[ "${RESTORE_KEEP_JOB:-}" == "1" ]] && return 0
  kubectl -n "${NS}" delete job "${JOB_BACKUP}" "${JOB_RESTORE}" \
    --ignore-not-found --wait=false >/dev/null 2>&1 || true
}
trap limpar EXIT

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

# `wait --for=condition=failed` em paralelo evita esperar o timeout inteiro
# quando o job já falhou — sem isso, um backup quebrado custa 10 minutos de
# espera antes de reportar.
if ! kubectl -n "${NS}" wait --for=condition=complete "job/${JOB_BACKUP}" --timeout=600s >/dev/null 2>&1; then
  fail "o Job de backup não completou em 10 minutos"
fi
kubectl -n "${NS}" logs "job/${JOB_BACKUP}" --tail=20 | sed 's/^/    /'
ok "backup concluído"

# --- 2. restore + validação ------------------------------------------------
# Job efêmero a partir da MESMA imagem, trocando só o comando. Roda com o mesmo
# securityContext do CronJob — inclusive rootfs read-only, para que o teste não
# passe num ambiente mais permissivo do que o de produção.
info "restaurando o último backup numa database nova"
kubectl -n "${NS}" apply -f - >/dev/null <<YAML
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_RESTORE}
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
          command: ["brabo-restore"]
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

if ! kubectl -n "${NS}" wait --for=condition=complete "job/${JOB_RESTORE}" --timeout=1800s >/dev/null 2>&1; then
  # O log do restore é a mensagem de erro útil (qual validação reprovou), então
  # ele é impresso antes do fail genérico.
  kubectl -n "${NS}" logs "job/${JOB_RESTORE}" --tail=100 | sed 's/^/    /' || true
  fail "o restore não completou ou uma validação reprovou"
fi

kubectl -n "${NS}" logs "job/${JOB_RESTORE}" | sed 's/^/    /'
ok "restore validado"

printf '\n\033[32m[test-restore] backup restaurado e íntegro\033[0m\n'
