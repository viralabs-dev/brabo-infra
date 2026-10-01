import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { IMAGENS_DOS_WORKFLOWS, imagemDoServico, resolverImagens } from './imagens-do-compose.ts';

/**
 * A fonte única de digest dos `services:` dos workflows (AT-246, ADR 0197): o
 * job reutilizável lê o compose, e o que ele devolve é o que o runner do CI
 * sobe. Os testes de baixo provam o leitor; os do fim provam que o workflow
 * reutilizável e a tabela não divergem — um output declarado sem linha na
 * tabela chegaria VAZIO ao `services:`.
 */

const PG = 'pgvector/pgvector:pg16@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b';
const OLLAMA = 'ollama/ollama:0.33.1@sha256:075246f72d4109385b4a01c3ac8e9cbd26a0bcb21cd7aa30edbccd24e1b3180c';

const COMPOSE = [
  'x-comum: &comum',
  '  image: nao/e:o-servico@sha256:' + '0'.repeat(64),
  'services:',
  '  postgres:',
  `    image: ${PG}`,
  '    environment:',
  '      image: nao-e-a-imagem',
  '  # comentário no meio',
  '  ollama:',
  `    image: "${OLLAMA}"  # 0.33.1`,
  '  api:',
  '    build: .',
  'volumes:',
  '  pgdata:',
].join('\n');

describe('imagemDoServico', () => {
  it('lê o `image:` filho direto do serviço, com aspas e comentário', () => {
    expect(imagemDoServico(COMPOSE, 'postgres')).toBe(PG);
    expect(imagemDoServico(COMPOSE, 'ollama')).toBe(OLLAMA);
  });

  it('recusa serviço que não existe — renomear no compose derruba o CI em vez de entregar vazio', () => {
    expect(() => imagemDoServico(COMPOSE, 'neo4j')).toThrow(/`neo4j` não existe/);
  });

  it('recusa serviço sem `image:` (construído localmente)', () => {
    expect(() => imagemDoServico(COMPOSE, 'api')).toThrow(/não tem `image:`/);
  });

  it('não confunde o `image:` de uma âncora `x-` nem uma chave aninhada com a do serviço', () => {
    expect(() => imagemDoServico(COMPOSE, 'pgdata')).toThrow();
    expect(imagemDoServico(COMPOSE, 'postgres')).toBe(PG);
  });

  it('recusa referência mutável — o runner do CI não sobe tag', () => {
    const compose = 'services:\n  postgres:\n    image: pgvector/pgvector:pg16\n';
    expect(() => imagemDoServico(compose, 'postgres')).toThrow(/ADR 0178/);
  });

  it('recusa digest sem a tag inline', () => {
    const compose = `services:\n  postgres:\n    image: pgvector/pgvector@sha256:${'a'.repeat(64)}\n`;
    expect(() => imagemDoServico(compose, 'postgres')).toThrow(/ADR 0178/);
  });

  it('recusa interpolação — o valor do compose de dev é sempre literal', () => {
    const compose = 'services:\n  postgres:\n    image: ${PG_IMAGE}\n';
    expect(() => imagemDoServico(compose, 'postgres')).toThrow(/ADR 0178/);
  });

  it('recusa compose sem `services:` na raiz', () => {
    expect(() => imagemDoServico('volumes:\n  x:\n', 'postgres')).toThrow(/services:/);
  });
});

describe('resolverImagens', () => {
  it('nomeia o compose e o output quando falha', () => {
    expect(() =>
      resolverImagens(() => COMPOSE, { neo4j: { compose: 'docker/docker-compose.yml', servico: 'neo4j' } }),
    ).toThrow(/docker\/docker-compose.yml → `neo4j`/);
  });

  it('lê cada compose uma vez', () => {
    let leituras = 0;
    const imagens = resolverImagens(() => {
      leituras += 1;
      return COMPOSE;
    });
    expect(imagens).toEqual({ pgvector: PG, ollama: OLLAMA });
    expect(leituras).toBe(1);
  });
});

// --------------------------------------------------------------------------
// O repositório de verdade.
// --------------------------------------------------------------------------

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ler = (caminho: string): string => readFileSync(path.join(RAIZ, caminho), 'utf8');

interface WorkflowReutilizavel {
  on: { workflow_call: { outputs: Record<string, { value: string }> } };
  jobs: Record<string, { outputs: Record<string, string>; steps: { id?: string; run?: string }[] }>;
}

describe('o repositório', () => {
  it('resolve toda linha da tabela contra o compose real, igual ao que o compose declara', () => {
    const imagens = resolverImagens(ler);
    for (const [saida, { compose, servico }] of Object.entries(IMAGENS_DOS_WORKFLOWS)) {
      const doCompose = parse(ler(compose)) as { services: Record<string, { image: string }> };
      expect(imagens[saida], saida).toBe(doCompose.services[servico]?.image);
    }
  });

  it('o workflow reutilizável declara EXATAMENTE as saídas da tabela, ligadas ao passo que roda este script', () => {
    const fluxo = parse(ler('.github/workflows/imagens-do-compose.yml')) as WorkflowReutilizavel;
    const saidas = fluxo.on.workflow_call.outputs;
    const tabela = Object.keys(IMAGENS_DOS_WORKFLOWS).sort();
    expect(Object.keys(saidas).sort()).toEqual(tabela);

    const [nomeDoJob, ...outros] = Object.keys(fluxo.jobs);
    expect(outros).toEqual([]);
    const job = fluxo.jobs[nomeDoJob!]!;
    expect(Object.keys(job.outputs).sort()).toEqual(tabela);

    const passo = job.steps.find(({ id }) => id !== undefined);
    expect(passo?.run?.trim()).toBe('node scripts/ci/imagens-do-compose.ts');

    // Cada saída vem do passo que LÊ o compose — nunca de um literal no meio.
    for (const nome of tabela) {
      expect(saidas[nome]?.value).toBe(`\${{ jobs.${nomeDoJob}.outputs.${nome} }}`);
      expect(job.outputs[nome]).toBe(`\${{ steps.${passo?.id}.outputs.${nome} }}`);
    }
  });
});
