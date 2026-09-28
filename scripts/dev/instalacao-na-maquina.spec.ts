import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROJETO_DA_INSTALACAO,
  PROJETO_DE_DEV,
  containersDaInstalacao,
  containersDaMaquina,
  containersDoDevAntigo,
  ehComposeDeInstalacao,
  mensagemDeInstalacaoPresente,
  projetoDeDevProibido,
  volumesDaMaquina,
  volumesDeDevOrfaos,
  volumesDoTopo,
  volumesSoDeDev,
  // @ts-expect-error -- módulo .mjs sem tipos; é script de dev, não pacote publicado.
} from './instalacao-na-maquina.mjs';

// AT-173 (ADR 0170): o compose de dev e o de instalação eram o MESMO projeto
// Docker (`brabo`). O dev virou `brabo-dev`; o preflight RECUSA enquanto houver
// container do compose de instalação na máquina, e AVISA sobre volumes `brabo_*`
// órfãos do dev antigo. A mesma régua em bash, no reset, é provada em
// `reset-total-ordem.spec.ts`.

const RAIZ = join(__dirname, '..', '..');
const composeDeDev = readFileSync(join(RAIZ, 'docker/docker-compose.yml'), 'utf8');
const composeDeInstalacao = readFileSync(join(RAIZ, 'docker/docker-compose.install.yml'), 'utf8');
const composeDeObservabilidade = readFileSync(join(RAIZ, 'docker/docker-compose.observability.yml'), 'utf8');

const nomeDoTopo = (texto: string) => /^name:\s*(\S+)\s*$/m.exec(texto)?.[1];

describe('os nomes de projeto dos composes (ADR 0170)', () => {
  it('o de dev é brabo-dev, e o overlay de observabilidade repete (o último -f vence)', () => {
    expect(nomeDoTopo(composeDeDev)).toBe(PROJETO_DE_DEV);
    expect(nomeDoTopo(composeDeObservabilidade)).toBe(PROJETO_DE_DEV);
  });

  it('o de instalação CONTINUA brabo: é o nome das instalações que já existem', () => {
    expect(nomeDoTopo(composeDeInstalacao)).toBe(PROJETO_DA_INSTALACAO);
  });
});

describe('ehComposeDeInstalacao', () => {
  it('reconhece o arquivo do checkout, o destino do install.sh e o nome do asset, sozinhos ou numa lista', () => {
    expect(ehComposeDeInstalacao('/opt/brabo/docker/docker-compose.install.yml')).toBe(true);
    expect(ehComposeDeInstalacao('/tmp/brabo-install-compose.yml')).toBe(true);
    expect(ehComposeDeInstalacao('/a/docker-compose.yml,/a/docker-compose.install.yml')).toBe(true);
  });

  it('não confunde com o compose de dev, de produção, nem com nome parecido', () => {
    expect(ehComposeDeInstalacao('/w/brabo/docker/docker-compose.yml')).toBe(false);
    expect(ehComposeDeInstalacao('/w/brabo/docker/docker-compose.prod.yml')).toBe(false);
    expect(ehComposeDeInstalacao('/w/x/docker-compose.install.yml.bak')).toBe(false);
    expect(ehComposeDeInstalacao('')).toBe(false);
    expect(ehComposeDeInstalacao(undefined)).toBe(false);
  });
});

