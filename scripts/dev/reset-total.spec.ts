import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// AT-181: o reset "total" NÃO toca volume — é a escolha conservadora (apagar
// volume descartaria workspaces e repositórios locais sem pedido) — e, como o
// preço disso é nunca reproduzir um primeiro clone (AT-172), o script o DIZ.
// Este spec guarda as duas metades: nenhuma linha EXECUTÁVEL remove ou recria
// volume, e o aviso sai antes de qualquer efeito e junto da frase de sucesso.
// Rodar o script de verdade derrubaria o ambiente de quem roda a suíte, então a
// prova é sobre o TEXTO dele, com os comentários fora — o cabeçalho cita
// `down -v` justamente para dizer que o script não o faz.

const aqui = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(aqui, 'reset-total.sh'), 'utf8');
const linhas = script.split('\n');
const executaveis = linhas.filter((l) => !/^\s*#/.test(l));

describe('reset-total.sh — volumes', () => {
  it('nenhuma linha executável remove ou recria volume', () => {
    const proibidos = [
      /\bdown\b/, // `down` (com ou sem -v) derrubaria o ambiente; `stop` é o que o script usa
      /\s-v(\s|$)/,
      /--volumes\b/,
      /\bvolume\s+(rm|prune)\b/,
      /\bsystem\s+prune\b/,
      /--renew-anon-volumes\b/,
      /\s-V(\s|$)/,
    ];
    // `psql -v ON_ERROR_STOP=1` é a única ocorrência legítima de `-v`: é
    // variável do psql, não volume.
    const suspeitas = executaveis
      .filter((l) => !l.includes('psql -v ON_ERROR_STOP=1'))
      .filter((l) => proibidos.some((re) => re.test(l)));
    expect(suspeitas).toEqual([]);
  });

  it('diz que não toca volume ANTES do primeiro efeito e DEPOIS da frase de sucesso', () => {
    const definicao = executaveis.findIndex((l) => l.startsWith('AVISO_DE_VOLUMES='));
    expect(definicao).toBeGreaterThanOrEqual(0);
    expect(executaveis[definicao]).toContain('NÃO são removidos nem recriados');
    expect(executaveis[definicao]).toContain('não reproduz um primeiro clone');

    const usos = executaveis
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /echo .*\$\{AVISO_DE_VOLUMES\}/.test(l))
      .map(({ i }) => i);
    const primeiroEfeito = executaveis.findIndex((l) => l.startsWith('node scripts/dev/preflight.mjs'));
    const sucesso = executaveis.findIndex((l) => l.includes('echo "reset completo'));
    expect(primeiroEfeito).toBeGreaterThan(0);
    expect(sucesso).toBeGreaterThan(0);

    expect(usos.some((i) => i > definicao && i < primeiroEfeito)).toBe(true);
    expect(usos).toContain(sucesso + 1);
  });
});
