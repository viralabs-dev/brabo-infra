---
id: runbook
title: Runbook operacional
sidebar_label: Manual de operação
sidebar_position: 4
description: Procedimentos operacionais do Brabo — deploy, rollout, restore, rotação de chaves, incidente de custo e observabilidade.
keywords: [runbook, operations, incident, restore, rollout, kubernetes]
tipo: guia
---

# Runbook operacional

Uma porta só, porque às 3h da manhã ninguém quer procurar em qual arquivo está o
procedimento: a triagem é a primeira coisa, e cada linha leva direto a ele.
Os procedimentos moram em `runbook/*.md`, cortados por tema. Comece pela triagem. O que prova cada procedimento, e o que roda
essa prova, está na tabela do fim:
[Procedimentos e como cada um é verificado](#procedimentos-e-verificacao).

## Triagem — do sintoma ao procedimento {#triage--from-symptom-to-procedure}

| o que você está vendo | vá para |
|---|---|
| quero subir tudo do zero | [Deploy local](runbook/deploy.md#deploy-local) |
| pods presos, `ExternalSecret` nunca Ready, HPA em `<unknown>` | [Diagnóstico do deploy](runbook/deploy.md#diagnostico-do-deploy) |
| vou fazer rollout do engine | [Rollout do engine](runbook/deploy.md#rollout-do-engine) |
| sessão `active` sem processo, ou presa em `closing` | [Quando a sessão escapa](runbook/deploy.md#quando-a-sessao-escapa) |
| perdi dados / quero verificar o backup | [Restore](runbook/restore.md#restore) |
| quero verificar ou restaurar um backup numa instalação **sem cluster** | [Restore](runbook/restore.md#restore) — `make test-restore-compose` |
| um projeto do provider `local` perdeu o repositório, ou estou levando uma instalação para outra máquina | [Recuperando os bare repos](runbook/restore.md#restore-dos-bare-repos) |
| o grafo está vazio depois de um restore ou de uma migração | [Perda do grafo](runbook/restore.md#perda-do-grafo) — `grafo:reprojetar` |
| a pasta `docs/` de um projeto (os artefatos dos agentes) sumiu depois de um restore, de uma perda de volume ou de uma conversão de modo | [Perda da pasta de artefatos](runbook/restore.md#perda-da-pasta-de-artefatos) — `artefatos:reprojetar` |
| credencial de LLM ou de git parou de decifrar | [Rotação da chave mestra](runbook/segredos.md#rotacao-da-chave-mestra) |
| todo mundo deslogado de uma vez, ou conta bloqueada no login | [Rotação das chaves do auth](runbook/segredos.md#rotacao-das-chaves-do-auth) |
| o custo por hora disparou | [Incidente de custo](runbook/operacao.md#incidente-de-custo) |
| painel vazio, sem trace, sem log | [Observabilidade](runbook/operacao.md#observabilidade) |
| não sei que versão está rodando | [Que versão está no ar](runbook/deploy.md#que-versao-esta-no-ar) |
| `blocked by CORS policy` no console do navegador | [Erro de CORS](runbook/deploy.md#erro-de-cors) |
| ativar uma sessão não faz nada, ou `transition` devolve `500` com `ECONNREFUSED` | [A sessão não sai de `created`](runbook/deploy.md#sessao-nao-ativa) |
| a api sai no boot reclamando de `GIT_OAUTH_STATE_SECRET` | [A api recusa subir por segredo de OAuth](runbook/deploy.md#segredo-de-oauth-no-boot) |
| "Entrar com GitHub/GitLab" volta do provider com erro de `redirect_uri` | [O provider recusa o callback do login social](runbook/deploy.md#callback-login-social-nao-registrado) |
| a api ou o engine saem no boot reclamando de `AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY`, `SECRET_KEY_BASE`, ou `NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD` | [Os quatro segredos irmãos também não sobem com o default](runbook/deploy.md#segredos-irmaos-no-boot) |
| quero ligar SMTP real, ou a api sai no boot reclamando de `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` | [SMTP real no `MailSender`](runbook/deploy.md#smtp-real) |
| agente respondendo vazio, truncado ou muito devagar | [Ambiente de inferência](runbook/operacao.md#ambiente-de-inferencia) |
| agente parando com `iteration limit reached` sem entregar | [Ambiente de inferência](runbook/operacao.md#ambiente-de-inferencia) |
| quero acrescentar um provider de LLM compatível com OpenAI | [Acrescentando um provider compatível](runbook/instalacao.md#adicionando-um-provider-compativel) |
| quero migrar meus workspaces do volume do Docker para uma pasta de verdade | [Migrar workspaces para pasta local](runbook/ambiente-local.md#migrar-workspaces-pasta-local) |
| o assistente de projeto não oferece o modo **Pasta montada**, ou criar um projeto montado é recusado dizendo que o caminho tem de ficar dentro da base | [Projeto no modo Pasta montada: a base de projetos](runbook/ambiente-local.md#projeto-no-modo-local) |
| aprovar `container_start` num projeto montado falha dizendo que a api não conseguiu criar ou alcançar a pasta | [Projeto no modo Pasta montada: a base de projetos](runbook/ambiente-local.md#projeto-no-modo-local) |
| `make dev` recusa subir, dizendo que `BRABO_PROJECTS_BASE` se sobrepõe ao checkout do Brabo | [Projeto no modo Pasta montada: a base de projetos](runbook/ambiente-local.md#projeto-no-modo-local) |
| `brabo-runner` sai com `base de projetos recusada`, ou imprime `base de projetos: nenhuma configurada` quando eu esperava uma base | [A base de projetos do runner](runbook/ambiente-local.md#base-do-runner) |
| `brabo-runner` fica imprimindo `nada a atender AINDA`, ou a unit de máquina está de pé mas nenhum projeto é atendido | [O agente de máquina](runbook/ambiente-local.md#agente-de-maquina) |
| `systemctl --user status` diz `Loaded: bad-setting` / `WorkingDirectory= path is not absolute`, e o serviço do agente nunca inicia | [A unit está `bad-setting`](runbook/ambiente-local.md#unit-do-agente-nao-inicia) |
| preciso de uma chave de dispositivo para a máquina e não há navegador (uma instalação nova, uma máquina sem tela) | [Chave de dispositivo pelo terminal](runbook/ambiente-local.md#chave-de-dispositivo-pelo-terminal) |
| o instalador terminou com um bloco **"O que ficou pendente"**, ou uma instalação nova não tem conta, nem chave de máquina, nem serviço do agente | [Quando o instalador não fecha a instalação](runbook/ambiente-local.md#instalador-nao-fecha) |
| a pasta do projeto nunca aparece na máquina do usuário, e o log do engine diz `workspace_create: o projeto <id> não criou pasta` | [A pasta do projeto nunca aparece](runbook/ambiente-local.md#pasta-do-projeto-nunca-aparece) |
| um dev agent num projeto `runner` fica bloqueado preparando o worktree, nomeando `credencial-nao-atravessa-o-container`, com origem `politica` | [Clone autenticado no modo Runner](runbook/ambiente-local.md#credencial-nao-atravessa-o-container) |
| `apps/api/dist`/`node_modules`, ou um arquivo que um agente escreveu numa pasta de projeto, pertence a `root` e não consigo editar sem `sudo` | [Os containers de dev escrevem como o seu usuário, não como root](runbook/ambiente-local.md#dev-containers-nao-root) |
| quero subir o broker de containers, ou ele responde `permission denied` no socket do Docker | [O broker de containers](runbook/ambiente-local.md#broker-de-container) |
| provisionar um repositório falha com `permission denied: /data/git-repos/<slug>.git`, ou o `permissions.json` não pode ser escrito | [Os containers de dev escrevem como o seu usuário, não como root](runbook/ambiente-local.md#dev-containers-nao-root) |
| quero apagar o banco de dev e começar de novo, ou o `reset-total.sh` parou no meio | [Reset total do ambiente de dev](runbook/ambiente-local.md#reset-total) |
| o web mostra **429 (rate limit)** sem motivo aparente, ou um projeto em modo `runner` parece "sem agente local" enquanto o `brabo-runner` está rodando | [O runner inunda a api com um ticket morto](runbook/deploy.md#runner-com-ticket-morto) |

Duas coisas que vale saber antes de qualquer procedimento:

- **Silêncio não é saúde.** As regras de alerta moram no Grafana, não no Prometheus
  ([ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md)):
  Grafana fora do ar quer dizer nenhum aviso, não nenhum problema.
- **Matar o pod não fecha uma sessão.** `kubectl delete pod` sem
  drenar cria um órfão. O caminho é sempre a transição normal.

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
| Subir a stack num cluster local | [Deploy local](runbook/deploy.md#deploy-local) | `make deploy-local` termina com `make smoke-k8s` (`deploy/k8s/smoke.sh`); a execução agendada faz o mesmo `deploy/k8s/bootstrap.sh` e smoke | weekly `.github/workflows/propriedades.yml` |
| Validar uma tag da esteira (`TAG=`) | [Validar uma tag da esteira](runbook/deploy.md#validar-tag-do-pipeline) | **None.** Nenhum workflow passa `TAG=`; o checkout destacado da tag só roda à mão | manual |
| Provar que o HPA do engine escala | [Deploy local](runbook/deploy.md#deploy-local) | `make hpa-test` (`deploy/k8s/hpa-test.sh`) | weekly `.github/workflows/propriedades.yml` |
| Validar os overlays sem cluster | [Deploy local](runbook/deploy.md#deploy-local) | `make k8s-validate` (`deploy/k8s/validate.sh`) | every PR `.github/workflows/ci.yml` |
| Fazer deploy das imagens de uma release | [Fazendo deploy das imagens de uma release](runbook/deploy.md#imagens-de-uma-release) | `scripts/ci/aplicar-imagens.spec.ts` prova a leitura do manifesto da release, `scripts/ci/images-manifest.spec.ts` os digests entregues ao `kustomize`; rodá-lo no overlay e aplicar os digests de uma release real: nenhuma | every PR `.github/workflows/ci.yml` (o spec); manual (a corrente) |
| Fazer rollout do engine | [Rollout do engine](runbook/deploy.md#rollout-do-engine) | `make rollout-test` (`deploy/k8s/rollout-test.sh`); os coletores de evidência dele por `scripts/ci/rollout-evidencia.spec.ts` | weekly `.github/workflows/propriedades.yml`; every PR `.github/workflows/ci.yml` (os coletores) |
| Aumentar a janela de drain | [Aumentar a janela de drain](runbook/deploy.md#aumentar-a-janela-de-drain) | **None própria.** `make rollout-test` prova só o par do overlay local (drain de 20 s, grace de 90 s); rode-o de novo com os valores aumentados | manual |
| Fallback para sealed-secrets | [Segredos: fallback para sealed-secrets](runbook/deploy.md#fallback-sealed-secrets) | **None.** Nada roda `kubeseal`; o cluster agendado usa External Secrets | manual |
| Verificar um backup no Kubernetes | [O caminho automatizado](runbook/restore.md#restore-automatizado) | `make test-restore` (`deploy/k8s/test-restore.sh`) e a quebra deliberada `make test-restore-mutacao` | weekly `.github/workflows/propriedades.yml` |
| Verificar um backup numa instalação compose | [O caminho automatizado](runbook/restore.md#restore-automatizado) | `make test-restore-compose` (`docker/backup/test-restore-compose.sh`); o repasse do `.env` dele por `scripts/dev/prova-de-restauracao-env.spec.ts` | weekly `.github/workflows/propriedades.yml`, job `restore-compose` (a prova); every PR `.github/workflows/ci.yml` (o spec) |
| Restaurar de verdade durante um incidente | [Restaurando de verdade](runbook/restore.md#restore-de-verdade) | passos 1–2: `make test-restore` (o mesmo `brabo-restore`, as mesmas consultas do `docker/backup/restore.sh`); passo 3, promover `DATABASE_URL`: nenhuma, nunca exercitado | weekly `.github/workflows/propriedades.yml` (passos 1–2); manual (passo 3) |
| Verificar e recuperar os bare repos | [Recuperando os bare repos](runbook/restore.md#restore-dos-bare-repos) | `scripts/ci/backup-lib.spec.ts` (as funções); `make test-restore-compose` (o comando que verifica, na imagem); `--restaurar` na imagem: nenhuma | every PR `.github/workflows/ci.yml` (o spec); weekly `.github/workflows/propriedades.yml`, job `restore-compose` (o comando que verifica); manual (`--restaurar`) |
| Reprojetar o grafo | [Perda do grafo](runbook/restore.md#perda-do-grafo) | `make test-reprojecao` (`apps/api/test/scripts/reprojetar-grafo.spec.ts`, pulado nos PRs, que não têm Neo4j) e `make test-reprojecao-k8s` (`deploy/k8s/test-reprojecao.sh`) | weekly `.github/workflows/propriedades.yml` |
| Reprojetar a pasta de artefatos | [Perda da pasta de artefatos](runbook/restore.md#perda-da-pasta-de-artefatos) | `apps/api/test/scripts/reprojetar-artefatos.spec.ts` e `make test-reprojecao-artefatos-k8s` (`deploy/k8s/test-reprojecao-artefatos.sh`, o comando dentro da imagem da api) | every PR `.github/workflows/ci.yml` (o spec); weekly `.github/workflows/propriedades.yml` (o caminho da imagem) |
| Rotacionar `AUTH_JWT_SECRET` | [`AUTH_JWT_SECRET`](runbook/segredos.md#rotacao-do-auth-jwt-secret) | `apps/api/test/infrastructure/security/ed25519-access-token-issuer.spec.ts` e `apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts` | every PR `.github/workflows/ci.yml` |
| Trocar `AUTH_TOKEN_PEPPER` | [`AUTH_TOKEN_PEPPER`](runbook/segredos.md#troca-do-auth-token-pepper) | `apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts` | every PR `.github/workflows/ci.yml` |
| Rotacionar `BRABO_SERVICE_TOKEN` | [`BRABO_SERVICE_TOKEN`](runbook/segredos.md#rotacao-do-brabo-service-token) | `apps/api/test/infrastructure/security/service-token.spec.ts`, `apps/api/test/interfaces/engine-service.guard.spec.ts`, `apps/engine/test/engine_web/plugs/verify_service_token_test.exs`, `apps/engine/test/engine/runtime_service_token_test.exs`, `apps/broker/src/config.spec.ts` e `scripts/ci/previous-nos-composes.spec.ts` | every PR `.github/workflows/ci.yml` |
| Pôr e aposentar um `_PREVIOUS` no Kubernetes | [Fazendo no Kubernetes](runbook/segredos.md#rotacao-no-kubernetes) | `scripts/ci/previous-nos-composes.spec.ts` mantém o `ExternalSecret` em `dataFrom.extract` sem `_PREVIOUS` em `data:`; o sync por um External Secrets Operator de verdade: `make test-rotacao-chave-mestra-k8s` (`deploy/k8s/test-rotacao-chave-mestra.sh`) acrescenta e remove `CREDENTIALS_MASTER_KEY_PREVIOUS` por ele; as outras chaves `_PREVIOUS`: nenhuma automatizada | every PR `.github/workflows/ci.yml` (o spec); weekly `.github/workflows/propriedades.yml` (o `_PREVIOUS` da chave mestra); manual (as outras chaves) |
| Destravar uma conta por SQL | [Conta travada por lockout](runbook/segredos.md#conta-travada-por-lockout) | **None.** As duas consultas foram conferidas contra o schema por leitura; `apps/api/test/application/use-cases/auth/lockout.spec.ts` cobre o lockout, não elas | manual |
| Rotacionar a chave mestra | [Rotação da chave mestra](runbook/segredos.md#rotacao-da-chave-mestra) | `apps/api/test/scripts/rewrap-deks.spec.ts` e `apps/api/test/infrastructure/security/envelope-encryption.service.spec.ts`; os três passos no cluster: `make test-rotacao-chave-mestra-k8s` (`deploy/k8s/test-rotacao-chave-mestra.sh`) | every PR `.github/workflows/ci.yml` (os specs); weekly `.github/workflows/propriedades.yml` (o ensaio) |
| Cortar o gasto num incidente de custo | [Incidente de custo](runbook/operacao.md#incidente-de-custo) | `apps/api/test/runbook/sql-do-incidente-de-custo.spec.ts` roda o SQL da seção, nos dois idiomas, contra o schema migrado; passos (b) e (d), na tela: nenhuma | every PR `.github/workflows/ci.yml` |
| Subir a observabilidade sem cluster | [Observabilidade local](runbook/operacao.md#observabilidade-local) | `scripts/dev/observabilidade-pronta.mjs`, uma autoverificação no fim do o overlay de observabilidade (comando em [Observabilidade local](#observabilidade-local)), sem spec | manual |
| Conferir o registro de gates na imagem | [Registro de gates](runbook/operacao.md#registro-de-gates) | `docker/smoke.sh` chama as duas rotas contra a imagem de produção; as funções de gate dele por `scripts/ci/smoke-gates.spec.ts` | every PR `.github/workflows/ci.yml` |
| Instalar | [Instalando](runbook/instalacao.md#instalando) | `.github/workflows/install-e2e.yml` (máquina limpa) e `scripts/dev/install*.spec.ts`; o caminho de migração de ponta a ponta: nenhuma | every tag `.github/workflows/install-e2e.yml`; every PR `.github/workflows/ci.yml` (os specs) |
| Ligar ou desligar o broker da instalação | [O broker de containers numa instalação](runbook/instalacao.md#broker-na-instalacao) | na instalação: `scripts/dev/install-broker.spec.ts` e `.github/workflows/install-e2e.yml`; ligá-lo depois à mão, e desligá-lo: nenhuma | every tag `.github/workflows/install-e2e.yml`; every PR `.github/workflows/ci.yml` (o spec); manual (depois, e desligar) |
| Ligar os modelos locais da instalação | [Modelos locais numa instalação](runbook/instalacao.md#modelos-locais-na-instalacao) | na instalação: `scripts/dev/install-llm.spec.ts`; ligá-los depois à mão: nenhuma | every PR `.github/workflows/ci.yml` (o spec); manual (depois) |
| Reinstalar do zero sobre uma instalação anterior | [Reinstalando do zero](runbook/instalacao.md#reinstalar-do-zero) | `scripts/dev/install-llm.spec.ts` | every PR `.github/workflows/ci.yml` |
| Verificar um artefato publicado | [Verificando um artefato publicado](runbook/instalacao.md#verificar-artefato-publicado) | os workflows de publicação verificam o que assinaram, na mesma execução: `.github/workflows/release.yml` (`cosign verify`) e `.github/workflows/build-runner-binaries.yml` (`cosign verify-blob`) | every tag `.github/workflows/release.yml` `.github/workflows/build-runner-binaries.yml` |
| Conferir a oferta escrita de fonte | [A oferta escrita de fonte](runbook/instalacao.md#oferta-de-fonte-na-imagem) | `scripts/ci/oferta-de-fonte-na-imagem.spec.ts` mantém cada `COPY` e o asset da Release; as cinco imagens construídas a partir do PR, lidas de volta pelo `.github/workflows/ci.yml`; os artefatos publicados levando o arquivo: nenhuma | every PR `.github/workflows/ci.yml` (o spec e as imagens construídas); manual (os artefatos publicados) |
| Subir uma imagem de terceiro | [Subindo uma imagem de terceiro](runbook/instalacao.md#subindo-imagem-de-terceiro) | `scripts/ci/imagens-pinadas.ts`, `scripts/ci/imagens-pinadas.spec.ts` e `scripts/ci/imagens-do-compose.spec.ts` | every PR `.github/workflows/ci.yml` |
| Acrescentar um provider de LLM compatível | [Acrescentando um provider compatível](runbook/instalacao.md#adicionando-um-provider-compativel) | passos 2–4: `apps/api/test/contract/llm-provider.contract.ts`, rodado pelo spec de contrato de cada provider; passo 6, com credencial real: nenhuma no CI — os specs de smoke pulam sem chave | every PR `.github/workflows/ci.yml` (passos 2–4); manual (passo 6) |


## Âncoras antigas {#ancoras-antigas}

Cada âncora que já existiu nesta página continua aqui e leva à parte que hoje guarda a seção. Os links antigos não quebram.

<a id="broker-de-container"></a>[O broker de containers](runbook/ambiente-local.md#broker-de-container)  
<a id="migrar-workspaces-pasta-local"></a>[Migrar workspaces para pasta local](runbook/ambiente-local.md#migrar-workspaces-pasta-local)  
<a id="projeto-no-modo-local"></a>[Projeto no modo Pasta montada: a base de projetos](runbook/ambiente-local.md#projeto-no-modo-local)  
<a id="base-do-runner"></a>[A base de projetos do runner](runbook/ambiente-local.md#base-do-runner)  
<a id="agente-de-maquina"></a>[O agente de máquina: uma conexão por projeto](runbook/ambiente-local.md#agente-de-maquina)  
<a id="unit-do-agente-nao-inicia"></a>[A unit está bad-setting e nunca inicia](runbook/ambiente-local.md#unit-do-agente-nao-inicia)  
<a id="chave-de-dispositivo-pelo-terminal"></a>[Chave de dispositivo pelo terminal](runbook/ambiente-local.md#chave-de-dispositivo-pelo-terminal)  
<a id="instalador-nao-fecha"></a>[Quando o instalador não fecha a instalação](runbook/ambiente-local.md#instalador-nao-fecha)  
<a id="pasta-do-projeto-nunca-aparece"></a>[A pasta do projeto nunca aparece na máquina do usuário](runbook/ambiente-local.md#pasta-do-projeto-nunca-aparece)  
<a id="credencial-nao-atravessa-o-container"></a>[Clone autenticado no modo Runner é recusado enquanto o container está de pé](runbook/ambiente-local.md#credencial-nao-atravessa-o-container)  
<a id="dev-containers-nao-root"></a>[Os containers de dev escrevem como o seu usuário, não como root](runbook/ambiente-local.md#dev-containers-nao-root)  
<a id="reset-total"></a>[Reset total do ambiente de dev](runbook/ambiente-local.md#reset-total)  
<a id="dev-para-brabo-dev"></a>[Levando um ambiente de dev para brabo-dev](runbook/ambiente-local.md#dev-para-brabo-dev)  
<a id="acesso-rapido-local"></a>[Ligando o acesso rápido na instalação local (TP-01)](runbook/ambiente-local.md#acesso-rapido-local)  
<a id="deploy-local"></a>[Deploy local](runbook/deploy.md#deploy-local)  
<a id="prerequisites"></a>[Pré-requisitos](runbook/deploy.md#prerequisites)  
<a id="bringing-it-up"></a>[Subir](runbook/deploy.md#bringing-it-up)  
<a id="validar-tag-do-pipeline"></a>[Validar uma tag da esteira](runbook/deploy.md#validar-tag-do-pipeline)  
<a id="imagens-de-uma-release"></a>[Fazendo deploy das imagens de uma release](runbook/deploy.md#imagens-de-uma-release)  
<a id="que-versao-esta-no-ar"></a>[Que versão está no ar](runbook/deploy.md#que-versao-esta-no-ar)  
<a id="semgrep-do-gate"></a>[O gate de SecOps está preso em "SAST não rodou"](runbook/deploy.md#semgrep-do-gate)  
<a id="engine-sigaltstack"></a>[O engine aborta com sys_sigaltstack(): Internal error](runbook/deploy.md#engine-sigaltstack)  
<a id="erro-de-cors"></a>[Erro de CORS](runbook/deploy.md#erro-de-cors)  
<a id="sessao-nao-ativa"></a>[A sessão não sai de created](runbook/deploy.md#sessao-nao-ativa)  
<a id="terminal-preso-abrindo"></a>[A aba Terminal fica presa em "Abrindo terminal..." para sempre](runbook/deploy.md#terminal-preso-abrindo)  
<a id="runner-com-ticket-morto"></a>[O runner inunda a api com um ticket morto](runbook/deploy.md#runner-com-ticket-morto)  
<a id="segredo-de-oauth-no-boot"></a>[A api recusa subir por segredo de OAuth](runbook/deploy.md#segredo-de-oauth-no-boot)  
<a id="callback-login-social-nao-registrado"></a>[O provider recusa o callback do login social](runbook/deploy.md#callback-login-social-nao-registrado)  
<a id="segredos-irmaos-no-boot"></a>[Os quatro segredos irmãos também não sobem com o default](runbook/deploy.md#segredos-irmaos-no-boot)  
<a id="smtp-real"></a>[SMTP real no MailSender](runbook/deploy.md#smtp-real)  
<a id="k3d-is-the-default-even-with-kind-installed"></a>[k3d é o padrão mesmo com kind instalado](runbook/deploy.md#k3d-is-the-default-even-with-kind-installed)  
<a id="what-the-smoke-test-covers"></a>[O que o smoke test cobre](runbook/deploy.md#what-the-smoke-test-covers)  
<a id="diagnostico-do-deploy"></a>[Diagnóstico do deploy](runbook/deploy.md#diagnostico-do-deploy)  
<a id="403-on-internal-or-401-on-the-apis-calls-to-the-engine"></a>[403 no /internal/*, ou 401 nas chamadas da api para o engine](runbook/deploy.md#403-on-internal-or-401-on-the-apis-calls-to-the-engine)  
<a id="login-returning-401-for-everyone-after-a-deploy"></a>[Login devolvendo 401 para todo mundo depois de um deploy](runbook/deploy.md#login-returning-401-for-everyone-after-a-deploy)  
<a id="externalsecret-never-becomes-ready"></a>[O ExternalSecret nunca fica Ready](runbook/deploy.md#externalsecret-never-becomes-ready)  
<a id="engine-hpa-at-unknown"></a>[HPA do engine em <unknown>](runbook/deploy.md#engine-hpa-at-unknown)  
<a id="migration-job-doesnt-reapply"></a>[O Job de migração não reaplica](runbook/deploy.md#migration-job-doesnt-reapply)  
<a id="binengine-rpc-responds-eaddrinuse"></a>[bin/engine rpc responde eaddrinuse](runbook/deploy.md#binengine-rpc-responds-eaddrinuse)  
<a id="checking-that-the-engines-replicas-are-clustered"></a>[Conferindo que as réplicas do engine estão em cluster](runbook/deploy.md#checking-that-the-engines-replicas-are-clustered)  
<a id="fallback-sealed-secrets"></a>[Segredos: fallback para sealed-secrets](runbook/deploy.md#fallback-sealed-secrets)  
<a id="known-limits-of-this-environment"></a>[Limites conhecidos deste ambiente](runbook/deploy.md#known-limits-of-this-environment)  
<a id="rollout-do-engine"></a>[Rollout do engine](runbook/deploy.md#rollout-do-engine)  
<a id="what-happens-during-a-rollout-in-order"></a>[O que acontece durante um rollout, em ordem](runbook/deploy.md#what-happens-during-a-rollout-in-order)  
<a id="doing-the-rollout"></a>[Fazendo o rollout](runbook/deploy.md#doing-the-rollout)  
<a id="proving-nothing-was-left-orphaned"></a>[Provando que nada ficou órfão](runbook/deploy.md#proving-nothing-was-left-orphaned)  
<a id="quando-a-sessao-escapa"></a>[Quando a sessão escapa](runbook/deploy.md#quando-a-sessao-escapa)  
<a id="aumentar-a-janela-de-drain"></a>[Aumentar a janela de drain](runbook/deploy.md#aumentar-a-janela-de-drain)  
<a id="restore"></a>[Restore](runbook/restore.md#restore)  
<a id="what-is-backed-up-and-what-deliberately-is-not"></a>[O que tem backup, e o que deliberadamente não tem](runbook/restore.md#what-is-backed-up-and-what-deliberately-is-not)  
<a id="where-the-backup-lives"></a>[Onde o backup mora](runbook/restore.md#where-the-backup-lives)  
<a id="garantia-dos-bare-repos"></a>[O que o arquivo dos bare repos garante — e o que não garante](runbook/restore.md#garantia-dos-bare-repos)  
<a id="before-restoring-does-the-backup-exist-and-is-it-any-good"></a>[Antes de restaurar: o backup existe, e presta?](runbook/restore.md#before-restoring-does-the-backup-exist-and-is-it-any-good)  
<a id="restore-automatizado"></a>[O caminho automatizado (o mesmo que o teste roda)](runbook/restore.md#restore-automatizado)  
<a id="restore-de-verdade"></a>[Restaurando de verdade, durante um incidente](runbook/restore.md#restore-de-verdade)  
<a id="restore-compose-banco-vazio"></a>[Restaurando numa instalação compose (banco recém-criado)](runbook/restore.md#restore-compose-banco-vazio)  
<a id="what-the-restore-does-not-cover"></a>[O que o restore NÃO cobre](runbook/restore.md#what-the-restore-does-not-cover)  
<a id="restore-dos-bare-repos"></a>[Recuperando os bare repos](runbook/restore.md#restore-dos-bare-repos)  
<a id="perda-do-grafo"></a>[Perda do grafo (Neo4j)](runbook/restore.md#perda-do-grafo)  
<a id="reprojecao-em-janela"></a>[Rodando uma reprojeção completa: uma janela de manutenção, sem teto de tempo](runbook/restore.md#reprojecao-em-janela)  
<a id="perda-da-pasta-de-artefatos"></a>[Perda da pasta de artefatos (docs/)](runbook/restore.md#perda-da-pasta-de-artefatos)  
<a id="when-the-restore-fails"></a>[Quando o restore falha](runbook/restore.md#when-the-restore-fails)  
<a id="provas-de-propriedade-agendadas"></a>[Provas de propriedade agendadas](runbook/restore.md#provas-de-propriedade-agendadas)  
<a id="last-verified-run"></a>[Última execução verificada](runbook/restore.md#last-verified-run)  
<a id="what-this-run-found-and-that-the-test-now-prevents"></a>[O que esta execução achou (e que o teste agora impede)](runbook/restore.md#what-this-run-found-and-that-the-test-now-prevents)  
<a id="last-verified-run--compose-disk-destination"></a>[Última execução verificada — compose, destino em disco](runbook/restore.md#last-verified-run--compose-disk-destination)  
<a id="what-this-run-found"></a>[O que esta execução achou](runbook/restore.md#what-this-run-found)  
<a id="rotacao-das-chaves-do-auth"></a>[Rotação das chaves do auth](runbook/segredos.md#rotacao-das-chaves-do-auth)  
<a id="rotacao-do-auth-jwt-secret"></a>[AUTH_JWT_SECRET — rotação sem indisponibilidade](runbook/segredos.md#rotacao-do-auth-jwt-secret)  
<a id="troca-do-auth-token-pepper"></a>[AUTH_TOKEN_PEPPER — logout global, sem meio-termo](runbook/segredos.md#troca-do-auth-token-pepper)  
<a id="rotacao-do-brabo-service-token"></a>[BRABO_SERVICE_TOKEN — rotação sem indisponibilidade, dos dois lados](runbook/segredos.md#rotacao-do-brabo-service-token)  
<a id="rotacao-no-kubernetes"></a>[Fazendo no Kubernetes](runbook/segredos.md#rotacao-no-kubernetes)  
<a id="conta-travada-por-lockout"></a>[Conta travada por lockout](runbook/segredos.md#conta-travada-por-lockout)  
<a id="rotacao-da-chave-mestra"></a>[Rotação da chave mestra](runbook/segredos.md#rotacao-da-chave-mestra)  
<a id="whats-at-stake"></a>[O que está em jogo](runbook/segredos.md#whats-at-stake)  
<a id="before-size-it-up"></a>[Antes: dimensione](runbook/segredos.md#before-size-it-up)  
<a id="1-publish-both-keys"></a>[1. Publique as duas chaves](runbook/segredos.md#1-publish-both-keys)  
<a id="2-re-wrap-the-store"></a>[2. Re-embrulhe o acervo](runbook/segredos.md#2-re-wrap-the-store)  
<a id="3-discard-the-old-key"></a>[3. Descarte a chave antiga](runbook/segredos.md#3-discard-the-old-key)  
<a id="verifying-without-waiting-for-an-incident"></a>[Verificando sem esperar um incidente](runbook/segredos.md#verifying-without-waiting-for-an-incident)  
<a id="interaction-with-restore"></a>[Interação com o restore](runbook/segredos.md#interaction-with-restore)  
<a id="when-something-goes-wrong"></a>[Quando algo dá errado](runbook/segredos.md#when-something-goes-wrong)  
<a id="incidente-de-custo"></a>[Incidente de custo](runbook/operacao.md#incidente-de-custo)  
<a id="signal"></a>[Sinal](runbook/operacao.md#signal)  
<a id="1-which-project-which-agent"></a>[1. Qual projeto, qual agente](runbook/operacao.md#1-which-project-which-agent)  
<a id="2-check-the-budget"></a>[2. Confira o orçamento](runbook/operacao.md#2-check-the-budget)  
<a id="3-cut-the-spend"></a>[3. Corte o gasto](runbook/operacao.md#3-cut-the-spend)  
<a id="4-afterward"></a>[4. Depois](runbook/operacao.md#4-afterward)  
<a id="what-this-section-doesnt-fix"></a>[O que esta seção não conserta](runbook/operacao.md#what-this-section-doesnt-fix)  
<a id="observabilidade"></a>[Observabilidade](runbook/operacao.md#observabilidade)  
<a id="observabilidade-local"></a>[Observabilidade local, sem cluster](runbook/operacao.md#observabilidade-local)  
<a id="where-things-are"></a>[Onde as coisas estão](runbook/operacao.md#where-things-are)  
<a id="following-a-session-from-the-root-to-a-tool-call"></a>[Acompanhando uma sessão da raiz até uma chamada de ferramenta](runbook/operacao.md#following-a-session-from-the-root-to-a-tool-call)  
<a id="quando-nao-ha-trace-no-tempo"></a>[Quando não há trace no Tempo](runbook/operacao.md#quando-nao-ha-trace-no-tempo)  
<a id="when-a-panel-is-empty"></a>[Quando um painel está vazio](runbook/operacao.md#when-a-panel-is-empty)  
<a id="when-theres-no-log-in-loki"></a>[Quando não há log no Loki](runbook/operacao.md#when-theres-no-log-in-loki)  
<a id="alerts"></a>[Alertas](runbook/operacao.md#alerts)  
<a id="known-limits"></a>[Limites conhecidos](runbook/operacao.md#known-limits)  
<a id="registro-de-gates"></a>[Registro de gates](runbook/operacao.md#registro-de-gates)  
<a id="ambiente-de-inferencia"></a>[Ambiente de inferência](runbook/operacao.md#ambiente-de-inferencia)  
<a id="a-semantic-gate-on-a-small-model"></a>[Um gate semântico num modelo pequeno](runbook/operacao.md#a-semantic-gate-on-a-small-model)  
<a id="instalando"></a>[Instalando](runbook/instalacao.md#instalando)  
<a id="broker-na-instalacao"></a>[O broker de containers numa instalação](runbook/instalacao.md#broker-na-instalacao)  
<a id="modelos-locais-na-instalacao"></a>[Modelos locais numa instalação](runbook/instalacao.md#modelos-locais-na-instalacao)  
<a id="reinstalar-do-zero"></a>[Reinstalando do zero](runbook/instalacao.md#reinstalar-do-zero)  
<a id="verificar-artefato-publicado"></a>[Verificando um artefato publicado](runbook/instalacao.md#verificar-artefato-publicado)  
<a id="an-image-by-digest"></a>[Uma imagem, por digest](runbook/instalacao.md#an-image-by-digest)  
<a id="the-runner-binaries"></a>[Os binários do runner](runbook/instalacao.md#the-runner-binaries)  
<a id="when-verification-fails"></a>[Quando a verificação falha](runbook/instalacao.md#when-verification-fails)  
<a id="oferta-de-fonte-na-imagem"></a>[A oferta escrita de fonte, dentro de todo artefato publicado](runbook/instalacao.md#oferta-de-fonte-na-imagem)  
<a id="subindo-imagem-de-terceiro"></a>[Subindo uma imagem de terceiro](runbook/instalacao.md#subindo-imagem-de-terceiro)  
<a id="adicionando-um-provider-compativel"></a>[Acrescentando um provider compatível](runbook/instalacao.md#adicionando-um-provider-compativel)  
<a id="1-read-the-official-doc-before-writing-the-first-line"></a>[1. Leia a doc oficial antes de escrever a primeira linha](runbook/instalacao.md#1-read-the-official-doc-before-writing-the-first-line)  
<a id="2-write-the-config"></a>[2. Escreva a config](runbook/instalacao.md#2-write-the-config)  
<a id="3-run-the-contract-suite-against-it"></a>[3. Rode a suíte de contrato contra ele](runbook/instalacao.md#3-run-the-contract-suite-against-it)  
<a id="4-register-the-provider-and-the-credential-kind"></a>[4. Registre o provider e o tipo de credencial](runbook/instalacao.md#4-register-the-provider-and-the-credential-kind)  
<a id="5-seed-the-models-with-the-price-from-the-docs"></a>[5. Semeie os modelos com o preço da doc](runbook/instalacao.md#5-seed-the-models-with-the-price-from-the-docs)  
<a id="6-verify-with-a-real-credential"></a>[6. Verifique com uma credencial real](runbook/instalacao.md#6-verify-with-a-real-credential)  
