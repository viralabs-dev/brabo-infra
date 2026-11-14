# Imagem do LAYA do Brabo (AT-626, ADR 0290): o roteador local de ferramentas, SÓ para
# máquina com GPU NVIDIA. Sexta imagem do produto, OPCIONAL: sob o profile
# `tool-router-gpu` do compose de instalação, sem porta publicada.
#
# O que tem dentro, tudo por identidade fixa (cadeia de suprimentos):
#   * a base Python por DIGEST do índice (tag inline, como as outras imagens);
#   * o Laya `6f0496f` (Apache 2.0), buscado por COMMIT (o hash do git é a prova do conteúdo);
#   * o torch 2.14 cu130, que traz as bibliotecas CUDA em wheels: o host só dá o driver (CDI);
#   * o CHECKPOINT próprio `brabo-router` (modelo único 1a, AT-627/AT-630, decisão do dono de
#     13/11/2026) EMBUTIDO, conferido por sha256 no build. A imagem nunca baixa modelo no boot:
#     sobe sem internet (`HF_HUB_OFFLINE=1`, rede `internal` no compose).
#
# O checkpoint é dado, não código: não mora no git. O build o recebe como TARBALL
# (`LAYA_CHECKPOINT_URL`) e REPROVA se o sha256 do tarball ou o do `model.safetensors`
# divergirem do esperado. Construir à mão:
#   tar -C <ck>/brabo-router-at627 --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf - . | gzip -n > ck.tar.gz
#   docker buildx bake laya --set laya.args.LAYA_CHECKPOINT_URL=<url do ck.tar.gz> \
#       --set laya.args.LAYA_CHECKPOINT_SHA256=$(sha256sum ck.tar.gz | cut -d' ' -f1)

# --- o checkpoint: baixa, confere, extrai. Só python (a base não tem curl) ---
FROM python:3.11-slim-trixie@sha256:07d4824036af339fa1b6ef769cc99d9c10a141769538b52b3b597c84f7a7b535 AS checkpoint
ARG LAYA_CHECKPOINT_URL
ARG LAYA_CHECKPOINT_SHA256
# sha256 do `model.safetensors` do `brabo-router-at627` (AT-627; 643 835 524 bytes, fp16).
ARG LAYA_MODELO_SHA256=52c8d2f119e923b4a6ef3f206dcf330c69a32ea3552beefa698d3c0117adeb86
COPY docker/laya/baixar-checkpoint.py /baixar-checkpoint.py
RUN python /baixar-checkpoint.py "${LAYA_CHECKPOINT_URL}" "${LAYA_CHECKPOINT_SHA256}" "${LAYA_MODELO_SHA256}" /ck

# --- o Laya e o torch, num venv copiado para a imagem final ---
FROM python:3.11-slim-trixie@sha256:07d4824036af339fa1b6ef769cc99d9c10a141769538b52b3b597c84f7a7b535 AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
ARG LAYA_COMMIT=6f0496f797dc7127265d62e1543a62de507d943c
ARG TORCH_INDEX=cu130
ARG TORCH_VERSION=2.14.0
# git só neste estágio (não chega à imagem final).
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN python -m venv --upgrade-deps /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
# O `pip` sai do venv no fim: a imagem não instala nada em execução, e o `pip` 26 vendoriza o
# `pkg_resources` do setuptools 70.3 (CVE-2025-47273 no Trivy).
# shortcut: torch e dependências por versão, sem `--require-hashes`; subir para hashes quando o Dependabot de pip entrar neste repo.
RUN pip install "torch==${TORCH_VERSION}" --index-url "https://download.pytorch.org/whl/${TORCH_INDEX}" \
 && python -c "import torch; assert torch.version.cuda, 'o wheel não é CUDA'" \
 && git init -q /src && git -C /src fetch -q --depth 1 https://github.com/NandhaKishorM/laya.git "${LAYA_COMMIT}" \
 && git -C /src checkout -q FETCH_HEAD \
 && test "$(git -C /src rev-parse HEAD)" = "${LAYA_COMMIT}" \
 && pip install "/src[serve]" && pip check \
 && python -m pip uninstall -y pip

# --- a imagem final. O nome `runtime` é o do `no-cache-filter` do bake ---
FROM python:3.11-slim-trixie@sha256:07d4824036af339fa1b6ef769cc99d9c10a141769538b52b3b597c84f7a7b535 AS runtime
ARG LAYA_CHECKPOINT_SHA256
LABEL org.opencontainers.image.title="brabo-laya" \
      org.opencontainers.image.description="Roteador local de ferramentas do Brabo (Laya + checkpoint brabo-router), só com GPU NVIDIA" \
      org.opencontainers.image.source="https://github.com/viralabs-dev/brabo-infra" \
      org.opencontainers.image.licenses="Apache-2.0"

# `apt-get upgrade` pelo mesmo motivo do `apk upgrade` das outras: a base é pinada e congela os patches.
# O `setuptools` do Python do SISTEMA sai: o serviço roda no venv, e o da base vendoriza o
# `jaraco.context` 5.3.0 e o `wheel` 0.45.1, que reprovam no Trivy (CVE-2026-23949, CVE-2026-24049).
# hadolint ignore=DL3008
RUN apt-get update && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/* \
 && python -m pip uninstall -y --root-user-action=ignore setuptools \
 && groupadd --gid 10001 laya && useradd --uid 10001 --gid laya --create-home laya

# A oferta escrita de fonte (AT-120): dono root, 0644, ANTES do USER.
RUN install -d -m 0755 /usr/share/doc/brabo
COPY --chown=root:root --chmod=0644 THIRD_PARTY_NOTICES.md \
     /usr/share/doc/brabo/THIRD_PARTY_NOTICES.md

COPY --from=build /opt/venv /opt/venv
COPY --from=checkpoint /ck /ck
COPY docker/laya/servico.py /opt/laya/servico.py

# Sem compilador na imagem: o torch 2.14 trocaria ops por kernels Triton compilados na primeira
# inferência (Laya #365). Offline: o modelo e o tokenizador estão em /ck.
# TOKENIZERS_PARALLELISM não é segredo (o hadolint lê "TOKEN" no nome).
# hadolint ignore=DL3064
ENV PATH="/opt/venv/bin:$PATH" \
    TORCH_DISABLE_NATIVE_JIT=1 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    USE_TF=0 USE_TORCH=1 TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS=2 \
    HF_HUB_OFFLINE=1 HF_HOME=/tmp/hf HOME=/home/laya \
    LAYA_HOST=0.0.0.0 LAYA_PORT=8000 LAYA_DEVICE=cuda LAYA_THREADS=2 LAYA_PRELOAD=1 \
    LAYA_EXTRA_MODELS='{"brabo-router":"/ck"}' LAYA_MODELS=brabo-router LAYA_DEFAULT_MODEL=brabo-router \
    BRABO_CHECKPOINT_SHA256=${LAYA_CHECKPOINT_SHA256}

USER 10001:10001
WORKDIR /home/laya
EXPOSE 8000
ENTRYPOINT ["python", "/opt/laya/servico.py"]
