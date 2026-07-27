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

# `docker buildx bake` sem alvo constrói este grupo.
group "default" {
  targets = ["api", "engine", "web", "backup"]
}

# Cache do GitHub Actions com escopo POR IMAGEM. Escopo único faria os quatro
# builds disputarem a mesma chave e se invalidarem entre si.
target "_comum" {
  context = "."
  output  = ["type=docker"]
}

target "api" {
  inherits   = ["_comum"]
  dockerfile = "docker/api/Dockerfile.prod"
  tags       = ["brabo-api:${TAG}"]
  cache-from = ["type=gha,scope=api"]
  cache-to   = ["type=gha,scope=api,mode=max"]
}

target "engine" {
  inherits   = ["_comum"]
  dockerfile = "docker/engine/Dockerfile.prod"
  tags       = ["brabo-engine:${TAG}"]
  cache-from = ["type=gha,scope=engine"]
  cache-to   = ["type=gha,scope=engine,mode=max"]
}

target "web" {
  inherits   = ["_comum"]
  dockerfile = "docker/web/Dockerfile.prod"
  tags       = ["brabo-web:${TAG}"]
  cache-from = ["type=gha,scope=web"]
  cache-to   = ["type=gha,scope=web,mode=max"]
}

# Quarta imagem (Fase 5, item 6). Entra nos MESMOS gates das outras três:
# non-root, trivy e hadolint. Ela carrega credencial de leitura do banco
# inteiro — é a última que deveria ficar de fora do scan.
target "backup" {
  inherits   = ["_comum"]
  dockerfile = "docker/backup/Dockerfile.prod"
  tags       = ["brabo-backup:${TAG}"]
  cache-from = ["type=gha,scope=backup"]
  cache-to   = ["type=gha,scope=backup,mode=max"]
}
