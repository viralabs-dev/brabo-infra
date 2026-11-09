---
id: runbook-instalacao
title: Instalação e artefatos
sidebar_label: Instalação e artefatos
tipo: guia
description: Instalador, verificação de artefato, imagem de terceiro e provider compatível.
---

# Instalação e artefatos

Parte do [Runbook operacional](../runbook.md). Comece pela triagem do índice.

## Instalando {#instalando}

```sh
curl -fsSLO https://github.com/viralabs-dev/brabo/releases/latest/download/install.sh && bash install.sh
```

**Baixe um arquivo, depois rode-o com `bash`.** As duas formas mais curtas que parecem
equivalentes não são, e o script recusa as duas **pelo nome**, antes de
baixar qualquer coisa, imprimindo a linha acima:

- **Nunca `curl … | sh`.** O motivo é mecânico, não de estilo: com o
  script chegando pelo pipe, o `stdin` do processo **é** o download,
  então qualquer `read` lê bytes do próprio script ou bate em EOF. Um instalador que
  não consegue perguntar teria de escolher sozinho os locais das pastas na máquina de outra pessoa
  ([RN-526](../business-rules/produto.md#rn-526)).
- **Nem `sh -c "$(curl …)"`** — esta foi a forma documentada até a
  AT-083, e nunca funcionou. O script confere **o próprio hash** contra o
  manifesto assinado, e sob `X -c "…"` não há arquivo para calcular hash: `$0` é o
  nome do shell. Com `dash` como `sh` (Debian, Ubuntu) ele morria ainda antes, no
  `set -o pipefail`. Não há chave para pular essa autoverificação, e não
  haverá ([ADR 0150](../adr/0150-instalador-de-uma-linha.md)) — a correção é
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
([RN-570](../business-rules/produto.md#rn-570),
[ADR 0160](../adr/0160-o-compose-do-instalador-viaja-assinado.md)). Quatro arquivos
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
> lacuna que a [RN-549](../business-rules/ci.md#rn-549) mediu). Para essas tags, rode o
> instalador a partir de um checkout do repositório na tag que você está instalando.

> No caminho de *migração* a prova de restauração (`test-restore-compose.sh`) recebe o
> `.env` da instalação por `BRABO_ENV_FILE` (passado ao Compose como
> `--env-file`), porque o Compose procura o `.env` ao lado do arquivo de compose — não
> no diretório de onde você roda. Se você rodar a prova à mão contra uma
> instalação, exporte `BRABO_ENV_FILE=/caminho/para/.env` antes; um caminho que não
> existe é recusado, nunca substituído por outro arquivo. Uma prova que falha ainda
> não apaga nada ([RN-530](../business-rules/infra.md#rn-530)).

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
([RN-531](../business-rules/produto.md#rn-531)) — e pergunta UMA base, escrevendo-a nos
dois lados: `BRABO_PROJECTS_BASE` no `.env` e `base` no
`runner.json` do runner. Uma Release sem binário para esta plataforma não interrompe
a instalação: ela diz isso e aponta para abrir uma issue em
`https://github.com/viralabs-dev/brabo-runner/issues` (o runner sai só como binário, AT-774).

Sobre uma instalação existente ele **migra ou para** — um `up` em volumes
de outra versão é dano que não avisa. A ordem é backup →
**PROVAR** que restaura → perguntar → apagar → instalar → restaurar, e a prova no
meio é o que dá ao instalador o direito de apagar
([RN-530](../business-rules/infra.md#rn-530)).

E ele sabe **qual** versão está substituindo ([RN-542](../business-rules/produto.md#rn-542)).
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
> agente local ele **pareia**, desde a [RN-547](../business-rules/produto.md#rn-547): ele
> cria a primeira conta, gera a chave de dispositivo de máquina na máquina,
> registra a metade pública, carimba o `kid` e instala a unit de **máquina**
> ([ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md)) — e quando um
> elo falha ele nomeia o comando a repetir, veja
> [Quando o instalador não fecha a instalação](ambiente-local.md#instalador-nao-fecha).
> O que fica na tela do projeto é um pareamento **preso a um projeto**: essa chave de
> dispositivo e o `brabo-runner.config.json` ainda vêm de lá
> ([ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)).
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
([ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md)). Sem ele nenhum dos modos
jamais executa: `container_start` termina `failed` com `BrokerIndisponivelError`
e os dev agents ficam em `dev.blocked_by_container`. O modo **Runner** não
depende dele — ali o agente local usa o Docker da sua máquina.

Desde o [ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md) o
broker é a **quinta imagem publicada** (`ghcr.io/viralabs-dev/brabo-broker`, por
digest, assinada como as outras quatro) e o compose de instalação tem o
serviço — **desligado por padrão**, sob o mesmo profile `container-broker` do
compose de validação. O instalador **pergunta** (*"Ligar o broker de container?
[s/N]"*), logo depois da base de projetos, e diz em texto o que ligá-lo
concede: o broker recebe **o socket do Docker desta máquina**, e quem
comanda o broker comanda o seu Docker. O que o contém são as cinco camadas
do [ADR 0130](../adr/0130-broker-de-container.md): nenhuma porta publicada, uma rede
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
([ADR 0161](../adr/0161-a-tela-so-oferece-o-modo-que-a-instalacao-executa.md)).

Verificação: ligá-lo **na instalação** está provado — a pergunta e
as recusas dela pelo `scripts/dev/install-broker.spec.ts` em todo PR, e o caminho
inteiro pelo `.github/workflows/install-e2e.yml` em toda tag final, que responde
*sim* e exige o broker ligado, a api o alcançando, e `COMPOSE_PROFILES` e
`BROKER_URL` escritos no `.env`. Ligá-lo **depois** pelos cinco comandos acima, e desligá-lo,
**não têm verificação**: nada os roda, e a ressalva do
`up --remove-orphans` foi medida uma vez à mão.

### Modelos locais numa instalação {#modelos-locais-na-instalacao}

Logo depois do broker, o `install.sh` pergunta `Ligar os modelos locais? [s/N]`
([RN-691](../business-rules/produto.md#rn-691)). Ele diz o custo antes — disco para a
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
[RN-692](../business-rules/produto.md#rn-692)), a migração roda o backup, prova o
restore, e então pergunta
`Apagar os volumes e reinstalar? [s = restaurar / z = do zero / N = parar]`.
`z` apaga e reinstala **sem restaurar** os dados antigos; o backup provado
fica na pasta que ele nomeia, e restaurá-lo depois é o
[Restore](restore.md#restore). Provado pelo `scripts/dev/install-llm.spec.ts`.

---

## Verificando um artefato publicado {#verificar-artefato-publicado}

Toda tag final assina o que publica, com `cosign` **keyless** — a
identidade que assina é o próprio workflow, e não há chave sob custódia
em lugar nenhum ([ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md),
[RN-524](../business-rules/ci.md#rn-524)). É assim que **você** confere, fora do
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
  --certificate-identity-regexp '^https://github.com/viralabs-dev/brabo/\.github/workflows/release\.yml@' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  "ghcr.io/viralabs-dev/brabo-api@${DIGEST}"
```

### Os binários do runner {#the-runner-binaries}

Um `checksums.txt` assinado cobre os quatro alvos (o Mac Intel não tem binário
desde o [ADR 0174](../adr/0174-runner-sem-binario-darwin-x64.md) — ele fica
sem runner e pede suporte por issue no `brabo-runner`, AT-774), então a verificação tem dois
passos: a assinatura do manifesto, depois o binário contra o manifesto.

```bash
gh release download vX.Y.Z --repo viralabs-dev/brabo-runner --pattern 'checksums.txt*' --pattern 'brabo-runner-*'

cosign verify-blob \
  --bundle checksums.txt.bundle \
  --certificate-identity-regexp '^https://github.com/viralabs-dev/brabo-runner/\.github/workflows/build-runner-binaries\.yml@' \
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
a fonte correspondente. Desde o [ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md)
essa distribuição acontece em toda tag final.

A oferta escrita é o `THIRD_PARTY_NOTICES.md`, e ele vai **dentro** da
imagem, porque quem roda `docker pull` não tem o repositório:

```bash
docker run --rm --entrypoint sh ghcr.io/viralabs-dev/brabo-engine:vX.Y.Z \
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
gh release download vX.Y.Z --repo viralabs-dev/brabo \
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
do digest ([ADR 0159](../adr/0159-imagem-de-terceiro-por-digest.md),
[ADR 0178](../adr/0178-tag-inline-na-imagem-de-terceiro.md)). Os workflows em
`.github/workflows/` **não** guardam literal de imagem: os `services:` deles leem a
referência do compose de dev pelo `imagens-do-compose.yml`
([ADR 0197](../adr/0197-a-imagem-dos-workflows-vem-do-compose.md)), então subir
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
[a cadeia de suprimentos do CI](../explanation/cadeia-de-suprimentos-do-ci.md#container-images-digest-with-the-tag-alongside):
as cinco imagens que o produto publica já estão resolvidas por digest pelo
`.release/images.json` e pelo `make imagens-do-release`
([ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md)) — nunca fixe
essas à mão no overlay, que deliberadamente guarda o marcador.

---

## Acrescentando um provider compatível {#adicionando-um-provider-compativel}

Vale para qualquer provider que fale o dialeto `/chat/completions` da OpenAI —
que é o caso de praticamente todo hub e todo serviço de inferência
gerenciado. A base já existe
([ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md));
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
([RN-043](../business-rules/api.md#rn-043)).

Se o catálogo do provider publica **modalidade** (aceita imagem, gera
imagem) ou `reasoning`, emita-as no `parseCatalogo` dele — e só quando
a doc oficial diz. Um campo que o provider não declara fica
**omitido**, nunca `false`: `undefined` preserva o que já estava
gravado, e `false` apagaria dado curado à mão
([RN-056](../business-rules/api.md#rn-056)).

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

