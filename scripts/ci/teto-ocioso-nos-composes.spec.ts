import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { ler } from '../docs/fontes.mjs';

/**
 * O teto da conversa OCIOSA (RN-581, `SESSION_CONVERSATION_IDLE_TIMEOUT_MS`)
 * contra o `environment:` do serviço `engine` dos TRÊS composes.
 *
 * Por que este teste existe (AT-153): a variável nasceu no PR #596 nos composes
 * de dev e de produção, e NÃO no de instalação (`docker-compose.install.yml`) —
 * que é justamente o que roda na máquina de quem instala. O Compose não repassa
 * o ambiente do host, então a linha no `.env` de uma instalação era inerte e o
 * teto ficava preso nas 8h do código, sem erro nenhum. É a classe de defeito da
 * RN-540, com uma diferença que justifica um teste próprio: a guarda da RN-540
 * (`flags-do-engine-no-compose.spec.ts`) só olha as flags BOOLEANAS, e este é
 * um NÚMERO.
 *
 * Nos três arquivos o default tem de ser o MESMO do `runtime.exs`: ao contrário
 * de `START_ANAMNESE`, nenhum compose tem motivo para decidir este teto por
 * baixo do código. `deploy/k8s/` fica de fora de propósito — lá nada intercepta
 * o ambiente, a ausência é o default do código, e o motivo está escrito no
 * Deployment do engine (`deploy/k8s/base/engine/deployment.yaml`).
 */

const VARIAVEL = 'SESSION_CONVERSATION_IDLE_TIMEOUT_MS';
const COMPOSES = [
  'docker/docker-compose.yml',
  'docker/docker-compose.prod.yml',
  'docker/docker-compose.install.yml',
];

function defaultDoRuntime(): string {
  const m = new RegExp(
    `System\\.get_env\\(\\s*"${VARIAVEL}"\\s*,\\s*"(\\d+)"\\s*\\)`,
  ).exec(ler('apps/engine/config/runtime.exs'));
  if (!m) {
    throw new Error(
      `apps/engine/config/runtime.exs não lê mais ${VARIAVEL} com default ` +
        'numérico literal. Se o teto mudou de nome ou de forma, atualize este ' +
        'teste junto — senão ele passa comparando nada.',
    );
  }
  return m[1] as string;
}

function valorNoEngine(caminho: string): string | undefined {
  const doc = parse(ler(caminho)) as {
    services?: Record<string, { environment?: Record<string, unknown> }>;
  };
  const ambiente = doc?.services?.engine?.environment;
  if (ambiente === undefined || Array.isArray(ambiente)) {
    throw new Error(
      `${caminho}: \`services.engine.environment\` ausente ou em forma de ` +
        'lista; o repositório usa a de mapa. Atualize este teste se mudou.',
    );
  }
  const v = ambiente[VARIAVEL];
  return v === undefined || v === null ? undefined : String(v);
}

describe(`${VARIAVEL} nos composes (RN-581, AT-153)`, () => {
  const doCodigo = defaultDoRuntime();

  it('o default do runtime.exs é o das 8h da decisão do mantenedor', () => {
    expect(doCodigo).toBe('28800000');
  });

  for (const caminho of COMPOSES) {
    it(`${caminho} mapeia o teto com o default do código`, () => {
      expect(
        valorNoEngine(caminho),
        `${caminho} não repassa ${VARIAVEL} ao engine com o default do ` +
          '`runtime.exs`. O Compose não repassa o ambiente do host: sem a ' +
          'linha, o valor no `.env` é inerte (RN-540, RN-581).',
      ).toBe(`\${${VARIAVEL}:-${doCodigo}}`);
    });
  }
});
