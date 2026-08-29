/**
 * images-manifest — transforma o metadata do `docker buildx bake` no
 * `.release/images.json`, o registro por DIGEST do que aquela tag publicou.
 *
 * ## Por que existe
 *
 * O `release.yml` construía as quatro imagens com `load: true` e `push:
 * false`: provava que a tag era CONSTRUÍVEL e parava aí. O overlay de
 * produção apontava para `ghcr.io/OWNER/*` com `newTag:
 * REPLACE_WITH_DIGEST` — um marcador que nenhum passo substituía. Enquanto
 * isso valesse, "deploy de produção executável ponta a ponta" era falso, e
 * era a dívida declarada mais cara do ADR 0027.
 *
 * ## Por que DIGEST, e não a tag da versão
 *
 * O comentário do próprio overlay já dizia a regra: tag mutável não serve em
 * produção. `:3.2.0` apontando para conteúdo diferente ao longo do tempo
 * impede rollback determinístico e deixa dois pods do mesmo ReplicaSet
 * rodando binários diferentes. O digest é o conteúdo, não um nome para ele.
 * As tags legíveis continuam sendo publicadas — elas servem para conversa
 * humana e para `docker pull` manual, nunca para o manifesto.
 *
 * ## Por que um arquivo, e não o bot reescrevendo o kustomization
 *
 * `.release/images.json` segue o mesmo desenho de `.release/gate.json`:
 * estado de release é DADO versionado, não manifesto editado por bot. E ele
 * NÃO abre exceção nova de push (a política tem só duas: tags pelo bot de
 * release e `.release/gate.json` pelo bot do gate) — ele pega carona na PR
 * do CHANGELOG que o `release.yml` já abre para a `dev`, e é anexado à
 * GitHub Release no mesmo instante da tag, que é a cópia autoritativa.
 *
 * ## Formato de entrada
 *
 * O `docker/bake-action` devolve, em `outputs.metadata`, um objeto com uma
 * chave por alvo do bake:
 *
 *     {
 *       "api": {
 *         "containerimage.digest": "sha256:…",
 *         "image.name": "ghcr.io/dono/brabo-api:3.2.0,ghcr.io/dono/brabo-api:abc123"
 *       },
 *       …
 *     }
 *
 * Alvo sem digest REPROVA em vez de sair do manifesto: um `images.json` com
 * três das quatro imagens é pior que nenhum — o deploy aplicaria três
 * imagens novas e uma velha, e nada no arquivo diria que faltou uma. É a
 * mesma disciplina do `embed` em lote (ADR 0075): resposta parcial é
 * indetectável depois.
 */
import { readFileSync } from 'node:fs';

/** Os quatro alvos do `docker-bake.hcl`. Alvo fora desta lista é erro. */
export const ALVOS = ['api', 'engine', 'web', 'backup'] as const;
export type Alvo = (typeof ALVOS)[number];

/** `sha256:` + 64 hex. Digest fora deste formato nunca vira manifesto. */
const PADRAO_DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface ImagemPublicada {
  /** Nome do alvo no bake, que é também o `name:` do kustomize (`brabo-api`). */
  alvo: Alvo;
  /** Referência SEM tag: `ghcr.io/dono/brabo-api`. */
  repositorio: string;
  /** `sha256:…` — o que o manifesto de produção referencia. */
  digest: string;
  /** As tags legíveis publicadas junto. Documentação, nunca deploy. */
  tags: string[];
}

export interface ManifestoDeImagens {
  versao: string;
  commit: string;
  publicadoEm: string;
  imagens: ImagemPublicada[];
}

interface MetadataDeAlvo {
  'containerimage.digest'?: unknown;
  'image.name'?: unknown;
}

/**
 * Quebra `image.name` do bake — uma lista separada por vírgula de
 * `repositorio:tag` — em repositório único e suas tags.
 *
 * Duas referências com repositórios DIFERENTES no mesmo alvo reprovam: o
 * manifesto tem um digest só por alvo, e digest só vale dentro de um
 * repositório. Deixar passar produziria um arquivo que parece certo e
 * aponta para o lugar errado na metade dos casos.
 */
