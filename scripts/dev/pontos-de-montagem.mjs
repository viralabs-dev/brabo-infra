/**
 * Os pontos de montagem de `node_modules` que o compose de DEV pisa DENTRO do
 * bind-mount `..:/workspace` (AT-172).
 *
 * POR QUE O PREFLIGHT CRIA ISTO. Um volume nomeado montado sobre um caminho
 * que ainda não existe no checkout faz o Docker CRIAR esse caminho no HOST — e
 * o cria como `root:root`. Foi o que aconteceu com `packages/shared/
 * node_modules`: a pasta nasceu root dentro do repositório de quem
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

/** `- <volume>:/workspace/<caminho>/node_modules` → `<caminho>/node_modules`. */
export function pontosDeMontagemDoCompose(textoDoCompose) {
  const achados = new Set();
  for (const linha of textoDoCompose.split('\n')) {
    const m =
      /^\s*-\s+[A-Za-z0-9_.-]+:\/workspace\/((?:[A-Za-z0-9_.-]+\/)*node_modules)\s*$/.exec(linha);
    if (m) achados.add(m[1]);
  }
  return [...achados];
}

/**
 * Cria o que falta, dono = quem roda o preflight. Devolve o que criou e o que
 * não conseguiu, para o script RELATAR — nunca lança: o `up` dirá o resto.
 * Só cria quando o PAI existe (ponto de montagem de app que não está neste
 * checkout não é motivo para inventar diretório).
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
