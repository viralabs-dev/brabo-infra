import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error -- módulo .mjs sem tipos; é script de dev, não pacote publicado.
import { garantirPontosDeMontagem, pontosDeMontagemDoCompose } from './pontos-de-montagem.mjs';

const RAIZ = join(__dirname, '..', '..');
const composeDeDev = readFileSync(join(RAIZ, 'docker/docker-compose.yml'), 'utf8');

/**
 * AT-172: volume nomeado montado sobre caminho ausente no checkout faz o
 * Docker criá-lo no HOST como root. O preflight cria antes, como o usuário.
 */
describe('pontosDeMontagemDoCompose', () => {
  it('deriva do compose real os pontos de api, web e broker', () => {
    const pontos = pontosDeMontagemDoCompose(composeDeDev);
    for (const esperado of [
      'node_modules',
      'apps/api/node_modules',
      'apps/web/node_modules',
      'apps/broker/node_modules',
      'packages/shared/node_modules',
      'packages/docker-port/node_modules',
    ]) {
      expect(pontos).toContain(esperado);
    }
  });

  it('ignora linhas que não são volume de node_modules', () => {
    expect(pontosDeMontagemDoCompose('- ..:/workspace\n- x:/data/git-repos\n')).toEqual([]);
  });
});

describe('garantirPontosDeMontagem', () => {
  it('cria o que falta, deixa o que existe e não inventa pai ausente', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'at172-'));
    mkdirSync(join(raiz, 'packages/shared'), { recursive: true });
    mkdirSync(join(raiz, 'apps/api/node_modules'), { recursive: true });
    const r = garantirPontosDeMontagem(raiz, [
      'packages/shared/node_modules',
      'apps/api/node_modules',
      'apps/web/node_modules',
    ]);
    expect(r.criados).toEqual(['packages/shared/node_modules']);
    expect(r.falhas).toEqual([]);
    expect(statSync(join(raiz, 'packages/shared/node_modules')).isDirectory()).toBe(true);
  });

  it('falha de criação vira relato, nunca exceção', () => {
    const fs = {
      existsSync: (p: string) => !p.endsWith('node_modules'),
      mkdirSync: () => {
        throw new Error('EACCES: negado');
      },
    };
    const r = garantirPontosDeMontagem('/x', ['a/node_modules'], fs);
    expect(r.criados).toEqual([]);
    expect(r.falhas[0].motivo).toContain('EACCES');
  });
});
