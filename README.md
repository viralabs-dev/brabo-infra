# brabo-infra

O que SOBE o Brabo: composes (dev, produção, instalação, observabilidade, GPU), Kubernetes
(`deploy/k8s`), backup/restore, o `docker-bake.hcl`, o `Makefile`, os scripts de ambiente
(`scripts/dev`), as aferições CRUZADAS entre repositórios (`scripts/ci`) e a doc da área
(`deploy/docs`). Extraído do monorepo `daneiel/brabo` (EP-033, AT-701, ADR 0252).

A porta de entrada do produto (documentação, `install.sh`, Release) é o repositório
[`brabo`](https://github.com/viralabs-dev/brabo); este aqui não instala nem publica o produto.

## Clones irmãos

Os Dockerfiles moram nos repositórios dos apps (`brabo-api`, `brabo-engine`, `brabo-web`,
`brabo-broker`; o do backup fica aqui). Os composes constroem com o contexto nos CLONES
IRMÃOS, na pasta-mãe deste (a do [`brabo-workspace`](https://github.com/viralabs-dev/brabo-workspace)):

```text
~/dev/brabo/
  brabo-infra/   <- você está aqui
  brabo-api/  brabo-engine/  brabo-web/  brabo-runner/  brabo-broker/  brabo-contracts/  brabo/
```

`BRABO_IRMAOS` muda a pasta-mãe (padrão `..` a partir deste repositório; nos composes, relativo a
`docker/`, o padrão é `../..`).

```sh
make dev                                             # preflight (irmãos + pontos de montagem) + compose up
docker compose -f docker/docker-compose.yml config   # resolve contextos e volumes
make k8s-validate                                    # kustomize + kubeconform nos overlays
pnpm install && pnpm typecheck && pnpm test          # aferições (leem os irmãos)
```

Subir os seis serviços a partir dos irmãos (`docker compose -f docker/docker-compose.yml up -d --wait`)
é a prova da AT-707, e não foi feita aqui (ver CHANGELOG).

Para `docker buildx bake` com os irmãos: `docker buildx bake --allow=fs.read=.. -f docker-bake.hcl`.

## O que não vem para cá

`install.sh`, os assets `brabo-install-*`, os workflows de release do produto e o
`.release/` ficam no `brabo`; os testes `install-*.spec.ts` foram com o instalador.
Política de PR e reutilizáveis: [`brabo-ci`](https://github.com/viralabs-dev/brabo-ci).
