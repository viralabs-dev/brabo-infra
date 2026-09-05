# Definição das quatro imagens de produção para `docker buildx bake`.
#
# POR QUE BAKE E NÃO QUATRO STEPS. Em sequência, os builds somavam ~6 dos 8
# minutos do job (api 130s, engine 160s, web 49s, backup 20s). Bake dispara os
# alvos em PARALELO num único builder, o que mantém a propriedade que o job já
# dependia: as quatro imagens ficam no mesmo daemon, disponíveis pro scan e pro
# smoke sem passar 1,3 GB entre jobs por artifact.
#
# Paralelizar por matriz de jobs faria o contrário — cada job teria seu daemon,
# e o custo de upload/download das imagens comeria o ganho.
#
# ISSO FOI MEDIDO DE VERDADE DUAS VEZES, com DOIS mecanismos de transporte
# diferentes, e as duas rejeitaram o split. A primeira vez foi raciocínio
# sobre artifact genérico (`actions/upload-artifact`, ~1,7 GB). A segunda
# (PR #497, revertido) testou GHCR — que usa as variáveis `REGISTRY`/`OUTPUT`
# deste arquivo, `type=registry` empurrando direto do builder — e mediu
# push 44–51s / pull 21–25s (round-trip 65–76s) num job de build separado dos
# de scan/smoke. Não foi o transporte que reprovou desta vez (GHCR é rápido);
# foi a ESTRUTURA: o job de smoke+e2e precisa das QUATRO imagens de qualquer
# jeito, então o split nunca evita pagar o pull inteiro, e o único trabalho
# que sairia do caminho crítico (o Trivy, ~15–21s) vale menos que o
# round-trip que passaria a custar. Ver o comentário do job `images` em
# `ci.yml` para o achado de segurança encontrado no caminho (pacote novo no
# GHCR nasce público por padrão neste repositório).
#
# O ganho não é linear: o runner tem 2 vCPUs e `pnpm install`, `mix deps.get`,
# `pip install` e `apk add` competem por CPU. O que se ganha de verdade é a
# sobreposição das esperas de rede, que são boa parte de cada build.
#
# Fica na RAIZ, não em docker/, por dois motivos: é onde o buildx procura por
# convenção, e o contexto de build é a raiz (o monorepo pnpm precisa do lockfile
# e de packages/shared). Um bake em docker/ precisaria de `context = ".."`, que
# exige `--allow=fs.read=..` em toda invocação.

variable "TAG" {
  default = "prod"
}

# Segunda tag, opcional. Existe para o `release.yml`, que precisa de DUAS por
# imagem: a versão (legível, é o que se cita numa conversa) e o SHA do commit
# (imutável, identifica o build mesmo quando uma tag é movida).
#
# Vazia por padrão para o `ci.yml` não ganhar tag de enfeite. Cada alvo resolve
# a lista com um ternário — repetido nos quatro em vez de escondido numa função,
# porque quatro linhas explícitas se leem melhor que uma indireção.
variable "TAG_EXTRA" {
  default = ""
}

# Versão do ARTEFATO, assada nas imagens da api e do web (ADR 0036).
#
# Separada de `TAG` de propósito, apesar de o `release.yml` passar o mesmo valor
# para as duas. `TAG` é o nome com que a imagem é referenciada e o `ci.yml` a põe
# em "prod"; se a versão viesse dela, o rodapé da web mostraria "prod" e todo span
# da api sairia com `service.version=prod` — que não é versão de nada. Com
# variável própria, quem não é release fica em "dev", que é a verdade.
variable "VERSION" {
  default = "dev"
}
# Prefixo de registry, COM a barra final quando presente:
# `ghcr.io/daneiel/`. Vazio por padrão de propósito — o `ci.yml` constrói para
# o daemon local e compara nomes curtos (`brabo-api:prod`) no scan e no smoke;
# quem publica é só o `release.yml` (ADR 0119).
#
# A barra vem NO VALOR e não numa interpolação condicional porque HCL não tem
# ternário aninhado legível para isso, e um prefixo vazio precisa produzir
# exatamente o nome antigo — qualquer separador fixo aqui quebraria o `ci.yml`.
variable "REGISTRY" {
  default = ""
}

# Destino do build. `type=docker` carrega no daemon local (o que o `ci.yml`
# precisa para escanear e rodar o smoke); o `release.yml` troca para
# `type=registry`, que EMPURRA e é o único modo em que o bake devolve
# `containerimage.digest` no metadata — o digest não existe antes do push.
variable "OUTPUT" {
  default = "type=docker"
}

# `docker buildx bake` sem alvo constrói este grupo.
group "default" {
  targets = ["api", "engine", "web", "backup"]
}

# Cache do GitHub Actions com escopo POR IMAGEM. Escopo único faria os quatro
# builds disputarem a mesma chave e se invalidarem entre si.
target "_comum" {
  context = "."
  output  = [OUTPUT]
}

target "api" {
  inherits   = ["_comum"]
  dockerfile = "docker/api/Dockerfile.prod"
  tags       = TAG_EXTRA == "" ? ["${REGISTRY}brabo-api:${TAG}"] : ["${REGISTRY}brabo-api:${TAG}", "${REGISTRY}brabo-api:${TAG_EXTRA}"]
  args       = { BRABO_VERSION = VERSION }
  cache-from = ["type=gha,scope=api"]
  cache-to   = ["type=gha,scope=api,mode=max"]
}

target "engine" {
  inherits   = ["_comum"]
  dockerfile = "docker/engine/Dockerfile.prod"
  tags       = TAG_EXTRA == "" ? ["${REGISTRY}brabo-engine:${TAG}"] : ["${REGISTRY}brabo-engine:${TAG}", "${REGISTRY}brabo-engine:${TAG_EXTRA}"]
  cache-from = ["type=gha,scope=engine"]
  cache-to   = ["type=gha,scope=engine,mode=max"]
}

target "web" {
  inherits   = ["_comum"]
  dockerfile = "docker/web/Dockerfile.prod"
  tags       = TAG_EXTRA == "" ? ["${REGISTRY}brabo-web:${TAG}"] : ["${REGISTRY}brabo-web:${TAG}", "${REGISTRY}brabo-web:${TAG_EXTRA}"]
  args       = { VITE_BRABO_VERSION = VERSION }
  cache-from = ["type=gha,scope=web"]
  cache-to   = ["type=gha,scope=web,mode=max"]
}

# Quarta imagem (Fase 5, item 6). Entra nos MESMOS gates das outras três:
# non-root, trivy e hadolint. Ela carrega credencial de leitura do banco
# inteiro — é a última que deveria ficar de fora do scan.
target "backup" {
  inherits   = ["_comum"]
  dockerfile = "docker/backup/Dockerfile.prod"
  tags       = TAG_EXTRA == "" ? ["${REGISTRY}brabo-backup:${TAG}"] : ["${REGISTRY}brabo-backup:${TAG}", "${REGISTRY}brabo-backup:${TAG_EXTRA}"]
  cache-from = ["type=gha,scope=backup"]
  cache-to   = ["type=gha,scope=backup,mode=max"]
}
