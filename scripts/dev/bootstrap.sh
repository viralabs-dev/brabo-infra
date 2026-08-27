#!/usr/bin/env bash
# Menu de terminal para operar o repositório.
#
# POR QUE EXISTE: os comandos do dia a dia moram em três lugares que não
# conversam — `package.json` (os scripts pnpm), o `Makefile` (os alvos de
# Kubernetes) e scripts soltos em `deploy/k8s/` e `docker/`. Saber que Docker
# é `pnpm`, que K8s é `make` e que o smoke é `bash docker/smoke.sh` é
# conhecimento decorado, e conhecimento decorado apodrece. Este menu é a porta
# única; ele NÃO reimplementa nada, só chama o que já existe.
#
# Uso:
#   bash scripts/dev/bootstrap.sh              # abre o menu (precisa de TTY)
#   pnpm bootstrap                             # idem, pelo package.json
#   bash scripts/dev/bootstrap.sh --print-commands
#                                              # imprime a árvore inteira e sai
#   bash scripts/dev/bootstrap.sh --print-commands --path 1.1
#                                              # só a subárvore de um caminho
#   bash scripts/dev/bootstrap.sh --print-window <log> <linhas> <deslocamento>
#                                              # recorta a janela do log (teste)
#
# Variáveis de ambiente:
#   NO_COLOR=1          desliga a cor (o script também desliga sozinho sem TTY)
#   POSTGRES_USER       usuário do Postgres  (default: brabo, igual ao compose)
#   POSTGRES_DB         banco do Postgres    (default: brabo, igual ao compose)
#
# Teclas: dígito escolhe (sem Enter), `v` volta, `q` sai, `↓`/`↑` mostram e
# escondem a saída de um comando em execução. Com a saída à mostra, a roda do
# mouse, `j`/`k` e PageUp/PageDown rolam o log inteiro e `G` volta ao fim (ao
# vivo). Na tela de um comando (rodando ou já concluído), `c` copia o comando
# real para a área de transferência (OSC 52) e também imprime a mesma linha
# no log, como segunda via — não há como confirmar de dentro do bash que a
# transferência funcionou. Todas aparecem no rodapé.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ---------------------------------------------------------------------------
# Cores — design system do produto (design/tokens.css, tema dark) no terminal
#
# Três níveis de degradação, nesta ordem: sem cor (NO_COLOR ou saída que não é
# terminal), 256 cores (aproximação) e 24-bit (fiel ao token). O repositório
# não usava 24-bit até aqui — só os oito códigos básicos —, e é justamente por
# isso que o fallback não é opcional: um menu ilegível num terminal antigo é
# pior que um menu sem graça.
# ---------------------------------------------------------------------------
C_RESET=''; C_BOLD=''; C_DIM=''
C_ACCENT=''; C_TEXT=''; C_MUTED=''
C_SUCCESS=''; C_WARNING=''; C_DANGER=''; C_BORDER=''

configurar_cores() {
  if [[ -n "${NO_COLOR:-}" ]] || [[ ! -t 1 ]]; then
    return 0
  fi

  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'

  if [[ "${COLORTERM:-}" == "truecolor" || "${COLORTERM:-}" == "24bit" ]]; then
    # --accent #d6633a, --text-primary #f5ede0, --text-muted #6e8a94,
    # --success #37b3a4, --warning #e0982f, --danger #e05a3e, --border #1c4a5a
    C_ACCENT=$'\033[38;2;214;99;58m'
    C_TEXT=$'\033[38;2;245;237;224m'
    C_MUTED=$'\033[38;2;110;138;148m'
    C_SUCCESS=$'\033[38;2;55;179;164m'
    C_WARNING=$'\033[38;2;224;152;47m'
    C_DANGER=$'\033[38;2;224;90;62m'
    C_BORDER=$'\033[38;2;28;74;90m'
  else
    # Aproximações no cubo de 256 cores. `danger` não usa o índice mais
    # próximo (173) porque ele é o MESMO do accent: duas cores que o produto
    # separa não podem colidir justamente na tela que informa falha.
    C_ACCENT=$'\033[38;5;173m'
    C_TEXT=$'\033[38;5;230m'
    C_MUTED=$'\033[38;5;109m'
    C_SUCCESS=$'\033[38;5;79m'
    C_WARNING=$'\033[38;5;179m'
    C_DANGER=$'\033[38;5;167m'
    C_BORDER=$'\033[38;5;60m'
  fi
}

# ---------------------------------------------------------------------------
# .env ausente (auto-cura)
#
# POR QUE EXISTE: todo item de Docker do menu chama `${COMPOSE}`, que é
# `docker compose --env-file .env` — sem o arquivo, o compose falha (ou sobe
# com as variáveis todas vazias) antes de qualquer container existir. Em vez
# de fazer quem clona o repo pela primeira vez descobrir isso batendo a
# cabeça no erro do compose, o menu copia `.env.example` (valores de dev,
# já documentados linha a linha) para `.env` sozinho, na primeira vez.
# ---------------------------------------------------------------------------
garantir_env() {
  local env="${REPO_ROOT}/.env" exemplo="${REPO_ROOT}/.env.example"
  [[ -e "${env}" ]] && return 0
  printf '%s%s%s\n' "${C_WARNING}" "bootstrap: .env não existe — copiando de .env.example" "${C_RESET}" >&2
  cp "${exemplo}" "${env}"
}

# ---------------------------------------------------------------------------
# Donos corrompidos por container (auto-cura)
#
# POR QUE EXISTE: os Dockerfiles de dev (docker/*/Dockerfile) não têm `USER` e
# rodam `pnpm install`/`mix deps.get` como root dentro de `/workspace`, que é
# bind-mount do repo (`..:/workspace`). O compose isola a maior parte disso
# com volumes nomeados (api_app_node_modules, engine_build...), mas pastas
# fora dessa lista — `.pnpm-store`, `website/node_modules`, `apps/*/dist` — ou
# que já existiam ANTES dos volumes serem adicionados, ficam com dono root no
# host. Todo item do menu que roda `pnpm`/`mix` fora do Docker (Test, DB
# generate...) esbarra nelas com "permission denied". Em vez de depender de
# alguém lembrar de rodar `sudo chown` à mão — em toda máquina, toda vez que
# regredir —, o menu se auto-cura ANTES de abrir: varre a mesma lista de
# pastas regeneráveis do `.gitignore` e devolve o dono quando encontra algo
# escrito por root.
# ---------------------------------------------------------------------------
PASTAS_REGENERAVEIS=(
  node_modules
  dist
  .pnpm-store
  apps/api/node_modules
  apps/api/dist
  apps/web/node_modules
  apps/web/dist
  apps/engine/_build
  apps/engine/deps
  packages/shared/node_modules
  packages/shared/dist
  website/node_modules
  website/build
)

