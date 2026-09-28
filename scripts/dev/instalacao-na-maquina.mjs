/**
 * O compose de DEV e o de INSTALAÇÃO na MESMA máquina (AT-173, ADR 0170).
 *
 * POR QUE ISTO EXISTE. Até o ADR 0170 os dois composes declaravam `name: brabo`
 * e eram, para o Docker, o MESMO projeto: mesmos containers (`brabo-api-1`),
 * mesma rede, mesmos volumes (`brabo_pgdata`…). Subir um sobre o outro recriava
 * os containers e ligava o compose novo ao banco do outro (medido em 19/09: o
 * banco da instalação recebeu uma migration do dev), e o
 * `scripts/dev/reset-total.sh` faria `DROP SCHEMA … CASCADE` no Postgres da
 * instalação. O dev passou a se chamar `brabo-dev`; a instalação continua
 * `brabo` (é o que as máquinas instaladas têm, e mudar ali as quebraria).
 *
 * O nome resolve o caso comum. Esta guarda cobre o resto: quem sobe o compose
 * de dev com `-p brabo` à mão, com `COMPOSE_PROJECT_NAME=brabo` no `.env`, ou
 * de um checkout antigo. O preflight e o reset RECUSAM enquanto existir na
 * máquina container do compose de instalação — em qualquer estado, porque
 * container parado de pé é projeto `brabo` vivo para o Compose. O preço é
 * declarado no ADR: desenvolver numa máquina que tem instalação pede antes
 * `docker compose -f <compose da instalação> --env-file <.env dela> down` (SEM `-v`: os dados ficam).
 *
 * Módulo PURO, pelo motivo de `docker-gid.mjs`: importar `preflight.mjs`
 * rodaria o preflight inteiro. Aqui mora a DECISÃO sobre o que o Docker
 * respondeu; quem pergunta ao Docker e imprime é o script. O `reset-total.sh`
 * tem a MESMA régua em bash (`reset-total-lib.sh`), porque o spec dele roda com
 * um `node` de mentira no PATH — as duas são exercitadas pelos specs ao lado.
 */

/** O nome de projeto do compose de DEV. */
export const PROJETO_DE_DEV = 'brabo-dev';

/** O nome de projeto do compose de INSTALAÇÃO — e o do dev antes do ADR 0170. */
export const PROJETO_DA_INSTALACAO = 'brabo';

/**
 * O separador das linhas de `docker ps`/`docker volume ls --format`. Um
 * caractere que não aparece em nome de container, rótulo de projeto nem caminho
 * razoável — o mesmo que `donosContainer()` do preflight já usa.
 */
export const SEP = '§';

/** O formato de `docker ps -a` que `containersDaMaquina` entende. */
export const FORMATO_DE_CONTAINER =
  `{{.Names}}${SEP}{{.Label "com.docker.compose.project"}}${SEP}` +
  '{{.Label "com.docker.compose.project.config_files"}}';

/** O formato de `docker volume ls` que `volumesDaMaquina` entende. */
export const FORMATO_DE_VOLUME =
  `{{.Name}}${SEP}{{.Label "com.docker.compose.project"}}${SEP}` +
  '{{.Label "com.docker.compose.volume"}}';

/**
 * O compose de instalação aparece no rótulo `config_files` com um de dois
 * nomes: `docker/docker-compose.install.yml` (do checkout, e o destino em que o
 * `install.sh` grava o asset) e `brabo-install-compose.yml` (o NOME do asset na
 * Release, se alguém o usar sem renomear). O rótulo é uma lista separada por
 * vírgula, com caminhos absolutos.
 */
const ARQUIVO_DE_INSTALACAO = /(^|[/,])(docker-compose\.install\.yml|brabo-install-compose\.yml)(,|$)/;

/** O compose de DEV no rótulo: `…/docker/docker-compose.yml`, sozinho ou com overlays. */
const ARQUIVO_DE_DEV = /(^|[/,])docker-compose\.yml(,|$)/;

export function ehComposeDeInstalacao(configFiles) {
  return ARQUIVO_DE_INSTALACAO.test(String(configFiles ?? ''));
}