export function separarRepositorioETags(imageName: string): {
  repositorio: string;
  tags: string[];
} {
  const referencias = imageName
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);

  if (referencias.length === 0) {
    throw new Error('`image.name` vazio — o bake não publicou referência nenhuma.');
  }

  const partidas = referencias.map((referencia) => {
    const corte = referencia.lastIndexOf(':');
    // `lastIndexOf` e não `split(':')`: `ghcr.io:5000/dono/img:tag` tem dois.
    // Sem tag nenhuma também é erro — o bake sempre publica pelo menos uma.
    if (corte <= 0 || referencia.includes('/', corte)) {
      throw new Error(`referência sem tag: "${referencia}"`);
    }
    return {
      repositorio: referencia.slice(0, corte),
      tag: referencia.slice(corte + 1),
    };
  });

  const repositorios = new Set(partidas.map((p) => p.repositorio));
  if (repositorios.size > 1) {
    throw new Error(
      `o mesmo alvo publicou em repositórios diferentes (${[...repositorios].join(', ')}) — ` +
        'um digest só vale dentro de um repositório.',
    );
  }

  // `partidas` tem ao menos um elemento (a checagem de vazio acima garante),
  // mas o `noUncheckedIndexedAccess` do tsconfig não sabe disso — e a saída
  // com `!` seria um lugar a menos onde o compilador ajuda.
  const [primeira] = partidas;
  if (!primeira) {
    throw new Error('`image.name` vazio — o bake não publicou referência nenhuma.');
  }

  return {
    repositorio: primeira.repositorio,
    tags: partidas.map((p) => p.tag),
  };
}

/**
 * Monta o manifesto a partir do metadata do bake. Lança — nunca devolve
 * parcial — quando qualquer um dos quatro alvos falta, vem sem digest, com
 * digest malformado ou sem `image.name`.
 */
export function manifestoDeImagens(
  metadata: Record<string, unknown>,
  contexto: { versao: string; commit: string; publicadoEm: string },
): ManifestoDeImagens {
  const imagens = ALVOS.map((alvo): ImagemPublicada => {
    const bruto = metadata[alvo] as MetadataDeAlvo | undefined;
    if (!bruto || typeof bruto !== 'object') {
      throw new Error(
        `alvo "${alvo}" não aparece no metadata do bake — as quatro imagens ` +
          'são publicadas juntas ou nenhuma é.',
      );
    }

    const digest = bruto['containerimage.digest'];
    if (typeof digest !== 'string' || !PADRAO_DIGEST.test(digest)) {
      throw new Error(
        `alvo "${alvo}" sem digest válido (recebido: ${JSON.stringify(digest)}) — ` +
          'sem digest não há referência imutável para o manifesto de produção.',
      );
    }

    const imageName = bruto['image.name'];
    if (typeof imageName !== 'string') {
      throw new Error(`alvo "${alvo}" sem \`image.name\` no metadata do bake.`);
    }

    const { repositorio, tags } = separarRepositorioETags(imageName);
    return { alvo, repositorio, digest, tags };
  });

  return { ...contexto, imagens };
}

/**
 * Os argumentos de `kustomize edit set image`, um por imagem, no formato
 * `nome=repositorio@digest`.
 *
 * `nome` é o `brabo-api` que a base dos manifests declara em `image:` — o
 * mesmo que o overlay já usa como `name:`. O valor é SEMPRE por digest: se
 * um dia isto emitir `:tag`, o rollback determinístico morre em silêncio, e
 * é para isso que existe o teste.
 */
export function argumentosDeSetImage(manifesto: ManifestoDeImagens): string[] {
  return manifesto.imagens.map(
    (i) => `brabo-${i.alvo}=${i.repositorio}@${i.digest}`,
  );
}

async function principal(): Promise<void> {
  const [caminhoMetadata, versao, commit] = process.argv.slice(2);
  if (!caminhoMetadata || !versao || !commit) {
    console.error(
      '::error::images-manifest: uso — ' +
        'node scripts/ci/images-manifest.ts <metadata.json> <versao> <commit>',
    );
    process.exit(1);
  }

  let manifesto: ManifestoDeImagens;
  try {
    manifesto = manifestoDeImagens(
      JSON.parse(readFileSync(caminhoMetadata, 'utf8')) as Record<string, unknown>,
      { versao, commit, publicadoEm: new Date().toISOString() },
    );
  } catch (erro) {
    console.error(
      `::error::images-manifest: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
    process.exit(1);
    return;
  }

  // STDOUT é o arquivo; o resumo legível vai para STDERR para não sujá-lo.
  console.error(`images-manifest: ${manifesto.imagens.length} imagens em ${versao}`);
  for (const imagem of manifesto.imagens) {
    console.error(`  ${imagem.repositorio}@${imagem.digest}`);
  }
  console.log(JSON.stringify(manifesto, null, 2));
}

if (process.argv[1]?.endsWith('images-manifest.ts')) {
  await principal();
}
