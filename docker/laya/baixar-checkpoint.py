"""Baixa o tarball do checkpoint, confere os dois sha256 e extrai. Reprova o build se algo diverge.

Uso: baixar-checkpoint.py <url> <sha256 do tarball> <sha256 do model.safetensors> <destino>
"""
import hashlib
import os
import sys
import tarfile
import urllib.request

url, sha_tarball, sha_modelo, destino = sys.argv[1:5]
if not url or not sha_tarball:
    sys.exit("defina LAYA_CHECKPOINT_URL e LAYA_CHECKPOINT_SHA256: o checkpoint não mora no git (ver o cabeçalho do Dockerfile)")


def sha256(caminho):
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


urllib.request.urlretrieve(url, "/tmp/ck.tar.gz")
if sha256("/tmp/ck.tar.gz") != sha_tarball:
    sys.exit("o sha256 do tarball do checkpoint diverge do esperado")
with tarfile.open("/tmp/ck.tar.gz") as t:
    t.extractall(destino, filter="data")
# O tarball pode trazer 0600; o serviço roda como outro usuário e só LÊ.
for pasta, _, arquivos in os.walk(destino):
    os.chmod(pasta, 0o755)
    for nome in arquivos:
        os.chmod(os.path.join(pasta, nome), 0o644)
if sha256(destino + "/model.safetensors") != sha_modelo:
    sys.exit("o sha256 do model.safetensors diverge do esperado")
