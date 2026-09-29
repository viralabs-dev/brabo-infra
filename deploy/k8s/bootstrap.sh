#!/usr/bin/env bash
# Sobe um cluster local do zero e instala o Brabo inteiro (Fase 5, item 6).
#
# Uso:
#   bash deploy/k8s/bootstrap.sh                # cria cluster, instala, valida
#   BRABO_CLUSTER_TOOL=kind bash ...            # força kind (default: k3d)
#   BRABO_SKIP_BUILD=1 bash ...                 # usa as imagens já no daemon
#   BRABO_KEEP_CLUSTER=1 bash ...               # reaproveita cluster existente
#   BRABO_SKIP_OBSERVABILITY=1 bash ...         # sem Tempo/Loki/Collector/Alloy/Grafana
#   TAG=v0.2.0-qa.1 bash ...                    # valida uma TAG da esteira
#
# O que ele NÃO faz: instalar ingress controller ou mexer em DNS. Os serviços
# saem em NodePorts mapeadas para as MESMAS portas do docker-compose.prod.yml
# (3000/4000/8088), o que mantém válidos os defaults do docker/smoke.sh e evita
# depender de resolução de nome — nip.io e afins precisam de internet.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
K8S_DIR="${REPO_ROOT}/deploy/k8s"
CLUSTER_NAME="${BRABO_CLUSTER_NAME:-brabo}"
BIN_DIR="${HOME}/.local/bin"

# shellcheck source=/dev/null
source "${K8S_DIR}/helm/charts.env"

# Versões pinadas das ferramentas que este script pode instalar.
K3D_VERSION="v5.8.3"
HELM_VERSION="v3.19.0"

