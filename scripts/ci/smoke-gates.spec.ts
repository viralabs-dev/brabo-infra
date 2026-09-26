import { execFile, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * O passo de gates do `docker/smoke.sh` rodando num bash de VERDADE (AT-109).
 *
 * O smoke completo sobe as imagens de produção, e é o CI que o roda (job
 * "Build, scan e smoke das imagens de produção"). O que se prova aqui, sem
 * stack, são as duas funções que o passo usa, carregadas com `source` do
 * próprio script (ele para antes do `up` quando é carregado assim):
 *
 * - `checar_registro_de_gates` separa os três corpos: o registro passa, e o 500
 *   do Nest (o que a imagem devolvia com a checagem de arquivo de prova no
 *   loader, a mutação do #584) e a lista vazia reprovam. A MESMA função serve
 *   `GET /gates` e `GET /internal/gates`;
 * - `gates_internos` entrega o service token ao curl pelo STDIN, nunca pelo
 *   argv. Um `curl` falso no PATH grava o que recebeu nos dois canais.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SMOKE = path.join(RAIZ, 'docker/smoke.sh');
const execFileAsync = promisify(execFile);

let area: string;

beforeEach(() => {
  area = mkdtempSync(path.join(tmpdir(), 'brabo-smoke-gates-'));
});

afterEach(() => {
  rmSync(area, { recursive: true, force: true });
});

function comSmoke(trecho: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', ['-c', `source "${SMOKE}"\n${trecho}`], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C.UTF-8', ...env },
    timeout: 30_000,
  });
  return { codigo: r.status, saida: r.stdout, erro: r.stderr };
}

function checar(corpo: string) {
  return comSmoke(`checar_registro_de_gates 'GET /internal/gates' "$CORPO"`, { CORPO: corpo });
}

// O corpo do registro como a api o serve: `carregarRegistro()` devolve o YAML
// parseado, sem transformação, e o Nest o serializa.
const REGISTRO = JSON.stringify(parse(readFileSync(path.join(RAIZ, 'docs/gates.yml'), 'utf8')));

describe('checar_registro_de_gates', () => {
  it('aceita o registro real de docs/gates.yml', () => {
    const r = checar(REGISTRO);
    expect(r.codigo).toBe(0);
    expect(r.saida).toBe('');
  });

  it('reprova o 500 do Nest, que é o que a mutação do #584 devolve', () => {
    const r = checar('{"statusCode":500,"message":"Internal server error"}');
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain('GET /internal/gates não devolveu o registro');
    expect(r.saida).toContain('"statusCode":500');
  });

  it('reprova a lista vazia, que passaria no primeiro grep', () => {
    const r = checar('{"version":1,"gates":[]}');
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain('GET /internal/gates respondeu sem o gate merge-protegida');
  });

  it('reprova o 403 de token recusado, mostrando o corpo', () => {
    const r = checar('{"message":"Chamada restrita ao serviço engine","error":"Forbidden","statusCode":403}');
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain('"statusCode":403');
  });
});

describe('gates_internos', () => {
  it('manda o token pelo stdin do curl, nunca pelo argv', () => {
    const bin = path.join(area, 'bin');
    mkdirSync(bin);
    writeFileSync(
      path.join(bin, 'curl'),
      `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${area}/argv"
cat > "${area}/stdin"
echo '{"version":1,"gates":[{"id":"merge-protegida"}]}'
`,
    );
    chmodSync(path.join(bin, 'curl'), 0o755);
    const token = 'token-de-teste+/=abc123';

    const r = comSmoke(
      `API=http://localhost:9999
      corpo="$(gates_internos)"
      checar_registro_de_gates 'GET /internal/gates' "$corpo" && echo aprovado`,
      { PATH: `${bin}:${process.env.PATH}`, BRABO_SERVICE_TOKEN: token },
    );

    expect(r.codigo).toBe(0);
    expect(r.saida).toContain('aprovado');
    const argv = readFileSync(path.join(area, 'argv'), 'utf8');
    expect(argv).not.toContain(token);
    expect(argv).toContain('--config\n-\n');
    expect(argv).toContain('http://localhost:9999/internal/gates');
    expect(readFileSync(path.join(area, 'stdin'), 'utf8')).toBe(
      `header = "x-brabo-service-token: ${token}"\n`,
    );
    expect(r.saida + r.erro).not.toContain(token);
  });

  it('o curl de verdade entrega o cabeçalho que veio pelo stdin', async () => {
    // Um servidor HTTP local responde como a api: confere o cabeçalho e devolve
    // o registro. Prova o formato do `--config -` contra o parser do PRÓPRIO
    // curl, e não contra uma asserção de string.
    const token = 'abc+/=xyz';
    let recebido: string | undefined;
    const servidor = createServer((req, res) => {
      recebido = req.headers['x-brabo-service-token'] as string | undefined;
      res.setHeader('content-type', 'application/json');
      res.end(recebido === token ? REGISTRO : '{"statusCode":403}');
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    const { port } = servidor.address() as AddressInfo;
    try {
      const { stdout } = await execFileAsync(
        'bash',
        [
          '-c',
          `source "${SMOKE}"
          API=http://127.0.0.1:${port}
          corpo="$(gates_internos)"
          checar_registro_de_gates 'GET /internal/gates' "$corpo" && echo aprovado`,
        ],
        { env: { ...process.env, BRABO_SERVICE_TOKEN: token }, timeout: 30_000 },
      );
      expect(recebido).toBe(token);
      expect(stdout).toContain('aprovado');
    } finally {
      servidor.close();
    }
  });
});

describe('o passo do smoke', () => {
  it('aplica a checagem às DUAS rotas do registro', () => {
    // Guarda de texto, de propósito: tirar a chamada à rota interna não faz
    // nenhum teste acima falhar, e impedir isso é a razão do AT-109.
    const smoke = readFileSync(SMOKE, 'utf8');
    expect(smoke).toContain(`checar_registro_de_gates 'GET /gates' "\${gates}"`);
    expect(smoke).toContain('gates_int="$(gates_internos)"');
    expect(smoke).toContain(`checar_registro_de_gates 'GET /internal/gates' "\${gates_int}"`);
  });
});
