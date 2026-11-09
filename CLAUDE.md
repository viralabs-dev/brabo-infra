# brabo-infra — o que sobe o Brabo

Composes, Kubernetes, backup, observabilidade, `docker-bake.hcl`, `Makefile`, `scripts/dev`, as
aferições cruzadas (`scripts/ci`) e `deploy/docs`. Extraído do monorepo (EP-033, AT-701, ADR 0252).
O produto (docs, `install.sh`, Release) é o repo `brabo`; a política de PR é o `brabo-ci`; os
Dockerfiles dos apps moram nos repos dos apps.

Regras de CAMINHO (carregadas ao ler a área): `.claude/rules/broker-e-containers.md` (broker, `DockerPort`,
ciclo de vida do container) e `.claude/rules/ci-e-cadeia-de-suprimentos.md` (pin por SHA/digest,
assinatura, Trivy). Os caminhos que elas citam (`apps/api/...`) são os do monorepo.

## Clones irmãos
- O `~/.npmrc` (ou `NPMRC`) com o token `read:packages` do GitHub Packages entra nos builds de api, web e broker só como secret do BuildKit, nunca como ARG/ENV nem em camada (RN-1039, `token-do-registry.spec.ts`).
- Os composes e o bake constroem com contexto em `${BRABO_IRMAOS:-../..}/brabo-<app>` (relativo a
  `docker/`); `scripts/ci/irmaos.ts` traduz os caminhos canônicos do monorepo (`apps/engine/...`) para
  o irmão e lê por `BRABO_IRMAOS` (padrão `..` a partir da raiz deste repo). Aferição cruzada nova lê
  por ali, nunca por `RAIZ/apps/...`. No CI os irmãos são checkout na `dev` (`.github/actions/irmaos`).
- Docker não roda aqui no CI de PR: valida-se `docker compose config` (`scripts/ci/composes-resolvem.sh`)
  e `make k8s-validate`. Subir os seis serviços é prova da AT-707.

## Convenções (compose, volumes e reset) — herdadas do monorepo
- Volume nomeado nasce com o dono do caminho que existir NA IMAGEM; caminho inexistente nasce `root`.
  Volume novo exige o diretório criado e `chown`-ado na imagem do app ANTES do `USER`; esquecer não dá
  erro de build, dá 403 em runtime. Volume já criado mantém o dono antigo (`docker volume rm`).
- `docker compose up --wait` só prova o que tem `healthcheck`. Serviço novo nasce com o dele (`/health`
  na api e no engine, `/` no Vite do web), com `start_period` generoso em dev.
- Script que apaga o banco para antes `api` e `engine` (nenhum a mais): `DROP SCHEMA` embaixo deles os
  mata. Script que AFIRMA estado pergunta antes (`/health` dos três, `ps`) e sai nomeando o passo que
  falhou. O reset NÃO remove volume; `reset-total.spec.ts` reprova linha que apague volume. Pré-requisito
  de host novo entra em `reset-total-lib.sh`, antes do `stop`.
- O compose de DEV é o projeto `brabo-dev`; o de INSTALAÇÃO é `brabo` (ADR 0170). Não renomeie o de
  instalação nem volte o de dev a `brabo`. `preflight.mjs` e `reset-total.sh` RECUSAM se há container do
  compose de instalação na máquina. Prova de guarda se faz em projeto DESCARTÁVEL (`-p <nome>`).
- `WEB_ORIGIN` deriva de `WEB_PORT` nos composes (ADR 0037): o CI reprova a divergência.
- As flags booleanas do `runtime.exs` do engine estão nos TRÊS composes (`flags-do-engine-no-compose.spec.ts`
  deriva a lista); não "uniformize" produção e instalação (as chaves de boot divergem de propósito).
- `/data/git-repos` e `/data/project-workspaces` são criados na imagem do api/engine; bind-mount do host é
  criado como root pelo Docker (quem o cria antes é o `preflight.mjs`).
- Arquivo que outro programa parseia se prova contra o parser dele (systemd, Compose), nunca contra
  string. O `.env` do instalador é conferido por `docker compose config` (`prova-de-restauracao-env.spec.ts`).
- Imagem de terceiro por digest com a tag inline; `uses:` preso a SHA com `# vX`; Dependabot de
  linguagem só segurança (`open-pull-requests-limit: 0`), `docker` com `ignore: brabo-*`.
- Regressivo por funcionalidade (AT-769): PR que toca uma funcionalidade do catálogo (`brabo-qa/funcionalidades.yml`, mapa por caminho) ajusta o regressivo dela no `brabo-qa` contra a `dev`, ou diz no card por que não precisa. Na PR para a `dev` o check `Regressivo do brabo-qa` só atesta (nunca obrigatório); na PR para a `main` o `E2E do brabo-qa` roda o catálogo inteiro e bloqueia, salvo `/qa-aceitar`.

## O que NÃO fazer
- Não subir broker/compose com socket do Docker em produção sem a contenção do ADR 0189.
- Não mover `install.sh` nem a release do produto para cá (são do `brabo`).
- Não deixar aferição cruzada passar sobre o vazio: irmão ausente PULA nomeando o motivo ou reprova;
  nunca verde por não ter lido nada.
- Branches: `dev` e `main`; trabalho nasce de `dev` (`feature/…`, `bugfix/…`); commits em conventional commits, pt-BR.