info() { printf '\n\033[1m[bootstrap]\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }
warn() { printf '  \033[33maviso\033[0m %s\n' "$*" >&2; }
die()  { printf '\n\033[31m[bootstrap] %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Ferramentas
# ---------------------------------------------------------------------------
ensure_helm() {
  command -v helm >/dev/null 2>&1 && return 0
  info "helm não encontrado — instalando ${HELM_VERSION} em ${BIN_DIR}"
  mkdir -p "${BIN_DIR}"
  local tmp arch tarball
  tmp="$(mktemp -d)"
  arch="$(uname -m)"; [[ "${arch}" == "x86_64" ]] && arch=amd64
  [[ "${arch}" == "aarch64" ]] && arch=arm64
  # O nome do arquivo tem que ser o ORIGINAL: o .sha256sum publicado traz o
  # nome dentro dele, e `sha256sum -c` procura por esse nome no disco.
  tarball="helm-${HELM_VERSION}-linux-${arch}.tar.gz"
  curl -fsSL "https://get.helm.sh/${tarball}" -o "${tmp}/${tarball}"
  # O projeto publica o sha256 ao lado do tarball; conferimos contra ele em vez
  # de pinar um hash aqui, que apodreceria a cada bump de versão. Sem esta
  # conferência, um mirror comprometido entrega binário arbitrário.
  curl -fsSL "https://get.helm.sh/${tarball}.sha256sum" -o "${tmp}/${tarball}.sha256sum"
  (cd "${tmp}" && sha256sum -c "${tarball}.sha256sum") >/dev/null \
    || die "checksum do helm não confere"
  tar -xzf "${tmp}/${tarball}" -C "${tmp}"
  install -m 0755 "${tmp}/linux-${arch}/helm" "${BIN_DIR}/helm"
  rm -rf "${tmp}"
  export PATH="${BIN_DIR}:${PATH}"
  ok "helm $(helm version --short)"
}

ensure_k3d() {
  command -v k3d >/dev/null 2>&1 && return 0
  info "k3d não encontrado — instalando ${K3D_VERSION} em ${BIN_DIR}"
  mkdir -p "${BIN_DIR}"
  local arch
  arch="$(uname -m)"; [[ "${arch}" == "x86_64" ]] && arch=amd64
  [[ "${arch}" == "aarch64" ]] && arch=arm64
  curl -fsSL "https://github.com/k3d-io/k3d/releases/download/${K3D_VERSION}/k3d-linux-${arch}" \
    -o "${BIN_DIR}/k3d"
  chmod 0755 "${BIN_DIR}/k3d"
  export PATH="${BIN_DIR}:${PATH}"
  ok "k3d $(k3d version | head -1)"
}

pick_cluster_tool() {
  if [[ -n "${BRABO_CLUSTER_TOOL:-}" ]]; then
    echo "${BRABO_CLUSTER_TOOL}"; return
  fi
  # k3d é o default MESMO quando só o kind está instalado, e não por gosto: o
  # k3s traz controlador de NetworkPolicy embutido, enquanto o kindnet do kind
  # NÃO implementa NetworkPolicy e ignora os manifests em silêncio. Num cluster
  # kind as políticas desta sessão existiriam no etcd sem efeito nenhum, e o
  # deploy pareceria validado sem ter validado metade do item 4 do escopo.
  #
  # kind continua suportado, por escolha explícita: BRABO_CLUSTER_TOOL=kind.
  echo k3d
}

# ---------------------------------------------------------------------------
# Cluster
# ---------------------------------------------------------------------------
create_cluster_k3d() {
  # A lista é LIDA INTEIRA antes do `grep` (AT-242): o `k3d` escreve a tabela
  # em pedaços (medido: 9 escritas só no cabeçalho), o `grep -q` sai na linha
  # que casa e, sob `pipefail`, o EPIPE do resto faria um cluster que EXISTE
  # parecer ausente — e o `cluster create` seguinte reprovaria por nome
  # repetido. `k3d` que falha continua lido como "sem cluster", como antes.
  local clusters
  if clusters="$(k3d cluster list 2>/dev/null)" \
      && grep -q "^${CLUSTER_NAME}\b" <<<"${clusters}"; then
    if [[ "${BRABO_KEEP_CLUSTER:-}" == "1" ]]; then
      ok "cluster k3d ${CLUSTER_NAME} reaproveitado"; return
    fi
    info "removendo cluster k3d ${CLUSTER_NAME} anterior"
    k3d cluster delete "${CLUSTER_NAME}" >/dev/null
  fi

  info "criando cluster k3d ${CLUSTER_NAME}"
  # As portas do host batem com as do docker-compose.prod.yml. `@loadbalancer`
  # publica através do proxy do k3d, que encaminha para o NodePort.
  k3d cluster create "${CLUSTER_NAME}" \
    --agents 0 \
    --port "3000:30300@loadbalancer" \
    --port "4000:30400@loadbalancer" \
    --port "8088:30088@loadbalancer" \
    --port "3001:30030@loadbalancer" \
    --k3s-arg "--disable=traefik@server:0" \
    --wait >/dev/null
  ok "cluster k3d de pé"
}

create_cluster_kind() {
  # Mesma leitura inteira do k3d acima (AT-242): o `kind` escreve um cluster
  # por linha, cada uma numa escrita (medido: 5 para uma lista curta).
  local clusters
  if clusters="$(kind get clusters 2>/dev/null)" \
      && grep -qx "${CLUSTER_NAME}" <<<"${clusters}"; then
    if [[ "${BRABO_KEEP_CLUSTER:-}" == "1" ]]; then
      ok "cluster kind ${CLUSTER_NAME} reaproveitado"; return
    fi
    info "removendo cluster kind ${CLUSTER_NAME} anterior"
    kind delete cluster --name "${CLUSTER_NAME}" >/dev/null
  fi

  warn "kind: o kindnet NÃO implementa NetworkPolicy — as políticas serão"
  warn "      aplicadas mas não terão efeito. Prefira k3d para validá-las."

  info "criando cluster kind ${CLUSTER_NAME}"
  kind create cluster --name "${CLUSTER_NAME}" --wait 120s --config=- <<'EOF' >/dev/null
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraPortMappings:
      - { containerPort: 30300, hostPort: 3000, protocol: TCP }
      - { containerPort: 30400, hostPort: 4000, protocol: TCP }
      - { containerPort: 30088, hostPort: 8088, protocol: TCP }
      - { containerPort: 30030, hostPort: 3001, protocol: TCP }
EOF
  ok "cluster kind de pé"
}

# Importa uma imagem do daemon para o cluster.
#
# Segundo argumento `optional`: falha vira aviso em vez de erro. Serve para
# imagens públicas, que o kubelet consegue puxar sozinho do registry — e é
# necessário porque o `k3d image import` engasga com índices multi-arquitetura
# que trazem manifesto de atestação (`content digest ... not found`), que é o
# formato que o `docker pull` produz hoje para imagens oficiais. As NOSSAS
# imagens não existem em registry nenhum: para elas, falhar na importação é
# erro de verdade.
load_image() {
  local image="$1" mode="${2:-required}" out

  case "${TOOL}" in
    k3d)  out="$(k3d image import -c "${CLUSTER_NAME}" "${image}" 2>&1)" ;;
    kind) out="$(kind load docker-image --name "${CLUSTER_NAME}" "${image}" 2>&1)" ;;
  esac

  # O k3d sai com 0 mesmo quando falha em importar: sem inspecionar a saída, o
  # script anunciava "disponível no cluster" para uma imagem que não entrou.
  if grep -qiE 'error|failed' <<<"${out}"; then
    if [[ "${mode}" == "optional" ]]; then
      warn "imagem ${image} não pôde ser importada; o kubelet vai puxá-la do registry"
      return 0
    fi
    printf '%s\n' "${out}" >&2
    die "falha ao importar ${image} para o cluster"
  fi

  ok "imagem ${image} disponível no cluster"
}

# ---------------------------------------------------------------------------
# Execução
# ---------------------------------------------------------------------------
export PATH="${BIN_DIR}:${PATH}"
command -v kubectl >/dev/null 2>&1 || die "kubectl não encontrado no PATH"
command -v docker  >/dev/null 2>&1 || die "docker não encontrado no PATH"

TOOL="$(pick_cluster_tool)"
info "ferramenta de cluster: ${TOOL}"
[[ "${TOOL}" == "k3d" ]] && ensure_k3d
[[ "${TOOL}" == "kind" ]] && { command -v kind >/dev/null || die "kind não encontrado"; }
ensure_helm

