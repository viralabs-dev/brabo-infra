# Local Kubernetes deploy targets (Phase 5).
#
# The rest of day-to-day work stays in `pnpm` (see package.json): this
# Makefile exists for what isn't JavaScript nor Elixir — bringing up the
# cluster, applying manifests, validating. Doesn't duplicate package.json
# on purpose.
.PHONY: help deploy-local deploy-local-clean smoke-k8s hpa-test rollout-test test-restore k8s-validate k8s-logs k8s-down

SHELL := /usr/bin/env bash
K8S := deploy/k8s
NS ?= brabo

help: ## Lists the available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# TAG=vX.Y.Z-qa.N validates a pipeline tag instead of the working tree. There
# is no automatic deploy: this is how you look at what the tag stamped.
deploy-local: ## Brings up the local cluster, installs everything and runs the smoke test (TAG=vX.Y.Z-qa.N optional)
	@TAG=$(TAG) bash $(K8S)/bootstrap.sh
	@bash $(K8S)/smoke.sh

deploy-local-clean: ## Same as deploy-local, but without rebuilding the images
	@BRABO_SKIP_BUILD=1 bash $(K8S)/bootstrap.sh
	@bash $(K8S)/smoke.sh

smoke-k8s: ## Runs only the smoke test against the cluster already up
	@bash $(K8S)/smoke.sh

hpa-test: ## Fills the Oban queue and proves the engine's HPA scales
	@bash $(K8S)/hpa-test.sh

rollout-test: ## Opens active sessions, does a rollout restart and proves none is orphaned
	@bash $(K8S)/rollout-test.sh

test-restore: ## Triggers a real backup, restores it into a new database and validates it
	@bash $(K8S)/test-restore.sh

k8s-validate: ## Renders the overlays and validates them against the Kubernetes schema
	@bash $(K8S)/validate.sh

k8s-logs: ## Last lines from each workload
	@for app in api engine web; do \
		echo "=== $$app ==="; \
		kubectl -n $(NS) logs -l app.kubernetes.io/name=$$app --tail=40 --prefix || true; \
	done

k8s-down: ## Removes the local cluster
	@if k3d cluster list 2>/dev/null | grep -q '^brabo\b'; then k3d cluster delete brabo; \
	elif kind get clusters 2>/dev/null | grep -qx brabo; then kind delete cluster --name brabo; \
	else echo "no local cluster named 'brabo'"; fi
