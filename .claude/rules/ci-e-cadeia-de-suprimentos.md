---
paths:
  - ".github/**"
  - "scripts/ci/**"
  - "docker/**"
  - "deploy/**"
  - "docker-bake.hcl"
  - "Makefile"
---

> Extraída do monorepo (AT-701): caminhos como `apps/api/...`, `apps/engine/...`, `docs/...` e `.github/workflows/release.yml` são os do monorepo; hoje moram nos repos `brabo-api`, `brabo-engine`, `brabo-docs`->`brabo` e no `brabo` (release do produto). `install.sh` e a release do produto são do repo `brabo`.

> Regra de CAMINHO: o Claude Code a carrega só quando a sessão lê arquivo
> que casa com `paths:` acima. Saiu de `.claude/contexto/stack.md` (Stack) porque o contexto lido em
> toda sessão passava do teto de 150 mil caracteres. Edite AQUI.

## Stack: CI/CD de release e cadeia de suprimentos
- CI/CD de release: GitHub Actions com lógica em scripts testáveis
  (scripts/ci/, vitest). Todo `uses:` de terceiro é preso a COMMIT SHA, com
  a versão num comentário ao lado (`@<sha>  # v4`) — tag é ponteiro que o
  dono da action move sem aviso, e quem move executa código no runner que
  tem o checkout e os segredos daquele workflow. O comentário é obrigatório:
  é o que diz a um humano, e ao Dependabot, que versão é aquele hash.
  `scripts/ci/actions-pinadas.ts` reprova no job `lint` quem esquecer, e
  todo `curl` de binário passa por `sha256sum -c`. Desde o ADR 0159 essa
  regra tem uma IRMÃ, e o argumento é o mesmo palavra por palavra: toda
  IMAGEM de terceiro é presa por DIGEST, e o digest é o do ÍNDICE, nunca o de
  uma plataforma — pinar o manifesto de `linux/amd64` quebraria `linux-arm64`
  sem aviso. Desde o ADR 0178 (AT-139) a TAG mora DENTRO da referência, antes
  do digest — `neo4j:5.26-community@sha256:…`, e no Dockerfile
  `FROM node:26.10.0-alpine3.24@sha256:… AS deps` —, e NÃO num comentário, que
  era a forma do ADR 0159: o Dependabot não lê comentário em formato nenhum e
  atualiza pin só de digest para o digest da `latest`, com o comentário
  mentindo e o lint verde. Com os dois, o Docker puxa pelo digest. Comentário
  ao lado é PERMITIDO só se disser a MESMA tag (um token com dígito que
  diverge reprova), e em DOCKERFILE comentário no FIM da linha do `FROM`
  continua proibido: o parser do Docker só reconhece `#` no INÍCIO da linha,
  então `FROM x@sha256:… # tag` é um `FROM` com TRÊS argumentos e o build
  morre — aprendido errando, e o `hadolint` tinha passado (parser próprio;
  linter concordar não é build concordar). Vale nas TRÊS árvores onde imagem de terceiro entra: `docker/`
  (compose E `FROM` de Dockerfile), `deploy/k8s/` e `.github/workflows/` —
  esta última é `services:` de job, ou seja, o MESMO runner que a regra das
  actions protege, alcançado pela outra porta, e foi o lugar que o próprio
  levantamento do `BRB-004` não tinha visto. E desde o ADR 0197 (AT-246) os
  workflows NÃO têm literal de imagem nenhum: o `image:` dos `services:` é
  `${{ needs.imagens.outputs.<imagem> }}`, de um job `imagens` que chama o
  reutilizável `.github/workflows/imagens-do-compose.yml`, que lê o serviço do
  compose de DEV (`scripts/ci/imagens-do-compose.ts`, tabela
  `IMAGENS_DOS_WORKFLOWS`). Serviço novo de workflow entra por ESSE caminho —
  imagem no compose, linha na tabela, output no reutilizável (o spec reprova
  se divergirem) —, nunca com um literal. Job EXIGIDO que dependa de `imagens`
  leva `if: ${{ !cancelled() }}`, senão `imagens` vermelho o deixaria
  `skipped`, que conta como verde. `scripts/ci/imagens-pinadas.ts`
  reprova no job `lint`, e reprova: referência mutável, digest sem a tag
  INLINE (inclusive a forma antiga, tag só no comentário), comentário que
  diverge da tag inline, comentário no fim do `FROM`, a MESMA tag inline com
  dois digests diferentes, e — num WORKFLOW — imagem literal (mesmo por
  digest), expressão que não seja EXATAMENTE `${{ needs.<job>.outputs.<x> }}`
  (literal na expressão, `||`, `env.`, `vars.`, `format()` são onde um literal
  mutável se esconde) e `needs` de job que não chama o reutilizável. A regra
  dos dois digests nasceu da promessa do `golden-set-rag.yml` de rodar a
  mesma versão do compose de dev (o piso do golden-set é chaveado por MODELO,
  não por ambiente); desde o ADR 0197 essa promessa é CONSTRUÇÃO, e a regra
  segue guardando composes × Dockerfiles × manifests. São DOIS
  scripts e não um: `uses:` mora em YAML de workflow com uma sintaxe, imagem
  mora em compose, manifest do kustomize e Dockerfile com outras três. O
  check NÃO cobre as imagens que o PRODUTO publica, e isso é decisão com três
  razões — não há terceiro que as mova; `brabo-api:prod` é tag LOCAL cujo
  digest não existe antes do build; e onde elas atravessam registry o ADR
  0119 já as resolve, com o overlay guardando o MARCADOR de propósito, então
  cobrar digest literal ali reprovaria o estado CERTO. Também ficam fora
  referência interpolada (`${BRABO_API_IMAGE:?…}`) e estágio de multi-stage.
  A lista de exceções é por NOME e falha fechado: imagem de terceiro nova
  nunca casa com `brabo-`. Preço DECLARADO e não pago aqui: digest congela, e
  imagem congelada não recebe correção de segurança até alguém trocá-lo — e
  desde o ADR 0197 o Dependabot `docker-compose` (`/docker`) e `docker`
  (`/docker/*` e `/deploy/k8s/**`, NUNCA `/docker` sem o `/*`: o `docker`
  também lê YAML e abriria um segundo PR para os composes) estão LIGADOS,
  `target-branch: dev`, cada um com UM grupo — sem grupo, a mesma tag em três
  pastas de Dockerfile viraria três PRs vermelhos. Segue DECLARADO: `neo4j` e
  `ollama` moram também em `deploy/k8s/base/`, os dois ecossistemas nunca
  dividem um PR, e uma re-publicação da MESMA tag faz os dois PRs nascerem
  vermelhos pela regra dos dois digests até um humano juntá-los — não afrouxe
  a regra para eles passarem. O `imageName` do CNPG e a
  `IMAGEM_DO_GOLDEN_SET_QA` ficam no procedimento manual em qualquer caso. Subir um digest é procedimento de runbook, e a regra NÃO tem RN,
  pelo mesmo motivo que a irmã não tem: as duas moram aqui e em
  scripts/ci/docs/explanation/cadeia-de-suprimentos-do-ci.md, e pôr uma delas em
  business-rules.md daria dois endereços à mesma política. E desde a RN-524 (ADR
  0149) a esteira também ASSINA o que publica: `cosign` keyless (OIDC do
  Actions) nas imagens publicadas (cinco desde o ADR 0162) por DIGEST — nunca por tag, que é ponteiro
  móvel — e UM `checksums.txt` assinado cobrindo os binários do runner
  (quatro alvos desde o ADR 0174), não uma assinatura por binário. Os dois workflows VERIFICAM o que
  assinaram no mesmo run, porque assinatura que ninguém tenta verificar é
  arquivo a mais e a falha apareceria só na máquina de quem instala. E desde
  o ADR 0172 (AT-179) o `release.yml` ESCANEIA o que publica antes de
  assinar: Trivy sobre o DIGEST de cada imagem do `.release/images.json`
  (`--image-src remote`), entre o registro e o `cosign sign` — imagem
  reprovada não é assinada, e o `install.sh` não instala imagem sem
  assinatura. Até ali só o `ci.yml` escaneava, e ele escaneia um build LOCAL do
  PR, enquanto a tag constrói FRIA noutra execução (AT-110). O portão usa as
  flags do `ci.yml` BYTE A BYTE (`--severity HIGH,CRITICAL --ignore-unfixed
  --exit-code 1`, o MESMO `.trivyignore.yaml`) e o veredito é o código de
  saída do Trivy, nunca uma régua em TS; o que NÃO tem correção é RELATADO
  (resumo do job e asset `trivy-sem-correcao.md`, por
  `scripts/ci/trivy-do-release.ts`) e não bloqueia. Sem allowlist nova — não
  acrescente `--ignorefile`, `--skip-*` nem `--vex` ao release para uma tag
  passar. Versão, `sha256` e flags do Trivy existem nos DOIS workflows, de
  propósito (`env:` não se importa), e `scripts/ci/trivy-do-release.spec.ts`
  reprova a divergência e o portão depois da assinatura: quem sobe o Trivy sobe
  nos dois no mesmo PR. Preço declarado: o push vem antes do scan, então tag
  reprovada deixa imagem SEM assinatura no GHCR e sem Release. Desde a
  RN-525 o proxy `GET /runner-releases/binary` VERIFICA — mas só o sha256
  contra o `checksums.txt` da mesma release, nunca a ASSINATURA dele: é
  INTEGRIDADE e não procedência, e está escrito assim no docblock, na
  OpenAPI, na mensagem de recusa e na RN. As duas formas de a api verificar
  assinatura foram MEDIDAS e recusadas — `cosign` na imagem custa 155 MB
  contra um runtime Alpine+Node, e `@sigstore/verify` (2,5 MB, barato) faria
  uma rota `@Public()` depender de um SEGUNDO host de terceiro
  (`tuf-repo-cdn.sigstore.dev`) para verificar algo que nenhuma Release
  carrega ainda, o que a régua dos ADRs 0041/0042 proíbe declarar sem prova.
  Quem verifica assinatura é o `install.sh`, com `cosign` pinado — e ele roda
  na máquina DOS OUTROS, então não assume ferramenta que o SO possa não ter:
  hash é UMA função com DUAS ferramentas aceitas (`sha256sum` **ou**
  `shasum -a 256`), resolvidas ANTES do primeiro download e nunca no meio de
  uma verificação, pela mesma disciplina que já fez o `case` de
  `sha_do_cosign` recusar array associativo (bash 3.2 do macOS) e
  `comparar_versoes` recusar `sort -V`. Faltar as DUAS é recusa PRÓPRIA, que
  nomeia a ferramenta — NUNCA a de hash divergente, que é a de INCIDENTE
  (*"pare e investigue"*): o script chamava `sha256sum` direto nos cinco
  pontos de verificação, o macOS não o traz, e o `command not found` chegava
  como acusação de adulteração, bloqueando toda instalação na plataforma que
  ele mesmo suporta e ensinando a ignorar a frase no dia em que ela for
  verdade (AT-091, RN-526). Ferramenta ausente e hash divergente são recusas
  DIFERENTES, com textos diferentes — não as colapse. Fica FORA,
  declarado: code-signing de SO dos binários (notarização, Authenticode) e a
  metade de PROCEDÊNCIA do proxy — BRB-005 segue aberto só nela. E desde a
  RN-565 o manifesto NÃO é mais refém da matriz: o job `checksums` perdeu o
  `needs: build` e passou a esperar os ASSETS da Release, com teto, em vez do
  JOB mais lento — que podia nem começar. O número é medido nas três tags que
  existem: `darwin-x64` ficava 24h00m01s na fila e era cancelado, o MESMO
  valor nas três, enquanto os outros quatro terminavam em no máximo 4m18s (o
  alvo saiu da matriz depois, no ADR 0174; a correção vale para qualquer alvo
  sem runner). `always()`
  cobria dependência CANCELADA e por isso o job RODAVA; o que ele nunca
  cobriu foi QUANDO, e um manifesto que chega um dia depois é, para quem
  instala, um manifesto ausente (RN-525/526 recusam sem ele, em TODA
  plataforma, inclusive as que anexaram). O teto dos binários é 1200s porque
  é o `timeout-minutes: 20` do próprio job `build` — o máximo que um alvo COM
  runner demora depois de começar; não cobrir tempo de FILA é o ponto. Ver
  scripts/ci/docs/explanation/cadeia-de-suprimentos-do-ci.md, que também DECLARA o que
  segue confiado na fé (sem proveniência de dependência npm; o Dependabot e a
  imagem de terceiro por tag saíram dessa lista, e o que ficou no lugar do
  segundo é o preço do pin — digest não recebe correção sozinho).
  E há UM workflow que NÃO roda em `pull_request` e não pode passar a rodar:
  `install-e2e.yml` (RN-534/RN-549). O instalador verifica a própria origem
  contra o `checksums.txt` ASSINADO de uma Release, que só existe depois de uma
  tag final — fazê-lo rodar em PR exigiria dar-lhe uma porta para PULAR a
  verificação, que é a porta que o ADR 0150 recusa e que, aberta, vale para
  qualquer um. A consequência é DECLARADA e não escondida: **PR que mexe nesse
  workflow não o executa**, e verde ali não significa provado. O que roda em PR
  é `scripts/dev/install-e2e.spec.ts`, e ele guarda as duas formas de o E2E
  apodrecer calado — o gatilho afrouxado, e uma frase do `install.sh` reescrita
  (que não faz as asserções falharem: faz elas SUMIREM). Mesma decisão, mesmo
  motivo, do golden-set do RAG (ADR 0138) e do golden-set do QA
  (`golden-set-qa.yml`, SEMANAL, ADR 0168 — api, engine e broker nativos no
  runner, o socket do Docker só no broker, e a imagem dos casos lida do
  próprio seed, nunca de um segundo literal no workflow). E ele guarda uma TERCEIRA, medida na
  AT-083: o instrumento que não mede. O passo "com TTY" rodava
  `script -qec "… < respostas"`, o `<` ficava DENTRO do `script`, e o
  instalador nunca viu terminal — o comentário afirmava o contrário. Quem roda o
  instalador agora é um driver de pty em Python, e o spec EXTRAI esse driver do
  workflow e o roda contra um instalador de mentira; lógica de workflow que só
  roda em tag se prova assim, em PR, nunca por leitura. A forma de instalar é
  BAIXAR e rodar um arquivo (`curl -fsSLO … && bash install.sh`, RN-526) — o
  `sh -c "$(curl …)"` antigo nunca funcionou, porque a autoverificação calcula o
  hash de `$0`; não reabra essa forma nem dê à verificação uma porta de pular
