import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { ler } from '../docs/fontes.mjs';

/**
 * As FLAGS BOOLEANAS que o `runtime.exs` do engine lê, contra o
 * `environment:` do serviço `engine` dos DOIS composes.
 *
 * Por que este teste existe: `docker compose` NÃO repassa o ambiente do host
 * ao container — uma variável só chega ao processo se estiver escrita no
 * `environment:` (ou num `env_file`). O engine tinha TREZE variáveis de
 * Anamnese/Psicólogo mapeadas ali, todas TETOS de custo, e NENHUMA das duas
 * flags que decidem se os agentes rodam. `ANAMNESE_ENABLED` e
 * `PSYCHOLOGIST_ENABLED` chegavam vazias, `runtime.exs` caía no default
 * `"false"`, e os dois agentes ficavam desligados em silêncio, sem erro.
 *
 * Medido no compose de dev de pé, antes da correção:
 *
 *     $ docker compose … exec -T engine sh -lc \
 *         'echo "[$START_ANAMNESE] [$ANAMNESE_ENABLED] [$PSYCHOLOGIST_ENABLED]"'
 *     [true] [] []
 *
 * E o que torna isso um defeito, e não uma omissão neutra: TRÊS lugares
 * prometiam por escrito que a pausa de 2026-08-10 era reversível — o docblock
 * de `AnamneseSchedulerWorker.enabled?/0` ("Ligar de volta é
 * `ANAMNESE_ENABLED=true` e reiniciar o engine"), o de
 * `PsychologistWorker.enabled?/0`, e `docs/reference/configuration.md`. A
 * promessa era falsa em ambiente nenhum. Ver RN-540.
 *
 * Por que a lista é DERIVADA e não travada à mão: das 58 variáveis que o
 * `runtime.exs` lê, a maioria são tetos numéricos com default bom (e
 * legitimamente ausentes do compose) ou coisas de release (`SECRET_KEY_BASE`,
 * `POOL_SIZE`, `PHX_HOST`). O recorte que NÃO admite ausência é o das flags
 * BOOLEANAS — `System.get_env("X", "true"|"false") == "true"` —, porque uma
 * flag existe exatamente para ser virada, e a virada acontece pelo ambiente.
 * Uma flag sem linha no compose é um interruptor sem fio: o default do código
 * vale para sempre, e quem tenta mudá-lo não recebe erro nenhum.
 *
 * Nos TRÊS arquivos a flag tem de estar mapeada COM o default do código — um
 * default divergente faria o compose decidir produto por baixo do
 * `runtime.exs`. A exceção é DECLARADA, por arquivo, em
 * `DEFAULTS_DIVERGENTES_DECLARADOS`: os composes de PRODUÇÃO e de INSTALAÇÃO
 * desligam de propósito os dois agentes de fundo (`START_OUTBOX_DRAIN` e
 * `START_ANAMNESE` em `false` contra o `true` do código, com o motivo escrito
 * ao lado no próprio compose), e cobrar igualdade ali reprovaria uma decisão
 * consciente. Até a AT-202 a igualdade só valia no de dev e o de instalação nem
 * entrava no teste — foi assim que seis flags ficaram de fora dele.
 *
 * `deploy/k8s/` fica FORA de propósito, e não por esquecimento: lá não existe
 * a camada que quebra: um Deployment/ConfigMap não intercepta nada — a
 * variável é escrita onde toda variável é escrita, e o `brabo-config` tem
 * QUATRO literais (endereços de serviço e nível de log), sem nenhum dos 13
 * tetos nem `START_ANAMNESE`. Não há interruptor sem fio para consertar ali.
 */

const CAMINHO_RUNTIME = 'apps/engine/config/runtime.exs';
const COMPOSE_DEV = 'docker/docker-compose.yml';
const COMPOSE_PROD = 'docker/docker-compose.prod.yml';
const COMPOSE_INSTALL = 'docker/docker-compose.install.yml';
const COMPOSES = [COMPOSE_DEV, COMPOSE_PROD, COMPOSE_INSTALL];

/**
 * Flag cujo default NO COMPOSE difere do `runtime.exs` de propósito, por
 * arquivo, com o motivo. Nome fora daqui tem de repetir o default do código.
 */
