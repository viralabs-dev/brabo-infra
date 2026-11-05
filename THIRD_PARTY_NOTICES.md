# Avisos de terceiros

O Brabo é [MIT](LICENSE). Este documento cobre o software de terceiros que
**viaja junto** com ele — e a distinção que importa é essa: dependência que
você instala não é a mesma coisa que binário que sai dentro de uma imagem que
você publica.

Levantado em **2026-07-27**, contra a `v0.1.0`. Os dados das seções 1 e 2 foram
extraídos **de dentro da imagem construída** (`brabo-engine:prod`), não de
documentação de projeto.

## O que é distribuição e o que não é

| categoria | é distribuição? | por quê |
|---|---|---|
| Dependências npm/hex | **Não**, hoje | são resolvidas na instalação, não redistribuídas por nós |
| **Conteúdo da imagem do engine** | **Sim, se a imagem for publicada** | o binário sai empacotado dentro dela |
| **Fontes do design system** | **Sim, se a imagem do web for publicada** | desde o ADR 0036 os `.woff2` são auto-hospedados e saem dentro da imagem |

As cinco imagens **são publicadas** no GHCR, públicas e por digest, a cada tag
final ([ADR 0119](docs/adr/0119-imagens-publicadas-no-ghcr-por-digest.md)). A
seção 1 **é obrigação**, não informativo — esta frase dizia o contrário desde
2026-07-27 e ficou para trás quando a publicação passou a acontecer de verdade.

---

## 1. Imagem do engine — copyleft

> **ATENÇÃO(humano):** revise esta seção **antes** de publicar
> `brabo-engine` em qualquer registry, público ou privado com terceiros.

Ferramentas instaladas deliberadamente, porque os gates de QA e SecOps
dependem delas. O [ADR 0021](docs/adr/0021-fechamento-4a-infra-e-painel.md)
registra que **sem hadolint o gate de infra aprova qualquer Dockerfile**, e o
[ADR 0020](docs/adr/0020-destravar-gates-qa-secops.md) que **sem gitleaks o
SecOps roda sem verificação de segredo** — por isso o build quebra se algum
faltar, em vez de degradar em silêncio.

| ferramenta | versão | licença | como entra |
|---|---|---|---|
| **yamllint** | 1.38.0 | **GPL-3.0-or-later** | `pip install` |
| **semgrep** | 1.183.0 | **LGPL-2.1-or-later** | `pip install` |
| **readline** | 8.2.10-r0 | **GPL-3.0-or-later** | apk (transitiva) |
| **gdbm** | 1.23-r1 | **GPL-3.0-or-later** | apk (transitiva) |
| hadolint | 2.12.0 | **GPL-3.0** | binário do release, sha256 conferido |
| gitleaks | 8.30.1 | MIT | binário do release, sha256 conferido |
| git | 2.45.4-r0 | GPL-2.0-only | apk |
| busybox, apk-tools, alpine-baselayout, scanelf, ssl_client | — | GPL-2.0-only | base Alpine |
| libgcc, libstdc++ | 13.2.1 | GPL-2.0-or-later **AND** LGPL-2.1-or-later | base Alpine |
| libidn2, libunistring | — | GPL-2.0-or-later **OR** LGPL-3.0-or-later | apk (transitiva) |
| xz-libs | 5.8.3-r0 | GPL-2.0-or-later AND 0BSD AND Public-Domain AND LGPL-2.1-or-later | apk (transitiva) |
| certifi, pathspec | — | MPL-2.0 | pip (transitiva do semgrep) |

### O que isso significa na prática

**Executar um binário GPL como processo separado não contamina a obra.** O
engine invoca `hadolint`, `gitleaks`, `semgrep` e `yamllint` por `exec`, sem
linkar contra nenhum deles. O código do Brabo continua MIT.

**Distribuir a imagem é outra coisa.** A GPL-3.0 e a GPL-2.0 exigem que quem
recebe o binário possa obter o código-fonte correspondente. Três caminhos
aceitos, do mais simples ao mais trabalhoso:

