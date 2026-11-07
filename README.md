# brabo-infra

O que SOBE o Brabo: composes (dev, produção, instalação, observabilidade, GPU), Kubernetes
(`deploy/k8s`), backup/restore, o `docker-bake.hcl`, o `Makefile`, os scripts de ambiente
(`scripts/dev`), as aferições CRUZADAS entre repositórios (`scripts/ci`) e a doc da área
(`deploy/docs`). Extraído do monorepo original do Brabo (EP-033, AT-701, ADR 0252).

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
é a prova da AT-707. A primeira rodada (05/11/2026, `make dev`) parou no broker; a correção (AT-737)
já está na `dev` do `brabo-broker`, e a rodada com os seis serviços saudáveis ainda não foi registrada.

Para `docker buildx bake` com os irmãos: `docker buildx bake --allow=fs.read=.. -f docker-bake.hcl`.

### Token do GitHub Packages (AT-770)

api, web e broker instalam `@viralabs-dev/brabo-shared` e `@viralabs-dev/brabo-docker-port` (pacotes públicos, mas o
registry pede token até para instalar). O token é um PAT classic só com `read:packages`, numa linha do `~/.npmrc` do host:

```text
//npm.pkg.github.com/:_authToken=<PAT>
```

- **Dev (`make dev`, `bootstrap.sh`)**: o compose monta o `~/.npmrc` como secret nos serviços que rodam `pnpm install` (`api`, `web`) e no build do `broker`. `NPMRC=<arquivo>` aponta para outro arquivo. O `bootstrap.sh` avisa, sem ecoar valor, se a linha não existe.
- **Build de imagem (bake, compose prod, `deploy/k8s/bootstrap.sh`)**: o mesmo arquivo entra como secret do BuildKit (`id=npmrc`), nunca como `ARG`/`ENV` nem em camada (RN-1039). Sem ele o build recusa.
- **CI**: o passo `.github/actions/npmrc` grava um `.npmrc` temporário com o `GITHUB_TOKEN` (job com `packages: read`) e exporta `NPMRC`.
- A ref do `brabo-contracts` nos clones irmãos (`.github/actions/irmaos`) é a `v1.2.0`; o check `contracts-alinhado` do `brabo-ci` a confere.

## O que não vem para cá

`install.sh`, os assets `brabo-install-*`, os workflows de release do produto e o
`.release/` ficam no `brabo`; os testes `install-*.spec.ts` foram com o instalador.
Política de PR e reutilizáveis: [`brabo-ci`](https://github.com/viralabs-dev/brabo-ci).

## Repositórios do Brabo

O Brabo é dividido em repositórios por camada (ADR 0252), e a documentação central está no
[brabo](https://github.com/viralabs-dev/brabo) e em https://viralabs-dev.github.io/brabo/prd/.

**Depende de:** [brabo-ci](https://github.com/viralabs-dev/brabo-ci), [brabo-api](https://github.com/viralabs-dev/brabo-api), [brabo-engine](https://github.com/viralabs-dev/brabo-engine), [brabo-web](https://github.com/viralabs-dev/brabo-web), [brabo-runner](https://github.com/viralabs-dev/brabo-runner), [brabo-broker](https://github.com/viralabs-dev/brabo-broker), [brabo-contracts](https://github.com/viralabs-dev/brabo-contracts), [brabo](https://github.com/viralabs-dev/brabo)
(os irmãos pela action `.github/actions/irmaos`; a política de PR pelo `brabo-ci`).

**É usado por:** [brabo](https://github.com/viralabs-dev/brabo) (o instalador usa os composes daqui), [brabo-qa](https://github.com/viralabs-dev/brabo-qa) e [brabo-api](https://github.com/viralabs-dev/brabo-api).

| Repositório | Papel |
| --- | --- |
| [brabo](https://github.com/viralabs-dev/brabo) | Porta de entrada: documentação central, instalador (`install.sh`) e release do produto. |
| [brabo-api](https://github.com/viralabs-dev/brabo-api) | API (NestJS, Drizzle, PostgreSQL com pgvector). |
| [brabo-engine](https://github.com/viralabs-dev/brabo-engine) | Engine (Elixir/OTP, Phoenix, Oban): agentes, gates, sessões e runners. |
| [brabo-web](https://github.com/viralabs-dev/brabo-web) | Interface web (React, Vite, TanStack, Tailwind). |
| [brabo-runner](https://github.com/viralabs-dev/brabo-runner) | CLI que roda na máquina do usuário e se conecta à engine. |
| [brabo-broker](https://github.com/viralabs-dev/brabo-broker) | Broker de containers: o único processo que fala com o Docker do servidor. |
| [brabo-contracts](https://github.com/viralabs-dev/brabo-contracts) | Contratos compartilhados (`shared`, `docker-port`, `contracts`). |
| [brabo-infra](https://github.com/viralabs-dev/brabo-infra) | Composes, Kubernetes, backup e restore, `docker-bake.hcl` e as aferições cruzadas. |
| [brabo-ci](https://github.com/viralabs-dev/brabo-ci) | Workflows reutilizáveis: política de PR, escada de aprovação, promoção e carimbo de versão. |
| [brabo-qa](https://github.com/viralabs-dev/brabo-qa) | Testes entre repositórios: E2E de navegador, golden-sets e instrumentos de medição. |
| [brabo-workspace](https://github.com/viralabs-dev/brabo-workspace) | Pasta-mãe que reúne os clones `brabo-*` lado a lado. |

## Apoie

Se o projeto te ajuda, você pode [pagar um café no Ko-fi](https://ko-fi.com/daneiel).
