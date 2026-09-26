import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AT-225 — a régua de produção dos tokens de serviço (`exigirTokenDeProducao`,
 * RN-114/RN-598/RN-601) existe em TRÊS processos e em DUAS linguagens:
 *
 * - api: `apps/api/src/infrastructure/security/service-token.ts`;
 * - broker: `apps/broker/src/config.ts`;
 * - engine: `apps/engine/config/runtime.exs`, INLINE, porque numa release o
 *   config provider roda antes de o código da aplicação estar carregado.
 *
 * Os três comparam o MESMO segredo, então a régua precisa ser a mesma: um piso
 * mais baixo num deles, ou um literal proibido diferente, faz um processo subir
 * em produção com um valor que os outros dois recusariam — e o mais frouxo é o
 * que decide o que abre `/internal/*` (ou o socket do Docker, no broker).
 * Nenhuma das três suítes alcança as outras (ExUnit não lê TypeScript, e a api
 * e o broker não se importam), então a guarda mora aqui, com os outros testes
 * que leem o repositório como texto — no molde de
 * `marca-de-credencial-do-runner.spec.ts`.
 *
 * O que se EXTRAI de cada lado, e se compara: o piso (valor E operador), o
 * literal proibido, as variáveis lidas, o trim de cada leitura, a régua
 * aplicada ao anterior em produção, e o anterior igual ao atual virando
 * ausente. Padrão que para de casar reprova NOMEANDO o arquivo — a forma mudou,
 * e este teste muda junto, nunca só um dos lados.
 */

const RAIZ = join(import.meta.dirname, '..', '..');

function ler(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), 'utf8');
}

function extrair(texto: string, padrao: RegExp, oque: string): string {
  const achado = texto.match(padrao);
  if (!achado?.[1]) {
    throw new Error(
      `não achei ${oque}. A régua mudou de FORMA (nome ou sintaxe), não só de ` +
        'valor — ajuste este teste junto, nunca só um dos lados.',
    );
  }
  return achado[1];
}

function exigirPresenca(texto: string, padrao: RegExp, oque: string): void {
  if (!padrao.test(texto)) {
    throw new Error(
      `não achei ${oque}. Se a régua mudou de forma, ajuste este teste junto; ` +
        'se ela mudou de COMPORTAMENTO, os três processos mudam juntos.',
    );
  }
}

interface Regua {
  arquivo: string;
  literal: string;
  minimo: number;
  operador: string;
  variaveis: string[];
  leiturasSemTrim: string[];
}

/** Variáveis `BRABO_SERVICE_TOKEN*` lidas do ambiente, e as lidas sem trim. */
function leituras(
  texto: string,
  todas: RegExp,
  comTrim: RegExp,
): { variaveis: string[]; semTrim: string[] } {
  const lidas = [...texto.matchAll(todas)].map((m) => m[1] as string);
  const aparadas = new Set(
    [...texto.matchAll(comTrim)].map((m) => m[1] as string),
  );
  return {
    variaveis: [...new Set(lidas)].sort(),
    semTrim: [...new Set(lidas.filter((v) => !aparadas.has(v)))].sort(),
  };
}

function reguaDaApi(): Regua {
  const arquivo = 'apps/api/src/infrastructure/security/service-token.ts';
  const texto = ler(arquivo);
  const { variaveis, semTrim } = leituras(
    texto,
    /process\.env\.(BRABO_SERVICE_TOKEN\w*)/g,
    /\(process\.env\.(BRABO_SERVICE_TOKEN\w*) \?\? ''\)\.trim\(\)/g,
  );
  exigirPresenca(
    texto,
    /exigirTokenDeProducao\('BRABO_SERVICE_TOKEN_PREVIOUS', bruto\)/,
    `a régua aplicada ao anterior em ${arquivo}`,
  );
  exigirPresenca(
    texto,
    /anterior === tokenDeServicoAtual\(\) \? null : anterior/,
    `o anterior igual ao atual virando ausente em ${arquivo}`,
  );
  return {
    arquivo,
    literal: extrair(texto, /const PADRAO_DEV = '([^']+)'/, `o literal em ${arquivo}`),
    minimo: Number(
      extrair(texto, /const TAMANHO_MINIMO = (\d+);/, `o piso em ${arquivo}`),
    ),
    operador: extrair(
      texto,
      /bruto\.length (<=?) TAMANHO_MINIMO\b/,
      `a comparação com o piso em ${arquivo}`,
    ),
    variaveis,
    leiturasSemTrim: semTrim,
  };
}