export const DEFAULTS_DIVERGENTES_DECLARADOS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  [COMPOSE_PROD]: {
    START_OUTBOX_DRAIN:
      'agente de fundo (Psicólogo via outbox) desligado: gastaria LLM sem provider configurado',
    START_ANAMNESE:
      'agente de fundo (Anamnese periódica) desligado: gastaria LLM sem provider configurado',
  },
  [COMPOSE_INSTALL]: {
    START_OUTBOX_DRAIN:
      'mesma decisão do compose de produção, de onde a instalação herdou o bloco',
    START_ANAMNESE:
      'mesma decisão do compose de produção, de onde a instalação herdou o bloco',
  },
};

/**
 * Flag booleana deliberadamente FORA do compose, com o motivo. Vazio hoje —
 * e vazio aqui não esconde nada, é o mapa do compose que precisa estar cheio.
 * Existe para que "fora por decisão" tenha onde ser dito, em vez de virar
 * indistinguível de "fora por esquecimento", que é o defeito que este arquivo
 * pega.
 */
export const FLAGS_FORA_DO_COMPOSE: Readonly<Record<string, string>> = {};

/**
 * O par (nome, default) de toda flag booleana do `runtime.exs`. Casa só a
 * forma `System.get_env("X", "true"|"false") == "true"`, que é como TODA flag
 * de liga/desliga do engine é escrita — a variável ternária (`ECTO_IPV6`, em
 * `~w(true 1)`) e as numéricas ficam de fora por não serem interruptor.
 */
export function flagsBooleanas(fonte: string): Map<string, string> {
  const achadas = new Map<string, string>();
  const padrao =
    /System\.get_env\(\s*"([A-Z0-9_]+)"\s*,\s*"(true|false)"\s*\)\s*==\s*"true"/g;
  for (const m of fonte.matchAll(padrao)) {
    achadas.set(m[1] as string, m[2] as string);
  }
  return achadas;
}

/** O `environment:` do serviço `engine`, como mapa nome -> valor textual. */
function ambienteDoEngine(caminho: string): Map<string, string> {
  const doc = parse(ler(caminho)) as {
    services?: Record<string, { environment?: unknown }>;
  };
  const bruto = doc?.services?.engine?.environment;
  if (bruto === undefined) {
    throw new Error(
      `${caminho}: não achei \`services.engine.environment\`. ` +
        'Se o serviço mudou de nome ou o compose mudou de forma, atualize ' +
        'este teste — ele é o que impede uma flag de virar interruptor sem fio.',
    );
  }
  const entradas: [string, string][] = Array.isArray(bruto)
    ? // A forma de lista (`- NOME=valor`) é válida em Compose; o repositório
      // usa a de mapa nos dois arquivos, mas ler as duas custa uma linha e
      // evita que uma reescrita de forma passe como "nenhuma flag mapeada".
      bruto.map((linha) => {
        const texto = String(linha);
        const igual = texto.indexOf('=');
        return igual === -1
          ? [texto, '']
          : [texto.slice(0, igual), texto.slice(igual + 1)];
      })
    : Object.entries(bruto as Record<string, unknown>).map(([k, v]) => [
        k,
        v === null || v === undefined ? '' : String(v),
      ]);
  if (entradas.length === 0) {
    throw new Error(
      `${caminho}: \`services.engine.environment\` veio VAZIO da leitura. ` +
        'Ambiente vazio passaria calado em qualquer comparação — por isso falha aqui.',
    );
  }
  return new Map(entradas);
}

/**
 * O default de `${NOME:-valor}`. `null` quando a linha não tem essa forma —
 * o que é legítimo (`PHX_SERVER: "true"` é literal), e por isso a checagem de
 * default só se aplica quando há um para comparar.
 */
export function defaultDaInterpolacao(valor: string): string | null {
  const m = /^\$\{[A-Z0-9_]+:-(.*)\}$/.exec(valor.trim());
  return m ? (m[1] as string) : null;
}

const flags = flagsBooleanas(ler(CAMINHO_RUNTIME));