corrigir_donos() {
  local meu_uid alvo caminho pendentes=()
  meu_uid="$(id -u)"

  for alvo in "${PASTAS_REGENERAVEIS[@]}"; do
    caminho="${REPO_ROOT}/${alvo}"
    [[ -e "${caminho}" ]] || continue
    # head -n1 (não `-quit`, que é só GNU find) pra funcionar igual em BSD find.
    if [[ -n "$(find "${caminho}" -not -user "${meu_uid}" -print 2>/dev/null | head -n 1)" ]]; then
      pendentes+=("${caminho}")
    fi
  done

  (( ${#pendentes[@]} == 0 )) && return 0

  printf '%s%s%s\n' "${C_WARNING}" "bootstrap: pastas com dono root (escritas pelo Docker) — corrigindo antes de continuar:" "${C_RESET}" >&2
  printf '  %s\n' "${pendentes[@]}" >&2
  sudo chown -R "${meu_uid}:$(id -g)" "${pendentes[@]}"
}

# ---------------------------------------------------------------------------
# A árvore de menus
#
# Um mapa de caminho ("1.1.2") para rótulo, comando e estado. É dado, não
# código: é o que permite o modo `--print-commands` provar a árvore inteira
# sem executar nada — e é a lógica que erra na prática, então é a que tem
# teste (scripts/dev/bootstrap.spec.ts).
# ---------------------------------------------------------------------------
declare -A ROTULO CMD FILHOS ESTADO NOTA

COMPOSE="docker compose -f docker/docker-compose.yml --env-file .env"

ROTULO["."]="Brabo";     FILHOS["."]="1 2 3 4"

ROTULO["1"]="Docker";    FILHOS["1"]="1.1 1.2 1.3 1.4 1.5"
ROTULO["2"]="K8s";       FILHOS["2"]="2.1 2.2 2.3"
ROTULO["3"]="Database";  FILHOS["3"]="3.1 3.2 3.3 3.4"
ROTULO["4"]="Test";      FILHOS["4"]="4.1 4.2 4.3 4.4 4.5 4.6"

# -- 1. Docker --------------------------------------------------------------
# Deploy publica código num ambiente que JÁ existe (por isso é o granular).
# Create provisiona do zero — e passa pelo preflight, que confere as portas
# 3000/4000/8080 e é o que evita o choque conhecido com `make deploy-local`.
#
# `$(bash scripts/dev/perfil-ollama.sh)` — ESCAPADO com `\$` de propósito, para
# ficar gravado LITERAL no mapa (senão o `$(...)` rodaria uma vez só, aqui, na
# hora em que este arquivo é fonteado, e nunca de novo) — decide em tempo de
# EXECUÇÃO se o comando sobe (ou derruba) ollama/ollama-model-loader junto
# (mesmo padrão de `\${POSTGRES_USER:-brabo}` no CMD["3.4"], abaixo: escapar
# é o que faz a variável ser lida quando o comando RODA, não quando o menu é
# montado). Os três itens que operam a STACK INTEIRA (nenhum serviço
# específico) precisam disso — Api/Engine/Web (1.1.2..4) não tocam ollama.
# Destroy também precisa: `docker compose down` SEM `--profile` ignora
# containers de um profile inativo (deixa `ollama`/`ollama-model-loader` de
# pé, órfãos, e a rede presa) — mesmo `--profile` do `up`, para desfazer
# exatamente o que ele fez.
ROTULO["1.1"]="Deploy";  FILHOS["1.1"]="1.1.1 1.1.2 1.1.3 1.1.4"
ROTULO["1.2"]="Create";  CMD["1.2"]="node scripts/dev/preflight.mjs && ${COMPOSE} \$(bash scripts/dev/perfil-ollama.sh) up -d"
ROTULO["1.3"]="Destroy"; CMD["1.3"]="${COMPOSE} \$(bash scripts/dev/perfil-ollama.sh) down"
NOTA["1.2"]="cria a rede, os volumes e os containers (sem reconstruir imagem)"
NOTA["1.3"]="para e remove os containers (incl. ollama/ollama-model-loader se estiverem de pé); os volumes sobrevivem"

ROTULO["1.1.1"]="All";    CMD["1.1.1"]="${COMPOSE} \$(bash scripts/dev/perfil-ollama.sh) up -d --build"
ROTULO["1.1.2"]="Api";    CMD["1.1.2"]="${COMPOSE} up -d --build api"
ROTULO["1.1.3"]="Engine"; CMD["1.1.3"]="${COMPOSE} up -d --build engine"
ROTULO["1.1.4"]="Web";    CMD["1.1.4"]="${COMPOSE} up -d --build web"

# Reset total: rebuild + apaga o banco + sobe até saudável + migra + semeia,
# numa tacada só — ver scripts/dev/reset-total.sh. É a única folha de Docker
# que também mexe no banco, e por isso pede confirmação PRÓPRIA
# (`confirmar_reset`, não `confirmar` — essa é só do Database › Delete) e não
# exige o Postgres já de pé: o próprio comando sobe o compose do zero.
ROTULO["1.4"]="Reset total"; CMD["1.4"]="bash scripts/dev/reset-total.sh"
ESTADO["1.4"]="confirmar_reset"
NOTA["1.4"]="rebuild + apaga o banco + sobe até saudável + migra + semeia (credenciais de .env inclusas)"

# Reconfigurar Ollama: esquece a decisão host/container gravada em `.env` por
# scripts/dev/preflight.mjs (RN de detecção de Ollama nativo), forçando a
# pergunta de novo na próxima subida. NÃO mexe em dado nenhum (só três chaves
# de `.env`) — segue o idioma predominante dos itens não-triviais-mas-não-
# destrutivos deste menu (Generate, Migrate, Seed...) e executa direto, sem
# tela de confirmação: essa régua é só para o que apaga banco.
ROTULO["1.5"]="Reconfigurar Ollama"; CMD["1.5"]="bash scripts/dev/reconfigurar-ollama.sh"
NOTA["1.5"]="remove OLLAMA_MODE/OLLAMA_HOST de .env — a próxima subida pergunta de novo"

# -- 2. K8s -----------------------------------------------------------------
# Só `All` existe: o bootstrap do cluster instala api, engine e web juntos, e
# não há caminho por serviço para expor. Api/Engine/Web ficam VISÍVEIS e
# desabilitados em vez de sumirem — o menu deve dizer o que o produto não faz.
ROTULO["2.1"]="Deploy";  FILHOS["2.1"]="2.1.1 2.1.2 2.1.3 2.1.4"
ROTULO["2.2"]="Create";  CMD["2.2"]="make deploy-local"
ROTULO["2.3"]="Destroy"; CMD["2.3"]="make k8s-down"
NOTA["2.2"]="cria o cluster k3d do zero, instala tudo e roda o smoke"
NOTA["2.3"]="remove o cluster local inteiro"

ROTULO["2.1.1"]="All";    CMD["2.1.1"]="BRABO_KEEP_CLUSTER=1 make deploy-local"
ROTULO["2.1.2"]="Api";    ESTADO["2.1.2"]="desabilitado"
ROTULO["2.1.3"]="Engine"; ESTADO["2.1.3"]="desabilitado"
ROTULO["2.1.4"]="Web";    ESTADO["2.1.4"]="desabilitado"
NOTA["2.1.2"]="o bootstrap do K8s instala os três juntos — use All"
NOTA["2.1.3"]="${NOTA["2.1.2"]}"
NOTA["2.1.4"]="${NOTA["2.1.2"]}"

# -- 3. Database ------------------------------------------------------------
ROTULO["3.1"]="Generate"; CMD["3.1"]="pnpm db:generate"
ROTULO["3.2"]="Migrate";  CMD["3.2"]="pnpm db:migrate"
ROTULO["3.3"]="Seed";     CMD["3.3"]="pnpm --filter api seed"
NOTA["3.1"]="drizzle-kit gera a migration a partir do schema"
NOTA["3.2"]="aplica as migrations pendentes da api"
NOTA["3.3"]="popula dados de demonstração (workspace, usuários, projeto, sessão)"

# Delete zera o SCHEMA e mantém container e volume de pé. TRÊS armadilhas
# reais, confirmadas no código (a terceira, rodando o reset de ponta a ponta
# — só um DROP SCHEMA public não bastava), e não suposições:
#
# 1. `docker/postgres/init.sql` cria a extensão pgvector e roda SÓ na primeira
#    inicialização do volume. Um DROP SCHEMA puro levaria o pgvector junto, e a
#    migration seguinte falharia — por isso a extensão é recriada aqui.
# 2. O engine (Ecto/Oban) divide o MESMO banco, mas em schema PRÓPRIO
#    (`engine`, não `public`) — dropar só `public` não apaga `engine.*`
#    (dev_agent_states, session_states, oban_jobs...). `mix ecto.migrate`
#    então tenta recriar tabela que já existe e falha com `duplicate_table`.
# 3. drizzle-kit guarda o PRÓPRIO controle de migration em `drizzle.
#    __drizzle_migrations` — schema à parte, também sobrevivendo a um DROP de
#    só `public`. Sem apagá-lo junto, `pnpm db:migrate` acha que já rodou tudo
#    (pelo controle intacto) e não recria NENHUMA tabela em `public` — a api
#    fica com o banco vazio, silenciosamente, sem erro nenhum.
# Por isso os DOIS schemas de controle são dropados ANTES do `public`, e
# recuperar exige `pnpm db:migrate` E `pnpm engine:migrate`, nesta ordem.
ROTULO["3.4"]="Delete"
ESTADO["3.4"]="confirmar"
NOTA["3.4"]="apaga TODAS as tabelas (api, engine e o controle de migration dos dois); containers seguem de pé"
CMD["3.4"]="${COMPOSE} exec -T postgres psql -v ON_ERROR_STOP=1 -U \"\${POSTGRES_USER:-brabo}\" -d \"\${POSTGRES_DB:-brabo}\" -c 'DROP SCHEMA IF EXISTS engine CASCADE;' -c 'DROP SCHEMA IF EXISTS drizzle CASCADE;' -c 'DROP SCHEMA public CASCADE;' -c 'CREATE SCHEMA public;' -c 'CREATE EXTENSION IF NOT EXISTS vector;'"

# -- 4. Test ----------------------------------------------------------------
# `All` soma engine e scripts ao `pnpm test` da raiz, que cobre só api e web.
ROTULO["4.1"]="All";    CMD["4.1"]="pnpm test && pnpm engine:test && pnpm --filter @brabo/scripts test"
ROTULO["4.2"]="Api";    CMD["4.2"]="pnpm --filter api test"
ROTULO["4.3"]="Engine"; CMD["4.3"]="pnpm engine:test"
ROTULO["4.4"]="Web";    CMD["4.4"]="pnpm --filter web test"
ROTULO["4.5"]="Smoke";  CMD["4.5"]="bash docker/smoke.sh"
ROTULO["4.6"]="Docs";   CMD["4.6"]="pnpm docs:check && pnpm docs:build"
NOTA["4.1"]="api, web, engine e os scripts de CI"
NOTA["4.5"]="sobe as imagens de produção, exercita 3 caminhos e derruba"
NOTA["4.6"]="docmap, gerados em dia e build do site"

# ---------------------------------------------------------------------------
# Consultas à árvore
# ---------------------------------------------------------------------------
eh_folha() { [[ -z "${FILHOS[$1]:-}" ]]; }
existe()   { [[ -n "${ROTULO[$1]:-}" ]]; }

# "1.1.2" -> "Docker › Deploy › Api"
trilha() {
  local caminho="$1" acumulado="" saida="" seg
  [[ "${caminho}" == "." ]] && { printf '%s' "${ROTULO["."]}"; return; }
  local IFS='.'
  for seg in ${caminho}; do
    acumulado="${acumulado:+${acumulado}.}${seg}"
    saida="${saida:+${saida} › }${ROTULO[$acumulado]}"
  done
  printf '%s' "${saida}"
}

folhas_de() {
  local raiz="$1" filho
  if eh_folha "${raiz}"; then printf '%s\n' "${raiz}"; return; fi
  for filho in ${FILHOS[$raiz]}; do folhas_de "${filho}"; done
}

# ---------------------------------------------------------------------------
# Modo não-interativo: imprime a árvore resolvida e sai. É o que torna o
# mapeamento menu → comando testável sem TTY e sem executar nada.
# ---------------------------------------------------------------------------
imprimir_comandos() {
  local raiz="${1:-.}" folha estado comando
  if ! existe "${raiz}"; then
    printf 'caminho inexistente: %s\n' "${raiz}" >&2
    return 2
  fi
  while IFS= read -r folha; do
    estado="${ESTADO[$folha]:-ok}"
    comando="${CMD[$folha]:--}"
    [[ "${estado}" == "desabilitado" ]] && comando='-'
    printf '%s\t%s\t%s\t%s\n' "${folha}" "$(trilha "${folha}")" "${estado}" "${comando}"
  done < <(folhas_de "${raiz}")
}

# ---------------------------------------------------------------------------
# Terminal: banner fixo por região de rolagem (DECSTBM)
#
# `\e[<topo>;<base>r` tira as linhas do banner da área que rola. É isso que
# mantém a marca parada quando o conteúdo passa da tela e quando se navega
# entre submenus, sem redesenhar a tela inteira a cada quadro.
# ---------------------------------------------------------------------------
LINHAS=24; COLUNAS=80; ALTURA_BANNER=7; COMPACTO=0
STTY_ORIGINAL=''
declare -a LOGS=()

medir_terminal() {
  LINHAS="$(tput lines 2>/dev/null || echo 24)"
  COLUNAS="$(tput cols 2>/dev/null || echo 80)"
  # Terminal pequeno é caso real, não hipótese: abaixo deste tamanho o banner
  # de seis linhas comeria o menu inteiro.
  if (( LINHAS < 20 || COLUNAS < 60 )); then
    COMPACTO=1; ALTURA_BANNER=2
  else
    COMPACTO=0; ALTURA_BANNER=8
  fi
}

mover()  { printf '\033[%d;%dH' "$1" "$2"; }
limpar_tudo() { printf '\033[2J'; }

limpar_corpo() {
  local l
  for (( l = ALTURA_BANNER + 1; l <= LINHAS; l++ )); do
    mover "$l" 1; printf '\033[2K'
  done
}

definir_regiao() { printf '\033[%d;%dr' "$(( ALTURA_BANNER + 1 ))" "${LINHAS}"; }

# ---------------------------------------------------------------------------
# Roda do mouse
#
# `?1000` liga o rastreio de botão (a roda entra nele como botão 64/65) e
# `?1006` pede o relato em SGR — `ESC [ < Cb ; Cx ; Cy M`, tudo em ASCII
# imprimível. O modo X10 original relata a posição como BYTES CRUS somados a
# 32, e coluna > 95 vira byte fora do ASCII: sob locale UTF-8 o `read` do bash
# junta esse byte ao seguinte e a sequência chega quebrada. Por isso SGR, e não
# o modo antigo.
#
# Ligar é local à tela de execução (é a única onde rolar significa algo), mas
# DESLIGAR é incondicional em `restaurar_terminal`: um terminal que sai daqui
# ainda relatando mouse enche o shell de lixo a cada clique.
# ---------------------------------------------------------------------------
ligar_mouse()    { printf '\033[?1000h\033[?1006h'; }
desligar_mouse() { printf '\033[?1006l\033[?1000l'; }

restaurar_terminal() {
  desligar_mouse       # antes de tudo: sair relatando mouse quebra o shell
  printf '\033[r'      # solta a região de rolagem
  printf '\033[?25h'   # cursor de volta
  printf '%s' "${C_RESET}"
  [[ -n "${STTY_ORIGINAL}" ]] && stty "${STTY_ORIGINAL}" 2>/dev/null || true
  mover "${LINHAS}" 1
  printf '\n'
}

limpar_logs() {
  local f
  if (( ${#LOGS[@]} > 0 )); then
    for f in "${LOGS[@]}"; do rm -f "${f}"; done
  fi
  return 0
}

# Sem este trap, um Ctrl+C deixa o terminal do usuário com a região de rolagem
# presa e o cursor escondido — o script quebraria o shell de quem o rodou.
#
# O `$?` é capturado e devolvido na primeira linha: sem isso, o status da
# limpeza vira o status do script, e um menu que sempre sai 1 é indistinguível
# de um comando que falhou.
ao_sair() {
  local codigo=$?
  restaurar_terminal
  limpar_logs
  return "${codigo}"
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
# Monograma B: haste sólida + dois chevrons. De longe lê-se `>>` — agentes
# avançando em cadeia. O chevron de baixo vai esmaecido: é o 58% de opacidade
# do handoff ainda em execução (apps/web/src/components/ui/icons.tsx, LogoMark).
desenhar_banner() {
  local a="${C_ACCENT}" m="${C_MUTED}" t="${C_TEXT}" b="${C_BORDER}" r="${C_RESET}"

  if (( COMPACTO )); then
    mover 1 1; printf '\033[2K%s▌❯❯ %s%sBRABO%s %s· orquestração de agentes%s' \
      "${a}" "${m}" "${C_BOLD}${t}" "${r}" "${m}" "${r}"
    mover 2 1; printf '\033[2K%s%s%s' "${b}" "$(regua)" "${r}"
    return
  fi

  mover 1 1; printf '\033[2K %s██▌╲%s   %s%s██████╗ ██████╗  █████╗ ██████╗  ██████╗%s'  "${a}" "${r}" "${C_BOLD}" "${t}" "${r}"
  mover 2 1; printf '\033[2K %s██▌╱%s   %s%s██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔═══██╗%s' "${a}" "${r}" "${C_BOLD}" "${t}" "${r}"
  mover 3 1; printf '\033[2K %s██▌%s%s╲%s   %s%s██████╔╝██████╔╝███████║██████╔╝██║   ██║%s' "${a}" "${r}" "${m}" "${r}" "${C_BOLD}" "${t}" "${r}"
  mover 4 1; printf '\033[2K %s██▌%s%s╱%s   %s%s██╔══██╗██╔══██╗██╔══██║██╔══██╗██║   ██║%s' "${a}" "${r}" "${m}" "${r}" "${C_BOLD}" "${t}" "${r}"
  mover 5 1; printf '\033[2K %s██▌%s    %s%s██████╔╝██║  ██║██║  ██║██████╔╝╚██████╔╝%s'  "${a}" "${r}" "${C_BOLD}" "${t}" "${r}"
  mover 6 1; printf '\033[2K'
  mover 7 1; printf '\033[2K        %sORQUESTRAÇÃO DE AGENTES%s' "${m}" "${r}"
  mover 8 1; printf '\033[2K%s%s%s' "${b}" "$(regua)" "${r}"
}

regua() {
  local i saida=''
  for (( i = 0; i < COLUNAS; i++ )); do saida+='─'; done
  printf '%s' "${saida}"
}

# ---------------------------------------------------------------------------
# Leitura de tecla
#
# Seta é sequência de escape, e o timeout curto no segundo `read` é o que
# separa uma seta de um ESC solto.
#
# O parser é GENÉRICO de propósito. Ler dois bytes fixos depois do ESC — o que
# havia aqui — cobre `↑`/`↓` (`\e[A`/`\e[B`) e mais nada: PageUp é `\e[5~`
# (quatro bytes) e a roda do mouse em SGR é `\e[<64;12;34M` (comprimento
# variável). E o estrago não é perder a tecla: os bytes que sobram voltam como
# teclas SOLTAS na leitura seguinte — como o menu trata `[1-9]` como escolha,
# um giro de roda dispararia itens do menu. Por isso a leitura vai até o byte
# FINAL da sequência CSI (0x40–0x7E), qualquer que seja o tamanho dela.
# ---------------------------------------------------------------------------
BYTES_DE_PARAMETRO='^[0-9;:<=>?]$'   # 0x30–0x3F: o miolo de uma sequência CSI

ler_tecla() {
  local tempo="${1:-}" k introdutor corpo byte botao
  if [[ -n "${tempo}" ]]; then
    IFS= read -rsn1 -t "${tempo}" k || { printf ''; return 0; }
  else
    IFS= read -rsn1 k || { printf 'q'; return 0; }
  fi
  if [[ "${k}" != $'\033' ]]; then printf '%s' "${k}"; return 0; fi

  # Só `[` (CSI) e `O` (SS3, as setas em modo de aplicação) abrem sequência.
  IFS= read -rsn1 -t 0.05 introdutor || introdutor=''
  if [[ "${introdutor}" != '[' && "${introdutor}" != 'O' ]]; then
    printf 'esc'; return 0
  fi

  corpo=''
  while IFS= read -rsn1 -t 0.05 byte; do
    corpo+="${byte}"
    [[ "${byte}" =~ ${BYTES_DE_PARAMETRO} ]] || break
  done

  # Mouse em SGR: `<botão;coluna;linha` e `M` (pressão) ou `m` (soltura). Só a
  # roda interessa — clique e arraste não têm significado neste menu, e devolver
  # vazio para eles é o que impede um clique de virar tecla.
  if [[ "${corpo}" == '<'* ]]; then
    botao="${corpo#<}"; botao="${botao%%;*}"
    case "${botao}" in
      64) printf 'roda_cima' ;;
      65) printf 'roda_baixo' ;;
      *)  printf '' ;;
    esac
    return 0
  fi

  case "${corpo}" in
    'A')  printf 'cima' ;;
    'B')  printf 'baixo' ;;
    '5~') printf 'pagina_cima' ;;
    '6~') printf 'pagina_baixo' ;;
    *)    printf '' ;;
  esac
}

