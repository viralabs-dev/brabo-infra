#!/usr/bin/env bash
# Sobe um cluster local do zero e instala o Brabo inteiro (Fase 5, item 6).
#
# Uso:
#   bash deploy/k8s/bootstrap.sh                # cria cluster, instala, valida
#   BRABO_CLUSTER_TOOL=kind bash ...            # força kind (default: k3d)
#   BRABO_SKIP_BUILD=1 bash ...                 # usa as imagens já no daemon
#   BRABO_KEEP_CLUSTER=1 bash ...               # reaproveita cluster existente
#
# O que ele NÃO faz: instalar ingress controller ou mexer em DNS. Os serviços
# saem em NodePorts mapeadas para as MESMAS portas do docker-compose.prod.yml
# (3000/4000/8080/8088), o que mantém válidos o realm de desenvolvimento e os
# defaults do docker/smoke.sh, e evita depender de resolução de nome — nip.io e
# afins precisam de internet.
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
  if k3d cluster list 2>/dev/null | grep -q "^${CLUSTER_NAME}\b"; then
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
    --port "8080:30080@loadbalancer" \
    --port "8088:30088@loadbalancer" \
    --port "3001:30030@loadbalancer" \
    --k3s-arg "--disable=traefik@server:0" \
    --wait >/dev/null
  ok "cluster k3d de pé"
}

create_cluster_kind() {
  if kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"; then
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
      - { containerPort: 30080, hostPort: 8080, protocol: TCP }
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

# --- imagens ---------------------------------------------------------------
if [[ "${BRABO_SKIP_BUILD:-}" == "1" ]]; then
  info "BRABO_SKIP_BUILD=1 — usando as imagens já no daemon"
else
  info "construindo as imagens de produção"
  docker build -q -f "${REPO_ROOT}/docker/api/Dockerfile.prod"    -t brabo-api:prod    "${REPO_ROOT}" >/dev/null
  docker build -q -f "${REPO_ROOT}/docker/engine/Dockerfile.prod" -t brabo-engine:prod "${REPO_ROOT}" >/dev/null
  docker build -q -f "${REPO_ROOT}/docker/web/Dockerfile.prod"    -t brabo-web:prod    "${REPO_ROOT}" >/dev/null
  ok "três imagens construídas"
fi
docker image inspect "${BUSYBOX_IMAGE}" >/dev/null 2>&1 || docker pull -q "${BUSYBOX_IMAGE}" >/dev/null

case "${TOOL}" in
  k3d)  create_cluster_k3d ;;
  kind) create_cluster_kind ;;
  *)    die "ferramenta desconhecida: ${TOOL}" ;;
esac

for img in brabo-api:prod brabo-engine:prod brabo-web:prod; do
  load_image "${img}"
done
load_image "${BUSYBOX_IMAGE}" optional

# --- operadores ------------------------------------------------------------
info "instalando operadores (helm)"
helm repo add external-secrets "${ESO_REPO}" >/dev/null 2>&1 || true
helm repo add cnpg "${CNPG_REPO}" >/dev/null 2>&1 || true
helm repo add prometheus-community "${PROMETHEUS_REPO}" >/dev/null 2>&1 || true
helm repo add metrics-server "${METRICS_SERVER_REPO}" >/dev/null 2>&1 || true
helm repo add grafana "${GRAFANA_REPO}" >/dev/null 2>&1 || true
helm repo add open-telemetry "${OTEL_COLLECTOR_REPO}" >/dev/null 2>&1 || true
helm repo update >/dev/null

helm upgrade --install external-secrets external-secrets/external-secrets \
  --version "${ESO_CHART_VERSION}" \
  --namespace external-secrets --create-namespace \
  --set installCRDs=true --wait --timeout 5m >/dev/null
ok "External Secrets Operator"

helm upgrade --install cnpg cnpg/cloudnative-pg \
  --version "${CNPG_CHART_VERSION}" \
  --namespace cnpg-system --create-namespace --wait --timeout 5m >/dev/null
ok "CloudNativePG"

# metrics-server: sem ele o HPA da api (CPU) nunca sai de <unknown>. O k3s já
# traz o seu; instalar por cima criaria dois controladores disputando o mesmo
# APIService.
if kubectl get deploy -n kube-system metrics-server >/dev/null 2>&1; then
  ok "metrics-server já presente (k3s)"
