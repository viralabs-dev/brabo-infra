/**
 * A pasta GERENCIADA no host, e se o broker vai conseguir montá-la (RN-599).
 *
 * POR QUE ISTO EXISTE. No compose de dev o broker sobe por padrão (RN-512), e o
 * modo `container` é o default da criação de projeto. Mas o `start` do broker
 * só monta a pasta do projeto se souber onde ela está NO HOST
 * (`PROJECT_WORKSPACES_HOST_ROOT`, ADR 0130) — e o compose de dev a DERIVA de
 * `PROJECT_WORKSPACES_HOST_DIR`, que vem comentada no `.env.example`. Sem ela,
 * api e engine escrevem no volume Docker gerenciado `project_workspaces` (que
 * não tem caminho de host que sirva a um `-v`), o stack sobe inteiro e verde, e
 * a falha só aparece quando alguém aprova `container_start`: o broker recusa
 * com "PROJECT_WORKSPACES_HOST_ROOT não está definida neste broker". O mesmo
 * molde do `DOCKER_GID` (`docker-gid.mjs`): errar não quebra o boot, quebra o
 * uso, longe da causa.
 *
 * RELATA e nunca recusa, nem grava: a resposta é um CAMINHO no disco de
 * alguém, e trocar o volume por uma pasta esconde o que já estiver no volume
 * (os dados ficam lá, só deixam de ser o que api e engine enxergam). Essa
 * decisão é de quem desenvolve, não do preflight.
 *
 * Módulo PRÓPRIO e puro, pelo mesmo motivo de `docker-gid.mjs`: importar
 * `preflight.mjs` rodaria o preflight inteiro. Aqui mora a DECISÃO; quem lê o
 * `.env` e imprime é o script.
 */

/**
 * Os desfechos, e eles não colapsam — cada um pede um conserto diferente.
 *
 * - `AUSENTE`: nenhuma das duas variáveis. É o estado de quem copiou o
 *   `.env.example` sem mexer, e o que o teste do dono mediu em 26/09.
 * - `OK`: a raiz efetiva é absoluta e é a MESMA pasta que api e engine montam.
 * - `NAO_ABSOLUTA`: a raiz efetiva não é absoluta — o caso real é o `~`. O
 *   Compose EXPANDE `~` na origem de um bind-mount (api e engine montam a pasta
 *   certa) mas NÃO numa variável de ambiente, então o broker recebe
 *   `~/brabo-projetos` literal e o `-v` do daemon não resolve (medido com
 *   `docker compose config`).
 * - `DIVERGENTE`: `PROJECT_WORKSPACES_HOST_ROOT` definida à mão e diferente da
 *   pasta que api e engine montam (inclusive quando elas montam o VOLUME, sem
 *   `PROJECT_WORKSPACES_HOST_DIR`): o container subiria com outra pasta, não a
 *   que os agentes escreveram.
 */
export const PASTA = {
  AUSENTE: 'ausente',
  OK: 'ok',
  NAO_ABSOLUTA: 'nao-absoluta',
  DIVERGENTE: 'divergente',
};

/** `" /a/b/ "` → `'/a/b'`; vazio/ausente → `null`. A raiz `/` fica `/`. */
export function normalizarCaminho(valor) {
  const bruto = String(valor ?? '').trim();
  if (bruto.length === 0) return null;
  const sem = bruto.replace(/\/+$/, '');
  return sem.length === 0 ? '/' : sem;
}

/**
 * O veredito, dado o que o `.env`/ambiente diz das duas variáveis.
 *
 * A raiz EFETIVA do broker segue a mesma precedência do compose de dev:
 * `${PROJECT_WORKSPACES_HOST_ROOT:-${PROJECT_WORKSPACES_HOST_DIR:-}}`.
 */
export function avaliarPastaGerenciada({ hostDir, hostRoot } = {}) {
  const dir = normalizarCaminho(hostDir);
  const root = normalizarCaminho(hostRoot);
  const efetiva = root ?? dir;
  const origem = root === null ? 'derivada' : 'explicita';

  if (efetiva === null) {
    return { estado: PASTA.AUSENTE, dir, efetiva: null, origem };
  }
  if (!efetiva.startsWith('/')) {
    return { estado: PASTA.NAO_ABSOLUTA, dir, efetiva, origem };
  }
  if (root !== null && root !== dir) {
    return { estado: PASTA.DIVERGENTE, dir, efetiva, origem };
  }
  return { estado: PASTA.OK, dir, efetiva, origem };
}

const RECRIAR =
  '            e recrie os serviços:  docker compose -f docker/docker-compose.yml \\\n' +
  '              --env-file .env up -d api engine broker\n';

/**
 * A mensagem. Diz o SINTOMA (onde a falha apareceria) e o CONSERTO, porque é
 * isso que evita a caçada — o mesmo contrato de `mensagemDoDockerGid`.
 */
export function mensagemDaPastaGerenciada(veredito) {
  const { estado, dir, efetiva } = veredito;

  if (estado === PASTA.OK) {
    return `[preflight] pasta gerenciada no host: ${efetiva}`;
  }

  if (estado === PASTA.AUSENTE) {
    return (
      '[preflight] PROJECT_WORKSPACES_HOST_DIR não configurada — o modo `container`\n' +
      '            não vai subir container. api e engine usam o volume Docker\n' +
      '            `project_workspaces`, que não tem caminho de host, e o broker\n' +
      '            fica sem PROJECT_WORKSPACES_HOST_ROOT: o stack sobe normalmente\n' +
      '            e `container_start` termina recusado ("PROJECT_WORKSPACES_HOST_ROOT\n' +
      '            não está definida neste broker").\n\n' +
      '            Para corrigir, crie uma pasta DEDICADA e grave no .env, com o\n' +
      '            caminho ABSOLUTO (sem `~`):\n' +
      '              PROJECT_WORKSPACES_HOST_DIR=/home/voce/brabo-projetos\n' +
      '              GIT_LOCAL_REPOS_HOST_DIR=/home/voce/brabo-projetos-bare\n' +
      RECRIAR +
      '            Trocar o volume pela pasta NÃO migra o que já estiver no volume\n' +
      '            `project_workspaces`: os dados ficam lá, só deixam de ser vistos.'
    );
  }

  if (estado === PASTA.NAO_ABSOLUTA) {
    return (
      `[preflight] a raiz do broker não é um caminho absoluto: ${efetiva}\n` +
      '            O Compose expande `~` na pasta que api e engine montam, mas NÃO\n' +
      '            na variável que o broker recebe — `container_start` vai falhar\n' +
      '            ao montar a pasta. Grave o caminho JÁ EXPANDIDO no .env\n' +
      '            (PROJECT_WORKSPACES_HOST_DIR e, se definida,\n' +
      '            PROJECT_WORKSPACES_HOST_ROOT), por exemplo /home/voce/brabo-projetos,\n' +
      RECRIAR.trimEnd()
    );
  }

  const montada = dir ?? 'o volume Docker `project_workspaces`';
  return (
    '[preflight] PROJECT_WORKSPACES_HOST_ROOT DIVERGE da pasta que api e engine montam.\n\n' +
    `              raiz do broker           ${efetiva}\n` +
    `              pasta de api e engine    ${montada}\n\n` +
    '            O container subiria com OUTRA pasta, não a que os agentes\n' +
    '            escreveram. Apague PROJECT_WORKSPACES_HOST_ROOT do .env (no compose\n' +
    '            de dev ela deriva de PROJECT_WORKSPACES_HOST_DIR) ou iguale as duas,\n' +
    RECRIAR.trimEnd()
  );
}