# ---------------------------------------------------------------------------
# Desenho do menu
# ---------------------------------------------------------------------------
rodape() {
  local linha="$1"; shift
  mover "${linha}" 1; printf '\033[2K%s%s%s' "${C_BORDER}" "$(regua)" "${C_RESET}"
  mover "$(( linha + 1 ))" 1; printf '\033[2K  %s%s%s' "${C_MUTED}" "$*" "${C_RESET}"
}

desenhar_menu() {
  local caminho="$1" linha filho digito rotulo estado nota marcador
  limpar_corpo

  linha=$(( ALTURA_BANNER + 2 ))
  mover "${linha}" 1
  if [[ "${caminho}" == "." ]]; then
    printf '  %sEscolha uma área%s' "${C_MUTED}" "${C_RESET}"
  else
    printf '  %s%s%s' "${C_ACCENT}" "$(trilha "${caminho}")" "${C_RESET}"
  fi
  linha=$(( linha + 2 ))

  for filho in ${FILHOS[$caminho]}; do
    digito="${filho##*.}"
    rotulo="${ROTULO[$filho]}"
    estado="${ESTADO[$filho]:-ok}"
    nota="${NOTA[$filho]:-}"
    mover "${linha}" 1
    if [[ "${estado}" == "desabilitado" ]]; then
      printf '   %s%s. %-9s%s %s%s%s' \
        "${C_MUTED}" "${digito}" "${rotulo}" "${C_RESET}" \
        "${C_MUTED}${C_DIM}" "(indisponível — ${nota})" "${C_RESET}"
    else
      marcador=''
      [[ "${estado}" == "confirmar" || "${estado}" == "confirmar_reset" ]] && marcador="${C_WARNING}!${C_RESET} "
      printf '   %s%s.%s %s%-9s%s %s%s%s%s' \
        "${C_ACCENT}" "${digito}" "${C_RESET}" \
        "${C_TEXT}" "${rotulo}" "${C_RESET}" \
        "${marcador}" "${C_MUTED}" "${nota}" "${C_RESET}"
    fi
    linha=$(( linha + 1 ))
  done

  if [[ "${caminho}" == "." ]]; then
    rodape "$(( LINHAS - 2 ))" "1-4 escolher   ${C_TEXT}q${C_MUTED} sair"
  else
    rodape "$(( LINHAS - 2 ))" "1-9 escolher   ${C_TEXT}v${C_MUTED} voltar   ${C_TEXT}q${C_MUTED} sair"
  fi
}

