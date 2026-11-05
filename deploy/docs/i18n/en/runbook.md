---
id: runbook
title: Operational Runbook
sidebar_label: Runbook
sidebar_position: 4
description: Brabo operational procedures — deploy, rollout, restore, key rotation, cost incident, and observability.
traducao_de: d6ad631fba3edac691608e1f31d9000e12640253
keywords: [runbook, operations, incident, restore, rollout, kubernetes]
---

# Operational Runbook

One single document, because at 3am nobody opens a directory to pick a file.
Start with triage. What proves each procedure, and what runs that proof, is in
the table at the end:
[Procedures and how each is verified](#procedimentos-e-verificacao).

## Triage — from symptom to procedure

| what you're seeing | go to |
|---|---|
| I want to bring everything up from scratch | [Local deploy](#deploy-local) |
| pods stuck, `ExternalSecret` never Ready, HPA at `<unknown>` | [Deploy diagnosis](#diagnostico-do-deploy) |
| I'm about to roll out the engine | [Engine rollout](#rollout-do-engine) |
| session `active` with no process, or stuck in `closing` | [When a session escapes](#quando-a-sessao-escapa) |
| I lost data / want to verify the backup | [Restore](#restore) |
| I want to verify or restore a backup on an install that has **no cluster** | [Restore](#restore) — `make test-restore-compose` |
| a `local`-provider project lost its repository, or I'm moving an installation to another machine | [Recovering the bare repos](#restore-dos-bare-repos) |
| the graph is empty after a restore or a migration | [Losing the graph](#perda-do-grafo) — `grafo:reprojetar` |
| a project's `docs/` folder (the agents' artifacts) is missing after a restore, a volume loss or a mode conversion | [Losing the artifact folder](#perda-da-pasta-de-artefatos) — `artefatos:reprojetar` |
| LLM or git credential stopped decrypting | [Master key rotation](#rotacao-da-chave-mestra) |
| everyone logged out at once, or account locked at login | [Auth key rotation](#rotacao-das-chaves-do-auth) |
| cost per hour spiked | [Cost incident](#incidente-de-custo) |
| empty panel, no trace, no log | [Observability](#observabilidade) |
| I don't know what version is running | [What version is live](#que-versao-esta-no-ar) |
| `blocked by CORS policy` in the browser console | [CORS error](#erro-de-cors) |
| activating a session does nothing, or `transition` returns `500` with `ECONNREFUSED` | [The session doesn't leave `created`](#sessao-nao-ativa) |
| the api exits on boot complaining about `GIT_OAUTH_STATE_SECRET` | [The api refuses to boot over an OAuth secret](#segredo-de-oauth-no-boot) |
| "Sign in with GitHub/GitLab" comes back from the provider with a `redirect_uri` error | [The provider rejects the social-login callback](#callback-login-social-nao-registrado) |
| the api or the engine exit on boot complaining about `AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY`, `SECRET_KEY_BASE`, or `NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD` | [The four sibling secrets also refuse the default](#segredos-irmaos-no-boot) |
| I want to turn on real SMTP, or the api exits on boot complaining about `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` | [Real SMTP in `MailSender`](#smtp-real) |
| agent responding empty, truncated, or very slow | [Inference environment](#ambiente-de-inferencia) |
| agent stopping with `iteration limit reached` without delivering | [Inference environment](#ambiente-de-inferencia) |
| I want to add an OpenAI-compatible LLM provider | [Adding a compatible provider](#adicionando-um-provider-compativel) |
| I want to migrate my workspaces from the Docker volume to a real folder | [Migrating workspaces to a local folder](#migrar-workspaces-pasta-local) |
| the project wizard doesn't offer **Mounted** mode, or creating a mounted project refuses saying the path must sit inside the base | [Project in Mounted mode: the projects base](#projeto-no-modo-local) |
| approving `container_start` on a mounted project fails saying the api couldn't create or reach the folder | [Project in Mounted mode: the projects base](#projeto-no-modo-local) |
| `pnpm dev` refuses to start, saying `BRABO_PROJECTS_BASE` overlaps the Brabo checkout | [Project in Mounted mode: the projects base](#projeto-no-modo-local) |
| `brabo-runner` exits with `base de projetos recusada`, or prints `base de projetos: nenhuma configurada` when I expected a base | [The runner's base of projects](#base-do-runner) |
| `brabo-runner` sits printing `nada a atender AINDA`, or the machine unit is up but no project is being served | [The machine agent](#agente-de-maquina) |
| `systemctl --user status` says `Loaded: bad-setting` / `WorkingDirectory= path is not absolute`, and the agent service never starts | [The unit is `bad-setting`](#unit-do-agente-nao-inicia) |
| I need a device key for the machine and there is no browser (a fresh install, a headless box) | [Device key from the terminal](#chave-de-dispositivo-pelo-terminal) |
| the installer finished with a **"O que ficou pendente"** block, or a fresh install has no account, no machine key, or no agent service | [When the installer does not close the installation](#instalador-nao-fecha) |
| the project folder never appears on the user's machine, and the engine log says `workspace_create: o projeto <id> não criou pasta` | [The project folder never appears](#pasta-do-projeto-nunca-aparece) |
| a dev agent in a `runner` project is blocked preparing its worktree, naming `credencial-nao-atravessa-o-container`, with origin `politica` | [Authenticated clone in Runner mode](#credencial-nao-atravessa-o-container) |
| `apps/api/dist`/`node_modules`, or a file an agent wrote to a project folder, is owned by `root` and I can't edit it without `sudo` | [Dev containers write as your user, not root](#dev-containers-nao-root) |
| I want to bring up the container broker, or it answers `permission denied` on the Docker socket | [The container broker](#broker-de-container) |
| provisioning a repository fails with `permission denied: /data/git-repos/<slug>.git`, or `permissions.json` can't be written | [Dev containers write as your user, not root](#dev-containers-nao-root) |
| I want to wipe the dev database and start over, or `reset-total.sh` stopped in the middle | [Total reset of the dev environment](#reset-total) |
| the web shows **429 (rate limit)** for no apparent reason, or a project in `runner` mode looks "no local agent" while `brabo-runner` is running | [The runner floods the api with a dead ticket](#runner-com-ticket-morto) |

Two things worth knowing before any procedure:

- **Silence isn't health.** Alert rules live in Grafana, not Prometheus
  ([ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md)):
  Grafana being down means no warning, not no problem.
- **Killing the pod doesn't close a session.** `kubectl delete pod` without
  draining creates an orphan. The path is always the normal transition.

### The container broker {#broker-de-container}

The broker ([ADR 0130](adr/0130-broker-de-container.md)) is the only process in
the product that talks to a Docker daemon, and the only service with
`/var/run/docker.sock` mounted. **Do not mount that socket anywhere else.**

**Locally it comes up with `pnpm dev`; in production it does not.** That
asymmetry is a decision ([ADR 0146](adr/0146-base-consentida-no-bootstrap.md),
point 3), not an oversight — do not "uniformize" the two compose files. Whoever
runs `pnpm dev` **already holds the Docker socket** (they are running
`docker compose` against their own host's daemon), so the broker receiving it
grants nothing the operator does not already have. In production the socket is
a real privilege boundary and the operator is not the developer, so there it
stays under `profiles: ["container-broker"]`.

Until that decision the broker was off by default in both files, on the grounds
that "nothing calls it yet". That stopped being true: it has four real callers
([ADR 0133](adr/0133-infra-elege-imagem-do-roteamento.md)/
[0136](adr/0136-pagina-global-de-containers.md)), and
[ADR 0144](adr/0144-a-segunda-raiz-do-broker.md) made **Mounted** mode bring its
container up *through* the broker — so with the profile off, the default local
mode ended in `BrokerIndisponivelError`. That failure is still what you get when
the broker is genuinely absent: a NAMED `failed`, never a crash, and never a
silent fallback to running outside a container.

What you still have to set is the gid — and getting it wrong does **not** break
the boot, it breaks the use:

```bash
# the gid of your host's docker group — the compose default (999) is the most
# common one and is wrong on several distributions
getent group docker | cut -d: -f3

# in .env
#    DOCKER_GID=<the number above>
#    PROJECT_WORKSPACES_HOST_DIR=/home/you/brabo-projects    # ALREADY EXPANDED; derives HOST_ROOT
#    GIT_LOCAL_REPOS_HOST_DIR=/home/you/brabo-projects-bare
#    BRABO_PROJECTS_BASE=/home/you/projetos-brabo            # derives HOST_BASE

docker compose -f docker/docker-compose.yml --env-file .env up -d api engine broker
```

`BROKER_URL` is **not** on that list any more: the dev compose defaults it to
`http://broker:8090`, the service it brings up
([RN-599](business-rules/infra.md#rn-599)). Before that default, the api answered
`brokerConfigurado: false` next to a healthy broker and project creation only
offered `runner`. A value in `.env` still wins; the production and installation
composes keep no default, on purpose.

The project container runs as the **owner of the project folder** ([ADR 0180](adr/0180-container-com-o-dono-da-pasta.md), [RN-627](business-rules/contracts.md#rn-627)): the api reads the folder's uid and gid and the broker starts it with `--user <uid>:<gid>` and `HOME=/tmp`. That is what lets a dev agent write to `/work` under `--cap-drop ALL`. Two things to know when it does not: a folder owned by root, unreadable or absent falls back to the previous behaviour (root inside the container, no write to a folder of another uid — `npm install` answers `EACCES`); and a container that already exists only changes when it is recreated (`container_remove`, then `container_start`).

`pnpm dev` also **reports** the managed folder on every run (RN-599): with
`PROJECT_WORKSPACES_HOST_DIR` unset, `api`/`engine` use the managed volume, the
broker gets no `PROJECT_WORKSPACES_HOST_ROOT`, and `container_start` ends
refused — with the stack healthy. It also reports a `~` in the path (Compose
expands it in the bind mount, not in the broker's variable) and an explicit
`PROJECT_WORKSPACES_HOST_ROOT` that differs from the folder the api mounts.
Like the gid report, it never blocks and never writes `.env`; switching from the
volume to a folder does not migrate the volume's content — see
[migrating workspaces](#migrar-workspaces-pasta-local).

`pnpm dev` **reports** the state of `DOCKER_GID` on every run
([RN-512](business-rules/infra.md#rn-512)), comparing it against your machine's real
group, precisely so the mismatch is not discovered much later — when someone
proposes `container_start` and every operation dies with `permission denied` on
the socket. The report never blocks, and on a machine with no `docker` group at
all (Docker Desktop, rootless) it says the question does not apply rather than
accusing you of a defect.

In production, bring it up explicitly:

```bash
docker compose -f docker/docker-compose.prod.yml \
  --profile container-broker up -d broker
```

In an **installation** made by `install.sh` the broker is the same service,
from the published image, and the installer asks whether to turn it on — see
[the broker in an installation](#broker-na-instalacao)
([ADR 0162](adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)).

**The broker has TWO roots, and neither stands in for the other**
([RN-503](business-rules/api.md#rn-503),
[ADR 0144](adr/0144-a-segunda-raiz-do-broker.md)).
`PROJECT_WORKSPACES_HOST_ROOT` is where **Container**-mode projects live;
`BRABO_PROJECTS_HOST_BASE` is where **Mounted**-mode projects live, and the
compose derives it from `BRABO_PROJECTS_BASE`, so setting the base is normally
all you do. Whichever is missing, the refusal names it and touches no
container. A fallback to the other root would mount the wrong project's folder
— the managed root is named by `workspace_dir_name`, the base is named by you,
and the same name means different folders in each.

To check that it is up — from the api, which is the ONLY service that reaches
it (the `broker` network is `internal: true` and the service publishes no port,
so `curl` from your host will not work, and that is the point):

```bash
docker compose -f docker/docker-compose.yml --env-file .env exec -T api \
  node -e "fetch('http://broker:8090/health').then(r=>r.text()).then(console.log)"
# expected: {"status":"ok","servico":"broker"}
```

`/health` speaks about the PROCESS, never about the daemon. Restarting the
broker does not fix a Docker that is down, and a healthcheck that failed for
that reason would produce a restart loop that resolves nothing.

**The local image installs its dependencies at BUILD time, and that is not an
optimization.** The broker's only network is `internal: true`, so there is no
reachable registry at runtime: an image that ran `corepack`/`pnpm install` on
start died with `getaddrinfo EAI_AGAIN registry.npmjs.org` and exited 1. The
fix took the registry out of the runtime path (`pnpm install` as a build step)
rather than opening the network — the network is the first of the five
containment layers. Since AT-360 no image uses corepack (Node 25+ no longer
ships it): every Dockerfile installs pnpm from the registry tarball, checked
against a sha512 recorded in the Dockerfile (`PNPM_SHA512`), into
`/usr/local/bin`. Its version matches `packageManager` in `package.json`, so
pnpm never tries to download anything at runtime — measured with the dev image
under `--network none`: `pnpm --version` prints `11.3.0` and `/health`
answers. Bumping pnpm means changing `packageManager`, `PNPM_VERSION` and
`PNPM_SHA512` (`npm view pnpm@<v> dist.integrity`, in hex) together.

Two consequences you will meet:

- **The three `node_modules` are named volumes mounted over what the image
  installed**, and Docker only seeds a volume from the image when the volume is
  EMPTY. `docker/broker/entrypoint.sh` therefore reconciles them against a copy
  kept outside `/workspace`, stamped with the sha256 of the `pnpm-lock.yaml`
  the image was built from. First boot after a `--build` logs
  `sincronizando…` and takes a few seconds; the ones after log nothing.
- **Changing a broker dependency requires `up -d --build broker`.** The
  entrypoint compares its stamp with the working tree's lockfile and WARNS when
  they differ. It warns instead of refusing to boot: the broker has no runtime
  dependency beyond the workspace link to `@brabo/docker-port`, and trading a
  warning for an outage would be worse.

The service also has a **healthcheck** (`wget` against `127.0.0.1:8090/health`
from inside the container — it publishes no port, and `node:26-alpine` has no
`curl`). Without it `up --wait` reported `Healthy` the moment the container
started, so `scripts/dev/reset-total.sh` announced "reset complete" with a
broker that had died five seconds earlier.

**Symptoms and what each one means:**

| what you see | what it is |
|---|---|
| `permission denied` on `/var/run/docker.sock` | wrong `DOCKER_GID`. The socket is `root:docker` and the broker runs non-root; redo step 1 above and recreate the container (`up -d --force-recreate broker`) |
| `não encontrei o executável docker no PATH` | the image was built without `docker-cli`. Rebuild it (`--build`). This error is deliberately SEPARATE from "daemon down": installing and starting are different fixes |
| `getaddrinfo EAI_AGAIN registry.npmjs.org` and the container exits 1 | a broker image built before the dependencies moved to build time. Rebuild it (`up -d --build broker`). Do NOT give the service egress: the `internal: true` network is the containment, and the registry is what has to leave the runtime path |
| `AVISO — pnpm-lock.yaml mudou desde o build desta imagem` | the image is older than the working tree's lockfile. It keeps running (the broker has no runtime dependency beyond the workspace link); rebuild when you actually changed a broker dependency |
| `PROJECT_WORKSPACES_HOST_ROOT não está definida` on `start` | expected, and the refusal is the correct behaviour. `-v` is resolved by the DAEMON against the HOST filesystem; guessing would mount an EMPTY folder and the dev agent would work in a directory with no code. The other four operations keep working without it |
| the lifecycle route says `naoObservado: "broker-nao-configurado"` | `BROKER_URL` is empty on the **api**. That is a normal state, not a failure — the read declares that it did not look instead of inheriting the recorded state ([RN-486](business-rules/api.md#rn-486)) |
| the lifecycle route says `naoObservado: "broker-sem-resposta"` | `BROKER_URL` is set and nothing answered: the profile is probably off, or the api is not on the `broker` network. If `detalhe` says ``não respondeu `inspect` dentro do teto desta operação (5000ms)``, the broker IS reachable and slow — look at the daemon, not the network ([RN-604](business-rules/api.md#rn-604)) |
| a terminal command or `container_start` fails with ``não respondeu `exec` dentro do teto desta operação`` (or `start`/`stop`/`remove`) | the api stopped waiting at that operation's own ceiling, not because the broker is down ([RN-604](business-rules/api.md#rn-604)). For `exec` the command may still be running inside the container; for `start`/`stop`/`remove` the effect may have happened — check `/containers` before repeating. A `start` whose image pull takes more than 30s is cut by the broker itself — that one has its own row below |
| a dev agent's terminal result says ``o comando passou do teto de execução de terminal (120s, TERMINAL_ACTION_TIMEOUT_MS)`` | the command ran longer than `TERMINAL_ACTION_TIMEOUT_MS` (default 120 s since [RN-757](business-rules/engine.md#rn-757); it was 15 s) and the engine stopped waiting; the process may still be running in the container. The agent is told to rerun it under `nohup … &`. Raising the variable is possible, but above ~180 s the engine's outer wait (value + 120 s) passes the 300 s header limit of the api's Node `fetch` and the cut comes back |
| `container_start` fails with ``o `docker pull <imagem>` não terminou dentro do teto de 30000ms e foi cancelado`` (broker answers `504`, `origem: infra`) | the image is not on the daemon and its pull does not fit the 30s control ceiling. Killing the CLI cancels the pull, so the image is still absent — repeating does not help. Pull it on the host that runs the containers (`docker pull <imagem>`; in `runner` mode, on the user's machine) and approve the start again. Large images do not come up through this path on the first try, by the maintainer's decision ([RN-605](business-rules/contracts.md#rn-605)) |
| `BRABO_PROJECTS_HOST_BASE não está definida` on `start` of a **Mounted** project | same shape as the row above, other root. Set `BRABO_PROJECTS_BASE` in `.env` and recreate the broker; the compose derives this one from it ([RN-503](business-rules/api.md#rn-503)) |
| the broker answers `409` for a project in `runner` mode | expected. That folder lives on the user's machine and this host cannot see it — there, the runner is what brings a container up ([ADR 0137](adr/0137-o-runner-sobe-o-container-do-projeto.md)) |
| the broker answers `409` saying it doesn't know where the project folder is | a LEGACY **Mounted** project, created before the base existed and living outside it. The fix is to move the folder under `BRABO_PROJECTS_BASE`, not to change the project's mode — the message names the base and the path it saw ([RN-503](business-rules/api.md#rn-503)) |

**The broker never brings a container up on its own.** There is no loop and no
queue: it acts when called, and every write call originates from a
`proposed_action` a human approved.

### Migrating workspaces to a local folder {#migrar-workspaces-pasta-local}

Setting `PROJECT_WORKSPACES_HOST_DIR`/`GIT_LOCAL_REPOS_HOST_DIR`
([Getting started](getting-started.md#local-folder-for-workspaces)) swaps the
Docker volume for the given folder — but it does **not copy** what already
existed in the old volume. Anyone with projects already created who doesn't
want to lose the work needs to copy the content before switching:

```bash
pnpm dev:down
docker run --rm \
  -v brabo-dev_project_workspaces:/de \
  -v "$(realpath ~/brabo-projetos)":/para \
  alpine sh -c 'cp -a /de/. /para/'
docker run --rm \
  -v brabo-dev_git_local_repos:/de \
  -v "$(realpath ~/brabo-projetos-bare)":/para \
  alpine sh -c 'cp -a /de/. /para/'
# set the two variables in .env, then:
pnpm dev
```

The volume name (`brabo-dev_project_workspaces`) carries the Compose project's
prefix (`name: brabo-dev` in `docker/docker-compose.yml`, [ADR
0170](adr/0170-compose-de-dev-brabo-dev.md)) — check with `docker volume ls`.
A dev environment from before ADR 0170 still has its data under `brabo_*`: see
[Moving a dev environment to brabo-dev](#dev-para-brabo-dev) first. The old volume keeps existing
afterward (Compose doesn't delete a volume that fell out of use); remove it
with `docker volume rm` once you're sure the copy worked.

### Project in Mounted mode: the projects base {#projeto-no-modo-local}

**Symptom:** the project wizard doesn't offer **Mounted** at all; or it
does, and the api responds `400` saying the folder *doesn't exist from
inside the api*.

Both come from the same fact: a project in Mounted mode keeps its code in a
folder of **yours**, and the api and the engine can only reach it if it is
mounted into their containers. What changed
([ADR 0141](adr/0141-base-unica-dos-projetos-montados.md),
[RN-500](business-rules/api.md#rn-500)) is who arranges that, and how often:
there is now **one base**, configured once by the operator, and every
mounted project lives underneath it. You never edit compose per project
again.

**What to do — once, for the whole installation.** The supported path is the
consent step ([ADR 0146](adr/0146-base-consentida-no-bootstrap.md)), which
proposes a folder, refuses one that overlaps the Brabo checkout or
`PROJECT_WORKSPACES_HOST_DIR`, proves on macOS/Windows that Docker can see it,
creates it and writes the variable:

```bash
node scripts/dev/consentir-base.mjs
```

Run it in **your** terminal. `pnpm bootstrap` → *Docker › Base de projetos*
runs the same script but can only **report**: every menu item runs with stdin
from `/dev/null` on purpose, so it cannot ask a question.

Writing the line by hand still works:

```bash
# .env — an ABSOLUTE path. `~` is NOT expanded by Compose.
BRABO_PROJECTS_BASE=/home/voce/projetos-brabo
```

```bash
docker compose -f docker/docker-compose.yml --env-file .env up -d api engine
```

That's it. From here on, a project in Mounted mode goes somewhere under
`/home/voce/brabo` and needs no further setup.

**The folder itself does not need to exist yet**
([ADR 0142](adr/0142-validacao-de-workspace-montado-adiada.md),
[RN-501](business-rules/api.md#rn-501)). Creating a Mounted project validates
only the path FORMAT plus "is it under the base"; the folder is created
later, when Infra starts the project's container — which is what makes the
wizard able to SUGGEST `<base>/<project slug>` in the first place. Between
those two moments `workspacePath` points at a folder that isn't there yet,
and the project's `workspaceVerifiedAt` is `null`; converting an existing
project to Mounted is the one exception and creates the folder right away,
because it moves `permissions.json` into it.

So a `400` at creation now means one of two things only, and both name what
they mean: the path is not under the base (the message names the base and
suggests `<base>/<name>`), or `BRABO_PROJECTS_BASE` isn't configured at all
(the message says the MODE is unavailable on this installation). A folder
the api cannot create or reach shows up later instead, as a NAMED `failed`
on the `container_start` action — never a 500, and the container lifecycle
is not marked `provisioning` when that happens.

**Mounted projects get a real container, and it runs on the SERVER**
([RN-503](business-rules/api.md#rn-503),
[ADR 0144](adr/0144-a-segunda-raiz-do-broker.md)). Because the base is
reachable by the host's Docker daemon, `container_start` for a Mounted project
goes to the [broker](#broker-de-container), exactly like Container mode — it no
longer requires a `brabo-runner` connected. Only **Runner** mode still goes to
the runner, on the user's own machine, because that folder is somewhere this
server cannot see. Locally the broker is already up — it comes with `pnpm dev`
since [ADR 0146](adr/0146-base-consentida-no-bootstrap.md), precisely because
this is the default mode's path; in production it still needs
`--profile container-broker`. That same step is when the folder above gets
created, in that order: the daemon can only bind-mount a folder that already
exists.

**Why the wizard hides Mounted mode.** Without `BRABO_PROJECTS_BASE`, the
api reports `projectsBase: null` and the option is not offered at all. That
is deliberate: offering a mode the installation cannot honor produces a
project that gets stuck later, on the first tool of the first agent, far
from the screen where the decision was made. Container mode (the default)
and Runner mode are unaffected and keep working without this variable.

**Why the same path on both sides.** The base is mounted by **identity** —
`/home/voce/brabo:/home/voce/brabo` — in `api` and `engine` alike. The path
is written ONCE to `projects.workspace_path` and read by both processes
([RN-169](business-rules/api.md#rn-169)); it is also the string
the screen shows back to you. Mounting it somewhere else would make the
engine write where the api doesn't read, and would make the screen show a
path that exists on neither your machine nor theirs.

**Check what the containers actually see:**

```bash
docker compose -f docker/docker-compose.yml exec api    ls -la /home/voce/brabo
docker compose -f docker/docker-compose.yml exec engine ls -la /home/voce/brabo
```

**Don't point the base at Brabo's own checkout.** `pnpm dev` refuses to
bring the stack up when `BRABO_PROJECTS_BASE` contains, or is contained by,
the repository you cloned — it names both paths and stops. This check lives
in the preflight and nowhere else on purpose: the api compares a project
path against `process.cwd()`, which inside its container is `/workspace`,
so it has no way to see your real checkout. Without the preflight guard,
cloning Brabo into `$HOME/brabo` and setting the base to the same folder
passes every validation and has dev agents running inside the product's own
tree — the failure
[ADR 0055](adr/0055-escopo-de-caminho-na-politica-de-terminal.md) exists to
prevent.

**Pick a dedicated folder.** Everything under the base is reachable from
inside the product's containers. Don't point it at your whole `$HOME`, and
don't point it at a folder that holds other secrets of yours.

**Other refusal modes, and what each one means:**

| the message says | what to do |
|---|---|
| Mounted mode isn't offered at all | `BRABO_PROJECTS_BASE` isn't set — set it and `up -d api engine` |
| *Mounted mode is not available on this installation* (at creation) | same cause, said by the api: `BRABO_PROJECTS_BASE` isn't set (RN-501) |
| *the folder must sit inside `<base>`* (at creation) | the path is outside the base; use the `<base>/<name>` the message suggests, or change the base and `up -d api engine` |
| *I couldn't create/reach `<path>` from inside the api* (on `container_start`) | the base isn't actually mounted, or the folder's owner on the host blocks it. Check with the `exec ls` above, fix it, and approve `container_start` again (RN-501) |
| *doesn't exist from inside the api* | the base isn't mounted into the containers; check with the `exec ls` above |
| *exists but isn't a folder* | the path points to a file; use a folder |
| *the process can't write to it* | owner/permission of the folder on the host. Images run non-root ([ADR 0024](adr/0024-fase5-imagens-producao-ci.md)); adjust the folder's owner or mode |
| *Invalid path for a Local project* | it's a filesystem root, a system folder, relative, has `..`, or overlaps Brabo's own checkout — pick your own folder, outside those ([ADR 0072](adr/0072-projeto-local-ou-container.md)) |

**Known limits, stated rather than hidden.** A symlink under the base
pointing outside it resolves differently inside the containers, since the
target isn't mounted — the folder browser refuses to descend into symlinks,
and the disk check catches the divergence as a named failure. And this
version supports **one** base: code living somewhere else has to be moved
under it.

**Migrating from the old per-project mounts.** If you have hand-written
`- /home/voce/projetos/loja:/home/voce/projetos/loja` lines in `api` and
`engine`, they keep working and nothing removes them — existing projects
are not broken by this change. The supported path from here on is the base;
move those folders under it and drop the hand-written lines when you get
the chance.

**Don't confuse this with Container mode.** A project in Container mode
(the default) keeps using `PROJECT_WORKSPACES_ROOT` and the migration
procedure above; Mounted mode never touches that root, and the base is
never the same folder as that root ([ADR 0141](adr/0141-base-unica-dos-projetos-montados.md)
explains why conflating them would let two projects land in one folder).

### The runner's base of projects {#base-do-runner}

**Symptom:** `brabo-runner` exits with code 2 saying
`base de projetos recusada (…)`, or it starts printing
`base de projetos: nenhuma configurada` when you expected a base, or it says
it is `Seguindo SEM base`.

This is a **different base** from the one in
[Project in Mounted mode](#projeto-no-modo-local). That one
(`BRABO_PROJECTS_BASE`) belongs to the SERVER and is the only folder the
containers can see; this one belongs to the **user's machine** and is where
the local agent creates the folder of each project
([ADR 0151](adr/0151-base-consentida-no-runner.md),
[RN-529](business-rules/runner.md#rn-529)). They are never the same variable, never
the same file, and never validated against each other.

Where the runner reads it from, in order:

1. `--base <absolute path>` on the command line;
2. `$XDG_CONFIG_HOME/brabo/runner.json` — falling back to
   `~/.config/brabo/runner.json` — with the shape `{"base": "/abs/path"}`.

```bash
cat "${XDG_CONFIG_HOME:-$HOME/.config}/brabo/runner.json"
# {"base":"/home/you/projetos-brabo"}
```

**No base at all is normal.** A runner without one keeps serving its project
exactly as it always did; what it can't do is host a project folder created
later. The startup line says which of the two states you're in, always.

That folder is no longer configuration only: since
[RN-551](business-rules/runner.md#rn-551) it is also where
`brabo-runner device-key create` puts the machine's **private** device key
(`brabo-runner-device-key.jwk.json`, mode 600) — see
[Device key from the terminal](#chave-de-dispositivo-pelo-terminal). Back it up
the way you'd back up a secret, or don't back it up at all and re-pair: the key
is revocable and replaceable, and nothing else in the product can read it.

**Refusals, and why the disposition differs.** The base is refused when it is
relative, has `..`, is `/`, points at an existing file, sits outside `$HOME`
on Linux (the same rule `--dir` has had since
[RN-434](business-rules/runner.md#rn-434)), or is **inside** the current project's
folder (or equal to it) — that last one would make every new project be born
inside this one. Coming from `--base`, that ends the process with code 2;
coming from the file, it is printed on `stderr` and the runner **carries on
without a base**, because killing an agent that is serving a project over a
setting it doesn't use yet would be out of proportion. A file that exists and
declares no `base` is absence, not a refusal.

**A project outside the base is not a problem.** `--dir` is validated exactly
as it always was and the base plays no part in it: the base is a rule of
CREATION. Do not "fix" a legacy project by moving it under the base to silence
something — nothing is complaining.

### The machine agent: one connection per project {#agente-de-maquina}

**Symptom:** `brabo-runner` was started without `--project` and either printed
the usage block, said `nenhum projeto em modo "runner" para esta conta`, or
served some projects and refused others.

Since [RN-544](business-rules/runner.md#rn-544)
([ADR 0154](adr/0154-chave-de-dispositivo-de-maquina.md)) running without
`--project` is a real mode: the agent asks `GET /runner/projects` and opens
**one connection per project**, rooted at `<base>/<workspaceDirName>`. The mode
with `--project` did not change at all. Reading the output:

- **`Sem --project, este runner só roda como agente de MÁQUINA…`** — there is
  no consented base. Both conditions are required and for different reasons:
  the machine credential is what the route accepts, the base is where each
  project's folder comes from. See [the base above](#base-do-runner).
- **`a api recusou a descoberta de projetos: esta credencial está presa a um
  PROJETO`** — a 403. The credential in use (a PAT, or a device key from the
  browser flow) names one project and has nothing to discover. Run it with
  `--project <projectId>` instead, or pair a machine key — the key material is
  made right here (`brabo-runner device-key create`, see
  [below](#chave-de-dispositivo-pelo-terminal)), and registering the public
  half is what the installer does. On disk the two species are the same file,
  so the runner does not guess: the server is the authority and its message is
  relayed verbatim.
- **`nenhum projeto em modo "runner" para esta conta — nada a atender AINDA`** —
  this is the **normal** state of a fresh install, and since
  [RN-550](business-rules/runner.md#rn-550) the process **stays up and keeps asking**:
  15s, then 30s, then 60s between calls, repeating forever, until the first
  project shows up. Nobody has to come back to the terminal — create the
  project in Runner mode on the web and the agent picks it up. The polling
  **stops** the moment the first connection is live: from then on the list is
  read only at start, because a list that comes back *smaller* is ambiguous and
  dropping a live connection over that ambiguity would trade a known state for
  a guess. Waiting has no ceiling; **failing does** — ten consecutive failed
  calls and the process exits 1 naming the count (any answer, empty included,
  resets the counter). Every 30 empty answers it prints a heartbeat saying how
  many calls there have been, so "waiting" never looks like "stuck" in
  `journalctl`. `Restart=on-abnormal` is unchanged in both unit species — it
  never looked at the exit code to begin with; what changes is that the machine
  unit is now genuinely `active (running)`, and `brabo-runner service status
  --machine` answers `rodando` (0) on a fresh install where it used to answer
  `parado` (3).
- **`[<projeto>] NÃO será atendido`** — that project's folder was refused (the
  segment escaped the base, or the target exists and is not a directory). The
  others keep going. Only if NONE is left does the process exit 1.
- **`[<projeto>] este projeto deixa de ser atendido — os demais continuam`** —
  the join was refused (usually a second runner already connected to that
  project) or the retry ceiling ran out. Both are per PROJECT now, not per
  process: one project failing no longer kills the agent for all the others.
  When every project has ended this way the process prints the outcome of each
  and exits 1.

Every line of the connection loop is prefixed with the project name. If a
message has no prefix, it came from the single-project mode.

### The unit is `bad-setting` and never starts {#unit-do-agente-nao-inicia}

**Symptom:** `service install` reported success, the unit file is on disk, and
yet nothing runs:

```
$ systemctl --user status brabo-runner.service
   Loaded: bad-setting (Reason: Unit brabo-runner.service has a bad unit file setting.)
   Active: inactive (dead)
brabo-runner.service:16: WorkingDirectory= path is not absolute: "/home/<you>/.config/brabo"
```

**Cause.** Units written **before** this fix quoted the working directory
(`WorkingDirectory="/home/…"`). The two halves of a unit file do not share one
syntax: `ExecStart=` is parsed with unquoting and word splitting, so each
argument is quoted; `WorkingDirectory=` is **not** — systemd takes the rest of
the line as the path. With the quotes the value no longer begins with `/`, the
unit is refused at load time, and it **never starts** — in either species
(per project and per machine alike, [RN-518](business-rules/runner.md#rn-518) and
[RN-545](business-rules/runner.md#rn-545)).

**Fix: reinstall.** `service install` overwrites the whole file, so there is no
repair step and nothing to edit by hand:

```bash
brabo-runner service install --machine \
  --dir "${XDG_CONFIG_HOME:-$HOME/.config}/brabo" \
  --api-url http://localhost:3000
# or, for a per-project unit, from inside that project's folder:
brabo-runner service install
```

`status` and `uninstall` keep working on a unit that is in the broken state —
the folder is read back from either form — so nothing is stranded if you would
rather remove it first.

**Related, and different:** a unit that loads but comes up in the wrong folder.
`WorkingDirectory=` goes through **specifier expansion**, so a literal `%` in
the path has to be written `%%`; the CLI escapes it now, but a hand-edited unit
with `/home/you/50%off` will silently start in `/home/you/50<os-id>ff` —
absolute, accepted, and wrong. Check the resolved value, never the file:

```bash
systemctl --user show -p WorkingDirectory brabo-runner.service
```

The same holds for the **environment** the unit freezes (AT-095). Units written
before that fix carried `Environment=XDG_CONFIG_HOME=<folder>` and
`Environment=PATH=<path>` unquoted, and `Environment=` both splits on spaces
and expands specifiers: with `XDG_CONFIG_HOME=/home/you/50%off com espaco` the
service received `/home/you/50<os-id>ff` — it loads, it starts, and the
per-machine agent looks for its base and device key in a folder that does not
exist, without a word. The CLI now writes the whole assignment quoted
(`Environment="XDG_CONFIG_HOME=…"`, with `\`, `"` and `%` escaped). **Fix:
reinstall**, as above. Check what systemd resolved:

```bash
systemctl --user show -p Environment brabo-runner.service
```

### Device key from the terminal {#chave-de-dispositivo-pelo-terminal}

**Symptom:** a machine needs a device key and there is no browser to run the
project screen's automatic setup — a fresh install, a headless box, or the
machine agent above refusing with `esta credencial está presa a um PROJETO`.

Since [RN-551](business-rules/runner.md#rn-551)
([ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md) point 4) the pair
is generated **on the machine**, in two steps:

```bash
# 1) generate here; the PUBLIC JWK is the only thing on stdout
PUB=$(brabo-runner device-key create)

# 2) register that public key with the api — whoever holds the credential to
#    register does this; the CLI never talks to the api
ID=$(… POST {"name":"…","publicKeyJwk":'"$PUB"'} … | jq -r .id)

# 3) stamp the registration id as the JWK's `kid` and write the real file
brabo-runner device-key finish --id "$ID"
```

- **Two steps, because of the `kid`.** It IS the registration id on the server
  ([RN-475](business-rules/web.md#rn-475)) and only exists after the public half is
  registered; a private key written before it is useless and the CLI refuses it
  forever. So `create` writes `brabo-runner-device-key.jwk.json.parcial`, a
  name the reader ignores, and `finish` writes the real one. **The file the
  runner reads never exists without a `kid`** — an interruption between the two
  leaves a `.parcial` the runner ignores and the next `create` names.
- **Where:** `$XDG_CONFIG_HOME/brabo/` (else `~/.config/brabo/`), next to
  `runner.json`, at mode 600; `--dir <folder>` writes somewhere else (a project
  folder, say). That folder is what the machine unit's `--dir` should point at
  (`brabo-runner service install --machine --dir <folder>`,
  [RN-545](business-rules/runner.md#rn-545)) — the runner reads the key from the
  folder it RUNS in, never from a global path it guesses.
- **stdout is for scripts, stderr is for people.** `create` prints only the
  public JWK; `finish`, only the path of the finished file.
- **Refusals:** `finish` without a `create` (nothing to stamp), without `--id`,
  with an `--id` that still has the whole JSON response in it, a `.parcial`
  that isn't a private Ed25519 JWK, and — in both commands — a COMPLETE key
  already in place. That last one has no `--force`: replacing the key of an
  already-paired machine silently would leave an agent signing with a key the
  server doesn't know. Revoke the current key
  ([RN-519](business-rules/api.md#rn-519)), delete the file, then `create` again.
- The CLI does **not** claim which species the key is. On disk a machine key
  and a project key are the same file; the route that registered the public
  half is what decides.

### When the installer does not close the installation {#instalador-nao-fecha}

**Symptom:** `install.sh` ended with a **"O que ficou pendente"** block, or a
fresh install has a login nobody can get through, no machine device key, or no
agent service running.

Since [RN-547](business-rules/produto.md#rn-547)
([ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)) the installer
**closes** the installation: it creates the first account, registers this
machine's device key and installs the machine unit. The chain is

1. `POST /internal/first-account` ([RN-546](business-rules/produto.md#rn-546)) — the
   account is born **already verified**, because `MAIL_TRANSPORT` is `log` and
   the installer does not turn SMTP on;
2. `brabo-runner device-key create` ([RN-551](business-rules/runner.md#rn-551)) — the
   Ed25519 pair is generated **on the machine**; only the public half travels;
3. `POST /internal/machine-device-keys` ([RN-552](business-rules/api.md#rn-552)) —
   the returned `id` is what becomes the private JWK's `kid`
   ([RN-475](business-rules/web.md#rn-475));
4. `brabo-runner device-key finish --id <id>`;
5. `brabo-runner service install --machine` ([RN-545](business-rules/runner.md#rn-545)).

**Nothing is ever undone, and every failure is named.** The installer always
exits 0: the compose is up, and the links already completed are useful on their
own. What failed is printed at the end with the exact command to repeat.

- **`service install --machine` refused.** This is the **common** case on a
  developer machine, not an edge one: it refuses when a **per-project** unit is
  already installed, and there is no `--force` — two processes would fight over
  the same project and the server would deny one of them. The refusal names the
  `uninstall` of each unit it found. Remove them, then rerun the last step, which
  the installer printed:

  ```bash
  brabo-runner service uninstall --project <projectId>   # for each one named
  brabo-runner service install --machine \
    --dir "${XDG_CONFIG_HOME:-$HOME/.config}/brabo" \
    --api-url http://localhost:3000
  ```

  The folder in `--dir` is where the key was written — never a project folder,
  which would carry a `brabo-runner.config.json` and make the unit come up in
  **project** mode, silently serving one project while calling itself the
  machine agent.

- **Registering the key failed.** A `…jwk.json.parcial` is left behind on
  purpose. It is inert — the runner does not read that name — and the installer
  does **not** delete it: a timeout after the api committed is indistinguishable
  from one before it, so that file may be the only copy of the private half of a
  key that is already registered. Rerun the installer, or finish it by hand if
  you know the registration id (`brabo-runner device-key finish --id <id>`). The
  next `device-key create` names it and replaces it.

- **The account step said the installation already has a user.** That is a
  `409`, and it is the **expected** outcome, not a failure — a second run, or a
  migration ([RN-530](business-rules/infra.md#rn-530)) whose restore brought the
  users back. Log in with the account that exists. The machine-key and service
  steps are skipped in that case by design: minting a durable credential for
  someone who did not ask for it in this run is not the installer's call.

- **The password was refused.** The policy is the domain one, the same
  registration uses, and it is only known after the POST — so the installer asks
  again, up to three times, and turns an exhausted ceiling into a pending line
  rather than aborting an installation that is already up. It never writes the
  password anywhere: not the `.env`, not the marker, not a log. Only the
  **e-mail** goes into the marker (`ownerEmail`, `schemaVersion: 3`).

- **No TTY.** The installer reports and exits **0** before writing anything.
  Run it from a terminal, as a downloaded file —
  `curl -fsSLO …/install.sh && bash install.sh` — never `curl … | sh` (the
  download becomes the process's stdin and kills every prompt) and never
  `sh -c "$(curl …)"`, which cannot verify its own hash. Both are refused by
  name; see [Installing](#instalando).

- **The agent is up but serving nothing.** That is the normal state of a fresh
  install: it waits and re-queries until the first `runner`-mode project exists
  ([RN-550](business-rules/runner.md#rn-550)). See
  [The machine agent](#agente-de-maquina).

### The project folder never appears on the user's machine {#pasta-do-projeto-nunca-aparece}

**Symptom:** a project folder was expected to show up under the runner's base
and it didn't. The engine log has a line starting with
`workspace_create: o projeto <id> não criou pasta —`, and the folder is
missing.

The message names which of the two pre-conditions failed
([RN-532](business-rules/runner.md#rn-532),
[ADR 0151](adr/0151-base-consentida-no-runner.md) points 3 to 6), and they are
the only two — **no container is required**, deliberately: requiring one would
be circular, since a `runner` project only reaches a registered `running`
container after the runner brings it up over the very folder this message
exists to create.

- **`nenhum brabo-runner está conectado a este projeto agora`** — start the
  agent for that project; see [the base above](#base-do-runner) for the flags.
- **`não declarou a capacidade `workspace` no join`** — the connected binary
  either predates this version, or is running **without a consented base**.
  Both fixes are in the previous section: run the installer, or start the
  runner with `--base`. The refusal is named on purpose because the two causes
  have different fixes; the join itself is NOT refused, so the runner keeps
  serving its project normally.
- **`o brabo-runner recusou criar a pasta`** — the message carries the
  runner's own reason: `segmento` (the segment escaped the base — the guard
  refused, nothing was created), `nao-e-pasta` (the target already exists as a
  file; this CLI never overwrites one), `mkdir` (permission or disk) or `git`
  (the `git init`/clone failed — the folder DOES exist and no plan B was
  attempted, on purpose).
- **`não respondeu ... a tempo`** — a large clone can exceed the ceiling.
  Check the runner's machine; nothing is left half-written on the server side,
  because the write only happens through `workspace_confirm`.

A folder that already exists as a git repository is a **success**, not an
error: the operation is idempotent and reports `ja-era-repositorio` in the
runner's log.

### Authenticated clone in Runner mode is refused while the container is up {#credencial-nao-atravessa-o-container}

**Symptom:** a dev agent in a `runner` project is blocked preparing its
worktree, and the diagnosis says the credential could not be delivered, naming
`credencial-nao-atravessa-o-container`. The blocked task's origin is
`politica`, not `codigo`.

**This is not a bug to chase, and that is exactly what the origin is telling
you** ([RN-558](business-rules/runner.md#rn-558)). The credential for an authenticated
remote (`ADR 0056`) can only travel in the `env` field of the `exec` message,
and that field applies to the **host** path only: the product's Docker port has
no `env` field, deliberately ([ADR 0130](adr/0130-broker-de-container.md), no
free `-e`). When the runner has brought the project's container up, it routes
every command into it — so the credential has nowhere to go.

Before RN-558 the command ran anyway, with the variables empty, and you saw a
plain authentication failure. Now it is refused before executing, and nothing
runs. The refusal never prints variable names or values, only the count.

**Since [ADR 0193](adr/0193-git-credenciado-no-host-do-runner.md)
([RN-676](business-rules/runner.md#rn-676)) this refusal no longer happens on the
common path:** the engine marks the authenticated `fetch` (`gitCredenciado`)
and a current runner runs it on the **host** even with the container up — the
same folder, mounted at `/work`. If you still see it, the connected
`brabo-runner` is older than that change and does not read the mark.

**What to do:**

1. Update the `brabo-runner` on the user's machine and restart it (or its
   service). That is the fix.
2. If you cannot update right now: stop the project's container (the
   `/containers` page, "Parar") and let the worktree materialise — on the host
   path the credential is delivered normally, and the initial `fetch`
   succeeds. Then bring the container back up; the clone is idempotent and is
   not repeated.

A **local** repository (no token) is unaffected, and so are `container` and
`mounted` projects — they never go through this path. So is
`workspace_create`, which runs on the host.

**What is still open, declared:** the credential continues not to cross the
`docker exec`. Closing that means deciding how a credentialed operation talks
to a `docker exec` with no `env` field, and every known option touches the
containment boundary — an ADR, not a fix in passing.

### Dev containers write as your user, not root {#dev-containers-nao-root}

**Symptom:** something the `api`, `web` or `engine` dev container wrote to a
bind mount — `apps/api/dist`, `node_modules`, a file an agent generated
inside a project in `mounted` execution mode — is owned by `root` on your
disk, and editing or deleting it without `sudo` fails.

This used to be expected: the dev images (`docker/api/Dockerfile`,
`docker/web/Dockerfile`, `docker/engine/Dockerfile` — unlike `Dockerfile.prod`,
already non-root since [ADR 0024](adr/0024-fase5-imagens-producao-ci.md)) had
no `USER` directive and ran as root. They now run as the **same UID/GID as
your host user**, via `DEV_UID`/`DEV_GID` build args
([Configuration](reference/configuration.md#dev-container-user-build-time)),
so this class of problem shouldn't recur.

**If you're still seeing it:**

1. Confirm your pair with `id -u`/`id -g`. If it isn't `1000`/`1000`, set
   `DEV_UID`/`DEV_GID` in `.env` (see `.env.example`) and rebuild:
   `docker compose -f docker/docker-compose.yml build api web engine`.
2. **Environment that predates this fix.** The named volumes
   (`*_node_modules`, `engine_build`, `engine_deps`, `engine_mix`,
   `engine_hex`) still hold content written by the old root containers — a
   brand-new named volume inherits the right owner on first mount, but an
   existing one doesn't get fixed retroactively. Reset it once, either by
   dropping the volumes (`docker compose -f docker/docker-compose.yml down
   -v` — safe for these, they're reproducible build artifacts, never source
   of truth) or by `chown`-ing them in place:
   ```bash
   docker run --rm -v brabo-dev_api_app_node_modules:/v alpine chown -R "$(id -u):$(id -g)" /v
   # repeat for the other node_modules/_build/deps/.mix/.hex volumes
   ```
   **Brand-new volumes** (a first clone, or a machine that only ran the
   installer, which defines none of these volumes) used to fail the other way:
   `api` and `web` exited with `EACCES: permission denied, mkdir
   '/workspace/node_modules/.pnpm'`, because a new volume inherits its owner
   from the path **in the image** and the path did not exist there, so it was
   born `root:root` (AT-172). `docker/api/Dockerfile` and `docker/web/Dockerfile`
   now create and `chown` the three `node_modules` mount points before `USER`.
   The mount points **inside the bind mount on your disk** are a separate
   half: Docker creates a missing one on the host as `root` (it left
   `packages/shared/node_modules` root-owned in the checkout), and no image can
   change that. `pnpm dev` runs `scripts/dev/preflight.mjs`, which creates them
   as you first; `docker compose up` run by hand skips it, so run
   `pnpm dev:preflight` once before your first hand-run `up`.
3. For a file already written by an agent into a **`mounted`**-mode project
   folder on the host, the fix is the same `sudo chown -R $USER <folder>`
   this section used to prescribe for the whole repo — it's now a one-off
   for pre-existing files, not the standing workaround.

4. **The two DATA volumes are a different case, and `down -v` is NOT safe for
   them.** `/data/git-repos` and `/data/project-workspaces` are mounted into
   `api` and `engine` as named volumes. A named volume is born owned by
   whatever exists at that path **in the image** — and when the path doesn't
   exist, it is born `root`, leaving the non-root process out. The dev images
   only started creating and `chown`-ing them before `USER` recently; the
   production images always did. The symptom is not a file you can't edit on
   your disk: it is `git init --bare` of the `LocalGitProvider` dying with
   `permission denied: /data/git-repos/<slug>.git`, and each project's
   `permissions.json` having nowhere to be written — that is, **provisioning
   a repository is impossible**.

   Unlike the build-artifact volumes above, these two hold source of truth
   (local bare repos, per-project worktrees), so dropping them loses data.
   Fix them in place:
   ```bash
   docker run --rm -v brabo-dev_git_local_repos:/v alpine chown -R "$(id -u):$(id -g)" /v
   docker run --rm -v brabo-dev_project_workspaces:/v alpine chown -R "$(id -u):$(id -g)" /v
   ```
   A volume created after the fix already comes up with the right owner. When
   you add a **new** named volume, create the directory in the image:
   forgetting it is not a build error, it is a runtime `permission denied`.

### Total reset of the dev environment {#reset-total}

```bash
bash scripts/dev/reset-total.sh      # or: pnpm bootstrap → Docker › Reset total
```

Rebuilds the images, **wipes the database**, migrates and seeds again — the
provider credentials already in `.env` (`<PROVIDER>_TEST_KEY`) come back
active on the owner, so you don't retype them in the UI every time. It does
**not** remove or recreate any volume — `node_modules`, `_build`/`deps`,
`pgdata` (only the schemas inside it are dropped), `neo4j`, the local bare
repos and the project workspaces all survive — and it **says so** at the start
and next to the success line (AT-181). That is the conservative choice on
purpose: wiping volumes would throw away workspaces and local repositories
nobody asked to lose.

The price is that **a reset never reproduces a first clone.** A defect that
only shows up with a volume that does not exist yet — like the `node_modules`
volume that used to be born `root` (AT-172) — passes every reset unseen. To
exercise that path, use a **throwaway compose project**, never this script and
never your `brabo-dev` project (nor `brabo`, the installation's name):

```bash
docker compose -p brabo-primeiro-clone -f docker/docker-compose.yml build engine
docker compose -p brabo-primeiro-clone -f docker/docker-compose.yml \
  run --rm --no-deps engine ls -ldn /root/.mix /root/.hex \
  /workspace/apps/engine/_build /workspace/apps/engine/deps
docker compose -p brabo-primeiro-clone -f docker/docker-compose.yml down -v
```

`run` creates that project's volumes from scratch and publishes no port, so it
does not collide with your running stack. Measured this way for the engine on
2026-09-25 (AT-182): `_build`, `deps`, `.mix` and `.hex` are born owned by
`DEV_UID:DEV_GID`, and `mix local.hex`/`local.rebar`/`deps.get` pass as the
non-root user. Two things it does leave behind: the empty `_build`/`deps`
mount points it creates **inside your checkout**, owned by `root` (remove them
with the `alpine` one-liner in the table below), and the image it built.

**The order is the point, and it is not negotiable:**

0. **The installation guard** ([ADR 0170](adr/0170-compose-de-dev-brabo-dev.md)),
   before the preflight: if this machine has any container from the
   INSTALLATION compose (its `com.docker.compose.project.config_files` label
   points at `docker-compose.install.yml`), or if the dev compose would resolve
   to the project `brabo`, it refuses with `RESET NÃO COMEÇOU`, naming what it
   found. Until ADR 0170 dev and installation were the same Docker project, and
   this script's `DROP SCHEMA` would have landed on the installation's database.
1. `preflight`, then the **host prerequisites** (AT-203), then `build` — the
   slow part, done while your environment is still up. The migrations and the
   seed run on the HOST, with the checkout's `apps/engine/deps`/`_build` and
   `node_modules` — not the containers' volumes, and nothing the image build
   refreshes. So before any effect the script runs `mix deps.get` and
   `mix compile` in `apps/engine`, checks that `drizzle-kit` and `ts-node`
   resolve, and checks the Neo4j password against the volume's. Measured on
   2026-09-26: with a new dependency in `mix.lock` (mint 1.10.1, #613),
   `pnpm engine:migrate` died with `lock mismatch` **after** the
   `DROP SCHEMA`, and "run it again" failed the same way. A refusal here says
   `RESET NÃO COMEÇOU … Nada foi parado nem apagado`: the database is intact.
2. **`stop api engine`.** These two, and no others: they are the ones holding
   a live connection to the compose Postgres (the api's Drizzle pool over
   `public`/`drizzle`, the engine's Ecto/Oban over `engine`). `web` is a Vite
   server and talks to no database, `neo4j` is a different database this reset
   doesn't touch, and the `broker` only speaks HTTP to the api.
3. `up postgres`, `DROP SCHEMA`, `migrate`.
4. `up --wait` for everything, then `seed`.
5. Ask `/health` of the api and the engine and `/` of the web, print
   `docker compose ps`, and only then conclude.

Dropping the schemas **underneath live processes** is what used to break it:
the engine dies inside the `DROP SCHEMA engine CASCADE`
(`Engine.Sessions.Rehydrator` queries `engine.session_states`, which just
vanished — `ERROR 42P01 (undefined_table)`), the migrations recreate
everything afterwards, and **nothing brings a dead process back**. The seed
then failed on the step that activates the session (api → engine) with
`ECONNREFUSED`, and the script still printed "reset completo" — a fixed
`echo` at the end of a script that never asked anything about what it had
just done.

**If it stops in the middle**, it says so and names the step
(`RESET INCOMPLETO — parou em: <passo>`), and the answer is to **run it
again**: it drops the schemas every time, so the second run starts from the
same clean slate as the first. Running only `pnpm --filter api seed` to
recover is also safe now — the seed is idempotent and reuses the demo
workspace, project and session instead of duplicating them (and does **not**
re-append the session's 5 events).

| what you see | what it is |
|---|---|
| `RESET INCOMPLETO — parou em: migrations (api + engine)` with `permission denied` under `apps/engine/_build` | `pnpm engine:migrate` runs on the HOST, and Docker creates a missing bind-mount point as `root`. Fix it in place: `docker run --rm -v "$PWD/apps/engine:/x" alpine chown -R "$(id -u):$(id -g)" /x/_build` |
| `RESET INCOMPLETO … banco apagado, migrado e semeado, mas estes serviços não responderam: <lista>` | the database is fine; a process didn't come back. `docker compose -f docker/docker-compose.yml --env-file .env logs <serviço>` says why. Nothing here needs the reset to run again |
| `RESET NÃO COMEÇOU — recusado em: guarda da instalação na máquina (ADR 0170)` | nothing was touched. There is an installation of Brabo on this machine (the containers are listed), or `COMPOSE_PROJECT_NAME=brabo` is set. Bring the installation down **without** `-v` (the refusal prints the exact `docker compose -f <folder>/docker/docker-compose.install.yml --env-file <folder>/.env down` — its volumes and data stay) or unset the variable; see [Moving a dev environment to brabo-dev](#dev-para-brabo-dev) |
| `RESET NÃO COMEÇOU — recusado em: pré-requisitos de host das migrations` | nothing was touched. `mix deps.get`/`mix compile` failed in `apps/engine` on the host (read the output above it), or `drizzle-kit`/`ts-node` don't resolve — `pnpm install --frozen-lockfile` |
| `O NEO4J RECUSA A SENHA DO .env`, before any effect or after `container brabo-dev-neo4j-1 is unhealthy` | Neo4j stores the password in the `neo4j_data` volume when it is **created** and ignores `NEO4J_AUTH` afterwards, while the healthcheck uses the one in `.env`. Measured on 2026-09-26: a volume from 09/13, the container recreated with the default password, healthcheck `The client is unauthorized due to authentication failure`. Put the old password back in `NEO4J_PASSWORD`, or change it inside Neo4j (`ALTER CURRENT USER SET PASSWORD FROM … TO …`, the command is printed), or — the graph is derived, `pnpm --filter api grafo:reprojetar` rebuilds it — remove the volume yourself. The script never removes it (AT-181) |
| the `up --wait` times out | `BRABO_RESET_WAIT_TIMEOUT` (seconds, default 600). A first boot with empty `node_modules`/`_build` volumes runs `pnpm install`/`mix deps.get` before the process listens |

### Moving a dev environment to brabo-dev {#dev-para-brabo-dev}

Since [ADR 0170](adr/0170-compose-de-dev-brabo-dev.md) the dev compose
(`docker/docker-compose.yml`) is the Docker project **`brabo-dev`**: containers
`brabo-dev-api-1`, `brabo-dev-postgres-1`…, volumes `brabo-dev_pgdata`,
`brabo-dev_neo4j_data`…, network `brabo-dev_default`. The installation compose
(`docker-compose.install.yml`) stays **`brabo`**, and so do the installations
already out there. Before, both were `brabo` — one Docker project: bringing one
up over the other recreated the containers and bound them to the other's
database (measured on 2026-09-19: an installation's database received a dev
migration), and `reset-total.sh` would have dropped the installation's schemas.

**What changes for you if you already developed here:** the next `pnpm dev`
creates NEW, empty `brabo-dev_*` volumes. Your data stays where it was, in the
`brabo_*` volumes, untouched — nothing in this change removes a volume. The
preflight warns while it sees them (it never refuses for this, and never
deletes). Pick one of the two paths.

**Telling dev volumes from an installation's.** Both carry the label
`com.docker.compose.project=brabo`, so the prefix alone says nothing. What does:

```bash
docker volume ls --filter label=com.docker.compose.project=brabo \
  --format '{{.Name}}\t{{.Label "com.docker.compose.volume"}}'
docker ps -a --filter label=com.docker.compose.project=brabo \
  --format '{{.Names}}\t{{.Label "com.docker.compose.project.config_files"}}'
```

- Volumes that only the dev compose declares — `api_*_node_modules`,
  `web_*_node_modules`, `broker_*_node_modules`, `engine_build`, `engine_deps`,
  `engine_mix`, `engine_hex` — prove a dev environment used the name `brabo`.
  The installation never creates them.
- Volumes both composes declare — `pgdata`, `neo4j_data`, `neo4j_logs`,
  `ollama_data`, `git_local_repos`, `project_workspaces`,
  `brabo_projects_base` — are ambiguous on their own. If no container of an
  installation exists (the second command shows no `docker-compose.install.yml`)
  and you never installed Brabo on this machine, they are your old dev data.
  If you did install it, they may be the installation's (or a mix, after the
  accident this ADR closes): do not copy nor delete them before you know.
  `backup_local` only exists in the installation.

**Path A — carry the data over** (the database, the graph, the local bare
repositories and the workspaces; the build-artifact volumes are not worth
copying, the new ones fill themselves on the first boot):

```bash
# 1. the old stack down, WITHOUT -v (it may still be running as `brabo`).
#    ONLY when the second command above listed no installation container:
#    `-p brabo down` would bring an installation down just the same.
docker compose -p brabo -f docker/docker-compose.yml --env-file .env down
# 2. create the new (empty) volumes without starting anything
docker compose -f docker/docker-compose.yml --env-file .env create
# 3. copy, volume by volume
for v in pgdata neo4j_data neo4j_logs git_local_repos project_workspaces ollama_data; do
  docker volume inspect "brabo_$v" >/dev/null 2>&1 || continue
  docker run --rm -v "brabo_$v":/de -v "brabo-dev_$v":/para \
    alpine sh -c 'cp -a /de/. /para/'
done
# 4. up as brabo-dev
pnpm dev
```

`cp -a` keeps owners and modes, which matters for `pgdata` (the Postgres image
refuses a data directory it doesn't own) and for the two data volumes (see
[Dev containers write as your user](#dev-containers-nao-root) above). Postgres must be **down**
while its directory is copied — that is what step 1 is for.

**Path B — start from scratch:** just run `pnpm dev`, then
`bash scripts/dev/reset-total.sh` to migrate and seed the new database. The
old volumes stay on disk until you remove them.

**Removing the old volumes, only after the new stack works and only the ones
you proved are dev** (the installation's are data you'd lose):

```bash
docker volume rm brabo_api_root_node_modules brabo_engine_build  # …one by one, by name
```

No script does this for you, on purpose: `docker volume rm` of an
installation's `brabo_pgdata` is the one mistake here that cannot be undone.

---

## Local deploy {#deploy-local}

Brings up the whole of Brabo in a local cluster and validates it with a
smoke test. Decisions in
[ADR 0025](adr/0025-fase5-deploy-kubernetes-kustomize.md).

### Prerequisites

Required on the PATH: `docker`, `kubectl`, `kustomize`, `jq`, `openssl`.

`k3d` and `helm` **don't** need to be installed — bootstrap installs them
into `~/.local/bin`, at a pinned version with a checked checksum. Make sure
that directory is on the PATH.

Resources: the full stack (Postgres, Prometheus, two operators, and the
three apps) asks for around **4 GiB** free.

### Bringing it up

```bash
make deploy-local           # builds the images, brings up the cluster, installs, validates
make deploy-local-clean     # the same, without rebuilding the images
```

At the end: web at <http://localhost:8088>, api at `:3000`, engine at
`:4000` — **the same ports as `docker-compose.prod.yml`**, on purpose (ADR
0025, decision 10). The bootstrap runs the seed, which creates
`owner@brabo.dev` already verified with the password from
`BRABO_SMOKE_PASSWORD` (default `brabo12345678`) — that's what you sign in
with in the web's own login.

The seed runs **after** the rollouts (its last step activates a session,
which makes the api call the engine), and the bootstrap only proceeds after
**verifying that login returns 200**. That check is result-based, not
process-based, and exists because the previous one wasn't:
`wait --for=condition=Ready=false` is satisfied by a pod that never got to
run, and because of that the bootstrap used to announce "smoke user ready"
while login was returning 401.

> **The seed is idempotent.** Running it again over a seeded database is the
> normal case (`BRABO_KEEP_CLUSTER=1`): the workspace, project and session of
> the demo are found and reused, never duplicated, and the reused session does
> not get its five events appended again (`apps/api/src/db/seed.ts`, the
> top docblock). A second run no longer dies on `workspaces_slug_unique`. The
> bootstrap still decides by the **login**, not by the pod's phase, and still
> removes the pod at the end so it doesn't fail step 1 of `smoke.sh`, which
> requires every pod healthy.

> **This uses up `pnpm dev`'s ports.** Keeping the ports the same is what
> makes `smoke.sh` hold for both modes, and the price is that they don't
> coexist: with the cluster up, `pnpm dev` can't publish the `api` port and
> **5173 never opens**. Notice that the web changes port between modes —
> 8088 here, 5173 there. To go back to development:
>
> ```bash
> make k8s-down && pnpm dev
> ```
>
> `pnpm dev:preflight` tells you which mode you're in, no guessing. Both
> are covered in
> [Getting started](getting-started.md#the-two-local-modes-dont-coexist).

Other targets:

```bash
make smoke-k8s        # just the smoke test, against the running cluster
make hpa-test         # proves the engine's HPA scales by queue
make k8s-validate     # renders the overlays and validates against the schema (no cluster needed)
make k8s-logs         # last lines from api, engine, and web
make k8s-down         # removes the cluster
```

Variables: `BRABO_SKIP_BUILD=1` (uses the daemon's images),
`BRABO_KEEP_CLUSTER=1` (reuses the cluster), `BRABO_CLUSTER_TOOL=kind`,
`BRABO_SKIP_OBSERVABILITY=1` (no Tempo, Loki, Collector, Alloy or Grafana —
AT-177). The last one is an explicit opt-out for the scheduled proofs and the
default does not change: `make deploy-local` still brings the whole stack up.
Prometheus and the prometheus-adapter stay either way, because the engine's HPA
scales on `oban_queue_depth` through the External Metrics API they serve.
Independent helm releases (ESO, CNPG, metrics-server, Prometheus) install in
parallel; each writes its own log, printed only if it fails.

### Validating a pipeline tag {#validar-tag-do-pipeline}

```bash
make deploy-local TAG=v0.2.0-qa.1
```

Phase 6's pipeline **doesn't deploy** — it ends at the tag. `TAG=` is how
you see, in the local cluster, what that tag stamped: bootstrap does a
detached checkout of the tag and builds the images from that commit.

It **refuses** to run with a dirty tree, instead of guessing what to do
with your work in progress. When it finishes you're left in a detached
HEAD; the command to go back appears in the log.

Verification: **none**. No workflow passes `TAG=`: the scheduled
`propriedades.yml` builds the checked-out tree, never a tag, so the detached
checkout in `deploy/k8s/bootstrap.sh` (and its refusal on a dirty tree) runs
only when someone types it. What it brings up afterwards is the same bootstrap
and smoke as [Local deploy](#deploy-local), which are proven.

### Deploying a release's images {#imagens-de-uma-release}

Since [ADR 0119](adr/0119-imagens-publicadas-no-ghcr-por-digest.md) every
final tag publishes the production images to GHCR
(`ghcr.io/daneiel/brabo-{api,engine,web,backup,broker}`, public — no
`imagePullSecret` anywhere) and records what it published, **by digest**,
in `.release/images.json`. The fifth, the container broker
([ADR 0162](adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)), is
for installations — the overlay has no broker Deployment, and
`make imagens-do-release` writes only the other four.

The overlays in this repository keep `newTag: REPLACE_WITH_DIGEST`, a
marker. **The repository never declares which release is in production** —
you do, at deploy time:

```bash
# 1. get the record of the release you're deploying
gh release download v3.2.0 --pattern images.json --dir .release

# 2. write its digests into the overlay
make imagens-do-release OVERLAY=prod      # or OVERLAY=staging

# 3. read the diff before applying anything
git diff deploy/k8s/overlays/prod/kustomization.yaml
```

Three things worth knowing before you run it:

- **Don't commit the result.** `kustomize edit` round-trips the YAML: it
  reorders keys and detaches the comments. The change is meant to live in
  your working tree long enough to `kubectl apply -k`, and no longer.
- **`digest:` replaces `newTag:`**, which is the point — a mutable tag in
  production means no deterministic rollback and two pods of the same
  ReplicaSet possibly running different binaries.
- **Rollback is the same command with the previous release's file.** There
  is nothing else to undo: the digest is the whole state.

If `make imagens-do-release` says it can't find `.release/images.json`, you
skipped step 1. If it can't find `kustomize`, the version the CI uses is
pinned in `KUSTOMIZE_VERSION`, in `.github/workflows/ci.yml`.

Verification: `scripts/ci/aplicar-imagens.spec.ts`, on every PR, proves the
half of step 2 that **reads** the file — it accepts the `images.json` that
`release.yml` writes and refuses one with no `imagens`, an empty list, or no
version and commit. What it hands to `kustomize edit set image` is proven by
`scripts/ci/images-manifest.spec.ts` — always by digest, never a tag, and only
the four images the kustomize base declares. Running `kustomize` on the overlay
has no spec. The chain as a whole
(download a real release's file, write it, `kubectl apply -k`) has **never
run as a proof**: nothing applies a release's digests to a cluster, and the
scheduled cluster runs images built from the tree, not the published ones.

### What version is live {#que-versao-esta-no-ar}

Three places say the same thing, and the answer is the version **baked
into the artifact** — not a configuration someone could have changed by
accident
([ADR 0036](adr/0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md)):

1. **The login screen**, in the footer. The fastest path, and it needs no
   cluster access: open `/login` and read the footer's first item.
2. **The image tag**, if you have `kubectl`:

   ```bash
   kubectl -n brabo get deploy -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.template.spec.containers[0].image}{"\n"}{end}'
   ```

3. **`service.version` on the spans**, from the api, in Tempo. The only one
   of the three that ties a specific request to a build.

`dev` in all three isn't a failure: it's what an image built outside
`release.yml` reports, because it wasn't born from any tag. `docker
compose`, `make deploy-local` without `TAG=`, and a local build all land
there.

**Divergence between the three is the finding.** The footer showing one
version and the image tag another means bundle caching in the browser or
in nginx, not a wrong deploy — the bundle and the image come from the same
build. Reload ignoring cache before suspecting the cluster.

### The SecOps gate is stuck on "SAST não rodou" {#semgrep-do-gate}

The session thread shows a SecOps `agent.error` (origin `infra`) saying
`SAST não rodou: semgrep falhou (:invalid_output), pulado` (or `:sem_saida`,
or `indisponível`) and the PR stays in `awaiting_secops`. Since
[RN-714](business-rules/engine.md#rn-714) the gate never approves without static
analysis: it stays pending and blocks the PR. After fixing the cause below,
the gate runs again by itself — on the next engine restart, or once the
`GateRescuer` finds the cycle stale (15 minutes). The error appears once per
reason: a rescue that hits the same reason again only logs it on the engine
server. Before RN-714 the same
failure approved the gate. On the production and installation composes the
engine runs with `read_only: true` and a tmpfs at `/home/engine`; when that
tmpfs is created `root:root`, the engine user (uid 1000) cannot create
`/home/engine/.semgrep`, semgrep exits with an empty stdout, and the gate
cannot read a result.

Check from inside the running engine:

```bash
docker exec brabo-engine-1 sh -c 'ls -ld /home/engine; id -u'
```

The folder must belong to uid 1000. Both composes declare
`/home/engine:uid=1000,gid=1000,mode=0700` since RN-707; an installation
created before it keeps the old line until its compose is updated and the
`engine` service is recreated (`docker compose ... up -d engine`). Kubernetes
is not affected (`fsGroup: 1000`). A missing `semgrep` binary blocks the gate
the same way. Semgrep still fetches its rules from the
registry: without egress the scan fails with `scan_failed`, which is a
different cause.

A `scan_failed` can also come from a semgrep **without `semgrep-core`**, the
binary that does the scanning:

```bash
docker exec brabo-dev-engine-1 semgrep --version   # dev compose
docker exec brabo-dev-engine-1 sh -c 'semgrep --config p/security-audit --json --quiet --metrics=off /tmp >/dev/null'
# "Failed to find semgrep-core in PATH or in the semgrep package." (exit 2)
```

Semgrep 1.179.0 stopped publishing `musllinux` wheels, so on the Alpine engine
image pip builds it from the sdist and the core binary is missing. Both engine
Dockerfiles pin `SEMGREP_VERSION=1.183.0` (the dev one since 02/10, held equal
to production by `scripts/ci/semgrep-do-engine.spec.ts`); a dev image built
before that rebuilds with `docker compose -p brabo-dev up -d --build engine`.
Raising the version needs a release that has a `musllinux` wheel on PyPI.

### The engine aborts with `sys_sigaltstack(): Internal error` {#engine-sigaltstack}

`sys/unix/sys_signal_stack.c:101:sys_sigaltstack(): Internal error: Failed to
set alternate signal stack`, exit 134, at boot or in the image build (`mix
local.hex`, `mix compile`): the ERTS asked musl for a fixed-size signal stack
that musl ≥ 1.2.6 refuses on CPUs with AMX (erlang/otp#11349). It shows up
intermittently in CI (only some runners have AMX) and deterministically on such
a server. The engine runs OTP 29.1.1, which has the fix
([ADR 0209](adr/0209-engine-em-otp-29.md)); seeing it again means an image with
OTP < 29.1 on Alpine ≥ 3.24 — rebuild from the current Dockerfiles. The CI build
step "O host tem AMX?" tells whether a given run landed on such a host.

### CORS error {#erro-de-cors}

The browser's message names the **destination** of the call, never the
cause. Read the **origin** it cites first — that's the useful information
([ADR 0037](adr/0037-cors-do-engine-e-a-porta-como-contrato.md)):

```
Access to fetch at 'http://localhost:3000/health' from origin
'http://localhost:5174' has been blocked by CORS policy
                     ^^^^ this part is the diagnosis
```

**If the origin isn't the one you expect** (`:5174` instead of `:5173`, a
different host, `https` instead of `http`), the problem is the origin, not
CORS.

In the composes, `WEB_ORIGIN` is **derived** from `WEB_PORT` — changing
`WEB_PORT` in `.env` (the guidance in [getting started](getting-started.md)
for a busy port) already moves the accepted origin along with it, so that
specific divergence no longer happens. What still causes this: someone
passed `--port` straight to Vite outside of compose (ADR 0037 made Vite
refuse to start in that case, via `strictPort`, instead of silently
starting on another port), the web is served through a different path, or
`WEB_ORIGIN` was set by hand and overrode the derivation. Fix the origin,
or add it to `WEB_ORIGIN` — **on both services**, which read the same
variable.

**If the origin is right**, confirm what each service actually answers.
`curl` doesn't do CORS, so it shows the raw header — exactly what the
browser looks at:

```bash
# api — expect access-control-allow-origin + allow-credentials
curl -sI http://localhost:3000/health -H "Origin: http://localhost:5173" \
  | grep -i access-control

# engine — expect access-control-allow-origin + vary: origin
curl -sI http://localhost:4000/health -H "Origin: http://localhost:5173" \
  | grep -i access-control

# preflight, which is where missing allow-headers shows up
curl -sI -X OPTIONS http://localhost:3000/auth/login \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-csrf-token" \
  | grep -i access-control
```

**Empty output is the finding**: the service didn't recognize the origin.
Wrong or missing `WEB_ORIGIN`, or the wrong port.

**A preflight missing the header the web sends** is the other failure
mode, and the most deceptive: the api's `allowedHeaders` list is explicit
and **no test does a preflight**, so a new client header passes CI and
breaks only in the browser. Today's list is `Content-Type`,
`Authorization`, `X-CSRF-Token`, `traceparent`.

Three things that **aren't** a CORS problem, no matter how much they look
like one:

- **api ↔ engine.** CORS is a browser mechanism; there the caller is a
  server-side HTTP client, which ignores those headers. A failure on that
  path is the service token (`401`/`403` — see
  [rotation](#rotacao-das-chaves-do-auth)) or the wrong address
  (`ECONNREFUSED` — see [the session doesn't leave `created`](#sessao-nao-ativa)).
- **The Phoenix channel going silent.** WebSocket doesn't go through CORS.
  Whoever refuses is the endpoint's `check_origin`, also fed by
  `WEB_ORIGIN`, and the refusal shows up in the engine's log — not in the
  browser console as a CORS error.
- **The engine's `/metrics` blocked in the browser.** That's deliberate: an
  internal metric isn't meant to be readable by page JavaScript. Use
  `curl`.

### The session doesn't leave `created` {#sessao-nao-ativa}

Symptom: activating a session does nothing. "Open creative session" creates
the session and the screen doesn't move; "Activate session" doesn't either.
In the api's log, `POST /projects/:id/sessions/:id/transition` returns
`500`:

```
TransitionSessionUseCase.activate ✗ TypeError
  ↳ HttpApiToEngineClient.startSession ✗ TypeError: fetch failed
      caused by: AggregateError [ECONNREFUSED]
```

Activating a session is the first step that **crosses over** to the engine
(the api asks for the supervised session over internal HTTP), so this is
where a wrong `ENGINE_URL` shows up — and not before, because nothing else
on the creation path leaves the api.

Confirm from **inside** the container, which is where the address matters
(`brabo-dev-api-1` in the dev compose; in an installation it is `brabo-api-1`,
[ADR 0170](adr/0170-compose-de-dev-brabo-dev.md)):

```bash
docker exec brabo-dev-api-1 node -e '
for (const u of ["http://engine:4000/health", "http://localhost:4000/health"]) {
  fetch(u, { signal: AbortSignal.timeout(5000) })
    .then((r) => console.log(u, "->", r.status))
    .catch((e) => console.log(u, "-> FAILED:", e.cause?.code ?? e.message));
}'
docker exec brabo-dev-api-1 sh -c 'echo $ENGINE_URL'
```

`engine:4000` responding `200` while `localhost:4000` gives
`ECONNREFUSED`, with `ENGINE_URL=http://localhost:4000`, is the closed
diagnosis: **inside the container, `localhost` is the api itself**.

The cause is usually the `.env`, not the compose. `pnpm dev` passes `.env`
as `--env-file`, and a value there **wins over** the compose's
`${ENGINE_URL:-http://engine:4000}`. Fix: remove (or comment out) the
`ENGINE_URL` line from your `.env` and recreate the api —

```bash
docker compose -f docker/docker-compose.yml --env-file .env up -d api
```

— because each environment already brings the right default without it:
compose points at the `engine` service, and the api running on the host
falls back to `http://localhost:4000` from its own code. Setting the
variable only makes sense to point at an engine that's neither of the two.
It also applies to the **production** compose, which uses the same
interpolation; in Kubernetes the value comes from the ConfigMap and has
always been `http://engine:4000`.

Two checks before blaming the address, if `ENGINE_URL` is correct:

- **Is the engine up?** `docker compose ps engine` and
  `curl -sI http://localhost:4000/health`. `ECONNREFUSED` with the right
  address means the service is down, not misconfigured.
- **A session that activates and closes itself ~30s later** isn't this
  problem. Look at `termination_reason`: `heartbeat_timeout` means
  activation worked and nobody joined the Phoenix channel — expected
  behavior when activating from outside the interface
  (`SESSION_HEARTBEAT_TIMEOUT_MS`). `conversation_idle_timeout` is the
  other one: a conversational agent was waiting for the user for longer
  than `SESSION_CONVERSATION_IDLE_TIMEOUT_MS` (8h), counted from the end of
  its turn ([RN-581](business-rules/api.md#rn-581)). To change that ceiling,
  set the variable in the `.env` (all three composes map it to the engine)
  or, on Kubernetes, add an `env:` item to the engine patch of the overlay:
  `deploy/k8s/` does not write it on purpose, because an absent variable
  there already is the code's 8h default (AT-153). A `409` with
  `reason: "sessao_encerrada"` afterwards is the closed session refusing
  conversation — open a new session.

### The Terminal tab is stuck on "Opening terminal..." forever {#terminal-preso-abrindo}

Symptom: a project in `runner` mode (ADR 0103/0104), Code → Dev → Terminal
tab never leaves the loading skeleton. The browser console shows, in a
tight loop with growing backoff:

```
socket do terminal com erro {"erro":"[object Event]"}
socket do terminal fechado
```

This is the browser's WebSocket never reaching the engine, not a runner
problem — it happens even before any `brabo-runner` connects. Three
stacked causes, all closed by [RN-433](business-rules/infra.md#rn-433):

1. **`ENGINE_PUBLIC_URL` resolving to a Docker-internal hostname.** The
   ticket the api hands the browser (`POST .../terminal-ticket`) carries
   `engineWsUrl`, built from `ENGINE_PUBLIC_URL` — distinct from
   `ENGINE_URL` (RN-419), which is for api→engine calls **inside** the
   compose network. `docker/docker-compose.yml` now sets
   `ENGINE_PUBLIC_URL: ${ENGINE_PUBLIC_URL:-http://localhost:4000}` on the
   `api` service (same default `VITE_ENGINE_URL` already uses for `web`).
   Confirm from inside the container:

   ```bash
   docker exec brabo-dev-api-1 sh -c 'echo $ENGINE_PUBLIC_URL'
   # expected: http://localhost:4000 (or your real public engine address)
   ```

   An empty value here on an environment built before this fix means the
   code fell back to `ENGINE_URL` (`http://engine:4000`) — a hostname that
   only resolves inside the Docker network, never from the browser. Fix:
   rebuild/recreate the `api` container so the new compose default takes
   effect, or set `ENGINE_PUBLIC_URL` explicitly in `.env` if the engine's
   real public address is something else (a tunnel, a different host).
2. **A socket that never opens used to retry forever, silently.**
   Independent of the address above — even a genuinely unreachable engine
   (down, firewalled) should surface as an error, never spin forever.
   `apps/web/src/lib/terminal-channel.ts` now gives up after 8s if the
   socket hasn't opened, and shows `RunnerOnboardingPanel` with an
   actionable message instead of looping on the browser's default
   WebSocket reconnect behavior.
3. **The socket URL duplicated its path.** The actual blocker once the
   first two were fixed: `terminal-channel.ts` used to concatenate
   `/runner/websocket` onto an `engineWsUrl` the api already returns
   complete (`ws://host:port/runner`) — and `phoenix.js`'s own `Socket`
   constructor appends `/websocket` again on top of whatever endpoint it's
   given. The engine received `GET /runner/runner/websocket/websocket` and
   rejected it (`Phoenix.Router.NoRouteError`), visible in
   `docker logs brabo-dev-engine-1` as a connection that never gets past
   `REFUSED CONNECTION`. Fixed by passing `engineWsUrl` straight to
   `Socket` — `apps/runner/src/channel.ts` (the CLI side of the same
   contract) already did this correctly.

### The runner floods the api with a dead ticket {#runner-com-ticket-morto}

Symptom: the web starts answering **429** to the person's own requests, with
no unusual activity on their part; and/or a project in `runner` mode shows as
having no local agent (dev tasks stuck on `dev.blocked_by_container`,
`RunnerReadiness` refusing) while `brabo-runner` is visibly running on their
machine.

**How to confirm.** In the engine's log, look for the SAME ticket being
refused over and over, at a fixed cadence of roughly **5,13 s**:

```bash
docker logs brabo-dev-engine-1 2>&1 | grep 'REFUSED CONNECTION TO EngineWeb.RunnerSocket' | tail -20
```

Dozens of those in a few hours, all carrying the same ticket string, is the
signature. ~5,13 s is not arbitrary — it is the ceiling of `phoenix.js`'s
internal `reconnectAfterMs` backoff.

**Cause.** The socket ticket is **single-use**
([RN-108](business-rules/web.md#rn-108)); the library's built-in
auto-reconnect repeats the SAME `params`, so it retries a ticket that was
consumed on the first connection and will never be accepted again. A version
of `apps/runner/src/channel.ts` shipped with that auto-reconnect left ON —
while the module's own docblock claimed it was neutralized. Stacked on the
runner's OWN retry policy (which is correct: fresh ticket per round, backoff,
ceiling on consecutive attempts), the measured result was **530 requests in
one minute** against the 300 req/min `RATE_LIMIT_USER` ceiling, four minutes
in a row over the limit. The limit is **per user**, which is why the 429
surfaced in the account owner's browser rather than anywhere near the runner.

The second consequence is the worse one: while stuck in that loop the runner
is **not connected**, so `RunnerReadiness` ([RN-507](business-rules/runner.md#rn-507))
refuses and the project looks like it has no local agent — some of what reads
as "the container won't come up" is this.

**Fix.** Update the `brabo-runner` binary (or reinstall from the project
screen). Nothing to change on the server: the rate limiter did its job, and the
engine was right to refuse every one of those tickets. If the flood is still
in progress, stopping the runner ends it immediately, and the 429s clear as
the sliding window drains (one minute).

### The api refuses to boot over an OAuth secret {#segredo-de-oauth-no-boot}

Symptom: with `NODE_ENV=production`, the api dies at start with a message
about `GIT_OAUTH_STATE_SECRET` — missing, set to the repository's example
value, or too short.

**It's not a regression, and don't work around it.** This key signs git
OAuth's `state`, and `state` is what stops the public callback from being
forged. Before [ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md)
the api would boot with a default published right in this repository —
whoever sees this error had, until now, the git-connection flow open to
anyone. The boot failing is the warning arriving, late.

```bash
export GIT_OAUTH_STATE_SECRET="$(openssl rand -base64 32)"
```

In Kubernetes the value comes from `brabo-secrets`, under the same-named
key of the `brabo` object in the secret store, which
`deploy/k8s/base/common/externalsecrets.yaml` pulls whole — if the error showed up
there, the problem is the vault not delivering the key, and the path is
[Deploy diagnosis](#diagnostico-do-deploy).

Changing the key **invalidates in-flight `state`s**: whoever is mid
"connect GitHub" at that instant gets refused and redoes the flow. Since
the `state`'s TTL is 10 minutes, that's the window — there's no migration
to do, and no **already-established** connection is affected (the stored
token doesn't depend on this key).

### The provider rejects the social-login callback {#callback-login-social-nao-registrado}

Symptom: clicking "Sign in with GitHub"/"Sign in with GitLab" on the login
screen goes to the provider and comes back with an error OF ITS OWN KIND
(`redirect_uri_mismatch` on GitHub, "The redirect URI included is not
valid" on GitLab) — it never even reaches
`/auth/oauth/:provider/callback`.

**It's not a product bug — it's a missing registration on the provider's
side.** Social login ([ADR 0084](adr/0084-login-social-github-e-gitlab.md))
reuses the SAME OAuth App the git connection already uses
(`GITHUB_OAUTH_CLIENT_ID`/`GITLAB_OAUTH_CLIENT_ID`, no new variable), but
each FLOW has its own `redirect_uri`, and the provider requires that ALL
the ones the api can ask for be registered beforehand:

- Git connection (already existed): `${API_PUBLIC_URL}/git/oauth/<provider>/callback`
- Social login (new): `${API_PUBLIC_URL}/auth/oauth/<provider>/callback`

Register the second one in the OAuth App's configuration (GitHub: Settings
→ Developer settings → OAuth Apps; GitLab: Settings → Applications) — GitHub
accepts several callback URLs on the same App, so does GitLab. No separate
App or new client id/secret needed.

### The four sibling secrets also refuse the default {#segredos-irmaos-no-boot}

Symptom: with `NODE_ENV=production`, the api (or, for `SECRET_KEY_BASE`
and `BRABO_SERVICE_TOKEN`, the engine's `:prod` release, which refuses the
same token values since [RN-601](business-rules/engine.md#rn-601)) dies
at start with a message about `AUTH_JWT_SECRET`,
`BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY`, or `SECRET_KEY_BASE` —
missing, set to the repository's example value, or too short.

**Same cause as the OAuth secret above, and the same guidance: it's not a
regression, and don't work around it.**
[ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md) already
declared these four as pending — the same pattern, just not replicated
yet — and [RN-114](business-rules/api.md#rn-114) closed it. Each protects
something different:

- `AUTH_JWT_SECRET` public = anyone can derive the pair that signs the
  access token and forge a valid one.
- `BRABO_SERVICE_TOKEN` public = anyone can call `/internal/*` bypassing
  `EngineServiceGuard`.
- `CREDENTIALS_MASTER_KEY` public = anyone can decrypt the user's
  credential store (LLM keys, git tokens).
- `SECRET_KEY_BASE` (engine) already had `raise` in `runtime.exs` — the
  defect was only the compose masking that `raise` with a public
  fallback.

```bash
export AUTH_JWT_SECRET="$(openssl rand -base64 32)"
export BRABO_SERVICE_TOKEN="$(openssl rand -base64 32)"
export CREDENTIALS_MASTER_KEY="$(openssl rand -base64 32)"
export SECRET_KEY_BASE="$(openssl rand -base64 64)"
```

Nothing changes in Kubernetes, for the same reason as
`GIT_OAUTH_STATE_SECRET`: all four already came from `brabo-secrets`,
under the same-named key of the `brabo` object that
`deploy/k8s/base/common/externalsecrets.yaml` pulls whole.

**The knowledge graph (`NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD`,
[ADR 0099](adr/0099-neo4j-grafo-de-conhecimento-e-templates.md)) follows
the same rule, with one difference**: `NEO4J_URI` and `NEO4J_USER` have a
safe development default (`bolt://neo4j:7687`, `neo4j` — they're not
secrets, and `docker-compose.prod.yml` already supplies them); only
`NEO4J_PASSWORD` has no public default, for the same reason as the four
above — and without it the api's boot fails in
`GraphStore.onModuleInit` (`neo4j-config.ts`) BEFORE Neo4j itself even
refuses to start (the official image's entrypoint requires an 8+ character
password; an empty `NEO4J_AUTH` brings down the `neo4j` container first).

```bash
export NEO4J_PASSWORD="$(openssl rand -hex 24)"
```

**In development the switch is `NEO4J_URI`, and it is empty by default.** The
`neo4j` service runs in the dev compose's default profile, so the server is up
whether or not anything talks to it; the api only connects when `NEO4J_URI` is
set. Uncomment it in `.env` (`bolt://neo4j:7687`) and recreate the api —
`GraphStore` then logs `Neo4j conectado — constraints do grafo garantidas`
instead of `NEO4J_URI/NEO4J_USER/NEO4J_PASSWORD ausentes`. User and password
reach the container with the same defaults the `neo4j` service uses for
`NEO4J_AUTH`, so set them only to CHANGE the password, and changing it there
changes both sides at once.

Until this was wired, `docker-compose.yml` did not pass the three variables to
the `api` service at all and the service has no `env_file` — so the block
`.env.example` has documented since the graph was born reached nothing, and
uncommenting it turned nothing on. `docker-compose.prod.yml` had supplied them
since day one (that is why only development was affected): a healthy Neo4j sat
next to an api reporting the variables absent, indefinitely.

**HEX, not base64.** Neo4j's entrypoint reads `NEO4J_AUTH` as
`user/password` and splits on the FIRST slash — a base64 password can
contain `/` (the alphabet has `/` and `+`), and that breaks the parse with
`Invalid value for NEO4J_AUTH`, taking down the `neo4j` container in a
restart loop. This actually happened: CI's smoke test failed this way after
a merge that reintroduced `-base64` by mistake. Hex has no `/`, `+` or `=`.

`docker/smoke.sh` already generates the five ephemeral variables above (the
four siblings plus `NEO4J_PASSWORD`, this one in hex) on every run — that's
how the CI job
"Build, scan e smoke das imagens de produção" brings up
`docker-compose.prod.yml` with
no secret committed.

Changing `AUTH_JWT_SECRET` or `BRABO_SERVICE_TOKEN` without the
`_PREVIOUS` dance has the same effect already documented in
[Auth key rotation](#rotacao-das-chaves-do-auth); changing
`CREDENTIALS_MASTER_KEY` without re-wrapping has the same effect already
documented in
[Master key rotation](#rotacao-da-chave-mestra). This BOOT check doesn't
change either procedure — it just stops the key from reaching production
as this repository's public literal.

### Real SMTP in `MailSender` {#smtp-real}

`MailSender` sends a real email only when `MAIL_TRANSPORT=smtp` — the
default is `log` (the usual behavior), **including in production**:
sending real email is opt-in for the operator
([ADR 0096](adr/0096-smtp-real-no-mailsender.md)). See
[Configuration](reference/configuration.md#api) for the full `SMTP_*`
table.

Symptom of incomplete configuration: with `NODE_ENV=production` and
`MAIL_TRANSPORT=smtp`, the api dies at start complaining about
`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, or `SMTP_FROM` — same message
pattern as the
[four sibling secrets](#segredos-irmaos-no-boot) ([RN-408](business-rules/api.md#rn-408)),
but WITHOUT the public default they have: here the rule only kicks in
once the operator opted into `smtp`.

```bash
export MAIL_TRANSPORT=smtp
export SMTP_HOST=smtp.seu-provedor.com
export SMTP_PORT=587
export SMTP_USER=usuario-do-provedor
export SMTP_PASSWORD="$(sua-credencial-do-provedor)"
export SMTP_FROM="Brabo <nao-responda@seu-dominio.com>"
```

`SMTP_PASSWORD` is a service INFRASTRUCTURE secret (a plain env var, like
`AUTH_JWT_SECRET`), not a USER secret — it doesn't go through envelope
encryption, and has no rotation procedure of its own beyond changing the
variable and restarting (the SMTP provider decides that credential's
rotation policy). In Kubernetes, the key goes into the `brabo` object of the
secret store like any other, and reaches `brabo-secrets` with no manifest
change — `deploy/k8s/base/common/externalsecrets.yaml` pulls the whole
object.

If email doesn't arrive even with no boot error: check the api's log for
`falha ao enviar e-mail via SMTP` (`type`/recipient show up, the body and
the token NEVER show up — same rule as `LogMailSender`), and test the
credential with the provider's own SMTP client before suspecting Brabo.

### k3d is the default even with kind installed

It's not a preference. k3s ships with a built-in NetworkPolicy
controller; **kind's kindnet doesn't implement NetworkPolicy** and
silently ignores the manifests. On a kind cluster, this phase's policies
exist in etcd with no effect at all, and the deploy would look validated
without having validated half of scope item 4. The smoke test warns when
the cluster isn't enforcing.

### What the smoke test covers

1. Every pod **Ready** — not just `Running`. A pod whose readiness check
   fails stays `Running` forever without receiving traffic.
2. No container with `runAsUser: 0`.
3. Login at `POST /auth/login` with the seed user — exercises argon2id,
   access-token issuance, and the session cookies.
4. `workspace → project → session`. This step crosses the whole
   NetworkPolicy set: creating a session makes the api call the engine
   over internal HTTP, with the service token. The session is created with
   `kind: consultiva` — mandatory since PHASE 20
   ([RN-097](business-rules/api.md#rn-097)) — and it's `consultiva` on
   purpose: the smoke test exercises create → activate → close and never
   activates execution, which on a consultative session returns `409`.

   **This is the step that proves the route has a consumer outside the
   web.** When `kind` was made mandatory, the api's suite passed with 1562
   tests, and it was the smoke test that failed, because it's the only
   one that calls the route as an external client, with no mock, against
   the production image.
5. Distinct probes (`/live` and `/ready` for the engine, `/live` for the
   api) and the web's `/config.js` pointing at the cluster's URLs.
6. `oban_queue_depth` with the `queue` and `state` labels at `/metrics`.
7. `external.metrics.k8s.io` serving the metric — the prometheus-adapter's
   failure mode is silent, so we ask the aggregated API directly.

### Deploy diagnosis {#diagnostico-do-deploy}

#### `403` on `/internal/*`, or `401` on the api's calls to the engine

Both symptoms have the same cause: the service token doesn't match
between the two sides (the api refuses with `403`, the engine's plug with
`401`). Check that both loads read the **same** value:

```bash
kubectl -n brabo get secret brabo-secrets -o jsonpath='{.data.BRABO_SERVICE_TOKEN}' | base64 -d | sha256sum
kubectl -n brabo exec deploy/engine -- sh -c 'printf %s "$BRABO_SERVICE_TOKEN" | sha256sum'
```

Comparing the hash instead of the value avoids printing the secret to the
terminal. If they diverge, the engine pod has an old version of the
Secret: `kubectl -n brabo rollout restart deploy/engine`. If they match,
the header isn't getting through: check that `BRABO_SERVICE_TOKEN` is set
on **both** loads — the engine has a development default
(`dev-service-token-change-me`), so forgetting the variable only there
produces exactly this symptom, with no boot error — and that no proxy in
the path is stripping unknown headers.

#### Login returning `401` for everyone after a deploy

Almost always a new `AUTH_JWT_SECRET` skipping the coexistence step: the
access token disappears along with it, but the symptom shows up on
refresh. The correct procedure is in
[Auth key rotation](#rotacao-das-chaves-do-auth).

#### `ExternalSecret` never becomes Ready

The `SecretStore` reads the source Secret `brabo`, created imperatively by
the bootstrap. Confirm it exists and that RBAC is in place:

```bash
kubectl -n brabo get secret brabo
kubectl -n brabo describe secretstore brabo-secret-store
```

Since AT-220 the `ExternalSecret` pulls the **whole** `brabo` object from the
store (`dataFrom.extract`) instead of listing each key. Two consequences for
diagnosis:

- **A missing key no longer keeps it from becoming Ready.** `brabo-secrets` is
  created without it, and the failure shows up in whoever needs the key: a Pod
  with a `secretKeyRef` (`NEO4J_PASSWORD` in Neo4j, `BACKUP_S3_ACCESS_KEY`/
  `BACKUP_S3_SECRET_KEY` in the local S3) stays in
  `CreateContainerConfigError`, and the api or the engine refuses to boot in
  production naming the variable. The object in the store must carry
  `DATABASE_URL`, `SECRET_KEY_BASE`, `CREDENTIALS_MASTER_KEY`,
  `GIT_OAUTH_STATE_SECRET`, `AUTH_JWT_SECRET`, `AUTH_TOKEN_PEPPER`,
  `BRABO_SERVICE_TOKEN`, `RELEASE_COOKIE`, `BACKUP_S3_ENDPOINT`,
  `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY` and
  `NEO4J_PASSWORD` — the list `deploy/k8s/bootstrap.sh` creates locally.
  Compare what arrived:

  ```bash
  kubectl -n brabo get secret brabo-secrets -o go-template='{{range $k, $v := .data}}{{$k}}{{"\n"}}{{end}}'
  ```

- **Everything in that object reaches the Pods.** Every key becomes an
  environment variable of api, engine, the two migration Jobs and the backup
  CronJob (`envFrom: brabo-secrets`). Don't store in `brabo` anything those
  processes shouldn't see; another consumer's secret goes in another object.

#### Engine HPA at `<unknown>`

In order, most to least likely:

```bash
# 1. is the engine exposing the metric?
kubectl -n brabo exec deploy/engine -- wget -qO- http://127.0.0.1:4000/metrics | grep oban_queue_depth

# 2. is Prometheus scraping it?
kubectl -n monitoring port-forward svc/prometheus-server 9090:80
# then: http://localhost:9090 -> Status -> Targets

# 3. is the adapter serving it?
kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1/namespaces/brabo/oban_queue_depth?labelSelector=state%3Davailable"
```

If (1) responds and (3) doesn't, the problem is the rule in
`deploy/k8s/helm/prometheus-adapter-values.yaml`.

#### Migration Job doesn't reapply

A `Job`'s spec is immutable: with the previous Job still in the cluster,
reapplying with a new image fails. The bootstrap already deletes both
before applying; manually:

```bash
kubectl -n brabo delete job migrate-api migrate-engine --ignore-not-found
kubectl apply -k deploy/k8s/overlays/local
```

#### `bin/engine rpc` responds `eaddrinuse`

The Erlang distribution's port range (`ERL_AFLAGS`) needs more than one
port: the running node occupies the first, and `rpc` brings up a hidden
node that needs another. The configured range is 9100–9110, opened in
the NetworkPolicy.

#### Checking that the engine's replicas are clustered

Without an Erlang cluster, `Workspace.ensure!`'s `:global.trans` doesn't
serialize anything and two replicas run a concurrent `git init` on the
same shared directory:

```bash
kubectl -n brabo exec deploy/engine -- /app/bin/engine rpc 'IO.inspect(Node.list())'
```

Should list the other pods. An empty list with more than one replica is a
defect.

### Secrets: fallback to sealed-secrets {#fallback-sealed-secrets}

The default is the External Secrets Operator. Where it isn't viable,
replace the `ExternalSecret` in
`deploy/k8s/base/common/externalsecrets.yaml` with a `SealedSecret`,
**keeping the same Secret name (`brabo-secrets`) and the same keys** —
nothing else in the deploy needs to change, because everything consumes
it via `secretRef`.

```bash
kubectl create secret generic brabo-secrets \
  --dry-run=client -o yaml \
  --from-literal=DATABASE_URL=... \
  --from-literal=SECRET_KEY_BASE=... \
  | kubeseal --format yaml > deploy/k8s/overlays/<env>/sealed-brabo-secrets.yaml
```

The `SealedSecret` is encrypted for that cluster's public key and can be
versioned. A plain Secret **never** can.

Verification: **none**. Nothing in the repository runs `kubeseal`, and the
scheduled cluster (`propriedades.yml`) materializes `brabo-secrets` through
External Secrets, so this path has never been exercised. Before relying on it,
bring up a cluster with the `SealedSecret` in place and run `make smoke-k8s`:
its first step requires every pod Ready, and a pod whose `secretRef` points
at a Secret that never materialized is not.

### Known limits of this environment

- **RWO instead of RWX.** Works because the cluster has a single node,
  and RWO means "one NODE", not "one pod". On a real cluster this
  configuration would put api and engine on different nodes and the dev
  agent's `git push` would fail with `remote unpack failed`.
- **No pgvector** on CloudNativePG's Postgres. Today no migration creates
  the extension and no `vector` column exists.
- **`.gitlab-ci.yml` has no local static validation** (Phase 8c, ADR
  0039). The Infra area's Workflows subagent validates GitHub Actions
  workflows with `actionlint` (pinned in `docker/engine/Dockerfile(.prod)`,
  same pattern as `hadolint`/`gitleaks`); there's no equivalent offline
  binary for GitLab CI — the official linter needs a live instance.
  Documented gap, not an invented half-solution.

---

## Engine rollout {#rollout-do-engine}

Decisions in
[ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md).

The engine hosts the session processes. Bringing down a replica carelessly
used to leave, before Phase 5, **every** session on that pod hanging in
`active` with no process at all — never advancing, never closing.

### What happens during a rollout, in order

| phase | how long | what happens |
|---|---|---|
| `preStop` | up to 45s (`SHUTDOWN_DRAIN_TIMEOUT_MS`) | `Engine.Shutdown.drain/1`: `/ready` flips to 503, `/internal/sessions` refuses new sessions, and every session on this node is offered to a live peer |
| per-session handoff | 5s (`@handoff_timeout_ms`) | `:erpc.call` to another node to take over the process |
| not adopted | — | become `closing` with cause `node_shutdown`, then `closed_abnormally` |
| SIGTERM | rest of the 90s (`terminationGracePeriodSeconds`) | the supervision tree comes down |

The 90s are deliberate: 45s of drain plus slack for the BEAM's teardown.
Lowering `terminationGracePeriodSeconds` without lowering the drain
timeout makes kubelet kill the pod **mid-handoff** — which is exactly how
you recreate the bug the drain exists to prevent.

### Doing the rollout

```bash
kubectl -n brabo rollout restart deployment/engine
kubectl -n brabo rollout status  deployment/engine --timeout=300s
```

With a single replica, there's no peer to adopt: **every** active session
will end up `closed_abnormally / node_shutdown`. That's correct, not a
failure — but if the goal was to not interrupt anyone, scale to 2 first:

```bash
kubectl -n brabo scale deployment/engine --replicas=2
```

### Proving nothing was left orphaned

```bash
make rollout-test
```

Opens 5 active sessions, does the rollout, and requires that **each one**
be in one of two states: `active` with a live `:global` owner (adopted),
or `closed_abnormally` with `node_shutdown` (drained). Any other
combination fails — especially `active` with no owner, which is the
operational definition of an orphan.

**It keeps the evidence the old pods take with them** (AT-078). Before the
`rollout restart`, `deploy/k8s/rollout-evidencia.sh` starts writing into
`ROLLOUT_EVIDENCE_DIR` (a `mktemp -d` when unset; the path is printed at the
end):

| file | what |
|---|---|
| `engine-<pod>.log` | `kubectl logs -f` of **every** engine pod — the ones already up (whole log, from boot), which the rollout kills, and every pod created later — attached as soon as it is `Running` |
| `final-<pod>.log` | a non-follow copy of the pods still up at the end, covering a `logs -f` that dropped |
| `events.log` | `kubectl get events -w` for the namespace, with each event's own timestamps (`SuccessfulRescale`, `ScalingReplicaSet`, `Killing`…) |
| `replicas.log` | every 2 s (`EVIDENCIA_INTERVALO`, which the spec shortens): `<epoch> <Deployment spec.replicas> <ready> <HPA current> <HPA desired>` |
| `donos.log` | every owner read of the check: `<epoch> <session> <owner node or ->` |
| `donos-durante-rollout.log` | the same read, looped while `rollout status` runs — which replica each handoff landed on. Kept apart because a read mid-rollout sometimes hits a pod on its way out, and must not feed the verdict |
| `engine-estado.txt` | read-only: the test sessions' rows in `engine.session_states` (without a row, neither the drain nor the `Adopter` sees a session) and the last `SessionAdoptionWorker` jobs, taken at the end of both outcomes |
| `marcos.log`, `anexos.log`, `pods-antes.txt`, `pods-no-fim.txt` | test milestones (`rollout-restart`, `rollout-status-ok`…), when each log was attached, the pods at T0 and at the end |

On an orphan the failure prints every line that names the session across all
of those files — the old pod's log included — plus the replica changes
relative to the rollout, and a verdict per orphan: **without an owner BEFORE
or AFTER the first HPA scale-down**. That separates the known confounder: the
`hpa-test` that runs first leaves three replicas, and ~75 s into the window the
HPA scales down to one, killing new replicas. A drop in `spec.replicas` is
read as the HPA, because `rollout restart` never changes it. None of this
changes what counts as adopted or drained, nor the 120 s ceiling. The pure
parts, and the collectors against a fake `kubectl`, are covered by
`scripts/ci/rollout-evidencia.spec.ts`. The scheduled workflow uploads the
directory as the `rollout-evidencia` artifact on every run that reached the
proof, green included.

What it does **not** capture, measured on the first green run with it
(`35449815544`): the drain's own lines (`shutdown: drenando…`,
`shutdown: drain concluído — …`) never reach the pod's log. `Engine.Shutdown.drain/0`
runs inside the `preStop`'s `bin/engine rpc`, so its `Logger` output goes to
that hook's stdout, which kubelet discards when the hook succeeds. The
old pods' logs end at `SIGTERM received`. The per-session outcome of the drain
has to be read from `donos-durante-rollout.log` (which replica each session
went to) and `engine-estado.txt` (whether its `session_states` row survived).

**Fixed cause, unconfirmed on k3d** (AT-078, RN-588). The orphan this proof
caught (~3 in 13 runs: no `session_states` row, and a second OLD pod in
`donos-durante-rollout.log`) came from the old pod's `Monitor` deleting the row
after the peer re-wrote it during the handoff. The drain now marks the handoff
and the Monitor keeps the row. That was proven by a deterministic ExUnit test,
not by this proof, which fails 1 in 4-6 and cannot prove a fix. If an orphan
shows up again, the pod log of the pod that handed the session over carries one
`Monitor: session_state <id> mantido|apagado em <node>` line per session: no
line means the Monitor never processed the `:DOWN` (the pod died first).

Manually, the same question:

```sql
-- active sessions according to the api
select id, status, updated_at from sessions where status = 'active';
```

```bash
# live owners according to the engine
kubectl -n brabo exec deploy/engine -- \
  /app/bin/engine rpc ':global.registered_names() |> Enum.filter(&match?({:brabo_session, _}, &1)) |> length()'
```

Active in the api with no owner in the engine = orphan.

### When a session escapes {#quando-a-sessao-escapa}

**Session stuck in `closing`.** `closing` is a transitional state; stuck
there means the drain started and didn't finish. The *Session stuck in
closing* alert fires after 15 minutes. Investigate the log of the pod
that was leaving — if it's already gone, the `Adopter` (a sweep every
30s) should have taken over; if it didn't, check whether the row still
exists in `engine.session_states`.

**Orphan after `kill -9` / an OOMKill.** `preStop` doesn't run in those
cases, by definition. What covers it is the `SessionAdoptionWorker`,
which every 30s looks for a row in `session_states` with no `:global`
owner and takes it over. If it's not running, the Oban queue is stalled —
and then the problem is something else (see the alert for a queue not
being consumed, under [Observability](#observabilidade)).

**A rollout stuck in `preStop`.** Symptom: a pod `Terminating` for exactly
90s, every time. Almost certainly an `:erpc.call` waiting for a node that
already died but is still in `Node.list()`. The 5s-per-session timeout
caps the damage; a full 90s means ~18 sessions in sequence or a handoff
that never returns.

**Nothing gets adopted, even with 2 replicas.** The nodes can't see each
other. Check the Erlang cluster:

```bash
kubectl -n brabo exec deploy/engine -- /app/bin/engine rpc 'Node.list()'
```

Empty list = the DNSCluster didn't resolve the headless Service, or the
NetworkPolicy is blocking the distribution range (9100–9110). Without a
cluster, each replica is an island and every rollout drains everything.

### Increasing the drain window {#aumentar-a-janela-de-drain}

If sessions run long and the 45s drain isn't enough, both values go up
**together** — and in this order of reasoning: pick the drain, then add
slack:

```yaml
# deploy/k8s/base/engine/deployment.yaml
terminationGracePeriodSeconds: 150   # drain + ~30s teardown
# env SHUTDOWN_DRAIN_TIMEOUT_MS: "120000"
```

Touching only `terminationGracePeriodSeconds` doesn't lengthen the drain;
touching only the drain makes kubelet kill mid-way.

Verification: **none of its own**. `make rollout-test` is the proof that
applies, and the scheduled run proves only the pair the **local** overlay
produces: 90 s of grace from `deploy/k8s/base/engine/deployment.yaml` and a
20 s drain from `deploy/k8s/overlays/local/patches.yaml` — not the 45 s of the
default, and not a raised one. After raising both in the overlay you deploy, run
`make rollout-test` with the same values in the local overlay
before the rollout that matters; nothing checks that the grace period stays
above the drain.

---

## Restore {#restore}

Decisions in [ADR 0027](adr/0027-fase5-backup-hardening-release.md).

> **Tested.** The procedure below is exactly what `make test-restore`
> runs, and it's run against the local cluster. There's no step here that
> nobody has ever exercised. The record of the last run is at the end.

### What is backed up, and what deliberately is not

Seven named volumes exist; **two** are source of truth and only those are
copied. The classification is
[ADR 0152](adr/0152-backup-de-volumes-contra-compose.md), and the point of
making it is that "back up every volume" costs space while hiding what matters.

| volume | nature | in the backup? |
|---|---|---|
| `pgdata` | source of truth — event log, actions, pgvector, everything | yes, as a **logical dump**. Never a file copy of the data directory: copying a running Postgres produces a backup that may not restore |
| `git_local_repos` | source of truth — the *bare* repos of `local`-provider projects | **yes**, and this was the hole. It is not reconstructible from Postgres: the event log holds the narrative, not the git objects |
| `neo4j_data` | derived — a projection of the event log ([ADR 0101](adr/0101-memoria-relacional-como-projecao-do-event-log.md)) | no. The answer for derived memory is **reprojection**, not restore — `grafo:reprojetar`, see [Losing the graph](#perda-do-grafo) |
| `project_workspaces` | derived — worktrees the `WorktreeManager` recreates from the bare repo, **and** the agents' `docs/` folder of `container` and `runner` projects, which is a projection of the event log ([ADR 0148](adr/0148-artefatos-projetados-em-arquivo.md)) | no. The answer is **reprojection** — `artefatos:reprojetar`, see [Losing the artifact folder](#perda-da-pasta-de-artefatos) |
| `ollama_data` | re-obtainable — models download again | no |
| `brabo_projects_base` | the user's, not the product's | no, and the installer never deletes it |

### Where the backup lives

| what | where |
|---|---|
| schedule | Kubernetes: `brabo-backup` CronJob, 03:17 UTC, daily. Compose: there is no scheduler — you run it, or the installer does before a migration |
| destination | disk (`BACKUP_DIR`) **or** an S3-compatible bucket (`BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET`). `BACKUP_DIR` set wins; empty falls back to S3, which is what the CronJob does |
| layout | `daily/brabo-<ISO>.dump` + `weekly/…` for Postgres; `git-daily/brabo-git-<ISO>.tar.gz` + `git-weekly/…` for the bare repos |
| retention | 7 daily + 4 weekly of **each kind**, by COUNT (`BACKUP_KEEP_DAILY` / `BACKUP_KEEP_WEEKLY`) |
| format | `pg_dump --format=custom --compress=9`; `tar -czf` for the repos |
| history | `backup_runs` table — the **dump**, keyed by `object_key`. The repo archive carries the same timestamp in the sibling prefix; the link is the name, not a column |

In the local cluster the S3 destination is a SeaweedFS (`s3-local`, the
`weed server -s3` gateway on port 9000) inside the `brabo` namespace — it was
MinIO until MinIO stopped publishing its community image
([ADR 0169](adr/0169-seaweedfs-no-lugar-do-minio-no-overlay-local.md)); in
staging/prod it's the real bucket. The procedure doesn't change — only the
endpoint. If the bootstrap stops at `rollout status deployment/s3-local` with
`ImagePullBackOff`, the pinned image stopped being served: the digest keeps
the bytes from changing, not the publisher from leaving.

> **The default compose destination is a named volume, and that is fine for
> verifying and wrong for migrating.** `docker compose down -v` deletes
> `backup_local` along with the data it was meant to save. Point
> `BRABO_BACKUP_HOST_DIR` at a host directory before any migration.

### What the bare-repo archive guarantees — and what it does not {#garantia-dos-bare-repos}

Nothing is quiesced: the repos are copied while api and engine may be writing
to them. What that buys, exactly:

- **Guaranteed.** Consistency **per reference**. Git writes objects before it
  moves a ref, and swaps the ref by atomic rename (or by rewriting
  `packed-refs` under a lock, also by rename). A `tar` crossing a `git push`
  captures the ref at its old value or its new one, never half a value — and
  in the new case the objects it reaches are already on disk.
- **Guaranteed.** A partial archive **fails the run** instead of passing as
  good. A concurrent `git gc` can delete a packfile between `tar` listing a
  directory and reading it; `tar`'s exit status is captured in a file (in POSIX
  `sh` a pipeline's status is the last command's) and a non-zero turns into a
  `failed` row in `backup_runs`, which is what alerts on. Run it again.
- **Guaranteed.** The archive is readable **end to end** before anything is
  written — `brabo-restore-git` is the `pg_restore --list` of the git side. A
  truncated tar has plausible size and only reading it tells.
- **Not guaranteed.** Any global instant. `tar` walks the tree over a period,
  so two repositories — or two refs of one — can come from different moments.
  Irrelevant to git, which validates per ref; relevant to anyone reading
  "the 03:17 backup" as one snapshot.
- **Not guaranteed.** Object connectivity. Nothing here runs `git fsck`: the
  backup image has no git, on purpose. What is proved is the integrity of the
  container, not of the contents.
- **Not copied.** `*.lock` files, and `objects/tmp_*`. Restoring an orphan lock
  yields a repository where every `git` refuses to work, with a message that
  never mentions backup.

### Before restoring: does the backup exist, and is it any good?

```sql
select finished_at, kind, status, object_key,
       pg_size_pretty(size_bytes) as tamanho, error_message
  from backup_runs
 order by finished_at desc
 limit 10;
```

Three things in that output matter more than the last row:

- **A recent `status = 'failed'` with an old success** is the dangerous
  case: a backup exists, it's just old. The *Last backup run failed*
  alert covers exactly this.
- **A sharp drop in `size_bytes`** between runs suggests a truncated
  dump, and the size alone doesn't give it away — the script's
  `pg_restore --list` is what catches it.
- **No rows at all** means the CronJob has never run successfully. Then
  the problem isn't the restore.

### The automated path (the same one the test runs) {#restore-automatizado}

On Kubernetes:

```bash
make test-restore
```

On a compose install — no cluster, no `kubectl`:

```bash
make test-restore-compose
```

Both trigger a **real** backup (same image, same command that runs in
production — not an ad-hoc `pg_dump`, which would test a path nobody uses),
restore into `brabo_restore_test`, validate, and drop the database. Use them
when the goal is to **verify** the backup, not to recover data.

The two wrappers stay separate on purpose: unifying them would make the compose
path depend on `kubectl`, which is the dependency it exists not to have. What is
*not* duplicated is the judgement — both run the same `brabo-restore`, with the
same three validations. The compose one adds a third step the cluster cannot
ask for: it verifies the bare-repo archive, because on Kubernetes the
`git_local_repos` volume is not mounted in the backup pod and the step is
legitimately skipped, while under compose it is mounted and skipping would be a
false green.

Both are proven every week in
[`propriedades.yml`](#provas-de-propriedade-agendadas): `make test-restore` (and
its deliberate break, `make test-restore-mutacao`) in the cluster job, and
`make test-restore-compose` — with the bare-repo verification that only the
compose path performs — in a second job, `restore-compose`, on another runner
(AT-195). The installer's migration also runs the compose one.

### Restoring for real, during an incident {#restore-de-verdade}

The `brabo-restore` script restores into a NEW database and never touches
the source one — on purpose. Restoring over the live database is
irreversible and almost always the wrong call in the first minutes of an
incident.

**1. Bring up a restore Job pointing at the database name you want:**

```bash
kubectl -n brabo create job restore-manual --from=cronjob/brabo-backup \
  --dry-run=client -o yaml \
| sed -e 's|\["brabo-backup"\]|["brabo-restore"]|' \
| kubectl -n brabo apply -f -

kubectl -n brabo set env job/restore-manual RESTORE_DB=brabo_recuperado
kubectl -n brabo logs -f job/restore-manual
```

To restore from a weekly copy instead of the latest daily:
`RESTORE_PREFIX=weekly/`.

**2. Check what came back** — the same questions the script asks, now with
your own eyes:

```sql
-- how many tables came back (compare against the source, not a fixed
-- number: every new migration changes this count)
select count(*) from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE';

-- the event log is dense per session: this query has to come back EMPTY
select session_id, count(*), min(seq), max(seq)
  from session_events
 group by session_id
having count(*) <> max(seq) - min(seq) + 1 or min(seq) <> 1;
```

**3. Promote the recovered database** by pointing `DATABASE_URL` at it and
restarting api and engine. This is the last step, and the only
destructive one:

```bash
kubectl -n brabo patch secret brabo-secrets --type merge \
  -p "{\"data\":{\"DATABASE_URL\":\"$(printf '%s' "$NOVA_URL" | base64 -w0)\"}}"
kubectl -n brabo rollout restart deployment/api deployment/engine
```

> The Secret is materialized by External Secrets from the provider. A
> direct `patch` gets overwritten on the next `refreshInterval` (1h):
> change **also** the value in the provider, or the system quietly goes
> back to the old database within an hour — mid-recovery.

Verification: steps 1 and 2 are the `brabo-restore` that `make test-restore`
runs every week, and the two queries of step 2 are the ones
`docker/backup/restore.sh` asks itself. Step 3 — patching `DATABASE_URL` and
restarting api and engine against the recovered database — has **never been
exercised**: the proof drops `brabo_restore_test` when it finishes and never
points a running api at it.

### What the restore does NOT cover

- **User credentials become unreadable if `CREDENTIALS_MASTER_KEY` is
  different.** The dump carries the wrapped DEKs, not the keys. Restoring
  into an environment with a different master key gives you back an
  intact database with useless LLM and git credentials. See
  [Master key rotation](#rotacao-da-chave-mestra).
- **Nothing about users is left out.** Since the Keycloak cut
  ([ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)) there's
  no separate IdP database: identities, argon2id credentials, refresh
  tokens, and the auth event log all live in the same Postgres and go
  into this dump. What does **not** survive is reading them if
  `AUTH_TOKEN_PEPPER` is different — same reasoning as the master key
  above.
- **`brabo-restore` restores the database, and only it.** The bare repos
  are the sibling command, `brabo-restore-git` — see
  [Recovering the bare repos](#restore-dos-bare-repos). They are separate
  commands rather than two phases of one because they are two artefacts with
  two judgements: a git failure must not fail the event-log validation, and
  the reverse would be worse.
- **Agent worktrees** (`project_workspaces`) aren't copied, and don't need
  to be: the `WorktreeManager` recreates them from the bare repo. What is
  lost is uncommitted work in progress.
- ~~The real repositories live in GitHub/GitLab~~ — **this used to be
  written here and it was wrong**, which is why the volume went years with
  no backup. It holds for `github`/`gitlab`-provider projects; for a
  project on the `local` provider there is no upstream anywhere, and the
  bare repo in `git_local_repos` **is** the code the agents produced.
- **It's not PITR.** The granularity is the last dump; anything written
  after it is lost. If that's not acceptable, the path is WAL archiving
  on CloudNativePG, which is out of scope for this phase.

### Recovering the bare repos {#restore-dos-bare-repos}

Verifying costs nothing and writes nothing — it is the weekly gesture, and
since AT-195 the scheduled `restore-compose` job of `propriedades.yml` makes it
(through `make test-restore-compose`, see
[the automated path](#restore-automatizado)):

```bash
docker compose -f docker/docker-compose.prod.yml run --rm backup brabo-restore-git
```

Restoring is the once-in-an-incident gesture, and it has to be typed:

```bash
docker compose -f docker/docker-compose.prod.yml \
  run --rm --user 0:0 backup brabo-restore-git --restaurar
```

Two things about that command, both measured rather than assumed:

- **`--user 0:0` is not optional here.** `git_local_repos` is shared by three
  images running as three different uids (the api as `node`, the engine as
  `engine`, the backup image as uid 70). The volume takes the owner of whoever
  mounted it first, mode 0755: uid 70 reads it and cannot write it. Without
  root the command refuses **before** extracting, naming this fix — it does not
  discover the problem halfway through `tar`, leaving the volume part-written.
- **What is extracted is handed back to the owner of the directory**, never
  left as root. Otherwise the volume would come back intact and useless: api
  and engine, non-root, could not write into what was just restored, and the
  symptom would surface long after the restore with nothing pointing at it.

It **refuses to extract over existing repos**. Overlaying two repository states
produces a mix that no `git` complains about and nobody notices until a `fetch`
brings back the wrong history. Empty the volume, or pass `RESTORE_GIT_FORCE=1`
if the overlay is genuinely what you want.

Verification: the shell functions behind both gestures are proven on every PR by
`scripts/ci/backup-lib.spec.ts` — archive and restore round-trip identical, no
`*.lock` copied, a truncated archive refused on reading, a destination it cannot
write refused before `tar`. The commands themselves, in the backup image against
the real volume, run through `make test-restore-compose` (the verifying
half, never `--restaurar`), weekly in `propriedades.yml`. That job first
creates a bare repo in the volume (`git init --bare`, as the
`LocalGitProvider` does) and fails if the verdict does not name it: with the
volume empty, `brabo-restore-git` answers "nothing to restore" and exits 0,
which would be a green that read no archive.

### Losing the graph (Neo4j) {#perda-do-grafo}

`neo4j_data` is **not** in any backup, and that is the decision, not an
oversight ([ADR 0152](adr/0152-backup-de-volumes-contra-compose.md), decision
4). Restoring a possibly-stale projection next to a Postgres restored at another
instant gives two derived states from different moments with nothing to
reconcile them. The right answer for derived memory is to reproject from the
source — and that command exists ([RN-569](business-rules/api.md#rn-569)):

```bash
# Kubernetes (the script ships inside the api image)
kubectl -n brabo exec deploy/api -- node scripts/reprojetar-grafo.js
kubectl -n brabo exec deploy/api -- node scripts/reprojetar-grafo.js --project <project-uuid>

# installation compose (same image as Kubernetes)
docker compose -f docker/docker-compose.install.yml exec api node scripts/reprojetar-grafo.js

# a dev checkout (DATABASE_URL and NEO4J_* pointing at the database and graph)
pnpm --filter api grafo:reprojetar
pnpm --filter api grafo:reprojetar -- --project <project-uuid>
```

Expected output:

```
[reprojetar] escopo: event log inteiro
[reprojetar] eventos: 4 projetados, cursor 01M2DTREY0TBKHCHG9NWXYF0A4
[reprojetar] sessões fechadas: 2 projetadas

[reprojetar] resultado

  eventos projetados=4  sessões fechadas projetadas=2  falhas=0
  grafo agora (inteiro): nós=80  arestas=80
```

What it does, and what it guarantees:

- **The same translation as the live projector.** Event → node/edge lives in
  one class (`GraphEventTranslator`), called by both the forward projector and
  this command. It reads `handoff.offered`, `psychologist.hypothesis_proposed`
  and `anamnese.profile_updated` from `session_events`, and the `Interacao` of
  every session in `closed`/`closed_abnormally` from `sessions` (closing a
  session leaves no event in the log).
- **Idempotent, and it never deletes.** Every write is a `MERGE` on a natural
  key: running it twice gives the same graph, and **running it again is how you
  retry** after a failure halfway. It only adds or converges; a node already in
  the graph stays.
- **In batches, by cursor.** `session_events` is walked in `id` order (ULID,
  the primary key), 200 rows at a time — never the whole table in memory. The
  progress line prints the cursor; `--after-event <id>` resumes the event phase
  after it. Starting over is equally safe, just slower.
- **It does not touch the outbox, so the api can stay up.** The live projector
  keeps its progress in `outbox_events.processed_at`
  (`aggregate_type = 'graph_projection'`); this command neither reads nor
  writes that table, so it cannot steal, reopen or mark a row. Both write with
  `MERGE` on the same keys.
- **It fails named, never as silent success.** Neo4j unconfigured or
  unreachable is refused *before* reading the log (an empty scope would
  otherwise "succeed" with zero projected); Neo4j dropping mid-run stops with
  the last event completed; an unknown `--project` is refused with nothing
  written; an item with an incoherent payload is counted, named, and the run
  exits `1` at the end.

What it does **not** rebuild, and the one ordering caveat:

- **`PromptTemplate`/`PromptVersion`** do not come from the event log. Their
  source is the `prompts/` directory: re-send them with
  `node scripts/dev/seed-prompts.ts` (idempotent by hash).
- **`PerfilAnamnese` is a snapshot keyed by user + dimension, with no project.**
  Last writer wins. A `--project` run replays only that project's profile
  events, so it can leave a snapshot at that project's latest value when another
  project wrote a newer one. The full run (no `--project`) walks the whole log in
  order and restores the global latest — use it after losing the graph; keep
  `--project` for a targeted repair.
- **A full run takes a maintenance window, with no time ceiling**, and how
  long it takes on a large log is unmeasured — see
  [Running a full reprojection](#reprojecao-em-janela) for the window, the
  progress line and how to tell how far along it is.

The proof is `make test-reprojecao`
(`apps/api/test/scripts/reprojetar-grafo.spec.ts`): it builds a scenario with
the forward projector, **wipes** that subgraph, reprojects, compares node and
edge counts plus the list of keys, and reprojects again. It needs Neo4j up and
skips without it — the api CI job has no Neo4j, so there it skips. It does not
depend on a backup having happened, on purpose.

The same proof also runs **inside the local cluster**: `make test-reprojecao-k8s`
(`deploy/k8s/test-reprojecao.sh`) is the fourth target of the scheduled
`propriedades.yml` (see [Scheduled property proofs](#provas-de-propriedade-agendadas)).
It runs the command exactly as this section tells you to run it in an incident
(`kubectl exec deploy/api -- node scripts/reprojetar-grafo.js --project <id>`),
against the cluster's Postgres and Neo4j, on a project it creates itself.
Since AT-191 its scenario exercises **all four translation paths** of the
`GraphEventTranslator` — a `handoff.offered`, a
`psychologist.hypothesis_proposed` citing a message as evidence, an
`anamnese.profile_updated` for a user of its own, and the `Interacao` of the
closed session — and requires **9 nodes and 6 edges** before the wipe, after
the rebuild and after the second run (measured on run `36498776825`). The
Psychologist and the Anamnesis stay paused: the proof appends the events they
would write and checks what the reprojection rebuilds from them.

The graph being empty until you run this has a named effect: reads that depend
on the graph degrade. The RAG is **not** affected — it lives in pgvector, which
is inside the dump.

#### Running a full reprojection: a maintenance window, no time ceiling {#reprojecao-em-janela}

A full reprojection (graph or [artifact folder](#perda-da-pasta-de-artefatos))
is a rare **recovery** operation, and it runs in a **maintenance window, with no
time ceiling** — maintainer's decision (2026-09-27). Nothing in the product
times it out, warns when it takes long, or schedules it: it runs for as long as
the event log takes, and you plan the window for that.

How long that is on a production-size log is **unmeasured**. The only real run
so far is the development compose (98 events in `session_events`, 2.5 s end to
end); a proportional extrapolation from it is not a measurement, so time the
first full run of your installation and keep that number for the next window.

**Following the progress.** The command prints one line per batch — every 200
events of the types it reads — before the final result, so a run that is
still printing is still walking the log:

```
[reprojetar] eventos: 200 projetados, cursor 01M2DTREY0TBKHCHG9NWXYF0A4
[reprojetar] eventos: 400 projetados, cursor 01M2DV3K8Q2S7ZB1CXN4W6Y9HR
...
[reprojetar] sessões fechadas: 200 projetadas
[reprojetar-artefatos] artefatos: 200 projetados, cursor 01M2DTREY0TBKHCHG9NWXYF0A4
```

The number is how many were **projected** (items that failed are printed on
their own line and counted in `falhas=` at the end). The line does not carry a
total. To know how far along the run is, ask Postgres, with the cursor from the
last line — reading only, so it is safe while the run goes on:

```sql
-- graph, event phase: how many in total, and how many still after the cursor
SELECT count(*) AS total,
       count(*) FILTER (WHERE id > '<cursor>') AS remaining
  FROM session_events
 WHERE type IN ('handoff.offered', 'psychologist.hypothesis_proposed',
                'anamnese.profile_updated');

-- graph, second phase (the Interacao of each closed session)
SELECT count(*) FROM sessions WHERE status IN ('closed', 'closed_abnormally');

-- artifact folder
SELECT count(*) AS total,
       count(*) FILTER (WHERE id > '<cursor>') AS remaining
  FROM session_events
 WHERE type IN ('artifact.note', 'artifact.business_rule',
                'artifact.decision_record', 'artifact.product_brief',
                'artifact.module_map', 'artifact.module_routing',
                'artifact.project_image', 'artifact.c4_diagram',
                'artifact.prototipo_navegavel', 'artifact.plano_de_teste',
                'artifact.threat_model', 'artifact.insight',
                'artifact.rfc_staff');

-- when the cursor event was written (ids are ULIDs, ordered by time)
SELECT created_at FROM session_events WHERE id = '<cursor>';
```

Add `AND session_id IN (SELECT id FROM sessions WHERE project_id = '<project-uuid>')`
to a count when the run has `--project`. The type lists are the ones the
commands read (`EVENTOS_DO_LOG_PROJETAVEIS` in
`apps/api/src/application/graph-projection/graph-event-translator.ts`,
`ARTIFACT_PROJECTABLE_EVENT_TYPES` in
`apps/api/src/domain/artifacts/artifact-projection-events.ts`); if either file
gained a type, the count here is short by it.

**What this decision does not add.** No ceiling, no warning, no reprojection
split into windows or scheduled by the product. `--project` and
`--after-event` stay exactly what they already were — a targeted repair and a
resume after an interruption — and are **not** the way to fit a full recovery
into a shorter window: a `--project` run cannot restore the global
`PerfilAnamnese` snapshot (above), and resuming in the middle of a versioned
artifact type can leave an older version ([below](#perda-da-pasta-de-artefatos)).
The full run is the recovery. Interrupting it is safe — the idempotence above
holds — and running it again from the start is always correct, just slower.

### Losing the artifact folder (`docs/`) {#perda-da-pasta-de-artefatos}

Every artifact the agents emit lives **only in the event log**; the `docs/`
folder of the project is a **projection** of it ([ADR 0148](adr/0148-artefatos-projetados-em-arquivo.md)),
so it is not in any backup and that is the decision, not an oversight
([ADR 0152](adr/0152-backup-de-volumes-contra-compose.md) reasons the same for the
graph). Restoring the database does **not** bring it back by itself: the
outbox rows that drive the live projector are already marked processed, so
nothing rewrites the folder. The command that does exists
([RN-590](business-rules/api.md#rn-590)):

```bash
# Kubernetes (the script ships inside the api image)
kubectl -n brabo exec deploy/api -- node scripts/reprojetar-artefatos.js
kubectl -n brabo exec deploy/api -- node scripts/reprojetar-artefatos.js --project <project-uuid>

# installation compose (same image as Kubernetes)
docker compose -f docker/docker-compose.install.yml exec api node scripts/reprojetar-artefatos.js

# a dev checkout (DATABASE_URL pointing at the database)
pnpm --filter api artefatos:reprojetar
pnpm --filter api artefatos:reprojetar -- --project <project-uuid>
```

Expected output:

```
[reprojetar-artefatos] escopo: event log inteiro
[reprojetar-artefatos] artefatos: 6 projetados, cursor 01M2DTREY0TBKHCHG9NWXYF0A4

[reprojetar-artefatos] resultado

  artefatos projetados=6  falhas=0
```

What it does, and what it guarantees:

- **The same translation as the live projector.** Event → folder, file name
  and Markdown live in one class (`ArtifactEventTranslator`), called by both
  the forward projector and this command.
- **Idempotent, and it never deletes.** The file name is a function of the
  event (versioned types: `<type>.md`; append-only: with the `seq`), so running
  it twice rewrites the same files with the same content, and **running it
  again is how you retry**. A file you created in `docs/` stays.
- **In batches, by cursor.** `session_events` is walked in `id` order, 200 rows
  at a time; `--after-event <id>` resumes after the printed cursor.
- **It does not touch the outbox**, so the api can stay up.
- **It fails named, never as silent success.** A write that fails (full disk,
  unreachable folder, a project whose folder is gone) is counted and named per
  event, does not stop the rest, and the run exits `1` at the end. An unknown
  `--project` is refused with nothing written.

Where it writes, and what it does **not** cover:

- **It must see the same disk as the api.** The folder is resolved by the same
  function the projector uses (`container`/`runner`:
  `<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>/docs/`; `mounted`: inside the
  project folder). Run it in the api image, with the api's volumes.
- **It writes to the project's *current* location.** A mode conversion does not
  move `docs/` (the conversion code never touches it), so files written before
  it stay at the old location; reprojecting recreates them at the current one.
- **Versioned types show the last event, so do not resume in the middle of
  them.** `module_map`, `module_routing`, `project_image` and `c4_diagram`
  overwrite one file; a full run ends with the latest emitted version, while
  `--after-event` starting between two versions can leave an older one.
- **What it does not read:** types outside the projectable list (`qa_verdict`,
  `secops_verdict`, `task_blocked`, `infra_delegation_files`) were never files
  and are not recreated.
- **It runs in a maintenance window, with no time ceiling**, the same as the
  graph: the progress line and the queries to follow it are in
  [Running a full reprojection](#reprojecao-em-janela). How long it takes on a
  large event log is unmeasured; the command is safe to interrupt and run
  again.

The proof is `apps/api/test/scripts/reprojetar-artefatos.spec.ts`: it builds a
scenario with the forward projector on a real Postgres and a real disk, **wipes**
the folder, reprojects, compares every path and content, and reprojects again.
It runs on every PR. The command as this section tells you to run it in an
incident — `node scripts/reprojetar-artefatos.js` inside the api **image** — is
proved by `make test-reprojecao-artefatos-k8s` (`deploy/k8s/test-reprojecao-artefatos.sh`,
AT-198), the sibling of the graph's cluster target: it creates its own project
with an `artifact.note` through the API, waits for the live projector to write
it, deletes the agent's `docs/<agent>/` folder **inside the api pod**, runs the
image's own script with `--project`, and requires the rebuilt file to have the
**same sha256** as the one the live projector wrote — then runs it again and
requires the same hash (idempotence). It runs in the scheduled
`.github/workflows/propriedades.yml`, and like its sibling it depends on no
other target.

### When the restore fails

| symptom | probable cause |
|---|---|
| `no backup under .../daily/` | wrong bucket, wrong credential, or the CronJob never ran |
| `not an intact custom dump` | interrupted upload; use the previous object or `weekly/` |
| `pg_restore failed` with an extension error | the destination database needs the same extensions (`pgvector`); on CNPG they come from the cluster, not the dump |
| `missing tables in the restored copy` | a dump from a different schema version — the script says WHICH ones are missing; check the object's date against the most recent migration |
| `out of window` on a critical table | count doesn't match the dump's timestamp: investigate before promoting |
| `server version mismatch` | the Job's `pg_dump` is 16; a cluster on a different major refuses the connection |
| Job timeout | database too large for `activeDeadlineSeconds`; raise the value on the Job, not the CronJob |
| `destination inaccessible … does not accept writes` | with `BACKUP_DIR`, the directory exists and the container's uid can't write it. It is a **write** check, not an existence one, on purpose: a read-only destination would pass `ls` and fail the dump, with the error surfacing after `pg_dump` and pointing at the wrong thing |
| `tar of the bare repos exited with N` | something changed under the repos mid-read — most likely a concurrent `git gc`. The run is marked `failed` rather than shipping a partial archive. Run it again |
| `there are N bare repo(s) … and NO archive` | this volume has no coverage: the archive is missing while the repos are not. Absent-and-empty is normal and reported differently |
| `does not accept writes by this user (uid 70)` on `--restaurar` | the shared-volume ownership case — restore with `--user 0:0`, see [Recovering the bare repos](#restore-dos-bare-repos) |

### Scheduled property proofs {#provas-de-propriedade-agendadas}

`make test-restore`, `make rollout-test` and `make hpa-test` prove
**properties**, not configuration — a backup that runs every night and does not
restore passes all five alerts in `brabo-alerts.yaml`. Until BRB-009 they ran
only when someone typed them. `.github/workflows/propriedades.yml` now runs
them on a schedule, in a k3d cluster on a GitHub-hosted runner:

1. installs `k3d`, `helm` and `kubectl` by pinned checksum;
2. runs `deploy/k8s/bootstrap.sh` — the same bootstrap `make deploy-local`
   runs, building the four production images from the checked-out tree (no
   registry, no secret) — with `BRABO_SKIP_OBSERVABILITY=1` (AT-177): none of
   the proofs reads Tempo, Loki, the Collector, Alloy or Grafana, and that is
   the only difference from the cluster `make deploy-local` gives you;
3. runs `make smoke-k8s`, then `make hpa-test`, `make rollout-test` and
   `make test-restore`, in the `Makefile`'s order, each one even when an earlier
   one failed (a broken HPA must not hide a broken restore);
4. runs `make test-restore-mutacao` (AT-126, BRB-009), the proof **of** the
   proof: it takes a real backup, then creates a table (`zz_mutacao_restore`) in
   the source that the dump does not have — exactly "a dump missing a table" —
   and runs the same `brabo-restore`. It passes only if the restore **rejects**
   it and names that table (the log line `faltando: zz_mutacao_restore`); if the restore
   approves, or rejects for another reason, the step fails and opens its own
   issue. A green `make test-restore` says the backup restores; this says the
   proof would still notice if it did not. The table is dropped on exit, even on
   failure. It runs even when `make test-restore` failed (a blind proof and a
   broken restore are two defects, and both must show);
5. runs `make test-reprojecao-k8s` (AT-127, BRB-018): the graph is not backed up
   ([ADR 0152](adr/0152-backup-de-volumes-contra-compose.md)) because it is
   reprojected from the event log, so the workflow proves that too — it creates
   its own project with a closed session and four events (a message, a
   handoff, a Psychologist hypothesis and an Anamnesis profile — every path of
   the translator, AT-191), reprojects it, **wipes that subgraph** in Neo4j,
   reprojects, and requires the same node and edge counts (9|6), then
   reprojects again. It uses no state left by the other targets and
   is **not** coupled to `test-restore` (the graph does not depend on a backup);
6. runs `make test-reprojecao-artefatos-k8s` (AT-198, RN-590), the same proof
   for the other derived projection — the `docs/` folder of the artifacts. It
   creates its own project with an `artifact.note`, waits for the live
   projector to write the file, **deletes the agent's folder inside the api
   pod**, runs the image's `node scripts/reprojetar-artefatos.js --project`,
   and requires the **same sha256**; then reprojects again and requires it
   once more. It depends on no other target;
7. runs `make test-rotacao-chave-mestra-k8s` (AT-146), **last**: the three steps
   of the [master key rotation](#rotacao-da-chave-mestra) — both keys published
   in the `brabo` source Secret, the `ExternalSecret` force-synced, the api
   restarted, the image's `rewrap-deks.js`, the previous key removed and the api
   restarted again — with every envelope checked to open at each step and a
   credential decrypting to the same value at the end. It swaps the cluster's
   master key and restarts the api, which is why nothing runs after it;
8. only when **both** the restore and the deliberate break passed in the same
   run, writes `ultima-execucao-boa.json` (date, run, commit, restore duration)
   and uploads it as the `restore-ultima-execucao-boa` artifact (kept 90 days),
   and adds the line *Última execução boa do restore* to the run summary;
9. writes each step's duration into the run summary.

A **second job**, `restore-compose` (AT-195), runs next to it on another
runner — the production compose publishes 3000/4000/8088, the same ports the
k3d cluster maps, so the two cannot share one. It builds the four images with
`docker-bake.hcl` (as `ci.yml` does), brings the production compose up through
`docker/smoke.sh` (which leaves the seed's user and session in the database),
creates a bare repo in `git_local_repos` as a fixture, and runs
`make test-restore-compose`: a real backup, the restore with the three
validations, and the verification of the bare-repo archive. A green without the
line naming the verified bare repos fails the step. Its failures open issues
the same way, with titles of their own.
Measured on run `36371633435`: image build 190 s, compose up (smoke) 43 s,
`make test-restore-compose` 4 s — 4 min 31 s for the job, in parallel with the
11 min of the cluster job, so the workflow's clock does not move.

| trigger | when |
|---|---|
| `schedule` | weekly, Sunday 04:00 UTC |
| `workflow_dispatch` | on demand, from the Actions tab (`gh workflow run propriedades.yml`) |

**A failure opens an issue** titled `Prova de propriedade falhou: <target>`,
one per target, and a repeat failure of the same target **comments on the open
issue** instead of opening another. The bootstrap has a title of its own: with
the cluster down, the three targets are `skipped`, and a skipped scheduled run
is the silence this exists to break. **The first run in which the target
passes closes its issue** with a comment naming that run (AT-212) — nobody has
to remember to. Only a run on the **default branch** (the schedule, or a
`workflow_dispatch` on it) touches issues: a red `workflow_dispatch` on a
branch fails in its own run, logs a warning, and neither opens nor comments on
the schedule's issue, and a green one on a branch closes nothing. Runs are
queued **per ref** (`concurrency: propriedades-<ref>`): two dispatches on
different branches run side by side, two on the same ref wait for each other.
It is **not** a gate and not a required check — nothing waits on it.

Measured on the runs that built the workflow (4 vCPUs, 15 GiB RAM, 87 GB of
free disk on `ubuntu-latest`):

| step | duration |
|---|---|
| bootstrap (image build + cluster + operators + app) | 705 s |
| `make smoke-k8s` | 1 s |
| `make hpa-test` | 19 s |
| `make rollout-test` | 24 s |
| `make test-restore` | 21 s |
| `make test-restore-mutacao` | 31 s (run `35473548113`) |
| `make test-reprojecao-k8s` | 16 s (run `35471428634`); 18 s with the four-event scenario (run `36498776825`) |
| `make test-reprojecao-artefatos-k8s` | 4 s (run `36498695123`, whole job 10 min 28 s) |
| `make test-rotacao-chave-mestra-k8s` | 47 s (run `36502355798`, whole job 12 min 10 s) |
| whole job | 12 min 56 s |

(First fully green run, `34784563928`, on 2026-09-13.)

With `BRABO_SKIP_OBSERVABILITY=1` and the operators in parallel (AT-177), the
helm phase went from 253 s (run `36362479629`, on `dev`) to 89–90 s, the
bootstrap from 710 s to 547–555 s and the whole job from 13 min 43 s to
10 min 59 s (runs `36367504128` and `36368334920`). The image build (141–161 s)
and the `seed-smoke` wait (still 180 s) are unchanged by it.

**The image build stays a plain `docker build`, on purpose** (AT-178, measured
and declined). Building the four images through `docker-bake.hcl` with the
`type=gha` cache `ci.yml` already uses — in parallel, loaded into the daemon,
the bootstrap then running with `BRABO_SKIP_BUILD=1` — was tried on a branch
and ran green twice:

| | image build | whole job |
|---|---|---|
| `docker build` in the bootstrap (runs `36367504128`, `36368334920`) | 161 s, 145 s | 10 min 59 s |
| bake, first run on the ref (`36369702417`) | 177 s (buildx setup included) | 11 min 44 s |
| bake, warm cache (`36370592556`) | 116 s (buildx setup included) | 11 min 32 s |

Warm, the step gains 30–45 s; cold, it loses 15–30 s; at the job level the
difference is inside the run-to-run noise. The run that matters is the weekly
one on `main`, and the Actions cache evicts an entry nobody read for 7 days —
a weekly cadence is exactly where the cache is most often cold. The
`no-cache-filter = ["runtime"]` of the bakefile (AT-110) also rebuilds every
final stage anyway, which is what keeps the warm gain small. Revisit only with
a measurement showing a warm cache on the scheduled run.

The cadence follows that cost. Almost all of it is the bootstrap, which a
nightly run would pay seven times a week to re-prove properties whose code
changes far less often than that; weekly keeps the alarm inside one sprint,
and `workflow_dispatch` covers "I just touched the backup". The job timeout is
90 minutes and the restore step alone is capped at 20 — see the comment on
that step for why the cap belongs to the step and not to the script.

**What the first runs found**, each one invisible to `kubeconform` and to
every PR check, and each one fixed in the same change that created the
workflow — `make deploy-local` had been broken on `dev` for weeks without
anyone running it:

1. The CNPG cluster's `imageName` pinned by digest alone
   ([ADR 0159](adr/0159-imagem-de-terceiro-por-digest.md)) is refused by the
   operator's webhook — *"Can't use just the image sha as we can't detect
   upgrades"*. It now carries `:16.10@sha256:…`.
2. The bootstrap's source Secret had no `NEO4J_PASSWORD`, which the base
   `ExternalSecret` reads since the graph ([ADR 0099](adr/0099-neo4j-grafo-de-conhecimento-e-templates.md)):
   `brabo-secrets` never materialized and every pod sat in
   `CreateContainerConfigError`.
3. The api got neither `NEO4J_URI` nor `NEO4J_USER` in the cluster, and in
   production mode it refuses to boot without all three.
4. The Neo4j StatefulSet exported `NEO4J_USER`/`NEO4J_PASSWORD`, which the
   image's entrypoint turns into config keys and rejects (*"Unrecognized
   setting"*) — the very defect a comment two lines below warned about. Those
   manifests had never run in a cluster.
5. `migrate-api` could not `CREATE EXTENSION vector` (the app role is not a
   superuser), so the api came up with no tables. The local CNPG cluster now
   creates it as superuser, in the app database and in `template1`.
6. `deploy/k8s/smoke.sh` and `rollout-test.sh` never sent the session `kind`
   that became mandatory in FASE 20 (`docker/smoke.sh` got it then), so both
   failed with a 400 before proving anything.
7. `make test-restore` died in `pg_restore` with *"permission denied to create
   extension vector"* — the case the table above already names — because
   nothing in the local cluster provided the extension to the database the
   restore creates.
8. With the extension provided, `pg_restore` still died — now with *"must be
   owner of extension vector"*, on the dump's `COMMENT ON EXTENSION`: only the
   extension's owner may comment on it, and wherever the app role is not a
   superuser (CNPG, any managed Postgres) the extension belongs to another role.
   **This one is not local to the cluster**: the same `brabo-restore` is the
   incident procedure, so a real restore on such a Postgres would have failed
   the same way. `restore.sh` now restores from the dump's table of contents
   minus the extension comment — a description string the extension installs,
   which no data and no validation depends on. Reproduced against a plain
   `pgvector` container with a non-superuser role before and after the change.
9. `deploy/k8s/test-restore.sh` waited with `kubectl wait
   --for=condition=complete`, which never sees a Job that **failed**, so the
   broken restore above spent the step's whole 20-minute cap to report what the
   Job's log said in seconds (the script's own cap was 30). It now polls both
   conditions and fails as soon as the Job is `Failed`.
10. `rollout-test.sh` checked for orphans after a fixed `sleep 15`, which
    cannot tell *still settling* from *orphaned for good*. It now polls up to a
    ceiling (`ROLLOUT_CONVERGENCE_SECONDS`, default 120) and records, before the
    rollout, which replica each session lived on — the old pods take their logs
    with them.

**Measured, and the likely cause since fixed** (AT-078,
[RN-588](business-rules/engine.md#rn-588)) — the old pod's `Monitor` deleting the
`session_states` row its peer had just re-written; see
[Proving nothing was left orphaned](#rollout-do-engine) for what a new orphan
would log. What follows is the record from before the fix. **The rollout proof
had failed once out of four runs that reached it** (two out of ten by run `35448353884`, 2026-09-19, where
all five sessions lived on the same old pod, four were adopted and one ended
with no owner and no drain; the only logs that named it died with that pod —
which is why the proof now keeps them, see
[Proving nothing was left orphaned](#rollout-do-engine)). With the same script and the same fixed wait, run
`34773908653` passed and run `34775712706` reported an orphan — a session
`active` in the api with no owner in any of the three engine replicas, 15 s
after `rollout status` returned. The two runs with the bounded wait passed, and
both converged in **3 s**, all five sessions adopted. A normal convergence
of 3 s makes "the orphan just needed more than 15 s" the less likely reading;
the more likely one is an intermittent race in adoption or drain that the fixed
wait happened to catch. It is left as it is on purpose: the workflow exists to
catch exactly this, and the next occurrence will now fail with the ceiling it
waited, where each session lived before the rollout, and the engine lines that
name the orphan. The fix belongs to the engine, not to this proof.

### Last verified run

> **The scheduled workflow is now the source for this, and the date is no
> longer edited by hand** (AT-126). The latest run of
> [`propriedades.yml`](#provas-de-propriedade-agendadas) that has the
> `restore-ultima-execucao-boa` artifact is the last time the restore passed on
> Kubernetes **and** a deliberate break of it was caught in the same run:
> `gh run list --workflow propriedades.yml --status success --limit 1`, then
> `gh run download <run> -n restore-ultima-execucao-boa` (kept 90 days). It is
> a workflow artifact, not a metric: a Prometheus gauge next to the backup
> alerts would need code in `apps/api`, which this change did not touch (BRB-009 stays open on that half). The record below is kept as it was written: it is the
> history of the first verification and of what it found.

<!-- Update this section whenever you run the test on a new environment. -->

| field | value |
|---|---|
| date | 2026-07-27 |
| environment | local k3d cluster, PostgreSQL 16.10 (CloudNativePG), MinIO |
| command | `make test-restore` |
| observed RTO | ~40s from triggering the backup to the verdict (a ~108 KB database) |

Output:

```
[restore]   ok    intact dump (108127 bytes)
[restore] restoring into brabo_restore_test
[restore]   ok    pg_restore completed
[restore]   ok    35 tables restored, identical to the source
[restore]   ok    users: 2 rows (window 2–2)
[restore]   ok    projects: 2 rows (window 2–2)
[restore]   ok    sessions: 2 rows (window 2–2)
[restore]   ok    session_events: 7 rows (window 7–7)
[restore]   ok    proposed_actions: 0 rows (window 0–0)
[restore]   ok    intact event log: 7 events across 2 sessions, dense seq starting at 1
[restore] RESTORE VALIDATED — all checks passed
```

The RTO above is for an empty production database — it's useful to prove
the PROCEDURE, not to size a real recovery. Measure again with a
representative dump before promising anyone an RTO.

#### What this run found (and that the test now prevents)

1. **Postgres major-version mismatch.** The local CloudNativePG was
   running 17.4 while the compose says 16; `pg_dump` refused the
   connection with "server version mismatch". The cluster's `imageName`
   was pinned to 16.10.
2. **False green from an empty database.** With zero rows, every count
   comparison becomes `0 == 0` and the `seq` check looks at nothing.
   Today the script explicitly fails in both cases.
3. **A fixed table count ages.** The validation compared against a number
   written in the script, which was already stale in that same session.
   It now compares the LIST of tables against the source and says which
   one is missing.
4. **The backup image carried 48 HIGH/CRITICAL CVEs** coming from `mc`
   (Go frozen since September 2025) and from `gosu` in the
   `postgres:16-alpine` base. Swapped for `alpine` + `postgresql16-client`
   + `aws-cli`, all from apk and therefore patchable: 48 → 0. See
   decision 1b of ADR 0027.

### Last verified run — compose, disk destination

| field | value |
|---|---|
| date | 2026-09-09 |
| environment | Docker compose, PostgreSQL 16 (pgvector image), destination on **disk** — no cluster, no bucket, no `kubectl` |
| command | `docker/backup/test-restore-compose.sh` (what `make test-restore-compose` runs) |
| database | 55 tables, 422 events across 13 sessions — a populated database, not an empty one |
| bare repos | 2 (`exp001.git`, `exp004.git`), 27 003 bytes archived |

Output (the three steps, abridged):

```
[backup] destination: disk at /backups
[backup] generating dump for daily/brabo-20260909T025733Z.dump
[backup] archiving 2 bare repo(s) for git-daily/brabo-git-20260909T025733Z.tar.gz
[backup] finished: daily/brabo-20260909T025733Z.dump (322894 bytes)
[restore]   ok    55 tables restored, identical to the source
[restore]   ok    session_events: 422 rows (window 422–422)
[restore]   ok    intact event log: 422 events across 13 sessions, dense seq from 1
[restore] RESTORE VALIDATED — all checks passed
[restore-git]   ok    2 intact bare repo(s) (27003 bytes)
[test-restore-compose] backup restored and intact
```

`backup_runs` got its `status = 'ok'` row for each run, with the **dump** as
`object_key` — the same column `restore.sh` queries for the snapshot window.

#### What this run found

**The bare-repo restore could not write the volume it restores into**, and only
running it revealed that. `git_local_repos` is shared by three images with three
uids; it carries the owner of whoever mounted it first (measured: `1000:1000`,
mode 0755) and the backup image runs as uid 70. The first `--restaurar` died
mid-extraction with `tar: can't make dir ./exp001.git: Permission denied`,
leaving the target part-written. Two changes came from it, both above: the
command refuses **before** extracting and names `--user 0:0`, and when it does
run as root it hands the extracted tree back to the directory's owner instead of
leaving it root-owned — which would have produced a volume that restores
perfectly and that api and engine cannot write to.

Verified afterwards with real `git` (not the backup image, which has none):
`git fsck --connectivity-only` clean on both repos, refs and commits intact,
ownership back at `1000:1000`.

---

## Auth key rotation {#rotacao-das-chaves-do-auth}

Decisions in
[ADR 0031](adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) and
[ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md).

First-party auth has **three** secrets, with very different consequences
when swapped. Confusing the first two is the expensive mistake here.

### `AUTH_JWT_SECRET` — zero-downtime rotation {#rotacao-do-auth-jwt-secret}

The Ed25519 pair that signs the access token is derived from it. Rotation
is the same three-step dance as the master key (below):

1. `AUTH_JWT_SECRET_PREVIOUS` gets the old value; `AUTH_JWT_SECRET` gets
   the new one. Restart the api.
2. Both keys appear at `/.well-known/jwks.json` and both verify; only the
   new one **signs**. The api emits a `WARN` once per process, on the first
   verification or JWKS read after boot (the previous key is derived on
   demand, not at startup), for as long as that lasts.
3. After 15 minutes (the access token's TTL), no token from the old key
   survives. **Remove `AUTH_JWT_SECRET_PREVIOUS`** and restart.

Nobody gets logged out: refresh tokens are hashed with `AUTH_TOKEN_PEPPER`,
not with this key, and since [RN-613](business-rules/api.md#rn-613)
the pepper is mandatory and never borrowed from this key.

**The order, if this installation predates RN-613: pepper FIRST, JWT after.**
Before RN-613 an unset pepper silently fell back to `AUTH_JWT_SECRET` — and
the production and install composes didn't even pass `AUTH_TOKEN_PEPPER` to
the api, so that was every compose installation. Now the api **refuses to
boot** without the pepper, with a message saying what to do. The migration
that logs nobody out:

1. Set `AUTH_TOKEN_PEPPER` to the **current** value of `AUTH_JWT_SECRET`
   (copy it; don't generate a new one). Restart the api. The token hashes are
   byte for byte what they were, so every refresh token and PAT keeps working.
   `install.sh` does this step by itself when it finds the previous `.env` in
   the folder it runs from, and says so on the terminal without printing the
   value; Kubernetes already had `AUTH_TOKEN_PEPPER` in the `ExternalSecret`.
2. Only then rotate `AUTH_JWT_SECRET` with the three steps above. From here on
   the two secrets are independent, and a pepper equal to the *old* JWT
   secret is the expected state, not a leftover.

**If someone rotates the JWT before separating**, on a version before RN-613
that rotation *was* a pepper change: everyone is logged out, every open
email/reset link dies and every PAT stops authenticating — the global logout
described in the next section. There is no undo short of putting the old
value back as `AUTH_TOKEN_PEPPER` (which revives the old tokens that haven't
expired, and invalidates anything issued in between). On RN-613 and later the
mistake can't happen silently: without a pepper the api doesn't boot. The one
way to still hit it is generating a **new** pepper during the migration
instead of copying the current JWT secret — same global logout.

Verification: `apps/api/test/infrastructure/security/ed25519-access-token-issuer.spec.ts`
(describe "rotação de chave"); for the pepper,
`apps/api/test/infrastructure/security/auth-key-material.spec.ts` (describe
"pepperAtual (RN-613)": the boot refusal and its message),
`apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`
(describe "a migração do RN-613": a refresh hashed by the old fallback stays
valid with the pepper set to the old JWT secret, and survives the JWT
rotation) and `scripts/dev/install-env.spec.ts` (the `.env` the installer
writes in both cases, through `docker compose config`).

### `AUTH_TOKEN_PEPPER` — global logout, no middle ground {#troca-do-auth-token-pepper}

This is the HMAC key for hashing refresh tokens and account tokens.
Changing it invalidates, all at once:

- **every** refresh token in circulation — everyone gets logged out;
- **every** open email-verification and password-reset link;
- **every** personal access token (PAT) — a runner started with `--token`
  stops authenticating (device keys are not affected);
- the lockout counters: every locked account unlocks.

Passwords survive (argon2id, no pepper): people log back in normally. A
refresh rejected this way shows up as `refresh_unknown` in `auth_events`,
not as `refresh_reuse_detected`.

There's no `AUTH_TOKEN_PEPPER_PREVIOUS`, and that's a conscious decision:
accepting double verification on every refresh, forever, for a scenario
that runs once in a blue moon, isn't worth it. If you need to change it —
suspected database leak, for instance — warn people first: the symptom
for the user is being logged out for no apparent reason and seeing the
reset link say "expired".

> The api does **not** fail to boot with a new pepper. It simply stops
> recognizing any old token. If support reports "everyone got logged out
> at the same time", this variable is the first place to look — and, on a
> version before [RN-613](business-rules/api.md#rn-613) where it was
> never set, `AUTH_JWT_SECRET`. It **does** fail to boot without one, in
> production: see the migration order above.

Verification: `apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`
([RN-597](business-rules/api.md#rn-597)).

### `BRABO_SERVICE_TOKEN` — zero-downtime rotation, on both sides {#rotacao-do-brabo-service-token}

This is the shared secret that authenticates api ↔ engine traffic
([RN-035](business-rules/api.md#rn-035)). It has nothing to do with a user
session: getting it wrong doesn't log anyone out, it breaks internal
communication.

The dance is the same as `AUTH_JWT_SECRET`, with the difference that it
runs on **both** loads — and order matters, because each side sends its
current one and accepts both:

1. `BRABO_SERVICE_TOKEN_PREVIOUS` gets the old value on **both api and
   engine**; `BRABO_SERVICE_TOKEN` gets the new one on both. Restart
   both. In production the api, the engine and the broker check the old
   value with the same rule as the new one, so if the old value is the public
   default or shorter than 16 characters, each of them refuses to boot at
   this step and names the variable
   ([RN-598](business-rules/api.md#rn-598),
   [RN-601](business-rules/engine.md#rn-601)). Rotating away from a
   weak token therefore means skipping `_PREVIOUS`, and paying for it with
   the `403`/`401` window described below.
2. While both are up with the new variable, traffic works in any
   combination of old and new pods — that's what makes the rollout safe
   mid-way through.
3. Once both Deployments' rollout is done, **remove
   `BRABO_SERVICE_TOKEN_PREVIOUS`** and restart.

Skipping step 1 and just swapping the current value produces `403`/`401`
for the entire window where an old pod remains on either side — the
symptom in the
[diagnosis above](#diagnostico-do-deploy).

Verification: on the api, `apps/api/test/infrastructure/security/service-token.spec.ts`
(describe "rotação do BRABO_SERVICE_TOKEN") and
`apps/api/test/interfaces/engine-service.guard.spec.ts`; on the engine,
`apps/engine/test/engine_web/plugs/verify_service_token_test.exs` and
`apps/engine/test/engine/runtime_service_token_test.exs` (the boot rule); on
the broker, `apps/broker/src/config.spec.ts`.

> **Where the `_PREVIOUS` variables reach the process.** In the three
> composes (`docker-compose.yml`, `docker-compose.prod.yml`,
> `docker-compose.install.yml`) all of them are mapped in the `environment:`
> of the service that reads them, empty by default — setting one in `.env`
> and recreating the service is enough
> ([RN-595](business-rules/api.md#rn-595); guarded by
> `scripts/ci/previous-nos-composes.spec.ts`, which derives the list from the
> code). **In Kubernetes they reach the Pods through the secret store**
> (AT-220): the `ExternalSecret`
> (`deploy/k8s/base/common/externalsecrets.yaml`) pulls the whole `brabo`
> object with `dataFrom.extract`, so a `_PREVIOUS` that exists there lands in
> `brabo-secrets` and one that doesn't simply isn't there — no sync failure
> outside a rotation. They are never listed one by one: a `data` entry whose
> property is missing fails the sync of the whole Secret, and a missing
> `_PREVIOUS` is the normal state. Either way, confirm it inside the
> container (`printenv`) before relying on step 2.

#### Doing it in Kubernetes {#rotacao-no-kubernetes}

The same dance, with the `brabo` object in the secrets provider standing in for
`.env`. In the local cluster that object is the Secret `brabo` the bootstrap
created; in staging/prod it is the provider entry the `SecretStore` points at.

1. **Add** the `_PREVIOUS` key (old value) and **replace** the current key (new
   value) in the `brabo` object — both in the same change. Locally:

   ```bash
   kubectl -n brabo patch secret brabo --type merge -p \
     '{"stringData":{"AUTH_JWT_SECRET_PREVIOUS":"<old>","AUTH_JWT_SECRET":"<new>"}}'
   ```

2. **Make the operator sync now** instead of waiting for the `refreshInterval`
   (1h), and check the key arrived:

   ```bash
   kubectl -n brabo annotate externalsecret brabo-secrets force-sync="$(date +%s)" --overwrite
   kubectl -n brabo get secret brabo-secrets -o go-template='{{range $k, $v := .data}}{{$k}}{{"\n"}}{{end}}' | grep _PREVIOUS
   ```

3. **Restart** whoever reads it. `envFrom` is read when the container starts:
   the Secret changing does not change a running Pod. `api` for
   `AUTH_JWT_SECRET` and `CREDENTIALS_MASTER_KEY`, `api` **and** `engine` for
   `BRABO_SERVICE_TOKEN`:

   ```bash
   kubectl -n brabo rollout restart deployment/api deployment/engine
   kubectl -n brabo exec deploy/api -- printenv AUTH_JWT_SECRET_PREVIOUS
   ```

4. **Retire it** when the rotation's own condition is met (15 min for
   `AUTH_JWT_SECRET`, both rollouts done for `BRABO_SERVICE_TOKEN`,
   `falhas=0` and zero pending for the master key): **remove** the `_PREVIOUS`
   key from the `brabo` object, force the sync again (step 2 — the key
   disappears from `brabo-secrets`, it isn't left behind) and restart again
   (step 3). Until the restart the Pods keep the old value in memory, and the
   api keeps warning that a rotation is in progress.

   ```bash
   kubectl -n brabo patch secret brabo --type json -p \
     '[{"op":"remove","path":"/data/AUTH_JWT_SECRET_PREVIOUS"}]'
   ```

Verification: the four steps were exercised against the External Secrets
Operator chart pinned in `deploy/k8s/helm/charts.env` (0.19.2) in a throwaway
k3d cluster, with the local `SecretStore`: the key appeared in
`brabo-secrets` after the `force-sync` and disappeared after removal, with the
`ExternalSecret` staying `SecretSynced`. Since AT-146 the same four steps run
every week for `CREDENTIALS_MASTER_KEY`, inside the master key rehearsal
(`make test-rotacao-chave-mestra-k8s`, see
[Verifying without waiting for an incident](#rotacao-da-chave-mestra)) — the
other `_PREVIOUS` keys still have no automated run. What runs on every PR is
`scripts/ci/previous-nos-composes.spec.ts`, which fails if the
`ExternalSecret` stops using `dataFrom.extract` or lists a `_PREVIOUS` in
`data:`.

```bash
# generate a value with enough entropy; it never needs to be typed
openssl rand -base64 48
```

### Account locked by lockout {#conta-travada-por-lockout}

The lockout is short (30s to 15 minutes) and resolves itself: the
sliding window drains. **There's no unlock endpoint**, on purpose — see
[RN-031](business-rules/api.md#rn-031). If you need to unlock someone right
now:

```sql
-- The key is an HMAC of the email, not the email. Find it from the recent event:
select subject_key, count(*), max(occurred_at)
  from auth_events
 where kind in ('login_failure', 'login_blocked_user')
   and occurred_at > now() - interval '30 minutes'
 group by subject_key order by 3 desc;

delete from auth_lockout_hits where bucket_key = '<subject_key>';
```

A successful password reset also unlocks the account.

Verification: **none** for the two queries above — they were checked against
the schema by reading, never executed by a spec. The lockout itself (the
window, the counter, what unlocks it) is covered by
`apps/api/test/application/use-cases/auth/lockout.spec.ts`.

> **The trail is never erased.** `auth_lockout_hits` is an ephemeral
> counter; `auth_events` is append-only and survives everything, including
> the user being removed (no foreign key, on purpose).

## Master key rotation {#rotacao-da-chave-mestra}

Decisions in [ADR 0027](adr/0027-fase5-backup-hardening-release.md).

`CREDENTIALS_MASTER_KEY` wraps the DEKs that encrypt the user's secrets:
LLM API keys and git tokens. It's rotated periodically and, mandatorily,
after any suspected leak.

### What's at stake

Changing the variable and restarting the api with a single key makes every
existing credential unreadable, all at once, with no boot error — the failure
only shows up on first use, as "unable to decrypt", and there's no way back
short of restoring the old key.

That's why rotation has three steps, not one. During the middle one, both
keys coexist:

| variable | role |
|---|---|
| `CREDENTIALS_MASTER_KEY` | CURRENT key — always used to encrypt |
| `CREDENTIALS_MASTER_KEY_PREVIOUS` | previous key — tried only when the current one fails |

Two tables hold envelopes: `user_credentials` and
`project_git_connections`.

Since [RN-563](business-rules/api.md#rn-563) each envelope also carries a
**`key_id`** — the fingerprint of the key that wrapped it. It is what makes
the progress of step 2 answerable in SQL. Two things about it matter at 3am:

- **It never decides whether a row opens.** Reading still tries the current
  key and falls back to the previous one; AES-GCM authenticates, and it is the
  authority. The label is metadata, and a row whose label disagrees with its
  envelope is still re-wrapped correctly ([ADR 0158](adr/0158-o-id-da-chave-mestra-gravado-no-envelope.md)).
- **`key_id IS NULL` means "written before that column existed", never "on the
  current key".** On an installation that predates it, everything is `NULL`
  until the first rotation, and the queries below count that as pending — which
  is the honest answer.

Get the current fingerprint from the api's own log; it prints one line at boot:

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=200 \
  | grep 'chave mestra corrente'
# chave mestra corrente: key_id=4f2b91c0a77e13d5
```

### Before: size it up

```sql
select 'user_credentials' as tabela, count(*) from user_credentials
union all
select 'project_git_connections', count(*) from project_git_connections;
```

The re-wrap is an UPDATE per row. Thousands of rows take seconds; it's
good to know the order of magnitude before starting.

### 1. Publish both keys

Generate the new one and publish **both** to the secrets provider, keeping
the old one in `CREDENTIALS_MASTER_KEY_PREVIOUS`:

```bash
openssl rand -hex 32   # the new key
```

In the local cluster the source Secret is created by the bootstrap; in
staging/prod the value goes into the provider that External Secrets reads
from. Then restart the api so it loads both:

> Publishing `CREDENTIALS_MASTER_KEY_PREVIOUS` in the `brabo` object of the
> provider puts it in `brabo-secrets` on the next sync (the `ExternalSecret`
> pulls the whole object) — force the sync and confirm it arrived as in
> [Doing it in Kubernetes](#rotacao-no-kubernetes), then restart. In the
> composes it's the `.env` plus recreating the api.

```bash
kubectl -n brabo rollout restart deployment/api
kubectl -n brabo rollout status  deployment/api
```

Confirm the api is in rotation mode — it warns in the log, on purpose, and the
warning names **both** fingerprints, which is what the queries below compare
against:

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=50 \
  | grep CREDENTIALS_MASTER_KEY_PREVIOUS
# ... rotação em andamento (atual key_id=<NEW>, anterior key_id=<OLD>). ...
```

> From here on **nothing breaks**: a new secret is already born on the new
> key, an old secret is still readable via the previous one. You can
> pause in this state for hours if you need to — but not for weeks:
> accepting two keys doubles the surface of a leaked key, which is
> exactly why you're rotating.

### 2. Re-wrap the store

```bash
kubectl -n brabo exec deploy/api -- node scripts/rewrap-deks.js
```

Expected output — the script prints in Portuguese, and this is what it
actually writes (`apps/api/src/scripts/rewrap-deks.ts`, `main`):

```
[rewrap] resultado

  user_credentials         total=12  re-embrulhados=12  já na chave atual=0  falhas=0
  project_git_connections  total=3   re-embrulhados=3   já na chave atual=0  falhas=0

[rewrap] concluído. Agora remova CREDENTIALS_MASTER_KEY_PREVIOUS e reinicie a api.
```

The counters read: `re-embrulhados` = re-wrapped, `já na chave atual` =
already on the current key, `falhas` = failures. Two other endings exist.
When nothing needed re-wrapping, the last line is `[rewrap] nada a fazer — o
acervo já está na chave atual.` ("nothing to do — the store is already on the
current key"). When any row failed, each one goes to `stderr` as
`[rewrap] <table>#<id>: <reason>`, the run ends with `[rewrap] <N>
registro(s) não abriram com nenhuma das duas chaves. NÃO remova
CREDENTIALS_MASTER_KEY_PREVIOUS até resolver.` ("N row(s) opened with
neither key — do NOT remove PREVIOUS until resolved"), and the exit code is 1.

Properties that matter if something interrupts the script:

- **Idempotent.** Running it again counts already-converted rows as
  `já na chave atual` and rewrites nothing. Interrupted? Run it
  again.
- **Only the envelope changes.** The secret's ciphertext stays byte for
  byte the same, so stopping halfway leaves the store consistent: part on
  the new key, part on the old, and both readable as long as PREVIOUS
  exists.
- **`falhas > 0` blocks step 3.** These are rows that don't open with
  either key — usually coming from a different environment, or from an
  earlier rotation that was interrupted with the key already discarded.
  The script identifies each one by id, and names WHY it failed — a row from
  another environment ("embrulhado pela chave `<kid>`"), a row whose label
  disagrees with its envelope ("rótulo incoerente ou registro adulterado"),
  and a row with no label at all are three different diagnoses with three
  different answers. Don't remove PREVIOUS: without it you also lose what
  still opened.

**Interrupted, and want to know where it stopped?** Ask the database instead of
re-running the script for its counter — with `<NEW>` the current fingerprint
from the log above:

```sql
select 'user_credentials' as tabela, count(*) as pendentes
  from user_credentials       where key_id is distinct from '<NEW>'
union all
select 'project_git_connections', count(*)
  from project_git_connections where key_id is distinct from '<NEW>';
```

`is distinct from`, never `<>`: rows with `key_id IS NULL` must count as
pending, and `<>` would silently drop them.

### 3. Discard the old key

Only once `falhas=0` **and** the query above answers `0` on both tables. The
two say different things and you want both: `falhas=0` means nothing refused
to open on this run, and the query means nothing is left behind — including
rows that a previous, interrupted run never reached.

```bash
# remove CREDENTIALS_MASTER_KEY_PREVIOUS from the provider, then
kubectl -n brabo annotate externalsecret brabo-secrets force-sync="$(date +%s)" --overwrite
kubectl -n brabo rollout restart deployment/api
```

Verify that the rotation warning is gone from the log and that an
existing credential still works (the most direct path is the project's
credentials screen, or any agent turn that uses an LLM key).

### Verifying without waiting for an incident

**The whole cycle has a named verification, and it runs in CI**
([RN-562](business-rules/api.md#rn-562)):

```bash
pnpm --filter api test -- test/scripts/rewrap-deks.spec.ts
```

That spec drives the sequence of this page against a real Postgres and **both**
tables: encrypt with K1, publish K2, re-wrap, drop K1, and still decrypt. It
also pins the two properties this procedure leans on — idempotence (a second
run reports `re-embrulhados=0`) and the unreadable row being counted and named
without aborting the others.

Narrower, in-memory coverage of the same primitives — including the case where
neither key works, and the case where the `key_id` label lies — lives in
`test/infrastructure/security/envelope-encryption.service.spec.ts`.

`rewrap` also runs in any environment: on a test one, the full cycle by hand
fits in a few minutes.

**Has it ever run for real? No.** The maintainer's answer (2026-09-27): this
rotation has **never** been executed in a real environment. So the spec above
is not a safety net under a practised procedure — until AT-146 it was the only
proof, and it never touched the image, the `ExternalSecret` or an api restart.

**The rehearsal, in the cluster, every week (AT-146).**
`make test-rotacao-chave-mestra-k8s` (`deploy/k8s/test-rotacao-chave-mestra.sh`)
runs the three steps of this page against the local cluster, with the same
mechanics: it writes an LLM credential with a random value through the API
and checks every envelope opens on today's key; **step 1** publishes the new
key and the old one as `_PREVIOUS` in the `brabo` source Secret (the local
stand-in for the provider — never `brabo-secrets` directly), forces the
`ExternalSecret` sync, waits for `_PREVIOUS` to arrive, restarts the api and
requires the rotation warning naming **both** fingerprints; **step 2** requires
pending rows by the query above, runs the image's `node scripts/rewrap-deks.js`
(`falhas=0`), requires **zero** pending, and runs it again (`nada a fazer`);
**step 3** removes `_PREVIOUS` from the source, requires it to **disappear**
from `brabo-secrets` after the sync, restarts the api, requires the boot line
with the new fingerprint and no rotation warning, and checks every envelope
opens with the new key alone — and that the credential from the start decrypts
to the **same value** (compared by sha256 inside the pod; the value never
leaves it). The verdict is the exit code. It is the **last** target of the
scheduled `.github/workflows/propriedades.yml`, because it swaps a secret and
restarts the api, and it leaves the cluster on the new key with no `_PREVIOUS`
— a finished rotation, not a half-way one. First green run: `36502355798`
(2026-09-29, 47 s).

What the rehearsal does **not** cover, declared: `project_git_connections`
rows (creating a git connection through the API validates a token against a
real provider, and the proof cluster has no egress — the table is read by the
verifier and by `rewrap`, usually with 0 rows; its envelope is the same code,
proven on both tables by the spec above), and the staging/production secrets
provider (here the source is the local Secret the overlay's `SecretStore`
reads; the `ExternalSecret` and the operator are the real ones). It is a
rehearsal in a throwaway cluster, **not** a rotation of any real environment:
"never ran for real" stays true until someone rotates one.

### Interaction with restore

**Restoring a dump into an environment with a different master key gives
you back an intact database with useless credentials.** The dump carries
the wrapped DEKs, not the key. If you restored a production backup into a
test environment and the credentials don't open, it's not corruption:
it's the wrong key — and since [RN-563](business-rules/api.md#rn-563) you can
confirm it in one comparison instead of by elimination, by reading `key_id`
off any row and putting it next to the `chave mestra corrente` line in the
api's boot log. See
[Restore](#restore).

That's why the master key is part of the recovery plan: a database backup
without the matching key doesn't recover the user's secrets.

### When something goes wrong

| symptom | cause |
|---|---|
| the api boots with no rotation warning, but the script requires PREVIOUS | the variable never reached the pod; ESO only resyncs every `refreshInterval` (1h) |
| `falhas` equal to the total | the published PREVIOUS isn't the key that wrapped the store |
| `já na chave atual` equal to the total, without having run before | both variables have the same value — the service ignores PREVIOUS in that case |
| a credential stops working AFTER step 3 | some row was left behind; republish PREVIOUS immediately and run the script again. The progress query in step 2 is what prevents this, and it is the check to run first |
| the pending query answers the full total, on a database nobody rotated yet | expected: `key_id` is written from the next write on, so an installation that predates [RN-563](business-rules/api.md#rn-563) has it `NULL` everywhere until the first rotation. `NULL` counts as pending on purpose — "I don't know which key" is not "already current" |
| `rewrap` says a row is on a key that is neither the current nor the previous one | the row came from another environment — most often a dump restored across installations. See [Interaction with restore](#rotacao-da-chave-mestra) below; the `key_id` in the row versus the one in the api's boot log tells you at a glance |

---

## Cost incident {#incidente-de-custo}

Agents spend tokens on every turn, and an agent stuck in a loop spends
fast. This section is for the moment cost per hour spikes and someone
needs to decide what to cut.

### Signal

The *Cost per hour above the limit* alert fires when projected spend goes
above USD 5/hour on any project:

```promql
max(sum by (project) (rate(brabo_llm_cost_micros_total[10m])) * 3600 / 1000000)
```

The alert is a **warning**, not a brake. The real brake is the domain's
`budgets`, and it acts per project/session, never globally
([RN-019](business-rules/api.md#rn-019)).

### 1. Which project, which agent

Grafana → **Brabo · executive view** dashboard → cost-per-project panel.
Or straight from the database, which also gives you the agent and the
model:

```sql
select s.project_id,
       tu.actor_id                             as agente,
       tu.model_name,
       count(*)                                as chamadas,
       sum(tu.cost_micros) / 1e6               as usd,
       round(avg(tu.latency_ms))               as latencia_media_ms
  from token_usage tu
  join sessions s on s.id = tu.session_id
 where tu.created_at > now() - interval '1 hour'
 group by 1, 2, 3
 order by usd desc
 limit 20;
```

Two readings change the action:

- **One agent dominating the list** with many short calls means a loop:
  the ToolLoop repeating the same tool without converging.
- **Few calls and high cost** means an expensive model on cheap work —
  wrong binding, not a loop.

### 2. Check the budget

```sql
select b.project_id, b.session_id,
       b.limit_micros / 1e6  as limite_usd,
       b.spent_micros / 1e6  as gasto_usd,
       round(100.0 * b.spent_micros / nullif(b.limit_micros, 0)) as pct,
       b.policy
  from budgets b
 order by pct desc nulls last;
```

`policy` decides the behavior at the ceiling:

- **`block`** — the call is refused. This is the default and what you
  want in production.
- **`allow`** — the ceiling becomes a mere record; spending continues. A
  project on `allow` spending heavily **won't stop on its own**. Check
  this before anything else: it's the most common cause of "the budget
  didn't hold".

### 3. Cut the spend

In order of reversibility, from mildest to most drastic.

**a) Take the agents out of automatic autonomy.** They stop acting on
their own and go back to requiring per-action approval, without losing
context:

```sql
update agent_autonomy
   set mode = 'require_approval', updated_at = now()
 where project_id = '<projeto>'
   and mode = 'auto_approve';
```

`agent_autonomy.mode` is the `permission_policy` enum
(`auto_approve | require_approval | deny`) — there is no `manual` value,
and an earlier version of this step used it and failed on the spot. The
`and mode = 'auto_approve'` is deliberate: without it, the update would
turn every `deny` row of the project into `require_approval`, loosening
exactly what someone had closed. The `"*"` rows (auto mode, RN-153) are
covered by the same update.

What this step does **not** cut: a pattern in `allow` in the project's
`permissions.json` still auto-approves what it matches — `decide()` reads
the file after `agent_autonomy`, and the file can raise the decision back
to `auto_approve` (`apps/api/src/domain/actions/decide.ts`, `decide`).
If the spend comes from commands the file allows, go to (c).

The SQL blocks of this section are run against the migrated schema by
`apps/api/test/runbook/sql-do-incidente-de-custo.spec.ts`, which also
checks that (a) changes `auto_approve` and leaves `deny` alone — an
invalid value or a renamed column here fails the api suite, not the
incident.

**b) Switch the model binding to a local one.** Ollama costs zero; quality
drops, spending stops on the spot:

```sql
-- see the binding in effect and the scope that resolves it
select scope, scope_id, model_id from model_bindings where scope_id = '<projeto>';
```

Then point the project's binding at a `local` model through the settings
screen (the most specific scope wins: session > agent > project >
workspace — [RN-020](business-rules/api.md#rn-020)).

**c) Lower the ceiling and make sure it's `block`.** Makes the domain
itself refuse the next calls:

```sql
update budgets
   set policy = 'block',
       limit_micros = least(limit_micros, spent_micros + 1000000)  -- +1 USD
 where project_id = '<projeto>';
```

**d) Close the project's sessions.** Last resort: interrupts work in
progress. Use the normal transition (`closing`), never `kill` on the pod
— killing the pod doesn't close a session, it just creates an orphan
(see [Engine rollout](#rollout-do-engine)).

### 4. Afterward

- **The Psychologist already has the evidence.** If the cause was an
  agent loop, its analysis points at the target agent and Anamnesis can
  propose an instruction patch. Fixing the instruction is what prevents
  it happening again; touching the budget only buys time.
- **Check that the alert arrived.** The rules live in Grafana, not
  Prometheus: if Grafana was down, there was no warning, and the silence
  didn't mean health.

### What this section doesn't fix

Cost already incurred. Metering is a record, not a refund: `token_usage`
counts what was spent, and nothing here gives money back from the
provider. The only real prevention is `policy = 'block'` with a sensible
ceiling **before** the incident.

---

## Observability {#observabilidade}

How to follow a session, find cost, and diagnose when there's no data.
Decisions in
[ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md).

### Local observability, no cluster {#observabilidade-local}

Everything below this subsection assumes the cluster is up. For metrics
and logs without bringing up Kubernetes, there's a Compose overlay
([ADR 0070](adr/0070-observabilidade-no-compose-local.md)):

```bash
pnpm dev:obs     # brings up the dev stack + Prometheus, Loki, Alloy, and Grafana
pnpm obs:down    # tears down just the four, leaving the apps up
```

The command finishes by checking what came up — if it says `ok` on every
line, the panel has data; if it complains, it says which piece was
missing.

Verification: that closing check is `scripts/dev/observabilidade-pronta.mjs`,
and it is a **self-check, not a proof** — it runs only when someone brings the
overlay up, and it has no spec and no workflow. A change that breaks the
overlay surfaces the next time someone runs `pnpm dev:obs`.

| tool | address | serves for |
|---|---|---|
| Grafana | <http://localhost:3001> | dashboards and logs, no login |
| Logs | <http://localhost:3001/d/brabo-logs> | one service at a time, or all three together |
| Prometheus | <http://localhost:9090> | checking a target and raw series |
| Loki | <http://localhost:3100> | direct query (the normal path is Grafana) |

**The dashboards are the SAME as the cluster's** — Compose mounts
`deploy/k8s/observability/dashboards/` directly, and the datasource UIDs
(`brabo-prometheus`, `brabo-loki`) are the same. A new dashboard is valid
in both environments with no copying.

**What this overlay doesn't do:** tracing. Without an OpenTelemetry
Collector in the middle there's no Tempo, and that's a decision, not an
oversight ([ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md),
decision 9). The `trace_id` still goes into the log and is enough to
cross-reference api and engine by hand.

Three things that confuse people, and are worth knowing before opening an
issue:

1. **An empty cost/tokens panel is expected on a fresh database.** Those
   metrics have labels (`project`, `provider`), and in `prom-client` a
   labeled metric doesn't exist before its first observation. One LLM
   call and the series appears.
2. **Only `api`, `engine`, and `web` go to Loki.** Postgres and Ollama are
   left out for noise; the observability stack itself is left out because,
   in the same Compose project, it would ingest its own log in a loop.
3. **The `OUTRO` (OTHER) level** is `pino-pretty`'s tree continuation
   line, which has no level of its own. It's not a lost log.

### Where things are

| tool | local address | serves for |
|---|---|---|
| Grafana | <http://localhost:3001> | dashboards, traces, logs, alerts |
| Prometheus | `kubectl -n monitoring port-forward svc/prometheus-server 9090:80` | checking a target and raw series |
| Tempo | Grafana datasource | traces |
| Loki | Grafana datasource | logs |

Two dashboards in the **Brabo** folder: *executive view* (cost/hour and
tokens/min per project, active sessions, action decisions) and
*operational view* (Oban queue by state, LLM p50/p95 latency by provider,
blocked tasks, sessions per replica).

### Following a session from the root to a tool call

1. Grab the session's `trace_id`. It's the middle field of the
   `traceparent` stored in `sessions.trace_parent`:

   ```bash
   # 00-<trace_id>-<span_id>-01
   curl -sS -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/projects/$PROJ/sessions/$SESS | jq -r .traceParent
   ```

2. In Grafana → **Explore** → **Tempo** datasource → **TraceQL** tab,
   paste the `trace_id`. The tree comes back with `session.create` (api)
   at the root and, below it, `agent.turn` → `tool.call` / `llm.turn` /
   `gate.scanner` (engine).

3. From a span, the **Logs for this span** button jumps to the Loki lines
   with that `trace_id`. The reverse path — from a log line to the trace
   — is the **TraceID** link that shows up in the line's detail.

4. Cost for that session: the *executive view* dashboard filters by
   project. For an exact per-session value, the source is the database
   (`token_usage.cost_micros`), not the metric — the metric is aggregated
   by project and provider on purpose, to avoid creating one series per
   session.

### When there's no trace in Tempo {#quando-nao-ha-trace-no-tempo}

This section's name changed along with its behavior (ADR 0035), and the
distinction is the first diagnostic step: **a span is always created, in
any environment.** What `OTEL_EXPORTER_OTLP_ENDPOINT` controls is
EXPORTING. So "I don't see a trace in Grafana" and "there's no trace" are
different problems.

Before anything else, see which side the failure is on — the log answers
on its own:

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=20 | grep -o '"trace_id":"[^"]*"' | head
```

- **There's a `trace_id` in the log, no trace in Tempo** → the problem is
  exporting: follow 1 through 4 below.
- **No `trace_id` in the log** → the problem is context, and it's rarer:
  either the api's `startTracing()` didn't run (see
  `apps/api/src/tracing-boot.ts` — it has to be `main.ts`'s first import),
  or `Engine.Telemetry.Otel.setup/0` wasn't called before the supervision
  tree.

In order, most to least likely:

**1. The variable isn't set.** Without `OTEL_EXPORTER_OTLP_ENDPOINT` the
span is created and discarded at the end, so there's a `trace_id` in the
log and nothing in Tempo. In development that's expected (no collector);
in a cluster, it's a defect.

```bash
kubectl -n brabo exec deploy/api -- printenv OTEL_EXPORTER_OTLP_ENDPOINT
kubectl -n brabo exec deploy/engine -- printenv OTEL_EXPORTER_OTLP_ENDPOINT
```

**2. The NetworkPolicy is blocking it.** This is the most silent failure
of all: the spans are created, the send fails, and everything else stays
green.

```bash
kubectl -n brabo get networkpolicy allow-otlp-egress
kubectl -n brabo logs -l app.kubernetes.io/name=engine --tail=50 | grep -i "error exporting"
```

**3. Wrong protocol.** Elixir's exporter speaks **HTTP/protobuf (4318)**,
not gRPC. Pointing it at 4317 gives `socket_closed_remotely` on every
batch.

**4. The Collector isn't receiving anything.**

```bash
kubectl -n monitoring logs deploy/otel-collector-opentelemetry-collector --tail=30
```

### When a panel is empty

Almost always a **metric name**. Names are referenced by string in three
places that don't see each other: the dashboards, the alert rules, and
this runbook. Check against what the service actually exposes:

```bash
curl -sS http://localhost:3000/metrics | grep '^brabo_' | cut -d'{' -f1 | sort -u
kubectl -n brabo exec deploy/engine -- wget -qO- http://127.0.0.1:4000/metrics | grep -E '^(brabo|oban)_'
```

And if the service exposes it but Prometheus doesn't have it, the
problem is the scrape:

```bash
kubectl -n monitoring port-forward svc/prometheus-server 9090:80
# then: http://localhost:9090/targets — the jobs are `brabo-api` and `brabo-engine`
```

### When there's no log in Loki

Alloy is a DaemonSet and reads `/var/log/pods` from the node, filtering
by the `brabo` namespace.

```bash
kubectl -n monitoring logs -l app.kubernetes.io/name=alloy --tail=30 | grep -i error
```

Warnings about `tailer stopped ... pods not found` are normal after a
rollout — Alloy keeps chasing pods that have already been removed.

The apps **can't** talk to Loki directly, and that's intentional:
`allow-otlp-egress` only opens 4317/4318. To query from outside:

```bash
kubectl -n monitoring port-forward svc/loki 3100:3100
curl -sS -G http://localhost:3100/loki/api/v1/query_range \
  --data-urlencode '{app="api"} | json | trace_id != ""' --data 'limit=5'
```

### Alerts

Provisioned and visible under **Alerting → Alert rules** (Brabo folder), from
`deploy/k8s/observability/alerts/brabo-alerts.yaml`. The rules carry their
titles in Portuguese — that is what you search for in Grafana:

| alert (title in Grafana) | severity | fires after | what to investigate |
|---|---|---|---|
| *Fila do Oban crescendo sem consumo* — Oban queue growing with no consumption | `critical` | 10 min | no engine replica Ready; Postgres pool exhausted; a worker stuck on a job |
| *Sessão presa em closing* — session stuck in `closing` | `warning` | 15 min | [the drain didn't complete](#quando-a-sessao-escapa), or the transition to `closed` failed |
| *Custo por hora acima do limite* — cost per hour above the limit | `warning` | 5 min | [which project and which agent](#incidente-de-custo); the domain's budget remains the hard control |
| *Backup do Postgres atrasado* — last good backup older than 26 h | `critical` | at once | the CronJob didn't run, or ran and failed — `brabo_backup_last_status` tells the two apart; see [Restore](#restore). "Never had a backup" (`-1`) does **not** fire it |
| *Última execução do backup falhou* — last backup run failed | `warning` | at once | a good backup from yesterday may still exist, which is why this one goes unnoticed for days; the cause is in `backup_runs.error_message` |

These are **Grafana** rules, not Prometheus (deviation recorded in ADR
0026): they stop being evaluated if Grafana goes down. There's no
Alertmanager or notification destination configured.

### Known limits

- No **real** agent trace has been observed end to end: verifying that
  requires a configured LLM (Ollama or an API key). The mechanism was
  validated by emitting spans directly into the session's trace.
- The web doesn't export its own spans — it **generates** the
  `traceparent` and sends it in the header, and the api adopts it as
  parent. Browser logs go to the console, not to Loki.
- Short retention: Tempo 24h, Loki 24h, Prometheus 2h. It's a local
  environment.

---

## Gate registry {#registro-de-gates}

The flow's gates are declared in `docs/gates.yml`
([ADR 0054](adr/0054-gates-como-registro-declarativo.md)). Two operational
things are worth knowing.

**The file travels inside the image.** `docker/api/Dockerfile.prod` copies
it in both stages, the same way it does with migrations, and
`.dockerignore` re-includes it explicitly — all of `docs/` is ignored, and
this is the only file from there that's production data, not
documentation. At runtime it sits at `/app/docs/gates.yml`; the loader
climbs up from `__dirname` until it finds it, with no environment
variable.

**An unreadable file doesn't bring down the api.** Loading is lazy:
whoever calls `GET /internal/gates` gets the error, and the rest of the
process keeps going. If the route returns an error, check that the file
made it in:

```bash
kubectl -n brabo exec deploy/api -- cat /app/docs/gates.yml | head -5
```

Empty or missing means the image was built without it — likely a tweaked
`.dockerignore`, or a build from a context that has no `docs/`.

**The registry travels; what it points at does not.** A `teste`/`ci` gate
names files under `apps/api/test/`, `scripts/ci/` and `.github/`, and none
of them are in the image. Until this was separated, the loader required
those files at runtime and the route answered `500` in every installation
— measured on v6.1.0 as twelve 5xx in about 55 minutes, with
`RegistroDeGatesInvalido` listing all eleven targets as "does not exist".
Reproduce the old failure with:

```bash
docker exec <api> node -e "require('/app/infrastructure/gates/gate-registry.loader').carregarRegistro()"
```

On a fixed image that prints nothing. If it throws
`RegistroDeGatesInvalido` naming a `.spec.ts` or a workflow, the image is
from before the fix ([RN-070](business-rules/api.md#rn-070)); if it
throws naming a gate's *content* (a `block` gate without `script`, an
`active` gate without evidence), the registry itself is wrong and the
repository is where to fix it.

The screen does not show this failure: `PrGateTimeline` falls back to the
full pipeline when `GET /gates` fails ([RN-084](business-rules/api.md#rn-084)),
so the only signal was the api's log. `docker/smoke.sh` now calls both
routes that serve the registry against the production image, `GET /gates`
with the user's bearer and `GET /internal/gates` with the service token.
One function checks the body of both, and it fails on the `500`, on an
empty list and on a registry without `merge-protegida`. That is what keeps
the failure from coming back silently. The token reaches `curl` through
stdin (`--config -`), never through argv, so it does not show in `ps` or in
the CI log.

To see the registry the way the api sees it, already validated:

```bash
kubectl -n brabo exec deploy/api -- \
  curl -sH "x-brabo-service-token: $BRABO_SERVICE_TOKEN" localhost:3000/internal/gates
```

Passage measurement does NOT run in production: it's
`pnpm --filter api validacao:gates`, from the repository, against the
database. See
[docs/explanation/gates.md](explanation/gates.md).

---

## Inference environment {#ambiente-de-inferencia}

When the agent responds empty, truncated, extremely slowly, or "forgets"
its own instructions, the problem is almost never in the domain code —
it's here. The first five causes were found across nine straight runs of
the gates demo and are recorded in
[ADR 0020](adr/0020-destravar-gates-qa-secops.md); all the variables are
exposed in `docker-compose.yml`.

| variable | symptom when wrong |
|---|---|
| **GPU** | the `ollama` service with no device reserved leaves the GPU idle and runs 100% on CPU: a ~7,000-token prompt takes ~50s just for ingestion. The override is opt-in (`docker-compose.gpu.yml`, `pnpm dev:gpu`), kept out of the main compose because without `nvidia-container-toolkit` on the host the reservation **makes the service fail to start** |
| `OLLAMA_CONTEXT_LENGTH` | the default of 4096 **silently** truncates a prompt built for 128k. The agent loses its own instructions and starts imitating the tools' schema, which is what's left at the end of the context |
| `OLLAMA_MAX_LOADED_MODELS` | with `OLLAMA_KEEP_ALIVE` set high, models pile up: 15.2 GB of resident weights on a 15 GB machine, and the agent responds empty for lack of memory |
| `OLLAMA_REQUEST_TIMEOUT_MS` | too short a timeout for a large model on a long prompt |
| `OLLAMA_MODE` (dev bootstrap, [RN-461](business-rules/infra.md#rn-461), ADR 0114) | stuck at `host` after the native Ollama on the developer's machine was uninstalled or stopped — every local-LLM turn fails with `ECONNREFUSED` against `http://host.docker.internal:<port>`, and the compose `ollama` service never starts to cover for it (it's gated behind `profiles: ["local-llm"]`, and this variable is what keeps that profile off). Fix: `Docker › Reconfigurar Ollama` in `pnpm bootstrap`, which clears `OLLAMA_MODE`/`OLLAMA_HOST` from `.env` and forces the detection to ask again on the next `Create`/`Reset total` |
| `START_OUTBOX_DRAIN` / `START_ANAMNESE` | the Psychologist and Anamnesis consume LLM turns in parallel with the execution agents and drop the dev's connection mid-cycle |
| `TOOL_LOOP_MAX_ITERATIONS*` | a ceiling that's too LOW and the agent stops without delivering, with `iteration limit reached` and origin `model` — which is misleading, because the model made no wrong judgment at all, it never got to judge. The ceiling is per TYPE ([RN-085](business-rules/engine.md#rn-085)): `8` for conversational agents, `60` for the dev agent and QA. Before raising it, check whether the agent HAS `token_budget_micros`; without it the ceiling is the only cost guard that exists |
| `TERMINAL_OUTPUT_MAX_BYTES` | raising it too much brings back the failure mode the ceiling exists to prevent: each command's output stays in the loop's history and travels on EVERY following turn. It's not a context-window issue: the largest successful call from the execution that first revealed this had only 28,993 input tokens ([RN-074](business-rules/engine.md#rn-074)) |
| `API_JSON_BODY_LIMIT` (api) / `TRANSPORT_MAX_BODY_BYTES` (engine) | the `413 request entity too large` on the QA/SecOps gate had its cause in Brabo's own api, never in the provider — Express never had a body limit configured and the default of 100 KB was in effect, against the 8 MB Phoenix accepts on the heaviest engine→api leg (`POST .../llm-turn`, which resends the entire history on every iteration). `API_JSON_BODY_LIMIT` (default 10 MB) closes that end; `TRANSPORT_MAX_BODY_BYTES` (default 8 MiB) is the ceiling the engine's context compaction respects ON TOP OF the model's window, so it fires before the body blows the HTTP limit ([RN-412](business-rules/api.md#rn-412), [ADR 0098](adr/0098-limites-de-transporte-e-janela-efetiva-de-compactacao.md)) |

> **Careful — the guard doesn't clear the queue.** `START_ANAMNESE=false`
> blocks **new** enqueues, not the old ones. There have been 20
> `AnamneseWorker`s piled up in `executing` from previous runs, which run
> on the next boot regardless of the guard. The queue needs to be
> **purged**, not just have the guard turned off.

> **Turning the Anamnesis or the Psychologist on: two variables, not
> one.** Both were paused on 2026-08-10 by product decision, not a bug. The
> Psychologist still is; the Anamnesis was turned back on by the owner on
> 2026-10-01 ([RN-680](business-rules/engine.md#rn-680)) — `ANAMNESE_ENABLED`
> defaults to `true` again in the code and the three composes, and a round
> with no eligible subject makes no LLM call and says why in the engine log
> (`sem_sujeito_elegivel`). Pausing it again is `ANAMNESE_ENABLED=false`. `ANAMNESE_ENABLED` / `PSYCHOLOGIST_ENABLED` are the
> product flags (may a NEW round happen at all); `START_ANAMNESE` is the boot
> key (is the periodic tick even scheduled). The periodic Anamnesis needs both
> at `true`; the Psychologist has no boot key, because its automatic trigger
> is session close.
>
> Until [RN-540](business-rules/engine.md#rn-540) the two `*_ENABLED` flags were
> **not mapped** in either compose's `engine` service, and `docker compose`
> does not forward the host environment — so setting them in `.env` did
> nothing at all, silently, while three places in the code promised the pause
> was reversible. They are mapped now, with the code's own default (`false`
> in both files at the time; `ANAMNESE_ENABLED` is `true` since RN-680). The **install** compose
> (`docker/docker-compose.install.yml`) was the third file and was left out of
> that fix; since AT-202 it maps the same flags with the same defaults, and
> `scripts/ci/flags-do-engine-no-compose.spec.ts` checks all **three** files
> and fails the build for the next boolean flag that isn't mapped, or that
> carries a default other than the code's (`START_OUTBOX_DRAIN` and
> `START_ANAMNESE` are `false` in the production compose on purpose, and the
> spec declares that divergence by name). The install compose used to carry
> the same `false` — copied from production together with production's reason
> ("it exists to validate the images") — and since AT-219 it repeats the
> code's `true`. That was a defect of the install, not a cost choice:
> `START_OUTBOX_DRAIN` is the only thing that drains the api's outbox into the
> engine, so on a one-machine install a closed session never stopped its
> processes and a dev agent waiting on an approval, a gate or the container
> was never woken. Neither key spends tokens with the product flags off: with
> `ANAMNESE_ENABLED=false` the Anamnesis `kickoff/0` schedules no job at all,
> and the drain only enqueues the Psychologist with `PSYCHOLOGIST_ENABLED=true`.
> On an install, the Anamnesis is therefore on or off by
> `ANAMNESE_ENABLED` alone (default `true` since RN-680). On Kubernetes there was nothing to fix — a
> Deployment/ConfigMap intercepts nothing, and `brabo-config` never carried
> these variables. Both flags are read at boot: change them and
> `docker compose up -d engine`.

### A semantic gate on a small model

QA is the role that fits worst in a local 7B: the judgment varies between
runs, which makes the demo an executable acceptance criterion and **not**
a regression test. To make it reliable, point `DEMO_QA_MODEL` at an API
model — the per-agent binding (`agent` scope, which beats `project`)
exists exactly for this.

The gate machine itself doesn't vary: immutable order, return on the same
branch, a ceiling on corrections, verdicts as an artifact, and a terminal
`awaiting_user` are all verified by ExUnit
([RN-014](business-rules/api.md#rn-014), [RN-015](business-rules/api.md#rn-015)).

---

## Installing {#instalando}

```sh
curl -fsSLO https://github.com/daneiel/brabo/releases/latest/download/install.sh && bash install.sh
```

**Download a file, then run it with `bash`.** The two shorter forms that look
equivalent are not, and the script refuses both **by name**, before
downloading anything, printing the line above:

- **Never `curl … | sh`.** The reason is mechanical, not stylistic: with the
  script arriving through the pipe, the process's `stdin` **is** the download,
  so any `read` reads bytes of the script itself or hits EOF. An installer that
  cannot ask would have to pick folder locations on someone else's machine by
  itself ([RN-526](business-rules/produto.md#rn-526)).
- **Not `sh -c "$(curl …)"` either** — this was the documented form until
  AT-083, and it never worked. The script checks **its own hash** against the
  signed manifest, and under `X -c "…"` there is no file to hash: `$0` is the
  shell's name. With `dash` as `sh` (Debian, Ubuntu) it died even earlier, on
  `set -o pipefail`. There is no switch to skip that self-check, and there will
  not be one ([ADR 0150](adr/0150-instalador-de-uma-linha.md)) — the fix is for
  a file to exist. Running it under a non-bash shell is its own named refusal
  too.

The script verifies **its own origin** before doing anything — the signature
of the Release's `checksums.txt`, and then its own hash inside that verified
manifest. A failure at either step is a **named refusal**, never a warning.

It needs **one** of `sha256sum` (coreutils, Linux) or `shasum -a 256` (ships
with macOS) to do any of that, and it resolves which one **before the first
download** — not in the middle of a check. Missing both is its **own** refusal,
naming the two tools and saying nothing was downloaded; it is a missing
dependency of the operating system, and it is deliberately *not* worded like
the hash refusals below. Those two are different outcomes asking for different
things — one is fixed by installing, the other by **stopping** — and the AT-091
measurement is what put the line between them: `sha256sum: command not found`
on macOS used to surface as *"o cosign baixado NÃO bate com o hash pinado neste
script. Isso não é um aviso: pare e investigue."*, which both blocked every
macOS install and taught the reader to ignore that sentence. `--print-plan`
needs neither tool and declares which ones the script accepts
(`conferir-hash`).

Detection has a **5s ceiling** on the Docker call it makes (`docker compose ls`
talks to the daemon, and a slow or stopped daemon behind a live socket would
hang the whole thing *before the first question*). Hitting the ceiling is not
an error — it is the same outcome as having no Docker at all, and the rest of
the signals are still read.

Without a TTY it **reports and exits 0**: it prints what it found and the
command to run in a terminal. That is deliberate, and it is the same shape
`consentir-base.mjs` already has.

**What it never deletes:** your project base and your mirror folder. Named
volumes only go with confirmation, listed one by one first.

It brings the stack up from **its own compose**
(`docker/docker-compose.install.yml`), which takes the images from variables
and builds nothing — and it **downloads that compose from the Release**
([RN-570](business-rules/produto.md#rn-570),
[ADR 0160](adr/0160-o-compose-do-instalador-viaja-assinado.md)). Four files
travel with the installer as `brabo-install-*` assets, in the **same** signed
`checksums.txt` that covers the runner binary: the compose, the
`postgres/init.sql` and `ollama/pull-models.sh` it bind-mounts, and the
`backup/test-restore-compose.sh` the migration runs. Right after verifying
itself — before any question, before writing anything — the script downloads
the four and checks each hash against that manifest. Three named refusals, all
on an untouched machine:

| message starts with | means | do |
|---|---|---|
| *"a Release não publica …"* | the Release predates ADR 0160, or its publishing step failed half-way | install from a checkout of the repository at that tag, or wait for the next release |
| *"o manifesto assinado não cobre …"* | the manifest exists but has no line for that asset | same as above — the Release is incomplete |
| *"… NÃO bate com o manifesto assinado"* | the downloaded file is not what the signed manifest describes | **stop and treat it as an incident**; do not retry around it |

The verified copies are written under `docker/` in the folder you ran the
script from — the same folder as `.env` — only when they are first needed.
Whatever was already there (the previous version's compose, on an upgrade) is
**replaced, never read**, and the script names what it replaced; from inside a
git checkout at another commit that leaves `git status` dirty.

> **Releases published before ADR 0160 do not carry these assets.** Their
> installer still uses the relative path, and the one-liner above fails in an
> empty directory with *"no such file or directory"* after writing `.env` (the
> gap [RN-549](business-rules/ci.md#rn-549) measured). For those tags, run the
> installer from a checkout of the repository at the tag you are installing.

> On the *migration* path the restore proof (`test-restore-compose.sh`) gets the
> installation's `.env` through `BRABO_ENV_FILE` (passed to Compose as
> `--env-file`), because Compose looks for `.env` next to the compose file — not
> in the directory you run from. If you run the proof by hand against an
> installation, export `BRABO_ENV_FILE=/path/to/.env` first; a path that does not
> exist is refused, never replaced by another file. A failing proof still
> deletes nothing ([RN-530](business-rules/infra.md#rn-530)).

Two sources:

```sh
install.sh                  # --source=ghcr (default): by digest, signature verified
install.sh --source=local   # buildx bake; requires a clean tree on a tag
```

Secrets are generated once and persisted into `.env` with mode **600** — the
file is created empty and locked *before* receiving content, because a window
where the secrets are world-readable is exactly what this file cannot have.

There is **no migrate step**, and there should not be: the compose chains
`api` → `migrate-api` with `service_completed_successfully`, so `up --wait`
waits for the migrations. A second place ordering migrations would be a second
source of the same truth.

After the stack is up it **asks before claiming**: `/health` on the api and on
the engine, and only then does it say it installed.

It **installs the local agent** — the binary is verified against the signed
manifest and placed with `install -m 0755`, so there is no manual `chmod`
([RN-531](business-rules/produto.md#rn-531)) — and it asks ONE base, writing it to
both sides: `BRABO_PROJECTS_BASE` in `.env` and `base` in the runner's
`runner.json`. A Release with no binary for this platform does not interrupt
the installation: it says so and points at `npm install -g @brabo/runner`.

Over an existing installation it **migrates or stops** — an `up` on volumes
from another version is damage that gives no warning. The order is backup →
**PROVE** it restores → ask → delete → install → restore, and the proof in the
middle is what gives the installer the right to delete
([RN-530](business-rules/infra.md#rn-530)).

And it knows **which** version it is replacing ([RN-542](business-rules/produto.md#rn-542)).
The images are resolved **before** detection runs, so the question is never
blind: the marker records the installed `versao`, the manifest carries the one
about to be installed, and the offer is specific to the relation between them.

| relation | what it offers | default |
|---|---|---|
| newer | *"Atualizar 5.0.0 → 5.1.0?"* | **yes** — it is what you came to do, and the proven backup makes it reversible |
| same | *"Já é a 5.0.0. Reinstalar do zero mesmo assim?"* | no — there is no gain to offer |
| older | names it a **downgrade**, warning that database migrations do not run backwards | no — it may have no way back |
| unknown | a marker from schema 1 has no version; it says so, and does not guess | no |

Whichever branch you take, the installation is **deleted and recreated from
scratch** rather than started on top of the old volumes. Half a migration is
worse than none.

An `install.sh` invoked from the `pnpm bootstrap` menu (*Docker › Instalar*)
only **reports** the plan. That is mechanical, not a preference: a menu item
runs with stdin on `/dev/null` so the menu can keep reading keys from the same
terminal, and this installer is built to *ask*. The note on the item carries
the one-line command that installs for real.

> **What it does not do:** turn the container **broker** on without asking —
> see [the broker in an installation](#broker-na-instalacao) right below. The
> local agent it **does** pair, since [RN-547](business-rules/produto.md#rn-547): it
> creates the first account, generates the machine device key on the machine,
> registers the public half, stamps the `kid` and installs the **machine** unit
> ([ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)) — and when a
> link fails it names the command to repeat, see
> [When the installer does not close the installation](#instalador-nao-fecha).
> What stays on the project screen is a **project-bound** pairing: that device
> key and `brabo-runner.config.json` still come from there
> ([ADR 0118](adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)).
> Inspect the whole thing with `install.sh --print-plan`, which touches nothing.

Verification: `.github/workflows/install-e2e.yml` runs the one-liner above on
a **clean** machine, under a real pty, on every final tag — the installer, the
stack, the first account, the machine key and the agent picking up the first
project. On every PR the `scripts/dev/install*.spec.ts` specs prove the pieces
that do not need a Release: the plan and the state (`install.spec.ts`), the
`.env` through Compose's own parser (`install-env.spec.ts`), the closing steps
(`install-fechamento.spec.ts`), the refused invocations
(`install-invocacao.spec.ts`), the downloaded files
(`install-arquivos-da-instalacao.spec.ts`), the broker question
(`install-broker.spec.ts`), and that the E2E itself has not rotted
(`install-e2e.spec.ts`). The **migration** path — backup, prove, delete,
install, restore — has no end-to-end run: the E2E machine is clean, so the
question is never asked, and only the restore proof's `.env` hand-off has a spec
(`scripts/dev/prova-de-restauracao-env.spec.ts`).

### The container broker in an installation {#broker-na-instalacao}

Projects in **Container** and **Mounted** mode run inside a container, and the
one that brings that container up is the **broker**
([ADR 0144](adr/0144-a-segunda-raiz-do-broker.md)). Without it neither mode
ever executes: `container_start` ends `failed` with `BrokerIndisponivelError`
and the dev agents stay in `dev.blocked_by_container`. **Runner** mode does not
depend on it — there the local agent uses the Docker on your machine.

Since [ADR 0162](adr/0162-broker-publicado-e-oferecido-pelo-instalador.md) the
broker is the **fifth published image** (`ghcr.io/daneiel/brabo-broker`, by
digest, signed like the other four) and the installation compose has the
service — **off by default**, under the same `container-broker` profile as the
validation compose. The installer **asks** (*"Ligar o broker de container?
[s/N]"*), right after the projects base, and says in text what turning it on
grants: the broker receives **this machine's Docker socket**, and whoever
commands the broker commands your Docker. What contains it is the five layers
of [ADR 0130](adr/0130-broker-de-container.md): no published port, a network
(`internal: true`, no internet) that only the api reaches, the service token,
five operations on ONE project's container, and a spec the broker composes
from what the Architect decided — there is no request that turns on
`privileged`, host networking or a free `-v`.

| answer | what happens |
|---|---|
| **`s`** / **`sim`** | it measures the socket's group **from inside a container** (the broker image itself, no network, read-only, the socket bound with `--mount` so a missing socket is an error instead of an empty folder created on your host), computes where Docker keeps the managed-folder volume, and writes `COMPOSE_PROFILES=container-broker`, `BROKER_URL=http://broker:8090`, `DOCKER_GID` and `PROJECT_WORKSPACES_HOST_ROOT` into `.env` — the four together |
| Enter, `n`, anything else | off. `.env` gets none of the four lines, and the final summary says *"Broker de container: DESLIGADO"* |
| no terminal | off, and it says so — no question is asked where no one can answer |

**Two refusals and two pending items, all named:**

- *"não consegui medir o grupo do socket do Docker…"* — the measurement failed
  (rootless or remote Docker: the socket is not at `/var/run/docker.sock`,
  which is the path the compose mounts). Nothing was written. Run again and
  answer **no**, or fix what the message quotes from Docker. It never writes a
  guessed `999` in its place.
- *"… não é um socket …"* — same outcome, same fix.
- pending *"a raiz da pasta gerenciada…"* — the computed
  `<DockerRootDir>/volumes/brabo_project_workspaces/_data` did not match the
  volume's real `Mountpoint` after the stack came up (or `docker info` did not
  say where volumes live). **Mounted** projects work; **Container** projects do
  not until you fix `PROJECT_WORKSPACES_HOST_ROOT` — the message carries the
  value the daemon reported and the command to recreate the broker.
- pending *"o broker de container: a api NÃO o alcançou…"* — the service came
  up healthy but the api could not reach it on the internal network. `docker
  compose -f docker/docker-compose.install.yml logs broker` says why.

`COMPOSE_PROFILES` in the `--env-file` is what makes `up -d --wait` bring the
broker up with no flag on the command line — measured on Compose v5.5.1. The
image variable, `BRABO_BROKER_IMAGE`, is written **whether you turn it on or
not**: Compose interpolates the whole file before filtering by profile, so a
required variable on a disabled service still refuses the file.

**Turning it on later** (same folder as `.env`):

```bash
# 1. the group of the socket AS A CONTAINER SEES IT — with the broker image
#    itself, no network; this is the number the compose needs
docker run --rm --network none --read-only --entrypoint stat \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
  "$(grep '^BRABO_BROKER_IMAGE=' .env | cut -d= -f2)" -c '%F %g' /var/run/docker.sock
# expected: socket <gid>

# 2. where Docker keeps the managed-folder volume
docker volume inspect --format '{{.Mountpoint}}' brabo_project_workspaces

# 3. append to .env (all four — never one without the others)
#    COMPOSE_PROFILES=container-broker
#    BROKER_URL=http://broker:8090
#    DOCKER_GID=<gid from step 1>
#    PROJECT_WORKSPACES_HOST_ROOT=<path from step 2>

# 4. recreate — the api too, so it picks up BROKER_URL
docker compose -f docker/docker-compose.install.yml --env-file .env up -d --wait

# 5. ask before claiming
docker compose -f docker/docker-compose.install.yml --env-file .env exec -T api \
  node -e "fetch('http://broker:8090/health').then(r=>r.text()).then(console.log)"
# expected: {"status":"ok","servico":"broker"}
```

**Turning it off:** remove the four lines from `.env`, then remove the broker
container and recreate the api without `BROKER_URL`:

```bash
docker compose -f docker/docker-compose.install.yml --env-file .env \
  --profile container-broker rm -sf broker
docker compose -f docker/docker-compose.install.yml --env-file .env up -d --wait
```

`up --remove-orphans` does **not** do the first step — measured: a service
under a disabled profile is still *defined* in the file, so its container is
not an orphan and keeps running. Nothing in your projects is deleted; Container
and Mounted projects stop executing, and the project screen stops offering
them ([ADR 0161](adr/0161-a-tela-so-oferece-o-modo-que-a-instalacao-executa.md)).

Verification: turning it on **at install time** is proven — the question and
its refusals by `scripts/dev/install-broker.spec.ts` on every PR, and the whole
path by `.github/workflows/install-e2e.yml` on every final tag, which answers
*sim* and requires the broker on, the api reaching it, and `COMPOSE_PROFILES` and
`BROKER_URL` written to `.env`. Turning it on **later** by the five commands above, and turning it
**off**, have **no verification**: nothing runs them, and the
`up --remove-orphans` caveat was measured once by hand.

### Local models in an installation {#modelos-locais-na-instalacao}

Right after the broker, `install.sh` asks `Ligar os modelos locais? [s/N]`
([RN-691](business-rules/produto.md#rn-691)). It states the cost first — disk for the
Ollama image and the models `ollama-model-loader` pulls on startup, RAM while a
model is loaded — and what is lost without them: the semantic duplicate check
of stories and rules is skipped, and agents have no local model. Only a typed
"s" turns them on; without a terminal they stay off.

Turning them on measures the host port before writing anything: `11434`, or the
first free one up to `11443` (a native Ollama usually holds `11434`). The whole
range busy is a named refusal with nothing written. `.env` gets `OLLAMA_PORT`
and `llm` in the single `COMPOSE_PROFILES` line.

To turn them on **later**, in the installation folder: pick a free port, then
add `OLLAMA_PORT=<port>` to `.env`, append `llm` to the existing
`COMPOSE_PROFILES` line with a comma (or create `COMPOSE_PROFILES=llm`), and run
`docker compose -f docker/docker-compose.install.yml --env-file .env up -d --wait`.

Verification: the question, the port measurement and the `.env` lines are
proven by `scripts/dev/install-llm.spec.ts` on every PR. The install E2E
answers *não* (pulling models would cost GBs per tag), so startup with the
`llm` profile has **no end-to-end verification**.

### Reinstalling from zero {#reinstalar-do-zero}

When a previous installation is found (only the compose project named exactly
`brabo` counts — the dev compose `brabo-dev` does not,
[RN-692](business-rules/produto.md#rn-692)), the migration runs backup, proves the
restore, and then asks
`Apagar os volumes e reinstalar? [s = restaurar / z = do zero / N = parar]`.
`z` deletes and reinstalls **without restoring** the old data; the proven
backup stays in the folder it names, and restoring it later is
[Restore](#restore). Proven by `scripts/dev/install-llm.spec.ts`.

---

## Verifying a published artifact {#verificar-artefato-publicado}

Every final tag signs what it publishes, with `cosign` **keyless** — the
signing identity is the workflow itself, and there is no key in custody
anywhere ([ADR 0149](adr/0149-assinatura-dos-artefatos-publicados.md),
[RN-524](business-rules/ci.md#rn-524)). This is how **you** check it, outside
CI.

Both commands need the two `--certificate-*` flags. They are not optional
decoration: without them `cosign` would accept a valid signature **from
anyone**, which is the failure this whole mechanism exists to prevent.

### An image, by digest

```bash
# The digest comes from .release/images.json, which is an asset of the Release
# — never from a tag, which is a movable pointer.
DIGEST=$(gh release download vX.Y.Z --pattern images.json --output - \
  | jq -r '.imagens[] | select(.alvo == "api") | .digest')

cosign verify \
  --certificate-identity-regexp '^https://github.com/daneiel/brabo/\.github/workflows/release\.yml@' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  "ghcr.io/daneiel/brabo-api@${DIGEST}"
```

### The runner binaries

One signed `checksums.txt` covers all four targets (Intel Mac has no binary
since [ADR 0174](adr/0174-runner-sem-binario-darwin-x64.md) — it uses
`npm install -g @brabo/runner`), so verification is two
steps: the manifest's signature, then the binary against the manifest.

```bash
gh release download vX.Y.Z --pattern 'checksums.txt*' --pattern 'brabo-runner-*'

cosign verify-blob \
  --bundle checksums.txt.bundle \
  --certificate-identity-regexp '^https://github.com/daneiel/brabo/\.github/workflows/build-runner-binaries\.yml@' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  checksums.txt

# Only after the manifest is proven authentic does checking the binary mean
# anything — a checksums.txt nobody verified is a file the attacker also
# gets to write.
sha256sum -c checksums.txt --ignore-missing
```

### When verification fails

**Do not install.** A signature that does not verify has exactly two
readings — the artifact is not what the pipeline published, or the pipeline
did not publish it — and neither is a reason to continue. Check whether the
identity regex matches the workflow that really published that tag (a
republish by `workflow_dispatch` signs with the same identity), and then
treat it as an incident rather than as noise.

**What this does NOT cover:** operating-system code-signing of the runner
binaries — macOS notarization and Windows Authenticode. Those need a paid
signing identity and are a separate backlog item; the OS will still warn on
first run.

### The written offer of source, inside every published artifact {#oferta-de-fonte-na-imagem}

Signing answers *"is this what the pipeline published?"*. A second question
travels with the same image and has a different answer: **where is the source
of the GPL software inside it?**

The engine image embeds `git`, `busybox`, `libgcc`/`libstdc++` and 18 other apk
packages under GPL, plus the four scanners the engine invokes by `exec`.
Running them as separate processes does not contaminate Brabo, which stays
MIT — but *distributing* the image requires that whoever receives it can obtain
the corresponding source. Since [ADR 0119](adr/0119-imagens-publicadas-no-ghcr-por-digest.md)
that distribution happens on every final tag.

The written offer is `THIRD_PARTY_NOTICES.md`, and it ships **inside** the
image, because whoever runs `docker pull` does not have the repository:

```bash
docker run --rm --entrypoint sh ghcr.io/daneiel/brabo-engine:vX.Y.Z \
  -c 'cat /usr/share/doc/brabo/THIRD_PARTY_NOTICES.md'
```

It names every component, its exact version and its licence, which is what
lets anyone reach the upstream release of each one.

Since AT-120 the same file, in the same path and the same form (root-owned,
`0644`, copied before the `USER`), ships inside **every** published image —
`brabo-api`, `brabo-web`, `brabo-broker` and `brabo-backup` as well as
`brabo-engine` — and next to the runner binaries as the
`THIRD_PARTY_NOTICES.md` asset of the Release, covered by the same signed
`checksums.txt` (RN-524). That was the maintainer's decision, and it is the
conservative one: no artifact is declared exempt. Swap `brabo-engine` for any
of the other four in the command above. Before AT-120 that command failed with
"Permission denied" on the engine image: BuildKit applies `COPY --chmod=0644`
to the directory the `COPY` creates too, so `/usr/share/doc/brabo` had no
execute bit and the image's non-root user could not traverse it. Each
Dockerfile now creates the directory `0755` first. For the runner:

```bash
gh release download vX.Y.Z --repo daneiel/brabo \
  --pattern THIRD_PARTY_NOTICES.md --pattern checksums.txt
sha256sum -c --ignore-missing checksums.txt
```

If that file is missing from an artifact, the artifact should not be
distributed. `scripts/ci/oferta-de-fonte-na-imagem.spec.ts` keeps each `COPY`
and the Release asset from being removed by accident, and the
`A oferta de fonte está dentro das cinco imagens` step of `ci.yml` reads the
file back out of each image it builds and compares it with the checkout — but
only a real tag proves the published artifact.

The file also records what is **not** settled: separating the scanners into
their own sidecar, leaving the engine image free of copyleft, stays open as an
*architecture* choice rather than a compliance one.

---

## Bumping a third-party image {#subindo-imagem-de-terceiro}

Every third-party image in `docker/` and `deploy/k8s/` is pinned **by
digest**, with the tag it came from written **inside the reference**, before
the digest ([ADR 0159](adr/0159-imagem-de-terceiro-por-digest.md),
[ADR 0178](adr/0178-tag-inline-na-imagem-de-terceiro.md)). The workflows in
`.github/workflows/` hold **no** image literal: their `services:` read the
reference from the dev compose through `imagens-do-compose.yml`
([ADR 0197](adr/0197-a-imagem-dos-workflows-vem-do-compose.md)), so bumping
the compose bumps the CI too:

```yaml
image: neo4j:5.26-community@sha256:d9cfe82983d27f5a75b3aaae8f316d04f9a698a3b7f6103a508f7caf8362f255
```

A **Dockerfile** takes the same shape on the `FROM` line — never a comment at
the end of it: Docker's parser only takes `#` at the start of a line, and a
trailing one makes the build fail with *"FROM requires either one or three
arguments"*:

```dockerfile
FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6 AS runtime
```

That is a **freeze**. Since ADR 0197 Dependabot's `docker-compose` (the
composes in `docker/`) and `docker` (the `FROM` lines in `docker/*/` and the
manifests in `deploy/k8s/`) ecosystems propose the bump weekly, one grouped PR
per ecosystem, into `dev`. Reviewing that PR is this procedure's steps 1 and 4.
Two cases still come back here:

- **`neo4j` and `ollama` live in a compose AND in `deploy/k8s/base/`**, and the
  two ecosystems never share a PR. When the registry re-publishes the SAME tag
  with another digest, both PRs fail the lint ("same inline tag, two
  digests"); bring the two bumps into one PR with step 3 below.
- The two images no ecosystem reads (below).

To move one by hand — say, `neo4j` from `5.26-community` to `5.27-community`:

```sh
# 1. Confirm the tag resolves to an INDEX (a manifest list). If it does not,
#    the pin loses multi-arch and linux/arm64 stops working.
docker manifest inspect neo4j:5.27-community | head -3
#    → "mediaType": "application/vnd.oci.image.index.v1+json"
#      (or …distribution.manifest.list.v2+json)

# 2. Read the index digest.
docker buildx imagetools inspect neo4j:5.27-community --format '{{.Manifest.Digest}}'

# 3. Write `neo4j:5.27-community@<digest>` EVERYWHERE the old reference appears.
#    Not in .github/workflows/: the workflows read pgvector and ollama from the
#    dev compose (ADR 0197), and the lint fails a literal there.
grep -rn 'neo4j:5.26-community@sha256' docker/ deploy/k8s/

# 4. The lint proves it.
node scripts/ci/imagens-pinadas.ts
```

Two images are bumped by this same procedure, by hand, whatever Dependabot
does: the CloudNativePG
`imageName` in `deploy/k8s/overlays/local/db/cluster.yaml` (no ecosystem
reads that key) and the golden-set QA case image,
`IMAGEM_DO_GOLDEN_SET_QA` in `apps/api/scripts/golden-set-qa-container.ts`
(a TypeScript constant, read by `golden-set-qa.yml`).

Step 3 is not optional bookkeeping: the check refuses **the same inline tag
carrying two different digests**, because the dev compose and the cluster
claiming the same version while running different bytes is how a green CI stops
meaning anything. Between the dev compose and the CI there is nothing to align
any more: the CI reads the compose.

To give a NEW workflow a third-party service, never write the reference in the
workflow: add the service image to `docker/docker-compose.yml`, a line to
`IMAGENS_DOS_WORKFLOWS` in `scripts/ci/imagens-do-compose.ts`, the matching
output to `.github/workflows/imagens-do-compose.yml` (its spec fails if the two
diverge), and in the workflow a job `imagens:` with
`uses: ./.github/workflows/imagens-do-compose.yml` plus
`image: ${{ needs.imagens.outputs.<name> }}`.

What the check does **not** cover, and why, is in
[the CI supply chain](explanation/cadeia-de-suprimentos-do-ci.md#container-images-digest-with-the-tag-alongside):
the five images the product publishes are already resolved by digest through
`.release/images.json` and `make imagens-do-release`
([ADR 0119](adr/0119-imagens-publicadas-no-ghcr-por-digest.md)) — never pin
those by hand in the overlay, which deliberately holds the marker.

---

## Adding a compatible provider {#adicionando-um-provider-compativel}

Applies to any provider that speaks OpenAI's `/chat/completions` dialect —
which is the case for practically every hub and every managed inference
service. The base already exists
([ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md));
what you write is **configuration**, not parsing.

### 1. Read the official doc before writing the first line

Four things need to come from the provider's documentation, not guessing:
`baseUrl`, the auth header, the `usage` format in the stream, and the
streaming quirks. Record the consulted URL and the date at the top of the
config file — it's the only way to know, months later, whether the config
is stale.

Whatever diverges from the OpenAI standard becomes a **flag in the base**,
never an `if` scattered around. If the divergence doesn't fit an existing
flag, add one — and only because this real provider needs it.

### 2. Write the config

```ts
// apps/api/src/infrastructure/llm/<provider>-provider.ts
export function meuProviderConfig(baseUrl = BASE_URL): OpenAICompatibleConfig {
  return {
    name: 'meu-provider',
    baseUrl,
    capabilities: { streaming: true, toolCalling: true, listModels: true },
    authHeaders: (apiKey) => ({ Authorization: `Bearer ${apiKey ?? ''}` }),
    flags: { streamOptionsIncludeUsage: true, maxTokensField: 'max_tokens' },
    // Only if its catalog returns more than `{ data: [{ id }] }`:
    // parseCatalogo: (corpo) => ...,
    // Only if it's a HUB (reports who actually served the request):
    // extrairUpstreamProvider: (frame) => ...,
  };
}
```

Export the config function, not just the class: that's what the contract
suite points at the fake server. A copy of the config written inside the
test would pass green even if production's diverged.

### 3. Run the contract suite against it

```ts
runLLMProviderContract('meu-provider', () => ({
  dialeto: dialetoOpenAI, // reuse the base's if the format is the same
  criar: (baseUrl) =>
    new OpenAICompatibleProvider(meuProviderConfig(baseUrl), new GptTokenizerEstimator()),
  usageFallback: 'estimated',
  timeoutEnv: 'LLM_REQUEST_TIMEOUT_MS',
  temFerramentasNoPedido: (body) => Array.isArray(body.tools),
  modelo: 'algum-modelo',
}));
```

Inherited for free: streaming with a split frame, usage present and
absent, tool calling, the four normalized errors, the catalog, and a mute
server.

### 4. Register the provider and the credential kind

1. **two places, on purpose**: the `LLMProviderName` type in
   `packages/shared/src/index.ts` (the web uses it too) and the runtime
   list `LLM_PROVIDER_NAMES` in
   `apps/api/src/domain/llm/llm-provider-names.ts`. They can't live
   together: `packages/shared` is 100% types — a value exported from
   there breaks the api's production image at boot with
   `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, and
   `apps/api/test/packages-shared-so-tipos.spec.ts` fails before it gets
   there. Forgetting the list doesn't pass silently: the exhaustiveness
   check in both directions breaks the typecheck, just like the web's
   exhaustive `ROTULO_DO_PROVIDER` `Record` breaks until the provider
   gets a label;
2. if it's a hub, add the name to `HUBS` in `apps/web/src/lib/models.ts`
   so it falls into the right group in the selector;
3. the api's provider registry (`llm-infrastructure.module.ts`);
4. the provider's `pgEnum` in the schema plus a migration, if the name is
   new.

### 5. Seed the models with the price from the docs

A typed-in price comes with `manual_pricing: true`. That protects the row
from the price sync: for a provider that doesn't expose price in its
catalog, the manual number is the only one that exists.

If the provider exposes `GET /models`, **don't seed the whole catalog** —
let the sync discover it. It writes the models in a disabled state, and
the owner enables what matters through the curation screen
([RN-043](business-rules/api.md#rn-043)).

If the provider's catalog publishes **modality** (accepts image, generates
image) or `reasoning`, emit them in its `parseCatalogo` — and only when
the official doc says so. A field the provider doesn't declare stays
**omitted**, never `false`: `undefined` preserves what was already
recorded, and `false` would wipe out hand-curated data
([RN-056](business-rules/api.md#rn-056)).

### 6. Verify with a real credential

```bash
# on the project's settings screen: register the credential, then
# "Update catalog" and check the per-provider report.
```

The report shows **every** provider, including the skipped ones, with the
reason and the origin of the failure. `sem_credencial` means the key
never arrived; `falha · origem infra` means it couldn't even reach the
provider; `falha · origem modelo` means it answered with a refusal.

Verification: steps 2–4 are proven on every PR — the contract suite
(`apps/api/test/contract/llm-provider.contract.ts`, run by each provider's
`*.contract.spec.ts`) against a fake server, and the typecheck that breaks when
a name is missing from either list. Step 6 is **manual by nature**: it needs a
real credential with credit, which CI does not have. The per-provider
`*.smoke.spec.ts` files are the scripted form of it, and they skip without a
key — the environment holds a credential only for OpenRouter (see the
`TODO(humano)` on the LLM smokes in `CLAUDE.md`).

---

## Procedures and how each is verified {#procedimentos-e-verificacao}

Every **operation** procedure of this page, with the file that proves it and
what runs that proof. Diagnosis sections (what to do when something looks
wrong) and the development-environment sections are not here: they are ways to
find a cause, not procedures that can pass or fail.

- **verification** names the spec, script, workflow or `make` target that
  proves the procedure, or starts with **None** and says so. A partial proof
  names what it covers and what it does not.
- **schedule** says what runs it without anyone remembering: a scheduled
  workflow (`weekly`), every pull request (`every PR`), every final tag
  (`every tag`), or `manual` — someone has to remember.

`pnpm docs:check` reads this table and fails when a file in **verification**
is not in the repository, a `make` target is not in the `Makefile`, a cell is
empty or says "see below", an anchor is not a heading of this page, or a
workflow in **schedule** does not have the trigger the cell claims
(`schedule:` for `weekly`, `pull_request` for `every PR`, `push: tags` for
`every tag`). How it works is in
[How documentation stays alive](explanation/documentation-workflow.md#the-runbook-procedures-table).

| procedure | anchor | verification | schedule |
|---|---|---|---|
| Bring the stack up in a local cluster | [Local deploy](#deploy-local) | `make deploy-local` ends with `make smoke-k8s` (`deploy/k8s/smoke.sh`); the scheduled run does the same `deploy/k8s/bootstrap.sh` and smoke | weekly `.github/workflows/propriedades.yml` |
| Validate a pipeline tag (`TAG=`) | [Validating a pipeline tag](#validar-tag-do-pipeline) | **None.** No workflow passes `TAG=`; the detached checkout of the tag runs only by hand | manual |
| Prove the engine's HPA scales | [Local deploy](#deploy-local) | `make hpa-test` (`deploy/k8s/hpa-test.sh`) | weekly `.github/workflows/propriedades.yml` |
| Validate the overlays without a cluster | [Local deploy](#deploy-local) | `make k8s-validate` (`deploy/k8s/validate.sh`) | every PR `.github/workflows/ci.yml` |
| Deploy a release's images | [Deploying a release's images](#imagens-de-uma-release) | `scripts/ci/aplicar-imagens.spec.ts` proves reading the release manifest, `scripts/ci/images-manifest.spec.ts` the digests handed to `kustomize`; running it on the overlay and applying a real release's digests: none | every PR `.github/workflows/ci.yml` (the spec); manual (the chain) |
| Roll out the engine | [Engine rollout](#rollout-do-engine) | `make rollout-test` (`deploy/k8s/rollout-test.sh`); its evidence collectors by `scripts/ci/rollout-evidencia.spec.ts` | weekly `.github/workflows/propriedades.yml`; every PR `.github/workflows/ci.yml` (the collectors) |
| Increase the drain window | [Increasing the drain window](#aumentar-a-janela-de-drain) | **None of its own.** `make rollout-test` proves only the local overlay's pair (20 s drain, 90 s grace); rerun it with the raised values | manual |
| Fall back to sealed-secrets | [Secrets: fallback to sealed-secrets](#fallback-sealed-secrets) | **None.** Nothing runs `kubeseal`; the scheduled cluster uses External Secrets | manual |
| Verify a backup on Kubernetes | [The automated path](#restore-automatizado) | `make test-restore` (`deploy/k8s/test-restore.sh`) and the deliberate break `make test-restore-mutacao` | weekly `.github/workflows/propriedades.yml` |
| Verify a backup on a compose installation | [The automated path](#restore-automatizado) | `make test-restore-compose` (`docker/backup/test-restore-compose.sh`); its `.env` hand-off by `scripts/dev/prova-de-restauracao-env.spec.ts` | weekly `.github/workflows/propriedades.yml`, job `restore-compose` (the proof); every PR `.github/workflows/ci.yml` (the spec) |
| Restore for real during an incident | [Restoring for real](#restore-de-verdade) | steps 1–2: `make test-restore` (the same `brabo-restore`, the same queries as `docker/backup/restore.sh`); step 3, promoting `DATABASE_URL`: none, never exercised | weekly `.github/workflows/propriedades.yml` (steps 1–2); manual (step 3) |
| Verify and recover the bare repos | [Recovering the bare repos](#restore-dos-bare-repos) | `scripts/ci/backup-lib.spec.ts` (the functions); `make test-restore-compose` (the verifying command, in the image); `--restaurar` in the image: none | every PR `.github/workflows/ci.yml` (the spec); weekly `.github/workflows/propriedades.yml`, job `restore-compose` (the verifying command); manual (`--restaurar`) |
| Reproject the graph | [Losing the graph](#perda-do-grafo) | `make test-reprojecao` (`apps/api/test/scripts/reprojetar-grafo.spec.ts`, skipped on PRs, which have no Neo4j) and `make test-reprojecao-k8s` (`deploy/k8s/test-reprojecao.sh`) | weekly `.github/workflows/propriedades.yml` |
| Reproject the artifact folder | [Losing the artifact folder](#perda-da-pasta-de-artefatos) | `apps/api/test/scripts/reprojetar-artefatos.spec.ts` and `make test-reprojecao-artefatos-k8s` (`deploy/k8s/test-reprojecao-artefatos.sh`, the command inside the api image) | every PR `.github/workflows/ci.yml` (the spec); weekly `.github/workflows/propriedades.yml` (the image path) |
| Rotate `AUTH_JWT_SECRET` | [`AUTH_JWT_SECRET`](#rotacao-do-auth-jwt-secret) | `apps/api/test/infrastructure/security/ed25519-access-token-issuer.spec.ts` and `apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts` | every PR `.github/workflows/ci.yml` |
| Change `AUTH_TOKEN_PEPPER` | [`AUTH_TOKEN_PEPPER`](#troca-do-auth-token-pepper) | `apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts` | every PR `.github/workflows/ci.yml` |
| Rotate `BRABO_SERVICE_TOKEN` | [`BRABO_SERVICE_TOKEN`](#rotacao-do-brabo-service-token) | `apps/api/test/infrastructure/security/service-token.spec.ts`, `apps/api/test/interfaces/engine-service.guard.spec.ts`, `apps/engine/test/engine_web/plugs/verify_service_token_test.exs`, `apps/engine/test/engine/runtime_service_token_test.exs`, `apps/broker/src/config.spec.ts` and `scripts/ci/previous-nos-composes.spec.ts` | every PR `.github/workflows/ci.yml` |
| Put and retire a `_PREVIOUS` in Kubernetes | [Doing it in Kubernetes](#rotacao-no-kubernetes) | `scripts/ci/previous-nos-composes.spec.ts` keeps the `ExternalSecret` on `dataFrom.extract` with no `_PREVIOUS` in `data:`; the sync through a real External Secrets Operator: `make test-rotacao-chave-mestra-k8s` (`deploy/k8s/test-rotacao-chave-mestra.sh`) adds and removes `CREDENTIALS_MASTER_KEY_PREVIOUS` through it; the other `_PREVIOUS` keys: none automated | every PR `.github/workflows/ci.yml` (the spec); weekly `.github/workflows/propriedades.yml` (the master key's `_PREVIOUS`); manual (the other keys) |
| Unlock an account by SQL | [Account locked by lockout](#conta-travada-por-lockout) | **None.** The two queries were checked against the schema by reading; `apps/api/test/application/use-cases/auth/lockout.spec.ts` covers the lockout, not them | manual |
| Rotate the master key | [Master key rotation](#rotacao-da-chave-mestra) | `apps/api/test/scripts/rewrap-deks.spec.ts` and `apps/api/test/infrastructure/security/envelope-encryption.service.spec.ts`; the three steps in the cluster: `make test-rotacao-chave-mestra-k8s` (`deploy/k8s/test-rotacao-chave-mestra.sh`) | every PR `.github/workflows/ci.yml` (the specs); weekly `.github/workflows/propriedades.yml` (the rehearsal) |
| Cut the spend in a cost incident | [Cost incident](#incidente-de-custo) | `apps/api/test/runbook/sql-do-incidente-de-custo.spec.ts` runs the section's SQL, in both languages, against the migrated schema; steps (b) and (d), on the screen: none | every PR `.github/workflows/ci.yml` |
| Bring up observability without a cluster | [Local observability](#observabilidade-local) | `scripts/dev/observabilidade-pronta.mjs`, a self-check at the end of `pnpm dev:obs`, with no spec | manual |
| Check the gate registry in the image | [Gate registry](#registro-de-gates) | `docker/smoke.sh` calls both routes against the production image; its gate functions by `scripts/ci/smoke-gates.spec.ts` | every PR `.github/workflows/ci.yml` |
| Install | [Installing](#instalando) | `.github/workflows/install-e2e.yml` (clean machine) and `scripts/dev/install*.spec.ts`; the migration path end to end: none | every tag `.github/workflows/install-e2e.yml`; every PR `.github/workflows/ci.yml` (the specs) |
| Turn the installation's broker on or off | [The container broker in an installation](#broker-na-instalacao) | at install: `scripts/dev/install-broker.spec.ts` and `.github/workflows/install-e2e.yml`; turning it on later by hand, and off: none | every tag `.github/workflows/install-e2e.yml`; every PR `.github/workflows/ci.yml` (the spec); manual (later, and off) |
| Turn the installation's local models on | [Local models in an installation](#modelos-locais-na-instalacao) | at install: `scripts/dev/install-llm.spec.ts`; turning them on later by hand: none | every PR `.github/workflows/ci.yml` (the spec); manual (later) |
| Reinstall from zero over a previous installation | [Reinstalling from zero](#reinstalar-do-zero) | `scripts/dev/install-llm.spec.ts` | every PR `.github/workflows/ci.yml` |
| Verify a published artifact | [Verifying a published artifact](#verificar-artefato-publicado) | the publishing workflows verify what they signed, in the same run: `.github/workflows/release.yml` (`cosign verify`) and `.github/workflows/build-runner-binaries.yml` (`cosign verify-blob`) | every tag `.github/workflows/release.yml` `.github/workflows/build-runner-binaries.yml` |
| Check the written offer of source | [The written offer of source](#oferta-de-fonte-na-imagem) | `scripts/ci/oferta-de-fonte-na-imagem.spec.ts` keeps each `COPY` and the Release asset; the five images built from the PR, read back by `.github/workflows/ci.yml`; the published artifacts carrying the file: none | every PR `.github/workflows/ci.yml` (the spec and the built images); manual (the published artifacts) |
| Bump a third-party image | [Bumping a third-party image](#subindo-imagem-de-terceiro) | `scripts/ci/imagens-pinadas.ts`, `scripts/ci/imagens-pinadas.spec.ts` and `scripts/ci/imagens-do-compose.spec.ts` | every PR `.github/workflows/ci.yml` |
| Add a compatible LLM provider | [Adding a compatible provider](#adicionando-um-provider-compativel) | steps 2–4: `apps/api/test/contract/llm-provider.contract.ts`, run by each provider's contract spec; step 6, with a real credential: none in CI — the smoke specs skip without a key | every PR `.github/workflows/ci.yml` (steps 2–4); manual (step 6) |
