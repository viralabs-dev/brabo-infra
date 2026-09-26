# shellcheck shell=bash
# Evidência do `rollout-test.sh` (AT-078) — carregada com `source`, nunca
# executada sozinha.
#
# ## Por que existe
#
# A prova do rollout reprova de forma intermitente (duas órfãs em dez rodadas),
# e as duas vezes a evidência morreu com o pod: a sessão órfã morava numa
# réplica ANTIGA, o `rollout restart` a derrubou, e os logs que diriam o que ela
# fez com a sessão foram junto. As réplicas NOVAS nunca citam a órfã. Sem esses
# logs não há reprodução, e sem reprodução a regra do AT-078 proíbe corrigir.
#
# Então, ANTES do rollout, isto passa a gravar em arquivo:
#
#   engine-<pod>.log   o log de CADA pod do engine, anexado com `logs -f` assim
#                      que o pod fica Running — os que já existiam (com o log
#                      inteiro, desde o boot) e os que nascerem depois
#   final-<pod>.log    uma cópia não-seguida dos pods ainda de pé no fim, que
#                      cobre um `logs -f` que tenha caído no meio
#   events.log         `kubectl get events -w` do namespace (com os instantes
#                      do próprio evento: SuccessfulRescale do HPA,
#                      ScalingReplicaSet, Killing...)
#   replicas.log       amostra a cada 2s: `<epoch> <spec.replicas do
#                      Deployment> <prontas> <hpa atual> <hpa desejado>` — é
#                      daqui que sai o instante do scale-down do HPA
#   donos.log          cada leitura de dono feita pela verificação:
#                      `<epoch> <sessão> <nó dono | ->`
#   donos-durante-rollout.log  a mesma leitura, em laço enquanto o
#                      `rollout status` corre (escrita pelo `rollout-test.sh`)
#   engine-estado.txt  `session_states` das sessões e os últimos jobs do
#                      `SessionAdoptionWorker`, no fim (escrito pelo teste)
#   anexos.log         quando cada `logs -f` foi anexado
#   marcos.log         instantes do teste (`rollout`, `rollout-status`...)
#
# ## O confundidor do HPA
#
# O `hpa-test` roda antes e deixa o engine com três réplicas; a carga dele sai
# no fim, e ~75s depois o HPA desce para uma, matando réplicas NOVAS no meio da
# janela de convergência. Uma órfã que perdeu o dono DEPOIS desse scale-down
# conta outra história que uma que nunca teve dono desde a primeira leitura.
# `diagnostico_da_orfa` separa as duas com o que `donos.log` e `replicas.log`
# gravaram, sem mudar nada do que o teste considera adotada ou drenada.
#
# As funções puras (`primeiro_scale_down`, `mudancas_de_replicas`,
# `diagnostico_da_orfa`) só leem arquivo e são exercitadas por
# `scripts/ci/rollout-evidencia.spec.ts`. As que falam com o cluster
# (`evidencia_iniciar`, `evidencia_parar`) só matam processos que ELAS
# iniciaram, pelos PIDs que gravaram.

# --------------------------------------------------------------------------
# Funções puras

# Instante (epoch) da primeira QUEDA de `spec.replicas` do Deployment a partir
# de `t0`. O `rollout restart` nunca muda `spec.replicas` (só o template), então
# uma queda ali é o HPA mandando descer. Vazio quando não houve queda.
primeiro_scale_down() {
  local arquivo="$1" t0="$2"
  [[ -f "${arquivo}" ]] || return 0
  awk -v t0="${t0}" '
    $2 ~ /^[0-9]+$/ {
      if (anterior != "" && $1 >= t0 && $2 + 0 < anterior + 0) { print $1; exit }
      anterior = $2
    }
  ' "${arquivo}"
}

# Cada mudança de `spec.replicas` ou do desejado pelo HPA, em tempo relativo a
# `t0` — "T+75s: deployment 3 -> 1 (hpa desejado 1)".
mudancas_de_replicas() {
  local arquivo="$1" t0="$2"
  [[ -f "${arquivo}" ]] || return 0
  awk -v t0="${t0}" '
    $2 ~ /^[0-9]+$/ {
      desejado = ($5 == "" ? "?" : $5)
      if (spec != "" && ($2 != spec || desejado != desj)) {
        rel = $1 - t0
        printf "T%s%ds: deployment %s -> %s (hpa desejado %s -> %s)\n", (rel < 0 ? "" : "+"), rel, spec, $2, desj, desejado
      }
      spec = $2; desj = desejado
    }
  ' "${arquivo}"
}