# --- referência da esteira -------------------------------------------------
#
# `TAG=vX.Y.Z-qa.N` valida uma tag da esteira (FASE 6) em vez do working tree.
# NÃO há deploy automático em ambiente nenhum: esta é a forma de olhar com os
# próprios olhos o que a tag carimbou, no cluster local.
#
# O checkout é destacado e a árvore precisa estar limpa — sair de um estado
# sujo perderia trabalho, e é melhor recusar do que adivinhar.
if [[ -n "${TAG:-}" ]]; then
  git -C "${REPO_ROOT}" rev-parse --verify --quiet "refs/tags/${TAG}" >/dev/null \
    || die "tag '${TAG}' não existe. Busque com: git fetch --tags"
  [[ -z "$(git -C "${REPO_ROOT}" status --porcelain)" ]] \
    || die "a árvore tem mudanças não commitadas — commite ou guarde antes de usar TAG="
  REF_ANTERIOR="$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD)"
  [[ "${REF_ANTERIOR}" == "HEAD" ]] && REF_ANTERIOR="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
  info "validando a tag ${TAG} (para voltar: git checkout ${REF_ANTERIOR})"
  git -C "${REPO_ROOT}" checkout --quiet --detach "refs/tags/${TAG}"
fi

# --- imagens ---------------------------------------------------------------
if [[ "${BRABO_SKIP_BUILD:-}" == "1" ]]; then
  info "BRABO_SKIP_BUILD=1 — usando as imagens já no daemon"
else
  info "construindo as imagens de produção"
  docker build -q -f "${REPO_ROOT}/docker/api/Dockerfile.prod"    -t brabo-api:prod    "${REPO_ROOT}" >/dev/null
  docker build -q -f "${REPO_ROOT}/docker/engine/Dockerfile.prod" -t brabo-engine:prod "${REPO_ROOT}" >/dev/null
  docker build -q -f "${REPO_ROOT}/docker/web/Dockerfile.prod"    -t brabo-web:prod    "${REPO_ROOT}" >/dev/null
  docker build -q -f "${REPO_ROOT}/docker/backup/Dockerfile.prod" -t brabo-backup:prod "${REPO_ROOT}" >/dev/null
  ok "quatro imagens construídas"
fi

case "${TOOL}" in
  k3d)  create_cluster_k3d ;;
  kind) create_cluster_kind ;;
  *)    die "ferramenta desconhecida: ${TOOL}" ;;
esac

for img in brabo-api:prod brabo-engine:prod brabo-web:prod brabo-backup:prod; do
  load_image "${img}"
done

# --- operadores ------------------------------------------------------------
info "instalando operadores (helm)"
helm repo add external-secrets "${ESO_REPO}" >/dev/null 2>&1 || true
helm repo add cnpg "${CNPG_REPO}" >/dev/null 2>&1 || true
helm repo add prometheus-community "${PROMETHEUS_REPO}" >/dev/null 2>&1 || true
helm repo add metrics-server "${METRICS_SERVER_REPO}" >/dev/null 2>&1 || true
helm repo add grafana "${GRAFANA_REPO}" >/dev/null 2>&1 || true
helm repo add open-telemetry "${OTEL_COLLECTOR_REPO}" >/dev/null 2>&1 || true
helm repo update >/dev/null

# Releases INDEPENDENTES sobem em paralelo (AT-177). O helm roda um `--wait`
# por release, e em série o bootstrap esperava cada operador ficar Ready antes
# de começar o seguinte, sem que nenhum dependesse do anterior: ESO, CNPG e
# Prometheus não se conhecem. O que tem ordem de verdade fica numa MESMA
# cadeia (o prometheus-adapter lê o Prometheus; o Grafana valida os
# datasources no boot), e as cadeias correm lado a lado.
#
# Cada cadeia escreve num log próprio, e o log só é despejado se ela FALHAR —
# em paralelo, as saídas misturadas no terminal não diriam de quem é o erro.
# `aguardar_releases` espera TODAS antes de decidir: morrer na primeira
# deixaria as outras rodando órfãs, escrevendo num terminal que já saiu.
RELEASES_TMP="$(mktemp -d)"
RELEASES_PIDS=()
RELEASES_NOMES=()

em_paralelo() {
  local nome="$1"; shift
  # A duração vai no log da cadeia: despejado só no fim, o instante da linha
  # no terminal deixa de dizer quanto cada release levou.
  ( inicio="${SECONDS}"; "$@"; printf '       (%s: %ss)\n' "${nome}" "$((SECONDS - inicio))" ) \
    >"${RELEASES_TMP}/${nome}.log" 2>&1 &
  RELEASES_PIDS+=("$!")
  RELEASES_NOMES+=("${nome}")
}

