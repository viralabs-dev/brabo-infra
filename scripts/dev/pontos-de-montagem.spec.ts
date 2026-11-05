import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error -- módulo .mjs sem tipos; é script de dev, não pacote publicado.
import { garantirPontosDeMontagem, irmaosDoCompose, pontosDeMontagemDoCompose } from './pontos-de-montagem.mjs';

const RAIZ = join(__dirname, '..', '..');
const composeDeDev = readFileSync(join(RAIZ, 'docker/docker-compose.yml'), 'utf8');

/**
 * AT-172: volume nomeado montado sobre caminho ausente no checkout faz o
 * Docker criá-lo no HOST como root. O preflight cria antes, como o usuário.
 */
describe('pontosDeMontagemDoCompose', () => {
  it('deriva do compose real os pontos de volume de cada irmão', () => {
    const pontos = pontosDeMontagemDoCompose(composeDeDev);
    for (const p of ['brabo-api/node_modules', 'brabo-web/node_modules', 'brabo-engine/_build', 'brabo-engine/deps']) {
      expect(pontos).toContain(p);
    }
    // `/root/.mix` não está em /workspace: não é ponto no host.
    expect(pontos.some((p: string) => p.includes('.mix'))).toBe(false);
  });

  it('os irmãos do compose incluem os que só têm contexto de build (broker)', () => {
    const irmaos = irmaosDoCompose(composeDeDev);
    expect(irmaos).toEqual(expect.arrayContaining(['brabo-api', 'brabo-engine', 'brabo-web', 'brabo-broker']));
  });

  it('ignora linhas que não são volume de node_modules', () => {
    expect(pontosDeMontagemDoCompose('- ${BRABO_IRMAOS:-../..}/brabo-api:/workspace\n- x:/data/git-repos\n')).toEqual([]);
  });
});

describe('garantirPontosDeMontagem', () => {
  it('cria o que falta DENTRO de cada irmão, deixa o que existe e não inventa irmão ausente', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'at172-'));
    mkdirSync(join(raiz, 'brabo-engine'), { recursive: true });
    mkdirSync(join(raiz, 'brabo-api/node_modules'), { recursive: true });
    const r = garantirPontosDeMontagem(raiz, [
      'brabo-engine/_build',
      'brabo-api/node_modules',
      'brabo-web/node_modules',
    ]);
    expect(r.criados).toEqual(['brabo-engine/_build']);
    expect(r.falhas).toEqual([]);
    expect(statSync(join(raiz, 'brabo-engine/_build')).isDirectory()).toBe(true);
  });

  it('falha de criação vira relato, nunca exceção', () => {
    const fs = {
      existsSync: (p: string) => !p.endsWith('node_modules'),
      mkdirSync: () => {
        throw new Error('EACCES: negado');
      },
    };
    const r = garantirPontosDeMontagem('/x', ['brabo-api/node_modules'], fs);
    expect(r.criados).toEqual([]);
    expect(r.falhas[0].motivo).toContain('EACCES');
  });
});