# Uma linha que diz se a órfã ficou sem dono ANTES ou DEPOIS do primeiro
# scale-down do HPA. Lê só as leituras de `donos.log` a partir de `t0`.
#   diagnostico_da_orfa <donos.log> <sessão> <t0> <epoch do scale-down | vazio>
diagnostico_da_orfa() {
  local arquivo="$1" sid="$2" t0="$3" queda="${4:-}"
  awk -v sid="${sid}" -v t0="${t0}" -v queda="${queda}" '
    function rel(t) { return "T+" (t - t0) "s" }
    $2 == sid && $1 >= t0 {
      n++
      if ($3 == "-") {
        if (primeira_sem == "") primeira_sem = $1
        if (ultima_com != "" && perdeu == "") perdeu = $1
      } else {
        ultima_com = $1; dono = $3; perdeu = ""
      }
    }
    END {
      if (n == 0) { print "nenhuma leitura de dono gravada depois do rollout"; exit }
      if (ultima_com != "" && perdeu == "") { printf "tinha dono (%s) na última leitura (%s)\n", dono, rel(ultima_com); exit }
      if (queda == "") {
        if (ultima_com == "")
          printf "sem dono já na primeira leitura (%s); nenhum scale-down do HPA na janela — o HPA não explica esta órfã\n", rel(primeira_sem)
        else
          printf "teve dono (%s) até %s e ficou sem dono em %s; nenhum scale-down do HPA na janela — o HPA não explica esta órfã\n", dono, rel(ultima_com), rel(perdeu)
        exit
      }
      if (ultima_com == "") {
        if (primeira_sem < queda)
          printf "sem dono já na primeira leitura (%s), ANTES do scale-down do HPA (%s) — o HPA não explica esta órfã\n", rel(primeira_sem), rel(queda)
        else
          printf "a primeira leitura (%s) já foi DEPOIS do scale-down do HPA (%s) — não dá para separar\n", rel(primeira_sem), rel(queda)
        exit
      }
      if (perdeu >= queda)
        printf "teve dono (%s) até %s e ficou sem dono em %s, DEPOIS do scale-down do HPA (%s) — o dono pode ter sido uma réplica que o HPA derrubou\n", dono, rel(ultima_com), rel(perdeu), rel(queda)
      else
        printf "teve dono (%s) até %s e ficou sem dono em %s, ANTES do scale-down do HPA (%s) — o HPA não explica esta órfã\n", dono, rel(ultima_com), rel(perdeu), rel(queda)
    }
  ' "${arquivo}"
}

# Toda linha que cita a sessão, em TODOS os arquivos de evidência — inclusive
# os logs dos pods antigos, que o `kubectl logs` do fim já não alcança.
citar_orfa() {
  local dir="$1" sid="$2" teto="${3:-200}"
  grep -rHF --include='*.log' -- "${sid}" "${dir}" 2>/dev/null \
    | sed "s|^${dir}/||" | head -n "${teto}" || true
}

# --------------------------------------------------------------------------
# Coletores (falam com o cluster)

EVIDENCIA_DIR=''
EVIDENCIA_NS=''
EVIDENCIA_SELETOR=''
# De quanto em quanto tempo os dois laços sondam o cluster. 2s na prova de
# verdade; o spec o encurta para não medir o relógio (AT-174).
EVIDENCIA_INTERVALO="${EVIDENCIA_INTERVALO:-2}"

marco() {
  [[ -n "${EVIDENCIA_DIR}" ]] || return 0
  printf '%s %s %s\n' "$(date +%s)" "$(date -u +%FT%TZ)" "$*" >> "${EVIDENCIA_DIR}/marcos.log"
}

# Anexa `logs -f` a cada pod Running ainda não anexado, a cada
# `EVIDENCIA_INTERVALO` (2s), até existir
# `.parar`. Um anexo por pod: se o `logs -f` cair, o `final-<pod>.log` do fim
# cobre o que o pod ainda tiver.
_anexar_logs_em_laco() {
  local pod fase
  while [[ ! -e "${EVIDENCIA_DIR}/.parar" ]]; do
    while read -r pod fase; do
      [[ -n "${pod}" && "${fase}" == Running ]] || continue
      [[ -e "${EVIDENCIA_DIR}/.anexado-${pod}" ]] && continue
      : > "${EVIDENCIA_DIR}/.anexado-${pod}"
      kubectl -n "${EVIDENCIA_NS}" logs -f "${pod}" --all-containers --timestamps \
        >> "${EVIDENCIA_DIR}/engine-${pod}.log" 2>&1 &
      echo "$!" >> "${EVIDENCIA_DIR}/.pids"
      printf '%s %s anexado %s\n' "$(date +%s)" "$(date -u +%FT%TZ)" "${pod}" >> "${EVIDENCIA_DIR}/anexos.log"
    done < <(kubectl -n "${EVIDENCIA_NS}" get pods -l "${EVIDENCIA_SELETOR}" \
      -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.phase}{"\n"}{end}' 2>/dev/null || true)
    sleep "${EVIDENCIA_INTERVALO}"
  done
}

_amostrar_replicas_em_laco() {
  local spec prontas hpa
  while [[ ! -e "${EVIDENCIA_DIR}/.parar" ]]; do
    spec="$(kubectl -n "${EVIDENCIA_NS}" get deploy engine -o jsonpath='{.spec.replicas} {.status.readyReplicas}' 2>/dev/null || true)"
    hpa="$(kubectl -n "${EVIDENCIA_NS}" get hpa engine -o jsonpath='{.status.currentReplicas} {.status.desiredReplicas}' 2>/dev/null || true)"
    read -r spec prontas <<<"${spec}"
    printf '%s %s %s %s\n' "$(date +%s)" "${spec:-?}" "${prontas:-0}" "${hpa:-? ?}" >> "${EVIDENCIA_DIR}/replicas.log"
    sleep "${EVIDENCIA_INTERVALO}"
  done
}

