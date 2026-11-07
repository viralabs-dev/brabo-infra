# Third-party notices

Brabo is [MIT](LICENSE). This document covers the third-party software that
**ships together** with it — and the distinction that matters here is this: a
dependency you install is not the same thing as a binary that goes inside an
image you publish.

Surveyed on **2026-07-27**, against `v0.1.0`. The data in sections 1 and 2 was
extracted **from inside the built image** (`brabo-engine:prod`), not from
project documentation.

## What is distribution and what is not

| category | is it distribution? | why |
|---|---|---|
| npm/hex dependencies | **No**, today | they are resolved at install time, not redistributed by us |
| **Contents of the engine image** | **Yes, if the image is published** | the binary ships packaged inside it |
| **Design system fonts** | **Yes, if the web image is published** | since ADR 0036 the `.woff2` files are self-hosted and ship inside the image |

The five images **are published** to GHCR, publicly and by digest, at every
final tag ([ADR 0119](docs/adr/0119-imagens-publicadas-no-ghcr-por-digest.md)).
Section 1 **is an obligation**, not informational — this sentence said the
opposite since 2026-07-27 and was left behind when publishing actually started
happening.

---

## 1. Engine image — copyleft

> **TODO(humano):** review this section **before** publishing
> `brabo-engine` to any registry, public or private with third parties.

Tools installed deliberately, because the QA and SecOps gates depend on them.
[ADR 0021](docs/adr/0021-fechamento-4a-infra-e-painel.md) records that **without
hadolint the infra gate approves any Dockerfile**, and
[ADR 0020](docs/adr/0020-destravar-gates-qa-secops.md) that **without gitleaks
SecOps runs with no secret verification** — which is why the build fails if any
of them is missing, instead of degrading silently.

| tool | version | license | how it gets in |
|---|---|---|---|
| **yamllint** | 1.38.0 | **GPL-3.0-or-later** | `pip install` |
| **semgrep** | 1.183.0 | **LGPL-2.1-or-later** | `pip install` |
| **readline** | 8.2.10-r0 | **GPL-3.0-or-later** | apk (transitive) |
| **gdbm** | 1.23-r1 | **GPL-3.0-or-later** | apk (transitive) |
| hadolint | 2.12.0 | **GPL-3.0** | release binary, sha256 checked |
| gitleaks | 8.30.1 | MIT | release binary, sha256 checked |
| git | 2.45.4-r0 | GPL-2.0-only | apk |
| busybox, apk-tools, alpine-baselayout, scanelf, ssl_client | — | GPL-2.0-only | Alpine base |
| libgcc, libstdc++ | 13.2.1 | GPL-2.0-or-later **AND** LGPL-2.1-or-later | Alpine base |
| libidn2, libunistring | — | GPL-2.0-or-later **OR** LGPL-3.0-or-later | apk (transitive) |
| xz-libs | 5.8.3-r0 | GPL-2.0-or-later AND 0BSD AND Public-Domain AND LGPL-2.1-or-later | apk (transitive) |
| certifi, pathspec | — | MPL-2.0 | pip (transitive from semgrep) |

### What this means in practice

**Running a GPL binary as a separate process does not taint the work.** The
engine invokes `hadolint`, `gitleaks`, `semgrep` and `yamllint` via `exec`,
without linking against any of them. The Brabo code remains MIT.

**Distributing the image is a different matter.** GPL-3.0 and GPL-2.0 require
that whoever receives the binary can obtain the corresponding source code. Three
accepted routes, from simplest to most laborious:

1. **Written offer** pointing to each tool's upstream release, with the exact
   version — which is what the tables above already give. This is the normal
   route for someone who only repackages official binaries without modifying
   them.
2. **Not publishing the image** and distributing only the Dockerfile, which
   downloads each binary from upstream at build time. **This is no longer the
   situation** with ADR 0119.
3. **Splitting the scanners** into their own sidecar, leaving the engine image
   free of copyleft. More work, and it changes the deploy design.

The LGPL-2.1 of semgrep and the MPL-2.0 of `certifi`/`pathspec` are **weak**
copyleft: the obligation reaches modifications to those libraries, and we modify
none of them.

### The route taken, and what is still to be decided

**Route 1 is EXERCISED**: since the PR that added this section, this file ships
**inside** the engine image, at `/usr/share/doc/brabo/THIRD_PARTY_NOTICES.md`.
The written offer has to travel with the binary — whoever does `docker pull` does
not have the repository, and an offer that only exists on GitHub does not
accompany the copy the person received. Check with:

```bash
docker run --rm --entrypoint sh ghcr.io/viralabs-dev/brabo-engine:<tag> \
  -c 'cat /usr/share/doc/brabo/THIRD_PARTY_NOTICES.md'
```

