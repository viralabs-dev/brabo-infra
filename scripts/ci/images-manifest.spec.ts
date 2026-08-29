import { describe, expect, it } from 'vitest';
import {
  argumentosDeSetImage,
  manifestoDeImagens,
  separarRepositorioETags,
} from './images-manifest.ts';

const DIGEST_API = `sha256:${'a'.repeat(64)}`;
const DIGEST_ENGINE = `sha256:${'b'.repeat(64)}`;
const DIGEST_WEB = `sha256:${'c'.repeat(64)}`;
const DIGEST_BACKUP = `sha256:${'d'.repeat(64)}`;

function metadataCompleto(): Record<string, unknown> {
  return {
    api: {
      'containerimage.digest': DIGEST_API,
      'image.name': 'ghcr.io/daneiel/brabo-api:3.2.0,ghcr.io/daneiel/brabo-api:abcabcabcabc',
    },
    engine: {
      'containerimage.digest': DIGEST_ENGINE,
      'image.name': 'ghcr.io/daneiel/brabo-engine:3.2.0,ghcr.io/daneiel/brabo-engine:abcabcabcabc',
    },
    web: {
      'containerimage.digest': DIGEST_WEB,
      'image.name': 'ghcr.io/daneiel/brabo-web:3.2.0,ghcr.io/daneiel/brabo-web:abcabcabcabc',
    },
    backup: {
      'containerimage.digest': DIGEST_BACKUP,
      'image.name': 'ghcr.io/daneiel/brabo-backup:3.2.0,ghcr.io/daneiel/brabo-backup:abcabcabcabc',
    },
  };
}

// O "sha do commit" das fixtures é `abcabcabcabc`, repetitivo de propósito:
// um hex plausível como `abc123456789` tem entropia 3,58 e a regra
// `generic-api-key` do gitleaks morde qualquer coisa assim depois de um `:`
// — e o `:` está no meio de toda referência de imagem. Padrão repetido tem
// entropia baixa e diz a mesma coisa ao leitor. NUNCA resolver isto com
// allowlist no `.gitleaks.toml`: allowlist vale para todos os commits e
// silenciaria um segredo de verdade no mesmo caminho.
const CONTEXTO = {
  versao: '3.2.0',
  commit: 'abcabcabcabc',
  publicadoEm: '2026-08-29T00:00:00.000Z',
};

describe('separarRepositorioETags', () => {
  it('separa repositório único e as duas tags que o release publica', () => {
    expect(
      separarRepositorioETags('ghcr.io/daneiel/brabo-api:3.2.0,ghcr.io/daneiel/brabo-api:abc123'),
    ).toEqual({
      repositorio: 'ghcr.io/daneiel/brabo-api',
      tags: ['3.2.0', 'abc123'],
    });
  });

  it('aceita registry com porta — o corte é no ÚLTIMO `:`, não no primeiro', () => {
    expect(separarRepositorioETags('registry.local:5000/brabo-api:3.2.0')).toEqual({
      repositorio: 'registry.local:5000/brabo-api',
      tags: ['3.2.0'],
    });
  });

  it('referência SEM tag reprova — o bake sempre publica com tag', () => {
    expect(() => separarRepositorioETags('ghcr.io/daneiel/brabo-api')).toThrow(
      /sem tag/,
    );
  });

  it('a porta do registry sozinha não conta como tag', () => {
    expect(() => separarRepositorioETags('registry.local:5000/brabo-api')).toThrow(
      /sem tag/,
    );
  });

  it('repositórios diferentes no mesmo alvo reprovam — digest só vale dentro de um', () => {
    expect(() =>
      separarRepositorioETags('ghcr.io/a/brabo-api:3.2.0,docker.io/b/brabo-api:3.2.0'),
    ).toThrow(/repositórios diferentes/);
  });

  it('`image.name` vazio reprova', () => {
    expect(() => separarRepositorioETags('  ')).toThrow(/vazio/);
  });
});

describe('manifestoDeImagens', () => {
  it('monta as quatro imagens com digest, repositório e tags', () => {
    const manifesto = manifestoDeImagens(metadataCompleto(), CONTEXTO);

    expect(manifesto.versao).toBe('3.2.0');
    expect(manifesto.commit).toBe('abcabcabcabc');
    expect(manifesto.imagens.map((i) => i.alvo)).toEqual(['api', 'engine', 'web', 'backup']);
    expect(manifesto.imagens[0]).toEqual({
      alvo: 'api',
      repositorio: 'ghcr.io/daneiel/brabo-api',
      digest: DIGEST_API,
      tags: ['3.2.0', 'abcabcabcabc'],
    });
  });

  it('alvo FALTANDO reprova — três de quatro imagens é pior que nenhuma', () => {
    const parcial = metadataCompleto();
    delete parcial.backup;

    expect(() => manifestoDeImagens(parcial, CONTEXTO)).toThrow(/backup/);
  });

  it('digest ausente reprova', () => {
    const metadata = metadataCompleto();
    metadata.web = { 'image.name': 'ghcr.io/daneiel/brabo-web:3.2.0' };

    expect(() => manifestoDeImagens(metadata, CONTEXTO)).toThrow(/sem digest válido/);
  });

  it('digest malformado reprova — não basta ser string', () => {
    const metadata = metadataCompleto();
    metadata.engine = {
      'containerimage.digest': 'sha256:naoehhex',
      'image.name': 'ghcr.io/daneiel/brabo-engine:3.2.0',
    };

    expect(() => manifestoDeImagens(metadata, CONTEXTO)).toThrow(/sem digest válido/);
  });

  it('metadata sem `image.name` reprova', () => {
    const metadata = metadataCompleto();
    metadata.api = { 'containerimage.digest': DIGEST_API };

    expect(() => manifestoDeImagens(metadata, CONTEXTO)).toThrow(/image\.name/);
  });
});

describe('argumentosDeSetImage', () => {
  it('emite `nome=repositorio@digest` para os quatro, SEMPRE por digest', () => {
    const argumentos = argumentosDeSetImage(manifestoDeImagens(metadataCompleto(), CONTEXTO));

    expect(argumentos).toEqual([
      `brabo-api=ghcr.io/daneiel/brabo-api@${DIGEST_API}`,
      `brabo-engine=ghcr.io/daneiel/brabo-engine@${DIGEST_ENGINE}`,
      `brabo-web=ghcr.io/daneiel/brabo-web@${DIGEST_WEB}`,
      `brabo-backup=ghcr.io/daneiel/brabo-backup@${DIGEST_BACKUP}`,
    ]);
  });

  it('nenhum argumento sai com `:tag` — tag mutável não faz rollback determinístico', () => {
    const argumentos = argumentosDeSetImage(manifestoDeImagens(metadataCompleto(), CONTEXTO));

    for (const argumento of argumentos) {
      const valor = argumento.split('=')[1] ?? '';
      expect(valor).toContain('@sha256:');
      // O único `:` do valor é o do `sha256:`; `:3.2.0` no fim reprovaria.
      expect(valor.split(':')).toHaveLength(2);
    }
  });

  it('o nome à esquerda é o `image:` que a base dos manifests declara', () => {
    const argumentos = argumentosDeSetImage(manifestoDeImagens(metadataCompleto(), CONTEXTO));

    expect(argumentos.map((a) => a.split('=')[0])).toEqual([
      'brabo-api',
      'brabo-engine',
      'brabo-web',
      'brabo-backup',
    ]);
  });
});
