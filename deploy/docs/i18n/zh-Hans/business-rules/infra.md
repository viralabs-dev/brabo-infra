---
traducao_de: 715e7330f7f738c55bc7cd3a0d770a0fc9304e11
id: rn-infra
title: 'Regras de negócio — Infra'
sidebar_label: Infra
description: 'As RNs hospedadas na raiz infra.'
keywords: [regras de negócio, infra]
---

# Infra

### RN-224 — 迁移自行以幂等方式创建 pgvector 扩展 {#rn-224}

迁移 `0045` 在创建表之前执行 `CREATE EXTENSION IF NOT EXISTS vector`，而不是假设 `docker/postgres/init.sql` 已经运行过——那个文件只在 Postgres 卷*首次*初始化时执行，使用旧卷的环境可能没有这个扩展。`IF NOT EXISTS` 是幂等的：本地（扩展已经安装）和新环境都经过同一行，行为没有差别。

- **位置：** `apps/api/src/db/migrations/0045_shallow_randall.sql`
- **ADR：** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

## `dbre` 角色变成两个机械脚本（RN-400..403，ADR 0093）

### RN-402 — 备份报告精确地重读 `collectBackup()` 的逻辑，从不使用第二种计算方式 {#rn-402}

`relatorio-backup.ts` 不是新的 Prometheus gauge——它是对 `backup_runs` 的**相同**读取，即 `DomainGaugesCollector.collectBackup()` 已经在做的（最后一次**成功**，用于年龄和大小；**最后一次**执行，用于捕捉连续几天失败但有一个较旧的好备份的情况），只是按需进行。`avaliarBackup` 是纯函数——接收两行和当前时刻，返回 `status`
（`ok`|`atrasado`|`nunca_houve`|`falha_recente_com_sucesso_antigo`）。“延迟”阈值（26 小时 = `BACKUP_AGE_ATRASADO_SEGUNDOS`）与告警 `brabo-backup-atrasado`
（`deploy/k8s/observability/alerts/brabo-alerts.yaml`）的**相同**，是复制的（不是导入的——Grafana 的 YAML 不被 Node 进程读取），如果一边改了而另一边没改，就可能产生分歧。

- **位置：** `apps/api/scripts/relatorio-backup.ts`（`avaliarBackup`，第
  82 行；`BACKUP_AGE_ATRASADO_SEGUNDOS`，第 54 行）
- **测试：** `apps/api/test/scripts/relatorio-backup.spec.ts`——从未有过备份、备份正常、延迟、恰好在阈值上（不算延迟）、近期失败但有较旧的成功、延迟优先于近期失败、年龄从不为负
- **ADR：** [0093](../adr/0093-dbre-linter-de-migracao-e-relatorio-de-backup.md)

### RN-403 — 备份报告**不**重新执行恢复；它指向已经测试过的流程 {#rn-403}

真正的恢复流程（`make test-restore` /
`deploy/k8s/test-restore.sh`）已经执行过，并记录在
`docs/runbook.md#restore` 中，真实的 RTO（针对约 108 KB 的数据库约 40 秒）记录在该文档的“最近一次已验证的执行”一节。
`relatorio-backup.ts` 回答一个更窄、更频繁的问题——“这次恢复会使用的备份现在健康吗？”——并为真正需要恢复的人引用运维手册，而不是复制或重新执行该流程。

- **位置：** `apps/api/scripts/relatorio-backup.ts`（`imprimir` 的最后一条消息，引用 `docs/runbook.md#restore`）
- **测试：** 不适用（这是指向运维手册的静态文本，不是逻辑）；已测试流程的存在本身是
  `docs/runbook.md#restore` 的 RN
- **ADR：** [0093](../adr/0093-dbre-linter-de-migracao-e-relatorio-de-backup.md)

---

## 仪表盘上的“N 个智能体在线”——**实时**状态，从不是历史在场（RN-409，ADR 0097）

### RN-413 — 提示词模板存放在代码之外，在图中版本化 {#rn-413}

在这次交付之前，每个智能体提示词都是内联的 Elixir heredoc——身份（`Engine.Harness.Agents`）、PO/Arquiteto/Dev
Lead/UX/Infra 的启动、`ContextManager` 的摘要提示词。提示词模板现在可以作为 `(:PromptTemplate {name})-[:HAS_VERSION]->
(:PromptVersion {version, body, hash, active})` 存放在 Neo4j 中，通过
`POST /internal/graph/prompt-templates` 写入，通过 `GET
/internal/graph/prompt-templates/:name` 读取。Upsert 按哈希幂等——把**相同**的内容写两次不会创建新版本，只会返回已存在的哈希相同的版本。

第一批提取到 `prompts/*.md`（front-matter `name`/`version`，占位符记录在“Variáveis”一节中，对应原 `.ex` 中的插值片段）：`ux-designer-identity`、
`psychologist-kickoff`、`anamnese-kickoff`、`context-manager-summarize`。
`scripts/dev/seed-prompts.ts` 读取 `prompts/*.md`，计算正文的 sha256 哈希并发送到上述端点。**这次交付中没有编辑任何 `.ex`**——四个 GenServer 继续使用内联文本；从图中消费模板（`InstructionFiles` 的 `:graph` 来源，优先级
`db > graph > dir > root`）是下一波，在此声明为范围之外。

- **位置：** `apps/api/src/application/use-cases/graph/upsert-prompt-template.use-case.ts`、
  `get-prompt-template.use-case.ts`；`apps/api/src/interfaces/http/internal/internal-graph.controller.ts`；
  `prompts/*.md`、`prompts/README.md`；`scripts/dev/seed-prompts.ts`
  （`SECAO_DE_DOCUMENTACAO`、`corpoSemDocumentacao`、`parseFrontMatter`）
