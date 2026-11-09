---
id: runbook-deploy
title: Deploy e rollout
sidebar_label: Deploy e rollout
tipo: guia
description: Deploy local no Kubernetes, diagnóstico do deploy e rollout do engine.
---

# Deploy e rollout

Parte do [Runbook operacional](../runbook.md). Comece pela triagem do índice.

## Deploy local {#deploy-local}

Sobe o Brabo inteiro num cluster local e o valida com um
smoke test. Decisões no
[ADR 0025](../adr/0025-fase5-deploy-kubernetes-kustomize.md).

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

> **Isto ocupa as portas do `make dev`.** Manter as portas iguais é o que
> faz o `smoke.sh` valer para os dois modos, e o preço é que eles não
> coexistem: com o cluster de pé, o `make dev` não consegue publicar a porta da `api` e
> **a 5173 nunca abre**. Repare que o web muda de porta entre os modos —
> 8088 aqui, 5173 lá. Para voltar ao desenvolvimento:
>
> ```bash
> make k8s-down && make dev
> ```
>
> `node scripts/dev/preflight.mjs` diz em que modo você está, sem adivinhação. Os dois
> são tratados em
> [Primeiros passos](../getting-started.md#the-two-local-modes-dont-coexist).

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

Desde o [ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md) toda
tag final publica as imagens de produção no GHCR
(`ghcr.io/viralabs-dev/brabo-{api,engine,web,backup,broker}`, públicas — nenhum
`imagePullSecret` em lugar nenhum) e registra o que publicou, **por digest**,
em `.release/images.json`. A quinta, o broker de containers
([ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)), é
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
([ADR 0036](../adr/0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md)):

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
[RN-714](../business-rules/engine.md#rn-714) o gate nunca aprova sem análise
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
([ADR 0209](../adr/0209-engine-em-otp-29.md)); vê-lo de novo quer dizer uma imagem com
OTP < 29.1 em Alpine ≥ 3.24 — reconstrua a partir dos Dockerfiles atuais. O passo de build
do CI "O host tem AMX?" diz se uma dada execução caiu num host desses.

### Erro de CORS {#erro-de-cors}

A mensagem do navegador nomeia o **destino** da chamada, nunca a
causa. Leia primeiro a **origem** que ela cita — é essa a informação útil
([ADR 0037](../adr/0037-cors-do-engine-e-a-porta-como-contrato.md)):

```
Access to fetch at 'http://localhost:3000/health' from origin
'http://localhost:5174' has been blocked by CORS policy
                     ^^^^ esta parte é o diagnóstico
```

**Se a origem não é a que você espera** (`:5174` em vez de `:5173`, um
host diferente, `https` em vez de `http`), o problema é a origem, não o
CORS.

Nos composes, `WEB_ORIGIN` é **derivada** de `WEB_PORT` — mudar
`WEB_PORT` no `.env` (a orientação dos [primeiros passos](../getting-started.md)
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
  [rotação](segredos.md#rotacao-das-chaves-do-auth)) ou o endereço errado
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
[ADR 0170](../adr/0170-compose-de-dev-brabo-dev.md)):

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

A causa costuma ser o `.env`, não o compose. `make dev` passa o `.env`
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
  turno dele ([RN-581](../business-rules/api.md#rn-581)). Para mudar esse teto,
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
causas empilhadas, todas fechadas pela [RN-433](../business-rules/infra.md#rn-433):

1. **`ENGINE_PUBLIC_URL` resolvendo para um hostname interno do Docker.** O
   ticket que a api entrega ao navegador (`POST .../terminal-ticket`) leva
   `engineWsUrl`, montado a partir de `ENGINE_PUBLIC_URL` — distinta de
   `ENGINE_URL` (RN-419), que é para chamadas api→engine **dentro** da
   rede do compose. `docker/docker-compose.yml` agora define
   `ENGINE_PUBLIC_URL: ${ENGINE_PUBLIC_URL:-http://localhost:4000}` no
   serviço `api` (o mesmo default que `VITE_ENGINE_URL` já usa para o `web`).
   A instalação e o prod têm a mesma variável, com `VITE_ENGINE_URL` como
   default (`docker exec brabo-api-1 printenv ENGINE_PUBLIC_URL`). Confirme de
   dentro do container:

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
([RN-108](../business-rules/web.md#rn-108)); o auto-reconnect embutido
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
**não está conectado**, então o `RunnerReadiness` ([RN-507](../business-rules/runner.md#rn-507))
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
forjado. Antes do [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)
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
provider.** O login social ([ADR 0084](../adr/0084-login-social-github-e-gitlab.md))
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
mesmos valores de token desde a [RN-601](../business-rules/engine.md#rn-601)) morre
no início com uma mensagem sobre `AUTH_JWT_SECRET`,
`BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` ou `SECRET_KEY_BASE` —
ausente, definida com o valor de exemplo do repositório, ou curta demais.

**Mesma causa do segredo de OAuth acima, e a mesma orientação: não é
regressão, e não a contorne.**
O [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md) já
declarava estes quatro como pendentes — o mesmo padrão, só ainda não
replicado — e a [RN-114](../business-rules/api.md#rn-114) o fechou. Cada um protege
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
[ADR 0099](../adr/0099-neo4j-grafo-de-conhecimento-e-templates.md)) segue
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
[Rotação das chaves do auth](segredos.md#rotacao-das-chaves-do-auth); trocar
`CREDENTIALS_MASTER_KEY` sem re-embrulhar tem o mesmo efeito já
documentado em
[Rotação da chave mestra](segredos.md#rotacao-da-chave-mestra). Esta checagem de BOOT não
muda nenhum dos dois procedimentos — ela só impede a chave de chegar à produção
como o literal público deste repositório.

### SMTP real no `MailSender` {#smtp-real}

O `MailSender` envia e-mail de verdade só quando `MAIL_TRANSPORT=smtp` — o
default é `log` (o comportamento de sempre), **inclusive em produção**:
enviar e-mail de verdade é escolha explícita do operador
([ADR 0096](../adr/0096-smtp-real-no-mailsender.md)). Veja
[Configuração](../reference/configuration.md#api) para a tabela completa de `SMTP_*`.

Sintoma de configuração incompleta: com `NODE_ENV=production` e
`MAIL_TRANSPORT=smtp`, a api morre no início reclamando de
`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` ou `SMTP_FROM` — mesmo padrão
de mensagem dos
[quatro segredos irmãos](#segredos-irmaos-no-boot) ([RN-408](../business-rules/api.md#rn-408)),
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
   ([RN-097](../business-rules/api.md#rn-097)) — e é `consultiva` de
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
[Rotação das chaves do auth](segredos.md#rotacao-das-chaves-do-auth).

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
[ADR 0026](../adr/0026-fase5-observabilidade-e-graceful-shutdown.md).

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
consumida, em [Observabilidade](operacao.md#observabilidade)).

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

