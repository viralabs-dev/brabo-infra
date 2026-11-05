---
paths:
  - "docker/**"
  - "deploy/**"
  - "scripts/dev/**"
---

> Extraída do monorepo (AT-701): caminhos como `apps/api/...`, `apps/engine/...`, `docs/...` e `.github/workflows/release.yml` são os do monorepo; hoje moram nos repos `brabo-api`, `brabo-engine`, `brabo-docs`->`brabo` e no `brabo` (release do produto). `install.sh` e a release do produto são do repo `brabo`.

> Regra de CAMINHO: o Claude Code a carrega só quando a sessão lê arquivo
> que casa com `paths:` acima. Saiu de `.claude/contexto/stack.md` (Stack) e `.claude/contexto/estado-atual.md` (Cortes e pausas) porque o contexto lido em
> toda sessão passava do teto de 150 mil caracteres. Edite AQUI.

## Stack: `apps/broker` e `packages/docker-port`
- `apps/broker`: workspace novo, Node/TS — o ÚNICO processo do produto que
  fala com um daemon Docker no SERVIDOR (ADR 0130), e o único serviço com
  `/var/run/docker.sock` montado. Não monte esse socket em mais nenhum. Sem
  framework web (são seis rotas, medido em 2026-09-25, `node:http` puro), imagem própria em
  `docker/broker/`, e o binário `docker` DENTRO da imagem (`docker-cli`, só o
  cliente) — preço declarado da decisão de usar um mecanismo só dos dois lados.
  **Ele não aceita especificação de container**: recebe um `projectId` e uma
  das cinco operações da `DockerPort`, vai à api LER a decisão do Arquiteto
  (`GET /internal/projects/:projectId/container-spec`) e COMPÕE imagem, rede,
  recursos e o único mount. Não existe campo em que se escreva `privileged`,
  `cap_add`, `network: host` ou um `-v` livre — se a spec viajasse no corpo, a
  contenção de um processo root-equivalente no host dependeria de o CHAMADOR
  estar correto. A api NÃO manda caminho nenhum (o `-v` é resolvido pelo daemon
  contra o filesystem do HOST; um caminho de dentro do container da api montaria
  uma pasta VAZIA). Desde o ADR 0144 (RN-503) ele tem DUAS raízes —
  `PROJECT_WORKSPACES_HOST_ROOT` (a pasta GERENCIADA, modo `container`) e
  `BRABO_PROJECTS_HOST_BASE` (a base dos projetos MONTADOS, derivada de
  `BRABO_PROJECTS_BASE` no compose, ADR 0141) — e ele NÃO adivinha qual usar: a
  api manda um localizador DISCRIMINADO (`localizacao`: `gerenciada` |
  `montada` | `indisponivel`) dizendo contra qual raiz o SEGMENTO relativo
  vale. O invariante é o mesmo de sempre — o que atravessa a rede continua
  sendo só a metade que a raiz do broker não cobre. `start` recusa NOMEANDO a
  raiz que falta, e NUNCA cai na outra: a gerenciada é nomeada por
  `workspace_dir_name` e a base é nomeada pelo usuário, então o mesmo nome
  aponta para pastas diferentes e o container subiria com o código de outro
  projeto. Ele atende `container` E `mounted`, e recusa `runner` (a pasta mora
  numa máquina que este host não enxerga); a lista é de PERMITIDOS, então modo
  novo no enum nasce recusado com mensagem. Contenção em cinco camadas
  independentes — sem porta publicada, rede `internal: true` que só a api
  alcança, `BRABO_SERVICE_TOKEN` em tempo constante, cinco operações, spec
  computada. Desde a RN-512 (ADR 0146) sobe POR PADRÃO no compose local e
  permanece sob `profiles: ["container-broker"]` no de produção e no de
  INSTALAÇÃO — a divergência entre o de dev e os outros dois é a decisão, não
  descuido; no de instalação quem liga o profile é o `install.sh`, perguntando
  (ADR 0162, RN-575). A imagem de PRODUÇÃO (`docker/broker/Dockerfile.prod`) é
  a QUINTA publicada no GHCR desde o ADR 0162, com os mesmos gates das outras
  quatro (Trivy, non-root, healthy read-only sem rede no `ci.yml`; digest,
  assinatura e verificação no `release.yml`) — e o Kubernetes NÃO a conhece, de
  propósito: não há Deployment de broker, e `argumentosDeSetImage` emite só as
  quatro que a base do kustomize declara. A imagem de
  DEV instala as dependências no BUILD e NUNCA em runtime, e isso é
  consequência direta da rede: sem egress não há registry alcançável, e a
  resposta a "o pnpm não baixa" é SEMPRE tirar o registry do caminho quente
  (o pnpm instalado no build em `/usr/local/bin`, do tarball do registry
  conferido contra o sha512 gravado no Dockerfile, na MESMA versão do
  `packageManager` — sem corepack, que o Node 25+ não traz (AT-360); `pnpm
  install` como passo de build), NUNCA dar rede ao serviço. Os TRÊS
  volumes nomeados de `node_modules` são montados por cima do que a imagem
  instalou, e o Docker só semeia volume VAZIO — então
  `docker/broker/entrypoint.sh` reconcilia os três contra uma cópia guardada
  FORA de `/workspace`, carimbada com o sha256 do `pnpm-lock.yaml` do build:
  mexer numa dependência do broker exige `up -d --build broker`, e o
  entrypoint AVISA quando a imagem ficou para trás em vez de recusar subir. O
  serviço tem healthcheck (`wget` contra `127.0.0.1:8090/health`, de DENTRO —
  ele não publica porta): sem ele, `up --wait` dava `Healthy` a um container
  que morria cinco segundos depois, e foi assim que a queda chegou a ser
  anunciada como "reset completo"
