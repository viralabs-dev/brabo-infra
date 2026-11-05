import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALVOS } from './images-manifest.ts';
import { IRMAOS, RAIZ } from './irmaos.ts';

// A imagem do engine embute software sob GPL — `git`, `busybox`,
// `libgcc`/`libstdc++` e outras 18 apk, mais os quatro scanners que o engine
// invoca por `exec`. Executá-los como processo separado não contamina o Brabo,
// que segue MIT; DISTRIBUIR a imagem é outra coisa, e desde o ADR 0119 ela é
// publicada no GHCR a cada tag final.
//
// A oferta escrita de fonte é o `THIRD_PARTY_NOTICES.md`, e ela só cumpre o
// papel se viajar DENTRO do artefato: quem faz `docker pull` (ou baixa o
// binário do runner da Release) não tem o repositório, e uma oferta que só
// existe no GitHub não acompanha a cópia que a pessoa recebeu.
//
// A AT-020 a pôs na imagem do engine. A AT-120, por decisão do mantenedor
// (01/10), a estende a TODA imagem publicada e aos binários do runner, na MESMA
// forma — conservador: nenhum artefato é declarado dispensado.
//
// Este teste é ESTÁTICO. A prova contra a imagem CONSTRUÍDA é o passo "A
// oferta de fonte está dentro das cinco imagens" do `ci.yml` (`docker run …
// cat` + `cmp`); a da Release só uma tag real dá — o mesmo limite da
// assinatura (RN-524). O que se garante a cada PR é que ninguém remova um
// `COPY` sem que algo fique vermelho.
//
// Aferição CRUZADA de imagens (AT-701/702): voltou do monorepo. Os Dockerfiles de api/engine/web/broker
// moram nos repos irmãos (`<IRMAOS>/brabo-<alvo>/Dockerfile`, contexto = a raiz do irmão); o do backup
// mora aqui (`docker/backup/Dockerfile.prod`, contexto = a raiz deste repo). A prova contra a imagem
// CONSTRUÍDA (`docker run … cat` + `cmp`) saiu junto com o `ci.yml` do monorepo e é da AT-707.
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');
const lerEm = (base: string, rel: string) => readFileSync(path.join(base, rel), 'utf8');
/** [pasta do contexto de build, Dockerfile relativo a ela] de cada alvo publicado. */
const contexto = (alvo: string): [string, string] =>
  alvo === 'backup' ? [RAIZ, 'docker/backup/Dockerfile.prod'] : [path.join(IRMAOS, `brabo-${alvo}`), 'Dockerfile'];

const DESTINO = '/usr/share/doc/brabo/THIRD_PARTY_NOTICES.md';
const COPIA =
  /^COPY --chown=root:root --chmod=0644 THIRD_PARTY_NOTICES\.md \\\n\s+\/usr\/share\/doc\/brabo\/THIRD_PARTY_NOTICES\.md$/m;

const PASTA = /^RUN install -d -m 0755 \/usr\/share\/doc\/brabo$/m;

/** `null` se o ESTÁGIO FINAL copia a oferta como root antes do `USER`; senão, o motivo. */
function problemaDaOferta(dockerfile: string): string | null {
  const froms = [...dockerfile.matchAll(/^FROM /gm)];
  const ultimo = froms.at(-1);
  if (ultimo?.index === undefined) return 'sem FROM';
  const estagioFinal = dockerfile.slice(ultimo.index);
  const copia = estagioFinal.search(COPIA);
  if (copia < 0) return `o estágio final não copia THIRD_PARTY_NOTICES.md para ${DESTINO} como root, 0644`;
  // O BuildKit aplica o `--chmod` às pastas que o `COPY` CRIA: sem a pasta
  // criada antes em 0755, ela nasce 0644 e o `USER` da imagem não a atravessa.
  const pasta = estagioFinal.search(PASTA);
  if (pasta < 0 || pasta > copia) return 'a pasta /usr/share/doc/brabo não é criada em 0755 ANTES do COPY';
  const user = estagioFinal.search(/^USER /m);
  if (user < 0) return 'o estágio final não tem USER';
  if (copia > user) return 'o COPY da oferta vem depois do USER';
  return null;
}

const pasta = 'RUN install -d -m 0755 /usr/share/doc/brabo\n';
const copia = `COPY --chown=root:root --chmod=0644 THIRD_PARTY_NOTICES.md \\\n     ${DESTINO}\n`;

