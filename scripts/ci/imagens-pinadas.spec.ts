import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  mensagemDeViolacao,
  partesDaReferencia,
  saidasDoWorkflowReutilizavel,
  usesDosJobs,
  verificarImagens,
  WORKFLOW_DAS_IMAGENS,
  type Arquivo,
} from './imagens-pinadas.ts';

/**
 * A regra, irmã da de `actions-pinadas.spec.ts`: toda imagem de TERCEIRO presa
 * por digest, com a tag DENTRO da referência — `imagem:tag@sha256:<índice>`
 * (ADR 0178, sobre o ADR 0159). Tag de registry é ponteiro mutável; digest é
 * conteúdo. Imagem que este repositório CONSTRÓI passa — não há terceiro que
 * possa mover nada, e onde ela atravessa um registry o ADR 0119 já a resolve
 * por digest.
 */

const DIGEST = 'sha256:22ec5cd05a8cbb372fc4bed5e384c30bc75fd92504c72be4462039761b105f61';
const OUTRO_DIGEST = 'sha256:075246f72d4109385b4a01c3ac8e9cbd26a0bcb21cd7aa30edbccd24e1b3180c';

const compose = (conteudo: string): Arquivo[] => [{ nome: 'docker/docker-compose.yml', conteudo }];
const dockerfile = (conteudo: string): Arquivo[] => [{ nome: 'docker/api/Dockerfile', conteudo }];

describe('verificarImagens — compose, manifest e workflow', () => {
  it('aceita imagem presa por digest com a tag inline', () => {
    expect(verificarImagens(compose(`    image: neo4j:5.26-community@${DIGEST}`))).toEqual([]);
  });

  it('aceita um comentário que diz a MESMA tag da referência', () => {
    expect(verificarImagens(compose(`    image: neo4j:5.26-community@${DIGEST}  # 5.26-community`))).toEqual([]);
  });

  it('reprova tag — o estado em que estavam as 37 referências do repositório antes do ADR 0159', () => {
    const violacoes = verificarImagens(compose('    image: neo4j:5.26-community'));
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]).toMatchObject({ linha: 1, imagem: 'neo4j:5.26-community', motivo: 'referência mutável' });
  });

  it('reprova imagem sem tag nenhuma, que é o ponteiro mais móvel de todos', () => {
    expect(verificarImagens(compose('    image: neo4j'))[0]?.motivo).toBe('referência mutável');
  });

  it('reprova digest sem tag: pin que ninguém sabe que versão é', () => {
    const violacoes = verificarImagens(compose(`    image: neo4j@${DIGEST}`));
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]?.motivo).toBe('digest sem a tag inline');
  });

  it('reprova a forma do ADR 0159 — tag só no comentário — porque o Dependabot não lê comentário', () => {
    const violacoes = verificarImagens(compose(`    image: neo4j@${DIGEST}  # 5.26-community`));
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]?.motivo).toBe('digest sem a tag inline');
  });

  it('reprova comentário que afirma OUTRA tag — o que sobra de uma subida de versão', () => {
    const violacoes = verificarImagens(compose(`    image: neo4j:5.27-community@${DIGEST}  # 5.26-community`));
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]).toMatchObject({ motivo: 'comentário diverge da tag inline', tagDoComentario: '5.26-community' });
  });

  it('não julga comentário em PROSA — o check não é revisor de texto', () => {
    expect(verificarImagens(compose(`    image: neo4j:5.26-community@${DIGEST}  # a versão community`))).toEqual([]);
  });

  it('reprova digest de 63 hex — quase-digest não é digest', () => {
    const quase = DIGEST.slice(0, -1);
    expect(verificarImagens(compose(`    image: neo4j:5.26@${quase}`))[0]?.motivo).toBe('referência mutável');
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
    expect(violacoes[0]?.motivo).toBe('literal no workflow');
  });

  it('aceita valor entre aspas — YAML permite as duas formas', () => {
    expect(verificarImagens(compose(`    image: "neo4j:5.26-community@${DIGEST}"`))).toEqual([]);
  });

  it('ignora linha comentada: é prosa SOBRE uma imagem, não uma imagem', () => {
    expect(verificarImagens(compose('    # antes disto era image: neo4j:5.26-community'))).toEqual([]);
  });

  it('ignora `image:` que abre um mapa (o `repository:` dos values do Helm)', () => {
    const conteudo = 'image:\n  repository: otel/opentelemetry-collector-contrib\n';
    expect(verificarImagens([{ nome: 'deploy/k8s/helm/otel-collector-values.yaml', conteudo }])).toEqual([]);
  });
});

