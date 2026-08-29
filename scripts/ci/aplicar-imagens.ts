/**
 * aplicar-imagens — escreve num overlay do kustomize o DIGEST das imagens que
 * uma release publicou, lendo `.release/images.json` (ADR 0119).
 *
 * ## Por que é um script e não o bot editando o manifesto
 *
 * O overlay guarda o MARCADOR (`REPLACE_WITH_DIGEST`), não uma release
 * congelada: o repositório não tem por que declarar que produção roda a
 * v3.2.0 — quem decide isso é quem faz o deploy, no momento do deploy. O que
 * o repositório guarda é o registro do que cada tag publicou
 * (`.release/images.json`) e a ferramenta que aplica.
 *
 * A alternativa — o `release.yml` reescrevendo `kustomization.yaml` e dando
 * push — foi recusada por dois motivos: abriria uma terceira exceção de push
 * direto numa política que tem exatamente duas (tags pelo bot de release e
 * `.release/gate.json` pelo bot do gate), e faria a tag decidir sozinha o que
 * está em produção.
 *
 * ## Por que `kustomize edit set image` e não `sed`
 *
 * `kustomize edit` conhece o formato: `nome=repo@sha256:…` vira `newName` +
 * `digest`, e o `newTag: REPLACE_WITH_DIGEST` some — que é o certo, porque
 * tag e digest juntos no mesmo `images:` é ambiguidade que o kustomize
 * resolve silenciosamente a favor da tag em algumas versões. Um `sed` acertaria
 * o texto e erraria o esquema.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { argumentosDeSetImage, type ManifestoDeImagens } from './images-manifest.ts';

const CAMINHO_PADRAO = '.release/images.json';
const OVERLAY_PADRAO = 'deploy/k8s/overlays/prod';

/**
 * Lê e valida o manifesto. Arquivo ausente é a falha ESPERADA (ninguém rodou
 * uma release ainda, ou o asset não foi baixado) e por isso tem mensagem
 * própria, que ensina de onde tirar o arquivo — não um stack trace de JSON.
 */
export function lerManifesto(conteudo: string): ManifestoDeImagens {
  const bruto = JSON.parse(conteudo) as Partial<ManifestoDeImagens>;
  if (!Array.isArray(bruto.imagens) || bruto.imagens.length === 0) {
    throw new Error('`imagens` vazio ou ausente — o arquivo não é um images.json de release.');
  }
  if (typeof bruto.versao !== 'string' || typeof bruto.commit !== 'string') {
    throw new Error('`versao`/`commit` ausentes — o arquivo não é um images.json de release.');
  }
  return bruto as ManifestoDeImagens;
}

async function principal(): Promise<void> {
  const caminho = process.argv[2] ?? CAMINHO_PADRAO;
  const overlay = process.argv[3] ?? OVERLAY_PADRAO;

  if (!existsSync(caminho)) {
    console.error(
      `aplicar-imagens: não encontrei "${caminho}".\n` +
        '  Ele é publicado como asset de cada release final — baixe com:\n' +
        '    gh release download <vX.Y.Z> --pattern images.json --dir .release',
    );
    process.exit(1);
  }

  const manifesto = lerManifesto(readFileSync(caminho, 'utf8'));
  const argumentos = argumentosDeSetImage(manifesto);

  console.log(`aplicar-imagens: ${manifesto.versao} (${manifesto.commit}) em ${overlay}`);
  for (const argumento of argumentos) {
    console.log(`  ${argumento}`);
  }

  const resultado = spawnSync('kustomize', ['edit', 'set', 'image', ...argumentos], {
    cwd: overlay,
    stdio: 'inherit',
  });

  if (resultado.error) {
    console.error(
      `aplicar-imagens: não consegui rodar \`kustomize\` (${resultado.error.message}).\n` +
        '  A versão usada pelo CI está pinada em KUSTOMIZE_VERSION, no .github/workflows/ci.yml.',
    );
    process.exit(1);
  }
  if (resultado.status !== 0) {
    process.exit(resultado.status ?? 1);
  }

  console.log('  ✓ overlay atualizado. Confira o diff antes de aplicar no cluster.');
}

if (process.argv[1]?.endsWith('aplicar-imagens.ts')) {
  await principal();
}
