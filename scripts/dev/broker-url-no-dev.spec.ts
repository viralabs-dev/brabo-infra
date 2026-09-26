import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * `BROKER_URL` tem default no compose de DEV, e só nele (RN-599, AT-213).
 *
 * O defeito medido no teste do dono em 26/09: o broker sobe por padrão no dev
 * (RN-512), mas a api recebia `BROKER_URL` vazia — `brokerConfigurado: false`
 * para um broker de pé ao lado, e a criação de projeto só liberava `runner`
 * (ADR 0161). O default precisa apontar para o serviço e a porta que ESTE
 * arquivo declara, senão ele troca "sem broker" por "broker inalcançável".
 *
 * A outra metade é a divergência DE PROPÓSITO: nos composes de produção e de
 * instalação o broker está sob profile, e lá quem liga grava a URL (o
 * `install.sh`, perguntando — ADR 0162). Um default ali faria a api de uma
 * instalação sem broker afirmar que tem um.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

type Servico = {
  environment?: Record<string, string | number>;
  networks?: string[] | Record<string, unknown>;
  profiles?: string[];
};
type Compose = { services: Record<string, Servico> };

const ler = (arquivo: string): Compose =>
  parse(fs.readFileSync(path.join(RAIZ, 'docker', arquivo), 'utf8')) as Compose;

const dev = ler('docker-compose.yml');

const nomesDeRede = (s: Servico): string[] =>
  Array.isArray(s.networks) ? s.networks : Object.keys(s.networks ?? {});

describe('BROKER_URL no compose de dev', () => {
  const valor = String(dev.services.api?.environment?.BROKER_URL ?? '');
  const casou = /^\$\{BROKER_URL:-(http:\/\/([^:/]+):(\d+))\}$/.exec(valor);

  it('tem default, e o valor do .env continua vencendo', () => {
    expect(casou, `BROKER_URL da api é ${JSON.stringify(valor)}`).not.toBeNull();
    expect(casou?.[1]).toBe('http://broker:8090');
  });

  it('o default aponta para o serviço e a porta que este arquivo declara', () => {
    const host = casou?.[2] ?? '';
    const broker = dev.services[host];
    expect(broker, `não há serviço "${host}" no compose de dev`).toBeDefined();
    expect(String(broker?.environment?.BROKER_PORT)).toBe(casou?.[3]);
  });

  // O default só é honesto porque o serviço SOBE sem pedir: sob profile ele
  // afirmaria um broker que `pnpm dev` não subiu.
  it('o broker sobe sem profile e a api está na rede dele', () => {
    expect(dev.services.broker?.profiles).toBeUndefined();
    expect(nomesDeRede(dev.services.api!)).toContain('broker');
  });
});

describe('BROKER_URL fora do dev segue sem default', () => {
  for (const arquivo of ['docker-compose.prod.yml', 'docker-compose.install.yml']) {
    it(`${arquivo}: vazia por padrão, e o broker segue sob profile`, () => {
      const c = ler(arquivo);
      expect(c.services.api?.environment?.BROKER_URL).toBe('${BROKER_URL:-}');
      expect(c.services.broker?.profiles).toEqual(['container-broker']);
    });
  }
});
