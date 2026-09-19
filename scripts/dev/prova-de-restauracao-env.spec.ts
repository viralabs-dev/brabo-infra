import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// AT-102. `test-restore-compose.sh` chamava o Compose sem `--env-file`, e o
// Compose procura o `.env` ao lado do compose. Na instalação por Release o
// compose mora em `docker/` e o `.env` uma pasta acima: a interpolação
// `${BRABO_BACKUP_IMAGE:?…}` recusava o arquivo inteiro e a prova da migração
// reprovava por AMBIENTE, nunca por backup (seguro pela RN-530, mas a migração
// por compose não fechava).
//
// A régua é a do `install-env.spec.ts`: o que se compara é o VALOR que chega ao
// serviço, resolvido pelo parser do Compose de verdade, e não a presença de uma
// flag no texto do script. Para isso o `docker` do PATH é um invólucro: o `run`
// que o script dispara é reexecutado como `compose <as mesmas flags globais>
// config --format json`, e o teste lê o serviço `backup` que o script USARIA.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INSTALL = path.join(RAIZ, 'install.sh');
const PROVA = path.join(RAIZ, 'docker/backup/test-restore-compose.sh');
const COMPOSE = path.join(RAIZ, 'docker/docker-compose.install.yml');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brabo-prova-env-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const composeDisponivel = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
const PULAR = composeDisponivel ? undefined : 'sem `docker compose` — o parser do Compose é o validador';

const IMAGENS = {
  BRABO_API_IMAGE: 'ghcr.io/daneiel/brabo-api@sha256:' + 'a'.repeat(64),
  BRABO_ENGINE_IMAGE: 'ghcr.io/daneiel/brabo-engine@sha256:' + 'b'.repeat(64),
  BRABO_WEB_IMAGE: 'ghcr.io/daneiel/brabo-web@sha256:' + 'c'.repeat(64),
  BRABO_BACKUP_IMAGE: 'ghcr.io/daneiel/brabo-backup@sha256:' + 'd'.repeat(64),
  BRABO_BROKER_IMAGE: 'ghcr.io/daneiel/brabo-broker@sha256:' + 'e'.repeat(64),
};

function ambiente(extra: Record<string, string> = {}, pathEnv?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NO_COLOR: '1' };
  for (const k of ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT']) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  if (pathEnv) env.PATH = pathEnv;
  return { ...env, ...extra };
}

/**
 * Monta a pasta de uma instalação por Release: compose em `<pasta>/docker/`,
 * `.env` (gravado por `escrever_env`, a função de verdade) em `<pasta>/`.
 * `BACKUP_KEEP_DAILY=13` é o marcador que só o `.env` conhece — o compose
 * tem 7 como default.
 */
function instalacao() {
  const pasta = fs.mkdtempSync(path.join(tmp, 'inst-'));
  fs.mkdirSync(path.join(pasta, 'docker'));
  const compose = path.join(pasta, 'docker/docker-compose.install.yml');
  fs.copyFileSync(COMPOSE, compose);
  const env = path.join(pasta, '.env');

  const texto = fs.readFileSync(INSTALL, 'utf8');
  const semMain = texto.replace(/\nmain\s+"\$@"\s*$/, '\n');
  if (semMain === texto) throw new Error('não achei a chamada de main em install.sh');
  const carregavel = path.join(pasta, 'install-sem-main.sh');
  fs.writeFileSync(carregavel, semMain);
  const base = path.join(pasta, 'projetos');
  fs.mkdirSync(base);
  const g = spawnSync(
    'bash',
    ['-c', `source "${carregavel}"; BASE_DE_PROJETOS="$1"; BROKER_LIGADO=nao; gerar_segredos; escrever_env "$2"`, 'x', base, env],
    { env: ambiente(IMAGENS), encoding: 'utf8' },
  );
  expect(g.status, g.stderr).toBe(0);
  fs.appendFileSync(env, 'BACKUP_KEEP_DAILY=13\n');

  // `docker` de mentira: `compose version` e `config` passam ao real; o `run`
  // vira um `config --format json` com as MESMAS flags globais.
  const bin = path.join(pasta, 'bin');
  fs.mkdirSync(bin);
  const saida = path.join(pasta, 'backup.json');
  const real = spawnSync('bash', ['-c', 'command -v docker'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/usr/bin/env bash
REAL="${real}"
if [[ "$1" == compose && "$2" == version ]]; then exec "$REAL" "$@"; fi
prefixo=()
shift
while [[ $# -gt 0 && "$1" != run && "$1" != config ]]; do prefixo+=("$1"); shift; done
if [[ "$1" == config ]]; then exec "$REAL" compose "\${prefixo[@]}" "$@"; fi
"$REAL" compose "\${prefixo[@]}" --profile backup config --format json > "${saida}" || exit 1
`,
    { mode: 0o755 },
  );
  return { pasta, env, compose, bin, saida };
}

function rodarProva(i: ReturnType<typeof instalacao>, extra: Record<string, string> = {}) {
  return spawnSync('bash', [PROVA], {
    cwd: i.pasta,
    env: ambiente({ BRABO_COMPOSE_FILE: i.compose, ...extra }, `${i.bin}:${process.env.PATH ?? ''}`),
    encoding: 'utf8',
  });
}

describe('a prova de restauração da migração enxerga o .env da instalação (AT-102)', () => {
  it('com BRABO_ENV_FILE, o valor do .env chega ao serviço backup INTEIRO', (ctx) => {
    if (PULAR) ctx.skip(PULAR);
    const i = instalacao();
    const r = rodarProva(i, { BRABO_ENV_FILE: i.env });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const cfg = JSON.parse(fs.readFileSync(i.saida, 'utf8')) as {
      services: Record<string, { image?: string; environment?: Record<string, string> }>;
    };
    expect(cfg.services.backup?.image).toBe(IMAGENS.BRABO_BACKUP_IMAGE);
    expect(cfg.services.backup?.environment?.BACKUP_KEEP_DAILY).toBe('13');
  });

  it('SEM a variável, com o .env uma pasta acima do compose, o Compose recusa — o defeito medido', (ctx) => {
    if (PULAR) ctx.skip(PULAR);
    const i = instalacao();
    const r = rodarProva(i);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/BRABO_BACKUP_IMAGE|serviço 'backup'|required variable/);
  });

  it('BRABO_ENV_FILE apontando para arquivo inexistente é recusa nomeada, nunca queda silenciosa', () => {
    const i = instalacao();
    const r = rodarProva(i, { BRABO_ENV_FILE: path.join(i.pasta, 'nao-existe.env') });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('BRABO_ENV_FILE não existe');
  });

  it('o install.sh entrega o .env da instalação à prova', () => {
    const texto = fs.readFileSync(INSTALL, 'utf8');
    expect(texto).toMatch(/BRABO_ENV_FILE="\$PWD\/\.env"[^\n]*\\\n\s+bash "\$PROVA_DE_RESTAURACAO"/);
  });
});