describe('partesDaReferencia', () => {
  it('separa a tag do nome, com e sem digest', () => {
    expect(partesDaReferencia(`neo4j:5.26-community@${DIGEST}`)).toEqual({ nome: 'neo4j', tag: '5.26-community' });
    expect(partesDaReferencia('neo4j')).toEqual({ nome: 'neo4j', tag: undefined });
  });

  it('não confunde a PORTA do registry com a tag', () => {
    expect(partesDaReferencia(`registro:5000/ns/pg@${DIGEST}`)).toEqual({ nome: 'registro:5000/ns/pg', tag: undefined });
    expect(partesDaReferencia(`registro:5000/ns/pg:16@${DIGEST}`)).toEqual({ nome: 'registro:5000/ns/pg', tag: '16' });
  });
});

describe('verificarImagens — o que NÃO é imagem de terceiro', () => {
  it('não cobra as imagens que este repositório constrói', () => {
    const conteudo = '    image: brabo-api:prod\n    image: ghcr.io/daneiel/brabo-engine:prod\n';
    expect(verificarImagens(compose(conteudo))).toEqual([]);
  });

  it('não cobra referência interpolada — o install.sh grava as imagens já por digest', () => {
    const linha = '    image: ${BRABO_API_IMAGE:?defina BRABO_API_IMAGE}';
    expect(verificarImagens(compose(linha))).toEqual([]);
  });

  it('não cobra estágio de build multi-stage nem `FROM scratch`', () => {
    const conteudo = [`FROM node:24-alpine@${DIGEST} AS deps`, 'FROM deps AS build', 'FROM scratch'].join('\n');
    expect(verificarImagens(dockerfile(conteudo))).toEqual([]);
  });

  it('cobra o `FROM` de base, que é onde a imagem publicada herda código de terceiro', () => {
    const violacoes = verificarImagens(dockerfile('FROM node:24-alpine\n'));
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]?.imagem).toBe('node:24-alpine');
  });
});

describe('verificarImagens — Dockerfile', () => {
  it('aceita a tag inline, com o `AS` na linha do FROM', () => {
    expect(verificarImagens(dockerfile(`FROM node:24.11.1-alpine3.21@${DIGEST} AS runtime`))).toEqual([]);
  });

  it('reprova a forma do ADR 0159 — tag na linha de cima, digest puro no FROM', () => {
    const conteudo = ['# 24.11.1-alpine3.21', `FROM node@${DIGEST} AS runtime`].join('\n');
    expect(verificarImagens(dockerfile(conteudo))[0]?.motivo).toBe('digest sem a tag inline');
  });

  it('reprova a linha de cima que afirma OUTRA tag', () => {
    const conteudo = ['# 24.10.0-alpine3.21', `FROM node:24.11.1-alpine3.21@${DIGEST} AS runtime`].join('\n');
    expect(verificarImagens(dockerfile(conteudo))[0]).toMatchObject({
      motivo: 'comentário diverge da tag inline',
      tagDoComentario: '24.10.0-alpine3.21',
    });
  });

  it('prosa acima do FROM não é tag — é o que já mora em quase todos', () => {
    const conteudo = ['# Estágio 1: dependências, separado para a camada não invalidar', `FROM node:24@${DIGEST}`].join(
      '\n',
    );
    expect(verificarImagens(dockerfile(conteudo))).toEqual([]);
  });

  // O parser do Docker só reconhece `#` no INÍCIO da linha. `FROM x@sha # tag`
  // não é um FROM comentado, é um FROM com três argumentos, e o build morre
  // em "FROM requires either one or three arguments". O `hadolint` passava.
  it('REPROVA comentário no fim da linha do FROM, mesmo com a tag inline — quebra o build', () => {
    const violacoes = verificarImagens(dockerfile(`FROM node:24.11.1-alpine3.21@${DIGEST} AS runtime  # 24.11.1`));
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]?.motivo).toBe('comentário no fim do FROM');
    expect(mensagemDeViolacao(violacoes[0]!)).toContain('FROM requires either one or three arguments');
  });
});

