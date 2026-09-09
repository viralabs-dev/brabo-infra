#!/bin/sh
# Biblioteca compartilhada por `brabo-backup`, `brabo-restore` e
# `brabo-restore-git` (ADR 0152).
#
# Existe por DOIS motivos, e nenhum deles é "evitar repetição":
#
#   1. o destino passou a ter duas implementações (disco e S3), e um backup que
#      escreve num destino que o restore não sabe ler é backup nenhum. As duas
#      pontas usam a MESMA função — divergir seria possível se cada script
#      tivesse a sua;
#   2. as funções ficam invocáveis fora de container, e é isso que torna o
#      caminho testável sem Docker (`scripts/ci/backup-lib.spec.ts` roda estas
#      funções num `sh` de verdade, contra um diretório de verdade).
#
# NÃO contém julgamento nenhum sobre o conteúdo do backup: as três validações do
# restore (lista de tabelas, contagem das críticas na janela, continuidade da
# `seq`) continuam onde sempre estiveram, em `restore.sh`. O ADR 0152 é
# explícito: o que muda é o invólucro, não o julgamento.

# --- destino ---------------------------------------------------------------
# `BACKUP_DIR` definida => destino em DISCO. Ausente => destino S3, exatamente
# como antes deste ADR.
#
# A inferência (em vez de uma variável `BACKUP_DEST` obrigatória) é deliberada:
# o CronJob do k8s passa só as cinco variáveis de S3, e esta sessão não o toca.
# Um destino explícito e obrigatório quebraria aquele caminho no dia do deploy,
# não no dia do commit.
destino_tipo() {
  if [ -n "${BACKUP_DIR:-}" ]; then echo local; else echo s3; fi
}

destino_descricao() {
  if [ "$(destino_tipo)" = local ]; then
    echo "disco em ${BACKUP_DIR}"
  else
    echo "${BACKUP_S3_ENDPOINT:-<sem endpoint>}/${BACKUP_S3_BUCKET:-<sem bucket>}"
  fi
}

# Exporta a credencial do aws-cli pelo AMBIENTE — nada em disco, nada em linha
# de comando (que `ps` mostraria). No destino local não há credencial nenhuma, e
# é isso que torna a instalação de máquina única possível sem bucket.
destino_preparar() {
  if [ "$(destino_tipo)" = local ]; then
    return 0
  fi
  : "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT é obrigatória quando BACKUP_DIR não está definida}"
  : "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET é obrigatória quando BACKUP_DIR não está definida}"
  : "${BACKUP_S3_ACCESS_KEY:?BACKUP_S3_ACCESS_KEY é obrigatória quando BACKUP_DIR não está definida}"
  : "${BACKUP_S3_SECRET_KEY:?BACKUP_S3_SECRET_KEY é obrigatória quando BACKUP_DIR não está definida}"
  AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY}"
  AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY}"
  AWS_ENDPOINT_URL="${BACKUP_S3_ENDPOINT}"
  AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-us-east-1}"
  BUCKET="s3://${BACKUP_S3_BUCKET}"
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_ENDPOINT_URL AWS_DEFAULT_REGION
}

# Prova que o destino ACEITA ESCRITA, não só que existe. Um diretório que existe
# e é read-only aceitaria `ls` e recusaria o dump — e o erro apareceria só
# depois do `pg_dump`, com o diagnóstico apontando para o lugar errado.
#
# Ecoa o motivo em `destino_saida` (variável, não stdout) para o chamador
# compor a mensagem, do mesmo jeito que o `esperar_destino` original fazia.
destino_esperar() {
  destino_saida=""
  if [ "$(destino_tipo)" = local ]; then
    if ! mkdir -p "${BACKUP_DIR}" 2>/dev/null; then
      destino_saida="não foi possível criar ${BACKUP_DIR}"
      return 1
    fi
    # `touch` e NÃO `: > arquivo`: em POSIX, erro de redirecionamento num
    # builtin ESPECIAL (`:` é um) derruba a shell inteira, mesmo dentro de `if`
    # e mesmo com `2>/dev/null` — medido, o teste do destino read-only morria
    # aqui em vez de reprovar com a mensagem. `touch` é comando externo e o
    # status volta normalmente.
    sentinela="${BACKUP_DIR}/.brabo-escrita-$$"
    if ! touch "${sentinela}" 2>/dev/null; then
      destino_saida="${BACKUP_DIR} existe mas não aceita escrita"
      return 1
    fi
    rm -f "${sentinela}"
    return 0
  fi

  # No S3, a espera com retentativa continua sendo necessária pelas duas razões
  # que o backup.sh já documentava: a NetworkPolicy do k3s programada depois de
  # o pod ganhar IP, e a indisponibilidade transitória de object storage.
  tentativa=1
  while [ "${tentativa}" -le "${BACKUP_S3_RETRIES:-10}" ]; do
    if destino_saida="$(aws s3 ls "${BUCKET}/" 2>&1)"; then
      [ "${tentativa}" -gt 1 ] && echo "[destino] disponível na tentativa ${tentativa}" >&2
      return 0
    fi
    echo "[destino] indisponível (tentativa ${tentativa}): ${destino_saida}" >&2
    tentativa=$((tentativa + 1))
    sleep 3
  done
  return 1
}

