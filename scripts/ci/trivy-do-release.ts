/**
 * trivy-do-release — o que o `release.yml` escaneia, e o relatório do que NÃO
 * reprova (ADR 0172).
 *
 * ## Por que existe
 *
 * Até o ADR 0172 a imagem que chegava ao GHCR — a que o instalador baixa —
 * nunca era escaneada: o `ci.yml` escaneia um build LOCAL do PR, e a tag
 * publica uma build FRIA diferente (AT-110: o cache de PR não é legível de uma
 * tag). O Trivy passou a rodar no `release.yml` sobre o DIGEST que o bake
 * acabou de empurrar, ANTES do `cosign sign`: imagem reprovada não recebe
 * assinatura, e sem assinatura o `install.sh` não a instala.
 *
 * ## O que é deste arquivo, e o que NÃO é
 *
 * O VEREDITO é do Trivy, nunca daqui: o passo de portão chama `trivy image`
 * com as MESMAS flags do `ci.yml` (`--severity HIGH,CRITICAL --ignore-unfixed
 * --exit-code 1`), e é o código de saída dele que reprova o job. Reimplementar
 * aqui a régua de "tem correção" seria uma segunda régua, e as duas divergiriam
 * no primeiro `Status` novo que o Trivy inventasse (`will_not_fix`,
 * `fix_deferred`…) sem ninguém perceber.
 *
 * Daqui sai só o que o Trivy não faz sozinho:
 *
 * 1. `referencias` — a lista `alvo repositorio@digest` lida do
 *    `.release/images.json` que o passo anterior gerou. É por digest, nunca por
 *    tag, pelo mesmo motivo da assinatura: escanear `:6.2.0` diria o que a tag
 *    apontava no instante do scan, não o que foi publicado.
 * 2. `resumo` — o markdown do resumo do job e do asset `trivy-sem-correcao.md`
 *    da Release, a partir dos relatórios JSON de um SEGUNDO scan, sem
 *    `--ignore-unfixed` e com `--exit-code 0`. É o que torna visível o CVE sem
 *    correção, que por decisão do mantenedor é RELATADO e não bloqueia. Um
 *    relatório faltando para qualquer alvo do manifesto REPROVA — resumo
 *    parcial é indetectável depois, a mesma disciplina do `images-manifest.ts`.
 *
 * Sem allowlist nova: o único arquivo de exceções é o `.trivyignore.yaml` que
 * o `ci.yml` já usa, com `expired_at` em toda entrada. Esta peça não aceita
 * outro.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** `sha256:` + 64 hex. Referência sem isto não é escaneada. */
const PADRAO_DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface ReferenciaEscaneavel {
  alvo: string;
  /** `repositorio@sha256:…` — nunca `:tag`. */
  referencia: string;
}

interface ImagemDoManifesto {
  alvo?: unknown;
  repositorio?: unknown;
  digest?: unknown;
}

/**
 * As referências POR DIGEST de tudo que o manifesto registra. Lança quando o
 * manifesto está vazio, ou quando qualquer imagem vem sem repositório ou com
 * digest malformado — escanear quatro de cinco e assinar as cinco é o defeito
 * que o passo existe para impedir.
 */
export function referenciasDoManifesto(manifesto: unknown): ReferenciaEscaneavel[] {
  const imagens = (manifesto as { imagens?: unknown } | null)?.imagens;
  if (!Array.isArray(imagens) || imagens.length === 0) {
    throw new Error('o manifesto não registra imagem nenhuma — nada a escanear é erro, não sucesso.');
  }
  return imagens.map((bruta: ImagemDoManifesto, i) => {
    const { alvo, repositorio, digest } = bruta ?? {};
    if (typeof alvo !== 'string' || alvo.length === 0) {
      throw new Error(`imagem ${i} do manifesto sem \`alvo\`.`);
    }
    if (typeof repositorio !== 'string' || repositorio.length === 0 || repositorio.includes('@')) {
      throw new Error(`alvo "${alvo}" sem repositório válido (${JSON.stringify(repositorio)}).`);
    }
    if (typeof digest !== 'string' || !PADRAO_DIGEST.test(digest)) {
      throw new Error(
        `alvo "${alvo}" sem digest válido (${JSON.stringify(digest)}) — ` +
          'o scan é sobre o que foi PUBLICADO, e só o digest diz isso.',
      );
    }
    return { alvo, referencia: `${repositorio}@${digest}` };
  });
}

export interface Achado {
  id: string;
  pacote: string;
  instalada: string;
  /** Vazio quando o upstream não publicou correção. */
  corrigidaEm: string;
  severidade: string;
  alvoDoTrivy: string;
}