describe('verificarImagens — a mesma tag tem de ser o mesmo digest', () => {
  it('reprova dois digests para a mesma imagem e a mesma tag INLINE, nomeando a primeira ocorrência', () => {
    const arquivos: Arquivo[] = [
      { nome: 'docker/docker-compose.yml', conteudo: `    image: ollama/ollama:0.33.1@${DIGEST}` },
      {
        nome: 'deploy/k8s/base/ollama/job-model-loader.yaml',
        conteudo: `          image: ollama/ollama:0.33.1@${OUTRO_DIGEST}`,
      },
    ];
    const violacoes = verificarImagens(arquivos);
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]).toMatchObject({
      arquivo: 'deploy/k8s/base/ollama/job-model-loader.yaml',
      motivo: 'digest divergente para a mesma tag',
      primeiraOcorrencia: 'docker/docker-compose.yml:1',
    });
  });

  it('aceita a mesma imagem em TAGS diferentes com digests diferentes (alpine 3.20 e 3.20.3)', () => {
    const arquivos: Arquivo[] = [
      { nome: 'docker/backup/Dockerfile.prod', conteudo: `FROM alpine:3.20@${DIGEST}` },
      { nome: 'docker/engine/Dockerfile.prod', conteudo: `FROM alpine:3.20.3@${OUTRO_DIGEST}` },
    ];
    expect(verificarImagens(arquivos)).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// Workflows: a imagem vem do compose, por um job anterior (ADR 0197). Cada
// teste abaixo é a MUTAÇÃO de uma das três regras novas: desligar a regra
// (ou afrouxar a forma da expressão) derruba pelo menos um deles.
// --------------------------------------------------------------------------

const REUTILIZAVEL: Arquivo = {
  nome: WORKFLOW_DAS_IMAGENS,
  conteudo: [
    'on:',
    '  workflow_call:',
    '    outputs:',
    '      pgvector:',
    '        value: ${{ jobs.ler.outputs.pgvector }}',
    '      ollama:',
    '        value: ${{ jobs.ler.outputs.ollama }}',
    'jobs:',
    '  ler:',
    '    runs-on: ubuntu-latest',
  ].join('\n'),
};

/** Um workflow com o job `imagens` chamando o reutilizável e um `services:` com `imagem`. */
function workflowCom(imagem: string, jobDasImagens = '    uses: ./.github/workflows/imagens-do-compose.yml'): Arquivo[] {
  const conteudo = [
    'on: pull_request',
    'jobs:',
    '  imagens:',
    jobDasImagens,
    '',
    '  outro:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1',
    '',
    '  test-x:',
    '    needs: [imagens, outro]',
    '    services:',
    '      postgres:',
    `        image: ${imagem}`,
  ].join('\n');
  return [REUTILIZAVEL, { nome: '.github/workflows/ci.yml', conteudo }];
}

describe('verificarImagens — workflow lê a imagem do compose (ADR 0197)', () => {
  it('aceita `${{ needs.<job>.outputs.<imagem> }}` de um job que chama o reutilizável', () => {
    expect(verificarImagens(workflowCom('${{ needs.imagens.outputs.pgvector }}'))).toEqual([]);
  });

  it('aceita a mesma expressão entre aspas, e sem espaço interno', () => {
    expect(verificarImagens(workflowCom('"${{ needs.imagens.outputs.pgvector }}"'))).toEqual([]);
    expect(verificarImagens(workflowCom('${{needs.imagens.outputs.ollama}}'))).toEqual([]);
  });

  it('reprova literal no workflow MESMO preso por digest — é a duplicata que o Dependabot não lê', () => {
    const violacoes = verificarImagens(workflowCom(`pgvector/pgvector:pg16@${DIGEST}`));
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]).toMatchObject({ motivo: 'literal no workflow', imagem: `pgvector/pgvector:pg16@${DIGEST}` });
    expect(mensagemDeViolacao(violacoes[0]!)).toContain('imagens-do-compose');
  });

  it('reprova a forma curta `container: <imagem>` de um job', () => {
    const arquivos: Arquivo[] = [{ nome: '.github/workflows/x.yml', conteudo: '    container: node:24-alpine' }];
    expect(verificarImagens(arquivos)[0]?.motivo).toBe('literal no workflow');
  });

  it('não confunde `container:` que abre um mapa com uma imagem', () => {
    const arquivos: Arquivo[] = [{ nome: '.github/workflows/x.yml', conteudo: '    container:\n      options: --x' }];
    expect(verificarImagens(arquivos)).toEqual([]);
  });

  it('aceita imagem do PRÓPRIO produto num workflow, como nas outras árvores', () => {
    expect(verificarImagens(workflowCom('brabo-api:prod'))).toEqual([]);
  });

  // O literal ESCONDIDO. Cada caso é um lugar onde uma referência mutável mora
  // dentro de uma expressão, e o padrão antigo (`\S+`) nem via a linha.
  it.each([
    ["${{ 'postgres:16' }}", 'literal dentro da expressão'],
    ["${{ needs.imagens.outputs.pgvector || 'postgres:16' }}", 'valor padrão com `||`'],
    ["${{ 'postgres:16' || needs.imagens.outputs.pgvector }}", 'literal ANTES da saída, com `||`'],
    ['${{ env.IMAGEM }}', '`env.`'],
    ['${{ vars.IMAGEM }}', '`vars.`'],
    ["${{ format('{0}:16', 'postgres') }}", '`format()`'],
    ['${{ needs.imagens.outputs.pgvector }}-alpine', 'sufixo depois da expressão'],
    ['${{ needs.imagens.outputs.pgvector', 'expressão sem fecho'],
  ])('reprova `%s` (%s)', (imagem) => {
    const violacoes = verificarImagens(workflowCom(imagem));
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]?.motivo).toBe('expressão de imagem fora da forma');
  });

  it('reprova literal com expressão no MEIO — `postgres:${{ … }}` é literal', () => {
    expect(verificarImagens(workflowCom('postgres:${{ inputs.versao }}'))[0]?.motivo).toBe('literal no workflow');
  });

  it('reprova `needs` de um job que NÃO chama o reutilizável — ele pode devolver qualquer literal', () => {
    const violacoes = verificarImagens(workflowCom('${{ needs.outro.outputs.pgvector }}'));
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]?.motivo).toBe('imagem do workflow fora do compose');
  });

  it('reprova o job `imagens` quando ele chama OUTRO workflow', () => {
    const violacoes = verificarImagens(
      workflowCom('${{ needs.imagens.outputs.pgvector }}', '    uses: ./.github/workflows/outro.yml'),
    );
    expect(violacoes[0]?.motivo).toBe('imagem do workflow fora do compose');
  });

  it('reprova um output que o reutilizável não declara', () => {
    const violacoes = verificarImagens(workflowCom('${{ needs.imagens.outputs.neo4j }}'));
    expect(violacoes[0]?.motivo).toBe('imagem do workflow fora do compose');
  });

  it('ignora linha comentada num workflow, como nas outras árvores', () => {
    const arquivos: Arquivo[] = [{ nome: '.github/workflows/x.yml', conteudo: '        # image: postgres:16' }];
    expect(verificarImagens(arquivos)).toEqual([]);
  });
});

