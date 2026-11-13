import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { ALVOS } from './images-manifest.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RAIZ } from './irmaos.ts';

// Arquivos DESTE repo: `ler` de irmaos.ts traduz `.github/workflows/release.yml` para o do `brabo`.
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

/**
 * A sexta imagem, o Laya (AT-626, ADR 0290): opcional, só com GPU NVIDIA. O que este
 * spec trava é o que, se mudar sem querer, liga o serviço numa máquina sem GPU, abre a
 * rede dele, solta o modelo do sha ou publica a imagem sem Trivy e assinatura.
 */
type Servico = {
  image?: string;
  build?: unknown;
  ports?: unknown[];
  profiles?: string[];
  networks?: string[];
  environment?: Record<string, string>;
  deploy?: { resources?: { reservations?: { devices?: Record<string, unknown>[] } } };
  depends_on?: Record<string, unknown> | string[];
};
type Compose = { services: Record<string, Servico>; networks?: Record<string, { internal?: boolean } | null> };

const COMPOSES = ['docker/docker-compose.install.yml', 'docker/docker-compose.prod.yml'] as const;
const compose = (arq: string) => YAML.parse(ler(arq)) as Compose;
const dockerfile = ler('docker/laya/Dockerfile');
// sha256 do model.safetensors do `brabo-router-at627` (AT-627), o modelo único 1a.
const SHA_DO_MODELO = '52c8d2f119e923b4a6ef3f206dcf330c69a32ea3552beefa698d3c0117adeb86';

describe('o Dockerfile do Laya', () => {
  it('toda base é por tag + digest', () => {
    const froms = [...dockerfile.matchAll(/^FROM (\S+)/gm)].map((m) => m[1]);
    expect(froms.length).toBeGreaterThan(0);
    for (const f of froms) expect(f, f).toMatch(/^[\w./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/);
  });

  it('o Laya vem por COMMIT inteiro e o modelo por sha256 conferido no build', () => {
    expect(dockerfile).toMatch(/ARG LAYA_COMMIT=[0-9a-f]{40}\b/);
    expect(dockerfile).toContain(`ARG LAYA_MODELO_SHA256=${SHA_DO_MODELO}`);
    expect(ler('docker/laya/baixar-checkpoint.py')).toMatch(/sha256\(destino \+ "\/model\.safetensors"\) != sha_modelo/);
  });

  it('sobe sem internet, como usuário numérico não-root, com a oferta de fonte antes do USER', () => {
    expect(dockerfile).toMatch(/HF_HUB_OFFLINE=1/);
    const user = dockerfile.search(/^USER 10001:10001$/m);
    const oferta = dockerfile.search(/^COPY --chown=root:root --chmod=0644 THIRD_PARTY_NOTICES\.md/m);
    expect(user).toBeGreaterThan(-1);
    expect(oferta).toBeGreaterThan(-1);
    expect(oferta).toBeLessThan(user);
    expect(dockerfile).toMatch(/^FROM \S+ AS runtime$/m); // o `no-cache-filter` do bake
  });
});

describe('o alvo do bake', () => {
  const bake = ler('docker-bake.hcl');
  it('existe, fora do grupo `default` e fora dos alvos obrigatórios do manifesto', () => {
    expect(bake).toMatch(/target "laya" \{/);
    const grupo = /group "default" \{\s*targets = \[([^\]]*)\]/.exec(bake)?.[1] ?? '';
    expect(grupo).not.toContain('laya');
    expect([...ALVOS]).not.toContain('laya');
  });
});

describe.each(COMPOSES)('o serviço `laya` em %s', (arq) => {
  const c = compose(arq);
  const laya = c.services.laya;

  it('só sobe pelo profile `tool-router-gpu`, sem porta publicada', () => {
    expect(laya?.profiles).toEqual(['tool-router-gpu']);
    expect(laya?.ports).toBeUndefined();
  });

  it('fica só na rede `laya`, que é interna (sem egress)', () => {
    expect(laya?.networks).toEqual(['laya']);
    expect(c.networks?.laya?.internal).toBe(true);
    const naRede = Object.entries(c.services)
      .filter(([, s]) => (s.networks ?? []).includes('laya'))
      .map(([nome]) => nome)
      .sort();
    expect(naRede).toEqual(['api', 'laya']);
  });

  it('reserva a GPU pelo CDI', () => {
    expect(laya?.deploy?.resources?.reservations?.devices).toEqual([
      { driver: 'cdi', device_ids: ['nvidia.com/gpu=all'], capabilities: ['gpu'] },
    ]);
  });

  it('nenhum serviço depende dele, e a api só tem a URL quando a imagem foi gravada', () => {
    for (const [nome, s] of Object.entries(c.services)) {
      const deps = Array.isArray(s.depends_on) ? s.depends_on : Object.keys(s.depends_on ?? {});
      expect(deps, nome).not.toContain('laya');
    }
    const env = c.services.api?.environment ?? {};
    expect(env.TOOL_ROUTER_URL).toBe('${TOOL_ROUTER_URL:-${BRABO_LAYA_IMAGE:+http://laya:8000}}');
    expect(env.TOOL_ROUTER_LAYA_MODELO).toBe('${TOOL_ROUTER_LAYA_MODELO:-brabo-router}');
    expect(env.TOOL_ROUTER_LAYA_LIMIAR).toBe('${TOOL_ROUTER_LAYA_LIMIAR:-0.88}');
  });
});

describe('o compose de instalação não constrói o Laya', () => {
  it('a imagem vem da variável que o instalador grava, com default inerte', () => {
    const laya = compose('docker/docker-compose.install.yml').services.laya;
    expect(laya?.build).toBeUndefined();
    expect(laya?.image).toMatch(/^\$\{BRABO_LAYA_IMAGE:-[^}]+\}$/);
  });
});

describe('o job `laya` do release.yml', () => {
  const wf = YAML.parse(ler('.github/workflows/release.yml')) as {
    jobs: Record<string, { needs?: string; if?: string; steps: { name?: string; run?: string }[] }>;
  };
  const job = wf.jobs.laya;

  it('só roda com o checkpoint configurado e depois do backup (a Release já existe)', () => {
    expect(job?.if).toBe("vars.LAYA_CHECKPOINT_URL != ''");
    expect(job?.needs).toBe('backup');
  });

  it('o Trivy vem ANTES da assinatura', () => {
    const nomes = (job?.steps ?? []).map((s) => s.name ?? '');
    const trivy = nomes.findIndex((n) => n.startsWith('Trivy'));
    const assinar = nomes.findIndex((n) => n.startsWith('Assinar'));
    expect(trivy).toBeGreaterThan(-1);
    expect(assinar).toBeGreaterThan(trivy);
  });
});
