import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Teste de CORRENTE dos serviços do container de trabalho (AT-1015, RN-1541).
 *
 * O ADR 0299 nunca teve prova ponta a ponta com Docker real, e foi por esse buraco que o TP-01
 * 31ª passou: cada elo estava certo no código e o ambiente rodava um broker velho, depois o
 * `postgres` morreu sob `--cap-drop ALL` e a tela dizia "rodando". Este teste sobe o broker
 * PELO MESMO CAMINHO DO DEV (`docker/docker-compose.yml`, `up --build broker`, sem atalho de
 * imagem) e responde às chamadas dele com uma api de mentira.
 *
 * Só roda com `BRABO_DOCKER_REAL=1` (precisa de Docker e do `~/.npmrc` do build). Fora do CI
 * obrigatório. Isolamento: projeto compose `prova-1015`, nenhuma porta publicada, nenhum toque
 * na 5432 da máquina nem em container que não tenha o prefixo `prova1015`. Limpa o que criou.
 *
 * Esperado hoje: o caso 1 falha enquanto o broker/contracts da `dev` não repassarem
 * `services`/`env` e não subirem o serviço com `usuario`; os casos 2 e 3 falham enquanto o
 * docker-port não recusar serviço sem `usuario` nem conferir que o serviço segue de pé.
 */
const REAL = process.env.BRABO_DOCKER_REAL === '1';
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROJETO = 'prova-1015';
const PREFIXO = 'prova1015';
const TOKEN = 'token-da-prova-1015';
const IMAGEM_DO_TRABALHO = 'node:22-bookworm-slim';
const IMAGEM_DO_BANCO = process.env.PROVA_1015_IMAGEM_DO_BANCO ?? 'postgres:16';

const servicoDeBanco = (extra: Record<string, unknown>) => ({
  name: 'db',
  image: IMAGEM_DO_BANCO,
  env: { POSTGRES_USER: 'teste', POSTGRES_PASSWORD: 'teste', POSTGRES_DB: 'teste' },
  ...extra,
});
const ENV_DO_APP = { DATABASE_URL: 'postgres://teste:teste@127.0.0.1:5432/teste' };

/** projectId → resposta de `GET /internal/projects/:id/container-spec` da api de mentira. */
const CASOS: Record<string, unknown[]> = {
  p1015a: [servicoDeBanco({ user: '999:999', tmpfs: ['/var/lib/postgresql/data'] })],
  p1015b: [servicoDeBanco({ tmpfs: ['/var/lib/postgresql/data'] })], // sem usuario
  p1015c: [servicoDeBanco({ user: '999:999', tmpfs: ['/var/lib/postgresql/data'], command: ['false'] })],
};

const API_FALSA = `
const http = require('node:http');
const casos = require('/specs.json');
http.createServer((req, res) => {
  const id = (req.url.split('/')[3] || '');
  if (!casos[id]) { res.statusCode = 404; return res.end('{}'); }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(casos[id]));
}).listen(3000);
`;