# ---------------------------------------------------------------------------
# Confirmação da ação destrutiva
#
# É a única tela que pede Enter, e de propósito: apagar o banco não pode
# acontecer por um dígito digitado sem querer.
# ---------------------------------------------------------------------------
confirmar_delete() {
  local linha=$(( ALTURA_BANNER + 2 )) resposta banco="${POSTGRES_DB:-brabo}"
  limpar_corpo
  mover "${linha}" 1;       printf '  %s%sIsto apaga TODAS as tabelas do banco "%s".%s' "${C_BOLD}" "${C_WARNING}" "${banco}" "${C_RESET}"
  mover $(( linha + 2 )) 1; printf '  %sOs schemas engine, drizzle e public são derrubados e o public recriado, com pgvector.%s' "${C_MUTED}" "${C_RESET}"
  mover $(( linha + 3 )) 1; printf '  %sO engine divide o mesmo banco (schema próprio): as tabelas dele somem também.%s' "${C_MUTED}" "${C_RESET}"
  mover $(( linha + 5 )) 1; printf '  %sContainers e volume seguem de pé. Recuperar:%s' "${C_MUTED}" "${C_RESET}"
  mover $(( linha + 6 )) 1; printf '    %spnpm db:migrate  &&  pnpm engine:migrate%s' "${C_TEXT}" "${C_RESET}"
  rodape "$(( LINHAS - 4 ))" "digite ${C_TEXT}${banco}${C_MUTED} e Enter para confirmar — qualquer outra coisa cancela"

  mover "$(( LINHAS - 1 ))" 1; printf '\033[2K  '
  printf '\033[?25h'
  IFS= read -r resposta || resposta=''
  printf '\033[?25l'

  [[ "${resposta}" == "${banco}" ]]
}