/** Linhas de `docker ps -a --format FORMATO_DE_CONTAINER` → objetos. */
export function containersDaMaquina(saida) {
  return String(saida ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [nome = '', projeto = '', configFiles = ''] = l.split(SEP);
      return { nome, projeto, configFiles };
    });
}

/** Os containers que vieram do compose de INSTALAÇÃO, em qualquer projeto. */
export function containersDaInstalacao(containers) {
  return containers.filter((c) => ehComposeDeInstalacao(c.configFiles));
}

/**
 * Os containers do compose de DEV que ainda rodam com o nome ANTIGO (`brabo`) —
 * o ambiente de quem desenvolvia antes do ADR 0170. Não são perigo por si (a
 * guarda de instalação cuida do perigo); são o motivo mais provável de o
 * preflight achar as portas ocupadas, e merecem a frase certa.
 */
export function containersDoDevAntigo(containers) {
  return containers.filter(
    (c) =>
      c.projeto === PROJETO_DA_INSTALACAO &&
      !ehComposeDeInstalacao(c.configFiles) &&
      ARQUIVO_DE_DEV.test(c.configFiles),
  );
}

/**
 * O `down` SEM `-v` de uma instalação. O compose de instalação interpola
 * variáveis obrigatórias (`BRABO_BROKER_IMAGE:?`) no arquivo INTEIRO, até para
 * `down`, e o `.env` dela mora na pasta da instalação — um nível ACIMA de
 * `docker/`, onde o `install.sh` grava o compose. Sem `--env-file` o comando
 * sugerido falharia.
 */
export function comandoDeDown(configFile) {
  const m = /^(.*)\/docker\/(docker-compose\.install\.yml|brabo-install-compose\.yml)$/.exec(configFile);
  const env = m ? `${m[1] || ''}/.env` : '<.env da instalação>';
  return `docker compose -f ${configFile} --env-file ${env} down`;
}

/** A recusa, nomeando o que foi achado e o que fazer. */
export function mensagemDeInstalacaoPresente(achados, quem = 'preflight') {
  const linhas = achados.map(
    (c) => `  ${c.nome}  (projeto ${c.projeto || '?'}, ${c.configFiles || 'sem rótulo de arquivo'})`,
  );
  const arquivos = [...new Set(achados.map((c) => c.configFiles.split(',')[0]).filter(Boolean))];
  const comoParar = arquivos.length > 0 ? arquivos : ['<pasta da instalação>/docker/docker-compose.install.yml'];
  return (
    `[${quem}] RECUSADO: esta máquina tem containers do compose de INSTALAÇÃO do Brabo:\n\n` +
    `${linhas.join('\n')}\n\n` +
    'Até o ADR 0170 o compose de dev e o de instalação eram o MESMO projeto Docker\n' +
    '(`brabo`): subir um sobre o outro liga o dev ao banco da instalação, e o\n' +
    'reset total apagaria esse banco. O dev agora é `brabo-dev`, mas um `-p brabo`\n' +
    'à mão, um `COMPOSE_PROJECT_NAME` no .env ou um checkout antigo refazem o\n' +
    'acidente — por isso, com a instalação presente, nada do dev sobe.\n\n' +
    'Para desenvolver nesta máquina, derrube a instalação SEM `-v` (os volumes\n' +
    'e os dados dela ficam intactos; ela volta com `up -d` quando quiser):\n' +
    comoParar.map((f) => `  ${comandoDeDown(f)}\n`).join('') +
    '\nNada foi parado nem apagado.'
  );
}

/**
 * O projeto que o compose de dev vai usar (`docker compose config`, que já
 * aplica `-p`/`COMPOSE_PROJECT_NAME`/`name:`), quando ele colide com o da
 * instalação. O nome certo é `brabo-dev`; `brabo` é recusado mesmo sem
 * instalação na máquina, porque é o nome que uma instalação criada depois
 * reusaria — com estes volumes.
 */
export function projetoDeDevProibido(projeto) {
  return projeto === PROJETO_DA_INSTALACAO;
}

