import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `scripts/ci/alarmar-prova.sh` rodando num bash de VERDADE, com um `gh` de
 * mentira no PATH que registra cada chamada (AT-212).
 *
 * O que se prova é o que o `propriedades.yml` não prova sozinho — ele só roda
 * o alarme depois de subir um cluster, e só a rodada do ramo padrão toca
 * issue, então um defeito aqui apareceria na issue da `main`, no domingo:
 *
 *   - falha no ramo padrão ABRE a issue, ou COMENTA na aberta;
 *   - verde no ramo padrão FECHA a aberta, e não faz nada sem uma;
 *   - rodada de BRANCH não toca issue nenhuma, nem vermelha nem verde;
 *   - `skipped`/`cancelled` não tocam nada;
 *   - sem `RAMO_PADRAO` no ambiente, o ramo é PERGUNTADO ao GitHub.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(RAIZ, 'scripts/ci/alarmar-prova.sh');

let area: string;
let log: string;

// O `gh` de mentira: grava a linha de argumentos e responde ao que o script
// pergunta. `ISSUES_ABERTAS` é o JSON que `gh issue list --json` devolveria
// JÁ filtrado pelo `--jq` — o script pede só o número.
const GH_FALSO = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GH_LOG"
case "$1 $2" in
  "repo view") printf '%s\\n' "\${RAMO_DO_GITHUB:-main}" ;;
  "issue list") [ -n "\${ISSUE_ABERTA:-}" ] && printf '%s\\n' "$ISSUE_ABERTA" ;;
  "issue create") echo "https://github.com/x/y/issues/99" ;;
esac
exit 0
`;

beforeEach(() => {
  area = mkdtempSync(path.join(tmpdir(), 'brabo-alarme-'));
  log = path.join(area, 'gh.log');
  writeFileSync(path.join(area, 'gh'), GH_FALSO);
  chmodSync(path.join(area, 'gh'), 0o755);
});

afterEach(() => {
  rmSync(area, { recursive: true, force: true });
});

function alarmar(
  desfecho: string,
  env: Record<string, string>,
): { saida: string; chamadas: string[] } {
  const saida = execFileSync(
    'bash',
    // Caminho e desfecho vão pelo AMBIENTE, nunca no argv do `bash -c` (AT-346
    // reaberta, CodeQL `js/shell-command-injection-from-environment`).
    [
      '--norc',
      '--noprofile',
      '-euo',
      'pipefail',
      '-c',
      'source "$BRABO_ALVO"\nalarmar \'make alvo\' "$BRABO_DESFECHO" \'olhe o cluster\'',
    ],
    {
      encoding: 'utf8',
      env: {
        PATH: `${area}:${process.env.PATH}`,
        GH_LOG: log,
        GITHUB_REPOSITORY: 'daneiel/brabo',
        GITHUB_SHA: 'abc123',
        URL_DO_RUN: 'https://github.com/daneiel/brabo/actions/runs/1',
        ...env,
        BRABO_ALVO: SCRIPT,
        BRABO_DESFECHO: desfecho,
      },
    },
  );
  const chamadas = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { saida, chamadas };
}

const mutaveis = (chamadas: string[]) =>
  chamadas.filter((c) => /^issue (create|comment|close)/.test(c));

describe('alarmar — no ramo padrão', () => {
  const noPadrao = { RAMO_PADRAO: 'main', GITHUB_REF_NAME: 'main' };

  it('falha sem issue aberta abre uma, com o título do alvo', () => {
    const { chamadas } = alarmar('failure', noPadrao);
    const criacao = mutaveis(chamadas);
    expect(criacao).toHaveLength(1);
    expect(criacao[0]).toContain('issue create --title Prova de propriedade falhou: `make alvo`');
  });

  it('falha com issue aberta comenta nela, sem abrir outra', () => {
    const { chamadas } = alarmar('failure', { ...noPadrao, ISSUE_ABERTA: '42' });
    const efeitos = mutaveis(chamadas);
    expect(efeitos).toHaveLength(1);
    expect(efeitos[0]).toMatch(/^issue comment 42 /);
  });

  it('verde com issue aberta FECHA a issue, nomeando a rodada', () => {
    const { chamadas, saida } = alarmar('success', { ...noPadrao, ISSUE_ABERTA: '42' });
    const efeitos = mutaveis(chamadas);
    expect(efeitos).toHaveLength(1);
    expect(efeitos[0]).toMatch(/^issue close 42 --comment Passou na rodada https:\/\/github\.com\/daneiel\/brabo\/actions\/runs\/1/);
    expect(saida).toContain('fechei a issue #42');
  });

  it('verde sem issue aberta não faz nada', () => {
    expect(mutaveis(alarmar('success', noPadrao).chamadas)).toEqual([]);
  });

  it('skipped e cancelled não perguntam nem tocam nada', () => {
    for (const desfecho of ['skipped', 'cancelled', '']) {
      rmSync(log, { force: true });
      expect(alarmar(desfecho, { ...noPadrao, ISSUE_ABERTA: '42' }).chamadas).toEqual([]);
    }
  });
});

describe('alarmar — numa branch', () => {
  const naBranch = { RAMO_PADRAO: 'main', GITHUB_REF_NAME: 'test/uma-branch' };

  it('vermelho não abre nem comenta — só avisa no log', () => {
    const { chamadas, saida } = alarmar('failure', { ...naBranch, ISSUE_ABERTA: '42' });
    expect(mutaveis(chamadas)).toEqual([]);
    expect(chamadas.some((c) => c.startsWith('issue list'))).toBe(false);
    expect(saida).toContain('::warning::make alvo reprovou em test/uma-branch');
  });

  it('verde não fecha a issue do agendamento', () => {
    const { chamadas } = alarmar('success', { ...naBranch, ISSUE_ABERTA: '42' });
    expect(mutaveis(chamadas)).toEqual([]);
  });
});

describe('alarmar — o ramo padrão vem do GitHub quando o ambiente não o traz', () => {
  it('pergunta com `gh repo view` e decide por ele', () => {
    const { chamadas } = alarmar('failure', {
      GITHUB_REF_NAME: 'dev',
      RAMO_DO_GITHUB: 'dev',
    });
    expect(chamadas[0]).toBe('repo view daneiel/brabo --json defaultBranchRef --jq .defaultBranchRef.name');
    expect(mutaveis(chamadas)).toHaveLength(1);
  });

  it('com o ramo perguntado diferente do da rodada, não toca issue', () => {
    const { chamadas } = alarmar('failure', { GITHUB_REF_NAME: 'dev', RAMO_DO_GITHUB: 'main' });
    expect(mutaveis(chamadas)).toEqual([]);
  });
});