# Confirmação do Reset total — mesma régua da Delete (só Enter não conta),
# mas a frase digitada é fixa: este item não gira em torno do NOME do banco,
# gira em torno de rebuild + apagar + subir + migrar + semear numa tacada só.
confirmar_reset_total() {
  local linha=$(( ALTURA_BANNER + 2 )) resposta
  limpar_corpo
  mover "${linha}" 1;       printf '  %s%sIsto reconstrói as imagens, apaga TODAS as tabelas e semeia de novo.%s' "${C_BOLD}" "${C_WARNING}" "${C_RESET}"
  mover $(( linha + 2 )) 1; printf '  %sOrdem: preflight, build + up --wait, DROP SCHEMA (api e engine), migrate, seed.%s' "${C_MUTED}" "${C_RESET}"
  mover $(( linha + 3 )) 1; printf '  %sCredenciais de provider em .env (*_TEST_KEY) entram já ativas no owner.%s' "${C_MUTED}" "${C_RESET}"
  rodape "$(( LINHAS - 4 ))" "digite ${C_TEXT}RESET${C_MUTED} e Enter para confirmar — qualquer outra coisa cancela"

  mover "$(( LINHAS - 1 ))" 1; printf '\033[2K  '
  printf '\033[?25h'
  IFS= read -r resposta || resposta=''
  printf '\033[?25l'

  [[ "${resposta}" == "RESET" ]]
}

# O `</dev/null` não é decoração: sem ele o `docker compose` herda o terminal e
# consome as teclas que o usuário já digitou, engolindo a navegação seguinte.
postgres_de_pe() {
  local id
  id="$(cd "${REPO_ROOT}" && ${COMPOSE} ps -q postgres 2>/dev/null </dev/null || true)"
  [[ -n "${id}" ]]
}

# ---------------------------------------------------------------------------
# Execução: duas telas
#
# O comando roda em background com a saída num log temporário. A tela padrão
# mostra só que está executando; `↓` revela a saída ao vivo e `↑` recolhe.
# ---------------------------------------------------------------------------
PID_ATUAL=0
ABORTADO=0

