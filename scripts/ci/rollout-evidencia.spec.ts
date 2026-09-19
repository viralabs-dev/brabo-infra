import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `deploy/k8s/rollout-evidencia.sh` rodando num bash de VERDADE (AT-078).
 *
 * A prova do rollout reprova de forma intermitente e a evidência morria com o
 * pod antigo. A lib que passou a gravá-la tem duas metades, e as duas são
 * exercitadas aqui:
 *
 * - as funções PURAS que respondem "a órfã ficou sem dono antes ou depois do
 *   scale-down do HPA?" — sobre `donos.log`/`replicas.log` escritos à mão, no
 *   formato que o teste grava;
 * - os COLETORES, contra um `kubectl` falso no PATH: que anexam o log de pod
 *   que já existia E de pod que nasce depois, e que `evidencia_parar` mata só o
 *   que eles subiram. O cluster de verdade só a rodada de `propriedades.yml`
 *   alcança; isto prova o mecanismo, não o k3d.
 *
 * O molde é o de `backup-lib.spec.ts`: shell executada, efeito medido em disco.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIB = path.join(RAIZ, 'deploy/k8s/rollout-evidencia.sh');

let area: string;

beforeEach(() => {
  area = mkdtempSync(path.join(tmpdir(), 'brabo-rollout-'));
});

afterEach(() => {
  rmSync(area, { recursive: true, force: true });
});

function bash(trecho: string, env: Record<string, string> = {}): string {
  return execFileSync('bash', ['-euo', 'pipefail', '-c', `source "${LIB}"\n${trecho}`], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C.UTF-8', ...env },
    timeout: 60_000,
  });
}

function escrever(nome: string, linhas: string[]): string {
  const arquivo = path.join(area, nome);
  writeFileSync(arquivo, linhas.join('\n') + '\n');
  return arquivo;
}

const T0 = 1000;
const SID = '7f7a4e36-1fee-438f-95fb-510b905373dc';

describe('primeiro_scale_down', () => {
  it('acha a primeira QUEDA de spec.replicas a partir do rollout', () => {
    const r = escrever('replicas.log', [
      '990 3 3 3 3',
      '1002 3 2 3 3',
      '1040 3 3 3 3',
      '1075 1 3 3 1',
      '1080 1 1 1 1',
    ]);
    expect(bash(`primeiro_scale_down "${r}" ${T0}`).trim()).toBe('1075');
  });

  it('ignora a queda de ANTES do rollout e devolve vazio sem queda depois', () => {
    const r = escrever('replicas.log', ['900 6 6 6 6', '950 3 3 3 3', '1010 3 3 3 3']);
    expect(bash(`primeiro_scale_down "${r}" ${T0}`).trim()).toBe('');
  });

  it('não se engana com amostra ilegível (cluster não respondeu)', () => {
    const r = escrever('replicas.log', ['1001 3 3 3 3', '1003 ? 0 ? ?', '1005 3 3 3 3']);
    expect(bash(`primeiro_scale_down "${r}" ${T0}`).trim()).toBe('');
  });
});

describe('mudancas_de_replicas', () => {
  it('lista cada mudança em tempo relativo ao rollout', () => {
    const r = escrever('replicas.log', ['990 3 3 3 3', '1002 3 2 3 3', '1075 1 3 3 1']);
    expect(bash(`mudancas_de_replicas "${r}" ${T0}`).trim()).toBe(
      'T+75s: deployment 3 -> 1 (hpa desejado 3 -> 1)',
    );
  });
});

describe('diagnostico_da_orfa', () => {
  const donos = (linhas: string[]) => escrever('donos.log', linhas);

  it('sem dono desde a primeira leitura, ANTES do scale-down: o HPA não explica', () => {
    const d = donos([
      `995 ${SID} engine@10.42.0.33`,
      `1030 ${SID} -`,
      `1035 ${SID} -`,
      `1150 ${SID} -`,
    ]);
    const saida = bash(`diagnostico_da_orfa "${d}" ${SID} ${T0} 1075`);
    expect(saida).toContain('sem dono já na primeira leitura (T+30s), ANTES do scale-down do HPA (T+75s)');
    expect(saida).toContain('o HPA não explica');
  });

  it('teve dono numa réplica nova e perdeu DEPOIS do scale-down', () => {
    const d = donos([
      `1030 ${SID} engine@10.42.0.35`,
      `1070 ${SID} engine@10.42.0.35`,
      `1080 ${SID} -`,
    ]);
    const saida = bash(`diagnostico_da_orfa "${d}" ${SID} ${T0} 1075`);
    expect(saida).toContain('teve dono (engine@10.42.0.35) até T+70s e ficou sem dono em T+80s, DEPOIS do scale-down');
  });

  it('primeira leitura já depois do scale-down: diz que não dá para separar', () => {
    const d = donos([`1080 ${SID} -`]);
    expect(bash(`diagnostico_da_orfa "${d}" ${SID} ${T0} 1075`)).toContain('não dá para separar');
  });

  it('sem scale-down na janela, diz isso', () => {
    const d = donos([`1030 ${SID} -`]);
    expect(bash(`diagnostico_da_orfa "${d}" ${SID} ${T0} ""`)).toContain('nenhum scale-down do HPA na janela');
  });

  it('não confunde a leitura de OUTRA sessão', () => {
    const d = donos([`1030 outra-sessao -`, `1031 ${SID} engine@10.42.0.35`]);
    expect(bash(`diagnostico_da_orfa "${d}" ${SID} ${T0} 1075`)).toContain('tinha dono');
  });
});

