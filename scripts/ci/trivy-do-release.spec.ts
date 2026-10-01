import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  achadosDoRelatorio,
  referenciasDoManifesto,
  resumirAlvo,
  celula,
  resumoEmMarkdown,
  resumosDoDiretorio,
} from './trivy-do-release.ts';

/**
 * ADR 0172 (AT-179). O `release.yml` só roda em TAG final, então nenhum PR o
 * executa — a mesma situação do `install-e2e.yml`. O que se prova a cada PR é
 * ESTÁTICO: a ordem dos passos (scan antes de assinar), as flags do portão
 * iguais às do `ci.yml`, a mesma versão e o mesmo sha256 do binário, e nenhuma
 * allowlist nova. A lógica que não é "chamar o Trivy" (ler o manifesto, montar
 * o resumo) é testada como código.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

interface Passo {
  name?: string;
  uses?: string;
  run?: string;
}
interface Workflow {
  env: Record<string, string>;
  jobs: Record<string, { steps: Passo[] }>;
}

const ler = (rel: string): Workflow =>
  YAML.parse(readFileSync(path.join(RAIZ, rel), 'utf8')) as Workflow;
const release = ler('.github/workflows/release.yml');
const ci = ler('.github/workflows/ci.yml');
const passos = release.jobs.release?.steps ?? [];

const indice = (predicado: (p: Passo) => boolean, descricao: string): number => {
  const i = passos.findIndex(predicado);
  if (i < 0) throw new Error(`release.yml não tem mais o passo: ${descricao}`);
  return i;
};
const porNome = (nome: string): number => indice((p) => p.name === nome, nome);

const PORTAO = 'Trivy — HIGH/CRITICAL com correção reprova, antes de assinar';
const RELATORIO = 'Trivy — relatório do que não tem correção';

/**
 * As flags de TODA invocação `trivy image` de um `run:`, com as continuações
 * de linha (`\`) juntadas. Devolve uma lista por invocação, como pares
 * `--flag[=valor]` na ordem em que aparecem (o argumento posicional, a imagem,
 * fica de fora).
 */
function invocacoesDoTrivy(run: string): string[][] {
  const juntado = run.replace(/\\\n\s*/g, ' ');
  return juntado
    .split('\n')
    .filter((l) => /\btrivy image\b/.test(l))
    .map((linha) => {
      // Corta no fim do COMANDO: redirecionamento, pipe ou `;` (o `; then`).
      const comando = linha.slice(linha.indexOf('trivy image') + 'trivy image'.length).split(/\s(?:2>&1|\||;)|;/)[0] ?? '';
      const tokens = comando.trim().split(/\s+/);
      // O último token é a IMAGEM, posicional — nunca valor de flag.
      const semImagem = tokens.slice(0, -1);
      const flags: string[] = [];
      for (let i = 0; i < semImagem.length; i++) {
        const t = semImagem[i] as string;
        if (!t.startsWith('--')) continue;
        const proximo = semImagem[i + 1];
        if (proximo !== undefined && !proximo.startsWith('--')) {
          flags.push(`${t}=${proximo}`);
          i++;
        } else {
          flags.push(t);
        }
      }
      return flags;
    });
}

/** Flags que dizem ONDE (cache, origem, formato, saída), não O QUE reprova. */
const DE_LOGISTICA = /^--(cache-dir|image-src|format|output|no-progress)\b/;
const regua = (flags: string[]): string[] => flags.filter((f) => !DE_LOGISTICA.test(f)).sort();

describe('release.yml — a ordem (ADR 0172)', () => {
  it('o portão do Trivy roda DEPOIS de publicar e registrar os digests', () => {
    expect(porNome(PORTAO)).toBeGreaterThan(porNome('Registrar as imagens publicadas'));
    expect(porNome(RELATORIO)).toBeGreaterThan(porNome('Registrar as imagens publicadas'));
  });

  it('o portão roda ANTES de instalar o cosign e de assinar — imagem reprovada não é assinada', () => {
    const cosign = indice((p) => (p.uses ?? '').startsWith('sigstore/cosign-installer@'), 'cosign-installer');
    const assinar = indice((p) => /\bcosign sign\b/.test(p.run ?? ''), 'cosign sign');
    expect(porNome(PORTAO)).toBeLessThan(cosign);
    expect(porNome(PORTAO)).toBeLessThan(assinar);
  });

  it('nenhum passo depois do portão o contorna com `continue-on-error` ou `if: always()`', () => {
    const portao = passos[porNome(PORTAO)] as Record<string, unknown>;
    expect(portao['continue-on-error']).toBeUndefined();
    expect(portao.if).toBeUndefined();
    for (const p of passos.slice(porNome(PORTAO) + 1) as Record<string, unknown>[]) {
      expect(String(p.if ?? '')).not.toMatch(/always\(\)|failure\(\)/);
    }
  });

  it('o relatório vem antes do portão, para o resumo existir mesmo quando ele reprova', () => {
    expect(porNome(RELATORIO)).toBeLessThan(porNome(PORTAO));
  });

  it('a Release anexa o relatório do que não tem correção', () => {
    const publicar = passos[porNome('Publicar a GitHub Release')]?.run ?? '';
    expect(publicar).toMatch(/gh release create[\s\S]*trivy-sem-correcao\.md/);
  });
});