describe('containersDaInstalacao / containersDoDevAntigo', () => {
  const saida = [
    'brabo-postgres-1§brabo§/opt/brabo/docker/docker-compose.install.yml',
    'prova-web-1§prova-guarda§/tmp/p/docker/docker-compose.install.yml',
    'brabo-api-1§brabo§/w/brabo/docker/docker-compose.yml,/w/brabo/docker/docker-compose.observability.yml',
    'brabo-dev-api-1§brabo-dev§/w/brabo/docker/docker-compose.yml',
    'solto§§',
    '',
  ].join('\n');
  const containers = containersDaMaquina(saida);

  it('acha a instalação pelo ARQUIVO do rótulo, em qualquer projeto (o `-p` descartável da prova inclusive)', () => {
    expect(containersDaInstalacao(containers).map((c: { nome: string }) => c.nome)).toEqual([
      'brabo-postgres-1',
      'prova-web-1',
    ]);
  });

  it('o dev ANTIGO é o projeto `brabo` com o compose de dev — nunca a instalação nem o dev novo', () => {
    expect(containersDoDevAntigo(containers).map((c: { nome: string }) => c.nome)).toEqual(['brabo-api-1']);
  });

  it('nada a recusar numa máquina só com o dev (novo ou antigo) e containers soltos', () => {
    const semInstalacao = containersDaMaquina(
      'brabo-dev-api-1§brabo-dev§/w/docker/docker-compose.yml\nbrabo-api-1§brabo§/w/docker/docker-compose.yml\nx§§\n',
    );
    expect(containersDaInstalacao(semInstalacao)).toEqual([]);
  });

  it('a recusa nomeia cada container e o `down` SEM -v de cada arquivo', () => {
    const msg = mensagemDeInstalacaoPresente(containersDaInstalacao(containers));
    expect(msg).toContain('RECUSADO');
    expect(msg).toContain('brabo-postgres-1  (projeto brabo, /opt/brabo/docker/docker-compose.install.yml)');
    expect(msg).toContain('docker compose -f /opt/brabo/docker/docker-compose.install.yml --env-file /opt/brabo/.env down\n');
    expect(msg).toContain('docker compose -f /tmp/p/docker/docker-compose.install.yml --env-file /tmp/p/.env down\n');
    expect(msg).not.toMatch(/down -v|--volumes/);
  });
});

describe('projetoDeDevProibido', () => {
  it('recusa `brabo` (o nome da instalação) e aceita `brabo-dev` e qualquer outro', () => {
    expect(projetoDeDevProibido('brabo')).toBe(true);
    expect(projetoDeDevProibido('brabo-dev')).toBe(false);
    expect(projetoDeDevProibido('brabo-primeiro-clone')).toBe(false);
  });
});

describe('volumes órfãos do dev antigo', () => {
  it('volumesDoTopo lê só o bloco `volumes:` de TOPO, derivado do arquivo real', () => {
    const dev = volumesDoTopo(composeDeDev);
    expect(dev).toContain('pgdata');
    expect(dev).toContain('engine_build');
    expect(dev).toContain('api_root_node_modules');
    expect(volumesDoTopo(composeDeInstalacao)).toContain('backup_local');
  });

  it('volumesSoDeDev: os de build ficam, os que a instalação também declara saem', () => {
    const so = volumesSoDeDev(composeDeDev, composeDeInstalacao);
    for (const v of ['api_root_node_modules', 'web_app_node_modules', 'broker_port_node_modules', 'engine_build', 'engine_deps', 'engine_mix', 'engine_hex']) {
      expect(so).toContain(v);
    }
    for (const v of ['pgdata', 'neo4j_data', 'git_local_repos', 'project_workspaces', 'ollama_data', 'brabo_projects_base']) {
      expect(so).not.toContain(v);
    }
  });

  it('avisa quando há `brabo_*` com chave exclusiva de dev, separando os de chave comum', () => {
    const so = volumesSoDeDev(composeDeDev, composeDeInstalacao);
    const volumes = volumesDaMaquina(
      [
        'brabo_pgdata§brabo§pgdata',
        'brabo_engine_build§brabo§engine_build',
        'brabo-dev_pgdata§brabo-dev§pgdata',
        'solto§§',
      ].join('\n'),
    );
    const veredito = volumesDeDevOrfaos(volumes, so);
    expect(veredito.deDev.map((v: { nome: string }) => v.nome)).toEqual(['brabo_engine_build']);
    expect(veredito.comuns.map((v: { nome: string }) => v.nome)).toEqual(['brabo_pgdata']);
  });

  it('só chave comum (o caso de uma instalação) ou nada de `brabo`: sem aviso', () => {
    const so = volumesSoDeDev(composeDeDev, composeDeInstalacao);
    expect(volumesDeDevOrfaos(volumesDaMaquina('brabo_pgdata§brabo§pgdata\n'), so)).toBeNull();
    expect(volumesDeDevOrfaos(volumesDaMaquina('brabo-dev_engine_build§brabo-dev§engine_build\n'), so)).toBeNull();
  });
});

