import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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

  it('tem 21 folhas — 6 Docker, 6 K8s, 3 Database, 6 Test', () => {
    const conta = (area: string) =>
      folhas.filter((f) => f.caminho.startsWith(`${area}.`)).length;
    expect(folhas).toHaveLength(21);
    expect(conta('1')).toBe(6);
    expect(conta('2')).toBe(6);
    expect(conta('3')).toBe(3);
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
    const apagar = porCaminho(folhas, '3.3');
    expect(apagar.estado).toBe('confirmar');
    expect(apagar.comando).toContain('DROP SCHEMA public CASCADE;');
    expect(apagar.comando).toContain('CREATE SCHEMA public;');
    expect(apagar.comando).toContain('CREATE EXTENSION IF NOT EXISTS vector;');
    expect(apagar.comando).toContain('ON_ERROR_STOP=1');
  });

  it('Database › Delete é a única folha que exige confirmação', () => {
    const confirmam = folhas.filter((f) => f.estado === 'confirmar');
    expect(confirmam.map((f) => f.caminho)).toEqual(['3.3']);
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
