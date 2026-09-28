import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { arquivos, ler } from '../docs/fontes.mjs';

/**
 * As variáveis `*_PREVIOUS` que a api, o engine e o broker LEEM, contra o
 * `environment:` do serviço de mesmo nome nos TRÊS composes (RN-595, AT-201).
 *
 * Por que este teste existe: as três rotações sem downtime do runbook
 * (`AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY`) dependem
 * de o processo ver o valor ANTIGO numa `_PREVIOUS` durante a janela. Nenhuma
 * delas estava mapeada em compose nenhum — nem no de dev —, e o Compose não
 * repassa o ambiente do host: definir a `_PREVIOUS` no `.env` não fazia nada, e
 * o operador que seguia o runbook trocava o valor atual achando que o antigo
 * continuava aceito. O sintoma era o que a rotação existe para evitar: 401/403
 * no tráfego interno, access tokens recusados, credenciais que não abrem. É a
 * classe de defeito da RN-540 (`flags-do-engine-no-compose.spec.ts`), com outro
 * recorte: lá são as flags booleanas do engine, aqui os segredos de rotação dos
 * três serviços.
 *
 * A lista é DERIVADA do código — a próxima `_PREVIOUS` que nascer num dos três
 * reprova aqui até ter a linha. E o default tem de ser VAZIO nos três arquivos:
 * `_PREVIOUS` definida é rotação EM ANDAMENTO (a api avisa no log por isso), e
 * um default preenchido deixaria toda instalação eternamente no meio de uma.
 *
 * `deploy/k8s/` tem o seu bloco no fim, com OUTRA pergunta (AT-220). Lá não há
 * `environment:` por variável: os Pods leem `envFrom: brabo-secrets`, e o
 * `ExternalSecret` (`deploy/k8s/base/common/externalsecrets.yaml`) puxa o
 * objeto INTEIRO do store por `dataFrom.extract` — é assim que a `_PREVIOUS`
 * entra quando existe. Listá-la em `data:` quebraria todo cluster fora de
 * rotação (propriedade ausente reprova a sincronização do Secret inteiro), e é
 * isso que o bloco reprova, junto com o `extract` sumir.
 */

const COMPOSES = [
  'docker/docker-compose.yml',
  'docker/docker-compose.prod.yml',
  'docker/docker-compose.install.yml',
];

/**
 * Onde cada serviço lê ambiente, e a FORMA da leitura. Só a forma de leitura
 * conta — citar o nome num comentário ou numa mensagem de log não é ler.
 */
const LEITORES: Record<
  string,
  { globs: string[]; ignorar: (f: string) => boolean; padrao: RegExp }
