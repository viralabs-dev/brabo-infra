"""O serviço do Laya do Brabo (AT-626, ADR 0290).

O `laya-serve` do Laya (`POST /v1/systemone`) com UMA diferença: o `/health` diz o
que a api precisa para o estado "proficiente" (dispositivo, VRAM livre, p95 da
sonda de boot). A sonda roda no boot, contra o próprio servidor, com um pedido do
tamanho dos do Brabo; o turno nunca passa pelo `/health`.
"""
import hmac
import json
import os
import threading
import time
import urllib.request

import uvicorn
from fastapi import Header
from laya import serve
from laya.mcp.device import agent_device, router_agent

PORTA = serve._resolve_port()
CHAVE = os.environ.get("LAYA_API_KEY") or None
MODELO = os.environ.get("LAYA_DEFAULT_MODEL", "brabo-router")
P95_MAX_MS = float(os.environ.get("LAYA_P95_MAX_MS", "500"))
VRAM_MIN_MIB = float(os.environ.get("LAYA_VRAM_MIN_MIB", "2048"))
AMOSTRAS = int(os.environ.get("LAYA_SONDA_AMOSTRAS", "20"))
DESCARTADAS = 3  # as primeiras chamadas pagam a inicialização do CUDA, não a latência do turno


def vram_livre_mib():
    """Medida ANTES de carregar o modelo: é o que a máquina oferece, não o que sobrou."""
    try:
        import torch

        if torch.cuda.is_available():
            return int(torch.cuda.mem_get_info()[0] / 2**20)
    except Exception:  # noqa: BLE001  # sem GPU a resposta é "sem_gpu", nunca um erro
        pass
    return None


VRAM_LIVRE = vram_livre_mib()
router = serve.build_router()
app = serve.create_app(router)
estado = {"p95Ms": None, "amostras": 0, "sonda": "em_andamento"}


def dispositivo():
    for nome in router.loaded or []:
        d = agent_device(router_agent(router, nome))
        if d:
            return "cuda" if str(d).startswith("cuda") else str(d)
    return None


def veredito():
    """(proficiente, motivo): os mesmos critérios que a api reaplica ao ler."""
    if dispositivo() != "cuda":
        return False, "sem_gpu"
    if VRAM_LIVRE is None or VRAM_LIVRE < VRAM_MIN_MIB:
        return False, "vram_insuficiente"
    if estado["sonda"] != "concluida":
        return False, "sonda_" + estado["sonda"]
    if estado["p95Ms"] is None or estado["p95Ms"] > P95_MAX_MS:
        return False, "p95_acima_do_teto"
    return True, None


# Substitui o `/health` do Laya. Sem a chave certa só a vivacidade, como o original.
app.router.routes = [r for r in app.router.routes if getattr(r, "path", None) != "/health"]


@app.get("/health")
def health(authorization: str | None = Header(default=None)):
    if CHAVE and not hmac.compare_digest(authorization or "", "Bearer " + CHAVE):
        return {"status": "ok"}
    proficiente, motivo = veredito()
    return {
        "status": "ok",
        "dispositivo": dispositivo() or "cpu",
        "vramLivreMiB": VRAM_LIVRE,
        "p95Ms": estado["p95Ms"],
        "amostras": estado["amostras"],
        "proficiente": proficiente,
        "motivo": motivo,
        "modelos": router.loaded,
        "checkpointSha256": os.environ.get("BRABO_CHECKPOINT_SHA256"),
    }


PEDIDO = json.dumps(
    {
        "model": MODELO,
        "state": "Passo 4 do agente. Tarefa: corrigir o teste que falha em src/auth/login.spec.ts. "
        "Já foi lido o arquivo e rodado o teste uma vez; a saída aponta uma importação ausente. " * 6,
        "questions": {
            "ferramenta": {
                "type": "choice",
                "instructions": "Qual ferramenta o agente deve usar agora?",
                "criteria": {
                    "ler_arquivo": "lê um arquivo do projeto",
                    "editar_arquivo": "altera um arquivo do projeto",
                    "rodar_testes": "executa a suíte de testes",
                    "buscar_no_codigo": "procura um texto no código",
                    "listar_pasta": "lista os arquivos de uma pasta",
                    "executar_comando": "executa um comando de shell",
                },
            }
        },
        "max_len": 2048,
    }
).encode()


def chamar():
    req = urllib.request.Request(
        f"http://127.0.0.1:{PORTA}/v1/systemone",
        data=PEDIDO,
        headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + CHAVE} if CHAVE else {})},
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=30) as r:
        r.read()
    return (time.perf_counter() - t0) * 1000.0


def sonda():
    # Espera o uvicorn aceitar conexões.
    for _ in range(120):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORTA}/health", timeout=2).read()
            break
        except OSError:
            time.sleep(0.5)
    try:
        for _ in range(DESCARTADAS):
            chamar()
        tempos = sorted(chamar() for _ in range(AMOSTRAS))
        estado["p95Ms"] = round(tempos[min(len(tempos) - 1, int(0.95 * len(tempos)))], 1)
        estado["amostras"] = len(tempos)
        estado["sonda"] = "concluida"
    except Exception:  # noqa: BLE001  # a sonda falhar é "não proficiente", o serviço segue de pé
        estado["sonda"] = "falhou"


if __name__ == "__main__":
    threading.Thread(target=sonda, daemon=True).start()
    uvicorn.run(app, host=os.environ.get("LAYA_HOST", "0.0.0.0"), port=PORTA, log_level="info")