1. **Oferta escrita** apontando para o release upstream de cada ferramenta, com
   a versão exata — que é o que as tabelas acima já dão. É o caminho normal
   para quem só reempacota binários oficiais sem modificá-los.
2. **Não publicar a imagem** e distribuir só o Dockerfile, que baixa cada
   binário do upstream no build. **Deixou de ser a situação** com o ADR 0119.
3. **Separar os scanners** num sidecar próprio, deixando a imagem do engine
   livre de copyleft. Mais trabalho, e muda o desenho do deploy.

A LGPL-2.1 do semgrep e a MPL-2.0 do `certifi`/`pathspec` são copyleft **fraco**:
a obrigação alcança modificações naquelas bibliotecas, e nós não modificamos
nenhuma.

### O caminho tomado, e o que falta decidir

**O caminho 1 está EXERCITADO**: desde o PR que acrescentou esta seção, este
arquivo viaja **dentro** da imagem do engine, em
`/usr/share/doc/brabo/THIRD_PARTY_NOTICES.md`. A oferta escrita precisa
acompanhar o binário — quem faz `docker pull` não tem o repositório, e uma
oferta que só existe no GitHub não acompanha a cópia que a pessoa recebeu.
Confira com:

```bash
docker run --rm --entrypoint sh ghcr.io/daneiel/brabo-engine:<tag> \
  -c 'cat /usr/share/doc/brabo/THIRD_PARTY_NOTICES.md'
```

**Desde a AT-120, o mesmo arquivo viaja em TODO artefato publicado**, por
decisão do mantenedor: dentro das imagens `brabo-api`, `brabo-web`,
`brabo-broker` e `brabo-backup`, no mesmo caminho e na mesma forma da do engine
(troque o nome da imagem no comando acima), e junto dos binários do runner como
o asset `THIRD_PARTY_NOTICES.md` da Release, coberto pelo mesmo `checksums.txt`
assinado (RN-524). A decisão é conservadora: este repositório não afirma que
algum desses artefatos dispensa a oferta. Até a AT-120 o comando acima dava
"Permission denied" na imagem do engine: a pasta nascia sem permissão de
travessia para o usuário não-root da imagem, e agora nasce `0755` antes da
cópia.

> **TODO(humano):** o caminho 1 cobre a obrigação com o desenho atual, e é o
> que está no ar. O **caminho 3** (separar os scanners num sidecar, deixando a
> imagem do engine livre de copyleft) continua aberto como escolha de
> ARQUITETURA, não de conformidade — ele muda o desenho do deploy e por isso
> pede ADR. Nada obriga a tomá-lo; o que não se pode é publicar sem nenhum dos
> dois, que era o estado até aqui.
>
> Esta seção descreve o que o repositório FAZ. Ela não é parecer jurídico, e a
> validação da suficiência da oferta escrita para cada licença embutida segue
> sendo do mantenedor.

### Fonte destes dados

Reproduzível a qualquer momento:

```bash
docker run --rm --entrypoint sh brabo-engine:prod -c \
  'grep "^L:" /lib/apk/db/installed | sort | uniq -c | sort -rn'

docker run --rm --entrypoint sh brabo-engine:prod -c \
  'python3 -c "
import importlib.metadata as md
for d in md.distributions():
    print(d.metadata[\"Name\"], d.version, d.metadata.get(\"License-Expression\"))
"'
```

---

## 2. Imagem do engine — permissivas

**60 pacotes apk** e **72 pacotes Python**, agrupados por família de licença
(uma declaração composta como `MIT AND BSD-2-Clause AND GPL-2.0-or-later` conta
como copyleft):

| família | apk | Python |
|---|---|---|
| MIT | 18 | 32 |
| BSD | 3 | 17 |
| Apache-2.0 | 5 | 16 |
| X11 | 6 | — |
| PSF | 4 | 1 |
| ICU, Zlib, blessing, curl, bzip2 | 6 | — |
| **copyleft** (detalhado na seção 1) | **18** | **4** |
| não declarada | — | 2 (`face`, `peewee`) |
| | **60** | **72** |

