import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * Os alvos do binário standalone do runner moram em TRÊS lugares, em três
 * linguagens, e nenhum deles pode derivar do outro em tempo de execução:
 *
 * - a matriz de `build-runner-binaries.yml` (o que se CONSTRÓI);
 * - `PLATAFORMAS` do proxy `GET /runner-releases/binary` (o que a api ACEITA);
 * - o `case` de `instalar_o_runner` no `install.sh` (o que o instalador BAIXA).
 *
 * Eram QUATRO até o ADR 0203 (RN-687): a quarta era a lista do navegador em
 * `apps/web/src/lib/runner-bootstrap.ts`, que saiu junto com o fluxo do ADR
 * 0118. O último teste abaixo trava que ela não volte calada.
 *
 * O ADR 0174 tirou `darwin-x64` (Mac Intel) da matriz: sem runner Intel
 * utilizável no Actions, e o Bun quebrando o `onData` do node-pty no
 * `macos-15-intel` (oven-sh/bun#25822). Tirar de um lugar e esquecer outro
 * produz o defeito silencioso que este arquivo existe para impedir — a api
 * aceitando uma plataforma que nunca publica, ou o instalador baixando um
 * asset que dá 404 com cara de rede fora.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ler = (relativo: string) => readFileSync(path.join(RAIZ, relativo), 'utf8');

const workflow = YAML.parse(ler('.github/workflows/build-runner-binaries.yml')) as {
  jobs: { build: { strategy: { matrix: { include: { target: string; os: string }[] } } } };
};
const matriz = workflow.jobs.build.strategy.matrix.include;
const daMatriz = matriz.map((i) => i.target).sort();

/** Os literais de string de `const <nome> ... = [ ... ]` num arquivo TS. */
function listaDoTs(fonte: string, nome: string): string[] {
  const m = new RegExp(`const ${nome}\\b[^=]*=\\s*\\[([^\\]]*)\\]`).exec(fonte);
  if (!m) throw new Error(`não achei \`const ${nome} = [...]\` — o extrator ficou cego`);
  return [...(m[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1] ?? '').sort();
}

describe('os alvos do binário do runner (ADR 0174)', () => {
  it('a matriz tem QUATRO alvos e nenhum deles é o Mac Intel', () => {
    expect(daMatriz).toEqual(['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-x64']);
    expect(matriz.map((i) => i.os)).not.toContain('macos-13');
    expect(matriz.map((i) => i.os)).not.toContain('macos-15-intel');
  });

  it('a api aceita exatamente o que a matriz constrói', () => {
    const fonte = ler('apps/api/src/interfaces/http/runner/runner-releases.controller.ts');
    expect(listaDoTs(fonte, 'PLATAFORMAS')).toEqual(daMatriz);
    // E o Mac Intel tem recusa PRÓPRIA, que aponta o npm.
    expect(fonte).toMatch(/SEM_BINARIO_POR_DECISAO = 'darwin-x64'/);
    expect(fonte).toContain('npm install -g @brabo/runner');
  });

  it('o instalador só baixa alvo que a matriz constrói, e manda o Mac Intel para o npm', () => {
    const fonte = ler('install.sh');
    const inicio = fonte.indexOf('instalar_o_runner() {');
    const fim = fonte.indexOf('\n}\n', inicio);
    expect(inicio).toBeGreaterThan(-1);
    const corpo = fonte.slice(inicio, fim);
    const baixados = [...corpo.matchAll(/alvo='([^']+)'/g)].map((x) => x[1]);
    expect(baixados.length).toBeGreaterThan(0);
    for (const alvo of baixados) expect(daMatriz).toContain(alvo);
    expect(corpo).toMatch(/darwin-amd64\)\s*\n[\s\S]*?npm install -g @brabo\/runner[\s\S]*?return 0/);
  });

  it('o navegador não enumera mais alvo nenhum: o fluxo do ADR 0118 saiu (ADR 0203)', () => {
    expect(existsSync(path.join(RAIZ, 'apps/web/src/lib/runner-bootstrap.ts'))).toBe(false);
  });
});
