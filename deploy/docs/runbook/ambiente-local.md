---
id: runbook-ambiente-local
title: Ambiente local e de dev
sidebar_label: Ambiente local e de dev
tipo: guia
description: Broker, pasta montada, runner, agente de máquina, reset total e brabo-dev.
---

# Ambiente local e de dev

Parte do [Runbook operacional](../runbook.md). Comece pela triagem do índice.

## O broker de containers {#broker-de-container}

O broker ([ADR 0130](../adr/0130-broker-de-container.md)) é o único processo do
produto que fala com um daemon do Docker, e o único serviço com
`/var/run/docker.sock` montado. **Não monte esse socket em nenhum outro lugar.**

**Localmente ele sobe com `make dev`; em produção, não.** Essa
assimetria é uma decisão ([ADR 0146](../adr/0146-base-consentida-no-bootstrap.md),
ponto 3), não um descuido — não "uniformize" os dois arquivos de compose. Quem
roda `make dev` **já tem o socket do Docker** (está rodando
`docker compose` contra o daemon do próprio host), então o broker recebê-lo
não concede nada que o operador já não tenha. Em produção o socket é uma
fronteira de privilégio de verdade e o operador não é o desenvolvedor, então ali ele
fica sob `profiles: ["container-broker"]`.

Até essa decisão o broker vinha desligado por padrão nos dois arquivos, com o
argumento de que "nada o chama ainda". Isso deixou de ser verdade: ele tem quatro chamadores reais
([ADR 0133](../adr/0133-infra-elege-imagem-do-roteamento.md)/
[0136](../adr/0136-pagina-global-de-containers.md)), e o
[ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md) fez o modo **Pasta montada** subir o
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
([RN-599](../business-rules/infra.md#rn-599)). Antes desse default, a api respondia
`brokerConfigurado: false` ao lado de um broker saudável e a criação de projeto só
oferecia `runner`. Um valor no `.env` continua vencendo; os composes de produção e de
instalação não têm default, de propósito.

O container do projeto roda como o **dono da pasta do projeto** ([ADR 0180](../adr/0180-container-com-o-dono-da-pasta.md), [RN-627](../business-rules/contracts.md#rn-627)): a api lê o uid e o gid da pasta e o broker o inicia com `--user <uid>:<gid>` e `HOME=/tmp`. É isso que deixa um dev agent escrever em `/work` sob `--cap-drop ALL`. Duas coisas a saber quando não funciona: uma pasta de root, ilegível ou ausente cai no comportamento anterior (root dentro do container, sem escrita numa pasta de outro uid — `npm install` responde `EACCES`); e um container que já existe só muda quando é recriado (`container_remove`, depois `container_start`).

`make dev` também **informa** a pasta gerenciada a cada execução (RN-599): com
`PROJECT_WORKSPACES_HOST_DIR` não definida, `api`/`engine` usam o volume gerenciado, o
broker não recebe `PROJECT_WORKSPACES_HOST_ROOT`, e `container_start` termina
recusado — com a stack saudável. Ele informa também um `~` no caminho (o Compose
o expande no bind mount, não na variável do broker) e um
`PROJECT_WORKSPACES_HOST_ROOT` explícito que difere da pasta que a api monta.
Como o aviso do gid, ele nunca bloqueia e nunca escreve no `.env`; trocar o
volume por uma pasta não migra o conteúdo do volume — veja
[migrar workspaces](#migrar-workspaces-pasta-local).

`make dev` **informa** o estado de `DOCKER_GID` a cada execução
([RN-512](../business-rules/infra.md#rn-512)), comparando-o com o grupo real da sua
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
[o broker numa instalação](instalacao.md#broker-na-instalacao)
([ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)).

**O broker tem DUAS raízes, e nenhuma faz as vezes da outra**
([RN-503](../business-rules/api.md#rn-503),
[ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md)).
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
| a rota do ciclo de vida diz `naoObservado: "broker-nao-configurado"` | `BROKER_URL` está vazia na **api**. É um estado normal, não uma falha — a leitura declara que não olhou em vez de herdar o estado registrado ([RN-486](../business-rules/api.md#rn-486)) |
| a rota do ciclo de vida diz `naoObservado: "broker-sem-resposta"` | `BROKER_URL` está definida e nada respondeu: o profile provavelmente está desligado, ou a api não está na rede `broker`. Se `detalhe` diz ``não respondeu `inspect` dentro do teto desta operação (5000ms)``, o broker É alcançável e está lento — olhe o daemon, não a rede ([RN-604](../business-rules/api.md#rn-604)) |
| um comando de terminal ou `container_start` falha com ``não respondeu `exec` dentro do teto desta operação`` (ou `start`/`stop`/`remove`) | a api parou de esperar no teto próprio daquela operação, não porque o broker está fora do ar ([RN-604](../business-rules/api.md#rn-604)). No `exec` o comando pode ainda estar rodando dentro do container; no `start`/`stop`/`remove` o efeito pode ter acontecido — confira `/containers` antes de repetir. Um `start` cujo pull de imagem leva mais de 30s é cortado pelo próprio broker — esse tem linha própria abaixo |
| o resultado de terminal de um dev agent diz ``o comando passou do teto de execução de terminal (120s, TERMINAL_ACTION_TIMEOUT_MS)`` | o comando rodou mais que `TERMINAL_ACTION_TIMEOUT_MS` (default de 120 s desde a [RN-757](../business-rules/engine.md#rn-757); era 15 s) e o engine parou de esperar; o processo pode ainda estar rodando no container. O agente é orientado a rodá-lo de novo sob `nohup … &`. Subir a variável é possível, mas acima de ~180 s a espera externa do engine (valor + 120 s) passa do limite de 300 s de cabeçalhos do `fetch` do Node da api e o corte volta |
| `container_start` falha com ``o `docker pull <imagem>` não terminou dentro do teto de 30000ms e foi cancelado`` (o broker responde `504`, `origem: infra`) | a imagem não está no daemon e o pull dela não cabe no teto de controle de 30s. Matar o CLI cancela o pull, então a imagem continua ausente — repetir não ajuda. Faça o pull no host que roda os containers (`docker pull <imagem>`; no modo `runner`, na máquina do usuário) e aprove o start de novo. Imagens grandes não sobem por este caminho na primeira tentativa, por decisão do mantenedor ([RN-605](../business-rules/contracts.md#rn-605)) |
| `BRABO_PROJECTS_HOST_BASE não está definida` no `start` de um projeto **Pasta montada** | mesma forma da linha acima, outra raiz. Defina `BRABO_PROJECTS_BASE` no `.env` e recrie o broker; o compose deriva esta dela ([RN-503](../business-rules/api.md#rn-503)) |
| o broker responde `409` para um projeto em modo `runner` | esperado. Aquela pasta mora na máquina do usuário e este host não a enxerga — lá, quem sobe container é o runner ([ADR 0137](../adr/0137-o-runner-sobe-o-container-do-projeto.md)) |
| o broker responde `409` dizendo que não sabe onde está a pasta do projeto | um projeto **Pasta montada** LEGADO, criado antes de a base existir e morando fora dela. A correção é mover a pasta para dentro de `BRABO_PROJECTS_BASE`, não mudar o modo do projeto — a mensagem nomeia a base e o caminho que viu ([RN-503](../business-rules/api.md#rn-503)) |

**O broker nunca sobe um container sozinho.** Não há laço nem
fila: ele age quando chamado, e toda chamada de escrita nasce de uma
`proposed_action` que um humano aprovou.

## Migrar workspaces para pasta local {#migrar-workspaces-pasta-local}

Definir `PROJECT_WORKSPACES_HOST_DIR`/`GIT_LOCAL_REPOS_HOST_DIR`
([Primeiros passos](../getting-started.md#local-folder-for-workspaces)) troca o
volume do Docker pela pasta indicada — mas **não copia** o que já
existia no volume antigo. Quem já tem projetos criados e não
quer perder o trabalho precisa copiar o conteúdo antes de trocar:

```bash
docker compose -f docker/docker-compose.yml --env-file .env down   # nunca com -v
docker run --rm \
  -v brabo-dev_project_workspaces:/de \
  -v "$(realpath ~/brabo-projetos)":/para \
  alpine sh -c 'cp -a /de/. /para/'
docker run --rm \
  -v brabo-dev_git_local_repos:/de \
  -v "$(realpath ~/brabo-projetos-bare)":/para \
  alpine sh -c 'cp -a /de/. /para/'
# defina as duas variáveis no .env, depois:
make dev
```

O nome do volume (`brabo-dev_project_workspaces`) leva o prefixo do projeto
Compose (`name: brabo-dev` em `docker/docker-compose.yml`, [ADR
0170](../adr/0170-compose-de-dev-brabo-dev.md)) — confira com `docker volume ls`.
Um ambiente de dev de antes do ADR 0170 ainda tem os dados sob `brabo_*`: veja
[Levando um ambiente de dev para brabo-dev](#dev-para-brabo-dev) antes. O volume antigo continua existindo
depois (o Compose não apaga um volume que saiu de uso); remova-o
com `docker volume rm` quando tiver certeza de que a cópia funcionou.

## Projeto no modo Pasta montada: a base de projetos {#projeto-no-modo-local}

**Sintoma:** o assistente de projeto nem oferece **Pasta montada**; ou
oferece, e a api responde `400` dizendo que a pasta *não existe de
dentro da api*.

Os dois vêm do mesmo fato: um projeto no modo Pasta montada guarda o código numa
pasta **sua**, e a api e o engine só a alcançam se ela estiver
montada nos containers deles. O que mudou
([ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md),
[RN-500](../business-rules/api.md#rn-500)) é quem arranja isso, e com que frequência:
agora há **uma base**, configurada uma vez pelo operador, e todo
projeto montado mora dentro dela. Você nunca mais edita o compose por
projeto.

**O que fazer — uma vez, para a instalação inteira.** O caminho suportado é o
passo de consentimento ([ADR 0146](../adr/0146-base-consentida-no-bootstrap.md)), que
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
([ADR 0142](../adr/0142-validacao-de-workspace-montado-adiada.md),
[RN-501](../business-rules/api.md#rn-501)). Criar um projeto Pasta montada valida
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
([RN-503](../business-rules/api.md#rn-503),
[ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md)). Como a base é
alcançável pelo daemon do Docker do host, `container_start` de um projeto Pasta montada
vai para o [broker](#broker-de-container), exatamente como o modo Container — ele
deixou de exigir um `brabo-runner` conectado. Só o modo **Runner** ainda vai para
o runner, na própria máquina do usuário, porque aquela pasta está num lugar que este
servidor não enxerga. Localmente o broker já está de pé — ele vem com o `make dev`
desde o [ADR 0146](../adr/0146-base-consentida-no-bootstrap.md), justamente porque
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
([RN-169](../business-rules/api.md#rn-169)); é também a string
que a tela mostra de volta para você. Montá-la em outro lugar faria o
engine escrever onde a api não lê, e faria a tela mostrar um
caminho que não existe nem na sua máquina nem na deles.

**Confira o que os containers de fato enxergam:**

```bash
docker compose -f docker/docker-compose.yml exec api    ls -la /home/voce/brabo
docker compose -f docker/docker-compose.yml exec engine ls -la /home/voce/brabo
```

**Não aponte a base para o próprio checkout do Brabo.** `make dev` recusa
subir a stack quando `BRABO_PROJECTS_BASE` contém, ou está contida em,
o repositório que você clonou — ele nomeia os dois caminhos e para. Essa checagem mora
no preflight e em nenhum outro lugar de propósito: a api compara um caminho de projeto
com `process.cwd()`, que dentro do container dela é `/workspace`,
então ela não tem como enxergar o seu checkout real. Sem a guarda do preflight,
clonar o Brabo em `$HOME/brabo` e definir a base para a mesma pasta
passa em toda validação e põe dev agents rodando dentro da própria
árvore do produto — a falha que o
[ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) existe para
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
| *o processo não consegue escrever nela* | dono/permissão da pasta no host. As imagens rodam não-root ([ADR 0024](../adr/0024-fase5-imagens-producao-ci.md)); ajuste o dono ou o modo da pasta |
| *Caminho inválido para um projeto Local* | é a raiz de um sistema de arquivos, uma pasta de sistema, relativo, tem `..`, ou se sobrepõe ao próprio checkout do Brabo — escolha uma pasta sua, fora desses ([ADR 0072](../adr/0072-projeto-local-ou-container.md)) |

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
nunca é a mesma pasta que essa raiz ([ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md)
explica por que confundi-las deixaria dois projetos caírem numa pasta só).

## A base de projetos do runner {#base-do-runner}

**Sintoma:** `brabo-runner` sai com código 2 dizendo
`base de projetos recusada (…)`, ou começa imprimindo
`base de projetos: nenhuma configurada` quando você esperava uma base, ou diz
que está `Seguindo SEM base`.

Esta é uma **base diferente** da de
[Projeto no modo Pasta montada](#projeto-no-modo-local). Aquela
(`BRABO_PROJECTS_BASE`) pertence ao SERVIDOR e é a única pasta que os
containers enxergam; esta pertence à **máquina do usuário** e é onde
o agente local cria a pasta de cada projeto
([ADR 0151](../adr/0151-base-consentida-no-runner.md),
[RN-529](../business-rules/runner.md#rn-529)). Elas nunca são a mesma variável, nunca
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
[RN-551](../business-rules/runner.md#rn-551) é também onde
`brabo-runner device-key create` põe a chave de dispositivo **privada** da máquina
(`brabo-runner-device-key.jwk.json`, modo 600) — veja
[Chave de dispositivo pelo terminal](#chave-de-dispositivo-pelo-terminal). Faça backup
dela como faria de um segredo, ou não faça backup nenhum e pareie de novo: a chave
é revogável e substituível, e nada mais no produto consegue lê-la.

**Recusas, e por que a disposição difere.** A base é recusada quando é
relativa, tem `..`, é `/`, aponta para um arquivo existente, fica fora do `$HOME`
no Linux (a mesma regra que o `--dir` tem desde a
[RN-434](../business-rules/runner.md#rn-434)), ou fica **dentro** da pasta do projeto
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

## O agente de máquina: uma conexão por projeto {#agente-de-maquina}

**Sintoma:** `brabo-runner` foi iniciado sem `--project` e ou imprimiu
o bloco de uso, ou disse `nenhum projeto em modo "runner" para esta conta`, ou
atendeu alguns projetos e recusou outros.

Desde a [RN-544](../business-rules/runner.md#rn-544)
([ADR 0154](../adr/0154-chave-de-dispositivo-de-maquina.md)) rodar sem
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
  [RN-550](../business-rules/runner.md#rn-550) o processo **fica de pé e continua perguntando**:
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

## A unit está `bad-setting` e nunca inicia {#unit-do-agente-nao-inicia}

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
(por projeto e por máquina igualmente, [RN-518](../business-rules/runner.md#rn-518) e
[RN-545](../business-rules/runner.md#rn-545)).

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

## Chave de dispositivo pelo terminal {#chave-de-dispositivo-pelo-terminal}

**Sintoma:** uma máquina precisa de uma chave de dispositivo e não há navegador para rodar a
configuração automática da tela do projeto — uma instalação nova, uma máquina sem tela, ou o
agente de máquina acima recusando com `esta credencial está presa a um PROJETO`.

Desde a [RN-551](../business-rules/runner.md#rn-551)
([ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) ponto 4) o par
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
  ([RN-475](../business-rules/web.md#rn-475)) e só existe depois que a metade pública é
  registrada; uma chave privada escrita antes dele é inútil e o CLI a recusa
  para sempre. Então `create` escreve `brabo-runner-device-key.jwk.json.parcial`, um
  nome que o leitor ignora, e `finish` escreve o de verdade. **O arquivo que o
  runner lê nunca existe sem `kid`** — uma interrupção entre os dois
  deixa um `.parcial` que o runner ignora e que o próximo `create` nomeia.
- **Onde:** `$XDG_CONFIG_HOME/brabo/` (senão `~/.config/brabo/`), ao lado de
  `runner.json`, no modo 600; `--dir <pasta>` escreve em outro lugar (uma pasta de
  projeto, digamos). Essa pasta é para onde o `--dir` da unit de máquina deve apontar
  (`brabo-runner service install --machine --dir <pasta>`,
  [RN-545](../business-rules/runner.md#rn-545)) — o runner lê a chave da
  pasta em que RODA, nunca de um caminho global que ele adivinhe.
- **stdout é para scripts, stderr é para pessoas.** `create` imprime só a
  JWK pública; `finish`, só o caminho do arquivo terminado.
- **Recusas:** `finish` sem um `create` (nada a carimbar), sem `--id`,
  com um `--id` que ainda tem a resposta JSON inteira dentro, um `.parcial`
  que não é uma JWK privada Ed25519, e — nos dois comandos — uma chave COMPLETA
  já no lugar. Essa última não tem `--force`: substituir a chave de uma
  máquina já pareada em silêncio deixaria um agente assinando com uma chave que o
  servidor não conhece. Revogue a chave atual
  ([RN-519](../business-rules/api.md#rn-519)), apague o arquivo, depois `create` de novo.
- O CLI **não** afirma de que espécie é a chave. Em disco uma chave de máquina
  e uma chave de projeto são o mesmo arquivo; quem decide é a rota que registrou a metade
  pública.

## Quando o instalador não fecha a instalação {#instalador-nao-fecha}

**Sintoma:** o `install.sh` terminou com um bloco **"O que ficou pendente"**, ou uma
instalação nova tem um login pelo qual ninguém consegue passar, nenhuma chave de dispositivo de máquina, ou nenhum
serviço do agente rodando.

Desde a [RN-547](../business-rules/produto.md#rn-547)
([ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md)) o instalador
**fecha** a instalação: ele cria a primeira conta, registra a chave de dispositivo desta
máquina e instala a unit de máquina. A corrente é

1. `POST /internal/first-account` ([RN-546](../business-rules/produto.md#rn-546)) — a
   conta nasce **já verificada**, porque `MAIL_TRANSPORT` é `log` e
   o instalador não liga SMTP;
2. `brabo-runner device-key create` ([RN-551](../business-rules/runner.md#rn-551)) — o
   par Ed25519 é gerado **na máquina**; só a metade pública viaja;
3. `POST /internal/machine-device-keys` ([RN-552](../business-rules/api.md#rn-552)) —
   o `id` devolvido é o que vira o `kid` da JWK privada
   ([RN-475](../business-rules/web.md#rn-475));
4. `brabo-runner device-key finish --id <id>`;
5. `brabo-runner service install --machine` ([RN-545](../business-rules/runner.md#rn-545)).

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
  migração ([RN-530](../business-rules/infra.md#rn-530)) cujo restore trouxe os
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
  nome; veja [Instalando](instalacao.md#instalando).

- **O agente está de pé mas não atende nada.** É o estado normal de uma instalação
  nova: ele espera e consulta de novo até o primeiro projeto no modo `runner` existir
  ([RN-550](../business-rules/runner.md#rn-550)). Veja
  [O agente de máquina](#agente-de-maquina).

## A pasta do projeto nunca aparece na máquina do usuário {#pasta-do-projeto-nunca-aparece}

**Sintoma:** esperava-se que uma pasta de projeto aparecesse sob a base do runner
e ela não apareceu. O log do engine tem uma linha começando com
`workspace_create: o projeto <id> não criou pasta —`, e a pasta está
ausente.

A mensagem nomeia qual das duas pré-condições falhou
([RN-532](../business-rules/runner.md#rn-532),
[ADR 0151](../adr/0151-base-consentida-no-runner.md) pontos 3 a 6), e elas são
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

## Clone autenticado no modo Runner é recusado enquanto o container está de pé {#credencial-nao-atravessa-o-container}

**Sintoma:** um dev agent num projeto `runner` fica bloqueado preparando o
worktree, e o diagnóstico diz que a credencial não pôde ser entregue, nomeando
`credencial-nao-atravessa-o-container`. A origem da tarefa bloqueada é
`politica`, não `codigo`.

**Isto não é um bug a caçar, e é exatamente isso que a origem está dizendo
a você** ([RN-558](../business-rules/runner.md#rn-558)). A credencial de um remoto
autenticado (`ADR 0056`) só consegue viajar no campo `env` da mensagem `exec`,
e esse campo vale só para o caminho do **host**: a porta do Docker do produto não tem
campo `env`, deliberadamente ([ADR 0130](../adr/0130-broker-de-container.md), sem
`-e` livre). Quando o runner subiu o container do projeto, ele roteia
todo comando para dentro dele — então a credencial não tem para onde ir.

Antes da RN-558 o comando rodava assim mesmo, com as variáveis vazias, e você via uma
falha de autenticação comum. Agora ele é recusado antes de executar, e nada
roda. A recusa nunca imprime nomes nem valores de variáveis, só a contagem.

**Desde o [ADR 0193](../adr/0193-git-credenciado-no-host-do-runner.md)
([RN-676](../business-rules/runner.md#rn-676)) esta recusa não acontece mais no
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

## Os containers de dev escrevem como o seu usuário, não como root {#dev-containers-nao-root}

**Sintoma:** algo que o container de dev `api`, `web` ou `engine` escreveu num
bind mount — `apps/api/dist`, `node_modules`, um arquivo que um agente gerou
dentro de um projeto no modo de execução `mounted` — pertence a `root` no seu
disco, e editá-lo ou apagá-lo sem `sudo` falha.

Isso era esperado: as imagens de dev (`docker/api/Dockerfile`,
`docker/web/Dockerfile`, `docker/engine/Dockerfile` — ao contrário do `Dockerfile.prod`,
já não-root desde o [ADR 0024](../adr/0024-fase5-imagens-producao-ci.md)) não tinham
diretiva `USER` e rodavam como root. Agora elas rodam com o **mesmo UID/GID do
seu usuário do host**, via os build args `DEV_UID`/`DEV_GID`
([Configuração](../reference/configuration.md#dev-container-user-build-time)),
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
   mudar isso. `make dev` roda `scripts/dev/preflight.mjs`, que os cria
   como você antes; `docker compose up` rodado à mão o pula, então rode
   `node scripts/dev/preflight.mjs` uma vez antes do seu primeiro `up` à mão.
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

## Reset total do ambiente de dev {#reset-total}

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

0. **A guarda da instalação** ([ADR 0170](../adr/0170-compose-de-dev-brabo-dev.md)),
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

## Levando um ambiente de dev para brabo-dev {#dev-para-brabo-dev}

Desde o [ADR 0170](../adr/0170-compose-de-dev-brabo-dev.md) o compose de dev
(`docker/docker-compose.yml`) é o projeto Docker **`brabo-dev`**: containers
`brabo-dev-api-1`, `brabo-dev-postgres-1`…, volumes `brabo-dev_pgdata`,
`brabo-dev_neo4j_data`…, rede `brabo-dev_default`. O compose de instalação
(`docker-compose.install.yml`) continua **`brabo`**, e as instalações
já existentes também. Antes, os dois eram `brabo` — um projeto Docker: subir um
por cima do outro recriava os containers e os ligava ao banco do outro
(medido em 2026-09-19: o banco de uma instalação recebeu uma migration de
dev), e o `reset-total.sh` teria apagado os schemas da instalação.

**O que muda para você se já desenvolvia aqui:** o próximo `make dev`
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
make dev
```

`cp -a` mantém donos e modos, o que importa para o `pgdata` (a imagem do Postgres
recusa um diretório de dados de que não é dona) e para os dois volumes de dados (veja
[Os containers de dev escrevem como o seu usuário](#dev-containers-nao-root) acima). O Postgres tem de estar **parado**
enquanto o diretório dele é copiado — é para isso que serve o passo 1.

**Caminho B — começar do zero:** só rode `make dev`, depois
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

## Ligando o acesso rápido na instalação local (TP-01) {#acesso-rapido-local}

O acesso rápido por papel (ADR 0245, RN-984) só existe em imagem construída
nesta máquina, nunca nas das Actions. Para a instalação local do TP-01
(`~/brabo-v7`):

1. No checkout da `dev`: `AMBIENTE=local docker buildx bake` (ou os
   `docker build` com `--build-arg BRABO_AMBIENTE=local` na api e
   `--build-arg VITE_BRABO_AMBIENTE=local` no web).
2. No `.env` da instalação: `BRABO_AMBIENTE=local` e `BRABO_BIND=127.0.0.1`
   (sem o bind, a porta fica aberta na rede e qualquer um entra como owner).
   O bind prende a api, o web e o engine; o Ollama e o neo4j ficam sempre em
   `127.0.0.1` (AT-811, RN-1057).
3. Copie o `docker/docker-compose.install.yml` novo para a pasta da
   instalação (o de lá é cópia).
4. `docker compose up -d`. A tela de login mostra o botão "Acesso rápido"; as
   contas `<papel>@brabo.dev` ficam num workspace próprio. A instalação precisa
   já ter a primeira conta (sem usuário a rota responde 409).

Para desligar: reconstrua sem `AMBIENTE` e tire `BRABO_AMBIENTE` do `.env`.
O `install.sh` não liga o `local`.

