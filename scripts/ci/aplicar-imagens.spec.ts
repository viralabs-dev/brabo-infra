import { describe, expect, it } from 'vitest';
import { lerManifesto } from './aplicar-imagens.ts';

const VALIDO = JSON.stringify({
  versao: '3.2.0',
  commit: 'abcabcabcabc',
  publicadoEm: '2026-08-29T00:00:00.000Z',
  imagens: [
    {
      alvo: 'api',
      repositorio: 'ghcr.io/daneiel/brabo-api',
      digest: `sha256:${'a'.repeat(64)}`,
      tags: ['3.2.0'],
    },
  ],
});

describe('lerManifesto', () => {
  it('aceita o arquivo que o release.yml grava', () => {
    expect(lerManifesto(VALIDO).versao).toBe('3.2.0');
  });

  it('recusa um JSON sem `imagens` — não é images.json de release', () => {
    expect(() => lerManifesto('{"versao":"3.2.0","commit":"abc"}')).toThrow(/imagens/);
  });

  it('recusa `imagens` vazio: aplicar zero imagem deixaria o overlay no marcador, em silêncio', () => {
    expect(() => lerManifesto('{"versao":"3.2.0","commit":"abc","imagens":[]}')).toThrow(
      /imagens/,
    );
  });

  it('recusa manifesto sem versão/commit — sem eles não dá para dizer o que foi aplicado', () => {
    const semVersao = JSON.parse(VALIDO) as Record<string, unknown>;
    delete semVersao.versao;

    expect(() => lerManifesto(JSON.stringify(semVersao))).toThrow(/versao/);
  });
});
