import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- módulo .mjs sem tipos; é script de dev, não pacote publicado.
import {
  PASTA,
  avaliarPastaGerenciada,
  mensagemDaPastaGerenciada,
  normalizarCaminho,
} from './pasta-gerenciada.mjs';

/**
 * O relato da pasta gerenciada do preflight (RN-599, AT-213).
 *
 * O que ele protege: sem `PROJECT_WORKSPACES_HOST_DIR` o compose de dev sobe
 * inteiro e o broker também, e só o `container_start` do modo `container` (o
 * default) termina recusado — longe da causa. Mesmo molde do `DOCKER_GID`.
 */
describe('normalizarCaminho', () => {
  it('apara espaço e barra final; vazio é null', () => {
    expect(normalizarCaminho(' /a/b/ ')).toBe('/a/b');
    expect(normalizarCaminho('/')).toBe('/');
    expect(normalizarCaminho('')).toBeNull();
    expect(normalizarCaminho(undefined)).toBeNull();
  });
});

describe('avaliarPastaGerenciada', () => {
  // O caso medido no teste do dono: `.env` copiado do exemplo, nada definido.
  it('sem nenhuma das duas, é AUSENTE', () => {
    expect(avaliarPastaGerenciada({}).estado).toBe(PASTA.AUSENTE);
    expect(avaliarPastaGerenciada({ hostDir: '  ', hostRoot: '' }).estado).toBe(PASTA.AUSENTE);
  });

  it('com a pasta absoluta, a raiz do broker DERIVA dela', () => {
    const v = avaliarPastaGerenciada({ hostDir: '/home/voce/brabo-projetos' });
    expect(v.estado).toBe(PASTA.OK);
    expect(v.efetiva).toBe('/home/voce/brabo-projetos');
    expect(v.origem).toBe('derivada');
  });

  it('raiz explícita IGUAL à pasta é OK (barra final não conta)', () => {
    const v = avaliarPastaGerenciada({ hostDir: '/x/p', hostRoot: '/x/p/' });
    expect(v.estado).toBe(PASTA.OK);
    expect(v.origem).toBe('explicita');
  });

  // Medido com `docker compose config`: o Compose expande `~` na origem do
  // bind-mount de api/engine, mas o broker recebe `~/brabo-projetos` literal.
  it('`~` não expandido é NAO_ABSOLUTA, venha de onde vier', () => {
    expect(avaliarPastaGerenciada({ hostDir: '~/brabo-projetos' }).estado).toBe(
      PASTA.NAO_ABSOLUTA,
    );
    expect(
      avaliarPastaGerenciada({ hostDir: '/x/p', hostRoot: '~/p' }).estado,
    ).toBe(PASTA.NAO_ABSOLUTA);
  });

  it('raiz explícita diferente da pasta montada é DIVERGENTE', () => {
    expect(avaliarPastaGerenciada({ hostDir: '/x/a', hostRoot: '/x/b' }).estado).toBe(
      PASTA.DIVERGENTE,
    );
  });

  // Raiz sem pasta: api e engine escrevem no VOLUME, o broker monta outra coisa.
  it('raiz explícita sem a pasta (api e engine no volume) é DIVERGENTE', () => {
    const v = avaliarPastaGerenciada({ hostRoot: '/x/b' });
    expect(v.estado).toBe(PASTA.DIVERGENTE);
    expect(v.dir).toBeNull();
  });
});

describe('mensagemDaPastaGerenciada', () => {
  it('AUSENTE diz o sintoma, o conserto e o que NÃO migra', () => {
    const msg = mensagemDaPastaGerenciada(avaliarPastaGerenciada({}));
    expect(msg).toContain('container_start');
    expect(msg).toContain('PROJECT_WORKSPACES_HOST_DIR=/');
    expect(msg).toContain('GIT_LOCAL_REPOS_HOST_DIR=');
    expect(msg).toContain('up -d api engine broker');
    // Quem já tem dados no volume não os perde, mas deixa de vê-los.
    expect(msg).toContain('project_workspaces');
    expect(msg).toContain('NÃO migra');
  });

  it('NAO_ABSOLUTA nomeia o `~`', () => {
    const msg = mensagemDaPastaGerenciada(avaliarPastaGerenciada({ hostDir: '~/p' }));
    expect(msg).toContain('~/p');
    expect(msg).toContain('container_start');
  });

  it('DIVERGENTE mostra os dois lados, e o volume quando não há pasta', () => {
    const msg = mensagemDaPastaGerenciada(avaliarPastaGerenciada({ hostRoot: '/x/b' }));
    expect(msg).toContain('/x/b');
    expect(msg).toContain('volume Docker `project_workspaces`');
  });

  it('OK é uma linha só', () => {
    const msg = mensagemDaPastaGerenciada(avaliarPastaGerenciada({ hostDir: '/x/p' }));
    expect(msg.split('\n')).toHaveLength(1);
    expect(msg).toContain('/x/p');
  });
});

// O preflight é o único consumidor, e o relato só vale se ele o CHAMA — mesmo
// motivo pelo qual `docker-gid.mjs` não mora no preflight: importá-lo rodaria
// o script inteiro, então a prova é sobre o texto dele.
describe('o preflight relata', () => {
  const preflight = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'preflight.mjs'),
    'utf8',
  );
  it('chama o relato no main, sem sair do processo por ele', () => {
    const main = preflight.slice(preflight.indexOf('async function main()'));
    expect(main).toMatch(/\n\s+relatarPastaGerenciada\(\);/);
    expect(main).not.toMatch(/relatarPastaGerenciada\(\)\)\s*process\.exit/);
  });
  it('lê as duas variáveis com o ambiente antes do .env', () => {
    expect(preflight).toContain(
      "process.env.PROJECT_WORKSPACES_HOST_DIR ?? env.get('PROJECT_WORKSPACES_HOST_DIR')",
    );
    expect(preflight).toContain(
      "process.env.PROJECT_WORKSPACES_HOST_ROOT ?? env.get('PROJECT_WORKSPACES_HOST_ROOT')",
    );
  });
});