describe('release.yml — a MESMA régua do ci.yml', () => {
  const portaoDoCi = ci.jobs.images?.steps.find((p) => p.name === 'Trivy nas cinco imagens (em paralelo)');
  const [flagsDoCi] = invocacoesDoTrivy(portaoDoCi?.run ?? '');
  const [flagsDoPortao] = invocacoesDoTrivy(passos[porNome(PORTAO)]?.run ?? '');
  const [flagsDoRelatorio] = invocacoesDoTrivy(passos[porNome(RELATORIO)]?.run ?? '');

  it('o extrator enxerga as três invocações (senão o resto passaria cego)', () => {
    expect(flagsDoCi?.length ?? 0).toBeGreaterThan(5);
    expect(flagsDoPortao?.length ?? 0).toBeGreaterThan(5);
    expect(flagsDoRelatorio?.length ?? 0).toBeGreaterThan(5);
  });

  it('o portão do release tem exatamente as flags de régua do portão do ci.yml', () => {
    expect(regua(flagsDoPortao ?? [])).toEqual(regua(flagsDoCi ?? []));
  });

  it('o portão reprova HIGH/CRITICAL com correção, e só isso', () => {
    expect(flagsDoPortao).toEqual(
      expect.arrayContaining(['--severity=HIGH,CRITICAL', '--ignore-unfixed', '--exit-code=1', '--scanners=vuln']),
    );
  });

  it('o relatório NÃO ignora o que não tem correção e nunca reprova', () => {
    expect(flagsDoRelatorio).not.toContain('--ignore-unfixed');
    expect(flagsDoRelatorio).toContain('--exit-code=0');
    expect(regua(flagsDoRelatorio ?? []).filter((f) => f !== '--exit-code=0')).toEqual(
      regua(flagsDoPortao ?? []).filter((f) => f !== '--exit-code=1' && f !== '--ignore-unfixed'),
    );
  });

  it('o release escaneia o que foi publicado: por DIGEST, do registry', () => {
    for (const flags of [flagsDoPortao, flagsDoRelatorio]) {
      expect(flags).toContain('--image-src=remote');
    }
    for (const nome of [PORTAO, RELATORIO]) {
      expect(passos[porNome(nome)]?.run).toContain('trivy-do-release.ts referencias .release/images.json');
    }
  });

  it('sem allowlist nova: o único arquivo de exceções é o `.trivyignore.yaml` do ci.yml', () => {
    for (const flags of [flagsDoCi, flagsDoPortao, flagsDoRelatorio]) {
      const ignores = (flags ?? []).filter((f) => /^--(ignorefile|ignore-policy|skip-files|skip-dirs|vex|ignore-status)/.test(f));
      expect(ignores).toEqual(['--ignorefile=.trivyignore.yaml']);
    }
  });

  it('versão e sha256 do binário são os mesmos nos dois workflows', () => {
    expect(release.env.TRIVY_VERSION).toBe(ci.env.TRIVY_VERSION);
    expect(release.env.TRIVY_SHA256).toBe(ci.env.TRIVY_SHA256);
    expect(release.env.TRIVY_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('o binário baixado passa por `sha256sum -c` antes de ser extraído', () => {
    const instalar = passos[porNome('Instalar o binário do trivy')]?.run ?? '';
    const curl = instalar.indexOf('curl ');
    const confere = instalar.indexOf('sha256sum -c');
    const extrai = instalar.indexOf('tar -xzf');
    expect(curl).toBeGreaterThanOrEqual(0);
    expect(confere).toBeGreaterThan(curl);
    expect(extrai).toBeGreaterThan(confere);
  });
});

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const manifesto = {
  versao: '9.9.9',
  imagens: [
    { alvo: 'api', repositorio: 'ghcr.io/dono/brabo-api', digest: DIGEST_A, tags: ['9.9.9'] },
    { alvo: 'web', repositorio: 'ghcr.io/dono/brabo-web', digest: DIGEST_B, tags: ['9.9.9'] },
  ],
};

const relatorio = (vulns: { id: string; fixed?: string }[]) => ({
  Results: [
    {
      Target: 'img (alpine 3.21)',
      Vulnerabilities: vulns.map((v) => ({
        VulnerabilityID: v.id,
        PkgName: 'libssl3',
        InstalledVersion: '3.3.7-r0',
        FixedVersion: v.fixed ?? '',
        Severity: 'HIGH',
      })),
    },
  ],
});

describe('referenciasDoManifesto', () => {
  it('devolve repositório@digest de cada imagem, nunca tag', () => {
    expect(referenciasDoManifesto(manifesto)).toEqual([
      { alvo: 'api', referencia: `ghcr.io/dono/brabo-api@${DIGEST_A}` },
      { alvo: 'web', referencia: `ghcr.io/dono/brabo-web@${DIGEST_B}` },
    ]);
  });

  it('reprova digest malformado — escanear parte e assinar tudo é o defeito', () => {
    const ruim = { imagens: [{ alvo: 'api', repositorio: 'ghcr.io/dono/brabo-api', digest: '6.2.0' }] };
    expect(() => referenciasDoManifesto(ruim)).toThrow(/digest válido/);
  });

  it('reprova manifesto vazio: nada a escanear é erro, não sucesso', () => {
    expect(() => referenciasDoManifesto({ imagens: [] })).toThrow(/nenhuma/);
  });

  it('lê o `.release/images.json` versionado', () => {
    const real = JSON.parse(readFileSync(path.join(RAIZ, '.release/images.json'), 'utf8'));
    for (const r of referenciasDoManifesto(real)) {
      expect(r.referencia).toMatch(/^ghcr\.io\/[^@:]+@sha256:[0-9a-f]{64}$/);
    }
  });
});

describe('achadosDoRelatorio / resumirAlvo', () => {
  it('relatório sem `Results` é imagem limpa, não erro', () => {
    expect(achadosDoRelatorio({ SchemaVersion: 2 })).toEqual([]);
  });

  it('separa com correção de sem correção pelo `FixedVersion`', () => {
    const ref = { alvo: 'api', referencia: `x@${DIGEST_A}` };
    const r = resumirAlvo(ref, relatorio([{ id: 'CVE-1', fixed: '3.3.7-r1' }, { id: 'CVE-2' }]));
    expect(r.comCorrecao.map((a) => a.id)).toEqual(['CVE-1']);
    expect(r.semCorrecao.map((a) => a.id)).toEqual(['CVE-2']);
  });

  it('`Results` que não é lista reprova: formato desconhecido não vira "limpo"', () => {
    expect(() => achadosDoRelatorio({ Results: {} })).toThrow(/formato/);
  });
});

describe('resumoEmMarkdown', () => {
  const refs = referenciasDoManifesto(manifesto);

  it('diz os dois números por imagem e lista o que não tem correção', () => {
    const md = resumoEmMarkdown('9.9.9', [
      resumirAlvo(refs[0]!, relatorio([{ id: 'CVE-SEM' }, { id: 'CVE-COM', fixed: '1' }])),
      resumirAlvo(refs[1]!, {}),
    ]);
    expect(md).toContain(`| \`ghcr.io/dono/brabo-api@${DIGEST_A}\` | 1 | 1 |`);
    expect(md).toContain(`| \`ghcr.io/dono/brabo-web@${DIGEST_B}\` | 0 | 0 |`);
    expect(md).toContain('CVE-SEM');
    // O que tem correção é listado pelo PORTÃO, com a tabela do Trivy — não aqui.
    expect(md).not.toContain('| CVE-COM');
  });

  it('diz em texto quando não há nada sem correção, em vez de uma seção vazia', () => {
    const md = resumoEmMarkdown('9.9.9', refs.map((r) => resumirAlvo(r, {})));
    expect(md).toContain('Nenhum HIGH/CRITICAL sem correção');
  });
});

describe('celula (AT-345)', () => {
  it('escapa a barra invertida ANTES da barra vertical', () => {
    expect(celula('a|b')).toBe('a\\|b');
    expect(celula('a\\|b')).toBe('a\\\\\\|b');
    expect(celula('fim\\')).toBe('fim\\\\');
    expect(celula('')).toBe('—');
  });

  it('valor com `\\|` ou `\\` no fim não abre coluna nova na tabela', () => {
    // Uma `|` só separa coluna quando não está escapada: precedida de um
    // número PAR de barras invertidas (`\\` consome as duas no GFM).
    const separadores = (linha: string) =>
      [...linha.matchAll(/(\\*)\|/g)].filter((m) => m[1]!.length % 2 === 0).length;
    for (const valor of ['x\\|y', 'x\\', 'a|b\\', '\\\\|']) {
      const linha = `| ${celula(valor)} | ${celula('fim\\')} |`;
      expect(separadores(linha)).toBe(3);
    }
  });

  it('quebra de linha vira espaço (linha nova encerraria a tabela)', () => {
    expect(celula('a\nb\r\nc')).toBe('a b c');
  });
});

describe('resumosDoDiretorio', () => {
  it('reprova quando falta o relatório de um alvo do manifesto', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'trivy-'));
    writeFileSync(path.join(dir, 'api.json'), JSON.stringify({}));
    expect(() => resumosDoDiretorio(referenciasDoManifesto(manifesto), dir)).toThrow(/sem relatório.*web/);
  });
});