aguardar_releases() {
  local i falhou=0
  for i in "${!RELEASES_PIDS[@]}"; do
    if wait "${RELEASES_PIDS[$i]}"; then
      cat "${RELEASES_TMP}/${RELEASES_NOMES[$i]}.log"
    else
      falhou=1
      printf '\n--- log de %s (falhou) ---\n' "${RELEASES_NOMES[$i]}" >&2
      cat "${RELEASES_TMP}/${RELEASES_NOMES[$i]}.log" >&2
    fi
  done
  RELEASES_PIDS=(); RELEASES_NOMES=()
  [[ "${falhou}" == "0" ]] || die "uma ou mais releases do helm falharam (log acima)"
}

cadeia_eso() {
  helm upgrade --install external-secrets external-secrets/external-secrets \
    --version "${ESO_CHART_VERSION}" \
    --namespace external-secrets --create-namespace \
    --set installCRDs=true --wait --timeout 5m >/dev/null
  ok "External Secrets Operator"
}

cadeia_cnpg() {
  helm upgrade --install cnpg cnpg/cloudnative-pg \
    --version "${CNPG_CHART_VERSION}" \
    --namespace cnpg-system --create-namespace --wait --timeout 5m >/dev/null
  ok "CloudNativePG"
}

# metrics-server: sem ele o HPA da api (CPU) nunca sai de <unknown>. O k3s já
# traz o seu; instalar por cima criaria dois controladores disputando o mesmo
# APIService.
cadeia_metrics_server() {
  if kubectl get deploy -n kube-system metrics-server >/dev/null 2>&1; then
    ok "metrics-server já presente (k3s)"
  else
    helm upgrade --install metrics-server metrics-server/metrics-server \
      --version "${METRICS_SERVER_CHART_VERSION}" \
      --namespace kube-system \
      --set 'args={--kubelet-insecure-tls}' --wait --timeout 5m >/dev/null
    ok "metrics-server"
  fi
}

# O Prometheus e o adapter NÃO são observabilidade opcional: o HPA do engine
# escala por `oban_queue_depth`, que chega pela External Metrics API que o
# adapter serve a partir do Prometheus. `smoke-k8s` e `hpa-test` dependem dos
# dois — por isso eles ficam FORA de `BRABO_SKIP_OBSERVABILITY`.
cadeia_prometheus() {
  helm upgrade --install prometheus prometheus-community/prometheus \
    --version "${PROMETHEUS_CHART_VERSION}" \
    --namespace monitoring \
    -f "${K8S_DIR}/helm/prometheus-values.yaml" --wait --timeout 5m >/dev/null
  ok "Prometheus"

  helm upgrade --install prometheus-adapter prometheus-community/prometheus-adapter \
    --version "${PROMETHEUS_ADAPTER_CHART_VERSION}" \
    --namespace monitoring \
    -f "${K8S_DIR}/helm/prometheus-adapter-values.yaml" --wait --timeout 5m >/dev/null
  ok "prometheus-adapter"
}

# --- observabilidade (Fase 5, sessão 3) ------------------------------------
# Ordem: os backends primeiro (Tempo, Loki), depois quem escreve neles
# (Collector, Alloy), e o Grafana por último — ele valida os datasources no
# boot e um datasource inalcançável só polui o log. Tempo e Loki não se
# conhecem, nem Collector e Alloy: cada par sobe em paralelo.
cadeia_tempo() {
  helm upgrade --install tempo grafana/tempo \
    --version "${TEMPO_CHART_VERSION}" --namespace monitoring \
    -f "${K8S_DIR}/helm/tempo-values.yaml" --wait --timeout 5m >/dev/null
  ok "Tempo (traces)"
}

cadeia_loki() {
  helm upgrade --install loki grafana/loki \
    --version "${LOKI_CHART_VERSION}" --namespace monitoring \
    -f "${K8S_DIR}/helm/loki-values.yaml" --wait --timeout 8m >/dev/null
  ok "Loki (logs)"
}

cadeia_otel_collector() {
  helm upgrade --install otel-collector open-telemetry/opentelemetry-collector \
    --version "${OTEL_COLLECTOR_CHART_VERSION}" --namespace monitoring \
    -f "${K8S_DIR}/helm/otel-collector-values.yaml" --wait --timeout 5m >/dev/null
  ok "OpenTelemetry Collector"
}

cadeia_alloy() {
  helm upgrade --install alloy grafana/alloy \
    --version "${ALLOY_CHART_VERSION}" --namespace monitoring \
    -f "${K8S_DIR}/helm/alloy-values.yaml" --wait --timeout 5m >/dev/null
  ok "Alloy (coleta de logs)"
}

# O rótulo do namespace é o que a NetworkPolicy do engine usa para liberar o
# scrape — `kubernetes.io/metadata.name` é posto automaticamente pelo cluster,
# mas só na criação. Criado ANTES das cadeias: duas delas instalam nele.
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f - >/dev/null

em_paralelo eso            cadeia_eso
em_paralelo cnpg           cadeia_cnpg
em_paralelo metrics-server cadeia_metrics_server
em_paralelo prometheus     cadeia_prometheus
aguardar_releases

