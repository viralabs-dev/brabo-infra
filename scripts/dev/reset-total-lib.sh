# shellcheck shell=bash
# Funções do reset-total.sh que decidem se ele pode COMEÇAR a destruir, em
# arquivo próprio para o spec (scripts/dev/reset-total.spec.ts) exercitá-las
# com `docker`/`mix`/`pnpm` de mentira no PATH — rodar o script de verdade
# derrubaria o ambiente de quem roda a suíte. Não é executável sozinho: quem o
# carrega é o reset-total.sh, que define COMPOSE e valor_do_env antes.
#
# A régua das duas (AT-203): tudo o que pode reprovar por um motivo do HOST ou
# de um VOLUME, e que o script só descobriria DEPOIS do `DROP SCHEMA`, é
# perguntado ANTES do primeiro efeito. Medido em 2026-09-26: com o mint 1.10.1
# novo no `mix.lock` (#613), `pnpm engine:migrate` morreu com `lock mismatch`
# com o banco já apagado, e a mensagem mandava rodar o script de novo — o que
# falha igual. Na mesma rodada, o `up --wait` reprovou com
# `container brabo-neo4j-1 is unhealthy` e o script disse só "RESET
# INCOMPLETO".

# As migrations e o seed rodam no HOST: `mix ecto.migrate` com o `deps`/`_build`
# de `apps/engine` do checkout (NÃO os volumes do container do engine), e
# `drizzle-kit`/`ts-node` com o `node_modules` do checkout. Nada do que o
# `build` das imagens faz os atualiza. `mix deps.get` alinha as dependências ao
# `mix.lock` (é o que faltava) e `mix compile` prova que o engine compila no
# MESMO ambiente em que `engine:migrate` vai rodar (MIX_ENV de sempre, `dev`).
# Não mexe em banco: nenhuma das três chamadas abre conexão.
preparar_host_para_migrar() {
  if ! command -v mix >/dev/null 2>&1; then
    echo "RECUSADO antes de qualquer efeito: \`mix\` não está no PATH do host, e \`pnpm engine:migrate\` roda no host. Nada foi parado nem apagado." >&2
    return 1
  fi
  echo "==> alinhando as dependências do engine ao mix.lock no host (mix deps.get)…"
  if ! (cd apps/engine && mix deps.get); then
    echo "RECUSADO antes de qualquer efeito: \`mix deps.get\` falhou em apps/engine (rede? hex?). Nada foi parado nem apagado." >&2
    return 1
  fi
  echo "==> conferindo que o engine compila no host (mix compile)…"
  if ! (cd apps/engine && mix compile); then
    echo "RECUSADO antes de qualquer efeito: o engine NÃO compila no host, e \`pnpm engine:migrate\` roda no host — o reset morreria depois do DROP SCHEMA. Corrija a compilação (cd apps/engine && mix compile) e rode de novo. Nada foi parado nem apagado." >&2
    return 1
  fi
  echo "==> conferindo drizzle-kit e ts-node no node_modules do host…"
  if ! pnpm --filter api exec drizzle-kit --version >/dev/null 2>&1 \
      || ! pnpm --filter api exec ts-node --version >/dev/null 2>&1; then
    echo "RECUSADO antes de qualquer efeito: \`drizzle-kit\` ou \`ts-node\` não resolvem no node_modules do host (\`pnpm db:migrate\` e o seed rodam no host). Rode \`pnpm install --frozen-lockfile\` e tente de novo. Nada foi parado nem apagado." >&2
    return 1
  fi
}

