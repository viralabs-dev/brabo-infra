---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
id: rn-infra
title: 'Regras de negócio — Infra'
sidebar_label: Infra
description: 'As RNs hospedadas na raiz infra.'
keywords: [regras de negócio, infra]
---

# Infra

### RN-224 — The migration creates the pgvector extension by itself, idempotently {#rn-224}

The `0045` migration runs `CREATE EXTENSION IF NOT EXISTS vector` before
creating the table, instead of assuming `docker/postgres/init.sql` has already run —
that file only executes on the FIRST initialization of the Postgres volume, and an
environment with an old volume may not have the extension. `IF NOT EXISTS` is
idempotent: local (where the extension was already installed) and a new
environment go through the same line with no difference in behavior.

- **Where:** `apps/api/src/db/migrations/0045_shallow_randall.sql`
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

## The `dbre` role becomes two mechanical scripts (RN-400..403, ADR 0093)

### RN-402 — The backup report rereads exactly the logic of `collectBackup()`, never a second way of computing {#rn-402}

`relatorio-backup.ts` isn't a new Prometheus gauge — it's the SAME read
of `backup_runs` that `DomainGaugesCollector.collectBackup()` already does
(last SUCCESS, for age and size; the LAST run, to catch the
case of failing for days with an older good backup), on
demand. `avaliarBackup` is pure — it receives the two rows and the current
instant, returns `status`
(`ok`|`atrasado`|`nunca_houve`|`falha_recente_com_sucesso_antigo`). The
"late" threshold (26h = `BACKUP_AGE_ATRASADO_SEGUNDOS`) is the SAME as the
`brabo-backup-atrasado` alert
(`deploy/k8s/observability/alerts/brabo-alerts.yaml`), duplicated (not
imported — the Grafana YAML isn't read by the Node process) and subject to
diverging if one side changes without the other.

- **Where:** `apps/api/scripts/relatorio-backup.ts` (`avaliarBackup`, line
  82; `BACKUP_AGE_ATRASADO_SEGUNDOS`, line 54)
- **Test:** `apps/api/test/scripts/relatorio-backup.spec.ts` — there was never
  a backup, backup ok, late, exactly at the threshold (doesn't count as
  late), recent failure with an old success, late takes priority
  over recent failure, age never negative
- **ADR:** [0093](../adr/0093-dbre-linter-de-migracao-e-relatorio-de-backup.md)

### RN-403 — The backup report does NOT rerun the restore; it points to the already tested procedure {#rn-403}

The procedure for actually restoring (`make test-restore` /
`deploy/k8s/test-restore.sh`) has already been executed and is documented in
`docs/runbook.md#restore`, with real RTO (~40s against a ~108 KB database)
recorded in that document's "Last verified run" section.
`relatorio-backup.ts` answers a narrower and more
frequent question — "is the backup that this restore would use healthy now?" — and
cites the runbook for whoever really needs to restore, instead of duplicating the
procedure or rerunning it.

- **Where:** `apps/api/scripts/relatorio-backup.ts` (final message of
  `imprimir`, citing `docs/runbook.md#restore`)
- **Test:** not applicable (it's static text pointing to the runbook,
  not logic); the existence of the tested procedure is an RN of
  `docs/runbook.md#restore` itself
- **ADR:** [0093](../adr/0093-dbre-linter-de-migracao-e-relatorio-de-backup.md)

---

## "N agents online" on the dashboard — LIVE status, never historical presence (RN-409, ADR 0097)

### RN-413 — Prompt templates live outside the code, versioned in the graph {#rn-413}

Every agent prompt was an inline Elixir heredoc until this delivery —
identities (`Engine.Harness.Agents`), the kickoffs of PO/Arquiteto/Dev
Lead/UX/Infra, the `ContextManager` summarization prompt. A prompt
template can now live as `(:PromptTemplate {name})-[:HAS_VERSION]->
(:PromptVersion {version, body, hash, active})` in Neo4j, written via
`POST /internal/graph/prompt-templates` and read via `GET
/internal/graph/prompt-templates/:name`. Upsert is idempotent by hash —
writing the SAME content twice doesn't create a new version, only the already
existing version with an equal hash is returned.

First batch extracted to `prompts/*.md` (front-matter `name`/`version`,
placeholders documented in a "Variáveis" section for passages that in
the original `.ex` were interpolation): `ux-designer-identity`,
`psychologist-kickoff`, `anamnese-kickoff`, `context-manager-summarize`.
`scripts/dev/seed-prompts.ts` reads `prompts/*.md`, computes the sha256 hash of the
body, and sends it to the endpoint above. **No `.ex` was edited in this
delivery** — the four GenServers keep the inline text; consuming
the templates from the graph (the `:graph` source of `InstructionFiles`, precedence
`db > graph > dir > root`) is the next Wave, declared out of scope here.

- **Where:** `apps/api/src/application/use-cases/graph/upsert-prompt-template.use-case.ts`,
  `get-prompt-template.use-case.ts`; `apps/api/src/interfaces/http/internal/internal-graph.controller.ts`;
  `prompts/*.md`, `prompts/README.md`; `scripts/dev/seed-prompts.ts`
  (`SECAO_DE_DOCUMENTACAO`, `corpoSemDocumentacao`, `parseFrontMatter`)
- **Test:** use cases with a mocked `GraphStore` (upsert with the same hash
  doesn't duplicate) + integration test against real Neo4j, skipping
  gracefully when unavailable; `scripts/dev/seed-prompts.spec.ts`
  (front-matter parsing, deterministic hash, malformed template
  fails with a clear message; and, since AT-244, the sweep of EVERY
  `prompts/*.md`: the seeded body doesn't have the documentation section and each
  placeholder appears in it only once, and the summarizer receives the turns only
  once through the same engine render)

> **Since AT-244** the "## Variáveis" section of each file is NOT seeded: the
> template's body ends at the `## Variáveis` line, and the seeder discards from it
> onward. Before, the body carried the whole section — documentation that cites the
> same `{{placeholders}}` as the body —, and since each consumer replaces ALL
> occurrences (`String.replace/3`), with `graph_templates_enabled?` on the
> model received the documentation and the data TWICE: the `ContextManager`
> summarizer the turns doubled, the kickoffs of the Psicólogo and the Anamnese the
> event log doubled, and the UX identity (behind
> `graph_instruction_templates_enabled?`) the documentation in every turn. The
> four files had the shape; the cut lives in the SEEDER, and not in the render,
> because there's one render per consumer and the question "what is body" is about the
> file, which only the seeder reads. The versions went up (`anamnese-kickoff` and
> `ux-designer-identity` to `"2"`, `psychologist-kickoff` and
> `context-manager-summarize` to `"3"`) with the SAME prompt text. **It
> doesn't close on its own in an installation that has already seeded**: the ACTIVE version in the graph stays
> the old one, with the documentation, until `scripts/dev/seed-prompts.ts` runs
> again — the body's hash changed, so the seeder creates the new version and deactivates the
> previous one. With the flags off (the default) the defect never existed: the
> inline text applies, which never had the section.
- **Origin:** product owner's decision, inspired by the repository
  [ErickWendel/neo4j-ai-experiments](https://github.com/ErickWendel/neo4j-ai-experiments)
  (see [ADR 0099](../adr/0099-neo4j-grafo-de-conhecimento-e-templates.md))

---

### RN-415 — Ollama models guaranteed at boot, RAG degradation declared {#rn-415}

`nomic-embed-text` (`RAG_EMBEDDING_MODEL`) was never pulled
automatically — a real bug, not only of this feature: the `ollama` service's
entrypoint only pulled `llama3.2:1b`, and RAG degraded to
lexical-only SILENTLY in any clean environment, with no sign
that this was happening. A new service `ollama-model-loader` (one-shot,
dev and prod `docker-compose.yml`), reading `OLLAMA_REQUIRED_MODELS`
(default `gemma3:1b,yi-coder:1.5b,nomic-embed-text`), additive to the existing
`ollama` service — its entrypoint stays untouched.

The degradation is no longer silent: `rag_search` (RN-414) and the api's hybrid
search already returned `degraded: true` when embedding failed
— what was missing was a CONSUMER that made that flag visible. Now
that the tool exists, the model itself sees the warning in the formatted text, and the
model-loader reduces the chance of degradation happening in the first place.

- **Where:** `docker/docker-compose.yml`, `docker/docker-compose.prod.yml`,
  `docker/ollama/pull-models.sh`; `deploy/k8s/base/neo4j/`,
  `deploy/k8s/base/ollama/job-model-loader.yaml` (template, NOT wired
  into any kustomization — `deploy/k8s/` doesn't yet have an `ollama` Service
  to point to, wiring it today would cause CrashLoopBackOff in every real deploy)
- **Test:** `scripts/dev/verificar-modelos-ollama.sh`, executed end
  to end with a real small model (`all-minilm`) so as not to pay
  the cost of several GB of the production list on a shared machine
- **Origin:** found during the foundation of the knowledge graph — see
  [ADR 0100](../adr/0100-rag-search-e-modelos-garantidos-no-boot.md)

---

## Local runner terminal stuck at "Opening terminal..." forever (RN-433)

Found testing a new project in `runner` mode (ADR 0103/0104) and opening
Code → Dev → Terminal: the screen never left the loading skeleton, and the
console showed `socket do terminal com erro`/`socket do terminal fechado`
in a loop, with growing backoff until stabilizing at ~5-6s — the pattern of the
`phoenix.js` DEFAULT backoff.

### RN-433 — The terminal socket gives up after a timeout, the `ENGINE_PUBLIC_URL` default is reachable BY THE BROWSER, and the endpoint doesn't duplicate the path {#rn-433}

Three stacked defects. The first two were found investigating the
symptom; the THIRD only showed up after fixing the first two — without
them, the browser never reached the engine to reveal the path bug
underneath. Fixing only one leaves the others standing:

1. `ENGINE_PUBLIC_URL` (RN-419) never had any default in
   `docker/docker-compose.yml` — only `ENGINE_URL` (`http://engine:4000`,
   a hostname that ONLY resolves inside the Compose network). The code's fallback
   (`process.env.ENGINE_PUBLIC_URL ?? process.env.ENGINE_URL ?? …`,
   `request-runner-ticket.use-case.ts`) silently fell to the wrong
   value, and the browser tried to open a WebSocket against a hostname
   it never resolves. `docker/docker-compose.yml` gained
   `ENGINE_PUBLIC_URL: ${ENGINE_PUBLIC_URL:-http://localhost:4000}` in the
   `api` service — the SAME default `VITE_ENGINE_URL` already uses in the
   `web` service, for the same reason.
2. Even with the right URL, a transport that NEVER opens (engine down,
   firewall, a wrong future reconfiguration) had no ceiling at all:
   `apps/web/src/lib/terminal-channel.ts` never passed `reconnectAfterMs`
   to the `Socket`, so `phoenix.js` fell into its DEFAULT backoff and kept
   trying to reconnect on its own forever — the module's own docblock
   already declared the intent of "no automatic reconnection" (same ruler as
   `session-channel.ts`/RN-108), but it was never fulfilled in practice. Without
   `onError`/`onClose` calling `handlers.onErro`, `TerminalPanel` stayed
   stuck in `'carregando'` (RN-088 — every screen distinguishes loading/error/
   empty — silently violated). Fixed with `reconnectAfterMs` returning
   a value that practically never fires (24h, same pattern as
   `session-channel.ts`) and an OWN 8s timeout
   (`TIMEOUT_CONEXAO_MS`): if `onOpen` doesn't fire before that, the module
   calls `handlers.onErro` with an actionable message and disconnects.
3. **The defect that actually prevented the connection, masked by the two
   above**: `terminal-channel.ts` concatenated `'/runner/websocket'` to an
   `engineWsUrl` the api already returns READY — `ws://host:porta/runner`
   (`engineWsUrlPublico()`) —, and `phoenix.js`'s OWN `Socket` also
   appends `/websocket` by itself in the constructor
   (`this.endPoint = ${endPoint}/websocket`). The result hit the engine
   as `GET /runner/runner/websocket/websocket`, which
   `Phoenix.Router.NoRouteError` refuses — confirmed in the engine's log
   (`docker logs brabo-engine-1`) during the end-to-end verification of this
   fix. `apps/runner/src/channel.ts` (the CLI side) already did it
   right — it passes `engineWsUrl` straight to the `Socket`, without touching it — and the
   `terminal-channel.ts` test never caught it because the mock of
   `getTerminalTicket` used an `engineWsUrl` (`http://engine.local`, without
   `/runner`) that doesn't reflect the api's real contract; fixed along with it.
   Fix: `terminal-channel.ts` now uses `engineWsUrl` (only with the
   defensive `.replace(/^http/, 'ws')`) directly, without concatenating any
   path.

Verified END TO END against `exp001` (`runner` mode, without a real
`brabo-runner` connected): before the fix, the tab spun forever; after, the
engine's log shows `CONNECTED TO EngineWeb.RunnerSocket` →
`JOINED terminal:<projectId>` → `pty_resize descartado — sem runner
conectado`, and the screen shows `RunnerOnboardingPanel` with the
`brabo-runner` command in under 1s — never item 2's 8s timeout, which
remains as a safety net for the case of the engine being genuinely
down.

- **Where:** `docker/docker-compose.yml`, `.env.example`,
  `apps/web/src/lib/terminal-channel.ts`
- **Test:** `apps/web/src/lib/terminal-channel.test.ts` (a socket that never
  opens calls `onErro` within the timeout, without phoenix's automatic
  reconnection; the mock's `engineWsUrl` fixed to reflect the real contract —
  already with `/runner`, without `/websocket` — and the happy path assertion
  now requires the URL used in the `Socket` EQUAL to the ticket's
  `engineWsUrl`, with no concatenation)
- **ADR:** none — a bug fix restoring the behavior that ADR
  0103/0104 and the module's own docblock already declared as intent
- **Origin:** found manually testing a new project in
  `runner` mode; item 3 only showed up when verifying the fix of items 1/2
  end to end in the browser against the real engine

---

## Native Ollama in the dev bootstrap and Hugging Face model pull (RN-461..463, ADR 0114/0115)

### RN-461 — Native Ollama: asks once, the answer persists in `.env`, never asks again {#rn-461}

`scripts/dev/preflight.mjs` detects a native Ollama already listening on
`OLLAMA_PORT` (the same default, 11434, as a native installation) confirming
by HTTP (`GET /api/tags`) that it really is an Ollama, not any process on the
port. Confirmed, it ASKS only once whether to use that instance —
default "Yes" when there's no TTY (`bootstrap.sh` runs the command with stdin
from `/dev/null` on purpose, so as not to steal the user's arrow keys) — and
writes the answer to `.env` (`OLLAMA_MODE=host|container`). From then on the
detection doesn't even run again: with `OLLAMA_MODE` already present, the function
returns early. `ollama`/`ollama-model-loader` enter `profiles:
["local-llm"]` in the compose so they don't come up when the mode is `host`. The
ONLY way to reopen the question is the dedicated menu item "Docker ›
Reconfigure Ollama", which deletes the written keys — never a spontaneous
question again while they exist.

- **Where:** `scripts/dev/env-file.mjs:41` (`escreverEnv`),
  `scripts/dev/preflight.mjs:157` (`ehOllama`),
  `scripts/dev/preflight.mjs:202` (`perguntarUsoDoOllama`),
  `scripts/dev/preflight.mjs:238` (`detectarOllamaNativo`),
  `scripts/dev/reconfigurar-ollama.sh`, `scripts/dev/perfil-ollama.sh`,
  `docker/docker-compose.yml:82,119` (`profiles: ["local-llm"]`)
- **Test:** `scripts/dev/bootstrap.spec.ts` (covers the menu wiring — the
  conditional profile in Deploy › All/Create and the dedicated item
  "Reconfigurar Ollama"). The detection/persistence logic itself
  (`detectarOllamaNativo`/`escreverEnv`) was validated end to end
  manually against a fake HTTP server and against this machine's real Ollama
  (see ADR 0114) — **declared gap**: there's no dedicated automated suite
  for `preflight.mjs` today.
- **ADR:** [0114](../adr/0114-deteccao-de-ollama-nativo-no-bootstrap-dev.md)
- **Origin:** product owner's request, a real finding during execution
  (port collision with a native Ollama)

## The base's consent, on the host (RN-511)

### RN-511 — The base is CONSENTED once on the host, sharing is proven by MOUNTING, and without a terminal the step reports instead of consenting {#rn-511}

[RN-500](api.md#rn-500) built the base and said what to do when it's missing —
`projectsBase: null`, and the "Mounted folder" mode isn't offered. What was missing
was someone **asking** for it to be configured: nothing in the product did, and the
result is that a ready mode became unreachable for whoever installs.

The consent step lives in `pnpm bootstrap` (`Docker › Projects
base`), proposes **`$HOME/projetos-brabo`**, and accepts another typed path.
The name isn't a preference: `.env.example` already uses `~/brabo-projetos` as an example
of `PROJECT_WORKSPACES_HOST_DIR`, the root the PRODUCT manages, and proposing the
same name for both variables would be walking into the collision that
ADR 0141 refused — `<base>/loja` would land in the same physical folder as a
`container` project whose `workspace_dir_name` was also `loja`, and the bootstrap would do
`git init` inside the other's project.

**The name is only the dodge; the protection is a mechanism.** `validarBase` refuses
any candidate that overlaps — in BOTH directions — Brabo's checkout
(the guard RN-500 already had) **or** `PROJECT_WORKSPACES_HOST_DIR` (the
new rule), besides refusing `~`, a relative path, and the root. The refusal applies to
the TYPED path, not only to the default; a well-chosen default only avoids
the refusal being the first thing the user sees.

**Docker Desktop sharing is proven by MOUNTING, never read from
`settings.json`.** That file isn't documented, changes between versions and between
macOS and Windows, and describes what the user CONFIGURED — not what the
daemon will do. It's the same ruler of "a capability is only declared when proven by
execution" of ADRs 0041/0042, applied to the host. The proof is a **sentinel**, and
not a bare `ls`: an empty folder and a non-shared folder produce the same
empty listing, so the script writes a file and asks whether the container
sees it. Only on macOS and Windows (`process.platform`); on Linux there's no sharing
list, and the check is existence and write. It's the product's SECOND
platform guard, symmetric to the first (`validarDirDentroDoHomeNoLinux`,
in the runner): each one restricts only where the restriction means something.

The proof has **three outcomes, and they don't collapse**: proven; failed (the
variable is **not** written, and the refusal names the path and where to add it); and
*couldn't prove* — no local Docker image to mount —, which writes the
variable and **says out loud that the proof didn't run**, with the command to
run it later. "Couldn't look" becoming "everything's fine" is exactly how
a non-shared base would reach the user in the form of a container that
comes up with an empty folder, far from the screen where the choice was made.

**Without a TTY, the step REPORTS and does nothing.** The `bootstrap.sh` menu item
runs with stdin coming from `/dev/null` — on purpose, otherwise anything that
reads stdin steals the user's arrow keys — so from there the script can only report,
and the output says the command that asks. It's the same design as
`perguntarUsoDoOllama`, which without a terminal applies the default and warns instead of
hanging. A consent script that "consents" on its own in a CI pipe is the
negation of the word. For the same reason `preflight.mjs` **reports** the base's
state and never asks: the answer is a path on someone's disk, and there's no
default that can be applied silently.

`mkdir -p` only happens **after** acceptance and validation — creating a folder
from a path that hasn't yet gone through the refusals is creating a folder in
any place the process reaches. And an already present value is never overwritten
without confirmation.

- **Where:** `scripts/dev/consentir-base.mjs` (the I/O: ask, prove, create,
  write); `scripts/dev/base-de-projetos.mjs:143` (`basePadrao`), `:177`
  (`validarBase`), and `:208` (`exigeProvaDeCompartilhamento`) — the pure decision;
  `scripts/dev/env-file.mjs` (`lerEnv`/`escreverEnv`, extracted from
  `preflight.mjs`, which runs `await main()` at the top and therefore can't be
  imported); `scripts/dev/bootstrap.sh` (item `1.6`);
  `scripts/dev/preflight.mjs` (`relatarBaseDeProjetos`)
- **Test:** `scripts/dev/base-de-projetos.spec.ts` (`describe('basePadrao')`,
  `describe('validarBase')` — happy path and the six refusals — and
  `describe('exigeProvaDeCompartilhamento')`); `scripts/dev/bootstrap.spec.ts`
  (the menu tree, 25 leaves)
- **ADR:** [0146](../adr/0146-base-consentida-no-bootstrap.md)
- **Origin:** PHASE 28, session 2

---

## The broker comes up by default in the local compose (RN-512)

### RN-512 — The broker leaves `profiles` in the LOCAL compose and only there, and `DOCKER_GID` now gets reported in the preflight {#rn-512}

The broker was born under `profiles: ["container-broker"]` with a justification that
ADR 0130 itself wrote: *"giving access to the host's Docker to a process that
nothing calls yet would be a posture change for every development
machine, in exchange for nothing"*. Both halves died. **"Nothing
calls it" is false** since ADRs 0133/0134/0136 — the broker has four real
callers. And **"in exchange for nothing" stopped describing the trade** when ADR 0144
made `mounted` bring up a container THROUGH THE BROKER and ADR 0146 made `mounted` the
local default: with the profile off, the default mode ends in
`BrokerIndisponivelError`.

So it leaves `profiles` in `docker/docker-compose.yml` — and **only there**. In
`docker/docker-compose.prod.yml` the profile STAYS, and the two files start
diverging on purpose.

**The asymmetry is what the socket means on each side.** Whoever runs `pnpm dev`
**already has the Docker socket** — they're running `docker compose`, against the
host's own daemon —, so the broker receiving it grants nothing the operator
doesn't already have. The marginal surface is the broker's own HTTP, which publishes no
port, lives on an `internal: true` network only the api reaches, and compares
`BRABO_SERVICE_TOKEN` in constant time. In production the calculation is the opposite: the
socket is a real privilege boundary, the operator isn't the developer,
and nothing in this phase changes the default mode of a production installation.

**The five containment layers aren't touched.** This changes **when** the
broker runs, never **what** it accepts: it still receives `projectId` and
one of the five operations, still goes to the api to read the Arquiteto's decision, and
still has no parameter where one could write `privileged`, `cap_add`,
`network: host`, or a free `-v`. The containment was never the profile.

**The environmental consequence, and why it got reported.** `DOCKER_GID` stops
mattering only to whoever turned the profile on on purpose — someone who was, by
definition, paying attention to it — and starts applying to anyone who
runs `pnpm dev`. The socket is `root:docker` on the host and the broker's process runs
non-root; the compose's `group_add` is what gives it the group, and the default `999` is
the most common and is wrong in several distributions. Getting it wrong **doesn't break
boot** — the broker comes up normally —, it breaks USE: every operation dies with
`permission denied` on the socket, and the symptom appears much later, when someone
proposes `container_start`. That's why `preflight.mjs` now **reports** the
state on every `pnpm dev`.

The report has **three outcomes, and they don't collapse**: matches; diverges (with the
origin of the effective value — `configurado` × `default` — because the two ask for
different instructions); and **doesn't apply**, when the machine has no `docker`
group. The third isn't an error nor "couldn't": on macOS and Windows
Docker Desktop doesn't use a unix group, and in a rootless Docker the socket belongs to the
user themselves. Treating the absence as a divergence would accuse half the machines of a
defect they don't have — the same care as `baseSobrepoeOCheckout`, which
returns `false` for an unknown checkout. And it **reports, never blocks**:
`pnpm dev` comes up the same.

**Leaving `profiles` wasn't enough, and the defect only appeared on the first default
startup.** The development image prepared pnpm with `corepack` as
**root** at build time and ran as uid 1000, which doesn't read that cache; without the cache
corepack tries to **download** pnpm at start, and the broker's only network is
`internal: true` — the attempt died with `getaddrinfo EAI_AGAIN
registry.npmjs.org` and the container exited with 1, five seconds after coming up. The
service also had no healthcheck, so `up --wait` printed `Healthy` and the
total reset announced "reset completo" with the process dead. While the service
was under a profile this never showed up: whoever turned it on on purpose was already
watching. The fix **takes the registry out of the runtime path** — the
`pnpm install` moves to a BUILD step and `COREPACK_HOME` goes to a
directory owned by the runtime uid — and **doesn't open the network**, which is the
first of the five layers above. Since the three `node_modules` are named volumes
mounted over what the image installed, and Docker only seeds an **empty**
volume, `docker/broker/entrypoint.sh` reconciles the three against a
copy kept outside `/workspace`, stamped with the sha256 of the build's `pnpm-lock.yaml`
— the same stamp that, compared to the tree's lockfile, warns that the
image is stale without refusing to come up. The PRODUCTION compose didn't suffer from this:
`Dockerfile.prod` already installed in a build stage, removed `corepack` from the
final image, and already had a `HEALTHCHECK`. Since AT-360 no image uses
`corepack` (Node 25+ doesn't ship it): pnpm is installed from the registry tarball,
checked against a sha512 recorded in the Dockerfile, in `/usr/local/bin`, and
`COREPACK_HOME` left the dev broker — with the version equal to `packageManager`'s
there's no cache to read nor download to attempt at start (measured under `--network none`).

- **Where:** `docker/docker-compose.yml` (`broker` service, without `profiles`, with
  `healthcheck`) and `docker/docker-compose.prod.yml` (with `profiles`, and the note
  that prevents uniformizing the two); `docker/broker/Dockerfile` (pnpm pinned by sha512,
  the build-time `pnpm install`, and the copy in `/opt/broker-deps`);
  `docker/broker/entrypoint.sh` (the reconciliation of the three volumes and the
  lockfile warning); `scripts/dev/docker-gid.mjs` (`avaliarDockerGid`,
  `mensagemDoDockerGid`, `GID_PADRAO_DO_COMPOSE` — the pure decision);
  `scripts/dev/preflight.mjs` (`relatarDockerGid`, `gidDoGrupoDocker`)
- **Test:** `scripts/dev/docker-gid.spec.ts` — the happy path, the two
  divergences (absent default and wrong value), the "doesn't apply" without a docker
  group, and the default that happens to be RIGHT
- **ADR:** [0146](../adr/0146-base-consentida-no-bootstrap.md), point 3
- **Origin:** PHASE 28, session 4

---

## PHASE 29 — the one-line installation: signing what is published

### RN-527 — The installation comes up from its OWN compose, by chosen image, and checks health before saying it installed {#rn-527}

> **Revised by [RN-575](produto.md#rn-575) (ADR 0162):** the `broker` service came to
> exist in this compose, off under the `container-broker` profile and turned on
> by the installer only with consent; the mandatory images are FIVE. The
> rest of this rule holds as is.

`docker/docker-compose.install.yml` is what runs on the machine of whoever installed, and
it **is not** `docker-compose.prod.yml`. Three differences, each with a
reason:

- the five images come from a **mandatory variable** (`${BRABO_API_IMAGE:?…}`),
  with no default. With a default, an absent variable would bring up half the stack with
  an image nobody chose, and the error would show up as strange behavior instead of
  refusal;
- **there is no `build:` block** anywhere: this file does not build, and that is its
  point;
- the **`broker` service does not exist** here, because its image is not published
  (`docker-bake.hcl` has four targets). Declared consequence: with
  `--source=ghcr`, a `mounted` project does not start a container (ADR 0150, decision 7).

`docker-compose.prod.yml` stays **intact** — it declares itself a
**validation** compose, it is what `docker/smoke.sh` uses building locally on purpose, and
promoting it would break that use. The cost of the two files is declared, and the ceiling
against divergence is **mechanical**:
`scripts/dev/composes-em-conformidade.spec.ts` fails if the installation one
gains a service, volume or port the validation one does not have, if any `build:`
survives, or if a third-party image loosens to a different tag.

**The image source is a choice, and "official" is the result of verification.**
`--source=ghcr` (default) resolves by **digest** from the Release's `images.json`;
`--source=local` runs `docker buildx bake` and **requires a clean tree on a
tag** — an image built from a dirty tree is not the version it says it is, and the
marker would record a lie.

**The secrets are born once and persist.** The five of
[RN-114](api.md#rn-114) plus `NEO4J_PASSWORD`, generated with
`openssl rand` in the same mold as `docker/smoke.sh:31-57` — including the detail
of `NEO4J_PASSWORD` being `-hex` and not `-base64`, because a `/` breaks the parse
of `NEO4J_AUTH`. The `.env` is created **empty and with mode 600 BEFORE** receiving
content: creating with the user's umask and tightening afterwards would leave the secrets
readable for a window, and it is precisely the file that cannot have that window.

**And the `.env` is a file COMPOSE parses, and it is proven against it**
(AT-083). The `SECRET_KEY_BASE` came from `openssl rand -base64 64`, which BREAKS the
line at 64 characters: the secret's 88 went on two lines, and the second was left
loose in the `.env`. Measured over 100 generations, Compose refused 49 (*"unexpected
character in variable name"*) and ACCEPTED 51 — with the secret cut at 64
characters, which is still Phoenix's minimum and that is why it came up without a warning. Every
base64 now goes through `segredo_base64` (`| tr -d '\n'`), and the file is written
by `escrever_env` — a function, and not the body of `main`, so that the spec writes the
SAME file the installation writes.

**There is no migrate step, and there must not be:** the compose chains `api` →
`migrate-api` with `service_completed_successfully`, and `up --wait` waits. A
second place ordering a migration would be the second source of the same truth.

**And the installer asks before asserting.** After `up --wait` — which already
waits for the healthcheck — it hits the `/health` of the api and of the engine, and only then says
it installed. It is the rule `reset-total.sh` learned the hard way: it announced
"reset complete" with the api in `Exited (1)`.

**Where:** `install.sh` (root), `docker/docker-compose.install.yml`.
**Test:** `scripts/dev/install.spec.ts` (the plan, without a TTY or effect) and
`scripts/dev/composes-em-conformidade.spec.ts` (the divergence between the two
composes); `scripts/dev/install-env.spec.ts` generates the secrets and the `.env` through the
real functions, runs the file through `docker compose config` against the
installation compose and demands that EACH secret reach the services WHOLE (skips
naming the reason without `docker compose`), with the old generation pinned as
rejected.
**Origin:** PHASE 29, session 4 ([ADR 0150](../adr/0150-instalador-de-uma-linha.md)).
Installing the runner (session 7) and migrating a previous installation (session 6)
remain out, and `--print-plan` declares them `nao-nesta-versao`.

## The backup covers the TWO volumes that are a source of truth, and runs without a cluster (RN-528)

### RN-528 — `git_local_repos` enters the backup, the destination can be disk, and the compose restore reuses the SAME three validations {#rn-528}

The backup covered **one** database and ran in **one** place. Three consequences, and the
third is the one that costs code: `make test-restore` requires `kubectl`, a cluster and
the `brabo-backup` CronJob in the namespace, and `docker-compose.prod.yml` had no
`backup` service at all — the image was built by the bake and used only in k8s.
Migrating a compose installation had no **proven** path.

**Classify before copying.** The easy move would be "back up all
the volumes", and it is wrong: of the seven, `neo4j_data` and `project_workspaces` are
DERIVED, `ollama_data` is re-obtainable and `brabo_projects_base` belongs to the user.
Copying them gives an impression of coverage without adding recovery. Sources of
truth are TWO: `pgdata` — which was already covered, as a logical dump and never as a copy
of the data directory of a running Postgres — and **`git_local_repos`**, which
**no backup covered**. A project with the `local` provider keeps the *bare*
repository in there, and it is NOT rebuildable from Postgres: the event log keeps the
narrative, not the git objects. The runbook prose said the opposite ("the
real repositories live in GitHub/GitLab") and it is that sentence that explains how the
volume went years without coverage — it holds for `github`/`gitlab`, and for
`local` there is no upstream at all.

**The guarantee of the repos archive is declared, and it is smaller than "snapshot".**
Nothing is quiesced. What is guaranteed is consistency PER REFERENCE — git writes
the objects before moving the ref, and swaps the ref by atomic rename, so a
`tar` that crosses a `git push` gets the old value or the new one, never half of one.
What is NOT guaranteed is a global instant (the `tar` walks the tree over a
period) nor object connectivity (the image has no git, on purpose). And
a concurrent `gc` deleting a packfile becomes a FAILURE and not a partial archive: the status
of `tar` is captured in a file, because in POSIX `sh` the status of a pipe is that
of the last command — without it the incomplete archive would announce itself as good, and
a backup that lies is worse than a backup that fails, because only the second becomes an
alert. `*.lock` is left out: restoring an orphan lock produces a repository in which
every `git` refuses to operate.

**Disk destination, S3 optional.** The five S3 variables stop being
mandatory and become what they already were in practice — the configuration of ONE of the
destinations. `BACKUP_DIR` set chooses disk; absent, S3, which is how the k8s
CronJob keeps running without a single line of change. The inference (instead of a
mandatory destination variable) is what keeps that path intact: an
explicit destination would break the CronJob on deploy day, not on commit day. Four
prefixes and not two (`daily/`, `weekly/`, `git-daily/`, `git-weekly/`) because
retention is by COUNT: two kinds of archive under one prefix would make "keep 7"
mean three and a half backups.

**The compose restore changes the wrapper, never the judgment.**
`test-restore-compose.sh` triggers a REAL backup through the same image and the same
production command, and calls the SAME `brabo-restore`, with the SAME three
validations (table list against the source, count of the critical ones in the backup
window, dense continuity of the `seq` of `session_events`).
`deploy/k8s/test-restore.sh` stays **intact** — unifying them would make the
compose path depend on `kubectl`, which is the dependency it exists not to have.
And `restore.sh` still does not touch the SOURCE database, a property that is not
negotiated for migration convenience. The step only compose can demand is the
third: verifying the repos archive, because in k8s that volume is not even
mounted in the pod (skipping is correct) and under compose it is (skipping would be a false green).

**Restoring the repos is a SIBLING command, not a phase of the other** — they are two artifacts
with two judgments, and joining them would make a git failure fail the validation of the
event log. It verifies by default and only writes with `--restaurar`; it refuses to
extract over existing repos (the mix of two states raises no
error and only shows up in a `fetch` with the wrong history); and — a finding of the real
execution — it refuses BEFORE the `tar` when the volume does not accept writes, naming
`--user 0:0`. `git_local_repos` is shared by three images with different uids
and carries the owner of whoever mounted it first (measured: `1000:1000`,
mode 0755) while this image runs as uid 70. When the extraction runs as
root, what comes out is handed back to the DIRECTORY's owner and never left as root:
otherwise the volume would come back intact and useless, with api and engine unable to
write to what was just restored.

**Neo4j gets reprojection, not backup.** Restoring a possibly
old projection next to a Postgres restored at another instant gives two derived states
from different moments, with nothing reconciling them. The reprojection **was not
built here** (it is BRB-018): until it exists, a migrated installation is born with
an EMPTY graph — known and named degradation, not data loss, because the RAG
lives in pgvector and comes in the dump. Since [RN-569](api.md#rn-569) it exists
(`grafo:reprojetar`), and the empty graph now lasts until someone runs it.

- **Where:** `docker/backup/lib.sh:28` (`destino_tipo`, the inference that keeps the
  CronJob intact), `:65` (`destino_esperar` asking about WRITING and not about
  existence), `:105` (`destino_enviar`, writing to `.parcial` and rename),
  `:181` (the guarantee of the bare repos, written next to the code that produces it),
  `:221` (`git_arquivar`, the `tar` status in a file), `:259`
  (`git_restaurar`, handing back the owner) and `:273` (`git_raiz_gravavel`);
  `docker/backup/backup.sh:31` (`destino_preparar` — the five S3 variables
  ceasing to be mandatory), `:149` (the three outcomes of the repos volume,
  without collapsing "not mounted" with "empty"), `:170` (the check of the
  `tar` status) and `:220` (the pruning of the four prefixes);
  `docker/backup/restore.sh:28` (the same destination as the backup) and `:120`, `:184`,
  `:215` (the three validations and the verdict, without a single line of change);
  `docker/backup/restore-git.sh:43` (verifying as default), `:109` (the refusal
  to extract over) and `:123` (the refusal for writing, with the fix named);
  `docker/backup/test-restore-compose.sh:60` (the `--profile` in `config` and not
  in `run`);
  `docker/docker-compose.prod.yml:392` (the `backup` service, under `profiles` and
  `restart: "no"`) and `:550` (the volume that does NOT enter the classification of the seven);
  `docker/backup/Dockerfile.prod:80` (the `/backups` created and `chown`-ed BEFORE
  the `USER`);
  `Makefile:54` (`test-restore-compose`)
- **Test:** `scripts/ci/backup-lib.spec.ts` — the functions in a real `sh`,
  against a real directory: the five operations of the disk destination; the
  absent object measuring 0; the atomic write and the `.parcial` that the listing
  ignores; the sibling prefixes that do not mix; the destination that exists and does NOT
  accept writes (failure case); "not mounted" × "mounted and empty"; the repos
  archive with status 0 and content re-read; `*.lock` and `objects/tmp_*` out; the
  archive→restore cycle returning byte for byte; the refusal to restore where
  one cannot write; and the truncated tar that fails when READ, never by
  size
- **ADR:** [0152](../adr/0152-backup-de-volumes-contra-compose.md)
- **Origin:** PHASE 29, session 5. Exercised for real against the
  development compose with real data (55 tables, 422 events, the bare repos of
  `exp001` and `exp004`), including the restore into a new volume checked with
  `git fsck` — the record is in `docs/runbook.md`, section "Last verified run —
  compose, disk destination". Declared and NOT done: the adapter's **S3** path
  has no automated coverage (it would require an endpoint), and it is still
  the same `aws` command as before; the Neo4j reprojection is BRB-018; and
  nothing here schedules the backup in a compose — what triggers it is a human or the
  installer (session 6)

---

## PHASE 29 — the one-line installation: signing what is published

### RN-530 — Migrating requires a PROVEN backup: the installer only earns the right to delete after restoring {#rn-530}

Installing over an existing installation **is not offered**: either one migrates,
or one stops. An `up` over volumes of another version is the kind of damage that gives no
warning.

The migration has an order, and the middle step is what gives it meaning:
**backup → PROVE it restores → ask → delete → install → restore.**

The proof is not overzealousness. A backup nobody tried to restore is a file, and the
time to find that out is not after the `down -v` — that is why the installer runs
`docker/backup/test-restore-compose.sh` (the SAME three validations as
`restore.sh`, ADR 0152) before any deletion. A backup that fails, or a proof
that fails, **interrupt the migration without deleting anything**, and the message says where the
backup was left.

**The backup destination is a HOST folder**, and that is the detail that makes the
difference between migrating and losing: the compose default is the named volume
`backup_local`, which `down -v` would delete **together** with what one wants to preserve.

**What the migration deletes**: the installation's named volumes (`pgdata`
included), the containers and the network. **What it never deletes**: the projects
base — when `BRABO_PROJECTS_BASE` points to a host folder, the compose
line is a **bind-mount**, and `down -v` does not touch binds —, the mirror folder
(RN-516) and the freshly proven backup.

The Postgres dump is **not** restored automatically over the new database:
`brabo-restore` validates against a test database and never overwrites the
source (ADR 0152), and restoring over an already populated database is a
destructive operation the installer does not take on its own. The local git repositories, yes —
they are a source of truth that would be born empty.

**Where:** `install.sh`, `migrar_instalacao_anterior` and `restaurar_apos_migrar`.
**Test:** `scripts/dev/install.spec.ts` — the plan declares
`apagar-sem-backup-provado: nunca`, and a test checks that the call to the proof
comes **before** the deletion call in the code.
**Origin:** PHASE 29, session 6 ([ADR 0150](../adr/0150-instalador-de-uma-linha.md),
[ADR 0152](../adr/0152-backup-de-volumes-contra-compose.md)).

## The repository is born on accepting the handoff to the Arquiteto, and execution does not start without it (RN-582)

### RN-599 — In the dev compose the api finds the broker on its own, and the absence of the managed folder is stated at each startup {#rn-599}

The broker comes up by default in the DEV compose since [RN-512](#rn-512), but the api
received an empty `BROKER_URL` (`${BROKER_URL:-}`, and the line came commented out in
`.env.example`). The result, measured in the owner's test on 09/26: with the broker
up alongside, `brokerConfigurado` came `false` and project creation only allowed
`runner` ([RN-573](api.md#rn-573)). Two rules close this:

1. **`BROKER_URL` has a default in the dev compose, and only there.** The default is
   `http://broker:8090` — the service and the port (`BROKER_PORT`) that the SAME
   file declares, and the test locks the two together: a default pointing
   elsewhere would swap "no broker" for "unreachable broker". The `.env`'s
   value keeps winning. The PRODUCTION and INSTALLATION composes stay
   `${BROKER_URL:-}`, on purpose: there the broker is under
   `profiles: ["container-broker"]`, and whoever turns it on writes the URL (`install.sh`,
   asking — [RN-575](produto.md#rn-575)). A default there would make the api of an
   installation without a broker assert it has one.
2. **`preflight.mjs` REPORTS the managed folder, in the mold of `DOCKER_GID`.**
   Without `PROJECT_WORKSPACES_HOST_DIR`, api and engine use the managed volume
   `project_workspaces` (without a host path), the broker is left without
   `PROJECT_WORKSPACES_HOST_ROOT` — the dev compose DERIVES it from that one —, the stack
   comes up healthy and the `container_start` of the `container` mode, the default, ends
   refused. The report has four outcomes that do not collapse: `ausente`, `ok`,
   `nao-absoluta` (the `~`: Compose expands it at the source of api/engine's bind-mount,
   but NOT in the variable the broker receives — measured with
   `docker compose config`) and `divergente` (an explicit `PROJECT_WORKSPACES_HOST_ROOT`
   different from the folder api and engine mount, including when they
   mount the volume). Each message states the symptom and the fix. It NEVER refuses
   the startup and NEVER writes the `.env`: the answer is a path on someone's disk,
   and swapping the volume for the folder hides what is already in the volume (the data stay
   there, they just stop being seen) — the message says that too.

**What stays open:** `pnpm bootstrap` does NOT offer the folder. Doing so would be a
second `consentir-base.mjs` (asking in a TTY, creating the folder with the right
owner, writing BOTH variables together, deciding what to do with a
`project_workspaces` volume that already has data), and that is its own front.

- **Code:** `docker/docker-compose.yml:266` (the default of `BROKER_URL`),
  `:571` (the derivation of `PROJECT_WORKSPACES_HOST_ROOT`);
  `scripts/dev/pasta-gerenciada.mjs:63` (`avaliarPastaGerenciada`), `:89`
  (`mensagemDaPastaGerenciada`); `scripts/dev/preflight.mjs:424`
  (`relatarPastaGerenciada`)
- **Test:** `scripts/dev/broker-url-no-dev.spec.ts:42` (the default exists),
  `:47` (points to the file's service and port), `:64` (production and
  installation without a default); `scripts/dev/pasta-gerenciada.spec.ts:31`
  (absent), `:51` (the `~`), `:67` (divergent with the volume), `:75` (the
  message states symptom, fix and what does not migrate), `:113` (the preflight
  calls the report without exiting because of it)
- **Origin:** AT-213 — the owner's test on 2026-09-26
