/**
 * imagens-pinadas — reprova qualquer imagem de terceiro presa a uma referência
 * MUTÁVEL (tag) em vez de um digest, todo digest sem a tag INLINE, e todo
 * comentário de tag que diverge dela.
 *
 * ## É o IRMÃO de `actions-pinadas.ts`, não uma extensão dele
 *
 * O argumento é o mesmo, palavra por palavra: tag é um ponteiro que o dono da
 * imagem pode remover e recriar apontando para outro conteúdo — `neo4j:5.26-
 * community` hoje e amanhã podem ser bytes diferentes, sem nenhum sinal neste
 * repositório. Digest não se move: é o próprio conteúdo.
 *
 * O que muda é ONDE quem move a tag executa. Numa action, no runner que tem o
 * checkout e as credenciais. Numa imagem, em três lugares piores: dentro da
 * imagem que publicamos no GHCR (as bases dos `FROM`), ao lado do Postgres de
 * quem instalou o produto (`docker-compose.install.yml`), e como `services:`
 * de um job do CI (`ci.yml`/`golden-set-*.yml`), que é literalmente o runner
 * que a regra das actions existe para proteger.
 *
 * São dois checks e não um só porque são duas perguntas: `uses:` mora em YAML
 * de workflow com uma sintaxe; `image:`/`imageName:`/`FROM` moram em compose,
 * em manifest do kustomize e em Dockerfile, com outras três.
 *
 * ## A forma: `imagem:tag@sha256:<índice>` — a tag DENTRO da referência
 *
 * Desde o ADR 0178 (sobre o ADR 0159), a tag mora na própria referência, antes
 * do digest. Até ali ela morava num comentário (`imagem@sha256:…  # tag`, e em
 * Dockerfile na linha de cima), e a medição de 27/09 da AT-139 mostrou o preço:
 * o Dependabot não lê comentário em formato nenhum, e um pin só de digest ele
 * atualiza para o digest da `latest` — o comentário ficaria mentindo com o lint
 * verde. Com a tag inline, o Docker e o Dependabot leem a MESMA tag que um
 * humano lê, e o digest continua sendo quem decide o conteúdo (com os dois, o
 * Docker puxa pelo digest).
 *
 * Três consequências para o check:
 *
 * - digest SEM tag inline reprova, mesmo com a tag num comentário — é a forma
 *   antiga, e é a que o bot atualizaria para a `latest`;
 * - comentário de tag continua PERMITIDO, mas só se disser a mesma coisa: um
 *   comentário que é UMA tag (um token com dígito) diferente da inline reprova,
 *   porque é justamente o que ficaria para trás quando alguém (ou o bot) sobe a
 *   referência. Em YAML ele é o de fim de linha; em Dockerfile, a linha de cima;
 * - em Dockerfile, comentário no FIM da linha do `FROM` continua reprovado: o
 *   parser do Docker só reconhece `#` no INÍCIO da linha, e `FROM x # y` morre
 *   em `FROM requires either one or three arguments` (o `hadolint`, que tem
 *   parser próprio, passava — ADR 0159).
 *
 * ## O que este check NÃO cobra, e por quê
 *
 * - **As cinco imagens do PRÓPRIO produto** (`brabo-api`, `brabo-engine`,
 *   `brabo-web`, `brabo-backup` e `brabo-broker` — esta publicada desde o
 *   ADR 0162).
 *   Não há terceiro que possa mover ponteiro nenhum: quem as constrói é este
 *   repositório. `brabo-api:prod` é uma tag LOCAL, produzida por `docker
 *   compose build` — o digest dela não existe antes do build e muda a cada
 *   build, então exigir um literal aqui seria exigir o impossível. E onde elas
 *   de fato atravessam um registry, JÁ vão por digest, por um mecanismo que é
 *   o dono delas: `.release/images.json` gravado pelo `release.yml` e aplicado
 *   por `make imagens-do-release` (ADR 0119). O overlay guarda o MARCADOR e
 *   não uma release congelada — cobrar um digest literal ali brigaria com o
 *   mecanismo em vez de reforçá-lo.
 * - **Referência com interpolação** (`${BRABO_API_IMAGE:?…}`). É o mesmo caso
 *   visto do outro lado: o `install.sh` grava as imagens no `.env` já por
 *   digest, e um literal não cabe numa variável.
 * - **Estágio de build multi-stage** (`FROM deps AS build`, `FROM scratch`).
 *   Não é imagem de registry.
 *
 * A lista de exceções é por NOME e falha fechado: imagem de terceiro nova
 * nunca casa com `brabo-`, então nasce cobrada.
 *
 * ## O quarto motivo: digest divergente para a mesma tag
 *
 * `golden-set-rag.yml` promete em comentário rodar a "MESMA versão pinada de
 * docker/docker-compose.yml", porque o piso do golden-set é chaveado por
 * modelo e não por ambiente. Com digest isso é verificável — a mesma imagem
 * com a mesma tag tem de ter o mesmo digest em todo lugar. A chave é a tag
 * INLINE, que agora é a única fonte dela.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Uma referência de imagem que não está presa a conteúdo imutável. */