# O Neo4j grava a senha no VOLUME (`neo4j_data`) quando ele é CRIADO e ignora
# `NEO4J_AUTH` em toda subida seguinte. Trocar `NEO4J_PASSWORD` no `.env` (ou
# ter o volume de uma época em que o `.env` dizia outra) deixa o healthcheck —
# que usa a senha do `.env` — recusado para sempre: `The client is unauthorized
# due to authentication failure`, e o `up --wait` reprova. Medido em
# 2026-09-26: `brabo_neo4j_data` criado em 13/09, container recriado em 26/09
# com a senha default, healthcheck recusado.
#
# Este script NÃO apaga o volume (AT-181), então o que ele pode fazer é DIZER,
# com o conserto. A frase é uma só para os dois momentos em que ele descobre.
explicar_senha_do_neo4j() {
  cat >&2 <<'EOF'
O NEO4J RECUSA A SENHA DO .env: o volume `neo4j_data` do compose guarda a senha
de quando foi CRIADO — o Neo4j só aplica NEO4J_AUTH na criação do volume — e o
healthcheck usa a do .env (NEO4J_USER/NEO4J_PASSWORD, ou o default do compose).
Este script não apaga volume. Consertos, escolha um:
  - volte NEO4J_PASSWORD no .env para a senha com que o volume foi criado; ou
  - troque a senha DENTRO do Neo4j, com a antiga:
      docker compose -f docker/docker-compose.yml --env-file .env exec neo4j \
        cypher-shell -u neo4j -p '<senha antiga>' -d system \
        "ALTER CURRENT USER SET PASSWORD FROM '<senha antiga>' TO '<senha do .env>'"
  - ou, se o grafo pode ser perdido (ele é DERIVADO do event log, e
    `pnpm --filter api grafo:reprojetar` o refaz), apague o volume você mesmo.
EOF
}

# O id do container do serviço neo4j DESTA stack, ou nada se ele não existe.
container_do_neo4j() {
  "${COMPOSE[@]}" ps -a -q neo4j 2>/dev/null | head -n1
}

# O healthcheck do container diz, em texto, POR QUE está recusado — é a mesma
# pergunta que o `up --wait` fez, lida do registro dele, sem gastar uma
# tentativa de login a mais (o Neo4j conta tentativas erradas).
neo4j_recusa_a_senha() {
  local id="$1"
  [[ -n "${id}" ]] || return 1
  docker inspect -f '{{if .State.Health}}{{range .State.Health.Log}}{{.Output}}{{end}}{{end}}' "${id}" 2>/dev/null \
    | grep -qi 'unauthorized due to authentication failure'
}

# Antes do primeiro efeito. Duas formas de saber que o `up --wait` vai reprovar:
# (1) o container de pé JÁ está recusando a senha; (2) ele está saudável com a
# senha com que foi criado, mas o .env agora diz outra — o `up` o recriaria com
# a nova, contra um volume que só aceita a velha. A comparação é feita sem
# imprimir nenhuma das duas. Sem container, não há como saber: diz isso e segue
# (o `ao_sair` ainda nomeia a causa se o `up` reprovar por ela).
conferir_senha_do_neo4j() {
  local id esperado atual
  id="$(container_do_neo4j)"
  if [[ -z "${id}" ]]; then
    echo "==> neo4j: sem container desta stack; a senha do volume não pode ser conferida antes do up."
    return 0
  fi
  if neo4j_recusa_a_senha "${id}"; then
    echo "RECUSADO antes de qualquer efeito: nada foi parado nem apagado." >&2
    explicar_senha_do_neo4j
    return 1
  fi
  # Mesma precedência da interpolação do Compose: ambiente do shell, depois o
  # .env, depois o default escrito no docker-compose.yml.
  esperado="${NEO4J_USER:-$(valor_do_env NEO4J_USER neo4j)}/${NEO4J_PASSWORD:-$(valor_do_env NEO4J_PASSWORD dev-neo4j-password-change-me)}"
  atual="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "${id}" 2>/dev/null \
    | grep -E '^NEO4J_AUTH=' | head -n1 | cut -d '=' -f2- || true)"
  if [[ -n "${atual}" && "${atual}" != "${esperado}" ]]; then
    echo "RECUSADO antes de qualquer efeito: o container neo4j foi criado com OUTRA credencial que a do .env, e o up o recriaria contra um volume que só aceita a antiga. Nada foi parado nem apagado." >&2
    explicar_senha_do_neo4j
    return 1
  fi
}