function docker(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const r = spawnSync('docker', args, { encoding: 'utf8', env, cwd: RAIZ });
  return { codigo: r.status ?? 1, saida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe.skipIf(!REAL)('prova de corrente: serviços do container de trabalho (AT-1015)', () => {
  let pasta = '';
  let env: NodeJS.ProcessEnv = process.env;
  const compose = (...a: string[]) =>
    docker(['compose', '-p', PROJETO, '-f', 'docker/docker-compose.yml', '-f', `${pasta}/override.yml`, ...a], env);

  /** `start` do broker, de dentro do próprio container dele (sem porta publicada). */
  function start(projectId: string) {
    const js =
      `fetch('http://127.0.0.1:8090/containers/${projectId}/start',{method:'POST',headers:{'x-brabo-service-token':'${TOKEN}'}})` +
      `.then(async r=>console.log(JSON.stringify({status:r.status,corpo:await r.text()})))`;
    const r = compose('exec', '-T', 'broker', 'node', '-e', js);
    expect(r.codigo, r.saida).toBe(0);
    return JSON.parse(r.saida.trim().split('\n').pop() as string) as { status: number; corpo: string };
  }

  const nomes = (projectId: string) =>
    docker(['ps', '-a', '--filter', `name=${PREFIXO}-${projectId.slice(-1)}`, '--format', '{{.Names}}']).saida.split('\n').filter(Boolean);
  const inspect = (nome: string) => JSON.parse(docker(['inspect', nome]).saida)[0];

  beforeAll(() => {
    pasta = mkdtempSync(path.join(tmpdir(), 'prova-1015-'));
    const u = userInfo();
    const projetos = path.join(pasta, 'projetos');
    for (const id of Object.keys(CASOS)) mkdirSync(path.join(projetos, `${PREFIXO}-${id.slice(-1)}`), { recursive: true });
    const specs = Object.fromEntries(
      Object.entries(CASOS).map(([id, services]) => [
        id,
        {
          projectId: id,
          projectSlug: id,
          workspaceId: `ws-${id}`,
          workspaceDirName: `${PREFIXO}-${id.slice(-1)}`,
          executionMode: 'container',
          localizacao: { tipo: 'gerenciada', segmento: `${PREFIXO}-${id.slice(-1)}` },
          usuarioDaPasta: { uid: u.uid, gid: u.gid },
          imagem: { image: IMAGEM_DO_TRABALHO, network: 'egress', resources: { cpus: 1, memoryMb: 512, pidsLimit: 256 } },
          imagemVersao: 1,
          comandoDoApp: null,
          ports: [],
          services,
          env: ENV_DO_APP,
        },
      ]),
    );
    writeFileSync(path.join(pasta, 'specs.json'), JSON.stringify(specs));
    writeFileSync(path.join(pasta, 'api.js'), API_FALSA);
    // Sem `ports` em lugar nenhum; a api de mentira roda a própria imagem do broker (já tem node).
    writeFileSync(
      path.join(pasta, 'override.yml'),
      `services:
  broker:
    environment:
      API_URL: http://api-falsa:3000
      BRABO_SERVICE_TOKEN: ${TOKEN}
      BRABO_SERVICE_TOKEN_PREVIOUS: ""
    networks: [broker]
  api-falsa:
    image: brabo-broker:dev
    command: ["node", "/api.js"]
    volumes:
      - ${pasta}/specs.json:/specs.json:ro
      - ${pasta}/api.js:/api.js:ro
    networks: [broker]
`,
    );
    env = {
      ...process.env,
      PROJECT_WORKSPACES_HOST_DIR: projetos,
      DOCKER_GID: String(execFileSync('stat', ['-c', '%g', '/var/run/docker.sock'], { encoding: 'utf8' }).trim()),
    };
    const sobe = compose('up', '--build', '--detach', '--wait', 'broker', 'api-falsa');
    expect(sobe.codigo, sobe.saida).toBe(0);
  }, 600_000);

  afterAll(() => {
    for (const n of docker(['ps', '-a', '--filter', `name=${PREFIXO}-`, '--format', '{{.Names}}']).saida.split('\n').filter(Boolean)) {
      docker(['rm', '--force', '--volumes', n]);
    }
    if (pasta) {
      compose('down', '--volumes', '--remove-orphans');
      rmSync(pasta, { recursive: true, force: true });
    }
  }, 120_000);

  it('caso 1: spec completa sobe o `-db` como 999:999, sem volume, alcançável em 127.0.0.1:5432 de dentro do trabalho', () => {
    const r = start('p1015a');
    expect(r.status, r.corpo).toBe(200);
    const [trabalho] = nomes('p1015a').filter((n) => !n.endsWith('-db'));
    expect(trabalho).toBeTruthy();
    expect(inspect(trabalho).Config.Env.some((v: string) => v.startsWith('DATABASE_URL='))).toBe(true);

    const db = inspect(`${trabalho}-db`);
    expect(db.State.Running).toBe(true);
    expect(db.HostConfig.NetworkMode).toBe(`container:${inspect(trabalho).Id}`);
    expect(db.HostConfig.CapDrop).toEqual(['ALL']);
    expect(db.Config.User).toBe('999:999');
    expect(db.Mounts.filter((m: { Type: string }) => m.Type === 'volume')).toEqual([]);

    const ate15s = (fn: () => number) => {
      for (let i = 0; i < 15; i += 1) {
        if (fn() === 0) return 0;
        execFileSync('sleep', ['1']);
      }
      return 1;
    };
    // `pg_isready` sem -h/-U dá falso negativo (socket unix), por isso os dois.
    expect(ate15s(() => docker(['exec', `${trabalho}-db`, 'pg_isready', '-h', '127.0.0.1', '-U', 'teste']).codigo)).toBe(0);
    const tcp = "require('net').connect(5432,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))";
    expect(ate15s(() => docker(['exec', trabalho, 'node', '-e', tcp]).codigo)).toBe(0);
  }, 120_000);

  it('caso 2: spec sem `usuario` é recusada com motivo nomeado e não deixa resto', () => {
    const r = start('p1015b');
    expect(r.status, r.corpo).toBeGreaterThanOrEqual(400);
    expect(r.corpo).toMatch(/usuario/i);
    expect(nomes('p1015b')).toEqual([]);
  }, 120_000);

  it('caso 3: serviço que morre na subida falha com `servico_de_dados_morreu` e não deixa resto', () => {
    const r = start('p1015c');
    expect(r.status, r.corpo).toBeGreaterThanOrEqual(400);
    expect(r.corpo).toContain('servico_de_dados_morreu');
    expect(nomes('p1015c')).toEqual([]);
  }, 120_000);
});