**Since AT-120, the same file ships in EVERY published artifact**, by the
maintainer's decision: inside the `brabo-api`, `brabo-web`, `brabo-broker` and
`brabo-backup` images, at the same path and in the same form as the engine's
(swap the image name in the command above), and alongside the runner binaries as
the `THIRD_PARTY_NOTICES.md` asset of the Release, covered by the same signed
`checksums.txt` (RN-524). The decision is conservative: this repository does not
claim that any of these artifacts waives the offer. Until AT-120 the command above
gave "Permission denied" on the engine image: the folder was created without
traverse permission for the image's non-root user, and now it is created `0755`
before the copy.

> **TODO(humano):** route 1 covers the obligation with the current design, and
> it is what is live. **Route 3** (splitting the scanners into a sidecar, leaving
> the engine image free of copyleft) remains open as an ARCHITECTURE choice, not a
> compliance one — it changes the deploy design and therefore needs an ADR.
> Nothing forces us to take it; what must not happen is publishing with neither
> of the two, which was the state until now.
>
> This section describes what the repository DOES. It is not a legal opinion, and
> validating whether the written offer is sufficient for each embedded license
> remains the maintainer's responsibility.

### Source of this data

Reproducible at any time:

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

## 2. Engine image — permissive

**60 apk packages** and **72 Python packages**, grouped by license family (a
compound declaration such as `MIT AND BSD-2-Clause AND GPL-2.0-or-later` counts
as copyleft):

| family | apk | Python |
|---|---|---|
| MIT | 18 | 32 |
| BSD | 3 | 17 |
| Apache-2.0 | 5 | 16 |
| X11 | 6 | — |
| PSF | 4 | 1 |
| ICU, Zlib, blessing, curl, bzip2 | 6 | — |
| **copyleft** (detailed in section 1) | **18** | **4** |
| undeclared | — | 2 (`face`, `peewee`) |
| | **60** | **72** |

> **TODO(humano):** `face 26.0.1` and `peewee 3.19.0` do not declare a license in
> their metadata. Both come in as transitive dependencies of semgrep. Confirm
> upstream before publishing the image — `peewee` is known to be MIT, but
> confirmation from metadata is what counts in an audit.

## 3. Backup image

`alpine:3.20` + `postgresql16-client` + `aws-cli`, all from apk. The same Alpine
base licenses as in section 1. The MinIO client (`mc`) **was removed** in Phase
5 — it carried 33 CVEs because it was a Go binary frozen since September 2025
([ADR 0027](docs/adr/0027-fase5-backup-hardening-release.md), decision 1b).

The local cluster's S3 **server** is not listed here because we do not
distribute it: SeaweedFS (Apache-2.0) is pulled from Docker Hub by the cluster
itself, only in the local overlay. It replaced MinIO (AGPL-3.0) when MinIO stopped
publishing a community image
([ADR 0169](docs/adr/0169-seaweedfs-no-lugar-do-minio-no-overlay-local.md)).

## 4. Application dependencies

We do not redistribute these, but they are recorded for auditing.

**TypeScript — 263 production packages, all permissive:**
MIT 188 · Apache-2.0 46 · ISC 14 · BSD-3-Clause 12 · Unlicense 2 · 0BSD 1.
**No copyleft.**

**Elixir — 57 dependencies, all permissive:**
Apache-2.0 36 · MIT 17 · BSD-3-Clause 1 · BSD-2-Clause 1.
Extracted from `deps/*/hex_metadata.config` — `mix hex.licenses` does not exist
as a task.

The CI rejects dependencies with critical vulnerabilities (`pnpm audit` +
`mix hex.audit`), but it does **not** check licenses. A copyleft package entering
as a transitive dependency passes without any warning.

> **TODO(humano):** worth a license gate in CI (`license-checker` for npm) if the
> repository goes open. Today it would be monitoring with no consumer.

## 5. Fonts and icons

The design system uses **Space Grotesk**, **Archivo** and **IBM Plex Mono**. Since
[ADR 0036](docs/adr/0036-login-fiel-ao-design-e-fontes-auto-hospedadas.md) they
are **self-hosted**: the `.woff2` files are versioned in `apps/web/public/fonts/`
and ship inside the web image.

This is the hypothesis the previous version of this section anticipated — *"if
they are ever served from the product's own domain"*. The reason was not privacy:
the nginx CSP (`style-src 'self'`, `font-src 'self' data:`) **always** blocked the
CDN, so in production the three never loaded and fell back to system fonts.

**The OFL obligation is active**, and is met by
`apps/web/public/fonts/LICENSE.txt`, which carries the full license text and the
three copyright notices, and is served publicly next to the files:

| family | copyright | license |
|---|---|---|
| Space Grotesk | 2020 The Space Grotesk Project Authors | OFL-1.1 |
| Archivo | 2020 The Archivo Project Authors | OFL-1.1 |
| IBM Plex Mono | © 2017 IBM Corp., Reserved Font Name "Plex" | OFL-1.1 |

`latin` and `latin-ext` subsets, in woff2, obtained from the Google Fonts API.
**No glyph was modified** — which keeps the use outside the Reserved Font Name
clause of IBM Plex.

Apart from the fonts, no vendored third-party code was found in the repository.
