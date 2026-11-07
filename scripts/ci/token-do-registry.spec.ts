import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

/**
 * RN-1039 (AT-770): o token do GitHub Packages nunca entra em camada nem em ARG/ENV;
 * só como secret do BuildKit. Aqui, o que é DESTE repositório: os alvos do bake e os
 * builds dos composes que instalam `@viralabs-dev/brabo-*` (api, web, broker).
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');
const COM_NPM = ['api', 'web', 'broker'];

describe('token do registry só como secret do BuildKit', () => {
  const bake = ler('docker-bake.hcl');
  const alvo = (nome: string) => bake.match(new RegExp(`target "${nome}" \\{[\\s\\S]*?\\n\\}`))![0];

  it.each(COM_NPM)('o alvo %s do bake monta o secret npmrc', (nome) => {
    expect(alvo(nome)).toContain('secret     = ["id=npmrc,src=${NPMRC}"]');
  });

  it.each(['engine', 'backup'])('o alvo %s não recebe o token', (nome) => {
    expect(alvo(nome)).not.toContain('npmrc');
  });

  it('nenhum arquivo do infra passa token por ARG, ENV ou build arg', () => {
    for (const arq of ['docker-bake.hcl', 'docker/docker-compose.yml', 'docker/docker-compose.prod.yml']) {
      expect(ler(arq)).not.toMatch(/(NODE_AUTH_TOKEN|NPM_TOKEN|_authToken)/);
    }
  });

  it.each([
    ['docker/docker-compose.prod.yml', ['brabo-api', 'brabo-web', 'brabo-broker']],
    ['docker/docker-compose.yml', ['brabo-broker']],
  ])('%s: todo build de irmão com npm declara secrets: [npmrc]', (arq, repos) => {
    const doc = YAML.parse(ler(arq)) as {
      secrets?: Record<string, unknown>;
      services: Record<string, { build?: { context?: string; secrets?: string[] } }>;
    };
    expect(doc.secrets).toHaveProperty('npmrc');
    const builds = Object.values(doc.services)
      .map((s) => s.build)
      .filter((b) => b?.context && repos.some((r) => b.context!.endsWith(`/${r}`)));
    expect(builds.length).toBeGreaterThan(0);
    for (const b of builds) expect(b!.secrets).toEqual(['npmrc']);
  });

  it('o compose de dev monta o npmrc em api e web (pnpm install no CMD)', () => {
    const doc = YAML.parse(ler('docker/docker-compose.yml')) as {
      services: Record<string, { secrets?: string[]; environment?: Record<string, string> }>;
    };
    for (const s of ['api', 'web']) {
      expect(doc.services[s]!.secrets).toEqual(['npmrc']);
      expect(doc.services[s]!.environment!.NPM_CONFIG_USERCONFIG).toBe('/run/secrets/npmrc');
    }
  });
});
