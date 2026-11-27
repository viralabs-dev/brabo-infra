import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- módulo .mjs sem tipos; é script de dev.
import { ESTADO, ROTULO_DE_REVISAO, avaliarBrokerDoClone, mensagemDoBroker, recusa } from './broker-do-clone.mjs';

/** Guarda de broker velho (AT-1015, RN-1541): a imagem `brabo-broker:dev` tem de ser a do clone. */
const HEAD = 'a'.repeat(40);
const base = { headDoClone: HEAD, ultimoCommitEm: '2026-11-26T10:00:00-03:00' };

describe('avaliarBrokerDoClone', () => {
  it('rótulo igual ao HEAD: ok e sem mensagem', () => {
    const v = avaliarBrokerDoClone({ ...base, revisaoDaImagem: HEAD, criadaEm: '2026-11-01T00:00:00Z' });
    expect(v.estado).toBe(ESTADO.OK);
    expect(mensagemDoBroker(v)).toBeNull();
  });

  it('rótulo diferente do HEAD: recusa, nomeia as duas revisões e dá o comando de conserto', () => {
    const v = avaliarBrokerDoClone({ ...base, revisaoDaImagem: 'b'.repeat(40) });
    expect(v.estado).toBe(ESTADO.REVISAO_DIVERGENTE);
    expect(recusa(v)).toBe(true);
    const m = mensagemDoBroker(v);
    expect(m).toContain('RECUSADO');
    expect(m).toContain('bbbbbbbbbbbb');
    expect(m).toContain('aaaaaaaaaaaa');
    expect(m).toContain('build broker');
  });

  it('sem rótulo e imagem mais velha que o último commit: recusa pela data, com aviso do rótulo', () => {
    const v = avaliarBrokerDoClone({ ...base, criadaEm: '2026-11-25T23:48:00Z' });
    expect(v.estado).toBe(ESTADO.VELHA_PELA_DATA);
    expect(recusa(v)).toBe(true);
    expect(mensagemDoBroker(v)).toContain(ROTULO_DE_REVISAO);
  });

  it('sem rótulo e imagem mais nova que o último commit: segue, só avisa do rótulo', () => {
    const v = avaliarBrokerDoClone({ ...base, criadaEm: '2026-11-27T10:00:00Z' });
    expect(v.estado).toBe(ESTADO.OK);
    expect(recusa(v)).toBe(false);
    expect(mensagemDoBroker(v)).toContain('AVISO');
  });

  it('sem imagem ou sem dados do clone: não afirma nada', () => {
    expect(avaliarBrokerDoClone(null).estado).toBe(ESTADO.SEM_IMAGEM);
    expect(avaliarBrokerDoClone({ revisaoDaImagem: HEAD }).estado).toBe(ESTADO.INDETERMINADO);
    expect(avaliarBrokerDoClone({ ...base, criadaEm: 'lixo' }).estado).toBe(ESTADO.INDETERMINADO);
  });
});

describe('o dev sobe o broker do clone', () => {
  const ler = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
  it('`make dev` e `pnpm dev` sobem com --build, e o compose passa a revisão como build-arg', () => {
    expect(ler('Makefile')).toMatch(/dev:.*\n\t@BRABO_UP_COM_BUILD=1 .* node scripts\/dev\/preflight\.mjs .* up --build/);
    expect(ler('package.json')).toMatch(/BRABO_UP_COM_BUILD=1 .* node scripts\/dev\/preflight\.mjs .* up --build/);
    // a revisão do clone vai exportada para o build, para a label sair preenchida
    expect(ler('Makefile')).toContain('BROKER_REVISION=$$(git -C $${BRABO_IRMAOS:-..}/brabo-broker rev-parse HEAD');
    expect(ler('package.json')).toContain('BROKER_REVISION=$(git -C ${BRABO_IRMAOS:-..}/brabo-broker rev-parse HEAD');
    expect(ler('docker/docker-compose.yml')).toMatch(/BROKER_REVISION: \$\{BROKER_REVISION:-\}/);
  });
  it('bootstrap.sh e reset-total.sh exportam BROKER_REVISION (HEAD do clone) antes de qualquer chamada ao compose', () => {
    for (const rel of ['scripts/dev/bootstrap.sh', 'scripts/dev/reset-total.sh']) {
      const s = ler(rel);
      const exporta = s.search(/^BROKER_REVISION="\$\(git -C ".*\/brabo-broker" rev-parse HEAD/m);
      expect(exporta, rel).toBeGreaterThan(-1);
      expect(exporta, rel).toBeLessThan(s.search(/^COMPOSE=/m));
    }
  });
});
