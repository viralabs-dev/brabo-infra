---
id: runbook
title: Runbook operacional
sidebar_label: Manual de operação
sidebar_position: 4
description: Procedimentos operacionais do Brabo — deploy, rollout, restore, rotação de chaves, incidente de custo e observabilidade.
keywords: [runbook, operations, incident, restore, rollout, kubernetes]
---

# Runbook operacional

Um documento só, porque às 3h da manhã ninguém abre um diretório para escolher
um arquivo. Comece pela triagem. O que prova cada procedimento, e o que roda
essa prova, está na tabela do fim:
[Procedimentos e como cada um é verificado](#procedimentos-e-verificacao).

## Triagem — do sintoma ao procedimento {#triage--from-symptom-to-procedure}

| o que você está vendo | vá para |
|---|---|
| quero subir tudo do zero | [Deploy local](#deploy-local) |
| pods presos, `ExternalSecret` nunca Ready, HPA em `<unknown>` | [Diagnóstico do deploy](#diagnostico-do-deploy) |
| vou fazer rollout do engine | [Rollout do engine](#rollout-do-engine) |
| sessão `active` sem processo, ou presa em `closing` | [Quando a sessão escapa](#quando-a-sessao-escapa) |
| perdi dados / quero verificar o backup | [Restore](#restore) |
| quero verificar ou restaurar um backup numa instalação **sem cluster** | [Restore](#restore) — `make test-restore-compose` |
| um projeto do provider `local` perdeu o repositório, ou estou levando uma instalação para outra máquina | [Recuperando os bare repos](#restore-dos-bare-repos) |
| o grafo está vazio depois de um restore ou de uma migração | [Perda do grafo](#perda-do-grafo) — `grafo:reprojetar` |
| a pasta `docs/` de um projeto (os artefatos dos agentes) sumiu depois de um restore, de uma perda de volume ou de uma conversão de modo | [Perda da pasta de artefatos](#perda-da-pasta-de-artefatos) — `artefatos:reprojetar` |
| credencial de LLM ou de git parou de decifrar | [Rotação da chave mestra](#rotacao-da-chave-mestra) |
| todo mundo deslogado de uma vez, ou conta bloqueada no login | [Rotação das chaves do auth](#rotacao-das-chaves-do-auth) |
| o custo por hora disparou | [Incidente de custo](#incidente-de-custo) |
| painel vazio, sem trace, sem log | [Observabilidade](#observabilidade) |
| não sei que versão está rodando | [Que versão está no ar](#que-versao-esta-no-ar) |
| `blocked by CORS policy` no console do navegador | [Erro de CORS](#erro-de-cors) |
| ativar uma sessão não faz nada, ou `transition` devolve `500` com `ECONNREFUSED` | [A sessão não sai de `created`](#sessao-nao-ativa) |
| a api sai no boot reclamando de `GIT_OAUTH_STATE_SECRET` | [A api recusa subir por segredo de OAuth](#segredo-de-oauth-no-boot) |
| "Entrar com GitHub/GitLab" volta do provider com erro de `redirect_uri` | [O provider recusa o callback do login social](#callback-login-social-nao-registrado) |
| a api ou o engine saem no boot reclamando de `AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY`, `SECRET_KEY_BASE`, ou `NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD` | [Os quatro segredos irmãos também não sobem com o default](#segredos-irmaos-no-boot) |
| quero ligar SMTP real, ou a api sai no boot reclamando de `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` | [SMTP real no `MailSender`](#smtp-real) |
| agente respondendo vazio, truncado ou muito devagar | [Ambiente de inferência](#ambiente-de-inferencia) |
| agente parando com `iteration limit reached` sem entregar | [Ambiente de inferência](#ambiente-de-inferencia) |
| quero acrescentar um provider de LLM compatível com OpenAI | [Acrescentando um provider compatível](#adicionando-um-provider-compativel) |
| quero migrar meus workspaces do volume do Docker para uma pasta de verdade | [Migrar workspaces para pasta local](#migrar-workspaces-pasta-local) |
| o assistente de projeto não oferece o modo **Pasta montada**, ou criar um projeto montado é recusado dizendo que o caminho tem de ficar dentro da base | [Projeto no modo Pasta montada: a base de projetos](#projeto-no-modo-local) |
| aprovar `container_start` num projeto montado falha dizendo que a api não conseguiu criar ou alcançar a pasta | [Projeto no modo Pasta montada: a base de projetos](#projeto-no-modo-local) |
| `pnpm dev` recusa subir, dizendo que `BRABO_PROJECTS_BASE` se sobrepõe ao checkout do Brabo | [Projeto no modo Pasta montada: a base de projetos](#projeto-no-modo-local) |
| `brabo-runner` sai com `base de projetos recusada`, ou imprime `base de projetos: nenhuma configurada` quando eu esperava uma base | [A base de projetos do runner](#base-do-runner) |
| `brabo-runner` fica imprimindo `nada a atender AINDA`, ou a unit de máquina está de pé mas nenhum projeto é atendido | [O agente de máquina](#agente-de-maquina) |
| `systemctl --user status` diz `Loaded: bad-setting` / `WorkingDirectory= path is not absolute`, e o serviço do agente nunca inicia | [A unit está `bad-setting`](#unit-do-agente-nao-inicia) |
| preciso de uma chave de dispositivo para a máquina e não há navegador (uma instalação nova, uma máquina sem tela) | [Chave de dispositivo pelo terminal](#chave-de-dispositivo-pelo-terminal) |
| o instalador terminou com um bloco **"O que ficou pendente"**, ou uma instalação nova não tem conta, nem chave de máquina, nem serviço do agente | [Quando o instalador não fecha a instalação](#instalador-nao-fecha) |
| a pasta do projeto nunca aparece na máquina do usuário, e o log do engine diz `workspace_create: o projeto <id> não criou pasta` | [A pasta do projeto nunca aparece](#pasta-do-projeto-nunca-aparece) |
| um dev agent num projeto `runner` fica bloqueado preparando o worktree, nomeando `credencial-nao-atravessa-o-container`, com origem `politica` | [Clone autenticado no modo Runner](#credencial-nao-atravessa-o-container) |
| `apps/api/dist`/`node_modules`, ou um arquivo que um agente escreveu numa pasta de projeto, pertence a `root` e não consigo editar sem `sudo` | [Os containers de dev escrevem como o seu usuário, não como root](#dev-containers-nao-root) |
| quero subir o broker de containers, ou ele responde `permission denied` no socket do Docker | [O broker de containers](#broker-de-container) |
| provisionar um repositório falha com `permission denied: /data/git-repos/<slug>.git`, ou o `permissions.json` não pode ser escrito | [Os containers de dev escrevem como o seu usuário, não como root](#dev-containers-nao-root) |
| quero apagar o banco de dev e começar de novo, ou o `reset-total.sh` parou no meio | [Reset total do ambiente de dev](#reset-total) |
| o web mostra **429 (rate limit)** sem motivo aparente, ou um projeto em modo `runner` parece "sem agente local" enquanto o `brabo-runner` está rodando | [O runner inunda a api com um ticket morto](#runner-com-ticket-morto) |

Duas coisas que vale saber antes de qualquer procedimento:

- **Silêncio não é saúde.** As regras de alerta moram no Grafana, não no Prometheus
  ([ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md)):
  Grafana fora do ar quer dizer nenhum aviso, não nenhum problema.
- **Matar o pod não fecha uma sessão.** `kubectl delete pod` sem
  drenar cria um órfão. O caminho é sempre a transição normal.

### O broker de containers {#broker-de-container}

O broker ([ADR 0130](adr/0130-broker-de-container.md)) é o único processo do
produto que fala com um daemon do Docker, e o único serviço com
`/var/run/docker.sock` montado. **Não monte esse socket em nenhum outro lugar.**

**Localmente ele sobe com `pnpm dev`; em produção, não.** Essa
assimetria é uma decisão ([ADR 0146](adr/0146-base-consentida-no-bootstrap.md),
ponto 3), não um descuido — não "uniformize" os dois arquivos de compose. Quem
roda `pnpm dev` **já tem o socket do Docker** (está rodando
`docker compose` contra o daemon do próprio host), então o broker recebê-lo
não concede nada que o operador já não tenha. Em produção o socket é uma
fronteira de privilégio de verdade e o operador não é o desenvolvedor, então ali ele
fica sob `profiles: ["container-broker"]`.

Até essa decisão o broker vinha desligado por padrão nos dois arquivos, com o
argumento de que "nada o chama ainda". Isso deixou de ser verdade: ele tem quatro chamadores reais
([ADR 0133](adr/0133-infra-elege-imagem-do-roteamento.md)/
[0136](adr/0136-pagina-global-de-containers.md)), e o
[ADR 0144](adr/0144-a-segunda-raiz-do-broker.md) fez o modo **Pasta montada** subir o
container dele *pelo* broker — então, com o profile desligado, o modo local
padrão terminava em `BrokerIndisponivelError`. Essa falha continua sendo o que você recebe quando
o broker está de fato ausente: um `failed` NOMEADO, nunca uma queda, e nunca uma
queda silenciosa para rodar fora de um container.

O que você ainda precisa definir é o gid — e errá-lo **não** quebra o
boot, quebra o uso:

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

`BROKER_URL` **não** está mais nessa lista: o compose de dev tem como default
`http://broker:8090`, o serviço que ele sobe
([RN-599](business-rules/infra.md#rn-599)). Antes desse default, a api respondia
`brokerConfigurado: false` ao lado de um broker saudável e a criação de projeto só
oferecia `runner`. Um valor no `.env` continua vencendo; os composes de produção e de
instalação não têm default, de propósito.

O container do projeto roda como o **dono da pasta do projeto** ([ADR 0180](adr/0180-container-com-o-dono-da-pasta.md), [RN-627](business-rules/contracts.md#rn-627)): a api lê o uid e o gid da pasta e o broker o inicia com `--user <uid>:<gid>` e `HOME=/tmp`. É isso que deixa um dev agent escrever em `/work` sob `--cap-drop ALL`. Duas coisas a saber quando não funciona: uma pasta de root, ilegível ou ausente cai no comportamento anterior (root dentro do container, sem escrita numa pasta de outro uid — `npm install` responde `EACCES`); e um container que já existe só muda quando é recriado (`container_remove`, depois `container_start`).

`pnpm dev` também **informa** a pasta gerenciada a cada execução (RN-599): com
`PROJECT_WORKSPACES_HOST_DIR` não definida, `api`/`engine` usam o volume gerenciado, o
broker não recebe `PROJECT_WORKSPACES_HOST_ROOT`, e `container_start` termina
recusado — com a stack saudável. Ele informa também um `~` no caminho (o Compose
o expande no bind mount, não na variável do broker) e um
`PROJECT_WORKSPACES_HOST_ROOT` explícito que difere da pasta que a api monta.
Como o aviso do gid, ele nunca bloqueia e nunca escreve no `.env`; trocar o
volume por uma pasta não migra o conteúdo do volume — veja
[migrar workspaces](#migrar-workspaces-pasta-local).

`pnpm dev` **informa** o estado de `DOCKER_GID` a cada execução
([RN-512](business-rules/infra.md#rn-512)), comparando-o com o grupo real da sua
máquina, justamente para que a divergência não seja descoberta muito depois — quando alguém
propõe `container_start` e toda operação morre com `permission denied` no
socket. O aviso nunca bloqueia, e numa máquina sem grupo `docker` nenhum
(Docker Desktop, rootless) ele diz que a pergunta não se aplica em vez de
acusar você de um defeito.

Em produção, suba-o explicitamente:

```bash
docker compose -f docker/docker-compose.prod.yml \
  --profile container-broker up -d broker
```

Numa **instalação** feita pelo `install.sh` o broker é o mesmo serviço,
da imagem publicada, e o instalador pergunta se deve ligá-lo — veja
[o broker numa instalação](#broker-na-instalacao)
([ADR 0162](adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)).

**O broker tem DUAS raízes, e nenhuma faz as vezes da outra**
([RN-503](business-rules/api.md#rn-503),
[ADR 0144](adr/0144-a-segunda-raiz-do-broker.md)).
`PROJECT_WORKSPACES_HOST_ROOT` é onde moram os projetos do modo **Container**;
`BRABO_PROJECTS_HOST_BASE` é onde moram os projetos do modo **Pasta montada**, e o
compose a deriva de `BRABO_PROJECTS_BASE`, então definir a base é normalmente
tudo o que você faz. Qualquer que falte, a recusa a nomeia e não toca em nenhum
container. Cair na outra raiz montaria a pasta do projeto errado
— a raiz gerenciada é nomeada por `workspace_dir_name`, a base é nomeada por você,
e o mesmo nome quer dizer pastas diferentes em cada uma.

Para conferir que ele está de pé — a partir da api, que é o ÚNICO serviço que o
alcança (a rede `broker` é `internal: true` e o serviço não publica porta nenhuma,
então `curl` do seu host não vai funcionar, e é essa a ideia):

```bash
docker compose -f docker/docker-compose.yml --env-file .env exec -T api \
  node -e "fetch('http://broker:8090/health').then(r=>r.text()).then(console.log)"
# esperado: {"status":"ok","servico":"broker"}
```

`/health` fala do PROCESSO, nunca do daemon. Reiniciar o
broker não conserta um Docker fora do ar, e um healthcheck que falhasse por
esse motivo produziria um laço de reinício que não resolve nada.

**A imagem local instala as dependências no BUILD, e isso não é uma
otimização.** A única rede do broker é `internal: true`, então não há registry
alcançável em runtime: uma imagem que rodava `corepack`/`pnpm install` ao
iniciar morria com `getaddrinfo EAI_AGAIN registry.npmjs.org` e saía com 1. A
correção tirou o registry do caminho de runtime (`pnpm install` como passo de build)
em vez de abrir a rede — a rede é a primeira das cinco
camadas de contenção. Desde a AT-360 nenhuma imagem usa corepack (o Node 25+ não
o traz mais): todo Dockerfile instala o pnpm a partir do tarball do registry, conferido
contra um sha512 gravado no Dockerfile (`PNPM_SHA512`), em
`/usr/local/bin`. A versão dele bate com `packageManager` no `package.json`, então
o pnpm nunca tenta baixar nada em runtime — medido com a imagem de dev
sob `--network none`: `pnpm --version` imprime `11.3.0` e `/health`
responde. Subir o pnpm quer dizer mudar `packageManager`, `PNPM_VERSION` e
`PNPM_SHA512` (`npm view pnpm@<v> dist.integrity`, em hex) juntos.

Duas consequências que você vai encontrar:

- **Os três `node_modules` são volumes nomeados montados sobre o que a imagem
  instalou**, e o Docker só semeia um volume a partir da imagem quando o volume está
  VAZIO. Por isso `docker/broker/entrypoint.sh` os reconcilia contra uma cópia
  guardada fora de `/workspace`, carimbada com o sha256 do `pnpm-lock.yaml`
  com que a imagem foi construída. O primeiro boot depois de um `--build` registra
  `sincronizando…` e leva alguns segundos; os seguintes não registram nada.
- **Mudar uma dependência do broker exige `up -d --build broker`.** O
  entrypoint compara o carimbo dele com o lockfile da árvore de trabalho e AVISA quando
  diferem. Ele avisa em vez de recusar o boot: o broker não tem dependência de
  runtime além do link de workspace para `@brabo/docker-port`, e trocar um
  aviso por uma indisponibilidade seria pior.

O serviço também tem **healthcheck** (`wget` contra `127.0.0.1:8090/health`
de dentro do container — ele não publica porta, e o `node:26-alpine` não tem
`curl`). Sem ele, `up --wait` informava `Healthy` no instante em que o container
iniciava, então o `scripts/dev/reset-total.sh` anunciava "reset completo" com um
broker que tinha morrido cinco segundos antes.

**Sintomas e o que cada um quer dizer:**

| o que você vê | o que é |
|---|---|
| `permission denied` em `/var/run/docker.sock` | `DOCKER_GID` errado. O socket é `root:docker` e o broker roda não-root; refaça o passo 1 acima e recrie o container (`up -d --force-recreate broker`) |
| `não encontrei o executável docker no PATH` | a imagem foi construída sem `docker-cli`. Reconstrua-a (`--build`). Este erro é SEPARADO de "daemon fora do ar" de propósito: instalar e iniciar são correções diferentes |
| `getaddrinfo EAI_AGAIN registry.npmjs.org` e o container sai com 1 | uma imagem do broker construída antes de as dependências irem para o build. Reconstrua-a (`up -d --build broker`). NÃO dê saída de rede ao serviço: a rede `internal: true` é a contenção, e o registry é o que tem de sair do caminho de runtime |
| `AVISO — pnpm-lock.yaml mudou desde o build desta imagem` | a imagem é mais velha que o lockfile da árvore de trabalho. Ela continua rodando (o broker não tem dependência de runtime além do link de workspace); reconstrua quando você de fato mudou uma dependência do broker |
| `PROJECT_WORKSPACES_HOST_ROOT não está definida` no `start` | esperado, e a recusa é o comportamento correto. O `-v` é resolvido pelo DAEMON contra o sistema de arquivos do HOST; adivinhar montaria uma pasta VAZIA e o dev agent trabalharia num diretório sem código. As outras quatro operações continuam funcionando sem ela |
| a rota do ciclo de vida diz `naoObservado: "broker-nao-configurado"` | `BROKER_URL` está vazia na **api**. É um estado normal, não uma falha — a leitura declara que não olhou em vez de herdar o estado registrado ([RN-486](business-rules/api.md#rn-486)) |
| a rota do ciclo de vida diz `naoObservado: "broker-sem-resposta"` | `BROKER_URL` está definida e nada respondeu: o profile provavelmente está desligado, ou a api não está na rede `broker`. Se `detalhe` diz ``não respondeu `inspect` dentro do teto desta operação (5000ms)``, o broker É alcançável e está lento — olhe o daemon, não a rede ([RN-604](business-rules/api.md#rn-604)) |
| um comando de terminal ou `container_start` falha com ``não respondeu `exec` dentro do teto desta operação`` (ou `start`/`stop`/`remove`) | a api parou de esperar no teto próprio daquela operação, não porque o broker está fora do ar ([RN-604](business-rules/api.md#rn-604)). No `exec` o comando pode ainda estar rodando dentro do container; no `start`/`stop`/`remove` o efeito pode ter acontecido — confira `/containers` antes de repetir. Um `start` cujo pull de imagem leva mais de 30s é cortado pelo próprio broker — esse tem linha própria abaixo |
| o resultado de terminal de um dev agent diz ``o comando passou do teto de execução de terminal (120s, TERMINAL_ACTION_TIMEOUT_MS)`` | o comando rodou mais que `TERMINAL_ACTION_TIMEOUT_MS` (default de 120 s desde a [RN-757](business-rules/engine.md#rn-757); era 15 s) e o engine parou de esperar; o processo pode ainda estar rodando no container. O agente é orientado a rodá-lo de novo sob `nohup … &`. Subir a variável é possível, mas acima de ~180 s a espera externa do engine (valor + 120 s) passa do limite de 300 s de cabeçalhos do `fetch` do Node da api e o corte volta |
| `container_start` falha com ``o `docker pull <imagem>` não terminou dentro do teto de 30000ms e foi cancelado`` (o broker responde `504`, `origem: infra`) | a imagem não está no daemon e o pull dela não cabe no teto de controle de 30s. Matar o CLI cancela o pull, então a imagem continua ausente — repetir não ajuda. Faça o pull no host que roda os containers (`docker pull <imagem>`; no modo `runner`, na máquina do usuário) e aprove o start de novo. Imagens grandes não sobem por este caminho na primeira tentativa, por decisão do mantenedor ([RN-605](business-rules/contracts.md#rn-605)) |
| `BRABO_PROJECTS_HOST_BASE não está definida` no `start` de um projeto **Pasta montada** | mesma forma da linha acima, outra raiz. Defina `BRABO_PROJECTS_BASE` no `.env` e recrie o broker; o compose deriva esta dela ([RN-503](business-rules/api.md#rn-503)) |
| o broker responde `409` para um projeto em modo `runner` | esperado. Aquela pasta mora na máquina do usuário e este host não a enxerga — lá, quem sobe container é o runner ([ADR 0137](adr/0137-o-runner-sobe-o-container-do-projeto.md)) |
| o broker responde `409` dizendo que não sabe onde está a pasta do projeto | um projeto **Pasta montada** LEGADO, criado antes de a base existir e morando fora dela. A correção é mover a pasta para dentro de `BRABO_PROJECTS_BASE`, não mudar o modo do projeto — a mensagem nomeia a base e o caminho que viu ([RN-503](business-rules/api.md#rn-503)) |

**O broker nunca sobe um container sozinho.** Não há laço nem
fila: ele age quando chamado, e toda chamada de escrita nasce de uma
`proposed_action` que um humano aprovou.

### Migrar workspaces para pasta local {#migrar-workspaces-pasta-local}

Definir `PROJECT_WORKSPACES_HOST_DIR`/`GIT_LOCAL_REPOS_HOST_DIR`
([Primeiros passos](getting-started.md#local-folder-for-workspaces)) troca o
volume do Docker pela pasta indicada — mas **não copia** o que já
existia no volume antigo. Quem já tem projetos criados e não
quer perder o trabalho precisa copiar o conteúdo antes de trocar:

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

O nome do volume (`brabo-dev_project_workspaces`) leva o prefixo do projeto
Compose (`name: brabo-dev` em `docker/docker-compose.yml`, [ADR
0170](adr/0170-compose-de-dev-brabo-dev.md)) — confira com `docker volume ls`.
Um ambiente de dev de antes do ADR 0170 ainda tem os dados sob `brabo_*`: veja
[Levando um ambiente de dev para brabo-dev](#dev-para-brabo-dev) antes. O volume antigo continua existindo
depois (o Compose não apaga um volume que saiu de uso); remova-o
com `docker volume rm` quando tiver certeza de que a cópia funcionou.

### Projeto no modo Pasta montada: a base de projetos {#projeto-no-modo-local}

**Sintoma:** o assistente de projeto nem oferece **Pasta montada**; ou
oferece, e a api responde `400` dizendo que a pasta *não existe de
dentro da api*.

Os dois vêm do mesmo fato: um projeto no modo Pasta montada guarda o código numa
pasta **sua**, e a api e o engine só a alcançam se ela estiver
montada nos containers deles. O que mudou
([ADR 0141](adr/0141-base-unica-dos-projetos-montados.md),
[RN-500](business-rules/api.md#rn-500)) é quem arranja isso, e com que frequência:
agora há **uma base**, configurada uma vez pelo operador, e todo
projeto montado mora dentro dela. Você nunca mais edita o compose por
projeto.

**O que fazer — uma vez, para a instalação inteira.** O caminho suportado é o
passo de consentimento ([ADR 0146](adr/0146-base-consentida-no-bootstrap.md)), que
propõe uma pasta, recusa uma que se sobreponha ao checkout do Brabo ou a
`PROJECT_WORKSPACES_HOST_DIR`, prova no macOS/Windows que o Docker a enxerga,
a cria e escreve a variável:

```bash
node scripts/dev/consentir-base.mjs
```

Rode-o no **seu** terminal. `pnpm bootstrap` → *Docker › Base de projetos*
roda o mesmo script mas só consegue **informar**: todo item do menu roda com stdin
vindo de `/dev/null` de propósito, então ele não consegue fazer pergunta.

Escrever a linha à mão continua funcionando:

```bash
# .env — caminho ABSOLUTO. O `~` NÃO é expandido pelo Compose.
BRABO_PROJECTS_BASE=/home/voce/projetos-brabo
```

```bash
docker compose -f docker/docker-compose.yml --env-file .env up -d api engine
```

É isso. Daqui em diante, um projeto no modo Pasta montada vai para algum lugar sob
`/home/voce/brabo` e não precisa de mais configuração.

**A pasta em si ainda não precisa existir**
([ADR 0142](adr/0142-validacao-de-workspace-montado-adiada.md),
[RN-501](business-rules/api.md#rn-501)). Criar um projeto Pasta montada valida
só o FORMATO do caminho mais "está sob a base"; a pasta é criada
depois, quando a Infra sobe o container do projeto — que é o que permite ao
assistente SUGERIR `<base>/<slug do projeto>` para começo de conversa. Entre
esses dois momentos `workspacePath` aponta para uma pasta que ainda não está lá,
e o `workspaceVerifiedAt` do projeto é `null`; converter um projeto existente
para Pasta montada é a única exceção e cria a pasta na hora,
porque move o `permissions.json` para dentro dela.

Então um `400` na criação agora quer dizer só uma de duas coisas, e as duas nomeiam o que
querem dizer: o caminho não está sob a base (a mensagem nomeia a base e
sugere `<base>/<nome>`), ou `BRABO_PROJECTS_BASE` nem está configurada
(a mensagem diz que o MODO não está disponível nesta instalação). Uma pasta
que a api não consegue criar ou alcançar aparece depois, como um `failed` NOMEADO
na ação `container_start` — nunca um 500, e o ciclo de vida do container
não é marcado `provisioning` quando isso acontece.

**Projetos montados ganham um container de verdade, e ele roda no SERVIDOR**
([RN-503](business-rules/api.md#rn-503),
[ADR 0144](adr/0144-a-segunda-raiz-do-broker.md)). Como a base é
alcançável pelo daemon do Docker do host, `container_start` de um projeto Pasta montada
vai para o [broker](#broker-de-container), exatamente como o modo Container — ele
deixou de exigir um `brabo-runner` conectado. Só o modo **Runner** ainda vai para
o runner, na própria máquina do usuário, porque aquela pasta está num lugar que este
servidor não enxerga. Localmente o broker já está de pé — ele vem com o `pnpm dev`
desde o [ADR 0146](adr/0146-base-consentida-no-bootstrap.md), justamente porque
este é o caminho do modo padrão; em produção ainda precisa de
`--profile container-broker`. Esse mesmo passo é quando a pasta acima é
criada, nessa ordem: o daemon só faz bind-mount de uma pasta que já
existe.

**Por que o assistente esconde o modo Pasta montada.** Sem `BRABO_PROJECTS_BASE`, a
api informa `projectsBase: null` e a opção nem é oferecida. Isso
é deliberado: oferecer um modo que a instalação não consegue honrar produz um
projeto que trava depois, na primeira ferramenta do primeiro agente, longe
da tela onde a decisão foi tomada. O modo Container (o padrão)
e o modo Runner não são afetados e continuam funcionando sem esta variável.

**Por que o mesmo caminho dos dois lados.** A base é montada por **identidade** —
`/home/voce/brabo:/home/voce/brabo` — em `api` e `engine` igualmente. O caminho
é escrito UMA vez em `projects.workspace_path` e lido pelos dois processos
([RN-169](business-rules/api.md#rn-169)); é também a string
que a tela mostra de volta para você. Montá-la em outro lugar faria o
engine escrever onde a api não lê, e faria a tela mostrar um
caminho que não existe nem na sua máquina nem na deles.

**Confira o que os containers de fato enxergam:**

```bash
docker compose -f docker/docker-compose.yml exec api    ls -la /home/voce/brabo
docker compose -f docker/docker-compose.yml exec engine ls -la /home/voce/brabo
```

**Não aponte a base para o próprio checkout do Brabo.** `pnpm dev` recusa
subir a stack quando `BRABO_PROJECTS_BASE` contém, ou está contida em,
o repositório que você clonou — ele nomeia os dois caminhos e para. Essa checagem mora
no preflight e em nenhum outro lugar de propósito: a api compara um caminho de projeto
com `process.cwd()`, que dentro do container dela é `/workspace`,
então ela não tem como enxergar o seu checkout real. Sem a guarda do preflight,
clonar o Brabo em `$HOME/brabo` e definir a base para a mesma pasta
passa em toda validação e põe dev agents rodando dentro da própria
árvore do produto — a falha que o
[ADR 0055](adr/0055-escopo-de-caminho-na-politica-de-terminal.md) existe para
evitar.

**Escolha uma pasta dedicada.** Tudo sob a base é alcançável de
dentro dos containers do produto. Não a aponte para o seu `$HOME` inteiro, e
não a aponte para uma pasta que guarde outros segredos seus.

**Outros modos de recusa, e o que cada um quer dizer:**

| a mensagem diz | o que fazer |
|---|---|
| o modo Pasta montada nem é oferecido | `BRABO_PROJECTS_BASE` não está definida — defina-a e `up -d api engine` |
| *o modo Pasta montada não está disponível nesta instalação* (na criação) | mesma causa, dita pela api: `BRABO_PROJECTS_BASE` não está definida (RN-501) |
| *a pasta tem de ficar dentro de `<base>`* (na criação) | o caminho está fora da base; use o `<base>/<nome>` que a mensagem sugere, ou mude a base e `up -d api engine` |
| *não consegui criar/alcançar `<caminho>` de dentro da api* (no `container_start`) | a base não está montada de fato, ou o dono da pasta no host a bloqueia. Confira com o `exec ls` acima, corrija, e aprove `container_start` de novo (RN-501) |
| *não existe de dentro da api* | a base não está montada nos containers; confira com o `exec ls` acima |
| *existe mas não é uma pasta* | o caminho aponta para um arquivo; use uma pasta |
| *o processo não consegue escrever nela* | dono/permissão da pasta no host. As imagens rodam não-root ([ADR 0024](adr/0024-fase5-imagens-producao-ci.md)); ajuste o dono ou o modo da pasta |
| *Caminho inválido para um projeto Local* | é a raiz de um sistema de arquivos, uma pasta de sistema, relativo, tem `..`, ou se sobrepõe ao próprio checkout do Brabo — escolha uma pasta sua, fora desses ([ADR 0072](adr/0072-projeto-local-ou-container.md)) |

**Limites conhecidos, declarados em vez de escondidos.** Um symlink sob a base
apontando para fora dela resolve diferente dentro dos containers, já que o
alvo não está montado — o navegador de pastas recusa descer em symlinks,
e a checagem de disco pega a divergência como falha nomeada. E esta
versão suporta **uma** base: código que mora em outro lugar tem de ser movido
para dentro dela.

**Migrando das montagens antigas por projeto.** Se você tem linhas escritas à mão
`- /home/voce/projetos/loja:/home/voce/projetos/loja` em `api` e
`engine`, elas continuam funcionando e nada as remove — projetos existentes
não são quebrados por esta mudança. O caminho suportado daqui em diante é a base;
mova essas pastas para dentro dela e tire as linhas escritas à mão quando tiver
oportunidade.

**Não confunda isto com o modo Container.** Um projeto no modo Container
(o padrão) continua usando `PROJECT_WORKSPACES_ROOT` e o procedimento de
migração acima; o modo Pasta montada nunca toca essa raiz, e a base
nunca é a mesma pasta que essa raiz ([ADR 0141](adr/0141-base-unica-dos-projetos-montados.md)
explica por que confundi-las deixaria dois projetos caírem numa pasta só).

### A base de projetos do runner {#base-do-runner}

**Sintoma:** `brabo-runner` sai com código 2 dizendo
`base de projetos recusada (…)`, ou começa imprimindo
`base de projetos: nenhuma configurada` quando você esperava uma base, ou diz
que está `Seguindo SEM base`.

Esta é uma **base diferente** da de
[Projeto no modo Pasta montada](#projeto-no-modo-local). Aquela
(`BRABO_PROJECTS_BASE`) pertence ao SERVIDOR e é a única pasta que os
containers enxergam; esta pertence à **máquina do usuário** e é onde
o agente local cria a pasta de cada projeto
([ADR 0151](adr/0151-base-consentida-no-runner.md),
[RN-529](business-rules/runner.md#rn-529)). Elas nunca são a mesma variável, nunca
o mesmo arquivo, e nunca são validadas uma contra a outra.

De onde o runner a lê, em ordem:

1. `--base <caminho absoluto>` na linha de comando;
2. `$XDG_CONFIG_HOME/brabo/runner.json` — caindo para
   `~/.config/brabo/runner.json` — com a forma `{"base": "/abs/path"}`.

```bash
cat "${XDG_CONFIG_HOME:-$HOME/.config}/brabo/runner.json"
# {"base":"/home/you/projetos-brabo"}
```

**Nenhuma base é normal.** Um runner sem base continua atendendo o projeto dele
exatamente como sempre fez; o que ele não consegue é hospedar uma pasta de projeto criada
depois. A linha de início diz em qual dos dois estados você está, sempre.

Essa pasta deixou de ser só configuração: desde a
[RN-551](business-rules/runner.md#rn-551) é também onde
`brabo-runner device-key create` põe a chave de dispositivo **privada** da máquina
(`brabo-runner-device-key.jwk.json`, modo 600) — veja
[Chave de dispositivo pelo terminal](#chave-de-dispositivo-pelo-terminal). Faça backup
dela como faria de um segredo, ou não faça backup nenhum e pareie de novo: a chave
é revogável e substituível, e nada mais no produto consegue lê-la.

**Recusas, e por que a disposição difere.** A base é recusada quando é
relativa, tem `..`, é `/`, aponta para um arquivo existente, fica fora do `$HOME`
no Linux (a mesma regra que o `--dir` tem desde a
[RN-434](business-rules/runner.md#rn-434)), ou fica **dentro** da pasta do projeto
corrente (ou é igual a ela) — essa última faria todo projeto novo nascer
dentro deste. Vindo de `--base`, isso encerra o processo com código 2;
vindo do arquivo, é impresso no `stderr` e o runner **segue
sem base**, porque matar um agente que atende um projeto por causa de uma
configuração que ele ainda nem usa seria desproporcional. Um arquivo que existe e
não declara `base` é ausência, não recusa.

**Um projeto fora da base não é problema.** O `--dir` é validado exatamente
como sempre foi e a base não entra nisso: a base é regra de
CRIAÇÃO. Não "conserte" um projeto legado movendo-o para dentro da base para silenciar
algo — nada está reclamando.

### O agente de máquina: uma conexão por projeto {#agente-de-maquina}

**Sintoma:** `brabo-runner` foi iniciado sem `--project` e ou imprimiu
o bloco de uso, ou disse `nenhum projeto em modo "runner" para esta conta`, ou
atendeu alguns projetos e recusou outros.

Desde a [RN-544](business-rules/runner.md#rn-544)
([ADR 0154](adr/0154-chave-de-dispositivo-de-maquina.md)) rodar sem
`--project` é um modo de verdade: o agente pergunta `GET /runner/projects` e abre
**uma conexão por projeto**, enraizada em `<base>/<workspaceDirName>`. O modo
com `--project` não mudou nada. Lendo a saída:

- **`Sem --project, este runner só roda como agente de MÁQUINA…`** — não há
  base consentida. As duas condições são exigidas, e por motivos diferentes:
  a credencial de máquina é o que a rota aceita, a base é de onde vem a pasta de cada
  projeto. Veja [a base acima](#base-do-runner).
- **`a api recusou a descoberta de projetos: esta credencial está presa a um
  PROJETO`** — um 403. A credencial em uso (um PAT, ou uma chave de dispositivo do
  fluxo do navegador) nomeia um projeto e não tem nada a descobrir. Rode-o com
  `--project <projectId>` em vez disso, ou pareie uma chave de máquina — o material da chave é
  feito aqui mesmo (`brabo-runner device-key create`, veja
  [abaixo](#chave-de-dispositivo-pelo-terminal)), e registrar a metade
  pública é o que o instalador faz. Em disco as duas espécies são o mesmo arquivo,
  então o runner não adivinha: o servidor é a autoridade e a mensagem dele é
  repassada literalmente.
- **`nenhum projeto em modo "runner" para esta conta — nada a atender AINDA`** —
  este é o estado **normal** de uma instalação nova, e desde a
  [RN-550](business-rules/runner.md#rn-550) o processo **fica de pé e continua perguntando**:
  15s, depois 30s, depois 60s entre chamadas, repetindo para sempre, até o primeiro
  projeto aparecer. Ninguém precisa voltar ao terminal — crie o
  projeto no modo Runner no web e o agente o pega. A consulta
  **para** no instante em que a primeira conexão está viva: daí em diante a lista é
  lida só no início, porque uma lista que volta *menor* é ambígua e
  derrubar uma conexão viva por essa ambiguidade trocaria um estado conhecido por
  um palpite. Esperar não tem teto; **falhar tem** — dez chamadas falhas
  consecutivas e o processo sai com 1 nomeando a contagem (qualquer resposta, vazia inclusive,
  zera o contador). A cada 30 respostas vazias ele imprime um batimento dizendo quantas
  chamadas houve, para que "esperando" nunca pareça "travado" no
  `journalctl`. `Restart=on-abnormal` não mudou nas duas espécies de unit — ela
  nunca olhou o código de saída, para começo de conversa; o que muda é que a unit de máquina
  agora está genuinamente `active (running)`, e `brabo-runner service status
  --machine` responde `rodando` (0) numa instalação nova onde antes respondia
  `parado` (3).
- **`[<projeto>] NÃO será atendido`** — a pasta daquele projeto foi recusada (o
  segmento escapou da base, ou o alvo existe e não é diretório). Os
  outros seguem. Só se NENHUM sobrar o processo sai com 1.
- **`[<projeto>] este projeto deixa de ser atendido — os demais continuam`** —
  o join foi recusado (em geral um segundo runner já conectado àquele
  projeto) ou o teto de novas tentativas acabou. Os dois são por PROJETO agora, não por
  processo: um projeto falhando não derruba mais o agente para todos os outros.
  Quando todo projeto terminou assim o processo imprime o desfecho de cada um
  e sai com 1.

Toda linha do laço de conexão leva o nome do projeto como prefixo. Se uma
mensagem não tem prefixo, ela veio do modo de projeto único.

### A unit está `bad-setting` e nunca inicia {#unit-do-agente-nao-inicia}

**Sintoma:** `service install` informou sucesso, o arquivo da unit está em disco, e
mesmo assim nada roda:

```
$ systemctl --user status brabo-runner.service
   Loaded: bad-setting (Reason: Unit brabo-runner.service has a bad unit file setting.)
   Active: inactive (dead)
brabo-runner.service:16: WorkingDirectory= path is not absolute: "/home/<you>/.config/brabo"
```

**Causa.** Units escritas **antes** desta correção punham o diretório de trabalho entre aspas
(`WorkingDirectory="/home/…"`). As duas metades de um arquivo de unit não compartilham uma
sintaxe: `ExecStart=` é interpretado tirando aspas e separando palavras, então cada
argumento vai entre aspas; `WorkingDirectory=` **não** — o systemd toma o resto da
linha como o caminho. Com as aspas o valor deixa de começar com `/`, a
unit é recusada no carregamento, e **nunca inicia** — em qualquer das espécies
(por projeto e por máquina igualmente, [RN-518](business-rules/runner.md#rn-518) e
[RN-545](business-rules/runner.md#rn-545)).

**Correção: reinstale.** `service install` sobrescreve o arquivo inteiro, então não há
passo de reparo nem nada para editar à mão:

```bash
brabo-runner service install --machine \
  --dir "${XDG_CONFIG_HOME:-$HOME/.config}/brabo" \
  --api-url http://localhost:3000
# ou, para uma unit por projeto, de dentro da pasta daquele projeto:
brabo-runner service install
```

`status` e `uninstall` continuam funcionando numa unit no estado quebrado —
a pasta é lida de volta de qualquer das formas —, então nada fica preso se você
preferir removê-la primeiro.

**Relacionado, e diferente:** uma unit que carrega mas sobe na pasta errada.
`WorkingDirectory=` passa por **expansão de especificadores**, então um `%` literal
no caminho tem de ser escrito `%%`; o CLI o escapa agora, mas uma unit editada à mão
com `/home/you/50%off` vai iniciar em silêncio em `/home/you/50<os-id>ff` —
absoluto, aceito, e errado. Confira o valor resolvido, nunca o arquivo:

```bash
systemctl --user show -p WorkingDirectory brabo-runner.service
```

O mesmo vale para o **ambiente** que a unit congela (AT-095). Units escritas
antes dessa correção levavam `Environment=XDG_CONFIG_HOME=<pasta>` e
`Environment=PATH=<caminho>` sem aspas, e `Environment=` tanto separa em espaços
quanto expande especificadores: com `XDG_CONFIG_HOME=/home/you/50%off com espaco` o
serviço recebia `/home/you/50<os-id>ff` — carrega, inicia, e o
agente de máquina procura a base e a chave de dispositivo numa pasta que não
existe, sem dizer nada. O CLI agora escreve a atribuição inteira entre aspas
(`Environment="XDG_CONFIG_HOME=…"`, com `\`, `"` e `%` escapados). **Correção:
reinstale**, como acima. Confira o que o systemd resolveu:

```bash
systemctl --user show -p Environment brabo-runner.service
```

### Chave de dispositivo pelo terminal {#chave-de-dispositivo-pelo-terminal}

**Sintoma:** uma máquina precisa de uma chave de dispositivo e não há navegador para rodar a
configuração automática da tela do projeto — uma instalação nova, uma máquina sem tela, ou o
agente de máquina acima recusando com `esta credencial está presa a um PROJETO`.

Desde a [RN-551](business-rules/runner.md#rn-551)
([ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md) ponto 4) o par
é gerado **na máquina**, em dois passos:

```bash
# 1) gere aqui; a JWK PÚBLICA é a única coisa no stdout
PUB=$(brabo-runner device-key create)

# 2) registre essa chave pública na api — quem tem a credencial para
#    registrar faz isso; o CLI nunca fala com a api
ID=$(… POST {"name":"…","publicKeyJwk":'"$PUB"'} … | jq -r .id)

# 3) carimbe o id do registro como o `kid` da JWK e escreva o arquivo de verdade
brabo-runner device-key finish --id "$ID"
```

- **Dois passos, por causa do `kid`.** Ele É o id do registro no servidor
  ([RN-475](business-rules/web.md#rn-475)) e só existe depois que a metade pública é
  registrada; uma chave privada escrita antes dele é inútil e o CLI a recusa
  para sempre. Então `create` escreve `brabo-runner-device-key.jwk.json.parcial`, um
  nome que o leitor ignora, e `finish` escreve o de verdade. **O arquivo que o
  runner lê nunca existe sem `kid`** — uma interrupção entre os dois
  deixa um `.parcial` que o runner ignora e que o próximo `create` nomeia.
- **Onde:** `$XDG_CONFIG_HOME/brabo/` (senão `~/.config/brabo/`), ao lado de
  `runner.json`, no modo 600; `--dir <pasta>` escreve em outro lugar (uma pasta de
  projeto, digamos). Essa pasta é para onde o `--dir` da unit de máquina deve apontar
  (`brabo-runner service install --machine --dir <pasta>`,
  [RN-545](business-rules/runner.md#rn-545)) — o runner lê a chave da
  pasta em que RODA, nunca de um caminho global que ele adivinhe.
- **stdout é para scripts, stderr é para pessoas.** `create` imprime só a
  JWK pública; `finish`, só o caminho do arquivo terminado.
- **Recusas:** `finish` sem um `create` (nada a carimbar), sem `--id`,
  com um `--id` que ainda tem a resposta JSON inteira dentro, um `.parcial`
  que não é uma JWK privada Ed25519, e — nos dois comandos — uma chave COMPLETA
  já no lugar. Essa última não tem `--force`: substituir a chave de uma
  máquina já pareada em silêncio deixaria um agente assinando com uma chave que o
  servidor não conhece. Revogue a chave atual
  ([RN-519](business-rules/api.md#rn-519)), apague o arquivo, depois `create` de novo.
- O CLI **não** afirma de que espécie é a chave. Em disco uma chave de máquina
  e uma chave de projeto são o mesmo arquivo; quem decide é a rota que registrou a metade
  pública.

### Quando o instalador não fecha a instalação {#instalador-nao-fecha}

**Sintoma:** o `install.sh` terminou com um bloco **"O que ficou pendente"**, ou uma
instalação nova tem um login pelo qual ninguém consegue passar, nenhuma chave de dispositivo de máquina, ou nenhum
serviço do agente rodando.

Desde a [RN-547](business-rules/produto.md#rn-547)
([ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)) o instalador
**fecha** a instalação: ele cria a primeira conta, registra a chave de dispositivo desta
máquina e instala a unit de máquina. A corrente é

1. `POST /internal/first-account` ([RN-546](business-rules/produto.md#rn-546)) — a
   conta nasce **já verificada**, porque `MAIL_TRANSPORT` é `log` e
   o instalador não liga SMTP;
2. `brabo-runner device-key create` ([RN-551](business-rules/runner.md#rn-551)) — o
   par Ed25519 é gerado **na máquina**; só a metade pública viaja;
3. `POST /internal/machine-device-keys` ([RN-552](business-rules/api.md#rn-552)) —
   o `id` devolvido é o que vira o `kid` da JWK privada
   ([RN-475](business-rules/web.md#rn-475));
4. `brabo-runner device-key finish --id <id>`;
5. `brabo-runner service install --machine` ([RN-545](business-rules/runner.md#rn-545)).

**Nada é desfeito, nunca, e toda falha é nomeada.** O instalador sempre
sai com 0: o compose está de pé, e os elos já completados são úteis por si
sós. O que falhou é impresso no fim com o comando exato para repetir.

- **`service install --machine` recusou.** Este é o caso **comum** numa
  máquina de desenvolvedor, não um caso de borda: ele recusa quando uma unit **por projeto** já está
  instalada, e não há `--force` — dois processos brigariam pelo
  mesmo projeto e o servidor negaria um deles. A recusa nomeia o
  `uninstall` de cada unit que encontrou. Remova-as, depois rode de novo o último passo, que
  o instalador imprimiu:

  ```bash
  brabo-runner service uninstall --project <projectId>   # para cada uma nomeada
  brabo-runner service install --machine \
    --dir "${XDG_CONFIG_HOME:-$HOME/.config}/brabo" \
    --api-url http://localhost:3000
  ```

  A pasta em `--dir` é onde a chave foi escrita — nunca uma pasta de projeto,
  que levaria um `brabo-runner.config.json` e faria a unit subir no modo
  **projeto**, atendendo em silêncio um projeto enquanto se diz o
  agente de máquina.

- **Registrar a chave falhou.** Um `…jwk.json.parcial` fica para trás de
  propósito. Ele é inerte — o runner não lê esse nome — e o instalador
  **não** o apaga: um timeout depois de a api commitar é indistinguível
  de um antes, então esse arquivo pode ser a única cópia da metade privada de uma
  chave que já está registrada. Rode o instalador de novo, ou termine à mão se
  você sabe o id do registro (`brabo-runner device-key finish --id <id>`). O
  próximo `device-key create` o nomeia e o substitui.

- **O passo da conta disse que a instalação já tem um usuário.** É um
  `409`, e é o desfecho **esperado**, não uma falha — uma segunda execução, ou uma
  migração ([RN-530](business-rules/infra.md#rn-530)) cujo restore trouxe os
  usuários de volta. Entre com a conta que existe. Os passos da chave de máquina e do serviço
  são pulados nesse caso por desenho: cunhar uma credencial durável para
  alguém que não a pediu nesta execução não cabe ao instalador.

- **A senha foi recusada.** A política é a do domínio, a mesma que o
  registro usa, e só se sabe dela depois do POST — então o instalador pergunta
  de novo, até três vezes, e transforma um teto esgotado numa linha pendente
  em vez de abortar uma instalação que já está de pé. Ele nunca escreve a
  senha em lugar nenhum: nem no `.env`, nem no marcador, nem num log. Só o
  **e-mail** vai para o marcador (`ownerEmail`, `schemaVersion: 3`).

- **Sem TTY.** O instalador informa e sai com **0** antes de escrever qualquer coisa.
  Rode-o de um terminal, como arquivo baixado —
  `curl -fsSLO …/install.sh && bash install.sh` — nunca `curl … | sh` (o
  download vira o stdin do processo e mata toda pergunta) e nunca
  `sh -c "$(curl …)"`, que não consegue verificar o próprio hash. Os dois são recusados pelo
  nome; veja [Instalando](#instalando).

- **O agente está de pé mas não atende nada.** É o estado normal de uma instalação
  nova: ele espera e consulta de novo até o primeiro projeto no modo `runner` existir
  ([RN-550](business-rules/runner.md#rn-550)). Veja
  [O agente de máquina](#agente-de-maquina).

### A pasta do projeto nunca aparece na máquina do usuário {#pasta-do-projeto-nunca-aparece}

**Sintoma:** esperava-se que uma pasta de projeto aparecesse sob a base do runner
e ela não apareceu. O log do engine tem uma linha começando com
`workspace_create: o projeto <id> não criou pasta —`, e a pasta está
ausente.

A mensagem nomeia qual das duas pré-condições falhou
([RN-532](business-rules/runner.md#rn-532),
[ADR 0151](adr/0151-base-consentida-no-runner.md) pontos 3 a 6), e elas são
as únicas duas — **nenhum container é exigido**, deliberadamente: exigir um seria
circular, já que um projeto `runner` só chega a um container `running` registrado
depois que o runner o sobe sobre a própria pasta que esta mensagem
existe para criar.

- **`nenhum brabo-runner está conectado a este projeto agora`** — inicie o
  agente para aquele projeto; veja [a base acima](#base-do-runner) para as flags.
- **`não declarou a capacidade `workspace` no join`** — o binário conectado
  ou é anterior a esta versão, ou está rodando **sem base consentida**.
  As duas correções estão na seção anterior: rode o instalador, ou inicie o
  runner com `--base`. A recusa é nomeada de propósito porque as duas causas
  têm correções diferentes; o join em si NÃO é recusado, então o runner continua
  atendendo o projeto dele normalmente.
- **`o brabo-runner recusou criar a pasta`** — a mensagem leva o
  motivo do próprio runner: `segmento` (o segmento escapou da base — a guarda
  recusou, nada foi criado), `nao-e-pasta` (o alvo já existe como
  arquivo; este CLI nunca sobrescreve um), `mkdir` (permissão ou disco) ou `git`
  (o `git init`/clone falhou — a pasta EXISTE e nenhum plano B foi
  tentado, de propósito).
- **`não respondeu ... a tempo`** — um clone grande pode passar do teto.
  Confira a máquina do runner; nada fica escrito pela metade do lado do servidor,
  porque a escrita só acontece por `workspace_confirm`.

Uma pasta que já existe como repositório git é **sucesso**, não
erro: a operação é idempotente e informa `ja-era-repositorio` no
log do runner.

### Clone autenticado no modo Runner é recusado enquanto o container está de pé {#credencial-nao-atravessa-o-container}

**Sintoma:** um dev agent num projeto `runner` fica bloqueado preparando o
worktree, e o diagnóstico diz que a credencial não pôde ser entregue, nomeando
`credencial-nao-atravessa-o-container`. A origem da tarefa bloqueada é
`politica`, não `codigo`.

**Isto não é um bug a caçar, e é exatamente isso que a origem está dizendo
a você** ([RN-558](business-rules/runner.md#rn-558)). A credencial de um remoto
autenticado (`ADR 0056`) só consegue viajar no campo `env` da mensagem `exec`,
e esse campo vale só para o caminho do **host**: a porta do Docker do produto não tem
campo `env`, deliberadamente ([ADR 0130](adr/0130-broker-de-container.md), sem
`-e` livre). Quando o runner subiu o container do projeto, ele roteia
todo comando para dentro dele — então a credencial não tem para onde ir.

Antes da RN-558 o comando rodava assim mesmo, com as variáveis vazias, e você via uma
falha de autenticação comum. Agora ele é recusado antes de executar, e nada
roda. A recusa nunca imprime nomes nem valores de variáveis, só a contagem.

**Desde o [ADR 0193](adr/0193-git-credenciado-no-host-do-runner.md)
([RN-676](business-rules/runner.md#rn-676)) esta recusa não acontece mais no
caminho comum:** o engine marca o `fetch` autenticado (`gitCredenciado`)
e um runner atual o roda no **host** mesmo com o container de pé — a
mesma pasta, montada em `/work`. Se você ainda a vê, o
`brabo-runner` conectado é mais velho que essa mudança e não lê a marca.

**O que fazer:**

1. Atualize o `brabo-runner` na máquina do usuário e reinicie-o (ou o
   serviço dele). Essa é a correção.
2. Se não dá para atualizar agora: pare o container do projeto (a
   página `/containers`, "Parar") e deixe o worktree se materializar — no caminho do host
   a credencial é entregue normalmente, e o `fetch` inicial
   dá certo. Depois suba o container de novo; o clone é idempotente e não é
   repetido.

Um repositório **local** (sem token) não é afetado, e nem os projetos `container` e
`mounted` — eles nunca passam por este caminho. Nem o
`workspace_create`, que roda no host.

**O que segue aberto, declarado:** a credencial continua não atravessando o
`docker exec`. Fechar isso significa decidir como uma operação com credencial fala
com um `docker exec` sem campo `env`, e toda opção conhecida toca a
fronteira de contenção — um ADR, não uma correção de passagem.

### Os containers de dev escrevem como o seu usuário, não como root {#dev-containers-nao-root}

**Sintoma:** algo que o container de dev `api`, `web` ou `engine` escreveu num
bind mount — `apps/api/dist`, `node_modules`, um arquivo que um agente gerou
dentro de um projeto no modo de execução `mounted` — pertence a `root` no seu
disco, e editá-lo ou apagá-lo sem `sudo` falha.

Isso era esperado: as imagens de dev (`docker/api/Dockerfile`,
`docker/web/Dockerfile`, `docker/engine/Dockerfile` — ao contrário do `Dockerfile.prod`,
já não-root desde o [ADR 0024](adr/0024-fase5-imagens-producao-ci.md)) não tinham
diretiva `USER` e rodavam como root. Agora elas rodam com o **mesmo UID/GID do
seu usuário do host**, via os build args `DEV_UID`/`DEV_GID`
([Configuração](reference/configuration.md#dev-container-user-build-time)),
então essa classe de problema não deveria voltar.

**Se você ainda está vendo isso:**

1. Confirme o seu par com `id -u`/`id -g`. Se não for `1000`/`1000`, defina
   `DEV_UID`/`DEV_GID` no `.env` (veja `.env.example`) e reconstrua:
   `docker compose -f docker/docker-compose.yml build api web engine`.
2. **Ambiente anterior a esta correção.** Os volumes nomeados
   (`*_node_modules`, `engine_build`, `engine_deps`, `engine_mix`,
   `engine_hex`) ainda guardam conteúdo escrito pelos containers antigos como root — um
   volume nomeado novinho herda o dono certo na primeira montagem, mas um
   existente não é corrigido retroativamente. Zere-o uma vez, ou
   apagando os volumes (`docker compose -f docker/docker-compose.yml down
   -v` — seguro para estes, são artefatos de build reproduzíveis, nunca fonte
   da verdade) ou dando `chown` neles no lugar:
   ```bash
   docker run --rm -v brabo-dev_api_app_node_modules:/v alpine chown -R "$(id -u):$(id -g)" /v
   # repita para os outros volumes node_modules/_build/deps/.mix/.hex
   ```
   **Volumes novinhos** (um primeiro clone, ou uma máquina que só rodou o
   instalador, que não define nenhum destes volumes) falhavam do outro jeito:
   `api` e `web` saíam com `EACCES: permission denied, mkdir
   '/workspace/node_modules/.pnpm'`, porque um volume novo herda o dono
   do caminho **na imagem** e o caminho não existia lá, então ele
   nascia `root:root` (AT-172). `docker/api/Dockerfile` e `docker/web/Dockerfile`
   agora criam e dão `chown` nos três pontos de montagem de `node_modules` antes do `USER`.
   Os pontos de montagem **dentro do bind mount no seu disco** são uma metade
   separada: o Docker cria um ausente no host como `root` (ele deixou
   `packages/shared/node_modules` com dono root no checkout), e nenhuma imagem consegue
   mudar isso. `pnpm dev` roda `scripts/dev/preflight.mjs`, que os cria
   como você antes; `docker compose up` rodado à mão o pula, então rode
   `pnpm dev:preflight` uma vez antes do seu primeiro `up` à mão.
3. Para um arquivo já escrito por um agente numa pasta de projeto no modo **`mounted`**
   no host, a correção é o mesmo `sudo chown -R $USER <pasta>`
   que esta seção prescrevia para o repositório inteiro — agora é pontual
   para arquivos preexistentes, não o contorno permanente.

4. **Os dois volumes de DADOS são outro caso, e `down -v` NÃO é seguro para
   eles.** `/data/git-repos` e `/data/project-workspaces` são montados em
   `api` e `engine` como volumes nomeados. Um volume nomeado nasce com o dono
   do que existir naquele caminho **na imagem** — e quando o caminho não
   existe, ele nasce `root`, deixando o processo não-root de fora. As imagens de dev
   só começaram a criá-los e dar `chown` antes do `USER` recentemente; as
   imagens de produção sempre fizeram. O sintoma não é um arquivo que você não consegue editar no
   seu disco: é o `git init --bare` do `LocalGitProvider` morrendo com
   `permission denied: /data/git-repos/<slug>.git`, e o
   `permissions.json` de cada projeto sem onde ser escrito — ou seja, **provisionar
   um repositório é impossível**.

   Ao contrário dos volumes de artefato de build acima, estes dois guardam fonte da verdade
   (bare repos locais, worktrees por projeto), então apagá-los perde dados.
   Corrija-os no lugar:
   ```bash
   docker run --rm -v brabo-dev_git_local_repos:/v alpine chown -R "$(id -u):$(id -g)" /v
   docker run --rm -v brabo-dev_project_workspaces:/v alpine chown -R "$(id -u):$(id -g)" /v
   ```
   Um volume criado depois da correção já sobe com o dono certo. Quando
   você acrescentar um volume nomeado **novo**, crie o diretório na imagem:
   esquecer não é erro de build, é um `permission denied` em runtime.

### Reset total do ambiente de dev {#reset-total}

```bash
bash scripts/dev/reset-total.sh      # ou: pnpm bootstrap → Docker › Reset total
```

Reconstrói as imagens, **apaga o banco**, migra e semeia de novo — as
credenciais de provider que já estão no `.env` (`<PROVIDER>_TEST_KEY`) voltam
ativas no owner, então você não as digita de novo na interface toda vez. Ele
**não** remove nem recria volume nenhum — `node_modules`, `_build`/`deps`,
`pgdata` (só os schemas dentro dele são apagados), `neo4j`, os bare repos
locais e os workspaces dos projetos sobrevivem todos — e ele **diz isso** no começo
e ao lado da linha de sucesso (AT-181). Essa é a escolha conservadora de
propósito: apagar volumes jogaria fora workspaces e repositórios locais
que ninguém pediu para perder.

O preço é que **um reset nunca reproduz um primeiro clone.** Um defeito que
só aparece com um volume que ainda não existe — como o volume `node_modules`
que nascia `root` (AT-172) — passa por todo reset sem ser visto. Para
exercitar esse caminho, use um **projeto compose descartável**, nunca este script e
nunca o seu projeto `brabo-dev` (nem `brabo`, o nome da instalação):

```bash
docker compose -p brabo-primeiro-clone -f docker/docker-compose.yml build engine
docker compose -p brabo-primeiro-clone -f docker/docker-compose.yml \
  run --rm --no-deps engine ls -ldn /root/.mix /root/.hex \
  /workspace/apps/engine/_build /workspace/apps/engine/deps
docker compose -p brabo-primeiro-clone -f docker/docker-compose.yml down -v
```

O `run` cria os volumes daquele projeto do zero e não publica porta, então
não colide com a sua stack rodando. Medido assim para o engine em
2026-09-25 (AT-182): `_build`, `deps`, `.mix` e `.hex` nascem com dono
`DEV_UID:DEV_GID`, e `mix local.hex`/`local.rebar`/`deps.get` passam como o
usuário não-root. Duas coisas ele deixa para trás: os pontos de montagem vazios
`_build`/`deps` que cria **dentro do seu checkout**, com dono `root` (remova-os
com o one-liner `alpine` da tabela abaixo), e a imagem que construiu.

**A ordem é a questão, e não é negociável:**

0. **A guarda da instalação** ([ADR 0170](adr/0170-compose-de-dev-brabo-dev.md)),
   antes do preflight: se esta máquina tem qualquer container do compose de
   INSTALAÇÃO (o rótulo `com.docker.compose.project.config_files` dele
   aponta para `docker-compose.install.yml`), ou se o compose de dev resolveria
   para o projeto `brabo`, ele recusa com `RESET NÃO COMEÇOU`, nomeando o que
   encontrou. Até o ADR 0170 dev e instalação eram o mesmo projeto Docker, e
   o `DROP SCHEMA` deste script teria caído no banco da instalação.
1. `preflight`, depois os **pré-requisitos de host** (AT-203), depois `build` — a
   parte lenta, feita enquanto o seu ambiente ainda está de pé. As migrations e o
   seed rodam no HOST, com o `apps/engine/deps`/`_build` e o
   `node_modules` do checkout — não os volumes dos containers, e nada que o build da imagem
   atualize. Então, antes de qualquer efeito, o script roda `mix deps.get` e
   `mix compile` em `apps/engine`, confere que `drizzle-kit` e `ts-node`
   resolvem, e confere a senha do Neo4j contra a do volume. Medido em
   2026-09-26: com uma dependência nova no `mix.lock` (mint 1.10.1, #613),
   `pnpm engine:migrate` morria com `lock mismatch` **depois** do
   `DROP SCHEMA`, e "rodar de novo" falhava do mesmo jeito. Uma recusa aqui diz
   `RESET NÃO COMEÇOU … Nada foi parado nem apagado`: o banco está intacto.
2. **`stop api engine`.** Esses dois, e nenhum outro: são os que mantêm
   conexão viva com o Postgres do compose (o pool do Drizzle da api sobre
   `public`/`drizzle`, o Ecto/Oban do engine sobre `engine`). `web` é um servidor
   Vite e não fala com banco nenhum, `neo4j` é outro banco que este reset
   não toca, e o `broker` só fala HTTP com a api.
3. `up postgres`, `DROP SCHEMA`, `migrate`.
4. `up --wait` de tudo, depois `seed`.
5. Pergunta `/health` à api e ao engine e `/` ao web, imprime
   `docker compose ps`, e só então conclui.

Apagar os schemas **por baixo de processos vivos** era o que o quebrava:
o engine morre dentro do `DROP SCHEMA engine CASCADE`
(`Engine.Sessions.Rehydrator` consulta `engine.session_states`, que acabou de
sumir — `ERROR 42P01 (undefined_table)`), as migrations recriam
tudo depois, e **nada traz um processo morto de volta**. O seed
então falhava no passo que ativa a sessão (api → engine) com
`ECONNREFUSED`, e o script ainda imprimia "reset completo" — um `echo`
fixo no fim de um script que nunca perguntava nada sobre o que tinha
acabado de fazer.

**Se ele parar no meio**, ele diz isso e nomeia o passo
(`RESET INCOMPLETO — parou em: <passo>`), e a resposta é **rodá-lo
de novo**: ele apaga os schemas toda vez, então a segunda execução começa da
mesma lousa limpa que a primeira. Rodar só `pnpm --filter api seed` para
recuperar também é seguro agora — o seed é idempotente e reaproveita o workspace,
o projeto e a sessão de demonstração em vez de duplicá-los (e **não**
reacrescenta os 5 eventos da sessão).

| o que você vê | o que é |
|---|---|
| `RESET INCOMPLETO — parou em: migrations (api + engine)` com `permission denied` sob `apps/engine/_build` | `pnpm engine:migrate` roda no HOST, e o Docker cria um ponto de bind-mount ausente como `root`. Corrija no lugar: `docker run --rm -v "$PWD/apps/engine:/x" alpine chown -R "$(id -u):$(id -g)" /x/_build` |
| `RESET INCOMPLETO … banco apagado, migrado e semeado, mas estes serviços não responderam: <lista>` | o banco está bem; um processo não voltou. `docker compose -f docker/docker-compose.yml --env-file .env logs <serviço>` diz por quê. Nada aqui exige rodar o reset de novo |
| `RESET NÃO COMEÇOU — recusado em: guarda da instalação na máquina (ADR 0170)` | nada foi tocado. Há uma instalação do Brabo nesta máquina (os containers são listados), ou `COMPOSE_PROJECT_NAME=brabo` está definida. Derrube a instalação **sem** `-v` (a recusa imprime o `docker compose -f <pasta>/docker/docker-compose.install.yml --env-file <pasta>/.env down` exato — os volumes e os dados dela ficam) ou tire a variável; veja [Levando um ambiente de dev para brabo-dev](#dev-para-brabo-dev) |
| `RESET NÃO COMEÇOU — recusado em: pré-requisitos de host das migrations` | nada foi tocado. `mix deps.get`/`mix compile` falhou em `apps/engine` no host (leia a saída acima dela), ou `drizzle-kit`/`ts-node` não resolvem — `pnpm install --frozen-lockfile` |
| `O NEO4J RECUSA A SENHA DO .env`, antes de qualquer efeito ou depois de `container brabo-dev-neo4j-1 is unhealthy` | o Neo4j guarda a senha no volume `neo4j_data` quando ele é **criado** e ignora `NEO4J_AUTH` depois, enquanto o healthcheck usa a do `.env`. Medido em 2026-09-26: um volume de 13/09, o container recriado com a senha default, healthcheck `The client is unauthorized due to authentication failure`. Ponha a senha antiga de volta em `NEO4J_PASSWORD`, ou mude-a dentro do Neo4j (`ALTER CURRENT USER SET PASSWORD FROM … TO …`, o comando é impresso), ou — o grafo é derivado, `pnpm --filter api grafo:reprojetar` o reconstrói — remova o volume você mesmo. O script nunca o remove (AT-181) |
| o `up --wait` estoura o tempo | `BRABO_RESET_WAIT_TIMEOUT` (segundos, default 600). Um primeiro boot com volumes `node_modules`/`_build` vazios roda `pnpm install`/`mix deps.get` antes de o processo escutar |

### Levando um ambiente de dev para brabo-dev {#dev-para-brabo-dev}

Desde o [ADR 0170](adr/0170-compose-de-dev-brabo-dev.md) o compose de dev
(`docker/docker-compose.yml`) é o projeto Docker **`brabo-dev`**: containers
`brabo-dev-api-1`, `brabo-dev-postgres-1`…, volumes `brabo-dev_pgdata`,
`brabo-dev_neo4j_data`…, rede `brabo-dev_default`. O compose de instalação
(`docker-compose.install.yml`) continua **`brabo`**, e as instalações
já existentes também. Antes, os dois eram `brabo` — um projeto Docker: subir um
por cima do outro recriava os containers e os ligava ao banco do outro
(medido em 2026-09-19: o banco de uma instalação recebeu uma migration de
dev), e o `reset-total.sh` teria apagado os schemas da instalação.

**O que muda para você se já desenvolvia aqui:** o próximo `pnpm dev`
cria volumes `brabo-dev_*` NOVOS e vazios. Os seus dados ficam onde estavam, nos
volumes `brabo_*`, intocados — nada nesta mudança remove um volume. O
preflight avisa enquanto os vê (ele nunca recusa por isso, e nunca
apaga). Escolha um dos dois caminhos.

**Distinguindo volumes de dev dos de uma instalação.** Os dois levam o rótulo
`com.docker.compose.project=brabo`, então o prefixo sozinho não diz nada. O que diz:

```bash
docker volume ls --filter label=com.docker.compose.project=brabo \
  --format '{{.Name}}\t{{.Label "com.docker.compose.volume"}}'
docker ps -a --filter label=com.docker.compose.project=brabo \
  --format '{{.Names}}\t{{.Label "com.docker.compose.project.config_files"}}'
```

- Volumes que só o compose de dev declara — `api_*_node_modules`,
  `web_*_node_modules`, `broker_*_node_modules`, `engine_build`, `engine_deps`,
  `engine_mix`, `engine_hex` — provam que um ambiente de dev usou o nome `brabo`.
  A instalação nunca os cria.
- Volumes que os dois composes declaram — `pgdata`, `neo4j_data`, `neo4j_logs`,
  `ollama_data`, `git_local_repos`, `project_workspaces`,
  `brabo_projects_base` — são ambíguos sozinhos. Se nenhum container de uma
  instalação existe (o segundo comando não mostra `docker-compose.install.yml`)
  e você nunca instalou o Brabo nesta máquina, eles são os seus dados antigos de dev.
  Se você instalou, eles podem ser da instalação (ou uma mistura, depois do
  acidente que este ADR fecha): não os copie nem apague antes de saber.
  `backup_local` só existe na instalação.

**Caminho A — levar os dados** (o banco, o grafo, os repositórios bare
locais e os workspaces; os volumes de artefato de build não valem a
cópia, os novos se enchem sozinhos no primeiro boot):

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

`cp -a` mantém donos e modos, o que importa para o `pgdata` (a imagem do Postgres
recusa um diretório de dados de que não é dona) e para os dois volumes de dados (veja
[Os containers de dev escrevem como o seu usuário](#dev-containers-nao-root) acima). O Postgres tem de estar **parado**
enquanto o diretório dele é copiado — é para isso que serve o passo 1.

**Caminho B — começar do zero:** só rode `pnpm dev`, depois
`bash scripts/dev/reset-total.sh` para migrar e semear o banco novo. Os
volumes antigos ficam no disco até você removê-los.

**Removendo os volumes antigos, só depois de a stack nova funcionar e só os que
você provou serem de dev** (os da instalação são dados que você perderia):

```bash
docker volume rm brabo_api_root_node_modules brabo_engine_build  # …um a um, pelo nome
```

Nenhum script faz isso por você, de propósito: `docker volume rm` do
`brabo_pgdata` de uma instalação é o único erro aqui que não se desfaz.

---

### Ligando o acesso rápido na instalação local (TP-01) {#acesso-rapido-local}

O acesso rápido por papel (ADR 0245, RN-984) só existe em imagem construída
nesta máquina, nunca nas das Actions. Para a instalação local do TP-01
(`~/brabo-v7`):

1. No checkout da `dev`: `AMBIENTE=local docker buildx bake` (ou os
   `docker build` com `--build-arg BRABO_AMBIENTE=local` na api e
   `--build-arg VITE_BRABO_AMBIENTE=local` no web).
2. No `.env` da instalação: `BRABO_AMBIENTE=local` e `BRABO_BIND=127.0.0.1`
   (sem o bind, a porta fica aberta na rede e qualquer um entra como owner).
3. Copie o `docker/docker-compose.install.yml` novo para a pasta da
   instalação (o de lá é cópia).
4. `docker compose up -d`. A tela de login mostra o botão "Acesso rápido"; as
   contas `<papel>@brabo.dev` ficam num workspace próprio. A instalação precisa
   já ter a primeira conta (sem usuário a rota responde 409).

Para desligar: reconstrua sem `AMBIENTE` e tire `BRABO_AMBIENTE` do `.env`.
O `install.sh` não liga o `local`.

## Deploy local {#deploy-local}

Sobe o Brabo inteiro num cluster local e o valida com um
smoke test. Decisões no
[ADR 0025](adr/0025-fase5-deploy-kubernetes-kustomize.md).

### Pré-requisitos {#prerequisites}

Obrigatórios no PATH: `docker`, `kubectl`, `kustomize`, `jq`, `openssl`.

`k3d` e `helm` **não** precisam estar instalados — o bootstrap os instala
em `~/.local/bin`, numa versão fixada com checksum conferido. Garanta que
esse diretório está no PATH.

Recursos: a stack inteira (Postgres, Prometheus, dois operators e os
três apps) pede cerca de **4 GiB** livres.

### Subir {#bringing-it-up}

```bash
make deploy-local           # constrói as imagens, sobe o cluster, instala, valida
make deploy-local-clean     # o mesmo, sem reconstruir as imagens
```

No fim: web em <http://localhost:8088>, api em `:3000`, engine em
`:4000` — **as mesmas portas do `docker-compose.prod.yml`**, de propósito (ADR
0025, decisão 10). O bootstrap roda o seed, que cria
`owner@brabo.dev` já verificado com a senha de
`BRABO_SMOKE_PASSWORD` (default `brabo12345678`) — é com isso que você entra
no próprio login do web.

O seed roda **depois** dos rollouts (o último passo dele ativa uma sessão,
o que faz a api chamar o engine), e o bootstrap só segue depois de
**verificar que o login devolve 200**. Essa checagem é por resultado, não
por processo, e existe porque a anterior não era:
`wait --for=condition=Ready=false` é satisfeito por um pod que nunca chegou a
rodar, e por isso o bootstrap anunciava "usuário do smoke pronto"
enquanto o login devolvia 401.

> **O seed é idempotente.** Rodá-lo de novo sobre um banco semeado é o
> caso normal (`BRABO_KEEP_CLUSTER=1`): o workspace, o projeto e a sessão da
> demonstração são encontrados e reaproveitados, nunca duplicados, e a sessão reaproveitada
> não ganha os cinco eventos de novo (`apps/api/src/db/seed.ts`, o
> docblock do topo). Uma segunda execução não morre mais em `workspaces_slug_unique`. O
> bootstrap ainda decide pelo **login**, não pela fase do pod, e ainda
> remove o pod no fim para ele não reprovar o passo 1 do `smoke.sh`, que
> exige todo pod saudável.

> **Isto ocupa as portas do `pnpm dev`.** Manter as portas iguais é o que
> faz o `smoke.sh` valer para os dois modos, e o preço é que eles não
> coexistem: com o cluster de pé, o `pnpm dev` não consegue publicar a porta da `api` e
> **a 5173 nunca abre**. Repare que o web muda de porta entre os modos —
> 8088 aqui, 5173 lá. Para voltar ao desenvolvimento:
>
> ```bash
> make k8s-down && pnpm dev
> ```
>
> `pnpm dev:preflight` diz em que modo você está, sem adivinhação. Os dois
> são tratados em
> [Primeiros passos](getting-started.md#the-two-local-modes-dont-coexist).

Outros alvos:

```bash
make smoke-k8s        # só o smoke test, contra o cluster rodando
make hpa-test         # prova que o HPA do engine escala pela fila
make k8s-validate     # renderiza os overlays e valida contra o schema (sem cluster)
make k8s-logs         # últimas linhas de api, engine e web
make k8s-down         # remove o cluster
```

Variáveis: `BRABO_SKIP_BUILD=1` (usa as imagens do daemon),
`BRABO_KEEP_CLUSTER=1` (reaproveita o cluster), `BRABO_CLUSTER_TOOL=kind`,
`BRABO_SKIP_OBSERVABILITY=1` (sem Tempo, Loki, Collector, Alloy nem Grafana —
AT-177). A última é uma recusa explícita para as provas agendadas e o
default não muda: `make deploy-local` ainda sobe a stack inteira.
Prometheus e prometheus-adapter ficam de qualquer jeito, porque o HPA do engine
escala por `oban_queue_depth` pela External Metrics API que eles servem.
Releases de helm independentes (ESO, CNPG, metrics-server, Prometheus) instalam em
paralelo; cada uma escreve o próprio log, impresso só se falhar.

### Validar uma tag da esteira {#validar-tag-do-pipeline}

```bash
make deploy-local TAG=v0.2.0-qa.1
```

A esteira da Fase 6 **não faz deploy** — ela termina na tag. `TAG=` é como
você vê, no cluster local, o que aquela tag carimbou: o bootstrap faz um
checkout destacado da tag e constrói as imagens a partir daquele commit.

Ele **recusa** rodar com árvore suja, em vez de adivinhar o que fazer
com o seu trabalho em andamento. Ao terminar você fica num HEAD
destacado; o comando para voltar aparece no log.

Verificação: **nenhuma**. Nenhum workflow passa `TAG=`: o agendado
`propriedades.yml` constrói a árvore do checkout, nunca uma tag, então o checkout
destacado em `deploy/k8s/bootstrap.sh` (e a recusa dele com árvore suja) roda
só quando alguém o digita. O que ele sobe depois é o mesmo bootstrap
e smoke do [Deploy local](#deploy-local), que são provados.

### Fazendo deploy das imagens de uma release {#imagens-de-uma-release}

Desde o [ADR 0119](adr/0119-imagens-publicadas-no-ghcr-por-digest.md) toda
tag final publica as imagens de produção no GHCR
(`ghcr.io/daneiel/brabo-{api,engine,web,backup,broker}`, públicas — nenhum
`imagePullSecret` em lugar nenhum) e registra o que publicou, **por digest**,
em `.release/images.json`. A quinta, o broker de containers
([ADR 0162](adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)), é
para instalações — o overlay não tem Deployment do broker, e
`make imagens-do-release` escreve só as outras quatro.

Os overlays deste repositório mantêm `newTag: REPLACE_WITH_DIGEST`, um
marcador. **O repositório nunca declara que release está em produção** —
você declara, na hora do deploy:

```bash
# 1. pegue o registro da release de que você está fazendo deploy
gh release download v3.2.0 --pattern images.json --dir .release

# 2. escreva os digests dela no overlay
make imagens-do-release OVERLAY=prod      # ou OVERLAY=staging

# 3. leia o diff antes de aplicar qualquer coisa
git diff deploy/k8s/overlays/prod/kustomization.yaml
```

Três coisas que vale saber antes de rodar:

- **Não commite o resultado.** `kustomize edit` faz a ida e volta do YAML: ele
  reordena chaves e desprende os comentários. A mudança é feita para viver na
  sua árvore de trabalho o tempo de um `kubectl apply -k`, e não mais.
- **`digest:` substitui `newTag:`**, que é a questão — uma tag mutável em
  produção quer dizer nenhum rollback determinístico e dois pods do mesmo
  ReplicaSet possivelmente rodando binários diferentes.
- **Rollback é o mesmo comando com o arquivo da release anterior.** Não há
  mais nada a desfazer: o digest é o estado inteiro.

Se `make imagens-do-release` diz que não acha `.release/images.json`, você
pulou o passo 1. Se não acha `kustomize`, a versão que o CI usa está
fixada em `KUSTOMIZE_VERSION`, em `.github/workflows/ci.yml`.

Verificação: `scripts/ci/aplicar-imagens.spec.ts`, em todo PR, prova a
metade do passo 2 que **lê** o arquivo — ele aceita o `images.json` que o
`release.yml` escreve e recusa um sem `imagens`, com lista vazia, ou sem
versão e commit. O que ele entrega ao `kustomize edit set image` é provado por
`scripts/ci/images-manifest.spec.ts` — sempre por digest, nunca uma tag, e só
as quatro imagens que a base do kustomize declara. Rodar o `kustomize` no overlay
não tem spec. A corrente inteira
(baixar o arquivo de uma release real, escrevê-lo, `kubectl apply -k`) **nunca
rodou como prova**: nada aplica os digests de uma release a um cluster, e o
cluster agendado roda imagens construídas da árvore, não as publicadas.

### Que versão está no ar {#que-versao-esta-no-ar}

Três lugares dizem a mesma coisa, e a resposta é a versão **cozida
no artefato** — não uma configuração que alguém poderia ter mudado por
acidente
([ADR 0036](adr/0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md)):

1. **A tela de login**, no rodapé. O caminho mais rápido, e não precisa de
   acesso ao cluster: abra `/login` e leia o primeiro item do rodapé.
2. **A tag da imagem**, se você tem `kubectl`:

   ```bash
   kubectl -n brabo get deploy -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.template.spec.containers[0].image}{"\n"}{end}'
   ```

3. **`service.version` nos spans**, da api, no Tempo. O único
   dos três que amarra uma requisição específica a um build.

`dev` nos três não é falha: é o que uma imagem construída fora do
`release.yml` informa, porque não nasceu de tag nenhuma. `docker
compose`, `make deploy-local` sem `TAG=` e um build local caem todos
aí.

**Divergência entre os três é o achado.** O rodapé mostrando uma
versão e a tag da imagem outra quer dizer cache do bundle no navegador ou
no nginx, não deploy errado — o bundle e a imagem vêm do mesmo
build. Recarregue ignorando o cache antes de suspeitar do cluster.

### O gate de SecOps está preso em "SAST não rodou" {#semgrep-do-gate}

O fio da sessão mostra um `agent.error` do SecOps (origem `infra`) dizendo
`SAST não rodou: semgrep falhou (:invalid_output), pulado` (ou `:sem_saida`,
ou `indisponível`) e a PR fica em `awaiting_secops`. Desde a
[RN-714](business-rules/engine.md#rn-714) o gate nunca aprova sem análise
estática: ele fica pendente e bloqueia a PR. Depois de corrigir a causa abaixo,
o gate roda de novo sozinho — no próximo reinício do engine, ou quando o
`GateRescuer` acha o ciclo parado (15 minutos). O erro aparece uma vez por
motivo: um resgate que bate no mesmo motivo de novo só o registra no
servidor do engine. Antes da RN-714 a mesma
falha aprovava o gate. Nos composes de produção e de instalação o
engine roda com `read_only: true` e um tmpfs em `/home/engine`; quando esse
tmpfs é criado `root:root`, o usuário do engine (uid 1000) não consegue criar
`/home/engine/.semgrep`, o semgrep sai com stdout vazio, e o gate
não consegue ler um resultado.

Confira de dentro do engine rodando:

```bash
docker exec brabo-engine-1 sh -c 'ls -ld /home/engine; id -u'
```

A pasta tem de pertencer ao uid 1000. Os dois composes declaram
`/home/engine:uid=1000,gid=1000,mode=0700` desde a RN-707; uma instalação
criada antes dela mantém a linha antiga até o compose dela ser atualizado e o
serviço `engine` ser recriado (`docker compose ... up -d engine`). O Kubernetes
não é afetado (`fsGroup: 1000`). Um binário `semgrep` ausente bloqueia o gate
do mesmo jeito. O semgrep ainda busca as regras dele no
registry: sem saída de rede a varredura falha com `scan_failed`, que é uma
causa diferente.

Um `scan_failed` também pode vir de um semgrep **sem `semgrep-core`**, o
binário que faz a varredura:

```bash
docker exec brabo-dev-engine-1 semgrep --version   # compose de dev
docker exec brabo-dev-engine-1 sh -c 'semgrep --config p/security-audit --json --quiet --metrics=off /tmp >/dev/null'
# "Failed to find semgrep-core in PATH or in the semgrep package." (exit 2)
```

O Semgrep 1.179.0 parou de publicar wheels `musllinux`, então na imagem Alpine do engine
o pip o constrói a partir do sdist e o binário do core falta. Os dois Dockerfiles do engine
fixam `SEMGREP_VERSION=1.183.0` (o de dev desde 02/10, mantido igual
ao de produção por `scripts/ci/semgrep-do-engine.spec.ts`); uma imagem de dev construída
antes disso se reconstrói com `docker compose -p brabo-dev up -d --build engine`.
Subir a versão exige uma release que tenha wheel `musllinux` no PyPI.

### O engine aborta com `sys_sigaltstack(): Internal error` {#engine-sigaltstack}

`sys/unix/sys_signal_stack.c:101:sys_sigaltstack(): Internal error: Failed to
set alternate signal stack`, exit 134, no boot ou no build da imagem (`mix
local.hex`, `mix compile`): o ERTS pediu à musl uma pilha de sinal de tamanho fixo
que a musl ≥ 1.2.6 recusa em CPUs com AMX (erlang/otp#11349). Aparece de forma
intermitente no CI (só alguns runners têm AMX) e determinística num
servidor desses. O engine roda OTP 29.1.1, que tem a correção
([ADR 0209](adr/0209-engine-em-otp-29.md)); vê-lo de novo quer dizer uma imagem com
OTP < 29.1 em Alpine ≥ 3.24 — reconstrua a partir dos Dockerfiles atuais. O passo de build
do CI "O host tem AMX?" diz se uma dada execução caiu num host desses.

### Erro de CORS {#erro-de-cors}

A mensagem do navegador nomeia o **destino** da chamada, nunca a
causa. Leia primeiro a **origem** que ela cita — é essa a informação útil
([ADR 0037](adr/0037-cors-do-engine-e-a-porta-como-contrato.md)):

```
Access to fetch at 'http://localhost:3000/health' from origin
'http://localhost:5174' has been blocked by CORS policy
                     ^^^^ esta parte é o diagnóstico
```

**Se a origem não é a que você espera** (`:5174` em vez de `:5173`, um
host diferente, `https` em vez de `http`), o problema é a origem, não o
CORS.

Nos composes, `WEB_ORIGIN` é **derivada** de `WEB_PORT` — mudar
`WEB_PORT` no `.env` (a orientação dos [primeiros passos](getting-started.md)
para porta ocupada) já move a origem aceita junto, então essa
divergência específica não acontece mais. O que ainda causa isto: alguém
passou `--port` direto ao Vite fora do compose (o ADR 0037 fez o Vite
recusar subir nesse caso, via `strictPort`, em vez de subir em silêncio
noutra porta), o web é servido por outro caminho, ou
`WEB_ORIGIN` foi definida à mão e sobrepôs a derivação. Corrija a origem,
ou acrescente-a a `WEB_ORIGIN` — **nos dois serviços**, que leem a mesma
variável.

**Se a origem está certa**, confirme o que cada serviço de fato responde.
`curl` não faz CORS, então mostra o cabeçalho cru — exatamente o que o
navegador olha:

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

**Saída vazia é o achado**: o serviço não reconheceu a origem.
`WEB_ORIGIN` errada ou ausente, ou a porta errada.

**Um preflight sem o cabeçalho que o web manda** é o outro modo de
falha, e o mais enganoso: a lista `allowedHeaders` da api é explícita
e **nenhum teste faz preflight**, então um cabeçalho novo do cliente passa no CI e
quebra só no navegador. A lista de hoje é `Content-Type`,
`Authorization`, `X-CSRF-Token`, `traceparent`.

Três coisas que **não** são problema de CORS, por mais que pareçam
um:

- **api ↔ engine.** CORS é mecanismo do navegador; ali quem chama é um
  cliente HTTP do lado do servidor, que ignora esses cabeçalhos. Uma falha nesse
  caminho é o service token (`401`/`403` — veja
  [rotação](#rotacao-das-chaves-do-auth)) ou o endereço errado
  (`ECONNREFUSED` — veja [a sessão não sai de `created`](#sessao-nao-ativa)).
- **O canal Phoenix ficando em silêncio.** WebSocket não passa por CORS.
  Quem recusa é o `check_origin` do endpoint, também alimentado por
  `WEB_ORIGIN`, e a recusa aparece no log do engine — não no
  console do navegador como erro de CORS.
- **O `/metrics` do engine bloqueado no navegador.** Isso é deliberado: uma
  métrica interna não é feita para ser legível pelo JavaScript da página. Use
  `curl`.

### A sessão não sai de `created` {#sessao-nao-ativa}

Sintoma: ativar uma sessão não faz nada. "Abrir sessão criativa" cria
a sessão e a tela não se mexe; "Ativar sessão" também não.
No log da api, `POST /projects/:id/sessions/:id/transition` devolve
`500`:

```
TransitionSessionUseCase.activate ✗ TypeError
  ↳ HttpApiToEngineClient.startSession ✗ TypeError: fetch failed
      caused by: AggregateError [ECONNREFUSED]
```

Ativar uma sessão é o primeiro passo que **atravessa** para o engine
(a api pede a sessão supervisionada por HTTP interno), então é
aqui que um `ENGINE_URL` errado aparece — e não antes, porque nada mais
no caminho de criação sai da api.

Confirme de **dentro** do container, que é onde o endereço importa
(`brabo-dev-api-1` no compose de dev; numa instalação é `brabo-api-1`,
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

`engine:4000` respondendo `200` enquanto `localhost:4000` dá
`ECONNREFUSED`, com `ENGINE_URL=http://localhost:4000`, é o diagnóstico
fechado: **dentro do container, `localhost` é a própria api**.

A causa costuma ser o `.env`, não o compose. `pnpm dev` passa o `.env`
como `--env-file`, e um valor ali **vence** o
`${ENGINE_URL:-http://engine:4000}` do compose. Correção: remova (ou comente) a
linha `ENGINE_URL` do seu `.env` e recrie a api —

```bash
docker compose -f docker/docker-compose.yml --env-file .env up -d api
```

— porque cada ambiente já traz o default certo sem ela:
o compose aponta para o serviço `engine`, e a api rodando no host
cai em `http://localhost:4000` pelo próprio código. Definir a
variável só faz sentido para apontar para um engine que não é nenhum dos dois.
Vale também para o compose de **produção**, que usa a mesma
interpolação; no Kubernetes o valor vem do ConfigMap e sempre
foi `http://engine:4000`.

Duas checagens antes de culpar o endereço, se `ENGINE_URL` está correta:

- **O engine está de pé?** `docker compose ps engine` e
  `curl -sI http://localhost:4000/health`. `ECONNREFUSED` com o
  endereço certo quer dizer serviço fora do ar, não mal configurado.
- **Uma sessão que ativa e se fecha sozinha ~30s depois** não é este
  problema. Olhe o `termination_reason`: `heartbeat_timeout` quer dizer que a
  ativação funcionou e ninguém entrou no canal Phoenix — comportamento
  esperado ao ativar de fora da interface
  (`SESSION_HEARTBEAT_TIMEOUT_MS`). `conversation_idle_timeout` é o
  outro: um agente conversacional esperou o usuário por mais
  de `SESSION_CONVERSATION_IDLE_TIMEOUT_MS` (8h), contadas do fim do
  turno dele ([RN-581](business-rules/api.md#rn-581)). Para mudar esse teto,
  defina a variável no `.env` (os três composes a mapeiam para o engine)
  ou, no Kubernetes, acrescente um item `env:` ao patch do engine no overlay:
  `deploy/k8s/` não a escreve de propósito, porque uma variável ausente
  ali já é o default de 8h do código (AT-153). Um `409` com
  `reason: "sessao_encerrada"` depois disso é a sessão fechada recusando
  conversa — abra uma sessão nova.

### A aba Terminal fica presa em "Abrindo terminal..." para sempre {#terminal-preso-abrindo}

Sintoma: num projeto em modo `runner` (ADR 0103/0104), a aba Código → Dev → Terminal
nunca sai do esqueleto de carregamento. O console do navegador mostra, num
laço apertado com backoff crescente:

```
socket do terminal com erro {"erro":"[object Event]"}
socket do terminal fechado
```

Isto é o WebSocket do navegador nunca alcançando o engine, não um
problema do runner — acontece até antes de qualquer `brabo-runner` conectar. Três
causas empilhadas, todas fechadas pela [RN-433](business-rules/infra.md#rn-433):

1. **`ENGINE_PUBLIC_URL` resolvendo para um hostname interno do Docker.** O
   ticket que a api entrega ao navegador (`POST .../terminal-ticket`) leva
   `engineWsUrl`, montado a partir de `ENGINE_PUBLIC_URL` — distinta de
   `ENGINE_URL` (RN-419), que é para chamadas api→engine **dentro** da
   rede do compose. `docker/docker-compose.yml` agora define
   `ENGINE_PUBLIC_URL: ${ENGINE_PUBLIC_URL:-http://localhost:4000}` no
   serviço `api` (o mesmo default que `VITE_ENGINE_URL` já usa para o `web`).
   Confirme de dentro do container:

   ```bash
   docker exec brabo-dev-api-1 sh -c 'echo $ENGINE_PUBLIC_URL'
   # esperado: http://localhost:4000 (ou o endereço público real do seu engine)
   ```

   Um valor vazio aqui num ambiente construído antes desta correção quer dizer que o
   código caiu para `ENGINE_URL` (`http://engine:4000`) — um hostname que
   só resolve dentro da rede do Docker, nunca a partir do navegador. Correção:
   reconstrua/recrie o container `api` para o novo default do compose valer,
   ou defina `ENGINE_PUBLIC_URL` explicitamente no `.env` se o endereço público
   real do engine for outro (um túnel, outro host).
2. **Um socket que nunca abre tentava de novo para sempre, em silêncio.**
   Independente do endereço acima — mesmo um engine genuinamente inalcançável
   (fora do ar, atrás de firewall) deveria aparecer como erro, nunca girar para sempre.
   `apps/web/src/lib/terminal-channel.ts` agora desiste depois de 8s se o
   socket não abriu, e mostra o `RunnerOnboardingPanel` com uma
   mensagem acionável em vez de ficar no laço do comportamento padrão de
   reconexão do WebSocket do navegador.
3. **A URL do socket duplicava o caminho.** O bloqueio de verdade depois que
   os dois primeiros foram corrigidos: `terminal-channel.ts` concatenava
   `/runner/websocket` num `engineWsUrl` que a api já devolve
   completo (`ws://host:port/runner`) — e o próprio construtor `Socket` do `phoenix.js`
   acrescenta `/websocket` de novo sobre qualquer endpoint que
   receba. O engine recebia `GET /runner/runner/websocket/websocket` e
   o rejeitava (`Phoenix.Router.NoRouteError`), visível em
   `docker logs brabo-dev-engine-1` como uma conexão que nunca passa de
   `REFUSED CONNECTION`. Corrigido passando `engineWsUrl` direto ao
   `Socket` — `apps/runner/src/channel.ts` (o lado do CLI do mesmo
   contrato) já fazia isso corretamente.

### O runner inunda a api com um ticket morto {#runner-com-ticket-morto}

Sintoma: o web começa a responder **429** às requisições da própria pessoa, sem
atividade incomum da parte dela; e/ou um projeto em modo `runner` aparece como
sem agente local (tarefas de dev presas em `dev.blocked_by_container`,
`RunnerReadiness` recusando) enquanto o `brabo-runner` está visivelmente rodando na
máquina dela.

**Como confirmar.** No log do engine, procure o MESMO ticket sendo
recusado de novo e de novo, numa cadência fixa de cerca de **5,13 s**:

```bash
docker logs brabo-dev-engine-1 2>&1 | grep 'REFUSED CONNECTION TO EngineWeb.RunnerSocket' | tail -20
```

Dezenas dessas em poucas horas, todas com a mesma string de ticket, é a
assinatura. ~5,13 s não é arbitrário — é o teto do backoff interno
`reconnectAfterMs` do `phoenix.js`.

**Causa.** O ticket do socket é de **uso único**
([RN-108](business-rules/web.md#rn-108)); o auto-reconnect embutido
da biblioteca repete os MESMOS `params`, então ele tenta de novo um ticket que foi
consumido na primeira conexão e nunca mais será aceito. Uma versão
de `apps/runner/src/channel.ts` saiu com esse auto-reconnect LIGADO —
enquanto o docblock do próprio módulo afirmava que ele estava neutralizado. Empilhado na
política PRÓPRIA de nova tentativa do runner (que está correta: ticket fresco por rodada, backoff,
teto de tentativas consecutivas), o resultado medido foi **530 requisições em
um minuto** contra o teto de 300 req/min do `RATE_LIMIT_USER`, quatro minutos
seguidos acima do limite. O limite é **por usuário**, e é por isso que o 429
apareceu no navegador do dono da conta e não em algum lugar perto do runner.

A segunda consequência é a pior: enquanto preso nesse laço o runner
**não está conectado**, então o `RunnerReadiness` ([RN-507](business-rules/runner.md#rn-507))
recusa e o projeto parece não ter agente local — parte do que se lê
como "o container não sobe" é isto.

**Correção.** Atualize o binário `brabo-runner` (ou reinstale a partir da tela
do projeto). Nada a mudar no servidor: o rate limiter fez o trabalho dele, e o
engine estava certo em recusar cada um daqueles tickets. Se a inundação ainda
está em curso, parar o runner a encerra na hora, e os 429 somem à medida que
a janela deslizante esvazia (um minuto).

### A api recusa subir por segredo de OAuth {#segredo-de-oauth-no-boot}

Sintoma: com `NODE_ENV=production`, a api morre no início com uma mensagem
sobre `GIT_OAUTH_STATE_SECRET` — ausente, definida com o valor de exemplo
do repositório, ou curta demais.

**Não é regressão, e não a contorne.** Esta chave assina o `state` do
OAuth de git, e o `state` é o que impede o callback público de ser
forjado. Antes do [ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md)
a api subia com um default publicado aqui mesmo neste repositório —
quem vê este erro tinha, até agora, o fluxo de conexão de git aberto a
qualquer um. O boot falhar é o aviso chegando, atrasado.

```bash
export GIT_OAUTH_STATE_SECRET="$(openssl rand -base64 32)"
```

No Kubernetes o valor vem de `brabo-secrets`, sob a chave de mesmo nome
do objeto `brabo` no cofre de segredos, que
`deploy/k8s/base/common/externalsecrets.yaml` puxa inteiro — se o erro apareceu
lá, o problema é o cofre não entregar a chave, e o caminho é
[Diagnóstico do deploy](#diagnostico-do-deploy).

Trocar a chave **invalida os `state`s em voo**: quem está no meio de
"conectar GitHub" naquele instante é recusado e refaz o fluxo. Como
o TTL do `state` é de 10 minutos, essa é a janela — não há migração
a fazer, e nenhuma conexão **já estabelecida** é afetada (o
token guardado não depende desta chave).

### O provider recusa o callback do login social {#callback-login-social-nao-registrado}

Sintoma: clicar em "Entrar com GitHub"/"Entrar com GitLab" na tela de
login vai ao provider e volta com um erro DO PRÓPRIO PROVIDER
(`redirect_uri_mismatch` no GitHub, "The redirect URI included is not
valid" no GitLab) — nem chega a
`/auth/oauth/:provider/callback`.

**Não é bug do produto — é um cadastro faltando do lado do
provider.** O login social ([ADR 0084](adr/0084-login-social-github-e-gitlab.md))
reaproveita o MESMO OAuth App que a conexão de git já usa
(`GITHUB_OAUTH_CLIENT_ID`/`GITLAB_OAUTH_CLIENT_ID`, nenhuma variável nova), mas
cada FLUXO tem o próprio `redirect_uri`, e o provider exige que TODOS
os que a api pode pedir estejam cadastrados antes:

- Conexão de git (já existia): `${API_PUBLIC_URL}/git/oauth/<provider>/callback`
- Login social (novo): `${API_PUBLIC_URL}/auth/oauth/<provider>/callback`

Cadastre o segundo na configuração do OAuth App (GitHub: Settings
→ Developer settings → OAuth Apps; GitLab: Settings → Applications) — o GitHub
aceita várias URLs de callback no mesmo App, o GitLab também. Não precisa de
App separado nem de client id/secret novos.

### Os quatro segredos irmãos também não sobem com o default {#segredos-irmaos-no-boot}

Sintoma: com `NODE_ENV=production`, a api (ou, para `SECRET_KEY_BASE`
e `BRABO_SERVICE_TOKEN`, a release `:prod` do engine, que recusa os
mesmos valores de token desde a [RN-601](business-rules/engine.md#rn-601)) morre
no início com uma mensagem sobre `AUTH_JWT_SECRET`,
`BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` ou `SECRET_KEY_BASE` —
ausente, definida com o valor de exemplo do repositório, ou curta demais.

**Mesma causa do segredo de OAuth acima, e a mesma orientação: não é
regressão, e não a contorne.**
O [ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md) já
declarava estes quatro como pendentes — o mesmo padrão, só ainda não
replicado — e a [RN-114](business-rules/api.md#rn-114) o fechou. Cada um protege
uma coisa diferente:

- `AUTH_JWT_SECRET` público = qualquer um pode derivar o par que assina o
  access token e forjar um válido.
- `BRABO_SERVICE_TOKEN` público = qualquer um pode chamar `/internal/*` passando por cima do
  `EngineServiceGuard`.
- `CREDENTIALS_MASTER_KEY` público = qualquer um pode decifrar o cofre de
  credenciais do usuário (chaves de LLM, tokens de git).
- `SECRET_KEY_BASE` (engine) já tinha `raise` no `runtime.exs` — o
  defeito era só o compose mascarando esse `raise` com um fallback
  público.

```bash
export AUTH_JWT_SECRET="$(openssl rand -base64 32)"
export BRABO_SERVICE_TOKEN="$(openssl rand -base64 32)"
export CREDENTIALS_MASTER_KEY="$(openssl rand -base64 32)"
export SECRET_KEY_BASE="$(openssl rand -base64 64)"
```

Nada muda no Kubernetes, pelo mesmo motivo de
`GIT_OAUTH_STATE_SECRET`: os quatro já vinham de `brabo-secrets`,
sob a chave de mesmo nome do objeto `brabo` que
`deploy/k8s/base/common/externalsecrets.yaml` puxa inteiro.

**O grafo de conhecimento (`NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD`,
[ADR 0099](adr/0099-neo4j-grafo-de-conhecimento-e-templates.md)) segue
a mesma regra, com uma diferença**: `NEO4J_URI` e `NEO4J_USER` têm um
default de desenvolvimento seguro (`bolt://neo4j:7687`, `neo4j` — não são
segredos, e o `docker-compose.prod.yml` já os fornece); só
`NEO4J_PASSWORD` não tem default público, pelo mesmo motivo dos quatro
acima — e sem ela o boot da api falha em
`GraphStore.onModuleInit` (`neo4j-config.ts`) ANTES mesmo de o próprio Neo4j
recusar subir (o entrypoint da imagem oficial exige senha de 8+
caracteres; um `NEO4J_AUTH` vazio derruba o container `neo4j` primeiro).

```bash
export NEO4J_PASSWORD="$(openssl rand -hex 24)"
```

**Em desenvolvimento a chave é `NEO4J_URI`, e ela vem vazia por padrão.** O
serviço `neo4j` roda no profile padrão do compose de dev, então o servidor está de pé
falando alguém com ele ou não; a api só conecta quando `NEO4J_URI` está
definida. Descomente-a no `.env` (`bolt://neo4j:7687`) e recrie a api —
o `GraphStore` então registra `Neo4j conectado — constraints do grafo garantidas`
em vez de `NEO4J_URI/NEO4J_USER/NEO4J_PASSWORD ausentes`. Usuário e senha
chegam ao container com os mesmos defaults que o serviço `neo4j` usa para
`NEO4J_AUTH`, então defina-os só para TROCAR a senha, e trocá-la ali
muda os dois lados de uma vez.

Até isto ser ligado, o `docker-compose.yml` não passava as três variáveis ao
serviço `api` de jeito nenhum e o serviço não tem `env_file` — então o bloco
que o `.env.example` documentava desde que o grafo nasceu não chegava a nada, e
descomentá-lo não ligava nada. O `docker-compose.prod.yml` as fornecia
desde o primeiro dia (é por isso que só o desenvolvimento foi afetado): um Neo4j saudável ficava
ao lado de uma api informando as variáveis ausentes, indefinidamente.

**HEX, não base64.** O entrypoint do Neo4j lê `NEO4J_AUTH` como
`usuario/senha` e separa na PRIMEIRA barra — uma senha base64 pode
conter `/` (o alfabeto tem `/` e `+`), e isso quebra o parse com
`Invalid value for NEO4J_AUTH`, derrubando o container `neo4j` num
laço de reinício. Isso aconteceu de verdade: o smoke test do CI falhou assim depois de
um merge que reintroduziu `-base64` por engano. Hex não tem `/`, `+` nem `=`.

O `docker/smoke.sh` já gera as cinco variáveis efêmeras acima (os
quatro irmãos mais `NEO4J_PASSWORD`, esta em hex) a cada execução — é
assim que o job de CI
"Build, scan e smoke das imagens de produção" sobe o
`docker-compose.prod.yml` sem
nenhum segredo commitado.

Trocar `AUTH_JWT_SECRET` ou `BRABO_SERVICE_TOKEN` sem a
dança do `_PREVIOUS` tem o mesmo efeito já documentado em
[Rotação das chaves do auth](#rotacao-das-chaves-do-auth); trocar
`CREDENTIALS_MASTER_KEY` sem re-embrulhar tem o mesmo efeito já
documentado em
[Rotação da chave mestra](#rotacao-da-chave-mestra). Esta checagem de BOOT não
muda nenhum dos dois procedimentos — ela só impede a chave de chegar à produção
como o literal público deste repositório.

### SMTP real no `MailSender` {#smtp-real}

O `MailSender` envia e-mail de verdade só quando `MAIL_TRANSPORT=smtp` — o
default é `log` (o comportamento de sempre), **inclusive em produção**:
enviar e-mail de verdade é escolha explícita do operador
([ADR 0096](adr/0096-smtp-real-no-mailsender.md)). Veja
[Configuração](reference/configuration.md#api) para a tabela completa de `SMTP_*`.

Sintoma de configuração incompleta: com `NODE_ENV=production` e
`MAIL_TRANSPORT=smtp`, a api morre no início reclamando de
`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` ou `SMTP_FROM` — mesmo padrão
de mensagem dos
[quatro segredos irmãos](#segredos-irmaos-no-boot) ([RN-408](business-rules/api.md#rn-408)),
mas SEM o default público que eles têm: aqui a regra só entra em cena
quando o operador escolheu `smtp`.

```bash
export MAIL_TRANSPORT=smtp
export SMTP_HOST=smtp.seu-provedor.com
export SMTP_PORT=587
export SMTP_USER=usuario-do-provedor
export SMTP_PASSWORD="$(sua-credencial-do-provedor)"
export SMTP_FROM="Brabo <nao-responda@seu-dominio.com>"
```

`SMTP_PASSWORD` é um segredo de INFRAESTRUTURA do serviço (uma variável de ambiente simples, como
`AUTH_JWT_SECRET`), não um segredo de USUÁRIO — ele não passa por envelope
encryption, e não tem procedimento de rotação próprio além de trocar a
variável e reiniciar (o provedor de SMTP decide a política de rotação
dessa credencial). No Kubernetes, a chave vai para o objeto `brabo` do
cofre de segredos como qualquer outra, e chega a `brabo-secrets` sem mudança de
manifesto — `deploy/k8s/base/common/externalsecrets.yaml` puxa o objeto
inteiro.

Se o e-mail não chega mesmo sem erro de boot: confira no log da api
`falha ao enviar e-mail via SMTP` (`type`/destinatário aparecem, o corpo e
o token NUNCA aparecem — mesma regra do `LogMailSender`), e teste a
credencial com o próprio cliente SMTP do provedor antes de suspeitar do Brabo.

### k3d é o padrão mesmo com kind instalado {#k3d-is-the-default-even-with-kind-installed}

Não é preferência. O k3s vem com um controlador de NetworkPolicy
embutido; **o kindnet do kind não implementa NetworkPolicy** e
ignora os manifestos em silêncio. Num cluster kind, as policies desta fase
existem no etcd sem efeito nenhum, e o deploy pareceria validado
sem ter validado metade do item 4 do escopo. O smoke test avisa quando
o cluster não está aplicando.

### O que o smoke test cobre {#what-the-smoke-test-covers}

1. Todo pod **Ready** — não só `Running`. Um pod cuja checagem de readiness
   falha fica `Running` para sempre sem receber tráfego.
2. Nenhum container com `runAsUser: 0`.
3. Login em `POST /auth/login` com o usuário do seed — exercita argon2id,
   emissão de access token e os cookies de sessão.
4. `workspace → project → session`. Este passo atravessa o conjunto inteiro de
   NetworkPolicies: criar uma sessão faz a api chamar o engine
   por HTTP interno, com o service token. A sessão é criada com
   `kind: consultiva` — obrigatório desde a FASE 20
   ([RN-097](business-rules/api.md#rn-097)) — e é `consultiva` de
   propósito: o smoke test exercita criar → ativar → fechar e nunca
   ativa execução, que numa sessão consultiva devolve `409`.

   **Este é o passo que prova que a rota tem consumidor fora do
   web.** Quando `kind` passou a ser obrigatório, a suíte da api passou com 1562
   testes, e foi o smoke test que falhou, porque é o único
   que chama a rota como cliente externo, sem mock, contra
   a imagem de produção.
5. Sondas distintas (`/live` e `/ready` para o engine, `/live` para a
   api) e o `/config.js` do web apontando para as URLs do cluster.
6. `oban_queue_depth` com os rótulos `queue` e `state` em `/metrics`.
7. `external.metrics.k8s.io` servindo a métrica — o modo de falha do
   prometheus-adapter é silencioso, então perguntamos direto à API agregada.

### Diagnóstico do deploy {#diagnostico-do-deploy}

#### `403` no `/internal/*`, ou `401` nas chamadas da api para o engine {#403-on-internal-or-401-on-the-apis-calls-to-the-engine}

Os dois sintomas têm a mesma causa: o service token não bate
entre os dois lados (a api recusa com `403`, o plug do engine com
`401`). Confira que as duas cargas leem o **mesmo** valor:

```bash
kubectl -n brabo get secret brabo-secrets -o jsonpath='{.data.BRABO_SERVICE_TOKEN}' | base64 -d | sha256sum
kubectl -n brabo exec deploy/engine -- sh -c 'printf %s "$BRABO_SERVICE_TOKEN" | sha256sum'
```

Comparar o hash em vez do valor evita imprimir o segredo no
terminal. Se divergem, o pod do engine tem uma versão velha do
Secret: `kubectl -n brabo rollout restart deploy/engine`. Se batem,
o cabeçalho não está passando: confira que `BRABO_SERVICE_TOKEN` está definido
nas **duas** cargas — o engine tem um default de desenvolvimento
(`dev-service-token-change-me`), então esquecer a variável só lá
produz exatamente este sintoma, sem erro de boot — e que nenhum proxy no
caminho está tirando cabeçalhos desconhecidos.

#### Login devolvendo `401` para todo mundo depois de um deploy {#login-returning-401-for-everyone-after-a-deploy}

Quase sempre um `AUTH_JWT_SECRET` novo pulando o passo de coexistência: o
access token some junto com ele, mas o sintoma aparece no
refresh. O procedimento correto está em
[Rotação das chaves do auth](#rotacao-das-chaves-do-auth).

#### O `ExternalSecret` nunca fica Ready {#externalsecret-never-becomes-ready}

O `SecretStore` lê o Secret de origem `brabo`, criado imperativamente pelo
bootstrap. Confirme que ele existe e que o RBAC está no lugar:

```bash
kubectl -n brabo get secret brabo
kubectl -n brabo describe secretstore brabo-secret-store
```

Desde a AT-220 o `ExternalSecret` puxa o objeto `brabo` **inteiro** do
cofre (`dataFrom.extract`) em vez de listar cada chave. Duas consequências para o
diagnóstico:

- **Uma chave ausente não o impede mais de ficar Ready.** O `brabo-secrets` é
  criado sem ela, e a falha aparece em quem precisa da chave: um Pod
  com `secretKeyRef` (`NEO4J_PASSWORD` no Neo4j, `BACKUP_S3_ACCESS_KEY`/
  `BACKUP_S3_SECRET_KEY` no S3 local) fica em
  `CreateContainerConfigError`, e a api ou o engine recusa subir em
  produção nomeando a variável. O objeto no cofre tem de levar
  `DATABASE_URL`, `SECRET_KEY_BASE`, `CREDENTIALS_MASTER_KEY`,
  `GIT_OAUTH_STATE_SECRET`, `AUTH_JWT_SECRET`, `AUTH_TOKEN_PEPPER`,
  `BRABO_SERVICE_TOKEN`, `RELEASE_COOKIE`, `BACKUP_S3_ENDPOINT`,
  `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY` e
  `NEO4J_PASSWORD` — a lista que o `deploy/k8s/bootstrap.sh` cria localmente.
  Compare o que chegou:

  ```bash
  kubectl -n brabo get secret brabo-secrets -o go-template='{{range $k, $v := .data}}{{$k}}{{"\n"}}{{end}}'
  ```

- **Tudo nesse objeto chega aos Pods.** Toda chave vira uma
  variável de ambiente da api, do engine, dos dois Jobs de migração e do CronJob
  de backup (`envFrom: brabo-secrets`). Não guarde em `brabo` nada que esses
  processos não deveriam ver; o segredo de outro consumidor vai em outro objeto.

#### HPA do engine em `<unknown>` {#engine-hpa-at-unknown}

Em ordem, do mais ao menos provável:

```bash
# 1. o engine está expondo a métrica?
kubectl -n brabo exec deploy/engine -- wget -qO- http://127.0.0.1:4000/metrics | grep oban_queue_depth

# 2. o Prometheus a está coletando?
kubectl -n monitoring port-forward svc/prometheus-server 9090:80
# depois: http://localhost:9090 -> Status -> Targets

# 3. o adapter a está servindo?
kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1/namespaces/brabo/oban_queue_depth?labelSelector=state%3Davailable"
```

Se (1) responde e (3) não, o problema é a regra em
`deploy/k8s/helm/prometheus-adapter-values.yaml`.

#### O Job de migração não reaplica {#migration-job-doesnt-reapply}

A spec de um `Job` é imutável: com o Job anterior ainda no cluster,
reaplicar com uma imagem nova falha. O bootstrap já apaga os dois
antes de aplicar; à mão:

```bash
kubectl -n brabo delete job migrate-api migrate-engine --ignore-not-found
kubectl apply -k deploy/k8s/overlays/local
```

#### `bin/engine rpc` responde `eaddrinuse` {#binengine-rpc-responds-eaddrinuse}

A faixa de portas da distribuição Erlang (`ERL_AFLAGS`) precisa de mais de uma
porta: o nó rodando ocupa a primeira, e o `rpc` sobe um nó
oculto que precisa de outra. A faixa configurada é 9100–9110, aberta na
NetworkPolicy.

#### Conferindo que as réplicas do engine estão em cluster {#checking-that-the-engines-replicas-are-clustered}

Sem cluster Erlang, o `:global.trans` de `Workspace.ensure!` não
serializa nada e duas réplicas rodam um `git init` concorrente no
mesmo diretório compartilhado:

```bash
kubectl -n brabo exec deploy/engine -- /app/bin/engine rpc 'IO.inspect(Node.list())'
```

Deve listar os outros pods. Uma lista vazia com mais de uma réplica é um
defeito.

### Segredos: fallback para sealed-secrets {#fallback-sealed-secrets}

O padrão é o External Secrets Operator. Onde ele não é viável,
substitua o `ExternalSecret` em
`deploy/k8s/base/common/externalsecrets.yaml` por um `SealedSecret`,
**mantendo o mesmo nome de Secret (`brabo-secrets`) e as mesmas chaves** —
nada mais no deploy precisa mudar, porque tudo o consome
via `secretRef`.

```bash
kubectl create secret generic brabo-secrets \
  --dry-run=client -o yaml \
  --from-literal=DATABASE_URL=... \
  --from-literal=SECRET_KEY_BASE=... \
  | kubeseal --format yaml > deploy/k8s/overlays/<env>/sealed-brabo-secrets.yaml
```

O `SealedSecret` é cifrado para a chave pública daquele cluster e pode ser
versionado. Um Secret simples **nunca** pode.

Verificação: **nenhuma**. Nada no repositório roda `kubeseal`, e o
cluster agendado (`propriedades.yml`) materializa o `brabo-secrets` pelo
External Secrets, então este caminho nunca foi exercitado. Antes de confiar nele,
suba um cluster com o `SealedSecret` no lugar e rode `make smoke-k8s`:
o primeiro passo dele exige todo pod Ready, e um pod cujo `secretRef` aponta
para um Secret que nunca se materializou não está.

### Limites conhecidos deste ambiente {#known-limits-of-this-environment}

- **RWO em vez de RWX.** Funciona porque o cluster tem um nó só,
  e RWO quer dizer "um NÓ", não "um pod". Num cluster de verdade esta
  configuração poria api e engine em nós diferentes e o `git push` do dev
  agent falharia com `remote unpack failed`.
- **Sem pgvector** no Postgres do CloudNativePG. Hoje nenhuma migration cria
  a extensão e nenhuma coluna `vector` existe.
- **O `.gitlab-ci.yml` não tem validação estática local** (Fase 8c, ADR
  0039). O subagente de Workflows da área de Infra valida workflows do GitHub Actions
  com `actionlint` (fixado em `docker/engine/Dockerfile(.prod)`,
  mesmo padrão de `hadolint`/`gitleaks`); não há binário offline
  equivalente para o GitLab CI — o linter oficial precisa de uma instância viva.
  Lacuna documentada, não uma meia-solução inventada.

---

## Rollout do engine {#rollout-do-engine}

Decisões no
[ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md).

O engine hospeda os processos de sessão. Derrubar uma réplica sem cuidado
deixava, antes da Fase 5, **toda** sessão daquele pod pendurada em
`active` sem processo nenhum — nunca avançando, nunca fechando.

### O que acontece durante um rollout, em ordem {#what-happens-during-a-rollout-in-order}

| fase | quanto tempo | o que acontece |
|---|---|---|
| `preStop` | até 45s (`SHUTDOWN_DRAIN_TIMEOUT_MS`) | `Engine.Shutdown.drain/1`: `/ready` vira 503, `/internal/sessions` recusa sessões novas, e toda sessão deste nó é oferecida a um par vivo |
| repasse por sessão | 5s (`@handoff_timeout_ms`) | `:erpc.call` para outro nó assumir o processo |
| não adotada | — | vira `closing` com causa `node_shutdown`, depois `closed_abnormally` |
| SIGTERM | o resto dos 90s (`terminationGracePeriodSeconds`) | a árvore de supervisão cai |

Os 90s são deliberados: 45s de drain mais folga para o desmonte da BEAM.
Baixar `terminationGracePeriodSeconds` sem baixar o timeout do drain
faz o kubelet matar o pod **no meio do repasse** — que é exatamente como
você recria o bug que o drain existe para evitar.

### Fazendo o rollout {#doing-the-rollout}

```bash
kubectl -n brabo rollout restart deployment/engine
kubectl -n brabo rollout status  deployment/engine --timeout=300s
```

Com uma réplica só, não há par para adotar: **toda** sessão ativa
vai terminar `closed_abnormally / node_shutdown`. Isso é correto, não
falha — mas se o objetivo era não interromper ninguém, escale para 2 antes:

```bash
kubectl -n brabo scale deployment/engine --replicas=2
```

### Provando que nada ficou órfão {#proving-nothing-was-left-orphaned}

```bash
make rollout-test
```

Abre 5 sessões ativas, faz o rollout, e exige que **cada uma**
esteja num de dois estados: `active` com um dono `:global` vivo (adotada),
ou `closed_abnormally` com `node_shutdown` (drenada). Qualquer outra
combinação reprova — em especial `active` sem dono, que é a
definição operacional de órfã.

**Ele guarda a evidência que os pods antigos levam embora** (AT-078). Antes do
`rollout restart`, `deploy/k8s/rollout-evidencia.sh` começa a escrever em
`ROLLOUT_EVIDENCE_DIR` (um `mktemp -d` quando não definida; o caminho é impresso no
fim):

| arquivo | o quê |
|---|---|
| `engine-<pod>.log` | `kubectl logs -f` de **todo** pod do engine — os já de pé (log inteiro, desde o boot), que o rollout mata, e todo pod criado depois — anexado assim que fica `Running` |
| `final-<pod>.log` | uma cópia sem follow dos pods ainda de pé no fim, cobrindo um `logs -f` que caiu |
| `events.log` | `kubectl get events -w` do namespace, com os timestamps próprios de cada evento (`SuccessfulRescale`, `ScalingReplicaSet`, `Killing`…) |
| `replicas.log` | a cada 2 s (`EVIDENCIA_INTERVALO`, que o spec encurta): `<epoch> <spec.replicas do Deployment> <ready> <HPA current> <HPA desired>` |
| `donos.log` | toda leitura de dono da checagem: `<epoch> <sessão> <nó dono ou ->` |
| `donos-durante-rollout.log` | a mesma leitura, em laço enquanto o `rollout status` roda — em que réplica cada repasse caiu. Guardado à parte porque uma leitura no meio do rollout às vezes bate num pod de saída, e não pode alimentar o veredito |
| `engine-estado.txt` | só leitura: as linhas das sessões do teste em `engine.session_states` (sem linha, nem o drain nem o `Adopter` veem uma sessão) e os últimos jobs do `SessionAdoptionWorker`, tirados no fim dos dois desfechos |
| `marcos.log`, `anexos.log`, `pods-antes.txt`, `pods-no-fim.txt` | marcos do teste (`rollout-restart`, `rollout-status-ok`…), quando cada log foi anexado, os pods no T0 e no fim |

Numa órfã a falha imprime toda linha que nomeia a sessão em todos
esses arquivos — o log do pod antigo inclusive — mais as mudanças de réplica
relativas ao rollout, e um veredito por órfã: **sem dono ANTES
ou DEPOIS do primeiro scale-down do HPA**. Isso separa o confundidor conhecido: o
`hpa-test` que roda antes deixa três réplicas, e ~75 s dentro da janela o
HPA escala para uma, matando réplicas novas. Uma queda em `spec.replicas` é
lida como o HPA, porque o `rollout restart` nunca a muda. Nada disso
muda o que conta como adotada ou drenada, nem o teto de 120 s. As partes
puras, e os coletores contra um `kubectl` de mentira, são cobertos por
`scripts/ci/rollout-evidencia.spec.ts`. O workflow agendado sobe o
diretório como o artefato `rollout-evidencia` em toda execução que chegou à
prova, verde inclusive.

O que ele **não** captura, medido na primeira execução verde com ele
(`35449815544`): as linhas do próprio drain (`shutdown: drenando…`,
`shutdown: drain concluído — …`) nunca chegam ao log do pod. `Engine.Shutdown.drain/0`
roda dentro do `bin/engine rpc` do `preStop`, então a saída do `Logger` dele vai para
o stdout desse hook, que o kubelet descarta quando o hook dá certo. Os
logs dos pods antigos terminam em `SIGTERM received`. O desfecho do drain por sessão
tem de ser lido de `donos-durante-rollout.log` (para que réplica cada sessão
foi) e de `engine-estado.txt` (se a linha de `session_states` dela sobreviveu).

**Causa corrigida, não confirmada no k3d** (AT-078, RN-588). A órfã que esta prova
pegou (~3 em 13 execuções: sem linha em `session_states`, e um segundo pod ANTIGO em
`donos-durante-rollout.log`) vinha do `Monitor` do pod antigo apagando a linha
depois que o par a regravou durante o repasse. O drain agora marca o repasse
e o Monitor mantém a linha. Isso foi provado por um teste ExUnit determinístico,
não por esta prova, que falha 1 em 4-6 e não consegue provar uma correção. Se uma órfã
aparecer de novo, o log do pod que repassou a sessão leva uma
linha `Monitor: session_state <id> mantido|apagado em <node>` por sessão: nenhuma
linha quer dizer que o Monitor nunca processou o `:DOWN` (o pod morreu antes).

À mão, a mesma pergunta:

```sql
-- sessões ativas segundo a api
select id, status, updated_at from sessions where status = 'active';
```

```bash
# donos vivos segundo o engine
kubectl -n brabo exec deploy/engine -- \
  /app/bin/engine rpc ':global.registered_names() |> Enum.filter(&match?({:brabo_session, _}, &1)) |> length()'
```

Ativa na api sem dono no engine = órfã.

### Quando a sessão escapa {#quando-a-sessao-escapa}

**Sessão presa em `closing`.** `closing` é um estado de transição; presa
ali quer dizer que o drain começou e não terminou. O alerta *Session stuck in
closing* dispara depois de 15 minutos. Investigue o log do pod
que estava saindo — se ele já se foi, o `Adopter` (uma varredura a cada
30s) deveria ter assumido; se não assumiu, confira se a linha ainda
existe em `engine.session_states`.

**Órfã depois de `kill -9` / um OOMKill.** O `preStop` não roda nesses
casos, por definição. O que cobre é o `SessionAdoptionWorker`,
que a cada 30s procura uma linha em `session_states` sem dono `:global`
e a assume. Se ele não está rodando, a fila do Oban está parada —
e aí o problema é outro (veja o alerta de fila não
consumida, em [Observabilidade](#observabilidade)).

**Um rollout preso no `preStop`.** Sintoma: um pod `Terminating` por exatamente
90s, toda vez. Quase certamente um `:erpc.call` esperando por um nó que
já morreu mas ainda está em `Node.list()`. O timeout de 5s por sessão
limita o estrago; 90s cheios querem dizer ~18 sessões em sequência ou um repasse
que nunca volta.

**Nada é adotado, mesmo com 2 réplicas.** Os nós não se
enxergam. Confira o cluster Erlang:

```bash
kubectl -n brabo exec deploy/engine -- /app/bin/engine rpc 'Node.list()'
```

Lista vazia = o DNSCluster não resolveu o Service headless, ou a
NetworkPolicy está bloqueando a faixa da distribuição (9100–9110). Sem
cluster, cada réplica é uma ilha e todo rollout drena tudo.

### Aumentar a janela de drain {#aumentar-a-janela-de-drain}

Se as sessões são longas e os 45s de drain não bastam, os dois valores sobem
**juntos** — e nesta ordem de raciocínio: escolha o drain, depois acrescente
folga:

```yaml
# deploy/k8s/base/engine/deployment.yaml
terminationGracePeriodSeconds: 150   # drain + ~30s de desmonte
# env SHUTDOWN_DRAIN_TIMEOUT_MS: "120000"
```

Mexer só em `terminationGracePeriodSeconds` não alonga o drain;
mexer só no drain faz o kubelet matar no meio.

Verificação: **nenhuma própria**. `make rollout-test` é a prova que
se aplica, e a execução agendada prova só o par que o overlay **local**
produz: 90 s de grace de `deploy/k8s/base/engine/deployment.yaml` e um
drain de 20 s de `deploy/k8s/overlays/local/patches.yaml` — não os 45 s do
default, e não um aumentado. Depois de subir os dois no overlay de que você faz deploy, rode
`make rollout-test` com os mesmos valores no overlay local
antes do rollout que importa; nada confere que o grace period fica
acima do drain.

---

## Restore {#restore}

Decisões no [ADR 0027](adr/0027-fase5-backup-hardening-release.md).

> **Testado.** O procedimento abaixo é exatamente o que o `make test-restore`
> roda, e ele roda contra o cluster local. Não há passo aqui que
> ninguém nunca exercitou. O registro da última execução está no fim.

### O que tem backup, e o que deliberadamente não tem {#what-is-backed-up-and-what-deliberately-is-not}

Existem sete volumes nomeados; **dois** são fonte da verdade e só esses são
copiados. A classificação é o
[ADR 0152](adr/0152-backup-de-volumes-contra-compose.md), e o motivo de
fazê-la é que "fazer backup de todo volume" custa espaço enquanto esconde o que importa.

| volume | natureza | no backup? |
|---|---|---|
| `pgdata` | fonte da verdade — event log, ações, pgvector, tudo | sim, como **dump lógico**. Nunca uma cópia de arquivo do diretório de dados: copiar um Postgres rodando produz um backup que pode não restaurar |
| `git_local_repos` | fonte da verdade — os repos *bare* dos projetos do provider `local` | **sim**, e este era o buraco. Ele não é reconstruível a partir do Postgres: o event log guarda a narrativa, não os objetos do git |
| `neo4j_data` | derivado — uma projeção do event log ([ADR 0101](adr/0101-memoria-relacional-como-projecao-do-event-log.md)) | não. A resposta para memória derivada é **reprojeção**, não restore — `grafo:reprojetar`, veja [Perda do grafo](#perda-do-grafo) |
| `project_workspaces` | derivado — worktrees que o `WorktreeManager` recria a partir do bare repo, **e** a pasta `docs/` dos agentes dos projetos `container` e `runner`, que é uma projeção do event log ([ADR 0148](adr/0148-artefatos-projetados-em-arquivo.md)) | não. A resposta é **reprojeção** — `artefatos:reprojetar`, veja [Perda da pasta de artefatos](#perda-da-pasta-de-artefatos) |
| `ollama_data` | reobtível — os modelos baixam de novo | não |
| `brabo_projects_base` | do usuário, não do produto | não, e o instalador nunca o apaga |

### Onde o backup mora {#where-the-backup-lives}

| o quê | onde |
|---|---|
| agenda | Kubernetes: CronJob `brabo-backup`, 03:17 UTC, diário. Compose: não há agendador — você o roda, ou o instalador roda antes de uma migração |
| destino | disco (`BACKUP_DIR`) **ou** um bucket compatível com S3 (`BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET`). `BACKUP_DIR` definida vence; vazia cai para o S3, que é o que o CronJob faz |
| layout | `daily/brabo-<ISO>.dump` + `weekly/…` para o Postgres; `git-daily/brabo-git-<ISO>.tar.gz` + `git-weekly/…` para os bare repos |
| retenção | 7 diários + 4 semanais de **cada tipo**, por CONTAGEM (`BACKUP_KEEP_DAILY` / `BACKUP_KEEP_WEEKLY`) |
| formato | `pg_dump --format=custom --compress=9`; `tar -czf` para os repos |
| histórico | tabela `backup_runs` — o **dump**, chaveado por `object_key`. O arquivo dos repos leva o mesmo timestamp no prefixo irmão; o vínculo é o nome, não uma coluna |

No cluster local o destino S3 é um SeaweedFS (`s3-local`, o
gateway `weed server -s3` na porta 9000) dentro do namespace `brabo` — era
MinIO até o MinIO parar de publicar a imagem comunitária dele
([ADR 0169](adr/0169-seaweedfs-no-lugar-do-minio-no-overlay-local.md)); em
staging/prod é o bucket de verdade. O procedimento não muda — só o
endpoint. Se o bootstrap para em `rollout status deployment/s3-local` com
`ImagePullBackOff`, a imagem fixada deixou de ser servida: o digest impede
os bytes de mudarem, não o publicador de ir embora.

> **O destino padrão do compose é um volume nomeado, e isso serve para
> verificar e é errado para migrar.** `docker compose down -v` apaga o
> `backup_local` junto com os dados que ele devia salvar. Aponte
> `BRABO_BACKUP_HOST_DIR` para um diretório do host antes de qualquer migração.

### O que o arquivo dos bare repos garante — e o que não garante {#garantia-dos-bare-repos}

Nada é congelado: os repos são copiados enquanto api e engine podem estar escrevendo
neles. O que isso compra, exatamente:

- **Garantido.** Consistência **por referência**. O git escreve objetos antes de
  mover uma ref, e troca a ref por rename atômico (ou reescrevendo o
  `packed-refs` sob lock, também por rename). Um `tar` cruzando um `git push`
  captura a ref no valor antigo ou no novo, nunca meio valor — e
  no caso novo os objetos que ela alcança já estão em disco.
- **Garantido.** Um arquivo parcial **reprova a execução** em vez de passar como
  bom. Um `git gc` concorrente pode apagar um packfile entre o `tar` listar um
  diretório e lê-lo; o status de saída do `tar` é capturado num arquivo (em `sh`
  POSIX o status de um pipeline é o do último comando) e um não-zero vira uma
  linha `failed` em `backup_runs`, que é o que alerta. Rode de novo.
- **Garantido.** O arquivo é legível **de ponta a ponta** antes de qualquer coisa ser
  escrita — `brabo-restore-git` é o `pg_restore --list` do lado do git. Um
  tar truncado tem tamanho plausível e só lê-lo diz.
- **Não garantido.** Qualquer instante global. O `tar` percorre a árvore ao longo de um período,
  então dois repositórios — ou duas refs de um — podem vir de momentos diferentes.
  Irrelevante para o git, que valida por ref; relevante para quem lê
  "o backup das 03:17" como um retrato só.
- **Não garantido.** Conectividade de objetos. Nada aqui roda `git fsck`: a
  imagem de backup não tem git, de propósito. O que se prova é a integridade do
  contêiner, não do conteúdo.
- **Não copiados.** Arquivos `*.lock`, e `objects/tmp_*`. Restaurar um lock órfão
  dá um repositório onde todo `git` se recusa a trabalhar, com uma mensagem que
  nunca menciona backup.

### Antes de restaurar: o backup existe, e presta? {#before-restoring-does-the-backup-exist-and-is-it-any-good}

```sql
select finished_at, kind, status, object_key,
       pg_size_pretty(size_bytes) as tamanho, error_message
  from backup_runs
 order by finished_at desc
 limit 10;
```

Três coisas nessa saída importam mais que a última linha:

- **Um `status = 'failed'` recente com um sucesso antigo** é o caso
  perigoso: existe backup, só que velho. O alerta *Last backup run failed*
  cobre exatamente isso.
- **Uma queda brusca em `size_bytes`** entre execuções sugere um dump
  truncado, e o tamanho sozinho não o denuncia — é o
  `pg_restore --list` do script que o pega.
- **Nenhuma linha** quer dizer que o CronJob nunca rodou com sucesso. Aí
  o problema não é o restore.

### O caminho automatizado (o mesmo que o teste roda) {#restore-automatizado}

No Kubernetes:

```bash
make test-restore
```

Numa instalação compose — sem cluster, sem `kubectl`:

```bash
make test-restore-compose
```

Os dois disparam um backup **real** (mesma imagem, mesmo comando que roda em
produção — não um `pg_dump` improvisado, que testaria um caminho que ninguém usa),
restauram em `brabo_restore_test`, validam, e apagam o banco. Use-os
quando o objetivo é **verificar** o backup, não recuperar dados.

Os dois embrulhos ficam separados de propósito: unificá-los faria o caminho do compose
depender de `kubectl`, que é a dependência que ele existe para não ter. O que
*não* é duplicado é o julgamento — os dois rodam o mesmo `brabo-restore`, com as
mesmas três validações. O do compose acrescenta um terceiro passo que o cluster não consegue
pedir: ele verifica o arquivo dos bare repos, porque no Kubernetes o volume
`git_local_repos` não está montado no pod de backup e o passo é
legitimamente pulado, enquanto no compose ele está montado e pular seria um
falso verde.

Os dois são provados toda semana no
[`propriedades.yml`](#provas-de-propriedade-agendadas): `make test-restore` (e
a quebra deliberada dele, `make test-restore-mutacao`) no job do cluster, e
`make test-restore-compose` — com a verificação dos bare repos que só o
caminho do compose faz — num segundo job, `restore-compose`, em outro runner
(AT-195). A migração do instalador também roda o do compose.

### Restaurando de verdade, durante um incidente {#restore-de-verdade}

O script `brabo-restore` restaura num banco NOVO e nunca toca
o de origem — de propósito. Restaurar por cima do banco vivo é
irreversível e quase sempre a decisão errada nos primeiros minutos de um
incidente.

**1. Suba um Job de restore apontando para o nome de banco que você quer:**

```bash
kubectl -n brabo create job restore-manual --from=cronjob/brabo-backup \
  --dry-run=client -o yaml \
| sed -e 's|\["brabo-backup"\]|["brabo-restore"]|' \
| kubectl -n brabo apply -f -

kubectl -n brabo set env job/restore-manual RESTORE_DB=brabo_recuperado
kubectl -n brabo logs -f job/restore-manual
```

Para restaurar de uma cópia semanal em vez da última diária:
`RESTORE_PREFIX=weekly/`.

**2. Confira o que voltou** — as mesmas perguntas que o script faz, agora com
os seus próprios olhos:

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

**3. Promova o banco recuperado** apontando `DATABASE_URL` para ele e
reiniciando api e engine. Este é o último passo, e o único
destrutivo:

```bash
kubectl -n brabo patch secret brabo-secrets --type merge \
  -p "{\"data\":{\"DATABASE_URL\":\"$(printf '%s' "$NOVA_URL" | base64 -w0)\"}}"
kubectl -n brabo rollout restart deployment/api deployment/engine
```

> O Secret é materializado pelo External Secrets a partir do provedor. Um
> `patch` direto é sobrescrito no próximo `refreshInterval` (1h):
> mude **também** o valor no provedor, ou o sistema volta em silêncio
> para o banco antigo dentro de uma hora — no meio da recuperação.

Verificação: os passos 1 e 2 são o `brabo-restore` que o `make test-restore`
roda toda semana, e as duas consultas do passo 2 são as que
o `docker/backup/restore.sh` se faz. O passo 3 — o patch em `DATABASE_URL` e
reiniciar api e engine contra o banco recuperado — **nunca foi
exercitado**: a prova apaga `brabo_restore_test` ao terminar e nunca
aponta uma api rodando para ele.

### O que o restore NÃO cobre {#what-the-restore-does-not-cover}

- **As credenciais de usuário ficam ilegíveis se `CREDENTIALS_MASTER_KEY` for
  diferente.** O dump leva as DEKs embrulhadas, não as chaves. Restaurar
  num ambiente com outra chave mestra devolve um
  banco intacto com credenciais de LLM e de git inúteis. Veja
  [Rotação da chave mestra](#rotacao-da-chave-mestra).
- **Nada dos usuários fica de fora.** Desde o corte do Keycloak
  ([ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)) não há
  banco de IdP separado: identidades, credenciais argon2id, refresh
  tokens e o event log de auth moram todos no mesmo Postgres e entram
  neste dump. O que **não** sobrevive é lê-los se o
  `AUTH_TOKEN_PEPPER` for diferente — mesmo raciocínio da chave mestra
  acima.
- **O `brabo-restore` restaura o banco, e só ele.** Os bare repos
  são o comando irmão, `brabo-restore-git` — veja
  [Recuperando os bare repos](#restore-dos-bare-repos). São comandos
  separados e não duas fases de um só porque são dois artefatos com
  dois julgamentos: uma falha de git não pode reprovar a validação do event log, e
  o contrário seria pior.
- **Os worktrees dos agentes** (`project_workspaces`) não são copiados, e não precisam
  ser: o `WorktreeManager` os recria a partir do bare repo. O que se
  perde é trabalho em andamento não commitado.
- ~~Os repositórios de verdade moram no GitHub/GitLab~~ — **isto estava
  escrito aqui e estava errado**, e é por isso que o volume passou anos sem
  backup. Vale para projetos dos providers `github`/`gitlab`; para um
  projeto no provider `local` não há upstream em lugar nenhum, e o
  bare repo em `git_local_repos` **é** o código que os agentes produziram.
- **Não é PITR.** A granularidade é o último dump; qualquer coisa escrita
  depois dele se perde. Se isso não é aceitável, o caminho é arquivamento de WAL
  no CloudNativePG, que está fora do escopo desta fase.

### Recuperando os bare repos {#restore-dos-bare-repos}

Verificar não custa nada e não escreve nada — é o gesto semanal, e
desde a AT-195 o job agendado `restore-compose` do `propriedades.yml` o faz
(pelo `make test-restore-compose`, veja
[o caminho automatizado](#restore-automatizado)):

```bash
docker compose -f docker/docker-compose.prod.yml run --rm backup brabo-restore-git
```

Restaurar é o gesto de uma vez por incidente, e tem de ser digitado:

```bash
docker compose -f docker/docker-compose.prod.yml \
  run --rm --user 0:0 backup brabo-restore-git --restaurar
```

Duas coisas sobre esse comando, as duas medidas e não supostas:

- **`--user 0:0` não é opcional aqui.** O `git_local_repos` é compartilhado por três
  imagens rodando com três uids diferentes (a api como `node`, o engine como
  `engine`, a imagem de backup como uid 70). O volume fica com o dono de quem
  o montou primeiro, modo 0755: o uid 70 o lê e não consegue escrever. Sem
  root o comando recusa **antes** de extrair, nomeando esta correção — ele não
  descobre o problema no meio do `tar`, deixando o volume escrito pela metade.
- **O que é extraído é devolvido ao dono do diretório**, nunca
  deixado como root. Senão o volume voltaria intacto e inútil: api
  e engine, não-root, não conseguiriam escrever no que acabou de ser restaurado, e o
  sintoma apareceria muito depois do restore sem nada apontando para ele.

Ele **recusa extrair por cima de repos existentes**. Sobrepor dois estados de repositório
produz uma mistura de que nenhum `git` reclama e que ninguém nota até um `fetch`
trazer de volta o histórico errado. Esvazie o volume, ou passe `RESTORE_GIT_FORCE=1`
se a sobreposição é genuinamente o que você quer.

Verificação: as funções de shell por trás dos dois gestos são provadas em todo PR por
`scripts/ci/backup-lib.spec.ts` — arquivar e restaurar vão e voltam idênticos, nenhum
`*.lock` copiado, um arquivo truncado recusado na leitura, um destino em que ele não consegue
escrever recusado antes do `tar`. Os próprios comandos, na imagem de backup contra
o volume real, rodam pelo `make test-restore-compose` (a metade que
verifica, nunca `--restaurar`), toda semana no `propriedades.yml`. Esse job primeiro
cria um bare repo no volume (`git init --bare`, como o
`LocalGitProvider` faz) e reprova se o veredito não o nomeia: com o
volume vazio, `brabo-restore-git` responde "nada a restaurar" e sai com 0,
o que seria um verde que não leu arquivo nenhum.

### Perda do grafo (Neo4j) {#perda-do-grafo}

O `neo4j_data` **não** está em backup nenhum, e isso é a decisão, não um
descuido ([ADR 0152](adr/0152-backup-de-volumes-contra-compose.md), decisão
4). Restaurar uma projeção possivelmente velha ao lado de um Postgres restaurado noutro
instante dá dois estados derivados de momentos diferentes sem nada para
reconciliá-los. A resposta certa para memória derivada é reprojetar a partir da
fonte — e esse comando existe ([RN-569](business-rules/api.md#rn-569)):

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

Saída esperada:

```
[reprojetar] escopo: event log inteiro
[reprojetar] eventos: 4 projetados, cursor 01M2DTREY0TBKHCHG9NWXYF0A4
[reprojetar] sessões fechadas: 2 projetadas

[reprojetar] resultado

  eventos projetados=4  sessões fechadas projetadas=2  falhas=0
  grafo agora (inteiro): nós=80  arestas=80
```

O que ele faz, e o que garante:

- **A mesma tradução do projetor vivo.** Evento → nó/aresta mora numa
  classe só (`GraphEventTranslator`), chamada tanto pelo projetor de ida quanto
  por este comando. Ele lê `handoff.offered`, `psychologist.hypothesis_proposed`
  e `anamnese.profile_updated` de `session_events`, e a `Interacao` de
  toda sessão em `closed`/`closed_abnormally` de `sessions` (fechar uma
  sessão não deixa evento no log).
- **Idempotente, e nunca apaga.** Toda escrita é um `MERGE` numa chave
  natural: rodá-lo duas vezes dá o mesmo grafo, e **rodar de novo é como você
  tenta de novo** depois de uma falha no meio. Ele só acrescenta ou converge; um nó já no
  grafo fica.
- **Em lotes, por cursor.** O `session_events` é percorrido na ordem de `id` (ULID,
  a chave primária), 200 linhas por vez — nunca a tabela inteira em memória. A
  linha de progresso imprime o cursor; `--after-event <id>` retoma a fase de eventos
  depois dele. Recomeçar é igualmente seguro, só mais lento.
- **Ele não toca a outbox, então a api pode ficar de pé.** O projetor vivo
  guarda o progresso dele em `outbox_events.processed_at`
  (`aggregate_type = 'graph_projection'`); este comando nem lê nem
  escreve essa tabela, então não consegue roubar, reabrir nem marcar uma linha. Os dois escrevem com
  `MERGE` nas mesmas chaves.
- **Ele falha nomeado, nunca como sucesso silencioso.** Neo4j não configurado ou
  inalcançável é recusado *antes* de ler o log (um escopo vazio, senão,
  "daria certo" com zero projetados); o Neo4j caindo no meio para com
  o último evento completado; um `--project` desconhecido é recusado sem nada
  escrito; um item com payload incoerente é contado, nomeado, e a execução
  sai com `1` no fim.

O que ele **não** reconstrói, e a única ressalva de ordem:

- **`PromptTemplate`/`PromptVersion`** não vêm do event log. A
  fonte deles é o diretório `prompts/`: reenvie-os com
  `node scripts/dev/seed-prompts.ts` (idempotente por hash).
- **`PerfilAnamnese` é um retrato chaveado por usuário + dimensão, sem projeto.**
  O último a escrever vence. Uma execução com `--project` reexecuta só os eventos de perfil
  daquele projeto, então pode deixar um retrato no último valor daquele projeto quando outro
  projeto escreveu um mais novo. A execução completa (sem `--project`) percorre o log inteiro em
  ordem e restaura o último global — use-a depois de perder o grafo; guarde
  `--project` para um reparo pontual.
- **Uma execução completa exige uma janela de manutenção, sem teto de tempo**, e quanto
  ela leva num log grande não foi medido — veja
  [Rodando uma reprojeção completa](#reprojecao-em-janela) para a janela, a
  linha de progresso e como saber quanto falta.

A prova é o `make test-reprojecao`
(`apps/api/test/scripts/reprojetar-grafo.spec.ts`): ele monta um cenário com
o projetor de ida, **apaga** esse subgrafo, reprojeta, compara as contagens de nós e
arestas mais a lista de chaves, e reprojeta de novo. Ele precisa do Neo4j de pé e
pula sem ele — o job de CI da api não tem Neo4j, então ali ele pula. Ele não
depende de ter havido um backup, de propósito.

A mesma prova também roda **dentro do cluster local**: `make test-reprojecao-k8s`
(`deploy/k8s/test-reprojecao.sh`) é o quarto alvo do agendado
`propriedades.yml` (veja [Provas de propriedade agendadas](#provas-de-propriedade-agendadas)).
Ele roda o comando exatamente como esta seção manda rodá-lo num incidente
(`kubectl exec deploy/api -- node scripts/reprojetar-grafo.js --project <id>`),
contra o Postgres e o Neo4j do cluster, num projeto que ele mesmo cria.
Desde a AT-191 o cenário dele exercita **os quatro caminhos de tradução** do
`GraphEventTranslator` — um `handoff.offered`, um
`psychologist.hypothesis_proposed` citando uma mensagem como evidência, um
`anamnese.profile_updated` para um usuário próprio, e a `Interacao` da
sessão fechada — e exige **9 nós e 6 arestas** antes da limpeza, depois
da reconstrução e depois da segunda execução (medido na execução `36498776825`). O
Psicólogo e a Anamnese seguem pausados: a prova acrescenta os eventos que eles
escreveriam e confere o que a reprojeção reconstrói a partir deles.

O grafo vazio até você rodar isto tem um efeito nomeado: leituras que dependem
do grafo degradam. O RAG **não** é afetado — ele mora no pgvector, que está
dentro do dump.

#### Rodando uma reprojeção completa: uma janela de manutenção, sem teto de tempo {#reprojecao-em-janela}

Uma reprojeção completa (do grafo ou da [pasta de artefatos](#perda-da-pasta-de-artefatos))
é uma operação rara de **recuperação**, e roda numa **janela de manutenção, sem
teto de tempo** — decisão do mantenedor (2026-09-27). Nada no produto
a corta por tempo, avisa quando demora, ou a agenda: ela roda pelo tempo que
o event log levar, e você planeja a janela para isso.

Quanto tempo isso é num log de tamanho de produção **não foi medido**. A única execução real
até agora é o compose de desenvolvimento (98 eventos em `session_events`, 2,5 s de ponta
a ponta); uma extrapolação proporcional a partir disso não é medição, então cronometre a
primeira execução completa da sua instalação e guarde esse número para a próxima janela.

**Acompanhando o progresso.** O comando imprime uma linha por lote — a cada 200
eventos dos tipos que ele lê — antes do resultado final, então uma execução que
ainda está imprimindo ainda está percorrendo o log:

```
[reprojetar] eventos: 200 projetados, cursor 01M2DTREY0TBKHCHG9NWXYF0A4
[reprojetar] eventos: 400 projetados, cursor 01M2DV3K8Q2S7ZB1CXN4W6Y9HR
...
[reprojetar] sessões fechadas: 200 projetadas
[reprojetar-artefatos] artefatos: 200 projetados, cursor 01M2DTREY0TBKHCHG9NWXYF0A4
```

O número é de quantos foram **projetados** (itens que falharam são impressos na
própria linha e contados em `falhas=` no fim). A linha não leva um
total. Para saber quanto falta, pergunte ao Postgres, com o cursor da
última linha — só leitura, então é seguro enquanto a execução segue:

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

Acrescente `AND session_id IN (SELECT id FROM sessions WHERE project_id = '<project-uuid>')`
a uma contagem quando a execução tem `--project`. As listas de tipos são as que os
comandos leem (`EVENTOS_DO_LOG_PROJETAVEIS` em
`apps/api/src/application/graph-projection/graph-event-translator.ts`,
`ARTIFACT_PROJECTABLE_EVENT_TYPES` em
`apps/api/src/domain/artifacts/artifact-projection-events.ts`); se algum dos arquivos
ganhou um tipo, a contagem aqui fica curta dele.

**O que esta decisão não acrescenta.** Nenhum teto, nenhum aviso, nenhuma reprojeção
dividida em janelas ou agendada pelo produto. `--project` e
`--after-event` continuam exatamente o que já eram — um reparo pontual e uma
retomada depois de uma interrupção — e **não** são o jeito de caber uma recuperação completa
numa janela mais curta: uma execução com `--project` não consegue restaurar o retrato
global de `PerfilAnamnese` (acima), e retomar no meio de um tipo de artefato
versionado pode deixar uma versão mais velha ([abaixo](#perda-da-pasta-de-artefatos)).
A execução completa é a recuperação. Interrompê-la é seguro — a idempotência acima
vale — e rodá-la de novo desde o início é sempre correto, só mais lento.

### Perda da pasta de artefatos (`docs/`) {#perda-da-pasta-de-artefatos}

Todo artefato que os agentes emitem mora **só no event log**; a pasta `docs/`
do projeto é uma **projeção** dele ([ADR 0148](adr/0148-artefatos-projetados-em-arquivo.md)),
então não está em backup nenhum e isso é a decisão, não um descuido
(o [ADR 0152](adr/0152-backup-de-volumes-contra-compose.md) raciocina o mesmo para o
grafo). Restaurar o banco **não** a traz de volta sozinho: as
linhas da outbox que movem o projetor vivo já estão marcadas como processadas, então
nada reescreve a pasta. O comando que reescreve existe
([RN-590](business-rules/api.md#rn-590)):

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

Saída esperada:

```
[reprojetar-artefatos] escopo: event log inteiro
[reprojetar-artefatos] artefatos: 6 projetados, cursor 01M2DTREY0TBKHCHG9NWXYF0A4

[reprojetar-artefatos] resultado

  artefatos projetados=6  falhas=0
```

O que ele faz, e o que garante:

- **A mesma tradução do projetor vivo.** Evento → pasta, nome de arquivo
  e Markdown moram numa classe só (`ArtifactEventTranslator`), chamada tanto pelo
  projetor de ida quanto por este comando.
- **Idempotente, e nunca apaga.** O nome do arquivo é função do
  evento (tipos versionados: `<tipo>.md`; append-only: com o `seq`), então rodá-lo
  duas vezes reescreve os mesmos arquivos com o mesmo conteúdo, e **rodar de
  novo é como você tenta de novo**. Um arquivo que você criou em `docs/` fica.
- **Em lotes, por cursor.** O `session_events` é percorrido na ordem de `id`, 200 linhas
  por vez; `--after-event <id>` retoma depois do cursor impresso.
- **Ele não toca a outbox**, então a api pode ficar de pé.
- **Ele falha nomeado, nunca como sucesso silencioso.** Uma escrita que falha (disco cheio,
  pasta inalcançável, um projeto cuja pasta sumiu) é contada e nomeada por
  evento, não para o resto, e a execução sai com `1` no fim. Um `--project`
  desconhecido é recusado sem nada escrito.

Onde ele escreve, e o que **não** cobre:

- **Ele precisa ver o mesmo disco que a api.** A pasta é resolvida pela mesma
  função que o projetor usa (`container`/`runner`:
  `<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>/docs/`; `mounted`: dentro da
  pasta do projeto). Rode-o na imagem da api, com os volumes da api.
- **Ele escreve no local *atual* do projeto.** Uma conversão de modo não
  move a `docs/` (o código da conversão nunca a toca), então arquivos escritos antes
  dela ficam no local antigo; reprojetar os recria no atual.
- **Tipos versionados mostram o último evento, então não retome no meio
  deles.** `module_map`, `module_routing`, `project_image` e `c4_diagram`
  sobrescrevem um arquivo; uma execução completa termina com a última versão emitida, enquanto
  `--after-event` começando entre duas versões pode deixar uma mais velha.
- **O que ele não lê:** tipos fora da lista projetável (`qa_verdict`,
  `secops_verdict`, `task_blocked`, `infra_delegation_files`) nunca foram arquivos
  e não são recriados.
- **Ele roda numa janela de manutenção, sem teto de tempo**, igual ao
  grafo: a linha de progresso e as consultas para acompanhá-la estão em
  [Rodando uma reprojeção completa](#reprojecao-em-janela). Quanto ele leva num
  event log grande não foi medido; o comando é seguro de interromper e rodar
  de novo.

A prova é `apps/api/test/scripts/reprojetar-artefatos.spec.ts`: ele monta um
cenário com o projetor de ida num Postgres de verdade e num disco de verdade, **apaga**
a pasta, reprojeta, compara cada caminho e conteúdo, e reprojeta de novo.
Ele roda em todo PR. O comando como esta seção manda rodá-lo num
incidente — `node scripts/reprojetar-artefatos.js` dentro da **imagem** da api — é
provado pelo `make test-reprojecao-artefatos-k8s` (`deploy/k8s/test-reprojecao-artefatos.sh`,
AT-198), o irmão do alvo de cluster do grafo: ele cria um projeto próprio
com um `artifact.note` pela API, espera o projetor vivo escrevê-lo,
apaga a pasta `docs/<agente>/` do agente **dentro do pod da api**, roda o
próprio script da imagem com `--project`, e exige que o arquivo reconstruído tenha o
**mesmo sha256** do que o projetor vivo escreveu — depois roda de novo e
exige o mesmo hash (idempotência). Ele roda no agendado
`.github/workflows/propriedades.yml`, e como o irmão não depende de nenhum
outro alvo.

### Quando o restore falha {#when-the-restore-fails}

| sintoma | causa provável |
|---|---|
| `no backup under .../daily/` | bucket errado, credencial errada, ou o CronJob nunca rodou |
| `not an intact custom dump` | upload interrompido; use o objeto anterior ou `weekly/` |
| `pg_restore failed` com erro de extensão | o banco de destino precisa das mesmas extensões (`pgvector`); no CNPG elas vêm do cluster, não do dump |
| `missing tables in the restored copy` | um dump de outra versão de schema — o script diz QUAIS faltam; confira a data do objeto contra a migration mais recente |
| `out of window` numa tabela crítica | a contagem não bate com o timestamp do dump: investigue antes de promover |
| `server version mismatch` | o `pg_dump` do Job é 16; um cluster noutra major recusa a conexão |
| timeout do Job | banco grande demais para o `activeDeadlineSeconds`; suba o valor no Job, não no CronJob |
| `destination inaccessible … does not accept writes` | com `BACKUP_DIR`, o diretório existe e o uid do container não consegue escrever nele. É uma checagem de **escrita**, não de existência, de propósito: um destino só de leitura passaria no `ls` e reprovaria o dump, com o erro aparecendo depois do `pg_dump` e apontando para a coisa errada |
| `tar of the bare repos exited with N` | algo mudou sob os repos no meio da leitura — o mais provável é um `git gc` concorrente. A execução é marcada `failed` em vez de entregar um arquivo parcial. Rode de novo |
| `there are N bare repo(s) … and NO archive` | este volume não tem cobertura: o arquivo falta enquanto os repos não. Ausente-e-vazio é normal e informado de outro jeito |
| `does not accept writes by this user (uid 70)` no `--restaurar` | o caso do dono do volume compartilhado — restaure com `--user 0:0`, veja [Recuperando os bare repos](#restore-dos-bare-repos) |

### Provas de propriedade agendadas {#provas-de-propriedade-agendadas}

`make test-restore`, `make rollout-test` e `make hpa-test` provam
**propriedades**, não configuração — um backup que roda toda noite e não
restaura passa nos cinco alertas de `brabo-alerts.yaml`. Até o BRB-009 eles rodavam
só quando alguém os digitava. O `.github/workflows/propriedades.yml` agora os roda
numa agenda, num cluster k3d num runner hospedado pelo GitHub:

1. instala `k3d`, `helm` e `kubectl` por checksum fixado;
2. roda `deploy/k8s/bootstrap.sh` — o mesmo bootstrap que o `make deploy-local`
   roda, construindo as quatro imagens de produção a partir da árvore do checkout (sem
   registry, sem segredo) — com `BRABO_SKIP_OBSERVABILITY=1` (AT-177): nenhuma
   das provas lê Tempo, Loki, o Collector, Alloy ou Grafana, e essa é
   a única diferença do cluster que o `make deploy-local` te dá;
3. roda `make smoke-k8s`, depois `make hpa-test`, `make rollout-test` e
   `make test-restore`, na ordem do `Makefile`, cada um mesmo quando um anterior
   falhou (um HPA quebrado não pode esconder um restore quebrado);
4. roda `make test-restore-mutacao` (AT-126, BRB-009), a prova **da**
   prova: ele tira um backup real, depois cria uma tabela (`zz_mutacao_restore`) na
   origem que o dump não tem — exatamente "um dump faltando uma tabela" —
   e roda o mesmo `brabo-restore`. Ele passa só se o restore o **rejeita**
   e nomeia aquela tabela (a linha de log `faltando: zz_mutacao_restore`); se o restore
   aprova, ou rejeita por outro motivo, o passo falha e abre a própria
   issue. Um `make test-restore` verde diz que o backup restaura; este diz que a
   prova ainda perceberia se não restaurasse. A tabela é apagada na saída, mesmo em
   falha. Ele roda mesmo quando o `make test-restore` falhou (uma prova cega e um
   restore quebrado são dois defeitos, e os dois têm de aparecer);
5. roda `make test-reprojecao-k8s` (AT-127, BRB-018): o grafo não tem backup
   ([ADR 0152](adr/0152-backup-de-volumes-contra-compose.md)) porque é
   reprojetado a partir do event log, então o workflow prova isso também — ele cria
   um projeto próprio com uma sessão fechada e quatro eventos (uma mensagem, um
   handoff, uma hipótese do Psicólogo e um perfil da Anamnese — todo caminho do
   tradutor, AT-191), o reprojeta, **apaga esse subgrafo** no Neo4j,
   reprojeta, e exige as mesmas contagens de nós e arestas (9|6), depois
   reprojeta de novo. Ele não usa estado deixado pelos outros alvos e
   **não** é acoplado ao `test-restore` (o grafo não depende de um backup);
6. roda `make test-reprojecao-artefatos-k8s` (AT-198, RN-590), a mesma prova
   para a outra projeção derivada — a pasta `docs/` dos artefatos. Ele
   cria um projeto próprio com um `artifact.note`, espera o projetor
   vivo escrever o arquivo, **apaga a pasta do agente dentro do pod da
   api**, roda o `node scripts/reprojetar-artefatos.js --project` da imagem,
   e exige o **mesmo sha256**; depois reprojeta de novo e o exige
   outra vez. Ele não depende de nenhum outro alvo;
7. roda `make test-rotacao-chave-mestra-k8s` (AT-146), **por último**: os três passos
   da [rotação da chave mestra](#rotacao-da-chave-mestra) — as duas chaves publicadas
   no Secret de origem `brabo`, o `ExternalSecret` forçado a sincronizar, a api
   reiniciada, o `rewrap-deks.js` da imagem, a chave anterior removida e a api
   reiniciada de novo — com todo envelope conferido abrindo em cada passo e uma
   credencial decifrando para o mesmo valor no fim. Ele troca a chave mestra do cluster
   e reinicia a api, e é por isso que nada roda depois dele;
8. só quando **tanto** o restore quanto a quebra deliberada passaram na mesma
   execução, escreve `ultima-execucao-boa.json` (data, execução, commit, duração do restore)
   e o sobe como o artefato `restore-ultima-execucao-boa` (guardado 90 dias),
   e acrescenta a linha *Última execução boa do restore* ao resumo da execução;
9. escreve a duração de cada passo no resumo da execução.

Um **segundo job**, `restore-compose` (AT-195), roda ao lado dele noutro
runner — o compose de produção publica 3000/4000/8088, as mesmas portas que o
cluster k3d mapeia, então os dois não podem dividir um. Ele constrói as quatro imagens com
`docker-bake.hcl` (como o `ci.yml` faz), sobe o compose de produção pelo
`docker/smoke.sh` (que deixa o usuário e a sessão do seed no banco),
cria um bare repo em `git_local_repos` como fixture, e roda
`make test-restore-compose`: um backup real, o restore com as três
validações, e a verificação do arquivo dos bare repos. Um verde sem a
linha nomeando os bare repos verificados reprova o passo. As falhas dele abrem issues
do mesmo jeito, com títulos próprios.
Medido na execução `36371633435`: build das imagens 190 s, subida do compose (smoke) 43 s,
`make test-restore-compose` 4 s — 4 min 31 s para o job, em paralelo com os
11 min do job do cluster, então o relógio do workflow não se mexe.

| gatilho | quando |
|---|---|
| `schedule` | semanal, domingo 04:00 UTC |
| `workflow_dispatch` | sob demanda, pela aba Actions (`gh workflow run propriedades.yml`) |

**Uma falha abre uma issue** com o título `Prova de propriedade falhou: <alvo>`,
uma por alvo, e uma falha repetida do mesmo alvo **comenta na issue
aberta** em vez de abrir outra. O bootstrap tem título próprio: com
o cluster fora do ar, os três alvos ficam `skipped`, e uma execução agendada pulada
é o silêncio que isto existe para quebrar. **A primeira execução em que o alvo
passa fecha a issue dele** com um comentário nomeando aquela execução (AT-212) — ninguém
precisa lembrar. Só uma execução na **branch default** (a agenda, ou um
`workflow_dispatch` nela) mexe em issues: um `workflow_dispatch` vermelho numa
branch falha na própria execução, registra um aviso, e nem abre nem comenta na
issue da agenda, e um verde numa branch não fecha nada. As execuções ficam
em fila **por ref** (`concurrency: propriedades-<ref>`): dois dispatches em
branches diferentes rodam lado a lado, dois na mesma ref esperam um pelo outro.
Ele **não** é gate nem check obrigatório — nada espera por ele.

Medido nas execuções que construíram o workflow (4 vCPUs, 15 GiB de RAM, 87 GB de
disco livre no `ubuntu-latest`):

| passo | duração |
|---|---|
| bootstrap (build das imagens + cluster + operators + app) | 705 s |
| `make smoke-k8s` | 1 s |
| `make hpa-test` | 19 s |
| `make rollout-test` | 24 s |
| `make test-restore` | 21 s |
| `make test-restore-mutacao` | 31 s (execução `35473548113`) |
| `make test-reprojecao-k8s` | 16 s (execução `35471428634`); 18 s com o cenário de quatro eventos (execução `36498776825`) |
| `make test-reprojecao-artefatos-k8s` | 4 s (execução `36498695123`, job inteiro 10 min 28 s) |
| `make test-rotacao-chave-mestra-k8s` | 47 s (execução `36502355798`, job inteiro 12 min 10 s) |
| job inteiro | 12 min 56 s |

(Primeira execução inteira verde, `34784563928`, em 2026-09-13.)

Com `BRABO_SKIP_OBSERVABILITY=1` e os operators em paralelo (AT-177), a
fase do helm foi de 253 s (execução `36362479629`, na `dev`) para 89–90 s, o
bootstrap de 710 s para 547–555 s e o job inteiro de 13 min 43 s para
10 min 59 s (execuções `36367504128` e `36368334920`). O build das imagens (141–161 s)
e a espera do `seed-smoke` (ainda 180 s) não mudam com isso.

**O build das imagens continua um `docker build` simples, de propósito** (AT-178, medido
e recusado). Construir as quatro imagens pelo `docker-bake.hcl` com o
cache `type=gha` que o `ci.yml` já usa — em paralelo, carregadas no daemon,
o bootstrap então rodando com `BRABO_SKIP_BUILD=1` — foi tentado numa branch
e rodou verde duas vezes:

| | build das imagens | job inteiro |
|---|---|---|
| `docker build` no bootstrap (execuções `36367504128`, `36368334920`) | 161 s, 145 s | 10 min 59 s |
| bake, primeira execução na ref (`36369702417`) | 177 s (setup do buildx incluído) | 11 min 44 s |
| bake, cache quente (`36370592556`) | 116 s (setup do buildx incluído) | 11 min 32 s |

Quente, o passo ganha 30–45 s; frio, perde 15–30 s; no nível do job a
diferença fica dentro do ruído entre execuções. A execução que importa é a semanal
na `main`, e o cache do Actions despeja uma entrada que ninguém leu por 7 dias —
uma cadência semanal é exatamente onde o cache está frio com mais frequência. O
`no-cache-filter = ["runtime"]` do bakefile (AT-110) também reconstrói todo
estágio final de qualquer jeito, que é o que mantém pequeno o ganho quente. Reveja só com
uma medição mostrando cache quente na execução agendada.

A cadência segue esse custo. Quase todo ele é o bootstrap, que uma
execução noturna pagaria sete vezes por semana para reprovar propriedades cujo código
muda muito menos que isso; semanal mantém o alarme dentro de uma sprint,
e o `workflow_dispatch` cobre "acabei de mexer no backup". O timeout do job é
90 minutos e o passo do restore sozinho tem teto de 20 — veja o comentário nesse
passo para saber por que o teto pertence ao passo e não ao script.

**O que as primeiras execuções acharam**, cada um invisível ao `kubeconform` e a
todo check de PR, e cada um corrigido na mesma mudança que criou o
workflow — o `make deploy-local` estava quebrado na `dev` havia semanas sem
ninguém rodá-lo:

1. O `imageName` do cluster CNPG fixado só por digest
   ([ADR 0159](adr/0159-imagem-de-terceiro-por-digest.md)) é recusado pelo
   webhook do operator — *"Can't use just the image sha as we can't detect
   upgrades"*. Agora ele leva `:16.10@sha256:…`.
2. O Secret de origem do bootstrap não tinha `NEO4J_PASSWORD`, que o
   `ExternalSecret` da base lê desde o grafo ([ADR 0099](adr/0099-neo4j-grafo-de-conhecimento-e-templates.md)):
   o `brabo-secrets` nunca se materializava e todo pod ficava em
   `CreateContainerConfigError`.
3. A api não recebia nem `NEO4J_URI` nem `NEO4J_USER` no cluster, e em
   modo de produção ela recusa subir sem as três.
4. O StatefulSet do Neo4j exportava `NEO4J_USER`/`NEO4J_PASSWORD`, que o
   entrypoint da imagem transforma em chaves de config e rejeita (*"Unrecognized
   setting"*) — o próprio defeito sobre o qual um comentário duas linhas abaixo avisava. Esses
   manifestos nunca tinham rodado num cluster.
5. O `migrate-api` não conseguia `CREATE EXTENSION vector` (o papel do app não é
   superusuário), então a api subia sem tabelas. O cluster CNPG local agora
   a cria como superusuário, no banco do app e em `template1`.
6. `deploy/k8s/smoke.sh` e `rollout-test.sh` nunca mandavam o `kind` da sessão
   que se tornou obrigatório na FASE 20 (o `docker/smoke.sh` o ganhou naquela hora), então os dois
   falhavam com um 400 antes de provar qualquer coisa.
7. O `make test-restore` morria no `pg_restore` com *"permission denied to create
   extension vector"* — o caso que a tabela acima já nomeia — porque
   nada no cluster local fornecia a extensão ao banco que o
   restore cria.
8. Com a extensão fornecida, o `pg_restore` ainda morria — agora com *"must be
   owner of extension vector"*, no `COMMENT ON EXTENSION` do dump: só o
   dono da extensão pode comentá-la, e onde o papel do app não é
   superusuário (CNPG, qualquer Postgres gerenciado) a extensão pertence a outro papel.
   **Este não é local ao cluster**: o mesmo `brabo-restore` é o
   procedimento de incidente, então um restore de verdade num Postgres desses teria falhado
   do mesmo jeito. O `restore.sh` agora restaura a partir do índice do dump
   menos o comentário da extensão — uma string de descrição que a extensão instala,
   de que nenhum dado e nenhuma validação depende. Reproduzido contra um container
   `pgvector` simples com um papel não-superusuário antes e depois da mudança.
9. `deploy/k8s/test-restore.sh` esperava com `kubectl wait
   --for=condition=complete`, que nunca vê um Job que **falhou**, então o
   restore quebrado acima gastava o teto inteiro de 20 minutos do passo para informar o que o
   log do Job dizia em segundos (o teto do próprio script era 30). Agora ele consulta as duas
   condições e falha assim que o Job fica `Failed`.
10. `rollout-test.sh` procurava órfãs depois de um `sleep 15` fixo, que
    não distingue *ainda assentando* de *órfã de vez*. Agora ele consulta até um
    teto (`ROLLOUT_CONVERGENCE_SECONDS`, default 120) e registra, antes do
    rollout, em que réplica cada sessão vivia — os pods antigos levam os logs
    deles embora.

**Medido, e a causa provável desde então corrigida** (AT-078,
[RN-588](business-rules/engine.md#rn-588)) — o `Monitor` do pod antigo apagando a
linha de `session_states` que o par acabara de regravar; veja
[Provando que nada ficou órfão](#rollout-do-engine) para o que uma órfã nova
registraria. O que segue é o registro de antes da correção. **A prova de rollout
tinha falhado uma vez em quatro execuções que chegaram a ela** (duas em dez até a execução `35448353884`, 2026-09-19, em que
as cinco sessões viviam no mesmo pod antigo, quatro foram adotadas e uma terminou
sem dono e sem drenagem; os únicos logs que a nomeavam morreram com aquele pod —
e é por isso que a prova agora os guarda, veja
[Provando que nada ficou órfão](#rollout-do-engine)). Com o mesmo script e a mesma espera fixa, a execução
`34773908653` passou e a execução `34775712706` informou uma órfã — uma sessão
`active` na api sem dono em nenhuma das três réplicas do engine, 15 s
depois de o `rollout status` voltar. As duas execuções com a espera limitada passaram, e
as duas convergiram em **3 s**, as cinco sessões adotadas. Uma convergência normal
de 3 s torna "a órfã só precisava de mais de 15 s" a leitura menos provável;
a mais provável é uma corrida intermitente na adoção ou na drenagem que a espera
fixa por acaso pegou. Fica como está de propósito: o workflow existe para
pegar exatamente isto, e a próxima ocorrência agora vai falhar com o teto que
esperou, onde cada sessão vivia antes do rollout, e as linhas do engine que
nomeiam a órfã. A correção é do engine, não desta prova.

### Última execução verificada {#last-verified-run}

> **O workflow agendado é agora a fonte disto, e a data não é mais
> editada à mão** (AT-126). A execução mais recente do
> [`propriedades.yml`](#provas-de-propriedade-agendadas) que tem o
> artefato `restore-ultima-execucao-boa` é a última vez que o restore passou no
> Kubernetes **e** uma quebra deliberada dele foi pega na mesma execução:
> `gh run list --workflow propriedades.yml --status success --limit 1`, depois
> `gh run download <run> -n restore-ultima-execucao-boa` (guardado 90 dias). É
> um artefato de workflow, não uma métrica: um gauge do Prometheus ao lado dos alertas
> de backup exigiria código em `apps/api`, que esta mudança não tocou (o BRB-009 segue aberto nessa metade). O registro abaixo é mantido como foi escrito: é o
> histórico da primeira verificação e do que ela achou.

<!-- Atualize esta seção sempre que rodar o teste num ambiente novo. -->

| campo | valor |
|---|---|
| data | 2026-07-27 |
| ambiente | cluster k3d local, PostgreSQL 16.10 (CloudNativePG), MinIO |
| comando | `make test-restore` |
| RTO observado | ~40s do disparo do backup ao veredito (um banco de ~108 KB) |

Saída:

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

O RTO acima é de um banco de produção vazio — serve para provar
o PROCEDIMENTO, não para dimensionar uma recuperação de verdade. Meça de novo com um
dump representativo antes de prometer um RTO a alguém.

#### O que esta execução achou (e que o teste agora impede) {#what-this-run-found-and-that-the-test-now-prevents}

1. **Divergência de versão major do Postgres.** O CloudNativePG local estava
   rodando 17.4 enquanto o compose diz 16; o `pg_dump` recusava a
   conexão com "server version mismatch". O `imageName` do cluster
   foi fixado em 16.10.
2. **Falso verde de um banco vazio.** Com zero linhas, toda comparação de
   contagem vira `0 == 0` e a checagem de `seq` não olha nada.
   Hoje o script falha explicitamente nos dois casos.
3. **Uma contagem fixa de tabelas envelhece.** A validação comparava com um número
   escrito no script, que já estava velho naquela mesma sessão.
   Agora ela compara a LISTA de tabelas com a origem e diz qual
   falta.
4. **A imagem de backup carregava 48 CVEs HIGH/CRITICAL** vindas do `mc`
   (Go congelado desde setembro de 2025) e do `gosu` na base
   `postgres:16-alpine`. Trocada por `alpine` + `postgresql16-client`
   + `aws-cli`, todos do apk e portanto atualizáveis: 48 → 0. Veja
   a decisão 1b do ADR 0027.

### Última execução verificada — compose, destino em disco {#last-verified-run--compose-disk-destination}

| campo | valor |
|---|---|
| data | 2026-09-09 |
| ambiente | Docker compose, PostgreSQL 16 (imagem pgvector), destino em **disco** — sem cluster, sem bucket, sem `kubectl` |
| comando | `docker/backup/test-restore-compose.sh` (o que o `make test-restore-compose` roda) |
| banco | 55 tabelas, 422 eventos em 13 sessões — um banco povoado, não um vazio |
| bare repos | 2 (`exp001.git`, `exp004.git`), 27 003 bytes arquivados |

Saída (os três passos, resumida):

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

O `backup_runs` ganhou a linha `status = 'ok'` de cada execução, com o **dump** como
`object_key` — a mesma coluna que o `restore.sh` consulta para a janela do retrato.

#### O que esta execução achou {#what-this-run-found}

**O restore dos bare repos não conseguia escrever no volume em que restaura**, e só
rodá-lo revelou isso. O `git_local_repos` é compartilhado por três imagens com três
uids; ele fica com o dono de quem o montou primeiro (medido: `1000:1000`,
modo 0755) e a imagem de backup roda como uid 70. O primeiro `--restaurar` morreu
no meio da extração com `tar: can't make dir ./exp001.git: Permission denied`,
deixando o alvo escrito pela metade. Duas mudanças vieram disso, as duas acima: o
comando recusa **antes** de extrair e nomeia `--user 0:0`, e quando ele de fato
roda como root devolve a árvore extraída ao dono do diretório em vez de
deixá-la com dono root — o que teria produzido um volume que restaura
perfeitamente e em que api e engine não conseguem escrever.

Verificado depois com `git` de verdade (não a imagem de backup, que não tem):
`git fsck --connectivity-only` limpo nos dois repos, refs e commits intactos,
dono de volta em `1000:1000`.

---

## Rotação das chaves do auth {#rotacao-das-chaves-do-auth}

Decisões no
[ADR 0031](adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) e no
[ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md).

O auth first-party tem **três** segredos, com consequências muito diferentes
quando trocados. Confundir os dois primeiros é o erro caro aqui.

### `AUTH_JWT_SECRET` — rotação sem indisponibilidade {#rotacao-do-auth-jwt-secret}

O par Ed25519 que assina o access token é derivado dele. A rotação
é a mesma dança de três passos da chave mestra (abaixo):

1. `AUTH_JWT_SECRET_PREVIOUS` recebe o valor antigo; `AUTH_JWT_SECRET` recebe
   o novo. Reinicie a api.
2. As duas chaves aparecem em `/.well-known/jwks.json` e as duas verificam; só a
   nova **assina**. A api emite um `WARN` uma vez por processo, na primeira
   verificação ou leitura do JWKS depois do boot (a chave anterior é derivada sob
   demanda, não no início), enquanto isso durar.
3. Depois de 15 minutos (o TTL do access token), nenhum token da chave antiga
   sobrevive. **Remova `AUTH_JWT_SECRET_PREVIOUS`** e reinicie.

Ninguém é deslogado: os refresh tokens têm hash com `AUTH_TOKEN_PEPPER`,
não com esta chave, e desde a [RN-613](business-rules/api.md#rn-613)
o pepper é obrigatório e nunca emprestado desta chave.

**A ordem, se esta instalação é anterior à RN-613: pepper PRIMEIRO, JWT depois.**
Antes da RN-613 um pepper não definido caía em silêncio para `AUTH_JWT_SECRET` — e
os composes de produção e de instalação nem passavam `AUTH_TOKEN_PEPPER` à
api, então isso era toda instalação compose. Agora a api **recusa
subir** sem o pepper, com uma mensagem dizendo o que fazer. A migração
que não desloga ninguém:

1. Defina `AUTH_TOKEN_PEPPER` com o valor **atual** de `AUTH_JWT_SECRET`
   (copie-o; não gere um novo). Reinicie a api. Os hashes dos tokens são
   byte a byte o que eram, então todo refresh token e PAT continua funcionando.
   O `install.sh` faz este passo sozinho quando encontra o `.env` anterior na
   pasta de onde roda, e diz isso no terminal sem imprimir o
   valor; o Kubernetes já tinha `AUTH_TOKEN_PEPPER` no `ExternalSecret`.
2. Só então rode a rotação de `AUTH_JWT_SECRET` com os três passos acima. Daqui em diante
   os dois segredos são independentes, e um pepper igual ao segredo de JWT *antigo*
   é o estado esperado, não uma sobra.

**Se alguém rotacionar o JWT antes de separar**, numa versão anterior à RN-613
essa rotação *era* uma troca de pepper: todo mundo é deslogado, todo link de
e-mail/reset aberto morre e todo PAT para de autenticar — o logout global
descrito na próxima seção. Não há como desfazer a não ser pondo o valor antigo
de volta como `AUTH_TOKEN_PEPPER` (o que revive os tokens antigos que não
expiraram, e invalida tudo o que foi emitido no meio). Na RN-613 e depois o
erro não acontece em silêncio: sem pepper a api não sobe. O único
jeito de ainda cair nele é gerar um pepper **novo** durante a migração
em vez de copiar o segredo de JWT atual — mesmo logout global.

Verificação: `apps/api/test/infrastructure/security/ed25519-access-token-issuer.spec.ts`
(describe "rotação de chave"); para o pepper,
`apps/api/test/infrastructure/security/auth-key-material.spec.ts` (describe
"pepperAtual (RN-613)": a recusa no boot e a mensagem dela),
`apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`
(describe "a migração do RN-613": um refresh com hash pelo fallback antigo continua
válido com o pepper definido como o segredo de JWT antigo, e sobrevive à
rotação do JWT) e `scripts/dev/install-env.spec.ts` (o `.env` que o instalador
escreve nos dois casos, pelo `docker compose config`).

### `AUTH_TOKEN_PEPPER` — logout global, sem meio-termo {#troca-do-auth-token-pepper}

Esta é a chave HMAC para o hash dos refresh tokens e dos tokens de conta.
Trocá-la invalida, tudo de uma vez:

- **todo** refresh token em circulação — todo mundo é deslogado;
- **todo** link aberto de verificação de e-mail e de redefinição de senha;
- **todo** personal access token (PAT) — um runner iniciado com `--token`
  para de autenticar (chaves de dispositivo não são afetadas);
- os contadores de lockout: toda conta travada destrava.

As senhas sobrevivem (argon2id, sem pepper): as pessoas entram de novo normalmente. Um
refresh rejeitado assim aparece como `refresh_unknown` em `auth_events`,
não como `refresh_reuse_detected`.

Não há `AUTH_TOKEN_PEPPER_PREVIOUS`, e essa é uma decisão consciente:
aceitar verificação dupla em todo refresh, para sempre, por um cenário
que acontece uma vez na vida, não compensa. Se você precisar trocá-lo —
suspeita de vazamento do banco, por exemplo — avise as pessoas antes: o sintoma
para o usuário é ser deslogado sem motivo aparente e ver o
link de redefinição dizer "expirado".

> A api **não** deixa de subir com um pepper novo. Ela simplesmente deixa de
> reconhecer qualquer token antigo. Se o suporte relata "todo mundo foi deslogado
> ao mesmo tempo", esta variável é o primeiro lugar para olhar — e, numa
> versão anterior à [RN-613](business-rules/api.md#rn-613) em que ela
> nunca foi definida, `AUTH_JWT_SECRET`. Ela **deixa** de subir sem um, em
> produção: veja a ordem de migração acima.

Verificação: `apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`
([RN-597](business-rules/api.md#rn-597)).

### `BRABO_SERVICE_TOKEN` — rotação sem indisponibilidade, dos dois lados {#rotacao-do-brabo-service-token}

Este é o segredo compartilhado que autentica o tráfego api ↔ engine
([RN-035](business-rules/api.md#rn-035)). Ele não tem nada a ver com sessão de
usuário: errá-lo não desloga ninguém, quebra a comunicação
interna.

A dança é a mesma do `AUTH_JWT_SECRET`, com a diferença de que ela
roda nas **duas** cargas — e a ordem importa, porque cada lado manda o
atual e aceita os dois:

1. `BRABO_SERVICE_TOKEN_PREVIOUS` recebe o valor antigo na **api e no
   engine**; `BRABO_SERVICE_TOKEN` recebe o novo nos dois. Reinicie
   os dois. Em produção a api, o engine e o broker conferem o valor
   antigo com a mesma regra do novo, então se o valor antigo é o default
   público ou tem menos de 16 caracteres, cada um deles recusa subir neste
   passo e nomeia a variável
   ([RN-598](business-rules/api.md#rn-598),
   [RN-601](business-rules/engine.md#rn-601)). Sair de um
   token fraco, portanto, quer dizer pular o `_PREVIOUS`, e pagar por isso com
   a janela de `403`/`401` descrita abaixo.
2. Enquanto os dois estão de pé com a variável nova, o tráfego funciona em qualquer
   combinação de pods antigos e novos — é isso que torna o rollout seguro
   no meio do caminho.
3. Quando o rollout dos dois Deployments terminou, **remova
   `BRABO_SERVICE_TOKEN_PREVIOUS`** e reinicie.

Pular o passo 1 e só trocar o valor atual produz `403`/`401`
durante toda a janela em que um pod antigo continua de qualquer lado — o
sintoma do
[diagnóstico acima](#diagnostico-do-deploy).

Verificação: na api, `apps/api/test/infrastructure/security/service-token.spec.ts`
(describe "rotação do BRABO_SERVICE_TOKEN") e
`apps/api/test/interfaces/engine-service.guard.spec.ts`; no engine,
`apps/engine/test/engine_web/plugs/verify_service_token_test.exs` e
`apps/engine/test/engine/runtime_service_token_test.exs` (a regra do boot); no
broker, `apps/broker/src/config.spec.ts`.

> **Onde as variáveis `_PREVIOUS` chegam ao processo.** Nos três
> composes (`docker-compose.yml`, `docker-compose.prod.yml`,
> `docker-compose.install.yml`) todas estão mapeadas no `environment:`
> do serviço que as lê, vazias por padrão — definir uma no `.env`
> e recriar o serviço basta
> ([RN-595](business-rules/api.md#rn-595); guardado por
> `scripts/ci/previous-nos-composes.spec.ts`, que deriva a lista do
> código). **No Kubernetes elas chegam aos Pods pelo cofre de segredos**
> (AT-220): o `ExternalSecret`
> (`deploy/k8s/base/common/externalsecrets.yaml`) puxa o objeto `brabo`
> inteiro com `dataFrom.extract`, então um `_PREVIOUS` que existe lá cai em
> `brabo-secrets` e um que não existe simplesmente não está lá — sem falha de sync
> fora de uma rotação. Elas nunca são listadas uma a uma: uma entrada `data` cuja
> propriedade falta reprova o sync do Secret inteiro, e um `_PREVIOUS`
> ausente é o estado normal. De qualquer jeito, confirme dentro do
> container (`printenv`) antes de confiar no passo 2.

#### Fazendo no Kubernetes {#rotacao-no-kubernetes}

A mesma dança, com o objeto `brabo` no provedor de segredos fazendo as vezes do
`.env`. No cluster local esse objeto é o Secret `brabo` que o bootstrap
criou; em staging/prod é a entrada do provedor para onde o `SecretStore` aponta.

1. **Acrescente** a chave `_PREVIOUS` (valor antigo) e **substitua** a chave atual (valor
   novo) no objeto `brabo` — as duas na mesma mudança. Localmente:

   ```bash
   kubectl -n brabo patch secret brabo --type merge -p \
     '{"stringData":{"AUTH_JWT_SECRET_PREVIOUS":"<old>","AUTH_JWT_SECRET":"<new>"}}'
   ```

2. **Faça o operator sincronizar agora** em vez de esperar o `refreshInterval`
   (1h), e confira que a chave chegou:

   ```bash
   kubectl -n brabo annotate externalsecret brabo-secrets force-sync="$(date +%s)" --overwrite
   kubectl -n brabo get secret brabo-secrets -o go-template='{{range $k, $v := .data}}{{$k}}{{"\n"}}{{end}}' | grep _PREVIOUS
   ```

3. **Reinicie** quem a lê. O `envFrom` é lido quando o container inicia:
   o Secret mudar não muda um Pod rodando. `api` para
   `AUTH_JWT_SECRET` e `CREDENTIALS_MASTER_KEY`, `api` **e** `engine` para
   `BRABO_SERVICE_TOKEN`:

   ```bash
   kubectl -n brabo rollout restart deployment/api deployment/engine
   kubectl -n brabo exec deploy/api -- printenv AUTH_JWT_SECRET_PREVIOUS
   ```

4. **Aposente-a** quando a condição da própria rotação for cumprida (15 min para
   `AUTH_JWT_SECRET`, os dois rollouts terminados para `BRABO_SERVICE_TOKEN`,
   `falhas=0` e zero pendentes para a chave mestra): **remova** a chave `_PREVIOUS`
   do objeto `brabo`, force o sync de novo (passo 2 — a chave
   some de `brabo-secrets`, não fica para trás) e reinicie de novo
   (passo 3). Até o reinício os Pods mantêm o valor antigo em memória, e a
   api continua avisando que há uma rotação em andamento.

   ```bash
   kubectl -n brabo patch secret brabo --type json -p \
     '[{"op":"remove","path":"/data/AUTH_JWT_SECRET_PREVIOUS"}]'
   ```

Verificação: os quatro passos foram exercitados contra o chart do External Secrets
Operator fixado em `deploy/k8s/helm/charts.env` (0.19.2) num cluster k3d
descartável, com o `SecretStore` local: a chave apareceu em
`brabo-secrets` depois do `force-sync` e sumiu depois da remoção, com o
`ExternalSecret` continuando `SecretSynced`. Desde a AT-146 os mesmos quatro passos rodam
toda semana para `CREDENTIALS_MASTER_KEY`, dentro do ensaio da chave mestra
(`make test-rotacao-chave-mestra-k8s`, veja
[Verificando sem esperar um incidente](#rotacao-da-chave-mestra)) — as
outras chaves `_PREVIOUS` ainda não têm execução automatizada. O que roda em todo PR é
o `scripts/ci/previous-nos-composes.spec.ts`, que reprova se o
`ExternalSecret` deixa de usar `dataFrom.extract` ou lista um `_PREVIOUS` em
`data:`.

```bash
# gere um valor com entropia suficiente; ele nunca precisa ser digitado
openssl rand -base64 48
```

### Conta travada por lockout {#conta-travada-por-lockout}

O lockout é curto (30s a 15 minutos) e se resolve sozinho: a
janela deslizante esvazia. **Não há endpoint de destravamento**, de propósito — veja
a [RN-031](business-rules/api.md#rn-031). Se você precisa destravar alguém
agora:

```sql
-- A chave é um HMAC do e-mail, não o e-mail. Ache-a pelo evento recente:
select subject_key, count(*), max(occurred_at)
  from auth_events
 where kind in ('login_failure', 'login_blocked_user')
   and occurred_at > now() - interval '30 minutes'
 group by subject_key order by 3 desc;

delete from auth_lockout_hits where bucket_key = '<subject_key>';
```

Uma redefinição de senha bem-sucedida também destrava a conta.

Verificação: **nenhuma** para as duas consultas acima — elas foram conferidas contra
o schema por leitura, nunca executadas por um spec. O próprio lockout (a
janela, o contador, o que o destrava) é coberto por
`apps/api/test/application/use-cases/auth/lockout.spec.ts`.

> **O rastro nunca é apagado.** `auth_lockout_hits` é um contador
> efêmero; `auth_events` é append-only e sobrevive a tudo, inclusive
> à remoção do usuário (sem chave estrangeira, de propósito).

## Rotação da chave mestra {#rotacao-da-chave-mestra}

Decisões no [ADR 0027](adr/0027-fase5-backup-hardening-release.md).

`CREDENTIALS_MASTER_KEY` embrulha as DEKs que cifram os segredos do usuário:
chaves de API de LLM e tokens de git. Ela é rotacionada periodicamente e, obrigatoriamente,
depois de qualquer suspeita de vazamento.

### O que está em jogo {#whats-at-stake}

Trocar a variável e reiniciar a api com uma chave só torna toda
credencial existente ilegível, tudo de uma vez, sem erro de boot — a falha
só aparece no primeiro uso, como "não foi possível decifrar", e não há volta
a não ser restaurando a chave antiga.

É por isso que a rotação tem três passos, não um. Durante o do meio, as duas
chaves coexistem:

| variável | papel |
|---|---|
| `CREDENTIALS_MASTER_KEY` | chave ATUAL — sempre usada para cifrar |
| `CREDENTIALS_MASTER_KEY_PREVIOUS` | chave anterior — tentada só quando a atual falha |

Duas tabelas guardam envelopes: `user_credentials` e
`project_git_connections`.

Desde a [RN-563](business-rules/api.md#rn-563) cada envelope leva também um
**`key_id`** — a impressão digital da chave que o embrulhou. É ele que torna
o progresso do passo 2 respondível em SQL. Duas coisas sobre ele importam às 3h:

- **Ele nunca decide se uma linha abre.** A leitura continua tentando a chave
  atual e caindo para a anterior; o AES-GCM autentica, e ele é a
  autoridade. O rótulo é metadado, e uma linha cujo rótulo discorda do
  envelope é re-embrulhada corretamente assim mesmo ([ADR 0158](adr/0158-o-id-da-chave-mestra-gravado-no-envelope.md)).
- **`key_id IS NULL` quer dizer "escrita antes de essa coluna existir", nunca "na
  chave atual".** Numa instalação anterior a ela, tudo é `NULL`
  até a primeira rotação, e as consultas abaixo contam isso como pendente — que
  é a resposta honesta.

Pegue a impressão digital atual do próprio log da api; ela imprime uma linha no boot:

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=200 \
  | grep 'chave mestra corrente'
# chave mestra corrente: key_id=4f2b91c0a77e13d5
```

### Antes: dimensione {#before-size-it-up}

```sql
select 'user_credentials' as tabela, count(*) from user_credentials
union all
select 'project_git_connections', count(*) from project_git_connections;
```

O re-embrulho é um UPDATE por linha. Milhares de linhas levam segundos; é
bom saber a ordem de grandeza antes de começar.

### 1. Publique as duas chaves {#1-publish-both-keys}

Gere a nova e publique **as duas** no provedor de segredos, mantendo
a antiga em `CREDENTIALS_MASTER_KEY_PREVIOUS`:

```bash
openssl rand -hex 32   # a chave nova
```

No cluster local o Secret de origem é criado pelo bootstrap; em
staging/prod o valor vai para o provedor de onde o External Secrets lê.
Depois reinicie a api para ela carregar as duas:

> Publicar `CREDENTIALS_MASTER_KEY_PREVIOUS` no objeto `brabo` do
> provedor a põe em `brabo-secrets` no próximo sync (o `ExternalSecret`
> puxa o objeto inteiro) — force o sync e confirme que ela chegou como em
> [Fazendo no Kubernetes](#rotacao-no-kubernetes), depois reinicie. Nos
> composes é o `.env` mais recriar a api.

```bash
kubectl -n brabo rollout restart deployment/api
kubectl -n brabo rollout status  deployment/api
```

Confirme que a api está em modo de rotação — ela avisa no log, de propósito, e o
aviso nomeia **as duas** impressões digitais, que é contra o que as consultas abaixo
comparam:

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=50 \
  | grep CREDENTIALS_MASTER_KEY_PREVIOUS
# ... rotação em andamento (atual key_id=<NEW>, anterior key_id=<OLD>). ...
```

> Daqui em diante **nada quebra**: um segredo novo já nasce na chave
> nova, um segredo antigo continua legível pela anterior. Você pode
> pausar neste estado por horas se precisar — mas não por semanas:
> aceitar duas chaves dobra a superfície de uma chave vazada, que é
> exatamente o motivo de você estar rotacionando.

### 2. Re-embrulhe o acervo {#2-re-wrap-the-store}

```bash
kubectl -n brabo exec deploy/api -- node scripts/rewrap-deks.js
```

Saída esperada — o script imprime em português, e é isto que ele
de fato escreve (`apps/api/src/scripts/rewrap-deks.ts`, `main`):

```
[rewrap] resultado

  user_credentials         total=12  re-embrulhados=12  já na chave atual=0  falhas=0
  project_git_connections  total=3   re-embrulhados=3   já na chave atual=0  falhas=0

[rewrap] concluído. Agora remova CREDENTIALS_MASTER_KEY_PREVIOUS e reinicie a api.
```

Os contadores: `re-embrulhados`, `já na chave atual` e `falhas`. Há dois outros desfechos.
Quando nada precisou ser re-embrulhado, a última linha é `[rewrap] nada a fazer — o
acervo já está na chave atual.`. Quando alguma linha falhou, cada uma vai para o `stderr` como
`[rewrap] <tabela>#<id>: <motivo>`, a execução termina com `[rewrap] <N>
registro(s) não abriram com nenhuma das duas chaves. NÃO remova
CREDENTIALS_MASTER_KEY_PREVIOUS até resolver.`, e o código de saída é 1.

Propriedades que importam se algo interromper o script:

- **Idempotente.** Rodá-lo de novo conta as linhas já convertidas como
  `já na chave atual` e não reescreve nada. Interrompido? Rode de
  novo.
- **Só o envelope muda.** O texto cifrado do segredo fica byte a
  byte o mesmo, então parar no meio deixa o acervo consistente: parte na
  chave nova, parte na antiga, e as duas legíveis enquanto o PREVIOUS
  existir.
- **`falhas > 0` bloqueia o passo 3.** São linhas que não abrem com
  nenhuma das chaves — em geral vindas de outro ambiente, ou de uma
  rotação anterior interrompida com a chave já descartada.
  O script identifica cada uma por id, e nomeia POR QUE falhou — uma linha de
  outro ambiente ("embrulhado pela chave `<kid>`"), uma linha cujo rótulo
  discorda do envelope ("rótulo incoerente ou registro adulterado"),
  e uma linha sem rótulo nenhum são três diagnósticos diferentes com três
  respostas diferentes. Não remova o PREVIOUS: sem ele você perde também o que
  ainda abria.

**Interrompido, e quer saber onde parou?** Pergunte ao banco em vez de
rodar o script de novo pelo contador — com `<NEW>` a impressão digital atual
do log acima:

```sql
select 'user_credentials' as tabela, count(*) as pendentes
  from user_credentials       where key_id is distinct from '<NEW>'
union all
select 'project_git_connections', count(*)
  from project_git_connections where key_id is distinct from '<NEW>';
```

`is distinct from`, nunca `<>`: linhas com `key_id IS NULL` têm de contar como
pendentes, e `<>` as descartaria em silêncio.

### 3. Descarte a chave antiga {#3-discard-the-old-key}

Só depois de `falhas=0` **e** a consulta acima responder `0` nas duas tabelas. As
duas dizem coisas diferentes e você quer as duas: `falhas=0` quer dizer que nada se recusou
a abrir nesta execução, e a consulta quer dizer que nada ficou para trás — inclusive
linhas que uma execução anterior, interrompida, nunca alcançou.

```bash
# remova CREDENTIALS_MASTER_KEY_PREVIOUS do provedor, depois
kubectl -n brabo annotate externalsecret brabo-secrets force-sync="$(date +%s)" --overwrite
kubectl -n brabo rollout restart deployment/api
```

Verifique que o aviso de rotação sumiu do log e que uma
credencial existente ainda funciona (o caminho mais direto é a tela de
credenciais do projeto, ou qualquer turno de agente que use uma chave de LLM).

### Verificando sem esperar um incidente {#verifying-without-waiting-for-an-incident}

**O ciclo inteiro tem uma verificação nomeada, e ela roda no CI**
([RN-562](business-rules/api.md#rn-562)):

```bash
pnpm --filter api test -- test/scripts/rewrap-deks.spec.ts
```

Esse spec conduz a sequência desta página contra um Postgres de verdade e **as duas**
tabelas: cifra com K1, publica K2, re-embrulha, descarta K1, e ainda decifra. Ele
também fixa as duas propriedades em que este procedimento se apoia — idempotência (uma segunda
execução informa `re-embrulhados=0`) e a linha ilegível sendo contada e nomeada
sem abortar as outras.

Cobertura mais estreita, em memória, das mesmas primitivas — inclusive o caso em que
nenhuma chave funciona, e o caso em que o rótulo `key_id` mente — mora em
`test/infrastructure/security/envelope-encryption.service.spec.ts`.

O `rewrap` também roda em qualquer ambiente: num de teste, o ciclo completo à mão
cabe em poucos minutos.

**Já rodou de verdade? Não.** A resposta do mantenedor (2026-09-27): esta
rotação **nunca** foi executada num ambiente real. Então o spec acima
não é uma rede de segurança sob um procedimento praticado — até a AT-146 era a única
prova, e nunca tocou a imagem, o `ExternalSecret` nem um reinício da api.

**O ensaio, no cluster, toda semana (AT-146).**
`make test-rotacao-chave-mestra-k8s` (`deploy/k8s/test-rotacao-chave-mestra.sh`)
roda os três passos desta página contra o cluster local, com a mesma
mecânica: ele escreve uma credencial de LLM com valor aleatório pela API
e confere que todo envelope abre na chave de hoje; o **passo 1** publica a chave
nova e a antiga como `_PREVIOUS` no Secret de origem `brabo` (o substituto
local do provedor — nunca o `brabo-secrets` direto), força o
sync do `ExternalSecret`, espera o `_PREVIOUS` chegar, reinicia a api e
exige o aviso de rotação nomeando **as duas** impressões digitais; o **passo 2** exige
linhas pendentes pela consulta acima, roda o `node scripts/rewrap-deks.js` da imagem
(`falhas=0`), exige **zero** pendentes, e roda de novo (`nada a fazer`);
o **passo 3** remove o `_PREVIOUS` da origem, exige que ele **suma**
de `brabo-secrets` depois do sync, reinicia a api, exige a linha de boot
com a impressão digital nova e nenhum aviso de rotação, e confere que todo envelope
abre só com a chave nova — e que a credencial do início decifra
para o **mesmo valor** (comparado por sha256 dentro do pod; o valor nunca
sai dele). O veredito é o código de saída. Ele é o **último** alvo do
agendado `.github/workflows/propriedades.yml`, porque troca um segredo e
reinicia a api, e deixa o cluster na chave nova sem `_PREVIOUS`
— uma rotação terminada, não uma pela metade. Primeira execução verde: `36502355798`
(2026-09-29, 47 s).

O que o ensaio **não** cobre, declarado: linhas de `project_git_connections`
(criar uma conexão de git pela API valida um token contra um
provider real, e o cluster da prova não tem saída de rede — a tabela é lida pelo
verificador e pelo `rewrap`, em geral com 0 linhas; o envelope dela é o mesmo código,
provado nas duas tabelas pelo spec acima), e o provedor de segredos de staging/produção
(aqui a origem é o Secret local que o `SecretStore` do overlay
lê; o `ExternalSecret` e o operator são os de verdade). É um
ensaio num cluster descartável, **não** uma rotação de ambiente real:
"nunca rodou de verdade" continua verdade até alguém rotacionar um.

### Interação com o restore {#interaction-with-restore}

**Restaurar um dump num ambiente com outra chave mestra devolve
um banco intacto com credenciais inúteis.** O dump leva
as DEKs embrulhadas, não a chave. Se você restaurou um backup de produção num
ambiente de teste e as credenciais não abrem, não é corrupção:
é a chave errada — e desde a [RN-563](business-rules/api.md#rn-563) você pode
confirmar isso numa comparação em vez de por eliminação, lendo o `key_id`
de qualquer linha e pondo-o ao lado da linha `chave mestra corrente` no
log de boot da api. Veja
[Restore](#restore).

É por isso que a chave mestra faz parte do plano de recuperação: um backup de banco
sem a chave correspondente não recupera os segredos do usuário.

### Quando algo dá errado {#when-something-goes-wrong}

| sintoma | causa |
|---|---|
| a api sobe sem aviso de rotação, mas o script exige o PREVIOUS | a variável nunca chegou ao pod; o ESO só ressincroniza a cada `refreshInterval` (1h) |
| `falhas` igual ao total | o PREVIOUS publicado não é a chave que embrulhou o acervo |
| `já na chave atual` igual ao total, sem ter rodado antes | as duas variáveis têm o mesmo valor — o serviço ignora o PREVIOUS nesse caso |
| uma credencial para de funcionar DEPOIS do passo 3 | alguma linha ficou para trás; republique o PREVIOUS imediatamente e rode o script de novo. A consulta de progresso do passo 2 é o que impede isto, e é a checagem a rodar primeiro |
| a consulta de pendentes responde o total inteiro, num banco que ninguém rotacionou ainda | esperado: o `key_id` é escrito da próxima escrita em diante, então uma instalação anterior à [RN-563](business-rules/api.md#rn-563) o tem `NULL` em todo lugar até a primeira rotação. `NULL` conta como pendente de propósito — "não sei qual chave" não é "já na atual" |
| o `rewrap` diz que uma linha está numa chave que não é nem a atual nem a anterior | a linha veio de outro ambiente — o mais comum é um dump restaurado entre instalações. Veja [Interação com o restore](#rotacao-da-chave-mestra) abaixo; o `key_id` da linha contra o do log de boot da api diz de relance |

---

## Incidente de custo {#incidente-de-custo}

Agentes gastam tokens a cada turno, e um agente preso num laço gasta
rápido. Esta seção é para o momento em que o custo por hora dispara e alguém
precisa decidir o que cortar.

### Sinal {#signal}

O alerta *Custo por hora acima do limite* dispara quando o gasto projetado passa
de USD 5/hora em qualquer projeto:

```promql
max(sum by (project) (rate(brabo_llm_cost_micros_total[10m])) * 3600 / 1000000)
```

O alerta é um **aviso**, não um freio. O freio de verdade são os
`budgets` do domínio, e eles agem por projeto/sessão, nunca globalmente
([RN-019](business-rules/api.md#rn-019)).

### 1. Qual projeto, qual agente {#1-which-project-which-agent}

Grafana → painel **Brabo · visão executiva** → painel de custo por projeto.
Ou direto do banco, que também te dá o agente e o
modelo:

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

Duas leituras mudam a ação:

- **Um agente dominando a lista** com muitas chamadas curtas quer dizer laço:
  o ToolLoop repetindo a mesma ferramenta sem convergir.
- **Poucas chamadas e custo alto** quer dizer modelo caro em trabalho barato —
  binding errado, não laço.

### 2. Confira o orçamento {#2-check-the-budget}

```sql
select b.project_id, b.session_id,
       b.limit_micros / 1e6  as limite_usd,
       b.spent_micros / 1e6  as gasto_usd,
       round(100.0 * b.spent_micros / nullif(b.limit_micros, 0)) as pct,
       b.policy
  from budgets b
 order by pct desc nulls last;
```

A `policy` decide o comportamento no teto:

- **`block`** — a chamada é recusada. É o default e o que você
  quer em produção.
- **`allow`** — o teto vira mero registro; o gasto continua. Um
  projeto em `allow` gastando muito **não para sozinho**. Confira
  isto antes de qualquer outra coisa: é a causa mais comum de "o orçamento
  não segurou".

### 3. Corte o gasto {#3-cut-the-spend}

Em ordem de reversibilidade, do mais brando ao mais drástico.

**a) Tire os agentes da autonomia automática.** Eles param de agir
sozinhos e voltam a exigir aprovação por ação, sem perder
contexto:

```sql
update agent_autonomy
   set mode = 'require_approval', updated_at = now()
 where project_id = '<projeto>'
   and mode = 'auto_approve';
```

`agent_autonomy.mode` é o enum `permission_policy`
(`auto_approve | require_approval | deny`) — não há valor `manual`,
e uma versão anterior deste passo o usava e falhava na hora. O
`and mode = 'auto_approve'` é deliberado: sem ele, o update
transformaria toda linha `deny` do projeto em `require_approval`, afrouxando
exatamente o que alguém tinha fechado. As linhas `"*"` (modo automático, RN-153) são
cobertas pelo mesmo update.

O que este passo **não** corta: um padrão em `allow` no
`permissions.json` do projeto ainda auto-aprova o que casa — `decide()` lê
o arquivo depois de `agent_autonomy`, e o arquivo pode subir a decisão de volta
para `auto_approve` (`apps/api/src/domain/actions/decide.ts`, `decide`).
Se o gasto vem de comandos que o arquivo permite, vá para (c).

Os blocos SQL desta seção são rodados contra o schema migrado por
`apps/api/test/runbook/sql-do-incidente-de-custo.spec.ts`, que também
confere que (a) muda `auto_approve` e deixa `deny` em paz — um
valor inválido ou uma coluna renomeada aqui reprova a suíte da api, não o
incidente.

**b) Troque o binding de modelo por um local.** O Ollama custa zero; a qualidade
cai, o gasto para na hora:

```sql
-- veja o binding vigente e o escopo que o resolve
select scope, scope_id, model_id from model_bindings where scope_id = '<projeto>';
```

Depois aponte o binding do projeto para um modelo `local` pela tela de
configurações (o escopo mais específico vence: sessão > agente > projeto >
workspace — [RN-020](business-rules/api.md#rn-020)).

**c) Baixe o teto e garanta que é `block`.** Faz o próprio domínio
recusar as próximas chamadas:

```sql
update budgets
   set policy = 'block',
       limit_micros = least(limit_micros, spent_micros + 1000000)  -- +1 USD
 where project_id = '<projeto>';
```

**d) Feche as sessões do projeto.** Último recurso: interrompe trabalho em
andamento. Use a transição normal (`closing`), nunca `kill` no pod
— matar o pod não fecha uma sessão, só cria uma órfã
(veja [Rollout do engine](#rollout-do-engine)).

### 4. Depois {#4-afterward}

- **O Psicólogo já tem a evidência.** Se a causa foi um laço de
  agente, a análise dele aponta o agente alvo e a Anamnese pode
  propor um patch de instrução. Corrigir a instrução é o que impede
  de acontecer de novo; mexer no orçamento só compra tempo.
- **Confira que o alerta chegou.** As regras moram no Grafana, não no
  Prometheus: se o Grafana estava fora do ar, não houve aviso, e o silêncio
  não queria dizer saúde.

### O que esta seção não conserta {#what-this-section-doesnt-fix}

Custo já incorrido. Metering é registro, não reembolso: o `token_usage`
conta o que foi gasto, e nada aqui devolve dinheiro do
provider. A única prevenção real é `policy = 'block'` com um
teto sensato **antes** do incidente.

---

## Observabilidade {#observabilidade}

Como acompanhar uma sessão, achar custo, e diagnosticar quando não há dados.
Decisões no
[ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md).

### Observabilidade local, sem cluster {#observabilidade-local}

Tudo abaixo desta subseção supõe o cluster de pé. Para métricas
e logs sem subir Kubernetes, há um overlay de Compose
([ADR 0070](adr/0070-observabilidade-no-compose-local.md)):

```bash
pnpm dev:obs     # sobe a stack de dev + Prometheus, Loki, Alloy e Grafana
pnpm obs:down    # derruba só os quatro, deixando os apps de pé
```

O comando termina conferindo o que subiu — se diz `ok` em toda
linha, o painel tem dados; se reclama, diz qual peça
faltou.

Verificação: essa checagem final é `scripts/dev/observabilidade-pronta.mjs`,
e é uma **autoverificação, não uma prova** — ela só roda quando alguém sobe o
overlay, e não tem spec nem workflow. Uma mudança que quebra o
overlay aparece da próxima vez que alguém rodar `pnpm dev:obs`.

| ferramenta | endereço | serve para |
|---|---|---|
| Grafana | <http://localhost:3001> | painéis e logs, sem login |
| Logs | <http://localhost:3001/d/brabo-logs> | um serviço por vez, ou os três juntos |
| Prometheus | <http://localhost:9090> | conferir um alvo e séries cruas |
| Loki | <http://localhost:3100> | consulta direta (o caminho normal é o Grafana) |

**Os painéis são os MESMOS do cluster** — o Compose monta
`deploy/k8s/observability/dashboards/` direto, e os UIDs dos datasources
(`brabo-prometheus`, `brabo-loki`) são os mesmos. Um painel novo vale
nos dois ambientes sem cópia.

**O que este overlay não faz:** tracing. Sem um OpenTelemetry
Collector no meio não há Tempo, e isso é decisão, não
descuido ([ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md),
decisão 9). O `trace_id` ainda vai para o log e basta para
cruzar api e engine à mão.

Três coisas que confundem as pessoas, e vale saber antes de abrir uma
issue:

1. **Um painel de custo/tokens vazio é esperado num banco novo.** Essas
   métricas têm rótulos (`project`, `provider`), e no `prom-client` uma
   métrica rotulada não existe antes da primeira observação. Uma chamada de
   LLM e a série aparece.
2. **Só `api`, `engine` e `web` vão para o Loki.** Postgres e Ollama ficam
   de fora por ruído; a própria stack de observabilidade fica de fora porque,
   no mesmo projeto Compose, ela ingeriria o próprio log em laço.
3. **O nível `OUTRO`** é a linha de continuação de árvore do `pino-pretty`,
   que não tem nível próprio. Não é log perdido.

### Onde as coisas estão {#where-things-are}

| ferramenta | endereço local | serve para |
|---|---|---|
| Grafana | <http://localhost:3001> | painéis, traces, logs, alertas |
| Prometheus | `kubectl -n monitoring port-forward svc/prometheus-server 9090:80` | conferir um alvo e séries cruas |
| Tempo | datasource do Grafana | traces |
| Loki | datasource do Grafana | logs |

Dois painéis na pasta **Brabo**: *visão executiva* (custo/hora e
tokens/min por projeto, sessões ativas, decisões de ação) e
*visão operacional* (fila do Oban por estado, latência p50/p95 de LLM por provider,
tarefas bloqueadas, sessões por réplica).

### Acompanhando uma sessão da raiz até uma chamada de ferramenta {#following-a-session-from-the-root-to-a-tool-call}

1. Pegue o `trace_id` da sessão. É o campo do meio do
   `traceparent` guardado em `sessions.trace_parent`:

   ```bash
   # 00-<trace_id>-<span_id>-01
   curl -sS -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/projects/$PROJ/sessions/$SESS | jq -r .traceParent
   ```

2. No Grafana → **Explore** → datasource **Tempo** → aba **TraceQL**,
   cole o `trace_id`. A árvore volta com `session.create` (api)
   na raiz e, abaixo dele, `agent.turn` → `tool.call` / `llm.turn` /
   `gate.scanner` (engine).

3. A partir de um span, o botão **Logs for this span** salta para as linhas do Loki
   com aquele `trace_id`. O caminho inverso — de uma linha de log para o trace
   — é o link **TraceID** que aparece no detalhe da linha.

4. Custo daquela sessão: o painel *visão executiva* filtra por
   projeto. Para um valor exato por sessão, a fonte é o banco
   (`token_usage.cost_micros`), não a métrica — a métrica é agregada
   por projeto e provider de propósito, para não criar uma série por
   sessão.

### Quando não há trace no Tempo {#quando-nao-ha-trace-no-tempo}

O nome desta seção mudou junto com o comportamento (ADR 0035), e a
distinção é o primeiro passo do diagnóstico: **um span é sempre criado, em
qualquer ambiente.** O que `OTEL_EXPORTER_OTLP_ENDPOINT` controla é a
EXPORTAÇÃO. Então "não vejo trace no Grafana" e "não há trace" são
problemas diferentes.

Antes de qualquer coisa, veja de que lado está a falha — o log responde
sozinho:

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=20 | grep -o '"trace_id":"[^"]*"' | head
```

- **Há `trace_id` no log, nenhum trace no Tempo** → o problema é a
  exportação: siga de 1 a 4 abaixo.
- **Nenhum `trace_id` no log** → o problema é de contexto, e é mais raro:
  ou o `startTracing()` da api não rodou (veja
  `apps/api/src/tracing-boot.ts` — ele tem de ser o primeiro import do `main.ts`),
  ou o `Engine.Telemetry.Otel.setup/0` não foi chamado antes da árvore de
  supervisão.

Em ordem, do mais ao menos provável:

**1. A variável não está definida.** Sem `OTEL_EXPORTER_OTLP_ENDPOINT` o
span é criado e descartado no fim, então há `trace_id` no
log e nada no Tempo. Em desenvolvimento isso é esperado (sem collector);
num cluster, é defeito.

```bash
kubectl -n brabo exec deploy/api -- printenv OTEL_EXPORTER_OTLP_ENDPOINT
kubectl -n brabo exec deploy/engine -- printenv OTEL_EXPORTER_OTLP_ENDPOINT
```

**2. A NetworkPolicy está bloqueando.** Esta é a falha mais silenciosa
de todas: os spans são criados, o envio falha, e todo o resto fica
verde.

```bash
kubectl -n brabo get networkpolicy allow-otlp-egress
kubectl -n brabo logs -l app.kubernetes.io/name=engine --tail=50 | grep -i "error exporting"
```

**3. Protocolo errado.** O exporter do Elixir fala **HTTP/protobuf (4318)**,
não gRPC. Apontá-lo para a 4317 dá `socket_closed_remotely` em todo
lote.

**4. O Collector não está recebendo nada.**

```bash
kubectl -n monitoring logs deploy/otel-collector-opentelemetry-collector --tail=30
```

### Quando um painel está vazio {#when-a-panel-is-empty}

Quase sempre um **nome de métrica**. Os nomes são referenciados por string em três
lugares que não se enxergam: os painéis, as regras de alerta e
este runbook. Confira contra o que o serviço de fato expõe:

```bash
curl -sS http://localhost:3000/metrics | grep '^brabo_' | cut -d'{' -f1 | sort -u
kubectl -n brabo exec deploy/engine -- wget -qO- http://127.0.0.1:4000/metrics | grep -E '^(brabo|oban)_'
```

E se o serviço a expõe mas o Prometheus não a tem, o
problema é a coleta:

```bash
kubectl -n monitoring port-forward svc/prometheus-server 9090:80
# depois: http://localhost:9090/targets — os jobs são `brabo-api` e `brabo-engine`
```

### Quando não há log no Loki {#when-theres-no-log-in-loki}

O Alloy é um DaemonSet e lê `/var/log/pods` do nó, filtrando
pelo namespace `brabo`.

```bash
kubectl -n monitoring logs -l app.kubernetes.io/name=alloy --tail=30 | grep -i error
```

Avisos de `tailer stopped ... pods not found` são normais depois de um
rollout — o Alloy continua perseguindo pods que já foram removidos.

Os apps **não** conseguem falar com o Loki direto, e isso é intencional:
`allow-otlp-egress` só abre 4317/4318. Para consultar de fora:

```bash
kubectl -n monitoring port-forward svc/loki 3100:3100
curl -sS -G http://localhost:3100/loki/api/v1/query_range \
  --data-urlencode '{app="api"} | json | trace_id != ""' --data 'limit=5'
```

### Alertas {#alerts}

Provisionados e visíveis em **Alerting → Alert rules** (pasta Brabo), a partir de
`deploy/k8s/observability/alerts/brabo-alerts.yaml`. As regras levam os
títulos em português — é isso que você procura no Grafana:

| alerta (título no Grafana) | severidade | dispara depois de | o que investigar |
|---|---|---|---|
| *Fila do Oban crescendo sem consumo* | `critical` | 10 min | nenhuma réplica do engine Ready; pool do Postgres esgotado; um worker preso num job |
| *Sessão presa em closing* | `warning` | 15 min | [o drain não terminou](#quando-a-sessao-escapa), ou a transição para `closed` falhou |
| *Custo por hora acima do limite* | `warning` | 5 min | [qual projeto e qual agente](#incidente-de-custo); o orçamento do domínio continua sendo o controle duro |
| *Backup do Postgres atrasado* — último backup bom com mais de 26 h | `critical` | na hora | o CronJob não rodou, ou rodou e falhou — `brabo_backup_last_status` distingue os dois; veja [Restore](#restore). "Nunca teve backup" (`-1`) **não** o dispara |
| *Última execução do backup falhou* | `warning` | na hora | um backup bom de ontem ainda pode existir, e é por isso que este passa despercebido por dias; a causa está em `backup_runs.error_message` |

São regras do **Grafana**, não do Prometheus (desvio registrado no ADR
0026): elas deixam de ser avaliadas se o Grafana cair. Não há
Alertmanager nem destino de notificação configurado.

### Limites conhecidos {#known-limits}

- Nenhum trace de agente **real** foi observado de ponta a ponta: verificar isso
  exige um LLM configurado (Ollama ou uma chave de API). O mecanismo foi
  validado emitindo spans direto no trace da sessão.
- O web não exporta spans próprios — ele **gera** o
  `traceparent` e o manda no cabeçalho, e a api o adota como
  pai. Os logs do navegador vão para o console, não para o Loki.
- Retenção curta: Tempo 24h, Loki 24h, Prometheus 2h. É um ambiente
  local.

---

## Registro de gates {#registro-de-gates}

Os gates do fluxo são declarados em `apps/api/config/gates.yml`
([ADR 0054](adr/0054-gates-como-registro-declarativo.md)). Duas coisas
operacionais valem saber.

**O arquivo viaja dentro da imagem.** O `docker/api/Dockerfile.prod` o copia
nos dois estágios, do mesmo jeito que faz com as migrations, e o
`.dockerignore` o reinclui explicitamente — toda a `docs/` é ignorada, e
este é o único arquivo de lá que é dado de produção, não
documentação. Em runtime ele fica em `/app/apps/api/config/gates.yml`; o loader
sobe a partir de `__dirname` até achá-lo, sem variável de
ambiente.

**Um arquivo ilegível não derruba a api.** O carregamento é preguiçoso:
quem chama `GET /internal/gates` recebe o erro, e o resto do
processo segue. Se a rota devolve erro, confira que o arquivo
entrou:

```bash
kubectl -n brabo exec deploy/api -- cat /app/apps/api/config/gates.yml | head -5
```

Vazio ou ausente quer dizer que a imagem foi construída sem ele — provavelmente um
`.dockerignore` mexido, ou um build a partir de um contexto sem `docs/`.

**O registro viaja; o que ele aponta, não.** Um gate `teste`/`ci`
nomeia arquivos sob `apps/api/test/`, `scripts/ci/` e `.github/`, e nenhum
deles está na imagem. Até isto ser separado, o loader exigia
esses arquivos em runtime e a rota respondia `500` em toda instalação
— medido na v6.1.0 como doze 5xx em cerca de 55 minutos, com
`RegistroDeGatesInvalido` listando os onze alvos como "não existe".
Reproduza a falha antiga com:

```bash
docker exec <api> node -e "require('/app/infrastructure/gates/gate-registry.loader').carregarRegistro()"
```

Numa imagem corrigida isso não imprime nada. Se lança
`RegistroDeGatesInvalido` nomeando um `.spec.ts` ou um workflow, a imagem é
de antes da correção ([RN-070](business-rules/api.md#rn-070)); se
lança nomeando o *conteúdo* de um gate (um gate `block` sem `script`, um
gate `active` sem evidência), o próprio registro está errado e o
repositório é onde corrigir.

A tela não mostra esta falha: o `PrGateTimeline` cai para a
esteira completa quando `GET /gates` falha ([RN-084](business-rules/api.md#rn-084)),
então o único sinal era o log da api. O `docker/smoke.sh` agora chama as duas
rotas que servem o registro contra a imagem de produção, `GET /gates`
com o bearer do usuário e `GET /internal/gates` com o service token.
Uma função confere o corpo das duas, e reprova no `500`, numa
lista vazia e num registro sem `merge-protegida`. É isso que impede
a falha de voltar em silêncio. O token chega ao `curl` pelo
stdin (`--config -`), nunca pelo argv, então não aparece no `ps` nem no
log do CI.

Para ver o registro como a api o vê, já validado:

```bash
kubectl -n brabo exec deploy/api -- \
  curl -sH "x-brabo-service-token: $BRABO_SERVICE_TOKEN" localhost:3000/internal/gates
```

A medição de passagem NÃO roda em produção: é
`pnpm --filter api validacao:gates`, a partir do repositório, contra o
banco. Veja
[docs/explanation/gates.md](explanation/gates.md).

---

## Ambiente de inferência {#ambiente-de-inferencia}

Quando o agente responde vazio, truncado, extremamente devagar, ou "esquece"
as próprias instruções, o problema quase nunca está no código de domínio —
está aqui. As cinco primeiras causas foram achadas em nove execuções seguidas da
demo de gates e estão registradas no
[ADR 0020](adr/0020-destravar-gates-qa-secops.md); todas as variáveis estão
expostas no `docker-compose.yml`.

| variável | sintoma quando errada |
|---|---|
| **GPU** | o serviço `ollama` sem dispositivo reservado deixa a GPU parada e roda 100% na CPU: um prompt de ~7.000 tokens leva ~50s só para a ingestão. O override é opcional (`docker-compose.gpu.yml`, `pnpm dev:gpu`), mantido fora do compose principal porque sem `nvidia-container-toolkit` no host a reserva **faz o serviço não subir** |
| `OLLAMA_CONTEXT_LENGTH` | o default de 4096 trunca **em silêncio** um prompt feito para 128k. O agente perde as próprias instruções e começa a imitar o schema das ferramentas, que é o que sobra no fim do contexto |
| `OLLAMA_MAX_LOADED_MODELS` | com `OLLAMA_KEEP_ALIVE` alto, os modelos se acumulam: 15,2 GB de pesos residentes numa máquina de 15 GB, e o agente responde vazio por falta de memória |
| `OLLAMA_REQUEST_TIMEOUT_MS` | timeout curto demais para um modelo grande num prompt longo |
| `OLLAMA_MODE` (bootstrap de dev, [RN-461](business-rules/infra.md#rn-461), ADR 0114) | preso em `host` depois que o Ollama nativo na máquina do desenvolvedor foi desinstalado ou parado — todo turno de LLM local falha com `ECONNREFUSED` contra `http://host.docker.internal:<porta>`, e o serviço `ollama` do compose nunca sobe para cobrir (ele fica atrás de `profiles: ["local-llm"]`, e é esta variável que mantém esse profile desligado). Correção: `Docker › Reconfigurar Ollama` no `pnpm bootstrap`, que limpa `OLLAMA_MODE`/`OLLAMA_HOST` do `.env` e força a detecção a perguntar de novo no próximo `Create`/`Reset total` |
| `NINE_ROUTER_BASE_URL` ([RN-909](business-rules/api.md#rn-909), ADR 0222) | o provider `9router` falha com `ECONNREFUSED` (origem `infra`) e o teste de conexão da credencial recusa. O padrão `http://host.docker.internal:20128/v1` só resolve dentro do container: a api da instalação e a de produção alcançam o host pelo `extra_hosts: host.docker.internal:host-gateway`; rodando no host (smoke), aponte para `http://localhost:20128/v1`. Com o 9Router parado o erro é o mesmo, então confira primeiro se ele escuta na porta 20128 |
| `START_OUTBOX_DRAIN` / `START_ANAMNESE` | o Psicólogo e a Anamnese consomem turnos de LLM em paralelo com os agentes de execução e derrubam a conexão do dev no meio do ciclo |
| `TOOL_LOOP_MAX_ITERATIONS*` | um teto BAIXO demais e o agente para sem entregar, com `iteration limit reached` e origem `model` — o que engana, porque o modelo não fez julgamento errado nenhum, nem chegou a julgar. O teto é por TIPO ([RN-085](business-rules/engine.md#rn-085)): `8` para agentes conversacionais, `60` para o dev agent e o QA. Antes de subi-lo, confira se o agente TEM `token_budget_micros`; sem ele o teto é a única guarda de custo que existe |
| `TERMINAL_OUTPUT_MAX_BYTES` | subi-lo demais traz de volta o modo de falha que o teto existe para evitar: a saída de cada comando fica no histórico do laço e viaja em TODO turno seguinte. Não é questão de janela de contexto: a maior chamada bem-sucedida da execução que revelou isto primeiro tinha só 28.993 tokens de entrada ([RN-074](business-rules/engine.md#rn-074)) |
| `API_JSON_BODY_LIMIT` (api) / `TRANSPORT_MAX_BODY_BYTES` (engine) | o `413 request entity too large` no gate de QA/SecOps tinha a causa na própria api do Brabo, nunca no provider — o Express nunca teve limite de corpo configurado e valia o default de 100 KB, contra os 8 MB que o Phoenix aceita na perna engine→api mais pesada (`POST .../llm-turn`, que reenvia o histórico inteiro a cada iteração). `API_JSON_BODY_LIMIT` (default 10 MB) fecha essa ponta; `TRANSPORT_MAX_BODY_BYTES` (default 8 MiB) é o teto que a compactação de contexto do engine respeita POR CIMA da janela do modelo, para disparar antes de o corpo estourar o limite do HTTP ([RN-412](business-rules/api.md#rn-412), [ADR 0098](adr/0098-limites-de-transporte-e-janela-efetiva-de-compactacao.md)) |

Se o modelo do `9router` chama `Read` ou `Bash` (ferramentas que o Brabo não tem) na conta OAuth do Claude, a causa é a **camuflagem do OAuth** do 9Router ([RN-966](business-rules/api.md#rn-966)), não o agente: o 9Router renomeia as ferramentas e acrescenta falsas do Claude Code, e nenhuma configuração a desliga. Use API key do Claude ou outro provider.

> **Cuidado — a guarda não limpa a fila.** `START_ANAMNESE=false`
> bloqueia enfileiramentos **novos**, não os antigos. Já houve 20
> `AnamneseWorker`s acumulados em `executing` de execuções anteriores, que rodam
> no próximo boot independentemente da guarda. A fila precisa ser
> **expurgada**, não só ter a guarda desligada.

> **Ligar a Anamnese ou o Psicólogo: duas variáveis, não
> uma.** Os dois foram pausados em 2026-08-10 por decisão de produto, não por bug. O
> Psicólogo ainda está; a Anamnese foi religada pelo dono em
> 2026-10-01 ([RN-680](business-rules/engine.md#rn-680)) — `ANAMNESE_ENABLED`
> volta ao default `true` no código e nos três composes, e uma rodada
> sem sujeito elegível não faz chamada de LLM e diz por quê no log do engine
> (`sem_sujeito_elegivel`). Pausá-la de novo é `ANAMNESE_ENABLED=false`. `ANAMNESE_ENABLED` / `PSYCHOLOGIST_ENABLED` são as
> flags de produto (uma rodada NOVA pode acontecer?); `START_ANAMNESE` é a chave
> de boot (o tick periódico é sequer agendado?). A Anamnese periódica precisa das duas
> em `true`; o Psicólogo não tem chave de boot, porque o gatilho automático dele
> é o fechamento de sessão.
>
> Até a [RN-540](business-rules/engine.md#rn-540) as duas flags `*_ENABLED`
> **não estavam mapeadas** no serviço `engine` de nenhum dos composes, e o `docker compose`
> não repassa o ambiente do host — então defini-las no `.env` não fazia
> nada, em silêncio, enquanto três lugares no código prometiam que a pausa
> era reversível. Agora estão mapeadas, com o default do próprio código (`false`
> nos dois arquivos na época; `ANAMNESE_ENABLED` é `true` desde a RN-680). O compose de **instalação**
> (`docker/docker-compose.install.yml`) era o terceiro arquivo e ficou fora
> dessa correção; desde a AT-202 ele mapeia as mesmas flags com os mesmos defaults, e
> `scripts/ci/flags-do-engine-no-compose.spec.ts` confere os **três** arquivos
> e reprova o build da próxima flag booleana que não estiver mapeada, ou que
> levar default diferente do código (`START_OUTBOX_DRAIN` e
> `START_ANAMNESE` são `false` no compose de produção de propósito, e o
> spec declara essa divergência pelo nome). O compose de instalação levava
> o mesmo `false` — copiado da produção junto com o motivo da produção
> ("ele existe para validar as imagens") — e desde a AT-219 repete o
> `true` do código. Era um defeito da instalação, não uma escolha de custo:
> `START_OUTBOX_DRAIN` é a única coisa que drena a outbox da api para o
> engine, então numa instalação de uma máquina uma sessão fechada nunca parava os
> processos dela e um dev agent esperando uma aprovação, um gate ou o container
> nunca era acordado. Nenhuma das chaves gasta tokens com as flags de produto desligadas: com
> `ANAMNESE_ENABLED=false` o `kickoff/0` da Anamnese não agenda job nenhum,
> e o drain só enfileira o Psicólogo com `PSYCHOLOGIST_ENABLED=true`.
> Numa instalação, a Anamnese está, portanto, ligada ou desligada só por
> `ANAMNESE_ENABLED` (default `true` desde a RN-680). No Kubernetes não havia nada a corrigir — um
> Deployment/ConfigMap não intercepta nada, e o `brabo-config` nunca carregou
> estas variáveis. As duas flags são lidas no boot: mude-as e
> `docker compose up -d engine`.

### Um gate semântico num modelo pequeno {#a-semantic-gate-on-a-small-model}

O QA é o papel que cabe pior num 7B local: o julgamento varia entre
execuções, o que faz da demo um critério de aceite executável e **não**
um teste de regressão. Para torná-la confiável, aponte `DEMO_QA_MODEL` para um
modelo de API — o binding por agente (escopo `agent`, que vence `project`)
existe exatamente para isso.

A máquina de gates em si não varia: ordem imutável, retorno na mesma
branch, teto de correções, vereditos como artefato e um terminal
`awaiting_user` são todos verificados por ExUnit
([RN-014](business-rules/api.md#rn-014), [RN-015](business-rules/api.md#rn-015)).

---

## Instalando {#instalando}

```sh
curl -fsSLO https://github.com/daneiel/brabo/releases/latest/download/install.sh && bash install.sh
```

**Baixe um arquivo, depois rode-o com `bash`.** As duas formas mais curtas que parecem
equivalentes não são, e o script recusa as duas **pelo nome**, antes de
baixar qualquer coisa, imprimindo a linha acima:

- **Nunca `curl … | sh`.** O motivo é mecânico, não de estilo: com o
  script chegando pelo pipe, o `stdin` do processo **é** o download,
  então qualquer `read` lê bytes do próprio script ou bate em EOF. Um instalador que
  não consegue perguntar teria de escolher sozinho os locais das pastas na máquina de outra pessoa
  ([RN-526](business-rules/produto.md#rn-526)).
- **Nem `sh -c "$(curl …)"`** — esta foi a forma documentada até a
  AT-083, e nunca funcionou. O script confere **o próprio hash** contra o
  manifesto assinado, e sob `X -c "…"` não há arquivo para calcular hash: `$0` é o
  nome do shell. Com `dash` como `sh` (Debian, Ubuntu) ele morria ainda antes, no
  `set -o pipefail`. Não há chave para pular essa autoverificação, e não
  haverá ([ADR 0150](adr/0150-instalador-de-uma-linha.md)) — a correção é
  existir um arquivo. Rodá-lo sob um shell que não é bash também é uma recusa
  nomeada própria.

O script verifica **a própria origem** antes de fazer qualquer coisa — a assinatura
do `checksums.txt` da Release, e depois o próprio hash dentro desse
manifesto verificado. Uma falha em qualquer passo é uma **recusa nomeada**, nunca um aviso.

Ele precisa de **um** entre `sha256sum` (coreutils, Linux) ou `shasum -a 256` (vem
com o macOS) para fazer qualquer disso, e resolve qual **antes do primeiro
download** — não no meio de uma checagem. Faltar os dois é uma recusa **própria**,
nomeando as duas ferramentas e dizendo que nada foi baixado; é uma dependência
faltando do sistema operacional, e deliberadamente *não* é redigida como
as recusas de hash abaixo. Essas duas são desfechos diferentes pedindo coisas
diferentes — uma se corrige instalando, a outra **parando** — e a medição da AT-091
é o que pôs a linha entre elas: `sha256sum: command not found`
no macOS aparecia como *"o cosign baixado NÃO bate com o hash pinado neste
script. Isso não é um aviso: pare e investigue."*, o que tanto bloqueava toda
instalação no macOS quanto ensinava o leitor a ignorar essa frase. O `--print-plan`
não precisa de nenhuma das ferramentas e declara quais o script aceita
(`conferir-hash`).

A detecção tem **teto de 5s** na chamada ao Docker que faz (`docker compose ls`
fala com o daemon, e um daemon lento ou parado atrás de um socket vivo
travaria tudo *antes da primeira pergunta*). Bater no teto não é
erro — é o mesmo desfecho de não ter Docker nenhum, e o resto
dos sinais ainda é lido.

Sem TTY ele **informa e sai com 0**: imprime o que achou e o
comando a rodar num terminal. Isso é deliberado, e é a mesma forma
que o `consentir-base.mjs` já tem.

**O que ele nunca apaga:** a sua base de projetos e a sua pasta de espelho. Volumes
nomeados só vão com confirmação, listados um a um antes.

Ele sobe a stack a partir do **próprio compose**
(`docker/docker-compose.install.yml`), que pega as imagens de variáveis
e não constrói nada — e ele **baixa esse compose da Release**
([RN-570](business-rules/produto.md#rn-570),
[ADR 0160](adr/0160-o-compose-do-instalador-viaja-assinado.md)). Quatro arquivos
viajam com o instalador como assets `brabo-install-*`, no **mesmo**
`checksums.txt` assinado que cobre o binário do runner: o compose, o
`postgres/init.sql` e o `ollama/pull-models.sh` de que ele faz bind-mount, e o
`backup/test-restore-compose.sh` que a migração roda. Logo depois de verificar
a si mesmo — antes de qualquer pergunta, antes de escrever qualquer coisa — o script baixa
os quatro e confere cada hash contra esse manifesto. Três recusas nomeadas, todas
numa máquina intocada:

| a mensagem começa com | quer dizer | faça |
|---|---|---|
| *"a Release não publica …"* | a Release é anterior ao ADR 0160, ou o passo de publicação dela falhou no meio | instale a partir de um checkout do repositório naquela tag, ou espere a próxima release |
| *"o manifesto assinado não cobre …"* | o manifesto existe mas não tem linha para aquele asset | igual ao de cima — a Release está incompleta |
| *"… NÃO bate com o manifesto assinado"* | o arquivo baixado não é o que o manifesto assinado descreve | **pare e trate como incidente**; não tente contornar |

As cópias verificadas são escritas sob `docker/` na pasta de onde você rodou o
script — a mesma pasta do `.env` — só quando são necessárias pela primeira vez.
O que já estava lá (o compose da versão anterior, numa atualização) é
**substituído, nunca lido**, e o script nomeia o que substituiu; de dentro de um
checkout git noutro commit isso deixa o `git status` sujo.

> **Releases publicadas antes do ADR 0160 não levam esses assets.** O
> instalador delas ainda usa o caminho relativo, e a linha única acima falha num
> diretório vazio com *"no such file or directory"* depois de escrever o `.env` (a
> lacuna que a [RN-549](business-rules/ci.md#rn-549) mediu). Para essas tags, rode o
> instalador a partir de um checkout do repositório na tag que você está instalando.

> No caminho de *migração* a prova de restauração (`test-restore-compose.sh`) recebe o
> `.env` da instalação por `BRABO_ENV_FILE` (passado ao Compose como
> `--env-file`), porque o Compose procura o `.env` ao lado do arquivo de compose — não
> no diretório de onde você roda. Se você rodar a prova à mão contra uma
> instalação, exporte `BRABO_ENV_FILE=/caminho/para/.env` antes; um caminho que não
> existe é recusado, nunca substituído por outro arquivo. Uma prova que falha ainda
> não apaga nada ([RN-530](business-rules/infra.md#rn-530)).

Duas origens:

```sh
install.sh                  # --source=ghcr (default): por digest, assinatura verificada
install.sh --source=local   # buildx bake; exige árvore limpa numa tag
```

Os segredos são gerados uma vez e persistidos no `.env` com modo **600** — o
arquivo é criado vazio e trancado *antes* de receber conteúdo, porque uma janela
em que os segredos são legíveis por todos é exatamente o que este arquivo não pode ter.

Não há **passo de migrate**, e não deveria haver: o compose encadeia
`api` → `migrate-api` com `service_completed_successfully`, então o `up --wait`
espera as migrations. Um segundo lugar ordenando migrations seria uma segunda
fonte da mesma verdade.

Depois de a stack subir ele **pergunta antes de afirmar**: `/health` na api e no
engine, e só então diz que instalou.

Ele **instala o agente local** — o binário é verificado contra o
manifesto assinado e posto com `install -m 0755`, então não há `chmod` manual
([RN-531](business-rules/produto.md#rn-531)) — e pergunta UMA base, escrevendo-a nos
dois lados: `BRABO_PROJECTS_BASE` no `.env` e `base` no
`runner.json` do runner. Uma Release sem binário para esta plataforma não interrompe
a instalação: ela diz isso e aponta para `npm install -g @brabo/runner`.

Sobre uma instalação existente ele **migra ou para** — um `up` em volumes
de outra versão é dano que não avisa. A ordem é backup →
**PROVAR** que restaura → perguntar → apagar → instalar → restaurar, e a prova no
meio é o que dá ao instalador o direito de apagar
([RN-530](business-rules/infra.md#rn-530)).

E ele sabe **qual** versão está substituindo ([RN-542](business-rules/produto.md#rn-542)).
As imagens são resolvidas **antes** de a detecção rodar, então a pergunta nunca é
cega: o marcador registra a `versao` instalada, o manifesto leva a que
está para ser instalada, e a oferta é específica para a relação entre elas.

| relação | o que oferece | default |
|---|---|---|
| mais nova | *"Atualizar 5.0.0 → 5.1.0?"* | **sim** — é o que você veio fazer, e o backup provado a torna reversível |
| a mesma | *"Já é a 5.0.0. Reinstalar do zero mesmo assim?"* | não — não há ganho a oferecer |
| mais velha | a nomeia **downgrade**, avisando que migrations de banco não rodam para trás | não — pode não ter volta |
| desconhecida | um marcador do schema 1 não tem versão; ele diz isso, e não adivinha | não |

Qualquer que seja o ramo que você escolher, a instalação é **apagada e recriada do
zero** em vez de iniciada por cima dos volumes antigos. Meia migração é
pior que nenhuma.

Um `install.sh` chamado pelo menu do `pnpm bootstrap` (*Docker › Instalar*)
só **informa** o plano. Isso é mecânico, não preferência: um item de menu
roda com stdin em `/dev/null` para o menu poder continuar lendo teclas do mesmo
terminal, e este instalador é feito para *perguntar*. A nota no item leva
o comando de uma linha que instala de verdade.

> **O que ele não faz:** ligar o **broker** de containers sem perguntar —
> veja [o broker numa instalação](#broker-na-instalacao) logo abaixo. O
> agente local ele **pareia**, desde a [RN-547](business-rules/produto.md#rn-547): ele
> cria a primeira conta, gera a chave de dispositivo de máquina na máquina,
> registra a metade pública, carimba o `kid` e instala a unit de **máquina**
> ([ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)) — e quando um
> elo falha ele nomeia o comando a repetir, veja
> [Quando o instalador não fecha a instalação](#instalador-nao-fecha).
> O que fica na tela do projeto é um pareamento **preso a um projeto**: essa chave de
> dispositivo e o `brabo-runner.config.json` ainda vêm de lá
> ([ADR 0118](adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)).
> Inspecione tudo com `install.sh --print-plan`, que não toca em nada.

Verificação: `.github/workflows/install-e2e.yml` roda a linha única acima numa
máquina **limpa**, sob um pty de verdade, em toda tag final — o instalador, a
stack, a primeira conta, a chave de máquina e o agente pegando o primeiro
projeto. Em todo PR os specs `scripts/dev/install*.spec.ts` provam as peças
que não precisam de Release: o plano e o estado (`install.spec.ts`), o
`.env` pelo próprio parser do Compose (`install-env.spec.ts`), os passos de fechamento
(`install-fechamento.spec.ts`), as invocações recusadas
(`install-invocacao.spec.ts`), os arquivos baixados
(`install-arquivos-da-instalacao.spec.ts`), a pergunta do broker
(`install-broker.spec.ts`), e que o próprio E2E não apodreceu
(`install-e2e.spec.ts`). O caminho de **migração** — backup, provar, apagar,
instalar, restaurar — não tem execução de ponta a ponta: a máquina do E2E é limpa, então a
pergunta nunca é feita, e só o repasse do `.env` da prova de restauração tem spec
(`scripts/dev/prova-de-restauracao-env.spec.ts`).

### O broker de containers numa instalação {#broker-na-instalacao}

Projetos nos modos **Container** e **Pasta montada** rodam dentro de um container, e
quem sobe esse container é o **broker**
([ADR 0144](adr/0144-a-segunda-raiz-do-broker.md)). Sem ele nenhum dos modos
jamais executa: `container_start` termina `failed` com `BrokerIndisponivelError`
e os dev agents ficam em `dev.blocked_by_container`. O modo **Runner** não
depende dele — ali o agente local usa o Docker da sua máquina.

Desde o [ADR 0162](adr/0162-broker-publicado-e-oferecido-pelo-instalador.md) o
broker é a **quinta imagem publicada** (`ghcr.io/daneiel/brabo-broker`, por
digest, assinada como as outras quatro) e o compose de instalação tem o
serviço — **desligado por padrão**, sob o mesmo profile `container-broker` do
compose de validação. O instalador **pergunta** (*"Ligar o broker de container?
[s/N]"*), logo depois da base de projetos, e diz em texto o que ligá-lo
concede: o broker recebe **o socket do Docker desta máquina**, e quem
comanda o broker comanda o seu Docker. O que o contém são as cinco camadas
do [ADR 0130](adr/0130-broker-de-container.md): nenhuma porta publicada, uma rede
(`internal: true`, sem internet) que só a api alcança, o service token,
cinco operações sobre o container de UM projeto, e uma spec que o broker compõe
a partir do que o Arquiteto decidiu — não há requisição que ligue
`privileged`, rede do host ou um `-v` livre.

| resposta | o que acontece |
|---|---|
| **`s`** / **`sim`** | ele mede o grupo do socket **de dentro de um container** (a própria imagem do broker, sem rede, só leitura, o socket ligado com `--mount` para que um socket ausente seja erro em vez de uma pasta vazia criada no seu host), calcula onde o Docker guarda o volume da pasta gerenciada, e escreve `COMPOSE_PROFILES=container-broker`, `BROKER_URL=http://broker:8090`, `DOCKER_GID` e `PROJECT_WORKSPACES_HOST_ROOT` no `.env` — as quatro juntas |
| Enter, `n`, qualquer outra coisa | desligado. O `.env` não recebe nenhuma das quatro linhas, e o resumo final diz *"Broker de container: DESLIGADO"* |
| sem terminal | desligado, e ele diz isso — nenhuma pergunta é feita onde ninguém pode responder |

**Duas recusas e duas pendências, todas nomeadas:**

- *"não consegui medir o grupo do socket do Docker…"* — a medição falhou
  (Docker rootless ou remoto: o socket não está em `/var/run/docker.sock`,
  que é o caminho que o compose monta). Nada foi escrito. Rode de novo e
  responda **não**, ou corrija o que a mensagem cita do Docker. Ele nunca escreve um
  `999` adivinhado no lugar.
- *"… não é um socket …"* — mesmo desfecho, mesma correção.
- pendência *"a raiz da pasta gerenciada…"* — o
  `<DockerRootDir>/volumes/brabo_project_workspaces/_data` calculado não bateu com o
  `Mountpoint` real do volume depois de a stack subir (ou o `docker info` não
  disse onde os volumes moram). Projetos **Pasta montada** funcionam; projetos **Container**
  não, até você corrigir `PROJECT_WORKSPACES_HOST_ROOT` — a mensagem leva o
  valor que o daemon informou e o comando para recriar o broker.
- pendência *"o broker de container: a api NÃO o alcançou…"* — o serviço subiu
  saudável mas a api não o alcançou na rede interna. `docker
  compose -f docker/docker-compose.install.yml logs broker` diz por quê.

`COMPOSE_PROFILES` no `--env-file` é o que faz o `up -d --wait` subir o
broker sem flag nenhuma na linha de comando — medido no Compose v5.5.1. A
variável da imagem, `BRABO_BROKER_IMAGE`, é escrita **ligando-o você ou
não**: o Compose interpola o arquivo inteiro antes de filtrar por profile, então uma
variável obrigatória num serviço desligado ainda recusa o arquivo.

**Ligando depois** (mesma pasta do `.env`):

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

**Desligando:** remova as quatro linhas do `.env`, depois remova o container do
broker e recrie a api sem `BROKER_URL`:

```bash
docker compose -f docker/docker-compose.install.yml --env-file .env \
  --profile container-broker rm -sf broker
docker compose -f docker/docker-compose.install.yml --env-file .env up -d --wait
```

`up --remove-orphans` **não** faz o primeiro passo — medido: um serviço
sob um profile desligado continua *definido* no arquivo, então o container dele
não é órfão e continua rodando. Nada nos seus projetos é apagado; projetos Container
e Pasta montada param de executar, e a tela do projeto deixa de oferecê-los
([ADR 0161](adr/0161-a-tela-so-oferece-o-modo-que-a-instalacao-executa.md)).

Verificação: ligá-lo **na instalação** está provado — a pergunta e
as recusas dela pelo `scripts/dev/install-broker.spec.ts` em todo PR, e o caminho
inteiro pelo `.github/workflows/install-e2e.yml` em toda tag final, que responde
*sim* e exige o broker ligado, a api o alcançando, e `COMPOSE_PROFILES` e
`BROKER_URL` escritos no `.env`. Ligá-lo **depois** pelos cinco comandos acima, e desligá-lo,
**não têm verificação**: nada os roda, e a ressalva do
`up --remove-orphans` foi medida uma vez à mão.

### Modelos locais numa instalação {#modelos-locais-na-instalacao}

Logo depois do broker, o `install.sh` pergunta `Ligar os modelos locais? [s/N]`
([RN-691](business-rules/produto.md#rn-691)). Ele diz o custo antes — disco para a
imagem do Ollama e os modelos que o `ollama-model-loader` baixa ao iniciar, RAM enquanto um
modelo está carregado — e o que se perde sem eles: a checagem de duplicata semântica
de histórias e regras é pulada, e os agentes não têm modelo local. Só um
"s" digitado os liga; sem terminal eles ficam desligados.

Ligá-los mede a porta do host antes de escrever qualquer coisa: `11434`, ou a
primeira livre até `11443` (um Ollama nativo costuma segurar a `11434`). A faixa
inteira ocupada é uma recusa nomeada sem nada escrito. O `.env` recebe `OLLAMA_PORT`
e `llm` na linha única de `COMPOSE_PROFILES`.

Para ligá-los **depois**, na pasta da instalação: escolha uma porta livre, depois
acrescente `OLLAMA_PORT=<porta>` ao `.env`, acrescente `llm` à linha existente de
`COMPOSE_PROFILES` com uma vírgula (ou crie `COMPOSE_PROFILES=llm`), e rode
`docker compose -f docker/docker-compose.install.yml --env-file .env up -d --wait`.

Verificação: a pergunta, a medição da porta e as linhas do `.env` são
provadas pelo `scripts/dev/install-llm.spec.ts` em todo PR. O E2E da instalação
responde *não* (baixar modelos custaria GBs por tag), então subir com o
profile `llm` **não tem verificação de ponta a ponta**.

### Reinstalando do zero {#reinstalar-do-zero}

Quando uma instalação anterior é encontrada (só conta o projeto compose chamado exatamente
`brabo` — o compose de dev `brabo-dev` não,
[RN-692](business-rules/produto.md#rn-692)), a migração roda o backup, prova o
restore, e então pergunta
`Apagar os volumes e reinstalar? [s = restaurar / z = do zero / N = parar]`.
`z` apaga e reinstala **sem restaurar** os dados antigos; o backup provado
fica na pasta que ele nomeia, e restaurá-lo depois é o
[Restore](#restore). Provado pelo `scripts/dev/install-llm.spec.ts`.

---

## Verificando um artefato publicado {#verificar-artefato-publicado}

Toda tag final assina o que publica, com `cosign` **keyless** — a
identidade que assina é o próprio workflow, e não há chave sob custódia
em lugar nenhum ([ADR 0149](adr/0149-assinatura-dos-artefatos-publicados.md),
[RN-524](business-rules/ci.md#rn-524)). É assim que **você** confere, fora do
CI.

Os dois comandos precisam das duas flags `--certificate-*`. Elas não são
enfeite opcional: sem elas o `cosign` aceitaria uma assinatura válida **de
qualquer um**, que é a falha que todo este mecanismo existe para evitar.

### Uma imagem, por digest {#an-image-by-digest}

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

### Os binários do runner {#the-runner-binaries}

Um `checksums.txt` assinado cobre os quatro alvos (o Mac Intel não tem binário
desde o [ADR 0174](adr/0174-runner-sem-binario-darwin-x64.md) — ele usa
`npm install -g @brabo/runner`), então a verificação tem dois
passos: a assinatura do manifesto, depois o binário contra o manifesto.

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

### Quando a verificação falha {#when-verification-fails}

**Não instale.** Uma assinatura que não verifica tem exatamente duas
leituras — o artefato não é o que a esteira publicou, ou a esteira
não o publicou — e nenhuma é motivo para continuar. Confira se a
regex de identidade casa com o workflow que de fato publicou aquela tag (uma
republicação por `workflow_dispatch` assina com a mesma identidade), e então
trate como incidente e não como ruído.

**O que isto NÃO cobre:** assinatura de código do sistema operacional para os
binários do runner — notarização do macOS e Authenticode do Windows. Essas exigem uma
identidade de assinatura paga e são um item de backlog separado; o sistema ainda vai avisar
na primeira execução.

### A oferta escrita de fonte, dentro de todo artefato publicado {#oferta-de-fonte-na-imagem}

Assinar responde *"isto é o que a esteira publicou?"*. Uma segunda pergunta
viaja com a mesma imagem e tem outra resposta: **onde está a fonte
do software GPL dentro dela?**

A imagem do engine embute `git`, `busybox`, `libgcc`/`libstdc++` e outros 18 pacotes
apk sob GPL, mais os quatro scanners que o engine chama por `exec`.
Rodá-los como processos separados não contamina o Brabo, que continua
MIT — mas *distribuir* a imagem exige que quem a recebe possa obter
a fonte correspondente. Desde o [ADR 0119](adr/0119-imagens-publicadas-no-ghcr-por-digest.md)
essa distribuição acontece em toda tag final.

A oferta escrita é o `THIRD_PARTY_NOTICES.md`, e ele vai **dentro** da
imagem, porque quem roda `docker pull` não tem o repositório:

```bash
docker run --rm --entrypoint sh ghcr.io/daneiel/brabo-engine:vX.Y.Z \
  -c 'cat /usr/share/doc/brabo/THIRD_PARTY_NOTICES.md'
```

Ele nomeia todo componente, a versão exata e a licença, que é o que
permite a qualquer um chegar à release upstream de cada um.

Desde a AT-120 o mesmo arquivo, no mesmo caminho e na mesma forma (dono root,
`0644`, copiado antes do `USER`), vai dentro de **toda** imagem publicada —
`brabo-api`, `brabo-web`, `brabo-broker` e `brabo-backup` além de
`brabo-engine` — e ao lado dos binários do runner como o asset
`THIRD_PARTY_NOTICES.md` da Release, coberto pelo mesmo
`checksums.txt` assinado (RN-524). Essa foi a decisão do mantenedor, e é a
conservadora: nenhum artefato é declarado isento. Troque `brabo-engine` por qualquer
das outras quatro no comando acima. Antes da AT-120 esse comando falhava com
"Permission denied" na imagem do engine: o BuildKit aplica `COPY --chmod=0644`
também ao diretório que o `COPY` cria, então `/usr/share/doc/brabo` não tinha
bit de execução e o usuário não-root da imagem não conseguia atravessá-lo. Cada
Dockerfile agora cria o diretório `0755` antes. Para o runner:

```bash
gh release download vX.Y.Z --repo daneiel/brabo \
  --pattern THIRD_PARTY_NOTICES.md --pattern checksums.txt
sha256sum -c --ignore-missing checksums.txt
```

Se esse arquivo falta num artefato, o artefato não deveria ser
distribuído. O `scripts/ci/oferta-de-fonte-na-imagem.spec.ts` impede que cada `COPY`
e o asset da Release sejam removidos por acidente, e o passo
`A oferta de fonte está dentro das cinco imagens` do `ci.yml` lê o
arquivo de volta de cada imagem que constrói e o compara com o checkout — mas
só uma tag de verdade prova o artefato publicado.

O arquivo também registra o que **não** está resolvido: separar os scanners num
sidecar próprio, deixando a imagem do engine livre de copyleft, segue aberto como
escolha de *arquitetura* e não de conformidade.

---

## Subindo uma imagem de terceiro {#subindo-imagem-de-terceiro}

Toda imagem de terceiro em `docker/` e `deploy/k8s/` é fixada **por
digest**, com a tag de onde veio escrita **dentro da referência**, antes
do digest ([ADR 0159](adr/0159-imagem-de-terceiro-por-digest.md),
[ADR 0178](adr/0178-tag-inline-na-imagem-de-terceiro.md)). Os workflows em
`.github/workflows/` **não** guardam literal de imagem: os `services:` deles leem a
referência do compose de dev pelo `imagens-do-compose.yml`
([ADR 0197](adr/0197-a-imagem-dos-workflows-vem-do-compose.md)), então subir
o compose sobe o CI também:

```yaml
image: neo4j:5.26-community@sha256:d9cfe82983d27f5a75b3aaae8f316d04f9a698a3b7f6103a508f7caf8362f255
```

Um **Dockerfile** toma a mesma forma na linha `FROM` — nunca um comentário no
fim dela: o parser do Docker só aceita `#` no começo da linha, e um
no fim faz o build falhar com *"FROM requires either one or three
arguments"*:

```dockerfile
FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6 AS runtime
```

Isso é um **congelamento**. Desde o ADR 0197 os ecossistemas `docker-compose` (os
composes em `docker/`) e `docker` (as linhas `FROM` em `docker/*/` e os
manifestos em `deploy/k8s/`) do Dependabot propõem a subida toda semana, uma PR agrupada
por ecossistema, na `dev`. Revisar essa PR são os passos 1 e 4 deste procedimento.
Dois casos ainda voltam para cá:

- **`neo4j` e `ollama` moram num compose E em `deploy/k8s/base/`**, e os
  dois ecossistemas nunca dividem uma PR. Quando o registry republica a MESMA tag
  com outro digest, as duas PRs reprovam no lint ("mesma tag inline, dois
  digests"); junte as duas subidas numa PR só com o passo 3 abaixo.
- As duas imagens que nenhum ecossistema lê (abaixo).

Para mover uma à mão — digamos, `neo4j` de `5.26-community` para `5.27-community`:

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

Duas imagens são subidas por este mesmo procedimento, à mão, faça o Dependabot
o que fizer: o `imageName` do CloudNativePG
em `deploy/k8s/overlays/local/db/cluster.yaml` (nenhum ecossistema
lê essa chave) e a imagem do caso de QA do golden-set,
`IMAGEM_DO_GOLDEN_SET_QA` em `apps/api/scripts/golden-set-qa-container.ts`
(uma constante TypeScript, lida pelo `golden-set-qa.yml`).

O passo 3 não é burocracia opcional: a checagem recusa **a mesma tag inline
levando dois digests diferentes**, porque o compose de dev e o cluster
afirmando a mesma versão enquanto rodam bytes diferentes é como um CI verde deixa de
querer dizer alguma coisa. Entre o compose de dev e o CI não há mais nada a alinhar:
o CI lê o compose.

Para dar a um workflow NOVO um serviço de terceiro, nunca escreva a referência no
workflow: acrescente a imagem do serviço em `docker/docker-compose.yml`, uma linha em
`IMAGENS_DOS_WORKFLOWS` em `scripts/ci/imagens-do-compose.ts`, a saída
correspondente em `.github/workflows/imagens-do-compose.yml` (o spec dele reprova se os dois
divergem), e no workflow um job `imagens:` com
`uses: ./.github/workflows/imagens-do-compose.yml` mais
`image: ${{ needs.imagens.outputs.<nome> }}`.

O que a checagem **não** cobre, e por quê, está em
[a cadeia de suprimentos do CI](explanation/cadeia-de-suprimentos-do-ci.md#container-images-digest-with-the-tag-alongside):
as cinco imagens que o produto publica já estão resolvidas por digest pelo
`.release/images.json` e pelo `make imagens-do-release`
([ADR 0119](adr/0119-imagens-publicadas-no-ghcr-por-digest.md)) — nunca fixe
essas à mão no overlay, que deliberadamente guarda o marcador.

---

## Acrescentando um provider compatível {#adicionando-um-provider-compativel}

Vale para qualquer provider que fale o dialeto `/chat/completions` da OpenAI —
que é o caso de praticamente todo hub e todo serviço de inferência
gerenciado. A base já existe
([ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md));
o que você escreve é **configuração**, não parsing.

### 1. Leia a doc oficial antes de escrever a primeira linha {#1-read-the-official-doc-before-writing-the-first-line}

Quatro coisas precisam vir da documentação do provider, não de palpite:
`baseUrl`, o cabeçalho de auth, o formato do `usage` no stream, e as
peculiaridades do streaming. Registre a URL consultada e a data no topo do
arquivo de config — é o único jeito de saber, meses depois, se a config
está velha.

O que diverge do padrão da OpenAI vira uma **flag na base**,
nunca um `if` espalhado. Se a divergência não cabe numa flag
existente, acrescente uma — e só porque este provider real precisa.

### 2. Escreva a config {#2-write-the-config}

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

Exporte a função de config, não só a classe: é para ela que a suíte de
contrato aponta o servidor falso. Uma cópia da config escrita dentro do
teste passaria verde mesmo se a de produção divergisse.

### 3. Rode a suíte de contrato contra ele {#3-run-the-contract-suite-against-it}

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

Herdado de graça: streaming com frame partido, usage presente e
ausente, tool calling, os quatro erros normalizados, o catálogo, e um
servidor mudo.

### 4. Registre o provider e o tipo de credencial {#4-register-the-provider-and-the-credential-kind}

1. **dois lugares, de propósito**: o tipo `LLMProviderName` em
   `packages/shared/src/index.ts` (o web o usa também) e a lista de
   runtime `LLM_PROVIDER_NAMES` em
   `apps/api/src/domain/llm/llm-provider-names.ts`. Eles não podem morar
   juntos: `packages/shared` é 100% tipos — um valor exportado de
   lá quebra a imagem de produção da api no boot com
   `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, e
   `apps/api/test/packages-shared-so-tipos.spec.ts` reprova antes de
   chegar lá. Esquecer a lista não passa em silêncio: a checagem de
   exaustividade nos dois sentidos quebra o typecheck, assim como o `Record`
   exaustivo `ROTULO_DO_PROVIDER` do web quebra até o provider
   ganhar um rótulo;
2. se for um hub, acrescente o nome a `HUBS` em `apps/web/src/lib/models.ts`
   para ele cair no grupo certo do seletor;
3. o registro de providers da api (`llm-infrastructure.module.ts`);
4. o `pgEnum` do provider no schema mais uma migration, se o nome é
   novo.

### 5. Semeie os modelos com o preço da doc {#5-seed-the-models-with-the-price-from-the-docs}

Um preço digitado vem com `manual_pricing: true`. Isso protege a linha
da sincronização de preço: para um provider que não expõe preço no
catálogo, o número manual é o único que existe.

Se o provider expõe `GET /models`, **não semeie o catálogo inteiro** —
deixe a sincronização descobri-lo. Ela escreve os modelos desabilitados, e
o owner habilita o que importa pela tela de curadoria
([RN-043](business-rules/api.md#rn-043)).

Se o catálogo do provider publica **modalidade** (aceita imagem, gera
imagem) ou `reasoning`, emita-as no `parseCatalogo` dele — e só quando
a doc oficial diz. Um campo que o provider não declara fica
**omitido**, nunca `false`: `undefined` preserva o que já estava
gravado, e `false` apagaria dado curado à mão
([RN-056](business-rules/api.md#rn-056)).

### 6. Verifique com uma credencial real {#6-verify-with-a-real-credential}

```bash
# na página Providers (rodapé do menu): cadastre a credencial, depois
# "Atualizar catálogo" e confira o relatório por provider.
```

O relatório mostra **todo** provider, inclusive os pulados, com o
motivo e a origem da falha. `sem_credencial` quer dizer que a chave
nunca chegou; `falha · origem infra` quer dizer que nem chegou ao
provider; `falha · origem modelo` quer dizer que ele respondeu com uma recusa.

Verificação: os passos 2–4 são provados em todo PR — a suíte de contrato
(`apps/api/test/contract/llm-provider.contract.ts`, rodada pelo
`*.contract.spec.ts` de cada provider) contra um servidor falso, e o typecheck que quebra quando
falta um nome em qualquer das listas. O passo 6 é **manual por natureza**: ele precisa de uma
credencial real com crédito, que o CI não tem. Os arquivos `*.smoke.spec.ts` por
provider são a forma roteirizada dele, e pulam sem uma
chave — o ambiente tem credencial só para o OpenRouter (veja o
`TODO(humano)` sobre os smokes de LLM no `CLAUDE.md`).

---

## Procedimentos e como cada um é verificado {#procedimentos-e-verificacao}

Todo procedimento de **operação** desta página, com o arquivo que o prova e
o que roda essa prova. Seções de diagnóstico (o que fazer quando algo parece
errado) e as seções do ambiente de desenvolvimento não estão aqui: são jeitos de
achar uma causa, não procedimentos que podem passar ou reprovar.

- **verification** nomeia o spec, script, workflow ou alvo `make` que
  prova o procedimento, ou começa com **None** e diz isso. Uma prova parcial
  nomeia o que cobre e o que não cobre.
- **schedule** diz o que o roda sem ninguém lembrar: um workflow agendado
  (`weekly`), todo pull request (`every PR`), toda tag final
  (`every tag`), ou `manual` — alguém tem de lembrar.

Os cabeçalhos da tabela e as palavras de classe da coluna **schedule** ficam em inglês
de propósito: são vocabulário de máquina, que o `pnpm docs:check` lê. Ele lê esta tabela e reprova quando um arquivo em **verification**
não está no repositório, um alvo `make` não está no `Makefile`, uma célula está
vazia ou diz "ver abaixo", uma âncora não é cabeçalho desta página, ou um
workflow em **schedule** não tem o gatilho que a célula afirma
(`schedule:` para `weekly`, `pull_request` para `every PR`, `push: tags` para
`every tag`). Como funciona está em
[Como a documentação continua viva](explanation/documentation-workflow.md#the-runbook-procedures-table).

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
