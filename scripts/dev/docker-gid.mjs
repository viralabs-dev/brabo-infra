/**
 * O gid do grupo `docker`, e se o que o compose vai usar bate com ele
 * (ADR 0146, ponto 3).
 *
 * POR QUE ISTO PASSOU A IMPORTAR. Enquanto o broker subia sob
 * `profiles: ["container-broker"]`, um `DOCKER_GID` errado só afetava quem
 * tinha ligado o profile de propósito — alguém que estava, por definição,
 * prestando atenção nele. Com o broker subindo por padrão no compose local, o
 * mesmo erro passa a valer para qualquer pessoa que rode `pnpm dev`, e o
 * sintoma aparece longe da causa: não no `up`, que sobe normalmente, mas muito
 * depois, quando alguém propõe `container_start` e toda operação morre com
 * "permission denied" no socket.
 *
 * O socket é `root:docker` no host e o processo do broker roda non-root; o
 * `group_add` do compose é o que lhe dá o grupo. Errar o gid não quebra o
 * boot, quebra o uso.
 *
 * Módulo PRÓPRIO e puro, pelo mesmo motivo de `base-de-projetos.mjs` e
 * `env-file.mjs`: `preflight.mjs` roda `await main()` no topo, então importar
 * qualquer coisa dele subiria o preflight inteiro. Aqui mora a DECISÃO; quem
 * chama `getent` e imprime é o script.
 */

/**
 * O default que `docker/docker-compose.yml` aplica quando `DOCKER_GID` não
 * está definida (`group_add: - "${DOCKER_GID:-999}"`).
 *
 * Duplicado aqui de propósito, e não lido do compose: o preflight precisa
 * saber o que vai valer ANTES de o compose rodar, e ler YAML para descobrir um
 * literal custaria mais do que o teste que trava os dois juntos.
 */
export const GID_PADRAO_DO_COMPOSE = '999';

/**
 * Os três desfechos, e eles não colapsam.
 *
 * `NAO_SE_APLICA` não é um erro nem um "não consegui": em macOS e Windows o
 * Docker Desktop não usa grupo unix nenhum, e num Docker rootless o socket é
 * do próprio usuário. Tratar a ausência do grupo como divergência acusaria
 * metade das máquinas de um defeito que elas não têm — o mesmo erro que
 * `baseSobrepoeOCheckout` evita ao devolver `false` para checkout
 * desconhecido.
 */
export const GID = {
  NAO_SE_APLICA: 'nao-se-aplica',
  OK: 'ok',
  DIVERGENTE: 'divergente',
};

/** `"984"`, `" 984 "` → `'984'`; vazio/ausente/não-numérico → `null`. */
export function normalizarGid(valor) {
  const bruto = String(valor ?? '').trim();
  if (bruto.length === 0) return null;
  return /^[0-9]+$/.test(bruto) ? bruto : null;
}

/**
 * O veredito, dado o gid real do grupo e o que o `.env`/ambiente diz.
 *
 * Devolve também a ORIGEM do valor efetivo (`configurado` × `default`), porque
 * as duas divergências pedem instruções diferentes: quem nunca definiu a
 * variável precisa saber que existe um default e que ele errou; quem a definiu
 * precisa saber que o número dela não é o da máquina.
 *
 * `gidDoGrupo` ausente vence tudo: sem grupo `docker` não há o que comparar.
 */
export function avaliarDockerGid({ gidDoGrupo, valorConfigurado } = {}) {
  const real = normalizarGid(gidDoGrupo);
  const configurado = normalizarGid(valorConfigurado);
  const efetivo = configurado ?? GID_PADRAO_DO_COMPOSE;
  const origem = configurado === null ? 'default' : 'configurado';

  if (real === null) {
    return { estado: GID.NAO_SE_APLICA, gidDoGrupo: null, efetivo, origem };
  }
  return {
    estado: real === efetivo ? GID.OK : GID.DIVERGENTE,
    gidDoGrupo: real,
    efetivo,
    origem,
  };
}

/**
 * A mensagem — que é o produto deste relato tanto quanto o veredito.
 *
 * Nunca bloqueia e nunca pergunta: `pnpm dev` sobe do mesmo jeito, e o broker
 * também. O que ela evita é a descoberta tardia, quando o socket recusa e o
 * erro chega pelo `DockerIndisponivelError`, três telas adiante da causa.
 */
export function mensagemDoDockerGid(veredito) {
  const { estado, gidDoGrupo, efetivo, origem } = veredito;

  if (estado === GID.NAO_SE_APLICA) {
    return (
      '[preflight] sem grupo `docker` nesta máquina — DOCKER_GID não se aplica\n' +
      '            (Docker Desktop ou rootless não usam grupo unix).'
    );
  }
  if (estado === GID.OK) {
    return `[preflight] DOCKER_GID: ${efetivo} (grupo docker=${gidDoGrupo})`;
  }

  const comoCorrigir =
    origem === 'default'
      ? `            DOCKER_GID não está definida, então vale o default ${efetivo} do\n` +
        `            compose. Grave no .env:  DOCKER_GID=${gidDoGrupo}\n`
      : `            DOCKER_GID=${efetivo} no seu .env não é o gid desta máquina.\n` +
        `            Corrija para:  DOCKER_GID=${gidDoGrupo}\n`;

  return (
    `[preflight] DOCKER_GID DIVERGE — o broker não vai conseguir usar o socket.\n\n` +
    `              grupo docker da máquina  ${gidDoGrupo}\n` +
    `              o que o compose vai usar ${efetivo} (${origem})\n\n` +
    comoCorrigir +
    '            e recrie o serviço:  docker compose -f docker/docker-compose.yml \\\n' +
    '              --env-file .env up -d broker\n\n' +
    '            O broker sobe por padrão desde o ADR 0146 e é quem fala com o\n' +
    '            Docker do host. Com o gid errado ele sobe normalmente e só falha\n' +
    '            quando alguém propõe `container_start`, com "permission denied"\n' +
    '            no socket — longe daqui.'
  );
}
