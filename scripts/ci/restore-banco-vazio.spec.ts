import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `restore.sh --banco-vazio` (AT-738, ADR 0256): a RECUSA de banco com tabela.
 *
 * `psql` e `pg_restore` são de mentira no PATH: o `psql` responde quantas
 * tabelas o banco "tem" e o `pg_restore` só registra que foi chamado. O que se
 * prova é a decisão — banco populado nunca chega ao `pg_restore` —, e a
 * restauração de verdade (contagens iguais) é a do job `restore-banco-vazio`
 * do `propriedades.yml`, contra um Postgres de verdade.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(RAIZ, 'docker/backup/restore.sh');
const LIB = path.join(RAIZ, 'docker/backup/lib.sh');

let area: string;

beforeEach(() => {
  area = mkdtempSync(path.join(tmpdir(), 'brabo-restore-vazio-'));
  mkdirSync(path.join(area, 'bin'));
  mkdirSync(path.join(area, 'backups/daily'), { recursive: true });
  writeFileSync(path.join(area, 'backups/daily/brabo-x.dump'), 'dump');
  const falso = (nome: string, corpo: string) => {
    const f = path.join(area, 'bin', nome);
    writeFileSync(f, `#!/bin/sh\n${corpo}\n`);
    chmodSync(f, 0o755);
  };
  falso('psql', 'echo "${FAKE_TABELAS}"');
  falso('pg_restore', 'echo "$*" >> "${FAKE_LOG}"; exit 0');
});

afterEach(() => rmSync(area, { recursive: true, force: true }));

function rodar(script: string, tabelas: string, args: string[] = ['--banco-vazio']) {
  const log = path.join(area, 'pg_restore.log');
  let codigo = 0;
  let saida = '';
  try {
    saida = execFileSync('sh', [script, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        PATH: `${path.join(area, 'bin')}:${process.env.PATH}`,
        DATABASE_URL: 'postgres://u:p@h:5432/brabo',
        BRABO_BACKUP_LIB: LIB,
        BACKUP_DIR: path.join(area, 'backups'),
        FAKE_TABELAS: tabelas,
        FAKE_LOG: log,
      },
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    codigo = err.status ?? -1;
    saida = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  return { codigo, saida, chamouPgRestore: existsSync(log) && readFileSync(log, 'utf8').length > 0 };
}

describe('restore.sh --banco-vazio', () => {
  it('banco com tabela: RECUSA nomeando o motivo e nunca chama o pg_restore', () => {
    const r = rodar(SCRIPT, '3');
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain('RECUSADO');
    expect(r.saida).toContain('3 tabela(s)');
    expect(r.chamouPgRestore).toBe(false);
  });

  it('banco vazio: passa da recusa e chega ao pg_restore', () => {
    const r = rodar(SCRIPT, '0');
    expect(r.saida).toContain('banco vazio');
    expect(r.chamouPgRestore).toBe(true);
  });

  it('argumento desconhecido: uso, status 2', () => {
    expect(rodar(SCRIPT, '0', ['--sobrescrever']).codigo).toBe(2);
  });

  // MUTAÇÃO: sem a recusa o teste de banco populado TEM de reprovar — prova que
  // ele enxerga a falha, e não passa por outro motivo.
  it('mutação: neutralizando a recusa, o banco populado chega ao pg_restore', () => {
    const original = readFileSync(SCRIPT, 'utf8');
    const mutado = original.replace('"${n_tabelas}" -gt 0', '"${n_tabelas}" -gt 999999');
    expect(mutado).not.toBe(original);
    const copia = path.join(area, 'restore-mutado.sh');
    writeFileSync(copia, mutado);
    const r = rodar(copia, '3');
    expect(r.chamouPgRestore).toBe(true);
  });
});
