import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

// O ADR 0150 aceitou, por escrito, o custo de DOIS composes com a mesma
// topologia: um valida as imagens (constrói local, é o que o `smoke.sh` usa) e
// o outro instala (consome digest, não constrói nada). O que ele NÃO aceitou
// foi que os dois divirjam em silêncio — e "não divergir" por boa vontade dura
// até o primeiro serviço novo entrar num só.
//
// Este teste é o teto. A direção importa: o de instalação **não pode ganhar**
// o que o de validação não tem, porque o de validação é o que o CI exercita a
// cada PR. O contrário é permitido e está declarado — o `broker` existe só na
// validação, porque a imagem dele não é publicada.
//
// Mora em `scripts/dev/` e não em `scripts/ci/` de propósito: lá o extglob da
// regra `politica-de-branches` cobraria `branching-policy.md` de um teste que
// não tem nada a ver com branch — o mesmo defeito que aquele bloco do docmap
// já documenta ter cometido duas vezes.
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

type Compose = {
  name?: string;
  services: Record<string, { image?: string; ports?: unknown[]; build?: unknown; profiles?: string[] }>;
  volumes?: Record<string, unknown>;
};

const ler = (arquivo: string): Compose =>
  parse(fs.readFileSync(path.join(RAIZ, 'docker', arquivo), 'utf8')) as Compose;

const validacao = ler('docker-compose.prod.yml');
const instalacao = ler('docker-compose.install.yml');

// O `broker` é a divergência DECLARADA, e o único item desta lista. Ela existe
// para que a próxima divergência precise de uma decisão explícita — entrar
// aqui, com motivo — em vez de passar despercebida.
const SO_NA_VALIDACAO = new Set(['broker']);

describe('os dois composes não divergem em silêncio', () => {
  it('o de instalação não ganha serviço que o de validação não tenha', () => {
    const extras = Object.keys(instalacao.services).filter((s) => !(s in validacao.services));
    expect(extras).toEqual([]);
  });

  it('o que só existe na validação está declarado', () => {
    const faltando = Object.keys(validacao.services).filter((s) => !(s in instalacao.services));
    expect(new Set(faltando)).toEqual(SO_NA_VALIDACAO);
  });

  it('o de instalação não ganha volume que o de validação não tenha', () => {
    const extras = Object.keys(instalacao.volumes ?? {}).filter(
      (v) => !(v in (validacao.volumes ?? {})),
    );
    expect(extras).toEqual([]);
  });

  // O ponto do arquivo. Um `build:` que sobrevivesse faria a instalação
  // construir a imagem em vez de usar a publicada — e ninguém notaria, porque
  // o resultado sobe do mesmo jeito.
  it('nada se constrói no compose de instalação', () => {
    const comBuild = Object.entries(instalacao.services)
      .filter(([, def]) => def.build !== undefined)
      .map(([nome]) => nome);
    expect(comBuild).toEqual([]);
  });

  // Sem default de propósito: `${VAR:?...}`. Com default, uma variável ausente
  // subiria metade da stack com uma imagem que ninguém escolheu, e o erro
  // apareceria como comportamento estranho em vez de recusa.
  it('as quatro imagens próprias vêm de variável obrigatória', () => {
    for (const servico of ['migrate-api', 'migrate-engine', 'api', 'engine', 'web']) {
      const imagem = instalacao.services[servico]?.image ?? '';
      expect(imagem, `${servico}`).toMatch(/^\$\{BRABO_[A-Z]+_IMAGE:\?/);
    }
  });

  // Imagem de terceiro continua pinada por TAG nos dois (BRB-004 pede digest e
  // segue aberto) — o que este teste garante é que a instalação não afrouxe
  // para `latest` o que a validação pinou.
  it('as imagens de terceiro são as mesmas nos dois', () => {
    for (const servico of ['postgres', 'neo4j']) {
      expect(instalacao.services[servico]?.image, servico).toBe(
        validacao.services[servico]?.image,
      );
    }
  });
});
