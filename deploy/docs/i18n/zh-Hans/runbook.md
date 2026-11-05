---
id: runbook
title: 运维手册
sidebar_label: 运维手册
sidebar_position: 4
description: Brabo 的运维流程——部署、滚动发布、恢复、密钥轮换、成本事件与可观测性。
keywords: [runbook, operations, incident, restore, rollout, kubernetes]
traducao_de: d6ad631fba3edac691608e1f31d9000e12640253
---

# 运维手册

只有一份文档，因为凌晨 3 点没有人会打开一个目录去挑文件。从分诊开始。每个流程由什么证明、由谁运行这项证明，见末尾的表格：
[流程及其验证方式](#procedimentos-e-verificacao)。

## 分诊——从症状到流程 {#triage--from-symptom-to-procedure}

| 你看到的情况 | 前往 |
|---|---|
| 我想从零启动全部服务 | [本地部署](#deploy-local) |
| pod 卡住，`ExternalSecret` 始终不 Ready，HPA 显示 `<unknown>` | [部署诊断](#diagnostico-do-deploy) |
| 我要对 engine 做滚动发布 | [engine 的滚动发布](#rollout-do-engine) |
| 会话处于 `active` 却没有进程，或卡在 `closing` | [会话失控时](#quando-a-sessao-escapa) |
| 我丢了数据 / 想验证备份 | [恢复](#restore) |
| 我想在**没有集群**的安装上验证或恢复备份 | [恢复](#restore)——`make test-restore-compose` |
| `local` provider 的某个项目丢了仓库，或者我正把一套安装搬到另一台机器 | [恢复 bare 仓库](#restore-dos-bare-repos) |
| 恢复或迁移之后图谱是空的 | [图谱丢失](#perda-do-grafo)——`grafo:reprojetar` |
| 某个项目的 `docs/` 目录（agent 的产物）在恢复、卷丢失或模式转换之后消失了 | [产物目录丢失](#perda-da-pasta-de-artefatos)——`artefatos:reprojetar` |
| LLM 或 git 的凭据无法再解密 | [主密钥轮换](#rotacao-da-chave-mestra) |
| 所有人同时被登出，或登录时账号被锁定 | [auth 密钥轮换](#rotacao-das-chaves-do-auth) |
| 每小时成本飙升 | [成本事件](#incidente-de-custo) |
| 面板为空，没有 trace，没有日志 | [可观测性](#observabilidade) |
| 不知道线上运行的是哪个版本 | [线上是哪个版本](#que-versao-esta-no-ar) |
| 浏览器控制台出现 `blocked by CORS policy` | [CORS 错误](#erro-de-cors) |
| 激活会话没有任何反应，或 `transition` 返回 `500` 并带有 `ECONNREFUSED` | [会话无法离开 `created`](#sessao-nao-ativa) |
| api 启动时因 `GIT_OAUTH_STATE_SECRET` 报错退出 | [api 因 OAuth 密钥拒绝启动](#segredo-de-oauth-no-boot) |
| “使用 GitHub/GitLab 登录”从 provider 返回 `redirect_uri` 错误 | [provider 拒绝社交登录的回调](#callback-login-social-nao-registrado) |
| api 或 engine 启动时因 `AUTH_JWT_SECRET`、`BRABO_SERVICE_TOKEN`、`CREDENTIALS_MASTER_KEY`、`SECRET_KEY_BASE` 或 `NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD` 报错退出 | [四个同类密钥用默认值同样无法启动](#segredos-irmaos-no-boot) |
| 我想启用真实的 SMTP，或 api 启动时因 `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` 报错退出 | [`MailSender` 中的真实 SMTP](#smtp-real) |
| agent 回复为空、被截断或非常慢 | [推理环境](#ambiente-de-inferencia) |
| agent 因 `iteration limit reached` 停止且没有交付 | [推理环境](#ambiente-de-inferencia) |
| 我想添加一个兼容 OpenAI 的 LLM provider | [添加兼容的 provider](#adicionando-um-provider-compativel) |
| 我想把 workspace 从 Docker 卷迁移到真正的目录 | [把 workspace 迁移到本地目录](#migrar-workspaces-pasta-local) |
| 项目向导不提供**挂载目录**模式，或创建挂载项目被拒绝，提示路径必须位于 base 之内 | [挂载目录模式的项目：项目 base](#projeto-no-modo-local) |
| 在挂载项目中批准 `container_start` 失败，提示 api 无法创建或访问该目录 | [挂载目录模式的项目：项目 base](#projeto-no-modo-local) |
| `pnpm dev` 拒绝启动，提示 `BRABO_PROJECTS_BASE` 与 Brabo 的 checkout 重叠 | [挂载目录模式的项目：项目 base](#projeto-no-modo-local) |
| `brabo-runner` 以 `base de projetos recusada` 退出，或在我期待有 base 时打印 `base de projetos: nenhuma configurada` | [runner 的项目 base](#base-do-runner) |
| `brabo-runner` 不停打印 `nada a atender AINDA`，或机器级 unit 已运行却没有任何项目被服务 | [机器级 agent](#agente-de-maquina) |
| `systemctl --user status` 显示 `Loaded: bad-setting` / `WorkingDirectory= path is not absolute`，agent 服务始终无法启动 | [unit 处于 `bad-setting`](#unit-do-agente-nao-inicia) |
| 我需要为这台机器创建设备密钥，但没有浏览器（新安装、无屏幕的机器） | [通过终端创建设备密钥](#chave-de-dispositivo-pelo-terminal) |
| 安装程序结束时给出一个 **"O que ficou pendente"** 区块，或新安装既没有账号、也没有机器密钥、也没有 agent 服务 | [安装程序没有完成安装时](#instalador-nao-fecha) |
| 项目目录始终没有出现在用户的机器上，engine 日志写着 `workspace_create: o projeto <id> não criou pasta` | [项目目录始终没有出现](#pasta-do-projeto-nunca-aparece) |
| `runner` 项目中的某个 dev agent 在准备 worktree 时被阻塞，点名 `credencial-nao-atravessa-o-container`，来源为 `politica` | [Runner 模式下的认证克隆](#credencial-nao-atravessa-o-container) |
| `apps/api/dist`/`node_modules`，或某个 agent 在项目目录中写入的文件属于 `root`，不用 `sudo` 就无法编辑 | [dev 容器以你的用户身份写入，而不是 root](#dev-containers-nao-root) |
| 我想启动容器 broker，或它在 Docker socket 上返回 `permission denied` | [容器 broker](#broker-de-container) |
| 置备仓库失败并报 `permission denied: /data/git-repos/<slug>.git`，或 `permissions.json` 无法写入 | [dev 容器以你的用户身份写入，而不是 root](#dev-containers-nao-root) |
| 我想删除 dev 数据库重新开始，或 `reset-total.sh` 中途停止了 | [dev 环境的完全重置](#reset-total) |
| web 无明显原因显示 **429 (rate limit)**，或 `runner` 模式的项目在 `brabo-runner` 运行时看起来“没有本地 agent” | [runner 用失效的 ticket 淹没 api](#runner-com-ticket-morto) |

在执行任何流程之前，有两点值得了解：

- **沉默不等于健康。** 告警规则位于 Grafana，而不是 Prometheus
  （[ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md)）：
  Grafana 宕机意味着没有告警，而不是没有问题。
- **杀掉 pod 不会关闭会话。** 不先 drain 就执行 `kubectl delete pod`
  会产生孤儿会话。正确路径始终是正常的状态转换。

### 容器 broker {#broker-de-container}

broker（[ADR 0130](adr/0130-broker-de-container.md)）是产品中唯一与 Docker 守护进程通信的进程，也是唯一挂载了
`/var/run/docker.sock` 的服务。**不要在任何其他地方挂载这个 socket。**

**在本地它随 `pnpm dev` 启动；在生产环境中则不会。** 这种不对称是一项决定（[ADR 0146](adr/0146-base-consentida-no-bootstrap.md)，第 3 点），而不是疏忽——不要把两个 compose 文件“统一”。运行 `pnpm dev` 的人**本来就拥有 Docker socket**（他正在对自己主机的守护进程运行 `docker compose`），因此 broker 拿到它并不会授予操作者原本没有的任何权限。在生产环境中，socket 是一道真正的权限边界，操作者也不是开发者，所以在那里它位于 `profiles: ["container-broker"]` 之下。

在这项决定之前，broker 在两个文件中都默认关闭，理由是“还没有任何东西调用它”。这已经不再成立：它有四个真实的调用方
（[ADR 0133](adr/0133-infra-elege-imagem-do-roteamento.md)/
[0136](adr/0136-pagina-global-de-containers.md)），而
[ADR 0144](adr/0144-a-segunda-raiz-do-broker.md) 让**挂载目录**模式*通过* broker 启动自己的容器——因此在 profile 关闭时，默认的本地模式会以 `BrokerIndisponivelError` 告终。当 broker 确实缺席时，你得到的仍然是这个失败：一个**具名**的 `failed`，绝不是崩溃，也绝不会静默退回到在容器之外运行。

你仍然需要设置的是 gid——设错**不会**破坏启动，而是破坏使用：

```bash
# o gid do grupo docker do seu host — o default do compose (999) é o mais
# comum e está errado em várias distribuições
getent group docker | cut -d: -f3

# no .env
#    DOCKER_GID=<o número acima>
#    PROJECT_WORKSPACES_HOST_DIR=/home/you/brabo-projects    # JÁ EXPANDIDO; deriva HOST_ROOT
#    GIT_LOCAL_REPOS_HOST_DIR=/home/you/brabo-projects-bare
#    BRABO_PROJECTS_BASE=/home/you/projetos-brabo            # deriva HOST_BASE

docker compose -f docker/docker-compose.yml --env-file .env up -d api engine broker
```

`BROKER_URL` **已不在**这份清单中：dev 的 compose 默认值是
`http://broker:8090`，即它所启动的服务
（[RN-599](business-rules/infra.md#rn-599)）。在有这个默认值之前，api 会在一个健康的 broker 旁边返回
`brokerConfigurado: false`，创建项目时只提供 `runner`。`.env` 中的值依然优先；生产和安装用的 compose 故意没有默认值。

项目容器以**项目目录的所有者**身份运行（[ADR 0180](adr/0180-container-com-o-dono-da-pasta.md)，[RN-627](business-rules/contracts.md#rn-627)）：api 读取该目录的 uid 和 gid，broker 以 `--user <uid>:<gid>` 和 `HOME=/tmp` 启动它。正是这一点让 dev agent 能在 `--cap-drop ALL` 下写入 `/work`。不生效时需要知道两件事：属于 root、不可读或不存在的目录会退回到以前的行为（容器内为 root，无法写入属于其他 uid 的目录——`npm install` 返回 `EACCES`）；已经存在的容器只有在重建后才会改变（先 `container_remove`，再 `container_start`）。

`pnpm dev` 每次运行时也会**报告**受管目录（RN-599）：未设置
`PROJECT_WORKSPACES_HOST_DIR` 时，`api`/`engine` 使用受管卷，broker 收不到 `PROJECT_WORKSPACES_HOST_ROOT`，`container_start` 最终被拒绝——而整个栈是健康的。它还会报告路径中的 `~`（Compose 在 bind mount 中展开它，但不会在 broker 的变量中展开），以及与 api 挂载的目录不同的显式 `PROJECT_WORKSPACES_HOST_ROOT`。与 gid 的提示一样，它从不阻塞，也从不写入 `.env`；把卷换成目录不会迁移卷中的内容——参见
[迁移 workspace](#migrar-workspaces-pasta-local)。

`pnpm dev` 每次运行时都会**报告** `DOCKER_GID` 的状态
（[RN-512](business-rules/infra.md#rn-512)），把它与你机器上真实的组进行比较，正是为了不让这种不一致在很久之后才被发现——那时有人提出 `container_start`，而每个操作都在 socket 上以 `permission denied` 失败。这个提示从不阻塞；在完全没有 `docker` 组的机器上（Docker Desktop、rootless），它会说明这个问题不适用，而不是指责你有缺陷。

在生产环境中，显式启动它：

```bash
docker compose -f docker/docker-compose.prod.yml \
  --profile container-broker up -d broker
```

在由 `install.sh` 完成的**安装**中，broker 是同一个服务，来自已发布的镜像，安装程序会询问是否启用它——参见
[安装中的 broker](#broker-na-instalacao)
（[ADR 0162](adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)）。

**broker 有**两个**根，任何一个都不能替代另一个**
（[RN-503](business-rules/api.md#rn-503)，
[ADR 0144](adr/0144-a-segunda-raiz-do-broker.md)）。
`PROJECT_WORKSPACES_HOST_ROOT` 是**容器**模式项目所在的位置；
`BRABO_PROJECTS_HOST_BASE` 是**挂载目录**模式项目所在的位置，compose 从
`BRABO_PROJECTS_BASE` 推导它，所以通常你只需设置 base。缺少任何一个，拒绝信息都会点名它，并且不会触碰任何容器。退回到另一个根会挂载错误项目的目录——受管根按 `workspace_dir_name` 命名，base 由你命名，同一个名字在两者中指向不同的目录。

确认它是否正常运行——要从 api 发起，api 是**唯一**能访问它的服务（`broker` 网络是 `internal: true`，该服务不发布任何端口，所以从你的主机执行 `curl` 不会成功，这正是设计意图）：

```bash
docker compose -f docker/docker-compose.yml --env-file .env exec -T api \
  node -e "fetch('http://broker:8090/health').then(r=>r.text()).then(console.log)"
# esperado: {"status":"ok","servico":"broker"}
```

`/health` 说的是**进程**，从不涉及守护进程。重启 broker 修不好宕机的 Docker，而一个因此失败的 healthcheck 只会造成一个什么也解决不了的重启循环。

**本地镜像在 BUILD 阶段安装依赖，这不是一种优化。** broker 唯一的网络是 `internal: true`，因此运行时没有可访问的 registry：一个在启动时运行 `corepack`/`pnpm install` 的镜像会因 `getaddrinfo EAI_AGAIN registry.npmjs.org` 而死掉并以 1 退出。修复方式是把 registry 从运行时路径上移走（`pnpm install` 作为构建步骤），而不是开放网络——网络是五层隔离中的第一层。自 AT-360 起，没有任何镜像使用 corepack（Node 25+ 已不再自带它）：每个 Dockerfile 都从 registry 的 tarball 安装 pnpm，并对照 Dockerfile 中记录的 sha512（`PNPM_SHA512`）校验，安装到 `/usr/local/bin`。它的版本与 `package.json` 中的 `packageManager` 一致，所以 pnpm 在运行时从不尝试下载任何东西——用 dev 镜像在 `--network none` 下测得：`pnpm --version` 打印 `11.3.0`，`/health` 正常响应。升级 pnpm 意味着同时修改 `packageManager`、`PNPM_VERSION` 和 `PNPM_SHA512`（`npm view pnpm@<v> dist.integrity`，十六进制）。

你会遇到的两个后果：

- **三个 `node_modules` 是挂载在镜像所安装内容之上的具名卷**，而 Docker 只在卷为**空**时才用镜像内容初始化卷。因此 `docker/broker/entrypoint.sh` 会把它们与保存在 `/workspace` 之外的一份副本进行协调，该副本带有构建镜像时所用 `pnpm-lock.yaml` 的 sha256 标记。`--build` 之后的第一次启动会记录 `sincronizando…` 并花几秒钟；之后的启动什么也不记录。
- **修改 broker 的依赖需要 `up -d --build broker`。** entrypoint 会把自己的标记与工作树中的 lockfile 比较，不一致时**发出警告**。它选择警告而不是拒绝启动：broker 除了指向 `@brabo/docker-port` 的 workspace 链接外没有运行时依赖，把一个警告换成一次不可用只会更糟。

该服务还有 **healthcheck**（在容器内部对 `127.0.0.1:8090/health` 执行 `wget`——它不发布端口，`node:26-alpine` 也没有 `curl`）。没有它时，`up --wait` 会在容器启动的那一刻就报告 `Healthy`，于是 `scripts/dev/reset-total.sh` 会在 broker 五秒前已经死掉的情况下宣布 "reset completo"。

**症状及其含义：**

| 你看到的 | 它是什么 |
|---|---|
| `/var/run/docker.sock` 上的 `permission denied` | `DOCKER_GID` 错误。socket 是 `root:docker`，而 broker 以非 root 运行；重做上面的第 1 步并重建容器（`up -d --force-recreate broker`） |
| `não encontrei o executável docker no PATH` | 镜像构建时没有 `docker-cli`。重新构建（`--build`）。这个错误故意与“守护进程宕机”**分开**：安装和启动是不同的修复 |
| `getaddrinfo EAI_AGAIN registry.npmjs.org`，容器以 1 退出 | 这是依赖移入构建之前构建的 broker 镜像。重新构建（`up -d --build broker`）。**不要**给该服务开放出站网络：`internal: true` 网络就是隔离，要离开运行时路径的是 registry |
| `AVISO — pnpm-lock.yaml mudou desde o build desta imagem` | 镜像比工作树的 lockfile 旧。它仍能运行（broker 除 workspace 链接外没有运行时依赖）；当你确实修改了 broker 的依赖时再重新构建 |
| `start` 时出现 `PROJECT_WORKSPACES_HOST_ROOT não está definida` | 预期之中，拒绝是正确行为。`-v` 由**守护进程**对照**主机**文件系统解析；靠猜会挂载一个**空**目录，dev agent 会在没有代码的目录里工作。其他四个操作没有它也能继续工作 |
| 生命周期路由显示 `naoObservado: "broker-nao-configurado"` | **api** 上的 `BROKER_URL` 为空。这是正常状态，不是故障——读取会声明自己没有去查看，而不是沿用已登记的状态（[RN-486](business-rules/api.md#rn-486)） |
| 生命周期路由显示 `naoObservado: "broker-sem-resposta"` | `BROKER_URL` 已设置但没有任何响应：profile 很可能关闭了，或 api 不在 `broker` 网络中。如果 `detalhe` 写着 ``não respondeu `inspect` dentro do teto desta operação (5000ms)``，说明 broker **可以**访问但很慢——去看守护进程，而不是网络（[RN-604](business-rules/api.md#rn-604)） |
| 终端命令或 `container_start` 失败并显示 ``não respondeu `exec` dentro do teto desta operação``（或 `start`/`stop`/`remove`） | api 在该操作自己的上限处停止等待，而不是因为 broker 宕机（[RN-604](business-rules/api.md#rn-604)）。对于 `exec`，命令可能仍在容器内运行；对于 `start`/`stop`/`remove`，效果可能已经发生——重试前先检查 `/containers`。镜像 pull 超过 30s 的 `start` 会被 broker 自己截断——它在下面有单独一行 |
| dev agent 的终端结果显示 ``o comando passou do teto de execução de terminal (120s, TERMINAL_ACTION_TIMEOUT_MS)`` | 命令运行时间超过了 `TERMINAL_ACTION_TIMEOUT_MS`（自 [RN-757](business-rules/engine.md#rn-757) 起默认 120 s；之前是 15 s），engine 停止等待；进程可能仍在容器中运行。agent 会被引导在 `nohup … &` 下重新运行它。可以调高该变量，但超过约 180 s 时，engine 的外部等待（该值 + 120 s）会超过 api 中 Node `fetch` 的 300 s 响应头上限，截断问题又会回来 |
| `container_start` 失败并显示 ``o `docker pull <imagem>` não terminou dentro do teto de 30000ms e foi cancelado``（broker 返回 `504`，`origem: infra`） | 镜像不在守护进程中，其 pull 超出了 30s 的控制上限。杀掉 CLI 会取消 pull，因此镜像仍然缺失——重试没有用。在运行容器的主机上执行 pull（`docker pull <imagem>`；在 `runner` 模式下，在用户的机器上），然后再次批准 start。根据维护者的决定，大镜像第一次不会通过这条路径启动（[RN-605](business-rules/contracts.md#rn-605)） |
| **挂载目录**项目的 `start` 中出现 `BRABO_PROJECTS_HOST_BASE não está definida` | 与上一行形式相同，只是另一个根。在 `.env` 中设置 `BRABO_PROJECTS_BASE` 并重建 broker；compose 从它推导出这个变量（[RN-503](business-rules/api.md#rn-503)） |
| broker 对 `runner` 模式的项目返回 `409` | 预期之中。那个目录位于用户的机器上，本主机看不到它——在那里，由 runner 启动容器（[ADR 0137](adr/0137-o-runner-sobe-o-container-do-projeto.md)） |
| broker 返回 `409`，说不知道项目目录在哪里 | 这是一个**遗留**的**挂载目录**项目，创建于 base 存在之前，位于 base 之外。修复方法是把目录移到 `BRABO_PROJECTS_BASE` 之内，而不是更改项目的模式——消息会点名 base 和它看到的路径（[RN-503](business-rules/api.md#rn-503)） |

**broker 从不自行启动容器。** 没有循环，也没有队列：它只在被调用时行动，而每一次写调用都源自一个由人批准的 `proposed_action`。

### 把 workspace 迁移到本地目录 {#migrar-workspaces-pasta-local}

设置 `PROJECT_WORKSPACES_HOST_DIR`/`GIT_LOCAL_REPOS_HOST_DIR`
（[快速开始](getting-started.md#local-folder-for-workspaces)）会把 Docker 卷换成指定的目录——但**不会复制**旧卷中已有的内容。已经创建了项目且不想丢失工作的人，需要在切换前先复制内容：

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
# defina as duas variáveis no .env, depois:
pnpm dev
```

卷名（`brabo-dev_project_workspaces`）带有 Compose 项目的前缀（`docker/docker-compose.yml` 中的 `name: brabo-dev`，[ADR
0170](adr/0170-compose-de-dev-brabo-dev.md)）——用 `docker volume ls` 确认。ADR 0170 之前的 dev 环境仍把数据放在 `brabo_*` 下：请先参见
[把 dev 环境迁移到 brabo-dev](#dev-para-brabo-dev)。旧卷之后仍会存在（Compose 不会删除不再使用的卷）；确定复制成功后，用 `docker volume rm` 删除它。

### 挂载目录模式的项目：项目 base {#projeto-no-modo-local}

**症状：**项目向导根本不提供**挂载目录**；或者提供了，但 api 返回 `400`，说该目录*从 api 内部看不存在*。

两者源于同一个事实：挂载目录模式的项目把代码保存在**你的**目录中，而 api 和 engine 只有在该目录挂载到它们的容器中时才能访问。变化的是（[ADR 0141](adr/0141-base-unica-dos-projetos-montados.md)，
[RN-500](business-rules/api.md#rn-500)）由谁来安排这件事、多久安排一次：现在有**一个 base**，由操作者配置一次，每个挂载项目都位于其中。你再也不用按项目编辑 compose。

**怎么做——整个安装只需一次。** 受支持的路径是同意步骤（[ADR 0146](adr/0146-base-consentida-no-bootstrap.md)），它会建议一个目录，拒绝与 Brabo 的 checkout 或
`PROJECT_WORKSPACES_HOST_DIR` 重叠的目录，在 macOS/Windows 上证明 Docker 能看到它，创建该目录并写入变量：

```bash
node scripts/dev/consentir-base.mjs
```

在**你自己的**终端中运行它。`pnpm bootstrap` → *Docker › Base de projetos* 运行同一个脚本，但只能**报告**：菜单中的每一项都故意以来自 `/dev/null` 的 stdin 运行，因此它无法提问。

手动写入这一行仍然有效：

```bash
# .env — caminho ABSOLUTO. O `~` NÃO é expandido pelo Compose.
BRABO_PROJECTS_BASE=/home/voce/projetos-brabo
```

```bash
docker compose -f docker/docker-compose.yml --env-file .env up -d api engine
```

就这样。从此以后，挂载目录模式的项目会放在 `/home/voce/brabo` 下的某处，不再需要额外配置。

**目录本身还不需要存在**
（[ADR 0142](adr/0142-validacao-de-workspace-montado-adiada.md)，
[RN-501](business-rules/api.md#rn-501)）。创建挂载目录项目只校验路径的**格式**以及“位于 base 之下”；目录在之后才创建，即 Infra 启动项目容器时——正因如此，向导可以先**建议** `<base>/<项目 slug>`。在这两个时刻之间，`workspacePath` 指向一个尚不存在的目录，项目的 `workspaceVerifiedAt` 为 `null`；把现有项目转换为挂载目录是唯一的例外，会当场创建目录，因为它要把 `permissions.json` 移进去。

所以现在创建时的 `400` 只意味着两件事之一，并且两者都会点明含义：路径不在 base 之下（消息点名 base 并建议 `<base>/<nome>`），或者根本没有配置 `BRABO_PROJECTS_BASE`（消息说明该**模式**在此安装中不可用）。api 无法创建或访问的目录会在之后出现，表现为 `container_start` 动作上的一个**具名** `failed`——绝不是 500，并且发生这种情况时容器生命周期不会被标记为 `provisioning`。

**挂载项目会得到一个真正的容器，它运行在服务器上**
（[RN-503](business-rules/api.md#rn-503)，
[ADR 0144](adr/0144-a-segunda-raiz-do-broker.md)）。由于主机的 Docker 守护进程可以访问 base，挂载目录项目的 `container_start` 会交给 [broker](#broker-de-container)，与容器模式完全一样——它不再需要已连接的 `brabo-runner`。只有 **Runner** 模式仍然交给 runner，在用户自己的机器上执行，因为那个目录位于本服务器看不到的地方。在本地 broker 已经在运行——自 [ADR 0146](adr/0146-base-consentida-no-bootstrap.md) 起它随 `pnpm dev` 一起启动，正是因为这是默认模式的路径；在生产环境中仍然需要 `--profile container-broker`。上面的目录也正是在这一步按此顺序创建的：守护进程只会对已经存在的目录做 bind-mount。

**向导为什么隐藏挂载目录模式。** 没有 `BRABO_PROJECTS_BASE` 时，api 报告 `projectsBase: null`，该选项根本不提供。这是有意为之：提供一个安装无法兑现的模式，会产生一个之后才卡住的项目——卡在第一个 agent 的第一个工具上，远离做出该决定的界面。容器模式（默认）和 Runner 模式不受影响，没有这个变量也能继续工作。

**为什么两边使用同一路径。** base 以**同一身份**挂载——
`/home/voce/brabo:/home/voce/brabo`——在 `api` 和 `engine` 中完全相同。路径**一次性**写入 `projects.workspace_path`，由两个进程读取
（[RN-169](business-rules/api.md#rn-169)）；它也是界面回显给你的字符串。把它挂载到别处会让 engine 写到 api 不读的地方，并让界面显示一个在你的机器上和它们的容器中都不存在的路径。

**确认容器实际看到的内容：**

```bash
docker compose -f docker/docker-compose.yml exec api    ls -la /home/voce/brabo
docker compose -f docker/docker-compose.yml exec engine ls -la /home/voce/brabo
```

**不要把 base 指向 Brabo 自身的 checkout。** 当 `BRABO_PROJECTS_BASE` 包含你克隆的仓库、或被它包含时，`pnpm dev` 会拒绝启动整个栈——它会点名两个路径并停止。这项检查故意只放在 preflight 中：api 把项目路径与 `process.cwd()` 比较，而在它的容器内那是 `/workspace`，所以它无法看到你真实的 checkout。没有 preflight 的守卫，把 Brabo 克隆到 `$HOME/brabo` 并把 base 设为同一目录，会通过所有校验，并让 dev agent 在产品自身的目录树中运行——这正是
[ADR 0055](adr/0055-escopo-de-caminho-na-politica-de-terminal.md) 要避免的失败。

**选择一个专用目录。** base 之下的一切都可以从产品的容器内部访问。不要把它指向整个 `$HOME`，也不要指向存放你其他机密的目录。

**其他拒绝方式及其含义：**

| 消息内容 | 怎么做 |
|---|---|
| 根本不提供挂载目录模式 | 未设置 `BRABO_PROJECTS_BASE`——设置它并执行 `up -d api engine` |
| *o modo Pasta montada não está disponível nesta instalação*（创建时） | 同一原因，由 api 说出：未设置 `BRABO_PROJECTS_BASE`（RN-501） |
| *a pasta tem de ficar dentro de `<base>`*（创建时） | 路径在 base 之外；使用消息建议的 `<base>/<nome>`，或修改 base 并执行 `up -d api engine` |
| *não consegui criar/alcançar `<caminho>` de dentro da api*（`container_start` 时） | base 实际上没有挂载，或主机上目录的所有者阻止了访问。用上面的 `exec ls` 确认、修正，然后再次批准 `container_start`（RN-501） |
| *não existe de dentro da api* | base 没有挂载到容器中；用上面的 `exec ls` 确认 |
| *existe mas não é uma pasta* | 路径指向一个文件；请使用目录 |
| *o processo não consegue escrever nela* | 主机上目录的所有者/权限问题。镜像以非 root 运行（[ADR 0024](adr/0024-fase5-imagens-producao-ci.md)）；调整目录的所有者或模式 |
| *Caminho inválido para um projeto Local* | 它是文件系统根、系统目录、相对路径、含有 `..`，或与 Brabo 自身的 checkout 重叠——请选择这些之外的你自己的目录（[ADR 0072](adr/0072-projeto-local-ou-container.md)） |

**已知限制，声明而不隐藏。** base 下指向其外部的符号链接在容器内会解析得不同，因为目标没有被挂载——目录浏览器拒绝进入符号链接，磁盘检查会把这种不一致作为具名失败捕获。此外，这个版本只支持**一个** base：位于别处的代码必须移到它里面。

**从旧的按项目挂载迁移。** 如果你在 `api` 和 `engine` 中有手写的
`- /home/voce/projetos/loja:/home/voce/projetos/loja` 行，它们仍然有效，也没有东西会删除它们——现有项目不会因这项改动而损坏。今后受支持的路径是 base；有机会时把这些目录移到其中，并删掉手写的行。

**不要把它与容器模式混淆。** 容器模式（默认）的项目继续使用 `PROJECT_WORKSPACES_ROOT` 和上面的迁移流程；挂载目录模式从不触碰那个根，base 也从不与那个根是同一个目录（[ADR 0141](adr/0141-base-unica-dos-projetos-montados.md)
解释了为什么混淆二者会让两个项目落进同一个目录）。

### runner 的项目 base {#base-do-runner}

**症状：**`brabo-runner` 以代码 2 退出，提示
`base de projetos recusada (…)`，或者在你期待有 base 时一开始就打印
`base de projetos: nenhuma configurada`，或者说它正 `Seguindo SEM base`。

这是一个与
[挂载目录模式的项目](#projeto-no-modo-local)中**不同的 base**。那一个
（`BRABO_PROJECTS_BASE`）属于**服务器**，是容器唯一能看到的目录；这一个属于**用户的机器**，是本地 agent 为每个项目创建目录的地方
（[ADR 0151](adr/0151-base-consentida-no-runner.md)，
[RN-529](business-rules/runner.md#rn-529)）。它们从不是同一个变量，从不是同一个文件，也从不互相校验。

runner 按以下顺序读取它：

1. 命令行中的 `--base <caminho absoluto>`；
2. `$XDG_CONFIG_HOME/brabo/runner.json`——退回到
   `~/.config/brabo/runner.json`——格式为 `{"base": "/abs/path"}`。

```bash
cat "${XDG_CONFIG_HOME:-$HOME/.config}/brabo/runner.json"
# {"base":"/home/you/projetos-brabo"}
```

**没有 base 是正常的。** 没有 base 的 runner 会像以往一样继续服务它的项目；它做不到的是承载之后创建的项目目录。启动行总会告诉你处于这两种状态中的哪一种。

这个目录已不只是配置：自
[RN-551](business-rules/runner.md#rn-551) 起，它也是
`brabo-runner device-key create` 存放本机**私有**设备密钥的地方
（`brabo-runner-device-key.jwk.json`，模式 600）——参见
[通过终端创建设备密钥](#chave-de-dispositivo-pelo-terminal)。像备份机密一样备份它，或者完全不备份并重新配对：密钥可以吊销、可以替换，产品中没有其他东西能读取它。

**拒绝，以及为什么处理方式不同。** base 在以下情况下被拒绝：是相对路径、含有 `..`、是 `/`、指向一个已存在的文件、在 Linux 上位于 `$HOME` 之外（与 `--dir` 自
[RN-434](business-rules/runner.md#rn-434) 以来的规则相同），或位于当前项目目录**之内**（或与之相同）——最后一种会让每个新项目都诞生在这个项目里面。来自 `--base` 时，这会以代码 2 结束进程；来自文件时，会打印到 `stderr`，runner **继续在没有 base 的情况下运行**，因为仅仅为了一项它还没用到的配置就杀死一个正在服务项目的 agent 是不相称的。存在但未声明 `base` 的文件属于缺失，而不是拒绝。

**位于 base 之外的项目不是问题。** `--dir` 的校验与以往完全一样，base 不参与其中：base 是**创建**规则。不要为了让某个提示消失而把遗留项目移进 base 来“修复”它——没有任何东西在报错。

### 机器级 agent：每个项目一个连接 {#agente-de-maquina}

**症状：**`brabo-runner` 在没有 `--project` 的情况下启动，要么打印了用法区块，要么说 `nenhum projeto em modo "runner" para esta conta`，要么服务了一些项目而拒绝了另一些。

自 [RN-544](business-rules/runner.md#rn-544)
（[ADR 0154](adr/0154-chave-de-dispositivo-de-maquina.md)）起，不带
`--project` 运行是一种真正的模式：agent 请求 `GET /runner/projects`，并打开
**每个项目一个连接**，根目录为 `<base>/<workspaceDirName>`。带 `--project` 的模式没有任何变化。解读输出：

- **`Sem --project, este runner só roda como agente de MÁQUINA…`**——没有经过同意的 base。两个条件都是必需的，原因不同：机器凭据是该路由接受的东西，base 是每个项目目录的来源。参见[上文的 base](#base-do-runner)。
- **`a api recusou a descoberta de projetos: esta credencial está presa a um
  PROJETO`**——一个 403。正在使用的凭据（PAT，或浏览器流程生成的设备密钥）指定了一个项目，没有什么可发现的。改用
  `--project <projectId>` 运行，或配对一把机器密钥——密钥材料就在本机生成（`brabo-runner device-key create`，参见
  [下文](#chave-de-dispositivo-pelo-terminal)），注册公钥部分是安装程序做的事。磁盘上两种密钥是同一种文件，所以 runner 不去猜：服务器是权威，它的消息被原样转述。
- **`nenhum projeto em modo "runner" para esta conta — nada a atender AINDA`**——
  这是新安装的**正常**状态，自
  [RN-550](business-rules/runner.md#rn-550) 起进程会**保持运行并持续询问**：
  每次调用之间间隔 15s，然后 30s，然后 60s，永远重复，直到第一个项目出现。没有人需要回到终端——在 web 上以 Runner 模式创建项目，agent 就会接手。一旦第一个连接建立，查询就会**停止**：此后列表只在启动时读取，因为一个变*短*的列表是有歧义的，为这种歧义断开一个活跃连接，等于用猜测替换已知状态。等待没有上限；**失败有**——连续十次调用失败，进程就以 1 退出并点名这个次数（任何响应，包括空响应，都会将计数器归零）。每 30 次空响应它会打印一次心跳，说明已经调用了多少次，以免在 `journalctl` 中“等待”看起来像“卡住”。两种 unit 的 `Restart=on-abnormal` 都没有改变——它本来就从不看退出码；改变的是，机器级 unit 现在真正处于 `active (running)`，`brabo-runner service status
  --machine` 在新安装上回答 `rodando`（0），而以前回答
  `parado`（3）。
- **`[<projeto>] NÃO será atendido`**——该项目的目录被拒绝（路径段逃出了 base，或目标存在但不是目录）。其他项目继续。只有**没有任何**项目剩下时，进程才以 1 退出。
- **`[<projeto>] este projeto deixa de ser atendido — os demais continuam`**——
  join 被拒绝（通常是已有第二个 runner 连接到该项目），或重试上限已用完。现在两者都是按**项目**的，而不是按进程：一个项目失败不再让 agent 对所有其他项目都停摆。当每个项目都以这种方式结束时，进程会打印每个项目的结果并以 1 退出。

连接循环中的每一行都以项目名作为前缀。如果某条消息没有前缀，它来自单项目模式。

### unit 处于 `bad-setting`，始终无法启动 {#unit-do-agente-nao-inicia}

**症状：**`service install` 报告成功，unit 文件已在磁盘上，但什么都没有运行：

```
$ systemctl --user status brabo-runner.service
   Loaded: bad-setting (Reason: Unit brabo-runner.service has a bad unit file setting.)
   Active: inactive (dead)
brabo-runner.service:16: WorkingDirectory= path is not absolute: "/home/<you>/.config/brabo"
```

**原因。** 在本次修复**之前**写入的 unit 会把工作目录放在引号里
（`WorkingDirectory="/home/…"`）。unit 文件的两部分并不共享同一种语法：`ExecStart=` 在解析时去掉引号并按单词分隔，所以每个参数都放在引号中；`WorkingDirectory=` **不是**——systemd 把行的剩余部分作为路径。加了引号后，值不再以 `/` 开头，unit 在加载时被拒绝，**永远不会启动**——两种 unit 都是如此（按项目和按机器一样，[RN-518](business-rules/runner.md#rn-518) 和
[RN-545](business-rules/runner.md#rn-545)）。

**修复：重新安装。** `service install` 会覆盖整个文件，所以没有修复步骤，也没有需要手工编辑的地方：

```bash
brabo-runner service install --machine \
  --dir "${XDG_CONFIG_HOME:-$HOME/.config}/brabo" \
  --api-url http://localhost:3000
# ou, para uma unit por projeto, de dentro da pasta daquele projeto:
brabo-runner service install
```

`status` 和 `uninstall` 在处于损坏状态的 unit 上仍然可用——目录以两种形式都能读回——所以如果你想先删除它，也不会卡住。

**相关但不同：** 一个能加载、却在错误目录启动的 unit。
`WorkingDirectory=` 会经过**说明符展开**，因此路径中的字面 `%` 必须写成 `%%`；CLI 现在会转义它，但一个手工编辑、带有 `/home/you/50%off` 的 unit 会静默地在 `/home/you/50<os-id>ff` 启动——绝对路径、被接受，但是错的。检查解析后的值，而不是文件：

```bash
systemctl --user show -p WorkingDirectory brabo-runner.service
```

unit 冻结的**环境**也是如此（AT-095）。在这次修复之前写入的 unit 带有不加引号的 `Environment=XDG_CONFIG_HOME=<pasta>` 和
`Environment=PATH=<caminho>`，而 `Environment=` 既按空格分隔，又展开说明符：使用 `XDG_CONFIG_HOME=/home/you/50%off com espaco` 时，服务收到的是 `/home/you/50<os-id>ff`——能加载、能启动，而机器级 agent 会在一个不存在的目录中寻找 base 和设备密钥，并且一言不发。CLI 现在把整个赋值放在引号中
（`Environment="XDG_CONFIG_HOME=…"`，并转义 `\`、`"` 和 `%`）。**修复：重新安装**，同上。检查 systemd 解析出的内容：

```bash
systemctl --user show -p Environment brabo-runner.service
```

### 通过终端创建设备密钥 {#chave-de-dispositivo-pelo-terminal}

**症状：**一台机器需要设备密钥，但没有浏览器来运行项目界面中的自动配置——新安装、无屏幕的机器，或者上面的机器级 agent 以 `esta credencial está presa a um PROJETO` 拒绝。

自 [RN-551](business-rules/runner.md#rn-551)
（[ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md) 第 4 点）起，密钥对**在本机**生成，分两步：

```bash
# 1) gere aqui; a JWK PÚBLICA é a única coisa no stdout
PUB=$(brabo-runner device-key create)

# 2) registre essa chave pública na api — quem tem a credencial para
#    registrar faz isso; o CLI nunca fala com a api
ID=$(… POST {"name":"…","publicKeyJwk":'"$PUB"'} … | jq -r .id)

# 3) carimbe o id do registro como o `kid` da JWK e escreva o arquivo de verdade
brabo-runner device-key finish --id "$ID"
```

- **分两步，是因为 `kid`。** 它**就是**服务器上的注册 id
  （[RN-475](business-rules/web.md#rn-475)），只有在公钥部分注册之后才存在；在它之前写入的私钥毫无用处，CLI 会永远拒绝它。所以 `create` 写入 `brabo-runner-device-key.jwk.json.parcial`，一个读取方会忽略的名字，而 `finish` 写入真正的文件。**runner 读取的文件永远不会缺少 `kid`**——两步之间的中断只会留下一个 runner 忽略、下一次 `create` 会点名的 `.parcial`。
- **位置：**`$XDG_CONFIG_HOME/brabo/`（否则为 `~/.config/brabo/`），在
  `runner.json` 旁边，模式 600；`--dir <pasta>` 会写到别处（比如某个项目目录）。机器级 unit 的 `--dir` 应当指向这个目录
  （`brabo-runner service install --machine --dir <pasta>`，
  [RN-545](business-rules/runner.md#rn-545)）——runner 从它**运行**所在的目录读取密钥，从不从它猜测的全局路径读取。
- **stdout 给脚本，stderr 给人。** `create` 只打印公钥 JWK；`finish` 只打印完成后的文件路径。
- **拒绝情况：**没有先 `create` 就 `finish`（没有可盖章的东西）、没有 `--id`、`--id` 里仍然包含整段 JSON 响应、`.parcial` 不是 Ed25519 私钥 JWK，以及——两个命令都有——已经有一把**完整**的密钥。最后这种情况没有 `--force`：静默替换一台已配对机器的密钥，会让 agent 用服务器不认识的密钥签名。先吊销当前密钥
  （[RN-519](business-rules/api.md#rn-519)），删除文件，然后再次 `create`。
- CLI **不会**断言密钥属于哪一种。在磁盘上，机器密钥和项目密钥是同一种文件；决定的是注册公钥部分的那条路由。

### 安装程序没有完成安装时 {#instalador-nao-fecha}

**症状：**`install.sh` 结束时给出一个 **"O que ficou pendente"** 区块，或者新安装有一个谁也过不去的登录、没有机器设备密钥、或者没有运行的 agent 服务。

自 [RN-547](business-rules/produto.md#rn-547)
（[ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)）起，安装程序会**完成**安装：它创建第一个账号，注册本机的设备密钥，并安装机器级 unit。这条链是

1. `POST /internal/first-account`（[RN-546](business-rules/produto.md#rn-546)）——账号**诞生即已验证**，因为 `MAIL_TRANSPORT` 是 `log`，安装程序不启用 SMTP；
2. `brabo-runner device-key create`（[RN-551](business-rules/runner.md#rn-551)）——Ed25519 密钥对**在本机**生成；只有公钥部分会传输；
3. `POST /internal/machine-device-keys`（[RN-552](business-rules/api.md#rn-552)）——
   返回的 `id` 会成为私钥 JWK 的 `kid`
   （[RN-475](business-rules/web.md#rn-475)）；
4. `brabo-runner device-key finish --id <id>`；
5. `brabo-runner service install --machine`（[RN-545](business-rules/runner.md#rn-545)）。

**什么都不会被撤销，每个失败都会被点名。** 安装程序总是以 0 退出：compose 已经运行，已完成的环节本身就有用。失败的部分会在最后打印出来，并附上重试的确切命令。

- **`service install --machine` 拒绝了。** 在开发者的机器上这是**常见**情况，而不是边界情况：当已经安装了**按项目**的 unit 时它会拒绝，并且没有 `--force`——两个进程会争夺同一个项目，服务器会拒绝其中一个。拒绝信息会点名它找到的每个 unit 的 `uninstall`。删除它们，然后重新运行安装程序打印出的最后一步：

  ```bash
  brabo-runner service uninstall --project <projectId>   # para cada uma nomeada
  brabo-runner service install --machine \
    --dir "${XDG_CONFIG_HOME:-$HOME/.config}/brabo" \
    --api-url http://localhost:3000
  ```

  `--dir` 中的目录是写入密钥的地方——绝不是项目目录，那里会有一个 `brabo-runner.config.json`，会让 unit 以**项目**模式启动，在自称机器级 agent 的同时静默地只服务一个项目。

- **注册密钥失败。** 会故意留下一个 `…jwk.json.parcial`。它是惰性的——runner 不读这个名字——安装程序**不会**删除它：api 提交之后的超时与之前的超时无法区分，所以这个文件可能是一把已注册密钥私钥部分的唯一副本。再次运行安装程序；如果你知道注册 id，也可以手工完成（`brabo-runner device-key finish --id <id>`）。下一次 `device-key create` 会点名并替换它。

- **账号步骤说安装中已经有用户。** 这是一个
  `409`，是**预期**结果，而不是失败——第二次执行，或者一次其恢复带回了用户的迁移（[RN-530](business-rules/infra.md#rn-530)）。用已存在的账号登录。这种情况下，机器密钥和服务步骤按设计会被跳过：为一个没有在本次执行中请求它的人铸造一个持久凭据，不是安装程序该做的事。

- **密码被拒绝。** 策略是领域中的策略，与注册所用的相同，只有在 POST 之后才知道——所以安装程序会再次询问，最多三次，并把用尽的上限变成一行待办，而不是中止一个已经运行起来的安装。它从不把密码写到任何地方：不写入 `.env`，不写入标记文件，也不写入日志。只有**电子邮件**进入标记文件（`ownerEmail`，`schemaVersion: 3`）。

- **没有 TTY。** 安装程序会报告并在写入任何东西之前以 **0** 退出。从终端运行它，作为下载下来的文件——
  `curl -fsSLO …/install.sh && bash install.sh`——绝不要用 `curl … | sh`（下载内容会变成进程的 stdin，扼杀每一个提问），也绝不要用
  `sh -c "$(curl …)"`，它无法校验自己的哈希。两者都会被点名拒绝；参见[安装](#instalando)。

- **agent 在运行但不服务任何东西。** 这是新安装的正常状态：它会等待并再次查询，直到第一个 `runner` 模式的项目出现
  （[RN-550](business-rules/runner.md#rn-550)）。参见
  [机器级 agent](#agente-de-maquina)。

### 项目目录始终没有出现在用户的机器上 {#pasta-do-projeto-nunca-aparece}

**症状：**本应在 runner 的 base 下出现一个项目目录，但它没有出现。engine 日志中有一行以
`workspace_create: o projeto <id> não criou pasta —` 开头，目录不存在。

消息会点名两个前置条件中哪一个失败了
（[RN-532](business-rules/runner.md#rn-532)，
[ADR 0151](adr/0151-base-consentida-no-runner.md) 第 3 至 6 点），它们也是仅有的两个——**不要求容器**，这是有意的：要求容器将是循环依赖，因为 `runner` 项目只有在 runner 把容器建立在这条消息要创建的目录之上之后，才会有一个已登记的 `running` 容器。

- **`nenhum brabo-runner está conectado a este projeto agora`**——为该项目启动 agent；参数见[上文的 base](#base-do-runner)。
- **`não declarou a capacidade `workspace` no join`**——已连接的二进制文件要么早于本版本，要么正**在没有经过同意的 base 下**运行。两种修复都在上一节：运行安装程序，或以 `--base` 启动 runner。拒绝故意被点名，因为两种原因的修复不同；join 本身**不会**被拒绝，所以 runner 会继续正常服务它的项目。
- **`o brabo-runner recusou criar a pasta`**——消息带有 runner 自己给出的原因：`segmento`（路径段逃出了 base——守卫拒绝了，什么也没创建）、`nao-e-pasta`（目标已作为文件存在；这个 CLI 从不覆盖文件）、`mkdir`（权限或磁盘）或 `git`
  （`git init`/clone 失败——目录**存在**，并且故意没有尝试任何备选方案）。
- **`não respondeu ... a tempo`**——大的克隆可能超出上限。检查 runner 所在的机器；服务器端不会留下写了一半的东西，因为写入只通过 `workspace_confirm` 发生。

已经作为 git 仓库存在的目录是**成功**，而不是错误：该操作是幂等的，会在 runner 的日志中报告 `ja-era-repositorio`。

### Runner 模式下的认证克隆在容器运行时被拒绝 {#credencial-nao-atravessa-o-container}

**症状：**`runner` 项目中的某个 dev agent 在准备 worktree 时被阻塞，诊断信息说凭据无法交付，点名
`credencial-nao-atravessa-o-container`。被阻塞任务的来源是
`politica`，而不是 `codigo`。

**这不是需要追查的 bug，而来源恰恰就在告诉你这一点**（[RN-558](business-rules/runner.md#rn-558)）。认证远程（`ADR 0056`）的凭据只能通过 `exec` 消息的 `env` 字段传递，而这个字段只适用于**主机**路径：产品的 Docker 端口故意没有
`env` 字段（[ADR 0130](adr/0130-broker-de-container.md)，没有任意的
`-e`）。当 runner 启动了项目容器后，它会把所有命令路由到容器内——于是凭据无处可去。

在 RN-558 之前，命令照样运行，变量为空，你看到的是一次普通的认证失败。现在它在执行前就被拒绝，什么也不会运行。拒绝信息从不打印变量的名字或值，只打印数量。

**自 [ADR 0193](adr/0193-git-credenciado-no-host-do-runner.md)
（[RN-676](business-rules/runner.md#rn-676)）起，这种拒绝在常见路径上不再发生：**engine 会标记认证的 `fetch`（`gitCredenciado`），当前版本的 runner 即使容器在运行，也会在**主机**上执行它——同一个目录，挂载在 `/work`。如果你仍然看到它，说明已连接的 `brabo-runner` 比这项改动更旧，不读取这个标记。

**怎么做：**

1. 在用户的机器上更新 `brabo-runner` 并重启它（或它的服务）。这就是修复。
2. 如果暂时无法更新：停止项目容器（`/containers` 页面，“Parar”），让 worktree 先落地——在主机路径上凭据会正常交付，初始 `fetch` 会成功。之后再重新启动容器；克隆是幂等的，不会重复。

**本地**仓库（没有 token）不受影响，`container` 和
`mounted` 项目也不受影响——它们从不经过这条路径。在主机上运行的
`workspace_create` 也不受影响。

**仍然开放、已声明的部分：**凭据仍然无法穿过
`docker exec`。要解决这一点，就得决定一个带凭据的操作如何与没有 `env` 字段的 `docker exec` 通信，而每个已知方案都会触及隔离边界——这需要一个 ADR，而不是顺手修复。

### dev 容器以你的用户身份写入，而不是 root {#dev-containers-nao-root}

**症状：**dev 容器 `api`、`web` 或 `engine` 在 bind mount 中写入的东西——`apps/api/dist`、`node_modules`、agent 在 `mounted` 执行模式的项目中生成的文件——在你的磁盘上属于 `root`，不用 `sudo` 编辑或删除都会失败。

这在以前是预期的：dev 镜像（`docker/api/Dockerfile`、
`docker/web/Dockerfile`、`docker/engine/Dockerfile`——与自 [ADR 0024](adr/0024-fase5-imagens-producao-ci.md) 起就已是非 root 的 `Dockerfile.prod` 不同）没有
`USER` 指令，以 root 运行。现在它们以**与你主机用户相同的 UID/GID** 运行，通过构建参数 `DEV_UID`/`DEV_GID`
（[配置](reference/configuration.md#dev-container-user-build-time)），所以这类问题不应再出现。

**如果你仍然看到它：**

1. 用 `id -u`/`id -g` 确认你的 UID/GID。如果不是 `1000`/`1000`，在 `.env` 中设置
   `DEV_UID`/`DEV_GID`（参见 `.env.example`）并重新构建：
   `docker compose -f docker/docker-compose.yml build api web engine`。
2. **本次修复之前的环境。** 具名卷
   （`*_node_modules`、`engine_build`、`engine_deps`、`engine_mix`、
   `engine_hex`）仍保存着旧容器以 root 身份写入的内容——全新的具名卷在第一次挂载时会继承正确的所有者，但已存在的卷不会被追溯修正。清理一次即可，要么删除这些卷（`docker compose -f docker/docker-compose.yml down
   -v`——对它们是安全的，它们是可复现的构建产物，从不是事实来源），要么就地对它们执行 `chown`：
   ```bash
   docker run --rm -v brabo-dev_api_app_node_modules:/v alpine chown -R "$(id -u):$(id -g)" /v
   # repita para os outros volumes node_modules/_build/deps/.mix/.hex
   ```
   **全新的卷**（第一次克隆，或只运行过安装程序、没有定义这些卷的机器）以另一种方式失败：
   `api` 和 `web` 以 `EACCES: permission denied, mkdir
   '/workspace/node_modules/.pnpm'` 退出，因为新卷继承的是该路径**在镜像中**的所有者，而镜像里不存在这个路径，于是它以
   `root:root` 诞生（AT-172）。`docker/api/Dockerfile` 和 `docker/web/Dockerfile`
   现在会在 `USER` 之前创建三个 `node_modules` 挂载点并对其 `chown`。**你磁盘上的 bind mount 内部**的挂载点是另一半：Docker 在主机上以 `root` 创建缺失的挂载点（它曾在 checkout 中留下属于 root 的
   `packages/shared/node_modules`），任何镜像都无法改变这一点。`pnpm dev` 会运行 `scripts/dev/preflight.mjs`，它会先以你的身份创建这些挂载点；手动执行的 `docker compose up` 会跳过它，所以在第一次手动 `up` 之前运行一次
   `pnpm dev:preflight`。
3. 对于 agent 已经在主机上 **`mounted`** 模式项目目录中写入的文件，修复方法是同样的 `sudo chown -R $USER <pasta>`——本节以前为整个仓库规定的方法——现在只是针对已有文件的一次性操作，而不是永久的变通。

4. **两个数据卷是另一回事，`down -v` 对它们**不**安全。**`/data/git-repos` 和 `/data/project-workspaces` 以具名卷挂载在
   `api` 和 `engine` 中。具名卷诞生时的所有者是该路径**在镜像中**已存在内容的所有者——如果路径不存在，它以 `root` 诞生，把非 root 进程挡在外面。dev 镜像最近才开始在 `USER` 之前创建它们并 `chown`；生产镜像一直这样做。症状不是你磁盘上某个无法编辑的文件：而是 `LocalGitProvider` 的 `git init --bare` 以
   `permission denied: /data/git-repos/<slug>.git` 失败，每个项目的
   `permissions.json` 无处写入——也就是说，**无法置备仓库**。

   与上面的构建产物卷不同，这两个卷保存的是事实来源（本地 bare 仓库、按项目的 worktree），删除它们会丢失数据。就地修复它们：
   ```bash
   docker run --rm -v brabo-dev_git_local_repos:/v alpine chown -R "$(id -u):$(id -g)" /v
   docker run --rm -v brabo-dev_project_workspaces:/v alpine chown -R "$(id -u):$(id -g)" /v
   ```
   修复之后创建的卷启动时就有正确的所有者。当你添加一个**新的**具名卷时，请在镜像中创建对应目录：忘记这一点不会造成构建错误，而是运行时的 `permission denied`。

### dev 环境的完全重置 {#reset-total}

```bash
bash scripts/dev/reset-total.sh      # ou: pnpm bootstrap → Docker › Reset total
```

重新构建镜像，**删除数据库**，重新迁移并填充种子数据——`.env` 中已有的 provider 凭据（`<PROVIDER>_TEST_KEY`）会在 owner 名下重新激活，所以你不必每次都在界面中重新输入。它**不会**删除或重建任何卷——`node_modules`、`_build`/`deps`、
`pgdata`（只删除其中的 schema）、`neo4j`、本地 bare 仓库和项目 workspace 全都保留——并且它会在开头和成功行旁边**说明这一点**（AT-181）。这是故意的保守选择：删除卷会丢掉没有人要求丢弃的 workspace 和本地仓库。

代价是**重置永远无法复现第一次克隆。** 只在卷尚不存在时出现的缺陷——比如以 `root` 诞生的 `node_modules` 卷（AT-172）——会在每次重置中都不被发现。要演练那条路径，请使用一个**一次性的 compose 项目**，绝不要用这个脚本，也绝不要用你的 `brabo-dev` 项目（也不要用安装的名字 `brabo`）：

```bash
docker compose -p brabo-primeiro-clone -f docker/docker-compose.yml build engine
docker compose -p brabo-primeiro-clone -f docker/docker-compose.yml \
  run --rm --no-deps engine ls -ldn /root/.mix /root/.hex \
  /workspace/apps/engine/_build /workspace/apps/engine/deps
docker compose -p brabo-primeiro-clone -f docker/docker-compose.yml down -v
```

`run` 会从零创建该项目的卷，并且不发布端口，所以不会与你正在运行的栈冲突。2026-09-25 以这种方式对 engine 测得（AT-182）：`_build`、`deps`、`.mix` 和 `.hex` 诞生时所有者为
`DEV_UID:DEV_GID`，`mix local.hex`/`local.rebar`/`deps.get` 以非 root 用户通过。它会留下两样东西：它在**你的 checkout 中**创建的空挂载点
`_build`/`deps`，所有者为 `root`（用下表中的 `alpine` 单行命令删除），以及它构建的镜像。

**顺序才是关键，且不可商量：**

0. **安装守卫**（[ADR 0170](adr/0170-compose-de-dev-brabo-dev.md)），在 preflight 之前：如果这台机器上有任何**安装** compose 的容器（其标签 `com.docker.compose.project.config_files`
   指向 `docker-compose.install.yml`），或者 dev compose 会解析为项目 `brabo`，它就以 `RESET NÃO COMEÇOU` 拒绝，并点名它找到的东西。在 ADR 0170 之前，dev 和安装是同一个 Docker 项目，这个脚本的 `DROP SCHEMA` 会落到安装的数据库上。
1. `preflight`，然后是**主机前置条件**（AT-203），然后是 `build`——慢的部分，在你的环境仍在运行时完成。migration 和种子在**主机**上运行，使用 checkout 中的 `apps/engine/deps`/`_build` 和
   `node_modules`——不是容器的卷，也不是镜像构建会更新的任何东西。因此，在产生任何效果之前，脚本会在 `apps/engine` 中运行 `mix deps.get` 和
   `mix compile`，确认 `drizzle-kit` 和 `ts-node` 能解析，并对照卷中的密码检查 Neo4j 的密码。2026-09-26 测得：`mix.lock` 中有一个新依赖时（mint 1.10.1，#613），
   `pnpm engine:migrate` 会在 `DROP SCHEMA` **之后**以 `lock mismatch` 失败，而“再运行一次”也同样失败。这里的拒绝会说
   `RESET NÃO COMEÇOU … Nada foi parado nem apagado`：数据库完好无损。
2. **`stop api engine`。** 就这两个，没有别的：它们是与 compose 的 Postgres 保持活动连接的服务（api 在
   `public`/`drizzle` 上的 Drizzle 连接池，engine 在 `engine` 上的 Ecto/Oban）。`web` 是一个 Vite 服务器，不与任何数据库通信，`neo4j` 是另一个本次重置不触碰的数据库，`broker` 只与 api 进行 HTTP 通信。
3. `up postgres`、`DROP SCHEMA`、`migrate`。
4. 全部 `up --wait`，然后 `seed`。
5. 向 api 和 engine 请求 `/health`，向 web 请求 `/`，打印
   `docker compose ps`，然后才结束。

**在活动进程底下**删除 schema 正是让它出错的原因：engine 会死在 `DROP SCHEMA engine CASCADE` 之中
（`Engine.Sessions.Rehydrator` 查询刚刚消失的 `engine.session_states`——`ERROR 42P01 (undefined_table)`），migration 之后会重建一切，而**没有任何东西能把死掉的进程带回来**。种子随后在激活会话的步骤（api → engine）以
`ECONNREFUSED` 失败，脚本却仍然打印 "reset completo"——一个固定在脚本末尾的 `echo`，而这个脚本从不询问刚做的事情结果如何。

**如果它中途停止**，它会说明并点名步骤
（`RESET INCOMPLETO — parou em: <passo>`），答案是**再运行一次**：它每次都会删除 schema，所以第二次执行与第一次从同样干净的起点开始。现在只运行 `pnpm --filter api seed` 来恢复也是安全的——种子是幂等的，会复用演示用的 workspace、项目和会话，而不是重复创建它们（并且**不会**再次追加会话的 5 个事件）。

| 你看到的 | 它是什么 |
|---|---|
| `RESET INCOMPLETO — parou em: migrations (api + engine)`，并在 `apps/engine/_build` 下出现 `permission denied` | `pnpm engine:migrate` 在**主机**上运行，而 Docker 以 `root` 创建缺失的 bind-mount 挂载点。就地修复：`docker run --rm -v "$PWD/apps/engine:/x" alpine chown -R "$(id -u):$(id -g)" /x/_build` |
| `RESET INCOMPLETO … banco apagado, migrado e semeado, mas estes serviços não responderam: <lista>` | 数据库没问题；有个进程没有回来。`docker compose -f docker/docker-compose.yml --env-file .env logs <serviço>` 会告诉你原因。这里没有任何情况需要再次运行重置 |
| `RESET NÃO COMEÇOU — recusado em: guarda da instalação na máquina (ADR 0170)` | 什么都没有被触碰。这台机器上有一个 Brabo 安装（会列出其容器），或者设置了 `COMPOSE_PROJECT_NAME=brabo`。**不带** `-v` 地停掉安装（拒绝信息会打印确切的 `docker compose -f <pasta>/docker/docker-compose.install.yml --env-file <pasta>/.env down`——其卷和数据保留），或去掉该变量；参见[把 dev 环境迁移到 brabo-dev](#dev-para-brabo-dev) |
| `RESET NÃO COMEÇOU — recusado em: pré-requisitos de host das migrations` | 什么都没有被触碰。主机上 `apps/engine` 中的 `mix deps.get`/`mix compile` 失败了（阅读它上方的输出），或者 `drizzle-kit`/`ts-node` 无法解析——`pnpm install --frozen-lockfile` |
| `O NEO4J RECUSA A SENHA DO .env`，出现在任何效果之前，或出现在 `container brabo-dev-neo4j-1 is unhealthy` 之后 | Neo4j 在 `neo4j_data` 卷**创建**时把密码保存在卷中，此后忽略 `NEO4J_AUTH`，而 healthcheck 使用的是 `.env` 中的密码。2026-09-26 测得：一个 9月13日的卷，容器以默认密码重建，healthcheck 报 `The client is unauthorized due to authentication failure`。把旧密码放回 `NEO4J_PASSWORD`，或在 Neo4j 内修改它（`ALTER CURRENT USER SET PASSWORD FROM … TO …`，命令会被打印出来），或者——图谱是派生的，`pnpm --filter api grafo:reprojetar` 可以重建它——自己删除该卷。脚本从不删除它（AT-181） |
| `up --wait` 超时 | `BRABO_RESET_WAIT_TIMEOUT`（秒，默认 600）。在 `node_modules`/`_build` 卷为空时的第一次启动，会在进程开始监听之前运行 `pnpm install`/`mix deps.get` |

### 把 dev 环境迁移到 brabo-dev {#dev-para-brabo-dev}

自 [ADR 0170](adr/0170-compose-de-dev-brabo-dev.md) 起，dev 的 compose
（`docker/docker-compose.yml`）是 Docker 项目 **`brabo-dev`**：容器
`brabo-dev-api-1`、`brabo-dev-postgres-1`……，卷 `brabo-dev_pgdata`、
`brabo-dev_neo4j_data`……，网络 `brabo-dev_default`。安装用的 compose
（`docker-compose.install.yml`）仍然是 **`brabo`**，已有的安装也是。以前两者都是 `brabo`——同一个 Docker 项目：在一个之上启动另一个会重建容器并把它们连到对方的数据库
（2026-09-19 测得：某个安装的数据库收到了一个 dev 的 migration），而 `reset-total.sh` 本会删除安装的 schema。

**如果你已经在这里开发，对你有什么变化：**下一次 `pnpm dev` 会创建**新的**、空的 `brabo-dev_*` 卷。你的数据仍留在原处，在 `brabo_*` 卷中，未被触碰——这项改动中没有任何东西会删除卷。preflight 在看到它们时会发出警告（它从不因此拒绝，也从不删除）。在以下两条路径中选择一条。

**区分 dev 卷与安装的卷。** 两者都带有标签
`com.docker.compose.project=brabo`，所以仅凭前缀什么也说明不了。能说明问题的是：

```bash
docker volume ls --filter label=com.docker.compose.project=brabo \
  --format '{{.Name}}\t{{.Label "com.docker.compose.volume"}}'
docker ps -a --filter label=com.docker.compose.project=brabo \
  --format '{{.Names}}\t{{.Label "com.docker.compose.project.config_files"}}'
```

- 只有 dev compose 声明的卷——`api_*_node_modules`、
  `web_*_node_modules`、`broker_*_node_modules`、`engine_build`、`engine_deps`、
  `engine_mix`、`engine_hex`——证明某个 dev 环境使用过 `brabo` 这个名字。安装从不创建它们。
- 两个 compose 都声明的卷——`pgdata`、`neo4j_data`、`neo4j_logs`、
  `ollama_data`、`git_local_repos`、`project_workspaces`、
  `brabo_projects_base`——单独看是有歧义的。如果不存在任何安装的容器（第二个命令没有显示 `docker-compose.install.yml`），并且你从未在这台机器上安装过 Brabo，那它们就是你旧的 dev 数据。如果你安装过，它们可能属于安装（或者在这个 ADR 所修复的事故之后是两者的混合）：在弄清楚之前，不要复制也不要删除它们。
  `backup_local` 只存在于安装中。

**路径 A——带走数据**（数据库、图谱、本地 bare 仓库和 workspace；构建产物卷不值得复制，新卷会在第一次启动时自行填充）：

```bash
# 1. a stack antiga para baixo, SEM -v (ela pode ainda estar rodando como `brabo`).
#    SÓ quando o segundo comando acima não listou nenhum container de instalação:
#    `-p brabo down` derrubaria uma instalação do mesmo jeito.
docker compose -p brabo -f docker/docker-compose.yml --env-file .env down
# 2. crie os volumes novos (vazios) sem iniciar nada
docker compose -f docker/docker-compose.yml --env-file .env create
# 3. copie, volume a volume
for v in pgdata neo4j_data neo4j_logs git_local_repos project_workspaces ollama_data; do
  docker volume inspect "brabo_$v" >/dev/null 2>&1 || continue
  docker run --rm -v "brabo_$v":/de -v "brabo-dev_$v":/para \
    alpine sh -c 'cp -a /de/. /para/'
done
# 4. suba como brabo-dev
pnpm dev
```

`cp -a` 会保留所有者和模式，这对 `pgdata`（Postgres 镜像会拒绝不属于自己的数据目录）和两个数据卷很重要（参见上文的
[dev 容器以你的用户身份写入](#dev-containers-nao-root)）。复制 Postgres 的目录时它必须处于**停止**状态——这正是第 1 步的作用。

**路径 B——从零开始：**只需运行 `pnpm dev`，然后运行
`bash scripts/dev/reset-total.sh` 来迁移新数据库并填充种子数据。旧卷会留在磁盘上，直到你删除它们。

**删除旧卷，只在新栈正常工作之后，并且只删除你已证明属于 dev 的卷**（安装的卷是你会丢失的数据）：

```bash
docker volume rm brabo_api_root_node_modules brabo_engine_build  # …um a um, pelo nome
```

故意没有任何脚本替你做这件事：对某个安装的 `brabo_pgdata` 执行 `docker volume rm` 是这里唯一无法撤销的错误。

---

## 本地部署 {#deploy-local}

在本地集群中启动完整的 Brabo，并用冒烟测试验证它。决策见
[ADR 0025](adr/0025-fase5-deploy-kubernetes-kustomize.md)。

### 前置条件 {#prerequisites}

PATH 中必须有：`docker`、`kubectl`、`kustomize`、`jq`、`openssl`。

`k3d` 和 `helm` **不**需要预先安装——bootstrap 会把它们安装到
`~/.local/bin`，使用固定版本并校验 checksum。确保该目录在 PATH 中。

资源：整个栈（Postgres、Prometheus、两个 operator 和三个应用）大约需要 **4 GiB** 空闲内存。

### 启动 {#bringing-it-up}

```bash
make deploy-local           # constrói as imagens, sobe o cluster, instala, valida
make deploy-local-clean     # o mesmo, sem reconstruir as imagens
```

结束时：web 位于 <http://localhost:8088>，api 位于 `:3000`，engine 位于
`:4000`——**与 `docker-compose.prod.yml` 的端口相同**，这是有意的（ADR
0025，决策 10）。bootstrap 会运行种子，创建已验证的
`owner@brabo.dev`，密码取自
`BRABO_SMOKE_PASSWORD`（默认 `brabo12345678`）——你就用它登录 web 自己的登录页。

种子在滚动发布**之后**运行（它的最后一步会激活一个会话，这会让 api 调用 engine），并且 bootstrap 只有在**确认登录返回 200** 之后才继续。这项检查依据的是结果而不是进程，它之所以存在，是因为之前的检查不是这样：
`wait --for=condition=Ready=false` 会被一个从未运行过的 pod 满足，因此 bootstrap 曾在登录返回 401 时宣布“冒烟用户已就绪”。

> **种子是幂等的。** 在已填充的数据库上再次运行它是正常情况（`BRABO_KEEP_CLUSTER=1`）：演示用的 workspace、项目和会话会被找到并复用，从不重复，复用的会话也不会再次获得那五个事件（`apps/api/src/db/seed.ts`，顶部的 docblock）。第二次执行不再死于 `workspaces_slug_unique`。bootstrap 仍然依据**登录**而不是 pod 的阶段做判断，并且仍会在最后删除该 pod，以免它让 `smoke.sh` 的第 1 步失败——那一步要求每个 pod 都健康。

> **这会占用 `pnpm dev` 的端口。** 保持端口相同，是让 `smoke.sh` 对两种模式都有效的原因，代价是两者不能共存：集群运行时，`pnpm dev` 无法发布 `api` 的端口，
> **5173 永远不会打开**。注意 web 在两种模式之间换了端口——
> 这里是 8088，那里是 5173。要回到开发：
>
> ```bash
> make k8s-down && pnpm dev
> ```
>
> `pnpm dev:preflight` 会告诉你当前处于哪种模式，无需猜测。两者在
> [快速开始](getting-started.md#the-two-local-modes-dont-coexist)中有说明。

其他目标：

```bash
make smoke-k8s        # só o smoke test, contra o cluster rodando
make hpa-test         # prova que o HPA do engine escala pela fila
make k8s-validate     # renderiza os overlays e valida contra o schema (sem cluster)
make k8s-logs         # últimas linhas de api, engine e web
make k8s-down         # remove o cluster
```

变量：`BRABO_SKIP_BUILD=1`（使用守护进程中的镜像）、
`BRABO_KEEP_CLUSTER=1`（复用集群）、`BRABO_CLUSTER_TOOL=kind`、
`BRABO_SKIP_OBSERVABILITY=1`（不安装 Tempo、Loki、Collector、Alloy 和 Grafana——
AT-177）。最后一个是为定时证明显式提供的关闭项，默认值不变：`make deploy-local` 仍会启动整个栈。Prometheus 和 prometheus-adapter 无论如何都会保留，因为 engine 的 HPA 通过它们提供的 External Metrics API 按 `oban_queue_depth` 扩缩容。相互独立的 helm release（ESO、CNPG、metrics-server、Prometheus）并行安装；每个都写自己的日志，只在失败时打印。

### 验证流水线的某个 tag {#validar-tag-do-pipeline}

```bash
make deploy-local TAG=v0.2.0-qa.1
```

第 6 阶段的流水线**不做部署**——它止于 tag。`TAG=` 是你在本地集群中查看该 tag 所盖章内容的方式：bootstrap 以分离方式检出该 tag，并从那个提交构建镜像。

它会在工作树不干净时**拒绝**运行，而不是去猜测如何处理你正在进行的工作。结束时你会处于分离的 HEAD；返回的命令会出现在日志中。

验证：**无**。没有任何 workflow 传入 `TAG=`：定时的
`propriedades.yml` 构建的是 checkout 的目录树，从不是 tag，所以
`deploy/k8s/bootstrap.sh` 中的分离检出（以及它对脏工作树的拒绝）只在有人手动输入时才运行。它之后启动的是与[本地部署](#deploy-local)相同的 bootstrap 和冒烟测试，而那些是经过证明的。

### 部署某个 release 的镜像 {#imagens-de-uma-release}

自 [ADR 0119](adr/0119-imagens-publicadas-no-ghcr-por-digest.md) 起，每个最终 tag 都会把生产镜像发布到 GHCR
（`ghcr.io/daneiel/brabo-{api,engine,web,backup,broker}`，公开——任何地方都没有
`imagePullSecret`），并**按 digest** 把发布内容记录在
`.release/images.json` 中。第五个镜像，即容器 broker
（[ADR 0162](adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)），是给安装用的——overlay 中没有 broker 的 Deployment，
`make imagens-do-release` 只写入其他四个。

本仓库的 overlay 保持 `newTag: REPLACE_WITH_DIGEST`，一个占位标记。**仓库从不声明生产环境运行的是哪个 release**——由你在部署时声明：

```bash
# 1. pegue o registro da release de que você está fazendo deploy
gh release download v3.2.0 --pattern images.json --dir .release

# 2. escreva os digests dela no overlay
make imagens-do-release OVERLAY=prod      # ou OVERLAY=staging

# 3. leia o diff antes de aplicar qualquer coisa
git diff deploy/k8s/overlays/prod/kustomization.yaml
```

运行前值得了解的三件事：

- **不要提交结果。** `kustomize edit` 会对 YAML 做一次往返：它会重排键并丢掉注释。这项改动只应在你的工作树中存活一次 `kubectl apply -k` 的时间，不能更久。
- **`digest:` 取代 `newTag:`**，这正是要点——生产环境中的可变 tag 意味着没有确定性的回滚，同一个 ReplicaSet 的两个 pod 可能运行不同的二进制文件。
- **回滚就是用上一个 release 的文件执行同一个命令。** 没有别的需要撤销：digest 就是全部状态。

如果 `make imagens-do-release` 说找不到 `.release/images.json`，说明你跳过了第 1 步。如果找不到 `kustomize`，CI 使用的版本固定在 `.github/workflows/ci.yml` 中的 `KUSTOMIZE_VERSION`。

验证：`scripts/ci/aplicar-imagens.spec.ts` 在每个 PR 上证明第 2 步中**读取**文件的那一半——它接受
`release.yml` 写出的 `images.json`，拒绝没有 `imagens`、列表为空、或缺少版本和提交的文件。它交给 `kustomize edit set image` 的内容由
`scripts/ci/images-manifest.spec.ts` 证明——始终按 digest，从不是 tag，并且只有 kustomize base 声明的四个镜像。在 overlay 上运行 `kustomize` 没有 spec。整条链路
（下载真实 release 的文件、写入、`kubectl apply -k`）**从未作为证明运行过**：没有任何东西把某个 release 的 digest 应用到集群，而定时运行的集群使用的是从目录树构建的镜像，而不是已发布的镜像。

### 线上是哪个版本 {#que-versao-esta-no-ar}

三个地方说的是同一件事，答案是**烘焙进产物**的版本——而不是某个可能被人意外修改的配置
（[ADR 0036](adr/0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md)）：

1. **登录页面**的页脚。最快的方式，也不需要集群访问权限：打开 `/login`，读取页脚的第一项。
2. **镜像的 tag**，如果你有 `kubectl`：

   ```bash
   kubectl -n brabo get deploy -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.template.spec.containers[0].image}{"\n"}{end}'
   ```

3. Tempo 中来自 api 的 **span 上的 `service.version`**。三者中唯一能把某个具体请求与某次构建关联起来的。

三处都显示 `dev` 并不是故障：这是在 `release.yml` 之外构建的镜像所报告的值，因为它不是从任何 tag 诞生的。`docker
compose`、不带 `TAG=` 的 `make deploy-local` 以及本地构建都会落到这里。

**三者之间的不一致本身就是发现。** 页脚显示一个版本而镜像 tag 显示另一个，意味着浏览器或 nginx 中的 bundle 缓存，而不是部署错误——bundle 和镜像来自同一次构建。在怀疑集群之前，先忽略缓存强制刷新。

### SecOps 的 gate 卡在 "SAST não rodou" {#semgrep-do-gate}

会话的消息流显示一条来自 SecOps 的 `agent.error`（来源 `infra`），内容为
`SAST não rodou: semgrep falhou (:invalid_output), pulado`（或 `:sem_saida`、
或 `indisponível`），PR 停在 `awaiting_secops`。自
[RN-714](business-rules/engine.md#rn-714) 起，gate 从不在没有静态分析的情况下通过：它保持待定并阻塞 PR。修复下面的原因之后，gate 会自己重新运行——在 engine 下一次重启时，或者 `GateRescuer` 发现停滞的周期时（15 分钟）。每个原因的错误只出现一次：再次遇到同一原因的救援只会在 engine 服务器上记录它。在 RN-714 之前，同样的失败会让 gate 通过。在生产和安装用的 compose 中，engine 以 `read_only: true` 运行，并在 `/home/engine` 上挂载 tmpfs；当这个 tmpfs 以 `root:root` 创建时，engine 用户（uid 1000）无法创建
`/home/engine/.semgrep`，semgrep 以空的 stdout 退出，gate 无法读取结果。

在运行中的 engine 内部检查：

```bash
docker exec brabo-engine-1 sh -c 'ls -ld /home/engine; id -u'
```

该目录必须属于 uid 1000。自 RN-707 起，两个 compose 都声明了
`/home/engine:uid=1000,gid=1000,mode=0700`；在它之前创建的安装会保留旧的那一行，直到其 compose 被更新、`engine` 服务被重建（`docker compose ... up -d engine`）。Kubernetes 不受影响（`fsGroup: 1000`）。缺少 `semgrep` 二进制文件也会以同样方式阻塞 gate。semgrep 仍会从 registry 获取规则：没有出站网络时扫描会以 `scan_failed` 失败，那是另一个原因。

`scan_failed` 也可能来自一个**没有 `semgrep-core`** 的 semgrep——执行扫描的二进制文件：

```bash
docker exec brabo-dev-engine-1 semgrep --version   # compose de dev
docker exec brabo-dev-engine-1 sh -c 'semgrep --config p/security-audit --json --quiet --metrics=off /tmp >/dev/null'
# "Failed to find semgrep-core in PATH or in the semgrep package." (exit 2)
```

Semgrep 1.179.0 停止发布 `musllinux` wheel，因此在 engine 的 Alpine 镜像中，pip 会从 sdist 构建它，而 core 二进制文件缺失。engine 的两个 Dockerfile 都固定了 `SEMGREP_VERSION=1.183.0`（dev 的自 10月2日起，并由 `scripts/ci/semgrep-do-engine.spec.ts` 保持与生产一致）；在此之前构建的 dev 镜像用 `docker compose -p brabo-dev up -d --build engine` 重建。升级版本需要一个在 PyPI 上有 `musllinux` wheel 的 release。

### engine 以 `sys_sigaltstack(): Internal error` 中止 {#engine-sigaltstack}

`sys/unix/sys_signal_stack.c:101:sys_sigaltstack(): Internal error: Failed to
set alternate signal stack`，exit 134，出现在启动或镜像构建时（`mix
local.hex`、`mix compile`）：ERTS 向 musl 请求一个固定大小的信号栈，而 musl ≥ 1.2.6 在带有 AMX 的 CPU 上会拒绝（erlang/otp#11349）。它在 CI 中间歇出现（只有部分 runner 有 AMX），在这类服务器上则是确定性的。engine 运行的 OTP 29.1.1 包含修复
（[ADR 0209](adr/0209-engine-em-otp-29.md)）；再次看到它意味着某个镜像在 Alpine ≥ 3.24 上使用了 OTP < 29.1——从当前的 Dockerfile 重新构建。CI 的构建步骤“O host tem AMX?”会告诉你某次执行是否落在了这类主机上。

### CORS 错误 {#erro-de-cors}

浏览器的消息点名的是调用的**目标**，从不是原因。先读它引用的**来源**——那才是有用的信息
（[ADR 0037](adr/0037-cors-do-engine-e-a-porta-como-contrato.md)）：

```
Access to fetch at 'http://localhost:3000/health' from origin
'http://localhost:5174' has been blocked by CORS policy
                     ^^^^ esta parte é o diagnóstico
```

**如果来源不是你预期的**（`:5174` 而不是 `:5173`、不同的主机、`https` 而不是 `http`），问题在来源，而不是 CORS。

在 compose 中，`WEB_ORIGIN` 是从 `WEB_PORT` **推导**出来的——在 `.env` 中修改
`WEB_PORT`（[快速开始](getting-started.md)对端口被占用的建议）会同时移动被接受的来源，所以这种特定的不一致不会再发生。仍然会导致它的情况：有人在 compose 之外直接给 Vite 传了 `--port`（ADR 0037 让 Vite 在这种情况下通过 `strictPort` 拒绝启动，而不是静默地在另一个端口启动）、web 通过其他途径提供，或者
`WEB_ORIGIN` 被手动设置并覆盖了推导。修正来源，或把它添加到 `WEB_ORIGIN`——**在两个服务中都要加**，它们读取同一个变量。

**如果来源是对的**，确认每个服务实际返回了什么。
`curl` 不执行 CORS，所以会显示原始响应头——正是浏览器所查看的：

```bash
# api — espera-se access-control-allow-origin + allow-credentials
curl -sI http://localhost:3000/health -H "Origin: http://localhost:5173" \
  | grep -i access-control

# engine — espera-se access-control-allow-origin + vary: origin
curl -sI http://localhost:4000/health -H "Origin: http://localhost:5173" \
  | grep -i access-control

# preflight, que é onde falta de allow-headers aparece
curl -sI -X OPTIONS http://localhost:3000/auth/login \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-csrf-token" \
  | grep -i access-control
```

**空输出就是发现**：服务没有认出这个来源。
`WEB_ORIGIN` 错误或缺失，或者端口错误。

**缺少 web 发送的响应头的 preflight** 是另一种失败方式，也是最具误导性的：api 的 `allowedHeaders` 列表是显式的，而且**没有任何测试执行 preflight**，所以客户端新增的请求头会通过 CI，只在浏览器中出错。目前的列表是 `Content-Type`、
`Authorization`、`X-CSRF-Token`、`traceparent`。

三件看起来像、但**不是** CORS 问题的事：

- **api ↔ engine。** CORS 是浏览器的机制；在那里调用方是服务器端的 HTTP 客户端，会忽略这些响应头。这条路径上的失败要么是 service token（`401`/`403`——参见
  [轮换](#rotacao-das-chaves-do-auth)），要么是地址错误
  （`ECONNREFUSED`——参见[会话无法离开 `created`](#sessao-nao-ativa)）。
- **Phoenix 通道陷入沉默。** WebSocket 不经过 CORS。拒绝它的是 endpoint 的 `check_origin`，同样由
  `WEB_ORIGIN` 提供，拒绝会出现在 engine 的日志中——而不是作为 CORS 错误出现在浏览器控制台。
- **engine 的 `/metrics` 在浏览器中被阻止。** 这是有意的：内部指标不打算让页面的 JavaScript 可读。请使用
  `curl`。

### 会话无法离开 `created` {#sessao-nao-ativa}

症状：激活会话没有任何反应。“Abrir sessão criativa” 创建了会话但界面不动；“Ativar sessão” 也一样。在 api 的日志中，`POST /projects/:id/sessions/:id/transition` 返回
`500`：

```
TransitionSessionUseCase.activate ✗ TypeError
  ↳ HttpApiToEngineClient.startSession ✗ TypeError: fetch failed
      caused by: AggregateError [ECONNREFUSED]
```

激活会话是第一个**跨越**到 engine 的步骤（api 通过内部 HTTP 请求一个受监督的会话），所以错误的 `ENGINE_URL` 会在这里出现——而不是更早，因为创建路径上没有其他东西离开 api。

在容器**内部**确认，那里才是地址起作用的地方
（dev compose 中是 `brabo-dev-api-1`；在安装中是 `brabo-api-1`，
[ADR 0170](adr/0170-compose-de-dev-brabo-dev.md)）：

```bash
docker exec brabo-dev-api-1 node -e '
for (const u of ["http://engine:4000/health", "http://localhost:4000/health"]) {
  fetch(u, { signal: AbortSignal.timeout(5000) })
    .then((r) => console.log(u, "->", r.status))
    .catch((e) => console.log(u, "-> FAILED:", e.cause?.code ?? e.message));
}'
docker exec brabo-dev-api-1 sh -c 'echo $ENGINE_URL'
```

`engine:4000` 返回 `200`，而 `localhost:4000` 给出
`ECONNREFUSED`，且 `ENGINE_URL=http://localhost:4000`，这就是确定的诊断：**在容器内部，`localhost` 就是 api 自己**。

原因通常是 `.env`，而不是 compose。`pnpm dev` 把 `.env` 作为 `--env-file` 传入，其中的值**优先于** compose 的
`${ENGINE_URL:-http://engine:4000}`。修复：从你的 `.env` 中删除（或注释掉）`ENGINE_URL` 这一行并重建 api——

```bash
docker compose -f docker/docker-compose.yml --env-file .env up -d api
```

——因为每个环境在没有它时都已带有正确的默认值：compose 指向 `engine` 服务，而在主机上运行的 api 会由其代码本身落到 `http://localhost:4000`。只有在要指向一个两者都不是的 engine 时，设置这个变量才有意义。这同样适用于**生产**的 compose，它使用相同的插值；在 Kubernetes 中值来自 ConfigMap，一直是 `http://engine:4000`。

如果 `ENGINE_URL` 是正确的，在怪罪地址之前先做两项检查：

- **engine 在运行吗？** `docker compose ps engine` 和
  `curl -sI http://localhost:4000/health`。地址正确时出现 `ECONNREFUSED` 意味着服务宕机，而不是配置错误。
- **一个激活后约 30s 自行关闭的会话**不是这个问题。查看 `termination_reason`：`heartbeat_timeout` 意味着激活成功了，但没有人加入 Phoenix 通道——在界面之外激活时这是预期行为
  （`SESSION_HEARTBEAT_TIMEOUT_MS`）。`conversation_idle_timeout` 是另一种：某个对话型 agent 等待用户超过了
  `SESSION_CONVERSATION_IDLE_TIMEOUT_MS`（8h），从它的回合结束时算起（[RN-581](business-rules/api.md#rn-581)）。要修改这个上限，在 `.env` 中设置该变量（三个 compose 都把它映射给 engine），或者在 Kubernetes 中给 overlay 中 engine 的 patch 添加一个 `env:` 项：
  `deploy/k8s/` 故意不写它，因为那里缺少该变量就已经是代码中 8h 的默认值（AT-153）。此后出现带有
  `reason: "sessao_encerrada"` 的 `409`，就是已关闭的会话在拒绝对话——请打开一个新会话。

### 终端标签页永远卡在 "Abrindo terminal..." {#terminal-preso-abrindo}

症状：在 `runner` 模式的项目中（ADR 0103/0104），代码 → Dev → 终端标签页始终停留在加载骨架。浏览器控制台在一个紧凑的循环中、以递增的退避显示：

```
socket do terminal com erro {"erro":"[object Event]"}
socket do terminal fechado
```

这是浏览器的 WebSocket 始终无法到达 engine，而不是 runner 的问题——甚至在任何 `brabo-runner` 连接之前就会发生。三个叠加的原因，都已由 [RN-433](business-rules/infra.md#rn-433) 解决：

1. **`ENGINE_PUBLIC_URL` 解析为 Docker 内部主机名。** api 交给浏览器的 ticket（`POST .../terminal-ticket`）带有
   `engineWsUrl`，由 `ENGINE_PUBLIC_URL` 组装——它不同于
   `ENGINE_URL`（RN-419），后者用于 compose 网络**内部**的 api→engine 调用。`docker/docker-compose.yml` 现在在 `api` 服务中定义了
   `ENGINE_PUBLIC_URL: ${ENGINE_PUBLIC_URL:-http://localhost:4000}`（与 `VITE_ENGINE_URL` 已为 `web` 使用的默认值相同）。在容器内部确认：

   ```bash
   docker exec brabo-dev-api-1 sh -c 'echo $ENGINE_PUBLIC_URL'
   # esperado: http://localhost:4000 (ou o endereço público real do seu engine)
   ```

   在本次修复之前构建的环境中，这里的空值意味着代码退回到了 `ENGINE_URL`（`http://engine:4000`）——一个只在 Docker 网络内部可解析、从浏览器永远无法解析的主机名。修复：重新构建/重建 `api` 容器，让新的 compose 默认值生效；如果 engine 真实的公开地址是别的（隧道、另一台主机），就在 `.env` 中显式设置 `ENGINE_PUBLIC_URL`。
2. **一个永远打不开的 socket 会永远静默重试。** 与上面的地址无关——即使 engine 确实无法访问（宕机、在防火墙之后），也应该表现为错误，而不是永远转圈。
   `apps/web/src/lib/terminal-channel.ts` 现在在 socket 8s 内未打开时放弃，并显示 `RunnerOnboardingPanel` 和一条可操作的消息，而不是停留在浏览器 WebSocket 默认重连行为的循环中。
3. **socket 的 URL 重复了路径。** 前两个修复之后真正的阻塞：`terminal-channel.ts` 把
   `/runner/websocket` 拼接到 api 已经返回完整的 `engineWsUrl`（`ws://host:port/runner`）上——而 `phoenix.js` 的 `Socket` 构造函数本身又会在它收到的任何 endpoint 上再追加 `/websocket`。engine 收到的是 `GET /runner/runner/websocket/websocket` 并拒绝它（`Phoenix.Router.NoRouteError`），在
   `docker logs brabo-dev-engine-1` 中表现为一个始终停留在
   `REFUSED CONNECTION` 的连接。修复方式是把 `engineWsUrl` 直接传给
   `Socket`——`apps/runner/src/channel.ts`（同一契约的 CLI 一侧）本来就是这样正确做的。

### runner 用失效的 ticket 淹没 api {#runner-com-ticket-morto}

症状：web 开始对用户本人的请求返回 **429**，而该用户并没有异常活动；和/或 `runner` 模式的项目显示为没有本地 agent（dev 任务卡在 `dev.blocked_by_container`，`RunnerReadiness` 拒绝），而 `brabo-runner` 明显正在该用户的机器上运行。

**如何确认。** 在 engine 日志中，寻找**同一个** ticket 以大约 **5.13 s** 的固定节奏被一次又一次拒绝：

```bash
docker logs brabo-dev-engine-1 2>&1 | grep 'REFUSED CONNECTION TO EngineWeb.RunnerSocket' | tail -20
```

几小时内出现几十条、全都带着同一个 ticket 字符串，就是它的特征。约 5.13 s 并非随意——它是 `phoenix.js` 内部 `reconnectAfterMs` 退避的上限。

**原因。** socket 的 ticket 是**一次性**的
（[RN-108](business-rules/web.md#rn-108)）；库内置的自动重连会重复**相同**的 `params`，因此它会重试一个在第一次连接时已被消耗、永远不会再被接受的 ticket。某个版本的 `apps/runner/src/channel.ts` 发布时这个自动重连是**开启**的——而该模块自己的 docblock 声称它已被禁用。叠加在 runner **自己**的重试策略上（那个策略是正确的：每轮新 ticket、退避、连续尝试上限），测得的结果是**一分钟内 530 个请求**，对比 `RATE_LIMIT_USER` 300 req/min 的上限，连续四分钟超限。这个限制是**按用户**的，这就是为什么 429 出现在账号所有者的浏览器中，而不是 runner 附近的某个地方。

第二个后果更糟：卡在这个循环中时 runner **并未连接**，所以 `RunnerReadiness`（[RN-507](business-rules/runner.md#rn-507)）会拒绝，项目看起来没有本地 agent——被理解为“容器起不来”的情况，有一部分就是这个。

**修复。** 更新 `brabo-runner` 二进制文件（或从项目界面重新安装）。服务器端无需改动：限流器尽了它的职责，engine 拒绝每一个这样的 ticket 也是正确的。如果洪泛仍在进行，停止 runner 会立即结束它，429 会随着滑动窗口清空（一分钟）而消失。

### api 因 OAuth 密钥拒绝启动 {#segredo-de-oauth-no-boot}

症状：在 `NODE_ENV=production` 下，api 在启动时就退出，消息与 `GIT_OAUTH_STATE_SECRET` 有关——缺失、设置为仓库中的示例值，或太短。

**这不是回归，也不要绕过它。** 这个密钥为 git OAuth 的 `state` 签名，而 `state` 正是防止公开回调被伪造的东西。在 [ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md)
之前，api 会以一个就发布在本仓库中的默认值启动——看到这个错误的人，此前其 git 连接流程一直对任何人开放。启动失败是迟到的警告。

```bash
export GIT_OAUTH_STATE_SECRET="$(openssl rand -base64 32)"
```

在 Kubernetes 中，值来自 `brabo-secrets`，位于密钥库中 `brabo` 对象下同名的键，
`deploy/k8s/base/common/externalsecrets.yaml` 会整体拉取它——如果错误出现在那里，问题在于密钥库没有提供这个键，路径是
[部署诊断](#diagnostico-do-deploy)。

更换密钥**会使进行中的 `state` 失效**：那一刻正处于“连接 GitHub”中途的人会被拒绝并重新走一遍流程。由于 `state` 的 TTL 是 10 分钟，这就是窗口期——无需迁移，任何**已建立**的连接都不受影响（保存的 token 不依赖这个密钥）。

### provider 拒绝社交登录的回调 {#callback-login-social-nao-registrado}

症状：在登录页点击“使用 GitHub 登录”/“使用 GitLab 登录”会跳到 provider，然后带着**provider 自己的**错误返回
（GitHub 上的 `redirect_uri_mismatch`，GitLab 上的 "The redirect URI included is not
valid"）——甚至没有到达
`/auth/oauth/:provider/callback`。

**这不是产品的 bug——是 provider 一侧缺少登记。** 社交登录（[ADR 0084](adr/0084-login-social-github-e-gitlab.md)）复用 git 连接已经在用的**同一个** OAuth App
（`GITHUB_OAUTH_CLIENT_ID`/`GITLAB_OAUTH_CLIENT_ID`，没有新变量），但每个**流程**都有自己的 `redirect_uri`，而 provider 要求 api 可能请求的**所有** URI 事先都已登记：

- git 连接（已有）：`${API_PUBLIC_URL}/git/oauth/<provider>/callback`
- 社交登录（新增）：`${API_PUBLIC_URL}/auth/oauth/<provider>/callback`

在 OAuth App 的配置中登记第二个（GitHub：Settings
→ Developer settings → OAuth Apps；GitLab：Settings → Applications）——GitHub 在同一个 App 中接受多个回调 URL，GitLab 也是。不需要单独的 App，也不需要新的 client id/secret。

### 四个同类密钥用默认值同样无法启动 {#segredos-irmaos-no-boot}

症状：在 `NODE_ENV=production` 下，api（或者，对于 `SECRET_KEY_BASE`
和 `BRABO_SERVICE_TOKEN`，engine 的 `:prod` release——自 [RN-601](business-rules/engine.md#rn-601) 起它拒绝同样的 token 值）在启动时退出，消息与 `AUTH_JWT_SECRET`、
`BRABO_SERVICE_TOKEN`、`CREDENTIALS_MASTER_KEY` 或 `SECRET_KEY_BASE` 有关——缺失、设置为仓库中的示例值，或太短。

**与上面的 OAuth 密钥原因相同，指引也相同：这不是回归，也不要绕过它。**
[ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md) 早已把这四个声明为待办——同样的模式，只是尚未复制——而 [RN-114](business-rules/api.md#rn-114) 解决了它。每一个保护的是不同的东西：

- `AUTH_JWT_SECRET` 公开 = 任何人都能推导出签署 access token 的密钥对并伪造一个有效的 token。
- `BRABO_SERVICE_TOKEN` 公开 = 任何人都能绕过
  `EngineServiceGuard` 调用 `/internal/*`。
- `CREDENTIALS_MASTER_KEY` 公开 = 任何人都能解密用户的凭据库（LLM 密钥、git token）。
- `SECRET_KEY_BASE`（engine）在 `runtime.exs` 中本来就有 `raise`——缺陷只在于 compose 用一个公开的回退值掩盖了这个 `raise`。

```bash
export AUTH_JWT_SECRET="$(openssl rand -base64 32)"
export BRABO_SERVICE_TOKEN="$(openssl rand -base64 32)"
export CREDENTIALS_MASTER_KEY="$(openssl rand -base64 32)"
export SECRET_KEY_BASE="$(openssl rand -base64 64)"
```

Kubernetes 中没有任何变化，原因与
`GIT_OAUTH_STATE_SECRET` 相同：这四个本来就来自 `brabo-secrets`，位于 `brabo` 对象下的同名键，由
`deploy/k8s/base/common/externalsecrets.yaml` 整体拉取。

**知识图谱（`NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD`，
[ADR 0099](adr/0099-neo4j-grafo-de-conhecimento-e-templates.md)）遵循同样的规则，但有一个区别**：`NEO4J_URI` 和 `NEO4J_USER` 有安全的开发默认值（`bolt://neo4j:7687`、`neo4j`——它们不是机密，`docker-compose.prod.yml` 也已提供）；只有
`NEO4J_PASSWORD` 没有公开默认值，原因与上面四个相同——没有它，api 的启动会在
`GraphStore.onModuleInit`（`neo4j-config.ts`）中失败，甚至**早于** Neo4j 本身拒绝启动（官方镜像的 entrypoint 要求 8 个以上字符的密码；空的 `NEO4J_AUTH` 会先让 `neo4j` 容器挂掉）。

```bash
export NEO4J_PASSWORD="$(openssl rand -hex 24)"
```

**在开发环境中，开关是 `NEO4J_URI`，它默认为空。** `neo4j` 服务在 dev compose 的默认 profile 中运行，因此无论是否有人与它通信，服务器都在运行；api 只有在设置了 `NEO4J_URI` 时才会连接。在 `.env` 中取消它的注释（`bolt://neo4j:7687`）并重建 api——
`GraphStore` 随后会记录 `Neo4j conectado — constraints do grafo garantidas`，而不是 `NEO4J_URI/NEO4J_USER/NEO4J_PASSWORD ausentes`。用户名和密码以 `neo4j` 服务用于
`NEO4J_AUTH` 的相同默认值到达容器，因此只有在要**更换**密码时才设置它们，而在那里更换会同时改变两边。

在这项接线之前，`docker-compose.yml` 根本不把这三个变量传给 `api` 服务，而该服务也没有 `env_file`——所以自图谱诞生以来 `.env.example` 记录的那个区块什么也没连上，取消注释也什么都不会开启。`docker-compose.prod.yml` 从第一天起就提供了它们（这就是为什么只有开发环境受影响）：一个健康的 Neo4j 旁边，是一个无限期报告变量缺失的 api。

**用 HEX，不要用 base64。** Neo4j 的 entrypoint 把 `NEO4J_AUTH` 读作
`usuario/senha`，并在**第一个**斜杠处分割——base64 密码可能包含 `/`（字母表中有 `/` 和 `+`），这会以
`Invalid value for NEO4J_AUTH` 破坏解析，让 `neo4j` 容器陷入重启循环。这真的发生过：在一次误把 `-base64` 重新引入的合并之后，CI 的冒烟测试就是这样失败的。十六进制没有 `/`、`+` 或 `=`。

`docker/smoke.sh` 每次运行时都会生成上面五个临时变量（四个同类密钥加上 `NEO4J_PASSWORD`，后者为十六进制）——CI 作业
"Build, scan e smoke das imagens de produção" 就是这样在没有任何提交的密钥的情况下启动
`docker-compose.prod.yml` 的。

不经过 `_PREVIOUS` 的交替就更换 `AUTH_JWT_SECRET` 或 `BRABO_SERVICE_TOKEN`，其效果已在
[auth 密钥轮换](#rotacao-das-chaves-do-auth)中说明；不重新包装就更换
`CREDENTIALS_MASTER_KEY`，其效果已在
[主密钥轮换](#rotacao-da-chave-mestra)中说明。这项**启动**检查不改变这两个流程中的任何一个——它只是阻止密钥以本仓库中的公开字面值进入生产。

### `MailSender` 中的真实 SMTP {#smtp-real}

`MailSender` 只有在 `MAIL_TRANSPORT=smtp` 时才真正发送邮件——默认值是 `log`（一贯的行为），**生产环境中也是如此**：发送真实邮件是操作者的显式选择
（[ADR 0096](adr/0096-smtp-real-no-mailsender.md)）。完整的 `SMTP_*` 表格参见
[配置](reference/configuration.md#api)。

配置不完整的症状：在 `NODE_ENV=production` 和
`MAIL_TRANSPORT=smtp` 下，api 在启动时退出，抱怨
`SMTP_HOST`、`SMTP_USER`、`SMTP_PASSWORD` 或 `SMTP_FROM`——与
[四个同类密钥](#segredos-irmaos-no-boot)（[RN-408](business-rules/api.md#rn-408)）的消息模式相同，但**没有**它们那种公开默认值：这里的规则只有在操作者选择了 `smtp` 时才起作用。

```bash
export MAIL_TRANSPORT=smtp
export SMTP_HOST=smtp.seu-provedor.com
export SMTP_PORT=587
export SMTP_USER=usuario-do-provedor
export SMTP_PASSWORD="$(sua-credencial-do-provedor)"
export SMTP_FROM="Brabo <nao-responda@seu-dominio.com>"
```

`SMTP_PASSWORD` 是服务的**基础设施**机密（一个简单的环境变量，像
`AUTH_JWT_SECRET` 一样），而不是**用户**机密——它不经过 envelope
encryption，除了更换变量并重启之外也没有自己的轮换流程（这个凭据的轮换策略由 SMTP 提供商决定）。在 Kubernetes 中，这个键像其他键一样放进密钥库的 `brabo` 对象，无需修改清单就会到达 `brabo-secrets`——`deploy/k8s/base/common/externalsecrets.yaml` 会整体拉取该对象。

如果没有启动错误但邮件仍未送达：在 api 日志中查找
`falha ao enviar e-mail via SMTP`（会显示 `type`/收件人，正文和 token **从不**出现——与 `LogMailSender` 的规则相同），并在怀疑 Brabo 之前用提供商自己的 SMTP 客户端测试凭据。

### 即使安装了 kind，k3d 仍是默认 {#k3d-is-the-default-even-with-kind-installed}

这不是偏好。k3s 自带内置的 NetworkPolicy 控制器；**kind 的 kindnet 不实现 NetworkPolicy**，会静默忽略这些清单。在 kind 集群中，本阶段的 policy 存在于 etcd 中却没有任何效果，部署看起来已经验证，实际上范围第 4 项有一半没有验证。冒烟测试会在集群没有执行策略时发出警告。

### 冒烟测试覆盖什么 {#what-the-smoke-test-covers}

1. 每个 pod 都 **Ready**——不只是 `Running`。readiness 检查失败的 pod 会永远处于 `Running`，却收不到流量。
2. 没有容器使用 `runAsUser: 0`。
3. 用种子用户登录 `POST /auth/login`——演练 argon2id、access token 的签发和会话 cookie。
4. `workspace → project → session`。这一步会穿过整套 NetworkPolicy：创建会话会让 api 通过内部 HTTP、携带 service token 调用 engine。会话以
   `kind: consultiva` 创建——自第 20 阶段起为必填
   （[RN-097](business-rules/api.md#rn-097)）——并且故意是 `consultiva`：冒烟测试演练创建 → 激活 → 关闭，从不激活执行，而在咨询型会话中激活执行会返回 `409`。

   **正是这一步证明了该路由在 web 之外有使用方。** 当 `kind` 变为必填时，api 的测试套件以 1562 个测试通过，而失败的是冒烟测试，因为它是唯一一个以外部客户端身份、不使用 mock、针对生产镜像调用该路由的测试。
5. 不同的探针（engine 的 `/live` 和 `/ready`，api 的 `/live`），以及 web 的 `/config.js` 指向集群的 URL。
6. `/metrics` 中带有 `queue` 和 `state` 标签的 `oban_queue_depth`。
7. `external.metrics.k8s.io` 提供该指标——prometheus-adapter 的失败方式是静默的，所以我们直接询问聚合 API。

### 部署诊断 {#diagnostico-do-deploy}

#### `/internal/*` 上的 `403`，或 api 调用 engine 时的 `401` {#403-on-internal-or-401-on-the-apis-calls-to-the-engine}

两个症状原因相同：两端的 service token 不一致（api 以 `403` 拒绝，engine 的 plug 以 `401` 拒绝）。确认两个工作负载读取的是**同一个**值：

```bash
kubectl -n brabo get secret brabo-secrets -o jsonpath='{.data.BRABO_SERVICE_TOKEN}' | base64 -d | sha256sum
kubectl -n brabo exec deploy/engine -- sh -c 'printf %s "$BRABO_SERVICE_TOKEN" | sha256sum'
```

比较哈希而不是值，可以避免在终端打印机密。如果不一致，engine 的 pod 拿的是旧版本的 Secret：`kubectl -n brabo rollout restart deploy/engine`。如果一致，说明请求头没有传过去：确认 `BRABO_SERVICE_TOKEN` 在**两个**工作负载中都已定义——engine 有一个开发默认值
（`dev-service-token-change-me`），所以只在那里忘记设置这个变量，恰好会产生这个症状，而且没有启动错误——并确认路径上没有代理剥掉未知的请求头。

#### 部署之后所有人登录都返回 `401` {#login-returning-401-for-everyone-after-a-deploy}

几乎总是新的 `AUTH_JWT_SECRET` 跳过了共存步骤：access token 随之失效，但症状出现在 refresh 时。正确流程见
[auth 密钥轮换](#rotacao-das-chaves-do-auth)。

#### `ExternalSecret` 始终不 Ready {#externalsecret-never-becomes-ready}

`SecretStore` 读取源 Secret `brabo`，它由 bootstrap 以命令式方式创建。确认它存在且 RBAC 已就位：

```bash
kubectl -n brabo get secret brabo
kubectl -n brabo describe secretstore brabo-secret-store
```

自 AT-220 起，`ExternalSecret` 从密钥库中**整体**拉取 `brabo` 对象（`dataFrom.extract`），而不是逐个列出键。这对诊断有两个影响：

- **缺少某个键不再阻止它变为 Ready。** `brabo-secrets` 会在缺少该键的情况下被创建，失败出现在需要该键的地方：带有 `secretKeyRef` 的 Pod（Neo4j 中的 `NEO4J_PASSWORD`，本地 S3 中的 `BACKUP_S3_ACCESS_KEY`/
  `BACKUP_S3_SECRET_KEY`）会停在
  `CreateContainerConfigError`，而 api 或 engine 会在生产中拒绝启动并点名该变量。密钥库中的对象必须包含
  `DATABASE_URL`、`SECRET_KEY_BASE`、`CREDENTIALS_MASTER_KEY`、
  `GIT_OAUTH_STATE_SECRET`、`AUTH_JWT_SECRET`、`AUTH_TOKEN_PEPPER`、
  `BRABO_SERVICE_TOKEN`、`RELEASE_COOKIE`、`BACKUP_S3_ENDPOINT`、
  `BACKUP_S3_BUCKET`、`BACKUP_S3_ACCESS_KEY`、`BACKUP_S3_SECRET_KEY` 和
  `NEO4J_PASSWORD`——即 `deploy/k8s/bootstrap.sh` 在本地创建的列表。比较实际到达的内容：

  ```bash
  kubectl -n brabo get secret brabo-secrets -o go-template='{{range $k, $v := .data}}{{$k}}{{"\n"}}{{end}}'
  ```

- **这个对象中的一切都会到达 Pod。** 每个键都会成为 api、engine、两个迁移 Job 以及备份 CronJob 的环境变量（`envFrom: brabo-secrets`）。不要在 `brabo` 中存放这些进程不应看到的东西；其他使用方的机密放进另一个对象。

#### engine 的 HPA 显示 `<unknown>` {#engine-hpa-at-unknown}

按可能性从高到低：

```bash
# 1. o engine está expondo a métrica?
kubectl -n brabo exec deploy/engine -- wget -qO- http://127.0.0.1:4000/metrics | grep oban_queue_depth

# 2. o Prometheus a está coletando?
kubectl -n monitoring port-forward svc/prometheus-server 9090:80
# depois: http://localhost:9090 -> Status -> Targets

# 3. o adapter a está servindo?
kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1/namespaces/brabo/oban_queue_depth?labelSelector=state%3Davailable"
```

如果 (1) 有响应而 (3) 没有，问题出在
`deploy/k8s/helm/prometheus-adapter-values.yaml` 中的规则。

#### 迁移 Job 无法重新应用 {#migration-job-doesnt-reapply}

`Job` 的 spec 是不可变的：先前的 Job 仍在集群中时，用新镜像重新应用会失败。bootstrap 在应用前已经会删除这两个 Job；手动操作：

```bash
kubectl -n brabo delete job migrate-api migrate-engine --ignore-not-found
kubectl apply -k deploy/k8s/overlays/local
```

#### `bin/engine rpc` 返回 `eaddrinuse` {#binengine-rpc-responds-eaddrinuse}

Erlang 分布式的端口范围（`ERL_AFLAGS`）需要不止一个端口：运行中的节点占用第一个，`rpc` 会启动一个需要另一个端口的隐藏节点。配置的范围是 9100–9110，已在 NetworkPolicy 中开放。

#### 确认 engine 的副本已组成集群 {#checking-that-the-engines-replicas-are-clustered}

没有 Erlang 集群时，`Workspace.ensure!` 的 `:global.trans` 不会串行化任何东西，两个副本会在同一个共享目录中并发执行 `git init`：

```bash
kubectl -n brabo exec deploy/engine -- /app/bin/engine rpc 'IO.inspect(Node.list())'
```

它应当列出其他 pod。在多于一个副本时列表为空，是缺陷。

### 机密：退回到 sealed-secrets {#fallback-sealed-secrets}

默认是 External Secrets Operator。在它不可行的地方，把
`deploy/k8s/base/common/externalsecrets.yaml` 中的 `ExternalSecret` 替换为 `SealedSecret`，
**保持同样的 Secret 名称（`brabo-secrets`）和同样的键**——部署中的其他东西都不需要修改，因为它们都通过 `secretRef` 使用它。

```bash
kubectl create secret generic brabo-secrets \
  --dry-run=client -o yaml \
  --from-literal=DATABASE_URL=... \
  --from-literal=SECRET_KEY_BASE=... \
  | kubeseal --format yaml > deploy/k8s/overlays/<env>/sealed-brabo-secrets.yaml
```

`SealedSecret` 是针对该集群的公钥加密的，可以纳入版本控制。普通 Secret **绝不**可以。

验证：**无**。仓库中没有任何东西运行 `kubeseal`，而定时运行的集群（`propriedades.yml`）通过 External Secrets 生成 `brabo-secrets`，所以这条路径从未被演练过。在信任它之前，用 `SealedSecret` 替换后启动一个集群并运行 `make smoke-k8s`：它的第一步要求每个 pod 都 Ready，而一个 `secretRef` 指向从未生成的 Secret 的 pod 不会 Ready。

### 本环境的已知限制 {#known-limits-of-this-environment}

- **用 RWO 代替 RWX。** 之所以可行，是因为集群只有一个节点，而 RWO 的意思是“一个**节点**”，不是“一个 pod”。在真正的集群中，这种配置会把 api 和 engine 放到不同节点上，dev agent 的 `git push` 会以 `remote unpack failed` 失败。
- CloudNativePG 的 Postgres 中**没有 pgvector**。目前没有任何 migration 创建该扩展，也不存在 `vector` 列。
- **`.gitlab-ci.yml` 没有本地静态校验**（第 8c 阶段，ADR
  0039）。Infra 领域的 Workflows 子 agent 用 `actionlint` 校验 GitHub Actions 的 workflow（固定在 `docker/engine/Dockerfile(.prod)` 中，与 `hadolint`/`gitleaks` 同样的模式）；GitLab CI 没有等效的离线二进制——官方 linter 需要一个在线实例。这是已记录的缺口，而不是编造出来的半吊子方案。

---

## engine 的滚动发布 {#rollout-do-engine}

决策见
[ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md)。

engine 承载会话进程。在第 5 阶段之前，不加小心地关掉一个副本，会让该 pod 上的**每个**会话悬挂在没有任何进程的
`active` 状态——永不推进，永不关闭。

### 滚动发布期间按顺序发生什么 {#what-happens-during-a-rollout-in-order}

| 阶段 | 多长时间 | 发生什么 |
|---|---|---|
| `preStop` | 最多 45s（`SHUTDOWN_DRAIN_TIMEOUT_MS`） | `Engine.Shutdown.drain/1`：`/ready` 变为 503，`/internal/sessions` 拒绝新会话，本节点上的每个会话都被交给一个存活的对等节点 |
| 逐会话交接 | 5s（`@handoff_timeout_ms`） | `:erpc.call`，让另一个节点接管该进程 |
| 未被接管 | — | 变为 `closing`，原因为 `node_shutdown`，然后变为 `closed_abnormally` |
| SIGTERM | 90s 中剩余的时间（`terminationGracePeriodSeconds`） | 监督树关闭 |

90s 是有意的：45s 的 drain 加上 BEAM 拆除的余量。只降低 `terminationGracePeriodSeconds` 而不降低 drain 的超时，会让 kubelet **在交接中途**杀死 pod——这恰恰就是重现 drain 所要避免的 bug 的方法。

### 执行滚动发布 {#doing-the-rollout}

```bash
kubectl -n brabo rollout restart deployment/engine
kubectl -n brabo rollout status  deployment/engine --timeout=300s
```

只有一个副本时，没有对等节点可以接管：**每个**活跃会话都会以 `closed_abnormally / node_shutdown` 结束。这是正确的，不是故障——但如果目标是不打断任何人，先扩容到 2：

```bash
kubectl -n brabo scale deployment/engine --replicas=2
```

### 证明没有留下孤儿 {#proving-nothing-was-left-orphaned}

```bash
make rollout-test
```

打开 5 个活跃会话，执行滚动发布，并要求**每一个**都处于两种状态之一：带有存活 `:global` 所有者的 `active`（已接管），或带有 `node_shutdown` 的 `closed_abnormally`（已 drain）。任何其他组合都不通过——尤其是没有所有者的 `active`，这正是孤儿的操作定义。

**它会保存旧 pod 会带走的证据**（AT-078）。在
`rollout restart` 之前，`deploy/k8s/rollout-evidencia.sh` 开始写入
`ROLLOUT_EVIDENCE_DIR`（未设置时为 `mktemp -d`；路径会在最后打印）：

| 文件 | 内容 |
|---|---|
| `engine-<pod>.log` | **每个** engine pod 的 `kubectl logs -f`——已在运行的（自启动起的完整日志，滚动发布会杀死它们），以及之后创建的每个 pod——一旦进入 `Running` 就开始附加 |
| `final-<pod>.log` | 结束时仍在运行的 pod 的一份非 follow 副本，用于覆盖中断的 `logs -f` |
| `events.log` | 命名空间的 `kubectl get events -w`，带有每个事件自己的时间戳（`SuccessfulRescale`、`ScalingReplicaSet`、`Killing`……） |
| `replicas.log` | 每 2 s 一次（`EVIDENCIA_INTERVALO`，spec 会缩短它）：`<epoch> <spec.replicas do Deployment> <ready> <HPA current> <HPA desired>` |
| `donos.log` | 检查中每一次所有者读取：`<epoch> <sessão> <nó dono ou ->` |
| `donos-durante-rollout.log` | 同样的读取，在 `rollout status` 运行期间循环执行——每次交接落到了哪个副本。单独保存，因为滚动发布中途的读取有时会碰到正在退出的 pod，不能用来作出结论 |
| `engine-estado.txt` | 只读：`engine.session_states` 中测试会话的行（没有行时，drain 和 `Adopter` 都看不到会话），以及 `SessionAdoptionWorker` 最近的 job，在两种结果的结尾各取一次 |
| `marcos.log`、`anexos.log`、`pods-antes.txt`、`pods-no-fim.txt` | 测试的里程碑（`rollout-restart`、`rollout-status-ok`……）、每个日志何时开始附加、T0 时和结束时的 pod |

出现孤儿时，失败会打印所有这些文件中点名该会话的每一行——包括旧 pod 的日志——以及与滚动发布相关的副本变化，并为每个孤儿给出一个结论：**在 HPA 第一次缩容之前还是之后**失去所有者。这区分出已知的混淆因素：之前运行的
`hpa-test` 会留下三个副本，而在窗口内约 75 s 时，HPA 缩到一个，杀掉新的副本。`spec.replicas` 的下降被视为 HPA 所致，因为 `rollout restart` 从不改变它。这些都不改变什么算作已接管或已 drain，也不改变 120 s 的上限。纯逻辑部分以及针对伪造 `kubectl` 的采集器，由
`scripts/ci/rollout-evidencia.spec.ts` 覆盖。定时 workflow 会在每次到达证明阶段的执行中（包括绿色的）把该目录作为 `rollout-evidencia` 产物上传。

它**不**捕获的内容，在有它之后的第一次绿色执行中测得
（`35449815544`）：drain 自己的日志行（`shutdown: drenando…`、
`shutdown: drain concluído — …`）从不进入 pod 日志。`Engine.Shutdown.drain/0`
在 `preStop` 的 `bin/engine rpc` 中运行，所以它的 `Logger` 输出进入该 hook 的 stdout，而 hook 成功时 kubelet 会丢弃它。旧 pod 的日志以 `SIGTERM received` 结束。逐会话的 drain 结果必须从 `donos-durante-rollout.log`（每个会话去了哪个副本）和 `engine-estado.txt`（它在 `session_states` 中的行是否保留下来）中读取。

**原因已修复，未在 k3d 中确认**（AT-078，RN-588）。这项证明捕获的孤儿（13 次执行中约 3 次：`session_states` 中没有行，且 `donos-durante-rollout.log` 中出现第二个**旧** pod）来自旧 pod 的 `Monitor` 在对等节点于交接期间重写该行之后又删除了它。现在 drain 会标记交接，Monitor 会保留该行。这由一个确定性的 ExUnit 测试证明，而不是由这项证明——它的失败率是 4-6 次中 1 次，无法证明一个修复。如果孤儿再次出现，交出该会话的 pod 的日志中，每个会话都会有一行
`Monitor: session_state <id> mantido|apagado em <node>`：没有这一行意味着 Monitor 从未处理 `:DOWN`（pod 先死了）。

手动询问同样的问题：

```sql
-- sessões ativas segundo a api
select id, status, updated_at from sessions where status = 'active';
```

```bash
# donos vivos segundo o engine
kubectl -n brabo exec deploy/engine -- \
  /app/bin/engine rpc ':global.registered_names() |> Enum.filter(&match?({:brabo_session, _}, &1)) |> length()'
```

在 api 中处于活跃、在 engine 中没有所有者 = 孤儿。

### 会话失控时 {#quando-a-sessao-escapa}

**会话卡在 `closing`。** `closing` 是过渡状态；卡在那里意味着 drain 开始了却没有结束。告警 *Session stuck in
closing* 在 15 分钟后触发。检查正在退出的那个 pod 的日志——如果它已经不在了，`Adopter`（每 30s 扫描一次）本应接管；如果没有接管，检查该行是否仍存在于 `engine.session_states` 中。

**`kill -9` / OOMKill 之后的孤儿。** 按定义，这些情况下 `preStop` 不会运行。覆盖它们的是 `SessionAdoptionWorker`，它每 30s 寻找一个在 `session_states` 中没有 `:global` 所有者的行并接管它。如果它没有运行，说明 Oban 队列停了——那就是另一个问题（参见[可观测性](#observabilidade)中未消费队列的告警）。

**滚动发布卡在 `preStop`。** 症状：一个 pod 每次都恰好 `Terminating` 90s。几乎可以肯定是某个 `:erpc.call` 在等待一个已经死亡但仍在 `Node.list()` 中的节点。每个会话 5s 的超时限制了损害；整整 90s 意味着约 18 个依次处理的会话，或一次永不返回的交接。

**即使有 2 个副本也没有任何会话被接管。** 节点之间互相看不见。检查 Erlang 集群：

```bash
kubectl -n brabo exec deploy/engine -- /app/bin/engine rpc 'Node.list()'
```

列表为空 = DNSCluster 没有解析 headless Service，或者 NetworkPolicy 阻止了分布式通信的端口范围（9100–9110）。没有集群时，每个副本都是孤岛，每次滚动发布都会 drain 所有会话。

### 加大 drain 窗口 {#aumentar-a-janela-de-drain}

如果会话很长、45s 的 drain 不够，两个值要**一起**提高——并按这个推理顺序：先选 drain，再加余量：

```yaml
# deploy/k8s/base/engine/deployment.yaml
terminationGracePeriodSeconds: 150   # drain + ~30s de desmonte
# env SHUTDOWN_DRAIN_TIMEOUT_MS: "120000"
```

只改 `terminationGracePeriodSeconds` 不会延长 drain；只改 drain 会让 kubelet 在中途杀死 pod。

验证：**没有专门的**。适用的证明是 `make rollout-test`，而定时执行只证明**本地** overlay 产生的那一对值：来自 `deploy/k8s/base/engine/deployment.yaml` 的 90 s grace，以及来自 `deploy/k8s/overlays/local/patches.yaml` 的 20 s drain——不是默认的 45 s，也不是加大后的值。在你部署所用的 overlay 中同时提高两者之后，在关键的滚动发布之前，用本地 overlay 中相同的值运行 `make rollout-test`；没有任何东西检查 grace period 是否高于 drain。

---

## 恢复 {#restore}

决策见 [ADR 0027](adr/0027-fase5-backup-hardening-release.md)。

> **已测试。** 下面的流程正是 `make test-restore` 所运行的，它针对本地集群运行。这里没有任何一步是从未有人演练过的。最后一次执行的记录在末尾。

### 哪些有备份，哪些故意没有 {#what-is-backed-up-and-what-deliberately-is-not}

共有七个具名卷；**两个**是事实来源，只复制这两个。分类见
[ADR 0152](adr/0152-backup-de-volumes-contra-compose.md)，这样做的原因是“备份所有卷”会浪费空间，同时掩盖真正重要的东西。

| 卷 | 性质 | 是否备份？ |
|---|---|---|
| `pgdata` | 事实来源——event log、动作、pgvector，一切 | 是，作为**逻辑 dump**。绝不是数据目录的文件副本：复制正在运行的 Postgres 会产生一个可能无法恢复的备份 |
| `git_local_repos` | 事实来源——`local` provider 项目的 *bare* 仓库 | **是**，这曾是缺口。它无法从 Postgres 重建：event log 保存的是叙事，不是 git 对象 |
| `neo4j_data` | 派生——event log 的一个投影（[ADR 0101](adr/0101-memoria-relacional-como-projecao-do-event-log.md)） | 否。对派生记忆的答案是**重新投影**，而不是恢复——`grafo:reprojetar`，参见[图谱丢失](#perda-do-grafo) |
| `project_workspaces` | 派生——`WorktreeManager` 从 bare 仓库重建的 worktree，**以及** `container` 和 `runner` 项目中 agent 的 `docs/` 目录，它是 event log 的一个投影（[ADR 0148](adr/0148-artefatos-projetados-em-arquivo.md)） | 否。答案是**重新投影**——`artefatos:reprojetar`，参见[产物目录丢失](#perda-da-pasta-de-artefatos) |
| `ollama_data` | 可重新获取——模型会重新下载 | 否 |
| `brabo_projects_base` | 属于用户，不属于产品 | 否，安装程序也从不删除它 |

### 备份存放在哪里 {#where-the-backup-lives}

| 什么 | 在哪里 |
|---|---|
| 计划 | Kubernetes：CronJob `brabo-backup`，每天 03:17 UTC。Compose：没有调度器——由你运行，或由安装程序在迁移前运行 |
| 目标 | 磁盘（`BACKUP_DIR`）**或**兼容 S3 的 bucket（`BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET`）。设置了 `BACKUP_DIR` 时它优先；为空时退回到 S3，CronJob 就是这样做的 |
| 布局 | Postgres 为 `daily/brabo-<ISO>.dump` + `weekly/…`；bare 仓库为 `git-daily/brabo-git-<ISO>.tar.gz` + `git-weekly/…` |
| 保留 | **每种类型** 7 个每日 + 4 个每周，按**数量**（`BACKUP_KEEP_DAILY` / `BACKUP_KEEP_WEEKLY`） |
| 格式 | `pg_dump --format=custom --compress=9`；仓库用 `tar -czf` |
| 历史 | 表 `backup_runs`——**dump**，以 `object_key` 为键。仓库的归档在同级前缀中带有相同的时间戳；关联靠名字，而不是某一列 |

在本地集群中，S3 目标是 `brabo` 命名空间内的一个 SeaweedFS（`s3-local`，`weed server -s3` 网关，端口 9000）——在 MinIO 停止发布其社区镜像之前一直是 MinIO
（[ADR 0169](adr/0169-seaweedfs-no-lugar-do-minio-no-overlay-local.md)）；在
staging/prod 中是真正的 bucket。流程不变——只是 endpoint 不同。如果 bootstrap 停在 `rollout status deployment/s3-local` 并出现
`ImagePullBackOff`，说明固定的镜像已不再提供：digest 能阻止字节改变，却不能阻止发布者离开。

> **compose 的默认目标是一个具名卷，这适合验证，却不适合迁移。** `docker compose down -v` 会把
> `backup_local` 连同它本应保护的数据一起删除。在任何迁移之前，把
> `BRABO_BACKUP_HOST_DIR` 指向主机上的一个目录。

### bare 仓库的归档保证什么——以及不保证什么 {#garantia-dos-bare-repos}

没有任何东西被冻结：复制仓库时，api 和 engine 可能正在写入。这具体换来的是：

- **保证。** **按引用**的一致性。git 在移动 ref 之前写入对象，并通过原子 rename 替换 ref（或在锁下重写
  `packed-refs`，同样通过 rename）。与 `git push` 交叉的 `tar` 捕获到的 ref 要么是旧值要么是新值，绝不会是半个值——而在新值的情况下，它能到达的对象已经在磁盘上。
- **保证。** 部分归档会**让本次执行失败**，而不是被当作良好的备份通过。并发的 `git gc` 可能在 `tar` 列出目录与读取它之间删除某个 packfile；`tar` 的退出状态被记录到一个文件中（在 POSIX `sh` 中，管道的状态是最后一个命令的状态），非零状态会在 `backup_runs` 中变成一行 `failed`，这正是触发告警的东西。重新运行即可。
- **保证。** 在写入任何东西之前，归档**从头到尾**都是可读的——`brabo-restore-git` 就是 git 这一侧的 `pg_restore --list`。被截断的 tar 大小看起来合理，只有读一遍才能知道。
- **不保证。** 任何全局时间点。`tar` 在一段时间内遍历目录树，所以两个仓库——或同一个仓库的两个 ref——可能来自不同的时刻。对按 ref 校验的 git 来说无关紧要；对把“03:17 的备份”理解为单一快照的人来说则有关。
- **不保证。** 对象的连通性。这里没有任何东西运行 `git fsck`：备份镜像故意不包含 git。证明的是容器的完整性，而不是内容的完整性。
- **不复制。** `*.lock` 文件和 `objects/tmp_*`。恢复一个孤立的锁，会得到一个所有 `git` 都拒绝工作的仓库，而且错误信息从不提及备份。

### 恢复之前：备份存在吗，可用吗？ {#before-restoring-does-the-backup-exist-and-is-it-any-good}

```sql
select finished_at, kind, status, object_key,
       pg_size_pretty(size_bytes) as tamanho, error_message
  from backup_runs
 order by finished_at desc
 limit 10;
```

这段输出中有三件事比最后一行更重要：

- **最近的 `status = 'failed'` 加上一个较旧的成功**是危险的情况：备份存在，只是旧了。告警 *Last backup run failed* 恰好覆盖这种情况。
- 两次执行之间 **`size_bytes` 的急剧下降**暗示 dump 被截断，而单凭大小并不能揭示这一点——是脚本中的
  `pg_restore --list` 发现它。
- **没有任何行**意味着 CronJob 从未成功运行过。那问题就不在恢复。

### 自动化路径（与测试运行的相同） {#restore-automatizado}

在 Kubernetes 中：

```bash
make test-restore
```

在 compose 安装中——没有集群，没有 `kubectl`：

```bash
make test-restore-compose
```

两者都会触发一次**真实**的备份（与生产中运行的相同镜像、相同命令——而不是临时拼凑的 `pg_dump`，那会测试一条没人用的路径），恢复到 `brabo_restore_test`，校验，然后删除该数据库。当目标是**验证**备份而不是恢复数据时，使用它们。

两个封装故意分开：合并它们会让 compose 路径依赖 `kubectl`，而它存在的意义正是不依赖它。*没有*重复的是判断——两者运行同一个 `brabo-restore`，带有同样的三项校验。compose 的版本增加了集群无法要求的第三步：它会验证 bare 仓库的归档，因为在 Kubernetes 中 `git_local_repos` 卷没有挂载到备份 pod，该步骤被合理地跳过，而在 compose 中它是挂载的，跳过就会是虚假的绿色。

两者每周都在
[`propriedades.yml`](#provas-de-propriedade-agendadas) 中得到证明：集群作业中的 `make test-restore`（以及它有意的破坏版本 `make test-restore-mutacao`），以及在另一个 runner 上的第二个作业 `restore-compose` 中的 `make test-restore-compose`——带有只有 compose 路径才做的 bare 仓库验证（AT-195）。安装程序的迁移也会运行 compose 的版本。

### 在事件中真正执行恢复 {#restore-de-verdade}

`brabo-restore` 脚本恢复到一个**新**数据库，从不触碰源数据库——这是有意的。在活动数据库之上恢复是不可逆的，在事件的最初几分钟里几乎总是错误的决定。

**1. 启动一个指向你想要的数据库名的恢复 Job：**

```bash
kubectl -n brabo create job restore-manual --from=cronjob/brabo-backup \
  --dry-run=client -o yaml \
| sed -e 's|\["brabo-backup"\]|["brabo-restore"]|' \
| kubectl -n brabo apply -f -

kubectl -n brabo set env job/restore-manual RESTORE_DB=brabo_recuperado
kubectl -n brabo logs -f job/restore-manual
```

要从每周副本而不是最新的每日副本恢复：
`RESTORE_PREFIX=weekly/`。

**2. 检查恢复回来的内容**——与脚本提出的问题相同，现在用你自己的眼睛：

```sql
-- quantas tabelas voltaram (compare com a origem, não com um número
-- fixo: toda migration nova muda esta contagem)
select count(*) from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE';

-- o event log é denso por sessão: esta consulta tem de voltar VAZIA
select session_id, count(*), min(seq), max(seq)
  from session_events
 group by session_id
having count(*) <> max(seq) - min(seq) + 1 or min(seq) <> 1;
```

**3. 提升恢复出的数据库**：把 `DATABASE_URL` 指向它，并重启 api 和 engine。这是最后一步，也是唯一具有破坏性的一步：

```bash
kubectl -n brabo patch secret brabo-secrets --type merge \
  -p "{\"data\":{\"DATABASE_URL\":\"$(printf '%s' "$NOVA_URL" | base64 -w0)\"}}"
kubectl -n brabo rollout restart deployment/api deployment/engine
```

> Secret 由 External Secrets 从提供方生成。直接的
> `patch` 会在下一个 `refreshInterval`（1h）时被覆盖：
> **同时**修改提供方中的值，否则系统会在一小时内悄悄地回到旧数据库——正在恢复的过程中。

验证：第 1 和第 2 步就是 `make test-restore` 每周运行的 `brabo-restore`，第 2 步的两个查询正是
`docker/backup/restore.sh` 自己执行的。第 3 步——修补 `DATABASE_URL` 并让 api 和 engine 针对恢复出的数据库重启——**从未被演练过**：该证明结束时会删除 `brabo_restore_test`，从不让运行中的 api 指向它。

### 恢复**不**覆盖什么 {#what-the-restore-does-not-cover}

- **如果 `CREDENTIALS_MASTER_KEY` 不同，用户凭据将无法读取。** dump 携带的是被包装的 DEK，而不是密钥。在使用另一把主密钥的环境中恢复，会得到一个完好的数据库，但其中的 LLM 和 git 凭据毫无用处。参见
  [主密钥轮换](#rotacao-da-chave-mestra)。
- **用户的任何数据都不会遗漏。** 自从移除 Keycloak
  （[ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)）以来，不再有单独的 IdP 数据库：身份、argon2id 凭据、refresh token 和 auth 的 event log 全都位于同一个 Postgres 中，并包含在这个 dump 里。**无法**保留的是在
  `AUTH_TOKEN_PEPPER` 不同的情况下读取它们——与上面主密钥的道理相同。
- **`brabo-restore` 恢复数据库，也只恢复数据库。** bare 仓库由同类命令 `brabo-restore-git` 负责——参见
  [恢复 bare 仓库](#restore-dos-bare-repos)。它们是独立的命令，而不是同一个命令的两个阶段，因为它们是两个产物、两种判断：git 的失败不能让 event log 的校验失败，反过来会更糟。
- **agent 的 worktree**（`project_workspaces`）不复制，也不需要复制：`WorktreeManager` 会从 bare 仓库重建它们。丢失的是未提交的进行中工作。
- ~~真正的仓库位于 GitHub/GitLab~~——**这句话曾经写在这里，而它是错的**，这就是该卷多年没有备份的原因。它对 `github`/`gitlab` provider 的项目成立；对于 `local` provider 的项目，任何地方都没有上游，`git_local_repos` 中的 bare 仓库**就是** agent 产出的代码。
- **这不是 PITR。** 粒度是最近一次 dump；此后写入的任何东西都会丢失。如果这不可接受，路径是在 CloudNativePG 中归档 WAL，这超出了本阶段的范围。

### 恢复 bare 仓库 {#restore-dos-bare-repos}

验证不花任何代价，也不写任何东西——这是每周的动作，自 AT-195 起由 `propriedades.yml` 的定时作业 `restore-compose` 执行
（通过 `make test-restore-compose`，参见
[自动化路径](#restore-automatizado)）：

```bash
docker compose -f docker/docker-compose.prod.yml run --rm backup brabo-restore-git
```

恢复是每次事件一次的动作，必须亲手输入：

```bash
docker compose -f docker/docker-compose.prod.yml \
  run --rm --user 0:0 backup brabo-restore-git --restaurar
```

关于这个命令的两点，都是测出来的而不是假设的：

- **这里的 `--user 0:0` 不是可选的。** `git_local_repos` 由三个以三种不同 uid 运行的镜像共享（api 为 `node`，engine 为
  `engine`，备份镜像为 uid 70）。卷的所有者是最先挂载它的那一方，模式 0755：uid 70 能读却不能写。没有 root 时，命令会在提取**之前**拒绝，并点名这项修复——它不会在 `tar` 中途才发现问题、留下写了一半的卷。
- **提取出的内容会交还给目录的所有者**，从不保留为 root。否则卷会完好无损地回来却毫无用处：非 root 的 api 和 engine 无法写入刚刚恢复的内容，而症状会在恢复很久之后才出现，没有任何线索指向它。

它**拒绝在已有仓库之上提取**。叠加两种仓库状态会产生一种任何 `git` 都不会抱怨、谁也不会注意到的混合，直到某次 `fetch` 带回错误的历史。清空卷，或者如果叠加确实是你想要的，传入 `RESTORE_GIT_FORCE=1`。

验证：两个动作背后的 shell 函数在每个 PR 中由
`scripts/ci/backup-lib.spec.ts` 证明——归档与恢复往返一致、不复制任何 `*.lock`、截断的归档在读取时被拒绝、无法写入的目标在 `tar` 之前被拒绝。命令本身——在备份镜像中针对真实卷——通过 `make test-restore-compose`（验证的那一半，从不执行 `--restaurar`）每周在 `propriedades.yml` 中运行。该作业先在卷中创建一个 bare 仓库（`git init --bare`，与
`LocalGitProvider` 的做法相同），如果结论中没有点名它就判定失败：卷为空时，`brabo-restore-git` 会回答“没有可恢复的内容”并以 0 退出，那将是一个没有读取任何归档的绿色。

### 图谱丢失（Neo4j） {#perda-do-grafo}

`neo4j_data` **不在**任何备份中，这是决定，而不是疏忽（[ADR 0152](adr/0152-backup-de-volumes-contra-compose.md)，决策
4）。把一个可能过时的投影与在另一个时刻恢复的 Postgres 一起恢复，会得到两个来自不同时刻的派生状态，没有任何东西去调和它们。对派生记忆的正确答案是从源头重新投影——这个命令是存在的（[RN-569](business-rules/api.md#rn-569)）：

```bash
# Kubernetes (o script vem dentro da imagem da api)
kubectl -n brabo exec deploy/api -- node scripts/reprojetar-grafo.js
kubectl -n brabo exec deploy/api -- node scripts/reprojetar-grafo.js --project <project-uuid>

# compose de instalação (mesma imagem do Kubernetes)
docker compose -f docker/docker-compose.install.yml exec api node scripts/reprojetar-grafo.js

# um checkout de dev (DATABASE_URL e NEO4J_* apontando para o banco e o grafo)
pnpm --filter api grafo:reprojetar
pnpm --filter api grafo:reprojetar -- --project <project-uuid>
```

预期输出：

```
[reprojetar] escopo: event log inteiro
[reprojetar] eventos: 4 projetados, cursor 01M2DTREY0TBKHCHG9NWXYF0A4
[reprojetar] sessões fechadas: 2 projetadas

[reprojetar] resultado

  eventos projetados=4  sessões fechadas projetadas=2  falhas=0
  grafo agora (inteiro): nós=80  arestas=80
```

它做什么，保证什么：

- **与在线投影器相同的转换。** 事件 → 节点/边的逻辑只在一个类中（`GraphEventTranslator`），在线投影器和本命令都调用它。它从 `session_events` 读取 `handoff.offered`、`psychologist.hypothesis_proposed`
  和 `anamnese.profile_updated`，并从 `sessions` 读取每个处于 `closed`/`closed_abnormally` 的会话的 `Interacao`（关闭会话不会在日志中留下事件）。
- **幂等，并且从不删除。** 每次写入都是对自然键的 `MERGE`：运行两次得到同样的图谱，**再次运行就是你重试的方式**——在中途失败之后。它只会添加或收敛；已在图谱中的节点会保留。
- **按批次、按游标。** `session_events` 按 `id`（ULID，主键）的顺序遍历，每次 200 行——绝不把整张表放进内存。进度行会打印游标；`--after-event <id>` 会在它之后继续事件阶段。从头开始同样安全，只是更慢。
- **它不触碰 outbox，所以 api 可以保持运行。** 在线投影器把进度保存在 `outbox_events.processed_at`
  （`aggregate_type = 'graph_projection'`）；本命令既不读也不写这张表，因此无法抢占、重新打开或标记某一行。两者都以
  `MERGE` 写入相同的键。
- **它以具名方式失败，绝不静默地表现为成功。** Neo4j 未配置或不可访问会在读取日志*之前*被拒绝（否则一个空范围会以零投影“成功”）；Neo4j 在中途宕机会停在最后完成的事件；未知的 `--project` 会在不写入任何东西的情况下被拒绝；payload 不一致的条目会被计数、点名，执行最终以 `1` 退出。

它**不**重建的东西，以及唯一的顺序注意事项：

- **`PromptTemplate`/`PromptVersion`** 不来自 event log。它们的来源是 `prompts/` 目录：用
  `node scripts/dev/seed-prompts.ts` 重新发送（按哈希幂等）。
- **`PerfilAnamnese` 是一个以用户 + 维度为键、不含项目的快照。** 最后写入者胜出。带 `--project` 的执行只重放该项目的画像事件，所以当另一个项目写入了更新的值时，它可能让快照停在该项目的最后值。完整执行（不带 `--project`）按顺序遍历整个日志并恢复全局最后值——在丢失图谱后使用它；把
  `--project` 留给定点修复。
- **完整执行需要一个维护窗口，且没有时间上限**，在大日志上要花多久尚未测量——关于窗口、进度行以及如何知道还剩多少，参见
  [运行完整的重新投影](#reprojecao-em-janela)。

证明是 `make test-reprojecao`
（`apps/api/test/scripts/reprojetar-grafo.spec.ts`）：它用在线投影器构建一个场景，**删除**该子图，重新投影，比较节点和边的数量以及键列表，然后再次重新投影。它需要运行中的 Neo4j，没有时会跳过——api 的 CI 作业没有 Neo4j，所以在那里它会跳过。它故意不依赖曾经有过备份。

同样的证明也在**本地集群内部**运行：`make test-reprojecao-k8s`
（`deploy/k8s/test-reprojecao.sh`）是定时
`propriedades.yml` 的第四个目标（参见[定时的属性证明](#provas-de-propriedade-agendadas)）。它完全按照本节在事件中要求的方式运行该命令
（`kubectl exec deploy/api -- node scripts/reprojetar-grafo.js --project <id>`），针对集群的 Postgres 和 Neo4j，在它自己创建的项目上。自 AT-191 起，它的场景演练了 `GraphEventTranslator` 的**全部四条转换路径**——一个 `handoff.offered`、一个引用某条消息作为证据的
`psychologist.hypothesis_proposed`、一个针对自身用户的
`anamnese.profile_updated`，以及已关闭会话的 `Interacao`——并在清理之前、重建之后和第二次执行之后都要求 **9 个节点和 6 条边**（在执行 `36498776825` 中测得）。Psicólogo 和 Anamnese 仍处于暂停状态：证明会添加它们本应写入的事件，并检查重新投影从中重建了什么。

在你运行它之前，空图谱会产生一个具名的影响：依赖图谱的读取会降级。RAG **不**受影响——它位于 pgvector 中，而 pgvector 在 dump 之内。

#### 运行完整的重新投影：一个维护窗口，没有时间上限 {#reprojecao-em-janela}

完整的重新投影（图谱的或[产物目录](#perda-da-pasta-de-artefatos)的）是一项罕见的**恢复**操作，在**没有时间上限的维护窗口**中运行——这是维护者的决定（2026-09-27）。产品中没有任何东西会按时间截断它、在它耗时过长时发出警告或调度它：event log 需要多久它就运行多久，你据此规划窗口。

在生产规模的日志上这需要多久**尚未测量**。迄今为止唯一的真实执行是开发 compose（`session_events` 中 98 个事件，端到端 2.5 s）；基于它的按比例外推不是测量，所以请为你的安装的第一次完整执行计时，并为下一个窗口保存这个数字。

**跟踪进度。** 命令在最终结果之前每批打印一行——每 200 个它读取的类型的事件——所以仍在打印的执行仍在遍历日志：

```
[reprojetar] eventos: 200 projetados, cursor 01M2DTREY0TBKHCHG9NWXYF0A4
[reprojetar] eventos: 400 projetados, cursor 01M2DV3K8Q2S7ZB1CXN4W6Y9HR
...
[reprojetar] sessões fechadas: 200 projetadas
[reprojetar-artefatos] artefatos: 200 projetados, cursor 01M2DTREY0TBKHCHG9NWXYF0A4
```

数字是已**投影**的数量（失败的条目会在各自的行中打印，并在最后计入 `falhas=`）。这一行不带总数。要知道还剩多少，用最后一行的游标询问 Postgres——只读，所以在执行继续时也是安全的：

```sql
-- grafo, fase de eventos: quantos no total, e quantos ainda depois do cursor
SELECT count(*) AS total,
       count(*) FILTER (WHERE id > '<cursor>') AS remaining
  FROM session_events
 WHERE type IN ('handoff.offered', 'psychologist.hypothesis_proposed',
                'anamnese.profile_updated');

-- grafo, segunda fase (a Interacao de cada sessão fechada)
SELECT count(*) FROM sessions WHERE status IN ('closed', 'closed_abnormally');

-- pasta de artefatos
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

-- quando o evento do cursor foi escrito (os ids são ULIDs, ordenados por tempo)
SELECT created_at FROM session_events WHERE id = '<cursor>';
```

当执行带有 `--project` 时，在计数中加上 `AND session_id IN (SELECT id FROM sessions WHERE project_id = '<project-uuid>')`。类型列表就是命令读取的那些（`apps/api/src/application/graph-projection/graph-event-translator.ts` 中的 `EVENTOS_DO_LOG_PROJETAVEIS`，
`apps/api/src/domain/artifacts/artifact-projection-events.ts` 中的 `ARTIFACT_PROJECTABLE_EVENT_TYPES`）；如果其中任何一个文件新增了类型，这里的计数就会少算它。

**这项决定没有增加的东西。** 没有上限，没有警告，也没有由产品分窗口或调度的重新投影。`--project` 和
`--after-event` 仍然完全是它们原来的样子——定点修复和中断后的继续——而**不是**把完整恢复塞进更短窗口的方法：带 `--project` 的执行无法恢复全局的
`PerfilAnamnese` 快照（见上文），而在某个版本化产物类型的中途继续，可能留下较旧的版本（[见下文](#perda-da-pasta-de-artefatos)）。完整执行就是恢复。中断它是安全的——上述幂等性成立——从头再运行一次总是正确的，只是更慢。

### 产物目录（`docs/`）丢失 {#perda-da-pasta-de-artefatos}

agent 发出的每个产物都**只存在于 event log 中**；项目的 `docs/` 目录是它的一个**投影**（[ADR 0148](adr/0148-artefatos-projetados-em-arquivo.md)），因此它不在任何备份中，这是决定，而不是疏忽
（[ADR 0152](adr/0152-backup-de-volumes-contra-compose.md) 对图谱也是同样的推理）。恢复数据库**不会**自行把它带回来：驱动在线投影器的 outbox 行已被标记为已处理，所以没有任何东西会重写这个目录。重写它的命令是存在的
（[RN-590](business-rules/api.md#rn-590)）：

```bash
# Kubernetes (o script vem dentro da imagem da api)
kubectl -n brabo exec deploy/api -- node scripts/reprojetar-artefatos.js
kubectl -n brabo exec deploy/api -- node scripts/reprojetar-artefatos.js --project <project-uuid>

# compose de instalação (mesma imagem do Kubernetes)
docker compose -f docker/docker-compose.install.yml exec api node scripts/reprojetar-artefatos.js

# um checkout de dev (DATABASE_URL apontando para o banco)
pnpm --filter api artefatos:reprojetar
pnpm --filter api artefatos:reprojetar -- --project <project-uuid>
```

预期输出：

```
[reprojetar-artefatos] escopo: event log inteiro
[reprojetar-artefatos] artefatos: 6 projetados, cursor 01M2DTREY0TBKHCHG9NWXYF0A4

[reprojetar-artefatos] resultado

  artefatos projetados=6  falhas=0
```

它做什么，保证什么：

- **与在线投影器相同的转换。** 事件 → 目录、文件名和 Markdown 的逻辑只在一个类中（`ArtifactEventTranslator`），在线投影器和本命令都调用它。
- **幂等，并且从不删除。** 文件名是事件的函数（版本化类型：`<tipo>.md`；仅追加类型：带 `seq`），所以运行两次会用相同内容重写相同的文件，**再次运行就是你重试的方式**。你在 `docs/` 中创建的文件会保留。
- **按批次、按游标。** `session_events` 按 `id` 顺序遍历，每次 200 行；`--after-event <id>` 会在打印出的游标之后继续。
- **它不触碰 outbox**，所以 api 可以保持运行。
- **它以具名方式失败，绝不静默地表现为成功。** 失败的写入（磁盘满、目录不可访问、某个项目的目录消失了）会按事件计数并点名，不会中断其余部分，执行最终以 `1` 退出。未知的 `--project` 会在不写入任何东西的情况下被拒绝。

它写到哪里，以及**不**覆盖什么：

- **它需要看到与 api 相同的磁盘。** 目录由投影器使用的同一个函数解析（`container`/`runner`：
  `<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>/docs/`；`mounted`：在项目目录之内）。在 api 的镜像中、使用 api 的卷运行它。
- **它写到项目的*当前*位置。** 模式转换不会移动 `docs/`（转换的代码从不触碰它），所以转换之前写入的文件留在旧位置；重新投影会在当前位置重新创建它们。
- **版本化类型显示最后一个事件，所以不要在它们中途继续。** `module_map`、`module_routing`、`project_image` 和 `c4_diagram`
  会覆盖同一个文件；完整执行以最后发出的版本结束，而从两个版本之间开始的
  `--after-event` 可能留下较旧的版本。
- **它不读取的内容：**可投影列表之外的类型（`qa_verdict`、
  `secops_verdict`、`task_blocked`、`infra_delegation_files`）从来不是文件，不会被重新创建。
- **它在维护窗口中运行，没有时间上限**，与图谱相同：进度行和跟踪它的查询在
  [运行完整的重新投影](#reprojecao-em-janela)中。在大的 event log 上它要花多久尚未测量；该命令可以安全地中断并重新运行。

证明是 `apps/api/test/scripts/reprojetar-artefatos.spec.ts`：它在真实的 Postgres 和真实的磁盘上用在线投影器构建一个场景，**删除**目录，重新投影，比较每个路径和内容，然后再次重新投影。它在每个 PR 中运行。按照本节在事件中要求的方式运行命令——在 api 的**镜像**中运行 `node scripts/reprojetar-artefatos.js`——由 `make test-reprojecao-artefatos-k8s`（`deploy/k8s/test-reprojecao-artefatos.sh`，
AT-198）证明，它是图谱集群目标的同类：它通过 API 创建一个自己的项目和一个 `artifact.note`，等待在线投影器写入它，在 **api 的 pod 内部**删除该 agent 的 `docs/<agente>/` 目录，以 `--project` 运行镜像自带的脚本，并要求重建的文件与在线投影器写入的文件具有**相同的 sha256**——然后再运行一次并要求相同的哈希（幂等性）。它在定时的
`.github/workflows/propriedades.yml` 中运行，并且与其同类一样不依赖任何其他目标。

### 恢复失败时 {#when-the-restore-fails}

| 症状 | 可能原因 |
|---|---|
| `no backup under .../daily/` | bucket 错误、凭据错误，或 CronJob 从未运行 |
| `not an intact custom dump` | 上传中断；使用上一个对象或 `weekly/` |
| `pg_restore failed` 并带有扩展错误 | 目标数据库需要相同的扩展（`pgvector`）；在 CNPG 中它们来自集群，而不是 dump |
| `missing tables in the restored copy` | 来自另一个 schema 版本的 dump——脚本会说出缺少**哪些**；对照最新的 migration 检查对象的日期 |
| 关键表上的 `out of window` | 计数与 dump 的时间戳不符：在提升之前先调查 |
| `server version mismatch` | Job 的 `pg_dump` 是 16；另一个大版本的集群会拒绝连接 |
| Job 超时 | 数据库对 `activeDeadlineSeconds` 来说太大；在 Job 中调高该值，而不是在 CronJob 中 |
| `destination inaccessible … does not accept writes` | 使用 `BACKUP_DIR` 时，目录存在，但容器的 uid 无法写入。这是故意做成**写入**检查而不是存在检查：只读的目标会通过 `ls` 却让 dump 失败，错误会在 `pg_dump` 之后出现并指向错误的地方 |
| `tar of the bare repos exited with N` | 读取过程中仓库底下发生了变化——最可能是并发的 `git gc`。本次执行被标记为 `failed`，而不是交付一个部分归档。重新运行 |
| `there are N bare repo(s) … and NO archive` | 这个卷没有覆盖：仓库存在而归档缺失。缺失且为空是正常的，会以另一种方式报告 |
| `--restaurar` 时出现 `does not accept writes by this user (uid 70)` | 共享卷所有者的情况——用 `--user 0:0` 恢复，参见[恢复 bare 仓库](#restore-dos-bare-repos) |

### 定时的属性证明 {#provas-de-propriedade-agendadas}

`make test-restore`、`make rollout-test` 和 `make hpa-test` 证明的是**属性**，而不是配置——一个每晚运行却无法恢复的备份，会通过 `brabo-alerts.yaml` 中的全部五个告警。在 BRB-009 之前，它们只有在有人手动输入时才运行。`.github/workflows/propriedades.yml` 现在按计划运行它们，在 GitHub 托管的 runner 上的 k3d 集群中：

1. 通过固定的 checksum 安装 `k3d`、`helm` 和 `kubectl`；
2. 运行 `deploy/k8s/bootstrap.sh`——与 `make deploy-local` 运行的 bootstrap 相同，从 checkout 的目录树构建四个生产镜像（没有 registry，没有机密）——并带上 `BRABO_SKIP_OBSERVABILITY=1`（AT-177）：没有任何证明读取 Tempo、Loki、Collector、Alloy 或 Grafana，这是与 `make deploy-local` 给你的集群唯一的区别；
3. 运行 `make smoke-k8s`，然后按 `Makefile` 的顺序运行 `make hpa-test`、`make rollout-test` 和
   `make test-restore`，即使前一个失败也会运行每一个（坏掉的 HPA 不能掩盖坏掉的恢复）；
4. 运行 `make test-restore-mutacao`（AT-126，BRB-009），这是**对证明本身**的证明：它做一次真实备份，然后在源库中创建一张 dump 中没有的表（`zz_mutacao_restore`）——恰好是“缺一张表的 dump”——并运行同一个 `brabo-restore`。只有当恢复**拒绝**它并点名那张表时（日志行 `faltando: zz_mutacao_restore`）它才通过；如果恢复通过了，或者因为别的原因拒绝，该步骤失败并开启自己的 issue。绿色的 `make test-restore` 说明备份可以恢复；这一项说明证明仍然能发现不能恢复的情况。退出时该表会被删除，即使失败也是如此。即使 `make test-restore` 失败它也会运行（一个失明的证明和一个坏掉的恢复是两个缺陷，两者都必须暴露）；
5. 运行 `make test-reprojecao-k8s`（AT-127，BRB-018）：图谱没有备份
   （[ADR 0152](adr/0152-backup-de-volumes-contra-compose.md)），因为它从 event log 重新投影，所以 workflow 也证明这一点——它创建一个自己的项目，带有一个已关闭的会话和四个事件（一条消息、一个 handoff、一个 Psicólogo 的假设和一个 Anamnese 的画像——转换器的每条路径，AT-191），重新投影，**在 Neo4j 中删除该子图**，再重新投影，并要求相同的节点和边数量（9|6），然后再重新投影一次。它不使用其他目标留下的状态，也**不**与 `test-restore` 耦合（图谱不依赖备份）；
6. 运行 `make test-reprojecao-artefatos-k8s`（AT-198，RN-590），对另一个派生投影——产物的 `docs/` 目录——做同样的证明。它创建一个自己的项目和一个 `artifact.note`，等待在线投影器写出文件，**在 api 的 pod 内部删除该 agent 的目录**，运行镜像中的 `node scripts/reprojetar-artefatos.js --project`，并要求**相同的 sha256**；然后再次重新投影并再次要求。它不依赖任何其他目标；
7. **最后**运行 `make test-rotacao-chave-mestra-k8s`（AT-146）：[主密钥轮换](#rotacao-da-chave-mestra)的三个步骤——两把密钥发布到源 Secret `brabo`、强制 `ExternalSecret` 同步、重启 api、运行镜像中的 `rewrap-deks.js`、删除旧密钥并再次重启 api——每一步都检查所有 envelope 能否打开，并在最后让一个凭据解密为相同的值。它会更换集群的主密钥并重启 api，这就是为什么它之后什么都不运行；
8. 只有当恢复**和**有意的破坏在同一次执行中**都**通过时，才写入 `ultima-execucao-boa.json`（日期、执行、提交、恢复耗时），将其作为产物 `restore-ultima-execucao-boa` 上传（保存 90 天），并把 *Última execução boa do restore* 一行加入执行摘要；
9. 把每一步的耗时写入执行摘要。

**第二个作业** `restore-compose`（AT-195）在另一个 runner 上与它并行运行——生产 compose 发布 3000/4000/8088，与 k3d 集群映射的端口相同，所以两者不能共用一个。它用
`docker-bake.hcl` 构建四个镜像（与 `ci.yml` 的做法相同），通过
`docker/smoke.sh` 启动生产 compose（它会把种子用户和会话留在数据库中），在 `git_local_repos` 中创建一个 bare 仓库作为 fixture，然后运行
`make test-restore-compose`：一次真实备份、带有三项校验的恢复，以及 bare 仓库归档的验证。没有点名已验证 bare 仓库那一行的绿色会让该步骤失败。它的失败同样会开启 issue，带有自己的标题。在执行 `36371633435` 中测得：镜像构建 190 s，compose 启动（smoke）43 s，
`make test-restore-compose` 4 s——作业共 4 min 31 s，与集群作业的 11 min 并行，所以 workflow 的总时长不变。

| 触发器 | 何时 |
|---|---|
| `schedule` | 每周，周日 04:00 UTC |
| `workflow_dispatch` | 按需，通过 Actions 标签页（`gh workflow run propriedades.yml`） |

**失败会开启一个 issue**，标题为 `Prova de propriedade falhou: <alvo>`，每个目标一个，同一目标的重复失败会**在已开启的 issue 中评论**，而不是再开一个。bootstrap 有自己的标题：集群宕机时，三个目标都会是 `skipped`，而一次被跳过的定时执行，正是这个机制要打破的沉默。**目标通过的第一次执行会关闭它的 issue**，并附上点名那次执行的评论（AT-212）——没有人需要记得。只有在**默认分支**上的执行（计划任务，或其上的 `workflow_dispatch`）才会操作 issue：在某个分支上失败的 `workflow_dispatch` 只会让自身执行失败、记录一个警告，既不开启也不评论计划任务的 issue，而分支上的绿色执行不会关闭任何东西。执行**按 ref** 排队（`concurrency: propriedades-<ref>`）：不同分支上的两次 dispatch 并行运行，同一 ref 上的两次互相等待。它**不是** gate，也不是必需检查——没有任何东西等待它。

在构建该 workflow 的执行中测得（`ubuntu-latest` 上 4 vCPU、15 GiB 内存、87 GB 可用磁盘）：

| 步骤 | 耗时 |
|---|---|
| bootstrap（镜像构建 + 集群 + operator + 应用） | 705 s |
| `make smoke-k8s` | 1 s |
| `make hpa-test` | 19 s |
| `make rollout-test` | 24 s |
| `make test-restore` | 21 s |
| `make test-restore-mutacao` | 31 s（执行 `35473548113`） |
| `make test-reprojecao-k8s` | 16 s（执行 `35471428634`）；四事件场景 18 s（执行 `36498776825`） |
| `make test-reprojecao-artefatos-k8s` | 4 s（执行 `36498695123`，整个作业 10 min 28 s） |
| `make test-rotacao-chave-mestra-k8s` | 47 s（执行 `36502355798`，整个作业 12 min 10 s） |
| 整个作业 | 12 min 56 s |

（第一次完整绿色执行：`34784563928`，2026-09-13。）

使用 `BRABO_SKIP_OBSERVABILITY=1` 并让 operator 并行安装后（AT-177），helm 阶段从 253 s（执行 `36362479629`，在 `dev` 上）降到 89–90 s，bootstrap 从 710 s 降到 547–555 s，整个作业从 13 min 43 s 降到 10 min 59 s（执行 `36367504128` 和 `36368334920`）。镜像构建（141–161 s）和 `seed-smoke` 的等待（仍是 180 s）不因此改变。

**镜像构建故意仍是简单的 `docker build`**（AT-178，经测量后否决）。曾在一个分支上尝试用 `docker-bake.hcl` 以 `ci.yml` 已在使用的 `type=gha` 缓存构建四个镜像——并行、加载到守护进程中，然后 bootstrap 以 `BRABO_SKIP_BUILD=1` 运行——两次都是绿色：

| | 镜像构建 | 整个作业 |
|---|---|---|
| bootstrap 中的 `docker build`（执行 `36367504128`、`36368334920`） | 161 s、145 s | 10 min 59 s |
| bake，该 ref 上的第一次执行（`36369702417`） | 177 s（含 buildx 设置） | 11 min 44 s |
| bake，热缓存（`36370592556`） | 116 s（含 buildx 设置） | 11 min 32 s |

热缓存时，该步骤节省 30–45 s；冷缓存时，多花 15–30 s；在作业层面，差异处于执行之间的噪声范围内。重要的执行是 `main` 上每周一次的那次，而 Actions 缓存会逐出 7 天内无人读取的条目——每周一次的节奏恰恰是缓存最常处于冷状态的情况。bakefile 中的
`no-cache-filter = ["runtime"]`（AT-110）无论如何也会重建每个最终阶段，这正是热缓存收益很小的原因。只有在有测量显示定时执行中缓存是热的时候才重新考虑。

节奏遵循这个成本。几乎全部成本都是 bootstrap，每晚执行一次就要每周付出七次，去检验那些代码变化远比这少的属性；每周一次让告警保持在一个冲刺之内，而 `workflow_dispatch` 覆盖“我刚改了备份”的情况。作业超时为 90 分钟，单是恢复步骤就有 20 分钟的上限——关于上限为什么属于步骤而不属于脚本，参见该步骤中的注释。

**最初几次执行发现的问题**，每一个都对 `kubeconform` 和每个 PR 检查不可见，并且每一个都在创建该 workflow 的同一次改动中修复——`make deploy-local` 在 `dev` 上已经坏了好几周而没有人运行它：

1. 只用 digest 固定的 CNPG 集群 `imageName`
   （[ADR 0159](adr/0159-imagem-de-terceiro-por-digest.md)）会被 operator 的 webhook 拒绝——*"Can't use just the image sha as we can't detect
   upgrades"*。现在它带有 `:16.10@sha256:…`。
2. bootstrap 的源 Secret 中没有 `NEO4J_PASSWORD`，而 base 的 `ExternalSecret` 自图谱以来就读取它（[ADR 0099](adr/0099-neo4j-grafo-de-conhecimento-e-templates.md)）：
   `brabo-secrets` 始终无法生成，每个 pod 都停在
   `CreateContainerConfigError`。
3. 集群中的 api 既收不到 `NEO4J_URI` 也收不到 `NEO4J_USER`，而在生产模式下，缺少这三个变量它会拒绝启动。
4. Neo4j 的 StatefulSet 导出了 `NEO4J_USER`/`NEO4J_PASSWORD`，镜像的 entrypoint 会把它们转换为配置键并拒绝（*"Unrecognized
   setting"*）——正是两行之下的一条注释所警告的那个缺陷。这些清单从未在集群中运行过。
5. `migrate-api` 无法执行 `CREATE EXTENSION vector`（应用的角色不是超级用户），于是 api 启动时没有表。本地 CNPG 集群现在以超级用户身份在应用的数据库和 `template1` 中创建它。
6. `deploy/k8s/smoke.sh` 和 `rollout-test.sh` 从不发送会话的 `kind`，而它在第 20 阶段变为必填（`docker/smoke.sh` 当时就加上了），所以两者在证明任何东西之前就以 400 失败。
7. `make test-restore` 在 `pg_restore` 中以 *"permission denied to create
   extension vector"* 失败——上表已经点名的情况——因为本地集群中没有任何东西为恢复创建的数据库提供该扩展。
8. 提供扩展之后，`pg_restore` 仍然失败——这次是在 dump 的 `COMMENT ON EXTENSION` 处报 *"must be
   owner of extension vector"*：只有扩展的所有者才能为它添加注释，而在应用角色不是超级用户的地方（CNPG、任何托管的 Postgres），扩展属于另一个角色。**这不是集群本地的问题**：同一个 `brabo-restore` 就是事件处理流程，所以在这类 Postgres 上的真实恢复也会以同样方式失败。`restore.sh` 现在从 dump 的索引中去掉扩展注释后再恢复——那是扩展安装的一段描述字符串，没有任何数据或校验依赖它。改动前后都在一个使用非超级用户角色的简单 `pgvector` 容器上复现过。
9. `deploy/k8s/test-restore.sh` 用 `kubectl wait
   --for=condition=complete` 等待，而它永远看不到一个**失败**的 Job，所以上面那个坏掉的恢复会耗尽该步骤 20 分钟的全部上限，才报告 Job 日志在几秒内就说明了的事（脚本自己的上限是 30）。现在它同时查询两个条件，一旦 Job 变为 `Failed` 就立即失败。
10. `rollout-test.sh` 在固定的 `sleep 15` 之后查找孤儿，而这无法区分*仍在稳定中*与*彻底成为孤儿*。现在它会一直查询到上限（`ROLLOUT_CONVERGENCE_SECONDS`，默认 120），并在滚动发布之前记录每个会话所在的副本——旧 pod 会把它们的日志带走。

**已测量，可能的原因此后已修复**（AT-078，
[RN-588](business-rules/engine.md#rn-588)）——旧 pod 的 `Monitor` 删除了对等节点刚刚重写的
`session_states` 行；关于新的孤儿会记录什么，参见
[证明没有留下孤儿](#rollout-do-engine)。以下是修复之前的记录。**滚动发布证明在到达它的四次执行中失败过一次**（截至执行 `35448353884`，2026-09-19，十次中有两次；在那次执行中五个会话都位于同一个旧 pod 上，四个被接管，一个最终既没有所有者也没有被 drain；唯一点名它的日志随那个 pod 一起消失了——这就是为什么证明现在会保存它们，参见
[证明没有留下孤儿](#rollout-do-engine)）。在相同的脚本和相同的固定等待下，执行
`34773908653` 通过了，而执行 `34775712706` 报告了一个孤儿——在 `rollout status` 返回 15 s 后，一个在 api 中为 `active` 的会话在 engine 的三个副本中都没有所有者。两次使用有限等待的执行都通过了，并且都在 **3 s** 内收敛，五个会话全部被接管。3 s 的正常收敛使“孤儿只是需要超过 15 s”成为最不可能的解读；更可能的是接管或 drain 中的间歇性竞争，被固定等待碰巧捕获了。它被故意保持原样：workflow 的存在正是为了捕获这种情况，下一次发生时，它将带着等待的上限、每个会话在滚动发布之前所在的位置以及点名该孤儿的 engine 日志行而失败。修复属于 engine，而不属于这项证明。

### 最后一次已验证的执行 {#last-verified-run}

> **定时 workflow 现在是这一信息的来源，日期不再手工编辑**（AT-126）。带有
> `restore-ultima-execucao-boa` 产物的最近一次
> [`propriedades.yml`](#provas-de-propriedade-agendadas) 执行，就是恢复最后一次在 Kubernetes 上通过、**并且**在同一次执行中捕获到对它的有意破坏的时间：
> `gh run list --workflow propriedades.yml --status success --limit 1`，然后
> `gh run download <run> -n restore-ultima-execucao-boa`（保存 90 天）。它是 workflow 产物，而不是指标：在备份告警旁边放一个 Prometheus gauge 需要修改 `apps/api` 中的代码，而这次改动没有触碰它（BRB-009 在这一半上仍然开放）。下面的记录保持原样：它是第一次验证及其发现的历史。

<!-- Atualize esta seção sempre que rodar o teste num ambiente novo. -->

| 字段 | 值 |
|---|---|
| 日期 | 2026-07-27 |
| 环境 | 本地 k3d 集群，PostgreSQL 16.10（CloudNativePG），MinIO |
| 命令 | `make test-restore` |
| 观测到的 RTO | 从触发备份到得出结论约 40s（一个约 108 KB 的数据库） |

输出：

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

上面的 RTO 来自一个空的生产数据库——它用于证明**流程**，而不是用于估算真实恢复的规模。在向任何人承诺 RTO 之前，用一个有代表性的 dump 重新测量。

#### 这次执行发现了什么（以及测试现在防止什么） {#what-this-run-found-and-that-the-test-now-prevents}

1. **Postgres 大版本不一致。** 本地 CloudNativePG 运行的是 17.4，而 compose 写的是 16；`pg_dump` 以 "server version mismatch" 拒绝连接。集群的 `imageName` 已固定为 16.10。
2. **空数据库导致的虚假绿色。** 行数为零时，每次计数比较都变成 `0 == 0`，`seq` 检查什么也不看。现在脚本在这两种情况下都会显式失败。
3. **固定的表数量会过时。** 校验曾与写在脚本中的一个数字比较，而那个数字在同一个会话里就已经过时。现在它把表的**列表**与源库比较，并说出缺少哪一张。
4. **备份镜像带有 48 个 HIGH/CRITICAL CVE**，来自 `mc`（Go 版本自 2025 年 9 月起冻结）和基础镜像
   `postgres:16-alpine` 中的 `gosu`。已替换为 `alpine` + `postgresql16-client`
   + `aws-cli`，全部来自 apk，因此可以更新：48 → 0。参见 ADR 0027 的决策 1b。

### 最后一次已验证的执行——compose，磁盘目标 {#last-verified-run--compose-disk-destination}

| 字段 | 值 |
|---|---|
| 日期 | 2026-09-09 |
| 环境 | Docker compose，PostgreSQL 16（pgvector 镜像），**磁盘**目标——没有集群，没有 bucket，没有 `kubectl` |
| 命令 | `docker/backup/test-restore-compose.sh`（`make test-restore-compose` 所运行的） |
| 数据库 | 55 张表，13 个会话中的 422 个事件——一个有数据的数据库，而不是空库 |
| bare 仓库 | 2 个（`exp001.git`、`exp004.git`），归档 27 003 字节 |

输出（三个步骤，摘要）：

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

`backup_runs` 为每次执行增加了 `status = 'ok'` 的一行，以 **dump** 作为
`object_key`——正是 `restore.sh` 为快照窗口所查询的那一列。

#### 这次执行发现了什么 {#what-this-run-found}

**bare 仓库的恢复无法写入它要恢复到的卷**，只有实际运行它才暴露了这一点。`git_local_repos` 由三个使用三个 uid 的镜像共享；它的所有者是最先挂载它的一方（测得：`1000:1000`，模式 0755），而备份镜像以 uid 70 运行。第一次 `--restaurar` 在提取中途以 `tar: can't make dir ./exp001.git: Permission denied` 失败，留下写了一半的目标。由此产生了两项改动，都在上文：命令在提取**之前**拒绝并点名 `--user 0:0`；当它确实以 root 运行时，会把提取出的目录树交还给目录的所有者，而不是让它属于 root——否则会得到一个完美恢复、但 api 和 engine 无法写入的卷。

之后用真正的 `git`（不是没有 git 的备份镜像）验证：两个仓库上的
`git fsck --connectivity-only` 都干净，ref 和提交完好，所有者恢复为 `1000:1000`。

---

## auth 密钥轮换 {#rotacao-das-chaves-do-auth}

决策见
[ADR 0031](adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) 和
[ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)。

first-party auth 有**三个**机密，更换时的后果差别很大。混淆前两个是这里代价最高的错误。

### `AUTH_JWT_SECRET`——不中断服务的轮换 {#rotacao-do-auth-jwt-secret}

签署 access token 的 Ed25519 密钥对由它派生。轮换与主密钥（见下文）的三步交替相同：

1. `AUTH_JWT_SECRET_PREVIOUS` 取旧值；`AUTH_JWT_SECRET` 取新值。重启 api。
2. 两把密钥都出现在 `/.well-known/jwks.json` 中，两者都能验证；只有新密钥用于**签名**。在此期间，api 每个进程发出一次 `WARN`，发生在启动后第一次验证或读取 JWKS 时（旧密钥是按需派生的，而不是在启动时）。
3. 15 分钟后（access token 的 TTL），旧密钥签发的 token 都已失效。**删除 `AUTH_JWT_SECRET_PREVIOUS`** 并重启。

没有人会被登出：refresh token 是用 `AUTH_TOKEN_PEPPER` 而不是这把密钥做哈希的，并且自 [RN-613](business-rules/api.md#rn-613)
起 pepper 是必需的，绝不再借用这把密钥。

**顺序（如果此安装早于 RN-613）：先 pepper，后 JWT。**
在 RN-613 之前，未设置的 pepper 会静默地退回到 `AUTH_JWT_SECRET`——而生产和安装用的 compose 甚至都不把 `AUTH_TOKEN_PEPPER` 传给 api，所以每个 compose 安装都是这种情况。现在没有 pepper 时 api 会**拒绝启动**，并附上说明该怎么做的消息。不会登出任何人的迁移：

1. 把 `AUTH_TOKEN_PEPPER` 设为 `AUTH_JWT_SECRET` 的**当前**值（复制它；不要生成新的）。重启 api。token 的哈希与以前逐字节相同，所以每个 refresh token 和 PAT 都继续有效。`install.sh` 在它运行的目录中找到之前的 `.env` 时会自行完成这一步，并在终端中说明这一点而不打印该值；Kubernetes 的 `ExternalSecret` 中早已有 `AUTH_TOKEN_PEPPER`。
2. 只有在此之后，才按上面的三步轮换 `AUTH_JWT_SECRET`。从此两个机密相互独立，与*旧* JWT 机密相同的 pepper 是预期状态，而不是残留。

**如果有人在分离之前就轮换了 JWT**，在 RN-613 之前的版本中，那次轮换*就是*一次 pepper 更换：所有人都被登出，所有未完成的邮件/重置链接失效，所有 PAT 停止认证——即下一节所描述的全局登出。除了把旧值作为 `AUTH_TOKEN_PEPPER` 放回去之外无法撤销（这会让未过期的旧 token 复活，并使中间签发的一切失效）。在 RN-613 及之后，这个错误不会静默发生：没有 pepper，api 不会启动。仍会掉进去的唯一方式，是在迁移时生成一个**新的** pepper，而不是复制当前的 JWT 机密——同样是全局登出。

验证：`apps/api/test/infrastructure/security/ed25519-access-token-issuer.spec.ts`
（describe "rotação de chave"）；pepper 方面，
`apps/api/test/infrastructure/security/auth-key-material.spec.ts`（describe
"pepperAtual (RN-613)"：启动时的拒绝及其消息），
`apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`
（describe "a migração do RN-613"：用旧回退值做哈希的 refresh 在 pepper 被设为旧 JWT 机密时仍然有效，并能在 JWT 轮换后存活），以及 `scripts/dev/install-env.spec.ts`（安装程序在两种情况下写出的 `.env`，经由 `docker compose config`）。

### `AUTH_TOKEN_PEPPER`——全局登出，没有折中 {#troca-do-auth-token-pepper}

这是用于对 refresh token 和账号 token 做哈希的 HMAC 密钥。更换它会一次性使以下全部失效：

- 流通中的**每个** refresh token——所有人都被登出；
- **每个**未完成的邮件验证链接和密码重置链接；
- **每个** personal access token（PAT）——以 `--token` 启动的 runner 停止认证（设备密钥不受影响）；
- 锁定计数器：每个被锁定的账号都会解锁。

密码会保留（argon2id，没有 pepper）：人们可以正常重新登录。以这种方式被拒绝的 refresh 在 `auth_events` 中显示为 `refresh_unknown`，而不是 `refresh_reuse_detected`。

没有 `AUTH_TOKEN_PEPPER_PREVIOUS`，这是一个有意识的决定：为了一个一生只发生一次的场景，在每次 refresh 上永远接受双重验证，并不划算。如果你需要更换它——比如怀疑数据库泄露——请提前通知大家：对用户而言，症状是毫无明显原因地被登出，并看到重置链接显示“已过期”。

> api **不会**因为新的 pepper 而无法启动。它只是不再认识任何旧 token。如果支持人员报告“所有人同时被登出”，这个变量是第一个要查看的地方——在早于 [RN-613](business-rules/api.md#rn-613) 且从未设置过它的版本中，则是 `AUTH_JWT_SECRET`。在生产中，缺少它时 api **会**无法启动：参见上面的迁移顺序。

验证：`apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`
（[RN-597](business-rules/api.md#rn-597)）。

### `BRABO_SERVICE_TOKEN`——两侧都不中断服务的轮换 {#rotacao-do-brabo-service-token}

这是认证 api ↔ engine 流量的共享机密
（[RN-035](business-rules/api.md#rn-035)）。它与用户会话无关：弄错它不会登出任何人，而是破坏内部通信。

交替步骤与 `AUTH_JWT_SECRET` 相同，区别在于它在**两个**工作负载上运行——而且顺序很重要，因为每一侧发送当前值并接受两个值：

1. `BRABO_SERVICE_TOKEN_PREVIOUS` 在 **api 和 engine** 上都取旧值；`BRABO_SERVICE_TOKEN` 在两者上都取新值。重启两者。在生产中，api、engine 和 broker 以与新值相同的规则检查旧值，所以如果旧值是公开默认值或少于 16 个字符，它们每一个都会在这一步拒绝启动并点名该变量
   （[RN-598](business-rules/api.md#rn-598)，
   [RN-601](business-rules/engine.md#rn-601)）。因此，要摆脱弱 token，就意味着跳过 `_PREVIOUS`，并为此付出下面所描述的 `403`/`401` 窗口期的代价。
2. 当两者都以新变量运行时，新旧 pod 的任意组合都能正常通信——这正是让滚动发布在中途也安全的原因。
3. 两个 Deployment 的滚动发布完成后，**删除
   `BRABO_SERVICE_TOKEN_PREVIOUS`** 并重启。

跳过第 1 步、只更换当前值，会在任何一侧仍有旧 pod 的整个窗口期内产生 `403`/`401`——即
[上文诊断](#diagnostico-do-deploy)中的症状。

验证：api 中为 `apps/api/test/infrastructure/security/service-token.spec.ts`
（describe "rotação do BRABO_SERVICE_TOKEN"）和
`apps/api/test/interfaces/engine-service.guard.spec.ts`；engine 中为
`apps/engine/test/engine_web/plugs/verify_service_token_test.exs` 和
`apps/engine/test/engine/runtime_service_token_test.exs`（启动规则）；broker 中为 `apps/broker/src/config.spec.ts`。

> **`_PREVIOUS` 变量在哪里到达进程。** 在三个
> compose（`docker-compose.yml`、`docker-compose.prod.yml`、
> `docker-compose.install.yml`）中，它们都映射在读取它们的服务的 `environment:` 中，默认为空——在 `.env` 中设置一个并重建服务即可
> （[RN-595](business-rules/api.md#rn-595)；由
> `scripts/ci/previous-nos-composes.spec.ts` 守护，它从代码推导出列表）。**在 Kubernetes 中，它们通过密钥库到达 Pod**
> （AT-220）：`ExternalSecret`
> （`deploy/k8s/base/common/externalsecrets.yaml`）用 `dataFrom.extract` 整体拉取 `brabo` 对象，所以那里存在的 `_PREVIOUS` 会落到
> `brabo-secrets` 中，不存在的就简单地不在那里——在轮换之外不会出现同步失败。它们从不逐个列出：某个 `data` 条目的属性缺失会让整个 Secret 的同步失败，而缺失 `_PREVIOUS` 是正常状态。无论如何，在信任第 2 步之前先在容器内确认（`printenv`）。

#### 在 Kubernetes 中操作 {#rotacao-no-kubernetes}

同样的交替，由密钥提供方中的 `brabo` 对象充当 `.env`。在本地集群中，这个对象是 bootstrap 创建的 Secret `brabo`；在 staging/prod 中，它是 `SecretStore` 指向的提供方条目。

1. 在 `brabo` 对象中**添加** `_PREVIOUS` 键（旧值）并**替换**当前键（新值）——两者在同一次改动中完成。在本地：

   ```bash
   kubectl -n brabo patch secret brabo --type merge -p \
     '{"stringData":{"AUTH_JWT_SECRET_PREVIOUS":"<old>","AUTH_JWT_SECRET":"<new>"}}'
   ```

2. **让 operator 立即同步**，而不是等待 `refreshInterval`
   （1h），并确认该键已经到达：

   ```bash
   kubectl -n brabo annotate externalsecret brabo-secrets force-sync="$(date +%s)" --overwrite
   kubectl -n brabo get secret brabo-secrets -o go-template='{{range $k, $v := .data}}{{$k}}{{"\n"}}{{end}}' | grep _PREVIOUS
   ```

3. **重启**读取它的服务。`envFrom` 在容器启动时读取：Secret 的变化不会改变运行中的 Pod。`AUTH_JWT_SECRET` 和 `CREDENTIALS_MASTER_KEY` 需要重启 `api`，
   `BRABO_SERVICE_TOKEN` 需要重启 `api` **和** `engine`：

   ```bash
   kubectl -n brabo rollout restart deployment/api deployment/engine
   kubectl -n brabo exec deploy/api -- printenv AUTH_JWT_SECRET_PREVIOUS
   ```

4. 当该轮换自身的条件满足时**让它退役**（`AUTH_JWT_SECRET` 为 15 分钟，`BRABO_SERVICE_TOKEN` 为两次滚动发布完成，主密钥为
   `falhas=0` 且待处理为零）：从 `brabo` 对象中**删除** `_PREVIOUS` 键，再次强制同步（第 2 步——该键会从 `brabo-secrets` 中消失，不会残留），然后再次重启（第 3 步）。在重启之前，Pod 会在内存中保留旧值，api 会继续警告有轮换正在进行。

   ```bash
   kubectl -n brabo patch secret brabo --type json -p \
     '[{"op":"remove","path":"/data/AUTH_JWT_SECRET_PREVIOUS"}]'
   ```

验证：这四步曾在一个一次性的 k3d 集群上，针对固定在 `deploy/k8s/helm/charts.env`（0.19.2）中的 External Secrets Operator chart、使用本地 `SecretStore` 演练过：该键在 `force-sync` 之后出现在
`brabo-secrets` 中，删除后消失，而 `ExternalSecret` 一直保持 `SecretSynced`。自 AT-146 起，同样的四步每周针对 `CREDENTIALS_MASTER_KEY` 运行，作为主密钥演练的一部分
（`make test-rotacao-chave-mestra-k8s`，参见
[不必等待事件即可验证](#rotacao-da-chave-mestra)）——其他 `_PREVIOUS` 键还没有自动化执行。每个 PR 上运行的是
`scripts/ci/previous-nos-composes.spec.ts`，如果
`ExternalSecret` 不再使用 `dataFrom.extract` 或在 `data:` 中列出了某个 `_PREVIOUS`，它就会失败。

```bash
# gere um valor com entropia suficiente; ele nunca precisa ser digitado
openssl rand -base64 48
```

### 账号因 lockout 被锁定 {#conta-travada-por-lockout}

lockout 很短（30s 到 15 分钟），并会自行解除：滑动窗口会清空。**故意没有解锁 endpoint**——参见
[RN-031](business-rules/api.md#rn-031)。如果你需要立即解锁某人：

```sql
-- A chave é um HMAC do e-mail, não o e-mail. Ache-a pelo evento recente:
select subject_key, count(*), max(occurred_at)
  from auth_events
 where kind in ('login_failure', 'login_blocked_user')
   and occurred_at > now() - interval '30 minutes'
 group by subject_key order by 3 desc;

delete from auth_lockout_hits where bucket_key = '<subject_key>';
```

成功的密码重置也会解锁账号。

验证：上面两个查询**没有**验证——它们是通过阅读对照 schema 检查的，从未由 spec 执行。lockout 本身（窗口、计数器、解除它的东西）由
`apps/api/test/application/use-cases/auth/lockout.spec.ts` 覆盖。

> **痕迹从不删除。** `auth_lockout_hits` 是一个临时计数器；`auth_events` 是仅追加的，在任何情况下都会保留，包括删除用户（故意没有外键）。

## 主密钥轮换 {#rotacao-da-chave-mestra}

决策见 [ADR 0027](adr/0027-fase5-backup-hardening-release.md)。

`CREDENTIALS_MASTER_KEY` 包装加密用户机密的 DEK：LLM 的 API 密钥和 git token。它会定期轮换，并且在任何泄露嫌疑之后必须轮换。

### 风险是什么 {#whats-at-stake}

只用一把密钥更换变量并重启 api，会让每个现有凭据一次性变得不可读，而且没有启动错误——失败只在第一次使用时以“无法解密”的形式出现，除了恢复旧密钥之外无法挽回。

这就是为什么轮换有三步而不是一步。在中间那一步中，两把密钥共存：

| 变量 | 作用 |
|---|---|
| `CREDENTIALS_MASTER_KEY` | **当前**密钥——始终用于加密 |
| `CREDENTIALS_MASTER_KEY_PREVIOUS` | 旧密钥——只在当前密钥失败时尝试 |

有两张表保存 envelope：`user_credentials` 和
`project_git_connections`。

自 [RN-563](business-rules/api.md#rn-563) 起，每个 envelope 还带有一个
**`key_id`**——包装它的那把密钥的指纹。正是它让第 2 步的进度可以用 SQL 回答。关于它，凌晨 3 点时有两点要紧：

- **它从不决定一行能否打开。** 读取仍然先尝试当前密钥、再退回到旧密钥；AES-GCM 负责认证，它才是权威。标签是元数据，标签与 envelope 不一致的行照样会被正确地重新包装（[ADR 0158](adr/0158-o-id-da-chave-mestra-gravado-no-envelope.md)）。
- **`key_id IS NULL` 的意思是“在这一列存在之前写入”，从不是“使用当前密钥”。** 在早于该列的安装中，在第一次轮换之前一切都是 `NULL`，下面的查询会把它们计为待处理——这是诚实的回答。

从 api 自己的日志中获取当前指纹；它在启动时打印一行：

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=200 \
  | grep 'chave mestra corrente'
# chave mestra corrente: key_id=4f2b91c0a77e13d5
```

### 之前：估算规模 {#before-size-it-up}

```sql
select 'user_credentials' as tabela, count(*) from user_credentials
union all
select 'project_git_connections', count(*) from project_git_connections;
```

重新包装是每行一次 UPDATE。几千行只需几秒；开始之前最好知道数量级。

### 1. 发布两把密钥 {#1-publish-both-keys}

生成新密钥，并把**两把**都发布到密钥提供方，旧的保留在 `CREDENTIALS_MASTER_KEY_PREVIOUS` 中：

```bash
openssl rand -hex 32   # a chave nova
```

在本地集群中，源 Secret 由 bootstrap 创建；在
staging/prod 中，值放入 External Secrets 读取的提供方。然后重启 api，让它加载两把密钥：

> 在提供方的 `brabo` 对象中发布 `CREDENTIALS_MASTER_KEY_PREVIOUS`，会在下一次同步时把它放进 `brabo-secrets`（`ExternalSecret`
> 整体拉取该对象）——强制同步并像
> [在 Kubernetes 中操作](#rotacao-no-kubernetes)中那样确认它已到达，然后重启。在
> compose 中则是修改 `.env` 并重建 api。

```bash
kubectl -n brabo rollout restart deployment/api
kubectl -n brabo rollout status  deployment/api
```

确认 api 处于轮换模式——它会故意在日志中发出警告，并且警告会点名**两个**指纹，下面的查询正是拿它们做比较：

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=50 \
  | grep CREDENTIALS_MASTER_KEY_PREVIOUS
# ... rotação em andamento (atual key_id=<NEW>, anterior key_id=<OLD>). ...
```

> 从这里开始**什么都不会坏**：新机密一诞生就使用新密钥，旧机密仍可通过旧密钥读取。如有需要，你可以在这个状态暂停几个小时——但不能暂停几周：接受两把密钥会让泄露密钥的攻击面翻倍，而这恰恰是你要轮换的原因。

### 2. 重新包装存量数据 {#2-re-wrap-the-store}

```bash
kubectl -n brabo exec deploy/api -- node scripts/rewrap-deks.js
```

预期输出——脚本以葡萄牙语打印，下面就是它实际写出的内容（`apps/api/src/scripts/rewrap-deks.ts`，`main`）：

```
[rewrap] resultado

  user_credentials         total=12  re-embrulhados=12  já na chave atual=0  falhas=0
  project_git_connections  total=3   re-embrulhados=3   já na chave atual=0  falhas=0

[rewrap] concluído. Agora remova CREDENTIALS_MASTER_KEY_PREVIOUS e reinicie a api.
```

计数器：`re-embrulhados`、`já na chave atual` 和 `falhas`。还有另外两种结果。当没有任何东西需要重新包装时，最后一行是 `[rewrap] nada a fazer — o
acervo já está na chave atual.`。当某些行失败时，每一行都以
`[rewrap] <tabela>#<id>: <motivo>` 写入 `stderr`，执行以 `[rewrap] <N>
registro(s) não abriram com nenhuma das duas chaves. NÃO remova
CREDENTIALS_MASTER_KEY_PREVIOUS até resolver.` 结束，退出码为 1。

如果有什么中断了脚本，以下属性很重要：

- **幂等。** 再次运行它会把已转换的行计为
  `já na chave atual`，不会重写任何东西。被中断了？再运行一次。
- **只有 envelope 会变。** 机密的密文逐字节保持不变，所以在中途停止会让存量保持一致：一部分使用新密钥，一部分使用旧密钥，只要 PREVIOUS 存在，两者都可读。
- **`falhas > 0` 会阻止第 3 步。** 这些是两把密钥都打不开的行——通常来自另一个环境，或来自某次被中断、且其密钥已被丢弃的旧轮换。脚本按 id 标识每一行，并点明**为什么**失败——来自另一个环境的行（"embrulhado pela chave `<kid>`"）、标签与 envelope 不一致的行（"rótulo incoerente ou registro adulterado"），以及完全没有标签的行，是三种不同的诊断，对应三种不同的处理。不要删除 PREVIOUS：没有它，你还会失去那些原本仍能打开的东西。

**被中断了，想知道停在哪里？** 去问数据库，而不是靠计数器再跑一次脚本——`<NEW>` 为上面日志中的当前指纹：

```sql
select 'user_credentials' as tabela, count(*) as pendentes
  from user_credentials       where key_id is distinct from '<NEW>'
union all
select 'project_git_connections', count(*)
  from project_git_connections where key_id is distinct from '<NEW>';
```

用 `is distinct from`，绝不用 `<>`：`key_id IS NULL` 的行必须计为待处理，而 `<>` 会静默地把它们排除掉。

### 3. 丢弃旧密钥 {#3-discard-the-old-key}

只有在 `falhas=0` **并且**上面的查询在两张表上都返回 `0` 之后。两者说的是不同的事，你两者都需要：`falhas=0` 意味着本次执行中没有任何东西拒绝打开，而查询意味着没有任何东西被落下——包括之前一次被中断的执行从未到达的行。

```bash
# remova CREDENTIALS_MASTER_KEY_PREVIOUS do provedor, depois
kubectl -n brabo annotate externalsecret brabo-secrets force-sync="$(date +%s)" --overwrite
kubectl -n brabo rollout restart deployment/api
```

确认轮换警告已从日志中消失，并且一个现有凭据仍然可用（最直接的路径是项目的凭据界面，或任何使用 LLM 密钥的 agent 回合）。

### 不必等待事件即可验证 {#verifying-without-waiting-for-an-incident}

**整个周期有一个具名的验证，它在 CI 中运行**
（[RN-562](business-rules/api.md#rn-562)）：

```bash
pnpm --filter api test -- test/scripts/rewrap-deks.spec.ts
```

这个 spec 针对真实的 Postgres 和**两张**表执行本页的流程：用 K1 加密，发布 K2，重新包装，丢弃 K1，并且仍能解密。它还固定了本流程所依赖的两个属性——幂等性（第二次执行报告 `re-embrulhados=0`）以及不可读的行被计数并点名而不会中止其他行。

对同样原语的更窄的内存内覆盖——包括没有任何密钥可用的情况，以及 `key_id` 标签说谎的情况——位于
`test/infrastructure/security/envelope-encryption.service.spec.ts`。

`rewrap` 也可以在任何环境中运行：在测试环境中，手动走完完整周期只需几分钟。

**真的运行过吗？没有。** 维护者的回答（2026-09-27）：这次轮换**从未**在真实环境中执行过。因此上面的 spec 不是一项已演练流程之下的安全网——在 AT-146 之前它是唯一的证明，而且从未触及镜像、`ExternalSecret` 或 api 的重启。

**演练，在集群中，每周一次（AT-146）。**
`make test-rotacao-chave-mestra-k8s`（`deploy/k8s/test-rotacao-chave-mestra.sh`）以相同的机制针对本地集群运行本页的三个步骤：它通过 API 写入一个随机值的 LLM 凭据，并确认每个 envelope 都能用今天的密钥打开；**第 1 步**把新密钥和作为 `_PREVIOUS` 的旧密钥发布到源 Secret `brabo`（提供方的本地替代——绝不直接写 `brabo-secrets`），强制 `ExternalSecret` 同步，等待 `_PREVIOUS` 到达，重启 api，并要求出现点名**两个**指纹的轮换警告；**第 2 步**要求通过上面的查询看到待处理行，运行镜像中的 `node scripts/rewrap-deks.js`
（`falhas=0`），要求待处理为**零**，然后再运行一次（`nada a fazer`）；**第 3 步**从源中删除 `_PREVIOUS`，要求同步后它从 `brabo-secrets` 中**消失**，重启 api，要求出现带有新指纹的启动行且没有轮换警告，并确认每个 envelope 只用新密钥就能打开——并且开头的凭据解密为**相同的值**（在 pod 内以 sha256 比较；值从不离开 pod）。结论就是退出码。它是定时
`.github/workflows/propriedades.yml` 的**最后**一个目标，因为它会更换一个机密并重启 api，并让集群停留在没有 `_PREVIOUS` 的新密钥上——一次完成的轮换，而不是半途而废的。第一次绿色执行：`36502355798`
（2026-09-29，47 s）。

演练**不**覆盖的内容，已声明：`project_git_connections` 的行（通过 API 创建 git 连接会针对真实 provider 校验 token，而证明用的集群没有出站网络——这张表由校验器和 `rewrap` 读取，通常为 0 行；它的 envelope 是同一份代码，已由上面的 spec 在两张表上证明），以及 staging/生产的密钥提供方（这里的源是 overlay 的 `SecretStore` 读取的本地 Secret；`ExternalSecret` 和 operator 是真实的）。这是在一次性集群上的演练，**不是**真实环境的轮换：“从未真正运行过”在有人轮换某个真实环境之前依然成立。

### 与恢复的交互 {#interaction-with-restore}

**把 dump 恢复到使用另一把主密钥的环境，会得到一个完好的数据库，但凭据毫无用处。** dump 携带的是被包装的 DEK，而不是密钥。如果你把生产备份恢复到测试环境而凭据打不开，那不是损坏：是密钥错了——并且自 [RN-563](business-rules/api.md#rn-563) 起，你可以通过一次比较而不是排除法来确认这一点：读取任意一行的 `key_id`，把它与 api 启动日志中的 `chave mestra corrente` 一行放在一起。参见
[恢复](#restore)。

这就是为什么主密钥是恢复计划的一部分：没有对应密钥的数据库备份无法恢复用户的机密。

### 出问题时 {#when-something-goes-wrong}

| 症状 | 原因 |
|---|---|
| api 启动时没有轮换警告，但脚本要求 PREVIOUS | 变量从未到达 pod；ESO 只在每个 `refreshInterval`（1h）重新同步一次 |
| `falhas` 等于总数 | 发布的 PREVIOUS 不是包装存量数据的那把密钥 |
| 在之前从未运行过的情况下，`já na chave atual` 等于总数 | 两个变量的值相同——这种情况下服务会忽略 PREVIOUS |
| 第 3 步**之后**某个凭据停止工作 | 有行被落下了；立即重新发布 PREVIOUS 并再次运行脚本。第 2 步的进度查询正是防止这种情况的手段，也是首先要运行的检查 |
| 在一个从未有人轮换过的数据库中，待处理查询返回全部总数 | 预期之中：`key_id` 从下一次写入起才会写入，所以早于 [RN-563](business-rules/api.md#rn-563) 的安装在第一次轮换之前处处都是 `NULL`。`NULL` 故意计为待处理——“不知道是哪把密钥”不等于“已经是当前密钥” |
| `rewrap` 说某一行使用的密钥既不是当前的也不是旧的 | 该行来自另一个环境——最常见的是在安装之间恢复的 dump。参见下文的[与恢复的交互](#rotacao-da-chave-mestra)；该行的 `key_id` 与 api 启动日志中的对照一眼就能说明问题 |

---

## 成本事件 {#incidente-de-custo}

agent 每个回合都会消耗 token，而陷入循环的 agent 消耗得很快。本节用于每小时成本飙升、需要有人决定削减什么的时刻。

### 信号 {#signal}

当任何项目的预计花费超过每小时 USD 5 时，告警 *Custo por hora acima do limite* 触发：

```promql
max(sum by (project) (rate(brabo_llm_cost_micros_total[10m])) * 3600 / 1000000)
```

告警是一个**警告**，而不是刹车。真正的刹车是领域中的 `budgets`，它们按项目/会话起作用，从不全局起作用
（[RN-019](business-rules/api.md#rn-019)）。

### 1. 哪个项目，哪个 agent {#1-which-project-which-agent}

Grafana → 面板 **Brabo · visão executiva** → 按项目的成本面板。或者直接从数据库查询，它还会给出 agent 和模型：

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

两种解读会改变处理方式：

- **某个 agent 主导列表**、带有大量短调用，意味着循环：ToolLoop 在重复同一个工具而不收敛。
- **调用少而成本高**意味着在廉价工作上使用了昂贵的模型——binding 错误，而不是循环。

### 2. 检查预算 {#2-check-the-budget}

```sql
select b.project_id, b.session_id,
       b.limit_micros / 1e6  as limite_usd,
       b.spent_micros / 1e6  as gasto_usd,
       round(100.0 * b.spent_micros / nullif(b.limit_micros, 0)) as pct,
       b.policy
  from budgets b
 order by pct desc nulls last;
```

`policy` 决定到达上限时的行为：

- **`block`**——调用被拒绝。这是默认值，也是你在生产中想要的。
- **`allow`**——上限只是记录；花费会继续。处于 `allow` 且花费很高的项目**不会自己停下来**。在做任何其他事情之前先检查这一点：这是“预算没有拦住”最常见的原因。

### 3. 削减花费 {#3-cut-the-spend}

按可逆程度，从最温和到最激进。

**a) 让 agent 退出自动自主模式。** 它们停止自行行动，回到每个动作都需要批准的状态，且不会丢失上下文：

```sql
update agent_autonomy
   set mode = 'require_approval', updated_at = now()
 where project_id = '<projeto>'
   and mode = 'auto_approve';
```

`agent_autonomy.mode` 是枚举 `permission_policy`
（`auto_approve | require_approval | deny`）——没有 `manual` 这个值，这一步的早期版本用过它，并且当场失败。
`and mode = 'auto_approve'` 是有意的：没有它，update 会把项目中每一行 `deny` 都变成 `require_approval`，恰恰放松了有人已经关闭的东西。`"*"` 行（自动模式，RN-153）也由同一个 update 覆盖。

这一步**不能**削减的：项目 `permissions.json` 中 `allow` 的模式仍会自动批准与之匹配的内容——`decide()` 在 `agent_autonomy` 之后读取该文件，而该文件可能把决定重新抬回
`auto_approve`（`apps/api/src/domain/actions/decide.ts`，`decide`）。如果花费来自该文件允许的命令，转到 (c)。

本节的 SQL 块由
`apps/api/test/runbook/sql-do-incidente-de-custo.spec.ts` 针对已迁移的 schema 运行，它还会确认 (a) 修改 `auto_approve` 而不触碰 `deny`——这里的无效值或被重命名的列会让 api 的测试套件失败，而不是让事件处理失败。

**b) 把模型 binding 换成本地模型。** Ollama 成本为零；质量会下降，花费立即停止：

```sql
-- veja o binding vigente e o escopo que o resolve
select scope, scope_id, model_id from model_bindings where scope_id = '<projeto>';
```

然后通过配置界面把项目的 binding 指向一个 `local` 模型（最具体的范围优先：会话 > agent > 项目 >
workspace——[RN-020](business-rules/api.md#rn-020)）。

**c) 降低上限并确保是 `block`。** 让领域本身拒绝接下来的调用：

```sql
update budgets
   set policy = 'block',
       limit_micros = least(limit_micros, spent_micros + 1000000)  -- +1 USD
 where project_id = '<projeto>';
```

**d) 关闭项目的会话。** 最后手段：会中断进行中的工作。使用正常的状态转换（`closing`），绝不对 pod 执行 `kill`——杀掉 pod 不会关闭会话，只会制造孤儿
（参见 [engine 的滚动发布](#rollout-do-engine)）。

### 4. 之后 {#4-afterward}

- **Psicólogo 已经有证据。** 如果原因是 agent 的循环，它的分析会指出目标 agent，Anamnese 可以提出指令补丁。修正指令才能防止再次发生；调整预算只是争取时间。
- **确认告警已送达。** 规则位于 Grafana，而不是 Prometheus：如果 Grafana 当时宕机，就不会有警告，而那时的沉默并不意味着健康。

### 本节不能修复的 {#what-this-section-doesnt-fix}

已经产生的成本。计量是记录，而不是退款：`token_usage` 统计已花费的部分，这里没有任何东西能从 provider 那里把钱退回来。唯一真正的预防，是在事件**之前**设置 `policy = 'block'` 和合理的上限。

---

## 可观测性 {#observabilidade}

如何跟踪一个会话、找到成本，以及在没有数据时进行诊断。决策见
[ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md)。

### 本地可观测性，无需集群 {#observabilidade-local}

本小节之后的所有内容都假设集群在运行。要在不启动 Kubernetes 的情况下获取指标和日志，有一个 Compose overlay
（[ADR 0070](adr/0070-observabilidade-no-compose-local.md)）：

```bash
pnpm dev:obs     # sobe a stack de dev + Prometheus, Loki, Alloy e Grafana
pnpm obs:down    # derruba só os quatro, deixando os apps de pé
```

命令结束时会检查已启动的内容——如果每一行都显示 `ok`，面板就有数据；如果报错，它会说明缺少哪一部分。

验证：这最后的检查是 `scripts/dev/observabilidade-pronta.mjs`，它是一个**自检，而不是证明**——只有在有人启动 overlay 时才运行，没有 spec 也没有 workflow。破坏 overlay 的改动会在下一次有人运行 `pnpm dev:obs` 时暴露出来。

| 工具 | 地址 | 用途 |
|---|---|---|
| Grafana | <http://localhost:3001> | 面板和日志，无需登录 |
| 日志 | <http://localhost:3001/d/brabo-logs> | 一次一个服务，或三个一起 |
| Prometheus | <http://localhost:9090> | 检查目标和原始序列 |
| Loki | <http://localhost:3100> | 直接查询（正常路径是 Grafana） |

**面板与集群中的完全相同**——Compose 直接挂载
`deploy/k8s/observability/dashboards/`，数据源的 UID
（`brabo-prometheus`、`brabo-loki`）也相同。新面板无需复制即可在两个环境中使用。

**这个 overlay 不做的事：**追踪。中间没有 OpenTelemetry
Collector 就没有 Tempo，这是决定，而不是疏忽（[ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md)，决策 9）。`trace_id` 仍会写入日志，足以手动对照 api 和 engine。

三件让人困惑、值得在提 issue 之前了解的事：

1. **在新数据库上，成本/token 面板为空是预期的。** 这些指标带有标签（`project`、`provider`），而在 `prom-client` 中，带标签的指标在第一次观测之前并不存在。发起一次 LLM 调用，序列就会出现。
2. **只有 `api`、`engine` 和 `web` 进入 Loki。** Postgres 和 Ollama 因噪声被排除；可观测性栈本身被排除，因为在同一个 Compose 项目中，它会循环摄取自己的日志。
3. **`OUTRO` 级别**是 `pino-pretty` 的树状续行，它没有自己的级别。这不是丢失的日志。

### 东西在哪里 {#where-things-are}

| 工具 | 本地地址 | 用途 |
|---|---|---|
| Grafana | <http://localhost:3001> | 面板、trace、日志、告警 |
| Prometheus | `kubectl -n monitoring port-forward svc/prometheus-server 9090:80` | 检查目标和原始序列 |
| Tempo | Grafana 数据源 | trace |
| Loki | Grafana 数据源 | 日志 |

**Brabo** 文件夹中有两个面板：*visão executiva*（按项目的每小时成本和每分钟 token、活跃会话、动作决策）和
*visão operacional*（按状态的 Oban 队列、按 provider 的 LLM p50/p95 延迟、被阻塞的任务、每个副本的会话）。

### 从根节点到工具调用跟踪一个会话 {#following-a-session-from-the-root-to-a-tool-call}

1. 获取会话的 `trace_id`。它是保存在 `sessions.trace_parent` 中的
   `traceparent` 的中间字段：

   ```bash
   # 00-<trace_id>-<span_id>-01
   curl -sS -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/projects/$PROJ/sessions/$SESS | jq -r .traceParent
   ```

2. 在 Grafana → **Explore** → 数据源 **Tempo** → **TraceQL** 标签页中，粘贴 `trace_id`。返回的树以 `session.create`（api）为根，其下是 `agent.turn` → `tool.call` / `llm.turn` /
   `gate.scanner`（engine）。

3. 从一个 span 出发，**Logs for this span** 按钮会跳转到带有该 `trace_id` 的 Loki 日志行。反方向——从日志行到 trace——是日志行详情中出现的 **TraceID** 链接。

4. 该会话的成本：*visão executiva* 面板按项目筛选。要得到每个会话的精确值，来源是数据库（`token_usage.cost_micros`），而不是指标——指标故意按项目和 provider 聚合，以免为每个会话创建一条序列。

### Tempo 中没有 trace 时 {#quando-nao-ha-trace-no-tempo}

本节的名称随行为一起改变了（ADR 0035），这种区分是诊断的第一步：**span 总会被创建，在任何环境中都是。** `OTEL_EXPORTER_OTLP_ENDPOINT` 控制的是**导出**。所以“我在 Grafana 中看不到 trace”和“没有 trace”是不同的问题。

在做任何事情之前，先看故障在哪一侧——日志自己会回答：

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=20 | grep -o '"trace_id":"[^"]*"' | head
```

- **日志中有 `trace_id`，Tempo 中没有 trace** → 问题在导出：按下面的 1 到 4 检查。
- **日志中没有 `trace_id`** → 问题在上下文，更少见：要么 api 的 `startTracing()` 没有运行（参见
  `apps/api/src/tracing-boot.ts`——它必须是 `main.ts` 的第一个 import），要么 `Engine.Telemetry.Otel.setup/0` 没有在监督树之前调用。

按可能性从高到低：

**1. 变量没有设置。** 没有 `OTEL_EXPORTER_OTLP_ENDPOINT` 时，span 被创建并在最后丢弃，所以日志中有 `trace_id` 而 Tempo 中什么也没有。在开发环境中这是预期的（没有 collector）；在集群中这是缺陷。

```bash
kubectl -n brabo exec deploy/api -- printenv OTEL_EXPORTER_OTLP_ENDPOINT
kubectl -n brabo exec deploy/engine -- printenv OTEL_EXPORTER_OTLP_ENDPOINT
```

**2. NetworkPolicy 在阻止。** 这是所有失败中最安静的：span 被创建，发送失败，其他一切都是绿色。

```bash
kubectl -n brabo get networkpolicy allow-otlp-egress
kubectl -n brabo logs -l app.kubernetes.io/name=engine --tail=50 | grep -i "error exporting"
```

**3. 协议错误。** Elixir 的 exporter 使用 **HTTP/protobuf（4318）**，而不是 gRPC。把它指向 4317 会让每一批都报 `socket_closed_remotely`。

**4. Collector 什么也没收到。**

```bash
kubectl -n monitoring logs deploy/otel-collector-opentelemetry-collector --tail=30
```

### 面板为空时 {#when-a-panel-is-empty}

几乎总是**指标名称**的问题。名称在三个互相看不见的地方以字符串被引用：面板、告警规则和本运维手册。对照服务实际暴露的内容检查：

```bash
curl -sS http://localhost:3000/metrics | grep '^brabo_' | cut -d'{' -f1 | sort -u
kubectl -n brabo exec deploy/engine -- wget -qO- http://127.0.0.1:4000/metrics | grep -E '^(brabo|oban)_'
```

如果服务暴露了它而 Prometheus 中没有，问题在采集：

```bash
kubectl -n monitoring port-forward svc/prometheus-server 9090:80
# depois: http://localhost:9090/targets — os jobs são `brabo-api` e `brabo-engine`
```

### Loki 中没有日志时 {#when-theres-no-log-in-loki}

Alloy 是一个 DaemonSet，读取节点上的 `/var/log/pods`，按 `brabo` 命名空间过滤。

```bash
kubectl -n monitoring logs -l app.kubernetes.io/name=alloy --tail=30 | grep -i error
```

滚动发布之后出现 `tailer stopped ... pods not found` 警告是正常的——Alloy 会继续追踪已被删除的 pod。

应用**无法**直接与 Loki 通信，这是有意的：
`allow-otlp-egress` 只开放 4317/4318。要从外部查询：

```bash
kubectl -n monitoring port-forward svc/loki 3100:3100
curl -sS -G http://localhost:3100/loki/api/v1/query_range \
  --data-urlencode '{app="api"} | json | trace_id != ""' --data 'limit=5'
```

### 告警 {#alerts}

从 `deploy/k8s/observability/alerts/brabo-alerts.yaml` 预置，并可在 **Alerting → Alert rules**（Brabo 文件夹）中看到。规则的标题是葡萄牙语——这是你在 Grafana 中要搜索的内容：

| 告警（Grafana 中的标题） | 严重程度 | 多久后触发 | 调查什么 |
|---|---|---|---|
| *Fila do Oban crescendo sem consumo* | `critical` | 10 min | 没有任何 engine 副本 Ready；Postgres 连接池耗尽；某个 worker 卡在一个 job 上 |
| *Sessão presa em closing* | `warning` | 15 min | [drain 没有结束](#quando-a-sessao-escapa)，或转换到 `closed` 失败 |
| *Custo por hora acima do limite* | `warning` | 5 min | [哪个项目、哪个 agent](#incidente-de-custo)；领域预算仍是硬性控制 |
| *Backup do Postgres atrasado*——最后一次良好备份超过 26 h | `critical` | 立即 | CronJob 没有运行，或运行了但失败——`brabo_backup_last_status` 区分这两种情况；参见[恢复](#restore)。“从未有过备份”（`-1`）**不会**触发它 |
| *Última execução do backup falhou* | `warning` | 立即 | 昨天的一次良好备份可能仍然存在，这就是它会好几天不被注意的原因；原因在 `backup_runs.error_message` 中 |

它们是 **Grafana** 规则，而不是 Prometheus 规则（ADR
0026 中记录的偏离）：如果 Grafana 宕机，它们就不再被评估。没有配置 Alertmanager，也没有通知目标。

### 已知限制 {#known-limits}

- 还没有端到端地观察到任何**真实**的 agent trace：验证这一点需要配置好的 LLM（Ollama 或 API 密钥）。该机制是通过直接在会话的 trace 中发出 span 来验证的。
- web 不导出自己的 span——它**生成** `traceparent` 并在请求头中发送，api 把它采纳为父级。浏览器日志进入控制台，而不是 Loki。
- 保留期很短：Tempo 24h，Loki 24h，Prometheus 2h。这是一个本地环境。

---

## gate 注册表 {#registro-de-gates}

流程中的 gate 在 `docs/gates.yml` 中声明
（[ADR 0054](adr/0054-gates-como-registro-declarativo.md)）。有两点运维上值得了解。

**该文件随镜像一起发布。** `docker/api/Dockerfile.prod` 在两个阶段中都复制它，方式与复制 migration 相同，而
`.dockerignore` 显式地把它重新包含进来——整个 `docs/` 都被忽略，而这是其中唯一属于生产数据、而不是文档的文件。运行时它位于 `/app/docs/gates.yml`；加载器从 `__dirname` 向上查找直到找到它，不使用环境变量。

**不可读的文件不会让 api 崩溃。** 加载是惰性的：调用 `GET /internal/gates` 的一方会收到错误，进程的其余部分继续运行。如果该路由返回错误，确认文件已被包含：

```bash
kubectl -n brabo exec deploy/api -- cat /app/docs/gates.yml | head -5
```

为空或缺失意味着镜像在构建时没有它——很可能是 `.dockerignore` 被改过，或者是从一个没有 `docs/` 的上下文构建的。

**注册表随镜像发布；它所指向的东西不会。** `teste`/`ci` 类型的 gate 指向 `apps/api/test/`、`scripts/ci/` 和 `.github/` 下的文件，而它们都不在镜像中。在拆分之前，加载器在运行时要求这些文件存在，该路由在每个安装上都返回 `500`——在 v6.1.0 上测得约 55 分钟内有十二次 5xx，`RegistroDeGatesInvalido` 把十一个目标列为“não existe”。用下面的命令重现旧的失败：

```bash
docker exec <api> node -e "require('/app/infrastructure/gates/gate-registry.loader').carregarRegistro()"
```

在修复后的镜像上，这条命令什么也不打印。如果它抛出点名某个 `.spec.ts` 或 workflow 的
`RegistroDeGatesInvalido`，说明镜像早于修复（[RN-070](business-rules/api.md#rn-070)）；如果它抛出时点名的是某个 gate 的*内容*（一个没有 `script` 的 `block` gate，一个没有证据的 `active` gate），说明注册表本身有错，应该在仓库中修正。

界面不会显示这个失败：当 `GET /gates` 失败时，`PrGateTimeline` 会退回到完整的流水线（[RN-084](business-rules/api.md#rn-084)），所以唯一的信号是 api 的日志。`docker/smoke.sh` 现在针对生产镜像调用提供注册表的两个路由：带用户 bearer 的 `GET /gates` 和带 service token 的 `GET /internal/gates`。一个函数检查两者的响应体，遇到 `500`、空列表或没有 `merge-protegida` 的注册表都会判定失败。正是这一点阻止了该失败静默地回来。token 通过 stdin（`--config -`）传给 `curl`，从不通过 argv，因此不会出现在 `ps` 或 CI 日志中。

要以 api 看到的方式查看已校验的注册表：

```bash
kubectl -n brabo exec deploy/api -- \
  curl -sH "x-brabo-service-token: $BRABO_SERVICE_TOKEN" localhost:3000/internal/gates
```

通过率的测量**不**在生产中运行：它是
`pnpm --filter api validacao:gates`，从仓库针对数据库运行。参见
[docs/explanation/gates.md](explanation/gates.md)。

---

## 推理环境 {#ambiente-de-inferencia}

当 agent 回复为空、被截断、极其缓慢，或“忘记”了自己的指令时，问题几乎从不在领域代码中——而在这里。前五个原因是在 gate 演示连续九次执行中发现的，记录在
[ADR 0020](adr/0020-destravar-gates-qa-secops.md) 中；所有变量都在 `docker-compose.yml` 中暴露。

| 变量 | 设置错误时的症状 |
|---|---|
| **GPU** | 没有预留设备的 `ollama` 服务会让 GPU 闲置，100% 在 CPU 上运行：一个约 7,000 token 的 prompt 仅摄入就要约 50s。override 是可选的（`docker-compose.gpu.yml`、`pnpm dev:gpu`），放在主 compose 之外，因为主机上没有 `nvidia-container-toolkit` 时，这项预留**会让服务无法启动** |
| `OLLAMA_CONTEXT_LENGTH` | 默认值 4096 会**静默**截断一个为 128k 设计的 prompt。agent 丢失自己的指令，开始模仿工具的 schema，那是上下文末尾剩下的内容 |
| `OLLAMA_MAX_LOADED_MODELS` | `OLLAMA_KEEP_ALIVE` 较高时，模型会累积：在 15 GB 的机器上常驻 15.2 GB 的权重，agent 因内存不足而回复为空 |
| `OLLAMA_REQUEST_TIMEOUT_MS` | 对于长 prompt 上的大模型来说超时太短 |
| `OLLAMA_MODE`（dev bootstrap，[RN-461](business-rules/infra.md#rn-461)，ADR 0114） | 在开发者机器上的原生 Ollama 被卸载或停止后仍卡在 `host`——每个本地 LLM 回合都以针对 `http://host.docker.internal:<porta>` 的 `ECONNREFUSED` 失败，而 compose 的 `ollama` 服务永远不会启动来补位（它位于 `profiles: ["local-llm"]` 之后，正是这个变量让该 profile 保持关闭）。修复：`pnpm bootstrap` 中的 `Docker › Reconfigurar Ollama`，它会从 `.env` 中清除 `OLLAMA_MODE`/`OLLAMA_HOST`，并强制检测在下一次 `Create`/`Reset total` 时重新询问 |
| `START_OUTBOX_DRAIN` / `START_ANAMNESE` | Psicólogo 和 Anamnese 与执行型 agent 并行消耗 LLM 回合，在周期中途拖垮 dev 的连接 |
| `TOOL_LOOP_MAX_ITERATIONS*` | 上限**太低**时 agent 会在没有交付的情况下停止，报 `iteration limit reached`，来源为 `model`——这具有误导性，因为模型并没有做出错误判断，甚至还没来得及判断。上限按**类型**设置（[RN-085](business-rules/engine.md#rn-085)）：对话型 agent 为 `8`，dev agent 和 QA 为 `60`。调高之前，确认该 agent **有** `token_budget_micros`；没有它时，上限是唯一存在的成本防护 |
| `TERMINAL_OUTPUT_MAX_BYTES` | 调得太高会带回这个上限所要避免的失败方式：每条命令的输出都留在循环的历史中，并在之后的**每个**回合中传输。这与上下文窗口无关：首次暴露这一点的执行中，最大的一次成功调用只有 28,993 个输入 token（[RN-074](business-rules/engine.md#rn-074)） |
| `API_JSON_BODY_LIMIT`（api）/ `TRANSPORT_MAX_BODY_BYTES`（engine） | QA/SecOps gate 中 `413 request entity too large` 的原因在 Brabo 自己的 api 中，从不在 provider——Express 从未配置请求体限制，使用的是 100 KB 的默认值，而 Phoenix 在最重的 engine→api 链路（`POST .../llm-turn`，每次迭代都重新发送整个历史）上接受 8 MB。`API_JSON_BODY_LIMIT`（默认 10 MB）堵住了这一端；`TRANSPORT_MAX_BODY_BYTES`（默认 8 MiB）是 engine 的上下文压缩在模型窗口**之上**遵守的上限，以便在请求体超出 HTTP 限制之前触发（[RN-412](business-rules/api.md#rn-412)，[ADR 0098](adr/0098-limites-de-transporte-e-janela-efetiva-de-compactacao.md)） |

> **注意——守卫不会清空队列。** `START_ANAMNESE=false`
> 阻止的是**新的**入队，而不是旧的。曾经有 20 个来自之前执行的 `AnamneseWorker` 堆积在 `executing` 中，它们会在下一次启动时运行，与守卫无关。队列需要被**清除**，而不只是关闭守卫。

> **启用 Anamnese 或 Psicólogo：是两个变量，不是一个。** 两者都在 2026-08-10 因产品决定（而不是 bug）被暂停。Psicólogo 仍处于暂停；Anamnese 已由所有者在 2026-10-01 重新启用（[RN-680](business-rules/engine.md#rn-680)）——`ANAMNESE_ENABLED`
> 在代码和三个 compose 中恢复为默认 `true`，没有符合条件主体的轮次不会调用 LLM，并会在 engine 日志中说明原因
> （`sem_sujeito_elegivel`）。再次暂停它就是 `ANAMNESE_ENABLED=false`。`ANAMNESE_ENABLED` / `PSYCHOLOGIST_ENABLED` 是产品开关（**新的**一轮可以发生吗？）；`START_ANAMNESE` 是启动开关（周期性 tick 是否被调度？）。周期性的 Anamnese 需要两者都为 `true`；Psicólogo 没有启动开关，因为它的自动触发器是会话关闭。
>
> 在 [RN-540](business-rules/engine.md#rn-540) 之前，两个 `*_ENABLED` 开关在任何 compose 的 `engine` 服务中都**没有映射**，而 `docker compose` 不会传递主机环境——所以在 `.env` 中设置它们会静默地毫无作用，同时代码中有三个地方承诺暂停是可逆的。现在它们已被映射，使用代码自身的默认值（当时两个文件中都是 `false`；`ANAMNESE_ENABLED` 自 RN-680 起为 `true`）。**安装**用的 compose
> （`docker/docker-compose.install.yml`）是第三个文件，当时没有包含在这次修复中；自 AT-202 起，它以相同的默认值映射同样的开关，而
> `scripts/ci/flags-do-engine-no-compose.spec.ts` 检查**全部三个**文件，并会让下一个未映射、或默认值与代码不同的布尔开关构建失败（`START_OUTBOX_DRAIN` 和
> `START_ANAMNESE` 在生产 compose 中故意为 `false`，spec 按名称声明了这一差异）。安装用的 compose 曾带有同样的 `false`——连同生产的理由（“它存在是为了验证镜像”）一起从生产复制过来——自 AT-219 起它重复代码中的
> `true`。这是安装的缺陷，而不是成本上的选择：`START_OUTBOX_DRAIN` 是唯一把 api 的 outbox 排入 engine 的东西，所以在单机安装中，已关闭的会话永远不会停止它的进程，等待批准、gate 或容器的 dev agent 也永远不会被唤醒。在产品开关关闭时，这些开关都不会消耗 token：在
> `ANAMNESE_ENABLED=false` 时，Anamnese 的 `kickoff/0` 不调度任何 job，而 drain 只有在 `PSYCHOLOGIST_ENABLED=true` 时才会让 Psicólogo 入队。因此在一个安装中，Anamnese 的开启或关闭只取决于
> `ANAMNESE_ENABLED`（自 RN-680 起默认 `true`）。在 Kubernetes 中没有需要修正的地方——Deployment/ConfigMap 不会拦截任何东西，而 `brabo-config` 从未携带这些变量。两个开关在启动时读取：修改它们后执行
> `docker compose up -d engine`。

### 小模型上的语义 gate {#a-semantic-gate-on-a-small-model}

QA 是最不适合本地 7B 模型的角色：判断在不同执行之间会变化，这使演示成为一个可执行的验收标准，而**不是**回归测试。要让它可靠，把 `DEMO_QA_MODEL` 指向一个 API 模型——按 agent 的 binding（`agent` 范围，优先于 `project`）正是为此而存在的。

gate 机制本身不会变化：不可变的顺序、在同一分支上返回、修正次数上限、作为产物的结论以及终态
`awaiting_user`，全部由 ExUnit 验证
（[RN-014](business-rules/api.md#rn-014)，[RN-015](business-rules/api.md#rn-015)）。

---

## 安装 {#instalando}

```sh
curl -fsSLO https://github.com/daneiel/brabo/releases/latest/download/install.sh && bash install.sh
```

**先下载文件，再用 `bash` 运行它。** 两种看起来等价的更短写法并不等价，脚本会在下载任何东西之前**按名称**拒绝两者，并打印上面那一行：

- **绝不要用 `curl … | sh`。** 原因是机制上的，而不是风格上的：脚本通过管道到达时，进程的 `stdin` **就是**下载内容，所以任何 `read` 都会读到脚本自身的字节或遇到 EOF。一个无法提问的安装程序，只能自己替别人的机器选择目录位置
  （[RN-526](business-rules/produto.md#rn-526)）。
- **也不要用 `sh -c "$(curl …)"`**——这曾是 AT-083 之前文档中的写法，而它从未奏效。脚本会对照已签名的清单检查**自身的哈希**，而在 `X -c "…"` 下没有可计算哈希的文件：`$0` 是 shell 的名字。以 `dash` 作为 `sh`（Debian、Ubuntu）时，它甚至更早就会死在
  `set -o pipefail` 上。没有跳过这项自检的开关，将来也不会有（[ADR 0150](adr/0150-instalador-de-uma-linha.md)）——修复方法是要有一个文件存在。在非 bash 的 shell 下运行它，同样是一个单独的具名拒绝。

脚本在做任何事情之前都会验证**自己的来源**——Release 的 `checksums.txt` 的签名，然后是它自身在这份已验证清单中的哈希。任何一步失败都是**具名拒绝**，绝不是警告。

做任何这些事情，它都需要 `sha256sum`（coreutils，Linux）或 `shasum -a 256`（macOS 自带）**之一**，并在**第一次下载之前**确定用哪一个——而不是在某次检查的中途。两者都缺失是一个**单独的**拒绝，会点名两个工具并说明没有下载任何东西；这是操作系统缺少依赖，故意*不*用下面哈希拒绝的措辞来写。两者是要求不同处理的不同结果——一个靠安装修复，另一个靠**停下来**——而 AT-091 的测量正是在两者之间划线的原因：macOS 上的 `sha256sum: command not found` 曾表现为 *"o cosign baixado NÃO bate com o hash pinado neste
script. Isso não é um aviso: pare e investigue."*，这既阻止了 macOS 上的每一次安装，又教会读者忽略这句话。`--print-plan` 不需要任何一个工具，并会声明脚本接受哪些（`conferir-hash`）。

检测对它发起的 Docker 调用有 **5s 的上限**（`docker compose ls` 会与守护进程通信，而躲在活动 socket 后面的缓慢或停止的守护进程会在*第一个问题之前*卡住一切）。触及上限不是错误——它与完全没有 Docker 的结果相同，其余信号仍会被读取。

没有 TTY 时它会**报告并以 0 退出**：打印它发现的内容以及要在终端中运行的命令。这是有意的，与 `consentir-base.mjs` 已有的方式相同。

**它从不删除的东西：**你的项目 base 和你的镜像目录。具名卷只有在确认后才会删除，并且会事先逐个列出。

它通过**自己的 compose**（`docker/docker-compose.install.yml`）启动整个栈，该 compose 从变量获取镜像，不构建任何东西——并且它**从 Release 下载这个 compose**
（[RN-570](business-rules/produto.md#rn-570)，
[ADR 0160](adr/0160-o-compose-do-instalador-viaja-assinado.md)）。四个文件作为 `brabo-install-*` 资产随安装程序发布，位于覆盖 runner 二进制文件的**同一个**已签名 `checksums.txt` 中：compose、它 bind-mount 的
`postgres/init.sql` 和 `ollama/pull-models.sh`，以及迁移时运行的
`backup/test-restore-compose.sh`。在验证自身之后——在任何提问之前、在写入任何东西之前——脚本立即下载这四个文件，并对照这份清单检查每一个的哈希。三种具名拒绝，都发生在未被触碰的机器上：

| 消息以什么开头 | 含义 | 怎么做 |
|---|---|---|
| *"a Release não publica …"* | 该 Release 早于 ADR 0160，或其发布步骤中途失败 | 从该 tag 的仓库 checkout 安装，或等待下一个 release |
| *"o manifesto assinado não cobre …"* | 清单存在，但没有该资产的条目 | 同上——Release 不完整 |
| *"… NÃO bate com o manifesto assinado"* | 下载的文件不是已签名清单所描述的那个 | **停下来，当作事件处理**；不要试图绕过 |

经过验证的副本只在首次需要时写入你运行脚本所在目录下的 `docker/`——与 `.env` 同一目录。那里已有的内容（升级时上一版本的 compose）会被**替换，从不读取**，脚本会点名它替换了什么；在处于另一个提交的 git checkout 中，这会让 `git status` 变脏。

> **在 ADR 0160 之前发布的 Release 不带这些资产。** 它们的安装程序仍使用相对路径，上面的单行命令在空目录中会在写入 `.env` 之后以 *"no such file or directory"* 失败（[RN-549](business-rules/ci.md#rn-549) 测得的缺口）。对于这些 tag，请从你要安装的那个 tag 的仓库 checkout 运行安装程序。

> 在*迁移*路径上，恢复证明（`test-restore-compose.sh`）通过 `BRABO_ENV_FILE`（作为 `--env-file` 传给 Compose）接收安装的
> `.env`，因为 Compose 是在 compose 文件旁边查找 `.env`——而不是在你运行命令的目录中。如果你手动针对某个安装运行这项证明，请先导出 `BRABO_ENV_FILE=/caminho/para/.env`；不存在的路径会被拒绝，从不会被另一个文件替代。失败的证明仍然不会删除任何东西（[RN-530](business-rules/infra.md#rn-530)）。

两种来源：

```sh
install.sh                  # --source=ghcr (default): por digest, assinatura verificada
install.sh --source=local   # buildx bake; exige árvore limpa numa tag
```

机密只生成一次，并以模式 **600** 持久化到 `.env` 中——文件在接收内容*之前*就被创建为空并锁定，因为机密对所有人可读的窗口期正是这个文件不能有的。

没有**迁移步骤**，也不应该有：compose 通过 `service_completed_successfully` 把 `api` → `migrate-api` 串联起来，所以 `up --wait` 会等待 migration。第二个安排 migration 顺序的地方，就会成为同一事实的第二个来源。

栈启动后，它会**先问再断言**：对 api 和 engine 请求 `/health`，然后才说已安装。

它会**安装本地 agent**——二进制文件对照已签名清单验证，并以 `install -m 0755` 放置，所以无需手动 `chmod`
（[RN-531](business-rules/produto.md#rn-531)）——并询问**一个** base，把它写入两侧：`.env` 中的 `BRABO_PROJECTS_BASE` 和 runner 的
`runner.json` 中的 `base`。没有该平台二进制文件的 Release 不会中断安装：它会说明这一点并指向 `npm install -g @brabo/runner`。

在已有安装之上，它会**迁移或停止**——在另一个版本的卷上执行 `up` 是不会预警的损坏。顺序是备份 →
**证明**可以恢复 → 询问 → 删除 → 安装 → 恢复，中间的证明正是赋予安装程序删除权的东西
（[RN-530](business-rules/infra.md#rn-530)）。

并且它知道自己要替换的是**哪个**版本（[RN-542](business-rules/produto.md#rn-542)）。镜像在检测运行**之前**就已解析，所以问题从不是盲目的：标记文件记录已安装的 `versao`，清单带有将要安装的版本，提供的选项针对两者之间的关系：

| 关系 | 提供什么 | 默认 |
|---|---|---|
| 更新 | *"Atualizar 5.0.0 → 5.1.0?"* | **是**——这正是你来做的事，已证明的备份让它可以回退 |
| 相同 | *"Já é a 5.0.0. Reinstalar do zero mesmo assim?"* | 否——没有可提供的收益 |
| 更旧 | 称之为 **downgrade**，并警告数据库 migration 不会反向运行 | 否——可能无法回头 |
| 未知 | schema 1 的标记文件没有版本；它会说明这一点，不会猜测 | 否 |

无论你选择哪个分支，安装都会被**删除并从零重建**，而不是在旧卷之上启动。迁移一半比完全不迁移更糟。

由 `pnpm bootstrap` 菜单（*Docker › Instalar*）调用的 `install.sh` 只**报告**计划。这是机制上的，而不是偏好：菜单项以 `/dev/null` 作为 stdin 运行，以便菜单能继续从同一终端读取按键，而这个安装程序是为*提问*而设计的。该菜单项的说明中带有真正执行安装的单行命令。

> **它不做的事：**不经询问就启用容器 **broker**——参见下面的[安装中的 broker](#broker-na-instalacao)。本地 agent 它会**配对**，自 [RN-547](business-rules/produto.md#rn-547) 起：它创建第一个账号，在本机生成机器设备密钥，注册公钥部分，盖上 `kid` 并安装**机器级** unit
> （[ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)）——当某个环节失败时，它会点名要重试的命令，参见
> [安装程序没有完成安装时](#instalador-nao-fecha)。
> 留在项目界面上的是**绑定到某个项目**的配对：那种设备密钥和 `brabo-runner.config.json` 仍然来自那里
> （[ADR 0118](adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)）。
> 用 `install.sh --print-plan` 检查一切，它不会触碰任何东西。

验证：`.github/workflows/install-e2e.yml` 在每个最终 tag 上，在一台**干净**的机器上、在真实的 pty 下运行上面的单行命令——安装程序、整个栈、第一个账号、机器密钥，以及 agent 接手第一个项目。每个 PR 中，`scripts/dev/install*.spec.ts` 这些 spec 证明不需要 Release 的部分：计划和状态（`install.spec.ts`）、经 Compose 自身解析器解析的
`.env`（`install-env.spec.ts`）、收尾步骤
（`install-fechamento.spec.ts`）、被拒绝的调用方式
（`install-invocacao.spec.ts`）、下载的文件
（`install-arquivos-da-instalacao.spec.ts`）、broker 的提问
（`install-broker.spec.ts`），以及 E2E 本身没有腐坏
（`install-e2e.spec.ts`）。**迁移**路径——备份、证明、删除、安装、恢复——没有端到端执行：E2E 的机器是干净的，所以这个问题从不会被提出，只有恢复证明的 `.env` 传递有 spec
（`scripts/dev/prova-de-restauracao-env.spec.ts`）。

### 安装中的容器 broker {#broker-na-instalacao}

**容器**和**挂载目录**模式的项目在容器内运行，而启动这个容器的是 **broker**
（[ADR 0144](adr/0144-a-segunda-raiz-do-broker.md)）。没有它，这两种模式都永远无法执行：`container_start` 以 `failed` 和 `BrokerIndisponivelError` 结束，dev agent 停留在 `dev.blocked_by_container`。**Runner** 模式不依赖它——在那里，本地 agent 使用你机器上的 Docker。

自 [ADR 0162](adr/0162-broker-publicado-e-oferecido-pelo-instalador.md) 起，broker 是**第五个发布的镜像**（`ghcr.io/daneiel/brabo-broker`，按 digest，与其他四个一样签名），安装用的 compose 中有这个服务——**默认关闭**，位于与验证用 compose 相同的 `container-broker` profile 之下。安装程序会**询问**（*"Ligar o broker de container?
[s/N]"*），紧接在项目 base 之后，并用文字说明启用它会授予什么：broker 会拿到**这台机器的 Docker socket**，谁控制 broker 就控制你的 Docker。约束它的是
[ADR 0130](adr/0130-broker-de-container.md) 的五层：没有发布端口、只有 api 能访问的网络（`internal: true`，没有互联网）、service token、针对**一个**项目容器的五个操作，以及 broker 根据 Arquiteto 的决定自行组装的 spec——没有任何请求能开启
`privileged`、主机网络或任意的 `-v`。

| 回答 | 会发生什么 |
|---|---|
| **`s`** / **`sim`** | 它**在容器内部**测量 socket 的组（使用 broker 自己的镜像，无网络，只读，socket 以 `--mount` 挂载，以便缺失的 socket 是错误，而不是在你的主机上创建一个空目录），计算 Docker 存放受管目录卷的位置，并把 `COMPOSE_PROFILES=container-broker`、`BROKER_URL=http://broker:8090`、`DOCKER_GID` 和 `PROJECT_WORKSPACES_HOST_ROOT` 写入 `.env`——四个一起 |
| 回车、`n`、其他任何输入 | 关闭。`.env` 不会获得这四行中的任何一行，最后的摘要会写 *"Broker de container: DESLIGADO"* |
| 没有终端 | 关闭，并且它会说明——在没人能回答的地方不会提问 |

**两种拒绝和两项待办，全部具名：**

- *"não consegui medir o grupo do socket do Docker…"*——测量失败（rootless 或远程 Docker：socket 不在 `/var/run/docker.sock`，而 compose 挂载的就是这个路径）。什么都没有写入。重新运行并回答**否**，或修正消息中提到的 Docker 问题。它从不会代之以写入一个猜测的 `999`。
- *"… não é um socket …"*——同样的结果，同样的修复。
- 待办 *"a raiz da pasta gerenciada…"*——计算出的
  `<DockerRootDir>/volumes/brabo_project_workspaces/_data` 与栈启动后卷的真实 `Mountpoint` 不一致（或者 `docker info` 没有说明卷在哪里）。**挂载目录**项目可以工作；**容器**项目不行，直到你修正 `PROJECT_WORKSPACES_HOST_ROOT`——消息中带有守护进程报告的值以及重建 broker 的命令。
- 待办 *"o broker de container: a api NÃO o alcançou…"*——服务启动并且健康，但 api 在内部网络上无法访问它。`docker
  compose -f docker/docker-compose.install.yml logs broker` 会说明原因。

`--env-file` 中的 `COMPOSE_PROFILES` 让 `up -d --wait` 在命令行不带任何标志的情况下启动 broker——在 Compose v5.5.1 上测得。镜像变量 `BRABO_BROKER_IMAGE` **无论你是否启用它都会写入**：Compose 在按 profile 过滤之前会对整个文件做插值，所以已关闭服务中的必需变量仍会让文件被拒绝。

**之后再启用**（在 `.env` 所在的同一目录）：

```bash
# 1. o grupo do socket COMO UM CONTAINER O VÊ — com a própria imagem do broker,
#    sem rede; é este o número de que o compose precisa
docker run --rm --network none --read-only --entrypoint stat \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
  "$(grep '^BRABO_BROKER_IMAGE=' .env | cut -d= -f2)" -c '%F %g' /var/run/docker.sock
# esperado: socket <gid>

# 2. onde o Docker guarda o volume da pasta gerenciada
docker volume inspect --format '{{.Mountpoint}}' brabo_project_workspaces

# 3. acrescente ao .env (as quatro — nunca uma sem as outras)
#    COMPOSE_PROFILES=container-broker
#    BROKER_URL=http://broker:8090
#    DOCKER_GID=<gid do passo 1>
#    PROJECT_WORKSPACES_HOST_ROOT=<caminho do passo 2>

# 4. recrie — a api também, para ela pegar o BROKER_URL
docker compose -f docker/docker-compose.install.yml --env-file .env up -d --wait

# 5. pergunte antes de afirmar
docker compose -f docker/docker-compose.install.yml --env-file .env exec -T api \
  node -e "fetch('http://broker:8090/health').then(r=>r.text()).then(console.log)"
# esperado: {"status":"ok","servico":"broker"}
```

**关闭：**从 `.env` 中删除这四行，然后删除 broker 容器，并在没有 `BROKER_URL` 的情况下重建 api：

```bash
docker compose -f docker/docker-compose.install.yml --env-file .env \
  --profile container-broker rm -sf broker
docker compose -f docker/docker-compose.install.yml --env-file .env up -d --wait
```

`up --remove-orphans` **不会**完成第一步——测得：位于已关闭 profile 之下的服务仍然在文件中*有定义*，所以它的容器不是孤儿，会继续运行。你的项目中什么都不会被删除；容器和挂载目录项目停止执行，项目界面也不再提供它们
（[ADR 0161](adr/0161-a-tela-so-oferece-o-modo-que-a-instalacao-executa.md)）。

验证：**在安装时**启用它是经过证明的——提问及其拒绝由每个 PR 中的 `scripts/dev/install-broker.spec.ts` 证明，整条路径由每个最终 tag 上的 `.github/workflows/install-e2e.yml` 证明，它回答*是*，并要求 broker 已启用、api 能访问它，以及 `COMPOSE_PROFILES` 和
`BROKER_URL` 已写入 `.env`。通过上面五条命令**之后**再启用它，以及关闭它，**没有验证**：没有任何东西运行它们，而 `up --remove-orphans` 的注意事项只手动测过一次。

### 安装中的本地模型 {#modelos-locais-na-instalacao}

紧接在 broker 之后，`install.sh` 会询问 `Ligar os modelos locais? [s/N]`
（[RN-691](business-rules/produto.md#rn-691)）。它会先说明代价——Ollama 镜像以及 `ollama-model-loader` 在启动时下载的模型所占的磁盘，模型加载期间占用的内存——以及没有它们会失去什么：故事和规则的语义重复检查会被跳过，agent 没有本地模型。只有输入 "s" 才会启用它们；没有终端时它们保持关闭。

启用它们会在写入任何东西之前测量主机端口：`11434`，或直到 `11443` 的第一个空闲端口（原生 Ollama 通常占用 `11434`）。整个范围都被占用是一个具名拒绝，不会写入任何东西。`.env` 获得 `OLLAMA_PORT`，并在唯一的 `COMPOSE_PROFILES` 行中加入 `llm`。

要**之后**再启用它们，在安装目录中：选择一个空闲端口，然后在 `.env` 中添加 `OLLAMA_PORT=<porta>`，用逗号把 `llm` 加到已有的
`COMPOSE_PROFILES` 行（或创建 `COMPOSE_PROFILES=llm`），然后运行
`docker compose -f docker/docker-compose.install.yml --env-file .env up -d --wait`。

验证：提问、端口测量和 `.env` 中的行由每个 PR 中的 `scripts/dev/install-llm.spec.ts` 证明。安装的 E2E 回答*否*（下载模型每个 tag 要花费数 GB），所以以
`llm` profile 启动**没有端到端验证**。

### 从零重新安装 {#reinstalar-do-zero}

当发现之前的安装时（只计名称恰好为
`brabo` 的 compose 项目——dev compose `brabo-dev` 不算，
[RN-692](business-rules/produto.md#rn-692)），迁移会运行备份、证明可以恢复，然后询问
`Apagar os volumes e reinstalar? [s = restaurar / z = do zero / N = parar]`。
`z` 会删除并重新安装，**不恢复**旧数据；已证明的备份留在它点名的目录中，之后要恢复它就是
[恢复](#restore)。由 `scripts/dev/install-llm.spec.ts` 证明。

---

## 验证已发布的产物 {#verificar-artefato-publicado}

每个最终 tag 都会对其发布的内容签名，使用 `cosign` **keyless**——签名身份就是 workflow 本身，任何地方都没有托管的密钥（[ADR 0149](adr/0149-assinatura-dos-artefatos-publicados.md)，
[RN-524](business-rules/ci.md#rn-524)）。下面是**你**在 CI 之外进行检查的方式。

两条命令都需要两个 `--certificate-*` 标志。它们不是可有可无的装饰：没有它们，`cosign` 会接受**任何人**的有效签名，而这正是整个机制要避免的失败。

### 按 digest 验证镜像 {#an-image-by-digest}

```bash
# O digest vem do .release/images.json, que é um asset da Release
# — nunca de uma tag, que é um ponteiro móvel.
DIGEST=$(gh release download vX.Y.Z --pattern images.json --output - \
  | jq -r '.imagens[] | select(.alvo == "api") | .digest')

cosign verify \
  --certificate-identity-regexp '^https://github.com/daneiel/brabo/\.github/workflows/release\.yml@' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  "ghcr.io/daneiel/brabo-api@${DIGEST}"
```

### runner 的二进制文件 {#the-runner-binaries}

一个已签名的 `checksums.txt` 覆盖四个目标（自 [ADR 0174](adr/0174-runner-sem-binario-darwin-x64.md) 起 Intel Mac 没有二进制文件——它使用
`npm install -g @brabo/runner`），所以验证分两步：先验证清单的签名，再对照清单验证二进制文件。

```bash
gh release download vX.Y.Z --pattern 'checksums.txt*' --pattern 'brabo-runner-*'

cosign verify-blob \
  --bundle checksums.txt.bundle \
  --certificate-identity-regexp '^https://github.com/daneiel/brabo/\.github/workflows/build-runner-binaries\.yml@' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  checksums.txt

# Só depois de o manifesto ser provado autêntico é que conferir o binário quer
# dizer alguma coisa — um checksums.txt que ninguém verificou é um arquivo que o
# atacante também consegue escrever.
sha256sum -c checksums.txt --ignore-missing
```

### 验证失败时 {#when-verification-fails}

**不要安装。** 无法验证的签名恰好有两种解读——产物不是流水线发布的那个，或者流水线没有发布它——两者都不是继续的理由。检查身份正则是否与实际发布该 tag 的 workflow 匹配（通过 `workflow_dispatch` 重新发布会以相同的身份签名），然后把它当作事件而不是噪声来处理。

**这不覆盖的内容：**runner 二进制文件的操作系统代码签名——macOS 公证和 Windows Authenticode。这些需要付费的签名身份，是单独的 backlog 项；系统在第一次运行时仍会发出警告。

### 每个已发布产物中的书面源代码提供 {#oferta-de-fonte-na-imagem}

签名回答的是*"这是流水线发布的吗？"*。第二个问题随同一个镜像一起传递，答案不同：**其中 GPL 软件的源代码在哪里？**

engine 镜像内嵌了 `git`、`busybox`、`libgcc`/`libstdc++` 以及另外 18 个 GPL 许可的 apk 包，外加 engine 通过 `exec` 调用的四个扫描器。把它们作为独立进程运行不会污染仍为 MIT 的 Brabo——但*分发*镜像要求接收者能够获取相应的源代码。自 [ADR 0119](adr/0119-imagens-publicadas-no-ghcr-por-digest.md)
起，这种分发在每个最终 tag 上都会发生。

书面提供就是 `THIRD_PARTY_NOTICES.md`，它放在镜像**之内**，因为运行 `docker pull` 的人没有仓库：

```bash
docker run --rm --entrypoint sh ghcr.io/daneiel/brabo-engine:vX.Y.Z \
  -c 'cat /usr/share/doc/brabo/THIRD_PARTY_NOTICES.md'
```

它点名每个组件、确切版本和许可证，这让任何人都能找到每个组件的上游 release。

自 AT-120 起，同一个文件以相同的路径和形式（所有者 root、
`0644`、在 `USER` 之前复制）放在**每个**已发布的镜像中——除
`brabo-engine` 外还有 `brabo-api`、`brabo-web`、`brabo-broker` 和 `brabo-backup`——并作为 Release 的
`THIRD_PARTY_NOTICES.md` 资产放在 runner 二进制文件旁边，由同一个已签名的
`checksums.txt` 覆盖（RN-524）。这是维护者的决定，也是保守的决定：没有任何产物被声明为豁免。在上面的命令中把 `brabo-engine` 换成其他四个中的任何一个即可。在 AT-120 之前，这条命令在 engine 镜像上以 "Permission denied" 失败：BuildKit 把 `COPY --chmod=0644` 也应用到了 `COPY` 创建的目录上，所以 `/usr/share/doc/brabo` 没有执行位，镜像的非 root 用户无法进入它。现在每个 Dockerfile 都会先以 `0755` 创建该目录。对于 runner：

```bash
gh release download vX.Y.Z --repo daneiel/brabo \
  --pattern THIRD_PARTY_NOTICES.md --pattern checksums.txt
sha256sum -c --ignore-missing checksums.txt
```

如果某个产物中缺少这个文件，该产物就不应被分发。`scripts/ci/oferta-de-fonte-na-imagem.spec.ts` 防止每个 `COPY` 和 Release 资产被意外删除，而 `ci.yml` 的步骤
`A oferta de fonte está dentro das cinco imagens` 会从它构建的每个镜像中读回该文件并与 checkout 比较——但只有真正的 tag 才能证明已发布的产物。

该文件还记录了**尚未**解决的事项：把扫描器拆分到独立的 sidecar、使 engine 镜像不含 copyleft，作为*架构*选择而非合规问题，仍然开放。

---

## 升级第三方镜像 {#subindo-imagem-de-terceiro}

`docker/` 和 `deploy/k8s/` 中的每个第三方镜像都**按 digest** 固定，其来源 tag 写在**引用之内**、digest 之前（[ADR 0159](adr/0159-imagem-de-terceiro-por-digest.md)，
[ADR 0178](adr/0178-tag-inline-na-imagem-de-terceiro.md)）。`.github/workflows/` 中的 workflow **不**保存镜像字面值：它们的 `services:` 通过 `imagens-do-compose.yml` 从 dev compose 读取引用
（[ADR 0197](adr/0197-a-imagem-dos-workflows-vem-do-compose.md)），所以升级 compose 也就升级了 CI：

```yaml
image: neo4j:5.26-community@sha256:d9cfe82983d27f5a75b3aaae8f316d04f9a698a3b7f6103a508f7caf8362f255
```

**Dockerfile** 在 `FROM` 行中采用同样的形式——绝不在行尾加注释：Docker 的解析器只接受行首的 `#`，行尾的 `#` 会让构建以 *"FROM requires either one or three
arguments"* 失败：

```dockerfile
FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6 AS runtime
```

这是一种**冻结**。自 ADR 0197 起，Dependabot 的 `docker-compose`（`docker/` 中的 compose）和 `docker`（`docker/*/` 中的 `FROM` 行以及 `deploy/k8s/` 中的清单）生态每周提出升级，每个生态一个分组 PR，提交到 `dev`。审查这个 PR 就是本流程的第 1 和第 4 步。仍有两种情况会回到这里：

- **`neo4j` 和 `ollama` 同时位于某个 compose 和 `deploy/k8s/base/` 中**，而两个生态从不共用一个 PR。当 registry 以另一个 digest 重新发布**同一个** tag 时，两个 PR 都会在 lint 中失败（"mesma tag inline, dois
  digests"）；用下面的第 3 步把两次升级合并到一个 PR 中。
- 没有任何生态读取的两个镜像（见下文）。

手动移动一个镜像——比如把 `neo4j` 从 `5.26-community` 升到 `5.27-community`：

```sh
# 1. Confirme que a tag resolve para um ÍNDICE (uma manifest list). Se não,
#    o pin perde o multi-arch e o linux/arm64 para de funcionar.
docker manifest inspect neo4j:5.27-community | head -3
#    → "mediaType": "application/vnd.oci.image.index.v1+json"
#      (ou …distribution.manifest.list.v2+json)

# 2. Leia o digest do índice.
docker buildx imagetools inspect neo4j:5.27-community --format '{{.Manifest.Digest}}'

# 3. Escreva `neo4j:5.27-community@<digest>` EM TODO LUGAR onde a referência antiga aparece.
#    Não em .github/workflows/: os workflows leem pgvector e ollama do
#    compose de dev (ADR 0197), e o lint reprova um literal ali.
grep -rn 'neo4j:5.26-community@sha256' docker/ deploy/k8s/

# 4. O lint prova.
node scripts/ci/imagens-pinadas.ts
```

无论 Dependabot 做什么，有两个镜像都通过同样的流程手动升级：`deploy/k8s/overlays/local/db/cluster.yaml` 中 CloudNativePG 的 `imageName`（没有任何生态读取这个键），以及 golden-set QA 用例的镜像，
`apps/api/scripts/golden-set-qa-container.ts` 中的 `IMAGEM_DO_GOLDEN_SET_QA`
（一个 TypeScript 常量，由 `golden-set-qa.yml` 读取）。

第 3 步不是可有可无的繁文缛节：检查会拒绝**同一个内联 tag 带有两个不同的 digest**，因为 dev compose 和集群声称同一个版本却运行不同的字节，正是绿色 CI 不再有意义的方式。dev compose 和 CI 之间已没有什么需要对齐的：CI 读取 compose。

要给一个**新**的 workflow 提供第三方服务，绝不要把引用写进 workflow：在 `docker/docker-compose.yml` 中添加该服务的镜像，在
`scripts/ci/imagens-do-compose.ts` 的 `IMAGENS_DOS_WORKFLOWS` 中添加一行，在 `.github/workflows/imagens-do-compose.yml` 中添加对应的输出（它的 spec 会在两者不一致时失败），并在 workflow 中添加一个 `imagens:` 作业，带有
`uses: ./.github/workflows/imagens-do-compose.yml` 以及
`image: ${{ needs.imagens.outputs.<nome> }}`。

检查**不**覆盖的内容及原因，见
[CI 的供应链](explanation/cadeia-de-suprimentos-do-ci.md#container-images-digest-with-the-tag-alongside)：产品发布的五个镜像已经由
`.release/images.json` 和 `make imagens-do-release` 按 digest 解析
（[ADR 0119](adr/0119-imagens-publicadas-no-ghcr-por-digest.md)）——绝不要在 overlay 中手动固定它们，overlay 故意保留占位标记。

---

## 添加兼容的 provider {#adicionando-um-provider-compativel}

适用于任何使用 OpenAI `/chat/completions` 方言的 provider——几乎所有 hub 和托管推理服务都是如此。基础已经存在
（[ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)）；你写的是**配置**，而不是解析。

### 1. 写第一行之前先阅读官方文档 {#1-read-the-official-doc-before-writing-the-first-line}

有四件事必须来自 provider 的文档，而不是猜测：
`baseUrl`、认证请求头、流中 `usage` 的格式，以及流式传输的特殊之处。在配置文件顶部记录查阅的 URL 和日期——这是几个月后判断配置是否过时的唯一方法。

与 OpenAI 标准不同的地方要成为**基础中的一个 flag**，绝不是散落各处的 `if`。如果差异放不进现有的 flag，就添加一个——并且只因为这个真实的 provider 需要它。

### 2. 编写配置 {#2-write-the-config}

```ts
// apps/api/src/infrastructure/llm/<provider>-provider.ts
export function meuProviderConfig(baseUrl = BASE_URL): OpenAICompatibleConfig {
  return {
    name: 'meu-provider',
    baseUrl,
    capabilities: { streaming: true, toolCalling: true, listModels: true },
    authHeaders: (apiKey) => ({ Authorization: `Bearer ${apiKey ?? ''}` }),
    flags: { streamOptionsIncludeUsage: true, maxTokensField: 'max_tokens' },
    // Só se o catálogo dele devolve mais que `{ data: [{ id }] }`:
    // parseCatalogo: (corpo) => ...,
    // Só se for um HUB (informa quem de fato serviu a requisição):
    // extrairUpstreamProvider: (frame) => ...,
  };
}
```

导出配置函数，而不只是类：契约测试套件正是把伪造服务器指向它。在测试中手写一份配置副本，即使生产配置有差异也会通过。

### 3. 针对它运行契约测试套件 {#3-run-the-contract-suite-against-it}

```ts
runLLMProviderContract('meu-provider', () => ({
  dialeto: dialetoOpenAI, // reaproveite o da base se o formato é o mesmo
  criar: (baseUrl) =>
    new OpenAICompatibleProvider(meuProviderConfig(baseUrl), new GptTokenizerEstimator()),
  usageFallback: 'estimated',
  timeoutEnv: 'LLM_REQUEST_TIMEOUT_MS',
  temFerramentasNoPedido: (body) => Array.isArray(body.tools),
  modelo: 'algum-modelo',
}));
```

免费继承：帧被拆分的流式传输、usage 存在与缺失、tool calling、四种规范化错误、目录，以及一个沉默的服务器。

### 4. 注册 provider 和凭据类型 {#4-register-the-provider-and-the-credential-kind}

1. **故意放在两个地方**：`packages/shared/src/index.ts` 中的 `LLMProviderName` 类型（web 也使用它）和
   `apps/api/src/domain/llm/llm-provider-names.ts` 中的运行时列表 `LLM_PROVIDER_NAMES`。它们不能放在一起：`packages/shared` 100% 是类型——从那里导出的值会让 api 的生产镜像在启动时以
   `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` 崩溃，而
   `apps/api/test/packages-shared-so-tipos.spec.ts` 会在那之前就判定失败。忘记列表不会静默通过：双向的穷尽性检查会让 typecheck 失败，web 的穷尽 `Record` `ROTULO_DO_PROVIDER` 也会失败，直到该 provider 获得一个标签；
2. 如果是 hub，把名字加入 `apps/web/src/lib/models.ts` 的 `HUBS`，以便它落入选择器中正确的分组；
3. api 的 provider 注册表（`llm-infrastructure.module.ts`）；
4. 如果名字是新的，在 schema 中添加 provider 的 `pgEnum` 并新增一个 migration。

### 5. 用文档中的价格为模型填充种子数据 {#5-seed-the-models-with-the-price-from-the-docs}

手动输入的价格带有 `manual_pricing: true`。这会保护该行不被价格同步覆盖：对于不在目录中公开价格的 provider，手动数字是唯一存在的数字。

如果 provider 公开 `GET /models`，**不要为整个目录填充种子**——让同步去发现它。同步写入的模型是禁用的，owner 通过策展界面启用重要的模型
（[RN-043](business-rules/api.md#rn-043)）。

如果 provider 的目录公布了**模态**（接受图像、生成图像）或 `reasoning`，就在它的 `parseCatalogo` 中输出——并且只在官方文档这么说时。provider 未声明的字段保持**省略**，绝不是 `false`：`undefined` 会保留已记录的内容，而 `false` 会抹掉手工策展的数据
（[RN-056](business-rules/api.md#rn-056)）。

### 6. 用真实凭据验证 {#6-verify-with-a-real-credential}

```bash
# na tela de configurações do projeto: cadastre a credencial, depois
# "Atualizar catálogo" e confira o relatório por provider.
```

报告显示**每个** provider，包括被跳过的，并附带原因和失败来源。`sem_credencial` 意味着密钥从未到达；`falha · origem infra` 意味着甚至没有到达 provider；`falha · origem modelo` 意味着它以拒绝作答。

验证：第 2–4 步在每个 PR 中得到证明——契约测试套件
（`apps/api/test/contract/llm-provider.contract.ts`，由每个 provider 的 `*.contract.spec.ts` 运行）针对伪造服务器，以及在任一列表缺少名字时会失败的 typecheck。第 6 步**本质上是手动的**：它需要一个有余额的真实凭据，而 CI 没有。按 provider 的 `*.smoke.spec.ts` 文件是它的脚本化形式，没有密钥时会跳过——环境中只有 OpenRouter 的凭据（参见 `CLAUDE.md` 中关于 LLM smoke 的
`TODO(humano)`）。

---

## 流程及其验证方式 {#procedimentos-e-verificacao}

本页中每个**运维**流程，连同证明它的文件以及运行这项证明的东西。诊断类章节（看起来出问题时怎么做）和开发环境的章节不在这里：它们是寻找原因的方法，而不是可以通过或失败的流程。

- **verification** 点名证明该流程的 spec、脚本、workflow 或 `make` 目标，或者以 **None** 开头并如实说明。部分证明会点名它覆盖什么、不覆盖什么。
- **schedule** 说明是什么在无人记得的情况下运行它：定时 workflow
  （`weekly`）、每个 pull request（`every PR`）、每个最终 tag
  （`every tag`），或者 `manual`——必须有人记得。

表头和 **schedule** 列中的类别词故意保留为英文：它们是机器词汇，由 `pnpm docs:check` 读取。它读取这张表，并在以下情况判定失败：**verification** 中的文件不在仓库中、`make` 目标不在 `Makefile` 中、单元格为空或写着“见下文”、锚点不是本页的标题，或者 **schedule** 中的 workflow 没有单元格所声称的触发器
（`weekly` 对应 `schedule:`，`every PR` 对应 `pull_request`，`every tag` 对应 `push: tags`）。工作原理见
[文档如何保持活力](explanation/documentation-workflow.md#the-runbook-procedures-table)。

| procedure | anchor | verification | schedule |
|---|---|---|---|
| Subir a stack num cluster local | [Deploy local](#deploy-local) | `make deploy-local` termina com `make smoke-k8s` (`deploy/k8s/smoke.sh`); a execução agendada faz o mesmo `deploy/k8s/bootstrap.sh` e smoke | weekly `.github/workflows/propriedades.yml` |
| Validar uma tag da esteira (`TAG=`) | [Validar uma tag da esteira](#validar-tag-do-pipeline) | **None.** Nenhum workflow passa `TAG=`; o checkout destacado da tag só roda à mão | manual |
| Provar que o HPA do engine escala | [Deploy local](#deploy-local) | `make hpa-test` (`deploy/k8s/hpa-test.sh`) | weekly `.github/workflows/propriedades.yml` |
| Validar os overlays sem cluster | [Deploy local](#deploy-local) | `make k8s-validate` (`deploy/k8s/validate.sh`) | every PR `.github/workflows/ci.yml` |
| Fazer deploy das imagens de uma release | [Fazendo deploy das imagens de uma release](#imagens-de-uma-release) | `scripts/ci/aplicar-imagens.spec.ts` prova a leitura do manifesto da release, `scripts/ci/images-manifest.spec.ts` os digests entregues ao `kustomize`; rodá-lo no overlay e aplicar os digests de uma release real: nenhuma | every PR `.github/workflows/ci.yml` (o spec); manual (a corrente) |
| Fazer rollout do engine | [Rollout do engine](#rollout-do-engine) | `make rollout-test` (`deploy/k8s/rollout-test.sh`); os coletores de evidência dele por `scripts/ci/rollout-evidencia.spec.ts` | weekly `.github/workflows/propriedades.yml`; every PR `.github/workflows/ci.yml` (os coletores) |
| Aumentar a janela de drain | [Aumentar a janela de drain](#aumentar-a-janela-de-drain) | **None própria.** `make rollout-test` prova só o par do overlay local (drain de 20 s, grace de 90 s); rode-o de novo com os valores aumentados | manual |
| Fallback para sealed-secrets | [Segredos: fallback para sealed-secrets](#fallback-sealed-secrets) | **None.** Nada roda `kubeseal`; o cluster agendado usa External Secrets | manual |
| Verificar um backup no Kubernetes | [O caminho automatizado](#restore-automatizado) | `make test-restore` (`deploy/k8s/test-restore.sh`) e a quebra deliberada `make test-restore-mutacao` | weekly `.github/workflows/propriedades.yml` |
| Verificar um backup numa instalação compose | [O caminho automatizado](#restore-automatizado) | `make test-restore-compose` (`docker/backup/test-restore-compose.sh`); o repasse do `.env` dele por `scripts/dev/prova-de-restauracao-env.spec.ts` | weekly `.github/workflows/propriedades.yml`, job `restore-compose` (a prova); every PR `.github/workflows/ci.yml` (o spec) |
| Restaurar de verdade durante um incidente | [Restaurando de verdade](#restore-de-verdade) | passos 1–2: `make test-restore` (o mesmo `brabo-restore`, as mesmas consultas do `docker/backup/restore.sh`); passo 3, promover `DATABASE_URL`: nenhuma, nunca exercitado | weekly `.github/workflows/propriedades.yml` (passos 1–2); manual (passo 3) |
| Verificar e recuperar os bare repos | [Recuperando os bare repos](#restore-dos-bare-repos) | `scripts/ci/backup-lib.spec.ts` (as funções); `make test-restore-compose` (o comando que verifica, na imagem); `--restaurar` na imagem: nenhuma | every PR `.github/workflows/ci.yml` (o spec); weekly `.github/workflows/propriedades.yml`, job `restore-compose` (o comando que verifica); manual (`--restaurar`) |
| Reprojetar o grafo | [Perda do grafo](#perda-do-grafo) | `make test-reprojecao` (`apps/api/test/scripts/reprojetar-grafo.spec.ts`, pulado nos PRs, que não têm Neo4j) e `make test-reprojecao-k8s` (`deploy/k8s/test-reprojecao.sh`) | weekly `.github/workflows/propriedades.yml` |
| Reprojetar a pasta de artefatos | [Perda da pasta de artefatos](#perda-da-pasta-de-artefatos) | `apps/api/test/scripts/reprojetar-artefatos.spec.ts` e `make test-reprojecao-artefatos-k8s` (`deploy/k8s/test-reprojecao-artefatos.sh`, o comando dentro da imagem da api) | every PR `.github/workflows/ci.yml` (o spec); weekly `.github/workflows/propriedades.yml` (o caminho da imagem) |
| Rotacionar `AUTH_JWT_SECRET` | [`AUTH_JWT_SECRET`](#rotacao-do-auth-jwt-secret) | `apps/api/test/infrastructure/security/ed25519-access-token-issuer.spec.ts` e `apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts` | every PR `.github/workflows/ci.yml` |
| Trocar `AUTH_TOKEN_PEPPER` | [`AUTH_TOKEN_PEPPER`](#troca-do-auth-token-pepper) | `apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts` | every PR `.github/workflows/ci.yml` |
| Rotacionar `BRABO_SERVICE_TOKEN` | [`BRABO_SERVICE_TOKEN`](#rotacao-do-brabo-service-token) | `apps/api/test/infrastructure/security/service-token.spec.ts`, `apps/api/test/interfaces/engine-service.guard.spec.ts`, `apps/engine/test/engine_web/plugs/verify_service_token_test.exs`, `apps/engine/test/engine/runtime_service_token_test.exs`, `apps/broker/src/config.spec.ts` e `scripts/ci/previous-nos-composes.spec.ts` | every PR `.github/workflows/ci.yml` |
| Pôr e aposentar um `_PREVIOUS` no Kubernetes | [Fazendo no Kubernetes](#rotacao-no-kubernetes) | `scripts/ci/previous-nos-composes.spec.ts` mantém o `ExternalSecret` em `dataFrom.extract` sem `_PREVIOUS` em `data:`; o sync por um External Secrets Operator de verdade: `make test-rotacao-chave-mestra-k8s` (`deploy/k8s/test-rotacao-chave-mestra.sh`) acrescenta e remove `CREDENTIALS_MASTER_KEY_PREVIOUS` por ele; as outras chaves `_PREVIOUS`: nenhuma automatizada | every PR `.github/workflows/ci.yml` (o spec); weekly `.github/workflows/propriedades.yml` (o `_PREVIOUS` da chave mestra); manual (as outras chaves) |
| Destravar uma conta por SQL | [Conta travada por lockout](#conta-travada-por-lockout) | **None.** As duas consultas foram conferidas contra o schema por leitura; `apps/api/test/application/use-cases/auth/lockout.spec.ts` cobre o lockout, não elas | manual |
| Rotacionar a chave mestra | [Rotação da chave mestra](#rotacao-da-chave-mestra) | `apps/api/test/scripts/rewrap-deks.spec.ts` e `apps/api/test/infrastructure/security/envelope-encryption.service.spec.ts`; os três passos no cluster: `make test-rotacao-chave-mestra-k8s` (`deploy/k8s/test-rotacao-chave-mestra.sh`) | every PR `.github/workflows/ci.yml` (os specs); weekly `.github/workflows/propriedades.yml` (o ensaio) |
| Cortar o gasto num incidente de custo | [Incidente de custo](#incidente-de-custo) | `apps/api/test/runbook/sql-do-incidente-de-custo.spec.ts` roda o SQL da seção, nos dois idiomas, contra o schema migrado; passos (b) e (d), na tela: nenhuma | every PR `.github/workflows/ci.yml` |
| Subir a observabilidade sem cluster | [Observabilidade local](#observabilidade-local) | `scripts/dev/observabilidade-pronta.mjs`, uma autoverificação no fim do `pnpm dev:obs`, sem spec | manual |
| Conferir o registro de gates na imagem | [Registro de gates](#registro-de-gates) | `docker/smoke.sh` chama as duas rotas contra a imagem de produção; as funções de gate dele por `scripts/ci/smoke-gates.spec.ts` | every PR `.github/workflows/ci.yml` |
| Instalar | [Instalando](#instalando) | `.github/workflows/install-e2e.yml` (máquina limpa) e `scripts/dev/install*.spec.ts`; o caminho de migração de ponta a ponta: nenhuma | every tag `.github/workflows/install-e2e.yml`; every PR `.github/workflows/ci.yml` (os specs) |
| Ligar ou desligar o broker da instalação | [O broker de containers numa instalação](#broker-na-instalacao) | na instalação: `scripts/dev/install-broker.spec.ts` e `.github/workflows/install-e2e.yml`; ligá-lo depois à mão, e desligá-lo: nenhuma | every tag `.github/workflows/install-e2e.yml`; every PR `.github/workflows/ci.yml` (o spec); manual (depois, e desligar) |
| Ligar os modelos locais da instalação | [Modelos locais numa instalação](#modelos-locais-na-instalacao) | na instalação: `scripts/dev/install-llm.spec.ts`; ligá-los depois à mão: nenhuma | every PR `.github/workflows/ci.yml` (o spec); manual (depois) |
| Reinstalar do zero sobre uma instalação anterior | [Reinstalando do zero](#reinstalar-do-zero) | `scripts/dev/install-llm.spec.ts` | every PR `.github/workflows/ci.yml` |
| Verificar um artefato publicado | [Verificando um artefato publicado](#verificar-artefato-publicado) | os workflows de publicação verificam o que assinaram, na mesma execução: `.github/workflows/release.yml` (`cosign verify`) e `.github/workflows/build-runner-binaries.yml` (`cosign verify-blob`) | every tag `.github/workflows/release.yml` `.github/workflows/build-runner-binaries.yml` |
| Conferir a oferta escrita de fonte | [A oferta escrita de fonte](#oferta-de-fonte-na-imagem) | `scripts/ci/oferta-de-fonte-na-imagem.spec.ts` mantém cada `COPY` e o asset da Release; as cinco imagens construídas a partir do PR, lidas de volta pelo `.github/workflows/ci.yml`; os artefatos publicados levando o arquivo: nenhuma | every PR `.github/workflows/ci.yml` (o spec e as imagens construídas); manual (os artefatos publicados) |
| Subir uma imagem de terceiro | [Subindo uma imagem de terceiro](#subindo-imagem-de-terceiro) | `scripts/ci/imagens-pinadas.ts`, `scripts/ci/imagens-pinadas.spec.ts` e `scripts/ci/imagens-do-compose.spec.ts` | every PR `.github/workflows/ci.yml` |
| Acrescentar um provider de LLM compatível | [Acrescentando um provider compatível](#adicionando-um-provider-compativel) | passos 2–4: `apps/api/test/contract/llm-provider.contract.ts`, rodado pelo spec de contrato de cada provider; passo 6, com credencial real: nenhuma no CI — os specs de smoke pulam sem chave | every PR `.github/workflows/ci.yml` (passos 2–4); manual (passo 6) |

