---
id: runbook
title: Операционный runbook
sidebar_label: Руководство по эксплуатации
sidebar_position: 4
description: Операционные процедуры Brabo — deploy, rollout, restore, ротация ключей, инцидент стоимости и наблюдаемость.
keywords: [runbook, operations, incident, restore, rollout, kubernetes]
traducao_de: d6ad631fba3edac691608e1f31d9000e12640253
---

# Операционный runbook

Один документ, потому что в 3 часа ночи никто не открывает каталог, чтобы выбрать
файл. Начинайте с триажа. Что доказывает каждая процедура и что запускает
это доказательство, указано в таблице в конце:
[Процедуры и как проверяется каждая из них](#procedimentos-e-verificacao).

## Триаж — от симптома к процедуре {#triage--from-symptom-to-procedure}

| что вы видите | куда идти |
|---|---|
| нужно поднять всё с нуля | [Локальный deploy](#deploy-local) |
| поды зависли, `ExternalSecret` никогда не Ready, HPA в `<unknown>` | [Диагностика deploy](#diagnostico-do-deploy) |
| предстоит rollout engine | [Rollout engine](#rollout-do-engine) |
| сессия `active` без процесса или зависла в `closing` | [Когда сессия ускользает](#quando-a-sessao-escapa) |
| потеряны данные / нужно проверить бэкап | [Restore](#restore) |
| нужно проверить или восстановить бэкап в установке **без кластера** | [Restore](#restore) — `make test-restore-compose` |
| проект provider-а `local` потерял репозиторий, или установка переносится на другую машину | [Восстановление bare-репозиториев](#restore-dos-bare-repos) |
| граф пуст после restore или миграции | [Потеря графа](#perda-do-grafo) — `grafo:reprojetar` |
| папка `docs/` проекта (артефакты агентов) пропала после restore, потери тома или конвертации режима | [Потеря папки артефактов](#perda-da-pasta-de-artefatos) — `artefatos:reprojetar` |
| учётные данные LLM или git перестали расшифровываться | [Ротация мастер-ключа](#rotacao-da-chave-mestra) |
| все разлогинены разом, или учётная запись заблокирована при входе | [Ротация ключей auth](#rotacao-das-chaves-do-auth) |
| почасовая стоимость резко выросла | [Инцидент стоимости](#incidente-de-custo) |
| пустая панель, нет trace, нет лога | [Наблюдаемость](#observabilidade) |
| неизвестно, какая версия запущена | [Какая версия в эфире](#que-versao-esta-no-ar) |
| `blocked by CORS policy` в консоли браузера | [Ошибка CORS](#erro-de-cors) |
| активация сессии ничего не делает, или `transition` возвращает `500` с `ECONNREFUSED` | [Сессия не выходит из `created`](#sessao-nao-ativa) |
| api завершается при загрузке, жалуясь на `GIT_OAUTH_STATE_SECRET` | [api отказывается стартовать из-за секрета OAuth](#segredo-de-oauth-no-boot) |
| «Entrar com GitHub/GitLab» возвращается от provider-а с ошибкой `redirect_uri` | [Provider отклоняет callback социального входа](#callback-login-social-nao-registrado) |
| api или engine завершаются при загрузке, жалуясь на `AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY`, `SECRET_KEY_BASE` или `NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD` | [Четыре родственных секрета тоже не стартуют со значением по умолчанию](#segredos-irmaos-no-boot) |
| нужно включить настоящий SMTP, или api завершается при загрузке, жалуясь на `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` | [Настоящий SMTP в `MailSender`](#smtp-real) |
| агент отвечает пусто, обрезанно или очень медленно | [Среда инференса](#ambiente-de-inferencia) |
| агент останавливается с `iteration limit reached`, ничего не сдав | [Среда инференса](#ambiente-de-inferencia) |
| нужно добавить OpenAI-совместимый provider LLM | [Добавление совместимого provider-а](#adicionando-um-provider-compativel) |
| нужно перенести workspaces из тома Docker в настоящую папку | [Перенос workspaces в локальную папку](#migrar-workspaces-pasta-local) |
| мастер проекта не предлагает режим **Pasta montada**, или создание смонтированного проекта отклоняется с сообщением, что путь должен быть внутри базы | [Проект в режиме Pasta montada: база проектов](#projeto-no-modo-local) |
| одобрение `container_start` в смонтированном проекте падает с сообщением, что api не смогла создать папку или добраться до неё | [Проект в режиме Pasta montada: база проектов](#projeto-no-modo-local) |
| `pnpm dev` отказывается стартовать, сообщая, что `BRABO_PROJECTS_BASE` пересекается с checkout-ом Brabo | [Проект в режиме Pasta montada: база проектов](#projeto-no-modo-local) |
| `brabo-runner` завершается с `base de projetos recusada` или печатает `base de projetos: nenhuma configurada`, когда ожидалась база | [База проектов runner-а](#base-do-runner) |
| `brabo-runner` всё печатает `nada a atender AINDA`, или unit машины запущен, но ни один проект не обслуживается | [Агент машины](#agente-de-maquina) |
| `systemctl --user status` показывает `Loaded: bad-setting` / `WorkingDirectory= path is not absolute`, и служба агента никогда не стартует | [Unit в состоянии `bad-setting`](#unit-do-agente-nao-inicia) |
| нужен ключ устройства для машины, а браузера нет (новая установка, машина без экрана) | [Ключ устройства через терминал](#chave-de-dispositivo-pelo-terminal) |
| установщик завершился блоком **«O que ficou pendente»**, или у новой установки нет ни учётной записи, ни ключа машины, ни службы агента | [Когда установщик не завершает установку](#instalador-nao-fecha) |
| папка проекта так и не появляется на машине пользователя, а в логе engine написано `workspace_create: o projeto <id> não criou pasta` | [Папка проекта так и не появляется](#pasta-do-projeto-nunca-aparece) |
| dev agent в проекте `runner` блокируется при подготовке worktree, называя `credencial-nao-atravessa-o-container`, с источником `politica` | [Аутентифицированный clone в режиме Runner](#credencial-nao-atravessa-o-container) |
| `apps/api/dist`/`node_modules` или файл, который агент записал в папку проекта, принадлежит `root`, и редактировать его без `sudo` нельзя | [Контейнеры dev пишут от имени вашего пользователя, а не root](#dev-containers-nao-root) |
| нужно поднять broker контейнеров, или он отвечает `permission denied` на сокете Docker | [Broker контейнеров](#broker-de-container) |
| provisioning репозитория падает с `permission denied: /data/git-repos/<slug>.git`, или `permissions.json` не удаётся записать | [Контейнеры dev пишут от имени вашего пользователя, а не root](#dev-containers-nao-root) |
| нужно удалить базу dev и начать заново, или `reset-total.sh` остановился посередине | [Полный сброс среды dev](#reset-total) |
| web показывает **429 (rate limit)** без видимой причины, или проект в режиме `runner` выглядит «без локального агента», пока `brabo-runner` работает | [Runner заваливает api мёртвым тикетом](#runner-com-ticket-morto) |

Две вещи, которые стоит знать до любой процедуры:

- **Тишина — не здоровье.** Правила алертов живут в Grafana, а не в Prometheus
  ([ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md)):
  Grafana недоступна — значит, нет ни одного предупреждения, а не нет ни одной проблемы.
- **Убийство пода не закрывает сессию.** `kubectl delete pod` без
  drain создаёт сироту. Путь — всегда обычный переход.

### Broker контейнеров {#broker-de-container}

Broker ([ADR 0130](adr/0130-broker-de-container.md)) — единственный процесс
продукта, который говорит с демоном Docker, и единственный сервис со
смонтированным `/var/run/docker.sock`. **Не монтируйте этот сокет больше нигде.**

**Локально он поднимается с `pnpm dev`; в production — нет.** Эта
асимметрия — решение ([ADR 0146](adr/0146-base-consentida-no-bootstrap.md),
пункт 3), а не недосмотр: не «унифицируйте» два файла compose. Тот, кто
запускает `pnpm dev`, **уже имеет сокет Docker** (он запускает
`docker compose` против демона собственного хоста), поэтому передача его broker-у
не даёт ничего, чего у оператора ещё нет. В production сокет — настоящая
граница привилегий, а оператор — не разработчик, поэтому там он
остаётся под `profiles: ["container-broker"]`.

До этого решения broker по умолчанию был выключен в обоих файлах с
аргументом, что «его пока ничто не вызывает». Это перестало быть правдой: у него четыре реальных вызывающих
([ADR 0133](adr/0133-infra-elege-imagem-do-roteamento.md)/
[0136](adr/0136-pagina-global-de-containers.md)), а
[ADR 0144](adr/0144-a-segunda-raiz-do-broker.md) заставил режим **Pasta montada** поднимать
свой контейнер *через* broker — так что при выключенном profile локальный режим
по умолчанию заканчивался `BrokerIndisponivelError`. Этот отказ по-прежнему то, что вы получаете, когда
broker действительно отсутствует: ИМЕНОВАННЫЙ `failed`, никогда не падение и никогда не
молчаливый откат к запуску вне контейнера.

Что ещё нужно задать — это gid, и ошибка в нём **не** ломает
загрузку, она ломает использование:

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

`BROKER_URL` в этом списке **больше нет**: у compose dev значение по умолчанию —
`http://broker:8090`, сервис, который он поднимает
([RN-599](business-rules/infra.md#rn-599)). До этого значения по умолчанию api отвечала
`brokerConfigurado: false` рядом со здоровым broker-ом, и создание проекта
предлагало только `runner`. Значение в `.env` по-прежнему побеждает; у compose production и
установки значения по умолчанию нет — намеренно.

Контейнер проекта работает от имени **владельца папки проекта** ([ADR 0180](adr/0180-container-com-o-dono-da-pasta.md), [RN-627](business-rules/contracts.md#rn-627)): api читает uid и gid папки, и broker запускает его с `--user <uid>:<gid>` и `HOME=/tmp`. Именно это позволяет dev agent писать в `/work` под `--cap-drop ALL`. Две вещи, которые нужно знать, когда это не работает: папка root, нечитаемая или отсутствующая, приводит к прежнему поведению (root внутри контейнера, без записи в папку другого uid — `npm install` отвечает `EACCES`); а уже существующий контейнер меняется только при пересоздании (`container_remove`, затем `container_start`).

`pnpm dev` также **сообщает** об управляемой папке при каждом запуске (RN-599): при
незаданной `PROJECT_WORKSPACES_HOST_DIR` `api`/`engine` используют управляемый том,
broker не получает `PROJECT_WORKSPACES_HOST_ROOT`, и `container_start` заканчивается
отказом — при здоровом стеке. Он сообщает также о `~` в пути (Compose
раскрывает его в bind mount, но не в переменной broker-а) и о явном
`PROJECT_WORKSPACES_HOST_ROOT`, отличающемся от папки, которую монтирует api.
Как и предупреждение о gid, он никогда не блокирует и никогда не пишет в `.env`; замена
тома на папку не переносит содержимое тома — см.
[перенос workspaces](#migrar-workspaces-pasta-local).

`pnpm dev` **сообщает** о состоянии `DOCKER_GID` при каждом запуске
([RN-512](business-rules/infra.md#rn-512)), сравнивая его с реальной группой вашей
машины, именно для того, чтобы расхождение не обнаружилось слишком поздно — когда кто-то
предлагает `container_start` и каждая операция умирает с `permission denied` на
сокете. Предупреждение никогда не блокирует, а на машине вообще без группы `docker`
(Docker Desktop, rootless) оно говорит, что вопрос неприменим, вместо того чтобы
обвинять вас в дефекте.

В production поднимайте его явно:

```bash
docker compose -f docker/docker-compose.prod.yml \
  --profile container-broker up -d broker
```

В **установке**, выполненной через `install.sh`, broker — тот же сервис
из опубликованного образа, и установщик спрашивает, включать ли его — см.
[broker в установке](#broker-na-instalacao)
([ADR 0162](adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)).

**У broker-а ДВА корня, и ни один не заменяет другой**
([RN-503](business-rules/api.md#rn-503),
[ADR 0144](adr/0144-a-segunda-raiz-do-broker.md)).
`PROJECT_WORKSPACES_HOST_ROOT` — место, где живут проекты режима **Container**;
`BRABO_PROJECTS_HOST_BASE` — место, где живут проекты режима **Pasta montada**, и
compose выводит его из `BRABO_PROJECTS_BASE`, так что задания базы обычно
достаточно. Какого бы ни не хватало, отказ называет его и не трогает ни одного
контейнера. Переход к другому корню смонтировал бы папку не того проекта
— управляемый корень именуется по `workspace_dir_name`, база именуется вами,
и одно и то же имя означает разные папки в каждом из них.

Чтобы проверить, что он запущен, — из api, единственного сервиса, который до него
дотягивается (сеть `broker` — `internal: true`, и сервис не публикует ни одного порта,
поэтому `curl` с вашего хоста не сработает, и в этом весь смысл):

```bash
docker compose -f docker/docker-compose.yml --env-file .env exec -T api \
  node -e "fetch('http://broker:8090/health').then(r=>r.text()).then(console.log)"
# esperado: {"status":"ok","servico":"broker"}
```

`/health` говорит о ПРОЦЕССЕ, никогда о демоне. Перезапуск
broker-а не чинит упавший Docker, а healthcheck, падающий по
этой причине, породил бы цикл перезапусков, который ничего не решает.

**Локальный образ устанавливает зависимости при BUILD, и это не
оптимизация.** Единственная сеть broker-а — `internal: true`, поэтому в runtime нет
доступного registry: образ, который запускал `corepack`/`pnpm install` при
старте, умирал с `getaddrinfo EAI_AGAIN registry.npmjs.org` и завершался с 1.
Исправление убрало registry с пути runtime (`pnpm install` как шаг build),
вместо того чтобы открыть сеть — сеть является первым из пяти
слоёв сдерживания. Начиная с AT-360 ни один образ не использует corepack (Node 25+ его
больше не содержит): каждый Dockerfile устанавливает pnpm из tarball registry, проверенного
по sha512, записанному в Dockerfile (`PNPM_SHA512`), в
`/usr/local/bin`. Его версия совпадает с `packageManager` в `package.json`, поэтому
pnpm никогда не пытается ничего скачать в runtime — измерено на образе dev
под `--network none`: `pnpm --version` печатает `11.3.0`, и `/health`
отвечает. Обновление pnpm означает совместное изменение `packageManager`, `PNPM_VERSION` и
`PNPM_SHA512` (`npm view pnpm@<v> dist.integrity`, в hex).

Два следствия, с которыми вы столкнётесь:

- **Три `node_modules` — именованные тома, смонтированные поверх того, что установил
  образ**, а Docker заполняет том из образа, только когда том
  ПУСТ. Поэтому `docker/broker/entrypoint.sh` сверяет их с копией,
  хранящейся вне `/workspace` и помеченной sha256 того `pnpm-lock.yaml`,
  с которым был собран образ. Первая загрузка после `--build` пишет
  `sincronizando…` и занимает несколько секунд; последующие ничего не пишут.
- **Изменение зависимости broker-а требует `up -d --build broker`.**
  Entrypoint сравнивает свою метку с lockfile рабочего дерева и ПРЕДУПРЕЖДАЕТ, когда
  они различаются. Он предупреждает, а не отказывается загружаться: у broker-а нет зависимостей
  runtime, кроме ссылки workspace на `@brabo/docker-port`, и замена
  предупреждения недоступностью была бы хуже.

У сервиса также есть **healthcheck** (`wget` к `127.0.0.1:8090/health`
изнутри контейнера — он не публикует порт, а в `node:26-alpine` нет
`curl`). Без него `up --wait` сообщал `Healthy` в момент старта контейнера,
и `scripts/dev/reset-total.sh` объявлял «reset completo» с
broker-ом, умершим пятью секундами раньше.

**Симптомы и что означает каждый:**

| что вы видите | что это |
|---|---|
| `permission denied` на `/var/run/docker.sock` | неверный `DOCKER_GID`. Сокет — `root:docker`, а broker работает не от root; повторите шаг 1 выше и пересоздайте контейнер (`up -d --force-recreate broker`) |
| `não encontrei o executável docker no PATH` | образ собран без `docker-cli`. Пересоберите его (`--build`). Эта ошибка намеренно ОТДЕЛЕНА от «демон недоступен»: установка и запуск — разные исправления |
| `getaddrinfo EAI_AGAIN registry.npmjs.org`, и контейнер завершается с 1 | образ broker-а, собранный до переноса зависимостей в build. Пересоберите его (`up -d --build broker`). НЕ давайте сервису выход в сеть: сеть `internal: true` — это сдерживание, и с пути runtime должен уйти registry |
| `AVISO — pnpm-lock.yaml mudou desde o build desta imagem` | образ старше lockfile рабочего дерева. Он продолжает работать (у broker-а нет зависимостей runtime, кроме ссылки workspace); пересоберите, когда вы действительно изменили зависимость broker-а |
| `PROJECT_WORKSPACES_HOST_ROOT não está definida` при `start` | ожидаемо, и отказ — правильное поведение. `-v` разрешается ДЕМОНОМ относительно файловой системы ХОСТА; угадывание смонтировало бы ПУСТУЮ папку, и dev agent работал бы в каталоге без кода. Остальные четыре операции работают и без неё |
| маршрут жизненного цикла говорит `naoObservado: "broker-nao-configurado"` | `BROKER_URL` пуста в **api**. Это нормальное состояние, а не сбой — чтение объявляет, что не смотрело, вместо того чтобы унаследовать зарегистрированное состояние ([RN-486](business-rules/api.md#rn-486)) |
| маршрут жизненного цикла говорит `naoObservado: "broker-sem-resposta"` | `BROKER_URL` задана, и ничто не ответило: вероятно, profile выключен или api не в сети `broker`. Если `detalhe` говорит ``não respondeu `inspect` dentro do teto desta operação (5000ms)``, broker ДОСТУПЕН и медлит — смотрите на демон, а не на сеть ([RN-604](business-rules/api.md#rn-604)) |
| команда терминала или `container_start` падает с ``não respondeu `exec` dentro do teto desta operação`` (или `start`/`stop`/`remove`) | api перестала ждать по собственному пределу этой операции, а не потому, что broker недоступен ([RN-604](business-rules/api.md#rn-604)). При `exec` команда может всё ещё выполняться внутри контейнера; при `start`/`stop`/`remove` эффект мог произойти — проверьте `/containers` перед повтором. `start`, у которого pull образа длится дольше 30s, обрывается самим broker-ом — для этого ниже есть отдельная строка |
| результат терминала dev agent говорит ``o comando passou do teto de execução de terminal (120s, TERMINAL_ACTION_TIMEOUT_MS)`` | команда выполнялась дольше `TERMINAL_ACTION_TIMEOUT_MS` (по умолчанию 120 s начиная с [RN-757](business-rules/engine.md#rn-757); было 15 s), и engine перестал ждать; процесс может ещё выполняться в контейнере. Агенту предписано запустить её снова под `nohup … &`. Поднять переменную можно, но выше ~180 s внешнее ожидание engine (значение + 120 s) превышает предел в 300 s на заголовки `fetch` Node в api, и обрыв возвращается |
| `container_start` падает с ``o `docker pull <imagem>` não terminou dentro do teto de 30000ms e foi cancelado`` (broker отвечает `504`, `origem: infra`) | образа нет в демоне, и его pull не укладывается в управляющий предел 30s. Убийство CLI отменяет pull, так что образ остаётся отсутствующим — повтор не поможет. Выполните pull на хосте, где работают контейнеры (`docker pull <imagem>`; в режиме `runner` — на машине пользователя), и одобрите start снова. Большие образы не поднимаются этим путём с первой попытки — по решению мейнтейнера ([RN-605](business-rules/contracts.md#rn-605)) |
| `BRABO_PROJECTS_HOST_BASE não está definida` при `start` проекта **Pasta montada** | та же форма, что и в строке выше, другой корень. Задайте `BRABO_PROJECTS_BASE` в `.env` и пересоздайте broker; compose выводит эту переменную из неё ([RN-503](business-rules/api.md#rn-503)) |
| broker отвечает `409` для проекта в режиме `runner` | ожидаемо. Эта папка живёт на машине пользователя, и этот хост её не видит — там контейнер поднимает runner ([ADR 0137](adr/0137-o-runner-sobe-o-container-do-projeto.md)) |
| broker отвечает `409`, говоря, что не знает, где папка проекта | УСТАРЕВШИЙ проект **Pasta montada**, созданный до появления базы и живущий вне неё. Исправление — перенести папку внутрь `BRABO_PROJECTS_BASE`, а не менять режим проекта — сообщение называет базу и путь, который оно увидело ([RN-503](business-rules/api.md#rn-503)) |

**Broker никогда не поднимает контейнер сам.** Нет ни цикла, ни
очереди: он действует, когда его вызывают, и каждый вызов на запись рождается из
`proposed_action`, одобренного человеком.

### Перенос workspaces в локальную папку {#migrar-workspaces-pasta-local}

Задание `PROJECT_WORKSPACES_HOST_DIR`/`GIT_LOCAL_REPOS_HOST_DIR`
([Первые шаги](getting-started.md#local-folder-for-workspaces)) заменяет
том Docker указанной папкой — но **не копирует** то, что уже
было в старом томе. Тому, у кого уже есть созданные проекты и кто не
хочет потерять работу, нужно скопировать содержимое до замены:

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

Имя тома (`brabo-dev_project_workspaces`) несёт префикс проекта
Compose (`name: brabo-dev` в `docker/docker-compose.yml`, [ADR
0170](adr/0170-compose-de-dev-brabo-dev.md)) — проверьте через `docker volume ls`.
У среды dev, созданной до ADR 0170, данные ещё лежат под `brabo_*`: сначала см.
[Перенос среды dev в brabo-dev](#dev-para-brabo-dev). Старый том продолжает существовать
и после (Compose не удаляет том, вышедший из употребления); удалите его
через `docker volume rm`, когда будете уверены, что копирование сработало.

### Проект в режиме Pasta montada: база проектов {#projeto-no-modo-local}

**Симптом:** мастер проекта даже не предлагает **Pasta montada**; или
предлагает, а api отвечает `400`, сообщая, что папка *не существует
изнутри api*.

Оба случая проистекают из одного факта: проект в режиме Pasta montada хранит код в
**вашей** папке, а api и engine добираются до неё, только если она
смонтирована в их контейнеры. Изменилось
([ADR 0141](adr/0141-base-unica-dos-projetos-montados.md),
[RN-500](business-rules/api.md#rn-500)) то, кто это устраивает и как часто:
теперь есть **одна база**, настраиваемая оператором один раз, и каждый
смонтированный проект живёт внутри неё. Вам больше никогда не нужно править compose для
каждого проекта.

**Что делать — один раз, для всей установки.** Поддерживаемый путь —
шаг согласия ([ADR 0146](adr/0146-base-consentida-no-bootstrap.md)), который
предлагает папку, отклоняет ту, что пересекается с checkout-ом Brabo или с
`PROJECT_WORKSPACES_HOST_DIR`, проверяет на macOS/Windows, что Docker её видит,
создаёт её и записывает переменную:

```bash
node scripts/dev/consentir-base.mjs
```

Запускайте его в **своём** терминале. `pnpm bootstrap` → *Docker › Base de projetos*
запускает тот же скрипт, но может только **сообщить**: каждый пункт меню намеренно запускается со stdin
из `/dev/null`, поэтому он не может задавать вопросы.

Ручная запись строки по-прежнему работает:

```bash
# .env — caminho ABSOLUTO. O `~` NÃO é expandido pelo Compose.
BRABO_PROJECTS_BASE=/home/voce/projetos-brabo
```

```bash
docker compose -f docker/docker-compose.yml --env-file .env up -d api engine
```

Вот и всё. Отныне проект в режиме Pasta montada попадает куда-то под
`/home/voce/brabo` и больше не требует настройки.

**Самой папке пока не обязательно существовать**
([ADR 0142](adr/0142-validacao-de-workspace-montado-adiada.md),
[RN-501](business-rules/api.md#rn-501)). Создание проекта Pasta montada проверяет
только ФОРМАТ пути плюс «находится под базой»; папка создаётся
позже, когда Infra поднимает контейнер проекта, — именно это позволяет
мастеру для начала ПРЕДЛОЖИТЬ `<base>/<slug do projeto>`. Между
этими двумя моментами `workspacePath` указывает на папку, которой там ещё нет,
а `workspaceVerifiedAt` проекта равен `null`; конвертация существующего проекта
в Pasta montada — единственное исключение и создаёт папку сразу,
потому что переносит `permissions.json` внутрь неё.

Поэтому `400` при создании теперь означает лишь одно из двух, и оба называют то, что
имеют в виду: путь не находится под базой (сообщение называет базу и
предлагает `<base>/<nome>`), или `BRABO_PROJECTS_BASE` вообще не настроена
(сообщение говорит, что РЕЖИМ недоступен в этой установке). Папка,
которую api не может создать или до которой не может добраться, проявляется позже, как ИМЕНОВАННЫЙ `failed`
в действии `container_start` — никогда не 500, и жизненный цикл контейнера
при этом не помечается `provisioning`.

**Смонтированные проекты получают настоящий контейнер, и он работает на СЕРВЕРЕ**
([RN-503](business-rules/api.md#rn-503),
[ADR 0144](adr/0144-a-segunda-raiz-do-broker.md)). Поскольку база
доступна демону Docker хоста, `container_start` проекта Pasta montada
идёт в [broker](#broker-de-container), точно как режим Container, — он
перестал требовать подключённого `brabo-runner`. Только режим **Runner** по-прежнему идёт в
runner, на собственной машине пользователя, потому что та папка находится там, где этот
сервер её не видит. Локально broker уже запущен — он идёт вместе с `pnpm dev`
начиная с [ADR 0146](adr/0146-base-consentida-no-bootstrap.md), именно потому, что
это путь режима по умолчанию; в production ему всё ещё нужен
`--profile container-broker`. Этот же шаг — момент, когда создаётся папка выше,
в таком порядке: демон делает bind-mount только той папки, которая уже
существует.

**Почему мастер скрывает режим Pasta montada.** Без `BRABO_PROJECTS_BASE`
api сообщает `projectsBase: null`, и вариант даже не предлагается. Это
сделано намеренно: предложение режима, который установка не может обеспечить, порождает
проект, который ломается позже, на первом инструменте первого агента, далеко
от экрана, где было принято решение. Режим Container (по умолчанию)
и режим Runner не затронуты и продолжают работать без этой переменной.

**Почему один и тот же путь с обеих сторон.** База монтируется по **идентичности** —
`/home/voce/brabo:/home/voce/brabo` — в `api` и `engine` одинаково. Путь
записывается ОДИН раз в `projects.workspace_path` и читается обоими процессами
([RN-169](business-rules/api.md#rn-169)); это также строка,
которую экран показывает вам обратно. Монтирование в другое место заставило бы
engine писать туда, где api не читает, и заставило бы экран показывать
путь, который не существует ни на вашей машине, ни на их.

**Проверьте, что контейнеры видят на самом деле:**

```bash
docker compose -f docker/docker-compose.yml exec api    ls -la /home/voce/brabo
docker compose -f docker/docker-compose.yml exec engine ls -la /home/voce/brabo
```

**Не направляйте базу на сам checkout Brabo.** `pnpm dev` отказывается
поднимать стек, когда `BRABO_PROJECTS_BASE` содержит или содержится в
клонированном вами репозитории, — он называет оба пути и останавливается. Эта проверка живёт
в preflight и больше нигде — намеренно: api сравнивает путь проекта
с `process.cwd()`, который внутри её контейнера равен `/workspace`,
поэтому она не может увидеть ваш настоящий checkout. Без защиты preflight
клонирование Brabo в `$HOME/brabo` и задание базы на ту же папку
проходит любую проверку и запускает dev agents внутри собственного
дерева продукта — тот самый сбой, для предотвращения которого
существует [ADR 0055](adr/0055-escopo-de-caminho-na-politica-de-terminal.md).

**Выберите выделенную папку.** Всё под базой доступно
изнутри контейнеров продукта. Не направляйте её на весь ваш `$HOME` и
не направляйте на папку, где хранятся другие ваши секреты.

**Другие виды отказа и что означает каждый:**

| сообщение говорит | что делать |
|---|---|
| режим Pasta montada даже не предлагается | `BRABO_PROJECTS_BASE` не задана — задайте её и `up -d api engine` |
| *o modo Pasta montada não está disponível nesta instalação* (при создании) | та же причина, сказанная api: `BRABO_PROJECTS_BASE` не задана (RN-501) |
| *a pasta tem de ficar dentro de `<base>`* (при создании) | путь вне базы; используйте `<base>/<nome>`, который предлагает сообщение, или измените базу и `up -d api engine` |
| *não consegui criar/alcançar `<caminho>` de dentro da api* (при `container_start`) | база фактически не смонтирована, или владелец папки на хосте её блокирует. Проверьте через `exec ls` выше, исправьте и снова одобрите `container_start` (RN-501) |
| *não existe de dentro da api* | база не смонтирована в контейнеры; проверьте через `exec ls` выше |
| *existe mas não é uma pasta* | путь указывает на файл; используйте папку |
| *o processo não consegue escrever nela* | владелец/права папки на хосте. Образы работают не от root ([ADR 0024](adr/0024-fase5-imagens-producao-ci.md)); исправьте владельца или режим папки |
| *Caminho inválido para um projeto Local* | это корень файловой системы, системная папка, относительный путь, содержит `..` или пересекается с самим checkout-ом Brabo — выберите свою папку вне этого ([ADR 0072](adr/0072-projeto-local-ou-container.md)) |

**Известные ограничения, объявленные, а не скрытые.** Symlink под базой,
указывающий за её пределы, разрешается внутри контейнеров иначе, поскольку
цель не смонтирована, — браузер папок отказывается спускаться по symlink-ам,
а дисковая проверка ловит расхождение как именованный сбой. И эта
версия поддерживает **одну** базу: код, который живёт в другом месте, нужно перенести
внутрь неё.

**Переход со старых монтирований по проектам.** Если у вас есть написанные вручную строки
`- /home/voce/projetos/loja:/home/voce/projetos/loja` в `api` и
`engine`, они продолжают работать, и ничто их не удаляет — существующие проекты
этим изменением не ломаются. Поддерживаемый путь отныне — база;
перенесите эти папки внутрь неё и уберите написанные вручную строки, когда будет
возможность.

**Не путайте это с режимом Container.** Проект в режиме Container
(по умолчанию) продолжает использовать `PROJECT_WORKSPACES_ROOT` и процедуру
переноса выше; режим Pasta montada никогда не трогает этот корень, и база
никогда не является той же папкой, что этот корень ([ADR 0141](adr/0141-base-unica-dos-projetos-montados.md)
объясняет, почему их смешение привело бы к тому, что два проекта попадут в одну папку).

### База проектов runner-а {#base-do-runner}

**Симптом:** `brabo-runner` завершается с кодом 2, сообщая
`base de projetos recusada (…)`, или начинает с печати
`base de projetos: nenhuma configurada`, когда вы ожидали базу, или говорит,
что он `Seguindo SEM base`.

Это **другая база**, не та, что в
[Проект в режиме Pasta montada](#projeto-no-modo-local). Та
(`BRABO_PROJECTS_BASE`) принадлежит СЕРВЕРУ и является единственной папкой, которую
видят контейнеры; эта принадлежит **машине пользователя** и является местом, где
локальный агент создаёт папку каждого проекта
([ADR 0151](adr/0151-base-consentida-no-runner.md),
[RN-529](business-rules/runner.md#rn-529)). Это никогда не одна и та же переменная, никогда
не один и тот же файл, и они никогда не проверяются друг против друга.

Откуда runner её читает, по порядку:

1. `--base <caminho absoluto>` в командной строке;
2. `$XDG_CONFIG_HOME/brabo/runner.json` — с откатом на
   `~/.config/brabo/runner.json` — в форме `{"base": "/abs/path"}`.

```bash
cat "${XDG_CONFIG_HOME:-$HOME/.config}/brabo/runner.json"
# {"base":"/home/you/projetos-brabo"}
```

**Отсутствие базы — это нормально.** Runner без базы продолжает обслуживать свой проект
точно так же, как всегда; чего он не может — это разместить папку проекта, созданного
позже. Стартовая строка всегда говорит, в каком из двух состояний вы находитесь.

Эта папка перестала быть только конфигурацией: начиная с
[RN-551](business-rules/runner.md#rn-551) это также место, куда
`brabo-runner device-key create` кладёт **приватный** ключ устройства машины
(`brabo-runner-device-key.jwk.json`, режим 600) — см.
[Ключ устройства через терминал](#chave-de-dispositivo-pelo-terminal). Делайте её бэкап
как бэкап секрета или не делайте бэкап вовсе и выполните сопряжение заново: ключ
отзываем и заменяем, и больше ничто в продукте не может его прочитать.

**Отказы и почему их обработка различается.** База отклоняется, когда она
относительная, содержит `..`, равна `/`, указывает на существующий файл, находится вне `$HOME`
в Linux (то же правило, что у `--dir` начиная с
[RN-434](business-rules/runner.md#rn-434)), или находится **внутри** папки текущего
проекта (или равна ей) — последнее заставило бы каждый новый проект рождаться
внутри этого. При получении из `--base` это завершает процесс с кодом 2;
при получении из файла это печатается в `stderr`, и runner **продолжает
без базы**, потому что убивать агента, обслуживающего проект, из-за
конфигурации, которую он ещё даже не использует, было бы непропорционально. Файл, который существует и
не объявляет `base`, — это отсутствие, а не отказ.

**Проект вне базы — не проблема.** `--dir` проверяется точно
так же, как всегда, и база в этом не участвует: база — правило
СОЗДАНИЯ. Не «чините» устаревший проект, перенося его внутрь базы, чтобы что-то
заглушить, — ничто не жалуется.

### Агент машины: одно подключение на проект {#agente-de-maquina}

**Симптом:** `brabo-runner` запущен без `--project` и либо напечатал
блок использования, либо сказал `nenhum projeto em modo "runner" para esta conta`, либо
обслужил одни проекты и отклонил другие.

Начиная с [RN-544](business-rules/runner.md#rn-544)
([ADR 0154](adr/0154-chave-de-dispositivo-de-maquina.md)) запуск без
`--project` — настоящий режим: агент запрашивает `GET /runner/projects` и открывает
**одно подключение на проект**, укоренённое в `<base>/<workspaceDirName>`. Режим
с `--project` никак не изменился. Чтение вывода:

- **`Sem --project, este runner só roda como agente de MÁQUINA…`** — нет
  согласованной базы. Требуются оба условия, и по разным причинам:
  учётные данные машины — то, что принимает маршрут, база — откуда берётся папка каждого
  проекта. См. [базу выше](#base-do-runner).
- **`a api recusou a descoberta de projetos: esta credencial está presa a um
  PROJETO`** — 403. Используемые учётные данные (PAT или ключ устройства из
  потока браузера) называют проект, и обнаруживать нечего. Запустите его с
  `--project <projectId>` вместо этого или выполните сопряжение ключа машины — материал ключа
  создаётся прямо здесь (`brabo-runner device-key create`, см.
  [ниже](#chave-de-dispositivo-pelo-terminal)), а регистрация публичной
  половины — то, что делает установщик. На диске оба вида — один и тот же файл,
  поэтому runner не угадывает: сервер — авторитет, и его сообщение
  передаётся дословно.
- **`nenhum projeto em modo "runner" para esta conta — nada a atender AINDA`** —
  это **нормальное** состояние новой установки, и начиная с
  [RN-550](business-rules/runner.md#rn-550) процесс **остаётся запущенным и продолжает спрашивать**:
  15s, затем 30s, затем 60s между вызовами, повторяя бесконечно, пока не появится первый
  проект. Никому не нужно возвращаться в терминал — создайте
  проект в режиме Runner в web, и агент его подхватит. Опрос
  **останавливается** в момент, когда первое подключение живо: с этого момента список
  читается только при старте, потому что список, вернувшийся *меньшим*, неоднозначен, и
  обрыв живого подключения из-за этой неоднозначности променял бы известное состояние на
  догадку. Ожидание не имеет предела; **сбой имеет** — десять неудачных вызовов
  подряд, и процесс завершается с 1, называя счётчик (любой ответ, включая пустой,
  обнуляет счётчик). Каждые 30 пустых ответов он печатает пульс, сообщающий, сколько
  было вызовов, чтобы «ожидание» никогда не выглядело как «зависание» в
  `journalctl`. `Restart=on-abnormal` не изменился ни в одном из двух видов unit — он
  изначально никогда не смотрел на код выхода; меняется то, что unit машины
  теперь действительно `active (running)`, и `brabo-runner service status
  --machine` отвечает `rodando` (0) в новой установке, где раньше отвечал
  `parado` (3).
- **`[<projeto>] NÃO será atendido`** — папка этого проекта отклонена
  (сегмент вышел за базу, или цель существует и не является каталогом).
  Остальные продолжают. Только если не осталось НИ ОДНОГО, процесс завершается с 1.
- **`[<projeto>] este projeto deixa de ser atendido — os demais continuam`** —
  join отклонён (обычно второй runner уже подключён к этому
  проекту) или исчерпан предел повторных попыток. Оба теперь — на уровне ПРОЕКТА, а не
  процесса: падение одного проекта больше не роняет агента для всех остальных.
  Когда все проекты закончились так, процесс печатает исход каждого
  и завершается с 1.

Каждая строка цикла подключения несёт имя проекта как префикс. Если у
сообщения нет префикса, оно пришло из режима единственного проекта.

### Unit в состоянии `bad-setting` и никогда не стартует {#unit-do-agente-nao-inicia}

**Симптом:** `service install` сообщил об успехе, файл unit на диске, и
тем не менее ничего не работает:

```
$ systemctl --user status brabo-runner.service
   Loaded: bad-setting (Reason: Unit brabo-runner.service has a bad unit file setting.)
   Active: inactive (dead)
brabo-runner.service:16: WorkingDirectory= path is not absolute: "/home/<you>/.config/brabo"
```

**Причина.** Unit-ы, записанные **до** этого исправления, заключали рабочий каталог в кавычки
(`WorkingDirectory="/home/…"`). Две половины файла unit не разделяют
синтаксис: `ExecStart=` интерпретируется со снятием кавычек и разделением на слова, поэтому каждый
аргумент заключается в кавычки; `WorkingDirectory=` — **нет**: systemd берёт остаток
строки как путь. С кавычками значение перестаёт начинаться с `/`,
unit отклоняется при загрузке и **никогда не стартует** — в любом из видов
(по проекту и по машине одинаково, [RN-518](business-rules/runner.md#rn-518) и
[RN-545](business-rules/runner.md#rn-545)).

**Исправление: переустановите.** `service install` перезаписывает файл целиком, поэтому нет
шага починки и нечего править вручную:

```bash
brabo-runner service install --machine \
  --dir "${XDG_CONFIG_HOME:-$HOME/.config}/brabo" \
  --api-url http://localhost:3000
# ou, para uma unit por projeto, de dentro da pasta daquele projeto:
brabo-runner service install
```

`status` и `uninstall` продолжают работать с unit в сломанном состоянии —
папка считывается обратно в любой из форм, — так что ничего не застревает, если вы
предпочтёте сначала её удалить.

**Связанное, но другое:** unit, который загружается, но стартует не в той папке.
`WorkingDirectory=` проходит **раскрытие спецификаторов**, поэтому буквальный `%`
в пути нужно писать как `%%`; CLI теперь его экранирует, но вручную отредактированный unit
с `/home/you/50%off` молча стартует в `/home/you/50<os-id>ff` —
абсолютный, принятый и неверный. Проверяйте разрешённое значение, никогда не файл:

```bash
systemctl --user show -p WorkingDirectory brabo-runner.service
```

То же относится к **окружению**, которое unit замораживает (AT-095). Unit-ы, записанные
до этого исправления, несли `Environment=XDG_CONFIG_HOME=<pasta>` и
`Environment=PATH=<caminho>` без кавычек, а `Environment=` как разделяет по пробелам,
так и раскрывает спецификаторы: с `XDG_CONFIG_HOME=/home/you/50%off com espaco`
служба получала `/home/you/50<os-id>ff` — загружается, стартует, и
агент машины ищет базу и ключ устройства в папке, которой не
существует, ничего не сообщая. CLI теперь записывает присваивание целиком в кавычках
(`Environment="XDG_CONFIG_HOME=…"`, с экранированными `\`, `"` и `%`). **Исправление:
переустановите**, как выше. Проверьте, что разрешил systemd:

```bash
systemctl --user show -p Environment brabo-runner.service
```

### Ключ устройства через терминал {#chave-de-dispositivo-pelo-terminal}

**Симптом:** машине нужен ключ устройства, а браузера для запуска
автоматической настройки с экрана проекта нет — новая установка, машина без экрана или
агент машины выше, отказывающий с `esta credencial está presa a um PROJETO`.

Начиная с [RN-551](business-rules/runner.md#rn-551)
([ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md), пункт 4) пара
генерируется **на машине**, в два шага:

```bash
# 1) gere aqui; a JWK PÚBLICA é a única coisa no stdout
PUB=$(brabo-runner device-key create)

# 2) registre essa chave pública na api — quem tem a credencial para
#    registrar faz isso; o CLI nunca fala com a api
ID=$(… POST {"name":"…","publicKeyJwk":'"$PUB"'} … | jq -r .id)

# 3) carimbe o id do registro como o `kid` da JWK e escreva o arquivo de verdade
brabo-runner device-key finish --id "$ID"
```

- **Два шага — из-за `kid`.** Он ЯВЛЯЕТСЯ id записи на сервере
  ([RN-475](business-rules/web.md#rn-475)) и существует только после регистрации публичной
  половины; приватный ключ, записанный до него, бесполезен, и CLI отклоняет его
  навсегда. Поэтому `create` пишет `brabo-runner-device-key.jwk.json.parcial` —
  имя, которое читатель игнорирует, — а `finish` пишет настоящий. **Файл, который
  читает runner, никогда не существует без `kid`** — прерывание между двумя шагами
  оставляет `.parcial`, который runner игнорирует и который называет следующий `create`.
- **Где:** `$XDG_CONFIG_HOME/brabo/` (иначе `~/.config/brabo/`), рядом с
  `runner.json`, в режиме 600; `--dir <pasta>` пишет в другое место (например,
  в папку проекта). Эта папка — то, куда должен указывать `--dir` unit-а машины
  (`brabo-runner service install --machine --dir <pasta>`,
  [RN-545](business-rules/runner.md#rn-545)) — runner читает ключ из
  папки, в которой он РАБОТАЕТ, никогда не из глобального пути, который он угадывает.
- **stdout — для скриптов, stderr — для людей.** `create` печатает только
  публичный JWK; `finish` — только путь к готовому файлу.
- **Отказы:** `finish` без `create` (нечего штамповать), без `--id`,
  с `--id`, внутри которого всё ещё целый JSON-ответ, `.parcial`,
  который не является приватным JWK Ed25519, и — в обеих командах — ПОЛНЫЙ ключ,
  уже лежащий на месте. У последнего нет `--force`: молчаливая замена ключа
  уже сопряжённой машины оставила бы агента, подписывающего ключом, которого
  сервер не знает. Отзовите текущий ключ
  ([RN-519](business-rules/api.md#rn-519)), удалите файл, затем снова `create`.
- CLI **не** утверждает, какого вида ключ. На диске ключ машины
  и ключ проекта — один и тот же файл; решает маршрут, который зарегистрировал публичную
  половину.

### Когда установщик не завершает установку {#instalador-nao-fecha}

**Симптом:** `install.sh` завершился блоком **«O que ficou pendente»**, или у
новой установки есть вход, через который никто не может пройти, нет ключа устройства машины или нет
запущенной службы агента.

Начиная с [RN-547](business-rules/produto.md#rn-547)
([ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)) установщик
**завершает** установку: он создаёт первую учётную запись, регистрирует ключ устройства этой
машины и устанавливает unit машины. Цепочка такова:

1. `POST /internal/first-account` ([RN-546](business-rules/produto.md#rn-546)) —
   учётная запись рождается **уже подтверждённой**, потому что `MAIL_TRANSPORT` равен `log` и
   установщик не включает SMTP;
2. `brabo-runner device-key create` ([RN-551](business-rules/runner.md#rn-551)) —
   пара Ed25519 генерируется **на машине**; передаётся только публичная половина;
3. `POST /internal/machine-device-keys` ([RN-552](business-rules/api.md#rn-552)) —
   возвращённый `id` становится `kid` приватного JWK
   ([RN-475](business-rules/web.md#rn-475));
4. `brabo-runner device-key finish --id <id>`;
5. `brabo-runner service install --machine` ([RN-545](business-rules/runner.md#rn-545)).

**Ничто никогда не откатывается, и каждый сбой назван.** Установщик всегда
завершается с 0: compose запущен, а уже выполненные звенья полезны сами
по себе. То, что не удалось, печатается в конце с точной командой для повтора.

- **`service install --machine` отказал.** Это **обычный** случай на
  машине разработчика, а не граничный: он отказывает, когда unit **по проекту** уже
  установлен, и `--force` нет — два процесса боролись бы за
  один проект, и сервер отказал бы одному из них. Отказ называет
  `uninstall` каждого найденного unit. Удалите их, затем снова выполните последний шаг, который
  напечатал установщик:

  ```bash
  brabo-runner service uninstall --project <projectId>   # para cada uma nomeada
  brabo-runner service install --machine \
    --dir "${XDG_CONFIG_HOME:-$HOME/.config}/brabo" \
    --api-url http://localhost:3000
  ```

  Папка в `--dir` — та, куда был записан ключ, — никогда не папка проекта,
  в которой лежал бы `brabo-runner.config.json` и которая заставила бы unit стартовать в режиме
  **проекта**, молча обслуживая один проект, называя себя
  агентом машины.

- **Регистрация ключа не удалась.** `…jwk.json.parcial` намеренно остаётся
  на месте. Он инертен — runner не читает это имя — и установщик
  **не** удаляет его: timeout после commit в api неотличим
  от timeout до него, так что этот файл может быть единственной копией приватной половины
  ключа, который уже зарегистрирован. Запустите установщик снова или завершите вручную, если
  знаете id записи (`brabo-runner device-key finish --id <id>`).
  Следующий `device-key create` назовёт его и заменит.

- **Шаг учётной записи сообщил, что в установке уже есть пользователь.** Это
  `409`, и это **ожидаемый** исход, а не сбой — второй запуск или
  миграция ([RN-530](business-rules/infra.md#rn-530)), чей restore вернул
  пользователей. Войдите существующей учётной записью. Шаги ключа машины и службы
  в этом случае пропускаются по замыслу: выпускать долговременные учётные данные для
  того, кто не просил их в этом запуске, — не дело установщика.

- **Пароль отклонён.** Политика — доменная, та же, что использует
  регистрация, и о ней становится известно только после POST — поэтому установщик спрашивает
  снова, до трёх раз, и превращает исчерпанный предел в незавершённую строку,
  а не прерывает уже запущенную установку. Он никогда не записывает
  пароль никуда: ни в `.env`, ни в маркер, ни в лог. В маркер попадает только
  **e-mail** (`ownerEmail`, `schemaVersion: 3`).

- **Без TTY.** Установщик сообщает и завершается с **0** до того, как что-либо записать.
  Запускайте его из терминала, как скачанный файл —
  `curl -fsSLO …/install.sh && bash install.sh` — никогда `curl … | sh` (загрузка
  становится stdin процесса и убивает каждый вопрос) и никогда
  `sh -c "$(curl …)"`, который не может проверить собственный хеш. Оба отклоняются
  по имени; см. [Установка](#instalando).

- **Агент запущен, но ничего не обслуживает.** Это нормальное состояние новой
  установки: он ждёт и снова опрашивает, пока не появится первый проект в режиме `runner`
  ([RN-550](business-rules/runner.md#rn-550)). См.
  [Агент машины](#agente-de-maquina).

### Папка проекта так и не появляется на машине пользователя {#pasta-do-projeto-nunca-aparece}

**Симптом:** ожидалось, что папка проекта появится под базой runner-а,
а она не появилась. В логе engine есть строка, начинающаяся с
`workspace_create: o projeto <id> não criou pasta —`, и папка
отсутствует.

Сообщение называет, какое из двух предусловий не выполнено
([RN-532](business-rules/runner.md#rn-532),
[ADR 0151](adr/0151-base-consentida-no-runner.md), пункты 3–6), и они
единственные два — **контейнер не требуется**, намеренно: требовать его было бы
циклично, поскольку проект `runner` доходит до зарегистрированного контейнера `running`
только после того, как runner поднимет его поверх той самой папки, для создания которой
существует это сообщение.

- **`nenhum brabo-runner está conectado a este projeto agora`** — запустите
  агента для этого проекта; флаги см. в [базе выше](#base-do-runner).
- **`não declarou a capacidade `workspace` no join`** — подключённый бинарник
  либо старше этой версии, либо работает **без согласованной базы**.
  Оба исправления — в предыдущем разделе: запустите установщик или запустите
  runner с `--base`. Отказ назван намеренно, потому что у двух причин
  разные исправления; сам join НЕ отклоняется, так что runner продолжает
  нормально обслуживать свой проект.
- **`o brabo-runner recusou criar a pasta`** — сообщение несёт
  причину самого runner-а: `segmento` (сегмент вышел за базу — защита
  отказала, ничего не создано), `nao-e-pasta` (цель уже существует как
  файл; этот CLI никогда его не перезаписывает), `mkdir` (права или диск) или `git`
  (`git init`/clone не удался — папка СУЩЕСТВУЕТ, и никакой план Б
  намеренно не пробовался).
- **`não respondeu ... a tempo`** — большой clone может превысить предел.
  Проверьте машину runner-а; на стороне сервера ничего не остаётся записанным наполовину,
  потому что запись происходит только через `workspace_confirm`.

Папка, которая уже существует как git-репозиторий, — это **успех**, а не
ошибка: операция идемпотентна и сообщает `ja-era-repositorio` в
логе runner-а.

### Аутентифицированный clone в режиме Runner отклоняется, пока контейнер запущен {#credencial-nao-atravessa-o-container}

**Симптом:** dev agent в проекте `runner` блокируется при подготовке
worktree, и диагностика говорит, что учётные данные не удалось передать, называя
`credencial-nao-atravessa-o-container`. Источник заблокированной задачи —
`politica`, а не `codigo`.

**Это не баг, который надо ловить, и именно это вам говорит
источник** ([RN-558](business-rules/runner.md#rn-558)). Учётные данные аутентифицированного
remote (`ADR 0056`) могут передаваться только в поле `env` сообщения `exec`,
а это поле действует только для пути **хоста**: у порта Docker продукта нет
поля `env`, намеренно ([ADR 0130](adr/0130-broker-de-container.md), без
свободного `-e`). Когда runner поднял контейнер проекта, он направляет
каждую команду внутрь него — так что учётным данным некуда деваться.

До RN-558 команда всё равно выполнялась, с пустыми переменными, и вы видели
обычный сбой аутентификации. Теперь она отклоняется до выполнения, и ничего
не запускается. Отказ никогда не печатает ни имён, ни значений переменных, только их количество.

**Начиная с [ADR 0193](adr/0193-git-credenciado-no-host-do-runner.md)
([RN-676](business-rules/runner.md#rn-676)) этот отказ больше не происходит на
обычном пути:** engine помечает аутентифицированный `fetch` (`gitCredenciado`),
и актуальный runner выполняет его на **хосте** даже при запущенном контейнере —
та же папка, смонтированная в `/work`. Если вы всё ещё его видите,
подключённый `brabo-runner` старше этого изменения и не читает метку.

**Что делать:**

1. Обновите `brabo-runner` на машине пользователя и перезапустите его (или его
   службу). Это и есть исправление.
2. Если обновить сейчас нельзя: остановите контейнер проекта (страница
   `/containers`, «Parar») и дайте worktree материализоваться — на пути хоста
   учётные данные передаются нормально, и начальный `fetch`
   проходит. Затем снова поднимите контейнер; clone идемпотентен и не
   повторяется.

**Локальный** репозиторий (без токена) не затронут, как и проекты `container` и
`mounted` — они никогда не проходят этим путём. Не затронут и
`workspace_create`, который выполняется на хосте.

**Что остаётся открытым, объявлено:** учётные данные по-прежнему не проходят через
`docker exec`. Закрыть это — значит решить, как операция с учётными данными говорит
с `docker exec` без поля `env`, и каждый известный вариант затрагивает
границу сдерживания — это ADR, а не попутное исправление.

### Контейнеры dev пишут от имени вашего пользователя, а не root {#dev-containers-nao-root}

**Симптом:** что-то, что контейнер dev `api`, `web` или `engine` записал в
bind mount — `apps/api/dist`, `node_modules`, файл, который агент сгенерировал
внутри проекта в режиме выполнения `mounted`, — принадлежит `root` на вашем
диске, и его редактирование или удаление без `sudo` не удаётся.

Это было ожидаемо: образы dev (`docker/api/Dockerfile`,
`docker/web/Dockerfile`, `docker/engine/Dockerfile` — в отличие от `Dockerfile.prod`,
уже не-root начиная с [ADR 0024](adr/0024-fase5-imagens-producao-ci.md)) не имели
директивы `USER` и работали от root. Теперь они работают с **тем же UID/GID, что и
ваш пользователь хоста**, через build args `DEV_UID`/`DEV_GID`
([Конфигурация](reference/configuration.md#dev-container-user-build-time)),
так что этот класс проблем не должен вернуться.

**Если вы всё ещё это видите:**

1. Подтвердите свою пару через `id -u`/`id -g`. Если это не `1000`/`1000`, задайте
   `DEV_UID`/`DEV_GID` в `.env` (см. `.env.example`) и пересоберите:
   `docker compose -f docker/docker-compose.yml build api web engine`.
2. **Среда, предшествующая этому исправлению.** Именованные тома
   (`*_node_modules`, `engine_build`, `engine_deps`, `engine_mix`,
   `engine_hex`) всё ещё хранят содержимое, записанное старыми контейнерами от root, —
   совершенно новый именованный том наследует правильного владельца при первом монтировании, но
   существующий не исправляется задним числом. Обнулите его один раз, либо
   удалив тома (`docker compose -f docker/docker-compose.yml down
   -v` — безопасно для этих, это воспроизводимые артефакты build, никогда не источник
   истины), либо выполнив над ними `chown` на месте:
   ```bash
   docker run --rm -v brabo-dev_api_app_node_modules:/v alpine chown -R "$(id -u):$(id -g)" /v
   # repita para os outros volumes node_modules/_build/deps/.mix/.hex
   ```
   **Совершенно новые тома** (первый clone или машина, на которой запускался только
   установщик, не определяющий ни один из этих томов) падали по-другому:
   `api` и `web` завершались с `EACCES: permission denied, mkdir
   '/workspace/node_modules/.pnpm'`, потому что новый том наследует владельца
   пути **в образе**, а этого пути там не было, поэтому он
   рождался `root:root` (AT-172). `docker/api/Dockerfile` и `docker/web/Dockerfile`
   теперь создают три точки монтирования `node_modules` и выполняют над ними `chown` до `USER`.
   Точки монтирования **внутри bind mount на вашем диске** — отдельная
   половина: Docker создаёт отсутствующую на хосте как `root` (он оставил
   `packages/shared/node_modules` с владельцем root в checkout-е), и никакой образ не может
   этого изменить. `pnpm dev` запускает `scripts/dev/preflight.mjs`, который заранее создаёт их
   от вашего имени; `docker compose up`, запущенный вручную, его пропускает, поэтому выполните
   `pnpm dev:preflight` один раз перед первым ручным `up`.
3. Для файла, уже записанного агентом в папку проекта в режиме **`mounted`**
   на хосте, исправление — тот же `sudo chown -R $USER <pasta>`,
   который этот раздел предписывал для всего репозитория, — теперь он точечный
   для существовавших ранее файлов, а не постоянный обходной путь.

4. **Два тома ДАННЫХ — другой случай, и `down -v` для них НЕ безопасен.**
   `/data/git-repos` и `/data/project-workspaces` монтируются в
   `api` и `engine` как именованные тома. Именованный том рождается с владельцем
   того, что существует по этому пути **в образе**, — а когда пути не
   существует, он рождается `root`, оставляя не-root процесс за бортом. Образы dev
   начали создавать их и выполнять `chown` до `USER` лишь недавно;
   образы production делали это всегда. Симптом — не файл, который вы не можете редактировать на
   своём диске: это `git init --bare` у `LocalGitProvider`, умирающий с
   `permission denied: /data/git-repos/<slug>.git`, и
   `permissions.json` каждого проекта, которому негде записаться, — то есть **provisioning
   репозитория невозможен**.

   В отличие от томов артефактов build выше, эти два хранят источник истины
   (локальные bare-репозитории, worktrees по проектам), так что их удаление теряет данные.
   Исправьте их на месте:
   ```bash
   docker run --rm -v brabo-dev_git_local_repos:/v alpine chown -R "$(id -u):$(id -g)" /v
   docker run --rm -v brabo-dev_project_workspaces:/v alpine chown -R "$(id -u):$(id -g)" /v
   ```
   Том, созданный после исправления, уже поднимается с правильным владельцем. Когда
   вы добавляете **новый** именованный том, создайте каталог в образе:
   забыть — это не ошибка build, это `permission denied` в runtime.

### Полный сброс среды dev {#reset-total}

```bash
bash scripts/dev/reset-total.sh      # ou: pnpm bootstrap → Docker › Reset total
```

Пересобирает образы, **удаляет базу данных**, выполняет миграции и заново заполняет данными —
учётные данные provider-ов, уже лежащие в `.env` (`<PROVIDER>_TEST_KEY`), возвращаются
активными у владельца, так что вам не нужно каждый раз заново вводить их в интерфейсе. Он
**не** удаляет и не пересоздаёт ни одного тома — `node_modules`, `_build`/`deps`,
`pgdata` (удаляются только схемы внутри него), `neo4j`, локальные bare-репозитории
и workspaces проектов — всё это выживает, — и он **говорит об этом** в начале
и рядом со строкой успеха (AT-181). Это намеренно консервативный
выбор: удаление томов выбросило бы workspaces и локальные репозитории,
потерять которые никто не просил.

Цена в том, что **сброс никогда не воспроизводит первый clone.** Дефект, который
проявляется только с томом, которого ещё не существует, — как том `node_modules`,
рождавшийся `root` (AT-172), — проходит через любой сброс незамеченным. Чтобы
проверить этот путь, используйте **одноразовый проект compose**, никогда не этот скрипт и
никогда не ваш проект `brabo-dev` (и не `brabo`, имя установки):

```bash
docker compose -p brabo-primeiro-clone -f docker/docker-compose.yml build engine
docker compose -p brabo-primeiro-clone -f docker/docker-compose.yml \
  run --rm --no-deps engine ls -ldn /root/.mix /root/.hex \
  /workspace/apps/engine/_build /workspace/apps/engine/deps
docker compose -p brabo-primeiro-clone -f docker/docker-compose.yml down -v
```

`run` создаёт тома этого проекта с нуля и не публикует порт, поэтому
не конфликтует с вашим запущенным стеком. Так измерено для engine
2026-09-25 (AT-182): `_build`, `deps`, `.mix` и `.hex` рождаются с владельцем
`DEV_UID:DEV_GID`, и `mix local.hex`/`local.rebar`/`deps.get` проходят от имени
не-root пользователя. Две вещи он оставляет после себя: пустые точки монтирования
`_build`/`deps`, которые он создаёт **внутри вашего checkout-а**, с владельцем `root` (удалите их
однострочником `alpine` из таблицы ниже), и собранный им образ.

**Порядок — это суть, и он не обсуждается:**

0. **Защита установки** ([ADR 0170](adr/0170-compose-de-dev-brabo-dev.md)),
   до preflight: если на этой машине есть хоть один контейнер compose
   УСТАНОВКИ (его метка `com.docker.compose.project.config_files`
   указывает на `docker-compose.install.yml`), или если compose dev разрешился бы
   в проект `brabo`, он отказывает с `RESET NÃO COMEÇOU`, называя то, что
   нашёл. До ADR 0170 dev и установка были одним проектом Docker, и
   `DROP SCHEMA` этого скрипта попал бы в базу установки.
1. `preflight`, затем **предпосылки хоста** (AT-203), затем `build` —
   медленная часть, выполняемая, пока ваша среда ещё запущена. Миграции и
   seed выполняются на ХОСТЕ, с `apps/engine/deps`/`_build` и
   `node_modules` checkout-а — не с томами контейнеров и не с тем, что обновляет build
   образа. Поэтому до любого эффекта скрипт запускает `mix deps.get` и
   `mix compile` в `apps/engine`, проверяет, что `drizzle-kit` и `ts-node`
   разрешаются, и сверяет пароль Neo4j с паролем тома. Измерено
   2026-09-26: с новой зависимостью в `mix.lock` (mint 1.10.1, #613)
   `pnpm engine:migrate` умирал с `lock mismatch` **после**
   `DROP SCHEMA`, и «запустить снова» падало так же. Отказ здесь говорит
   `RESET NÃO COMEÇOU … Nada foi parado nem apagado`: база цела.
2. **`stop api engine`.** Эти два и никакие другие: именно они держат
   живое подключение к Postgres из compose (пул Drizzle api над
   `public`/`drizzle`, Ecto/Oban engine над `engine`). `web` — сервер
   Vite и не говорит ни с одной базой, `neo4j` — другая база, которую этот сброс
   не трогает, а `broker` говорит с api только по HTTP.
3. `up postgres`, `DROP SCHEMA`, `migrate`.
4. `up --wait` всего, затем `seed`.
5. Запрашивает `/health` у api и engine и `/` у web, печатает
   `docker compose ps` и только затем завершает.

Ломало его удаление схем **из-под живых процессов**:
engine умирает внутри `DROP SCHEMA engine CASCADE`
(`Engine.Sessions.Rehydrator` запрашивает `engine.session_states`, которая только что
исчезла, — `ERROR 42P01 (undefined_table)`), миграции пересоздают
всё потом, и **ничто не возвращает мёртвый процесс**. Seed
затем падал на шаге, активирующем сессию (api → engine), с
`ECONNREFUSED`, а скрипт всё равно печатал «reset completo» — фиксированный `echo`
в конце скрипта, который никогда ничего не спрашивал о том, что он только что
сделал.

**Если он остановится посередине**, он скажет об этом и назовёт шаг
(`RESET INCOMPLETO — parou em: <passo>`), и ответ — **запустить его
снова**: он каждый раз удаляет схемы, поэтому второй запуск начинается с того же
чистого листа, что и первый. Запуск только `pnpm --filter api seed` для
восстановления теперь тоже безопасен — seed идемпотентен и переиспользует демонстрационные workspace,
проект и сессию вместо их дублирования (и **не**
добавляет повторно 5 событий сессии).

| что вы видите | что это |
|---|---|
| `RESET INCOMPLETO — parou em: migrations (api + engine)` с `permission denied` под `apps/engine/_build` | `pnpm engine:migrate` выполняется на ХОСТЕ, а Docker создаёт отсутствующую точку bind-mount как `root`. Исправьте на месте: `docker run --rm -v "$PWD/apps/engine:/x" alpine chown -R "$(id -u):$(id -g)" /x/_build` |
| `RESET INCOMPLETO … banco apagado, migrado e semeado, mas estes serviços não responderam: <lista>` | база в порядке; один процесс не вернулся. `docker compose -f docker/docker-compose.yml --env-file .env logs <serviço>` скажет почему. Ничто здесь не требует повторного запуска сброса |
| `RESET NÃO COMEÇOU — recusado em: guarda da instalação na máquina (ADR 0170)` | ничего не тронуто. На этой машине есть установка Brabo (контейнеры перечислены), или задана `COMPOSE_PROJECT_NAME=brabo`. Остановите установку **без** `-v` (отказ печатает точную команду `docker compose -f <pasta>/docker/docker-compose.install.yml --env-file <pasta>/.env down` — её тома и данные остаются) или уберите переменную; см. [Перенос среды dev в brabo-dev](#dev-para-brabo-dev) |
| `RESET NÃO COMEÇOU — recusado em: pré-requisitos de host das migrations` | ничего не тронуто. `mix deps.get`/`mix compile` не удался в `apps/engine` на хосте (читайте вывод над ним), или `drizzle-kit`/`ts-node` не разрешаются — `pnpm install --frozen-lockfile` |
| `O NEO4J RECUSA A SENHA DO .env` до любого эффекта или после `container brabo-dev-neo4j-1 is unhealthy` | Neo4j сохраняет пароль в томе `neo4j_data` при его **создании** и после этого игнорирует `NEO4J_AUTH`, тогда как healthcheck использует пароль из `.env`. Измерено 2026-09-26: том от 13.09, контейнер пересоздан с паролем по умолчанию, healthcheck `The client is unauthorized due to authentication failure`. Верните старый пароль в `NEO4J_PASSWORD`, или смените его внутри Neo4j (`ALTER CURRENT USER SET PASSWORD FROM … TO …`, команда печатается), или — граф производный, `pnpm --filter api grafo:reprojetar` его перестраивает — удалите том сами. Скрипт никогда его не удаляет (AT-181) |
| `up --wait` превышает время | `BRABO_RESET_WAIT_TIMEOUT` (секунды, по умолчанию 600). Первая загрузка с пустыми томами `node_modules`/`_build` выполняет `pnpm install`/`mix deps.get` до того, как процесс начнёт слушать |

### Перенос среды dev в brabo-dev {#dev-para-brabo-dev}

Начиная с [ADR 0170](adr/0170-compose-de-dev-brabo-dev.md) compose dev
(`docker/docker-compose.yml`) — это проект Docker **`brabo-dev`**: контейнеры
`brabo-dev-api-1`, `brabo-dev-postgres-1`…, тома `brabo-dev_pgdata`,
`brabo-dev_neo4j_data`…, сеть `brabo-dev_default`. Compose установки
(`docker-compose.install.yml`) остаётся **`brabo`**, как и
уже существующие установки. Раньше оба были `brabo` — одним проектом Docker: подъём одного
поверх другого пересоздавал контейнеры и подключал их к базе другого
(измерено 2026-09-19: база установки получила миграцию
dev), а `reset-total.sh` удалил бы схемы установки.

**Что меняется для вас, если вы уже разрабатывали здесь:** следующий `pnpm dev`
создаёт НОВЫЕ пустые тома `brabo-dev_*`. Ваши данные остаются там, где были, в
томах `brabo_*`, нетронутыми — ничто в этом изменении не удаляет том.
Preflight предупреждает, пока их видит (он никогда не отказывает из-за этого и никогда
не удаляет). Выберите один из двух путей.

**Как отличить тома dev от томов установки.** Оба несут метку
`com.docker.compose.project=brabo`, поэтому один префикс ничего не говорит. Что говорит:

```bash
docker volume ls --filter label=com.docker.compose.project=brabo \
  --format '{{.Name}}\t{{.Label "com.docker.compose.volume"}}'
docker ps -a --filter label=com.docker.compose.project=brabo \
  --format '{{.Names}}\t{{.Label "com.docker.compose.project.config_files"}}'
```

- Тома, которые объявляет только compose dev, — `api_*_node_modules`,
  `web_*_node_modules`, `broker_*_node_modules`, `engine_build`, `engine_deps`,
  `engine_mix`, `engine_hex` — доказывают, что среда dev использовала имя `brabo`.
  Установка их никогда не создаёт.
- Тома, которые объявляют оба compose, — `pgdata`, `neo4j_data`, `neo4j_logs`,
  `ollama_data`, `git_local_repos`, `project_workspaces`,
  `brabo_projects_base` — сами по себе неоднозначны. Если ни одного контейнера
  установки не существует (вторая команда не показывает `docker-compose.install.yml`)
  и вы никогда не устанавливали Brabo на эту машину, это ваши старые данные dev.
  Если устанавливали, они могут принадлежать установке (или быть смесью после
  аварии, которую закрывает этот ADR): не копируйте и не удаляйте их, пока не узнаете.
  `backup_local` существует только в установке.

**Путь A — перенести данные** (базу, граф, локальные bare-репозитории
и workspaces; тома артефактов build не стоят
копирования, новые заполняются сами при первой загрузке):

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

`cp -a` сохраняет владельцев и режимы, что важно для `pgdata` (образ Postgres
отклоняет каталог данных, владельцем которого он не является) и для двух томов данных (см.
[Контейнеры dev пишут от имени вашего пользователя](#dev-containers-nao-root) выше). Postgres должен быть **остановлен**,
пока копируется его каталог, — для этого и нужен шаг 1.

**Путь B — начать с нуля:** просто запустите `pnpm dev`, затем
`bash scripts/dev/reset-total.sh`, чтобы выполнить миграции и заполнить новую базу.
Старые тома остаются на диске, пока вы их не удалите.

**Удаление старых томов — только после того, как новый стек заработал, и только тех, что
вы доказали как принадлежащие dev** (тома установки — данные, которые вы бы потеряли):

```bash
docker volume rm brabo_api_root_node_modules brabo_engine_build  # …um a um, pelo nome
```

Ни один скрипт не делает этого за вас — намеренно: `docker volume rm`
для `brabo_pgdata` установки — единственная ошибка здесь, которую нельзя отменить.

---

## Локальный deploy {#deploy-local}

Поднимает весь Brabo в локальном кластере и проверяет его
smoke-тестом. Решения — в
[ADR 0025](adr/0025-fase5-deploy-kubernetes-kustomize.md).

### Предварительные требования {#prerequisites}

Обязательны в PATH: `docker`, `kubectl`, `kustomize`, `jq`, `openssl`.

`k3d` и `helm` устанавливать **не** нужно — bootstrap устанавливает их
в `~/.local/bin`, в зафиксированной версии с проверенной контрольной суммой. Убедитесь, что
этот каталог есть в PATH.

Ресурсы: весь стек (Postgres, Prometheus, два operator-а и
три приложения) требует около **4 GiB** свободной памяти.

### Подъём {#bringing-it-up}

```bash
make deploy-local           # constrói as imagens, sobe o cluster, instala, valida
make deploy-local-clean     # o mesmo, sem reconstruir as imagens
```

В итоге: web на <http://localhost:8088>, api на `:3000`, engine на
`:4000` — **те же порты, что в `docker-compose.prod.yml`**, намеренно (ADR
0025, решение 10). Bootstrap запускает seed, который создаёт
уже подтверждённого `owner@brabo.dev` с паролем из
`BRABO_SMOKE_PASSWORD` (по умолчанию `brabo12345678`) — именно с ним вы входите
через собственный вход web.

Seed запускается **после** rollout-ов (его последний шаг активирует сессию,
что заставляет api вызвать engine), а bootstrap продолжает только после
**проверки, что вход возвращает 200**. Эта проверка — по результату, а не
по процессу, и она существует, потому что предыдущая такой не была:
`wait --for=condition=Ready=false` удовлетворяется подом, который так и не
запустился, и поэтому bootstrap объявлял «usuário do smoke pronto»,
пока вход возвращал 401.

> **Seed идемпотентен.** Повторный запуск над заполненной базой — это
> нормальный случай (`BRABO_KEEP_CLUSTER=1`): демонстрационные workspace, проект и сессия
> находятся и переиспользуются, никогда не дублируются, и переиспользованная сессия
> не получает пять событий заново (`apps/api/src/db/seed.ts`,
> docblock в начале). Второй запуск больше не умирает на `workspaces_slug_unique`.
> Bootstrap по-прежнему решает по **входу**, а не по фазе пода, и по-прежнему
> удаляет под в конце, чтобы он не провалил шаг 1 `smoke.sh`, который
> требует, чтобы все поды были здоровы.

> **Это занимает порты `pnpm dev`.** Одинаковые порты — то, что
> делает `smoke.sh` действительным для обоих режимов, а цена в том, что они не
> сосуществуют: при запущенном кластере `pnpm dev` не может опубликовать порт `api`, и
> **5173 никогда не открывается**. Обратите внимание, что web меняет порт между режимами —
> 8088 здесь, 5173 там. Чтобы вернуться к разработке:
>
> ```bash
> make k8s-down && pnpm dev
> ```
>
> `pnpm dev:preflight` говорит, в каком режиме вы находитесь, без догадок. Оба
> рассмотрены в
> [Первых шагах](getting-started.md#the-two-local-modes-dont-coexist).

Другие цели:

```bash
make smoke-k8s        # só o smoke test, contra o cluster rodando
make hpa-test         # prova que o HPA do engine escala pela fila
make k8s-validate     # renderiza os overlays e valida contra o schema (sem cluster)
make k8s-logs         # últimas linhas de api, engine e web
make k8s-down         # remove o cluster
```

Переменные: `BRABO_SKIP_BUILD=1` (использует образы демона),
`BRABO_KEEP_CLUSTER=1` (переиспользует кластер), `BRABO_CLUSTER_TOOL=kind`,
`BRABO_SKIP_OBSERVABILITY=1` (без Tempo, Loki, Collector, Alloy и Grafana —
AT-177). Последняя — явный отказ для запланированных проверок, и
значение по умолчанию не меняется: `make deploy-local` по-прежнему поднимает весь стек.
Prometheus и prometheus-adapter остаются в любом случае, потому что HPA engine
масштабируется по `oban_queue_depth` через External Metrics API, которую они обслуживают.
Независимые релизы helm (ESO, CNPG, metrics-server, Prometheus) устанавливаются
параллельно; каждый пишет собственный лог, печатаемый только при сбое.

### Проверка тега конвейера {#validar-tag-do-pipeline}

```bash
make deploy-local TAG=v0.2.0-qa.1
```

Конвейер Фазы 6 **не делает deploy** — он заканчивается тегом. `TAG=` — способ
увидеть в локальном кластере то, что этот тег зафиксировал: bootstrap делает
отсоединённый checkout тега и собирает образы из этого commit-а.

Он **отказывается** работать с грязным деревом, вместо того чтобы угадывать, что делать
с вашей незавершённой работой. По завершении вы оказываетесь в отсоединённом
HEAD; команда для возврата появляется в логе.

Проверка: **никакой**. Ни один workflow не передаёт `TAG=`: запланированный
`propriedades.yml` собирает дерево checkout-а, никогда не тег, поэтому отсоединённый
checkout в `deploy/k8s/bootstrap.sh` (и его отказ при грязном дереве) выполняется
только когда кто-то его набирает. То, что он поднимает затем, — тот же bootstrap
и smoke из [Локального deploy](#deploy-local), которые доказаны.

### Deploy образов релиза {#imagens-de-uma-release}

Начиная с [ADR 0119](adr/0119-imagens-publicadas-no-ghcr-por-digest.md) каждый
финальный тег публикует образы production в GHCR
(`ghcr.io/daneiel/brabo-{api,engine,web,backup,broker}`, публичные — ни одного
`imagePullSecret` нигде) и регистрирует опубликованное **по digest**
в `.release/images.json`. Пятый, broker контейнеров
([ADR 0162](adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)),
предназначен для установок — в overlay нет Deployment broker-а, и
`make imagens-do-release` записывает только остальные четыре.

Overlays этого репозитория держат `newTag: REPLACE_WITH_DIGEST` —
маркер. **Репозиторий никогда не объявляет, какой релиз в production** —
это объявляете вы, в момент deploy:

```bash
# 1. pegue o registro da release de que você está fazendo deploy
gh release download v3.2.0 --pattern images.json --dir .release

# 2. escreva os digests dela no overlay
make imagens-do-release OVERLAY=prod      # ou OVERLAY=staging

# 3. leia o diff antes de aplicar qualquer coisa
git diff deploy/k8s/overlays/prod/kustomization.yaml
```

Три вещи, которые стоит знать перед запуском:

- **Не коммитьте результат.** `kustomize edit` делает круговой проход YAML: он
  переупорядочивает ключи и отрывает комментарии. Изменение рассчитано жить в
  вашем рабочем дереве на время одного `kubectl apply -k` и не дольше.
- **`digest:` заменяет `newTag:`**, в чём и суть — изменяемый тег в
  production означает отсутствие детерминированного rollback и два пода одного
  ReplicaSet, возможно выполняющих разные бинарники.
- **Rollback — та же команда с файлом предыдущего релиза.** Больше
  отменять нечего: digest — это всё состояние.

Если `make imagens-do-release` говорит, что не находит `.release/images.json`, вы
пропустили шаг 1. Если не находит `kustomize`, версия, которую использует CI,
зафиксирована в `KUSTOMIZE_VERSION`, в `.github/workflows/ci.yml`.

Проверка: `scripts/ci/aplicar-imagens.spec.ts` в каждом PR доказывает
половину шага 2, которая **читает** файл, — он принимает `images.json`, который
пишет `release.yml`, и отклоняет файл без `imagens`, с пустым списком или без
версии и commit-а. То, что он передаёт в `kustomize edit set image`, доказывается
`scripts/ci/images-manifest.spec.ts` — всегда по digest, никогда не тег, и только
четыре образа, которые объявляет база kustomize. У запуска `kustomize` на overlay
нет spec. Вся цепочка
(скачать файл реального релиза, записать его, `kubectl apply -k`) **никогда
не запускалась как доказательство**: ничто не применяет digest-ы релиза к кластеру, а
запланированный кластер запускает образы, собранные из дерева, а не опубликованные.

### Какая версия в эфире {#que-versao-esta-no-ar}

Три места говорят одно и то же, и ответ — версия, **запечённая
в артефакт**, а не конфигурация, которую кто-то мог изменить
случайно
([ADR 0036](adr/0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md)):

1. **Экран входа**, в подвале. Самый быстрый путь, и он не требует
   доступа к кластеру: откройте `/login` и прочитайте первый элемент подвала.
2. **Тег образа**, если у вас есть `kubectl`:

   ```bash
   kubectl -n brabo get deploy -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.template.spec.containers[0].image}{"\n"}{end}'
   ```

3. **`service.version` в span-ах** api, в Tempo. Единственный
   из трёх, который связывает конкретный запрос с build-ом.

`dev` во всех трёх — не сбой: это то, что сообщает образ, собранный вне
`release.yml`, потому что он не родился ни из какого тега. `docker
compose`, `make deploy-local` без `TAG=` и локальный build — все попадают
сюда.

**Расхождение между тремя — это и есть находка.** Подвал, показывающий одну
версию, и тег образа — другую, означают кеш бандла в браузере или
в nginx, а не неверный deploy — бандл и образ происходят из одного и того же
build-а. Перезагрузите в обход кеша, прежде чем подозревать кластер.

### Gate SecOps застрял на «SAST não rodou» {#semgrep-do-gate}

Нить сессии показывает `agent.error` от SecOps (источник `infra`), говорящий
`SAST não rodou: semgrep falhou (:invalid_output), pulado` (или `:sem_saida`,
или `indisponível`), и PR остаётся в `awaiting_secops`. Начиная с
[RN-714](business-rules/engine.md#rn-714) gate никогда не одобряет без статического
анализа: он остаётся в ожидании и блокирует PR. После исправления причины ниже
gate запускается снова сам — при следующем перезапуске engine или когда
`GateRescuer` находит остановленный цикл (15 минут). Ошибка появляется один раз на
причину: спасение, которое снова натыкается на ту же причину, лишь регистрирует её на
сервере engine. До RN-714 тот же
сбой одобрял gate. В compose production и установки
engine работает с `read_only: true` и tmpfs в `/home/engine`; когда этот
tmpfs создаётся `root:root`, пользователь engine (uid 1000) не может создать
`/home/engine/.semgrep`, semgrep завершается с пустым stdout, и gate
не может прочитать результат.

Проверьте изнутри работающего engine:

```bash
docker exec brabo-engine-1 sh -c 'ls -ld /home/engine; id -u'
```

Папка должна принадлежать uid 1000. Оба compose объявляют
`/home/engine:uid=1000,gid=1000,mode=0700` начиная с RN-707; установка,
созданная до неё, сохраняет старую строку, пока её compose не будет обновлён и
сервис `engine` не будет пересоздан (`docker compose ... up -d engine`). Kubernetes
не затронут (`fsGroup: 1000`). Отсутствующий бинарник `semgrep` блокирует gate
так же. Semgrep по-прежнему загружает свои правила из
registry: без выхода в сеть сканирование падает с `scan_failed` — это
другая причина.

`scan_failed` также может прийти от semgrep **без `semgrep-core`** —
бинарника, который выполняет сканирование:

```bash
docker exec brabo-dev-engine-1 semgrep --version   # compose de dev
docker exec brabo-dev-engine-1 sh -c 'semgrep --config p/security-audit --json --quiet --metrics=off /tmp >/dev/null'
# "Failed to find semgrep-core in PATH or in the semgrep package." (exit 2)
```

Semgrep 1.179.0 перестал публиковать wheels `musllinux`, поэтому в образе Alpine engine
pip собирает его из sdist, и бинарника core нет. Оба Dockerfile engine
фиксируют `SEMGREP_VERSION=1.183.0` (dev — начиная с 02.10, синхронизировано
с production через `scripts/ci/semgrep-do-engine.spec.ts`); образ dev, собранный
до этого, пересобирается через `docker compose -p brabo-dev up -d --build engine`.
Повышение версии требует релиза с wheel `musllinux` в PyPI.

### Engine аварийно завершается с `sys_sigaltstack(): Internal error` {#engine-sigaltstack}

`sys/unix/sys_signal_stack.c:101:sys_sigaltstack(): Internal error: Failed to
set alternate signal stack`, exit 134, при загрузке или при build образа (`mix
local.hex`, `mix compile`): ERTS запросил у musl стек сигналов фиксированного размера,
который musl ≥ 1.2.6 отклоняет на CPU с AMX (erlang/otp#11349). Проявляется
периодически в CI (AMX есть лишь у некоторых runner-ов) и детерминированно на таком
сервере. Engine работает на OTP 29.1.1, где есть исправление
([ADR 0209](adr/0209-engine-em-otp-29.md)); увидеть это снова — значит образ с
OTP < 29.1 на Alpine ≥ 3.24 — пересоберите из текущих Dockerfile. Шаг build
в CI «O host tem AMX?» говорит, попал ли конкретный запуск на такой хост.

### Ошибка CORS {#erro-de-cors}

Сообщение браузера называет **назначение** вызова, но никогда не
причину. Сначала читайте **источник (origin)**, который в нём указан, — это и есть полезная информация
([ADR 0037](adr/0037-cors-do-engine-e-a-porta-como-contrato.md)):

```
Access to fetch at 'http://localhost:3000/health' from origin
'http://localhost:5174' has been blocked by CORS policy
                     ^^^^ esta parte é o diagnóstico
```

**Если origin не тот, что вы ожидаете** (`:5174` вместо `:5173`, другой
хост, `https` вместо `http`), проблема в origin, а не в
CORS.

В compose `WEB_ORIGIN` **выводится** из `WEB_PORT` — изменение
`WEB_PORT` в `.env` (рекомендация [первых шагов](getting-started.md)
для занятого порта) сразу сдвигает и принимаемый origin, поэтому это
конкретное расхождение больше не происходит. Что ещё вызывает это: кто-то
передал `--port` напрямую в Vite вне compose (ADR 0037 заставил Vite
отказываться стартовать в этом случае, через `strictPort`, вместо того чтобы молча стартовать
на другом порту), web раздаётся другим путём, или
`WEB_ORIGIN` задана вручную и перекрыла вывод. Исправьте origin
или добавьте его в `WEB_ORIGIN` — **в обоих сервисах**, которые читают одну и ту же
переменную.

**Если origin верный**, проверьте, что каждый сервис отвечает на самом деле.
`curl` не делает CORS, поэтому показывает сырой заголовок — ровно то, на что
смотрит браузер:

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

**Пустой вывод — это находка**: сервис не распознал origin.
Неверная или отсутствующая `WEB_ORIGIN` либо неверный порт.

**Preflight без заголовка, который отправляет web**, — другой вид
сбоя, и самый обманчивый: список `allowedHeaders` в api явный,
и **ни один тест не делает preflight**, поэтому новый заголовок клиента проходит CI и
ломается только в браузере. Сегодняшний список: `Content-Type`,
`Authorization`, `X-CSRF-Token`, `traceparent`.

Три вещи, которые **не** являются проблемой CORS, как бы они ни были
на неё похожи:

- **api ↔ engine.** CORS — механизм браузера; там вызывает
  серверный HTTP-клиент, который игнорирует эти заголовки. Сбой на этом
  пути — это service token (`401`/`403` — см.
  [ротацию](#rotacao-das-chaves-do-auth)) или неверный адрес
  (`ECONNREFUSED` — см. [сессия не выходит из `created`](#sessao-nao-ativa)).
- **Канал Phoenix замолкает.** WebSocket не проходит через CORS.
  Отказывает `check_origin` endpoint-а, тоже питаемый
  `WEB_ORIGIN`, и отказ появляется в логе engine — а не в
  консоли браузера как ошибка CORS.
- **`/metrics` engine заблокирован в браузере.** Это намеренно:
  внутренняя метрика не предназначена для чтения JavaScript-ом страницы. Используйте
  `curl`.

### Сессия не выходит из `created` {#sessao-nao-ativa}

Симптом: активация сессии ничего не делает. «Abrir sessão criativa» создаёт
сессию, а экран не двигается; «Ativar sessão» — тоже.
В логе api `POST /projects/:id/sessions/:id/transition` возвращает
`500`:

```
TransitionSessionUseCase.activate ✗ TypeError
  ↳ HttpApiToEngineClient.startSession ✗ TypeError: fetch failed
      caused by: AggregateError [ECONNREFUSED]
```

Активация сессии — первый шаг, который **переходит** в engine
(api запрашивает супервизируемую сессию по внутреннему HTTP), поэтому
именно здесь проявляется неверный `ENGINE_URL` — и не раньше, потому что ничто другое
на пути создания не выходит за пределы api.

Подтвердите **изнутри** контейнера — именно там адрес имеет значение
(`brabo-dev-api-1` в compose dev; в установке — `brabo-api-1`,
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

`engine:4000`, отвечающий `200`, в то время как `localhost:4000` даёт
`ECONNREFUSED`, при `ENGINE_URL=http://localhost:4000`, — законченный
диагноз: **внутри контейнера `localhost` — это сама api**.

Причина обычно в `.env`, а не в compose. `pnpm dev` передаёт `.env`
как `--env-file`, и значение там **побеждает**
`${ENGINE_URL:-http://engine:4000}` из compose. Исправление: удалите (или закомментируйте)
строку `ENGINE_URL` в вашем `.env` и пересоздайте api —

```bash
docker compose -f docker/docker-compose.yml --env-file .env up -d api
```

— потому что каждая среда и без неё несёт правильное значение по умолчанию:
compose указывает на сервис `engine`, а api, запущенная на хосте,
падает на `http://localhost:4000` собственным кодом. Задавать
переменную имеет смысл только для указания на engine, который не является ни одним из этих двух.
Это относится и к compose **production**, использующему ту же
интерполяцию; в Kubernetes значение приходит из ConfigMap и всегда
было `http://engine:4000`.

Две проверки, прежде чем винить адрес, если `ENGINE_URL` верна:

- **Engine запущен?** `docker compose ps engine` и
  `curl -sI http://localhost:4000/health`. `ECONNREFUSED` при
  верном адресе означает, что сервис недоступен, а не неправильно настроен.
- **Сессия, которая активируется и сама закрывается ~30s спустя**, — не эта
  проблема. Посмотрите на `termination_reason`: `heartbeat_timeout` означает, что
  активация сработала и никто не вошёл в канал Phoenix — ожидаемое
  поведение при активации вне интерфейса
  (`SESSION_HEARTBEAT_TIMEOUT_MS`). `conversation_idle_timeout` —
  другое: разговорный агент ждал пользователя дольше
  `SESSION_CONVERSATION_IDLE_TIMEOUT_MS` (8h), отсчитываемых от конца
  его хода ([RN-581](business-rules/api.md#rn-581)). Чтобы изменить этот предел,
  задайте переменную в `.env` (все три compose передают её в engine)
  или, в Kubernetes, добавьте элемент `env:` в patch engine в overlay:
  `deploy/k8s/` намеренно её не пишет, потому что отсутствующая там переменная
  уже даёт значение по умолчанию 8h из кода (AT-153). `409` с
  `reason: "sessao_encerrada"` после этого — закрытая сессия, отказывающая
  в разговоре: откройте новую сессию.

### Вкладка Terminal навсегда застревает на «Abrindo terminal...» {#terminal-preso-abrindo}

Симптом: в проекте в режиме `runner` (ADR 0103/0104) вкладка Código → Dev → Terminal
никогда не выходит из скелета загрузки. Консоль браузера показывает, в
тугом цикле с растущим backoff:

```
socket do terminal com erro {"erro":"[object Event]"}
socket do terminal fechado
```

Это WebSocket браузера, так и не дотягивающийся до engine, а не
проблема runner-а — это происходит даже до подключения какого-либо `brabo-runner`. Три
наложенные причины, все закрытые [RN-433](business-rules/infra.md#rn-433):

1. **`ENGINE_PUBLIC_URL` разрешается во внутреннее имя хоста Docker.**
   Тикет, который api отдаёт браузеру (`POST .../terminal-ticket`), несёт
   `engineWsUrl`, собранный из `ENGINE_PUBLIC_URL`, — отличной от
   `ENGINE_URL` (RN-419), которая предназначена для вызовов api→engine **внутри**
   сети compose. `docker/docker-compose.yml` теперь задаёт
   `ENGINE_PUBLIC_URL: ${ENGINE_PUBLIC_URL:-http://localhost:4000}` в
   сервисе `api` (то же значение по умолчанию, что `VITE_ENGINE_URL` уже использует для `web`).
   Подтвердите изнутри контейнера:

   ```bash
   docker exec brabo-dev-api-1 sh -c 'echo $ENGINE_PUBLIC_URL'
   # esperado: http://localhost:4000 (ou o endereço público real do seu engine)
   ```

   Пустое значение здесь в среде, собранной до этого исправления, означает, что
   код откатился на `ENGINE_URL` (`http://engine:4000`) — имя хоста, которое
   разрешается только внутри сети Docker, никогда из браузера. Исправление:
   пересоберите/пересоздайте контейнер `api`, чтобы новое значение по умолчанию compose вступило в силу,
   или задайте `ENGINE_PUBLIC_URL` явно в `.env`, если настоящий публичный адрес
   engine другой (туннель, другой хост).
2. **Сокет, который никогда не открывается, повторял попытки вечно и молча.**
   Независимо от адреса выше — даже по-настоящему недоступный engine
   (выключен, за firewall) должен проявляться как ошибка, а не крутиться вечно.
   `apps/web/src/lib/terminal-channel.ts` теперь сдаётся через 8s, если
   сокет не открылся, и показывает `RunnerOnboardingPanel` с
   практичным сообщением вместо того, чтобы оставаться в цикле стандартного
   переподключения WebSocket браузера.
3. **URL сокета дублировал путь.** Настоящая блокировка после того, как
   первые две были исправлены: `terminal-channel.ts` приклеивал
   `/runner/websocket` к `engineWsUrl`, который api уже возвращает
   полным (`ws://host:port/runner`), — а собственный конструктор `Socket` из `phoenix.js`
   снова добавляет `/websocket` к любому endpoint-у, который
   получает. Engine получал `GET /runner/runner/websocket/websocket` и
   отклонял его (`Phoenix.Router.NoRouteError`), что видно в
   `docker logs brabo-dev-engine-1` как подключение, которое никогда не уходит дальше
   `REFUSED CONNECTION`. Исправлено передачей `engineWsUrl` напрямую в
   `Socket` — `apps/runner/src/channel.ts` (сторона CLI того же
   контракта) уже делал это правильно.

### Runner заваливает api мёртвым тикетом {#runner-com-ticket-morto}

Симптом: web начинает отвечать **429** на запросы самого человека, без
необычной активности с его стороны; и/или проект в режиме `runner` выглядит
без локального агента (задачи dev застряли в `dev.blocked_by_container`,
`RunnerReadiness` отказывает), в то время как `brabo-runner` явно работает на
его машине.

**Как подтвердить.** В логе engine ищите ОДИН И ТОТ ЖЕ тикет, который
отклоняется снова и снова с фиксированным интервалом около **5,13 s**:

```bash
docker logs brabo-dev-engine-1 2>&1 | grep 'REFUSED CONNECTION TO EngineWeb.RunnerSocket' | tail -20
```

Десятки таких за несколько часов, все с одной и той же строкой тикета, — это
сигнатура. ~5,13 s — не произвольное число: это предел внутреннего backoff
`reconnectAfterMs` в `phoenix.js`.

**Причина.** Тикет сокета — **одноразовый**
([RN-108](business-rules/web.md#rn-108)); встроенный auto-reconnect
библиотеки повторяет ТЕ ЖЕ `params`, поэтому он повторяет тикет, который был
израсходован при первом подключении и больше никогда не будет принят. Одна версия
`apps/runner/src/channel.ts` вышла с этим auto-reconnect ВКЛЮЧЁННЫМ —
в то время как docblock самого модуля утверждал, что он нейтрализован. Наложившись на
СОБСТВЕННУЮ политику повторов runner-а (которая корректна: свежий тикет на каждый раунд, backoff,
предел последовательных попыток), это дало измеренные **530 запросов за
одну минуту** против предела 300 req/min у `RATE_LIMIT_USER`, четыре минуты
подряд выше лимита. Лимит — **на пользователя**, и именно поэтому 429
появился в браузере владельца учётной записи, а не где-то рядом с runner-ом.

Второе следствие хуже: пока он застрял в этом цикле, runner
**не подключён**, поэтому `RunnerReadiness` ([RN-507](business-rules/runner.md#rn-507))
отказывает, и проект выглядит не имеющим локального агента — часть того, что читается
как «контейнер не поднимается», — это вот это.

**Исправление.** Обновите бинарник `brabo-runner` (или переустановите с экрана
проекта). На сервере ничего менять не нужно: rate limiter сделал свою работу, а
engine был прав, отклоняя каждый из этих тикетов. Если наводнение ещё
продолжается, остановка runner-а прекращает его сразу, и 429 исчезают по мере того, как
скользящее окно опустошается (одна минута).

### api отказывается стартовать из-за секрета OAuth {#segredo-de-oauth-no-boot}

Симптом: при `NODE_ENV=production` api умирает в начале с сообщением
о `GIT_OAUTH_STATE_SECRET` — отсутствует, задана примерным значением
из репозитория или слишком короткая.

**Это не регрессия, и не обходите её.** Этот ключ подписывает `state`
OAuth для git, а `state` — то, что не даёт подделать публичный
callback. До [ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md)
api стартовала со значением по умолчанию, опубликованным прямо здесь, в этом репозитории, —
у того, кто видит эту ошибку, до сих пор поток подключения git был открыт
любому. Сбой загрузки — это запоздало пришедшее предупреждение.

```bash
export GIT_OAUTH_STATE_SECRET="$(openssl rand -base64 32)"
```

В Kubernetes значение приходит из `brabo-secrets`, под одноимённым ключом
объекта `brabo` в хранилище секретов, который
`deploy/k8s/base/common/externalsecrets.yaml` забирает целиком, — если ошибка появилась
там, проблема в том, что хранилище не отдаёт ключ, и путь —
[Диагностика deploy](#diagnostico-do-deploy).

Смена ключа **инвалидирует `state`-ы в полёте**: тот, кто в этот момент находится посреди
«подключить GitHub», получает отказ и проходит поток заново. Поскольку
TTL `state` — 10 минут, это и есть окно — миграции
не требуется, и ни одно **уже установленное** подключение не затрагивается
(сохранённый токен не зависит от этого ключа).

### Provider отклоняет callback социального входа {#callback-login-social-nao-registrado}

Симптом: нажатие «Entrar com GitHub»/«Entrar com GitLab» на экране
входа уходит к provider-у и возвращается с ошибкой САМОГО PROVIDER-А
(`redirect_uri_mismatch` в GitHub, «The redirect URI included is not
valid» в GitLab) — даже не доходит до
`/auth/oauth/:provider/callback`.

**Это не баг продукта — не хватает регистрации на стороне
provider-а.** Социальный вход ([ADR 0084](adr/0084-login-social-github-e-gitlab.md))
переиспользует ТОТ ЖЕ OAuth App, который уже использует подключение git
(`GITHUB_OAUTH_CLIENT_ID`/`GITLAB_OAUTH_CLIENT_ID`, ни одной новой переменной), но
у каждого ПОТОКА свой `redirect_uri`, и provider требует, чтобы ВСЕ,
которые может запросить api, были заранее зарегистрированы:

- Подключение git (уже существовало): `${API_PUBLIC_URL}/git/oauth/<provider>/callback`
- Социальный вход (новый): `${API_PUBLIC_URL}/auth/oauth/<provider>/callback`

Зарегистрируйте второй в конфигурации OAuth App (GitHub: Settings
→ Developer settings → OAuth Apps; GitLab: Settings → Applications) — GitHub
принимает несколько callback URL в одном App, GitLab тоже. Отдельный
App или новые client id/secret не нужны.

### Четыре родственных секрета тоже не стартуют со значением по умолчанию {#segredos-irmaos-no-boot}

Симптом: при `NODE_ENV=production` api (или, для `SECRET_KEY_BASE`
и `BRABO_SERVICE_TOKEN`, релиз `:prod` engine, который отклоняет те
же значения токенов начиная с [RN-601](business-rules/engine.md#rn-601)) умирает
в начале с сообщением об `AUTH_JWT_SECRET`,
`BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` или `SECRET_KEY_BASE` —
отсутствует, задан примерным значением из репозитория или слишком короткий.

**Та же причина, что у секрета OAuth выше, и та же рекомендация: это не
регрессия, и не обходите её.**
[ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md) уже
объявлял эти четыре как незакрытые — тот же шаблон, только ещё не
повторённый, — и [RN-114](business-rules/api.md#rn-114) его закрыла. Каждый защищает
своё:

- публичный `AUTH_JWT_SECRET` = любой может вывести пару, подписывающую
  access token, и подделать действительный.
- публичный `BRABO_SERVICE_TOKEN` = любой может вызывать `/internal/*` в обход
  `EngineServiceGuard`.
- публичный `CREDENTIALS_MASTER_KEY` = любой может расшифровать хранилище
  учётных данных пользователя (ключи LLM, токены git).
- `SECRET_KEY_BASE` (engine) уже имел `raise` в `runtime.exs` —
  дефект был лишь в том, что compose маскировал этот `raise` публичным
  fallback-значением.

```bash
export AUTH_JWT_SECRET="$(openssl rand -base64 32)"
export BRABO_SERVICE_TOKEN="$(openssl rand -base64 32)"
export CREDENTIALS_MASTER_KEY="$(openssl rand -base64 32)"
export SECRET_KEY_BASE="$(openssl rand -base64 64)"
```

В Kubernetes ничего не меняется по той же причине, что и для
`GIT_OAUTH_STATE_SECRET`: все четыре уже приходили из `brabo-secrets`,
под одноимённым ключом объекта `brabo`, который
`deploy/k8s/base/common/externalsecrets.yaml` забирает целиком.

**Граф знаний (`NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD`,
[ADR 0099](adr/0099-neo4j-grafo-de-conhecimento-e-templates.md)) следует
тому же правилу, с одним отличием**: у `NEO4J_URI` и `NEO4J_USER` есть
безопасное значение по умолчанию для разработки (`bolt://neo4j:7687`, `neo4j` — это не
секреты, и `docker-compose.prod.yml` их уже предоставляет); только у
`NEO4J_PASSWORD` нет публичного значения по умолчанию, по той же причине, что и у четырёх
выше, — и без него загрузка api падает в
`GraphStore.onModuleInit` (`neo4j-config.ts`) ЕЩЁ ДО того, как сам Neo4j
откажется стартовать (entrypoint официального образа требует пароль из 8+
символов; пустой `NEO4J_AUTH` первым роняет контейнер `neo4j`).

```bash
export NEO4J_PASSWORD="$(openssl rand -hex 24)"
```

**В разработке ключевая переменная — `NEO4J_URI`, и по умолчанию она пуста.**
Сервис `neo4j` работает в profile по умолчанию compose dev, так что сервер запущен
независимо от того, говорит с ним кто-то или нет; api подключается, только когда `NEO4J_URI`
задана. Раскомментируйте её в `.env` (`bolt://neo4j:7687`) и пересоздайте api —
тогда `GraphStore` пишет `Neo4j conectado — constraints do grafo garantidas`
вместо `NEO4J_URI/NEO4J_USER/NEO4J_PASSWORD ausentes`. Пользователь и пароль
приходят в контейнер с теми же значениями по умолчанию, что сервис `neo4j` использует для
`NEO4J_AUTH`, поэтому задавайте их только чтобы СМЕНИТЬ пароль, и смена там
меняет обе стороны разом.

До того как это было подключено, `docker-compose.yml` вообще не передавал три переменные
сервису `api`, а у сервиса нет `env_file` — так что блок,
который `.env.example` документировал с рождения графа, ни к чему не приводил, и
его раскомментирование ничего не включало. `docker-compose.prod.yml` предоставлял их
с первого дня (поэтому затронута была только разработка): здоровый Neo4j стоял
рядом с api, сообщающей об отсутствующих переменных, бесконечно.

**HEX, а не base64.** Entrypoint Neo4j читает `NEO4J_AUTH` как
`usuario/senha` и разделяет по ПЕРВОЙ косой черте — пароль base64 может
содержать `/` (в алфавите есть `/` и `+`), и это ломает разбор с
`Invalid value for NEO4J_AUTH`, роняя контейнер `neo4j` в
цикл перезапусков. Это действительно случилось: smoke-тест CI упал так после
merge, который по ошибке вернул `-base64`. В hex нет ни `/`, ни `+`, ни `=`.

`docker/smoke.sh` уже генерирует пять эфемерных переменных выше
(четыре родственных плюс `NEO4J_PASSWORD`, её — в hex) при каждом запуске — так
job CI
«Build, scan e smoke das imagens de produção» поднимает
`docker-compose.prod.yml` без
единого закоммиченного секрета.

Смена `AUTH_JWT_SECRET` или `BRABO_SERVICE_TOKEN` без
танца с `_PREVIOUS` даёт тот же эффект, что уже задокументирован в
[Ротации ключей auth](#rotacao-das-chaves-do-auth); смена
`CREDENTIALS_MASTER_KEY` без переупаковки даёт тот же эффект, что уже
задокументирован в
[Ротации мастер-ключа](#rotacao-da-chave-mestra). Эта проверка при ЗАГРУЗКЕ не
меняет ни одну из двух процедур — она лишь не даёт ключу попасть в production
в виде публичного литерала из этого репозитория.

### Настоящий SMTP в `MailSender` {#smtp-real}

`MailSender` отправляет настоящую почту, только когда `MAIL_TRANSPORT=smtp`, —
значение по умолчанию `log` (привычное поведение), **в том числе в production**:
отправка настоящей почты — явный выбор оператора
([ADR 0096](adr/0096-smtp-real-no-mailsender.md)). Полную таблицу `SMTP_*` см. в
[Конфигурации](reference/configuration.md#api).

Симптом неполной конфигурации: при `NODE_ENV=production` и
`MAIL_TRANSPORT=smtp` api умирает в начале, жалуясь на
`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` или `SMTP_FROM` — тот же шаблон
сообщения, что у
[четырёх родственных секретов](#segredos-irmaos-no-boot) ([RN-408](business-rules/api.md#rn-408)),
но БЕЗ публичного значения по умолчанию, которое есть у них: здесь правило вступает в игру
только когда оператор выбрал `smtp`.

```bash
export MAIL_TRANSPORT=smtp
export SMTP_HOST=smtp.seu-provedor.com
export SMTP_PORT=587
export SMTP_USER=usuario-do-provedor
export SMTP_PASSWORD="$(sua-credencial-do-provedor)"
export SMTP_FROM="Brabo <nao-responda@seu-dominio.com>"
```

`SMTP_PASSWORD` — секрет ИНФРАСТРУКТУРЫ сервиса (простая переменная окружения, как
`AUTH_JWT_SECRET`), а не секрет ПОЛЬЗОВАТЕЛЯ — он не проходит через envelope
encryption, и у него нет собственной процедуры ротации, кроме замены
переменной и перезапуска (политику ротации этих учётных данных решает
provider SMTP). В Kubernetes ключ попадает в объект `brabo`
хранилища секретов, как любой другой, и доходит до `brabo-secrets` без изменения
манифеста — `deploy/k8s/base/common/externalsecrets.yaml` забирает объект
целиком.

Если почта не приходит даже без ошибки загрузки: ищите в логе api
`falha ao enviar e-mail via SMTP` (`type`/получатель видны, тело и
токен НИКОГДА не появляются — то же правило, что у `LogMailSender`), и проверьте
учётные данные собственным SMTP-клиентом provider-а, прежде чем подозревать Brabo.

### k3d — по умолчанию даже при установленном kind {#k3d-is-the-default-even-with-kind-installed}

Это не предпочтение. k3s поставляется со встроенным контроллером NetworkPolicy;
**kindnet из kind не реализует NetworkPolicy** и
молча игнорирует манифесты. В кластере kind политики этой фазы
существуют в etcd без какого-либо эффекта, и deploy выглядел бы проверенным,
не проверив половину пункта 4 объёма. Smoke-тест предупреждает, когда
кластер их не применяет.

### Что покрывает smoke-тест {#what-the-smoke-test-covers}

1. Каждый под **Ready** — не только `Running`. Под, чья проверка readiness
   падает, остаётся `Running` вечно, не получая трафика.
2. Ни одного контейнера с `runAsUser: 0`.
3. Вход в `POST /auth/login` пользователем из seed — проверяет argon2id,
   выпуск access token и cookies сессии.
4. `workspace → project → session`. Этот шаг пересекает весь набор
   NetworkPolicies: создание сессии заставляет api вызвать engine
   по внутреннему HTTP, с service token. Сессия создаётся с
   `kind: consultiva` — обязательным начиная с ФАЗЫ 20
   ([RN-097](business-rules/api.md#rn-097)) — и она `consultiva`
   намеренно: smoke-тест проверяет создать → активировать → закрыть и никогда
   не активирует выполнение, которое в консультативной сессии возвращает `409`.

   **Этот шаг доказывает, что у маршрута есть потребитель вне
   web.** Когда `kind` стал обязательным, набор тестов api прошёл с 1562
   тестами, а упал именно smoke-тест, потому что он единственный
   вызывает маршрут как внешний клиент, без mock, против
   образа production.
5. Раздельные пробы (`/live` и `/ready` для engine, `/live` для
   api) и `/config.js` web, указывающий на URL кластера.
6. `oban_queue_depth` с метками `queue` и `state` в `/metrics`.
7. `external.metrics.k8s.io`, отдающий метрику — сбой
   prometheus-adapter молчалив, поэтому мы спрашиваем агрегированный API напрямую.

### Диагностика deploy {#diagnostico-do-deploy}

#### `403` на `/internal/*` или `401` в вызовах api к engine {#403-on-internal-or-401-on-the-apis-calls-to-the-engine}

У обоих симптомов одна причина: service token не совпадает
между двумя сторонами (api отказывает с `403`, plug engine — с
`401`). Проверьте, что обе нагрузки читают **одно и то же** значение:

```bash
kubectl -n brabo get secret brabo-secrets -o jsonpath='{.data.BRABO_SERVICE_TOKEN}' | base64 -d | sha256sum
kubectl -n brabo exec deploy/engine -- sh -c 'printf %s "$BRABO_SERVICE_TOKEN" | sha256sum'
```

Сравнение хеша вместо значения позволяет не печатать секрет в
терминале. Если они расходятся, у пода engine старая версия
Secret: `kubectl -n brabo rollout restart deploy/engine`. Если совпадают,
заголовок не проходит: проверьте, что `BRABO_SERVICE_TOKEN` задан
в **обеих** нагрузках — у engine есть значение по умолчанию для разработки
(`dev-service-token-change-me`), поэтому забытая только там переменная
даёт ровно этот симптом, без ошибки загрузки, — и что ни один прокси на
пути не вырезает незнакомые заголовки.

#### Вход возвращает `401` всем после deploy {#login-returning-401-for-everyone-after-a-deploy}

Почти всегда это новый `AUTH_JWT_SECRET`, пропустивший шаг сосуществования:
access token исчезает вместе с ним, но симптом проявляется на
refresh. Правильная процедура — в
[Ротации ключей auth](#rotacao-das-chaves-do-auth).

#### `ExternalSecret` никогда не становится Ready {#externalsecret-never-becomes-ready}

`SecretStore` читает исходный Secret `brabo`, созданный императивно
bootstrap-ом. Подтвердите, что он существует и что RBAC на месте:

```bash
kubectl -n brabo get secret brabo
kubectl -n brabo describe secretstore brabo-secret-store
```

Начиная с AT-220 `ExternalSecret` забирает объект `brabo` **целиком** из
хранилища (`dataFrom.extract`) вместо перечисления каждого ключа. Два следствия для
диагностики:

- **Отсутствующий ключ больше не мешает ему стать Ready.** `brabo-secrets`
  создаётся без него, и сбой проявляется у того, кому нужен ключ: Pod
  с `secretKeyRef` (`NEO4J_PASSWORD` в Neo4j, `BACKUP_S3_ACCESS_KEY`/
  `BACKUP_S3_SECRET_KEY` в локальном S3) остаётся в
  `CreateContainerConfigError`, а api или engine отказываются стартовать в
  production, называя переменную. Объект в хранилище должен содержать
  `DATABASE_URL`, `SECRET_KEY_BASE`, `CREDENTIALS_MASTER_KEY`,
  `GIT_OAUTH_STATE_SECRET`, `AUTH_JWT_SECRET`, `AUTH_TOKEN_PEPPER`,
  `BRABO_SERVICE_TOKEN`, `RELEASE_COOKIE`, `BACKUP_S3_ENDPOINT`,
  `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY` и
  `NEO4J_PASSWORD` — список, который `deploy/k8s/bootstrap.sh` создаёт локально.
  Сравните то, что пришло:

  ```bash
  kubectl -n brabo get secret brabo-secrets -o go-template='{{range $k, $v := .data}}{{$k}}{{"\n"}}{{end}}'
  ```

- **Всё в этом объекте доходит до Pod-ов.** Каждый ключ становится
  переменной окружения api, engine, двух Job-ов миграции и CronJob
  бэкапа (`envFrom: brabo-secrets`). Не храните в `brabo` ничего, чего эти
  процессы не должны видеть; секрет другого потребителя идёт в другой объект.

#### HPA engine в `<unknown>` {#engine-hpa-at-unknown}

По порядку, от наиболее к наименее вероятному:

```bash
# 1. o engine está expondo a métrica?
kubectl -n brabo exec deploy/engine -- wget -qO- http://127.0.0.1:4000/metrics | grep oban_queue_depth

# 2. o Prometheus a está coletando?
kubectl -n monitoring port-forward svc/prometheus-server 9090:80
# depois: http://localhost:9090 -> Status -> Targets

# 3. o adapter a está servindo?
kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1/namespaces/brabo/oban_queue_depth?labelSelector=state%3Davailable"
```

Если (1) отвечает, а (3) нет, проблема в правиле в
`deploy/k8s/helm/prometheus-adapter-values.yaml`.

#### Job миграции не применяется повторно {#migration-job-doesnt-reapply}

Spec у `Job` неизменяем: пока предыдущий Job ещё в кластере,
повторное применение с новым образом падает. Bootstrap уже удаляет оба
перед применением; вручную:

```bash
kubectl -n brabo delete job migrate-api migrate-engine --ignore-not-found
kubectl apply -k deploy/k8s/overlays/local
```

#### `bin/engine rpc` отвечает `eaddrinuse` {#binengine-rpc-responds-eaddrinuse}

Диапазону портов распределения Erlang (`ERL_AFLAGS`) нужно больше одного
порта: работающий узел занимает первый, а `rpc` поднимает скрытый
узел, которому нужен другой. Настроенный диапазон — 9100–9110, открытый в
NetworkPolicy.

#### Проверка, что реплики engine в кластере {#checking-that-the-engines-replicas-are-clustered}

Без кластера Erlang `:global.trans` из `Workspace.ensure!` ничего не
сериализует, и две реплики запускают конкурентный `git init` в
одном и том же общем каталоге:

```bash
kubectl -n brabo exec deploy/engine -- /app/bin/engine rpc 'IO.inspect(Node.list())'
```

Должны быть перечислены другие поды. Пустой список при более чем одной реплике — это
дефект.

### Секреты: откат на sealed-secrets {#fallback-sealed-secrets}

По умолчанию — External Secrets Operator. Где он неприменим,
замените `ExternalSecret` в
`deploy/k8s/base/common/externalsecrets.yaml` на `SealedSecret`,
**сохранив то же имя Secret (`brabo-secrets`) и те же ключи** —
больше ничего в deploy менять не нужно, потому что всё потребляет его
через `secretRef`.

```bash
kubectl create secret generic brabo-secrets \
  --dry-run=client -o yaml \
  --from-literal=DATABASE_URL=... \
  --from-literal=SECRET_KEY_BASE=... \
  | kubeseal --format yaml > deploy/k8s/overlays/<env>/sealed-brabo-secrets.yaml
```

`SealedSecret` шифруется для публичного ключа данного кластера и может
версионироваться. Простой Secret — **никогда**.

Проверка: **никакой**. Ничто в репозитории не запускает `kubeseal`, а
запланированный кластер (`propriedades.yml`) материализует `brabo-secrets` через
External Secrets, так что этот путь никогда не проверялся. Прежде чем доверять ему,
поднимите кластер с `SealedSecret` на месте и запустите `make smoke-k8s`:
его первый шаг требует, чтобы каждый под был Ready, а под, чей `secretRef` указывает
на Secret, который так и не материализовался, таковым не является.

### Известные ограничения этой среды {#known-limits-of-this-environment}

- **RWO вместо RWX.** Работает, потому что в кластере один узел,
  а RWO означает «один УЗЕЛ», а не «один под». В настоящем кластере эта
  конфигурация разместила бы api и engine на разных узлах, и `git push` dev
  agent падал бы с `remote unpack failed`.
- **Нет pgvector** в Postgres от CloudNativePG. Сегодня ни одна миграция не создаёт
  расширение, и ни одного столбца `vector` нет.
- **У `.gitlab-ci.yml` нет локальной статической проверки** (Фаза 8c, ADR
  0039). Субагент Workflows области Infra проверяет workflows GitHub Actions
  через `actionlint` (зафиксирован в `docker/engine/Dockerfile(.prod)`,
  тот же шаблон, что `hadolint`/`gitleaks`); эквивалентного офлайн-бинарника
  для GitLab CI нет — официальному линтеру нужен живой экземпляр.
  Задокументированный пробел, а не выдуманное полурешение.

---

## Rollout engine {#rollout-do-engine}

Решения — в
[ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md).

Engine размещает процессы сессий. Неаккуратное падение реплики
до Фазы 5 оставляло **каждую** сессию этого пода висеть в
`active` без какого-либо процесса — никогда не продвигаясь, никогда не закрываясь.

### Что происходит во время rollout, по порядку {#what-happens-during-a-rollout-in-order}

| фаза | сколько времени | что происходит |
|---|---|---|
| `preStop` | до 45s (`SHUTDOWN_DRAIN_TIMEOUT_MS`) | `Engine.Shutdown.drain/1`: `/ready` становится 503, `/internal/sessions` отклоняет новые сессии, и каждая сессия этого узла предлагается живому партнёру |
| передача по сессии | 5s (`@handoff_timeout_ms`) | `:erpc.call`, чтобы другой узел взял процесс |
| не принята | — | становится `closing` с причиной `node_shutdown`, затем `closed_abnormally` |
| SIGTERM | остаток из 90s (`terminationGracePeriodSeconds`) | дерево супервизии падает |

90s выбраны намеренно: 45s на drain плюс запас на разборку BEAM.
Снижение `terminationGracePeriodSeconds` без снижения timeout drain
заставляет kubelet убить под **посреди передачи** — именно так
воссоздаётся баг, для предотвращения которого существует drain.

### Выполнение rollout {#doing-the-rollout}

```bash
kubectl -n brabo rollout restart deployment/engine
kubectl -n brabo rollout status  deployment/engine --timeout=300s
```

При одной реплике нет партнёра для принятия: **каждая** активная сессия
закончится `closed_abnormally / node_shutdown`. Это правильно, а не
сбой — но если цель была никого не прерывать, сначала масштабируйте до 2:

```bash
kubectl -n brabo scale deployment/engine --replicas=2
```

### Доказательство, что сирот не осталось {#proving-nothing-was-left-orphaned}

```bash
make rollout-test
```

Открывает 5 активных сессий, выполняет rollout и требует, чтобы **каждая**
была в одном из двух состояний: `active` с живым владельцем `:global` (принята)
или `closed_abnormally` с `node_shutdown` (дренирована). Любая другая
комбинация проваливает тест — в особенности `active` без владельца, что является
операционным определением сироты.

**Он сохраняет улики, которые старые поды уносят с собой** (AT-078). До
`rollout restart` `deploy/k8s/rollout-evidencia.sh` начинает писать в
`ROLLOUT_EVIDENCE_DIR` (`mktemp -d`, если не задана; путь печатается в
конце):

| файл | что |
|---|---|
| `engine-<pod>.log` | `kubectl logs -f` **каждого** пода engine — уже запущенных (весь лог, с загрузки), которых rollout убивает, и каждого пода, созданного позже, — подключается, как только тот становится `Running` |
| `final-<pod>.log` | копия без follow подов, ещё работающих в конце, покрывающая упавший `logs -f` |
| `events.log` | `kubectl get events -w` пространства имён, с собственными временными метками каждого события (`SuccessfulRescale`, `ScalingReplicaSet`, `Killing`…) |
| `replicas.log` | каждые 2 s (`EVIDENCIA_INTERVALO`, который spec сокращает): `<epoch> <spec.replicas do Deployment> <ready> <HPA current> <HPA desired>` |
| `donos.log` | каждое чтение владельца при проверке: `<epoch> <sessão> <nó dono ou ->` |
| `donos-durante-rollout.log` | то же чтение в цикле, пока работает `rollout status`, — на какую реплику попала каждая передача. Хранится отдельно, потому что чтение посреди rollout иногда попадает на уходящий под и не может питать вердикт |
| `engine-estado.txt` | только чтение: строки сессий теста в `engine.session_states` (без строки ни drain, ни `Adopter` не видят сессию) и последние job-ы `SessionAdoptionWorker`, снятые в конце обоих исходов |
| `marcos.log`, `anexos.log`, `pods-antes.txt`, `pods-no-fim.txt` | вехи теста (`rollout-restart`, `rollout-status-ok`…), когда был подключён каждый лог, поды в T0 и в конце |

При сироте сбой печатает каждую строку, называющую сессию, во всех
этих файлах — включая лог старого пода, — плюс изменения реплик
относительно rollout и вердикт по каждой сироте: **без владельца ДО
или ПОСЛЕ первого scale-down HPA**. Это отделяет известный смешивающий фактор:
`hpa-test`, который запускается раньше, оставляет три реплики, и ~75 s внутри окна
HPA масштабирует до одной, убивая новые реплики. Падение `spec.replicas`
читается как HPA, потому что `rollout restart` его никогда не меняет. Ничто из этого
не меняет того, что считается принятым или дренированным, ни предел 120 s. Чистые
части и сборщики против поддельного `kubectl` покрыты
`scripts/ci/rollout-evidencia.spec.ts`. Запланированный workflow загружает
каталог как артефакт `rollout-evidencia` в каждом запуске, дошедшем до
проверки, включая зелёные.

Чего он **не** захватывает, измерено в первом зелёном запуске с ним
(`35449815544`): строки самого drain (`shutdown: drenando…`,
`shutdown: drain concluído — …`) никогда не попадают в лог пода. `Engine.Shutdown.drain/0`
выполняется внутри `bin/engine rpc` из `preStop`, поэтому вывод его `Logger` идёт в
stdout этого hook-а, который kubelet отбрасывает при успехе hook-а.
Логи старых подов заканчиваются на `SIGTERM received`. Исход drain по сессиям
нужно читать из `donos-durante-rollout.log` (на какую реплику ушла каждая сессия)
и из `engine-estado.txt` (выжила ли её строка в `session_states`).

**Причина исправлена, не подтверждено в k3d** (AT-078, RN-588). Сирота, которую поймала
эта проверка (~3 из 13 запусков: нет строки в `session_states`, и второй СТАРЫЙ под в
`donos-durante-rollout.log`), возникала из-за того, что `Monitor` старого пода удалял строку
после того, как партнёр перезаписал её во время передачи. Drain теперь помечает передачу,
и Monitor сохраняет строку. Это доказано детерминированным тестом ExUnit,
а не этой проверкой, которая падает 1 раз из 4–6 и не может доказать исправление. Если сирота
появится снова, лог пода, передавшего сессию, несёт
строку `Monitor: session_state <id> mantido|apagado em <node>` на каждую сессию: отсутствие
строки означает, что Monitor так и не обработал `:DOWN` (под умер раньше).

Вручную — тот же вопрос:

```sql
-- sessões ativas segundo a api
select id, status, updated_at from sessions where status = 'active';
```

```bash
# donos vivos segundo o engine
kubectl -n brabo exec deploy/engine -- \
  /app/bin/engine rpc ':global.registered_names() |> Enum.filter(&match?({:brabo_session, _}, &1)) |> length()'
```

Активна в api без владельца в engine = сирота.

### Когда сессия ускользает {#quando-a-sessao-escapa}

**Сессия застряла в `closing`.** `closing` — переходное состояние; застрять
там означает, что drain начался и не закончился. Алерт *Session stuck in
closing* срабатывает через 15 минут. Исследуйте лог пода,
который уходил, — если его уже нет, `Adopter` (обход каждые
30s) должен был взять её; если не взял, проверьте, существует ли ещё строка
в `engine.session_states`.

**Сирота после `kill -9` / OOMKill.** `preStop` в этих
случаях по определению не выполняется. Покрывает это `SessionAdoptionWorker`,
который каждые 30s ищет строку в `session_states` без владельца `:global`
и берёт её. Если он не работает, очередь Oban стоит —
и тогда проблема другая (см. алерт о непотребляемой
очереди в [Наблюдаемости](#observabilidade)).

**Rollout застрял в `preStop`.** Симптом: под в `Terminating` ровно
90s, каждый раз. Почти наверняка `:erpc.call`, ждущий узла, который
уже умер, но всё ещё в `Node.list()`. Timeout 5s на сессию
ограничивает ущерб; полные 90s означают ~18 сессий подряд или передачу,
которая никогда не возвращается.

**Ничего не принимается, даже с 2 репликами.** Узлы не
видят друг друга. Проверьте кластер Erlang:

```bash
kubectl -n brabo exec deploy/engine -- /app/bin/engine rpc 'Node.list()'
```

Пустой список = DNSCluster не разрешил headless Service, или
NetworkPolicy блокирует диапазон распределения (9100–9110). Без
кластера каждая реплика — остров, и каждый rollout дренирует всё.

### Увеличение окна drain {#aumentar-a-janela-de-drain}

Если сессии длинные и 45s drain не хватает, оба значения повышаются
**вместе** — и в таком порядке рассуждения: выберите drain, затем добавьте
запас:

```yaml
# deploy/k8s/base/engine/deployment.yaml
terminationGracePeriodSeconds: 150   # drain + ~30s de desmonte
# env SHUTDOWN_DRAIN_TIMEOUT_MS: "120000"
```

Изменение только `terminationGracePeriodSeconds` не удлиняет drain;
изменение только drain заставляет kubelet убивать посередине.

Проверка: **собственной нет**. `make rollout-test` — применимое
доказательство, а запланированный запуск доказывает только пару, которую производит
**локальный** overlay: 90 s grace из `deploy/k8s/base/engine/deployment.yaml` и
drain 20 s из `deploy/k8s/overlays/local/patches.yaml` — не 45 s по
умолчанию и не увеличенный. После повышения обоих в overlay, который вы деплоите, запустите
`make rollout-test` с теми же значениями в локальном overlay
перед важным rollout; ничто не проверяет, что grace period остаётся
выше drain.

---

## Restore {#restore}

Решения — в [ADR 0027](adr/0027-fase5-backup-hardening-release.md).

> **Протестировано.** Процедура ниже — ровно то, что запускает `make test-restore`,
> и он запускается против локального кластера. Здесь нет шага, который
> никто никогда не выполнял. Запись последнего запуска — в конце.

### Что попадает в бэкап, а что намеренно нет {#what-is-backed-up-and-what-deliberately-is-not}

Существует семь именованных томов; **два** являются источником истины, и только они
копируются. Классификация — это
[ADR 0152](adr/0152-backup-de-volumes-contra-compose.md), и смысл её
проведения в том, что «бэкап каждого тома» стоит места, скрывая то, что важно.

| том | природа | в бэкапе? |
|---|---|---|
| `pgdata` | источник истины — event log, действия, pgvector, всё | да, как **логический дамп**. Никогда не файловая копия каталога данных: копирование работающего Postgres даёт бэкап, который может не восстановиться |
| `git_local_repos` | источник истины — *bare*-репозитории проектов provider-а `local` | **да**, и именно здесь была дыра. Он не восстанавливается из Postgres: event log хранит повествование, а не объекты git |
| `neo4j_data` | производный — проекция event log ([ADR 0101](adr/0101-memoria-relacional-como-projecao-do-event-log.md)) | нет. Ответ для производной памяти — **перепроекция**, а не restore — `grafo:reprojetar`, см. [Потеря графа](#perda-do-grafo) |
| `project_workspaces` | производный — worktrees, которые `WorktreeManager` пересоздаёт из bare-репозитория, **и** папка `docs/` агентов проектов `container` и `runner`, являющаяся проекцией event log ([ADR 0148](adr/0148-artefatos-projetados-em-arquivo.md)) | нет. Ответ — **перепроекция** — `artefatos:reprojetar`, см. [Потеря папки артефактов](#perda-da-pasta-de-artefatos) |
| `ollama_data` | повторно получаемый — модели скачиваются заново | нет |
| `brabo_projects_base` | пользователя, а не продукта | нет, и установщик никогда его не удаляет |

### Где живёт бэкап {#where-the-backup-lives}

| что | где |
|---|---|
| расписание | Kubernetes: CronJob `brabo-backup`, 03:17 UTC, ежедневно. Compose: планировщика нет — запускаете вы, или установщик запускает перед миграцией |
| назначение | диск (`BACKUP_DIR`) **или** S3-совместимый bucket (`BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET`). Заданная `BACKUP_DIR` побеждает; пустая — откат на S3, что и делает CronJob |
| структура | `daily/brabo-<ISO>.dump` + `weekly/…` для Postgres; `git-daily/brabo-git-<ISO>.tar.gz` + `git-weekly/…` для bare-репозиториев |
| хранение | 7 ежедневных + 4 еженедельных **каждого типа**, по КОЛИЧЕСТВУ (`BACKUP_KEEP_DAILY` / `BACKUP_KEEP_WEEKLY`) |
| формат | `pg_dump --format=custom --compress=9`; `tar -czf` для репозиториев |
| история | таблица `backup_runs` — **дамп**, с ключом `object_key`. Архив репозиториев несёт ту же временную метку в соседнем префиксе; связь — имя, а не столбец |

В локальном кластере назначение S3 — SeaweedFS (`s3-local`,
шлюз `weed server -s3` на порту 9000) внутри пространства имён `brabo` — это был
MinIO, пока MinIO не перестал публиковать свой community-образ
([ADR 0169](adr/0169-seaweedfs-no-lugar-do-minio-no-overlay-local.md)); в
staging/prod это настоящий bucket. Процедура не меняется — меняется только
endpoint. Если bootstrap останавливается на `rollout status deployment/s3-local` с
`ImagePullBackOff`, зафиксированный образ перестал раздаваться: digest не даёт
изменяться байтам, но не не даёт уйти издателю.

> **Назначение по умолчанию в compose — именованный том, и это годится для
> проверки и неверно для миграции.** `docker compose down -v` удаляет
> `backup_local` вместе с данными, которые он должен был спасти. Направьте
> `BRABO_BACKUP_HOST_DIR` на каталог хоста перед любой миграцией.

### Что гарантирует архив bare-репозиториев — и чего не гарантирует {#garantia-dos-bare-repos}

Ничто не замораживается: репозитории копируются, пока api и engine могут в них
писать. Что именно это даёт:

- **Гарантировано.** Согласованность **по ссылке**. Git пишет объекты до того, как
  сдвинуть ref, и меняет ref атомарным rename (или перезаписью
  `packed-refs` под lock, тоже через rename). `tar`, пересекающийся с `git push`,
  захватывает ref в старом или новом значении, никогда не половину — и
  в новом случае объекты, до которых она дотягивается, уже на диске.
- **Гарантировано.** Частичный архив **проваливает запуск**, а не проходит как
  хороший. Конкурентный `git gc` может удалить packfile между тем, как `tar` перечислил
  каталог и прочитал его; код выхода `tar` захватывается в файл (в POSIX `sh`
  статус конвейера — статус последней команды), и ненулевой превращается в
  строку `failed` в `backup_runs`, что и вызывает алерт. Запустите снова.
- **Гарантировано.** Архив читаем **от начала до конца** до того, как что-либо будет
  записано, — `brabo-restore-git` — это `pg_restore --list` на стороне git.
  Обрезанный tar имеет правдоподобный размер, и только его чтение это показывает.
- **Не гарантировано.** Какой-либо глобальный момент. `tar` обходит дерево за некоторый период,
  поэтому два репозитория — или две ref одного — могут быть из разных моментов.
  Неважно для git, который проверяет по ref; важно для того, кто читает
  «бэкап 03:17» как один снимок.
- **Не гарантировано.** Связность объектов. Ничто здесь не запускает `git fsck`:
  в образе бэкапа намеренно нет git. Доказывается целостность
  контейнера, а не содержимого.
- **Не копируются.** Файлы `*.lock` и `objects/tmp_*`. Восстановление осиротевшего lock
  даёт репозиторий, где каждый `git` отказывается работать, с сообщением, которое
  никогда не упоминает бэкап.

### Перед восстановлением: бэкап существует и годен ли он? {#before-restoring-does-the-backup-exist-and-is-it-any-good}

```sql
select finished_at, kind, status, object_key,
       pg_size_pretty(size_bytes) as tamanho, error_message
  from backup_runs
 order by finished_at desc
 limit 10;
```

Три вещи в этом выводе важнее последней строки:

- **Недавний `status = 'failed'` при старом успехе** — опасный
  случай: бэкап есть, только старый. Алерт *Last backup run failed*
  покрывает ровно это.
- **Резкое падение `size_bytes`** между запусками указывает на обрезанный
  дамп, и один размер его не выдаёт — его ловит
  `pg_restore --list` в скрипте.
- **Ни одной строки** означает, что CronJob ни разу не отработал успешно. Тогда
  проблема не в restore.

### Автоматизированный путь (тот же, что запускает тест) {#restore-automatizado}

В Kubernetes:

```bash
make test-restore
```

В установке compose — без кластера, без `kubectl`:

```bash
make test-restore-compose
```

Оба запускают **настоящий** бэкап (тот же образ, та же команда, что работает в
production, — не импровизированный `pg_dump`, который тестировал бы путь, которым никто не пользуется),
восстанавливают в `brabo_restore_test`, проверяют и удаляют базу. Используйте их,
когда цель — **проверить** бэкап, а не восстановить данные.

Две обёртки намеренно разделены: их объединение сделало бы путь compose
зависимым от `kubectl`, а это та зависимость, которой он существует, чтобы не иметь. Что
*не* дублируется — это суждение: обе запускают один и тот же `brabo-restore` с теми же
тремя проверками. Обёртка compose добавляет третий шаг, которого кластер не может
запросить: она проверяет архив bare-репозиториев, потому что в Kubernetes том
`git_local_repos` не смонтирован в под бэкапа и шаг
законно пропускается, тогда как в compose он смонтирован, и пропуск был бы
ложным зелёным.

Обе доказываются каждую неделю в
[`propriedades.yml`](#provas-de-propriedade-agendadas): `make test-restore` (и
его намеренная поломка, `make test-restore-mutacao`) в job-е кластера, и
`make test-restore-compose` — с проверкой bare-репозиториев, которую делает только
путь compose, — во втором job-е, `restore-compose`, на другом runner-е
(AT-195). Миграция установщика тоже запускает вариант compose.

### Настоящее восстановление во время инцидента {#restore-de-verdade}

Скрипт `brabo-restore` восстанавливает в НОВУЮ базу и никогда не трогает
исходную — намеренно. Восстановление поверх живой базы
необратимо и почти всегда является неверным решением в первые минуты
инцидента.

**1. Поднимите Job восстановления, указывающий на нужное вам имя базы:**

```bash
kubectl -n brabo create job restore-manual --from=cronjob/brabo-backup \
  --dry-run=client -o yaml \
| sed -e 's|\["brabo-backup"\]|["brabo-restore"]|' \
| kubectl -n brabo apply -f -

kubectl -n brabo set env job/restore-manual RESTORE_DB=brabo_recuperado
kubectl -n brabo logs -f job/restore-manual
```

Чтобы восстановить из еженедельной копии вместо последней ежедневной:
`RESTORE_PREFIX=weekly/`.

**2. Проверьте, что вернулось** — те же вопросы, что задаёт скрипт, теперь
своими глазами:

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

**3. Повысьте восстановленную базу**, направив на неё `DATABASE_URL` и
перезапустив api и engine. Это последний шаг и единственный
разрушительный:

```bash
kubectl -n brabo patch secret brabo-secrets --type merge \
  -p "{\"data\":{\"DATABASE_URL\":\"$(printf '%s' "$NOVA_URL" | base64 -w0)\"}}"
kubectl -n brabo rollout restart deployment/api deployment/engine
```

> Secret материализуется External Secrets из provider-а. Прямой
> `patch` перезаписывается при следующем `refreshInterval` (1h):
> измените **также** значение в provider-е, иначе система молча вернётся
> к старой базе в течение часа — посреди восстановления.

Проверка: шаги 1 и 2 — это `brabo-restore`, который `make test-restore`
запускает каждую неделю, а два запроса шага 2 — те, которые
задаёт себе `docker/backup/restore.sh`. Шаг 3 — patch `DATABASE_URL` и
перезапуск api и engine против восстановленной базы — **никогда не
выполнялся**: проверка удаляет `brabo_restore_test` по завершении и никогда
не направляет на неё работающую api.

### Чего НЕ покрывает restore {#what-the-restore-does-not-cover}

- **Учётные данные пользователей становятся нечитаемыми, если `CREDENTIALS_MASTER_KEY`
  другой.** Дамп несёт упакованные DEK, а не ключи. Восстановление
  в среду с другим мастер-ключом возвращает
  целую базу с бесполезными учётными данными LLM и git. См.
  [Ротация мастер-ключа](#rotacao-da-chave-mestra).
- **Ничто из пользователей не остаётся за бортом.** Начиная с отказа от Keycloak
  ([ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)) нет
  отдельной базы IdP: идентичности, учётные данные argon2id, refresh-токены
  и event log auth живут все в одном Postgres и попадают
  в этот дамп. Что **не** выживает — их чтение, если
  `AUTH_TOKEN_PEPPER` другой, — то же рассуждение, что для мастер-ключа
  выше.
- **`brabo-restore` восстанавливает базу, и только её.** Bare-репозитории —
  это родственная команда `brabo-restore-git` — см.
  [Восстановление bare-репозиториев](#restore-dos-bare-repos). Это отдельные
  команды, а не две фазы одной, потому что это два артефакта с
  двумя суждениями: сбой git не может провалить проверку event log, а
  обратное было бы хуже.
- **Worktrees агентов** (`project_workspaces`) не копируются, и это не
  нужно: `WorktreeManager` пересоздаёт их из bare-репозитория. Теряется
  незакоммиченная работа в процессе.
- ~~Настоящие репозитории живут в GitHub/GitLab~~ — **это было
  написано здесь и было неверно**, и именно поэтому том годами оставался без
  бэкапа. Это верно для проектов provider-ов `github`/`gitlab`; для
  проекта provider-а `local` нигде нет upstream, и
  bare-репозиторий в `git_local_repos` **и есть** код, который произвели агенты.
- **Это не PITR.** Гранулярность — последний дамп; всё, что записано
  после него, теряется. Если это неприемлемо, путь — архивирование WAL
  в CloudNativePG, что вне объёма этой фазы.

### Восстановление bare-репозиториев {#restore-dos-bare-repos}

Проверка ничего не стоит и ничего не пишет — это еженедельный жест, и
начиная с AT-195 его выполняет запланированный job `restore-compose` из `propriedades.yml`
(через `make test-restore-compose`, см.
[автоматизированный путь](#restore-automatizado)):

```bash
docker compose -f docker/docker-compose.prod.yml run --rm backup brabo-restore-git
```

Восстановление — жест, выполняемый раз на инцидент, и его нужно набрать:

```bash
docker compose -f docker/docker-compose.prod.yml \
  run --rm --user 0:0 backup brabo-restore-git --restaurar
```

Две вещи об этой команде, обе измеренные, а не предположенные:

- **`--user 0:0` здесь не опционален.** `git_local_repos` разделяется тремя
  образами, работающими с тремя разными uid (api как `node`, engine как
  `engine`, образ бэкапа как uid 70). Том принадлежит тому, кто
  смонтировал его первым, режим 0755: uid 70 его читает и не может писать. Без
  root команда отказывает **до** извлечения, называя это исправление, — она не
  обнаруживает проблему посреди `tar`, оставляя том записанным наполовину.
- **Извлечённое возвращается владельцу каталога**, а не
  остаётся под root. Иначе том вернулся бы целым и бесполезным: api
  и engine, не-root, не смогли бы писать в только что восстановленное, и
  симптом проявился бы долго после restore, и ничто бы на него не указывало.

Она **отказывается извлекать поверх существующих репозиториев**. Наложение двух состояний репозитория
даёт смесь, на которую не жалуется ни один `git` и которую никто не замечает, пока `fetch`
не вернёт неверную историю. Опустошите том или передайте `RESTORE_GIT_FORCE=1`,
если наложение — действительно то, что вам нужно.

Проверка: shell-функции за обоими жестами доказываются в каждом PR
`scripts/ci/backup-lib.spec.ts` — архивирование и восстановление совпадают в оба конца, ни один
`*.lock` не копируется, обрезанный архив отклоняется при чтении, назначение, в которое
невозможно писать, отклоняется до `tar`. Сами команды, в образе бэкапа против
настоящего тома, выполняются через `make test-restore-compose` (половина, которая
проверяет, никогда `--restaurar`), каждую неделю в `propriedades.yml`. Этот job сначала
создаёт bare-репозиторий в томе (`git init --bare`, как делает
`LocalGitProvider`) и проваливается, если вердикт его не называет: при
пустом томе `brabo-restore-git` отвечает «nada a restaurar» и завершается с 0,
что было бы зелёным, не прочитавшим ни одного архива.

### Потеря графа (Neo4j) {#perda-do-grafo}

`neo4j_data` **не** входит ни в один бэкап, и это решение, а не
недосмотр ([ADR 0152](adr/0152-backup-de-volumes-contra-compose.md), решение
4). Восстановление, возможно, устаревшей проекции рядом с Postgres, восстановленным в другой
момент, даёт два производных состояния из разных моментов без чего-либо, что
бы их примирило. Правильный ответ для производной памяти — перепроецировать из
источника — и такая команда существует ([RN-569](business-rules/api.md#rn-569)):

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

Ожидаемый вывод:

```
[reprojetar] escopo: event log inteiro
[reprojetar] eventos: 4 projetados, cursor 01M2DTREY0TBKHCHG9NWXYF0A4
[reprojetar] sessões fechadas: 2 projetadas

[reprojetar] resultado

  eventos projetados=4  sessões fechadas projetadas=2  falhas=0
  grafo agora (inteiro): nós=80  arestas=80
```

Что она делает и что гарантирует:

- **Тот же перевод, что у живого проектора.** Событие → узел/ребро живёт в одном
  классе (`GraphEventTranslator`), вызываемом как прямым проектором, так и
  этой командой. Она читает `handoff.offered`, `psychologist.hypothesis_proposed`
  и `anamnese.profile_updated` из `session_events`, а `Interacao` каждой
  сессии в `closed`/`closed_abnormally` — из `sessions` (закрытие сессии
  не оставляет события в логе).
- **Идемпотентна и никогда не удаляет.** Каждая запись — `MERGE` по естественному
  ключу: двойной запуск даёт тот же граф, и **повторный запуск — это способ
  повторить попытку** после сбоя посередине. Она только добавляет или сходится; узел, уже находящийся в
  графе, остаётся.
- **Пакетами, по курсору.** `session_events` обходится в порядке `id` (ULID,
  первичный ключ), по 200 строк за раз — никогда вся таблица в памяти.
  Строка прогресса печатает курсор; `--after-event <id>` возобновляет фазу событий
  после него. Начать заново так же безопасно, только медленнее.
- **Она не трогает outbox, поэтому api может оставаться запущенной.** Живой проектор
  хранит свой прогресс в `outbox_events.processed_at`
  (`aggregate_type = 'graph_projection'`); эта команда не читает и не
  пишет эту таблицу, поэтому не может украсть, переоткрыть или пометить строку. Обе пишут через
  `MERGE` по одним и тем же ключам.
- **Она падает с именем, никогда как молчаливый успех.** Не настроенный или
  недоступный Neo4j отклоняется *до* чтения лога (иначе пустой объём
  «сработал» бы с нулём спроецированных); Neo4j, падающий посередине, останавливает работу на
  последнем завершённом событии; неизвестный `--project` отклоняется без какой-либо
  записи; элемент с несогласованным payload подсчитывается, называется, и запуск
  завершается с `1` в конце.

Чего она **не** восстанавливает, и единственная оговорка о порядке:

- **`PromptTemplate`/`PromptVersion`** не берутся из event log. Их
  источник — каталог `prompts/`: отправьте их заново через
  `node scripts/dev/seed-prompts.ts` (идемпотентно по хешу).
- **`PerfilAnamnese` — снимок с ключом пользователь + измерение, без проекта.**
  Побеждает последний записавший. Запуск с `--project` повторно выполняет только события профиля
  этого проекта, поэтому может оставить снимок на последнем значении этого проекта, когда другой
  проект записал более новое. Полный запуск (без `--project`) обходит весь лог по
  порядку и восстанавливает глобальное последнее — используйте его после потери графа; приберегите
  `--project` для точечного ремонта.
- **Полный запуск требует окна обслуживания, без предела по времени**, и сколько
  он длится на большом логе, не измерено — см.
  [Выполнение полной перепроекции](#reprojecao-em-janela) про окно,
  строку прогресса и как узнать, сколько осталось.

Доказательство — `make test-reprojecao`
(`apps/api/test/scripts/reprojetar-grafo.spec.ts`): он строит сценарий с
прямым проектором, **удаляет** этот подграф, перепроецирует, сравнивает количество узлов и
рёбер плюс список ключей и перепроецирует снова. Ему нужен запущенный Neo4j, и
без него он пропускается — у job-а CI api нет Neo4j, поэтому там он пропускается. Он
намеренно не зависит от того, был ли бэкап.

То же доказательство запускается и **внутри локального кластера**: `make test-reprojecao-k8s`
(`deploy/k8s/test-reprojecao.sh`) — четвёртая цель запланированного
`propriedades.yml` (см. [Запланированные доказательства свойств](#provas-de-propriedade-agendadas)).
Он запускает команду ровно так, как этот раздел велит запускать её при инциденте
(`kubectl exec deploy/api -- node scripts/reprojetar-grafo.js --project <id>`),
против Postgres и Neo4j кластера, в проекте, который он создаёт сам.
Начиная с AT-191 его сценарий проверяет **все четыре пути перевода**
`GraphEventTranslator` — `handoff.offered`,
`psychologist.hypothesis_proposed`, ссылающийся на сообщение как на улику,
`anamnese.profile_updated` для собственного пользователя и `Interacao`
закрытой сессии — и требует **9 узлов и 6 рёбер** до очистки, после
восстановления и после второго запуска (измерено в запуске `36498776825`).
Psicólogo и Anamnese остаются на паузе: доказательство добавляет события, которые они
записали бы, и проверяет, что перепроекция из них восстанавливает.

Пустой граф до запуска этого имеет названный эффект: чтения, зависящие
от графа, деградируют. RAG **не** затронут — он живёт в pgvector, который находится
внутри дампа.

#### Выполнение полной перепроекции: окно обслуживания, без предела по времени {#reprojecao-em-janela}

Полная перепроекция (графа или [папки артефактов](#perda-da-pasta-de-artefatos))
— редкая операция **восстановления**, и она выполняется в **окне обслуживания, без
предела по времени** — решение мейнтейнера (2026-09-27). Ничто в продукте
не обрывает её по времени, не предупреждает, когда она долго идёт, и не планирует её: она идёт столько,
сколько потребует event log, и вы планируете окно под это.

Сколько это на логе размера production, **не измерено**. Единственный реальный запуск
пока — compose разработки (98 событий в `session_events`, 2,5 s от начала
до конца); пропорциональная экстраполяция из этого не является измерением, поэтому засеките
первый полный запуск вашей установки и сохраните это число для следующего окна.

**Отслеживание прогресса.** Команда печатает одну строку на пакет — каждые 200
событий читаемых ею типов — перед итоговым результатом, так что запуск, который
ещё печатает, ещё обходит лог:

```
[reprojetar] eventos: 200 projetados, cursor 01M2DTREY0TBKHCHG9NWXYF0A4
[reprojetar] eventos: 400 projetados, cursor 01M2DV3K8Q2S7ZB1CXN4W6Y9HR
...
[reprojetar] sessões fechadas: 200 projetadas
[reprojetar-artefatos] artefatos: 200 projetados, cursor 01M2DTREY0TBKHCHG9NWXYF0A4
```

Число — сколько было **спроецировано** (неудавшиеся элементы печатаются в
собственной строке и подсчитываются в `falhas=` в конце). Строка не несёт
итога. Чтобы узнать, сколько осталось, спросите Postgres, с курсором
последней строки — только чтение, поэтому безопасно, пока запуск продолжается:

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

Добавьте `AND session_id IN (SELECT id FROM sessions WHERE project_id = '<project-uuid>')`
к подсчёту, когда у запуска есть `--project`. Списки типов — те, которые
читают команды (`EVENTOS_DO_LOG_PROJETAVEIS` в
`apps/api/src/application/graph-projection/graph-event-translator.ts`,
`ARTIFACT_PROJECTABLE_EVENT_TYPES` в
`apps/api/src/domain/artifacts/artifact-projection-events.ts`); если какой-то из файлов
получил новый тип, подсчёт здесь его недосчитает.

**Чего это решение не добавляет.** Ни предела, ни предупреждения, ни перепроекции,
разделённой на окна или запланированной продуктом. `--project` и
`--after-event` остаются ровно тем, чем были, — точечным ремонтом и
возобновлением после прерывания — и **не** являются способом уместить полное восстановление
в более короткое окно: запуск с `--project` не может восстановить глобальный
снимок `PerfilAnamnese` (выше), а возобновление посреди версионируемого типа
артефакта может оставить более старую версию ([ниже](#perda-da-pasta-de-artefatos)).
Полный запуск и есть восстановление. Прерывать его безопасно — идемпотентность выше
действует, — и повторный запуск с начала всегда корректен, только медленнее.

### Потеря папки артефактов (`docs/`) {#perda-da-pasta-de-artefatos}

Каждый артефакт, который выпускают агенты, живёт **только в event log**; папка `docs/`
проекта — его **проекция** ([ADR 0148](adr/0148-artefatos-projetados-em-arquivo.md)),
поэтому она не входит ни в один бэкап, и это решение, а не недосмотр
([ADR 0152](adr/0152-backup-de-volumes-contra-compose.md) рассуждает так же о
графе). Восстановление базы **не** возвращает её само по себе:
строки outbox, двигающие живой проектор, уже помечены как обработанные, поэтому
ничто не переписывает папку. Команда, которая переписывает, существует
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

Ожидаемый вывод:

```
[reprojetar-artefatos] escopo: event log inteiro
[reprojetar-artefatos] artefatos: 6 projetados, cursor 01M2DTREY0TBKHCHG9NWXYF0A4

[reprojetar-artefatos] resultado

  artefatos projetados=6  falhas=0
```

Что она делает и что гарантирует:

- **Тот же перевод, что у живого проектора.** Событие → папка, имя файла
  и Markdown живут в одном классе (`ArtifactEventTranslator`), вызываемом как
  прямым проектором, так и этой командой.
- **Идемпотентна и никогда не удаляет.** Имя файла — функция
  события (версионируемые типы: `<tipo>.md`; append-only: с `seq`), поэтому двойной
  запуск перезаписывает те же файлы тем же содержимым, и **повторный
  запуск — это способ повторить попытку**. Файл, который вы создали в `docs/`, остаётся.
- **Пакетами, по курсору.** `session_events` обходится в порядке `id`, по 200 строк
  за раз; `--after-event <id>` возобновляет после напечатанного курсора.
- **Она не трогает outbox**, поэтому api может оставаться запущенной.
- **Она падает с именем, никогда как молчаливый успех.** Неудавшаяся запись (переполненный диск,
  недоступная папка, проект, чья папка исчезла) подсчитывается и называется по
  событию, не останавливает остальное, и запуск завершается с `1` в конце. Неизвестный
  `--project` отклоняется без какой-либо записи.

Куда она пишет и чего **не** покрывает:

- **Ей нужно видеть тот же диск, что и api.** Папка разрешается той же
  функцией, что использует проектор (`container`/`runner`:
  `<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>/docs/`; `mounted`: внутри
  папки проекта). Запускайте её в образе api, с томами api.
- **Она пишет в *текущее* местоположение проекта.** Конвертация режима не
  перемещает `docs/` (код конвертации её никогда не трогает), поэтому файлы, записанные до
  неё, остаются в старом месте; перепроекция воссоздаёт их в текущем.
- **Версионируемые типы показывают последнее событие, поэтому не возобновляйте посреди
  них.** `module_map`, `module_routing`, `project_image` и `c4_diagram`
  перезаписывают файл; полный запуск заканчивается последней выпущенной версией, тогда как
  `--after-event`, начинающийся между двумя версиями, может оставить более старую.
- **Чего она не читает:** типы вне проецируемого списка (`qa_verdict`,
  `secops_verdict`, `task_blocked`, `infra_delegation_files`) никогда не были файлами
  и не воссоздаются.
- **Она выполняется в окне обслуживания, без предела по времени**, как и
  граф: строка прогресса и запросы для её отслеживания — в
  [Выполнение полной перепроекции](#reprojecao-em-janela). Сколько она длится на
  большом event log, не измерено; команду безопасно прерывать и запускать
  снова.

Доказательство — `apps/api/test/scripts/reprojetar-artefatos.spec.ts`: он строит
сценарий с прямым проектором на настоящем Postgres и настоящем диске, **удаляет**
папку, перепроецирует, сравнивает каждый путь и содержимое и перепроецирует снова.
Он запускается в каждом PR. Команда в том виде, как этот раздел велит запускать её при
инциденте, — `node scripts/reprojetar-artefatos.js` внутри **образа** api —
доказывается `make test-reprojecao-artefatos-k8s` (`deploy/k8s/test-reprojecao-artefatos.sh`,
AT-198), родственником цели кластера для графа: он создаёт собственный проект
с `artifact.note` через API, ждёт, пока живой проектор его запишет,
удаляет папку `docs/<agente>/` агента **внутри пода api**, запускает
собственный скрипт образа с `--project` и требует, чтобы восстановленный файл имел
**тот же sha256**, что записал живой проектор, — затем запускает снова и
требует тот же хеш (идемпотентность). Он запускается в запланированном
`.github/workflows/propriedades.yml` и, как и его родственник, не зависит ни от какой
другой цели.

### Когда restore не удаётся {#when-the-restore-fails}

| симптом | вероятная причина |
|---|---|
| `no backup under .../daily/` | не тот bucket, не те учётные данные, или CronJob ни разу не запускался |
| `not an intact custom dump` | загрузка прервана; используйте предыдущий объект или `weekly/` |
| `pg_restore failed` с ошибкой расширения | целевой базе нужны те же расширения (`pgvector`); в CNPG они приходят из кластера, а не из дампа |
| `missing tables in the restored copy` | дамп другой версии схемы — скрипт говорит, КАКИХ не хватает; сверьте дату объекта с самой свежей миграцией |
| `out of window` в критической таблице | количество не совпадает с временной меткой дампа: разберитесь перед повышением |
| `server version mismatch` | `pg_dump` в Job — 16; кластер другой major-версии отклоняет подключение |
| timeout Job-а | база слишком велика для `activeDeadlineSeconds`; повысьте значение в Job, а не в CronJob |
| `destination inaccessible … does not accept writes` | с `BACKUP_DIR` каталог существует, но uid контейнера не может в него писать. Это намеренно проверка **записи**, а не существования: назначение только для чтения прошло бы `ls` и провалило бы дамп, с ошибкой, появляющейся после `pg_dump` и указывающей не туда |
| `tar of the bare repos exited with N` | что-то изменилось под репозиториями посреди чтения — скорее всего, конкурентный `git gc`. Запуск помечается `failed`, а не выдаёт частичный архив. Запустите снова |
| `there are N bare repo(s) … and NO archive` | у этого тома нет покрытия: архива нет, а репозитории есть. Отсутствие при пустоте — норма и сообщается иначе |
| `does not accept writes by this user (uid 70)` при `--restaurar` | случай с владельцем общего тома — восстанавливайте с `--user 0:0`, см. [Восстановление bare-репозиториев](#restore-dos-bare-repos) |

### Запланированные доказательства свойств {#provas-de-propriedade-agendadas}

`make test-restore`, `make rollout-test` и `make hpa-test` доказывают
**свойства**, а не конфигурацию — бэкап, который выполняется каждую ночь и не
восстанавливается, проходит все пять алертов `brabo-alerts.yaml`. До BRB-009 они запускались,
только когда кто-то их набирал. `.github/workflows/propriedades.yml` теперь запускает их
по расписанию, в кластере k3d на runner-е, размещённом GitHub:

1. устанавливает `k3d`, `helm` и `kubectl` по зафиксированной контрольной сумме;
2. запускает `deploy/k8s/bootstrap.sh` — тот же bootstrap, что запускает `make deploy-local`,
   собирая четыре образа production из дерева checkout-а (без
   registry, без секрета) — с `BRABO_SKIP_OBSERVABILITY=1` (AT-177): ни одно
   из доказательств не читает Tempo, Loki, Collector, Alloy или Grafana, и это
   единственное отличие от кластера, который даёт вам `make deploy-local`;
3. запускает `make smoke-k8s`, затем `make hpa-test`, `make rollout-test` и
   `make test-restore`, в порядке `Makefile`, каждый — даже когда предыдущий
   упал (сломанный HPA не может скрыть сломанный restore);
4. запускает `make test-restore-mutacao` (AT-126, BRB-009), доказательство
   доказательства: он делает настоящий бэкап, затем создаёт таблицу (`zz_mutacao_restore`) в
   источнике, которой нет в дампе, — ровно «дамп без одной таблицы» —
   и запускает тот же `brabo-restore`. Он проходит, только если restore его **отклоняет**
   и называет эту таблицу (строка лога `faltando: zz_mutacao_restore`); если restore
   одобряет или отклоняет по другой причине, шаг падает и открывает собственный
   issue. Зелёный `make test-restore` говорит, что бэкап восстанавливается; этот говорит, что
   доказательство всё ещё заметило бы, если бы не восстанавливался. Таблица удаляется на выходе, даже при
   сбое. Он запускается, даже когда `make test-restore` упал (слепое доказательство и
   сломанный restore — два дефекта, и оба должны проявиться);
5. запускает `make test-reprojecao-k8s` (AT-127, BRB-018): у графа нет бэкапа
   ([ADR 0152](adr/0152-backup-de-volumes-contra-compose.md)), потому что он
   перепроецируется из event log, поэтому workflow доказывает и это — он создаёт
   собственный проект с закрытой сессией и четырьмя событиями (сообщение,
   handoff, гипотеза Psicólogo и профиль Anamnese — каждый путь
   переводчика, AT-191), перепроецирует его, **удаляет этот подграф** в Neo4j,
   перепроецирует и требует те же количества узлов и рёбер (9|6), затем
   перепроецирует снова. Он не использует состояние, оставленное другими целями, и
   **не** связан с `test-restore` (граф не зависит от бэкапа);
6. запускает `make test-reprojecao-artefatos-k8s` (AT-198, RN-590), то же доказательство
   для другой производной проекции — папки `docs/` артефактов. Он
   создаёт собственный проект с `artifact.note`, ждёт, пока живой
   проектор запишет файл, **удаляет папку агента внутри пода
   api**, запускает `node scripts/reprojetar-artefatos.js --project` из образа
   и требует **тот же sha256**; затем перепроецирует снова и требует его
   ещё раз. Он не зависит ни от какой другой цели;
7. запускает `make test-rotacao-chave-mestra-k8s` (AT-146), **последним**: три шага
   [ротации мастер-ключа](#rotacao-da-chave-mestra) — оба ключа опубликованы
   в исходном Secret `brabo`, `ExternalSecret` принудительно синхронизирован, api
   перезапущена, `rewrap-deks.js` из образа, предыдущий ключ удалён и api
   снова перезапущена — с проверкой, что каждый конверт открывается на каждом шаге и
   учётные данные расшифровываются в то же значение в конце. Он меняет мастер-ключ кластера
   и перезапускает api, и именно поэтому после него ничего не запускается;
8. только когда **и** restore, **и** намеренная поломка прошли в одном и том же
   запуске, записывает `ultima-execucao-boa.json` (дата, запуск, commit, длительность restore)
   и загружает его как артефакт `restore-ultima-execucao-boa` (хранится 90 дней),
   и добавляет строку *Última execução boa do restore* в сводку запуска;
9. записывает длительность каждого шага в сводку запуска.

**Второй job**, `restore-compose` (AT-195), запускается рядом с ним на другом
runner-е — compose production публикует 3000/4000/8088, те же порты, которые
отображает кластер k3d, поэтому они не могут делить один. Он собирает четыре образа через
`docker-bake.hcl` (как делает `ci.yml`), поднимает compose production через
`docker/smoke.sh` (который оставляет пользователя и сессию seed в базе),
создаёт bare-репозиторий в `git_local_repos` как fixture и запускает
`make test-restore-compose`: настоящий бэкап, restore с тремя
проверками и проверку архива bare-репозиториев. Зелёный без
строки, называющей проверенные bare-репозитории, проваливает шаг. Его сбои открывают issues
тем же способом, с собственными заголовками.
Измерено в запуске `36371633435`: build образов 190 s, подъём compose (smoke) 43 s,
`make test-restore-compose` 4 s — 4 min 31 s на job, параллельно с
11 min job-а кластера, так что часы workflow не сдвигаются.

| триггер | когда |
|---|---|
| `schedule` | еженедельно, воскресенье 04:00 UTC |
| `workflow_dispatch` | по требованию, через вкладку Actions (`gh workflow run propriedades.yml`) |

**Сбой открывает issue** с заголовком `Prova de propriedade falhou: <alvo>`,
по одному на цель, а повторный сбой той же цели **комментирует в открытом
issue**, а не открывает другой. У bootstrap собственный заголовок: при
недоступном кластере три цели остаются `skipped`, а пропущенный запланированный запуск —
это та тишина, ради нарушения которой всё это существует. **Первый запуск, в котором цель
проходит, закрывает её issue** комментарием, называющим этот запуск (AT-212), — никому
не нужно помнить. Только запуск на **ветке по умолчанию** (расписание или
`workflow_dispatch` на ней) трогает issues: красный `workflow_dispatch` на
ветке падает в собственном запуске, регистрирует предупреждение и не открывает и не комментирует
issue расписания, а зелёный на ветке ничего не закрывает. Запуски стоят
в очереди **по ref** (`concurrency: propriedades-<ref>`): два dispatch на
разных ветках идут бок о бок, два на одной ref ждут друг друга.
Это **не** gate и не обязательная проверка — ничто его не ждёт.

Измерено в запусках, которые строили workflow (4 vCPU, 15 GiB RAM, 87 GB
свободного диска на `ubuntu-latest`):

| шаг | длительность |
|---|---|
| bootstrap (build образов + кластер + operators + приложение) | 705 s |
| `make smoke-k8s` | 1 s |
| `make hpa-test` | 19 s |
| `make rollout-test` | 24 s |
| `make test-restore` | 21 s |
| `make test-restore-mutacao` | 31 s (запуск `35473548113`) |
| `make test-reprojecao-k8s` | 16 s (запуск `35471428634`); 18 s со сценарием из четырёх событий (запуск `36498776825`) |
| `make test-reprojecao-artefatos-k8s` | 4 s (запуск `36498695123`, весь job 10 min 28 s) |
| `make test-rotacao-chave-mestra-k8s` | 47 s (запуск `36502355798`, весь job 12 min 10 s) |
| весь job | 12 min 56 s |

(Первый полностью зелёный запуск, `34784563928`, 2026-09-13.)

С `BRABO_SKIP_OBSERVABILITY=1` и operator-ами параллельно (AT-177)
фаза helm сократилась с 253 s (запуск `36362479629`, на `dev`) до 89–90 s,
bootstrap — с 710 s до 547–555 s, а весь job — с 13 min 43 s до
10 min 59 s (запуски `36367504128` и `36368334920`). Build образов (141–161 s)
и ожидание `seed-smoke` (по-прежнему 180 s) от этого не меняются.

**Build образов остаётся простым `docker build` — намеренно** (AT-178, измерено
и отклонено). Сборка четырёх образов через `docker-bake.hcl` с
кешем `type=gha`, который уже использует `ci.yml`, — параллельно, с загрузкой в демон,
и bootstrap, затем работающий с `BRABO_SKIP_BUILD=1`, — была опробована на ветке
и дважды прошла зелёной:

| | build образов | весь job |
|---|---|---|
| `docker build` в bootstrap (запуски `36367504128`, `36368334920`) | 161 s, 145 s | 10 min 59 s |
| bake, первый запуск на ref (`36369702417`) | 177 s (включая setup buildx) | 11 min 44 s |
| bake, тёплый кеш (`36370592556`) | 116 s (включая setup buildx) | 11 min 32 s |

В тёплом состоянии шаг выигрывает 30–45 s; в холодном — проигрывает 15–30 s; на уровне job-а
разница остаётся в пределах шума между запусками. Важный запуск — еженедельный
на `main`, а кеш Actions вытесняет запись, которую никто не читал 7 дней, —
еженедельная периодичность как раз то место, где кеш чаще всего холодный.
`no-cache-filter = ["runtime"]` в bakefile (AT-110) также в любом случае пересобирает каждый
финальный этап, что и держит тёплый выигрыш маленьким. Пересматривать только с
измерением, показывающим тёплый кеш в запланированном запуске.

Периодичность следует этой стоимости. Почти вся она — bootstrap, который
ночной запуск оплачивал бы семь раз в неделю, чтобы проваливать свойства, чей код
меняется гораздо реже; еженедельная держит тревогу в пределах одного спринта,
а `workflow_dispatch` покрывает «я только что трогал бэкап». Timeout job-а —
90 минут, а у одного шага restore предел 20 — см. комментарий в этом
шаге, чтобы понять, почему предел принадлежит шагу, а не скрипту.

**Что нашли первые запуски**, каждое невидимое для `kubeconform` и
любой проверки PR, и каждое исправлено в том же изменении, которое создало
workflow, — `make deploy-local` был сломан на `dev` неделями, и
никто его не запускал:

1. `imageName` кластера CNPG, зафиксированный только по digest
   ([ADR 0159](adr/0159-imagem-de-terceiro-por-digest.md)), отклоняется
   webhook-ом operator-а — *«Can't use just the image sha as we can't detect
   upgrades»*. Теперь он несёт `:16.10@sha256:…`.
2. В исходном Secret bootstrap не было `NEO4J_PASSWORD`, которую
   `ExternalSecret` базы читает с появления графа ([ADR 0099](adr/0099-neo4j-grafo-de-conhecimento-e-templates.md)):
   `brabo-secrets` так и не материализовывался, и каждый под оставался в
   `CreateContainerConfigError`.
3. api не получала в кластере ни `NEO4J_URI`, ни `NEO4J_USER`, а в
   режиме production она отказывается стартовать без всех трёх.
4. StatefulSet Neo4j экспортировал `NEO4J_USER`/`NEO4J_PASSWORD`, которые
   entrypoint образа превращает в ключи конфигурации и отклоняет (*«Unrecognized
   setting»*), — тот самый дефект, о котором предупреждал комментарий двумя строками ниже. Эти
   манифесты ни разу не запускались в кластере.
5. `migrate-api` не мог выполнить `CREATE EXTENSION vector` (роль приложения не
   суперпользователь), поэтому api стартовала без таблиц. Локальный кластер CNPG теперь
   создаёт его как суперпользователь, в базе приложения и в `template1`.
6. `deploy/k8s/smoke.sh` и `rollout-test.sh` никогда не передавали `kind` сессии,
   ставший обязательным в ФАЗЕ 20 (`docker/smoke.sh` получил его тогда же), поэтому оба
   падали с 400, ничего не доказав.
7. `make test-restore` умирал в `pg_restore` с *«permission denied to create
   extension vector»* — случай, который таблица выше уже называет, — потому что
   ничто в локальном кластере не предоставляло расширение базе, которую
   создаёт restore.
8. С предоставленным расширением `pg_restore` всё равно умирал — теперь с *«must be
   owner of extension vector»*, на `COMMENT ON EXTENSION` дампа: только
   владелец расширения может его комментировать, а там, где роль приложения не
   суперпользователь (CNPG, любой управляемый Postgres), расширение принадлежит другой роли.
   **Это не локально для кластера**: тот же `brabo-restore` — это
   процедура инцидента, так что настоящий restore на таком Postgres упал бы
   так же. `restore.sh` теперь восстанавливает по индексу дампа
   без комментария расширения — строки описания, которую устанавливает расширение,
   от которой не зависят ни данные, ни проверки. Воспроизведено против простого контейнера
   `pgvector` с ролью не-суперпользователя до и после изменения.
9. `deploy/k8s/test-restore.sh` ждал через `kubectl wait
   --for=condition=complete`, который никогда не видит **упавший** Job, поэтому
   сломанный restore выше тратил весь 20-минутный предел шага, чтобы сообщить то, что
   лог Job-а говорил за секунды (собственный предел скрипта был 30). Теперь он опрашивает оба
   условия и падает, как только Job становится `Failed`.
10. `rollout-test.sh` искал сирот после фиксированного `sleep 15`, который
    не отличает *ещё оседает* от *окончательно сирота*. Теперь он опрашивает до
    предела (`ROLLOUT_CONVERGENCE_SECONDS`, по умолчанию 120) и записывает, до
    rollout, на какой реплике жила каждая сессия, — старые поды уносят свои
    логи с собой.

**Измерено, и вероятная причина с тех пор исправлена** (AT-078,
[RN-588](business-rules/engine.md#rn-588)) — `Monitor` старого пода, удалявший
строку `session_states`, которую партнёр только что перезаписал; см.
[Доказательство, что сирот не осталось](#rollout-do-engine), про то, что записала бы
новая сирота. Далее — запись до исправления. **Доказательство rollout
упало один раз из четырёх запусков, дошедших до него** (два из десяти до запуска `35448353884`, 2026-09-19, в котором
пять сессий жили на одном старом поде, четыре были приняты, а одна закончилась
без владельца и без дренирования; единственные логи, называвшие её, умерли вместе с этим подом, —
и именно поэтому доказательство теперь их сохраняет, см.
[Доказательство, что сирот не осталось](#rollout-do-engine)). С тем же скриптом и тем же фиксированным ожиданием запуск
`34773908653` прошёл, а запуск `34775712706` сообщил о сироте — сессия
`active` в api без владельца ни на одной из трёх реплик engine, через 15 s
после возврата `rollout status`. Оба запуска с ограниченным ожиданием прошли, и
оба сошлись за **3 s**, все пять сессий приняты. Нормальная сходимость
за 3 s делает прочтение «сироте просто нужно было больше 15 s» наименее вероятным;
наиболее вероятное — периодическая гонка при принятии или дренировании, которую фиксированное
ожидание случайно поймало. Остаётся как есть — намеренно: workflow существует, чтобы
ловить ровно это, и следующее появление теперь упадёт с пределом, который
ждали, с тем, где жила каждая сессия до rollout, и со строками engine, которые
называют сироту. Исправление — за engine, а не за этим доказательством.

### Последний проверенный запуск {#last-verified-run}

> **Источник этого теперь — запланированный workflow, и дата больше не
> редактируется вручную** (AT-126). Самый свежий запуск
> [`propriedades.yml`](#provas-de-propriedade-agendadas), у которого есть
> артефакт `restore-ultima-execucao-boa`, — последний раз, когда restore прошёл в
> Kubernetes **и** намеренная его поломка была поймана в том же запуске:
> `gh run list --workflow propriedades.yml --status success --limit 1`, затем
> `gh run download <run> -n restore-ultima-execucao-boa` (хранится 90 дней). Это
> артефакт workflow, а не метрика: gauge Prometheus рядом с алертами
> бэкапа потребовал бы кода в `apps/api`, которого это изменение не касалось (BRB-009 остаётся открытым в этой половине). Запись ниже сохранена в том виде, в каком была написана: это
> история первой проверки и того, что она нашла.

<!-- Atualize esta seção sempre que rodar o teste num ambiente novo. -->

| поле | значение |
|---|---|
| дата | 2026-07-27 |
| среда | локальный кластер k3d, PostgreSQL 16.10 (CloudNativePG), MinIO |
| команда | `make test-restore` |
| наблюдаемый RTO | ~40s от запуска бэкапа до вердикта (база ~108 KB) |

Вывод:

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

RTO выше — для пустой базы production: он служит для доказательства
ПРОЦЕДУРЫ, а не для оценки настоящего восстановления. Измерьте снова на
репрезентативном дампе, прежде чем кому-либо обещать RTO.

#### Что нашёл этот запуск (и что тест теперь предотвращает) {#what-this-run-found-and-that-the-test-now-prevents}

1. **Расхождение major-версии Postgres.** Локальный CloudNativePG
   работал на 17.4, тогда как compose говорит 16; `pg_dump` отклонял
   подключение с «server version mismatch». `imageName` кластера
   был зафиксирован на 16.10.
2. **Ложный зелёный от пустой базы.** При нуле строк каждое сравнение
   количеств превращается в `0 == 0`, а проверка `seq` ничего не смотрит.
   Сегодня скрипт явно падает в обоих случаях.
3. **Фиксированное количество таблиц устаревает.** Проверка сравнивала с числом,
   записанным в скрипте, которое устарело уже в той же сессии.
   Теперь она сравнивает СПИСОК таблиц с источником и говорит, какой
   не хватает.
4. **Образ бэкапа нёс 48 CVE уровня HIGH/CRITICAL** от `mc`
   (Go, замороженный с сентября 2025) и от `gosu` в базе
   `postgres:16-alpine`. Заменён на `alpine` + `postgresql16-client`
   + `aws-cli`, все из apk и поэтому обновляемые: 48 → 0. См.
   решение 1b ADR 0027.

### Последний проверенный запуск — compose, назначение на диске {#last-verified-run--compose-disk-destination}

| поле | значение |
|---|---|
| дата | 2026-09-09 |
| среда | Docker compose, PostgreSQL 16 (образ pgvector), назначение на **диске** — без кластера, без bucket, без `kubectl` |
| команда | `docker/backup/test-restore-compose.sh` (то, что запускает `make test-restore-compose`) |
| база | 55 таблиц, 422 события в 13 сессиях — заполненная база, а не пустая |
| bare-репозитории | 2 (`exp001.git`, `exp004.git`), 27 003 байта в архиве |

Вывод (три шага, в сокращении):

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

`backup_runs` получила строку `status = 'ok'` каждого запуска, с **дампом** в качестве
`object_key` — тот же столбец, который `restore.sh` запрашивает для окна снимка.

#### Что нашёл этот запуск {#what-this-run-found}

**Restore bare-репозиториев не мог писать в том, в который восстанавливает**, и только
его запуск это выявил. `git_local_repos` разделяется тремя образами с тремя
uid; он принадлежит тому, кто смонтировал его первым (измерено: `1000:1000`,
режим 0755), а образ бэкапа работает как uid 70. Первый `--restaurar` умер
посреди извлечения с `tar: can't make dir ./exp001.git: Permission denied`,
оставив цель записанной наполовину. Из этого вышли два изменения, оба описаны выше:
команда отказывает **до** извлечения и называет `--user 0:0`, а когда она действительно
работает как root, возвращает извлечённое дерево владельцу каталога, а не
оставляет его во владении root, — что дало бы том, который восстанавливается
идеально и в который api и engine не могут писать.

Проверено затем настоящим `git` (не образом бэкапа, в котором его нет):
`git fsck --connectivity-only` чист на обоих репозиториях, refs и commit-ы целы,
владелец снова `1000:1000`.

---

## Ротация ключей auth {#rotacao-das-chaves-do-auth}

Решения — в
[ADR 0031](adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) и
[ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md).

У first-party auth **три** секрета с очень разными последствиями
при замене. Спутать первые два — дорогая ошибка здесь.

### `AUTH_JWT_SECRET` — ротация без недоступности {#rotacao-do-auth-jwt-secret}

Пара Ed25519, подписывающая access token, выводится из него. Ротация —
тот же трёхшаговый танец, что и для мастер-ключа (ниже):

1. `AUTH_JWT_SECRET_PREVIOUS` получает старое значение; `AUTH_JWT_SECRET` получает
   новое. Перезапустите api.
2. Оба ключа появляются в `/.well-known/jwks.json`, и оба проверяют; **подписывает** только
   новый. Api выдаёт `WARN` один раз на процесс, при первой
   проверке или чтении JWKS после загрузки (предыдущий ключ выводится по
   требованию, а не при старте), пока это длится.
3. Через 15 минут (TTL access token) ни один токен старого ключа
   не выживает. **Удалите `AUTH_JWT_SECRET_PREVIOUS`** и перезапустите.

Никто не разлогинивается: refresh-токены хешируются с `AUTH_TOKEN_PEPPER`,
а не с этим ключом, и начиная с [RN-613](business-rules/api.md#rn-613)
pepper обязателен и никогда не заимствуется у этого ключа.

**Порядок, если эта установка старше RN-613: сначала pepper, потом JWT.**
До RN-613 незаданный pepper молча откатывался на `AUTH_JWT_SECRET` — а
compose production и установки даже не передавали `AUTH_TOKEN_PEPPER` в
api, так что это касалось каждой установки compose. Теперь api **отказывается
стартовать** без pepper, с сообщением о том, что делать. Миграция,
которая никого не разлогинивает:

1. Задайте `AUTH_TOKEN_PEPPER` равным **текущему** значению `AUTH_JWT_SECRET`
   (скопируйте его; не генерируйте новый). Перезапустите api. Хеши токенов
   побайтно те же, что были, поэтому каждый refresh-токен и PAT продолжает работать.
   `install.sh` делает этот шаг сам, когда находит прежний `.env` в
   папке, из которой запускается, и сообщает об этом в терминале, не печатая
   значение; в Kubernetes `AUTH_TOKEN_PEPPER` уже был в `ExternalSecret`.
2. Только затем выполните ротацию `AUTH_JWT_SECRET` тремя шагами выше. Отныне
   два секрета независимы, и pepper, равный *старому* секрету JWT, —
   ожидаемое состояние, а не остаток.

**Если кто-то повернёт JWT до разделения**, в версии до RN-613
эта ротация *была* заменой pepper: все разлогинены, каждая открытая
ссылка e-mail/сброса умирает, и каждый PAT перестаёт аутентифицировать — глобальный
выход, описанный в следующем разделе. Отменить нельзя, кроме как вернув старое значение
в качестве `AUTH_TOKEN_PEPPER` (что оживляет старые неистёкшие
токены и инвалидирует всё, выданное в промежутке). Начиная с RN-613
ошибка не происходит молча: без pepper api не стартует. Единственный
способ всё ещё в неё попасть — сгенерировать **новый** pepper во время миграции
вместо копирования текущего секрета JWT — тот же глобальный выход.

Проверка: `apps/api/test/infrastructure/security/ed25519-access-token-issuer.spec.ts`
(describe "rotação de chave"); для pepper —
`apps/api/test/infrastructure/security/auth-key-material.spec.ts` (describe
"pepperAtual (RN-613)": отказ при загрузке и его сообщение),
`apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`
(describe "a migração do RN-613": refresh, захешированный через старый откат, остаётся
действительным при pepper, заданном как старый секрет JWT, и переживает
ротацию JWT) и `scripts/dev/install-env.spec.ts` (`.env`, который установщик
пишет в обоих случаях, через `docker compose config`).

### `AUTH_TOKEN_PEPPER` — глобальный выход, без полумер {#troca-do-auth-token-pepper}

Это ключ HMAC для хеша refresh-токенов и токенов учётной записи.
Его замена инвалидирует, всё сразу:

- **каждый** refresh-токен в обращении — все разлогинены;
- **каждую** открытую ссылку подтверждения e-mail и сброса пароля;
- **каждый** personal access token (PAT) — runner, запущенный с `--token`,
  перестаёт аутентифицироваться (ключи устройств не затронуты);
- счётчики блокировки: каждая заблокированная учётная запись разблокируется.

Пароли выживают (argon2id, без pepper): люди снова входят как обычно.
Отклонённый так refresh появляется как `refresh_unknown` в `auth_events`,
а не как `refresh_reuse_detected`.

`AUTH_TOKEN_PEPPER_PREVIOUS` нет, и это осознанное решение:
принимать двойную проверку в каждом refresh навсегда ради сценария,
который случается раз в жизни, не окупается. Если вам нужно его сменить —
например, при подозрении на утечку базы, — предупредите людей заранее: симптом
для пользователя — быть разлогиненным без видимой причины и видеть, что
ссылка сброса говорит «expirado».

> Api **не** перестаёт стартовать с новым pepper. Она просто перестаёт
> узнавать какой-либо старый токен. Если поддержка сообщает «все были разлогинены
> одновременно», эта переменная — первое место, куда смотреть, — и, в
> версии до [RN-613](business-rules/api.md#rn-613), где она
> никогда не была задана, `AUTH_JWT_SECRET`. Без него она **перестаёт** стартовать в
> production: см. порядок миграции выше.

Проверка: `apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`
([RN-597](business-rules/api.md#rn-597)).

### `BRABO_SERVICE_TOKEN` — ротация без недоступности, с обеих сторон {#rotacao-do-brabo-service-token}

Это общий секрет, аутентифицирующий трафик api ↔ engine
([RN-035](business-rules/api.md#rn-035)). Он не имеет ничего общего с сессией
пользователя: ошибка в нём никого не разлогинивает, она ломает внутреннюю
связь.

Танец тот же, что для `AUTH_JWT_SECRET`, с той разницей, что он
выполняется в **обеих** нагрузках — и порядок важен, потому что каждая сторона отправляет
текущий и принимает оба:

1. `BRABO_SERVICE_TOKEN_PREVIOUS` получает старое значение в **api и
   engine**; `BRABO_SERVICE_TOKEN` получает новое в обоих. Перезапустите
   оба. В production api, engine и broker проверяют старое
   значение по тому же правилу, что и новое, поэтому если старое значение — публичное
   значение по умолчанию или короче 16 символов, каждый из них отказывается стартовать на этом
   шаге и называет переменную
   ([RN-598](business-rules/api.md#rn-598),
   [RN-601](business-rules/engine.md#rn-601)). Уход со
   слабого токена, таким образом, означает пропуск `_PREVIOUS` и оплату этого
   окном `403`/`401`, описанным ниже.
2. Пока обе стороны запущены с новой переменной, трафик работает в любой
   комбинации старых и новых подов — именно это делает rollout безопасным
   на полпути.
3. Когда rollout обоих Deployment-ов закончен, **удалите
   `BRABO_SERVICE_TOKEN_PREVIOUS`** и перезапустите.

Пропуск шага 1 и простая замена текущего значения дают `403`/`401`
в течение всего окна, пока старый под остаётся с любой из сторон, —
симптом из
[диагностики выше](#diagnostico-do-deploy).

Проверка: в api — `apps/api/test/infrastructure/security/service-token.spec.ts`
(describe "rotação do BRABO_SERVICE_TOKEN") и
`apps/api/test/interfaces/engine-service.guard.spec.ts`; в engine —
`apps/engine/test/engine_web/plugs/verify_service_token_test.exs` и
`apps/engine/test/engine/runtime_service_token_test.exs` (правило загрузки); в
broker — `apps/broker/src/config.spec.ts`.

> **Где переменные `_PREVIOUS` доходят до процесса.** Во всех трёх
> compose (`docker-compose.yml`, `docker-compose.prod.yml`,
> `docker-compose.install.yml`) все они отображены в `environment:`
> сервиса, который их читает, пустые по умолчанию — достаточно задать одну в `.env`
> и пересоздать сервис
> ([RN-595](business-rules/api.md#rn-595); охраняется
> `scripts/ci/previous-nos-composes.spec.ts`, который выводит список из
> кода). **В Kubernetes они доходят до Pod-ов через хранилище секретов**
> (AT-220): `ExternalSecret`
> (`deploy/k8s/base/common/externalsecrets.yaml`) забирает объект `brabo`
> целиком через `dataFrom.extract`, так что существующий там `_PREVIOUS` попадает в
> `brabo-secrets`, а несуществующего там просто нет — без сбоя синхронизации
> вне ротации. Они никогда не перечисляются по одному: элемент `data`, у которого
> отсутствует свойство, проваливает синхронизацию всего Secret, а отсутствующий `_PREVIOUS`
> — нормальное состояние. В любом случае проверьте внутри
> контейнера (`printenv`), прежде чем доверять шагу 2.

#### Выполнение в Kubernetes {#rotacao-no-kubernetes}

Тот же танец, где объект `brabo` в provider-е секретов играет роль
`.env`. В локальном кластере этот объект — Secret `brabo`, созданный
bootstrap-ом; в staging/prod — запись provider-а, на которую указывает `SecretStore`.

1. **Добавьте** ключ `_PREVIOUS` (старое значение) и **замените** текущий ключ (новое
   значение) в объекте `brabo` — оба в одном изменении. Локально:

   ```bash
   kubectl -n brabo patch secret brabo --type merge -p \
     '{"stringData":{"AUTH_JWT_SECRET_PREVIOUS":"<old>","AUTH_JWT_SECRET":"<new>"}}'
   ```

2. **Заставьте operator синхронизировать сейчас** вместо ожидания `refreshInterval`
   (1h) и проверьте, что ключ пришёл:

   ```bash
   kubectl -n brabo annotate externalsecret brabo-secrets force-sync="$(date +%s)" --overwrite
   kubectl -n brabo get secret brabo-secrets -o go-template='{{range $k, $v := .data}}{{$k}}{{"\n"}}{{end}}' | grep _PREVIOUS
   ```

3. **Перезапустите** того, кто его читает. `envFrom` читается при старте контейнера:
   изменение Secret не меняет работающий Pod. `api` для
   `AUTH_JWT_SECRET` и `CREDENTIALS_MASTER_KEY`, `api` **и** `engine` для
   `BRABO_SERVICE_TOKEN`:

   ```bash
   kubectl -n brabo rollout restart deployment/api deployment/engine
   kubectl -n brabo exec deploy/api -- printenv AUTH_JWT_SECRET_PREVIOUS
   ```

4. **Выведите его из обращения**, когда условие самой ротации выполнено (15 min для
   `AUTH_JWT_SECRET`, оба rollout-а завершены для `BRABO_SERVICE_TOKEN`,
   `falhas=0` и ноль ожидающих для мастер-ключа): **удалите** ключ `_PREVIOUS`
   из объекта `brabo`, снова принудительно синхронизируйте (шаг 2 — ключ
   исчезает из `brabo-secrets`, а не остаётся) и снова перезапустите
   (шаг 3). До перезапуска Pod-ы держат старое значение в памяти, и
   api продолжает предупреждать, что идёт ротация.

   ```bash
   kubectl -n brabo patch secret brabo --type json -p \
     '[{"op":"remove","path":"/data/AUTH_JWT_SECRET_PREVIOUS"}]'
   ```

Проверка: четыре шага выполнены против chart-а External Secrets
Operator, зафиксированного в `deploy/k8s/helm/charts.env` (0.19.2), в одноразовом
кластере k3d с локальным `SecretStore`: ключ появился в
`brabo-secrets` после `force-sync` и исчез после удаления, а
`ExternalSecret` оставался `SecretSynced`. Начиная с AT-146 те же четыре шага выполняются
каждую неделю для `CREDENTIALS_MASTER_KEY`, внутри репетиции мастер-ключа
(`make test-rotacao-chave-mestra-k8s`, см.
[Проверка без ожидания инцидента](#rotacao-da-chave-mestra)) — у
остальных ключей `_PREVIOUS` автоматизированного запуска пока нет. В каждом PR выполняется
`scripts/ci/previous-nos-composes.spec.ts`, который проваливается, если
`ExternalSecret` перестаёт использовать `dataFrom.extract` или перечисляет `_PREVIOUS` в
`data:`.

```bash
# gere um valor com entropia suficiente; ele nunca precisa ser digitado
openssl rand -base64 48
```

### Учётная запись заблокирована lockout-ом {#conta-travada-por-lockout}

Lockout короткий (от 30s до 15 минут) и разрешается сам:
скользящее окно опустошается. **Endpoint-а разблокировки нет** — намеренно, см.
[RN-031](business-rules/api.md#rn-031). Если нужно разблокировать кого-то
прямо сейчас:

```sql
-- A chave é um HMAC do e-mail, não o e-mail. Ache-a pelo evento recente:
select subject_key, count(*), max(occurred_at)
  from auth_events
 where kind in ('login_failure', 'login_blocked_user')
   and occurred_at > now() - interval '30 minutes'
 group by subject_key order by 3 desc;

delete from auth_lockout_hits where bucket_key = '<subject_key>';
```

Успешный сброс пароля тоже разблокирует учётную запись.

Проверка: **никакой** для двух запросов выше — они сверены со
схемой чтением, ни разу не выполнялись spec-ом. Сам lockout (окно,
счётчик, что его снимает) покрыт
`apps/api/test/application/use-cases/auth/lockout.spec.ts`.

> **След никогда не удаляется.** `auth_lockout_hits` — эфемерный
> счётчик; `auth_events` — append-only и переживает всё, включая
> удаление пользователя (без внешнего ключа, намеренно).

## Ротация мастер-ключа {#rotacao-da-chave-mestra}

Решения — в [ADR 0027](adr/0027-fase5-backup-hardening-release.md).

`CREDENTIALS_MASTER_KEY` упаковывает DEK, шифрующие секреты пользователя:
ключи API LLM и токены git. Он ротируется периодически и обязательно
после любого подозрения на утечку.

### Что поставлено на карту {#whats-at-stake}

Замена переменной и перезапуск api с одним ключом делает каждые
существующие учётные данные нечитаемыми, все разом, без ошибки загрузки — сбой
проявляется только при первом использовании, как «não foi possível decifrar», и пути назад
нет, кроме восстановления старого ключа.

Поэтому у ротации три шага, а не один. Во время среднего два
ключа сосуществуют:

| переменная | роль |
|---|---|
| `CREDENTIALS_MASTER_KEY` | ТЕКУЩИЙ ключ — всегда используется для шифрования |
| `CREDENTIALS_MASTER_KEY_PREVIOUS` | предыдущий ключ — пробуется, только когда текущий не подходит |

Две таблицы хранят конверты: `user_credentials` и
`project_git_connections`.

Начиная с [RN-563](business-rules/api.md#rn-563) каждый конверт несёт также
**`key_id`** — отпечаток ключа, который его упаковал. Именно он делает
прогресс шага 2 отвечаемым на SQL. В 3 часа ночи о нём важны две вещи:

- **Он никогда не решает, открывается ли строка.** Чтение по-прежнему пробует текущий
  ключ и откатывается на предыдущий; AES-GCM аутентифицирует, и он —
  авторитет. Метка — это метаданные, и строка, чья метка не согласуется с
  конвертом, всё равно корректно переупаковывается ([ADR 0158](adr/0158-o-id-da-chave-mestra-gravado-no-envelope.md)).
- **`key_id IS NULL` означает «записано до появления этого столбца», никогда «в
  текущем ключе».** В установке, предшествующей ему, всё равно `NULL`
  до первой ротации, и запросы ниже считают это ожидающим — что
  и есть честный ответ.

Возьмите текущий отпечаток из собственного лога api; она печатает строку при загрузке:

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=200 \
  | grep 'chave mestra corrente'
# chave mestra corrente: key_id=4f2b91c0a77e13d5
```

### Сначала: оцените объём {#before-size-it-up}

```sql
select 'user_credentials' as tabela, count(*) from user_credentials
union all
select 'project_git_connections', count(*) from project_git_connections;
```

Переупаковка — один UPDATE на строку. Тысячи строк занимают секунды;
порядок величины полезно знать до начала.

### 1. Опубликуйте оба ключа {#1-publish-both-keys}

Сгенерируйте новый и опубликуйте **оба** в provider-е секретов, сохранив
старый в `CREDENTIALS_MASTER_KEY_PREVIOUS`:

```bash
openssl rand -hex 32   # a chave nova
```

В локальном кластере исходный Secret создаётся bootstrap-ом; в
staging/prod значение идёт в provider, из которого читает External Secrets.
Затем перезапустите api, чтобы она загрузила оба:

> Публикация `CREDENTIALS_MASTER_KEY_PREVIOUS` в объекте `brabo`
> provider-а помещает его в `brabo-secrets` при следующей синхронизации (`ExternalSecret`
> забирает объект целиком) — принудительно синхронизируйте и подтвердите, что он пришёл, как в
> [Выполнении в Kubernetes](#rotacao-no-kubernetes), затем перезапустите. В
> compose это `.env` плюс пересоздание api.

```bash
kubectl -n brabo rollout restart deployment/api
kubectl -n brabo rollout status  deployment/api
```

Подтвердите, что api в режиме ротации — она намеренно предупреждает в логе, и
предупреждение называет **оба** отпечатка, с которыми сравнивают запросы
ниже:

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=50 \
  | grep CREDENTIALS_MASTER_KEY_PREVIOUS
# ... rotação em andamento (atual key_id=<NEW>, anterior key_id=<OLD>). ...
```

> С этого момента **ничто не ломается**: новый секрет сразу рождается в новом
> ключе, старый секрет остаётся читаемым через предыдущий. Можно
> остановиться в этом состоянии на часы, если нужно, — но не на недели:
> приём двух ключей удваивает поверхность утёкшего ключа, что
> и является причиной, по которой вы ротируете.

### 2. Переупакуйте хранилище {#2-re-wrap-the-store}

```bash
kubectl -n brabo exec deploy/api -- node scripts/rewrap-deks.js
```

Ожидаемый вывод — скрипт печатает по-португальски, и вот что он
действительно пишет (`apps/api/src/scripts/rewrap-deks.ts`, `main`):

```
[rewrap] resultado

  user_credentials         total=12  re-embrulhados=12  já na chave atual=0  falhas=0
  project_git_connections  total=3   re-embrulhados=3   já na chave atual=0  falhas=0

[rewrap] concluído. Agora remova CREDENTIALS_MASTER_KEY_PREVIOUS e reinicie a api.
```

Счётчики: `re-embrulhados`, `já na chave atual` и `falhas`. Есть два других исхода.
Когда ничего не нужно было переупаковывать, последняя строка — `[rewrap] nada a fazer — o
acervo já está na chave atual.`. Когда какая-то строка не удалась, каждая идёт в `stderr` как
`[rewrap] <tabela>#<id>: <motivo>`, запуск заканчивается `[rewrap] <N>
registro(s) não abriram com nenhuma das duas chaves. NÃO remova
CREDENTIALS_MASTER_KEY_PREVIOUS até resolver.`, а код выхода — 1.

Свойства, важные, если что-то прервёт скрипт:

- **Идемпотентен.** Повторный запуск считает уже конвертированные строки как
  `já na chave atual` и ничего не перезаписывает. Прервали? Запустите
  снова.
- **Меняется только конверт.** Шифротекст секрета остаётся побайтно
  тем же, поэтому остановка посередине оставляет хранилище согласованным: часть в
  новом ключе, часть в старом, и обе читаемы, пока PREVIOUS
  существует.
- **`falhas > 0` блокирует шаг 3.** Это строки, которые не открываются
  ни одним ключом — обычно пришедшие из другой среды или от
  прерванной предыдущей ротации с уже выброшенным ключом.
  Скрипт идентифицирует каждую по id и называет, ПОЧЕМУ она не удалась, — строка из
  другой среды («embrulhado pela chave `<kid>`»), строка, чья метка
  не согласуется с конвертом («rótulo incoerente ou registro adulterado»),
  и строка вообще без метки — три разных диагноза с тремя
  разными ответами. Не удаляйте PREVIOUS: без него вы потеряете и то, что
  ещё открывалось.

**Прервали и хотите знать, где остановились?** Спросите базу, а не
запускайте скрипт снова ради счётчика — с `<NEW>`, текущим отпечатком
из лога выше:

```sql
select 'user_credentials' as tabela, count(*) as pendentes
  from user_credentials       where key_id is distinct from '<NEW>'
union all
select 'project_git_connections', count(*)
  from project_git_connections where key_id is distinct from '<NEW>';
```

`is distinct from`, никогда `<>`: строки с `key_id IS NULL` должны считаться
ожидающими, а `<>` молча их отбросил бы.

### 3. Выбросьте старый ключ {#3-discard-the-old-key}

Только после `falhas=0` **и** ответа `0` на запрос выше в обеих таблицах.
Они говорят разное, и вам нужно и то и другое: `falhas=0` означает, что ничто не отказалось
открыться в этом запуске, а запрос означает, что ничего не осталось позади, — включая
строки, до которых предыдущий, прерванный запуск так и не добрался.

```bash
# remova CREDENTIALS_MASTER_KEY_PREVIOUS do provedor, depois
kubectl -n brabo annotate externalsecret brabo-secrets force-sync="$(date +%s)" --overwrite
kubectl -n brabo rollout restart deployment/api
```

Проверьте, что предупреждение о ротации исчезло из лога и что
существующие учётные данные всё ещё работают (самый прямой путь — экран
учётных данных проекта или любой ход агента, использующий ключ LLM).

### Проверка без ожидания инцидента {#verifying-without-waiting-for-an-incident}

**У всего цикла есть именованная проверка, и она выполняется в CI**
([RN-562](business-rules/api.md#rn-562)):

```bash
pnpm --filter api test -- test/scripts/rewrap-deks.spec.ts
```

Этот spec проводит последовательность этой страницы против настоящего Postgres и **обеих**
таблиц: шифрует с K1, публикует K2, переупаковывает, выбрасывает K1 и всё ещё расшифровывает. Он
также фиксирует два свойства, на которые опирается эта процедура, — идемпотентность (второй
запуск сообщает `re-embrulhados=0`) и нечитаемую строку, которая подсчитывается и называется,
не прерывая остальные.

Более узкое покрытие тех же примитивов в памяти — включая случай, когда
не работает ни один ключ, и случай, когда метка `key_id` лжёт, — живёт в
`test/infrastructure/security/envelope-encryption.service.spec.ts`.

`rewrap` также работает в любой среде: в тестовой полный цикл вручную
укладывается в несколько минут.

**Запускалась ли по-настоящему? Нет.** Ответ мейнтейнера (2026-09-27): эта
ротация **ни разу** не выполнялась в реальной среде. Так что spec выше
— не страховочная сетка под отработанной процедурой: до AT-146 он был единственным
доказательством и никогда не касался образа, `ExternalSecret` или перезапуска api.

**Репетиция в кластере, каждую неделю (AT-146).**
`make test-rotacao-chave-mestra-k8s` (`deploy/k8s/test-rotacao-chave-mestra.sh`)
выполняет три шага этой страницы против локального кластера, с той же
механикой: он записывает учётные данные LLM со случайным значением через API
и проверяет, что каждый конверт открывается сегодняшним ключом; **шаг 1** публикует новый
ключ и старый как `_PREVIOUS` в исходном Secret `brabo` (локальная
замена provider-а — никогда не напрямую `brabo-secrets`), принудительно
синхронизирует `ExternalSecret`, ждёт прихода `_PREVIOUS`, перезапускает api и
требует предупреждения о ротации с **обоими** отпечатками; **шаг 2** требует
ожидающих строк по запросу выше, запускает `node scripts/rewrap-deks.js` из образа
(`falhas=0`), требует **ноль** ожидающих и запускает снова (`nada a fazer`);
**шаг 3** удаляет `_PREVIOUS` из источника, требует, чтобы он **исчез**
из `brabo-secrets` после синхронизации, перезапускает api, требует строку загрузки
с новым отпечатком и отсутствия предупреждения о ротации, и проверяет, что каждый конверт
открывается только новым ключом — и что учётные данные из начала расшифровываются
в **то же значение** (сравнение по sha256 внутри пода; значение никогда
не покидает его). Вердикт — код выхода. Это **последняя** цель
запланированного `.github/workflows/propriedades.yml`, потому что она меняет секрет и
перезапускает api, и оставляет кластер на новом ключе без `_PREVIOUS`
— завершённая ротация, а не половинчатая. Первый зелёный запуск: `36502355798`
(2026-09-29, 47 s).

Чего репетиция **не** покрывает, объявлено: строк `project_git_connections`
(создание подключения git через API проверяет токен у настоящего
provider-а, а у кластера доказательства нет выхода в сеть — таблица читается
проверяющим и `rewrap`, обычно с 0 строк; её конверт — тот же код,
доказанный на обеих таблицах spec-ом выше), и provider секретов staging/production
(здесь источник — локальный Secret, который читает `SecretStore` overlay;
`ExternalSecret` и operator — настоящие). Это
репетиция в одноразовом кластере, **не** ротация реальной среды:
«ни разу не запускалась по-настоящему» остаётся правдой, пока кто-то не повернёт ключ в такой.

### Взаимодействие с restore {#interaction-with-restore}

**Восстановление дампа в среде с другим мастер-ключом возвращает
целую базу с бесполезными учётными данными.** Дамп несёт
упакованные DEK, а не ключ. Если вы восстановили бэкап production в
тестовой среде и учётные данные не открываются, это не повреждение:
это не тот ключ — и начиная с [RN-563](business-rules/api.md#rn-563) вы можете
подтвердить это сравнением, а не методом исключения, прочитав `key_id`
любой строки и поставив его рядом со строкой `chave mestra corrente` в
логе загрузки api. См.
[Restore](#restore).

Именно поэтому мастер-ключ — часть плана восстановления: бэкап базы
без соответствующего ключа не восстанавливает секреты пользователя.

### Когда что-то идёт не так {#when-something-goes-wrong}

| симптом | причина |
|---|---|
| api стартует без предупреждения о ротации, но скрипт требует PREVIOUS | переменная так и не дошла до пода; ESO пересинхронизирует только каждый `refreshInterval` (1h) |
| `falhas` равно общему числу | опубликованный PREVIOUS — не тот ключ, который упаковал хранилище |
| `já na chave atual` равно общему числу без предыдущего запуска | у обеих переменных одно значение — сервис в этом случае игнорирует PREVIOUS |
| учётные данные перестают работать ПОСЛЕ шага 3 | какая-то строка осталась позади; немедленно переопубликуйте PREVIOUS и запустите скрипт снова. Запрос прогресса шага 2 — то, что это предотвращает, и это проверка, которую надо запускать первой |
| запрос ожидающих отвечает полным числом в базе, которую ещё никто не ротировал | ожидаемо: `key_id` пишется начиная со следующей записи, поэтому у установки до [RN-563](business-rules/api.md#rn-563) он `NULL` везде до первой ротации. `NULL` намеренно считается ожидающим — «не знаю, какой ключ» не означает «уже в текущем» |
| `rewrap` говорит, что строка в ключе, который не является ни текущим, ни предыдущим | строка пришла из другой среды — чаще всего это дамп, восстановленный между установками. См. [Взаимодействие с restore](#rotacao-da-chave-mestra) ниже; `key_id` строки против `key_id` из лога загрузки api говорит с первого взгляда |

---

## Инцидент стоимости {#incidente-de-custo}

Агенты тратят токены на каждом ходу, а агент, застрявший в цикле, тратит
быстро. Этот раздел — для момента, когда почасовая стоимость взлетает и кто-то
должен решить, что отрезать.

### Сигнал {#signal}

Алерт *Custo por hora acima do limite* срабатывает, когда прогнозируемые расходы превышают
USD 5/час в любом проекте:

```promql
max(sum by (project) (rate(brabo_llm_cost_micros_total[10m])) * 3600 / 1000000)
```

Алерт — **предупреждение**, а не тормоз. Настоящий тормоз — доменные
`budgets`, и они действуют по проекту/сессии, никогда глобально
([RN-019](business-rules/api.md#rn-019)).

### 1. Какой проект, какой агент {#1-which-project-which-agent}

Grafana → панель **Brabo · visão executiva** → панель стоимости по проекту.
Или прямо из базы, которая также даёт вам агента и
модель:

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

Два прочтения меняют действие:

- **Один агент, доминирующий в списке** с множеством коротких вызовов, означает цикл:
  ToolLoop, повторяющий тот же инструмент без сходимости.
- **Мало вызовов и высокая стоимость** означают дорогую модель на дешёвой работе —
  неверный binding, а не цикл.

### 2. Проверьте бюджет {#2-check-the-budget}

```sql
select b.project_id, b.session_id,
       b.limit_micros / 1e6  as limite_usd,
       b.spent_micros / 1e6  as gasto_usd,
       round(100.0 * b.spent_micros / nullif(b.limit_micros, 0)) as pct,
       b.policy
  from budgets b
 order by pct desc nulls last;
```

`policy` определяет поведение на пределе:

- **`block`** — вызов отклоняется. Это значение по умолчанию и то, что вам
  нужно в production.
- **`allow`** — предел становится простой записью; расходы продолжаются.
  Проект в `allow`, тратящий много, **не останавливается сам**. Проверьте
  это прежде всего: это самая частая причина «бюджет
  не удержал».

### 3. Отрежьте расходы {#3-cut-the-spend}

В порядке обратимости, от самого мягкого к самому радикальному.

**a) Выведите агентов из автоматической автономии.** Они перестают действовать
сами и снова требуют одобрения на каждое действие, не теряя
контекста:

```sql
update agent_autonomy
   set mode = 'require_approval', updated_at = now()
 where project_id = '<projeto>'
   and mode = 'auto_approve';
```

`agent_autonomy.mode` — это enum `permission_policy`
(`auto_approve | require_approval | deny`) — значения `manual` нет,
и предыдущая версия этого шага использовала его и сразу падала.
`and mode = 'auto_approve'` намеренный: без него update
превратил бы каждую строку `deny` проекта в `require_approval`, ослабив
ровно то, что кто-то закрыл. Строки `"*"` (автоматический режим, RN-153)
покрываются тем же update.

Чего этот шаг **не** отрезает: шаблон в `allow` в
`permissions.json` проекта по-прежнему автоматически одобряет совпадающее — `decide()` читает
файл после `agent_autonomy`, и файл может поднять решение обратно
до `auto_approve` (`apps/api/src/domain/actions/decide.ts`, `decide`).
Если расходы идут от команд, которые файл разрешает, переходите к (c).

SQL-блоки этого раздела выполняются против мигрированной схемы
`apps/api/test/runbook/sql-do-incidente-de-custo.spec.ts`, который также
проверяет, что (a) меняет `auto_approve` и оставляет `deny` в покое — недопустимое
значение или переименованный столбец здесь проваливает набор тестов api, а не
инцидент.

**b) Смените binding модели на локальную.** Ollama стоит ноль; качество
падает, расходы останавливаются сразу:

```sql
-- veja o binding vigente e o escopo que o resolve
select scope, scope_id, model_id from model_bindings where scope_id = '<projeto>';
```

Затем направьте binding проекта на модель `local` через экран
настроек (побеждает наиболее конкретная область: сессия > агент > проект >
workspace — [RN-020](business-rules/api.md#rn-020)).

**c) Снизьте предел и убедитесь, что это `block`.** Заставляет сам домен
отклонять следующие вызовы:

```sql
update budgets
   set policy = 'block',
       limit_micros = least(limit_micros, spent_micros + 1000000)  -- +1 USD
 where project_id = '<projeto>';
```

**d) Закройте сессии проекта.** Последнее средство: прерывает работу
в процессе. Используйте обычный переход (`closing`), никогда `kill` пода
— убийство пода не закрывает сессию, а лишь создаёт сироту
(см. [Rollout engine](#rollout-do-engine)).

### 4. После {#4-afterward}

- **У Psicólogo уже есть улики.** Если причиной был цикл
  агента, его анализ указывает на целевого агента, и Anamnese может
  предложить patch инструкции. Исправление инструкции — то, что не даёт
  этому повториться; возня с бюджетом лишь покупает время.
- **Проверьте, что алерт дошёл.** Правила живут в Grafana, а не в
  Prometheus: если Grafana была недоступна, предупреждения не было, и тишина
  не означала здоровья.

### Чего этот раздел не исправляет {#what-this-section-doesnt-fix}

Уже понесённые расходы. Metering — это запись, а не возврат: `token_usage`
считает потраченное, и ничто здесь не возвращает деньги от
provider-а. Единственная настоящая профилактика — `policy = 'block'` с
разумным пределом **до** инцидента.

---

## Наблюдаемость {#observabilidade}

Как отслеживать сессию, находить стоимость и диагностировать, когда данных нет.
Решения — в
[ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md).

### Локальная наблюдаемость, без кластера {#observabilidade-local}

Всё ниже этого подраздела предполагает запущенный кластер. Для метрик
и логов без подъёма Kubernetes есть overlay Compose
([ADR 0070](adr/0070-observabilidade-no-compose-local.md)):

```bash
pnpm dev:obs     # sobe a stack de dev + Prometheus, Loki, Alloy e Grafana
pnpm obs:down    # derruba só os quatro, deixando os apps de pé
```

Команда заканчивается проверкой того, что поднялось, — если в каждой
строке `ok`, в панели есть данные; если она жалуется, она говорит, какой части
не хватило.

Проверка: эта финальная проверка — `scripts/dev/observabilidade-pronta.mjs`,
и это **самопроверка, а не доказательство** — она выполняется только когда кто-то поднимает
overlay, и у неё нет ни spec, ни workflow. Изменение, ломающее
overlay, проявится в следующий раз, когда кто-то запустит `pnpm dev:obs`.

| инструмент | адрес | для чего |
|---|---|---|
| Grafana | <http://localhost:3001> | панели и логи, без входа |
| Logs | <http://localhost:3001/d/brabo-logs> | по одному сервису или все три вместе |
| Prometheus | <http://localhost:9090> | проверить цель и сырые ряды |
| Loki | <http://localhost:3100> | прямой запрос (обычный путь — Grafana) |

**Панели — ТЕ ЖЕ, что в кластере**: Compose монтирует
`deploy/k8s/observability/dashboards/` напрямую, и UID источников данных
(`brabo-prometheus`, `brabo-loki`) те же. Новая панель работает
в обеих средах без копирования.

**Чего этот overlay не делает:** трассировки. Без OpenTelemetry
Collector посередине нет Tempo, и это решение, а не
недосмотр ([ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md),
решение 9). `trace_id` по-прежнему попадает в лог, и этого достаточно, чтобы
сопоставить api и engine вручную.

Три вещи, которые сбивают людей с толку и которые стоит знать, прежде чем открывать
issue:

1. **Пустая панель стоимости/токенов ожидаема на новой базе.** Эти
   метрики имеют метки (`project`, `provider`), а в `prom-client`
   метрика с метками не существует до первого наблюдения. Один вызов
   LLM — и ряд появляется.
2. **В Loki идут только `api`, `engine` и `web`.** Postgres и Ollama исключены
   из-за шума; сам стек наблюдаемости исключён, потому что
   в том же проекте Compose он поглощал бы собственный лог в цикле.
3. **Уровень `OUTRO`** — это строка продолжения дерева `pino-pretty`,
   у которой нет собственного уровня. Это не потерянный лог.

### Где что находится {#where-things-are}

| инструмент | локальный адрес | для чего |
|---|---|---|
| Grafana | <http://localhost:3001> | панели, трассы, логи, алерты |
| Prometheus | `kubectl -n monitoring port-forward svc/prometheus-server 9090:80` | проверить цель и сырые ряды |
| Tempo | источник данных Grafana | трассы |
| Loki | источник данных Grafana | логи |

Две панели в папке **Brabo**: *visão executiva* (стоимость/час и
токены/мин по проекту, активные сессии, решения по действиям) и
*visão operacional* (очередь Oban по состоянию, задержка p50/p95 LLM по provider-у,
заблокированные задачи, сессии по реплике).

### Отслеживание сессии от корня до вызова инструмента {#following-a-session-from-the-root-to-a-tool-call}

1. Возьмите `trace_id` сессии. Это среднее поле
   `traceparent`, хранящегося в `sessions.trace_parent`:

   ```bash
   # 00-<trace_id>-<span_id>-01
   curl -sS -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/projects/$PROJ/sessions/$SESS | jq -r .traceParent
   ```

2. В Grafana → **Explore** → источник данных **Tempo** → вкладка **TraceQL**
   вставьте `trace_id`. Дерево возвращается с `session.create` (api)
   в корне и под ним `agent.turn` → `tool.call` / `llm.turn` /
   `gate.scanner` (engine).

3. Из span-а кнопка **Logs for this span** переходит к строкам Loki
   с этим `trace_id`. Обратный путь — от строки лога к трассе
   — ссылка **TraceID**, появляющаяся в деталях строки.

4. Стоимость этой сессии: панель *visão executiva* фильтрует по
   проекту. Для точного значения по сессии источник — база
   (`token_usage.cost_micros`), а не метрика — метрика намеренно агрегирована
   по проекту и provider-у, чтобы не создавать ряд на каждую
   сессию.

### Когда в Tempo нет трассы {#quando-nao-ha-trace-no-tempo}

Название этого раздела изменилось вместе с поведением (ADR 0035), и
различение — первый шаг диагностики: **span создаётся всегда, в
любой среде.** `OTEL_EXPORTER_OTLP_ENDPOINT` управляет
ЭКСПОРТОМ. Поэтому «не вижу трассы в Grafana» и «трассы нет» — это
разные проблемы.

Прежде всего посмотрите, на чьей стороне сбой, — лог отвечает
сам:

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=20 | grep -o '"trace_id":"[^"]*"' | head
```

- **В логе есть `trace_id`, в Tempo трассы нет** → проблема в
  экспорте: следуйте пунктам 1–4 ниже.
- **В логе нет `trace_id`** → проблема в контексте, и это реже:
  либо `startTracing()` api не выполнился (см.
  `apps/api/src/tracing-boot.ts` — он должен быть первым import в `main.ts`),
  либо `Engine.Telemetry.Otel.setup/0` не был вызван до дерева
  супервизии.

По порядку, от наиболее к наименее вероятному:

**1. Переменная не задана.** Без `OTEL_EXPORTER_OTLP_ENDPOINT`
span создаётся и отбрасывается в конце, поэтому `trace_id` в
логе есть, а в Tempo ничего. В разработке это ожидаемо (без collector);
в кластере это дефект.

```bash
kubectl -n brabo exec deploy/api -- printenv OTEL_EXPORTER_OTLP_ENDPOINT
kubectl -n brabo exec deploy/engine -- printenv OTEL_EXPORTER_OTLP_ENDPOINT
```

**2. NetworkPolicy блокирует.** Это самый тихий сбой
из всех: span-ы создаются, отправка падает, а всё остальное остаётся
зелёным.

```bash
kubectl -n brabo get networkpolicy allow-otlp-egress
kubectl -n brabo logs -l app.kubernetes.io/name=engine --tail=50 | grep -i "error exporting"
```

**3. Неверный протокол.** Экспортёр Elixir говорит на **HTTP/protobuf (4318)**,
а не gRPC. Направление его на 4317 даёт `socket_closed_remotely` в каждом
пакете.

**4. Collector ничего не получает.**

```bash
kubectl -n monitoring logs deploy/otel-collector-opentelemetry-collector --tail=30
```

### Когда панель пуста {#when-a-panel-is-empty}

Почти всегда — **имя метрики**. Имена упоминаются строкой в трёх
местах, которые друг друга не видят: панели, правила алертов и
этот runbook. Сверьте с тем, что сервис реально отдаёт:

```bash
curl -sS http://localhost:3000/metrics | grep '^brabo_' | cut -d'{' -f1 | sort -u
kubectl -n brabo exec deploy/engine -- wget -qO- http://127.0.0.1:4000/metrics | grep -E '^(brabo|oban)_'
```

А если сервис её отдаёт, но в Prometheus её нет,
проблема в сборе:

```bash
kubectl -n monitoring port-forward svc/prometheus-server 9090:80
# depois: http://localhost:9090/targets — os jobs são `brabo-api` e `brabo-engine`
```

### Когда в Loki нет логов {#when-theres-no-log-in-loki}

Alloy — это DaemonSet, и он читает `/var/log/pods` узла, фильтруя
по пространству имён `brabo`.

```bash
kubectl -n monitoring logs -l app.kubernetes.io/name=alloy --tail=30 | grep -i error
```

Предупреждения `tailer stopped ... pods not found` нормальны после
rollout — Alloy продолжает гнаться за подами, которые уже удалены.

Приложения **не** могут говорить с Loki напрямую, и это намеренно:
`allow-otlp-egress` открывает только 4317/4318. Чтобы запросить извне:

```bash
kubectl -n monitoring port-forward svc/loki 3100:3100
curl -sS -G http://localhost:3100/loki/api/v1/query_range \
  --data-urlencode '{app="api"} | json | trace_id != ""' --data 'limit=5'
```

### Алерты {#alerts}

Провизионированы и видны в **Alerting → Alert rules** (папка Brabo), из
`deploy/k8s/observability/alerts/brabo-alerts.yaml`. Правила несут
заголовки на португальском — именно их вы ищете в Grafana:

| алерт (заголовок в Grafana) | серьёзность | срабатывает через | что исследовать |
|---|---|---|---|
| *Fila do Oban crescendo sem consumo* | `critical` | 10 min | ни одной реплики engine в Ready; пул Postgres исчерпан; worker застрял на job-е |
| *Sessão presa em closing* | `warning` | 15 min | [drain не завершился](#quando-a-sessao-escapa), или переход в `closed` не удался |
| *Custo por hora acima do limite* | `warning` | 5 min | [какой проект и какой агент](#incidente-de-custo); доменный бюджет остаётся жёстким контролем |
| *Backup do Postgres atrasado* — последний хороший бэкап старше 26 h | `critical` | сразу | CronJob не запустился, или запустился и упал — `brabo_backup_last_status` различает эти случаи; см. [Restore](#restore). «Бэкапа никогда не было» (`-1`) его **не** вызывает |
| *Última execução do backup falhou* | `warning` | сразу | хороший вчерашний бэкап может ещё существовать, и именно поэтому этот алерт остаётся незамеченным днями; причина — в `backup_runs.error_message` |

Это правила **Grafana**, а не Prometheus (отклонение зафиксировано в ADR
0026): они перестают вычисляться, если Grafana падает. Нет ни
Alertmanager, ни настроенного назначения уведомлений.

### Известные ограничения {#known-limits}

- Ни одна **настоящая** трасса агента не наблюдалась от начала до конца: проверка этого
  требует настроенного LLM (Ollama или ключ API). Механизм
  проверен генерацией span-ов прямо в трассу сессии.
- Web не экспортирует собственные span-ы — он **генерирует**
  `traceparent` и отправляет его в заголовке, а api принимает его как
  родителя. Логи браузера идут в консоль, а не в Loki.
- Короткое хранение: Tempo 24h, Loki 24h, Prometheus 2h. Это локальная
  среда.

---

## Реестр gate-ов {#registro-de-gates}

Gate-ы потока объявляются в `docs/gates.yml`
([ADR 0054](adr/0054-gates-como-registro-declarativo.md)). Две
операционные вещи стоит знать.

**Файл путешествует внутри образа.** `docker/api/Dockerfile.prod` копирует его
на обоих этапах, так же как делает с миграциями, а
`.dockerignore` явно включает его обратно — весь `docs/` игнорируется, и
это единственный файл оттуда, являющийся данными production, а не
документацией. В runtime он лежит в `/app/docs/gates.yml`; загрузчик
поднимается от `__dirname`, пока не найдёт его, без переменной
окружения.

**Нечитаемый файл не роняет api.** Загрузка ленивая:
тот, кто вызывает `GET /internal/gates`, получает ошибку, а остальной
процесс продолжает работу. Если маршрут возвращает ошибку, проверьте, что файл
попал в образ:

```bash
kubectl -n brabo exec deploy/api -- cat /app/docs/gates.yml | head -5
```

Пустой или отсутствующий означает, что образ собран без него — вероятно, тронутый
`.dockerignore` или build из контекста без `docs/`.

**Реестр путешествует; то, на что он указывает, — нет.** Gate `teste`/`ci`
называет файлы под `apps/api/test/`, `scripts/ci/` и `.github/`, и ни одного
из них нет в образе. Пока это не было разделено, загрузчик требовал
эти файлы в runtime, и маршрут отвечал `500` в каждой установке
— измерено на v6.1.0 как двенадцать 5xx примерно за 55 минут, с
`RegistroDeGatesInvalido`, перечисляющим одиннадцать целей как «não existe».
Воспроизведите старый сбой так:

```bash
docker exec <api> node -e "require('/app/infrastructure/gates/gate-registry.loader').carregarRegistro()"
```

В исправленном образе это ничего не печатает. Если выбрасывает
`RegistroDeGatesInvalido`, называя `.spec.ts` или workflow, образ
до исправления ([RN-070](business-rules/api.md#rn-070)); если
выбрасывает, называя *содержимое* gate (gate `block` без `script`,
gate `active` без улик), неверен сам реестр, и
исправлять нужно в репозитории.

Экран этот сбой не показывает: `PrGateTimeline` откатывается на
полный конвейер, когда `GET /gates` падает ([RN-084](business-rules/api.md#rn-084)),
так что единственным сигналом был лог api. `docker/smoke.sh` теперь вызывает оба
маршрута, обслуживающих реестр, против образа production: `GET /gates`
с bearer пользователя и `GET /internal/gates` с service token.
Одна функция проверяет тело обоих и проваливается на `500`, на
пустом списке и на реестре без `merge-protegida`. Именно это не даёт
сбою вернуться молча. Токен приходит в `curl` через
stdin (`--config -`), никогда через argv, поэтому не появляется ни в `ps`, ни в
логе CI.

Чтобы увидеть реестр так, как его видит api, уже проверенным:

```bash
kubectl -n brabo exec deploy/api -- \
  curl -sH "x-brabo-service-token: $BRABO_SERVICE_TOKEN" localhost:3000/internal/gates
```

Измерение прохождения НЕ запускается в production: это
`pnpm --filter api validacao:gates`, из репозитория, против
базы. См.
[docs/explanation/gates.md](explanation/gates.md).

---

## Среда инференса {#ambiente-de-inferencia}

Когда агент отвечает пусто, обрезанно, крайне медленно или «забывает»
собственные инструкции, проблема почти никогда не в доменном коде —
она здесь. Первые пять причин были найдены в девяти последовательных запусках
демо gate-ов и зафиксированы в
[ADR 0020](adr/0020-destravar-gates-qa-secops.md); все переменные
вынесены в `docker-compose.yml`.

| переменная | симптом, когда она неверна |
|---|---|
| **GPU** | сервис `ollama` без зарезервированного устройства оставляет GPU простаивать и работает на 100% на CPU: промпт из ~7.000 токенов занимает ~50s только на приём. Override опционален (`docker-compose.gpu.yml`, `pnpm dev:gpu`), вынесен из основного compose, потому что без `nvidia-container-toolkit` на хосте резервирование **не даёт сервису стартовать** |
| `OLLAMA_CONTEXT_LENGTH` | значение по умолчанию 4096 **молча** обрезает промпт, рассчитанный на 128k. Агент теряет собственные инструкции и начинает имитировать схему инструментов — то, что остаётся в конце контекста |
| `OLLAMA_MAX_LOADED_MODELS` | при высоком `OLLAMA_KEEP_ALIVE` модели накапливаются: 15,2 GB резидентных весов на машине с 15 GB, и агент отвечает пусто из-за нехватки памяти |
| `OLLAMA_REQUEST_TIMEOUT_MS` | слишком короткий timeout для большой модели на длинном промпте |
| `OLLAMA_MODE` (bootstrap dev, [RN-461](business-rules/infra.md#rn-461), ADR 0114) | застряла в `host` после того, как нативный Ollama на машине разработчика был удалён или остановлен, — каждый ход локальной LLM падает с `ECONNREFUSED` против `http://host.docker.internal:<porta>`, а сервис `ollama` из compose так и не поднимается, чтобы подстраховать (он стоит за `profiles: ["local-llm"]`, и именно эта переменная держит этот profile выключенным). Исправление: `Docker › Reconfigurar Ollama` в `pnpm bootstrap`, который очищает `OLLAMA_MODE`/`OLLAMA_HOST` в `.env` и заставляет обнаружение снова спросить при следующем `Create`/`Reset total` |
| `START_OUTBOX_DRAIN` / `START_ANAMNESE` | Psicólogo и Anamnese потребляют ходы LLM параллельно с агентами выполнения и рвут соединение dev посреди цикла |
| `TOOL_LOOP_MAX_ITERATIONS*` | слишком НИЗКИЙ предел — и агент останавливается, ничего не сдав, с `iteration limit reached` и источником `model`, что обманчиво, потому что модель не вынесла никакого неверного суждения и даже не дошла до суждения. Предел — по ТИПУ ([RN-085](business-rules/engine.md#rn-085)): `8` для разговорных агентов, `60` для dev agent и QA. Прежде чем поднимать его, проверьте, ЕСТЬ ли у агента `token_budget_micros`; без него предел — единственная существующая защита от расходов |
| `TERMINAL_OUTPUT_MAX_BYTES` | слишком высокое значение возвращает режим сбоя, ради предотвращения которого предел существует: вывод каждой команды остаётся в истории цикла и путешествует в КАЖДОМ следующем ходе. Дело не в окне контекста: самый большой успешный вызов в запуске, впервые это выявившем, имел всего 28.993 входных токена ([RN-074](business-rules/engine.md#rn-074)) |
| `API_JSON_BODY_LIMIT` (api) / `TRANSPORT_MAX_BODY_BYTES` (engine) | у `413 request entity too large` в gate-е QA/SecOps причина была в самой api Brabo, а не в provider-е — у Express никогда не был настроен предел тела, и действовало значение по умолчанию 100 KB против 8 MB, которые принимает Phoenix на самом тяжёлом участке engine→api (`POST .../llm-turn`, который пересылает всю историю на каждой итерации). `API_JSON_BODY_LIMIT` (по умолчанию 10 MB) закрывает этот конец; `TRANSPORT_MAX_BODY_BYTES` (по умолчанию 8 MiB) — предел, который компактизация контекста engine соблюдает ПОВЕРХ окна модели, чтобы сработать до того, как тело превысит лимит HTTP ([RN-412](business-rules/api.md#rn-412), [ADR 0098](adr/0098-limites-de-transporte-e-janela-efetiva-de-compactacao.md)) |

> **Осторожно — защита не очищает очередь.** `START_ANAMNESE=false`
> блокирует **новые** постановки в очередь, но не старые. Уже бывало 20
> `AnamneseWorker`-ов, накопившихся в `executing` от предыдущих запусков, которые выполняются
> при следующей загрузке независимо от защиты. Очередь нужно
> **вычистить**, а не только выключить защиту.

> **Включение Anamnese или Psicólogo: две переменные, а не
> одна.** Оба были поставлены на паузу 2026-08-10 по продуктовому решению, а не из-за бага.
> Psicólogo по-прежнему на паузе; Anamnese была снова включена владельцем
> 2026-10-01 ([RN-680](business-rules/engine.md#rn-680)) — `ANAMNESE_ENABLED`
> возвращается к значению по умолчанию `true` в коде и во всех трёх compose, а раунд
> без подходящего субъекта не делает вызова LLM и говорит почему в логе engine
> (`sem_sujeito_elegivel`). Снова поставить её на паузу — `ANAMNESE_ENABLED=false`. `ANAMNESE_ENABLED` / `PSYCHOLOGIST_ENABLED` —
> продуктовые флаги (может ли произойти НОВЫЙ раунд?); `START_ANAMNESE` — ключ
> загрузки (планируется ли вообще периодический tick?). Периодической Anamnese нужны оба
> в `true`; у Psicólogo нет ключа загрузки, потому что его автоматический триггер
> — закрытие сессии.
>
> До [RN-540](business-rules/engine.md#rn-540) два флага `*_ENABLED`
> **не были отображены** в сервисе `engine` ни одного из compose, а `docker compose`
> не передаёт окружение хоста — поэтому их задание в `.env` молча ничего
> не делало, в то время как три места в коде обещали, что пауза
> обратима. Теперь они отображены, со значением по умолчанию из самого кода (`false`
> в обоих файлах на тот момент; `ANAMNESE_ENABLED` — `true` начиная с RN-680). Compose **установки**
> (`docker/docker-compose.install.yml`) был третьим файлом и остался вне
> этого исправления; начиная с AT-202 он отображает те же флаги с теми же значениями по умолчанию, и
> `scripts/ci/flags-do-engine-no-compose.spec.ts` проверяет **все три** файла
> и проваливает build при следующем булевом флаге, который не будет отображён или
> получит значение по умолчанию, отличное от кода (`START_OUTBOX_DRAIN` и
> `START_ANAMNESE` намеренно `false` в compose production, и
> spec объявляет это расхождение по имени). Compose установки нёс
> тот же `false` — скопированный из production вместе с мотивом production
> («он существует для проверки образов»), — а начиная с AT-219 повторяет
> `true` из кода. Это был дефект установки, а не выбор ради экономии:
> `START_OUTBOX_DRAIN` — единственное, что дренирует outbox api в
> engine, поэтому в установке на одной машине закрытая сессия никогда не останавливала свои
> процессы, а dev agent, ждущий одобрения, gate-а или контейнера,
> никогда не будился. Ни один из ключей не тратит токены при выключенных продуктовых флагах: при
> `ANAMNESE_ENABLED=false` `kickoff/0` Anamnese не планирует ни одного job-а,
> а drain ставит в очередь Psicólogo только при `PSYCHOLOGIST_ENABLED=true`.
> В установке Anamnese, таким образом, включена или выключена только
> `ANAMNESE_ENABLED` (по умолчанию `true` начиная с RN-680). В Kubernetes исправлять было нечего —
> Deployment/ConfigMap ничего не перехватывает, а `brabo-config` никогда не нёс
> этих переменных. Оба флага читаются при загрузке: измените их и выполните
> `docker compose up -d engine`.

### Семантический gate на маленькой модели {#a-semantic-gate-on-a-small-model}

QA — роль, которая хуже всего укладывается в локальную 7B: суждение меняется между
запусками, что делает демо исполняемым критерием приёмки, а **не**
регрессионным тестом. Чтобы сделать его надёжным, направьте `DEMO_QA_MODEL` на
модель API — binding по агенту (область `agent`, побеждающая `project`)
существует ровно для этого.

Сама машина gate-ов не меняется: неизменный порядок, возврат в ту же
ветку, предел исправлений, вердикты как артефакт и терминальный
`awaiting_user` — всё это проверено ExUnit
([RN-014](business-rules/api.md#rn-014), [RN-015](business-rules/api.md#rn-015)).

---

## Установка {#instalando}

```sh
curl -fsSLO https://github.com/daneiel/brabo/releases/latest/download/install.sh && bash install.sh
```

**Скачайте файл, затем запустите его через `bash`.** Две более короткие формы, которые кажутся
эквивалентными, таковыми не являются, и скрипт отклоняет обе **по имени**, до того как
что-либо скачать, печатая строку выше:

- **Никогда `curl … | sh`.** Причина механическая, а не стилистическая: когда
  скрипт приходит через pipe, `stdin` процесса **является** загрузкой,
  поэтому любой `read` читает байты самого скрипта или упирается в EOF. Установщик, который
  не может задавать вопросы, должен был бы сам выбирать расположение папок на чужой машине
  ([RN-526](business-rules/produto.md#rn-526)).
- **И не `sh -c "$(curl …)"`** — это была задокументированная форма до
  AT-083, и она никогда не работала. Скрипт проверяет **собственный хеш** по
  подписанному манифесту, а под `X -c "…"` нет файла, от которого считать хеш: `$0` —
  имя оболочки. С `dash` в роли `sh` (Debian, Ubuntu) он умирал ещё раньше, на
  `set -o pipefail`. Ключа для пропуска этой самопроверки нет и не
  будет ([ADR 0150](adr/0150-instalador-de-uma-linha.md)) — исправление в том,
  чтобы существовал файл. Запуск под оболочкой, не являющейся bash, — тоже отдельный
  именованный отказ.

Скрипт проверяет **собственное происхождение**, прежде чем что-либо делать, — подпись
`checksums.txt` Release-а, а затем собственный хеш внутри этого
проверенного манифеста. Сбой на любом шаге — **именованный отказ**, никогда не предупреждение.

Ему нужен **один** из `sha256sum` (coreutils, Linux) или `shasum -a 256` (идёт
с macOS), чтобы сделать что-либо из этого, и он определяет, какой, **до первой
загрузки** — а не посреди проверки. Отсутствие обоих — **собственный** отказ,
называющий оба инструмента и говорящий, что ничего не было скачано; это отсутствующая
зависимость операционной системы, и она намеренно *не* сформулирована как
отказы по хешу ниже. Это два разных исхода, требующих разного
— один исправляется установкой, другой **остановкой**, — и измерение AT-091
провело черту между ними: `sha256sum: command not found`
на macOS проявлялось как *«o cosign baixado NÃO bate com o hash pinado neste
script. Isso não é um aviso: pare e investigue.»*, что одновременно блокировало каждую
установку на macOS и учило читателя игнорировать эту фразу. `--print-plan`
не нуждается ни в одном из инструментов и объявляет, какие скрипт принимает
(`conferir-hash`).

Обнаружение имеет **предел 5s** на вызов Docker, который оно делает (`docker compose ls`
говорит с демоном, а медленный или остановленный демон за живым сокетом
повесил бы всё *до первого вопроса*). Достижение предела — не
ошибка: это тот же исход, что отсутствие Docker вовсе, а остальные
сигналы всё равно читаются.

Без TTY он **сообщает и завершается с 0**: печатает найденное и
команду для запуска в терминале. Это намеренно, и это та же форма,
что уже есть у `consentir-base.mjs`.

**Что он никогда не удаляет:** вашу базу проектов и вашу папку зеркала. Именованные
тома удаляются только с подтверждением, будучи перед этим перечислены по одному.

Он поднимает стек из **собственного compose**
(`docker/docker-compose.install.yml`), который берёт образы из переменных
и ничего не собирает, — и он **скачивает этот compose из Release**
([RN-570](business-rules/produto.md#rn-570),
[ADR 0160](adr/0160-o-compose-do-instalador-viaja-assinado.md)). Четыре файла
путешествуют с установщиком как assets `brabo-install-*`, в **том же**
подписанном `checksums.txt`, который покрывает бинарник runner-а: compose,
`postgres/init.sql` и `ollama/pull-models.sh`, которые он монтирует bind-mount-ом, и
`backup/test-restore-compose.sh`, который запускает миграция. Сразу после проверки
самого себя — до любого вопроса, до любой записи — скрипт скачивает
все четыре и сверяет каждый хеш с этим манифестом. Три именованных отказа, все
на нетронутой машине:

| сообщение начинается с | означает | сделайте |
|---|---|---|
| *«a Release não publica …»* | Release старше ADR 0160, или её шаг публикации упал посередине | установите из checkout-а репозитория на этом теге или дождитесь следующего релиза |
| *«o manifesto assinado não cobre …»* | манифест существует, но в нём нет строки для этого asset-а | то же, что выше, — Release неполон |
| *«… NÃO bate com o manifesto assinado»* | скачанный файл — не то, что описывает подписанный манифест | **остановитесь и обращайтесь с этим как с инцидентом**; не пытайтесь обойти |

Проверенные копии записываются под `docker/` в папке, из которой вы запустили
скрипт, — той же папке, где `.env`, — только когда они впервые понадобятся.
То, что там уже было (compose предыдущей версии, при обновлении),
**заменяется, никогда не читается**, и скрипт называет то, что заменил; изнутри
git-checkout-а на другом commit-е это оставляет `git status` грязным.

> **Releases, опубликованные до ADR 0160, этих assets не несут.**
> Их установщик всё ещё использует относительный путь, и однострочник выше падает в
> пустом каталоге с *«no such file or directory»* после записи `.env` (
> пробел, который измерила [RN-549](business-rules/ci.md#rn-549)). Для этих тегов запускайте
> установщик из checkout-а репозитория на устанавливаемом теге.

> На пути *миграции* доказательство восстановления (`test-restore-compose.sh`) получает
> `.env` установки через `BRABO_ENV_FILE` (передаётся в Compose как
> `--env-file`), потому что Compose ищет `.env` рядом с файлом compose — а не
> в каталоге, из которого вы запускаете. Если вы запускаете доказательство вручную против
> установки, сначала экспортируйте `BRABO_ENV_FILE=/caminho/para/.env`; путь, которого не
> существует, отклоняется, никогда не заменяется другим файлом. Неудавшееся доказательство по-прежнему
> ничего не удаляет ([RN-530](business-rules/infra.md#rn-530)).

Два источника:

```sh
install.sh                  # --source=ghcr (default): por digest, assinatura verificada
install.sh --source=local   # buildx bake; exige árvore limpa numa tag
```

Секреты генерируются один раз и сохраняются в `.env` с режимом **600** —
файл создаётся пустым и запертым *до* получения содержимого, потому что окно,
в котором секреты читаемы всеми, — ровно то, чего у этого файла не может быть.

**Шага migrate** нет, и не должно быть: compose связывает цепочкой
`api` → `migrate-api` с `service_completed_successfully`, поэтому `up --wait`
ждёт миграций. Второе место, упорядочивающее миграции, было бы вторым
источником той же истины.

После подъёма стека он **спрашивает, прежде чем утверждать**: `/health` у api и
engine, и только затем говорит, что установил.

Он **устанавливает локального агента** — бинарник проверяется по
подписанному манифесту и кладётся через `install -m 0755`, поэтому ручного `chmod` нет
([RN-531](business-rules/produto.md#rn-531)) — и спрашивает ОДНУ базу, записывая её с
обеих сторон: `BRABO_PROJECTS_BASE` в `.env` и `base` в
`runner.json` runner-а. Release без бинарника для этой платформы не прерывает
установку: он говорит об этом и указывает на `npm install -g @brabo/runner`.

Поверх существующей установки он **мигрирует или останавливается** — `up` на томах
другой версии — это ущерб, который не предупреждает. Порядок: бэкап →
**ДОКАЗАТЬ**, что он восстанавливается → спросить → удалить → установить → восстановить, и доказательство
посередине — то, что даёт установщику право удалять
([RN-530](business-rules/infra.md#rn-530)).

И он знает, **какую** версию заменяет ([RN-542](business-rules/produto.md#rn-542)).
Образы разрешаются **до** того, как запускается обнаружение, поэтому вопрос никогда не
слепой: маркер записывает установленную `versao`, манифест несёт ту, что
вот-вот будет установлена, и предложение специфично для соотношения между ними.

| соотношение | что предлагает | по умолчанию |
|---|---|---|
| новее | *«Atualizar 5.0.0 → 5.1.0?»* | **да** — именно за этим вы пришли, а доказанный бэкап делает это обратимым |
| та же | *«Já é a 5.0.0. Reinstalar do zero mesmo assim?»* | нет — предложить нечего |
| старее | называет это **downgrade**, предупреждая, что миграции базы назад не выполняются | нет — пути назад может не быть |
| неизвестно | у маркера схемы 1 нет версии; он говорит об этом и не угадывает | нет |

Какую бы ветку вы ни выбрали, установка **удаляется и пересоздаётся с
нуля**, а не запускается поверх старых томов. Половинчатая миграция
хуже никакой.

`install.sh`, вызванный из меню `pnpm bootstrap` (*Docker › Instalar*),
только **сообщает** план. Это механика, а не предпочтение: пункт меню
запускается со stdin в `/dev/null`, чтобы меню могло продолжать читать клавиши из того же
терминала, а этот установщик создан, чтобы *спрашивать*. Примечание в пункте несёт
однострочную команду, которая устанавливает по-настоящему.

> **Чего он не делает:** не включает **broker** контейнеров, не спросив, —
> см. [broker в установке](#broker-na-instalacao) чуть ниже.
> Локального агента он **сопрягает** начиная с [RN-547](business-rules/produto.md#rn-547): он
> создаёт первую учётную запись, генерирует ключ устройства машины на машине,
> регистрирует публичную половину, штампует `kid` и устанавливает unit **машины**
> ([ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)) — а когда
> звено падает, он называет команду для повтора, см.
> [Когда установщик не завершает установку](#instalador-nao-fecha).
> На экране проекта остаётся сопряжение, **привязанное к проекту**: этот ключ
> устройства и `brabo-runner.config.json` по-прежнему приходят оттуда
> ([ADR 0118](adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)).
> Проверьте всё через `install.sh --print-plan`, который ничего не трогает.

Проверка: `.github/workflows/install-e2e.yml` запускает однострочник выше на
**чистой** машине, под настоящим pty, на каждом финальном теге — установщик,
стек, первую учётную запись, ключ машины и агента, подхватывающего первый
проект. В каждом PR spec-и `scripts/dev/install*.spec.ts` доказывают части,
которым не нужен Release: план и состояние (`install.spec.ts`),
`.env` через собственный парсер Compose (`install-env.spec.ts`), шаги завершения
(`install-fechamento.spec.ts`), отклонённые вызовы
(`install-invocacao.spec.ts`), скачанные файлы
(`install-arquivos-da-instalacao.spec.ts`), вопрос о broker-е
(`install-broker.spec.ts`) и то, что сам E2E не протух
(`install-e2e.spec.ts`). У пути **миграции** — бэкап, доказать, удалить,
установить, восстановить — нет сквозного запуска: машина E2E чистая, поэтому
вопрос никогда не задаётся, и spec есть только у передачи `.env` доказательству восстановления
(`scripts/dev/prova-de-restauracao-env.spec.ts`).

### Broker контейнеров в установке {#broker-na-instalacao}

Проекты в режимах **Container** и **Pasta montada** работают внутри контейнера, и
поднимает этот контейнер **broker**
([ADR 0144](adr/0144-a-segunda-raiz-do-broker.md)). Без него ни один из режимов
никогда не выполняется: `container_start` заканчивается `failed` с `BrokerIndisponivelError`,
а dev agents остаются в `dev.blocked_by_container`. Режим **Runner** от него не
зависит — там локальный агент использует Docker вашей машины.

Начиная с [ADR 0162](adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)
broker — **пятый опубликованный образ** (`ghcr.io/daneiel/brabo-broker`, по
digest, подписанный, как и остальные четыре), и в compose установки есть
сервис — **выключенный по умолчанию**, под тем же profile `container-broker`, что и
compose проверки. Установщик **спрашивает** (*«Ligar o broker de container?
[s/N]»*), сразу после базы проектов, и говорит текстом, что даёт его
включение: broker получает **сокет Docker этой машины**, и тот, кто
командует broker-ом, командует вашим Docker. Сдерживают его пять слоёв
[ADR 0130](adr/0130-broker-de-container.md): ни одного опубликованного порта, сеть
(`internal: true`, без интернета), до которой дотягивается только api, service token,
пять операций над контейнером ОДНОГО проекта и spec, которую broker составляет
из того, что решил Arquiteto, — нет запроса, который включил бы
`privileged`, сеть хоста или свободный `-v`.

| ответ | что происходит |
|---|---|
| **`s`** / **`sim`** | он измеряет группу сокета **изнутри контейнера** (собственный образ broker-а, без сети, только чтение, сокет подключён через `--mount`, чтобы отсутствующий сокет был ошибкой, а не пустой папкой, созданной на вашем хосте), вычисляет, где Docker хранит том управляемой папки, и записывает `COMPOSE_PROFILES=container-broker`, `BROKER_URL=http://broker:8090`, `DOCKER_GID` и `PROJECT_WORKSPACES_HOST_ROOT` в `.env` — все четыре вместе |
| Enter, `n`, что угодно другое | выключен. `.env` не получает ни одной из четырёх строк, и итоговая сводка говорит *«Broker de container: DESLIGADO»* |
| без терминала | выключен, и он об этом говорит — ни один вопрос не задаётся там, где никто не может ответить |

**Два отказа и два незавершённых пункта, все названы:**

- *«não consegui medir o grupo do socket do Docker…»* — измерение не удалось
  (Docker rootless или удалённый: сокет не в `/var/run/docker.sock`,
  а именно этот путь монтирует compose). Ничего не записано. Запустите снова и
  ответьте **нет** или исправьте то, что сообщение указывает о Docker. Он никогда не пишет
  угаданное `999` вместо этого.
- *«… não é um socket …»* — тот же исход, то же исправление.
- незавершённый пункт *«a raiz da pasta gerenciada…»* — вычисленный
  `<DockerRootDir>/volumes/brabo_project_workspaces/_data` не совпал с
  реальным `Mountpoint` тома после подъёма стека (или `docker info` не
  сказал, где живут тома). Проекты **Pasta montada** работают; проекты **Container**
  — нет, пока вы не исправите `PROJECT_WORKSPACES_HOST_ROOT` — сообщение несёт
  значение, которое сообщил демон, и команду для пересоздания broker-а.
- незавершённый пункт *«o broker de container: a api NÃO o alcançou…»* — сервис поднялся
  здоровым, но api не дотянулась до него по внутренней сети. `docker
  compose -f docker/docker-compose.install.yml logs broker` скажет почему.

`COMPOSE_PROFILES` в `--env-file` — то, что заставляет `up -d --wait` поднять
broker без каких-либо флагов в командной строке, — измерено на Compose v5.5.1.
Переменная образа, `BRABO_BROKER_IMAGE`, записывается **независимо от того, включаете
вы его или нет**: Compose интерполирует весь файл до фильтрации по profile, поэтому
обязательная переменная в выключенном сервисе всё равно отклоняет файл.

**Включение позже** (та же папка, что `.env`):

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

**Выключение:** удалите четыре строки из `.env`, затем удалите контейнер
broker-а и пересоздайте api без `BROKER_URL`:

```bash
docker compose -f docker/docker-compose.install.yml --env-file .env \
  --profile container-broker rm -sf broker
docker compose -f docker/docker-compose.install.yml --env-file .env up -d --wait
```

`up --remove-orphans` первый шаг **не** выполняет — измерено: сервис
под выключенным profile остаётся *определённым* в файле, поэтому его контейнер
не сирота и продолжает работать. Ничего в ваших проектах не удаляется; проекты Container
и Pasta montada перестают выполняться, и экран проекта перестаёт их предлагать
([ADR 0161](adr/0161-a-tela-so-oferece-o-modo-que-a-instalacao-executa.md)).

Проверка: включение **при установке** доказано — вопрос и
его отказы через `scripts/dev/install-broker.spec.ts` в каждом PR, а весь путь
через `.github/workflows/install-e2e.yml` на каждом финальном теге, который отвечает
*да* и требует включённого broker-а, api, до него дотягивающейся, и `COMPOSE_PROFILES` и
`BROKER_URL`, записанных в `.env`. Включение **позже** пятью командами выше и выключение
**не имеют проверки**: ничто их не запускает, а оговорка про
`up --remove-orphans` была измерена один раз вручную.

### Локальные модели в установке {#modelos-locais-na-instalacao}

Сразу после broker-а `install.sh` спрашивает `Ligar os modelos locais? [s/N]`
([RN-691](business-rules/produto.md#rn-691)). Он заранее называет цену — диск под
образ Ollama и модели, которые `ollama-model-loader` скачивает при старте, RAM, пока
модель загружена, — и что теряется без них: проверка семантических дубликатов
историй и правил пропускается, и у агентов нет локальной модели. Включает их
только набранное «s»; без терминала они остаются выключенными.

Включение измеряет порт хоста, прежде чем что-либо записать: `11434` или
первый свободный до `11443` (нативный Ollama обычно держит `11434`). Весь
занятый диапазон — именованный отказ без какой-либо записи. `.env` получает `OLLAMA_PORT`
и `llm` в единственной строке `COMPOSE_PROFILES`.

Чтобы включить их **позже**, в папке установки: выберите свободный порт, затем
добавьте `OLLAMA_PORT=<porta>` в `.env`, добавьте `llm` к существующей строке
`COMPOSE_PROFILES` через запятую (или создайте `COMPOSE_PROFILES=llm`) и выполните
`docker compose -f docker/docker-compose.install.yml --env-file .env up -d --wait`.

Проверка: вопрос, измерение порта и строки `.env`
доказываются `scripts/dev/install-llm.spec.ts` в каждом PR. E2E установки
отвечает *нет* (скачивание моделей стоило бы ГБ на тег), поэтому подъём с
profile `llm` **не имеет сквозной проверки**.

### Переустановка с нуля {#reinstalar-do-zero}

Когда найдена предыдущая установка (учитывается только проект compose с именем ровно
`brabo` — compose dev `brabo-dev` нет,
[RN-692](business-rules/produto.md#rn-692)), миграция выполняет бэкап, доказывает
restore, а затем спрашивает
`Apagar os volumes e reinstalar? [s = restaurar / z = do zero / N = parar]`.
`z` удаляет и переустанавливает **без восстановления** старых данных; доказанный бэкап
остаётся в папке, которую он называет, и его последующее восстановление — это
[Restore](#restore). Доказано `scripts/dev/install-llm.spec.ts`.

---

## Проверка опубликованного артефакта {#verificar-artefato-publicado}

Каждый финальный тег подписывает то, что публикует, через `cosign` **keyless** —
подписывающая идентичность — сам workflow, и ни одного ключа на хранении
нигде нет ([ADR 0149](adr/0149-assinatura-dos-artefatos-publicados.md),
[RN-524](business-rules/ci.md#rn-524)). Вот как проверяете **вы**, вне
CI.

Обеим командам нужны оба флага `--certificate-*`. Это не
опциональное украшение: без них `cosign` принял бы действительную подпись **от
кого угодно**, а это ровно тот сбой, ради предотвращения которого существует весь этот механизм.

### Образ, по digest {#an-image-by-digest}

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

### Бинарники runner-а {#the-runner-binaries}

Подписанный `checksums.txt` покрывает четыре цели (у Mac Intel нет бинарника
начиная с [ADR 0174](adr/0174-runner-sem-binario-darwin-x64.md) — он использует
`npm install -g @brabo/runner`), поэтому у проверки два
шага: подпись манифеста, затем бинарник против манифеста.

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

### Когда проверка не проходит {#when-verification-fails}

**Не устанавливайте.** У подписи, которая не проверяется, ровно два
прочтения — артефакт не тот, что опубликовал конвейер, или конвейер
его не публиковал, — и ни одно не является поводом продолжать. Проверьте, совпадает ли
регулярное выражение идентичности с workflow, который действительно опубликовал этот тег (
повторная публикация через `workflow_dispatch` подписывается той же идентичностью), и затем
обращайтесь с этим как с инцидентом, а не как с шумом.

**Чего это НЕ покрывает:** подписи кода операционной системы для
бинарников runner-а — нотаризации macOS и Authenticode Windows. Они требуют
платной идентичности подписи и являются отдельным пунктом backlog-а; система по-прежнему будет предупреждать
при первом запуске.

### Письменное предложение исходного кода, внутри каждого опубликованного артефакта {#oferta-de-fonte-na-imagem}

Подпись отвечает на вопрос *«это то, что опубликовал конвейер?»*. Второй вопрос
путешествует с тем же образом и имеет другой ответ: **где исходный код
GPL-программ внутри него?**

Образ engine встраивает `git`, `busybox`, `libgcc`/`libstdc++` и ещё 18 пакетов
apk под GPL, плюс четыре сканера, которые engine вызывает через `exec`.
Их запуск как отдельных процессов не заражает Brabo, который остаётся
MIT, — но *распространение* образа требует, чтобы получатель мог получить
соответствующий исходный код. Начиная с [ADR 0119](adr/0119-imagens-publicadas-no-ghcr-por-digest.md)
это распространение происходит на каждом финальном теге.

Письменное предложение — это `THIRD_PARTY_NOTICES.md`, и оно лежит **внутри**
образа, потому что у того, кто запускает `docker pull`, нет репозитория:

```bash
docker run --rm --entrypoint sh ghcr.io/daneiel/brabo-engine:vX.Y.Z \
  -c 'cat /usr/share/doc/brabo/THIRD_PARTY_NOTICES.md'
```

Он называет каждый компонент, точную версию и лицензию, что
позволяет любому добраться до upstream-релиза каждого.

Начиная с AT-120 тот же файл, по тому же пути и в той же форме (владелец root,
`0644`, скопирован до `USER`), лежит внутри **каждого** опубликованного образа —
`brabo-api`, `brabo-web`, `brabo-broker` и `brabo-backup` помимо
`brabo-engine` — и рядом с бинарниками runner-а как asset
`THIRD_PARTY_NOTICES.md` Release-а, покрытый тем же
подписанным `checksums.txt` (RN-524). Таково было решение мейнтейнера, и оно
консервативное: ни один артефакт не объявлен освобождённым. Замените `brabo-engine` на любой
из остальных четырёх в команде выше. До AT-120 эта команда падала с
«Permission denied» на образе engine: BuildKit применяет `COPY --chmod=0644`
и к каталогу, который создаёт `COPY`, поэтому у `/usr/share/doc/brabo` не было
бита исполнения, и не-root пользователь образа не мог через него пройти. Каждый
Dockerfile теперь заранее создаёт каталог `0755`. Для runner-а:

```bash
gh release download vX.Y.Z --repo daneiel/brabo \
  --pattern THIRD_PARTY_NOTICES.md --pattern checksums.txt
sha256sum -c --ignore-missing checksums.txt
```

Если этого файла нет в артефакте, артефакт не должен
распространяться. `scripts/ci/oferta-de-fonte-na-imagem.spec.ts` не даёт случайно удалить
каждый `COPY` и asset Release-а, а шаг
`A oferta de fonte está dentro das cinco imagens` в `ci.yml` считывает
файл обратно из каждого собираемого образа и сравнивает его с checkout-ом — но
только настоящий тег доказывает опубликованный артефакт.

Файл также фиксирует то, что **не** решено: вынос сканеров в
собственный sidecar, освобождающий образ engine от copyleft, остаётся открытым как
выбор *архитектуры*, а не соответствия.

---

## Подъём стороннего образа {#subindo-imagem-de-terceiro}

Каждый сторонний образ в `docker/` и `deploy/k8s/` зафиксирован **по
digest**, с тегом, откуда он пришёл, записанным **внутри ссылки**, перед
digest ([ADR 0159](adr/0159-imagem-de-terceiro-por-digest.md),
[ADR 0178](adr/0178-tag-inline-na-imagem-de-terceiro.md)). Workflows в
`.github/workflows/` **не** хранят литерал образа: их `services:` читают
ссылку из compose dev через `imagens-do-compose.yml`
([ADR 0197](adr/0197-a-imagem-dos-workflows-vem-do-compose.md)), поэтому обновление
compose обновляет и CI:

```yaml
image: neo4j:5.26-community@sha256:d9cfe82983d27f5a75b3aaae8f316d04f9a698a3b7f6103a508f7caf8362f255
```

**Dockerfile** принимает ту же форму в строке `FROM` — никогда не комментарий в
её конце: парсер Docker принимает `#` только в начале строки, а
`#` в конце заставляет build упасть с *«FROM requires either one or three
arguments»*:

```dockerfile
FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6 AS runtime
```

Это **заморозка**. Начиная с ADR 0197 экосистемы Dependabot `docker-compose` (
compose в `docker/`) и `docker` (строки `FROM` в `docker/*/` и
манифесты в `deploy/k8s/`) каждую неделю предлагают обновление, одним сгруппированным PR
на экосистему, в `dev`. Ревью этого PR — шаги 1 и 4 этой процедуры.
Два случая по-прежнему возвращаются сюда:

- **`neo4j` и `ollama` живут в compose И в `deploy/k8s/base/`**, а
  две экосистемы никогда не делят PR. Когда registry переопубликует ТОТ ЖЕ тег
  с другим digest, оба PR проваливаются на lint («тот же inline-тег, два
  digest-а»); объедините оба обновления в один PR с шагом 3 ниже.
- Два образа, которые не читает ни одна экосистема (ниже).

Чтобы сдвинуть один вручную — скажем, `neo4j` с `5.26-community` на `5.27-community`:

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

Два образа обновляются этой же процедурой, вручную, что бы ни делал
Dependabot: `imageName` CloudNativePG
в `deploy/k8s/overlays/local/db/cluster.yaml` (ни одна экосистема
не читает этот ключ) и образ случая QA golden-set,
`IMAGEM_DO_GOLDEN_SET_QA` в `apps/api/scripts/golden-set-qa-container.ts`
(константа TypeScript, читаемая `golden-set-qa.yml`).

Шаг 3 — не опциональная бюрократия: проверка отклоняет **один и тот же inline-тег,
несущий два разных digest-а**, потому что compose dev и кластер,
утверждающие одну версию, при этом выполняя разные байты, — это то, как зелёный CI перестаёт
что-либо значить. Между compose dev и CI больше нечего выравнивать:
CI читает compose.

Чтобы дать НОВОМУ workflow сторонний сервис, никогда не пишите ссылку в
workflow: добавьте образ сервиса в `docker/docker-compose.yml`, строку в
`IMAGENS_DOS_WORKFLOWS` в `scripts/ci/imagens-do-compose.ts`, соответствующий
output в `.github/workflows/imagens-do-compose.yml` (его spec проваливается, если они
расходятся), а в workflow — job `imagens:` с
`uses: ./.github/workflows/imagens-do-compose.yml` плюс
`image: ${{ needs.imagens.outputs.<nome> }}`.

Чего проверка **не** покрывает и почему — в
[цепочке поставок CI](explanation/cadeia-de-suprimentos-do-ci.md#container-images-digest-with-the-tag-alongside):
пять образов, которые публикует продукт, уже разрешены по digest через
`.release/images.json` и `make imagens-do-release`
([ADR 0119](adr/0119-imagens-publicadas-no-ghcr-por-digest.md)) — никогда не фиксируйте
их вручную в overlay, который намеренно хранит маркер.

---

## Добавление совместимого provider-а {#adicionando-um-provider-compativel}

Относится к любому provider-у, говорящему на диалекте `/chat/completions` OpenAI, —
а это практически каждый хаб и каждый управляемый сервис
инференса. База уже существует
([ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md));
то, что вы пишете, — **конфигурация**, а не разбор.

### 1. Прочитайте официальную документацию до первой строки {#1-read-the-official-doc-before-writing-the-first-line}

Четыре вещи должны прийти из документации provider-а, а не из догадки:
`baseUrl`, заголовок auth, формат `usage` в потоке и
особенности потоковой передачи. Запишите просмотренный URL и дату в начале
файла конфигурации — это единственный способ узнать через месяцы, не устарела ли
конфигурация.

То, что расходится со стандартом OpenAI, становится **флагом в базе**,
никогда не разбросанным `if`. Если расхождение не укладывается в существующий
флаг, добавьте его — и только потому, что этому настоящему provider-у он нужен.

### 2. Напишите конфигурацию {#2-write-the-config}

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

Экспортируйте функцию конфигурации, а не только класс: именно на неё набор
контрактных тестов направляет поддельный сервер. Копия конфигурации, написанная внутри
теста, прошла бы зелёной, даже если бы production-конфигурация расходилась.

### 3. Прогоните против него контрактный набор {#3-run-the-contract-suite-against-it}

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

Наследуется даром: потоковая передача с разорванным frame-ом, присутствующий и
отсутствующий usage, tool calling, четыре нормализованные ошибки, каталог и
молчащий сервер.

### 4. Зарегистрируйте provider и тип учётных данных {#4-register-the-provider-and-the-credential-kind}

1. **два места, намеренно**: тип `LLMProviderName` в
   `packages/shared/src/index.ts` (web тоже его использует) и runtime-список
   `LLM_PROVIDER_NAMES` в
   `apps/api/src/domain/llm/llm-provider-names.ts`. Они не могут жить
   вместе: `packages/shared` — на 100% типы: значение, экспортированное
   оттуда, ломает образ production api при загрузке с
   `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, и
   `apps/api/test/packages-shared-so-tipos.spec.ts` проваливается до того, как
   дойдёт туда. Забытый список не проходит молча: проверка
   исчерпываемости в обе стороны ломает typecheck, так же как исчерпывающий
   `Record` `ROTULO_DO_PROVIDER` в web ломается, пока provider не
   получит метку;
2. если это хаб, добавьте имя в `HUBS` в `apps/web/src/lib/models.ts`,
   чтобы он попал в правильную группу селектора;
3. реестр provider-ов api (`llm-infrastructure.module.ts`);
4. `pgEnum` provider-а в схеме плюс миграция, если имя
   новое.

### 5. Заполните модели ценой из документации {#5-seed-the-models-with-the-price-from-the-docs}

Набранная вручную цена приходит с `manual_pricing: true`. Это защищает строку
от синхронизации цен: для provider-а, который не отдаёт цену в
каталоге, ручное число — единственное существующее.

Если provider отдаёт `GET /models`, **не заполняйте весь каталог** —
пусть синхронизация его обнаружит. Она записывает модели выключенными, а
владелец включает нужное через экран курирования
([RN-043](business-rules/api.md#rn-043)).

Если каталог provider-а публикует **модальность** (принимает изображение, генерирует
изображение) или `reasoning`, выдавайте их в его `parseCatalogo` — и только когда
это говорит официальная документация. Поле, которое provider не объявляет, остаётся
**опущенным**, никогда не `false`: `undefined` сохраняет то, что уже было
записано, а `false` стёр бы данные, курированные вручную
([RN-056](business-rules/api.md#rn-056)).

### 6. Проверьте с настоящими учётными данными {#6-verify-with-a-real-credential}

```bash
# na tela de configurações do projeto: cadastre a credencial, depois
# "Atualizar catálogo" e confira o relatório por provider.
```

Отчёт показывает **каждый** provider, включая пропущенные, с
причиной и источником сбоя. `sem_credencial` означает, что ключ
так и не дошёл; `falha · origem infra` означает, что дело даже не дошло до
provider-а; `falha · origem modelo` означает, что он ответил отказом.

Проверка: шаги 2–4 доказываются в каждом PR — контрактный набор
(`apps/api/test/contract/llm-provider.contract.ts`, запускаемый
`*.contract.spec.ts` каждого provider-а) против поддельного сервера, и typecheck, который ломается, когда
имени не хватает в каком-либо из списков. Шаг 6 **ручной по природе**: ему нужны
настоящие учётные данные с кредитом, которых у CI нет. Файлы `*.smoke.spec.ts` по
provider-у — его сценарная форма, и они пропускаются без
ключа — в среде есть учётные данные только для OpenRouter (см.
`TODO(humano)` про smoke-тесты LLM в `CLAUDE.md`).

---

## Процедуры и как проверяется каждая из них {#procedimentos-e-verificacao}

Каждая процедура **эксплуатации** на этой странице, с файлом, который её доказывает, и
тем, что запускает это доказательство. Разделы диагностики (что делать, когда что-то выглядит
не так) и разделы среды разработки здесь не перечислены: это способы
найти причину, а не процедуры, которые могут пройти или провалиться.

- **verification** называет spec, скрипт, workflow или цель `make`, которые
  доказывают процедуру, или начинается с **None** и говорит об этом. Частичное доказательство
  называет, что оно покрывает и чего не покрывает.
- **schedule** говорит, что запускает её без того, чтобы кто-то помнил: запланированный workflow
  (`weekly`), каждый pull request (`every PR`), каждый финальный тег
  (`every tag`) или `manual` — кто-то должен помнить.

Заголовки таблицы и слова-классы столбца **schedule** намеренно остаются на английском:
это машинный словарь, который читает `pnpm docs:check`. Он читает эту таблицу и проваливается, когда файл в **verification**
отсутствует в репозитории, цели `make` нет в `Makefile`, ячейка
пуста или говорит «см. ниже», якорь не является заголовком этой страницы, или
workflow в **schedule** не имеет триггера, который утверждает ячейка
(`schedule:` для `weekly`, `pull_request` для `every PR`, `push: tags` для
`every tag`). Как это работает — в
[Как документация остаётся живой](explanation/documentation-workflow.md#the-runbook-procedures-table).

| procedure | anchor | verification | schedule |
|---|---|---|---|
| Поднять стек в локальном кластере | [Локальный deploy](#deploy-local) | `make deploy-local` заканчивается `make smoke-k8s` (`deploy/k8s/smoke.sh`); запланированный запуск делает тот же `deploy/k8s/bootstrap.sh` и smoke | weekly `.github/workflows/propriedades.yml` |
| Проверить тег конвейера (`TAG=`) | [Проверка тега конвейера](#validar-tag-do-pipeline) | **None.** Ни один workflow не передаёт `TAG=`; отсоединённый checkout тега выполняется только вручную | manual |
| Доказать, что HPA engine масштабируется | [Локальный deploy](#deploy-local) | `make hpa-test` (`deploy/k8s/hpa-test.sh`) | weekly `.github/workflows/propriedades.yml` |
| Проверить overlays без кластера | [Локальный deploy](#deploy-local) | `make k8s-validate` (`deploy/k8s/validate.sh`) | every PR `.github/workflows/ci.yml` |
| Сделать deploy образов релиза | [Deploy образов релиза](#imagens-de-uma-release) | `scripts/ci/aplicar-imagens.spec.ts` доказывает чтение манифеста релиза, `scripts/ci/images-manifest.spec.ts` — digest-ы, переданные `kustomize`; запуск на overlay и применение digest-ов настоящего релиза: никакой | every PR `.github/workflows/ci.yml` (o spec); manual (a corrente) |
| Выполнить rollout engine | [Rollout engine](#rollout-do-engine) | `make rollout-test` (`deploy/k8s/rollout-test.sh`); его сборщики улик — `scripts/ci/rollout-evidencia.spec.ts` | weekly `.github/workflows/propriedades.yml`; every PR `.github/workflows/ci.yml` (os coletores) |
| Увеличить окно drain | [Увеличение окна drain](#aumentar-a-janela-de-drain) | **None собственной.** `make rollout-test` доказывает только пару локального overlay (drain 20 s, grace 90 s); запустите его снова с увеличенными значениями | manual |
| Откат на sealed-secrets | [Секреты: откат на sealed-secrets](#fallback-sealed-secrets) | **None.** Ничто не запускает `kubeseal`; запланированный кластер использует External Secrets | manual |
| Проверить бэкап в Kubernetes | [Автоматизированный путь](#restore-automatizado) | `make test-restore` (`deploy/k8s/test-restore.sh`) и намеренная поломка `make test-restore-mutacao` | weekly `.github/workflows/propriedades.yml` |
| Проверить бэкап в установке compose | [Автоматизированный путь](#restore-automatizado) | `make test-restore-compose` (`docker/backup/test-restore-compose.sh`); его передача `.env` — `scripts/dev/prova-de-restauracao-env.spec.ts` | weekly `.github/workflows/propriedades.yml`, job `restore-compose` (a prova); every PR `.github/workflows/ci.yml` (o spec) |
| Настоящее восстановление во время инцидента | [Настоящее восстановление](#restore-de-verdade) | шаги 1–2: `make test-restore` (тот же `brabo-restore`, те же запросы `docker/backup/restore.sh`); шаг 3, повышение `DATABASE_URL`: никакой, ни разу не выполнялся | weekly `.github/workflows/propriedades.yml` (passos 1–2); manual (passo 3) |
| Проверить и восстановить bare-репозитории | [Восстановление bare-репозиториев](#restore-dos-bare-repos) | `scripts/ci/backup-lib.spec.ts` (функции); `make test-restore-compose` (проверяющая команда, в образе); `--restaurar` в образе: никакой | every PR `.github/workflows/ci.yml` (o spec); weekly `.github/workflows/propriedades.yml`, job `restore-compose` (o comando que verifica); manual (`--restaurar`) |
| Перепроецировать граф | [Потеря графа](#perda-do-grafo) | `make test-reprojecao` (`apps/api/test/scripts/reprojetar-grafo.spec.ts`, пропускается в PR, где нет Neo4j) и `make test-reprojecao-k8s` (`deploy/k8s/test-reprojecao.sh`) | weekly `.github/workflows/propriedades.yml` |
| Перепроецировать папку артефактов | [Потеря папки артефактов](#perda-da-pasta-de-artefatos) | `apps/api/test/scripts/reprojetar-artefatos.spec.ts` и `make test-reprojecao-artefatos-k8s` (`deploy/k8s/test-reprojecao-artefatos.sh`, команда внутри образа api) | every PR `.github/workflows/ci.yml` (o spec); weekly `.github/workflows/propriedades.yml` (o caminho da imagem) |
| Ротировать `AUTH_JWT_SECRET` | [`AUTH_JWT_SECRET`](#rotacao-do-auth-jwt-secret) | `apps/api/test/infrastructure/security/ed25519-access-token-issuer.spec.ts` и `apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts` | every PR `.github/workflows/ci.yml` |
| Сменить `AUTH_TOKEN_PEPPER` | [`AUTH_TOKEN_PEPPER`](#troca-do-auth-token-pepper) | `apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts` | every PR `.github/workflows/ci.yml` |
| Ротировать `BRABO_SERVICE_TOKEN` | [`BRABO_SERVICE_TOKEN`](#rotacao-do-brabo-service-token) | `apps/api/test/infrastructure/security/service-token.spec.ts`, `apps/api/test/interfaces/engine-service.guard.spec.ts`, `apps/engine/test/engine_web/plugs/verify_service_token_test.exs`, `apps/engine/test/engine/runtime_service_token_test.exs`, `apps/broker/src/config.spec.ts` и `scripts/ci/previous-nos-composes.spec.ts` | every PR `.github/workflows/ci.yml` |
| Ввести и вывести `_PREVIOUS` в Kubernetes | [Выполнение в Kubernetes](#rotacao-no-kubernetes) | `scripts/ci/previous-nos-composes.spec.ts` держит `ExternalSecret` на `dataFrom.extract` без `_PREVIOUS` в `data:`; синхронизация настоящим External Secrets Operator: `make test-rotacao-chave-mestra-k8s` (`deploy/k8s/test-rotacao-chave-mestra.sh`) добавляет и удаляет через него `CREDENTIALS_MASTER_KEY_PREVIOUS`; остальные ключи `_PREVIOUS`: автоматизированной нет | every PR `.github/workflows/ci.yml` (o spec); weekly `.github/workflows/propriedades.yml` (o `_PREVIOUS` da chave mestra); manual (as outras chaves) |
| Разблокировать учётную запись через SQL | [Учётная запись заблокирована lockout-ом](#conta-travada-por-lockout) | **None.** Два запроса сверены со схемой чтением; `apps/api/test/application/use-cases/auth/lockout.spec.ts` покрывает lockout, а не их | manual |
| Ротировать мастер-ключ | [Ротация мастер-ключа](#rotacao-da-chave-mestra) | `apps/api/test/scripts/rewrap-deks.spec.ts` и `apps/api/test/infrastructure/security/envelope-encryption.service.spec.ts`; три шага в кластере: `make test-rotacao-chave-mestra-k8s` (`deploy/k8s/test-rotacao-chave-mestra.sh`) | every PR `.github/workflows/ci.yml` (os specs); weekly `.github/workflows/propriedades.yml` (o ensaio) |
| Отрезать расходы при инциденте стоимости | [Инцидент стоимости](#incidente-de-custo) | `apps/api/test/runbook/sql-do-incidente-de-custo.spec.ts` выполняет SQL раздела, на обоих языках, против мигрированной схемы; шаги (b) и (d), на экране: никакой | every PR `.github/workflows/ci.yml` |
| Поднять наблюдаемость без кластера | [Локальная наблюдаемость](#observabilidade-local) | `scripts/dev/observabilidade-pronta.mjs`, самопроверка в конце `pnpm dev:obs`, без spec | manual |
| Проверить реестр gate-ов в образе | [Реестр gate-ов](#registro-de-gates) | `docker/smoke.sh` вызывает оба маршрута против образа production; его функции gate — `scripts/ci/smoke-gates.spec.ts` | every PR `.github/workflows/ci.yml` |
| Установить | [Установка](#instalando) | `.github/workflows/install-e2e.yml` (чистая машина) и `scripts/dev/install*.spec.ts`; сквозной путь миграции: никакой | every tag `.github/workflows/install-e2e.yml`; every PR `.github/workflows/ci.yml` (os specs) |
| Включить или выключить broker установки | [Broker контейнеров в установке](#broker-na-instalacao) | при установке: `scripts/dev/install-broker.spec.ts` и `.github/workflows/install-e2e.yml`; включение позже вручную и выключение: никакой | every tag `.github/workflows/install-e2e.yml`; every PR `.github/workflows/ci.yml` (o spec); manual (depois, e desligar) |
| Включить локальные модели установки | [Локальные модели в установке](#modelos-locais-na-instalacao) | при установке: `scripts/dev/install-llm.spec.ts`; включение позже вручную: никакой | every PR `.github/workflows/ci.yml` (o spec); manual (depois) |
| Переустановить с нуля поверх предыдущей установки | [Переустановка с нуля](#reinstalar-do-zero) | `scripts/dev/install-llm.spec.ts` | every PR `.github/workflows/ci.yml` |
| Проверить опубликованный артефакт | [Проверка опубликованного артефакта](#verificar-artefato-publicado) | workflows публикации проверяют то, что подписали, в том же запуске: `.github/workflows/release.yml` (`cosign verify`) и `.github/workflows/build-runner-binaries.yml` (`cosign verify-blob`) | every tag `.github/workflows/release.yml` `.github/workflows/build-runner-binaries.yml` |
| Проверить письменное предложение исходного кода | [Письменное предложение исходного кода](#oferta-de-fonte-na-imagem) | `scripts/ci/oferta-de-fonte-na-imagem.spec.ts` удерживает каждый `COPY` и asset Release-а; пять образов, собранных из PR, считываются обратно `.github/workflows/ci.yml`; опубликованные артефакты, несущие файл: никакой | every PR `.github/workflows/ci.yml` (o spec e as imagens construídas); manual (os artefatos publicados) |
| Обновить сторонний образ | [Подъём стороннего образа](#subindo-imagem-de-terceiro) | `scripts/ci/imagens-pinadas.ts`, `scripts/ci/imagens-pinadas.spec.ts` и `scripts/ci/imagens-do-compose.spec.ts` | every PR `.github/workflows/ci.yml` |
| Добавить совместимый provider LLM | [Добавление совместимого provider-а](#adicionando-um-provider-compativel) | шаги 2–4: `apps/api/test/contract/llm-provider.contract.ts`, запускаемый контрактным spec-ом каждого provider-а; шаг 6, с настоящими учётными данными: в CI никакой — smoke-spec-и пропускаются без ключа | every PR `.github/workflows/ci.yml` (passos 2–4); manual (passo 6) |
