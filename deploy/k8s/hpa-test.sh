#!/usr/bin/env bash
# Critério de aceite do HPA: encher a fila do Oban artificialmente faz o
# autoscaler do engine escalar (Fase 5, item 3).
#
# ## Como a carga é injetada, e por que assim
#
# Os jobs entram numa fila que NÃO está declarada na configuração do Oban
# (`config :engine, Oban, queues: [default: 10]`). Sem produtor configurado,
# ninguém os consome: ficam em `available` até serem removidos, que é
# exatamente a condição que se quer observar.
#
# As alternativas foram descartadas por efeito colateral: inserir na fila
# `default` faria o engine EXECUTAR os jobs, medindo drenagem em vez de
# backlog; pausar a fila mudaria o comportamento do sistema durante o teste; e
# criar um worker no-op só para isto colocaria código de teste no domínio.
#
# Uso:
#   bash deploy/k8s/hpa-test.sh          # injeta, observa escalar, limpa
#   HPA_JOBS=120 bash deploy/k8s/hpa-test.sh
set -euo pipefail

NS="${BRABO_NAMESPACE:-brabo}"
JOBS="${HPA_JOBS:-60}"
PROBE_QUEUE="hpa_load_probe"
TIMEOUT="${HPA_TIMEOUT:-240}"

info() { printf '\n\033[1m[hpa-test]\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }
die()  { printf '\n\033[31m[hpa-test] %s\033[0m\n' "$*" >&2; exit 1; }

engine_rpc() {
  kubectl -n "${NS}" exec deploy/engine -- /app/bin/engine rpc "$1"
}

cleanup() {
  info 'removendo os jobs de carga'
  engine_rpc "Ecto.Adapters.SQL.query!(Engine.Repo, \"DELETE FROM engine.oban_jobs WHERE queue = '${PROBE_QUEUE}'\", []); :ok" >/dev/null 2>&1 || true
}
trap cleanup EXIT

baseline="$(kubectl -n "${NS}" get deploy engine -o jsonpath='{.spec.replicas}')"
info "réplicas do engine antes: ${baseline}"

# ---------------------------------------------------------------------------
info "injetando ${JOBS} jobs em available na fila ${PROBE_QUEUE}"
engine_rpc "
  jobs = Enum.map(1..${JOBS}, fn i ->
    Engine.Workers.WorktreeCleanupWorker.new(%{probe: i}, queue: :${PROBE_QUEUE})
  end)
  {:ok, _} = Oban.insert_all(Oban, jobs) |> then(&{:ok, &1})
  :ok
" >/dev/null || die "falha ao inserir os jobs de carga"

depth="$(engine_rpc "
  {:ok, r} = Ecto.Adapters.SQL.query(Engine.Repo, \"SELECT count(*) FROM engine.oban_jobs WHERE queue = '${PROBE_QUEUE}' AND state = 'available'\", [])
  [[n]] = r.rows
  IO.puts(n)
" | tr -d '\r')"
[[ "${depth}" == "${JOBS}" ]] || die "esperava ${JOBS} jobs available, encontrei '${depth}'"
ok "${depth} jobs esperando em available"

# ---------------------------------------------------------------------------
info 'esperando a métrica chegar na External Metrics API'
deadline=$(( SECONDS + 90 ))
while (( SECONDS < deadline )); do
  value="$(kubectl get --raw \
    "/apis/external.metrics.k8s.io/v1beta1/namespaces/${NS}/oban_queue_depth?labelSelector=state%3Davailable" 2>/dev/null \
    | jq '[.items[].value | tonumber] | add' 2>/dev/null || echo 0)"
  if [[ -n "${value}" && "${value}" != "null" ]] && (( ${value%%.*} >= JOBS )); then
    ok "External Metrics API reporta ${value}"
    break
  fi
  sleep 5
done
(( SECONDS < deadline )) || die "a métrica não refletiu a carga — Prometheus ou prometheus-adapter não estão coletando"

# ---------------------------------------------------------------------------
info "esperando o HPA escalar (limite de ${TIMEOUT}s)"
deadline=$(( SECONDS + TIMEOUT ))
scaled=0
while (( SECONDS < deadline )); do
  desired="$(kubectl -n "${NS}" get hpa engine -o jsonpath='{.status.desiredReplicas}' 2>/dev/null || echo 0)"
  current="$(kubectl -n "${NS}" get deploy engine -o jsonpath='{.spec.replicas}' 2>/dev/null || echo 0)"
  printf '  hpa desired=%s deploy replicas=%s\n' "${desired:-?}" "${current:-?}"
  if [[ -n "${desired}" ]] && (( desired > baseline )); then
    scaled=1
    ok "HPA pediu ${desired} réplicas (antes: ${baseline})"
    break
  fi
  sleep 10
done

if (( scaled == 0 )); then
  printf '\n--- estado do HPA ---\n' >&2
  kubectl -n "${NS}" describe hpa engine >&2 || true
  die 'o HPA não escalou dentro do tempo limite'
fi

kubectl -n "${NS}" rollout status deploy/engine --timeout=180s >/dev/null \
  || die 'as réplicas novas não ficaram Ready'
final="$(kubectl -n "${NS}" get deploy engine -o jsonpath='{.spec.replicas}')"
ok "engine escalou de ${baseline} para ${final} réplicas, todas Ready"

printf '\n\033[32m[hpa-test] critério de aceite do HPA cumprido\033[0m\n'