# evidencia_iniciar <dir> <namespace> <seletor dos pods do engine>
evidencia_iniciar() {
  EVIDENCIA_DIR="$1" EVIDENCIA_NS="$2" EVIDENCIA_SELETOR="$3"
  mkdir -p "${EVIDENCIA_DIR}"
  rm -f "${EVIDENCIA_DIR}/.parar" "${EVIDENCIA_DIR}/.pids" "${EVIDENCIA_DIR}/.lacos" "${EVIDENCIA_DIR}"/.anexado-*
  : > "${EVIDENCIA_DIR}/.pids"
  : > "${EVIDENCIA_DIR}/.lacos"

  kubectl -n "${EVIDENCIA_NS}" get events -w \
    -o custom-columns='ULTIMO:.lastTimestamp,INSTANTE:.eventTime,TIPO:.type,MOTIVO:.reason,TIPO_OBJ:.involvedObject.kind,OBJETO:.involvedObject.name,MENSAGEM:.message' \
    > "${EVIDENCIA_DIR}/events.log" 2>&1 &
  echo "$!" >> "${EVIDENCIA_DIR}/.pids"

  # Os dois laços vão também para `.lacos`: é por eles que `evidencia_parar`
  # espera antes de matar o resto.
  _anexar_logs_em_laco &
  echo "$!" | tee -a "${EVIDENCIA_DIR}/.lacos" >> "${EVIDENCIA_DIR}/.pids"

  _amostrar_replicas_em_laco &
  echo "$!" | tee -a "${EVIDENCIA_DIR}/.lacos" >> "${EVIDENCIA_DIR}/.pids"

  # Os pods de AGORA são os que o rollout vai matar: não seguir adiante antes de
  # o log de cada um estar anexado (teto de 20s, e o teto é dito, não engolido).
  # A sonda é de 0,2s: é espera pelo anexo, não um intervalo a cumprir.
  local esperados anexados espera=0
  esperados="$(kubectl -n "${EVIDENCIA_NS}" get pods -l "${EVIDENCIA_SELETOR}" \
    --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l)"
  while :; do
    anexados="$(find "${EVIDENCIA_DIR}" -maxdepth 1 -name '.anexado-*' | wc -l)"
    (( anexados >= esperados )) && break
    if (( espera >= 100 )); then
      printf '  aviso: só %s de %s pods do engine com log anexado depois de 20s\n' "${anexados}" "${esperados}" >&2
      break
    fi
    sleep 0.2; espera=$(( espera + 1 ))
  done

  marco "evidencia-iniciada (${esperados} pod(s) do engine de pé)"
}

# Para SÓ o que `evidencia_iniciar` subiu e tira a cópia final dos pods de pé.
# Idempotente: o `trap EXIT` do teste a chama de novo depois do caminho de falha.
evidencia_parar() {
  [[ -n "${EVIDENCIA_DIR}" && -f "${EVIDENCIA_DIR}/.pids" ]] || return 0
  [[ -e "${EVIDENCIA_DIR}/.parar" ]] && return 0
  : > "${EVIDENCIA_DIR}/.parar"
  marco "evidencia-parada"
  local pid pod vivos espera=0
  # Primeiro os laços param de anexar, depois morre tudo o que eles anexaram.
  # ESPERA que os dois laços saiam sozinhos (eles olham `.parar` a cada volta),
  # em vez de dormir um tempo fixo: um laço morto não acrescenta PID a `.pids`
  # depois da leitura abaixo. Teto de 10s, dito; depois dele o `kill` segue.
  while :; do
    vivos=0
    while read -r pid; do
      if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then vivos=$(( vivos + 1 )); fi
    done < "${EVIDENCIA_DIR}/.lacos"
    (( vivos == 0 )) && break
    if (( espera >= 100 )); then
      printf '  aviso: %s laço(s) da evidência ainda de pé depois de 10s; matando\n' "${vivos}" >&2
      break
    fi
    sleep 0.1; espera=$(( espera + 1 ))
  done
  while read -r pid; do
    [[ -n "${pid}" ]] && kill "${pid}" 2>/dev/null || true
  done < "${EVIDENCIA_DIR}/.pids"
  while read -r pod; do
    [[ -n "${pod}" ]] || continue
    kubectl -n "${EVIDENCIA_NS}" logs "${pod}" --all-containers --timestamps \
      > "${EVIDENCIA_DIR}/final-${pod}.log" 2>&1 || true
  done < <(kubectl -n "${EVIDENCIA_NS}" get pods -l "${EVIDENCIA_SELETOR}" \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)
  kubectl -n "${EVIDENCIA_NS}" get pods -o wide > "${EVIDENCIA_DIR}/pods-no-fim.txt" 2>&1 || true
}