# Quantas linhas a janela do log está deslocada para TRÁS. Zero significa colada
# no fim — o comportamento antigo, acompanhando a saída ao vivo.
DESLOCAMENTO=0

rolar() {
  local log="$1" delta="$2" total teto
  total="$(contar_linhas "${log}")"
  # Rolar além do começo do arquivo mostraria tela vazia e daria a impressão de
  # que o log sumiu; o teto é o que sobra depois do que já cabe na tela.
  teto=$(( total - $(altura_janela) ))
  (( teto < 0 )) && teto=0
  DESLOCAMENTO=$(( DESLOCAMENTO + delta ))
  (( DESLOCAMENTO < 0 )) && DESLOCAMENTO=0
  (( DESLOCAMENTO > teto )) && DESLOCAMENTO="${teto}"
  return 0
}

# Devolve 0 quando a tecla era de rolagem (e já a aplicou), 1 quando não era.
# Quem chama usa a resposta para ABRIR a saída: rolar com ela escondida não teria
# efeito visível nenhum, e o usuário concluiria que a roda não funciona.
#
# A roda anda 3 linhas (o passo que os terminais usam), `j`/`k` andam uma e
# PageUp/PageDown andam uma tela cheia menos uma linha — a linha repetida é o
# que dá a costura entre uma página e a seguinte.
tratar_rolagem() {
  local tecla="$1" log="$2" pagina
  pagina=$(( $(altura_janela) - 1 )); (( pagina < 1 )) && pagina=1
  case "${tecla}" in
    roda_cima)    rolar "${log}" 3 ;;
    roda_baixo)   rolar "${log}" -3 ;;
    k)            rolar "${log}" 1 ;;
    j)            rolar "${log}" -1 ;;
    pagina_cima)  rolar "${log}" "${pagina}" ;;
    pagina_baixo) rolar "${log}" "-${pagina}" ;;
    G)            DESLOCAMENTO=0 ;;
    *)            return 1 ;;
  esac
  return 0
}

# O rodapé precisa dizer que a janela CONGELOU, senão o log parado no meio de um
# comando que ainda escreve parece o comando ter travado.
dicas_rolagem() {
  if (( DESLOCAMENTO > 0 )); then
    printf '%scongelado%s em -%s linhas   %sG%s ao vivo' \
      "${C_WARNING}" "${C_MUTED}" "${DESLOCAMENTO}" "${C_TEXT}" "${C_MUTED}"
  else
    # Com o rastreio de mouse ligado, arrastar não seleciona mais texto: o
    # terminal manda o arrasto para cá. Segurar Shift devolve a seleção nativa —
    # e quem não souber disso vai achar que o menu quebrou o copiar e colar.
    printf '%sroda/jk/PgUp%s rolar   %sShift%s p/ selecionar' \
      "${C_TEXT}" "${C_MUTED}" "${C_TEXT}" "${C_MUTED}"
  fi
}

matar_arvore() {
  local p="$1"
  pkill -TERM -P "${p}" 2>/dev/null || true
  kill -TERM "${p}" 2>/dev/null || true
}

ao_interromper() {
  if (( PID_ATUAL > 0 )); then
    ABORTADO=1
    matar_arvore "${PID_ATUAL}"
  else
    exit 130
  fi
}

desenhar_execucao_compacta() {
  local rotulo="$1" quadro="$2" decorrido="$3"
  local -a spin=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  local linha=$(( ALTURA_BANNER + 3 ))
  mover "${linha}" 1;       printf '\033[2K   %s%s%s  %s%s%s' \
    "${C_ACCENT}" "${spin[quadro % 10]}" "${C_RESET}" "${C_TEXT}" "${rotulo}" "${C_RESET}"
  mover $(( linha + 2 )) 1; printf '\033[2K      %sexecutando… %ss%s' "${C_MUTED}" "${decorrido}" "${C_RESET}"
}

# ---------------------------------------------------------------------------
# A janela do log
#
# `tail -n` só sabe mostrar o FIM do arquivo — e é por isso que rolar não era
# questão de ler a roda do mouse melhor: não existia DESLOCAMENTO nenhum para
# onde rolar. A janela é o recorte `[fim - altura - deslocamento, ...]`, com
# `sed -n 'a,bp'` (já usado no `--help` deste mesmo script), sem ferramenta nova.
#
# Extraída em função própria porque é a única parte disto que se testa sem TTY,
# pelo modo `--print-window`.
# ---------------------------------------------------------------------------
contar_linhas() {
  local n
  n="$(wc -l < "$1" 2>/dev/null || printf '0')"
  n="${n//[^0-9]/}"          # o `wc` do BSD alinha o número com espaços
  printf '%s' "${n:-0}"
}

janela_log() {
  local log="$1" altura="$2" deslocamento="$3" total inicio
  (( altura < 1 )) && return 0
  (( deslocamento < 0 )) && deslocamento=0
  total="$(contar_linhas "${log}")"
  inicio=$(( total - altura - deslocamento + 1 ))
  (( inicio < 1 )) && inicio=1
  sed -n "${inicio},$(( inicio + altura - 1 ))p" "${log}" 2>/dev/null || true
}

# Quantas linhas do log cabem na tela. Uma conta só, porque quem desenha e quem
# rola (o passo de página, o teto do deslocamento) precisam do MESMO número.
altura_janela() { printf '%s' "$(( LINHAS - 3 - (ALTURA_BANNER + 2) ))"; }

desenhar_execucao_expandida() {
  local rotulo="$1" log="$2"
  local topo=$(( ALTURA_BANNER + 2 )) base=$(( LINHAS - 3 ))
  local disponiveis l=0 texto
  disponiveis="$(altura_janela)"
  mover "${topo}" 1; printf '\033[2K   %s%s%s' "${C_TEXT}" "${rotulo}" "${C_RESET}"
  l=$(( topo + 1 ))
  while IFS= read -r texto; do
    (( l > base )) && break
    mover "${l}" 1
    printf '\033[2K   %s%s%s' "${C_MUTED}" "${texto:0:$(( COLUNAS - 5 ))}" "${C_RESET}"
    l=$(( l + 1 ))
  done < <(janela_log "${log}" "${disponiveis}" "${DESLOCAMENTO}")
  while (( l <= base )); do mover "${l}" 1; printf '\033[2K'; l=$(( l + 1 )); done
}