describe('flags booleanas do engine × `environment:` do compose', () => {
  it('o extrator acha as flags que já conhecíamos', () => {
    // Piso, não igualdade: protege o REGEX. Se ele parar de casar (arquivo
    // movido, literal reescrito), as comparações abaixo passariam comparando
    // um conjunto vazio contra qualquer coisa.
    expect([...flags.keys()]).toEqual(
      expect.arrayContaining([
        'ANAMNESE_ENABLED',
        'PSYCHOLOGIST_ENABLED',
        'START_ANAMNESE',
        'START_OUTBOX_DRAIN',
      ]),
    );
    expect(flags.size).toBeGreaterThanOrEqual(6);
    // O default do código é o que a RN-540 obriga o compose a repetir — se
    // ele deixasse de ser lido, a checagem de default viraria decorativa.
    expect(flags.get('ANAMNESE_ENABLED')).toBe('false');
    expect(flags.get('PSYCHOLOGIST_ENABLED')).toBe('false');
    expect(flags.get('START_ANAMNESE')).toBe('true');
  });

  for (const caminho of COMPOSES) {
    it(`${caminho} mapeia toda flag booleana no serviço \`engine\``, () => {
      const ambiente = ambienteDoEngine(caminho);
      const faltando = [...flags.keys()].filter(
        (nome) => !ambiente.has(nome) && !(nome in FLAGS_FORA_DO_COMPOSE),
      );
      expect(
        faltando,
        faltando.length === 0
          ? ''
          : `${CAMINHO_RUNTIME} lê ${faltando.join(', ')} como flag booleana, ` +
              `e ${caminho} não mapeia no \`environment:\` do serviço \`engine\`. ` +
              'O Compose não repassa o ambiente do host: variável não mapeada ' +
              'NUNCA chega ao processo, o engine cai no default do código e ' +
              'ninguém recebe erro — foi assim que `ANAMNESE_ENABLED=true` ficou ' +
              'inerte com três lugares prometendo que ligava (RN-540). ' +
              'Acrescente `NOME: ${NOME:-<default do runtime.exs>}` junto do ' +
              'bloco do agente a que a flag pertence, ou declare o motivo em ' +
              '`FLAGS_FORA_DO_COMPOSE`.',
      ).toEqual([]);
    });
  }

  for (const caminho of COMPOSES) {
    it(`${caminho} repete o default do código em cada flag`, () => {
      const ambiente = ambienteDoEngine(caminho);
      const declarados = DEFAULTS_DIVERGENTES_DECLARADOS[caminho] ?? {};
      const divergentes = [...flags.entries()]
        .map(([nome, doCodigo]) => {
          if (nome in declarados) return null;
          const noCompose = ambiente.get(nome);
          if (noCompose === undefined) return null;
          const padrao = defaultDaInterpolacao(noCompose);
          return padrao === null || padrao === doCodigo
            ? null
            : `${nome} (runtime.exs: \`${doCodigo}\`, compose: \`${padrao}\`)`;
        })
        .filter((x): x is string => x !== null);
      expect(
        divergentes,
        divergentes.length === 0
          ? ''
          : `${caminho}: ${divergentes.join('; ')} — o compose decide produto ` +
              'por baixo do `runtime.exs`. Mapear a flag existe para criar o ' +
              'caminho de LIGAR, nunca para mudar o que vale sem ninguém pedir ' +
              '(RN-540). Se a divergência é decisão, declare-a com o motivo em ' +
              '`DEFAULTS_DIVERGENTES_DECLARADOS`; se é mudança de default, ela ' +
              'muda o `runtime.exs` primeiro.',
      ).toEqual([]);
    });
  }

  it('toda divergência declarada é mesmo divergente', () => {
    // Sem isto a lista de exceções vira lugar onde flag esquecida se esconde:
    // uma entrada cujo compose já repete o default do código não declara
    // decisão nenhuma, e deve sair.
    const mortas = Object.entries(DEFAULTS_DIVERGENTES_DECLARADOS).flatMap(
      ([caminho, nomes]) =>
        Object.keys(nomes)
          .filter((nome) => {
            const padrao = defaultDaInterpolacao(
              ambienteDoEngine(caminho).get(nome) ?? '',
            );
            return padrao === null || padrao === flags.get(nome);
          })
          .map((nome) => `${caminho}: ${nome}`),
    );
    expect(mortas).toEqual([]);
  });
});
