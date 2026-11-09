---
id: runbook-segredos
title: Rotação de segredos
sidebar_label: Rotação de segredos
tipo: guia
description: Rotação das chaves do auth e da chave mestra.
---

# Rotação de segredos

Parte do [Runbook operacional](../runbook.md). Comece pela triagem do índice.

## Rotação das chaves do auth {#rotacao-das-chaves-do-auth}

Decisões no
[ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) e no
[ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md).

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
não com esta chave, e desde a [RN-613](../business-rules/api.md#rn-613)
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
> versão anterior à [RN-613](../business-rules/api.md#rn-613) em que ela
> nunca foi definida, `AUTH_JWT_SECRET`. Ela **deixa** de subir sem um, em
> produção: veja a ordem de migração acima.

Verificação: `apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`
([RN-597](../business-rules/api.md#rn-597)).

### `BRABO_SERVICE_TOKEN` — rotação sem indisponibilidade, dos dois lados {#rotacao-do-brabo-service-token}

Este é o segredo compartilhado que autentica o tráfego api ↔ engine
([RN-035](../business-rules/api.md#rn-035)). Ele não tem nada a ver com sessão de
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
   ([RN-598](../business-rules/api.md#rn-598),
   [RN-601](../business-rules/engine.md#rn-601)). Sair de um
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
[diagnóstico acima](deploy.md#diagnostico-do-deploy).

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
> ([RN-595](../business-rules/api.md#rn-595); guardado por
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
a [RN-031](../business-rules/api.md#rn-031). Se você precisa destravar alguém
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

Decisões no [ADR 0027](../adr/0027-fase5-backup-hardening-release.md).

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

Desde a [RN-563](../business-rules/api.md#rn-563) cada envelope leva também um
**`key_id`** — a impressão digital da chave que o embrulhou. É ele que torna
o progresso do passo 2 respondível em SQL. Duas coisas sobre ele importam às 3h:

- **Ele nunca decide se uma linha abre.** A leitura continua tentando a chave
  atual e caindo para a anterior; o AES-GCM autentica, e ele é a
  autoridade. O rótulo é metadado, e uma linha cujo rótulo discorda do
  envelope é re-embrulhada corretamente assim mesmo ([ADR 0158](../adr/0158-o-id-da-chave-mestra-gravado-no-envelope.md)).
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
([RN-562](../business-rules/api.md#rn-562)):

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
é a chave errada — e desde a [RN-563](../business-rules/api.md#rn-563) você pode
confirmar isso numa comparação em vez de por eliminação, lendo o `key_id`
de qualquer linha e pondo-o ao lado da linha `chave mestra corrente` no
log de boot da api. Veja
[Restore](restore.md#restore).

É por isso que a chave mestra faz parte do plano de recuperação: um backup de banco
sem a chave correspondente não recupera os segredos do usuário.

### Quando algo dá errado {#when-something-goes-wrong}

| sintoma | causa |
|---|---|
| a api sobe sem aviso de rotação, mas o script exige o PREVIOUS | a variável nunca chegou ao pod; o ESO só ressincroniza a cada `refreshInterval` (1h) |
| `falhas` igual ao total | o PREVIOUS publicado não é a chave que embrulhou o acervo |
| `já na chave atual` igual ao total, sem ter rodado antes | as duas variáveis têm o mesmo valor — o serviço ignora o PREVIOUS nesse caso |
| uma credencial para de funcionar DEPOIS do passo 3 | alguma linha ficou para trás; republique o PREVIOUS imediatamente e rode o script de novo. A consulta de progresso do passo 2 é o que impede isto, e é a checagem a rodar primeiro |
| a consulta de pendentes responde o total inteiro, num banco que ninguém rotacionou ainda | esperado: o `key_id` é escrito da próxima escrita em diante, então uma instalação anterior à [RN-563](../business-rules/api.md#rn-563) o tem `NULL` em todo lugar até a primeira rotação. `NULL` conta como pendente de propósito — "não sei qual chave" não é "já na atual" |
| o `rewrap` diz que uma linha está numa chave que não é nem a atual nem a anterior | a linha veio de outro ambiente — o mais comum é um dump restaurado entre instalações. Veja [Interação com o restore](#rotacao-da-chave-mestra) abaixo; o `key_id` da linha contra o do log de boot da api diz de relance |

---

