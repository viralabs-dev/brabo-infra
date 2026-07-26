#!/usr/bin/env bash
# Valida os manifests sem precisar de cluster (rodado por `make k8s-validate` e
# pelo job `manifests` do CI).
#
# Dois níveis, porque pegam coisas diferentes:
#
# 1. `kustomize build` — pega erro de estrutura: patch sem alvo, conflito de
#    ID, referência a arquivo que não existe.
# 2. `kubeconform` — pega erro de CONTEÚDO contra o schema do Kubernetes:
#    campo com nome errado, tipo errado, apiVersion inexistente. É o que separa
#    "o YAML monta" de "a API aceitaria".
#
# CRDs de terceiros (ExternalSecret, SecretStore, Cluster do CloudNativePG) não
# estão no schema oficial; são ignorados por nome, e não com
# `--ignore-missing-schemas` global, que silenciaria também os nossos erros.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
K8S_DIR="${REPO_ROOT}/deploy/k8s"
KUBE_VERSION="${KUBE_VERSION:-1.31.0}"

OVERLAYS=(
  "base"
  "overlays/local"
  "overlays/local/db"
  "overlays/staging"
  "overlays/prod"
)

SKIP_KINDS="ExternalSecret,SecretStore,ClusterSecretStore,Cluster"

info() { printf '\n\033[1m[validate]\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }
die()  { printf '\n\033[31m[validate] %s\033[0m\n' "$*" >&2; exit 1; }

command -v kustomize >/dev/null 2>&1 || die "kustomize não encontrado no PATH"
HAVE_KUBECONFORM=0
command -v kubeconform >/dev/null 2>&1 && HAVE_KUBECONFORM=1

info "montando os overlays"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

for overlay in "${OVERLAYS[@]}"; do
  out="${tmp}/$(echo "${overlay}" | tr '/' '_').yaml"
  kustomize build "${K8S_DIR}/${overlay}" > "${out}" 2>"${tmp}/err" \
    || { cat "${tmp}/err" >&2; die "kustomize build falhou em ${overlay}"; }
  ok "${overlay} monta ($(grep -c '^kind:' "${out}") recursos)"
done

if (( HAVE_KUBECONFORM == 0 )); then
  printf '\n\033[33m[validate] kubeconform ausente — só a montagem foi verificada.\033[0m\n'
  printf 'Instale com: go install github.com/yannh/kubeconform/cmd/kubeconform@latest\n'
  exit 0
fi

info "validando contra o schema do Kubernetes ${KUBE_VERSION}"
for overlay in "${OVERLAYS[@]}"; do
  out="${tmp}/$(echo "${overlay}" | tr '/' '_').yaml"
  kubeconform \
    -kubernetes-version "${KUBE_VERSION}" \
    -strict \
    -skip "${SKIP_KINDS}" \
    -summary \
    "${out}" || die "kubeconform reprovou ${overlay}"
  ok "${overlay} válido"
done

printf '\n\033[32m[validate] manifests ok\033[0m\n'