export function mensagemDeProjetoProibido(projeto, quem = 'preflight') {
  return (
    `[${quem}] RECUSADO: o compose de dev resolveria o projeto Docker \`${projeto}\`,\n` +
    `            que é o nome do compose de INSTALAÇÃO (ADR 0170). O nome do dev\n` +
    `            é \`${PROJETO_DE_DEV}\` (\`name:\` em docker/docker-compose.yml).\n` +
    '            Tire `COMPOSE_PROJECT_NAME` do .env/ambiente, ou não passe `-p`.\n' +
    '            Nada foi parado nem apagado.'
  );
}

// ----------------------------------------------------------- volumes órfãos

/**
 * As chaves do bloco `volumes:` de TOPO de um compose (não os `volumes:` de
 * serviço, que são indentados). Derivado do arquivo e nunca copiado: volume
 * novo entra sozinho na régua que distingue dev de instalação.
 */
export function volumesDoTopo(textoDoCompose) {
  const chaves = [];
  let dentro = false;
  for (const linha of String(textoDoCompose).split('\n')) {
    if (/^volumes:\s*$/.test(linha)) {
      dentro = true;
      continue;
    }
    if (!dentro) continue;
    if (/^\S/.test(linha)) break; // próxima chave de topo
    const m = /^ {2}([A-Za-z0-9_.-]+):\s*(#.*)?$/.exec(linha);
    if (m) chaves.push(m[1]);
  }
  return chaves;
}

/**
 * Os volumes que SÓ o compose de dev declara (`node_modules`, `_build`, `deps`,
 * `.mix`, `.hex`…). Um volume `brabo_<chave>` com uma destas chaves só pode ter
 * nascido do compose de dev com o nome antigo — é assim que se distingue o
 * volume órfão de dev do de uma instalação. As chaves COMUNS aos dois
 * (`pgdata`, `neo4j_data`, `git_local_repos`, `project_workspaces`…) não
 * distinguem nada sozinhas.
 */
export function volumesSoDeDev(textoDoComposeDeDev, textoDoComposeDeInstalacao) {
  const daInstalacao = new Set(volumesDoTopo(textoDoComposeDeInstalacao));
  return volumesDoTopo(textoDoComposeDeDev).filter((v) => !daInstalacao.has(v));
}

/** Linhas de `docker volume ls --format FORMATO_DE_VOLUME` → objetos. */
export function volumesDaMaquina(saida) {
  return String(saida ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [nome = '', projeto = '', chave = ''] = l.split(SEP);
      return { nome, projeto, chave };
    });
}

/**
 * O veredito sobre os volumes `brabo_*`. `null` quando não há o que avisar:
 * nenhum volume do projeto `brabo` com chave exclusiva de dev. Quando há, a
 * lista vem separada em duas — os que PROVAM ser do dev antigo e os de chave
 * comum, que podem ser do dev antigo OU de uma instalação e que o aviso não
 * afirma de quem são.
 */
export function volumesDeDevOrfaos(volumes, soDeDev) {
  const doProjeto = volumes.filter((v) => v.projeto === PROJETO_DA_INSTALACAO);
  const exclusivos = new Set(soDeDev);
  const deDev = doProjeto.filter((v) => exclusivos.has(v.chave));
  if (deDev.length === 0) return null;
  const comuns = doProjeto.filter((v) => !exclusivos.has(v.chave));
  return { deDev, comuns };
}

export function mensagemDeVolumesOrfaos({ deDev, comuns }) {
  const nomes = (lista) => lista.map((v) => v.nome).join(', ');
  return (
    '[preflight] AVISO: há volumes do compose de dev com o nome ANTIGO (projeto `brabo`,\n' +
    `            antes do ADR 0170): ${nomes(deDev)}.\n` +
    (comuns.length > 0
      ? `            Com chave comum ao compose de instalação (podem ser do dev antigo OU\n` +
        `            de uma instalação nesta máquina — confira antes de mexer): ${nomes(comuns)}.\n`
      : '') +
    `            O dev agora é \`${PROJETO_DE_DEV}\` e sobe com volumes NOVOS e vazios; os\n` +
    '            dados antigos continuam nesses volumes. Para copiá-los ou recomeçar do\n' +
    '            zero, veja o runbook, "Moving a dev environment to brabo-dev".\n' +
    '            Nada foi apagado, e o preflight nunca apaga volume.'
  );
}
