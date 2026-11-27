/**
 * Guarda de broker velho (AT-1015, RN-1541).
 *
 * O broker é o ÚNICO serviço do compose de dev com o código DENTRO da imagem
 * (`brabo-broker:dev`, `build:`); api e engine montam o clone. Um `up` sem
 * `--build` reaproveita a imagem antiga e o ambiente roda um broker que não é
 * o do clone, sem aviso — foi o TP-01 31ª (27/11).
 *
 * Critério 1 (exato): a imagem leva o rótulo `org.opencontainers.image.revision`
 * (build-arg `BROKER_REVISION` no `Dockerfile.dev` do broker) e ele tem de ser o
 * HEAD do clone. Critério 2 (enquanto o rótulo não existir): a imagem não pode
 * ser mais velha que o último commit do clone. Ele erra para o lado seguro (um
 * commit só de docs também reprova), e o conserto custa um build em cache.
 */

export const ROTULO_DE_REVISAO = 'org.opencontainers.image.revision';

export const ESTADO = {
  OK: 'ok',
  SEM_IMAGEM: 'sem-imagem',
  INDETERMINADO: 'indeterminado',
  REVISAO_DIVERGENTE: 'revisao-divergente',
  VELHA_PELA_DATA: 'velha-pela-data',
};

export const COMANDO_DE_CONSERTO =
  'docker compose -f docker/docker-compose.yml --env-file .env build broker';

/**
 * @param {{ revisaoDaImagem?: string|null, criadaEm?: string|null, headDoClone?: string|null, ultimoCommitEm?: string|null }|null} dados
 *   `null` em `dados` = imagem inexistente (o `up` vai construí-la).
 */
export function avaliarBrokerDoClone(dados) {
  if (dados === null) return { estado: ESTADO.SEM_IMAGEM };
  const { revisaoDaImagem, criadaEm, headDoClone, ultimoCommitEm } = dados;
  if (!headDoClone) return { estado: ESTADO.INDETERMINADO };
  if (revisaoDaImagem) {
    return revisaoDaImagem === headDoClone
      ? { estado: ESTADO.OK }
      : { estado: ESTADO.REVISAO_DIVERGENTE, revisaoDaImagem, headDoClone };
  }
  const imagem = Date.parse(criadaEm ?? '');
  const commit = Date.parse(ultimoCommitEm ?? '');
  if (Number.isNaN(imagem) || Number.isNaN(commit)) return { estado: ESTADO.INDETERMINADO };
  return imagem < commit
    ? { estado: ESTADO.VELHA_PELA_DATA, criadaEm, ultimoCommitEm }
    : { estado: ESTADO.OK, semRotulo: true };
}

/** Texto para o terminal; `null` quando não há nada a dizer. */
export function mensagemDoBroker(veredito) {
  const { estado } = veredito;
  const semRotulo =
    `[preflight] AVISO: a imagem brabo-broker:dev não tem o rótulo ${ROTULO_DE_REVISAO};\n` +
    '            comparei a data da imagem com a do último commit do clone do broker.\n';
  const conserto =
    '\nPara consertar, reconstrua o broker e suba de novo:\n\n' +
    `  ${COMANDO_DE_CONSERTO}\n\n` +
    'ou use `make dev`, que já reconstrói. Sem isso o ambiente roda um broker\n' +
    'diferente do código que você está vendo, e as correções dele não valem.\n';
  if (estado === ESTADO.REVISAO_DIVERGENTE) {
    return (
      '[preflight] RECUSADO: o broker que está pronto para subir não é o do seu clone.\n' +
      `            A imagem brabo-broker:dev foi feita da revisão ${veredito.revisaoDaImagem.slice(0, 12)},\n` +
      `            e o clone do broker está na ${veredito.headDoClone.slice(0, 12)}.\n` +
      conserto
    );
  }
  if (estado === ESTADO.VELHA_PELA_DATA) {
    return (
      semRotulo +
      '[preflight] RECUSADO: a imagem brabo-broker:dev é mais antiga que o último commit do clone do broker\n' +
      `            (imagem de ${veredito.criadaEm}; commit de ${veredito.ultimoCommitEm}).\n` +
      conserto
    );
  }
  if (estado === ESTADO.OK && veredito.semRotulo) return semRotulo.trimEnd();
  return null;
}

export const recusa = (veredito) =>
  veredito.estado === ESTADO.REVISAO_DIVERGENTE || veredito.estado === ESTADO.VELHA_PELA_DATA;
