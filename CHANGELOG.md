# Changelog

## Unreleased

- `make dev` / `pnpm dev`: sobe o dev a partir da pasta-mãe dos irmãos (preflight + `compose up`).
- `preflight.mjs` confere que os repos irmãos do compose existem (recusa nomeando o que falta) e cria os pontos de volume (`node_modules`, `_build`, `deps`) DENTRO de cada irmão; `reset-total.sh` roda migrations/seed a partir de `brabo-api` e `mix ecto.migrate` em `brabo-engine` (`BRABO_IRMAOS`, padrão `..`); as recusas seguem.
- `trivy-do-release.spec.ts` religado (sem `skip`): compara com os workflows que escaneiam hoje; sem nenhum, prova o release contra a régua constante do spec. `oferta-de-fonte-na-imagem.spec.ts` voltou, lendo os Dockerfiles dos irmãos; ACHADO: o `build-runner-binaries.yml` do `brabo-runner` não anexa mais `THIRD_PARTY_NOTICES.md` (fica para o repo do runner).
- `imagens-do-compose.yml` (reutilizável) faz checkout explícito do `brabo-infra` em `infra/` no ref de `infra_ref` (o chamador passa o MESMO SHA do `uses:`); antes pegava o repo chamador. CI chama o reutilizável (`imagens`/`imagens-lidas`).

## 1.0.0

Primeira versão, extraída do monorepo `daneiel/brabo` em `1586158973` (EP-033, AT-701, ADR 0252) com o histórico dos caminhos; `#NNN` nas mensagens virou `viralabs-dev/brabo-legacy#NNN`.

- Veio: `docker/` (cinco composes, `backup/`, `ollama/`, `postgres/`, `observability/`, `smoke.sh`), `deploy/` (k8s e `deploy/docs/`), `docker-bake.hcl`, `Makefile`, `.env.example`, `.trivyignore.yaml`, `scripts/dev/` (sem os `install-*.spec.ts`) e, de `scripts/ci/`, `images-manifest`, `imagens-pinadas`, `imagens-do-compose`, `aplicar-imagens`, `trivy-do-release` e as aferições `flags-do-engine-no-compose`, `alvos-do-runner`, `marca-de-credencial-do-runner`, `previous-nos-composes`, `teto-ocioso-nos-composes`, `regua-dos-tokens-de-servico`, `smoke-gates`, `backup-lib`, `rollout-evidencia`, `alarmar-prova`; workflows `imagens-do-compose.yml` e `propriedades.yml`.
- Os composes, o `docker-bake.hcl` e o `deploy/k8s/bootstrap.sh` constroem com o contexto nos clones irmãos (`BRABO_IRMAOS`, padrão `..`), com `Dockerfile`/`Dockerfile.dev` da raiz de cada app. No compose de dev, cada serviço monta o repositório do app em `/workspace` e só `node_modules` é volume; o broker de dev não tem bind mount (a imagem copia o código). Voltaram os volumes `engine_build`/`engine_deps` em `/workspace/{_build,deps}`.
- As aferições cruzadas leem os irmãos por `scripts/ci/irmaos.ts` (os caminhos citados nos testes seguem os do monorepo, traduzidos ali). Sem o irmão `brabo`, pulam o que lê `install.sh`/`release.yml`.
- CI próprio: política de PR (`brabo-ci@v1.0.0`), typecheck + vitest com os irmãos em checkout na `dev`, `docker compose config` dos composes e `make k8s-validate`.
- Decisões: `docker/smoke.sh` ficou aqui (plano §2.9: é a prova de subida do compose; o `brabo-qa` o chama). `trivy-do-release` e `images-manifest` ficaram por pedido da lane, apesar de a release do produto morar no `brabo`.
- Fora do CI, declarado: `install-*.spec.ts`, `assets-do-instalador`, `oferta-de-fonte-na-imagem`, `alarme-de-tag` (instalador/release, `brabo`); `scripts/ci/docs` e as checagens de política (`brabo-ci`/`brabo`); `diff-toca-imagem`, `ambiente-nas-actions`, `rotulos-dos-workflows`, `destinos-do-composer`, `testes-leem-so-o-proprio-app`, `vocabulario-de-eventos-dev`, `semgrep-do-engine` (dependem de `.github/` ou `docs/` do monorepo).
- Lacunas: a prova de subir os seis serviços saudáveis a partir dos clones irmãos é da AT-707; `scripts/dev/bootstrap.sh` e `seed-prompts.ts` ainda assumem UM checkout.
