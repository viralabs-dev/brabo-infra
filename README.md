# brabo-infra

What RUNS Brabo: composes (dev, production, installation, observability, GPU), Kubernetes
(`deploy/k8s`), backup/restore, the `docker-bake.hcl`, the `Makefile`, the environment scripts
(`scripts/dev`), the CROSS-repository checks (`scripts/ci`) and the area's docs
(`deploy/docs`). Extracted from the `daneiel/brabo` monorepo (EP-033, AT-701, ADR 0252).

The product's entry point (documentation, `install.sh`, Release) is the
[`brabo`](https://github.com/viralabs-dev/brabo) repository; this one does not install or publish the product.

## Sibling clones

The Dockerfiles live in the apps' repositories (`brabo-api`, `brabo-engine`, `brabo-web`,
`brabo-broker`; the backup one lives here). The composes build with the context in the SIBLING
CLONES, in this repository's parent folder (the one of [`brabo-workspace`](https://github.com/viralabs-dev/brabo-workspace)):

```text
~/dev/brabo/
  brabo-infra/   <- você está aqui
  brabo-api/  brabo-engine/  brabo-web/  brabo-runner/  brabo-broker/  brabo-contracts/  brabo/
```

`BRABO_IRMAOS` changes the parent folder (default `..` from this repository; in the composes, relative to
`docker/`, the default is `../..`).

```sh
make dev                                             # preflight (irmãos + pontos de montagem) + compose up
docker compose -f docker/docker-compose.yml config   # resolve contextos e volumes
make k8s-validate                                    # kustomize + kubeconform nos overlays
pnpm install && pnpm typecheck && pnpm test          # aferições (leem os irmãos)
```

Bringing up the six services from the siblings (`docker compose -f docker/docker-compose.yml up -d --wait`)
is the proof for AT-707, and it was not done here (see CHANGELOG).

For `docker buildx bake` with the siblings: `docker buildx bake --allow=fs.read=.. -f docker-bake.hcl`.

## What does not come here

`install.sh`, the `brabo-install-*` assets, the product's release workflows and the
`.release/` stay in `brabo`; the `install-*.spec.ts` tests went with the installer.
PR policy and reusable workflows: [`brabo-ci`](https://github.com/viralabs-dev/brabo-ci).