# ---------------------------------------------------------------------------
# Copiar comando (tecla `c`, nas duas telas de execução — rodando e já
# concluída)
#
# OSC 52 é a única forma de um processo escrever na área de transferência do
# LADO DO CLIENTE a partir do bash — funciona local e sobre SSH, na maioria
# dos terminais modernos —, mas não há como confirmar sucesso: o terminal não
# devolve nada de volta. Por isso o texto puro do comando SEMPRE também vai
# para a janela de log (o mecanismo que já existe e sempre funciona), como
# segunda via — quem estiver num terminal sem suporte a OSC 52 ainda sai
# daqui com o comando para copiar à mão.
# ---------------------------------------------------------------------------
copiar_comando() {
  local comando="$1" log="$2"
  printf '\033]52;c;%s\033\\' "$(base64 -w0 <<< "${comando}")" > /dev/tty 2>/dev/null || true
  {
    printf '%s\n' "${comando}"
    printf 'Comando copiado (ou copie a linha acima manualmente).\n'
  } >> "${log}"
}

executar() {
  local caminho="$1"
  local rotulo comando log pid modo modo_anterior inicio quadro tecla codigo decorrido
  local total_agora total_anterior=0
  rotulo="$(trilha "${caminho}")"
  comando="${CMD[$caminho]}"
  log="$(mktemp "${TMPDIR:-/tmp}/brabo-bootstrap.XXXXXX")"
  LOGS+=("${log}")

  modo=compacto; modo_anterior=compacto; quadro=0; inicio="${SECONDS}"; ABORTADO=0
  DESLOCAMENTO=0
  # A roda só é ligada aqui: esta é a única tela onde rolar significa algo, e
  # rastrear mouse no menu custaria a seleção de texto por nada.
  ligar_mouse
  limpar_corpo

  # stdin vem de /dev/null de propósito: o comando roda em background enquanto
  # o menu continua lendo teclas do mesmo terminal. Sem isto, qualquer coisa
  # que leia stdin (um prompt do docker, um pager) rouba as setas do usuário —
  # e um comando que espera resposta trava sem nunca mostrar a pergunta.
  ( cd "${REPO_ROOT}" && exec bash -c "${comando}" ) >"${log}" 2>&1 </dev/null &
  pid=$!
  PID_ATUAL="${pid}"

  while kill -0 "${pid}" 2>/dev/null; do
    decorrido=$(( SECONDS - inicio ))
    # Compacta só reescreve 2 linhas; expandida ocupa da ALTURA_BANNER+2 até
    # LINHAS-3. Redesenhar sem limpar na TROCA de modo deixava o texto da
    # saída expandida vazando por trás do spinner ao recolher — `limpar_corpo`
    # só na virada (não a cada quadro) tira o resto sem piscar a animação.
    if [[ "${modo}" != "${modo_anterior}" ]]; then
      limpar_corpo
      modo_anterior="${modo}"
    fi
    if [[ "${modo}" == "compacto" ]]; then
      desenhar_execucao_compacta "${rotulo}" "${quadro}" "${decorrido}"
      rodape "$(( LINHAS - 2 ))" "${C_TEXT}↓${C_MUTED} ver a saída   ${C_TEXT}c${C_MUTED} copiar comando   ${C_TEXT}Ctrl+C${C_MUTED} abortar"
    else
      # Congelar de verdade exige compensar o CRESCIMENTO do log: o
      # deslocamento conta linhas a partir do FIM, e o fim anda enquanto o
      # comando escreve. Sem somar o que entrou desde o quadro anterior, a
      # janela escorregaria uma linha a cada linha nova — e "congelado" que
      # anda cinco vezes por segundo é pior que não congelar.
      total_agora="$(contar_linhas "${log}")"
      if (( DESLOCAMENTO > 0 && total_agora > total_anterior )); then
        DESLOCAMENTO=$(( DESLOCAMENTO + total_agora - total_anterior ))
      fi
      total_anterior="${total_agora}"
      desenhar_execucao_expandida "${rotulo}" "${log}"
      rodape "$(( LINHAS - 2 ))" "${C_TEXT}↑${C_MUTED} esconder   $(dicas_rolagem)   ${C_TEXT}c${C_MUTED} copiar comando   ${C_TEXT}Ctrl+C${C_MUTED} abortar"
    fi
    quadro=$(( quadro + 1 ))
    tecla="$(ler_tecla 0.2)"
    if tratar_rolagem "${tecla}" "${log}"; then
      if [[ "${modo}" == "compacto" ]]; then
        modo=expandido
        # A âncora do congelamento começa AGORA: herdar a contagem de antes de
        # a saída ser escondida faria a compensação somar de uma vez tudo que o
        # comando escreveu enquanto ninguém olhava.
        total_anterior="$(contar_linhas "${log}")"
      fi
      continue
    fi
    case "${tecla}" in
      baixo) modo=expandido ;;
      # Recolher volta a acompanhar o fim: reabrir a saída no ponto em que se
      # parou de olhar, minutos depois, mostraria um trecho que já não é o que
      # está acontecendo.
      cima)  modo=compacto; DESLOCAMENTO=0 ;;
      # Não é destrutiva e não precisa de Enter — mesmo idioma de tecla única
      # do resto do menu. Funciona também com o comando ainda RODANDO: é o
      # texto do comando que se copia, não a saída dele.
      c)     copiar_comando "${comando}" "${log}" ;;
    esac
  done

  codigo=0
  wait "${pid}" || codigo=$?
  PID_ATUAL=0
  decorrido=$(( SECONDS - inicio ))

  limpar_corpo
  local linha=$(( ALTURA_BANNER + 3 ))
  mover "${linha}" 1
  if (( ABORTADO )); then
    printf '   %sabortado%s  %s%s%s' "${C_WARNING}" "${C_RESET}" "${C_MUTED}" "${rotulo}" "${C_RESET}"
  elif (( codigo == 0 )); then
    printf '   %sok%s  %s%s%s  %s(%ss)%s' "${C_SUCCESS}" "${C_RESET}" "${C_TEXT}" "${rotulo}" "${C_RESET}" "${C_MUTED}" "${decorrido}" "${C_RESET}"
  else
    printf '   %sfalhou%s  %s%s%s  %s(exit %s, %ss)%s' "${C_DANGER}" "${C_RESET}" "${C_TEXT}" "${rotulo}" "${C_RESET}" "${C_MUTED}" "${codigo}" "${decorrido}" "${C_RESET}"
  fi

  # A dica do banco só aparece quando o Delete de fato rodou: o engine divide
  # o mesmo banco, e migrar só a api deixaria o Oban sem tabela.
  if [[ "${caminho}" == "3.4" ]] && (( codigo == 0 )) && (( ! ABORTADO )); then
    mover $(( linha + 2 )) 1; printf '   %spara recuperar:%s %spnpm db:migrate  &&  pnpm engine:migrate%s' \
      "${C_MUTED}" "${C_RESET}" "${C_TEXT}" "${C_RESET}"
  fi

  ULTIMO_CODIGO="${codigo}"

  modo=compacto; DESLOCAMENTO=0
  while true; do
    if [[ "${modo}" == "expandido" ]]; then
      desenhar_execucao_expandida "${rotulo}" "${log}"
      rodape "$(( LINHAS - 2 ))" "${C_TEXT}↑${C_MUTED} esconder   $(dicas_rolagem)   ${C_TEXT}c${C_MUTED} copiar comando   ${C_TEXT}v${C_MUTED} voltar   ${C_TEXT}q${C_MUTED} sair"
    else
      rodape "$(( LINHAS - 2 ))" "${C_TEXT}↓${C_MUTED} ver a saída   ${C_TEXT}c${C_MUTED} copiar comando   ${C_TEXT}v${C_MUTED} voltar   ${C_TEXT}q${C_MUTED} sair"
    fi
    tecla="$(ler_tecla)"
    # Depois que o comando termina o log está parado, então aqui não há o que
    # congelar — mas é justamente aqui que se rola de verdade: ler o erro que
    # passou voando é o motivo de a rolagem existir.
    if tratar_rolagem "${tecla}" "${log}"; then modo=expandido; continue; fi
    case "${tecla}" in
      baixo) modo=expandido ;;
      cima)  modo=compacto; DESLOCAMENTO=0; limpar_corpo; mover "${linha}" 1
             if (( codigo == 0 )); then
               printf '   %sok%s  %s%s%s' "${C_SUCCESS}" "${C_RESET}" "${C_TEXT}" "${rotulo}" "${C_RESET}"
             else
               printf '   %sfalhou%s  %s%s%s  %s(exit %s)%s' "${C_DANGER}" "${C_RESET}" "${C_TEXT}" "${rotulo}" "${C_RESET}" "${C_MUTED}" "${codigo}" "${C_RESET}"
             fi ;;
      c)     copiar_comando "${comando}" "${log}" ;;
      # Voltar ao menu desliga o mouse na mesma volta em que ele deixa de ter
      # uso; sair não precisa, porque o trap de EXIT desliga de qualquer jeito.
      v)     desligar_mouse; return 0 ;;
      q)     exit "${codigo}" ;;
    esac
  done
}