# stdin -> objeto. No disco a escrita é em nome PARCIAL seguida de `mv`: um
# processo morto no meio deixa `.parcial`, nunca um backup de tamanho plausível
# e conteúdo truncado — que é o modo de falha que a checagem de tamanho não pega.
destino_enviar() {
  chave="$1"
  if [ "$(destino_tipo)" = local ]; then
    alvo="${BACKUP_DIR}/${chave}"
    mkdir -p "$(dirname "${alvo}")" || return 1
    cat > "${alvo}.parcial" || { rm -f "${alvo}.parcial"; return 1; }
    mv "${alvo}.parcial" "${alvo}"
    return 0
  fi
  aws s3 cp - "${BUCKET}/${chave}" --quiet
}

destino_baixar() {
  chave="$1"; arquivo="$2"
  if [ "$(destino_tipo)" = local ]; then
    [ -f "${BACKUP_DIR}/${chave}" ] || return 1
    cp "${BACKUP_DIR}/${chave}" "${arquivo}"
    return 0
  fi
  aws s3 cp "${BUCKET}/${chave}" "${arquivo}" --quiet
}

# Ecoa o tamanho em bytes, ou 0. O 0 é o sinal que o chamador transforma em
# falha — objeto vazio é dump que não chegou.
destino_tamanho() {
  chave="$1"
  if [ "$(destino_tipo)" = local ]; then
    if [ -f "${BACKUP_DIR}/${chave}" ]; then wc -c < "${BACKUP_DIR}/${chave}" | tr -d ' '; else echo 0; fi
    return 0
  fi
  aws s3api head-object --bucket "${BACKUP_S3_BUCKET}" --key "${chave}" \
    --query ContentLength --output text 2>/dev/null || echo 0
}

destino_copiar() {
  origem="$1"; alvo="$2"
  if [ "$(destino_tipo)" = local ]; then
    mkdir -p "$(dirname "${BACKUP_DIR}/${alvo}")" || return 1
    cp "${BACKUP_DIR}/${origem}" "${BACKUP_DIR}/${alvo}.parcial" || return 1
    mv "${BACKUP_DIR}/${alvo}.parcial" "${BACKUP_DIR}/${alvo}"
    return 0
  fi
  aws s3 cp "${BUCKET}/${origem}" "${BUCKET}/${alvo}" --quiet
}

# Uma chave por linha, sem ordenação garantida — quem ordena é o chamador, e
# ordem lexicográfica é ordem cronológica porque o nome carrega o timestamp ISO.
destino_listar() {
  prefixo="$1"
  if [ "$(destino_tipo)" = local ]; then
    raiz="${BACKUP_DIR%/}"
    [ -d "${raiz}/${prefixo}" ] || return 0
    find "${raiz}/${prefixo}" -type f -name '*.parcial' -prune -o -type f -print 2>/dev/null \
      | sed "s|^${raiz}/||"
    return 0
  fi
  aws s3api list-objects-v2 --bucket "${BACKUP_S3_BUCKET}" --prefix "${prefixo}" \
    --query 'Contents[].Key' --output text 2>/dev/null \
    | tr '\t' '\n' | grep -v '^None$'
}

destino_remover() {
  chave="$1"
  if [ "$(destino_tipo)" = local ]; then
    rm -f "${BACKUP_DIR}/${chave}"
    return 0
  fi
  aws s3 rm "${BUCKET}/${chave}" --quiet
}

# --- os bare repos do LocalGitProvider -------------------------------------
# O achado do ADR 0152: `git_local_repos` é FONTE DE VERDADE e nenhum backup o
# cobria. Um projeto com provider `local` guarda o repositório *bare* ali; o
# event log guarda a narrativa, não os objetos do git, então perder o volume é
# perder o código que os agentes produziram.
#
# ## A garantia que este código DÁ
#
# Consistência POR REFERÊNCIA, não por instante. O git escreve os objetos ANTES
# de mover a ref, e a ref é trocada por rename atômico (ou por reescrita de
# `packed-refs` sob lock, também com rename). Um `tar` que passa no meio de um
# `git push` captura a ref no valor VELHO ou no NOVO, nunca num valor pela
# metade — e, no caso do novo, os objetos alcançáveis por ele já estão em disco.
#
# ## A garantia que este código NÃO DÁ
#
#   * NÃO há instante global: o `tar` percorre a árvore ao longo de um período,
#     então dois repositórios (ou duas refs do mesmo repositório) podem vir de
#     instantes diferentes. Para o git isso é irrelevante — cada ref é válida;
#     para quem lê "backup das 03:17" não é, e por isso está escrito aqui;
#   * NÃO há quiesce: nada suspende escrita. Um `git gc` concorrente pode
#     apagar um packfile entre o `tar` listar o diretório e lê-lo.
#
# Esse segundo caso é DETECTADO e vira falha, nunca backup silenciosamente
# parcial: o status do `tar` é capturado num arquivo (o `set -o pipefail` não
# existe em POSIX sh, e num cano o status é o do ÚLTIMO comando) e conferido
# pelo chamador. Um arquivo incompleto que se anuncia como bom é pior do que uma
# execução falha, que ao menos vira linha `failed` em `backup_runs` e alerta.
#
# `*.lock` fica de FORA. Restaurar um lock órfão produziria um repositório em
# que todo `git` recusa operar, com uma mensagem que não menciona backup nenhum.
GIT_EXCLUSOES="--exclude=*.lock --exclude=objects/tmp_* --exclude=*.tmp"

