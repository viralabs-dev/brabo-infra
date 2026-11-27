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
 *
 * Casos 4 e 5 (AT-1037): o trabalho que reinicia (PID 1 morto) deve religar o banco na rede nova e
 * avisar o agente no `exec`; e o comando do app não pode estar no argv do PID 1, para um
 * `pkill -f` dele não derrubar o container. Falham até a correção do docker-port chegar ao broker.
 */
const REAL = process.env.BRABO_DOCKER_REAL === '1';
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROJETO = 'prova-1015';
const PREFIXO = 'prova1015';
const IMAGEM_DO_BROKER = 'brabo-broker:prova-1015'; // tag própria: nunca a `brabo-broker:dev` do ambiente
const TOKEN = 'token-da-prova-1015';
const IMAGEM_DO_TRABALHO = 'node:22-bookworm-slim';
// O broker só aceita imagem de serviço por digest: usa o do `postgres:16` já baixado (RepoDigests).
const digestLocal = (tag: string) => {
  try {
    return execFileSync('docker', ['image', 'inspect', tag, '--format', '{{index .RepoDigests 0}}'], { encoding: 'utf8' }).trim();
  } catch {
    return tag;
  }
};
const IMAGEM_DO_BANCO = process.env.PROVA_1015_IMAGEM_DO_BANCO ?? (REAL ? digestLocal('postgres:16') : 'postgres:16');

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
  p1015d: [servicoDeBanco({ user: '999:999', tmpfs: ['/var/lib/postgresql/data'] })], // caso 4 (reinício)
  p1015e: [servicoDeBanco({ user: '999:999', tmpfs: ['/var/lib/postgresql/data'] })], // caso 5 (pkill -f)
};
// Casos 4 e 5 (AT-1037): o app declarado fica vivo para a caça por texto ter o que acertar.
const COM_APP = new Set(['p1015d', 'p1015e']);
const COMANDO_DO_APP = 'node -e "setInterval(()=>{},1e9)"';

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
    return post(projectId, 'start');
  }

  /** POST do broker (de dentro dele); `corpo` vai como JSON. */
  function post(projectId: string, op: string, corpo?: unknown) {
    const init = corpo === undefined ? '' : `,body:${JSON.stringify(JSON.stringify(corpo))}`;
    const js =
      `fetch('http://127.0.0.1:8090/containers/${projectId}/${op}',{method:'POST',headers:{'x-brabo-service-token':'${TOKEN}','content-type':'application/json'}${init}})` +
      `.then(async r=>console.log(JSON.stringify({status:r.status,corpo:await r.text()})))`;
    const r = compose('exec', '-T', 'broker', 'node', '-e', js);
    expect(r.codigo, r.saida).toBe(0);
    return JSON.parse(r.saida.trim().split('\n').pop() as string) as { status: number; corpo: string };
  }

  const nomes = (projectId: string) =>
    docker(['ps', '-a', '--filter', `name=${PREFIXO}-${projectId.slice(-1)}`, '--format', '{{.Names}}']).saida.split('\n').filter(Boolean);
  const inspect = (nome: string) => JSON.parse(docker(['inspect', nome]).saida)[0];

  const ate = (segundos: number, fn: () => boolean) => {
    for (let i = 0; i < segundos; i += 1) {
      if (fn()) return true;
      execFileSync('sleep', ['1']);
    }
    return fn();
  };
  const netns = (nome: string) => docker(['exec', nome, 'readlink', '/proc/1/ns/net']).saida.trim();

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
          comandoDoApp: COM_APP.has(id) ? COMANDO_DO_APP : null,
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
    image: ${IMAGEM_DO_BROKER}
    environment:
      BRABO_PROVA_SONDA_IMAGE: ${IMAGEM_DO_BROKER}
      API_URL: http://api-falsa:3000
      BRABO_SERVICE_TOKEN: ${TOKEN}
      BRABO_SERVICE_TOKEN_PREVIOUS: ""
    networks: [broker]
  api-falsa:
    image: ${IMAGEM_DO_BROKER}
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
      BROKER_REVISION: process.env.BROKER_REVISION ?? '',
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
      compose('down', '--volumes', '--remove-orphans', '--rmi', 'local');
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

  it('caso 4: o trabalho que reinicia (PID 1 morto) volta com o banco na MESMA rede, e o `exec` avisa', () => {
    expect(start('p1015d').status).toBe(200);
    const [trabalho] = nomes('p1015d').filter((n) => !n.endsWith('-db'));
    expect(inspect(trabalho).RestartCount).toBe(0);

    docker(['exec', trabalho, 'sh', '-c', 'kill 1']); // `kill` é builtin do sh, não binário
    const religou = ate(20, () => {
      const i = inspect(trabalho);
      return i.RestartCount >= 1 && i.State.Running && docker(['exec', trabalho, 'true']).codigo === 0;
    });
    expect(religou, 'o `unless-stopped` não religou o trabalho').toBe(true);

    const r = post('p1015d', 'exec', { comando: 'true' });
    expect(r.status, r.corpo).toBe(200);
    expect.soft(JSON.parse(r.corpo).output).toMatch(/^\[Brabo\] O container de trabalho reiniciou/);
    expect.soft(netns(`${trabalho}-db`), 'o banco ficou na rede antiga').toBe(netns(trabalho));
    const tcp = "require('net').connect(5432,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))";
    expect.soft(ate(15, () => docker(['exec', trabalho, 'node', '-e', tcp]).codigo === 0), '127.0.0.1:5432 não responde').toBe(true);
  }, 180_000);

  it('caso 5: caçar o app pelo texto do comando não derruba o container de trabalho', () => {
    expect(start('p1015e').status).toBe(200);
    const [trabalho] = nomes('p1015e').filter((n) => !n.endsWith('-db'));
    const antes = inspect(trabalho);

    // O PID 1 é a primeira linha de `docker top`; o comando do app não pode estar no argv dele.
    const top = docker(['top', trabalho, '-eo', 'pid,args']).saida.split('\n');
    expect.soft(top[1], 'o comando do app está no argv do PID 1').not.toContain('setInterval');

    // O que o agente fez (`pkill -f`): `pkill` não existe na imagem, então o laço em /proc. O padrão é
    // montado em duas partes para o próprio `sh -c` não casar com ele.
    const caca = `P=setInter; P="$P"val; for d in /proc/[0-9]*; do case "$(tr '\\0' ' ' < $d/cmdline 2>/dev/null)" in *"$P"*) kill "\${d#/proc/}" 2>/dev/null;; esac; done; true`;
    docker(['exec', trabalho, 'sh', '-c', caca]);
    execFileSync('sleep', ['5']);

    const depois = inspect(trabalho);
    expect.soft(depois.RestartCount, 'o container reiniciou').toBe(antes.RestartCount);
    expect(depois.State.Running).toBe(true);
    expect.soft(depois.State.StartedAt).toBe(antes.State.StartedAt);
  }, 180_000);
});
