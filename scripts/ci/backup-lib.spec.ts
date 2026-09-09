import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * As funções de `docker/backup/lib.sh` rodando num `sh` de VERDADE, contra um
 * diretório de verdade (ADR 0152).
 *
 * ## Por que este teste existe, e por que ele roda a shell
 *
 * O backup ganhou um segundo destino, e um backup escrito num destino que o
 * restore não sabe ler é backup nenhum. Um teste que lesse o TEXTO do script
 * provaria que as duas pontas chamam a mesma função — não que a função
 * funciona. O que se exercita aqui é o adaptador de disco e o arquivamento dos
 * bare repos, executados; o caminho S3 continua sem cobertura automatizada
 * (exigiria um endpoint), e isso está declarado no relatório da sessão, não
 * disfarçado por um mock que sempre concorda.
 *
 * O molde é o de `scripts/dev/bootstrap.spec.ts`: `execFileSync` sobre a shell,
 * saída parseada, asserção sobre o efeito real em disco.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIB = path.join(RAIZ, 'docker/backup/lib.sh');

let area: string;

beforeEach(() => {
  area = mkdtempSync(path.join(tmpdir(), 'brabo-backup-'));
});

afterEach(() => {
  rmSync(area, { recursive: true, force: true });
});

/** Roda um trecho de sh com a lib carregada. Devolve stdout; lança em status != 0. */
function sh(trecho: string, env: Record<string, string> = {}): string {
  return execFileSync('sh', ['-eu', '-c', `. "${LIB}"\n${trecho}`], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', ...env },
  });
}

/** Roda um trecho de sh e devolve o status de saída em vez de lançar. */
function status(trecho: string, env: Record<string, string> = {}): number {
  try {
    execFileSync('sh', ['-eu', '-c', `. "${LIB}"\n${trecho}`], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, LC_ALL: 'C', ...env },
    });
    return 0;
  } catch (erro) {
    return (erro as { status?: number }).status ?? -1;
  }
}

