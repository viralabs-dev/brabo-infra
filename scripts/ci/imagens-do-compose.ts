/**
 * imagens-do-compose — lê do compose de DEV as imagens de terceiro que os
 * `services:` dos workflows usam, e as entrega como `outputs` de um job
 * (AT-246, ADR 0197).
 *
 * ## Por que existe
 *
 * Até o ADR 0197, `pgvector` e `ollama` moravam DUAS vezes: no compose e,
 * como literal, nos `services:` de `ci.yml`/`golden-set-*.yml`. O ADR 0178
 * deixou o Dependabot de imagem desligado por causa disso: nenhum ecossistema
 * dele lê `services:` de workflow, então todo PR do bot que subisse uma das
 * duas no compose nasceria vermelho pela regra "mesma tag, dois digests" de
 * `imagens-pinadas.ts` — e o passo que alinharia o workflow no PR do bot teria
 * de empurrar commit em `.github/workflows/`, o que o `GITHUB_TOKEN` não pode.
 *
 * A decisão do dono (01/10) foi tirar o literal dos workflows: duplicata que
 * não existe não diverge. O `image:` de um `services:` aceita o contexto
 * `needs`, então o workflow reutilizável `.github/workflows/imagens-do-compose.yml`
 * roda ESTE script num job anterior, e os `services:` leem
 * `${{ needs.<job>.outputs.<imagem> }}`. O PR do bot mexe só no compose, e o
 * CI daquele PR já roda contra a imagem nova.
 *
 * ## O que ele recusa
 *
 * - serviço que não existe no compose, ou que existe sem `image:` (renomear o
 *   serviço no compose sem atualizar a tabela abaixo derruba o CI na hora,
 *   em vez de entregar uma string vazia ao `services:`);
 * - referência que não está na forma `imagem:tag@sha256:<índice>` (ADR 0178).
 *   O `imagens-pinadas.ts` já reprova isso no compose, no job `lint`; aqui é a
 *   segunda porta, porque o job que LÊ não pode depender de o `lint` ter rodado
 *   antes — e um `image:` mutável no runner do CI é exatamente o que a regra
 *   existe para impedir.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { partesDaReferencia, referenciaPresaPorDigest } from './imagens-pinadas.ts';

/** De onde cada `output` do workflow reutilizável vem. */
export interface OrigemDaImagem {
  /** Caminho do compose, relativo à raiz do repositório. */
  compose: string;
  /** Nome do serviço dentro do compose. */
  servico: string;
}

/**
 * A tabela. A chave é o nome do `output` — o que os workflows escrevem em
 * `needs.<job>.outputs.<chave>`. As duas leem o compose de DEV: é o que o
 * `golden-set-rag.yml` sempre prometeu ("a MESMA versão pinada de
 * docker/docker-compose.yml", porque o piso do golden-set é chaveado por
 * MODELO e não por ambiente), e é o mesmo Postgres contra o qual as suítes
 * de api e engine rodam em dev.
 */
export const IMAGENS_DOS_WORKFLOWS: Readonly<Record<string, OrigemDaImagem>> = {
  pgvector: { compose: 'docker/docker-compose.yml', servico: 'postgres' },
  ollama: { compose: 'docker/docker-compose.yml', servico: 'ollama' },
};

