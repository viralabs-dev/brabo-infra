---
id: runbook-restore
title: Restore
sidebar_label: Restore
tipo: guia
description: Backup, restore, bare repos, grafo e pasta de artefatos.
---

# Backup e restore

Parte do [Runbook operacional](../runbook.md). Comece pela triagem do índice.

## Restore {#restore}

Decisões no [ADR 0027](../adr/0027-fase5-backup-hardening-release.md).

> **Testado.** O procedimento abaixo é exatamente o que o `make test-restore`
> roda, e ele roda contra o cluster local. Não há passo aqui que
> ninguém nunca exercitou. O registro da última execução está no fim.

### O que tem backup, e o que deliberadamente não tem {#what-is-backed-up-and-what-deliberately-is-not}

Existem sete volumes nomeados; **dois** são fonte da verdade e só esses são
copiados. A classificação é o
[ADR 0152](../adr/0152-backup-de-volumes-contra-compose.md), e o motivo de
fazê-la é que "fazer backup de todo volume" custa espaço enquanto esconde o que importa.

| volume | natureza | no backup? |
|---|---|---|
| `pgdata` | fonte da verdade — event log, ações, pgvector, tudo | sim, como **dump lógico**. Nunca uma cópia de arquivo do diretório de dados: copiar um Postgres rodando produz um backup que pode não restaurar |
| `git_local_repos` | fonte da verdade — os repos *bare* dos projetos do provider `local` | **sim**, e este era o buraco. Ele não é reconstruível a partir do Postgres: o event log guarda a narrativa, não os objetos do git |
| `neo4j_data` | derivado — uma projeção do event log ([ADR 0101](../adr/0101-memoria-relacional-como-projecao-do-event-log.md)) | não. A resposta para memória derivada é **reprojeção**, não restore — `grafo:reprojetar`, veja [Perda do grafo](#perda-do-grafo) |
| `project_workspaces` | derivado — worktrees que o `WorktreeManager` recria a partir do bare repo, **e** a pasta `docs/` dos agentes dos projetos `container` e `runner`, que é uma projeção do event log ([ADR 0148](../adr/0148-artefatos-projetados-em-arquivo.md)) | não. A resposta é **reprojeção** — `artefatos:reprojetar`, veja [Perda da pasta de artefatos](#perda-da-pasta-de-artefatos) |
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
([ADR 0169](../adr/0169-seaweedfs-no-lugar-do-minio-no-overlay-local.md)); em
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

### Restaurando numa instalação compose (banco recém-criado) {#restore-compose-banco-vazio}

Este é o caminho da **migração** do instalador (AT-738, ADR 0256): depois do
`down -v` a instalação nova sobe com o Postgres vazio e o dump provado precisa
voltar nele. Não há `kubectl`; o comando é o mesmo `brabo-restore`, com
`--banco-vazio`:

```bash
# 1. Só o postgres de pé: api e engine PARADOS (eles migram o banco ao subir).
docker compose -f docker/docker-compose.install.yml up -d --wait postgres

# 2. Restaura o último dump da pasta do HOST (BRABO_BACKUP_HOST_DIR) no banco do DATABASE_URL.
docker compose -f docker/docker-compose.install.yml run --rm backup brabo-restore --banco-vazio

# 3. Só então suba o resto (api/engine) e restaure os bare repos git.
docker compose -f docker/docker-compose.install.yml up -d
docker compose -f docker/docker-compose.install.yml run --rm backup brabo-restore-git --restaurar
```

O que ele garante, e o que **não** faz:

- **Recusa**, antes de baixar qualquer coisa, se o banco tiver QUALQUER tabela em
  `public`, `drizzle` ou `engine` (inclusive a `__drizzle_migrations` de uma api
  que já subiu): a mensagem diz `RECUSADO` e quantas tabelas achou. Banco com
  dado nunca é sobrescrito — o ADR 0152 segue valendo, e o caminho de incidente
  continua sendo o restore em banco NOVO acima.
- Restaura numa única transação (falha não deixa meio banco) e roda as mesmas
  validações do teste: lista de tabelas igual à do dump, contagem das tabelas
  críticas igual à do dump (a origem não existe mais; o número vem das linhas do
  `COPY`) e `seq` densa do event log. Zero linhas nas críticas reprova.
- O destino do backup tem de ser a pasta do host: o volume `backup_local` é
  apagado pelo `down -v`.

Provado em `propriedades.yml`, job `restore-banco-vazio`: postgres e backup do
compose de instalação num projeto descartável, dado semeado, backup em pasta do
host, restore num banco novo com contagens iguais, e a recusa sobre o banco já
restaurado.

### O que o restore NÃO cobre {#what-the-restore-does-not-cover}

- **As credenciais de usuário ficam ilegíveis se `CREDENTIALS_MASTER_KEY` for
  diferente.** O dump leva as DEKs embrulhadas, não as chaves. Restaurar
  num ambiente com outra chave mestra devolve um
  banco intacto com credenciais de LLM e de git inúteis. Veja
  [Rotação da chave mestra](segredos.md#rotacao-da-chave-mestra).
- **Nada dos usuários fica de fora.** Desde o corte do Keycloak
  ([ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)) não há
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
  run --rm --user "$(docker run --rm -v brabo_git_local_repos:/v alpine stat -c %u:%g /v)" backup brabo-restore-git --restaurar
```

Duas coisas sobre esse comando, as duas medidas e não supostas:

- **`--user <dono do volume>` não é opcional aqui, e root não serve** (o serviço tem `cap_drop: ALL`; a mensagem de recusa imprime o `uid:gid` lido por `stat`). O `git_local_repos` é compartilhado por três
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
descuido ([ADR 0152](../adr/0152-backup-de-volumes-contra-compose.md), decisão
4). Restaurar uma projeção possivelmente velha ao lado de um Postgres restaurado noutro
instante dá dois estados derivados de momentos diferentes sem nada para
reconciliá-los. A resposta certa para memória derivada é reprojetar a partir da
fonte — e esse comando existe ([RN-569](../business-rules/api.md#rn-569)):

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
do projeto é uma **projeção** dele ([ADR 0148](../adr/0148-artefatos-projetados-em-arquivo.md)),
então não está em backup nenhum e isso é a decisão, não um descuido
(o [ADR 0152](../adr/0152-backup-de-volumes-contra-compose.md) raciocina o mesmo para o
grafo). Restaurar o banco **não** a traz de volta sozinho: as
linhas da outbox que movem o projetor vivo já estão marcadas como processadas, então
nada reescreve a pasta. O comando que reescreve existe
([RN-590](../business-rules/api.md#rn-590)):

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
| `does not accept writes by this user (uid 70)` no `--restaurar` | o caso do dono do volume compartilhado — restaure com `--user <dono do volume>`, veja [Recuperando os bare repos](#restore-dos-bare-repos) |

### Provas de propriedade agendadas {#provas-de-propriedade-agendadas}

Desde a AT-773, cada run mostra no título quem o disparou (`Provas de propriedade · agendado`, ou `manual · <ator>`) e, no Summary, o bloco `## Vínculos`: a origem, os irmãos lidos com o SHA de cada um (`brabo-api`, `brabo-engine`, `brabo-web`) e o destino do resultado. O helper nunca reprova o job; sem a tabela a prova segue. A issue de alarme recebe o mesmo bloco no corpo.

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
   ([ADR 0152](../adr/0152-backup-de-volumes-contra-compose.md)) porque é
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
   da [rotação da chave mestra](segredos.md#rotacao-da-chave-mestra) — as duas chaves publicadas
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
disco livre no `ubuntu-26.04`):

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
   ([ADR 0159](../adr/0159-imagem-de-terceiro-por-digest.md)) é recusado pelo
   webhook do operator — *"Can't use just the image sha as we can't detect
   upgrades"*. Agora ele leva `:16.10@sha256:…`.
2. O Secret de origem do bootstrap não tinha `NEO4J_PASSWORD`, que o
   `ExternalSecret` da base lê desde o grafo ([ADR 0099](../adr/0099-neo4j-grafo-de-conhecimento-e-templates.md)):
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
[RN-588](../business-rules/engine.md#rn-588)) — o `Monitor` do pod antigo apagando a
linha de `session_states` que o par acabara de regravar; veja
[Provando que nada ficou órfão](deploy.md#rollout-do-engine) para o que uma órfã nova
registraria. O que segue é o registro de antes da correção. **A prova de rollout
tinha falhado uma vez em quatro execuções que chegaram a ela** (duas em dez até a execução `35448353884`, 2026-09-19, em que
as cinco sessões viviam no mesmo pod antigo, quatro foram adotadas e uma terminou
sem dono e sem drenagem; os únicos logs que a nomeavam morreram com aquele pod —
e é por isso que a prova agora os guarda, veja
[Provando que nada ficou órfão](deploy.md#rollout-do-engine)). Com o mesmo script e a mesma espera fixa, a execução
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
comando recusa **antes** de extrair e nomeia `--user <dono do volume>`, e quando ele de fato
roda como root devolve a árvore extraída ao dono do diretório em vez de
deixá-la com dono root — o que teria produzido um volume que restaura
perfeitamente e em que api e engine não conseguem escrever.

Verificado depois com `git` de verdade (não a imagem de backup, que não tem):
`git fsck --connectivity-only` limpo nos dois repos, refs e commits intactos,
dono de volta em `1000:1000`.

---

