---
id: rn-infra
title: 'Regras de negócio — Infra'
sidebar_label: Infra
description: 'As RNs hospedadas na raiz infra.'
keywords: [regras de negócio, infra]
---

# Infra

### RN-224 — A migração cria a extensão pgvector sozinha, de forma idempotente {#rn-224}

A migration `0045` executa `CREATE EXTENSION IF NOT EXISTS vector` antes de
criar a tabela, em vez de assumir que `docker/postgres/init.sql` já rodou —
esse arquivo só executa na PRIMEIRA inicialização do volume Postgres, e um
ambiente com volume antigo pode não ter a extensão. `IF NOT EXISTS` é
idempotente: local (onde a extensão já estava instalada) e um ambiente
novo passam pela mesma linha sem diferença de comportamento.

- **Onde:** `apps/api/src/db/migrations/0045_shallow_randall.sql`
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

## O papel `dbre` vira dois scripts mecânicos (RN-400..403, ADR 0093)

### RN-402 — O relatório de backup relê exatamente a lógica de `collectBackup()`, nunca uma segunda forma de calcular {#rn-402}

`relatorio-backup.ts` não é um gauge Prometheus novo — é a MESMA leitura
de `backup_runs` que `DomainGaugesCollector.collectBackup()` já faz
(último SUCESSO, para idade e tamanho; a ÚLTIMA execução, para pegar o
caso de estar falhando há dias com um backup bom mais antigo), sob
demanda. `avaliarBackup` é pura — recebe as duas linhas e o instante
atual, devolve `status`
(`ok`|`atrasado`|`nunca_houve`|`falha_recente_com_sucesso_antigo`). O
limiar de "atrasado" (26h = `BACKUP_AGE_ATRASADO_SEGUNDOS`) é o MESMO do
alerta `brabo-backup-atrasado`
(`deploy/k8s/observability/alerts/brabo-alerts.yaml`), duplicado (não
importado — o YAML do Grafana não é lido pelo processo Node) e sujeito a
divergir se um lado mudar sem o outro.

- **Onde:** `apps/api/scripts/relatorio-backup.ts` (`avaliarBackup`, linha
  82; `BACKUP_AGE_ATRASADO_SEGUNDOS`, linha 54)
- **Teste:** `apps/api/test/scripts/relatorio-backup.spec.ts` — nunca
  houve backup, backup ok, atrasado, exatamente no limiar (não conta como
  atrasado), falha recente com sucesso antigo, atrasado tem prioridade
  sobre falha recente, idade nunca negativa
- **ADR:** [0093](../adr/0093-dbre-linter-de-migracao-e-relatorio-de-backup.md)

### RN-403 — O relatório de backup NÃO reexecuta o restore; ele aponta para o procedimento já testado {#rn-403}

O procedimento de restaurar de verdade (`make test-restore` /
`deploy/k8s/test-restore.sh`) já foi executado e está documentado em
`docs/runbook.md#restore`, com RTO real (~40s contra um banco de ~108 KB)
registrado na seção "Última execução verificada" daquele documento.
`relatorio-backup.ts` responde uma pergunta mais estreita e mais
frequente — "o backup que esse restore usaria está saudável agora?" — e
cita o runbook para quem precisa de fato restaurar, em vez de duplicar o
procedimento ou reexecutá-lo.

- **Onde:** `apps/api/scripts/relatorio-backup.ts` (mensagem final de
  `imprimir`, citando `docs/runbook.md#restore`)
- **Teste:** não aplicável (é texto estático apontando para o runbook,
  não lógica); a existência do procedimento testado é RN de
  `docs/runbook.md#restore` em si
- **ADR:** [0093](../adr/0093-dbre-linter-de-migracao-e-relatorio-de-backup.md)

---

## "N agentes online" no dashboard — status AO VIVO, nunca presença histórica (RN-409, ADR 0097)

### RN-413 — Templates de prompt vivem fora do código, versionados no grafo {#rn-413}

Todo prompt de agente era heredoc Elixir inline até esta entrega —
identidades (`Engine.Harness.Agents`), kickoffs de PO/Arquiteto/Dev
Lead/UX/Infra, o prompt de sumarização do `ContextManager`. Um template
de prompt agora pode viver como `(:PromptTemplate {name})-[:HAS_VERSION]->
(:PromptVersion {version, body, hash, active})` no Neo4j, gravado via
`POST /internal/graph/prompt-templates` e lido via `GET
/internal/graph/prompt-templates/:name`. Upsert é idempotente por hash —
gravar o MESMO conteúdo duas vezes não cria versão nova, só a versão com
hash igual já existente é devolvida.

Primeira leva extraída para `prompts/*.md` (front-matter `name`/`version`,
placeholders documentados numa seção "Variáveis" para trechos que no
`.ex` original eram interpolação): `ux-designer-identity`,
`psychologist-kickoff`, `anamnese-kickoff`, `context-manager-summarize`.
`scripts/dev/seed-prompts.ts` lê `prompts/*.md`, calcula hash sha256 do
corpo e envia ao endpoint acima. **Nenhum `.ex` foi editado nesta
entrega** — os quatro GenServers continuam com o texto inline; consumir
os templates do grafo (fonte `:graph` do `InstructionFiles`, precedência
`db > graph > dir > root`) é a Onda seguinte, declarada fora daqui.

- **Onde:** `apps/api/src/application/use-cases/graph/upsert-prompt-template.use-case.ts`,
  `get-prompt-template.use-case.ts`; `apps/api/src/interfaces/http/internal/internal-graph.controller.ts`;
  `prompts/*.md`, `prompts/README.md`; `scripts/dev/seed-prompts.ts`
  (`SECAO_DE_DOCUMENTACAO`, `corpoSemDocumentacao`, `parseFrontMatter`)
- **Teste:** casos de uso com `GraphStore` mockado (upsert com mesmo hash
  não duplica) + teste de integração contra Neo4j real, pulando
  graciosamente quando indisponível; `scripts/dev/seed-prompts.spec.ts`
  (parsing de front-matter, hash determinístico, template malformado
  reprova com mensagem clara; e, desde a AT-244, a varredura de TODO
  `prompts/*.md`: o corpo semeado não tem a seção de documentação e cada
  placeholder aparece nele uma vez só, e o sumarizador recebe os turnos uma
  vez só pelo mesmo render do engine)

