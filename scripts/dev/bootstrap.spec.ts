import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// O menu em si é TUI e não se testa por unidade. O que se testa — e o que erra
// na prática — é o MAPEAMENTO de caminho de menu para comando: um `--build`
// que some, um serviço trocado, um caminho que aponta para nada. O modo
// `--print-commands` existe para isso: resolve a árvore inteira sem TTY e sem
// executar nada.
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(RAIZ, 'scripts/dev/bootstrap.sh');

type Folha = { caminho: string; trilha: string; estado: string; comando: string };

function imprimir(args: string[] = []): Folha[] {
  const saida = execFileSync('bash', [SCRIPT, '--print-commands', ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return saida
    .split('\n')
    .filter((linha) => linha.trim() !== '')
    .map((linha) => {
      const [caminho, trilha, estado, comando] = linha.split('\t');
      return { caminho, trilha, estado, comando };
    });
}

function porCaminho(folhas: Folha[], caminho: string): Folha {
  const achada = folhas.find((f) => f.caminho === caminho);
  if (!achada) throw new Error(`caminho ausente na árvore: ${caminho}`);
  return achada;
}

describe('bootstrap.sh — árvore de comandos', () => {
  const folhas = imprimir();

  it('expõe as quatro áreas, e só elas', () => {
    const areas = new Set(folhas.map((f) => f.caminho.split('.')[0]));
    expect([...areas].sort()).toEqual(['1', '2', '3', '4']);
  });

  it('tem 22 folhas — 6 Docker, 6 K8s, 4 Database, 6 Test', () => {
    const conta = (area: string) =>
      folhas.filter((f) => f.caminho.startsWith(`${area}.`)).length;
    expect(folhas).toHaveLength(22);
    expect(conta('1')).toBe(6);
    expect(conta('2')).toBe(6);
    expect(conta('3')).toBe(4);
    expect(conta('4')).toBe(6);
  });

  it('Docker › Deploy reconstrói a imagem de cada serviço', () => {
    const compose = 'docker compose -f docker/docker-compose.yml --env-file .env';
    expect(porCaminho(folhas, '1.1.1').comando).toBe(`${compose} up -d --build`);
    expect(porCaminho(folhas, '1.1.2').comando).toBe(`${compose} up -d --build api`);
    expect(porCaminho(folhas, '1.1.3').comando).toBe(`${compose} up -d --build engine`);
    expect(porCaminho(folhas, '1.1.4').comando).toBe(`${compose} up -d --build web`);
  });

  it('Docker › Create passa pelo preflight de portas e NÃO reconstrói', () => {
    // O preflight é o que evita o choque conhecido de portas com
    // `make deploy-local`; sem ele o `up` falha com erro de bind opaco.
    const criar = porCaminho(folhas, '1.2').comando;
    expect(criar).toContain('node scripts/dev/preflight.mjs');
    expect(criar).toContain('up -d');
    expect(criar).not.toContain('--build');
  });

  it('Docker › Destroy preserva os volumes', () => {
    // `down -v` apagaria o pgdata. Destruir containers não é destruir dados:
    // quem quer zerar o banco usa Database › Delete, que avisa antes.
    expect(porCaminho(folhas, '1.3').comando).toMatch(/down$/);
    expect(porCaminho(folhas, '1.3').comando).not.toContain('-v');
  });

  it('K8s › Create sobe o cluster do zero e Deploy reaproveita o existente', () => {
    expect(porCaminho(folhas, '2.2').comando).toBe('make deploy-local');
    expect(porCaminho(folhas, '2.1.1').comando).toBe('BRABO_KEEP_CLUSTER=1 make deploy-local');
    expect(porCaminho(folhas, '2.3').comando).toBe('make k8s-down');
  });

  it('K8s por serviço aparece no menu, mas desabilitado e sem comando', () => {
    // O bootstrap do K8s instala api, engine e web juntos. Some-los do menu
    // esconderia o limite; deixá-los executáveis inventaria caminho que não
    // existe. Ficam visíveis e inertes.
    for (const caminho of ['2.1.2', '2.1.3', '2.1.4']) {
      expect(porCaminho(folhas, caminho).estado).toBe('desabilitado');
      expect(porCaminho(folhas, caminho).comando).toBe('-');
    }
    const desabilitadas = folhas.filter((f) => f.estado === 'desabilitado');
    expect(desabilitadas).toHaveLength(3);
  });

  it('Database › Delete pede confirmação e recria a extensão pgvector', () => {
    // `docker/postgres/init.sql` só roda na primeira inicialização do volume,
    // então um DROP SCHEMA puro levaria o pgvector junto e a migration
    // seguinte falharia.
    const apagar = porCaminho(folhas, '3.4');
    expect(apagar.estado).toBe('confirmar');
    expect(apagar.comando).toContain('DROP SCHEMA public CASCADE;');
    expect(apagar.comando).toContain('CREATE SCHEMA public;');
    expect(apagar.comando).toContain('CREATE EXTENSION IF NOT EXISTS vector;');
    expect(apagar.comando).toContain('ON_ERROR_STOP=1');
  });

  it('Database › Seed usa o script de demonstração que já existe', () => {
    // O menu não reimplementa nada: o seed vive em apps/api (`pnpm --filter api
    // seed`) e roda os use cases reais via application context do Nest.
    expect(porCaminho(folhas, '3.3').comando).toBe('pnpm --filter api seed');
    expect(porCaminho(folhas, '3.3').estado).toBe('ok');
  });

  it('Database › Delete é a única folha que exige confirmação', () => {
    const confirmam = folhas.filter((f) => f.estado === 'confirmar');
    expect(confirmam.map((f) => f.caminho)).toEqual(['3.4']);
  });

  it('Test › All cobre engine e scripts, que o `pnpm test` da raiz não cobre', () => {
    const todos = porCaminho(folhas, '4.1').comando;
    expect(todos).toContain('pnpm test');
    expect(todos).toContain('pnpm engine:test');
    expect(todos).toContain('pnpm --filter @brabo/scripts test');
  });

  it('Test aponta para os comandos que já existem no repositório', () => {
    expect(porCaminho(folhas, '4.2').comando).toBe('pnpm --filter api test');
    expect(porCaminho(folhas, '4.3').comando).toBe('pnpm engine:test');
    expect(porCaminho(folhas, '4.4').comando).toBe('pnpm --filter web test');
    expect(porCaminho(folhas, '4.5').comando).toBe('bash docker/smoke.sh');
    expect(porCaminho(folhas, '4.6').comando).toBe('pnpm docs:check && pnpm docs:build');
  });

  it('toda folha habilitada tem comando, e a trilha nomeia o caminho inteiro', () => {
    for (const folha of folhas) {
      if (folha.estado === 'desabilitado') continue;
      expect(folha.comando).not.toBe('-');
      expect(folha.comando.trim()).not.toBe('');
      expect(folha.trilha.split(' › ')).toHaveLength(folha.caminho.split('.').length);
    }
  });

  it('--path recorta a subárvore', () => {
    const deploy = imprimir(['--path', '1.1']);
    expect(deploy.map((f) => f.caminho)).toEqual(['1.1.1', '1.1.2', '1.1.3', '1.1.4']);
  });
});

// A rolagem do log é TUI, mas o RECORTE dela é aritmética pura — e é a
// aritmética que erra: a borda do começo do arquivo, o deslocamento maior que o
// log, a janela maior que o log. `--print-window` expõe exatamente esse recorte
// sem TTY e sem desenhar nada, pelo mesmo motivo que `--print-commands` existe.
describe('bootstrap.sh — a janela do log', () => {
  const log = path.join(os.tmpdir(), `brabo-bootstrap-spec-${process.pid}.log`);
  fs.writeFileSync(log, Array.from({ length: 100 }, (_, i) => `linha-${i + 1}`).join('\n') + '\n');

  afterAll(() => fs.rmSync(log, { force: true }));

  function janela(altura: number, deslocamento: number): string[] {
    const saida = execFileSync(
      'bash',
      [SCRIPT, '--print-window', log, String(altura), String(deslocamento)],
      { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } },
    );
    return saida.split('\n').filter((linha) => linha !== '');
  }

  it('sem deslocamento mostra a CAUDA — o mesmo que o `tail -n` de antes', () => {
    expect(janela(10, 0)).toEqual([
      'linha-91', 'linha-92', 'linha-93', 'linha-94', 'linha-95',
      'linha-96', 'linha-97', 'linha-98', 'linha-99', 'linha-100',
    ]);
  });

  it('o deslocamento anda para trás linha a linha, sem mudar a altura', () => {
    expect(janela(10, 1)[0]).toBe('linha-90');
    expect(janela(10, 1).at(-1)).toBe('linha-99');
    expect(janela(10, 25)).toHaveLength(10);
    expect(janela(10, 25)[0]).toBe('linha-66');
  });

  it('deslocamento maior que o log para no começo, e não devolve tela vazia', () => {
    // O erro clássico do recorte: `inicio` fica negativo e o `sed` não casa com
    // nada. Quem rolou até o topo veria o log "sumir".
    expect(janela(10, 5000)).toEqual([
      'linha-1', 'linha-2', 'linha-3', 'linha-4', 'linha-5',
      'linha-6', 'linha-7', 'linha-8', 'linha-9', 'linha-10',
    ]);
  });

  it('janela maior que o log devolve o log inteiro, uma vez só', () => {
    const tudo = janela(500, 0);
    expect(tudo).toHaveLength(100);
    expect(tudo[0]).toBe('linha-1');
    expect(tudo.at(-1)).toBe('linha-100');
  });

  it('altura sem linha nenhuma não imprime nada (terminal minúsculo)', () => {
    expect(janela(0, 0)).toEqual([]);
    expect(janela(-3, 0)).toEqual([]);
  });

  it('log ilegível sai != 0 em vez de imprimir janela vazia', () => {
    expect.assertions(2);
    try {
      execFileSync('bash', [SCRIPT, '--print-window', '/tmp/nao-existe-brabo', '5', '0'], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (erro) {
      const falha = erro as { status: number; stderr: string };
      expect(falha.status).toBe(2);
      expect(falha.stderr).toContain('log ilegível');
    }
  });
});

describe('bootstrap.sh — falhas', () => {
  it('caminho inexistente sai != 0 e não imprime comando nenhum', () => {
    expect.assertions(3);
    try {
      execFileSync('bash', [SCRIPT, '--print-commands', '--path', '9.9'], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (erro) {
      const falha = erro as { status: number; stdout: string; stderr: string };
      expect(falha.status).toBe(2);
      expect(falha.stdout).toBe('');
      expect(falha.stderr).toContain('caminho inexistente: 9.9');
    }
  });

  it('argumento desconhecido sai != 0 em vez de abrir o menu', () => {
    expect.assertions(2);
    try {
      execFileSync('bash', [SCRIPT, '--nao-existe'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (erro) {
      const falha = erro as { status: number; stderr: string };
      expect(falha.status).toBe(2);
      expect(falha.stderr).toContain('argumento desconhecido');
    }
  });

  it('sem TTY o menu recusa abrir e ensina o modo não-interativo', () => {
    // Rodar o menu num pipe (CI, subshell) desenharia numa tela que ninguém vê
    // e ficaria travado esperando tecla. Melhor recusar dizendo a saída.
    expect.assertions(2);
    try {
      execFileSync('bash', [SCRIPT], { encoding: 'utf8', stdio: 'pipe' });
    } catch (erro) {
      const falha = erro as { status: number; stderr: string };
      expect(falha.status).toBe(2);
      expect(falha.stderr).toContain('--print-commands');
    }
  });
});
