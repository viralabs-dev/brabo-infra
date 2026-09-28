import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// AT-203: o reset-total.sh roda INTEIRO, mas num checkout de mentira — uma
// pasta temporária com o script, a lib e o perfil-ollama de verdade — e com
// `docker`/`mix`/`pnpm`/`node` de mentira na FRENTE do PATH. Cada um anota a
// chamada num log e responde conforme o cenário. É isso que prova a ORDEM
// (recusa antes do build, do `stop` e do `DROP SCHEMA`) sem tocar o ambiente
// de ninguém: o `docker` real nunca é chamado.

const aqui = dirname(fileURLToPath(import.meta.url));

type Cenario = {
  mixCompileFalha?: boolean;
  mixDepsGetFalha?: boolean;
  semMix?: boolean;
  drizzleAusente?: boolean;
  // Estado do container neo4j ANTES do up: ausente, recusando a senha, ou
  // saudável com o NEO4J_AUTH dado.
  neo4jAntes?: 'ausente' | 'recusando' | 'saudavel';
  neo4jAuth?: string;
  // O `up -d --wait` de tudo reprova, e o neo4j que ele (re)criou recusa a senha.
  upFalhaComNeo4jRecusando?: boolean;
  env?: string;
  // Saída de `docker ps -a --format …` (AT-173): as linhas `nome§projeto§config_files`.
  containers?: string;
  // O `name:` que `docker compose … config` imprime (AT-173).
  projetoResolvido?: string;
};

const pastas: string[] = [];
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function stub(bin: string, nome: string, corpo: string[]) {
  const caminho = join(bin, nome);
  writeFileSync(caminho, ['#!/usr/bin/env bash', `echo "${nome} $*" >> "$LOG"`, ...corpo, ''].join('\n'));
  chmodSync(caminho, 0o755);
}