// O preflight INTEIRO, com um `docker` de mentira na frente do PATH e o `cwd`
// numa pasta temporária (é de lá que ele lê o `.env`). O `docker` real nunca é
// chamado.
describe('preflight.mjs — a guarda de ponta a ponta', () => {
  const pastas: string[] = [];
  afterEach(() => {
    for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
  });

  function rodarPreflight({ containers = '', volumes = '', projeto = 'brabo-dev' } = {}) {
    const raiz = mkdtempSync(join(tmpdir(), 'preflight-instalacao-'));
    pastas.push(raiz);
    const bin = join(raiz, 'bin');
    mkdirSync(bin);
    writeFileSync(join(raiz, '.env'), 'OLLAMA_MODE=host\n');
    writeFileSync(join(raiz, 'containers'), containers);
    writeFileSync(join(raiz, 'volumes'), volumes);
    const docker = join(bin, 'docker');
    writeFileSync(
      docker,
      [
        '#!/usr/bin/env bash',
        `if [[ "$1" == ps && "$2" == -a ]]; then cat "${join(raiz, 'containers')}"; exit 0; fi`,
        'if [[ "$1" == ps ]]; then exit 0; fi',
        `if [[ "$1" == volume && "$2" == ls ]]; then cat "${join(raiz, 'volumes')}"; exit 0; fi`,
        `if [[ "$*" == *" config --format json"* ]]; then echo '{"name":"${projeto}","services":{}}'; exit 0; fi`,
        'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(docker, 0o755);
    const r = spawnSync(process.execPath, [join(RAIZ, 'scripts/dev/preflight.mjs')], {
      cwd: raiz,
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: raiz },
      encoding: 'utf8',
    });
    return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
  }

  it('recusa com container do compose de instalação (projeto descartável, parado), nomeando-o', () => {
    const { codigo, saida } = rodarPreflight({
      containers: 'prova-postgres-1§prova-guarda§/tmp/p/docker/docker-compose.install.yml\n',
    });
    expect(codigo).toBe(1);
    expect(saida).toContain('containers do compose de INSTALAÇÃO');
    expect(saida).toContain('prova-postgres-1');
  });

  it('recusa quando o compose de dev resolveria o projeto `brabo`', () => {
    const { codigo, saida } = rodarPreflight({ projeto: 'brabo' });
    expect(codigo).toBe(1);
    expect(saida).toContain('resolveria o projeto Docker `brabo`');
  });

  it('passa sem instalação, e só AVISA sobre volumes órfãos do dev antigo', () => {
    const { codigo, saida } = rodarPreflight({
      containers: 'brabo-dev-api-1§brabo-dev§/w/docker/docker-compose.yml\n',
      volumes: 'brabo_engine_deps§brabo§engine_deps\nbrabo_pgdata§brabo§pgdata\n',
    });
    expect(saida).toContain('AVISO: há volumes do compose de dev com o nome ANTIGO');
    expect(saida).toContain('brabo_engine_deps');
    expect(saida).not.toContain('RECUSADO');
    expect(codigo).toBe(0);
  });

  it('passa calado sobre volumes numa máquina limpa', () => {
    const { codigo, saida } = rodarPreflight();
    expect(saida).not.toContain('AVISO: há volumes');
    expect(codigo).toBe(0);
  });
});