function reguaDoBroker(): Regua {
  const arquivo = 'apps/broker/src/config.ts';
  const texto = ler(arquivo);
  const { variaveis, semTrim } = leituras(
    texto,
    /env\.(BRABO_SERVICE_TOKEN\w*)/g,
    /\(env\.(BRABO_SERVICE_TOKEN\w*) \?\? ''\)\.trim\(\)/g,
  );
  exigirPresenca(
    texto,
    /exigirTokenDeProducao\('BRABO_SERVICE_TOKEN_PREVIOUS', anteriorBruto\)/,
    `a régua aplicada ao anterior em ${arquivo}`,
  );
  exigirPresenca(
    texto,
    /anterior !== tokenDeServico \? anterior : null/,
    `o anterior igual ao atual virando ausente em ${arquivo}`,
  );
  return {
    arquivo,
    literal: extrair(
      texto,
      /const TOKEN_PADRAO_DEV = '([^']+)'/,
      `o literal em ${arquivo}`,
    ),
    minimo: Number(
      extrair(
        texto,
        /const TAMANHO_MINIMO_DO_TOKEN = (\d+);/,
        `o piso em ${arquivo}`,
      ),
    ),
    operador: extrair(
      texto,
      /bruto\.length (<=?) TAMANHO_MINIMO_DO_TOKEN\b/,
      `a comparação com o piso em ${arquivo}`,
    ),
    variaveis,
    leiturasSemTrim: semTrim,
  };
}

function reguaDoEngine(): Regua {
  const arquivo = 'apps/engine/config/runtime.exs';
  const texto = ler(arquivo);
  const { variaveis, semTrim } = leituras(
    texto,
    /System\.get_env\("(BRABO_SERVICE_TOKEN\w*)"/g,
    /String\.trim\(System\.get_env\("(BRABO_SERVICE_TOKEN\w*)"\) \|\| ""\)/g,
  );
  exigirPresenca(
    texto,
    /exigir_token_de_servico_de_producao\.\("BRABO_SERVICE_TOKEN_PREVIOUS", bruto\)/,
    `a régua aplicada ao anterior em ${arquivo}`,
  );
  exigirPresenca(
    texto,
    /if anterior == service_token, do: nil, else: anterior/,
    `o anterior igual ao atual virando ausente em ${arquivo}`,
  );
  return {
    arquivo,
    literal: extrair(
      texto,
      /^token_de_servico_padrao_dev = "([^"]+)"$/m,
      `o literal em ${arquivo}`,
    ),
    minimo: Number(
      extrair(
        texto,
        /^token_de_servico_tamanho_minimo = (\d+)$/m,
        `o piso em ${arquivo}`,
      ),
    ),
    operador: extrair(
      texto,
      /String\.length\(bruto\) (<=?) token_de_servico_tamanho_minimo\b/,
      `a comparação com o piso em ${arquivo}`,
    ),
    variaveis,
    leiturasSemTrim: semTrim,
  };
}

describe('AT-225 — a régua dos tokens de serviço é a MESMA nos três processos', () => {
  const api = reguaDaApi();
  const reguas = [api, reguaDoBroker(), reguaDoEngine()];

  it.each(reguas.slice(1))('$arquivo usa o MESMO piso da api', (regua) => {
    expect(regua.minimo, regua.arquivo).toBe(api.minimo);
    expect(regua.operador, regua.arquivo).toBe(api.operador);
  });

  it.each(reguas.slice(1))(
    '$arquivo recusa o MESMO literal público da api',
    (regua) => {
      expect(regua.literal, regua.arquivo).toBe(api.literal);
    },
  );

  it.each(reguas)('$arquivo lê as duas variáveis, e as duas com trim', (regua) => {
    expect(regua.variaveis, regua.arquivo).toEqual([
      'BRABO_SERVICE_TOKEN',
      'BRABO_SERVICE_TOKEN_PREVIOUS',
    ]);
    expect(regua.leiturasSemTrim, regua.arquivo).toEqual([]);
  });

  it('o piso não afrouxou abaixo do que a RN-114 fixou', () => {
    // A comparação acima pega divergência; esta pega os três descendo JUNTOS.
    expect(api.minimo).toBeGreaterThanOrEqual(16);
    expect(api.operador).toBe('<');
  });

  it('o default do compose de dev é o literal que produção recusa', () => {
    // Se o literal mudar nos três processos e não aqui, o compose de dev passa
    // a suprir um valor PÚBLICO que produção deixou de reconhecer como tal.
    const compose = ler('docker/docker-compose.yml');
    const defaults = [
      ...compose.matchAll(/\$\{BRABO_SERVICE_TOKEN:-([^}]+)\}/g),
    ].map((m) => m[1]);
    expect(defaults.length).toBeGreaterThan(0);
    for (const valor of defaults) expect(valor).toBe(api.literal);
  });
});