export interface Violacao {
  arquivo: string;
  linha: number;
  imagem: string;
  motivo:
    | 'referência mutável'
    | 'digest sem a tag inline'
    | 'comentário diverge da tag inline'
    | 'comentário no fim do FROM'
    | 'digest divergente para a mesma tag';
  /** Só em `digest divergente`: onde o primeiro digest daquela tag foi visto. */
  primeiraOcorrencia?: string;
  /** Só em `comentário diverge`: a tag que o comentário afirma. */
  tagDoComentario?: string;
}

export interface Arquivo {
  nome: string;
  conteudo: string;
}

/**
 * `image: <ref>` / `imageName: <ref>` de compose e de manifest do kustomize.
 * O comentário é capturado INTEIRO, e não já validado como tag: um padrão que
 * exigisse a forma certa deixaria de casar com a linha errada, e a referência
 * sumiria do check em vez de ser reprovada — silêncio no lugar de vermelho.
 */
const CHAVE_YAML = /^\s*(?:-\s+)?(?:image|imageName):\s*(\S+)(?:\s+(#.*?))?\s*$/;

/**
 * `FROM [--platform=…] <ref> [AS <estágio>]`, com um comentário de fim de linha
 * OPCIONAL — que é reconhecido só para poder ser REPROVADO. O parser do Docker
 * não o aceita, e casar com essa linha é o que permite dizer isso.
 */
const FROM = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?(\s+#.*?)?\s*$/i;

/**
 * Um comentário que AFIRMA uma tag: `#` mais UM token com pelo menos um dígito
 * (`# 5.26-community`, `# pg16`, `# v1.11.0`). Prosa (mais de um token) e uma
 * palavra solta sem dígito (`# runtime`) não afirmam versão nenhuma, e não são
 * julgadas — o check não é revisor de prosa.
 */
const COMENTARIO_DE_TAG = /^#\s*(\S*\d\S*)$/;

/** A tag afirmada por um comentário bruto (`'# 5.26'` -> `'5.26'`); prosa devolve `undefined`. */
function tagDoComentario(bruto: string | undefined): string | undefined {
  if (bruto === undefined) return undefined;
  return COMENTARIO_DE_TAG.exec(bruto.trim())?.[1];
}

const DIGEST = /@sha256:[0-9a-f]{64}$/;

/**
 * As imagens que este repositório CONSTRÓI. `ghcr.io/<owner>/brabo-*` cobre o
 * caminho publicado; `brabo-*` puro cobre a tag local do compose e do kustomize
 * base.
 */
const IMAGEM_DO_PRODUTO = /^(?:[a-z0-9.-]+\/[^/]+\/)?brabo-[a-z]+(?::|@|$)/;

function ehDockerfile(nome: string): boolean {
  const base = nome.slice(nome.lastIndexOf('/') + 1);
  return base.startsWith('Dockerfile');
}

/** Tira aspas de `image: "x"` — YAML aceita as duas formas. */
function semAspas(valor: string): string {
  const primeiro = valor.charAt(0);
  if ((primeiro === '"' || primeiro === "'") && valor.endsWith(primeiro) && valor.length > 1) {
    return valor.slice(1, -1);
  }
  return valor;
}

/**
 * Separa `registry:5000/ns/nome:tag@sha256:…` em nome e tag. O `:` da tag é o
 * que vem DEPOIS da última barra — o de antes é porta de registry.
 */
export function partesDaReferencia(referencia: string): { nome: string; tag: string | undefined } {
  const arroba = referencia.indexOf('@');
  const semDigest = arroba === -1 ? referencia : referencia.slice(0, arroba);
  const barra = semDigest.lastIndexOf('/');
  const doisPontos = semDigest.indexOf(':', barra + 1);
  if (doisPontos === -1) return { nome: semDigest, tag: undefined };
  const tag = semDigest.slice(doisPontos + 1);
  return { nome: semDigest.slice(0, doisPontos), tag: tag.length > 0 ? tag : undefined };
}

interface Referencia {
  linha: number;
  referencia: string;
  /** A tag que um comentário AFIRMA (fim de linha no YAML, linha de cima no Dockerfile). */
  tagAfirmada: string | undefined;
  /** Dockerfile com `# …` no fim da linha do `FROM` — quebra o build. */
  comentarioNoFrom: boolean;
}

/** Toda referência de imagem de um arquivo, já sem o que não é de registry. */
function referenciasDe(arquivo: Arquivo): Referencia[] {
  const dockerfile = ehDockerfile(arquivo.nome);
  const estagios = new Set<string>();
  const achadas: Referencia[] = [];

  const linhas = arquivo.conteudo.split('\n');

  linhas.forEach((linha, indice) => {
    // Linha inteiramente comentada é prosa SOBRE uma imagem, não uma imagem.
    if (/^\s*#/.test(linha)) return;

    const achado = dockerfile ? FROM.exec(linha) : CHAVE_YAML.exec(linha);
    if (achado === null) return;

    const referencia = semAspas(achado[1] ?? '');

    if (dockerfile) {
      const estagio = achado[2];
      if (estagio !== undefined) estagios.add(estagio.toLowerCase());
      // `FROM deps AS build` aponta para um estágio deste mesmo arquivo, e
      // `FROM scratch` não é imagem nenhuma.
      if (referencia.toLowerCase() === 'scratch' || estagios.has(referencia.toLowerCase())) return;
    }

    // Interpolação: o valor é resolvido fora daqui, já por digest.
    if (referencia.includes('$')) return;

    // Imagem construída por este repositório — ver o docblock.
    if (IMAGEM_DO_PRODUTO.test(referencia)) return;

    // Em YAML o comentário é de fim de linha; em Dockerfile ele é a linha de
    // CIMA, porque o parser do Docker não conhece comentário inline.
    const tagAfirmada = tagDoComentario(dockerfile ? linhas[indice - 1] : achado[2]);
    const comentarioNoFrom = dockerfile && achado[3] !== undefined;

    achadas.push({ linha: indice + 1, referencia, tagAfirmada, comentarioNoFrom });
  });

  return achadas;
}

/**
 * @param arquivos - conteúdo de cada compose, manifest, Dockerfile e workflow
 * @returns toda violação encontrada, na ordem em que aparecem
 */
export function verificarImagens(arquivos: readonly Arquivo[]): Violacao[] {
  const violacoes: Violacao[] = [];
  /** `<nome>:<tag inline>` -> `<digest>` e onde ele apareceu primeiro. */
  const digestPorTag = new Map<string, { digest: string; onde: string }>();

  for (const arquivo of arquivos) {
    for (const { linha, referencia, tagAfirmada, comentarioNoFrom } of referenciasDe(arquivo)) {
      const onde = `${arquivo.nome}:${linha}`;
      const base = { arquivo: arquivo.nome, linha, imagem: referencia };

      if (comentarioNoFrom) {
        violacoes.push({ ...base, motivo: 'comentário no fim do FROM' });
        continue;
      }

      if (!DIGEST.test(referencia)) {
        violacoes.push({ ...base, motivo: 'referência mutável' });
        continue;
      }

      const { nome, tag } = partesDaReferencia(referencia);

      if (tag === undefined) {
        violacoes.push({ ...base, motivo: 'digest sem a tag inline' });
        continue;
      }

      if (tagAfirmada !== undefined && tagAfirmada !== tag) {
        violacoes.push({ ...base, motivo: 'comentário diverge da tag inline', tagDoComentario: tagAfirmada });
        continue;
      }

      const digest = referencia.slice(referencia.indexOf('@') + 1);
      const chave = `${nome}:${tag}`;
      const visto = digestPorTag.get(chave);

      if (visto === undefined) {
        digestPorTag.set(chave, { digest, onde });
        continue;
      }

      if (visto.digest !== digest) {
        violacoes.push({ ...base, motivo: 'digest divergente para a mesma tag', primeiraOcorrencia: visto.onde });
      }
    }
  }

  return violacoes;
}

/** A mensagem que ensina o que fazer, não só o que está errado. */
export function mensagemDeViolacao(violacao: Violacao): string {
  const onde = `${violacao.arquivo}:${violacao.linha}`;
  const forma = '`<imagem>:<tag>@sha256:<digest do índice>`';

  if (violacao.motivo === 'comentário no fim do FROM') {
    return (
      `${onde}: \`${violacao.imagem}\` tem um comentário no fim da linha do \`FROM\`. ` +
      'O parser do Docker só reconhece `#` no INÍCIO da linha: isso é um `FROM` com ' +
      'três argumentos, e o build morre em "FROM requires either one or three arguments". ' +
      `A tag vai DENTRO da referência (${forma}).`
    );
  }

  if (violacao.motivo === 'referência mutável') {
    return (
      `${onde}: \`${violacao.imagem}\` está preso a uma tag, que o dono da ` +
      'imagem pode reapontar para outro conteúdo sem aviso. Resolva a tag com ' +
      '`docker buildx imagetools inspect <imagem>:<tag> --format ' +
      "'{{.Manifest.Digest}}'\", use o digest do ÍNDICE para não perder o " +
      `multi-arch, e escreva ${forma} — a tag fica, o digest decide.`
    );
  }

  if (violacao.motivo === 'digest sem a tag inline') {
    return (
      `${onde}: \`${violacao.imagem}\` está preso por digest, mas sem a tag ` +
      `DENTRO da referência (${forma}, ADR 0178). Sem ela ninguém sabe que versão ` +
      'é esse hash, e o Dependabot — que não lê comentário — atualizaria o pin ' +
      'para o digest da `latest`.'
    );
  }

  if (violacao.motivo === 'comentário diverge da tag inline') {
    return (
      `${onde}: \`${violacao.imagem}\` tem um comentário que afirma a tag ` +
      `\`${violacao.tagDoComentario ?? '?'}\`, diferente da que está na referência. ` +
      'A tag inline é a fonte: apague o comentário ou faça-o dizer o mesmo — ' +
      'comentário que sobra de uma subida de versão é o que mente com o lint verde.'
    );
  }

  return (
    `${onde}: \`${violacao.imagem}\` declara a mesma tag que ` +
    `${violacao.primeiraOcorrencia ?? '(?)'} e um digest DIFERENTE. A mesma ` +
    'tag em dois lugares tem de ser o mesmo conteúdo — divergir aqui faz o CI ' +
    'testar contra uma imagem que não é a que roda.'
  );
}

// --- CLI: `node scripts/ci/imagens-pinadas.ts` -----------------------------

/**
 * As três árvores onde imagem de terceiro entra: o que sobe em dev, em produção
 * e na máquina de quem instalou (`docker/`); o que sobe no cluster
 * (`deploy/k8s/`); e o que sobe como `services:` no runner do CI
 * (`.github/workflows/`) — este último é o que ninguém tinha olhado.
 */
const RAIZES = ['docker', 'deploy/k8s', '.github/workflows'];

function ehArquivoDeImagem(nome: string): boolean {
  return nome.endsWith('.yml') || nome.endsWith('.yaml') || nome.startsWith('Dockerfile');
}

function lerArvore(raiz: string, prefixo: string, acumulado: Arquivo[]): void {
  for (const entrada of readdirSync(raiz, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const caminho = `${raiz}/${entrada.name}`;
    const relativo = `${prefixo}/${entrada.name}`;
    if (entrada.isDirectory()) {
      lerArvore(caminho, relativo, acumulado);
    } else if (entrada.isFile() && ehArquivoDeImagem(entrada.name)) {
      acumulado.push({ nome: relativo, conteudo: readFileSync(caminho, 'utf8') });
    }
  }
}

function principal(): void {
  const raizDoRepo = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
  const arquivos: Arquivo[] = [];

  for (const raiz of RAIZES) {
    const caminho = `${raizDoRepo}/${raiz}`;
    if (!statSync(caminho, { throwIfNoEntry: false })?.isDirectory()) {
      console.error(`::error::imagens-pinadas: a raiz \`${raiz}\` não existe — o check está olhando para o lugar errado.`);
      process.exit(1);
    }
    lerArvore(caminho, raiz, arquivos);
  }

  const violacoes = verificarImagens(arquivos);
  const total = arquivos.reduce((soma, { nome, conteudo }) => soma + referenciasDe({ nome, conteudo }).length, 0);

  console.log(`imagens-pinadas: ${total} imagens de terceiro em ${arquivos.length} arquivos.`);

  if (violacoes.length > 0) {
    for (const violacao of violacoes) {
      console.error(`::error file=${violacao.arquivo},line=${violacao.linha}::${mensagemDeViolacao(violacao)}`);
    }
    console.error(
      `::error::imagens-pinadas: ${violacoes.length} imagem(ns) sem pin imutável. ` +
        'Ver docs/explanation/cadeia-de-suprimentos-do-ci.md e o comentário no topo de ' +
        'scripts/ci/imagens-pinadas.ts.',
    );
    process.exit(1);
  }

  console.log('  ✓ todas presas por digest, com a tag inline.');
}

if (process.argv[1]?.endsWith('imagens-pinadas.ts')) {
  principal();
}