# `BRABO_SKIP_OBSERVABILITY=1` (AT-177) pula Tempo, Loki, Collector, Alloy e
# Grafana — os 133 s medidos que as provas de `propriedades.yml` nunca leem.
# É opt-out EXPLÍCITO, e o padrão não muda: `make deploy-local` continua
# subindo a stack inteira, porque quem abre o cluster para olhar quer o
# Grafana. Sem o Collector, api e engine seguem exportando OTLP para um
# Service que não existe: o exportador falha em segundo plano e nada que
# as provas medem depende dele (medido na rodada de `propriedades.yml` que
# introduziu a variável — ver `docs/runbook.md`, "Scheduled property proofs").
if [[ "${BRABO_SKIP_OBSERVABILITY:-}" == "1" ]]; then
  info "BRABO_SKIP_OBSERVABILITY=1 — sem Tempo, Loki, Collector, Alloy e Grafana"
else
  em_paralelo tempo cadeia_tempo
  em_paralelo loki  cadeia_loki
  aguardar_releases

  em_paralelo otel-collector cadeia_otel_collector
  em_paralelo alloy          cadeia_alloy
  aguardar_releases

  # Dashboards versionados no repositório viram ConfigMap. Cada arquivo entra
  # com a chave sendo o nome do arquivo, que é o que o provider do Grafana
  # espera.
  kubectl -n monitoring create configmap brabo-dashboards \
    --from-file="${K8S_DIR}/observability/dashboards/" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null

  # Regras de alerta: ConfigMap montado como arquivo de provisioning (ver o
  # comentário em helm/grafana-values.yaml).
  kubectl -n monitoring create configmap brabo-alerts \
    --from-file="${K8S_DIR}/observability/alerts/brabo-alerts.yaml" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null

  helm upgrade --install grafana grafana/grafana \
    --version "${GRAFANA_CHART_VERSION}" --namespace monitoring \
    -f "${K8S_DIR}/helm/grafana-values.yaml" \
    --wait --timeout 5m >/dev/null
  ok "Grafana (http://localhost:3001)"
fi
rm -rf "${RELEASES_TMP}"

# --- segredos --------------------------------------------------------------
# Gerados aqui e criados IMPERATIVAMENTE. Nunca entram em manifesto, nunca são
# versionados. É o mesmo contrato de produção visto do outro lado: lá o
# ExternalSecret lê de um provider gerenciado; aqui lê deste Secret-fonte.
info "gerando segredos locais"
kubectl create namespace brabo --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl create namespace brabo-db --dry-run=client -o yaml | kubectl apply -f - >/dev/null

PG_PASSWORD="$(openssl rand -hex 16)"
DATABASE_URL="postgres://brabo:${PG_PASSWORD}@brabo-pg-rw.brabo-db.svc.cluster.local:5432/brabo"

kubectl -n brabo-db create secret generic brabo-pg-credentials \
  --type=kubernetes.io/basic-auth \
  --from-literal=username=brabo \
  --from-literal=password="${PG_PASSWORD}" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

# NEO4J_PASSWORD entrou no ExternalSecret da base com o grafo (ADR 0099) e
# nunca aqui: o ESO parava em "property NEO4J_PASSWORD does not exist", o
# `brabo-secrets` não nascia e todo pod do namespace ficava em
# CreateContainerConfigError. Quem mediu foi a segunda rodada de
# `.github/workflows/propriedades.yml`. Desde a AT-220 o ExternalSecret puxa
# este objeto INTEIRO (`dataFrom.extract`), então uma chave esquecida aqui não
# derruba mais a sincronização: o `brabo-secrets` nasce sem ela e quem acusa é
# o consumidor (secretKeyRef em CreateContainerConfigError, api/engine
# recusando o boot). A lista abaixo continua sendo o inventário das chaves
# OBRIGATÓRIAS — e tudo o que entrar aqui vira variável de api, engine,
# migrações e backup. As `_PREVIOUS` NÃO entram: só existem durante uma
# rotação (docs/runbook.md, "Auth key rotation").
kubectl -n brabo create secret generic brabo \
  --from-literal=DATABASE_URL="${DATABASE_URL}" \
  --from-literal=SECRET_KEY_BASE="$(openssl rand -hex 32)" \
  --from-literal=CREDENTIALS_MASTER_KEY="$(openssl rand -hex 32)" \
  --from-literal=GIT_OAUTH_STATE_SECRET="$(openssl rand -hex 32)" \
  --from-literal=AUTH_JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=AUTH_TOKEN_PEPPER="$(openssl rand -hex 32)" \
  --from-literal=BRABO_SERVICE_TOKEN="$(openssl rand -hex 32)" \
  --from-literal=RELEASE_COOKIE="$(openssl rand -hex 24)" \
  --from-literal=BACKUP_S3_ENDPOINT="http://s3-local.brabo.svc.cluster.local:9000" \
  --from-literal=BACKUP_S3_BUCKET=brabo-backups \
  --from-literal=BACKUP_S3_ACCESS_KEY=brabo-backup \
  --from-literal=BACKUP_S3_SECRET_KEY="$(openssl rand -hex 20)" \
  --from-literal=NEO4J_PASSWORD="$(openssl rand -hex 24)" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
ok "Secret-fonte criado (nunca versionado)"