interface VulnDoTrivy {
  VulnerabilityID?: unknown;
  PkgName?: unknown;
  InstalledVersion?: unknown;
  FixedVersion?: unknown;
  Severity?: unknown;
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Achata o relatório JSON do Trivy (`Results[].Vulnerabilities[]`) em achados.
 * Relatório sem `Results` é imagem sem nada detectado — o Trivy omite a chave
 * nesse caso —, e não erro.
 */
export function achadosDoRelatorio(relatorio: unknown): Achado[] {
  const resultados = (relatorio as { Results?: unknown } | null)?.Results;
  if (resultados === undefined || resultados === null) return [];
  if (!Array.isArray(resultados)) {
    throw new Error('relatório do Trivy com `Results` que não é lista — formato desconhecido.');
  }
  return resultados.flatMap((r: { Target?: unknown; Vulnerabilities?: unknown }) => {
    const vulns = Array.isArray(r?.Vulnerabilities) ? (r.Vulnerabilities as VulnDoTrivy[]) : [];
    return vulns.map((v) => ({
      id: texto(v.VulnerabilityID),
      pacote: texto(v.PkgName),
      instalada: texto(v.InstalledVersion),
      corrigidaEm: texto(v.FixedVersion),
      severidade: texto(v.Severity),
      alvoDoTrivy: texto(r?.Target),
    }));
  });
}

export interface ResumoDoAlvo {
  alvo: string;
  referencia: string;
  /** O que o portão reprova. Contado aqui só para o resumo DIZER o número. */
  comCorrecao: Achado[];
  /** O que é relatado e não bloqueia (decisão do mantenedor, ADR 0172). */
  semCorrecao: Achado[];
}

export function resumirAlvo(ref: ReferenciaEscaneavel, relatorio: unknown): ResumoDoAlvo {
  const achados = achadosDoRelatorio(relatorio);
  return {
    alvo: ref.alvo,
    referencia: ref.referencia,
    comCorrecao: achados.filter((a) => a.corrigidaEm !== ''),
    semCorrecao: achados.filter((a) => a.corrigidaEm === ''),
  };
}

const celula = (s: string): string => (s === '' ? '—' : s.replace(/\|/g, '\\|'));

/**
 * O markdown do resumo. A tabela de cima é por imagem e diz os DOIS números; a
 * lista de baixo é o que não tem correção, que é o que este relatório existe
 * para não deixar calado. O que tem correção NÃO é listado aqui: quem lista é a
 * saída do portão, com a tabela do próprio Trivy, e duas listas do mesmo
 * achado divergiriam.
 */
export function resumoEmMarkdown(versao: string, resumos: ResumoDoAlvo[]): string {
  const linhas: string[] = [];
  linhas.push(`### Trivy sobre as imagens publicadas (${versao})`);
  linhas.push('');
  linhas.push(
    'Escaneado por DIGEST, antes da assinatura, com HIGH/CRITICAL e o mesmo ' +
      '`.trivyignore.yaml` do `ci.yml` (ADR 0172). **Com correção** reprova o release; ' +
      '**sem correção** é relatado e não bloqueia.',
  );
  linhas.push('');
  linhas.push('| Imagem | Com correção (reprova) | Sem correção (relatado) |');
  linhas.push('|---|---:|---:|');
  for (const r of resumos) {
    linhas.push(`| \`${r.referencia}\` | ${r.comCorrecao.length} | ${r.semCorrecao.length} |`);
  }
  linhas.push('');
  const total = resumos.reduce((n, r) => n + r.semCorrecao.length, 0);
  if (total === 0) {
    linhas.push('Nenhum HIGH/CRITICAL sem correção nas imagens publicadas.');
    return `${linhas.join('\n')}\n`;
  }
  linhas.push(`#### Sem correção disponível (${total})`);
  for (const r of resumos) {
    if (r.semCorrecao.length === 0) continue;
    linhas.push('');
    linhas.push(`**${r.alvo}** — \`${r.referencia}\``);
    linhas.push('');
    linhas.push('| CVE | Severidade | Pacote | Instalada | Onde |');
    linhas.push('|---|---|---|---|---|');
    for (const a of r.semCorrecao) {
      linhas.push(
        `| ${celula(a.id)} | ${celula(a.severidade)} | ${celula(a.pacote)} | ` +
          `${celula(a.instalada)} | ${celula(a.alvoDoTrivy)} |`,
      );
    }
  }
  return `${linhas.join('\n')}\n`;
}

/**
 * Lê `<dir>/<alvo>.json` para cada referência. Relatório ausente LANÇA: um
 * alvo sem relatório sairia do resumo em silêncio.
 */
export function resumosDoDiretorio(refs: ReferenciaEscaneavel[], dir: string): ResumoDoAlvo[] {
  return refs.map((ref) => {
    const arquivo = path.join(dir, `${ref.alvo}.json`);
    let bruto: string;
    try {
      bruto = readFileSync(arquivo, 'utf8');
    } catch {
      throw new Error(`sem relatório do Trivy para "${ref.alvo}" (${arquivo}).`);
    }
    return resumirAlvo(ref, JSON.parse(bruto));
  });
}

function principal(): void {
  const [comando, caminhoManifesto, dir, versao] = process.argv.slice(2);
  const uso =
    'uso — node scripts/ci/trivy-do-release.ts referencias <images.json> | ' +
    'resumo <images.json> <dir-dos-relatorios> <versao>';
  try {
    if (comando === 'referencias' && caminhoManifesto) {
      const refs = referenciasDoManifesto(JSON.parse(readFileSync(caminhoManifesto, 'utf8')));
      for (const r of refs) console.log(`${r.alvo} ${r.referencia}`);
      return;
    }
    if (comando === 'resumo' && caminhoManifesto && dir && versao) {
      const refs = referenciasDoManifesto(JSON.parse(readFileSync(caminhoManifesto, 'utf8')));
      process.stdout.write(resumoEmMarkdown(versao, resumosDoDiretorio(refs, dir)));
      return;
    }
    console.error(`::error::trivy-do-release: ${uso}`);
    process.exit(1);
  } catch (erro) {
    console.error(`::error::trivy-do-release: ${erro instanceof Error ? erro.message : String(erro)}`);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('trivy-do-release.ts')) {
  principal();
}