function rodar(c: Cenario) {
  const raiz = mkdtempSync(join(tmpdir(), 'reset-total-'));
  pastas.push(raiz);
  mkdirSync(join(raiz, 'scripts/dev'), { recursive: true });
  mkdirSync(join(raiz, 'apps/engine'), { recursive: true });
  for (const f of ['reset-total.sh', 'reset-total-lib.sh', 'perfil-ollama.sh']) {
    copyFileSync(join(aqui, f), join(raiz, 'scripts/dev', f));
  }
  writeFileSync(join(raiz, '.env'), c.env ?? 'OLLAMA_MODE=host\n');
  const bin = join(raiz, 'bin');
  mkdirSync(bin);
  const log = join(raiz, 'log');
  const subiu = join(raiz, 'subiu');
  writeFileSync(log, '');

  stub(bin, 'node', ['exit 0']);
  if (!c.semMix) {
    stub(bin, 'mix', [
      `[[ "$1" == deps.get ]] && exit ${c.mixDepsGetFalha ? 1 : 0}`,
      c.mixCompileFalha
        ? '[[ "$1" == compile ]] && { echo "** (Mix) lock mismatch" >&2; exit 1; }'
        : ':',
      'exit 0',
    ]);
  }
  stub(bin, 'pnpm', [`[[ "$*" == *drizzle-kit* ]] && exit ${c.drizzleAusente ? 1 : 0}`, 'exit 0']);

  const listaDeContainers = join(raiz, 'containers');
  writeFileSync(listaDeContainers, c.containers ?? '');

  const antes = c.neo4jAntes ?? 'saudavel';
  const recusa = 'The client is unauthorized due to authentication failure.';
  stub(bin, 'docker', [
    'args="$*"',
    // A guarda da instalação (ADR 0170): `docker ps -a --format …` e `compose … config`.
    `if [[ "$1" == ps && "$2" == -a && "$3" == --format ]]; then cat "${listaDeContainers}"; exit 0; fi`,
    `if [[ "$args" == *" config" ]]; then echo "name: ${c.projetoResolvido ?? 'brabo-dev'}"; exit 0; fi`,
    // Existe container? Antes do up conforme o cenário; depois do up, sempre.
    `if [[ "$args" == *" ps -a -q neo4j"* ]]; then`,
    `  if [[ -f "${subiu}" || "${antes}" != ausente ]]; then echo abc123; fi; exit 0`,
    'fi',
    'if [[ "$1" == inspect && "$args" == *Health* ]]; then',
    `  if [[ -f "${subiu}" ]]; then ${c.upFalhaComNeo4jRecusando ? `echo "${recusa}"` : 'echo ok'}; exit 0; fi`,
    `  ${antes === 'recusando' ? `echo "${recusa}"` : 'echo ok'}; exit 0`,
    'fi',
    'if [[ "$1" == inspect && "$args" == *Config.Env* ]]; then',
    `  printf 'PATH=/x\\nNEO4J_AUTH=%s\\n' '${c.neo4jAuth ?? 'neo4j/dev-neo4j-password-change-me'}'; exit 0`,
    'fi',
    'if [[ "$args" == *" port "* ]]; then echo 0.0.0.0:5432; exit 0; fi',
    'if [[ "$args" == *" up -d --wait"* && "$args" != *postgres* ]]; then',
    `  touch "${subiu}"`,
    `  ${c.upFalhaComNeo4jRecusando ? 'echo "container brabo-dev-neo4j-1 is unhealthy" >&2; exit 1' : 'exit 0'}`,
    'fi',
    'exit 0',
  ]);

  // Sem `mix`: PATH só com os stubs e o mínimo do sistema, para o `mix` real
  // da máquina não aparecer.
  const PATH = c.semMix ? `${bin}:/usr/bin:/bin` : `${bin}:${process.env.PATH ?? ''}`;
  const r = spawnSync('bash', [join(raiz, 'scripts/dev/reset-total.sh')], {
    env: { PATH, LOG: log, HOME: raiz },
    encoding: 'utf8',
  });
  const chamadas = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}`, chamadas, subiu: existsSync(subiu) };
}

// Tudo o que muda o ambiente. Uma recusa "antes de qualquer efeito" não pode
// ter NENHUMA destas no log.
const efeitos = (chamadas: string[]) =>
  chamadas.filter((l) => /^docker .*\s(build|stop|up|exec|down|rm)(\s|$)/.test(l) || l.includes('DROP SCHEMA'));

describe('reset-total.sh — pré-requisitos de host antes do primeiro efeito (AT-203)', () => {
  it('caminho feliz: deps.get e compile no host ANTES do stop e do DROP, e termina com a frase de sucesso', () => {
    const { codigo, saida, chamadas } = rodar({});
    expect(saida).toContain('reset completo');
    expect(codigo).toBe(0);
    const deps = chamadas.indexOf('mix deps.get');
    const compile = chamadas.indexOf('mix compile');
    const build = chamadas.findIndex((l) => /^docker .* build$/.test(l));
    const stop = chamadas.findIndex((l) => /\sstop\s/.test(l));
    const drop = chamadas.findIndex((l) => l.includes('DROP SCHEMA'));
    const migra = chamadas.indexOf('pnpm engine:migrate');
    expect(deps).toBeGreaterThanOrEqual(0);
    expect(compile).toBeGreaterThan(deps);
    expect(build).toBeGreaterThan(compile);
    expect(stop).toBeGreaterThan(build);
    expect(drop).toBeGreaterThan(stop);
    expect(migra).toBeGreaterThan(drop);
  });

  it('engine que não compila no host (o lock mismatch de 26/09): recusa nomeada, e nada foi parado nem apagado', () => {
    const { codigo, saida, chamadas } = rodar({ mixCompileFalha: true });
    expect(codigo).not.toBe(0);
    expect(saida).toContain('o engine NÃO compila no host');
    expect(saida).toContain('RESET NÃO COMEÇOU');
    expect(saida).not.toContain('pode estar apagado');
    expect(efeitos(chamadas)).toEqual([]);
  });

  it('mix deps.get que falha e mix ausente também recusam antes de qualquer efeito', () => {
    for (const c of [{ mixDepsGetFalha: true }, { semMix: true }]) {
      const { codigo, saida, chamadas } = rodar(c);
      expect(codigo).not.toBe(0);
      expect(saida).toContain('RECUSADO antes de qualquer efeito');
      expect(efeitos(chamadas)).toEqual([]);
    }
  });

  it('drizzle-kit que não resolve no host recusa antes de qualquer efeito', () => {
    const { codigo, saida, chamadas } = rodar({ drizzleAusente: true });
    expect(codigo).not.toBe(0);
    expect(saida).toContain('pnpm install --frozen-lockfile');
    expect(efeitos(chamadas)).toEqual([]);
  });
});

describe('reset-total.sh — a senha do neo4j contra a do volume', () => {
  it('container já recusando a senha: recusa ANTES do primeiro efeito, nomeando a causa, sem apagar volume', () => {
    const { codigo, saida, chamadas } = rodar({ neo4jAntes: 'recusando' });
    expect(codigo).not.toBe(0);
    expect(saida).toContain('O NEO4J RECUSA A SENHA DO .env');
    expect(saida).toContain('só aplica NEO4J_AUTH na criação do volume');
    expect(saida).toContain('Este script não apaga volume');
    expect(efeitos(chamadas)).toEqual([]);
  });

  it('container saudável criado com OUTRA senha que a do .env: recusa antes, sem imprimir nenhuma das duas', () => {
    const { codigo, saida, chamadas } = rodar({
      neo4jAuth: 'neo4j/senha-antiga-secreta',
      env: 'OLLAMA_MODE=host\nNEO4J_PASSWORD=senha-nova-secreta\n',
    });
    expect(codigo).not.toBe(0);
    expect(saida).toContain('criado com OUTRA credencial');
    expect(saida).not.toContain('senha-antiga-secreta');
    expect(saida).not.toContain('senha-nova-secreta');
    expect(efeitos(chamadas)).toEqual([]);
  });

  it('mesma credencial no .env e no container: segue até o fim', () => {
    const { codigo } = rodar({ neo4jAuth: 'neo4j/igual', env: 'OLLAMA_MODE=host\nNEO4J_PASSWORD=igual\n' });
    expect(codigo).toBe(0);
  });

  it('up --wait que reprova com o neo4j recusando a senha: nomeia a causa em vez do "RESET INCOMPLETO" genérico', () => {
    const { codigo, saida, subiu } = rodar({ neo4jAntes: 'ausente', upFalhaComNeo4jRecusando: true });
    expect(subiu).toBe(true);
    expect(codigo).not.toBe(0);
    expect(saida).toContain('RESET INCOMPLETO — parou em: subindo o ambiente');
    expect(saida).toContain('O NEO4J RECUSA A SENHA DO .env');
    expect(saida).toContain('falta subir o resto e semear');
    expect(saida).not.toContain('pode estar apagado e não semeado');
  });
});

// AT-173 (ADR 0170): o compose de dev e o de instalação eram o MESMO projeto
// Docker, e o DROP SCHEMA deste script cairia no banco da instalação. A guarda
// roda antes até do preflight, e recusa sem nenhum efeito.
describe('reset-total.sh — a guarda da instalação na máquina (ADR 0170)', () => {
  const INSTALACAO =
    'brabo-postgres-1§brabo§/home/x/brabo/docker/docker-compose.install.yml\n' +
    'brabo-api-1§brabo§/home/x/brabo/docker/docker-compose.install.yml\n';

  it('container do compose de INSTALAÇÃO na máquina: recusa antes do preflight, nomeando-o, sem efeito nenhum', () => {
    const { codigo, saida, chamadas } = rodar({ containers: INSTALACAO });
    expect(codigo).not.toBe(0);
    expect(saida).toContain('containers do compose de INSTALAÇÃO');
    expect(saida).toContain('brabo-postgres-1  (projeto brabo, /home/x/brabo/docker/docker-compose.install.yml)');
    expect(saida).toContain('docker compose -f /home/x/brabo/docker/docker-compose.install.yml --env-file /home/x/brabo/.env down');
    expect(saida).toContain('RESET NÃO COMEÇOU — recusado em: guarda da instalação na máquina (ADR 0170)');
    expect(chamadas.some((l) => l.startsWith('node '))).toBe(false);
    expect(chamadas.some((l) => l.startsWith('mix '))).toBe(false);
    expect(efeitos(chamadas)).toEqual([]);
  });

  it('também com projeto descartável (`-p` qualquer) e parado: o que vale é o arquivo de compose do rótulo', () => {
    const { codigo, saida, chamadas } = rodar({
      containers: 'prova-web-1§prova-guarda§/tmp/x/brabo-install-compose.yml,/tmp/x/extra.yml\n',
    });
    expect(codigo).not.toBe(0);
    expect(saida).toContain('prova-web-1');
    expect(efeitos(chamadas)).toEqual([]);
  });

  it('compose de dev que resolveria o projeto `brabo` (COMPOSE_PROJECT_NAME): recusa antes de qualquer efeito', () => {
    const { codigo, saida, chamadas } = rodar({ projetoResolvido: 'brabo' });
    expect(codigo).not.toBe(0);
    expect(saida).toContain('resolveria o projeto Docker `brabo`');
    expect(efeitos(chamadas)).toEqual([]);
  });

  it('sem instalação — só o dev (novo e antigo) e outros projetos: passa e vai até o fim', () => {
    const { codigo, saida } = rodar({
      containers:
        'brabo-dev-api-1§brabo-dev§/w/brabo/docker/docker-compose.yml\n' +
        'brabo-api-1§brabo§/w/brabo/docker/docker-compose.yml\n' +
        'outro-db-1§outro§/w/outro/docker-compose.yml\n' +
        'solto§§\n',
    });
    expect(saida).toContain('reset completo');
    expect(codigo).toBe(0);
  });
});
