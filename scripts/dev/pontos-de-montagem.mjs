/**
 * Os pontos de montagem de volume (`node_modules`, `_build`, `deps`) que o compose de DEV pisa
 * DENTRO do bind-mount de cada repo irmão em `/workspace` (AT-172; layout de irmãos, AT-702).
 *
 * POR QUE O PREFLIGHT CRIA ISTO. Um volume nomeado montado sobre um caminho
 * que ainda não existe no checkout faz o Docker CRIAR esse caminho no HOST — e
 * o cria como `root:root`. Foi o que aconteceu com `packages/shared/
 * node_modules` no monorepo: a pasta nasceu root dentro do repositório de quem
 * desenvolve, e o `pnpm install` dela dava EACCES. Nenhuma linha de Dockerfile
 * alcança isto (a imagem só governa o dono do que está DENTRO do volume, não o
 * ponto de montagem no bind-mount do host). Quem alcança é criar a pasta ANTES
 * do `up`, como o usuário.
 *
 * A lista é DERIVADA do compose e nunca copiada: serviço novo com volume de
 * `node_modules` entra aqui sozinho. Módulo puro (sem `await main()` no topo,
 * como `docker-gid.mjs`), porque importar `preflight.mjs` subiria o preflight.
 */
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const IRMAO = String.raw`\$\{BRABO_IRMAOS:-[^}]*\}/(brabo-[a-z-]+)`;

/** Os repos irmãos que o compose usa (bind-mount ou contexto de build): `brabo-api`, `brabo-engine`... */
export function irmaosDoCompose(textoDoCompose) {
  return [...new Set([...textoDoCompose.matchAll(new RegExp(IRMAO, 'g'))].map((m) => m[1]))];
}

/**
 * `- <irmão>:/workspace` seguido de `- <volume>:/workspace/<caminho>` (mesmo serviço) →
 * `<irmão>/<caminho>`. O irmão vale até o próximo bind-mount de irmão.
 */
export function pontosDeMontagemDoCompose(textoDoCompose) {
  const achados = new Set();
  let irmao = null;
  for (const linha of textoDoCompose.split('\n')) {
    const bind = new RegExp(`^\\s*-\\s+${IRMAO}:/workspace\\s*$`).exec(linha);
    if (bind) {
      irmao = bind[1];
      continue;
    }
    const m = /^\s*-\s+[A-Za-z0-9_.-]+:\/workspace\/((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+)\s*$/.exec(linha);
    if (m && irmao) achados.add(`${irmao}/${m[1]}`);
  }
  return [...achados];
}

/**
 * Cria o que falta, dono = quem roda o preflight. Devolve o que criou e o que
 * não conseguiu, para o script RELATAR — nunca lança: o `up` dirá o resto.
 * `raiz` é a pasta-mãe dos irmãos (BRABO_IRMAOS). Só cria quando o PAI existe
 * (irmão ausente não é motivo para inventar diretório).
 */
export function garantirPontosDeMontagem(raiz, pontos, fs = { mkdirSync, existsSync }) {
  const criados = [];
  const falhas = [];
  for (const p of pontos) {
    const alvo = join(raiz, p);
    if (fs.existsSync(alvo)) continue;
    if (!fs.existsSync(join(alvo, '..'))) continue;
    try {
      fs.mkdirSync(alvo);
      criados.push(p);
    } catch (erro) {
      falhas.push({ ponto: p, motivo: String(erro.message).split('\n')[0] });
    }
  }
  return { criados, falhas };
}