# ---------------------------------------------------------------------------
# Aviso simples no corpo (usado quando o item está indisponível)
# ---------------------------------------------------------------------------
avisar() {
  local mensagem="$1" linha=$(( ALTURA_BANNER + 3 ))
  limpar_corpo
  mover "${linha}" 1; printf '   %s%s%s' "${C_WARNING}" "${mensagem}" "${C_RESET}"
  rodape "$(( LINHAS - 2 ))" "qualquer tecla volta   ${C_TEXT}q${C_MUTED} sair"
  if [[ "$(ler_tecla)" == "q" ]]; then exit "${ULTIMO_CODIGO}"; fi
  return 0
}

# ---------------------------------------------------------------------------
# Laço principal
# ---------------------------------------------------------------------------
ULTIMO_CODIGO=0

principal() {
  local caminho="." tecla escolhido
  medir_terminal
  printf '\033[?25l'
  limpar_tudo
  definir_regiao
  desenhar_banner

  while true; do
    desenhar_menu "${caminho}"
    tecla="$(ler_tecla)"
    case "${tecla}" in
      q) exit "${ULTIMO_CODIGO}" ;;
      # Sobe um nível: "1.1.1" → "1.1" → "1" → ".". Um caminho sem ponto já
      # está no primeiro nível, então o pai dele é a raiz.
      #
      # Na RAIZ, desativado: sem a guarda, "." também "casa" com o padrão de
      # glob `*.*` (o próprio ponto serve de literal) e `${caminho%.*}` corta
      # a string inteira, deixando `caminho=""` — um estado sem folha nem
      # filhos que só se recupera apertando `v` de novo. A raiz não tem pai;
      # o rodapé dela já nem mostra a dica de "voltar".
      v) if [[ "${caminho}" == "." ]]; then
           continue
         elif [[ "${caminho}" == *.* ]]; then
           caminho="${caminho%.*}"
         else
           caminho="."
         fi
         ;;
      [1-9])
        escolhido="${caminho}.${tecla}"
        [[ "${caminho}" == "." ]] && escolhido="${tecla}"
        if ! existe "${escolhido}"; then continue; fi
        if [[ "${ESTADO[$escolhido]:-ok}" == "desabilitado" ]]; then
          avisar "${ROTULO[$escolhido]}: ${NOTA[$escolhido]}"
          continue
        fi
        if eh_folha "${escolhido}"; then
          case "${ESTADO[$escolhido]:-ok}" in
            confirmar)
              # Só a Delete: ela roda `${COMPOSE} exec postgres`, então precisa
              # do container já de pé — ao contrário do Reset total, que sobe
              # o compose sozinho.
              if ! postgres_de_pe; then
                avisar "o container postgres não está de pé — suba com Docker › Create"
                continue
              fi
              confirmar_delete || { avisar "cancelado — nada foi apagado"; continue; }
              ;;
            confirmar_reset)
              confirmar_reset_total || { avisar "cancelado — nada foi alterado"; continue; }
              ;;
          esac
          executar "${escolhido}"
        else
          caminho="${escolhido}"
        fi
        ;;
    esac
  done
}

# ---------------------------------------------------------------------------
# Entrada
# ---------------------------------------------------------------------------
modo_impressao=0
caminho_impressao='.'
# `--print-window <log> <altura> <deslocamento>` existe pelo mesmo motivo do
# `--print-commands`: um TUI não se testa por unidade, mas o RECORTE do log é
# aritmética pura e é o que erra na prática (a borda do começo do arquivo, o
# deslocamento maior que o log). Sem TTY e sem desenhar nada.
janela_argumentos=()
while (( $# > 0 )); do
  case "$1" in
    --print-commands) modo_impressao=1; shift ;;
    --print-window)
      shift
      if (( $# < 3 )); then
        printf 'uso: --print-window <log> <altura> <deslocamento>\n' >&2
        exit 2
      fi
      janela_argumentos=("$1" "$2" "$3"); shift 3 ;;
    --path) caminho_impressao="${2:-}"; shift 2 ;;
    -h|--help)
      # 2,32 é EXATAMENTE o bloco de comentário do topo. O intervalo era maior
      # que ele e o --help imprimia `set -euo pipefail` junto com a ajuda.
      sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) printf 'argumento desconhecido: %s\n' "$1" >&2; exit 2 ;;
  esac
done

configurar_cores

if (( ${#janela_argumentos[@]} == 3 )); then
  if [[ ! -r "${janela_argumentos[0]}" ]]; then
    printf 'log ilegível: %s\n' "${janela_argumentos[0]}" >&2
    exit 2
  fi
  janela_log "${janela_argumentos[@]}"
  exit 0
fi

if (( modo_impressao )); then
  imprimir_comandos "${caminho_impressao}"
  exit $?
fi

if [[ ! -t 0 || ! -t 1 ]]; then
  printf 'o menu precisa de um terminal interativo.\n' >&2
  printf 'sem TTY, use: bash scripts/dev/bootstrap.sh --print-commands\n' >&2
  exit 2
fi

garantir_env
corrigir_donos

STTY_ORIGINAL="$(stty -g 2>/dev/null || true)"
trap ao_sair EXIT
trap ao_interromper INT
trap 'medir_terminal; limpar_tudo; definir_regiao; desenhar_banner' WINCH

principal
