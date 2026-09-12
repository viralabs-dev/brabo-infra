import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mensagemDeViolacao, verificarImagens, type Arquivo } from './imagens-pinadas.ts';

/**
 * A regra, irmã da de `actions-pinadas.spec.ts`: toda imagem de TERCEIRO presa
 * por digest, com a tag num comentário ao lado. Tag de registry é ponteiro
 * mutável; digest é conteúdo. Imagem que este repositório CONSTRÓI passa — não
 * há terceiro que possa mover nada, e onde ela atravessa um registry o ADR 0119
 * já a resolve por digest.
 */

const DIGEST = 'sha256:22ec5cd05a8cbb372fc4bed5e384c30bc75fd92504c72be4462039761b105f61';
const OUTRO_DIGEST = 'sha256:075246f72d4109385b4a01c3ac8e9cbd26a0bcb21cd7aa30edbccd24e1b3180c';

const compose = (conteudo: string): Arquivo[] => [{ nome: 'docker/docker-compose.yml', conteudo }];
const dockerfile = (conteudo: string): Arquivo[] => [{ nome: 'docker/api/Dockerfile', conteudo }];

describe('verificarImagens — compose, manifest e workflow', () => {
  it('aceita imagem presa por digest com a tag em comentário', () => {
    expect(verificarImagens(compose(`    image: neo4j@${DIGEST}  # 5.26-community`))).toEqual([]);
  });

  it('reprova tag — o estado em que estavam as 37 referências do repositório', () => {
    const violacoes = verificarImagens(compose('    image: neo4j:5.26-community'));
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]).toMatchObject({ linha: 1, imagem: 'neo4j:5.26-community', motivo: 'referência mutável' });
  });

  it('reprova imagem sem tag nenhuma, que é o ponteiro mais móvel de todos', () => {
    expect(verificarImagens(compose('    image: neo4j'))[0]?.motivo).toBe('referência mutável');
  });

  it('reprova digest sem comentário: pin que ninguém sabe que versão é', () => {
    const violacoes = verificarImagens(compose(`    image: neo4j@${DIGEST}`));
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]?.motivo).toBe('digest sem a tag em comentário');
  });

  it('reprova digest de 63 hex — quase-digest não é digest', () => {
    const quase = DIGEST.slice(0, -1);
    expect(verificarImagens(compose(`    image: neo4j@${quase}  # 5.26`))[0]?.motivo).toBe('referência mutável');
  });

  it('cobre `imageName:`, a chave do CRD do CloudNativePG', () => {
    const linha = '  imageName: ghcr.io/cloudnative-pg/postgresql:16.10';
    const violacoes = verificarImagens([{ nome: 'deploy/k8s/overlays/local/db/cluster.yaml', conteudo: linha }]);
    expect(violacoes[0]?.imagem).toBe('ghcr.io/cloudnative-pg/postgresql:16.10');
  });

  it('cobre `services:` de workflow — é o runner que a regra das actions protege', () => {
    const violacoes = verificarImagens([
      { nome: '.github/workflows/ci.yml', conteudo: '        image: pgvector/pgvector:pg16' },
    ]);
    expect(violacoes).toHaveLength(1);
  });

  it('aceita valor entre aspas — YAML permite as duas formas', () => {
    expect(verificarImagens(compose(`    image: "neo4j@${DIGEST}"  # 5.26-community`))).toEqual([]);
  });

  it('ignora linha comentada: é prosa SOBRE uma imagem, não uma imagem', () => {
    expect(verificarImagens(compose('    # antes disto era image: neo4j:5.26-community'))).toEqual([]);
  });

  it('ignora `image:` que abre um mapa (o `repository:` dos values do Helm)', () => {
    const conteudo = 'image:\n  repository: otel/opentelemetry-collector-contrib\n';
    expect(verificarImagens([{ nome: 'deploy/k8s/helm/otel-collector-values.yaml', conteudo }])).toEqual([]);
  });
});

describe('verificarImagens — o que NÃO é imagem de terceiro', () => {
  it('não cobra as imagens que este repositório constrói', () => {
    const conteudo = '    image: brabo-api:prod\n    image: ghcr.io/daneiel/brabo-engine:prod\n';
    expect(verificarImagens(compose(conteudo))).toEqual([]);
  });

  it('não cobra referência interpolada — o install.sh grava as quatro já por digest', () => {
    const linha = '    image: ${BRABO_API_IMAGE:?defina BRABO_API_IMAGE}';
    expect(verificarImagens(compose(linha))).toEqual([]);
  });

  it('não cobra estágio de build multi-stage nem `FROM scratch`', () => {
    const conteudo = [`FROM node@${DIGEST} AS deps  # 24-alpine`, 'FROM deps AS build', 'FROM scratch'].join('\n');
    expect(verificarImagens(dockerfile(conteudo))).toEqual([]);
  });

  it('cobra o `FROM` de base, que é onde a imagem publicada herda código de terceiro', () => {
    const violacoes = verificarImagens(dockerfile('FROM node:24-alpine\n'));
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]?.imagem).toBe('node:24-alpine');
  });

  it('aceita `FROM` por digest com o `AS` antes do comentário', () => {
    expect(verificarImagens(dockerfile(`FROM node@${DIGEST} AS runtime  # 24.11.1-alpine3.21`))).toEqual([]);
  });
});

