#!/bin/sh
# Verifica e (opcionalmente) restaura os bare repos do LocalGitProvider a partir
# do arquivo que `brabo-backup` gera (ADR 0152).
#
# Irmão de `brabo-restore`, não continuação dele: aquele restaura o Postgres
# numa database NOVA e valida três coisas; este cuida do OUTRO volume que é
# fonte de verdade, `git_local_repos`. São dois artefatos e dois julgamentos, e
# juntá-los faria uma falha de git reprovar a validação do event log — e
# vice-versa, que é pior.
#
# ## Dois modos, e o de VERIFICAR é o default
#
#   brabo-restore-git              # verifica: baixa e LÊ o arquivo, não escreve
#   brabo-restore-git --restaurar  # extrai em GIT_REPOS_DIR
#
# O default é o não-destrutivo pela mesma razão que `brabo-restore` restaura numa
# database de teste: verificar é o que se faz toda semana, restaurar é o que se
# faz uma vez, num incidente ou numa migração, e o comando perigoso deve ser o
# que exige ser digitado.
#
# ## O que "verificado" quer dizer aqui
#
# Que o arquivo é um tar.gz LEGÍVEL DE PONTA A PONTA e que dentro dele há pelo
# menos um diretório `*.git` com `HEAD` e `objects/`. É o `pg_restore --list` do
# lado do git: um tar truncado tem tamanho > 0 e só se revela ao ser lido.
#
# O que NÃO quer dizer, e está escrito porque prometer a mais é o defeito que o
# ADR 0152 evita: nada aqui roda `git fsck` — a imagem não tem git, de propósito
# (ver Dockerfile.prod). Conectividade dos objetos não é verificada; o que se
# prova é integridade do CONTINENTE, não do conteúdo.
set -eu

: "${DATABASE_URL:?DATABASE_URL é obrigatória}"

# shellcheck source=docker/backup/lib.sh
. "${BRABO_BACKUP_LIB:-/usr/local/lib/brabo-backup-lib.sh}"
destino_preparar

PREFIXO="${RESTORE_GIT_PREFIX:-git-daily/}"
GIT_REPOS_DIR="${GIT_REPOS_DIR:-/data/git-repos}"
ARQUIVO=/tmp/restore-git.tar.gz

MODO=verificar
case "${1:-}" in
  --restaurar) MODO=restaurar ;;
  --verificar|"") ;;
  *) printf '[restore-git] uso: brabo-restore-git [--verificar|--restaurar]\n' >&2; exit 2 ;;
esac

log()   { printf '[restore-git] %s\n' "$*"; }
ok()    { printf '[restore-git]   \033[32mok\033[0m    %s\n' "$*"; }
falha() { printf '[restore-git]   \033[31mFALHA\033[0m %s\n' "$*"; }

limpar() { rc=$?; rm -f "${ARQUIVO}"; exit "${rc}"; }
trap limpar EXIT

# --- achar e baixar --------------------------------------------------------
destino_esperar \
  || { falha "destino inacessível ($(destino_descricao)): ${destino_saida}"; exit 1; }

OBJETO="$(destino_listar "${PREFIXO}" | sort -r | head -n 1)"
if [ -z "${OBJETO}" ]; then
  # AUSENTE não é o mesmo que corrompido, e os dois têm conserto diferente. Uma
  # instalação sem projeto de provider `local` legitimamente não tem este
  # arquivo; uma que tem projetos e não tem o arquivo perdeu cobertura. Quem
  # sabe distinguir é quem olha o `GIT_REPOS_DIR`, e é o que se faz aqui.
  if repos="$(git_repos_presentes "${GIT_REPOS_DIR}")" && [ -n "${repos}" ]; then
    falha "há $(echo "${repos}" | wc -l) bare repo(s) em ${GIT_REPOS_DIR} e NENHUM arquivo em ${PREFIXO} — este volume está sem backup"
    exit 1
  fi
  log "nenhum arquivo em ${PREFIXO} e nenhum bare repo em ${GIT_REPOS_DIR} — nada a restaurar"
  exit 0