describe('usesDosJobs e saidasDoWorkflowReutilizavel', () => {
  it('lê o `uses:` do JOB, nunca o `- uses:` de um passo', () => {
    const jobs = usesDosJobs(workflowCom('x')[1]!.conteudo);
    expect(jobs.get('imagens')).toBe('./.github/workflows/imagens-do-compose.yml');
    expect(jobs.get('outro')).toBeUndefined();
    expect(jobs.has('test-x')).toBe(true);
  });

  it('lê as saídas declaradas em `on.workflow_call.outputs`, e só elas', () => {
    expect([...saidasDoWorkflowReutilizavel(REUTILIZAVEL.conteudo)].sort()).toEqual(['ollama', 'pgvector']);
    expect(saidasDoWorkflowReutilizavel('on: pull_request\n').size).toBe(0);
  });
});

describe('mensagemDeViolacao', () => {
  it('ensina a resolver a tag em digest, e a forma inline, não só acusa', () => {
    const mensagem = mensagemDeViolacao({
      arquivo: 'docker/docker-compose.yml',
      linha: 29,
      imagem: 'neo4j:5.26-community',
      motivo: 'referência mutável',
    });
    expect(mensagem).toContain('docker/docker-compose.yml:29');
    expect(mensagem).toContain('docker buildx imagetools inspect');
    // Digest de ÍNDICE, senão o pin perde o multi-arch e o `linux-arm64` quebra.
    expect(mensagem).toContain('ÍNDICE');
    expect(mensagem).toContain('<imagem>:<tag>@sha256:');
  });

  it('explica por que a tag tem de estar DENTRO da referência', () => {
    const mensagem = mensagemDeViolacao({
      arquivo: 'docker/docker-compose.yml',
      linha: 5,
      imagem: `pgvector/pgvector@${DIGEST}`,
      motivo: 'digest sem a tag inline',
    });
    expect(mensagem).toContain('que versão');
    expect(mensagem).toContain('Dependabot');
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

  it('não tem imagem literal em workflow nenhum: os `services:` leem do compose (ADR 0197)', () => {
    const workflows = arquivosDoRepositorio().filter(({ nome }) => nome.startsWith('.github/workflows/'));
    const expressoes = workflows.flatMap(({ conteudo }) =>
      conteudo.split('\n').filter((linha) => /^\s*image:\s*\$\{\{\s*needs\.imagens\.outputs\./.test(linha)),
    );
    // ci.yml (test-api-shard, test-engine) e os dois golden-sets (pgvector + ollama).
    expect(expressoes.length).toBeGreaterThanOrEqual(6);
    const semComentario = workflows.map(({ conteudo }) => conteudo.replace(/^\s*#.*$/gm, ''));
    expect(semComentario.filter((conteudo) => /^\s*image:.*@sha256:/m.test(conteudo))).toEqual([]);
  });
});
