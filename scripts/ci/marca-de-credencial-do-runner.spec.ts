import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * RN-558 — a MARCA da recusa da credencial é uma constante de PROTOCOLO
 * partida entre DUAS linguagens: `apps/runner/src/index.ts` a escreve na saída
 * do `exec_result`, e `apps/engine/lib/engine/runners/credencial_de_git.ex` a
 * procura para decidir a ORIGEM da falha (`politica`, ADR 0020).
 *
 * Mudá-la de um lado só não quebra compilação de nada: o `exec` continua sendo
 * recusado, a mensagem continua correta para um humano, e a única coisa que
 * volta a acontecer é a classificação errada — exatamente o defeito silencioso
 * que esta entrega existiu para acabar. Nenhuma das duas suítes alcança o
 * outro lado (ExUnit não lê TypeScript, vitest do runner não lê Elixir), então
 * a guarda mora aqui, com os outros testes que leem o repositório inteiro como
 * texto (`vocabulario-de-eventos-dev.spec.ts`,
 * `flags-do-engine-no-compose.spec.ts`).
 *
 * Comentário não é mecanismo — o docblock dos dois lados já avisa, e é este
 * arquivo que reprova.
 */

const RAIZ = join(import.meta.dirname, '..', '..');

function ler(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), 'utf8');
}

function extrair(texto: string, padrao: RegExp, oque: string): string {
  const achado = texto.match(padrao);
  if (!achado?.[1]) {
    throw new Error(
      `não achei ${oque}. A constante mudou de FORMA (nome ou sintaxe), não só ` +
        `de valor — ajuste este teste junto, nunca só um dos lados.`,
    );
  }
  return achado[1];
}

describe('RN-558 — a marca da recusa de credencial é a MESMA nos dois lados', () => {
  const doRunner = extrair(
    ler('apps/runner/src/index.ts'),
    /export const MARCA_DE_CREDENCIAL_NAO_ENTREGUE = '([^']+)'/,
    'a marca em apps/runner/src/index.ts',
  );

  const doEngine = extrair(
    ler('apps/engine/lib/engine/runners/credencial_de_git.ex'),
    /@marca "([^"]+)"/,
    'a marca em apps/engine/lib/engine/runners/credencial_de_git.ex',
  );

  it('o runner escreve exatamente o que o engine procura', () => {
    expect(doRunner).toBe(doEngine);
  });

  it('a marca é um token estável, sem espaço nem pontuação de frase', () => {
    // Se ela virar uma frase, um reword inocente da mensagem a quebra, e a
    // classificação silenciosamente volta a `codigo`.
    expect(doRunner).toMatch(/^[a-z0-9-]+$/);
  });
});
