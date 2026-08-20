import { describe, expect, it } from 'vitest';
import { hashBody, parseFrontMatter } from './seed-prompts.ts';

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
