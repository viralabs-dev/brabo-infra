# Alvos de deploy local em Kubernetes (Fase 5).
#
# O resto do dia a dia continua em `pnpm` (ver package.json): este Makefile
# existe para o que não é JavaScript nem Elixir — subir cluster, aplicar
# manifests, validar. Não duplica nada do package.json de propósito.
.PHONY: help deploy-local deploy-local-clean smoke-k8s hpa-test rollout-test k8s-validate k8s-logs k8s-down

SHELL := /usr/bin/env bash
K8S := deploy/k8s
NS ?= brabo

help: ## Lista os alvos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

deploy-local: ## Sobe o cluster local, instala tudo e roda o smoke test
	@bash $(K8S)/bootstrap.sh
	@bash $(K8S)/smoke.sh

deploy-local-clean: ## Igual ao deploy-local, mas sem reconstruir as imagens
	@BRABO_SKIP_BUILD=1 bash $(K8S)/bootstrap.sh
	@bash $(K8S)/smoke.sh

smoke-k8s: ## Roda só o smoke contra o cluster já de pé
	@bash $(K8S)/smoke.sh

hpa-test: ## Enche a fila do Oban e prova que o HPA do engine escala
	@bash $(K8S)/hpa-test.sh

rollout-test: ## Abre sessões ativas, faz rollout restart e prova que nenhuma fica órfã
	@bash $(K8S)/rollout-test.sh

k8s-validate: ## Monta os overlays e valida contra o schema do Kubernetes
	@bash $(K8S)/validate.sh

k8s-logs: ## Últimas linhas de cada workload
	@for app in api engine web; do \
		echo "=== $$app ==="; \
		kubectl -n $(NS) logs -l app.kubernetes.io/name=$$app --tail=40 --prefix || true; \
	done

k8s-down: ## Remove o cluster local
	@if k3d cluster list 2>/dev/null | grep -q '^brabo\b'; then k3d cluster delete brabo; \
	elif kind get clusters 2>/dev/null | grep -qx brabo; then kind delete cluster --name brabo; \
	else echo "nenhum cluster local chamado 'brabo'"; fi
