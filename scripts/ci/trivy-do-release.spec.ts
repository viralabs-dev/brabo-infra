import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IRMAOS, RAIZ as RAIZ_DO_INFRA, caminhoReal, existe } from './irmaos.ts';
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
 * ADR 0172 (AT-179). Os `release.yml` só rodam em TAG final, então nenhum PR os executa. O que se
 * prova a cada PR é ESTÁTICO, nos workflows de HOJE (o do infra e, por checkout irmão em
 * `BRABO_IRMAOS`, os de `brabo` e dos quatro apps): os passos são achados pelo COMANDO
 * (`trivy image`, `cosign sign`), nunca pelo nome; versão e sha256 do Trivy e as flags do portão são
 * iguais em todos; o portão escaneia por DIGEST e vem ANTES de assinar; e não há allowlist nova.
 */

interface Passo {
  name?: string;
  uses?: string;
  run?: string;
}
interface Workflow {
  env?: Record<string, string>;
  jobs: Record<string, { steps?: Passo[] }>;
}

const REPOS = ['brabo-infra', 'brabo', 'brabo-api', 'brabo-engine', 'brabo-web', 'brabo-broker'];
const ARQUIVO = '.github/workflows/release.yml';
const caminhoDoRepo = (repo: string): string => (repo === 'brabo-infra' ? RAIZ_DO_INFRA : path.join(IRMAOS, repo));

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
      const semImagem = tokens.slice(0, -1).filter((t) => !t.startsWith('"${ignore')); // o array bash do ignorefile
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

/** Flags que dizem ONDE/COMO (cache, origem, formato, saída, banco), não O QUE reprova. */
const DE_LOGISTICA = /^--(cache-dir|image-src|format|output|no-progress|skip-db-update)\b/;
const regua = (flags: string[]): string[] => flags.filter((f) => !DE_LOGISTICA.test(f)).sort();
/** Allowlist: qualquer forma de dizer "ignore isto". `--skip-db-update` não é (é logística). */
const ALLOWLIST = /^--(ignorefile|ignore-policy|skip-(?!db-update)|vex|ignore-status)/;
const IGNOREFILE_OK = '.trivyignore.yaml';
const REGUA_DO_PORTAO = ['--exit-code=1', '--ignore-unfixed', '--scanners=vuln', '--severity=HIGH,CRITICAL'];

