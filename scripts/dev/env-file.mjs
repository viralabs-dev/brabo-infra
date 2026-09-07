/**
 * Leitura e escrita do `.env`, no mesmo espírito de `scripts/dev/reset-total.sh`
 * lendo as chaves `*_TEST_KEY` linha a linha (grep, não um parser de
 * biblioteca) — só que também na direção contrária (escrita), e por isso
 * in-place: comentários e o resto das chaves saem intocados; quem já existe é
 * ATUALIZADO na própria linha, quem não existe é ANEXADO ao final.
 *
 * POR QUE É MÓDULO PRÓPRIO, e não uma função dentro de `preflight.mjs`, que é
 * onde este código nasceu.
 *
 * `preflight.mjs` executa `await main()` no topo. Importar qualquer coisa de lá
 * subiria o preflight inteiro — com `docker`, `ss` e a pergunta do Ollama —
 * como efeito colateral do import. É exatamente o argumento que já criou
 * `scripts/dev/base-de-projetos.mjs`, e vale de novo assim que um SEGUNDO
 * script precisa escrever no `.env`: o passo de consentimento da base
 * (`consentir-base.mjs`, ADR 0146) é esse segundo.
 *
 * A alternativa — duplicar as duas funções — foi recusada porque a escrita
 * in-place tem uma sutileza que não sobrevive a cópia (a última linha vazia,
 * abaixo), e duas cópias divergindo nisso corromperiam o `.env` de quem usasse
 * o script errado.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ENV_PATH = path.resolve('.env');

/** As chaves do `.env` como mapa. Arquivo ausente devolve mapa vazio. */
export function lerEnv() {
  const mapa = new Map();
  if (!existsSync(ENV_PATH)) return mapa;
  for (const linha of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(linha);
    if (m) mapa.set(m[1], m[2]);
  }
  return mapa;
}

/** Atualiza (ou anexa) as chaves dadas, preservando comentários e ordem. */
export function escreverEnv(chaves) {
  const original = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const linhas = original.length > 0 ? original.split('\n') : [];
  const pendentes = new Map(Object.entries(chaves));

  const atualizadas = linhas.map((linha) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(linha);
    if (m && pendentes.has(m[1])) {
      const valor = pendentes.get(m[1]);
      pendentes.delete(m[1]);
      return `${m[1]}=${valor}`;
    }
    return linha;
  });

  // Uma última linha vazia (arquivo terminado em `\n`) some antes de anexar,
  // senão cada escrita deixaria uma linha em branco a mais no meio do arquivo.
  if (atualizadas.length > 0 && atualizadas.at(-1) === '') atualizadas.pop();
  for (const [chave, valor] of pendentes) atualizadas.push(`${chave}=${valor}`);
  writeFileSync(ENV_PATH, `${atualizadas.join('\n')}\n`);
}
