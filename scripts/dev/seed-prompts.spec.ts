import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROMPTS_DIR,
  SECAO_DE_DOCUMENTACAO,
  carregarTemplates,
  hashBody,
  parseFrontMatter,
} from './seed-prompts.ts';

const TEMPLATE_VALIDO = `---
name: exemplo
version: "1"
---

Olá {{nome}}, isto é um template de teste.
`;

describe('parseFrontMatter', () => {
  it('extrai name/version/body de um template válido', () => {
    const parsed = parseFrontMatter(TEMPLATE_VALIDO, 'exemplo.md');

    expect(parsed.name).toBe('exemplo');
    expect(parsed.version).toBe('1');
    expect(parsed.body).toBe('Olá {{nome}}, isto é um template de teste.\n');
  });

  it('aceita campos extras no front-matter (ex.: pinned) sem quebrar', () => {
    const raw = `---
name: kickoff
version: "2"
pinned: true
---
Corpo fixo.
`;
    const parsed = parseFrontMatter(raw, 'kickoff.md');

    expect(parsed.name).toBe('kickoff');
    expect(parsed.version).toBe('2');
    expect(parsed.body).toBe('Corpo fixo.\n');
  });

  it('reprova arquivo sem front-matter, com mensagem clara', () => {
    expect(() => parseFrontMatter('só corpo, sem front-matter\n', 'sem-front-matter.md')).toThrow(
      /front-matter ausente ou malformado/,
    );
  });

  it('reprova front-matter sem o delimitador de fechamento', () => {
    const raw = `---
name: quebrado
version: "1"

Corpo que nunca fecha o front-matter.
`;
    expect(() => parseFrontMatter(raw, 'quebrado.md')).toThrow(/front-matter ausente ou malformado/);
  });

  it('reprova front-matter com YAML inválido', () => {
    const raw = `---
name: [não fecha a lista
version: "1"
---
Corpo.
`;
    expect(() => parseFrontMatter(raw, 'yaml-invalido.md')).toThrow(/não é YAML válido/);
  });

  it('reprova front-matter sem "name"', () => {
    const raw = `---
version: "1"
---
Corpo.
`;
    expect(() => parseFrontMatter(raw, 'sem-name.md')).toThrow(/campo "name"/);
  });

  it('reprova front-matter sem "version"', () => {
    const raw = `---
name: sem-versao
---
Corpo.
`;
    expect(() => parseFrontMatter(raw, 'sem-version.md')).toThrow(/campo "version"/);
  });

  it('reprova corpo vazio depois do front-matter', () => {
    const raw = `---
name: vazio
version: "1"
---
`;
    expect(() => parseFrontMatter(raw, 'vazio.md')).toThrow(/corpo do template está vazio/);
  });
});

describe('hashBody', () => {
  it('é determinístico: o mesmo conteúdo produz o mesmo hash', () => {
    const a = hashBody('Resuma concisamente os turnos abaixo.');
    const b = hashBody('Resuma concisamente os turnos abaixo.');

    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('conteúdo diferente produz hash diferente', () => {
    const a = hashBody('corpo A');
    const b = hashBody('corpo B');

    expect(a).not.toBe(b);
  });
});

// AT-244: o corpo semeado é o que o engine renderiza com `String.replace/3`
// (troca TODAS as ocorrências). Se a seção "## Variáveis" — documentação, que
// cita os mesmos `{{placeholders}}` — entrasse no corpo, o modelo receberia a
// documentação e o dado DUAS vezes (o sumarizador, os turnos em dobro).
describe('corpo semeado de cada prompts/*.md (AT-244)', () => {
  const arquivos = readdirSync(PROMPTS_DIR)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .sort();

  it('há templates para conferir (a varredura não passa vazia)', () => {
    expect(arquivos.length).toBeGreaterThan(0);
  });

  it.each(arquivos)('%s: o corpo não carrega a seção de documentação', async (arquivo) => {
    const template = (await carregarTemplates()).find((t) => t.file === arquivo);
    expect(template).toBeDefined();
    expect(template!.body).not.toContain(SECAO_DE_DOCUMENTACAO);
    expect(template!.body).not.toMatch(/^## /m);
    // e o arquivo, sim, documenta — a documentação só saiu do que é semeado
    expect(readFileSync(path.join(PROMPTS_DIR, arquivo), 'utf8')).toContain(SECAO_DE_DOCUMENTACAO);
  });

  it.each(arquivos)('%s: cada placeholder aparece UMA vez no corpo', async (arquivo) => {
    const template = (await carregarTemplates()).find((t) => t.file === arquivo)!;
    const contagem = new Map<string, number>();
    for (const [p] of template.body.matchAll(/\{\{[a-z_]+\}\}/g)) {
      contagem.set(p, (contagem.get(p) ?? 0) + 1);
    }
    const duplicados = [...contagem].filter(([, n]) => n > 1).map(([p]) => p);
    expect(duplicados).toEqual([]);
  });

  it('o sumarizador recebe os turnos uma vez só, pelo mesmo render do engine', async () => {
    const template = (await carregarTemplates()).find(
      (t) => t.name === 'context-manager-summarize',
    )!;
    const turnos = 'user: TURNO-MARCADOR';
    // `Engine.Harness.ContextManager.Default.render_template/2`: String.replace/3 global
    const prompt = template.body.replaceAll('{{turnos}}', turnos);

    expect(prompt.split('TURNO-MARCADOR').length - 1).toBe(1);
    expect(prompt).not.toContain('{{');
    expect(prompt.trimEnd().endsWith(turnos)).toBe(true);
  });
});

describe('parseFrontMatter e a seção de documentação', () => {
  it('corta o corpo na seção "## Variáveis", que nunca é semeada', () => {
    const raw = `---
name: doc
version: "1"
---

Resuma: {{turnos}}

## Variáveis

- \`{{turnos}}\` — os turnos.
`;
    expect(parseFrontMatter(raw, 'doc.md').body).toBe('Resuma: {{turnos}}\n');
  });

  it('arquivo sem a seção semeia o corpo inteiro', () => {
    expect(parseFrontMatter(TEMPLATE_VALIDO, 'exemplo.md').body).toBe(
      'Olá {{nome}}, isto é um template de teste.\n',
    );
  });

  it('reprova arquivo cujo corpo é só documentação', () => {
    const raw = `---
name: so-doc
version: "1"
---

## Variáveis

Nenhuma.
`;
    expect(() => parseFrontMatter(raw, 'so-doc.md')).toThrow(/corpo do template está vazio/);
  });
});
