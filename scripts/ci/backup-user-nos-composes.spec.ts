import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { RAIZ } from './irmaos.ts';

/**
 * AT-738 achado 1: o instalador cria a pasta de backup com o uid de quem roda, e a
 * imagem roda como 70:70. Sem `user:` configurável o backup morre com "não aceita
 * escrita". O default (70:70) não muda.
 */
const COMPOSES = ['docker/docker-compose.install.yml', 'docker/docker-compose.prod.yml'];

describe('serviço backup nos composes (AT-738)', () => {
  for (const caminho of COMPOSES) {
    it(`${caminho} roda como \${BRABO_BACKUP_USER:-70:70}`, () => {
      const doc = parse(readFileSync(path.join(RAIZ, caminho), 'utf8')) as {
        services: Record<string, { user?: string }>;
      };
      expect(doc.services.backup?.user).toBe('${BRABO_BACKUP_USER:-70:70}');
    });
  }

  it('o cabeçalho do serviço backup do compose de instalação cita o arquivo de instalação', () => {
    const t = readFileSync(path.join(RAIZ, COMPOSES[0]!), 'utf8');
    const trecho = t.slice(t.indexOf('# Backup e restore contra compose'), t.indexOf('\n  backup:'));
    expect(trecho).toContain('docker/docker-compose.install.yml');
    expect(trecho).not.toContain('docker/docker-compose.prod.yml');
  });
});