- **测试：** 使用模拟 `GraphStore` 的用例（相同哈希的 upsert 不会重复）+ 针对真实 Neo4j 的集成测试，不可用时优雅跳过；`scripts/dev/seed-prompts.spec.ts`
  （front-matter 解析、确定性哈希、格式错误的模板以清晰消息失败；以及自 AT-244 起对**所有**
  `prompts/*.md` 的扫描：播种的正文不含文档小节，每个占位符在其中只出现一次，摘要器通过 engine 的同一渲染只接收一次轮次）

> **自 AT-244 起**，每个文件的“## Variáveis”一节**不**被播种：模板正文在 `## Variáveis` 这一行结束，播种器丢弃从它开始的内容。之前正文携带整个小节——引用正文中相同 `{{placeholders}}` 的文档——而由于每个消费者都替换**所有**出现（`String.replace/3`），在 `graph_templates_enabled?` 开启时模型会收到文档和数据**两次**：`ContextManager` 的摘要器收到双倍的轮次，Psicólogo 和 Anamnese 的启动收到双倍的事件日志，UX 的身份（在
> `graph_instruction_templates_enabled?` 之后）在每一轮都收到文档。四个文件都有这种形式；切分放在**播种器**中，而不是渲染中，因为每个消费者有一个渲染，而“什么是正文”是关于文件的问题，只有播种器读取文件。版本已经提升（`anamnese-kickoff` 和
> `ux-designer-identity` 升至 `"2"`，`psychologist-kickoff` 和
> `context-manager-summarize` 升至 `"3"`），提示词文本**相同**。**在已经播种过的安装中不会自行修复**：图中的**活动**版本仍是带文档的旧版本，直到再次运行 `scripts/dev/seed-prompts.ts`——正文的哈希变了，因此播种器会创建新版本并停用之前的版本。在开关关闭时（默认值），这个缺陷从未存在：使用的是内联文本，它从来没有这一节。
- **来源：** 产品负责人的决定，灵感来自仓库
  [ErickWendel/neo4j-ai-experiments](https://github.com/ErickWendel/neo4j-ai-experiments)
  （见 [ADR 0099](../adr/0099-neo4j-grafo-de-conhecimento-e-templates.md)）

---

### RN-415 — Ollama 模型在启动时得到保证，RAG 的降级被声明 {#rn-415}

`nomic-embed-text`（`RAG_EMBEDDING_MODEL`）从未被自动拉取——这是真实的缺陷，不只属于这个功能：`ollama` 服务的入口点只拉取 `llama3.2:1b`，在任何干净环境中 RAG 都会**静默**降级为仅词法检索，没有任何迹象表明这在发生。新服务 `ollama-model-loader`（一次性，`docker-compose.yml` dev 和 prod），读取 `OLLAMA_REQUIRED_MODELS`
（默认 `gemma3:1b,yi-coder:1.5b,nomic-embed-text`），附加于现有的
`ollama` 服务——其入口点保持不动。

降级不再是静默的：`rag_search`（RN-414）和 api 的混合检索在 embedding 失败时早已返回 `degraded: true`——缺少的是一个让这个标志可见的**消费者**。现在工具存在了，模型自己就会在格式化文本中看到提示，而 model-loader 降低了降级首先发生的可能性。

- **位置：** `docker/docker-compose.yml`、`docker/docker-compose.prod.yml`、
  `docker/ollama/pull-models.sh`；`deploy/k8s/base/neo4j/`、
  `deploy/k8s/base/ollama/job-model-loader.yaml`（模板，**没有**接入任何 kustomization——`deploy/k8s/` 还没有可指向的 `ollama` Service，如今接上会在每次真实部署中导致 CrashLoopBackOff）
- **测试：** `scripts/dev/verificar-modelos-ollama.sh`，用一个真实的小模型（`all-minilm`）端到端执行，以免在共享机器上付出生产列表数 GB 的代价
- **来源：** 在构建知识图谱基础时发现——见
  [ADR 0100](../adr/0100-rag-search-e-modelos-garantidos-no-boot.md)

---

## 本地 runner 的终端永远卡在“Abrindo terminal...”（RN-433）

在 `runner` 模式（ADR 0103/0104）下测试一个新项目并打开 Code → Dev → 终端时发现：屏幕从未离开加载骨架，控制台循环显示 `socket do terminal com erro`/`socket do terminal fechado`，退避时间不断增长直到稳定在约 5-6 秒——这是 `phoenix.js` **默认**退避的模式。

### RN-433 — 终端 socket 在超时后放弃，`ENGINE_PUBLIC_URL` 的默认值可由**浏览器**访问，端点不重复路径 {#rn-433}

三个叠加的缺陷。前两个是在调查症状时发现的；**第三个**只在修正前两个之后才出现——没有它们，浏览器永远到达不了 engine，也就无法揭示底下的路径缺陷。只修正一个会让其他的依然存在：

1. `ENGINE_PUBLIC_URL`（RN-419）在
   `docker/docker-compose.yml` 中从来没有任何默认值——只有 `ENGINE_URL`（`http://engine:4000`，一个**只**在 Compose 网络内部解析的主机名）。代码的后备（`process.env.ENGINE_PUBLIC_URL ?? process.env.ENGINE_URL ?? …`，
   `request-runner-ticket.use-case.ts`）悄悄地落到错误的值上，浏览器试图对一个它永远无法解析的主机名打开 WebSocket。`docker/docker-compose.yml` 在 `api` 服务中加入了
   `ENGINE_PUBLIC_URL: ${ENGINE_PUBLIC_URL:-http://localhost:4000}`——与 `VITE_ENGINE_URL` 在 `web` 服务中已使用的**相同**默认值，原因也相同。
2. 即使 URL 正确，一个**永远**打不开的传输（engine 宕机、防火墙、未来错误的重新配置）也没有任何上限：
   `apps/web/src/lib/terminal-channel.ts` 从未向 `Socket` 传递 `reconnectAfterMs`，于是 `phoenix.js` 落入它的**默认**退避，自己永远尝试重连——模块自己的 docblock 早已声明“没有自动重连”的意图（与
   `session-channel.ts`/RN-108 相同的标准），但实际上从未兑现。没有 `onError`/`onClose` 调用 `handlers.onErro`，`TerminalPanel` 就卡在 `'carregando'`（RN-088——每个屏幕都区分加载中/错误/空——被悄悄违反）。修正方法是让 `reconnectAfterMs` 返回一个几乎永远不会触发的值（24 小时，与 `session-channel.ts` 相同的模式），并设置一个**自己**的 8 秒超时
   （`TIMEOUT_CONEXAO_MS`）：如果在此之前 `onOpen` 没有触发，模块就以可操作的消息调用 `handlers.onErro` 并断开连接。
3. **真正阻止连接的缺陷，被上面两个掩盖了**：`terminal-channel.ts` 把 `'/runner/websocket'` 拼接到一个 api 已经返回**完整**的
   `engineWsUrl` 上——`ws://host:porta/runner`
   （`engineWsUrlPublico()`）——而 `phoenix.js` 的 `Socket` **自己**还会在构造函数中自行追加 `/websocket`
   （`this.endPoint = ${endPoint}/websocket`）。结果以 `GET /runner/runner/websocket/websocket` 打到 engine，被
   `Phoenix.Router.NoRouteError` 拒绝——在这次修正的端到端验证期间于 engine 日志（`docker logs brabo-engine-1`）中得到确认。`apps/runner/src/channel.ts`（CLI 一侧）早已做对了——把 `engineWsUrl` 原样传给 `Socket`，不做改动——而 `terminal-channel.ts` 的测试从未发现，因为
   `getTerminalTicket` 的模拟使用的 `engineWsUrl`（`http://engine.local`，没有
   `/runner`）不反映 api 的真实契约；一并修正。
   修复：`terminal-channel.ts` 改为直接使用 `engineWsUrl`（只做防御性的 `.replace(/^http/, 'ws')`），不拼接任何路径。

针对 `exp001` **端到端**验证（`runner` 模式，没有真实的 `brabo-runner` 连接）：修正之前，标签页永远转圈；修正之后，engine 日志显示 `CONNECTED TO EngineWeb.RunnerSocket` →
`JOINED terminal:<projectId>` → `pty_resize descartado — sem runner
conectado`，屏幕在不到 1 秒内显示带有
`brabo-runner` 命令的 `RunnerOnboardingPanel`——从不是第 2 项的 8 秒超时，后者作为 engine 真正宕机情况下的安全网保留。

- **位置：** `docker/docker-compose.yml`、`.env.example`、
  `apps/web/src/lib/terminal-channel.ts`
- **测试：** `apps/web/src/lib/terminal-channel.test.ts`（永不打开的 socket 在超时内调用 `onErro`，没有 phoenix 的自动重连；模拟的 `engineWsUrl` 已修正以反映真实契约——已带 `/runner`，没有 `/websocket`——正常路径的断言改为要求 `Socket` 使用的 URL 与 ticket 的 `engineWsUrl` **相同**，没有拼接）
- **ADR：** 无——缺陷修正，恢复 ADR
  0103/0104 和模块自己的 docblock 早已声明为意图的行为
- **来源：** 在 `runner` 模式下手动测试新项目时发现；第 3 项只在浏览器中针对真实 engine 端到端验证第 1/2 项的修正时才出现

---

## dev 引导中的原生 Ollama 与 Hugging Face 模型拉取（RN-461..463，ADR 0114/0115）

### RN-461 — 原生 Ollama：只问一次，答案持久化到 `.env`，永不再问 {#rn-461}

`scripts/dev/preflight.mjs` 检测已经在
`OLLAMA_PORT`（与原生安装相同的默认值 11434）上监听的原生 Ollama，并通过 HTTP（`GET /api/tags`）确认它确实是 Ollama，而不是端口上的任意进程。确认后，**只问一次**是否使用这个实例——没有 TTY 时默认“是”（`bootstrap.sh` 有意以 `/dev/null` 作为 stdin 运行该命令，以免抢走用户的方向键）——并把答案写入 `.env`（`OLLAMA_MODE=host|container`）。从那以后检测甚至不再运行：`OLLAMA_MODE` 已经存在时，函数提前返回。`ollama`/`ollama-model-loader` 在 compose 中加入 `profiles:
["local-llm"]`，以便在模式为 `host` 时不启动。重新打开这个问题的**唯一**方式是专门的菜单项“Docker ›
Reconfigurar Ollama”，它会删除已写入的键——只要它们存在，就永远不会再次自发地提问。

- **位置：** `scripts/dev/env-file.mjs:41`（`escreverEnv`）、
  `scripts/dev/preflight.mjs:157`（`ehOllama`）、
  `scripts/dev/preflight.mjs:202`（`perguntarUsoDoOllama`）、
  `scripts/dev/preflight.mjs:238`（`detectarOllamaNativo`）、
  `scripts/dev/reconfigurar-ollama.sh`、`scripts/dev/perfil-ollama.sh`、
  `docker/docker-compose.yml:82,119`（`profiles: ["local-llm"]`）
- **测试：** `scripts/dev/bootstrap.spec.ts`（覆盖菜单的接线——Deploy › All/Create 中的条件 profile 和专门的“Reconfigurar Ollama”菜单项）。检测/持久化逻辑本身
  （`detectarOllamaNativo`/`escreverEnv`）是针对一个假 HTTP 服务器和这台机器上的真实 Ollama 手动端到端验证的（见 ADR 0114）——**声明的缺口**：如今 `preflight.mjs` 没有自己的自动化测试套件。
- **ADR：** [0114](../adr/0114-deteccao-de-ollama-nativo-no-bootstrap-dev.md)
- **来源：** 产品负责人的请求，执行期间的真实发现（与原生 Ollama 的端口冲突）

## 在宿主机上同意基准目录（RN-511）

### RN-511 — 基准目录在宿主机上**同意**一次，共享通过**挂载**来证明，没有终端时该步骤只报告而不同意 {#rn-511}

[RN-500](api.md#rn-500) 构建了基准目录，并说明了它缺失时该做什么——
`projectsBase: null`，不提供“挂载文件夹”模式。缺少的是有人**请求**配置它：产品中没有任何东西这样做，结果是一个就绪的模式对安装者来说无法到达。

同意步骤位于 `pnpm bootstrap`（`Docker › Base de
projetos`），建议 **`$HOME/projetos-brabo`** 并接受输入的其他路径。这个名称不是偏好：`.env.example` 已经用 `~/brabo-projetos` 作为
`PROJECT_WORKSPACES_HOST_DIR`（**产品**管理的根目录）的示例，给两个变量建议同一个名称就是走进 ADR 0141 拒绝的冲突——`<base>/loja` 会落在与一个 `workspace_dir_name` 也是 `loja` 的 `container` 项目相同的物理文件夹中，引导程序会在另一个项目内执行 `git init`。

**名称只是规避；保护靠机制。** `validarBase` 拒绝任何在**两个**方向上与 Brabo 的检出（RN-500 已有的守卫）**或** `PROJECT_WORKSPACES_HOST_DIR`（新规则）重叠的候选，还拒绝 `~`、相对路径和根目录。拒绝适用于**输入**的路径，而不只是默认值；一个选得好的默认值只是避免让拒绝成为用户看到的第一件事。

**Docker Desktop 的共享通过**挂载**来证明，从不从 `settings.json` 读取。** 那个文件没有文档，在不同版本之间以及 macOS 与 Windows 之间都会变化，并且描述的是用户**配置**了什么——而不是守护进程会做什么。这与 ADR 0041/0042 的“capability 只有在被执行证明时才声明”是同一标准，应用于宿主机。证明是一个**哨兵**，而不是干巴巴的 `ls`：空文件夹和未共享的文件夹会产生同样的空列表，所以脚本写入一个文件并询问容器是否看到它。只在 macOS 和 Windows（`process.platform`）上；在 Linux 上没有共享列表，检查是存在性和可写性。这是产品的**第二个**平台守卫，与第一个（runner 中的 `validarDirDentroDoHomeNoLinux`）对称：每个都只在限制有意义的地方进行限制。

证明有**三种结果，它们不折叠**：已证明；被否决（变量**不**被写入，拒绝点名路径以及在哪里添加它）；以及*无法证明*——没有本地 Docker 镜像可用于挂载——它会写入变量并**大声说出证明没有运行**，附上之后运行它的命令。“我没能看”变成“一切都好”，正是一个未共享的基准会以容器带着空文件夹启动的形式到达用户的方式，远离做出选择的屏幕。

**没有 TTY 时，该步骤**报告**而什么都不做。** `bootstrap.sh` 的菜单项以来自 `/dev/null` 的 stdin 运行——有意如此，否则任何读取 stdin 的东西都会抢走用户的方向键——因此从那里脚本只能报告，输出会说出提问的命令。这与 `perguntarUsoDoOllama` 的设计相同，它在没有终端时应用默认值并提示，而不是卡住。一个在 CI 管道中自行“同意”的同意脚本是对这个词的否定。出于同样的原因，`preflight.mjs` **报告**基准目录的状态而从不提问：答案是某人磁盘上的一个路径，不存在可以静默应用的默认值。

`mkdir -p` 只在接受和校验**之后**才发生——从一个尚未通过拒绝检查的路径创建文件夹，就是在进程能到达的任何地方创建文件夹。已存在的值未经确认从不被覆盖。

- **位置：** `scripts/dev/consentir-base.mjs`（I/O：询问、证明、创建、写入）；`scripts/dev/base-de-projetos.mjs:143`（`basePadrao`）、`:177`
  （`validarBase`）和 `:208`（`exigeProvaDeCompartilhamento`）——纯决策；
  `scripts/dev/env-file.mjs`（`lerEnv`/`escreverEnv`，从
  `preflight.mjs` 中提取，后者在顶层运行 `await main()`，因此不能被导入）；`scripts/dev/bootstrap.sh`（第 `1.6` 项）；
  `scripts/dev/preflight.mjs`（`relatarBaseDeProjetos`）
- **测试：** `scripts/dev/base-de-projetos.spec.ts`（`describe('basePadrao')`、
  `describe('validarBase')`——正常路径和六种拒绝——以及
  `describe('exigeProvaDeCompartilhamento')`）；`scripts/dev/bootstrap.spec.ts`
  （菜单树，25 个叶子）
- **ADR：** [0146](../adr/0146-base-consentida-no-bootstrap.md)
- **来源：** FASE 28，第 2 次会话

---

## broker 在本地 compose 中默认启动（RN-512）

### RN-512 — broker 只在**本地** compose 中离开 `profiles`，`DOCKER_GID` 开始在 preflight 中被报告 {#rn-512}

broker 诞生于 `profiles: ["container-broker"]` 之下，理由是 ADR 0130 自己写的：*“dar acesso ao Docker do host a um processo que
nada chama ainda seria uma mudança de postura para toda máquina de
desenvolvimento, em troca de nada”*。两半都已失效。**“没有东西调用它”是假的**，自 ADR 0133/0134/0136 起——broker 有四个真实调用方。而当 ADR 0144 让 `mounted` **经由 broker** 启动容器、ADR 0146 让 `mounted` 成为本地默认值时，**“换来的什么都没有”就不再描述这种交换**：profile 关闭时，默认模式以 `BrokerIndisponivelError` 结束。

于是它在 `docker/docker-compose.yml` 中离开了 `profiles`——**只在那里**。在
`docker/docker-compose.prod.yml` 中 profile **保留**，两个文件开始有意地分歧。

**这种不对称在于 socket 在两边意味着什么。** 运行 `pnpm dev` 的人**已经拥有 Docker 的 socket**——他在运行 `docker compose`，针对的是自己宿主机的守护进程——所以 broker 获得它并不授予运维人员本就没有的任何东西。边际攻击面是 broker 自己的 HTTP，它不发布端口，位于只有 api 能到达的 `internal: true` 网络中，并以恒定时间比较 `BRABO_SERVICE_TOKEN`。在生产中计算恰恰相反：socket 是真正的权限边界，运维人员不是开发者，而这个阶段的任何东西都不改变生产安装的默认模式。

**五层约束不被触碰。** 这改变的是 broker **何时**运行，从不改变它**接受什么**：它继续接收 `projectId` 和五种操作之一，继续去 api 读取 Arquiteto 的决定，继续没有任何可以写入 `privileged`、`cap_add`、
`network: host` 或自由 `-v` 的参数。约束从来就不是 profile。

**环境后果，以及为什么它获得了报告。** `DOCKER_GID` 不再只对有意开启 profile 的人重要——按定义那个人是在留意它的——而是对任何运行 `pnpm dev` 的人都有效。socket 在宿主机上是 `root:docker`，而 broker 的进程以非 root 运行；compose 的 `group_add` 赋予它该组，默认值 `999` 最常见，但在好几个发行版中是错的。弄错**不会让启动失败**——broker 正常启动——却会让**使用**失败：每个操作都在 socket 上以 `permission denied` 死掉，症状在很久之后、有人提议 `container_start` 时才出现。因此 `preflight.mjs` 开始在每次 `pnpm dev` 时**报告**状态。

报告有**三种结果，它们不折叠**：一致；不一致（附上有效值的来源——`configurado` × `default`——因为两者需要不同的指示）；以及**不适用**，当机器没有 `docker` 组时。第三种既不是错误也不是“没能查看”：在 macOS 和 Windows 上 Docker Desktop 不使用 unix 组，而在 rootless Docker 中 socket 属于用户自己。把缺失当作不一致，会指控一半的机器有它们并不存在的缺陷——与 `baseSobrepoeOCheckout` 对未知检出返回 `false` 的谨慎相同。并且它**只报告，从不阻断**：`pnpm dev` 照样启动。

**离开 `profiles` 还不够，缺陷只在第一次默认启动时才出现。** 开发镜像在构建时以 **root** 用 `corepack` 准备 pnpm，却以 uid 1000 运行，后者读不了那个缓存；没有缓存，corepack 会在启动时尝试**下载** pnpm，而 broker 唯一的网络是 `internal: true`——尝试以 `getaddrinfo EAI_AGAIN
registry.npmjs.org` 失败，容器在启动五秒后以 1 退出。该服务也没有 healthcheck，所以 `up --wait` 打印 `Healthy`，完全重置在进程已死的情况下宣布“重置完成”。只要服务位于 profile 之下，这就从未出现：有意开启它的人本来就在留意。修正**把 registry 从运行时路径中移除**——`pnpm install` 迁移到**构建**步骤，`COREPACK_HOME` 改为一个属于运行时 uid 的目录——并且**不打开网络**，那是上面五层中的第一层。由于三个 `node_modules` 是挂载在镜像安装内容之上的命名卷，而 Docker 只为**空**卷播种，`docker/broker/entrypoint.sh` 会把这三个与保存在 `/workspace` 之外的一份副本进行对账，该副本带有构建时 `pnpm-lock.yaml` 的 sha256 标记——同一个标记与目录树中的 lockfile 比较时，会提示镜像已过时而不拒绝启动。**生产** compose 没有这个问题：`Dockerfile.prod` 早已在构建阶段安装，从最终镜像中删除了 `corepack`，并且已经有 `HEALTHCHECK`。自 AT-360 起没有镜像再使用 `corepack`（Node 25+ 不再自带它）：pnpm 从 registry 的 tarball 安装，对照记录在 Dockerfile 中的 sha512 校验，放到 `/usr/local/bin`，`COREPACK_HOME` 从 dev 的 broker 中移除——版本与 `packageManager` 相同，启动时就没有可读的缓存，也没有要尝试的下载（在 `--network none` 下测量）。

- **位置：** `docker/docker-compose.yml`（`broker` 服务，没有 `profiles`，带
  `healthcheck`）和 `docker/docker-compose.prod.yml`（带 `profiles`，以及阻止统一两者的注释）；`docker/broker/Dockerfile`（按 sha512 固定的 pnpm、构建时的 `pnpm install` 以及 `/opt/broker-deps` 中的副本）；
  `docker/broker/entrypoint.sh`（三个卷的对账和 lockfile 提示）；`scripts/dev/docker-gid.mjs`（`avaliarDockerGid`、
  `mensagemDoDockerGid`、`GID_PADRAO_DO_COMPOSE`——纯决策）；
  `scripts/dev/preflight.mjs`（`relatarDockerGid`、`gidDoGrupoDocker`）
- **测试：** `scripts/dev/docker-gid.spec.ts`——正常路径、两种不一致（缺少默认值和错误值）、没有 docker 组时的“不适用”，以及恰好**正确**的默认值
- **ADR：** [0146](../adr/0146-base-consentida-no-bootstrap.md)，第 3 点
- **来源：** FASE 28，第 4 次会话

---

## FASE 29 — 一行安装：为所发布的东西签名

### RN-527 — 安装从「自己的」compose 启动，按所选镜像，并在说已安装之前核对健康状况 {#rn-527}

> **由 [RN-575](produto.md#rn-575) 修订（ADR 0162）：** `broker` 服务开始存在于这个 compose 中，在 profile `container-broker` 下默认关闭，只有经同意才由安装程序开启；必需的镜像是「五个」。本规则的其余部分照常有效。

`docker/docker-compose.install.yml` 是在安装者机器上运行的东西，它**不是** `docker-compose.prod.yml`。三处差异，各有原因：

- 五个镜像来自**必需变量**（`${BRABO_API_IMAGE:?…}`），没有默认值。有默认值的话，缺失的变量会用一个没人选择的镜像启动半个栈，错误会表现为奇怪的行为而不是拒绝；
- 任何地方都**没有 `build:` 块**：这个文件不构建，这正是它的要点；
- 这里**不存在 `broker`** 服务，因为它的镜像没有发布（`docker-bake.hcl` 有四个目标）。已声明的后果：使用 `--source=ghcr` 时，`mounted` 项目不启动容器（ADR 0150，决定 7）。

`docker-compose.prod.yml` 保持**不变**——它自称是**校验**用的 compose，是 `docker/smoke.sh` 有意在本地构建时使用的，把它提升会破坏这种用途。两个文件的代价已声明，防止分歧的上限是**机械的**：
`scripts/dev/composes-em-conformidade.spec.ts` 在安装用的 compose 获得了校验用 compose 没有的服务、卷或端口，有任何 `build:` 残留，或第三方镜像放宽到不同 tag 时否决。

**镜像来源是选择，而「官方」是校验的结果。**
`--source=ghcr`（默认）从 Release 的 `images.json` 按 **digest** 解析；`--source=local` 运行 `docker buildx bake`，并**要求工作树干净且位于 tag 上**——从脏工作树构建的镜像不是它自称的那个版本，标记会记录一个谎言。

**密钥只生成一次并持久保存。** [RN-114](api.md#rn-114) 的五个加上 `NEO4J_PASSWORD`，用 `openssl rand` 生成，模板与 `docker/smoke.sh:31-57` 相同——包括 `NEO4J_PASSWORD` 用 `-hex` 而不是 `-base64` 这一细节，因为 `/` 会破坏 `NEO4J_AUTH` 的解析。`.env` 在接收内容「之前」被创建为**空文件且模式为 600**：以用户的 umask 创建再收紧，会让密钥在一段窗口期内可读，而这恰恰是不能有这种窗口的文件。

**而 `.env` 是一个由「COMPOSE」解析的文件，要针对它来证明**（AT-083）。`SECRET_KEY_BASE` 来自 `openssl rand -base64 64`，它在 64 个字符处「换行」：密钥的 88 个字符分成两行，第二行孤零零地留在 `.env` 中。在 100 次生成中测得，Compose 拒绝了 49 次（*"unexpected
character in variable name"*），「接受」了 51 次——密钥被截断为 64 个字符，这仍然是 Phoenix 的最小值，因此毫无警告地启动了。现在所有 base64 都经过 `segredo_base64`（`| tr -d '\n'`），文件由 `escrever_env` 写入——是函数，而不是 `main` 的主体，这样 spec 写入的就是安装所写的「同一个」文件。

**没有 migrate 步骤，也不应该有：** compose 以 `service_completed_successfully` 把 `api` → `migrate-api` 串联起来，`up --wait` 会等待。第二个下令迁移的地方会成为同一真相的第二个来源。

**安装程序在断言之前先询问。** 在 `up --wait`——它已经等待健康检查——之后，它访问 api 和 engine 的 `/health`，然后才说已安装。这是 `reset-total.sh` 付出代价才学会的尺子：它曾在 api 处于 `Exited (1)` 时宣布「reset completo」。

**位置：** `install.sh`（根目录）、`docker/docker-compose.install.yml`。
**测试：** `scripts/dev/install.spec.ts`（计划，没有 TTY 也没有副作用）和
`scripts/dev/composes-em-conformidade.spec.ts`（两个 compose 之间的分歧）；`scripts/dev/install-env.spec.ts` 通过真实的函数生成密钥和 `.env`，把文件交给 `docker compose config` 对照安装用 compose，并要求「每个」密钥「完整」到达各服务（没有 `docker compose` 时跳过并点明原因），旧的生成方式被固定为否决。
**来源：** FASE 29，第 4 次会话（[ADR 0150](../adr/0150-instalador-de-uma-linha.md)）。安装 runner（第 7 次会话）和迁移之前的安装（第 6 次会话）仍不在范围内，`--print-plan` 将它们声明为 `nao-nesta-versao`。

## 备份覆盖作为真相来源的「两个」卷，并且无需集群即可运行（RN-528）

### RN-528 — `git_local_repos` 进入备份，目标可以是磁盘，compose 的恢复复用「同样」的三项校验 {#rn-528}

备份原本只覆盖**一个**数据库，只在**一个**地方运行。三个后果，第三个是需要写代码的：`make test-restore` 需要 `kubectl`、一个集群以及命名空间中的 CronJob `brabo-backup`，而 `docker-compose.prod.yml` 没有任何 `backup` 服务——镜像由 bake 构建，只在 k8s 中使用。迁移一个 compose 安装没有「经过证明」的路径。

**先分类再复制。** 容易的做法是「备份所有卷」，而这是错的：七个卷中，`neo4j_data` 和 `project_workspaces` 是「派生」的，`ollama_data` 可以重新获取，`brabo_projects_base` 属于用户。复制它们会给人覆盖的印象，却没有增加任何可恢复性。真相来源有「两个」：`pgdata`——早已覆盖，作为逻辑转储，绝不是运行中 Postgres 数据目录的拷贝——以及 **`git_local_repos`**，**没有任何备份覆盖它**。provider 为 `local` 的项目把*裸*仓库存放在里面，它「无法」从 Postgres 重建：event log 保存的是叙事，不是 git 对象。runbook 的文字说的正相反（"the
real repositories live in GitHub/GitLab"），正是这句话解释了这个卷为何多年没有覆盖——它对 `github`/`gitlab` 成立，而对 `local` 根本没有上游。

**仓库归档的保证是已声明的，而且比「快照」要弱。** 没有任何东西被静默（quiesce）。所保证的是「按引用」的一致性——git 先写对象再移动 ref，并通过原子 rename 替换 ref，所以跨越一次 `git push` 的 `tar` 拿到的是旧值或新值，绝不会是半个。
「不」保证的是全局瞬间（`tar` 在一段时间内遍历目录树），也不保证对象的连通性（镜像中有意不含 git）。而并发的 `gc` 删除 packfile 会变成「失败」而不是不完整的归档：`tar` 的状态被捕获到一个文件中，因为在 POSIX `sh` 中管道的状态是最后一个命令的状态——没有这一步，不完整的归档会宣称自己是好的，而说谎的备份比失败的备份更糟，因为只有后者会变成告警。`*.lock` 被排除：恢复一个孤立的锁会产生一个所有 `git` 都拒绝操作的仓库。

**目标为磁盘，S3 可选。** 五个 S3 变量不再是必需的，成为它们在实践中早已是的东西——「某一个」目标的配置。定义了 `BACKUP_DIR` 就选择磁盘；不存在则为 S3，这就是 k8s 的 CronJob 无需改动一行就能继续运行的方式。推断（而不是一个必需的目标变量）正是让那条路径保持不变的东西：显式目标会在部署那天、而不是提交那天弄坏 CronJob。四个前缀而不是两个（`daily/`、`weekly/`、`git-daily/`、`git-weekly/`），因为保留是按「数量」计算的：一个前缀下的两类文件会让「保留 7 个」意味着三个半备份。

**compose 的恢复改变的是外壳，绝不是判断。**
`test-restore-compose.sh` 通过与生产相同的镜像和相同的命令触发一次「真实」备份，并调用「同一个」`brabo-restore`，带有「同样」的三项校验（表列表对照源头、备份窗口内关键表的计数、`session_events` 的 `seq` 的稠密连续性）。
`deploy/k8s/test-restore.sh` 保持**不变**——把它们统一起来会让 compose 路径依赖 `kubectl`，而这正是它存在就是为了避免的依赖。`restore.sh` 仍然不触碰「源」数据库，这一属性不因迁移的便利而妥协。只有 compose 能要求的一步是第三步：校验仓库归档，因为在 k8s 中那个卷甚至不挂载到 pod 中（跳过是正确的），而在 compose 下它是挂载的（跳过就是虚假的绿色）。

**恢复仓库是「兄弟」命令，而不是另一个的阶段**——这是两个产物、两种判断，合并它们会让 git 的失败否决 event log 的校验。它默认只做校验，只有带 `--restaurar` 才写入；拒绝在已有仓库之上解压（两种状态的混合不会报任何错误，只会在某次历史错误的 `fetch` 中显现）；并且——真实执行中的发现——当卷不接受写入时，在 `tar` 「之前」拒绝，并点名 `--user 0:0`。`git_local_repos` 由三个 uid 不同的镜像共享，带着最先挂载它的那一方的所有者（实测：`1000:1000`，模式 0755），而本镜像以 uid 70 运行。当解压以 root 运行时，解出的内容会被交还给「目录」的所有者，绝不留为 root：否则卷会完好地回来却毫无用处，api 和 engine 都无法写入刚刚恢复的东西。

**Neo4j 获得的是重新投影，不是备份。** 在一个于另一时刻恢复的 Postgres 旁边恢复一个可能过时的投影，会得到两个源自不同时刻的派生状态，没有任何东西能调和它们。重新投影**并未在这里构建**（那是 BRB-018）：在它存在之前，迁移的安装诞生时图是「空」的——已知且点名的降级，不是数据丢失，因为 RAG 存在于 pgvector 中并随转储一起到来。自 [RN-569](api.md#rn-569) 起它已存在（`grafo:reprojetar`），空图会一直持续到有人运行它。

- **位置：** `docker/backup/lib.sh:28`（`destino_tipo`，保持 CronJob 不变的推断）、`:65`（`destino_esperar` 询问的是「写入」而不是存在）、`:105`（`destino_enviar`，写入 `.parcial` 再 rename）、
  `:181`（裸仓库的保证，与产生它的代码写在一起）、
  `:221`（`git_arquivar`，`tar` 的状态写入文件）、`:259`
  （`git_restaurar`，交还所有者）和 `:273`（`git_raiz_gravavel`）；
  `docker/backup/backup.sh:31`（`destino_preparar`——五个 S3 变量不再必需）、`:149`（仓库卷的三种结果，不把「未挂载」与「空」坍缩）、`:170`（`tar` 状态的核对）和 `:220`（四个前缀的修剪）；
  `docker/backup/restore.sh:28`（与备份相同的目标）以及 `:120`、`:184`、
  `:215`（三项校验和裁决，未改一行）；
  `docker/backup/restore-git.sh:43`（默认校验）、`:109`（拒绝覆盖解压）和 `:123`（因写入而拒绝，并点名修复办法）；
  `docker/backup/test-restore-compose.sh:60`（`--profile` 放在 `config` 中而不是 `run` 中）；
  `docker/docker-compose.prod.yml:392`（`backup` 服务，在 `profiles` 下且 `restart: "no"`）和 `:550`（「不」进入七个卷分类的那个卷）；
  `docker/backup/Dockerfile.prod:80`（在 `USER` 「之前」创建并 `chown` 的 `/backups`）；
  `Makefile:54`（`test-restore-compose`）
- **测试：** `scripts/ci/backup-lib.spec.ts`——在真实的 `sh` 中、针对真实目录运行这些函数：磁盘目标的五个操作；缺失对象测得 0；原子写入以及列表忽略的 `.parcial`；不会混在一起的兄弟前缀；存在但「不」接受写入的目标（失败用例）；「未挂载」× 「已挂载且为空」；状态为 0 且内容被重新读取的仓库归档；排除 `*.lock` 和 `objects/tmp_*`；归档→恢复循环逐字节还原；拒绝在无法写入的地方恢复；以及在「读取」时、绝不按大小否决的截断 tar
- **ADR：** [0152](../adr/0152-backup-de-volumes-contra-compose.md)
- **来源：** FASE 29，第 5 次会话。已针对开发 compose 以真实数据真正执行过（55 张表、422 个事件、`exp001` 和 `exp004` 的裸仓库），包括在一个新卷中恢复并用 `git fsck` 核对——记录在 `docs/runbook.md` 的「Last verified run —
  compose, disk destination」一节中。已声明且「未」做：适配器的 **S3** 路径没有自动化覆盖（需要一个端点），仍然是之前那个 `aws` 命令；Neo4j 的重新投影是 BRB-018；这里没有任何东西在 compose 中安排备份——触发它的是人或安装程序（第 6 次会话）

---

## FASE 29 — 一行安装：为所发布的东西签名

### RN-530 — 迁移要求「经过证明」的备份：安装程序只有在恢复之后才获得删除的权利 {#rn-530}

在现有安装之上安装**不被提供**：要么迁移，要么停下。在另一版本的卷上执行 `up`，是那种不会提前告警的破坏。

迁移有一个顺序，中间那一步赋予了它意义：
**备份 → 「证明」能恢复 → 询问 → 删除 → 安装 → 恢复。**

证明不是过分小心。没人尝试恢复过的备份只是一个文件，而发现这一点的时机不是在 `down -v` 之后——因此安装程序在任何删除之前运行 `docker/backup/test-restore-compose.sh`（与 `restore.sh` 「同样」的三项校验，ADR 0152）。失败的备份或失败的证明**会中断迁移而不删除任何东西**，消息会说明备份留在哪里。

**备份的目标是「宿主机」上的一个文件夹**，这正是迁移与丢失之间的区别所在：compose 的默认值是具名卷 `backup_local`，`down -v` 会把它与想要保留的东西**一起**删除。

**迁移删除的**：安装的具名卷（包括 `pgdata`）、容器和网络。**它绝不删除的**：项目基目录——当 `BRABO_PROJECTS_BASE` 指向宿主机上的文件夹时，compose 中的那一行是 **bind-mount**，`down -v` 不碰 bind——、镜像文件夹（RN-516）以及刚刚证明过的备份。

Postgres 的转储**不会**自动恢复到新数据库上：`brabo-restore` 对照一个测试数据库进行校验，绝不覆盖源头（ADR 0152），而在已有数据的数据库上恢复是安装程序不会自行采取的破坏性操作。本地 git 仓库则会——它们是本会空着诞生的真相来源。

**位置：** `install.sh`、`migrar_instalacao_anterior` 和 `restaurar_apos_migrar`。
**测试：** `scripts/dev/install.spec.ts`——计划声明 `apagar-sem-backup-provado: nunca`，一个测试检查代码中证明的调用位于删除的调用**之前**。
**来源：** FASE 29，第 6 次会话（[ADR 0150](../adr/0150-instalador-de-uma-linha.md)，
[ADR 0152](../adr/0152-backup-de-volumes-contra-compose.md)）。

## 仓库在给 Arquiteto 的 handoff 接受时诞生，没有它执行就不开始（RN-582）

### RN-599 — 在开发 compose 中 api 自行找到 broker，托管文件夹的缺失在每次启动时被说明 {#rn-599}

自 [RN-512](#rn-512) 起 broker 在「开发」compose 中默认启动，但 api 收到的是空的 `BROKER_URL`（`${BROKER_URL:-}`，而该行在 `.env.example` 中被注释掉）。结果，在 9月26日负责人的测试中测得：broker 就在旁边运行，`brokerConfigurado` 却为 `false`，项目创建只放行 `runner`（[RN-573](api.md#rn-573)）。两条规则关闭这一点：

1. **`BROKER_URL` 在开发 compose 中有默认值，且只在那里。** 默认值是 `http://broker:8090`——「同一个」文件声明的服务和端口（`BROKER_PORT`），测试把两者锁在一起：指向别处的默认值会把「没有 broker」换成「broker 不可达」。`.env` 中的值仍然优先。「生产」和「安装」compose 有意保持 `${BROKER_URL:-}`：在那里 broker 位于 `profiles: ["container-broker"]` 之下，开启它的人写入 URL（`install.sh`，经询问——[RN-575](produto.md#rn-575)）。那里的默认值会让没有 broker 的安装的 api 断言它有一个。
2. **`preflight.mjs` 「报告」托管文件夹，仿照 `DOCKER_GID`。** 没有 `PROJECT_WORKSPACES_HOST_DIR` 时，api 和 engine 使用托管卷 `project_workspaces`（没有宿主机路径），broker 没有 `PROJECT_WORKSPACES_HOST_ROOT`——开发 compose 由前者「推导」它——，栈健康地启动，而默认的 `container` 模式的 `container_start` 以被拒绝告终。报告有四种不坍缩的结果：`ausente`、`ok`、`nao-absoluta`（`~`：Compose 在 api/engine 的 bind-mount 源中展开它，但「不」在 broker 收到的变量中展开——用 `docker compose config` 测得）以及 `divergente`（显式的 `PROJECT_WORKSPACES_HOST_ROOT` 与 api 和 engine 挂载的文件夹不同，包括它们挂载的是卷的情况）。每条消息都说明症状和修复办法。它「绝不」拒绝启动，也「绝不」写入 `.env`：答案是某人磁盘上的一个路径，而把卷换成文件夹会隐藏已经在卷中的东西（数据留在那里，只是不再被看到）——消息也说明这一点。

**仍然开放的：** `pnpm bootstrap` 「不」提供这个文件夹。那样做就是第二个 `consentir-base.mjs`（在 TTY 中询问、以正确所有者创建文件夹、一起写入「两个」变量、决定如何处理已有数据的 `project_workspaces` 卷），这是另一条战线。

- **代码：** `docker/docker-compose.yml:266`（`BROKER_URL` 的默认值）、
  `:571`（`PROJECT_WORKSPACES_HOST_ROOT` 的推导）；
  `scripts/dev/pasta-gerenciada.mjs:63`（`avaliarPastaGerenciada`）、`:89`
  （`mensagemDaPastaGerenciada`）；`scripts/dev/preflight.mjs:424`
  （`relatarPastaGerenciada`）
- **测试：** `scripts/dev/broker-url-no-dev.spec.ts:42`（默认值存在）、
  `:47`（指向文件中的服务和端口）、`:64`（生产和安装没有默认值）；`scripts/dev/pasta-gerenciada.spec.ts:31`
  （缺失）、`:51`（`~`）、`:67`（与卷不一致）、`:75`（消息说明症状、修复以及不会迁移的东西）、`:113`（preflight 调用报告而不因它退出）
- **来源：** AT-213——负责人于 2026-09-26 的测试