# --- banco -----------------------------------------------------------------
info "subindo o Postgres (CloudNativePG)"
kubectl apply -k "${K8S_DIR}/overlays/local/db" >/dev/null
kubectl -n brabo-db wait --for=condition=Ready cluster/brabo-pg --timeout=300s >/dev/null
ok "Postgres pronto"

# --- aplicação -------------------------------------------------------------
# Job tem spec imutável: reaplicar com imagem nova falha se o anterior existir.
kubectl -n brabo delete job migrate-api migrate-engine --ignore-not-found >/dev/null 2>&1 || true

info "aplicando o overlay local"
kubectl apply -k "${K8S_DIR}/overlays/local" >/dev/null

info "esperando o ESO materializar os Secrets"
kubectl -n brabo wait --for=condition=Ready externalsecret/brabo-secrets --timeout=120s >/dev/null
ok "Secrets materializados"

info "esperando as migrações"
kubectl -n brabo wait --for=condition=complete job/migrate-api --timeout=300s >/dev/null
kubectl -n brabo wait --for=condition=complete job/migrate-engine --timeout=300s >/dev/null
ok "schema da api e do engine migrados"


info "esperando os workloads ficarem Ready"
kubectl -n brabo rollout status deployment/api --timeout=300s >/dev/null
kubectl -n brabo rollout status deployment/engine --timeout=300s >/dev/null
kubectl -n brabo rollout status deployment/web --timeout=300s >/dev/null
kubectl -n brabo rollout status deployment/s3-local --timeout=300s >/dev/null
ok "api, engine, web e o S3 local Ready"

# O seed roda DEPOIS dos rollouts, e não antes: o último passo dele ativa uma
# sessão, o que faz a api chamar o engine por HTTP. Rodando antes, aquele passo
# morria com ECONNREFUSED em engine:4000 — o usuário já estava criado, mas o
# pod terminava em erro.
# Sem IdP externo não existe mais credencial pronta para o smoke. O seed cria
# um usuário com senha conhecida e e-mail já verificado; ele recusa rodar com
# NODE_ENV=production (ver apps/api/src/scripts/provisionar-usuario.ts).
info "provisionando o usuário do smoke"
API_IMAGE="$(kubectl -n brabo get deployment/api -o jsonpath='{.spec.template.spec.containers[0].image}')"

# TRÊS defeitos empilhados neste pod, todos aparecendo só lá na frente como um
# "login 401", e todos escondidos pelo `wait` errado no fim deste bloco:
#
# 1. o caminho do seed é `db/seed.js`, não `dist/db/seed.js`. A imagem de
#    produção copia `apps/api/dist` para a RAIZ do WORKDIR
#    (`COPY --from=build /repo/apps/api/dist ./`), e é por isso que o `CMD` da
#    imagem é `node main.js` e não `node dist/main.js`.
# 2. o ConfigMap tem sufixo de hash — ver abaixo.
# 3. `BRABO_FORCE_SEED=1`. A imagem roda com `NODE_ENV=production`, e o seed
#    RECUSA criar conta com senha conhecida nesse modo — a guarda está descrita
#    no comentário acima desde que este bloco foi escrito, e mesmo assim a
#    variável nunca foi passada. Aqui ela é legítima: este cluster existe para
#    o smoke, e a conta é justamente o que ele precisa.
#
# O NOME REAL do ConfigMap, lido do Deployment da api em vez de hardcoded.
# O `configMapGenerator` do Kustomize acrescenta um sufixo de hash
# (`brabo-config-4tchmmt6bk`), que é justamente o que faz um pod ser
# recriado quando a configuração muda. Este pod pedia `brabo-config` puro, que
# não existe: ele ficava em `CreateContainerConfigError`, o usuário do smoke
# NUNCA era criado, e o login respondia 401 — sintoma que é fácil confundir
# com a api quebrada.
CONFIG_MAP="$(kubectl -n brabo get deployment/api \
  -o jsonpath='{.spec.template.spec.containers[0].envFrom[?(@.configMapRef)].configMapRef.name}')"
[[ -n "${CONFIG_MAP}" ]] || die "não achei o ConfigMap referenciado pelo Deployment da api"

kubectl -n brabo delete pod seed-smoke --ignore-not-found >/dev/null 2>&1 || true
# 4. o LABEL. `kubectl run` marca o pod com `run=seed-smoke`, e a política
#    `allow-db-egress` libera 5432 só para
#    `app.kubernetes.io/name in [api, engine, migrate-api, ...]`. Sem o rótulo,
#    o `default-deny` da linha de base bloqueia a saída e o seed morre com
#    ECONNREFUSED no Postgres. `migrate-api` é a classe certa: mesma imagem,
#    mesmo papel de job efêmero da api contra o banco. Rotular aqui é melhor do
#    que acrescentar `seed-smoke` à política, que afrouxaria também produção
#    por causa de um pod que só existe no cluster local.
kubectl -n brabo run seed-smoke --restart=Never --image="${API_IMAGE}" \
  --labels="app.kubernetes.io/name=migrate-api" \
  --env="BRABO_SEED_PASSWORD=${BRABO_SMOKE_PASSWORD:-brabo12345678}" \
  --overrides="{\"spec\":{\"containers\":[{\"name\":\"seed-smoke\",\"image\":\"${API_IMAGE}\",\"command\":[\"node\",\"db/seed.js\"],\"envFrom\":[{\"secretRef\":{\"name\":\"brabo-secrets\"}},{\"configMapRef\":{\"name\":\"${CONFIG_MAP}\"}}],\"env\":[{\"name\":\"BRABO_SEED_PASSWORD\",\"value\":\"${BRABO_SMOKE_PASSWORD:-brabo12345678}\"},{\"name\":\"BRABO_FORCE_SEED\",\"value\":\"1\"}]}]}}" \
  >/dev/null 2>&1 || true

