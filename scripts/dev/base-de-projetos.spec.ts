import { describe, it, expect } from 'vitest';
// @ts-expect-error -- módulo .mjs sem tipos; é script de dev, não pacote publicado.
import {
  baseSobrepoeOCheckout,
  mensagemDeBaseSobreposta,
  normalizarBase,
} from './base-de-projetos.mjs';

/**
 * A guarda que o preflight aplica sobre `BRABO_PROJECTS_BASE` (ADR 0141,
 * RN-500).
 *
 * O que ela protege está escrito no módulo e vale repetir aqui, porque é o que
 * dá sentido aos casos: a api compara o caminho de um projeto contra o
 * checkout que ELA enxerga (`process.cwd()`, `/workspace` dentro do container
 * dela). Uma base apontando para o checkout REAL no host passa por toda
 * validação existente, e os dev agents passam a executar dentro da árvore do
 * produto — a falha do ADR 0055 entrando por uma porta que ele não vigia.
 */
describe('normalizarBase', () => {
  it('tira a barra final e espaços em volta', () => {
    expect(normalizarBase('/home/voce/brabo/')).toBe('/home/voce/brabo');
    expect(normalizarBase('/home/voce/brabo//')).toBe('/home/voce/brabo');
    expect(normalizarBase('  /home/voce/brabo  ')).toBe('/home/voce/brabo');
  });

  it('preserva a raiz — `/` não vira string vazia', () => {
    expect(normalizarBase('/')).toBe('/');
  });

  it('ausente, vazia ou só espaços é null', () => {
    expect(normalizarBase(undefined)).toBeNull();
    expect(normalizarBase(null)).toBeNull();
    expect(normalizarBase('')).toBeNull();
    expect(normalizarBase('   ')).toBeNull();
  });
});

describe('baseSobrepoeOCheckout', () => {
  const CHECKOUT = '/home/voce/dev/brabo';

  it('recusa a base que CONTÉM o checkout', () => {
    expect(baseSobrepoeOCheckout('/home/voce/dev', CHECKOUT)).toBe(true);
    expect(baseSobrepoeOCheckout('/home/voce', CHECKOUT)).toBe(true);
    expect(baseSobrepoeOCheckout('/', CHECKOUT)).toBe(true);
  });

  it('recusa a base CONTIDA pelo checkout', () => {
    expect(baseSobrepoeOCheckout('/home/voce/dev/brabo/projetos', CHECKOUT)).toBe(
      true,
    );
    expect(
      baseSobrepoeOCheckout('/home/voce/dev/brabo/apps/api/tmp', CHECKOUT),
    ).toBe(true);
  });

  it('recusa a base IGUAL ao checkout — o caso do clone em $HOME/brabo', () => {
    expect(baseSobrepoeOCheckout(CHECKOUT, CHECKOUT)).toBe(true);
    // Com barra final de um lado só: normalizar antes de comparar é o que faz
    // este caso ser pego em vez de passar por desencontro de string.
    expect(baseSobrepoeOCheckout(`${CHECKOUT}/`, CHECKOUT)).toBe(true);
  });

  it('aceita a base DISJUNTA', () => {
    expect(baseSobrepoeOCheckout('/home/voce/brabo-projetos', CHECKOUT)).toBe(
      false,
    );
    expect(baseSobrepoeOCheckout('/srv/projetos', CHECKOUT)).toBe(false);
  });

  // A armadilha de prefixo, do lado do host: `/home/voce/dev/brabo2` não está
  // dentro de `/home/voce/dev/brabo`, e recusá-lo seria bloquear quem não
  // errou. É a mesma checagem que `dentroDaBaseDeProjetos` faz na api.
  it('não confunde prefixo com contenção', () => {
    expect(baseSobrepoeOCheckout('/home/voce/dev/brabo2', CHECKOUT)).toBe(false);
    expect(baseSobrepoeOCheckout('/home/voce/dev/brabo-outro', CHECKOUT)).toBe(
      false,
    );
  });

  it('base ausente não bloqueia — instalação sem modo Pasta montada é normal', () => {
    expect(baseSobrepoeOCheckout(undefined, CHECKOUT)).toBe(false);
    expect(baseSobrepoeOCheckout('', CHECKOUT)).toBe(false);
  });

  it('checkout desconhecido não bloqueia — o preflight não trava por não saber', () => {
    expect(baseSobrepoeOCheckout('/home/voce/brabo', null)).toBe(false);
  });
});

describe('mensagemDeBaseSobreposta', () => {
  it('nomeia os DOIS caminhos e explica por que nada mais pega isso', () => {
    const msg = mensagemDeBaseSobreposta(
      '/home/voce/brabo/',
      '/home/voce/brabo',
    );
    expect(msg).toContain('/home/voce/brabo');
    expect(msg).toContain('BRABO_PROJECTS_BASE');
    expect(msg).toContain('/workspace');
    expect(msg).toContain('ADR 0055');
  });
});