> **Desde a AT-244** a seção "## Variáveis" de cada arquivo NÃO é semeada: o
> corpo do template termina na linha `## Variáveis`, e o seeder descarta dela
> em diante. Antes o corpo levava a seção inteira — documentação que cita os
> mesmos `{{placeholders}}` do corpo —, e como cada consumidor troca TODAS as
> ocorrências (`String.replace/3`), com `graph_templates_enabled?` ligada o
> modelo recebia a documentação e o dado DUAS vezes: o sumarizador do
> `ContextManager` os turnos em dobro, os kickoffs do Psicólogo e da Anamnese o
> log de eventos em dobro, e a identidade do UX (atrás da
> `graph_instruction_templates_enabled?`) a documentação em todo turno. Os
> quatro arquivos tinham a forma; o corte mora no SEEDER, e não no render,
> porque há um render por consumidor e a pergunta "o que é corpo" é sobre o
> arquivo, que só o seeder lê. As versões subiram (`anamnese-kickoff` e
> `ux-designer-identity` para `"2"`, `psychologist-kickoff` e
> `context-manager-summarize` para `"3"`) com o MESMO texto de prompt. **Não
> fecha sozinho numa instalação que já semeou**: a versão ATIVA no grafo segue
> a antiga, com a documentação, até rodar `scripts/dev/seed-prompts.ts` de
> novo — o hash do corpo mudou, então o seeder cria a versão nova e desativa a
> anterior. Com as flags desligadas (o default) o defeito nunca existiu: vale o
> texto inline, que nunca teve a seção.
- **Origem:** decisão do dono do produto, inspirada no repositório
  [ErickWendel/neo4j-ai-experiments](https://github.com/ErickWendel/neo4j-ai-experiments)
  (ver [ADR 0099](../adr/0099-neo4j-grafo-de-conhecimento-e-templates.md))

---

### RN-415 — Modelos Ollama garantidos no boot, degradação do RAG declarada {#rn-415}

`nomic-embed-text` (`RAG_EMBEDDING_MODEL`) nunca era puxado
automaticamente — bug real, não só desta feature: o entrypoint do
serviço `ollama` só puxava `llama3.2:1b`, e o RAG degradava para
léxico-only em SILÊNCIO em qualquer ambiente limpo, sem nenhum sinal de
que isso estava acontecendo. Serviço novo `ollama-model-loader` (one-shot,
`docker-compose.yml` dev e prod), lendo `OLLAMA_REQUIRED_MODELS`
(default `gemma3:1b,yi-coder:1.5b,nomic-embed-text`), aditivo ao serviço
`ollama` existente — o entrypoint dele continua intocado.

A degradação deixou de ser silenciosa: `rag_search` (RN-414) e a busca
híbrida da api já devolviam `degraded: true` quando o embedding falhava
— o que faltava era um CONSUMIDOR que tornasse essa flag visível. Agora
que a tool existe, o próprio modelo vê o aviso no texto formatado, e o
model-loader reduz a chance de a degradação acontecer em primeiro lugar.

- **Onde:** `docker/docker-compose.yml`, `docker/docker-compose.prod.yml`,
  `docker/ollama/pull-models.sh`; `deploy/k8s/base/neo4j/`,
  `deploy/k8s/base/ollama/job-model-loader.yaml` (template, NÃO wireado
  em nenhuma kustomization — `deploy/k8s/` ainda não tem Service `ollama`
  pra apontar, ligar isso hoje faria CrashLoopBackOff em todo deploy real)
- **Teste:** `scripts/dev/verificar-modelos-ollama.sh`, executado de
  ponta a ponta com um modelo pequeno real (`all-minilm`) para não pagar
  o custo de vários GB da lista de produção numa máquina compartilhada
- **Origem:** achado durante a fundação do grafo de conhecimento — ver
  [ADR 0100](../adr/0100-rag-search-e-modelos-garantidos-no-boot.md)

---

## Terminal do runner local preso em "Abrindo terminal..." para sempre (RN-433)

Achado testando um projeto novo no modo `runner` (ADR 0103/0104) e abrindo
Code → Dev → Terminal: a tela nunca saía do skeleton de carregamento, e o
console mostrava `socket do terminal com erro`/`socket do terminal fechado`
em loop, com backoff crescente até estabilizar em ~5-6s — o padrão do
backoff PADRÃO do `phoenix.js`.

### RN-433 — O socket do terminal desiste depois de um timeout, o default de `ENGINE_PUBLIC_URL` é alcançável PELO BROWSER, e o endpoint não duplica path {#rn-433}

Três defeitos empilhados. Os dois primeiros foram achados investigando o
sintoma; o TERCEIRO só apareceu depois de corrigir os dois primeiros — sem
eles, o browser nunca alcançava o engine pra revelar o bug de path por
baixo. Corrigir só um deixa os outros de pé:

1. `ENGINE_PUBLIC_URL` (RN-419) nunca tinha default nenhum no
   `docker/docker-compose.yml` — só `ENGINE_URL` (`http://engine:4000`,
   hostname que SÓ resolve dentro da rede do Compose). O fallback do
   código (`process.env.ENGINE_PUBLIC_URL ?? process.env.ENGINE_URL ?? …`,
   `request-runner-ticket.use-case.ts`) caía silenciosamente no valor
   errado, e o browser tentava abrir um WebSocket contra um hostname que
   ele nunca resolve. `docker/docker-compose.yml` ganhou
   `ENGINE_PUBLIC_URL: ${ENGINE_PUBLIC_URL:-http://localhost:4000}` no
   serviço `api` — o MESMO default que `VITE_ENGINE_URL` já usa no
   serviço `web`, pelo mesmo motivo.
2. Mesmo com a URL certa, um transporte que NUNCA abre (engine fora do ar,
   firewall, reconfiguração futura errada) não tinha teto nenhum:
   `apps/web/src/lib/terminal-channel.ts` nunca passava `reconnectAfterMs`
   pro `Socket`, então o `phoenix.js` caía no backoff PADRÃO dele e ficava
   tentando reconectar sozinho pra sempre — o próprio docblock do módulo
   já declarava a intenção de "sem reconexão automática" (mesma régua de
   `session-channel.ts`/RN-108), mas nunca era cumprida na prática. Sem
   `onError`/`onClose` chamando `handlers.onErro`, `TerminalPanel` ficava
   preso em `'carregando'` (RN-088 — toda tela distingue carregando/erro/
   vazio — violada em silêncio). Corrigido com `reconnectAfterMs` devolvendo
   um valor que praticamente nunca dispara (24h, mesmo padrão de
   `session-channel.ts`) e um timeout PRÓPRIO de 8s
   (`TIMEOUT_CONEXAO_MS`): se `onOpen` não disparar antes disso, o módulo
   chama `handlers.onErro` com mensagem acionável e desconecta.
3. **O defeito que de fato impedia a conexão, mascarado pelos dois
   acima**: `terminal-channel.ts` concatenava `'/runner/websocket'` a um
   `engineWsUrl` que a api já devolve PRONTO — `ws://host:porta/runner`
   (`engineWsUrlPublico()`) —, e o PRÓPRIO `Socket` do `phoenix.js` ainda
   acrescenta `/websocket` sozinho no construtor
   (`this.endPoint = ${endPoint}/websocket`). O resultado batia no engine
   como `GET /runner/runner/websocket/websocket`, que
   `Phoenix.Router.NoRouteError` recusa — confirmado no log do engine
   (`docker logs brabo-engine-1`) durante a verificação end-to-end desta
   correção. `apps/runner/src/channel.ts` (o lado do CLI) já fazia
   certo — passa `engineWsUrl` direto pro `Socket`, sem tocar — e o teste
   de `terminal-channel.ts` nunca pegou porque o mock de
   `getTerminalTicket` usava um `engineWsUrl` (`http://engine.local`, sem
   `/runner`) que não reflete o contrato real da api; corrigido junto.
   Fix: `terminal-channel.ts` passa a usar `engineWsUrl` (só com o
   `.replace(/^http/, 'ws')` defensivo) direto, sem concatenar path
   nenhum.

Verificado END TO END contra `exp001` (modo `runner`, sem `brabo-runner`
real conectado): antes da correção, a aba girava pra sempre; depois, o
log do engine mostra `CONNECTED TO EngineWeb.RunnerSocket` →
`JOINED terminal:<projectId>` → `pty_resize descartado — sem runner
conectado`, e a tela mostra `RunnerOnboardingPanel` com o comando
`brabo-runner` em menos de 1s — nunca o timeout de 8s do item 2, que
segue como rede de segurança pro caso do engine estar genuinamente fora
do ar.

- **Onde:** `docker/docker-compose.yml`, `.env.example`,
  `apps/web/src/lib/terminal-channel.ts`
- **Teste:** `apps/web/src/lib/terminal-channel.test.ts` (socket que nunca
  abre chama `onErro` dentro do timeout, sem reconexão automática do
  phoenix; `engineWsUrl` do mock corrigido pra refletir o contrato real —
  já com `/runner`, sem `/websocket` — e a asserção do caminho feliz
  passa a exigir a URL usada no `Socket` IGUAL ao `engineWsUrl` do
  ticket, sem concatenação)
- **ADR:** nenhum — correção de bug restaurando o comportamento que o ADR
  0103/0104 e o próprio docblock do módulo já declaravam como intenção
- **Origem:** achado testando manualmente um projeto novo no modo
  `runner`; o item 3 só apareceu ao verificar a correção dos itens 1/2
  ponta a ponta no browser contra o engine real

---

## Ollama nativo no bootstrap dev e pull de modelo Hugging Face (RN-461..463, ADR 0114/0115)

### RN-461 — Ollama nativo: pergunta uma vez, a resposta persiste em `.env`, nunca pergunta de novo {#rn-461}

`scripts/dev/preflight.mjs` detecta um Ollama nativo já escutando em
`OLLAMA_PORT` (mesmo default, 11434, de uma instalação nativa) confirmando
por HTTP (`GET /api/tags`) que é mesmo um Ollama, não qualquer processo na
porta. Confirmado, PERGUNTA uma única vez se é para usar essa instância —
default "Sim" quando não há TTY (o `bootstrap.sh` roda o comando com stdin
de `/dev/null` de propósito, para não roubar as setas do usuário) — e
grava a resposta em `.env` (`OLLAMA_MODE=host|container`). A partir daí a
detecção nem roda de novo: com `OLLAMA_MODE` já presente, a função
retorna cedo. `ollama`/`ollama-model-loader` entram em `profiles:
["local-llm"]` no compose para não subirem quando o modo é `host`. A
ÚNICA forma de reabrir a pergunta é o item de menu dedicado "Docker ›
Reconfigurar Ollama", que apaga as chaves gravadas — nunca uma pergunta
espontânea de novo enquanto elas existirem.

- **Onde:** `scripts/dev/env-file.mjs:41` (`escreverEnv`),
  `scripts/dev/preflight.mjs:157` (`ehOllama`),
  `scripts/dev/preflight.mjs:202` (`perguntarUsoDoOllama`),
  `scripts/dev/preflight.mjs:238` (`detectarOllamaNativo`),
  `scripts/dev/reconfigurar-ollama.sh`, `scripts/dev/perfil-ollama.sh`,
  `docker/docker-compose.yml:82,119` (`profiles: ["local-llm"]`)
- **Teste:** `scripts/dev/bootstrap.spec.ts` (cobre a fiação do menu — o
  perfil condicional em Deploy › All/Create e o item dedicado
  "Reconfigurar Ollama"). A lógica de detecção/persistência em si
  (`detectarOllamaNativo`/`escreverEnv`) foi validada ponta a ponta
  manualmente contra um servidor HTTP fake e contra o Ollama real desta
  máquina (ver ADR 0114) — **lacuna declarada**: não existe suíte
  automatizada própria para `preflight.mjs` hoje.
- **ADR:** [0114](../adr/0114-deteccao-de-ollama-nativo-no-bootstrap-dev.md)
- **Origem:** pedido do dono do produto, achado real durante a execução
  (colisão de porta com Ollama nativo)

## O consentimento da base, no host (RN-511)

### RN-511 — A base é CONSENTIDA uma vez no host, o compartilhamento é provado MONTANDO, e sem terminal o passo relata em vez de consentir {#rn-511}

A [RN-500](api.md#rn-500) construiu a base e disse o que fazer quando ela falta —
`projectsBase: null`, e o modo "Pasta montada" não é oferecido. O que faltava
era alguém **pedir** que ela fosse configurada: nada no produto o fazia, e o
resultado é que um modo pronto ficou inalcançável para quem instala.

O passo de consentimento vive em `pnpm bootstrap` (`Docker › Base de
projetos`), propõe **`$HOME/projetos-brabo`** e aceita outro caminho digitado.
O nome não é preferência: `.env.example` já usa `~/brabo-projetos` como exemplo
de `PROJECT_WORKSPACES_HOST_DIR`, a raiz que o PRODUTO gerencia, e propor o
mesmo nome para as duas variáveis seria andar para dentro da colisão que o
ADR 0141 recusou — `<base>/loja` cairia na mesma pasta física de um projeto
`container` cujo `workspace_dir_name` também fosse `loja`, e o bootstrap daria
`git init` dentro do projeto do outro.

**O nome é só a esquiva; a proteção é mecanismo.** `validarBase` recusa
qualquer candidata que se sobreponha — nos DOIS sentidos — ao checkout do Brabo
(a guarda que a RN-500 já tinha) **ou** a `PROJECT_WORKSPACES_HOST_DIR` (a
regra nova), além de recusar `~`, caminho relativo e a raiz. A recusa vale para
o caminho DIGITADO, não só para o default; um default bem escolhido só evita
que a recusa seja a primeira coisa que o usuário veja.

**O compartilhamento do Docker Desktop é provado MONTANDO, nunca lido de
`settings.json`.** Aquele arquivo não é documentado, muda entre versões e entre
macOS e Windows, e descreve o que o usuário CONFIGUROU — não o que o daemon
fará. É a mesma régua de "capability só é declarada quando provada por
execução" dos ADRs 0041/0042, aplicada ao host. A prova é uma **sentinela**, e
não um `ls` seco: pasta vazia e pasta não compartilhada produzem a mesma
listagem vazia, então o script escreve um arquivo e pergunta se o container o
enxerga. Só em macOS e Windows (`process.platform`); no Linux não há lista de
compartilhamento, e a checagem é existência e escrita. É a SEGUNDA guarda de
plataforma do produto, simétrica à primeira (`validarDirDentroDoHomeNoLinux`,
no runner): cada uma restringe apenas onde a restrição significa alguma coisa.

A prova tem **três desfechos, e eles não colapsam**: provado; reprovado (a
variável **não** é gravada, e a recusa nomeia o caminho e onde adicioná-lo); e
*não consegui provar* — sem imagem Docker local para montar —, que grava a
variável e **diz em voz alta que a prova não rodou**, com o comando para
rodá-la depois. "Não consegui olhar" virar "está tudo bem" é exatamente como
uma base não compartilhada chegaria ao usuário na forma de um container que
sobe com a pasta vazia, longe da tela onde a escolha foi feita.

**Sem TTY, o passo RELATA e não faz nada.** O item de menu do `bootstrap.sh`
roda com stdin vindo de `/dev/null` — de propósito, senão qualquer coisa que
leia stdin rouba as setas do usuário — então de lá o script só pode relatar, e
a saída diz o comando que pergunta. É o mesmo desenho de
`perguntarUsoDoOllama`, que sem terminal aplica o default e avisa em vez de
travar. Um script de consentimento que "consente" sozinho num pipe de CI é a
negação da palavra. Pelo mesmo motivo `preflight.mjs` **relata** o estado da
base e nunca pergunta: a resposta é um caminho no disco de alguém, e não existe
default que se possa aplicar em silêncio.

`mkdir -p` só acontece **depois** do aceite e da validação — criar pasta a
partir de um caminho que ainda não passou pelas recusas é criar pasta em
qualquer lugar que o processo alcance. E valor já presente nunca é sobrescrito
sem confirmação.

- **Onde:** `scripts/dev/consentir-base.mjs` (o I/O: perguntar, provar, criar,
  gravar); `scripts/dev/base-de-projetos.mjs:143` (`basePadrao`), `:177`
  (`validarBase`) e `:208` (`exigeProvaDeCompartilhamento`) — a decisão pura;
  `scripts/dev/env-file.mjs` (`lerEnv`/`escreverEnv`, extraídas de
  `preflight.mjs`, que roda `await main()` no topo e por isso não pode ser
  importado); `scripts/dev/bootstrap.sh` (item `1.6`);
  `scripts/dev/preflight.mjs` (`relatarBaseDeProjetos`)
- **Teste:** `scripts/dev/base-de-projetos.spec.ts` (`describe('basePadrao')`,
  `describe('validarBase')` — caminho feliz e as seis recusas — e
  `describe('exigeProvaDeCompartilhamento')`); `scripts/dev/bootstrap.spec.ts`
  (a árvore do menu, 25 folhas)
- **ADR:** [0146](../adr/0146-base-consentida-no-bootstrap.md)
- **Origem:** FASE 28, sessão 2

---

## O broker sobe por padrão no compose local (RN-512)

### RN-512 — O broker sai do `profiles` no compose LOCAL e só nele, e o `DOCKER_GID` passa a ser relatado no preflight {#rn-512}

O broker nasceu sob `profiles: ["container-broker"]` com uma justificativa que
o próprio ADR 0130 escreveu: *"dar acesso ao Docker do host a um processo que
nada chama ainda seria uma mudança de postura para toda máquina de
desenvolvimento, em troca de nada"*. As duas metades morreram. **"Nada o
chama" é falso** desde os ADRs 0133/0134/0136 — o broker tem quatro chamadores
reais. E **"em troca de nada" deixou de descrever a troca** quando o ADR 0144
fez `mounted` subir container PELO BROKER e o ADR 0146 tornou `mounted` o
padrão local: com o profile desligado, o modo padrão termina em
`BrokerIndisponivelError`.

Então ele sai do `profiles` em `docker/docker-compose.yml` — e **só ali**. Em
`docker/docker-compose.prod.yml` o profile FICA, e os dois arquivos passam a
divergir de propósito.

**A assimetria é o que o socket significa de cada lado.** Quem roda `pnpm dev`
**já tem o socket do Docker** — está rodando `docker compose`, contra o daemon
do próprio host —, então o broker recebê-lo não concede nada que o operador já
não possua. A superfície marginal é o HTTP do próprio broker, que não publica
porta, vive numa rede `internal: true` que só a api alcança, e compara
`BRABO_SERVICE_TOKEN` em tempo constante. Em produção o cálculo é o oposto: o
socket é fronteira de privilégio de verdade, o operador não é o desenvolvedor,
e nada nesta fase muda o modo padrão de uma instalação de produção.

**As cinco camadas de contenção não são tocadas.** Isto muda **quando** o
broker roda, nunca **o que** ele aceita: ele continua recebendo `projectId` e
uma das cinco operações, continua indo à api ler a decisão do Arquiteto, e
continua sem parâmetro nenhum onde se escreva `privileged`, `cap_add`,
`network: host` ou um `-v` livre. A contenção nunca foi o profile.

**A consequência ambiental, e por que ela ganhou relato.** `DOCKER_GID` deixa
de importar só para quem ligava o profile de propósito — alguém que estava, por
definição, prestando atenção nele — e passa a valer para qualquer pessoa que
rode `pnpm dev`. O socket é `root:docker` no host e o processo do broker roda
non-root; o `group_add` do compose é o que lhe dá o grupo, e o default `999` é
o mais comum e está errado em várias distribuições. Errar **não quebra o
boot** — o broker sobe normalmente —, quebra o USO: toda operação morre com
`permission denied` no socket, e o sintoma aparece muito depois, quando alguém
propõe `container_start`. Por isso `preflight.mjs` passa a **relatar** o
estado a cada `pnpm dev`.

O relato tem **três desfechos, e eles não colapsam**: bate; diverge (com a
origem do valor efetivo — `configurado` × `default` — porque as duas pedem
instruções diferentes); e **não se aplica**, quando a máquina não tem grupo
`docker`. O terceiro não é erro nem "não consegui": em macOS e Windows o
Docker Desktop não usa grupo unix, e num Docker rootless o socket é do próprio
usuário. Tratar a ausência como divergência acusaria metade das máquinas de um
defeito que elas não têm — o mesmo cuidado de `baseSobrepoeOCheckout`, que
devolve `false` para checkout desconhecido. E ele **relata, nunca bloqueia**:
`pnpm dev` sobe igual.

**Sair do `profiles` não bastava, e o defeito só apareceu na primeira subida
por padrão.** A imagem de desenvolvimento preparava o pnpm com `corepack` como
**root** no build e rodava como uid 1000, que não lê aquele cache; sem cache o
corepack tenta **baixar** o pnpm no start, e a única rede do broker é
`internal: true` — a tentativa morria com `getaddrinfo EAI_AGAIN
registry.npmjs.org` e o container saía com 1, cinco segundos depois de subir. O
serviço também não tinha healthcheck, então `up --wait` imprimia `Healthy` e o
reset total anunciava "reset completo" com o processo morto. Enquanto o serviço
esteve sob profile isso nunca apareceu: quem o ligava de propósito era quem já
estava olhando. A correção **tira o registry do caminho de runtime** — o
`pnpm install` migra para um passo de BUILD e `COREPACK_HOME` passa a um
diretório com o dono do uid de runtime — e **não abre a rede**, que é a
primeira das cinco camadas acima. Como os três `node_modules` são volumes
nomeados montados por cima do que a imagem instalou, e o Docker só semeia
volume **vazio**, `docker/broker/entrypoint.sh` reconcilia os três contra uma
cópia guardada fora de `/workspace`, carimbada com o sha256 do `pnpm-lock.yaml`
do build — o mesmo carimbo que, comparado com o lockfile da árvore, avisa que a
imagem está velha sem recusar subir. O compose de PRODUÇÃO não sofria disto:
`Dockerfile.prod` já instalava em estágio de build, removia `corepack` da
imagem final e já tinha `HEALTHCHECK`. Desde a AT-360 nenhuma imagem usa
`corepack` (o Node 25+ não o traz): o pnpm é instalado do tarball do registry,
conferido contra um sha512 gravado no Dockerfile, em `/usr/local/bin`, e
`COREPACK_HOME` saiu do broker de dev — com a versão igual à do `packageManager`
não há cache a ler nem download a tentar no start (medido sob `--network none`).

- **Onde:** `docker/docker-compose.yml` (serviço `broker`, sem `profiles`, com
  `healthcheck`) e `docker/docker-compose.prod.yml` (com `profiles`, e a nota
  que impede uniformizar os dois); `docker/broker/Dockerfile` (o pnpm pinado por sha512,
  o `pnpm install` de build e a cópia em `/opt/broker-deps`);
  `docker/broker/entrypoint.sh` (a reconciliação dos três volumes e o aviso de
  lockfile); `scripts/dev/docker-gid.mjs` (`avaliarDockerGid`,
  `mensagemDoDockerGid`, `GID_PADRAO_DO_COMPOSE` — a decisão pura);
  `scripts/dev/preflight.mjs` (`relatarDockerGid`, `gidDoGrupoDocker`)
- **Teste:** `scripts/dev/docker-gid.spec.ts` — o caminho feliz, as duas
  divergências (default ausente e valor errado), o "não se aplica" sem grupo
  docker, e o default que por acaso ACERTA
- **ADR:** [0146](../adr/0146-base-consentida-no-bootstrap.md), ponto 3
- **Origem:** FASE 28, sessão 4

---

## FASE 29 — a instalação de uma linha: assinar o que se publica

### RN-527 — A instalação sobe de um compose PRÓPRIO, por imagem escolhida, e confere a saúde antes de dizer que instalou {#rn-527}

> **Revisada pela [RN-575](produto.md#rn-575) (ADR 0162):** o serviço `broker` passou a
> existir neste compose, desligado sob o profile `container-broker` e ligado
> pelo instalador só com consentimento; as imagens obrigatórias são CINCO. O
> resto desta regra vale como está.

`docker/docker-compose.install.yml` é o que roda na máquina de quem instalou, e
ele **não é** o `docker-compose.prod.yml`. Três diferenças, cada uma com um
motivo:

- as cinco imagens vêm de **variável obrigatória** (`${BRABO_API_IMAGE:?…}`),
  sem default. Com default, uma variável ausente subiria metade da stack com
  uma imagem que ninguém escolheu, e o erro apareceria como comportamento
  estranho em vez de recusa;
- **não há bloco `build:`** em lugar nenhum: este arquivo não constrói, e é o
  ponto dele;
- o serviço **`broker` não existe** aqui, porque a imagem dele não é publicada
  (`docker-bake.hcl` tem quatro alvos). Consequência declarada: com
  `--source=ghcr`, projeto `mounted` não sobe container (ADR 0150, decisão 7).

O `docker-compose.prod.yml` fica **intacto** — ele se declara compose de
**validação**, é o que `docker/smoke.sh` usa construindo local de propósito, e
promovê-lo quebraria esse uso. O custo dos dois arquivos é declarado, e o teto
contra a divergência é **mecânico**:
`scripts/dev/composes-em-conformidade.spec.ts` reprova se o de instalação
ganhar serviço, volume ou porta que o de validação não tenha, se algum `build:`
sobreviver, ou se uma imagem de terceiro afrouxar para uma tag diferente.

**A fonte da imagem é escolha, e "oficial" é resultado de verificação.**
`--source=ghcr` (default) resolve por **digest** a partir do `images.json` da
Release; `--source=local` roda `docker buildx bake` e **exige árvore limpa e em
tag** — imagem construída de árvore suja não é a versão que ela diz ser, e o
marcador registraria uma mentira.

**Os segredos nascem uma vez e persistem.** Os cinco de
[RN-114](api.md#rn-114) mais o `NEO4J_PASSWORD`, gerados com
`openssl rand` no mesmo molde de `docker/smoke.sh:31-57` — inclusive o detalhe
de o `NEO4J_PASSWORD` ser `-hex` e não `-base64`, porque uma `/` quebra o parse
de `NEO4J_AUTH`. O `.env` é criado **vazio e com modo 600 ANTES** de receber
conteúdo: criar com o umask do usuário e apertar depois deixaria os segredos
legíveis por uma janela, e é justamente o arquivo que não pode ter essa janela.

**E o `.env` é um arquivo que o COMPOSE parseia, e se prova contra ele**
(AT-083). O `SECRET_KEY_BASE` saía de `openssl rand -base64 64`, que QUEBRA a
linha aos 64 caracteres: os 88 do segredo iam em duas linhas, e a segunda ficava
solta no `.env`. Medido em 100 gerações, o Compose recusou 49 (*"unexpected
character in variable name"*) e ACEITOU 51 — com o segredo cortado em 64
caracteres, que ainda é o mínimo do Phoenix e por isso subia sem aviso. Todo
base64 passa agora por `segredo_base64` (`| tr -d '\n'`), e o arquivo é escrito
por `escrever_env` — função, e não corpo de `main`, para que o spec grave o
MESMO arquivo que a instalação grava.

**Não há passo de migrate, e não deve haver:** o compose encadeia `api` →
`migrate-api` com `service_completed_successfully`, e `up --wait` espera. Um
segundo lugar mandando migrar seria a segunda fonte da mesma verdade.

**E o instalador pergunta antes de afirmar.** Depois do `up --wait` — que já
espera o healthcheck — ele bate no `/health` da api e do engine, e só então diz
que instalou. É a régua que o `reset-total.sh` custou a aprender: ele anunciava
"reset completo" com a api em `Exited (1)`.

**Onde:** `install.sh` (raiz), `docker/docker-compose.install.yml`.
**Teste:** `scripts/dev/install.spec.ts` (o plano, sem TTY nem efeito) e
`scripts/dev/composes-em-conformidade.spec.ts` (a divergência entre os dois
composes); `scripts/dev/install-env.spec.ts` gera os segredos e o `.env` pelas
funções de verdade, passa o arquivo por `docker compose config` contra o compose
de instalação e cobra que CADA segredo chegue INTEIRO aos serviços (pula
nomeando o motivo sem `docker compose`), com a geração antiga fixada como
reprovada.
**Origem:** FASE 29, sessão 4 ([ADR 0150](../adr/0150-instalador-de-uma-linha.md)).
Instalar o runner (sessão 7) e migrar uma instalação anterior (sessão 6)
seguem fora, e o `--print-plan` os declara `nao-nesta-versao`.

## O backup cobre os DOIS volumes que são fonte de verdade, e roda sem cluster (RN-528)

### RN-528 — `git_local_repos` entra no backup, o destino pode ser disco, e o restore de compose reusa as MESMAS três validações {#rn-528}

O backup cobria **um** banco e rodava **num** lugar. Três consequências, e a
terceira é a que custa código: `make test-restore` exige `kubectl`, um cluster e
o CronJob `brabo-backup` no namespace, e `docker-compose.prod.yml` não tinha
serviço `backup` nenhum — a imagem era construída pelo bake e usada só no k8s.
Migrar uma instalação por compose não tinha caminho **provado**.

**Classificar antes de copiar.** O movimento fácil seria "fazer backup de todos
os volumes", e ele é errado: dos sete, `neo4j_data` e `project_workspaces` são
DERIVADOS, `ollama_data` é re-obtenível e `brabo_projects_base` é do usuário.
Copiá-los dá impressão de cobertura sem acrescentar recuperação. Fonte de
verdade são DOIS: `pgdata` — que já vinha, como dump lógico e nunca como cópia
do diretório de dados de um Postgres em execução — e **`git_local_repos`**, que
**nenhum backup cobria**. Um projeto com provider `local` guarda o repositório
*bare* ali dentro, e ele NÃO é reconstruível do Postgres: o event log guarda a
narrativa, não os objetos do git. A prosa do runbook dizia o contrário ("the
real repositories live in GitHub/GitLab") e é essa frase que explica como o
volume passou anos sem cobertura — ela vale para `github`/`gitlab`, e para
`local` não há upstream nenhum.

**A garantia do arquivo dos repos é declarada, e é menor do que "snapshot".**
Nada é quiesced. O que se garante é consistência POR REFERÊNCIA — o git escreve
os objetos antes de mover a ref, e troca a ref por rename atômico, então um
`tar` que cruza um `git push` pega o valor velho ou o novo, nunca metade de um.
O que NÃO se garante é instante global (o `tar` percorre a árvore ao longo de um
período) nem conectividade dos objetos (a imagem não tem git, de propósito). E
um `gc` concorrente apagando packfile vira FALHA e não arquivo parcial: o status
do `tar` é capturado num arquivo, porque em POSIX `sh` o status de um cano é o
do último comando — sem isso o arquivo incompleto se anunciaria como bom, e
backup que mente é pior do que backup que falha, porque só o segundo vira
alerta. `*.lock` fica de fora: restaurar um lock órfão produz repositório em que
todo `git` recusa operar.

**Destino em disco, S3 opcional.** As cinco variáveis de S3 deixam de ser
obrigatórias e passam a ser o que já eram na prática — a configuração de UM dos
destinos. `BACKUP_DIR` definida escolhe disco; ausente, S3, que é como o CronJob
do k8s continua rodando sem uma linha de mudança. A inferência (em vez de uma
variável de destino obrigatória) é o que mantém aquele caminho intacto: um
destino explícito quebraria o CronJob no dia do deploy, não no do commit. Quatro
prefixos e não dois (`daily/`, `weekly/`, `git-daily/`, `git-weekly/`) porque a
retenção é por CONTAGEM: dois tipos de arquivo sob um prefixo fariam "manter 7"
significar três backups e meio.

**O restore de compose muda o invólucro, nunca o julgamento.**
`test-restore-compose.sh` dispara um backup REAL pela mesma imagem e o mesmo
comando de produção, e chama o MESMO `brabo-restore`, com as MESMAS três
validações (lista de tabelas contra a origem, contagem das críticas na janela do
backup, continuidade densa da `seq` de `session_events`).
`deploy/k8s/test-restore.sh` fica **intacto** — unificá-los faria o caminho de
compose depender de `kubectl`, que é a dependência que ele existe para não ter.
E `restore.sh` continua sem tocar a database de ORIGEM, propriedade que não se
negocia por conveniência de migração. O passo que só o compose pode cobrar é o
terceiro: verificar o arquivo dos repos, porque no k8s aquele volume nem é
montado no pod (pular é correto) e sob compose ele é (pular seria falso verde).

**Restaurar os repos é comando IRMÃO, não fase do outro** — são dois artefatos
com dois julgamentos, e juntá-los faria falha de git reprovar a validação do
event log. Ele verifica por default e só escreve com `--restaurar`; recusa
extrair por cima de repos existentes (a mistura de dois estados não levanta erro
nenhum e só aparece num `fetch` com história errada); e — achado da execução
real — recusa ANTES do `tar` quando o volume não aceita escrita, nomeando
`--user 0:0`. `git_local_repos` é compartilhado por três imagens com uids
diferentes e carrega o dono de quem o montou primeiro (medido: `1000:1000`,
modo 0755) enquanto esta imagem roda como uid 70. Quando a extração roda como
root, o que sai é devolvido ao dono do DIRETÓRIO e nunca deixado como root:
senão o volume voltaria íntegro e inútil, com api e engine sem conseguir
escrever no que acabou de ser restaurado.

**Neo4j recebe reprojeção, não backup.** Restaurar uma projeção possivelmente
velha ao lado de um Postgres restaurado noutro instante dá dois estados
derivados de momentos diferentes, sem nada que os concilie. A reprojeção **não
foi construída aqui** (é o BRB-018): até existir, instalação migrada nasce com
o grafo VAZIO — degradação conhecida e nomeada, não perda de dado, porque o RAG
vive no pgvector e vem no dump. Desde a [RN-569](api.md#rn-569) ela existe
(`grafo:reprojetar`), e o grafo vazio passa a durar até alguém rodá-la.

- **Onde:** `docker/backup/lib.sh:28` (`destino_tipo`, a inferência que mantém o
  CronJob intacto), `:65` (`destino_esperar` perguntando por ESCRITA e não por
  existência), `:105` (`destino_enviar`, escrita em `.parcial` e rename),
  `:181` (a garantia dos bare repos, escrita junto do código que a produz),
  `:221` (`git_arquivar`, o status do `tar` num arquivo), `:259`
  (`git_restaurar`, a devolução do dono) e `:273` (`git_raiz_gravavel`);
  `docker/backup/backup.sh:31` (`destino_preparar` — as cinco variáveis de S3
  deixando de ser obrigatórias), `:149` (os três desfechos do volume de repos,
  sem colapsar "não montado" com "vazio"), `:170` (a conferência do status do
  `tar`) e `:220` (a poda dos quatro prefixos);
  `docker/backup/restore.sh:28` (o mesmo destino do backup) e `:120`, `:184`,
  `:215` (as três validações e o veredito, sem uma linha de mudança);
  `docker/backup/restore-git.sh:43` (verificar como default), `:109` (a recusa
  de extrair por cima) e `:123` (a recusa por escrita, com o conserto nomeado);
  `docker/backup/test-restore-compose.sh:60` (o `--profile` no `config` e não
  no `run`);
  `docker/docker-compose.prod.yml:392` (o serviço `backup`, sob `profiles` e
  `restart: "no"`) e `:550` (o volume que NÃO entra na classificação dos sete);
  `docker/backup/Dockerfile.prod:80` (o `/backups` criado e `chown`-ado ANTES
  do `USER`);
  `Makefile:54` (`test-restore-compose`)
- **Teste:** `scripts/ci/backup-lib.spec.ts` — as funções num `sh` de verdade,
  contra um diretório de verdade: as cinco operações do destino em disco; o
  objeto ausente medindo 0; a escrita atômica e o `.parcial` que a listagem
  ignora; os prefixos irmãos que não se misturam; o destino que existe e NÃO
  aceita escrita (caso de falha); "não montado" × "montado e vazio"; o arquivo
  dos repos com status 0 e conteúdo relido; `*.lock` e `objects/tmp_*` fora; o
  ciclo arquivar→restaurar devolvendo byte a byte; a recusa de restaurar onde
  não se pode escrever; e o tar truncado que reprova ao ser LIDO, nunca pelo
  tamanho
- **ADR:** [0152](../adr/0152-backup-de-volumes-contra-compose.md)
- **Origem:** FASE 29, sessão 5. Exercitado de verdade contra o compose de
  desenvolvimento com dados reais (55 tabelas, 422 eventos, os bare repos de
  `exp001` e `exp004`), incluindo a restauração num volume novo conferida com
  `git fsck` — o registro está no `docs/runbook.md`, seção "Last verified run —
  compose, disk destination". Fica declarado e NÃO feito: o caminho **S3** do
  adaptador não tem cobertura automatizada (exigiria um endpoint), e continua
  sendo o mesmo comando `aws` de antes; a reprojeção do Neo4j é o BRB-018; e
  nada aqui agenda o backup num compose — quem o dispara é um humano ou o
  instalador (sessão 6)

---

## FASE 29 — a instalação de uma linha: assinar o que se publica

### RN-530 — Migrar exige backup PROVADO: o instalador só ganha o direito de apagar depois de restaurar {#rn-530}

Instalar por cima de uma instalação existente **não é oferecido**: ou se migra,
ou se para. Um `up` sobre volumes de outra versão é o tipo de estrago que não
avisa.

A migração tem uma ordem, e o passo do meio é o que dá sentido a ela:
**backup → PROVAR que restaura → perguntar → apagar → instalar → restaurar.**

A prova não é zelo. Um backup que ninguém tentou restaurar é um arquivo, e a
hora de descobrir isso não é depois do `down -v` — por isso o instalador roda
`docker/backup/test-restore-compose.sh` (as MESMAS três validações de
`restore.sh`, ADR 0152) antes de qualquer deleção. Backup que falha, ou prova
que falha, **interrompem a migração sem apagar nada**, e a mensagem diz onde o
backup ficou.

**O destino do backup é uma pasta do HOST**, e isso é o detalhe que faz a
diferença entre migrar e perder: o default do compose é o volume nomeado
`backup_local`, que o `down -v` apagaria **junto** com o que se quer preservar.

**O que a migração apaga**: os volumes nomeados da instalação (`pgdata`
inclusive), os containers e a rede. **O que ela nunca apaga**: a base de
projetos — quando `BRABO_PROJECTS_BASE` aponta para uma pasta do host, a linha
do compose é **bind-mount**, e `down -v` não toca bind —, a pasta de espelho
(RN-516) e o backup recém-provado.

O dump do Postgres **não** é restaurado automaticamente sobre o banco novo:
`brabo-restore` valida contra uma database de teste e nunca sobrescreve a
origem (ADR 0152), e restaurar sobre um banco já populado é operação
destrutiva que o instalador não toma sozinho. Os repositórios git locais, sim —
eles são fonte de verdade que nasceria vazia.

**Onde:** `install.sh`, `migrar_instalacao_anterior` e `restaurar_apos_migrar`.
**Teste:** `scripts/dev/install.spec.ts` — o plano declara
`apagar-sem-backup-provado: nunca`, e um teste afere que a chamada da prova
vem **antes** da chamada de deleção no código.
**Origem:** FASE 29, sessão 6 ([ADR 0150](../adr/0150-instalador-de-uma-linha.md),
[ADR 0152](../adr/0152-backup-de-volumes-contra-compose.md)).

## O repositório nasce no aceite do handoff ao Arquiteto, e a execução não começa sem ele (RN-582)

### RN-599 — No compose de dev a api encontra o broker sozinha, e a falta da pasta gerenciada é dita a cada subida {#rn-599}

O broker sobe por padrão no compose de DEV desde a [RN-512](#rn-512), mas a api
recebia `BROKER_URL` vazia (`${BROKER_URL:-}`, e a linha vinha comentada no
`.env.example`). O resultado, medido no teste do dono em 26/09: com o broker de
pé ao lado, `brokerConfigurado` vinha `false` e a criação de projeto só liberava
`runner` ([RN-573](api.md#rn-573)). Duas regras fecham isso:

1. **`BROKER_URL` tem default no compose de dev, e só nele.** O default é
   `http://broker:8090` — o serviço e a porta (`BROKER_PORT`) que o MESMO
   arquivo declara, e o teste trava os dois juntos: um default que apontasse
   para outro lugar trocaria "sem broker" por "broker inalcançável". O valor do
   `.env` continua vencendo. Os composes de PRODUÇÃO e de INSTALAÇÃO seguem
   `${BROKER_URL:-}`, de propósito: lá o broker está sob
   `profiles: ["container-broker"]`, e quem o liga grava a URL (o `install.sh`,
   perguntando — [RN-575](produto.md#rn-575)). Um default ali faria a api de uma
   instalação sem broker afirmar que tem um.
2. **O `preflight.mjs` RELATA a pasta gerenciada, no molde do `DOCKER_GID`.**
   Sem `PROJECT_WORKSPACES_HOST_DIR`, api e engine usam o volume gerenciado
   `project_workspaces` (sem caminho de host), o broker fica sem
   `PROJECT_WORKSPACES_HOST_ROOT` — o compose de dev a DERIVA daquela —, o stack
   sobe saudável e o `container_start` do modo `container`, o default, termina
   recusado. O relato tem quatro desfechos que não colapsam: `ausente`, `ok`,
   `nao-absoluta` (o `~`: o Compose o expande na origem do bind-mount de
   api/engine, mas NÃO na variável que o broker recebe — medido com
   `docker compose config`) e `divergente` (`PROJECT_WORKSPACES_HOST_ROOT`
   explícita diferente da pasta que api e engine montam, inclusive quando elas
   montam o volume). Cada mensagem diz o sintoma e o conserto. Ele NUNCA recusa
   a subida e NUNCA grava o `.env`: a resposta é um caminho no disco de alguém,
   e trocar o volume pela pasta esconde o que já está no volume (os dados ficam
   lá, só deixam de ser vistos) — a mensagem diz isso também.

**O que fica aberto:** o `pnpm bootstrap` NÃO oferece a pasta. Fazê-lo seria um
segundo `consentir-base.mjs` (perguntar num TTY, criar a pasta com o dono
certo, gravar as DUAS variáveis juntas, decidir o que fazer com um volume
`project_workspaces` que já tem dados), e isso é frente própria.

- **Código:** `docker/docker-compose.yml:266` (o default de `BROKER_URL`),
  `:571` (a derivação de `PROJECT_WORKSPACES_HOST_ROOT`);
  `scripts/dev/pasta-gerenciada.mjs:63` (`avaliarPastaGerenciada`), `:89`
  (`mensagemDaPastaGerenciada`); `scripts/dev/preflight.mjs:424`
  (`relatarPastaGerenciada`)
- **Teste:** `scripts/dev/broker-url-no-dev.spec.ts:42` (o default existe),
  `:47` (aponta para o serviço e a porta do arquivo), `:64` (produção e
  instalação sem default); `scripts/dev/pasta-gerenciada.spec.ts:31`
  (ausente), `:51` (o `~`), `:67` (divergente com o volume), `:75` (a
  mensagem diz sintoma, conserto e o que não migra), `:113` (o preflight
  chama o relato sem sair por ele)
- **Origem:** AT-213 — teste do dono em 2026-09-26