describe('verificarImagens — a mesma tag tem de ser o mesmo digest', () => {
  it('reprova dois digests para a mesma imagem e a mesma tag, nomeando a primeira ocorrência', () => {
    const arquivos: Arquivo[] = [
      { nome: 'docker/docker-compose.yml', conteudo: `    image: ollama/ollama@${DIGEST}  # 0.33.1` },
      { nome: '.github/workflows/golden-set-rag.yml', conteudo: `        image: ollama/ollama@${OUTRO_DIGEST}  # 0.33.1` },
    ];
    const violacoes = verificarImagens(arquivos);
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]).toMatchObject({
      arquivo: '.github/workflows/golden-set-rag.yml',
      motivo: 'digest divergente para a mesma tag',
      primeiraOcorrencia: 'docker/docker-compose.yml:1',
    });
  });

  it('aceita a mesma imagem em TAGS diferentes com digests diferentes (alpine 3.20 e 3.20.3)', () => {
    const arquivos: Arquivo[] = [
      { nome: 'docker/backup/Dockerfile.prod', conteudo: `FROM alpine@${DIGEST}  # 3.20` },
      { nome: 'docker/engine/Dockerfile.prod', conteudo: `FROM alpine@${OUTRO_DIGEST}  # 3.20.3` },
    ];
    expect(verificarImagens(arquivos)).toEqual([]);
  });
});

describe('mensagemDeViolacao', () => {
  it('ensina a resolver a tag em digest, não só acusa', () => {
    const mensagem = mensagemDeViolacao({
      arquivo: 'docker/docker-compose.yml',
      linha: 29,
      imagem: 'neo4j:5.26-community',
      motivo: 'referência mutável',
    });
    expect(mensagem).toContain('docker/docker-compose.yml:29');
    expect(mensagem).toContain('docker manifest inspect');
    // Digest de ÍNDICE, senão o pin perde o multi-arch e o `linux-arm64` quebra.
    expect(mensagem).toContain('ÍNDICE');
  });

  it('explica para que serve o comentário de tag', () => {
    const mensagem = mensagemDeViolacao({
      arquivo: 'docker/docker-compose.yml',
      linha: 5,
      imagem: `pgvector/pgvector@${DIGEST}`,
      motivo: 'digest sem a tag em comentário',
    });
    expect(mensagem).toContain('que versão é esse hash');
  });
});

// --------------------------------------------------------------------------
// O repositório de verdade. O check roda no job `lint`, mas a suíte também o
// roda: um gate que só existe num job é um gate que some quando alguém mexe no
// job. Mesmo raciocínio de `flags-do-engine-no-compose.spec.ts`.
// --------------------------------------------------------------------------

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function lerArvore(raiz: string, prefixo: string, acumulado: Arquivo[]): void {
  for (const entrada of readdirSync(raiz, { withFileTypes: true })) {
    const caminho = path.join(raiz, entrada.name);
    const relativo = `${prefixo}/${entrada.name}`;
    if (entrada.isDirectory()) {
      lerArvore(caminho, relativo, acumulado);
    } else if (entrada.name.endsWith('.yml') || entrada.name.endsWith('.yaml') || entrada.name.startsWith('Dockerfile')) {
      acumulado.push({ nome: relativo, conteudo: readFileSync(caminho, 'utf8') });
    }
  }
}

function arquivosDoRepositorio(): Arquivo[] {
  const acumulado: Arquivo[] = [];
  for (const raiz of ['docker', 'deploy/k8s', '.github/workflows']) {
    lerArvore(path.join(RAIZ, raiz), raiz, acumulado);
  }
  return acumulado;
}

describe('o repositório', () => {
  it('não tem nenhuma imagem de terceiro presa por tag', () => {
    const violacoes = verificarImagens(arquivosDoRepositorio()).map(mensagemDeViolacao);
    expect(violacoes).toEqual([]);
  });

  it('tem imagens de terceiro para conferir — um check que não vê nada passa por acidente', () => {
    // Se as três raízes deixarem de ser varridas (renomeadas, movidas), o teste
    // acima ficaria verde sobre o vazio. Este é o contra-teste dele.
    const arquivos = arquivosDoRepositorio();
    const comDigest = arquivos.filter(({ conteudo }) => /@sha256:[0-9a-f]{64}/.test(conteudo));
    expect(comDigest.length).toBeGreaterThanOrEqual(15);
  });
});