describe('citar_orfa', () => {
  it('acha a sessão em todos os logs, inclusive o do pod antigo, nomeando o arquivo', () => {
    escrever('engine-engine-antigo.log', [`... handoff ${SID} falhou`, 'outra linha']);
    escrever('engine-engine-novo.log', ['nada aqui']);
    escrever('events.log', ['SuccessfulRescale New size: 1']);
    const saida = bash(`citar_orfa "${area}" ${SID}`);
    expect(saida).toContain(`engine-engine-antigo.log:... handoff ${SID} falhou`);
    expect(saida).not.toContain('nada aqui');
  });
});

describe('coletores contra um kubectl falso', () => {
  it('anexam o log do pod que já existia e do que nasce depois, e param só o que subiram', () => {
    const bin = path.join(area, 'bin');
    const evid = path.join(area, 'evidencia');
    const pods = path.join(area, 'pods.txt');
    writeFileSync(pods, 'engine-antigo Running\n');
    execFileSync('mkdir', ['-p', bin]);
    // O kubectl falso: `get pods` lê a lista de `pods.txt`; `logs -f` imprime
    // uma linha com o nome do pod e fica seguindo; `get events -w` fica
    // pendurado como o de verdade.
    writeFileSync(
      path.join(bin, 'kubectl'),
      `#!/usr/bin/env bash
args="$*"
case "$args" in
  *"logs -f "*) pod="$(sed -E 's/.*logs -f ([^ ]+).*/\\1/' <<<"$args")"; echo "linha de $pod"; exec sleep 300 ;;
  *" logs "*) echo "final"; exit 0 ;;
  *"get events -w"*) exec sleep 300 ;;
  *"get pods"*"status.phase=Running"*) grep -c Running "${pods}" ;;
  *"get pods"*"status.phase"*) cat "${pods}" ;;
  *"get pods"*"metadata.name"*) cut -d' ' -f1 "${pods}" ;;
  *"get pods"*) cat "${pods}" ;;
  *"get deploy"*) echo "3 3" ;;
  *"get hpa"*) echo "3 3" ;;
esac
`,
    );
    chmodSync(path.join(bin, 'kubectl'), 0o755);

    const saida = bash(
      `
      evidencia_iniciar "${evid}" brabo app.kubernetes.io/name=engine
      echo 'engine-novo Running' >> "${pods}"
      for _ in $(seq 1 20); do [[ -e "${evid}/.anexado-engine-novo" ]] && break; sleep 0.5; done
      sleep 1
      pids="$(cat "${evid}/.pids")"
      evidencia_parar
      evidencia_parar
      sleep 0.5
      vivos=0
      for p in $pids; do kill -0 "$p" 2>/dev/null && vivos=$((vivos + 1)); done
      echo "vivos=$vivos"
      `,
      { PATH: `${bin}:${process.env.PATH}` },
    );

    expect(saida).toContain('vivos=0');
    expect(readFileSync(path.join(evid, 'engine-engine-antigo.log'), 'utf8')).toContain('linha de engine-antigo');
    expect(readFileSync(path.join(evid, 'engine-engine-novo.log'), 'utf8')).toContain('linha de engine-novo');
    expect(existsSync(path.join(evid, 'final-engine-antigo.log'))).toBe(true);
    const replicas = readFileSync(path.join(evid, 'replicas.log'), 'utf8').trim().split('\n');
    expect(replicas[0]).toMatch(/^\d+ 3 3 3 3$/);
    expect(readFileSync(path.join(evid, 'marcos.log'), 'utf8')).toContain('evidencia-parada');
    // Um anexo por pod, nunca dois.
    expect(readdirSync(evid).filter((f) => f.startsWith('.anexado-'))).toHaveLength(2);
  });
});
