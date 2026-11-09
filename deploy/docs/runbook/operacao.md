---
id: runbook-operacao
title: Operação
sidebar_label: Operação
tipo: guia
description: Incidente de custo, observabilidade, registro de gates e ambiente de inferência.
---

# Operação

Parte do [Runbook operacional](../runbook.md). Comece pela triagem do índice.

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
([RN-019](../business-rules/api.md#rn-019)).

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
workspace — [RN-020](../business-rules/api.md#rn-020)).

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
(veja [Rollout do engine](deploy.md#rollout-do-engine)).

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
[ADR 0026](../adr/0026-fase5-observabilidade-e-graceful-shutdown.md).

### Observabilidade local, sem cluster {#observabilidade-local}

Tudo abaixo desta subseção supõe o cluster de pé. Para métricas
e logs sem subir Kubernetes, há um overlay de Compose
([ADR 0070](../adr/0070-observabilidade-no-compose-local.md)):

```bash
node scripts/dev/preflight.mjs && docker compose -f docker/docker-compose.yml -f docker/docker-compose.observability.yml --env-file .env up -d && node scripts/dev/observabilidade-pronta.mjs   # sobe a stack de dev + Prometheus, Loki, Alloy e Grafana
docker compose -f docker/docker-compose.yml -f docker/docker-compose.observability.yml --env-file .env rm -sf loki alloy prometheus grafana   # derruba só os quatro, deixando os apps de pé
```

O comando termina conferindo o que subiu — se diz `ok` em toda
linha, o painel tem dados; se reclama, diz qual peça
faltou.

Verificação: essa checagem final é `scripts/dev/observabilidade-pronta.mjs`,
e é uma **autoverificação, não uma prova** — ela só roda quando alguém sobe o
overlay, e não tem spec nem workflow. Uma mudança que quebra o
overlay aparece da próxima vez que alguém rodar o overlay de observabilidade (comando em [Observabilidade local](#observabilidade-local)).

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
descuido ([ADR 0026](../adr/0026-fase5-observabilidade-e-graceful-shutdown.md),
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
| *Sessão presa em closing* | `warning` | 15 min | [o drain não terminou](deploy.md#quando-a-sessao-escapa), ou a transição para `closed` falhou |
| *Custo por hora acima do limite* | `warning` | 5 min | [qual projeto e qual agente](#incidente-de-custo); o orçamento do domínio continua sendo o controle duro |
| *Backup do Postgres atrasado* — último backup bom com mais de 26 h | `critical` | na hora | o CronJob não rodou, ou rodou e falhou — `brabo_backup_last_status` distingue os dois; veja [Restore](restore.md#restore). "Nunca teve backup" (`-1`) **não** o dispara |
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
([ADR 0054](../adr/0054-gates-como-registro-declarativo.md)). Duas coisas
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
de antes da correção ([RN-070](../business-rules/api.md#rn-070)); se
lança nomeando o *conteúdo* de um gate (um gate `block` sem `script`, um
gate `active` sem evidência), o próprio registro está errado e o
repositório é onde corrigir.

A tela não mostra esta falha: o `PrGateTimeline` cai para a
esteira completa quando `GET /gates` falha ([RN-084](../business-rules/api.md#rn-084)),
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
[docs/explanation/gates.md](../explanation/gates.md).

---

## Ambiente de inferência {#ambiente-de-inferencia}

Quando o agente responde vazio, truncado, extremamente devagar, ou "esquece"
as próprias instruções, o problema quase nunca está no código de domínio —
está aqui. As cinco primeiras causas foram achadas em nove execuções seguidas da
demo de gates e estão registradas no
[ADR 0020](../adr/0020-destravar-gates-qa-secops.md); todas as variáveis estão
expostas no `docker-compose.yml`.

| variável | sintoma quando errada |
|---|---|
| **GPU** | o serviço `ollama` sem dispositivo reservado deixa a GPU parada e roda 100% na CPU: um prompt de ~7.000 tokens leva ~50s só para a ingestão. O override é opcional (`docker-compose.gpu.yml`, `docker compose -f docker/docker-compose.yml -f docker/docker-compose.gpu.yml --env-file .env up`), mantido fora do compose principal porque sem `nvidia-container-toolkit` no host a reserva **faz o serviço não subir** |
| `OLLAMA_CONTEXT_LENGTH` | o default de 4096 trunca **em silêncio** um prompt feito para 128k. O agente perde as próprias instruções e começa a imitar o schema das ferramentas, que é o que sobra no fim do contexto |
| `OLLAMA_MAX_LOADED_MODELS` | com `OLLAMA_KEEP_ALIVE` alto, os modelos se acumulam: 15,2 GB de pesos residentes numa máquina de 15 GB, e o agente responde vazio por falta de memória |
| `OLLAMA_REQUEST_TIMEOUT_MS` | timeout curto demais para um modelo grande num prompt longo |
| `OLLAMA_MODE` (bootstrap de dev, [RN-461](../business-rules/infra.md#rn-461), ADR 0114) | preso em `host` depois que o Ollama nativo na máquina do desenvolvedor foi desinstalado ou parado — todo turno de LLM local falha com `ECONNREFUSED` contra `http://host.docker.internal:<porta>`, e o serviço `ollama` do compose nunca sobe para cobrir (ele fica atrás de `profiles: ["local-llm"]`, e é esta variável que mantém esse profile desligado). Correção: `Docker › Reconfigurar Ollama` no `pnpm bootstrap`, que limpa `OLLAMA_MODE`/`OLLAMA_HOST` do `.env` e força a detecção a perguntar de novo no próximo `Create`/`Reset total` |
| `NINE_ROUTER_BASE_URL` ([RN-909](../business-rules/api.md#rn-909), ADR 0222) | o provider `9router` falha com `ECONNREFUSED` (origem `infra`) e o teste de conexão da credencial recusa. O padrão `http://host.docker.internal:20128/v1` só resolve dentro do container: a api da instalação e a de produção alcançam o host pelo `extra_hosts: host.docker.internal:host-gateway`; rodando no host (smoke), aponte para `http://localhost:20128/v1`. Com o 9Router parado o erro é o mesmo, então confira primeiro se ele escuta na porta 20128 |
| `START_OUTBOX_DRAIN` / `START_ANAMNESE` | o Psicólogo e a Anamnese consomem turnos de LLM em paralelo com os agentes de execução e derrubam a conexão do dev no meio do ciclo |
| `TOOL_LOOP_MAX_ITERATIONS*` | um teto BAIXO demais e o agente para sem entregar, com `iteration limit reached` e origem `model` — o que engana, porque o modelo não fez julgamento errado nenhum, nem chegou a julgar. O teto é por TIPO ([RN-085](../business-rules/engine.md#rn-085)): `8` para agentes conversacionais, `60` para o dev agent e o QA. Antes de subi-lo, confira se o agente TEM `token_budget_micros`; sem ele o teto é a única guarda de custo que existe |
| `TERMINAL_OUTPUT_MAX_BYTES` | subi-lo demais traz de volta o modo de falha que o teto existe para evitar: a saída de cada comando fica no histórico do laço e viaja em TODO turno seguinte. Não é questão de janela de contexto: a maior chamada bem-sucedida da execução que revelou isto primeiro tinha só 28.993 tokens de entrada ([RN-074](../business-rules/engine.md#rn-074)) |
| `API_JSON_BODY_LIMIT` (api) / `TRANSPORT_MAX_BODY_BYTES` (engine) | o `413 request entity too large` no gate de QA/SecOps tinha a causa na própria api do Brabo, nunca no provider — o Express nunca teve limite de corpo configurado e valia o default de 100 KB, contra os 8 MB que o Phoenix aceita na perna engine→api mais pesada (`POST .../llm-turn`, que reenvia o histórico inteiro a cada iteração). `API_JSON_BODY_LIMIT` (default 10 MB) fecha essa ponta; `TRANSPORT_MAX_BODY_BYTES` (default 8 MiB) é o teto que a compactação de contexto do engine respeita POR CIMA da janela do modelo, para disparar antes de o corpo estourar o limite do HTTP ([RN-412](../business-rules/api.md#rn-412), [ADR 0098](../adr/0098-limites-de-transporte-e-janela-efetiva-de-compactacao.md)) |

Se o modelo do `9router` chama `Read` ou `Bash` (ferramentas que o Brabo não tem) na conta OAuth do Claude, a causa é a **camuflagem do OAuth** do 9Router ([RN-966](../business-rules/api.md#rn-966)), não o agente: o 9Router renomeia as ferramentas e acrescenta falsas do Claude Code, e nenhuma configuração a desliga. Use API key do Claude ou outro provider.

> **Cuidado — a guarda não limpa a fila.** `START_ANAMNESE=false`
> bloqueia enfileiramentos **novos**, não os antigos. Já houve 20
> `AnamneseWorker`s acumulados em `executing` de execuções anteriores, que rodam
> no próximo boot independentemente da guarda. A fila precisa ser
> **expurgada**, não só ter a guarda desligada.

> **Ligar a Anamnese ou o Psicólogo: duas variáveis, não
> uma.** Os dois foram pausados em 2026-08-10 por decisão de produto, não por bug. O
> Psicólogo ainda está; a Anamnese foi religada pelo dono em
> 2026-10-01 ([RN-680](../business-rules/engine.md#rn-680)) — `ANAMNESE_ENABLED`
> volta ao default `true` no código e nos três composes, e uma rodada
> sem sujeito elegível não faz chamada de LLM e diz por quê no log do engine
> (`sem_sujeito_elegivel`). Pausá-la de novo é `ANAMNESE_ENABLED=false`. `ANAMNESE_ENABLED` / `PSYCHOLOGIST_ENABLED` são as
> flags de produto (uma rodada NOVA pode acontecer?); `START_ANAMNESE` é a chave
> de boot (o tick periódico é sequer agendado?). A Anamnese periódica precisa das duas
> em `true`; o Psicólogo não tem chave de boot, porque o gatilho automático dele
> é o fechamento de sessão.
>
> Até a [RN-540](../business-rules/engine.md#rn-540) as duas flags `*_ENABLED`
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
([RN-014](../business-rules/api.md#rn-014), [RN-015](../business-rules/api.md#rn-015)).

---