describe('a oferta escrita de fonte viaja dentro de TODA imagem publicada', () => {
  it('a lista de imagens é a dos alvos publicados — imagem nova entra aqui sozinha', () => {
    expect([...ALVOS].sort()).toEqual(['api', 'backup', 'broker', 'engine', 'web']);
  });

  it.each([...ALVOS])('o Dockerfile de %s copia a oferta, como root, ANTES do USER, no estágio final', (alvo) => {
    const [base, dockerfile] = contexto(alvo);
    // Irmão ausente REPROVA (nunca verde por não ter lido nada): no CI os irmãos são checkout.
    expect(existsSync(path.join(base, dockerfile)), `${base}/${dockerfile} ausente (BRABO_IRMAOS=${IRMAOS})`).toBe(true);
    // Uma oferta de fonte que o próprio serviço pode sobrescrever não é oferta.
    // A ordem também importa por um motivo mecânico: depois do `USER` o `COPY`
    // nasceria com o dono errado. E num estágio de BUILD ela não chegaria à
    // imagem publicada.
    expect(problemaDaOferta(lerEm(base, dockerfile))).toBeNull();
  });

  it.each([
    ['sem o COPY', 'FROM a AS b\nUSER x\n', 'não copia'],
    ['com o COPY depois do USER', `FROM a AS b\n${pasta}USER x\n${copia}`, 'depois do USER'],
    ['com o COPY só num estágio de build', `FROM a AS build\n${pasta}${copia}FROM c AS runtime\nUSER x\n`, 'não copia'],
    [
      'com o COPY sem o dono root',
      `FROM a AS b\n${pasta}COPY --chmod=0644 THIRD_PARTY_NOTICES.md \\\n     ${DESTINO}\nUSER x\n`,
      'não copia',
    ],
    ['sem criar a pasta antes (ela nasceria 0644)', `FROM a AS b\n${copia}USER x\n`, 'ANTES do COPY'],
    ['criando a pasta DEPOIS do COPY', `FROM a AS b\n${copia}${pasta}USER x\n`, 'ANTES do COPY'],
  ])('a régua reprova um Dockerfile %s', (_rotulo, dockerfile, trecho) => {
    expect(problemaDaOferta(dockerfile)).toContain(trecho);
  });

  it.each([...ALVOS])('a oferta existe na raiz do contexto de %s e não é bloqueada pelo .dockerignore', (alvo) => {
    // `COPY` de arquivo ausente falha o build, mas só na hora do build; e um padrão novo no
    // `.dockerignore` o tiraria do contexto sem erro nenhum até lá.
    const [base] = contexto(alvo);
    expect(lerEm(base, 'THIRD_PARTY_NOTICES.md').length).toBeGreaterThan(0);
    const arquivoDeIgnore = path.join(base, '.dockerignore');
    const ignore = (existsSync(arquivoDeIgnore) ? readFileSync(arquivoDeIgnore, 'utf8') : '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    // O último padrão que casa o arquivo vence; `!` reinclui.
    let ignorado = false;
    for (const padrao of ignore) {
      const [negado, nome] = padrao.startsWith('!') ? [true, padrao.slice(1)] : [false, padrao];
      if (['THIRD_PARTY_NOTICES.md', '*.md', '**/*.md'].includes(nome)) ignorado = !negado;
    }
    expect(ignorado).toBe(false);
  });
});

// ACHADO (AT-702): os binários do runner NÃO levam mais a oferta. O `build-runner-binaries.yml` do
// irmão `brabo-runner` gera `checksums.txt` só com `brabo-runner-*` (no monorepo incluía
// `THIRD_PARTY_NOTICES.md`). A prova ficaria vermelha contra o runner `dev`; o conserto é do repo
// `brabo-runner` e a prova volta aqui junto com ele — não fica `skip`.

describe('o NOTICES diz a verdade sobre onde ele viaja', () => {
  it('não afirma mais que nenhuma imagem é publicada', () => {
    // A frase original ("Hoje nenhuma imagem é publicada em registry... o que
    // segue é informativo") era verdadeira em 2026-07-27 e ficou para trás
    // quando o ADR 0119 passou a publicar. Um documento de conformidade que
    // afirma o contrário do que o repositório faz é pior que nenhum.
    const notices = ler('THIRD_PARTY_NOTICES.md');
    expect(notices).not.toMatch(/nenhuma imagem é publicada/i);
    expect(notices).toContain('ADR 0119');
  });

  it('cita o caminho dentro da imagem e o asset da Release', () => {
    const notices = ler('THIRD_PARTY_NOTICES.md');
    expect(notices).toContain(DESTINO);
    expect(notices).toContain('checksums.txt');
  });
});
