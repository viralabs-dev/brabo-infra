/**
 * A base dos projetos montados, vista DO HOST (ADR 0141, RN-500).
 *
 * POR QUE ESTE MÓDULO EXISTE, e por que a checagem não mora na api.
 *
 * `caminhoDeWorkspaceLocalValido` (api) já recusa uma pasta de projeto que se
 * sobreponha ao checkout do Brabo, nos dois sentidos — é a regra do ADR 0055,
 * e ela funciona. Só que o checkout com que ela compara é `process.cwd()`, que
 * DENTRO do container da api é `/workspace`. O checkout de verdade, o que está
 * no disco de quem desenvolve, ela não tem como conhecer.
 *
 * Isso deixa passar exatamente o caso que o produto agora sugere por padrão:
 * quem clona o Brabo em `$HOME/brabo` e configura `BRABO_PROJECTS_BASE` na
 * MESMA pasta passa por toda validação existente — a api compara contra
 * `/workspace`, nunca contra `$HOME/brabo` — e os dev agents passam a
 * executar dentro da árvore do próprio produto. É a falha que o ADR 0055
 * existe para impedir, entrando por uma porta que ele não vigia.
 *
 * O preflight roda NO HOST. Ele consegue responder o que a api não consegue,
 * e por isso a guarda mora aqui. Módulo próprio, e não uma função dentro de
 * `preflight.mjs`, porque aquele arquivo executa `await main()` no topo:
 * importá-lo de um teste subiria o preflight inteiro, com `docker` e tudo.
 */

/**
 * `/home/voce/brabo//` → `/home/voce/brabo`; string vazia/só de espaços →
 * `null`.
 *
 * Sem regex de barras finais (`\/+$`): é a forma que o CodeQL já apontou como
 * ReDoS polinomial neste mesmo produto, e a api a evita pelo mesmo motivo em
 * `normalizarSemBarraFinal`. Aqui o laço faz o mesmo em O(n).
 *
 * NÃO expande `~` nem resolve caminho relativo, de propósito: o Compose também
 * não expande, e "corrigir" aqui faria o preflight aprovar uma base que o
 * Docker montaria em outro lugar — o preflight passaria a mentir.
 */
export function normalizarBase(valor) {
  const bruto = (valor ?? '').trim();
  if (bruto.length === 0) return null;
  let fim = bruto.length;
  while (fim > 1 && bruto[fim - 1] === '/') fim--;
  return bruto.slice(0, fim);
}

/**
 * `caminho` está sob `raiz` (ou é a própria raiz)?
 *
 * A barra é o que separa `/home/voce/brabo2` de `/home/voce/brabo`: sem ela, a
 * comparação de prefixo diria que o primeiro está dentro do segundo, que é a
 * armadilha clássica. Mesma semântica de `dentroDoEscopo`, na api.
 */
function dentroDe(caminho, raiz) {
  // A raiz `/` vira string VAZIA na comparação, e é assim que `startsWith('/')`
  // volta a valer para todo caminho absoluto — sem isto, `${'/'}/` seria `//` e
  // `BRABO_PROJECTS_BASE=/` (a base que contém o checkout inteiro, e tudo o
  // mais) passaria. `semBarraFinal`, na api, faz exatamente a mesma redução
  // pelo mesmo motivo. `normalizarBase` continua devolvendo `/` porque ela
  // também alimenta a MENSAGEM, e uma linha dizendo `base:` seguida de nada
  // não ensina ninguém.
  const r = raiz === '/' ? '' : raiz;
  return caminho === raiz || caminho.startsWith(`${r}/`);
}

/**
 * A base se sobrepõe ao checkout do Brabo — NOS DOIS SENTIDOS?
 *
 * Os dois, e não só um: "a base contém o checkout" (`BRABO_PROJECTS_BASE=/`,
 * ou `$HOME` com o Brabo dentro) e "o checkout contém a base"
 * (`$HOME/brabo/projetos` com o Brabo clonado em `$HOME/brabo`). Recusar um e
 * permitir o outro é fechar a porta e deixar a janela — a mesma frase que a
 * api usa para a checagem equivalente dela.
 *
 * Base ausente devolve `false`: não há sobreposição possível com uma base que
 * não existe, e uma instalação sem base é o estado normal de quem só usa o
 * modo `container`. Checkout desconhecido (fora de um repositório git, `git`
 * indisponível) também devolve `false` — o preflight avisa e sai da frente
 * quando não consegue afirmar, nunca bloqueia por defeito próprio.
 */
export function baseSobrepoeOCheckout(base, checkout) {
  const b = normalizarBase(base);
  const c = normalizarBase(checkout);
  if (b === null || c === null) return false;
  return dentroDe(b, c) || dentroDe(c, b);
}

/**
 * A mensagem — que é o produto desta guarda tanto quanto a recusa.
 *
 * Diz os dois caminhos que colidiram, POR QUE isso é grave (não é arrumação:
 * é o agente executando na árvore do produto) e por que nenhuma outra
 * validação pegaria (a api compara contra `/workspace`).
 */
export function mensagemDeBaseSobreposta(base, checkout) {
  const b = normalizarBase(base);
  const c = normalizarBase(checkout);
  return (
    `\n[preflight] BRABO_PROJECTS_BASE se sobrepõe ao checkout do Brabo.\n\n` +
    `  BRABO_PROJECTS_BASE  ${b}\n` +
    `  checkout do Brabo    ${c}\n\n` +
    'A base é onde moram as pastas dos projetos no modo "Pasta montada", e os\n' +
    'agentes de dev executam comandos dentro delas. Com ela sobreposta ao\n' +
    'checkout, esses comandos rodam na árvore do PRÓPRIO Brabo — que é a falha\n' +
    'que o ADR 0055 existe para impedir.\n\n' +
    'Nenhuma outra validação pega este caso: a api compara o caminho do projeto\n' +
    'contra o checkout que ELA enxerga, que dentro do container dela é\n' +
    '/workspace — nunca o caminho real no seu disco. Só o preflight, que roda\n' +
    'no host, tem como saber.\n\n' +
    'Aponte a base para uma pasta DEDICADA, fora do checkout e sem contê-lo:\n\n' +
    `  BRABO_PROJECTS_BASE=$HOME/brabo-projetos-montados\n\n` +
    'Ver .env.example (bloco "A base dos projetos no modo Pasta montada") e\n' +
    'docs/adr/0141-base-unica-dos-projetos-montados.md.\n'
  );
}