/** Um bare repo plausível: o que `git init --bare` deixa no disco. */
function bareRepo(raiz: string, nome: string): string {
  const repo = path.join(raiz, nome);
  mkdirSync(path.join(repo, 'objects/pack'), { recursive: true });
  mkdirSync(path.join(repo, 'refs/heads'), { recursive: true });
  writeFileSync(path.join(repo, 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(path.join(repo, 'config'), '[core]\n\tbare = true\n');
  writeFileSync(path.join(repo, 'refs/heads/main'), `${'a'.repeat(40)}\n`);
  writeFileSync(path.join(repo, 'objects/pack/pack-abc.pack'), 'PACK-conteudo-falso');
  return repo;
}

describe('destino — a inferência entre disco e S3', () => {
  it('sem BACKUP_DIR o destino é S3, que é como o CronJob do k8s continua rodando', () => {
    // A inferência é o que mantém `deploy/k8s/base/backup/cronjob.yaml` intacto:
    // ele passa só as cinco variáveis de S3, e esta sessão não o toca.
    expect(sh('destino_tipo').trim()).toBe('s3');
  });

  it('com BACKUP_DIR o destino é disco, sem exigir nenhuma variável de S3', () => {
    // A decisão 2 do ADR 0152: exigir um bucket para migrar seria exigir
    // infraestrutura que o instalador acabou de dizer que não precisa.
    expect(sh('destino_tipo; destino_preparar; echo preparou', { BACKUP_DIR: area }).trim()).toContain('local');
  });
});

describe('destino em disco — o caminho feliz', () => {
  it('envia, mede, lista, copia e remove — as cinco operações que o backup usa', () => {
    const env = { BACKUP_DIR: area };

    sh(`printf 'conteudo-do-dump' | destino_enviar 'daily/brabo-20260908T000000Z.dump'`, env);
    expect(readFileSync(path.join(area, 'daily/brabo-20260908T000000Z.dump'), 'utf8')).toBe('conteudo-do-dump');

    expect(sh(`destino_tamanho 'daily/brabo-20260908T000000Z.dump'`, env).trim()).toBe('16');

    sh(`destino_copiar 'daily/brabo-20260908T000000Z.dump' 'weekly/brabo-20260908T000000Z.dump'`, env);
    expect(existsSync(path.join(area, 'weekly/brabo-20260908T000000Z.dump'))).toBe(true);

    expect(sh(`destino_listar 'daily/'`, env).trim()).toBe('daily/brabo-20260908T000000Z.dump');

    sh(`destino_remover 'daily/brabo-20260908T000000Z.dump'`, env);
    expect(sh(`destino_listar 'daily/'`, env).trim()).toBe('');
  });

  it('objeto ausente mede 0 — o sinal que o backup transforma em falha', () => {
    expect(sh(`destino_tamanho 'daily/nao-existe.dump'`, { BACKUP_DIR: area }).trim()).toBe('0');
  });

  it('a escrita é atômica: um envio interrompido não deixa objeto de tamanho plausível', () => {
    // O modo de falha que a checagem de tamanho NÃO pega é um arquivo truncado.
    // Escrever em `.parcial` e renomear é o que impede que ele exista com o nome
    // que o restore procura. `destino_listar` também tem que ignorar o parcial.
    writeFileSync(path.join(area, 'daily-parcial-simulado'), '');
    mkdirSync(path.join(area, 'daily'), { recursive: true });
    writeFileSync(path.join(area, 'daily/brabo-morto.dump.parcial'), 'metade');
    expect(sh(`destino_listar 'daily/'`, { BACKUP_DIR: area }).trim()).toBe('');
  });

  it('prefixos irmãos não se misturam — a retenção por contagem depende disso', () => {
    // `daily/` e `git-daily/` no mesmo prefixo fariam "manter 7" significar três
    // backups e meio, porque a poda ordena por nome e corta pela contagem.
    const env = { BACKUP_DIR: area };
    sh(`printf 'a' | destino_enviar 'daily/brabo-1.dump'`, env);
    sh(`printf 'b' | destino_enviar 'git-daily/brabo-git-1.tar.gz'`, env);
    expect(sh(`destino_listar 'daily/'`, env).trim()).toBe('daily/brabo-1.dump');
    expect(sh(`destino_listar 'git-daily/'`, env).trim()).toBe('git-daily/brabo-git-1.tar.gz');
  });
});

describe('destino em disco — o caso de falha', () => {
  it('diretório que existe e NÃO aceita escrita reprova, e diz que é escrita', () => {
    // A pergunta certa não é "o diretório existe?": um destino read-only
    // aceitaria `ls` e recusaria o dump, e o erro apareceria só depois do
    // `pg_dump`, apontando para o lugar errado.
    const travado = path.join(area, 'travado');
    mkdirSync(travado, { mode: 0o500 });
    try {
      expect(status(`destino_esperar`, { BACKUP_DIR: travado })).not.toBe(0);
      const saida = sh(`destino_esperar || printf '%s' "$destino_saida"`, { BACKUP_DIR: travado });
      expect(saida).toContain('não aceita escrita');
    } finally {
      // Sem isto o `rmSync` do afterEach não consegue limpar.
      execFileSync('chmod', ['0700', travado]);
    }
  });
});

describe('bare repos — o achado do ADR 0152', () => {
  it('distingue volume NÃO MONTADO de volume montado e VAZIO', () => {
    // Os dois viram "nada a arquivar", mas por motivos opostos: no k8s o volume
    // nem é montado (pular é correto), no compose ele é (pular seria falso
    // verde). Colapsar os dois é como um backup passa anos parecendo cobrir o
    // que nunca cobriu.
    expect(status(`git_repos_presentes '${area}/nao-existe'`)).not.toBe(0);

    const vazio = path.join(area, 'vazio');
    mkdirSync(vazio);
    expect(status(`git_repos_presentes '${vazio}'`)).toBe(0);
    expect(sh(`git_repos_presentes '${vazio}'`).trim()).toBe('');
  });

  it('arquiva os bare repos, registra status 0 e o arquivo relê inteiro', () => {
    const repos = path.join(area, 'git-repos');
    mkdirSync(repos);
    bareRepo(repos, 'alpha.git');
    bareRepo(repos, 'beta.git');

    expect(sh(`git_repos_presentes '${repos}'`).trim().split('\n')).toEqual(['alpha.git', 'beta.git']);

    const arquivo = path.join(area, 'repos.tar.gz');
    const st = path.join(area, 'status');
    sh(`git_arquivar '${repos}' '${st}' > '${arquivo}'`);

    // O status do tar vem de um ARQUIVO e não do `$?` do cano: em POSIX sh o
    // status de um pipeline é o do último comando, e sem isto um `git gc`
    // concorrente apagando um packfile produziria um arquivo parcial que se
    // anuncia como bom.
    expect(readFileSync(st, 'utf8').trim()).toBe('0');

    const conteudo = sh(`git_conteudo '${arquivo}'`);
    expect(conteudo).toContain('./alpha.git/HEAD');
    expect(conteudo).toContain('./beta.git/objects/pack/pack-abc.pack');
    expect(conteudo).toContain('./alpha.git/refs/heads/main');
  });

  it('não arquiva `*.lock` — restaurar um lock órfão trava todo git no destino', () => {
    const repos = path.join(area, 'git-repos');
    mkdirSync(repos);
    bareRepo(repos, 'alpha.git');
    writeFileSync(path.join(repos, 'alpha.git/refs/heads/main.lock'), '');
    writeFileSync(path.join(repos, 'alpha.git/objects/tmp_pack_xyz'), 'meio pack');

    const arquivo = path.join(area, 'repos.tar.gz');
    sh(`git_arquivar '${repos}' '${path.join(area, 'st')}' > '${arquivo}'`);

    const conteudo = sh(`git_conteudo '${arquivo}'`);
    expect(conteudo).toContain('./alpha.git/refs/heads/main');
    expect(conteudo).not.toContain('main.lock');
    expect(conteudo).not.toContain('tmp_pack_xyz');
  });

  it('o ciclo fecha: o que foi arquivado volta idêntico ao ser restaurado', () => {
    const repos = path.join(area, 'git-repos');
    mkdirSync(repos);
    bareRepo(repos, 'alpha.git');
    const arquivo = path.join(area, 'repos.tar.gz');
    sh(`git_arquivar '${repos}' '${path.join(area, 'st')}' > '${arquivo}'`);

    const destino = path.join(area, 'restaurado');
    sh(`git_restaurar '${arquivo}' '${destino}'`);

    expect(sh(`git_repos_presentes '${destino}'`).trim()).toBe('alpha.git');
    expect(readFileSync(path.join(destino, 'alpha.git/HEAD'), 'utf8')).toBe('ref: refs/heads/main\n');
    expect(readFileSync(path.join(destino, 'alpha.git/refs/heads/main'), 'utf8')).toBe(`${'a'.repeat(40)}\n`);
  });

  it('recusa restaurar onde não pode escrever — o defeito que a execução real achou', () => {
    // `git_local_repos` é COMPARTILHADO por três imagens com uids diferentes
    // (api `node`, engine `engine`, a de backup uid 70). O volume nasce com o
    // dono de quem o montou primeiro, modo 0755: uid 70 lê e não escreve. A
    // primeira execução real morreu com `tar: can't make dir ... Permission
    // denied` a meio caminho — a pergunta tem que ser feita ANTES do tar.
    const gravavel = path.join(area, 'gravavel');
    mkdirSync(gravavel);
    expect(status(`git_raiz_gravavel '${gravavel}'`)).toBe(0);

    const travado = path.join(area, 'alheio');
    mkdirSync(travado, { mode: 0o500 });
    try {
      expect(status(`git_raiz_gravavel '${travado}'`)).not.toBe(0);
    } finally {
      execFileSync('chmod', ['0700', travado]);
    }
  });

  it('arquivo truncado reprova ao ser LIDO, não pelo tamanho', () => {
    // O `pg_restore --list` do lado do git. Um tar cortado no meio tem tamanho
    // > 0 e passaria em qualquer checagem de bytes; só a leitura denuncia.
    const arquivo = path.join(area, 'cortado.tar.gz');
    const repos = path.join(area, 'git-repos');
    mkdirSync(repos);
    bareRepo(repos, 'alpha.git');
    sh(`git_arquivar '${repos}' '${path.join(area, 'st')}' > '${arquivo}'`);

    const bytes = readFileSync(arquivo);
    expect(bytes.length).toBeGreaterThan(60);
    writeFileSync(arquivo, bytes.subarray(0, Math.floor(bytes.length / 2)));

    expect(status(`git_conteudo '${arquivo}' > /dev/null`)).not.toBe(0);
  });
});
