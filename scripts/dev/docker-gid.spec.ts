import { describe, it, expect } from 'vitest';
// @ts-expect-error -- módulo .mjs sem tipos; é script de dev, não pacote publicado.
import {
  GID,
  GID_PADRAO_DO_COMPOSE,
  avaliarDockerGid,
  mensagemDoDockerGid,
  normalizarGid,
} from './docker-gid.mjs';

/**
 * O relato de `DOCKER_GID` do preflight (ADR 0146, ponto 3).
 *
 * O que ele protege: com o broker subindo por padrão no compose local, um gid
 * errado deixou de ser problema de quem ligava o profile de propósito e passou
 * a ser de qualquer pessoa que rode `pnpm dev` — e o sintoma aparece longe da
 * causa, não no `up` (que sobe normalmente) mas quando alguém propõe
 * `container_start` e toda operação morre com "permission denied" no socket.
 */
describe('normalizarGid', () => {
  it('aceita número, com ou sem espaços em volta', () => {
    expect(normalizarGid('984')).toBe('984');
    expect(normalizarGid('  984  ')).toBe('984');
  });

  it('ausente, vazio ou não-numérico é null', () => {
    expect(normalizarGid(undefined)).toBeNull();
    expect(normalizarGid(null)).toBeNull();
    expect(normalizarGid('')).toBeNull();
    expect(normalizarGid('   ')).toBeNull();
    expect(normalizarGid('docker')).toBeNull();
    expect(normalizarGid('98a4')).toBeNull();
  });
});

describe('avaliarDockerGid', () => {
  it('bate quando o configurado é o gid da máquina', () => {
    const v = avaliarDockerGid({ gidDoGrupo: '984', valorConfigurado: '984' });
    expect(v.estado).toBe(GID.OK);
    expect(v.origem).toBe('configurado');
  });

  // O caso REAL da máquina em que esta sessão rodou: sem DOCKER_GID no `.env`,
  // e grupo docker = 984 contra o default 999 do compose. O "default errado"
  // não é hipótese.
  it('acusa divergência quando a variável não existe e o default do compose erra', () => {
    const v = avaliarDockerGid({ gidDoGrupo: '984', valorConfigurado: undefined });
    expect(v.estado).toBe(GID.DIVERGENTE);
    expect(v.efetivo).toBe(GID_PADRAO_DO_COMPOSE);
    expect(v.origem).toBe('default');
  });

  it('acusa divergência quando a variável existe e está errada', () => {
    const v = avaliarDockerGid({ gidDoGrupo: '984', valorConfigurado: '999' });
    expect(v.estado).toBe(GID.DIVERGENTE);
    expect(v.origem).toBe('configurado');
  });

  it('não acusa quando o default por acaso ACERTA', () => {
    const v = avaliarDockerGid({ gidDoGrupo: GID_PADRAO_DO_COMPOSE, valorConfigurado: undefined });
    expect(v.estado).toBe(GID.OK);
    expect(v.origem).toBe('default');
  });

  // Sem grupo `docker` não há o que comparar, e isso é metade das máquinas —
  // macOS/Windows (Docker Desktop) e Docker rootless. Tratar a ausência como
  // divergência acusaria um defeito que elas não têm, o mesmo erro que
  // `baseSobrepoeOCheckout` evita ao devolver `false` para checkout desconhecido.
  it('não se aplica quando a máquina não tem grupo docker', () => {
    expect(avaliarDockerGid({ gidDoGrupo: null, valorConfigurado: '999' }).estado).toBe(
      GID.NAO_SE_APLICA,
    );
    expect(avaliarDockerGid({ gidDoGrupo: undefined }).estado).toBe(GID.NAO_SE_APLICA);
  });

  it('valor não-numérico cai no default, não em erro', () => {
    const v = avaliarDockerGid({ gidDoGrupo: '984', valorConfigurado: 'docker' });
    expect(v.efetivo).toBe(GID_PADRAO_DO_COMPOSE);
    expect(v.origem).toBe('default');
  });
});

describe('mensagemDoDockerGid', () => {
  it('na divergência por default ausente, ensina a gravar o gid da máquina', () => {
    const msg = mensagemDoDockerGid(
      avaliarDockerGid({ gidDoGrupo: '984', valorConfigurado: undefined }),
    );
    expect(msg).toContain('DOCKER_GID=984');
    expect(msg).toContain('984');
    expect(msg).toContain('999');
    // Diz onde a falha APARECERIA, que é o que evita a caçada.
    expect(msg).toContain('container_start');
  });

  it('na divergência por valor errado, aponta o valor do .env', () => {
    const msg = mensagemDoDockerGid(
      avaliarDockerGid({ gidDoGrupo: '984', valorConfigurado: '999' }),
    );
    expect(msg).toContain('não é o gid desta máquina');
    expect(msg).toContain('DOCKER_GID=984');
  });

  it('sem grupo docker, diz que NÃO SE APLICA em vez de acusar', () => {
    const msg = mensagemDoDockerGid(avaliarDockerGid({ gidDoGrupo: null }));
    expect(msg).toContain('não se aplica');
    expect(msg).not.toContain('DIVERGE');
  });

  it('quando bate, é uma linha só', () => {
    const msg = mensagemDoDockerGid(
      avaliarDockerGid({ gidDoGrupo: '984', valorConfigurado: '984' }),
    );
    expect(msg.split('\n')).toHaveLength(1);
    expect(msg).toContain('984');
  });
});