fi

log "último arquivo: ${OBJETO}"
destino_baixar "${OBJETO}" "${ARQUIVO}" \
  || { falha "não foi possível baixar ${OBJETO}"; exit 1; }

# --- verificar -------------------------------------------------------------
conteudo="$(git_conteudo "${ARQUIVO}")" \
  || { falha "${OBJETO} não é um tar.gz íntegro"; exit 1; }

repos_no_arquivo="$(printf '%s\n' "${conteudo}" | sed -n 's|^\./\([^/]*\.git\)/HEAD$|\1|p' | sort -u)"
[ -n "${repos_no_arquivo}" ] \
  || { falha "${OBJETO} é legível mas não contém nenhum bare repo com HEAD"; exit 1; }

sem_objetos=""
for repo in ${repos_no_arquivo}; do
  printf '%s\n' "${conteudo}" | grep -q "^\./${repo}/objects/" \
    || sem_objetos="${sem_objetos} ${repo}"
done
[ -z "${sem_objetos}" ] \
  || { falha "bare repo(s) sem \`objects/\` no arquivo:${sem_objetos}"; exit 1; }

ok "$(printf '%s\n' "${repos_no_arquivo}" | wc -l) bare repo(s) íntegros em ${OBJETO} ($(wc -c < "${ARQUIVO}") bytes)"

if [ "${MODO}" = verificar ]; then
  log "modo VERIFICAR — nada foi escrito em ${GIT_REPOS_DIR}"
  exit 0
fi

# --- restaurar -------------------------------------------------------------
# Recusa por cima de conteúdo. Extrair um bare repo por cima de outro produz uma
# mistura de dois estados que nenhum `git` reclama e ninguém percebe até um
# `fetch` trazer história errada. O caso de uso real (migração, ADR 0152
# decisão 5) escreve num volume RECÉM-CRIADO, então a recusa não atrapalha o
# caminho que existe para atender.
if existentes="$(git_repos_presentes "${GIT_REPOS_DIR}")" && [ -n "${existentes}" ]; then
  if [ "${RESTORE_GIT_FORCE:-}" != "1" ]; then
    falha "${GIT_REPOS_DIR} já tem $(echo "${existentes}" | wc -l) bare repo(s).
       Restaurar por cima mistura dois estados sem erro nenhum. Esvazie o volume,
       ou passe RESTORE_GIT_FORCE=1 se a sobreposição for o que se quer."
    exit 1
  fi
  log "AVISO: RESTORE_GIT_FORCE=1 — extraindo por cima de conteúdo existente"
fi

# A recusa vem ANTES do `tar`, com o conserto nomeado. `git_local_repos` é
# compartilhado por três imagens com uids diferentes (api `node`, engine
# `engine`, esta uid 70): o volume nasce com o dono de quem o montou primeiro, e
# uid 70 lê mas não escreve. Descobrir isso no meio da extração deixa o destino
# pela metade e o diagnóstico apontando para o tar.
git_raiz_gravavel "${GIT_REPOS_DIR}" || {
  falha "${GIT_REPOS_DIR} não aceita escrita por este usuário (uid $(id -u)).
       O volume pertence à api/ao engine, que rodam com outro uid. Restaure como root:
         docker compose -f docker/docker-compose.prod.yml run --rm --user 0:0 backup brabo-restore-git --restaurar
       Os arquivos extraídos são devolvidos ao dono do diretório, nunca deixados como root."
  exit 1
}

git_restaurar "${ARQUIVO}" "${GIT_REPOS_DIR}" \
  || { falha "falha ao extrair em ${GIT_REPOS_DIR}"; exit 1; }

restaurados="$(git_repos_presentes "${GIT_REPOS_DIR}" || true)"
ok "$(printf '%s\n' "${restaurados}" | grep -c . ) bare repo(s) em ${GIT_REPOS_DIR}"
log "RESTAURADO — api e engine leem este volume no mesmo caminho, sem passo extra"