else
  helm upgrade --install metrics-server metrics-server/metrics-server \
    --version "${METRICS_SERVER_CHART_VERSION}" \
    --namespace kube-system \
    --set 'args={--kubelet-insecure-tls}' --wait --timeout 5m >/dev/null
  ok "metrics-server"
fi

# O rótulo do namespace é o que a NetworkPolicy do engine usa para liberar o
# scrape — `kubernetes.io/metadata.name` é posto automaticamente pelo cluster,
# mas só na criação.
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f - >/dev/null

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

# --- observabilidade (Fase 5, sessão 3) ------------------------------------
# Ordem: os backends primeiro (Tempo, Loki), depois quem escreve neles
# (Collector, Alloy), e o Grafana por último — ele valida os datasources no
# boot e um datasource inalcançável só polui o log.
helm upgrade --install tempo grafana/tempo \
  --version "${TEMPO_CHART_VERSION}" --namespace monitoring \
  -f "${K8S_DIR}/helm/tempo-values.yaml" --wait --timeout 5m >/dev/null
ok "Tempo (traces)"

helm upgrade --install loki grafana/loki \
  --version "${LOKI_CHART_VERSION}" --namespace monitoring \
  -f "${K8S_DIR}/helm/loki-values.yaml" --wait --timeout 8m >/dev/null
ok "Loki (logs)"

helm upgrade --install otel-collector open-telemetry/opentelemetry-collector \
  --version "${OTEL_COLLECTOR_CHART_VERSION}" --namespace monitoring \
  -f "${K8S_DIR}/helm/otel-collector-values.yaml" --wait --timeout 5m >/dev/null
ok "OpenTelemetry Collector"

helm upgrade --install alloy grafana/alloy \
  --version "${ALLOY_CHART_VERSION}" --namespace monitoring \
  -f "${K8S_DIR}/helm/alloy-values.yaml" --wait --timeout 5m >/dev/null
ok "Alloy (coleta de logs)"

# Dashboards versionados no repositório viram ConfigMap. Cada arquivo entra com
# a chave sendo o nome do arquivo, que é o que o provider do Grafana espera.
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

kubectl -n brabo create secret generic brabo \
  --from-literal=DATABASE_URL="${DATABASE_URL}" \
  --from-literal=SECRET_KEY_BASE="$(openssl rand -hex 32)" \
  --from-literal=CREDENTIALS_MASTER_KEY="$(openssl rand -hex 32)" \
  --from-literal=GIT_OAUTH_STATE_SECRET="$(openssl rand -hex 32)" \
  --from-literal=API_KEYCLOAK_CLIENT_SECRET="$(openssl rand -hex 16)" \
  --from-literal=ENGINE_KEYCLOAK_CLIENT_SECRET="$(openssl rand -hex 16)" \
  --from-literal=RELEASE_COOKIE="$(openssl rand -hex 24)" \
  --from-literal=KEYCLOAK_ADMIN=admin \
  --from-literal=KEYCLOAK_ADMIN_PASSWORD="${BRABO_SMOKE_PASSWORD:-admin123}" \
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
kubectl -n brabo wait --for=condition=Ready externalsecret/keycloak-secrets --timeout=120s >/dev/null
ok "Secrets materializados"

info "esperando as migrações"
kubectl -n brabo wait --for=condition=complete job/migrate-api --timeout=300s >/dev/null
kubectl -n brabo wait --for=condition=complete job/migrate-engine --timeout=300s >/dev/null
ok "schema da api e do engine migrados"

info "esperando os workloads ficarem Ready"
kubectl -n brabo rollout status statefulset/keycloak --timeout=300s >/dev/null
kubectl -n brabo rollout status deployment/api --timeout=300s >/dev/null
kubectl -n brabo rollout status deployment/engine --timeout=300s >/dev/null
kubectl -n brabo rollout status deployment/web --timeout=300s >/dev/null
ok "api, engine, web e Keycloak Ready"

printf '\n\033[32m[bootstrap] cluster pronto\033[0m — web em http://localhost:8088, Grafana em http://localhost:3001\n'
