/**
 * Leitura dos CLONES IRMÃOS (`brabo-api`, `brabo-engine`, ...) pelas aferições
 * CRUZADAS deste repositório (AT-701). No monorepo elas liam `apps/*` e
 * `packages/*` por caminho relativo à raiz; agora cada app mora no repo dele, na
 * pasta-mãe deste (`BRABO_IRMAOS`, padrão `..`). Os caminhos que os testes
 * citam continuam os canônicos do monorepo (`apps/engine/config/runtime.exs`) e
 * esta tabela os traduz — uma fonte só do "onde mora hoje".
 */
import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const IRMAOS = path.resolve(RAIZ, process.env.BRABO_IRMAOS ?? '..');

/** prefixo canônico (monorepo) -> [repo irmão, subpasta dentro dele]. Mais longo vence. */
const TABELA: Array<[string, string, string]> = [
  ['apps/api', 'brabo-api', ''],
  ['apps/engine', 'brabo-engine', ''],
  ['apps/web', 'brabo-web', ''],
  ['apps/runner', 'brabo-runner', ''],
  ['apps/broker', 'brabo-broker', ''],
  ['packages/docker-port', 'brabo-contracts', 'packages/docker-port'],
  ['packages/shared', 'brabo-contracts', 'packages/shared'],
  ['install.sh', 'brabo', 'install.sh'],
  ['.github/workflows/release.yml', 'brabo', '.github/workflows/release.yml'],
  ['.github/workflows/build-runner-binaries.yml', 'brabo-runner', '.github/workflows/build-runner-binaries.yml'],
  ['.release', 'brabo', '.release'],
];

/** Caminho real de um caminho canônico: o de um irmão, ou o deste repositório. */
export function caminhoReal(rel: string): string {
  for (const [prefixo, repo, sub] of TABELA) {
    if (rel === prefixo || rel.startsWith(`${prefixo}/`)) {
      const resto = rel === prefixo ? '' : rel.slice(prefixo.length + 1);
      const base = path.posix.join(sub, resto);
      return path.join(IRMAOS, repo, base);
    }
  }
  return path.join(RAIZ, rel);
}

export const existe = (rel: string): boolean => existsSync(caminhoReal(rel));
export const ler = (rel: string): string => readFileSync(caminhoReal(rel), 'utf8');

/** Arquivos que casam um glob canônico, devolvidos pelo caminho canônico. */
export function arquivos(glob: string): string[] {
  const real = caminhoReal(glob);
  const inicio = glob.split('/').findIndex((p) => /[*?[]/.test(p));
  const fixo = glob.split('/').slice(0, inicio).join('/');
  const base = caminhoReal(fixo);
  return globSync(real).map((f) => path.posix.join(fixo, path.relative(base, f).split(path.sep).join('/'))).sort();
}
