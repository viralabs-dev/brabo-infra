import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- módulo .mjs sem tipos; é script de dev.
import { ESTADO, ROTULO_DE_REVISAO, avaliarBrokerDoClone, mensagemDoBroker, recusa } from './broker-do-clone.mjs';

/** Guarda de broker velho (AT-1015, RN-1541): a imagem `brabo-broker:dev` tem de ser a do clone. */
const HEAD = 'a'.repeat(40);
const base = { headDoClone: HEAD, ultimoCommitEm: '2026-11-26T10:00:00-03:00' };

describe('avaliarBrokerDoClone', () => {
  it('rótulo igual ao HEAD: ok e sem mensagem', () => {
    const v = avaliarBrokerDoClone({ ...base, revisaoDaImagem: HEAD, criadaEm: '2026-11-01T00:00:00Z' });
    expect(v.estado).toBe(ESTADO.OK);
    expect(mensagemDoBroker(v)).toBeNull();
  });

  it('rótulo diferente do HEAD: recusa, nomeia as duas revisões e dá o comando de conserto', () => {
    const v = avaliarBrokerDoClone({ ...base, revisaoDaImagem: 'b'.repeat(40) });
    expect(v.estado).toBe(ESTADO.REVISAO_DIVERGENTE);
    expect(recusa(v)).toBe(true);
    const m = mensagemDoBroker(v);
    expect(m).toContain('RECUSADO');
    expect(m).toContain('bbbbbbbbbbbb');
    expect(m).toContain('aaaaaaaaaaaa');
    expect(m).toContain('build broker');
  });

  it('sem rótulo e imagem mais velha que o último commit: recusa pela data, com aviso do rótulo', () => {
    const v = avaliarBrokerDoClone({ ...base, criadaEm: '2026-11-25T23:48:00Z' });
    expect(v.estado).toBe(ESTADO.VELHA_PELA_DATA);
    expect(recusa(v)).toBe(true);
    expect(mensagemDoBroker(v)).toContain(ROTULO_DE_REVISAO);
  });

  it('sem rótulo e imagem mais nova que o último commit: segue, só avisa do rótulo', () => {
    const v = avaliarBrokerDoClone({ ...base, criadaEm: '2026-11-27T10:00:00Z' });
    expect(v.estado).toBe(ESTADO.OK);
    expect(recusa(v)).toBe(false);
    expect(mensagemDoBroker(v)).toContain('AVISO');
  });

  it('sem imagem ou sem dados do clone: não afirma nada', () => {
    expect(avaliarBrokerDoClone(null).estado).toBe(ESTADO.SEM_IMAGEM);
    expect(avaliarBrokerDoClone({ revisaoDaImagem: HEAD }).estado).toBe(ESTADO.INDETERMINADO);
    expect(avaliarBrokerDoClone({ ...base, criadaEm: 'lixo' }).estado).toBe(ESTADO.INDETERMINADO);
  });
});

describe('o dev sobe o broker do clone', () => {
  const ler = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
  it('`make dev` e `pnpm dev` sobem com --build, e o compose passa a revisão como build-arg', () => {
    expect(ler('Makefile')).toMatch(/dev:.*\n\t@export BROKER_REVISION=.*; BRABO_UP_COM_BUILD=1 (.* )?node scripts\/dev\/preflight\.mjs .* up --build/);
    expect(ler('package.json')).toMatch(/export BROKER_REVISION=.*; BRABO_UP_COM_BUILD=1 (.* )?node scripts\/dev\/preflight\.mjs .* up --build/);
    // a revisão do clone vai exportada para o build, para a label sair preenchida
    // exportada (`export`), não prefixo da linha: prefixo só vale para o `node`, e o compose depois do `&&` ficava sem ela (AT-1041)
    expect(ler('Makefile')).toContain('export BROKER_REVISION=$$(git -C $${BRABO_IRMAOS:-..}/brabo-broker rev-parse HEAD');
    expect(ler('package.json')).toContain('export BROKER_REVISION=$(git -C ${BRABO_IRMAOS:-..}/brabo-broker rev-parse HEAD');
    expect(ler('docker/docker-compose.yml')).toMatch(/BROKER_REVISION: \$\{BROKER_REVISION:-\}/);
  });
  it('`make dev` entrega BROKER_REVISION ao docker compose, não só ao preflight (AT-1041)', () => {
    // Roda a receita de verdade, com `node` (preflight) e `docker` (compose) substituídos por stubs no PATH.
    const dir = mkdtempSync(join(tmpdir(), 'at1041-'));
    try {
      const irmaos = join(dir, 'irmaos');
      const broker = join(irmaos, 'brabo-broker');
      mkdirSync(broker, { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: broker });
      execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: broker });
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: broker }).toString().trim();
      const bin = join(dir, 'bin');
      const registro = join(dir, 'revisao-no-compose.txt');
      mkdirSync(bin);
      writeFileSync(join(bin, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      writeFileSync(join(bin, 'docker'), `#!/bin/sh\nprintf '%s' "$BROKER_REVISION" > "${registro}"\nexit 0\n`, { mode: 0o755 });
      const { BROKER_REVISION: _ignorada, ...env } = process.env;
      execFileSync('make', ['-C', fileURLToPath(new URL('../..', import.meta.url)), 'dev'], {
        env: { ...env, PATH: `${bin}:${env.PATH ?? ''}`, BRABO_IRMAOS: irmaos },
        stdio: 'ignore',
      });
      expect(readFileSync(registro, 'utf8')).toBe(head);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('bootstrap.sh e reset-total.sh exportam BROKER_REVISION (HEAD do clone) antes de qualquer chamada ao compose', () => {
    for (const rel of ['scripts/dev/bootstrap.sh', 'scripts/dev/reset-total.sh']) {
      const s = ler(rel);
      const exporta = s.search(/^BROKER_REVISION="\$\(git -C ".*\/brabo-broker" rev-parse HEAD/m);
      expect(exporta, rel).toBeGreaterThan(-1);
      expect(exporta, rel).toBeLessThan(s.search(/^COMPOSE=/m));
    }
  });
});