- Spec ampliada (ADR 0228/0229, RN-928..930): o `sleep infinity` deixou de ser
  incondicional. `comandoDoApp` (da `container-spec`, nunca do corpo) usa o
  supervisor constante `SUPERVISOR_DO_APP` com o comando como argumento;
  `portas` (só `-p 127.0.0.1:H:C`), `dns` e `hostsExtras` são validados em
  `spec-de-container.ts`. O papel `qa` (`spec.qa`) é a instância efêmera
  `brabo-qa-<workspace>-<chave>`, sem `--restart`, e `stop`/`remove`/`inspect`/
  `exec` aceitam `alvo: { papel: 'qa', chave }` (a porta segue com CINCO
  operações; só `brabo.papel=qa` é alcançado). Rotas novas do broker, no
  roteador fechado: `/containers/:projectId/qa/:chave/{start,remove,exec}` —
  tudo o mais segue 404. Contrato api -> broker: campos `comandoDoApp`, `ports`
  (`host`, `container`, `protocol`), `dns`, `extraHosts` (`name`, `ip`) e, com
  `?papel=qa&task=<chave>`, `qa: { chave, services: [{ name, image, env?, tmpfs?,
  user?, command?, shared? }] }` (`user` = `<uid>:<gid>` nunca 0, `command` = argv
  depois da imagem, RN-941; o serviço próprio se chama `<instância>-<serviço>`).
- `packages/docker-port`: a porta de Docker e o adaptador de CLI, consumidos
  por `apps/runner` e `apps/broker`. Runtime, e por isso NÃO cabe em
  `packages/shared` (100% tipo, invariante travado por teste). Sem passo de
  build: os dois consumidores o EMPACOTAM (`tsup`, `bun build --compile`), e é
  por isso que a api não pode consumi-lo — `pnpm deploy` copia o pacote de
  verdade e o Node recusa type stripping dentro de `node_modules`