> = {
  api: {
    globs: ['apps/api/src/*.ts', 'apps/api/src/**/*.ts'],
    ignorar: (f) => f.includes('.spec.'),
    padrao: /process\.env(?:\.|\[\s*['"])([A-Z0-9_]+_PREVIOUS)\b/g,
  },
  engine: {
    globs: [
      'apps/engine/config/*.exs',
      'apps/engine/lib/*.ex',
      'apps/engine/lib/**/*.ex',
    ],
    ignorar: () => false,
    padrao: /System\.(?:get_env|fetch_env!?)\(\s*"([A-Z0-9_]+_PREVIOUS)"/g,
  },
  broker: {
    // Dois globs: `**/` no pathspec exige pelo menos um diretório, e
    // `config.ts` mora direto em `src/`.
    globs: ['apps/broker/src/*.ts', 'apps/broker/src/**/*.ts'],
    ignorar: (f) => f.includes('.spec.'),
    // `config.ts` recebe o ambiente como parâmetro (`env.X`), não
    // `process.env` direto — as duas formas casam.
    padrao: /\benv(?:\.|\[\s*['"])([A-Z0-9_]+_PREVIOUS)\b/g,
  },
};

export function previousLidasPor(servico: string): Set<string> {
  const leitor = LEITORES[servico];
  if (!leitor) throw new Error(`serviço sem leitor declarado: ${servico}`);
  const achadas = new Set<string>();
  for (const glob of leitor.globs) {
    for (const caminho of arquivos(glob)) {
      if (leitor.ignorar(caminho)) continue;
      for (const m of ler(caminho).matchAll(leitor.padrao)) {
        achadas.add(m[1] as string);
      }
    }
  }
  return achadas;
}

function ambienteDo(caminho: string, servico: string): Map<string, string> {
  const doc = parse(ler(caminho)) as {
    services?: Record<string, { environment?: unknown }>;
  };
  const bruto = doc?.services?.[servico]?.environment;
  if (bruto === undefined || bruto === null) {
    throw new Error(
      `${caminho}: não achei \`services.${servico}.environment\`. Se o serviço ` +
        'mudou de nome ou o compose mudou de forma, atualize este teste — ele ' +
        'é o que impede uma rotação de virar promessa sem fio.',
    );
  }
  const entradas: [string, string][] = Array.isArray(bruto)
    ? bruto.map((linha) => {
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
  return new Map(entradas);
}

const lidas = new Map(
  Object.keys(LEITORES).map((s) => [s, previousLidasPor(s)] as const),
);

function lidasPor(servico: string): Set<string> {
  const conjunto = lidas.get(servico);
  if (!conjunto) throw new Error(`serviço sem leitor declarado: ${servico}`);
  return conjunto;
}

describe('variáveis `_PREVIOUS` × `environment:` dos composes (RN-595)', () => {
  it('o extrator acha as que já conhecíamos', () => {
    // Piso, não igualdade: protege os REGEX. Se pararem de casar, as
    // comparações abaixo passariam comparando um conjunto vazio.
    expect([...lidasPor('api')]).toEqual(
      expect.arrayContaining([
        'AUTH_JWT_SECRET_PREVIOUS',
        'BRABO_SERVICE_TOKEN_PREVIOUS',
        'CREDENTIALS_MASTER_KEY_PREVIOUS',
      ]),
    );
    expect([...lidasPor('engine')]).toContain('BRABO_SERVICE_TOKEN_PREVIOUS');
    expect([...lidasPor('broker')]).toContain('BRABO_SERVICE_TOKEN_PREVIOUS');
  });

  for (const caminho of COMPOSES) {
    for (const servico of Object.keys(LEITORES)) {
      it(`${caminho}: \`${servico}\` mapeia toda \`_PREVIOUS\` que lê, com default vazio`, () => {
        const ambiente = ambienteDo(caminho, servico);
        const problemas = [...lidasPor(servico)].flatMap((nome) => {
          const valor = ambiente.get(nome);
          if (valor === undefined) return [`${nome} (ausente)`];
          return valor.trim() === `\${${nome}:-}`
            ? []
            : [`${nome} (\`${valor}\`, esperado \`\${${nome}:-}\`)`];
        });
        expect(
          problemas,
          problemas.length === 0
            ? ''
            : `${caminho}, serviço \`${servico}\`: ${problemas.join('; ')}. ` +
                'O Compose não repassa o ambiente do host — `_PREVIOUS` sem ' +
                'linha no `environment:` NUNCA chega ao processo, e a rotação ' +
                'sem downtime do runbook vira troca seca do segredo (RN-595). ' +
                'O default é vazio porque definida = rotação em andamento.',
        ).toEqual([]);
      });
    }
  }
});

/**
 * O lado Kubernetes (AT-220). A pergunta muda: não é "a variável está no
 * `environment:`", é "o Secret que os Pods leem PODE carregar uma `_PREVIOUS`
 * que só existe durante a rotação". O ESO não tem chave opcional em `data:`,
 * então a única forma é o `ExternalSecret` puxar o objeto inteiro do store
 * (`dataFrom.extract`) — e nenhuma `_PREVIOUS` pode estar em `data:`, onde a
 * ausência (o estado normal) derrubaria a sincronização do Secret inteiro.
 */
const EXTERNAL_SECRET = 'deploy/k8s/base/common/externalsecrets.yaml';
const DEPLOYMENTS_DO_K8S: Record<string, string> = {
  api: 'deploy/k8s/base/api/deployment.yaml',
  engine: 'deploy/k8s/base/engine/deployment.yaml',
  // O broker não tem Deployment no k8s, de propósito (ADR 0162).
};

type ExternalSecret = {
  kind?: string;
  spec?: {
    target?: { name?: string };
    data?: { secretKey?: string }[];
    dataFrom?: { extract?: { key?: string } }[];
  };
};

function externalSecretDoBrabo(): ExternalSecret {
  const doc = parse(ler(EXTERNAL_SECRET)) as ExternalSecret;
  if (
    doc?.kind !== 'ExternalSecret' ||
    doc.spec?.target?.name !== 'brabo-secrets'
  ) {
    throw new Error(
      `${EXTERNAL_SECRET}: não achei o ExternalSecret de \`brabo-secrets\`. Se ` +
        'o arquivo mudou de forma, atualize este teste.',
    );
  }
  return doc;
}

describe('variáveis `_PREVIOUS` × ExternalSecret do k8s (RN-595, AT-220)', () => {
  it('o ExternalSecret puxa o objeto inteiro do store por `dataFrom.extract`', () => {
    const extraidos = (externalSecretDoBrabo().spec?.dataFrom ?? []).map(
      (d) => d.extract?.key,
    );
    expect(
      extraidos,
      'Sem `dataFrom.extract`, o `brabo-secrets` só carrega as chaves listadas ' +
        'em `data:` — e a `_PREVIOUS` não pode ser listada ali. A rotação sem ' +
        'downtime no cluster volta a ser troca seca (AT-220).',
    ).toContain('brabo');
  });

  it('nenhuma `_PREVIOUS` está em `data:`, onde a ausência derrubaria o Secret', () => {
    const emData = (externalSecretDoBrabo().spec?.data ?? [])
      .map((d) => d.secretKey ?? '')
      .filter((k) => k.endsWith('_PREVIOUS'));
    expect(
      emData,
      'Entrada de `data:` cuja propriedade falta no provider reprova a ' +
        'sincronização do Secret INTEIRO, e `_PREVIOUS` ausente é o estado ' +
        'normal fora de rotação. Ela chega pelo `dataFrom.extract`.',
    ).toEqual([]);
  });

  for (const [servico, caminho] of Object.entries(DEPLOYMENTS_DO_K8S)) {
    it(`${caminho}: \`${servico}\` lê \`brabo-secrets\` inteiro por \`envFrom\``, () => {
      // Precondição: o serviço LÊ alguma `_PREVIOUS`, senão o teste é vazio.
      expect(lidasPor(servico).size).toBeGreaterThan(0);
      const doc = parse(ler(caminho)) as {
        spec?: {
          template?: {
            spec?: {
              containers?: {
                envFrom?: { secretRef?: { name?: string } }[];
              }[];
            };
          };
        };
      };
      const containers = doc?.spec?.template?.spec?.containers ?? [];
      const comOSecret = containers.filter((c) =>
        (c.envFrom ?? []).some((e) => e.secretRef?.name === 'brabo-secrets'),
      );
      expect(
        comOSecret.length,
        `${caminho}: nenhum container faz \`envFrom: brabo-secrets\`. A ` +
          '`_PREVIOUS` que o `dataFrom.extract` põe no Secret não chegaria ao ' +
          'processo.',
      ).toBeGreaterThan(0);
    });
  }
});