# O que importa é o RESULTADO, não o processo: o smoke precisa conseguir logar.
#
# Verificar o login em vez do status do pod resolve dois problemas de uma vez.
# O primeiro é o que estava quebrado: `wait --for=condition=Ready=false` é
# satisfeito por um pod que NUNCA rodou, e foi isso que deixou o bootstrap
# anunciar "usuário do smoke pronto" com o seed em CreateContainerConfigError.
#
# O segundo foi o motivo de este bloco ter nascido tolerante: o seed JÁ FOI
# não-idempotente — a segunda execução morria em `workspaces_slug_unique`, o
# que acontecia sempre que se reaproveitava um cluster com
# BRABO_KEEP_CLUSTER=1. Hoje ele É idempotente (`apps/api/src/db/seed.ts`
# reaproveita workspace, projeto e sessão; ver a convenção no CLAUDE.md), então
# num cluster reaproveitado o pod também termina `Succeeded`. Um pod em `Error`
# deixou de ser o desfecho esperado do reaproveitamento e passou a ser defeito
# do seed — e continua sendo o login, logo abaixo, quem decide (AT-212).
#
# AT-176: este wait durava SEMPRE 3m00s (9 execuções medidas) — a assinatura do
# `--timeout=180s` estourando, não de trabalho. A hipótese (o seed não chama
# `process.exit` e o processo fica de pé) NÃO foi confirmada: localmente o seed
# termina sozinho, exit 0, em ~2s. Duas coisas ficam então registradas na saída,
# para a próxima rodada dizer o que houve em vez de a fase ser só um número:
# quanto o wait levou e, quando ele NÃO devolveu `Succeeded`, o estado do pod
# (fase, estado do contêiner, instantes) e o fim do log. O que separa as
# hipóteses é a linha `Seed concluído.` no log: com ela e o pod ainda `Running`,
# o processo ficou de pé depois do seed; sem ela, o seed ainda estava
# bloqueado numa dependência (candidata medida: o GraphStore espera ~90s por um
# Neo4j que a NetworkPolicy não deixa o pod `migrate-api` alcançar — o ingress
# do `neo4j` só admite `api` e `engine`).
#
# O `|| true` FICA, e por um motivo que não é esconder a falha: o `wait` não é
# o veredito. Quem decide se o seed deu certo é o login logo abaixo — que morre
# com `die` —, e este bloco DIZ o que viu (duração, fase, fim do log) em vez de
# calar.
seed_wait_inicio="${SECONDS}"
seed_wait_rc=0
kubectl -n brabo wait --for=jsonpath='{.status.phase}'=Succeeded \
  pod/seed-smoke --timeout=180s >/dev/null 2>&1 || seed_wait_rc=$?
seed_wait_dur=$((SECONDS - seed_wait_inicio))
if [[ "${seed_wait_rc}" == "0" ]]; then
  ok "seed-smoke: Succeeded em ${seed_wait_dur}s"
else
  warn "seed-smoke: o wait saiu com código ${seed_wait_rc} após ${seed_wait_dur}s às $(date -u +%H:%M:%SZ) (não foi Succeeded)"
  kubectl -n brabo get pod/seed-smoke \
    -o jsonpath='  fase={.status.phase} inicio={.status.startTime} contêiner={.status.containerStatuses[0].state}{"\n"}' 2>&1 || true
  echo "  --- fim do log do seed-smoke ---"
  kubectl -n brabo logs pod/seed-smoke --tail=15 2>&1 | sed 's/^/  /' || true
  echo "  --- fim ---"
fi

seed_login_ok=0
for _ in $(seq 1 10); do
  if curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
      -H 'Content-Type: application/json' \
      -d "{\"email\":\"${SMOKE_USER:-owner@brabo.dev}\",\"senha\":\"${BRABO_SMOKE_PASSWORD:-brabo12345678}\"}" \
      "http://localhost:3000/auth/login" 2>/dev/null | grep -q '^200$'; then
    seed_login_ok=1
    break
  fi
  sleep 3
done

if [[ "${seed_login_ok}" != "1" ]]; then
  kubectl -n brabo logs pod/seed-smoke --tail=30 2>&1 || true
  die "o usuário do smoke não consegue logar — o seed não completou"