## Corte vigente: o broker e o ciclo de vida do container (FASE 25b)
- FASE 25b DEIXOU de ser corte no compose LOCAL (RN-512, ADR 0146 ponto 3): o
  broker sai do `profiles` ali e sobe com `pnpm dev`, e permanece sob
  `profiles: ["container-broker"]` só em PRODUÇÃO — os dois composes divergem
  de propósito, não uniformize. A justificativa original ("nada o chama... em
  troca de nada", ADR 0130) morreu: são quatro chamadores reais desde os ADRs
  0133/0136, e o ADR 0144 fez `mounted` subir PELO broker, então com o profile
  desligado o modo padrão terminava em `BrokerIndisponivelError`. A assimetria
  é o que o socket significa de cada lado: quem roda `pnpm dev` já o tem (está
  rodando `docker compose`), em produção ele é fronteira de privilégio e o
  operador não é o desenvolvedor. Isso muda QUANDO o broker roda, nunca O QUE
  ele aceita — as cinco camadas de contenção seguem intactas. Consequência:
  `DOCKER_GID` passa a importar para toda máquina de desenvolvimento, e
  `preflight.mjs` RELATA o estado dele a cada subida (errar não quebra o boot,
  quebra o uso, e o sintoma aparece só no `container_start`). Desde a RN-599
  o compose de DEV também dá default a `BROKER_URL` (`http://broker:8090`, o
  serviço do mesmo arquivo) — produção e instalação seguem `${BROKER_URL:-}`,
  e essa divergência também é a decisão, não uniformize —, e o preflight
  RELATA a pasta gerenciada no mesmo molde do `DOCKER_GID`: sem
  `PROJECT_WORKSPACES_HOST_DIR` o broker fica sem
  `PROJECT_WORKSPACES_HOST_ROOT` e o modo `container` não sobe container; o
  `~` é acusado porque o Compose o expande no bind-mount e NÃO na variável do
  broker. Relata, nunca recusa nem grava o `.env`. Em PRODUÇÃO, sem
  o profile ligado, `container_start` continua terminando `failed` com
  `BrokerIndisponivelError`. Na INSTALAÇÃO por Release
  (`docker-compose.install.yml`) o serviço `broker` EXISTE desde o ADR 0162
  (RN-575), desligado sob o MESMO profile, e quem o liga é o `install.sh`,
  PERGUNTANDO — só um "s" digitado liga, o `DOCKER_GID` é MEDIDO de dentro de
  um container com a própria imagem do broker (recusa nomeada, nunca o 999 de
  palpite), e `COMPOSE_PROFILES`/`BROKER_URL`/`DOCKER_GID`/
  `PROJECT_WORKSPACES_HOST_ROOT` vão juntos para o `.env` ou nenhum vai. É o
  argumento da RN-512 (quem instala na PRÓPRIA máquina já tem o socket), com
  consentimento no lugar do "sobe por padrão" do dev porque quem instala nunca
  leu este repositório. `BRABO_BROKER_IMAGE` é obrigatória ligado ou não — o
  Compose interpola o arquivo inteiro antes de filtrar por profile (medido). E
  desde o ADR 0161 (RN-573/574) a TELA sabe se há broker: `brokerConfigurado`
  (`ContainerBrokerPort.configurado()`, a mesma fonte do estado observado) vem
  em `GET .../projects-base` e em cada linha de `GET .../containers`, o
  assistente para de pré-selecionar `mounted` sem broker confirmado e a
  `/containers` recusa antes do clique a subida de `container`/`mounted`. As
  duas metades são a MESMA decisão do mantenedor ("os dois"). O
  que mudou (ADR 0133, RN-491) é que o MECANISMO deixou de ser corte:
  `container_start` é `proposed_action` de verdade (`maintainer`) — e desde
  o ADR 0190 (RN-671) é SEMEADA `auto_approve` no aceite do handoff da Infra,
  com o SERVIDOR do Infra Lead propondo a primeira subida sozinho no kickoff
  quando há roteamento — com a rede HERDADA da `artifact.project_image` do
  Arquiteto (`egress` incluído, sem clique; `none` sem decisão dele — ADR
  0208, RN-723, preço declarado na borda 5 do ADR 0189) (`container`/`mounted`; `runner` segue pelo modelo e
  com aprovação) —, e
  `ExecuteContainerStartUseCase` chama `ContainerBrokerPort.start` de
  verdade quando aprovada — o Infra Lead elege uma das candidatas do
  roteamento do Arquiteto (`artifact.module_routing`, ADR 0131) e a eleição
  emite nova versão de `artifact.project_image` (reusando
  `DecidirImagemDoProjetoUseCase`, `decidedBy: 'infra-lead'`), porque o
  broker compõe a partir DESSE artefato, nunca do roteamento. Das cinco
  operações do ADR 0128/0130, agora as CINCO têm chamador — `inspect` (a
  rota de ciclo de vida, observado ao lado do registrado), `start` e, desde
  o ADR 0134 (RN-492), `exec`: quando há um container `running` REGISTRADO,
  o comando de terminal do dev agent atravessa engine → api → broker e roda
  DENTRO dele, via `docker exec`, em vez de `System.cmd` local — a lacuna
  que a RN-491 tinha deixado declarada ("dev agents NÃO passam a trabalhar
  dentro do container") fechou. Desde o ADR 0136 (RN-495, PR 1.8), `stop` e
  `remove` também têm chamador: a página global de containers
  (`/containers`) propõe `container_stop`/`container_remove` — dois tipos
  novos, sempre um HUMANO clicando "Parar"/"Remover" numa linha da tela,
  nunca um agente. `container_stop` segue o calibre de
  `container_start` (`maintainer`, pode ser configurado auto-aprovável), mas
  NUNCA é semeado — a semente do ADR 0190 é só a da subida; `container_remove` — o mais destrutivo dos três, descarta
  o container e exige reprovisionar do zero — entra no MESMO teto absoluto
  de git push/comando privilegiado (RN-418): nunca auto-aprovável, "sempre
  permitir" recusado na fonte. A tela em si tem seu próprio teto: perguntar
  o OBSERVADO ao broker é uma chamada de rede por projeto, então só linhas
  `provisioning`/`running` são elegíveis, com um teto explícito de 20
  chamadas por carregamento (`TETO_DE_VERIFICACOES_POR_CARGA`) — o que fica
  de fora diz por quê (`naoVerificado`), nunca confundido com o broker ter
  sido perguntado e recusado (`naoObservado`).
  `RegistrarTransicaoDeContainerUseCase` ganhou o primeiro chamador fora de
  teste, transicionando `provisioning → running` (ou direto para `running`
  a partir de `stopped`, que a máquina de estados do ADR 0081 não deixa
  reprovisionar) — `container_remove` acrescenta o segundo hop real,
  `running → stopped → removed`, refletindo que `ContainerBrokerPort.remove`
  já era `docker rm --force` (remove mesmo `running`, numa chamada só) sem
  alargar a máquina de estados com um atalho `running → removed` que só
  existiria para este caso. O que seguia cortado até o ADR 0137 (RN-497,
  PR 1.3): `mounted`/`runner` continuavam sem container nenhum subindo NO
  SERVIDOR — o portão dos três modos fechou (RN-494/ADR 0135, PR 1.7: os
  três modos agora exigem imagem decidida para a aba Code, e
  `RegistrarTransicaoDeContainerUseCase` não recusa mais por modo), mas quem
  impedia `mounted`/`runner` de chegar em `running` era só o broker
  (`ModoDeExecucaoNaoSuportadoError`). O ADR 0137 fechou essa metade DO OUTRO
  LADO: `mounted`/`runner` sobem container de verdade NA MÁQUINA DO USUÁRIO,
  pelo `brabo-runner`. E o ADR 0144 (RN-503) fechou a metade que faltava para
  `mounted`, do lado do SERVIDOR: a base única do ADR 0141 tornou aquela pasta
  alcançável pelo daemon do host, então `mounted` passa a subir pelo BROKER
  como `container` — a ramificação vira por DESTINO (`container` e `mounted` →
  broker, `runner` → runner), e as três ações de ciclo de vida mudam juntas. O
  broker ganhou uma SEGUNDA raiz (`BRABO_PROJECTS_HOST_BASE`) e a api passou a
  mandar um localizador DISCRIMINADO em vez de um nome solto, sem que nenhum
  caminho absoluto atravesse a rede. `runner` é o único modo que segue sem
  container NO SERVIDOR — a pasta dele mora numa máquina que o broker não
  enxerga. A pergunta "quantos módulos, um container só" segue como está,
  `project_id UNIQUE` em `project_containers`, sem mudança aqui. O que
  faltava fechar era o OUTRO fallback: até a RN-507 (ADR 0145), um projeto
  `runner` verificado e conectado tinha comando roteado ao CLI mesmo SEM
  container `running` de pé — o runner caía sozinho no host puro,
  silenciosamente. `Engine.Runners.RunnerReadiness` unifica os TRÊS modos sob
  o MESMO predicado, e `container_start` deixa de atender `runner` (o
  payload dela, com eleição de imagem, nunca fazia sentido pra um caminho
  sem roteamento contra o qual eleger) — `container_start_via_runner` é o
  tipo novo, exclusivo desse modo