const IMAGE = /^\s+image:\s*(\S+)(?:\s+#.*)?\s*$/;

function indentacao(linha: string): number {
  return linha.length - linha.trimStart().length;
}

function ehSignificativa(linha: string): boolean {
  const aparada = linha.trim();
  return aparada.length > 0 && !aparada.startsWith('#');
}

function semAspas(valor: string): string {
  const primeiro = valor.charAt(0);
  if ((primeiro === '"' || primeiro === "'") && valor.endsWith(primeiro) && valor.length > 1) {
    return valor.slice(1, -1);
  }
  return valor;
}

/**
 * O `image:` do serviço, lido por linha (sem dependência: o job que roda isto
 * não instala `node_modules`). O serviço é a chave filha direta de `services:`;
 * o `image:` é a chave filha direta do serviço — um `image:` mais fundo (num
 * `x-` ou num mapa aninhado) não é o do serviço.
 *
 * @throws Error nomeando o serviço e o motivo
 */
export function imagemDoServico(conteudo: string, servico: string): string {
  const linhas = conteudo.split('\n');
  const inicioDeServices = linhas.findIndex((linha) => /^services:\s*(#.*)?$/.test(linha));
  if (inicioDeServices === -1) {
    throw new Error('o compose não tem a chave `services:` na raiz');
  }

  let nivelDoServico: number | undefined;
  let dentro = false;
  let nivelDaChave: number | undefined;
  const achadas: string[] = [];

  for (const linha of linhas.slice(inicioDeServices + 1)) {
    if (!ehSignificativa(linha)) continue;
    const nivel = indentacao(linha);
    if (nivel === 0) break; // saiu de `services:`

    nivelDoServico ??= nivel;
    if (nivel === nivelDoServico) {
      dentro = linha.trim() === `${servico}:`;
      nivelDaChave = undefined;
      continue;
    }
    if (!dentro || nivel < nivelDoServico) continue;

    nivelDaChave ??= nivel;
    if (nivel !== nivelDaChave) continue;

    const achado = IMAGE.exec(linha);
    if (achado !== null) achadas.push(semAspas(achado[1] ?? ''));
  }

  if (achadas.length === 0) {
    throw new Error(`o serviço \`${servico}\` não existe no compose, ou não tem \`image:\``);
  }
  if (achadas.length > 1) {
    throw new Error(`o serviço \`${servico}\` tem ${achadas.length} chaves \`image:\` — YAML inválido`);
  }

  const referencia = achadas[0] ?? '';
  if (!referenciaPresaPorDigest(referencia) || partesDaReferencia(referencia).tag === undefined) {
    throw new Error(
      `o serviço \`${servico}\` usa \`${referencia}\`, fora da forma \`<imagem>:<tag>@sha256:<índice>\` ` +
        '(ADR 0178). O runner do CI não sobe imagem mutável.',
    );
  }
  return referencia;
}

/**
 * Resolve a tabela inteira. Lê cada compose UMA vez.
 *
 * @param ler - lê um caminho relativo à raiz (injetado para o spec)
 */
export function resolverImagens(
  ler: (caminho: string) => string,
  tabela: Readonly<Record<string, OrigemDaImagem>> = IMAGENS_DOS_WORKFLOWS,
): Record<string, string> {
  const cache = new Map<string, string>();
  const resolvidas: Record<string, string> = {};
  for (const [saida, { compose, servico }] of Object.entries(tabela)) {
    const conteudo = cache.get(compose) ?? ler(compose);
    cache.set(compose, conteudo);
    try {
      resolvidas[saida] = imagemDoServico(conteudo, servico);
    } catch (erro) {
      throw new Error(`${compose} → \`${saida}\`: ${(erro as Error).message}`);
    }
  }
  return resolvidas;
}

// --- CLI: `node scripts/ci/imagens-do-compose.ts` --------------------------

function principal(): void {
  const raiz = fileURLToPath(new URL('../..', import.meta.url));
  let imagens: Record<string, string>;
  try {
    imagens = resolverImagens((caminho) => readFileSync(`${raiz}${caminho}`, 'utf8'));
  } catch (erro) {
    console.error(`::error::imagens-do-compose: ${(erro as Error).message}`);
    process.exit(1);
  }

  const linhas = Object.entries(imagens).map(([saida, referencia]) => `${saida}=${referencia}`);
  for (const linha of linhas) console.log(linha);

  const saida = process.env['GITHUB_OUTPUT'];
  if (saida !== undefined && saida.length > 0) appendFileSync(saida, `${linhas.join('\n')}\n`);

  const resumo = process.env['GITHUB_STEP_SUMMARY'];
  if (resumo !== undefined && resumo.length > 0) {
    const tabela = Object.entries(imagens)
      .map(([nome, referencia]) => `| \`${nome}\` | \`${referencia}\` |`)
      .join('\n');
    appendFileSync(resumo, `### Imagens lidas do compose\n\n| output | imagem |\n|---|---|\n${tabela}\n`);
  }
}

if (process.argv[1]?.endsWith('imagens-do-compose.ts')) {
  principal();
}