/** O `--ignorefile` do passo inteiro (o dos apps vem de um array bash), pelo nome do arquivo. */
const ignorefilesDoPasso = (run: string): string[] =>
  [...run.matchAll(/--ignorefile[= ]+([^\s)"']+)/g)].map((m) => path.posix.basename(m[1] as string));

const ehCosignSign = (p: Passo): boolean => /\bcosign sign(-blob)?\b/.test(p.run ?? '');
const ehPortao = (p: Passo): boolean =>
  invocacoesDoTrivy(p.run ?? '').some((f) => f.includes('--exit-code=1'));
/** Por digest: o alvo é `…@${DIGEST}`, vem do manifesto (`referencias`) ou da saída `ref` do passo que o resolveu. */
const PORDIGEST = /@\$\{?DIGEST|trivy-do-release\.ts referencias|steps\.ref\.outputs\.ref/;

/** Afere a régua em workflows (repo → YAML). Devolve as violações, nomeando o repo; vazio é verde. */
function violacoes(workflows: Record<string, string>): string[] {
  const v: string[] = [];
  let versao: string | undefined;
  let sha: string | undefined;
  for (const [repo, texto] of Object.entries(workflows)) {
    const wf = YAML.parse(texto) as Workflow;
    const env = wf.env ?? {};
    versao ??= env.TRIVY_VERSION;
    sha ??= env.TRIVY_SHA256;
    if (env.TRIVY_VERSION !== versao) v.push(`${repo}: TRIVY_VERSION diverge`);
    if (env.TRIVY_SHA256 !== sha) v.push(`${repo}: TRIVY_SHA256 diverge`);
    if (!/^[0-9a-f]{64}$/.test(env.TRIVY_SHA256 ?? '')) v.push(`${repo}: TRIVY_SHA256 inválido`);
    let portoes = 0;
    for (const job of Object.values(wf.jobs)) {
      const passos = job.steps ?? [];
      const assinar = passos.findIndex(ehCosignSign);
      passos.forEach((p, i) => {
        const run = p.run ?? '';
        for (const flags of invocacoesDoTrivy(run)) {
          if (flags.some((f) => ALLOWLIST.test(f) && !f.startsWith('--ignorefile'))) v.push(`${repo}: allowlist nova no Trivy`);
        }
        if (ignorefilesDoPasso(run).some((f) => f !== IGNOREFILE_OK)) v.push(`${repo}: ignorefile diferente de ${IGNOREFILE_OK}`);
        if (!ehPortao(p)) return;
        portoes++;
        const [flags] = invocacoesDoTrivy(run).filter((f) => f.includes('--exit-code=1'));
        if (JSON.stringify(regua(flags ?? []).filter((f) => !ALLOWLIST.test(f))) !== JSON.stringify([...REGUA_DO_PORTAO].sort()))
          v.push(`${repo}: flags do portão divergem da régua`);
        if (!PORDIGEST.test(run) && !PORDIGEST.test(JSON.stringify(passos))) v.push(`${repo}: o portão não escaneia por digest`);
        if (assinar >= 0 && i > assinar) v.push(`${repo}: o portão do Trivy vem DEPOIS do cosign sign`);
        if ((p as Record<string, unknown>)['continue-on-error'] !== undefined) v.push(`${repo}: portão com continue-on-error`);
        if (assinar < 0) v.push(`${repo}: portão sem cosign sign no mesmo job`);
      });
    }
    if (portoes === 0) v.push(`${repo}: nenhum portão (trivy image --exit-code 1)`);
  }
  return v;
}

/** Lê os workflows reais; irmão ausente vira entrada vazia que REPROVA nomeando o repo. */
function workflowsReais(): { lidos: Record<string, string>; ausentes: string[] } {
  const lidos: Record<string, string> = {};
  const ausentes: string[] = [];
  for (const repo of REPOS) {
    const f = path.join(caminhoDoRepo(repo), ARQUIVO);
    if (existsSync(f)) lidos[repo] = readFileSync(f, 'utf8');
    else ausentes.push(repo);
  }
  return { lidos, ausentes };
}

describe('Trivy — a régua nos workflows de release de hoje', () => {
  const { lidos, ausentes } = workflowsReais();

  it('todos os repositórios com release de imagem estão checados out (irmão ausente reprova, nomeando)', () => {
    expect(ausentes, `sem ${ARQUIVO} em: ${ausentes.join(', ')} (BRABO_IRMAOS=${IRMAOS})`).toEqual([]);
  });

  it('versão, sha256, flags, digest, ordem antes do cosign e sem allowlist nova', () => {
    expect(violacoes(lidos)).toEqual([]);
  });

  describe('mutação: o aferidor reprova o que deve', () => {
    const base = lidos['brabo-api'] ?? lidos['brabo-infra'] ?? '';
    const mut = (de: string | RegExp, para: string): Record<string, string> => {
      const t = base.replace(de, para);
      expect(t).not.toBe(base);
      return { x: t };
    };
    it('base real passa', () => expect(violacoes({ x: base })).toEqual([]));
    it('flag divergente', () => expect(violacoes(mut('--ignore-unfixed', ''))).toContain('x: flags do portão divergem da régua'));
    it('severidade afrouxada', () => expect(violacoes(mut('HIGH,CRITICAL', 'CRITICAL')).join()).toMatch(/flags do portão/));
    it('allowlist nova (--skip-files)', () =>
      expect(violacoes(mut('--ignore-unfixed', '--ignore-unfixed --skip-files x'))).toContain('x: allowlist nova no Trivy'));
    it('ignorefile diferente', () =>
      expect(violacoes(mut('--ignorefile .trivyignore.yaml', '--ignorefile outro.yaml')).join()).toMatch(/ignorefile diferente/));
    it('versão do Trivy diverge entre repositórios', () => {
      const outra = base.replace(/TRIVY_VERSION: '[^']+'/, "TRIVY_VERSION: '0.0.1'");
      expect(violacoes({ a: base, b: outra })).toContain('b: TRIVY_VERSION diverge');
    });
    it('Trivy depois do cosign sign', () => {
      const wf = YAML.parse(base) as Workflow;
      for (const job of Object.values(wf.jobs)) {
        const passos = job.steps ?? [];
        const i = passos.findIndex(ehPortao);
        const j = passos.findIndex(ehCosignSign);
        if (i >= 0 && j >= 0) [passos[i], passos[j]] = [passos[j] as Passo, passos[i] as Passo];
      }
      expect(violacoes({ x: YAML.stringify(wf) })).toContain('x: o portão do Trivy vem DEPOIS do cosign sign');
    });
    it('workflow sem portão', () => expect(violacoes({ x: base.replace(/--exit-code 1/g, '--exit-code 0') }).join()).toMatch(/nenhum portão/));
    it('irmão ausente: a lista de ausentes nomeia o repo', () => {
      const fora = REPOS.filter((r) => !existsSync(path.join(caminhoDoRepo(r), ARQUIVO)));
      expect(fora).toEqual(ausentes);
    });
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

  it.skipIf(!existe('.release/images.json'))('lê o `.release/images.json` versionado', () => {
    const real = JSON.parse(readFileSync(caminhoReal('.release/images.json'), 'utf8'));
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