> **TODO(humano):** `face 26.0.1` e `peewee 3.19.0` não declaram licença nos
> metadados. Ambos entram como transitivas do semgrep. Confirmar no upstream
> antes de publicar a imagem — o `peewee` é conhecidamente MIT, mas confirmação
> por metadado é o que vale numa auditoria.

## 3. Imagem de backup

`alpine:3.20` + `postgresql16-client` + `aws-cli`, tudo do apk. As mesmas
licenças de base Alpine da seção 1. O cliente MinIO (`mc`) **foi removido** na
Fase 5 — carregava 33 CVEs por ser um binário Go congelado desde setembro/2025
([ADR 0027](docs/adr/0027-fase5-backup-hardening-release.md), decisão 1b).

O **servidor** S3 do cluster local não entra aqui porque não é distribuído por
nós: o SeaweedFS (Apache-2.0) é puxado do Docker Hub pelo próprio cluster, só
no overlay local. Ele substituiu o MinIO (AGPL-3.0) quando a MinIO deixou de
publicar a imagem comunitária
([ADR 0169](docs/adr/0169-seaweedfs-no-lugar-do-minio-no-overlay-local.md)).

## 4. Dependências de aplicação

Não são redistribuídas por nós, mas registradas para auditoria.

**TypeScript — 263 pacotes de produção, todos permissivos:**
MIT 188 · Apache-2.0 46 · ISC 14 · BSD-3-Clause 12 · Unlicense 2 · 0BSD 1.
**Nenhuma copyleft.**

**Elixir — 57 dependências, todas permissivas:**
Apache-2.0 36 · MIT 17 · BSD-3-Clause 1 · BSD-2-Clause 1.
Extraídas de `deps/*/hex_metadata.config` — `mix hex.licenses` não existe como
task.

O CI reprova dependência com vulnerabilidade crítica (`pnpm audit` +
`mix hex.audit`), mas **não** verifica licença. Um pacote copyleft entrando
como transitiva passa sem aviso.

> **TODO(humano):** vale um gate de licença no CI (`license-checker` para npm)
> se o repositório for aberto. Hoje seria vigilância sem consumidor.

## 5. Fontes e ícones

O design system usa **Space Grotesk**, **Archivo** e **IBM Plex Mono**. Desde o
[ADR 0036](docs/adr/0036-login-fiel-ao-design-e-fontes-auto-hospedadas.md) elas
são **auto-hospedadas**: os `.woff2` estão versionados em
`apps/web/public/fonts/` e saem dentro da imagem do web.

Isto é a hipótese que a versão anterior desta seção previa — *"se um dia forem
servidas do próprio domínio"*. A razão não foi privacidade: a CSP do nginx
(`style-src 'self'`, `font-src 'self' data:`) **sempre** bloqueou o CDN, então em
produção as três nunca carregaram e caíam em fonte de sistema.

**A obrigação da OFL está ativa**, e é atendida por
`apps/web/public/fonts/LICENSE.txt`, que carrega o texto integral da licença e os
três avisos de copyright, e é servido publicamente ao lado dos arquivos:

| família | copyright | licença |
|---|---|---|
| Space Grotesk | 2020 The Space Grotesk Project Authors | OFL-1.1 |
| Archivo | 2020 The Archivo Project Authors | OFL-1.1 |
| IBM Plex Mono | © 2017 IBM Corp., Reserved Font Name "Plex" | OFL-1.1 |

Subsets `latin` e `latin-ext`, em woff2, obtidos da API do Google Fonts. **Nenhum
glifo foi modificado** — o que mantém o uso fora da cláusula de Reserved Font
Name do IBM Plex.

Fora das fontes, nenhum código de terceiro vendorizado foi encontrado no
repositório.
