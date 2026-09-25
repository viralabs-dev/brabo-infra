# Local Kubernetes deploy targets (Phase 5).
#
# The rest of day-to-day work stays in `pnpm` (see package.json): this
# Makefile exists for what isn't JavaScript nor Elixir — bringing up the
# cluster, applying manifests, validating. Doesn't duplicate package.json
# on purpose.
.PHONY: help deploy-local deploy-local-clean smoke-k8s hpa-test rollout-test test-restore test-restore-mutacao test-restore-compose test-reprojecao test-reprojecao-k8s k8s-validate k8s-logs k8s-down imagens-do-release

SHELL := /usr/bin/env bash
K8S := deploy/k8s
NS ?= brabo
# Which overlay `imagens-do-release` writes to. `prod` by default because that
# is the one the digest exists for: staging is fed by the same release.
OVERLAY ?= prod

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

# Writes the DIGESTS a release published into an overlay, reading
# `.release/images.json` (ADR 0119). The file ships as an asset of every final
# release: `gh release download vX.Y.Z --pattern images.json --dir .release`.
# The repository keeps the REPLACE_WITH_DIGEST marker, not a frozen release —
# what is deployed is decided at deploy time, not by the tag.
imagens-do-release: ## Applies the digests from .release/images.json to an overlay (OVERLAY=prod|staging)
	@node scripts/ci/aplicar-imagens.ts .release/images.json $(K8S)/overlays/$(OVERLAY)

smoke-k8s: ## Runs only the smoke test against the cluster already up
	@bash $(K8S)/smoke.sh

hpa-test: ## Fills the Oban queue and proves the engine's HPA scales
	@bash $(K8S)/hpa-test.sh

rollout-test: ## Opens active sessions, does a rollout restart and proves none is orphaned
	@bash $(K8S)/rollout-test.sh

test-restore: ## Triggers a real backup, restores it into a new database and validates it
	@bash $(K8S)/test-restore.sh

# The proof of the proof (AT-126, BRB-009): a deliberate break of the restore
# (the source gets a table the dump does not have) must be CAUGHT. Exits 0 only
# if the restore REJECTS it and names the missing table; exits 1 if the restore
# approves it. Independent of `test-restore`, which stays unchanged.
test-restore-mutacao: ## Breaks the restore on purpose (dump without a table) and requires the proof to catch it
	@RESTORE_MUTACAO=tabela-faltando bash $(K8S)/test-restore.sh

# The same proof for an installation that has no cluster (ADR 0152). Kept as a
# SEPARATE target on purpose: unifying it with the one above would make the
# compose path depend on `kubectl`. The judgement is not duplicated — both run
# the same `brabo-restore` with the same three validations.
test-restore-compose: ## Same proof as test-restore, against docker compose (no cluster); BRABO_ENV_FILE passes the installation .env
	@bash docker/backup/test-restore-compose.sh

# The graph is not backed up (ADR 0152, decision 4): it is REPROJECTED from the
# event log. This proves the command against a real Neo4j — wipe the scenario's
# subgraph, reproject, compare node and edge counts, reproject again. It does NOT
# depend on a backup having happened, on purpose (RN-569).
test-reprojecao: ## Wipes a graph scenario, reprojects it from the event log and compares counts (needs Neo4j up)
	@pnpm --filter api test -- test/scripts/reprojetar-grafo.spec.ts

# The same proof, one environment up (AT-127): against the local cluster, with the
# image's own `node scripts/reprojetar-grafo.js` over the cluster's Postgres and
# Neo4j. Its own scenario, its own project — it depends on no other target, and in
# particular not on `test-restore`.
test-reprojecao-k8s: ## Same proof as test-reprojecao, inside the local cluster (needs `make deploy-local` first)
	@bash $(K8S)/test-reprojecao.sh

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