# Ecoa os bare repos encontrados, um por linha (só o nome). Ausência de
# diretório e ausência de repositório são coisas DIFERENTES, e quem chama
# precisa distinguir: no k8s o volume nem é montado (pular é correto), no
# compose ele é (pular seria falso verde).
git_repos_presentes() {
  raiz="$1"
  [ -d "${raiz}" ] || return 1
  find "${raiz}" -maxdepth 1 -mindepth 1 -type d -name '*.git' 2>/dev/null \
    | sed "s|^${raiz%/}/||" | sort
}

# tar.gz dos bare repos para STDOUT. Grava o status do `tar` em $2, porque num
# cano o `$?` é o do último comando e um tar morto no meio passaria despercebido.
git_arquivar() {
  raiz="$1"; arquivo_status="$2"
  # shellcheck disable=SC2086
  { tar -C "${raiz}" ${GIT_EXCLUSOES} -czf - . 2>/dev/null; echo $? > "${arquivo_status}"; }
}

# Lista o conteúdo do arquivo — é o `pg_restore --list` do lado do git: um
# tar truncado tem tamanho > 0 e só se revela ao ser lido.
git_conteudo() {
  tar -tzf "$1" 2>/dev/null
}

# Extrai por cima da raiz indicada. NÃO apaga o que já está lá: o restore de
# uma migração escreve num volume recém-criado, e sobrescrever um volume com
# conteúdo é decisão de quem opera, não default de script.
#
# ## O dono, que foi medido rodando e não presumido lendo
#
# `git_local_repos` é COMPARTILHADO por três imagens com uids DIFERENTES: a api
# roda como `node`, o engine como `engine`, e esta imagem como uid 70 (o
# `postgres` que o `postgresql16-client` cria). O volume nasce com o dono do
# caminho na imagem que o montar primeiro — na prática, o da api —, com modo
# 0755. Ler dali como uid 70 funciona; ESCREVER não, e a primeira execução real
# do restore morreu exatamente assim (`tar: can't make dir ./exp001.git:
# Permission denied`).
#
# Daí as duas metades abaixo, e nenhuma delas inventa privilégio:
#
#   * quem escreve tem que poder escrever. O chamador confere ANTES e recusa
#     nomeando o conserto (`--user 0:0`), em vez de deixar o `tar` cuspir
#     permissão negada por arquivo;
#   * quando quem escreve É root, o que sai da extração é entregue ao dono do
#     DIRETÓRIO — nunca a root. Sem isso o volume voltaria íntegro e inútil: a
#     api e o engine, non-root, não conseguiriam escrever no que restauramos, e
#     o sintoma apareceria muito depois do restore, sem menção a ele.
#
# O dono é LIDO do diretório, nunca escrito à mão: um número fixo aqui erraria
# na próxima imagem que mudar de usuário, em silêncio.
git_restaurar() {
  arquivo="$1"; raiz="$2"
  mkdir -p "${raiz}" || return 1
  dono="$(stat -c '%u:%g' "${raiz}" 2>/dev/null || echo '')"
  tar -C "${raiz}" -xzf "${arquivo}" || return 1
  if [ "$(id -u)" = "0" ] && [ -n "${dono}" ] && [ "${dono}" != "0:0" ]; then
    chown -R "${dono}" "${raiz}"
  fi
}

# O diretório aceita escrita por QUEM está rodando? Mesma pergunta que
# `destino_esperar` faz do destino, pelo mesmo motivo: "existe" e "dá para
# escrever" são coisas diferentes, e descobrir a segunda no meio do `tar` produz
# um destino meio escrito.
git_raiz_gravavel() {
  raiz="$1"
  mkdir -p "${raiz}" 2>/dev/null || return 1
  sentinela="${raiz}/.brabo-escrita-$$"
  touch "${sentinela}" 2>/dev/null || return 1
  rm -f "${sentinela}"
}
