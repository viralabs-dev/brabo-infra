import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { RAIZ } from './irmaos.ts';

/**
 * AT-922 (ADR 0297): a prova de compose do projeto escreve o override no diretório de
 * trabalho do broker. Os três composes declaram o MESMO caminho, como tmpfs gravável
 * (volume nomeado nasce root sem o chown da imagem).
 */
const COMPOSES = [
  'docker/docker-compose.yml',
  'docker/docker-compose.prod.yml',
  'docker/docker-compose.install.yml',
];

describe('diretório de trabalho do broker nos composes (AT-922)', () => {
  for (const caminho of COMPOSES) {
    it(`${caminho}: BROKER_TRABALHO_DIR aponta para um tmpfs gravável de 64 MB`, () => {
      const doc = parse(readFileSync(path.join(RAIZ, caminho), 'utf8')) as {
        services: Record<string, { environment?: Record<string, string>; tmpfs?: string[] }>;
      };
      const broker = doc.services.broker!;
      expect(broker.environment?.BROKER_TRABALHO_DIR).toBe('/trabalho');
      expect(broker.tmpfs).toContain('/trabalho:mode=1777,size=64m');
    });
  }

  // AT-922 (ADR 0297): o broker LÊ, só leitura, a pasta gerenciada e a base dos montados.
  const ws = { dev: '${PROJECT_WORKSPACES_HOST_DIR:-project_workspaces}' };
  for (const caminho of COMPOSES) {
    it(`${caminho}: monta a pasta gerenciada e a base dos montados como :ro e define as variáveis`, () => {
      const doc = parse(readFileSync(path.join(RAIZ, caminho), 'utf8')) as {
        services: Record<string, { environment?: Record<string, string>; volumes?: string[] }>;
      };
      const broker = doc.services.broker!;
      const esq = caminho.endsWith('docker-compose.yml') ? ws.dev : 'project_workspaces';
      expect(broker.volumes).toContain(`${esq}:/data/project-workspaces:ro`);
      expect(broker.volumes).toContain(
        '${BRABO_PROJECTS_BASE:-brabo_projects_base}:${BRABO_PROJECTS_BASE:-/data/brabo-projects-base}:ro',
      );
      const env = broker.environment!;
      expect(env.PROJECT_WORKSPACES_BROKER_ROOT).toBe('/data/project-workspaces');
      expect(env.BRABO_PROJECTS_BROKER_BASE).toBe('${BRABO_PROJECTS_BASE:-/data/brabo-projects-base}');
      expect(env.BRABO_PROVA_SONDA_IMAGE).toMatch(/^(brabo-broker:(dev|prod)|\$\{BRABO_BROKER_IMAGE\})$/);
    });
  }
});
