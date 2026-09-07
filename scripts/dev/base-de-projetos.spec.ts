import { describe, it, expect } from 'vitest';
// @ts-expect-error -- módulo .mjs sem tipos; é script de dev, não pacote publicado.
import {
  RECUSA,
  basePadrao,
  baseSobrepoeOCheckout,
  exigeProvaDeCompartilhamento,
  mensagemDeBaseSobreposta,
  normalizarBase,
  validarBase,
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

/**
 * O passo de consentimento (ADR 0146). O que se testa aqui é a DECISÃO — qual
 * é o default e o que é uma base aceitável —, nunca o I/O: perguntar, criar
 * pasta e provar o compartilhamento chamando `docker` moram em
 * `consentir-base.mjs`, e é por isso que a decisão saiu de lá.
 */
describe('basePadrao', () => {
  it('propõe `projetos-brabo` sob o $HOME', () => {
    expect(basePadrao('/home/voce')).toBe('/home/voce/projetos-brabo');
    expect(basePadrao('/home/voce/')).toBe('/home/voce/projetos-brabo');
  });

  // O nome NÃO é `brabo-projetos`, e não é preferência: `.env.example` já usa
  // exatamente esse caminho como exemplo de `PROJECT_WORKSPACES_HOST_DIR`, a
  // raiz que o PRODUTO gerencia. Propor o mesmo nome para as duas variáveis
  // seria andar para dentro da colisão que o ADR 0141 recusou.
  it('não propõe o nome que o .env.example já usa para a raiz gerenciada', () => {
    expect(basePadrao('/home/voce')).not.toBe('/home/voce/brabo-projetos');
  });

  it('sem home conhecido, não inventa caminho', () => {
    expect(basePadrao(undefined)).toBeNull();
    expect(basePadrao('')).toBeNull();
  });
});

describe('validarBase', () => {
  const CHECKOUT = '/home/voce/dev/brabo';
  const GERENCIADA = '/home/voce/brabo-projetos';

  it('aceita a base disjunta das duas raízes — o caminho feliz', () => {
    const v = validarBase('/home/voce/projetos-brabo', {
      checkout: CHECKOUT,
      raizGerenciada: GERENCIADA,
    });
    expect(v.ok).toBe(true);
    expect(v.base).toBe('/home/voce/projetos-brabo');
  });

  it('normaliza antes de decidir', () => {
    const v = validarBase('  /home/voce/projetos-brabo/  ', { checkout: CHECKOUT });
    expect(v.ok).toBe(true);
    expect(v.base).toBe('/home/voce/projetos-brabo');
  });

  it('recusa `~` em vez de expandir — o Compose também não expande', () => {
    const v = validarBase('~/projetos-brabo', { checkout: CHECKOUT });
    expect(v.ok).toBe(false);
    expect(v.motivo).toBe(RECUSA.TIL);
  });

  it('recusa caminho relativo, vazio e a raiz', () => {
    expect(validarBase('projetos', {}).motivo).toBe(RECUSA.RELATIVA);
    expect(validarBase('   ', {}).motivo).toBe(RECUSA.VAZIA);
    expect(validarBase('/', {}).motivo).toBe(RECUSA.RAIZ);
  });

  it('recusa a base sobreposta ao checkout, nos dois sentidos', () => {
    expect(validarBase(CHECKOUT, { checkout: CHECKOUT }).motivo).toBe(
      RECUSA.SOBREPOE_CHECKOUT,
    );
    expect(validarBase('/home/voce/dev', { checkout: CHECKOUT }).motivo).toBe(
      RECUSA.SOBREPOE_CHECKOUT,
    );
    expect(
      validarBase(`${CHECKOUT}/projetos`, { checkout: CHECKOUT }).motivo,
    ).toBe(RECUSA.SOBREPOE_CHECKOUT);
  });

  // A recusa NOVA do ADR 0146, e a que a escolha do nome só evita encostar:
  // duas raízes de donos opostos na mesma pasta física fariam um projeto
  // "Pasta montada" chamado `loja` cair sobre um projeto `container` cujo
  // `workspace_dir_name` também é `loja`.
  it('recusa a base sobreposta a PROJECT_WORKSPACES_HOST_DIR, nos dois sentidos', () => {
    const dentro = validarBase(`${GERENCIADA}/montados`, {
      checkout: CHECKOUT,
      raizGerenciada: GERENCIADA,
    });
    expect(dentro.ok).toBe(false);
    expect(dentro.motivo).toBe(RECUSA.SOBREPOE_GERENCIADA);
    expect(dentro.outro).toBe(GERENCIADA);

    const contendo = validarBase('/home/voce', {
      checkout: '/srv/brabo',
      raizGerenciada: GERENCIADA,
    });
    expect(contendo.motivo).toBe(RECUSA.SOBREPOE_GERENCIADA);

    expect(
      validarBase(GERENCIADA, { checkout: CHECKOUT, raizGerenciada: GERENCIADA })
        .motivo,
    ).toBe(RECUSA.SOBREPOE_GERENCIADA);
  });

  it('raiz gerenciada ausente não produz recusa — a variável vem comentada', () => {
    expect(validarBase('/home/voce/projetos-brabo', { checkout: CHECKOUT }).ok).toBe(
      true,
    );
    expect(
      validarBase('/home/voce/projetos-brabo', {
        checkout: CHECKOUT,
        raizGerenciada: '~/brabo-projetos',
      }).ok,
    ).toBe(true);
  });

  it('não confunde prefixo com contenção na raiz gerenciada', () => {
    expect(
      validarBase(`${GERENCIADA}2`, { checkout: CHECKOUT, raizGerenciada: GERENCIADA })
        .ok,
    ).toBe(true);
  });
});

describe('exigeProvaDeCompartilhamento', () => {
  // Segunda guarda de plataforma do produto, simétrica à primeira
  // (`validarDirDentroDoHomeNoLinux`, no runner): cada uma restringe só onde a
  // restrição significa alguma coisa.
  it('exige em macOS e Windows, onde há lista de compartilhamento', () => {
    expect(exigeProvaDeCompartilhamento('darwin')).toBe(true);
    expect(exigeProvaDeCompartilhamento('win32')).toBe(true);
  });

  it('não exige no Linux, onde o bind mount alcança o que o usuário alcança', () => {
    expect(exigeProvaDeCompartilhamento('linux')).toBe(false);
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
