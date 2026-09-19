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
// cada PR. O contrário é permitido, desde que declarado — e hoje não há
// divergência nenhuma: o `broker` era a única, e entrou nos dois quando a
// imagem dele passou a ser publicada (ADR 0162).
//
// Mora em `scripts/dev/` e não em `scripts/ci/` de propósito: lá o extglob da
// regra `politica-de-branches` cobraria `branching-policy.md` de um teste que
// não tem nada a ver com branch — o mesmo defeito que aquele bloco do docmap
// já documenta ter cometido duas vezes.
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

type Servico = {
  image?: string;
  ports?: unknown[];
  build?: unknown;
  profiles?: string[];
  networks?: string[] | Record<string, unknown>;
  volumes?: string[];
  environment?: Record<string, string>;
  group_add?: string[];
};

type Compose = {
  name?: string;
  services: Record<string, Servico>;
  volumes?: Record<string, unknown>;
  networks?: Record<string, { internal?: boolean } | null>;
};

const ler = (arquivo: string): Compose =>
  parse(fs.readFileSync(path.join(RAIZ, 'docker', arquivo), 'utf8')) as Compose;

const validacao = ler('docker-compose.prod.yml');
const instalacao = ler('docker-compose.install.yml');

// A divergência DECLARADA — vazia desde o ADR 0162, quando o `broker` (o único
// item que ela teve) passou a ser publicado e entrou no compose de instalação.
// A lista continua existindo para que a próxima divergência precise de uma
// decisão explícita — entrar aqui, com motivo — em vez de passar despercebida.
const SO_NA_VALIDACAO = new Set<string>([]);

// Nota da integração da FASE 29: `backup` esteve nesta lista por alguns
// minutos, e foi o teste que forçou a decisão — a sessão 5 acrescentou o
// serviço ao compose de validação e o de instalação não o tinha. A resposta
// certa não era abrir exceção: a imagem `brabo-backup` É publicada (quarto
// alvo do bake), ao contrário da do broker. Ele entrou nos dois.

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
  it('as cinco imagens próprias vêm de variável obrigatória', () => {
    for (const servico of ['migrate-api', 'migrate-engine', 'api', 'engine', 'web', 'backup', 'broker']) {
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

// O broker da instalação (ADR 0162). As cinco camadas do ADR 0130 não dependem
// do profile — dependem destas linhas —, e é por isso que elas são asseridas no
// ARQUIVO que viaja para a máquina de quem instala, e não só no de validação.
describe('o broker da instalação guarda as camadas do ADR 0130', () => {
  const broker = instalacao.services.broker!;
  const redes = (s: Servico): string[] =>
    Array.isArray(s.networks) ? s.networks : Object.keys(s.networks ?? {});

  it('existe, e DESLIGADO por padrão — sob o mesmo profile do compose de validação', () => {
    expect(broker).toBeDefined();
    expect(broker.profiles).toEqual(['container-broker']);
    expect(broker.profiles).toEqual(validacao.services.broker?.profiles);
  });

  it('não publica porta nenhuma', () => {
    expect(broker.ports).toBeUndefined();
  });

  it('só está na rede `broker`, que é `internal: true` — sem egress, só a api do outro lado', () => {
    expect(redes(broker)).toEqual(['broker']);
    expect(instalacao.networks?.broker?.internal).toBe(true);
    const naRede = Object.entries(instalacao.services)
      .filter(([, s]) => redes(s).includes('broker'))
      .map(([nome]) => nome)
      .sort();
    expect(naRede).toEqual(['api', 'broker']);
  });

  it('o socket do Docker é montado nele e em NENHUM outro serviço', () => {
    const comSocket = Object.entries(instalacao.services)
      .filter(([, s]) => (s.volumes ?? []).some((v) => String(v).includes('docker.sock')))
      .map(([nome]) => nome);
    expect(comSocket).toEqual(['broker']);
  });

  it('o token de serviço, as duas raízes e o grupo do socket vêm do .env, sem default público', () => {
    const env = broker.environment ?? {};
    expect(env.NODE_ENV).toBe('production');
    expect(env.BRABO_SERVICE_TOKEN).toBe('${BRABO_SERVICE_TOKEN:-}');
    expect(env.PROJECT_WORKSPACES_HOST_ROOT).toBe('${PROJECT_WORKSPACES_HOST_ROOT:-}');
    expect(env.BRABO_PROJECTS_HOST_BASE).toBe('${BRABO_PROJECTS_HOST_BASE:-${BRABO_PROJECTS_BASE:-}}');
    expect(broker.group_add).toEqual(['${DOCKER_GID:-999}']);
  });

  it('a api não aponta para o broker por padrão — quem liga é o .env', () => {
    expect(instalacao.services.api?.environment?.BROKER_URL).toBe('${BROKER_URL:-}');
  });

  it('nenhum serviço depende dele (fora do profile dependendo de dentro recusa o arquivo)', () => {
    for (const [nome, s] of Object.entries(instalacao.services)) {
      const deps = (s as { depends_on?: Record<string, unknown> | string[] }).depends_on ?? {};
      const nomes = Array.isArray(deps) ? deps : Object.keys(deps);
      expect(nomes, nome).not.toContain('broker');
    }
  });
});