fi
# Some com o pod depois de verificar. Ele é one-shot, e um `seed-smoke` em
# Error deixado para trás reprova o passo 1 do smoke ("pods fora de
# Running/Completed") — que é justamente o caso normal de reexecutar o
# bootstrap num cluster reaproveitado, com o seed morrendo por não ser
# idempotente.
kubectl -n brabo delete pod seed-smoke --ignore-not-found >/dev/null 2>&1 || true
ok "usuário do smoke pronto (login verificado)"

# --- bucket de backup ------------------------------------------------------
# Criado aqui e não por um Job no overlay: é setup de ambiente local, roda uma
# vez e precisa ser idempotente. Criar o bucket num pod efêmero é
# mais simples de depurar do que um Job que fica no histórico do cluster.
#
# O pod herda as credenciais do MESMO Secret que o backup usa — se divergirem,
# o bucket é criado com uma chave e o CronJob autentica com outra.
#
# A espera não é zelo excessivo. "Pod Ready" e "ClusterIP roteando" são coisas
# diferentes: entre o kubelet marcar o pod pronto e o kube-proxy programar a
# regra do Service existe uma janela em que o ClusterIP responde `connection
# refused` (REJECT, porque o Service não tem backend ainda). Sem esperar o
# EndpointSlice, a criação do bucket falhava aqui — e a mensagem do cliente S3
# fala em credencial, que manda quem investiga procurar chave errada em vez de
# corrida de rede.
info "criando o bucket de backup no S3 local"

for _ in $(seq 1 30); do
  if [[ -n "$(kubectl -n brabo get endpoints s3-local -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null)" ]]; then
    break
  fi
  sleep 2
done

criar_bucket() {
  # A retentativa fica DENTRO do pod, não recriando pods.
  #
  # A janela de indisponibilidade é por pod: o k3s programa as regras de
  # NetworkPolicy depois de o pod ganhar IP, e quem fala na primeira instrução
  # leva `connection refused`. Recriar o pod recria a janela — foi assim que
  # seis tentativas seguidas falharam igual. Esperar de dentro do mesmo
  # container resolve na segunda, que é exatamente o que o backup.sh já faz.
  #
  # Nome único por tentativa mesmo assim: com `--rm` a remoção é assíncrona, e
  # reusar o nome faz a chamada seguinte falhar com "already exists" — um erro
  # que se disfarça de falha de conexão no log.
  kubectl -n brabo run "s3-mb-$$-${1}" \
    --rm --attach --restart=Never --quiet \
    --image=brabo-backup:prod \
    --image-pull-policy=IfNotPresent \
    --overrides='{
      "spec": {
        "securityContext": {"runAsNonRoot": true, "runAsUser": 70, "runAsGroup": 70},
        "containers": [{
          "name": "mb",
          "image": "brabo-backup:prod",
          "imagePullPolicy": "IfNotPresent",
          "command": ["sh","-c","export AWS_ACCESS_KEY_ID=\"$BACKUP_S3_ACCESS_KEY\" AWS_SECRET_ACCESS_KEY=\"$BACKUP_S3_SECRET_KEY\" AWS_ENDPOINT_URL=\"$BACKUP_S3_ENDPOINT\" AWS_DEFAULT_REGION=us-east-1; for i in 1 2 3 4 5 6 7 8 9 10; do aws s3 ls \"s3://$BACKUP_S3_BUCKET\" >/dev/null 2>&1 && exit 0; aws s3 mb \"s3://$BACKUP_S3_BUCKET\" 2>&1 && exit 0; echo \"destino indisponível (tentativa $i)\"; sleep 3; done; exit 1"],
          "envFrom": [{"secretRef": {"name": "brabo-secrets"}}],
          "volumeMounts": [{"name": "tmp", "mountPath": "/tmp"}]
        }],
        "volumes": [{"name": "tmp", "emptyDir": {}}],
        "metadata": {"labels": {"app.kubernetes.io/name": "brabo-backup"}}
      },
      "metadata": {"labels": {"app.kubernetes.io/name": "brabo-backup"}}
    }' 2>&1
}

bucket_criado=0
for tentativa in 1 2 3 4 5 6; do
  if saida_mb="$(criar_bucket "${tentativa}")"; then bucket_criado=1; break; fi
  [[ ${tentativa} -lt 6 ]] && sleep 5
done

# `die` e não `warn`: sem bucket o backup falha em toda execução, e o
# `make test-restore` reprova logo depois. Reportar "ok" aqui e falhar dez
# minutos adiante é o pior dos dois mundos.
[[ ${bucket_criado} -eq 1 ]] || die "não foi possível criar o bucket de backup: ${saida_mb:-sem saída}"
ok "bucket de backup pronto"

if [[ "${BRABO_SKIP_OBSERVABILITY:-}" == "1" ]]; then
  printf '\n\033[32m[bootstrap] cluster pronto\033[0m — web em http://localhost:8088 (sem Grafana: BRABO_SKIP_OBSERVABILITY=1)\n'
else
  printf '\n\033[32m[bootstrap] cluster pronto\033[0m — web em http://localhost:8088, Grafana em http://localhost:3001\n'
fi
