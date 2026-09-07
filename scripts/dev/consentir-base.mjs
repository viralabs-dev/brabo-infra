#!/usr/bin/env node
/**
 * O passo de consentimento da base de projetos montados (ADR 0146).
 *
 * Propõe uma base, valida, PROVA que o Docker a enxerga, cria a pasta e grava
 * `BRABO_PROJECTS_BASE` no `.env`. Sem ela, o modo "Pasta montada" não é
 * oferecido pelo produto (RN-500) — e nada, até aqui, pedia que ela fosse
 * configurada: era um modo pronto e inalcançável.
 *
 * Roda de dois lugares, e a diferença entre eles é stdin:
 *
 *   node scripts/dev/consentir-base.mjs      # no SEU terminal: pergunta
 *   pnpm bootstrap → Docker › Base de projetos   # do menu: só relata
 *
 * O item de menu não pergunta porque NÃO PODE: todo comando do menu roda em
 * background com stdin vindo de `/dev/null` (`bootstrap.sh:770`), de propósito
 * — sem isso qualquer coisa que leia stdin rouba as setas do usuário. É a
 * mesma razão pela qual "Reconfigurar Ollama" não pergunta e sim limpa chaves
 * para o próximo `pnpm dev` perguntar. Aqui o relato já é útil sozinho, e a
 * saída diz o comando que pergunta.
 *
 * A lógica de DECISÃO (qual é o default, o que é uma base válida, quando
 * provar) mora em `base-de-projetos.mjs`, pura e testada. Este arquivo é só o
 * I/O: perguntar, chamar `docker`, criar pasta, escrever.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';

import { lerEnv, escreverEnv } from './env-file.mjs';
import {
  RECUSA,
  basePadrao,
  exigeProvaDeCompartilhamento,
  normalizarBase,
  validarBase,
} from './base-de-projetos.mjs';

const VARIAVEL = 'BRABO_PROJECTS_BASE';

function rodar(cmd, args, opcoes = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opcoes });
}

function checkoutDoBrabo() {
  try {
    return rodar('git', ['rev-parse', '--show-toplevel']).trim();
  } catch {
    return null;
  }
}

// ------------------------------------------------------- a prova do mount
//
// Provar MONTANDO, nunca lendo `settings.json` do Docker Desktop: aquele
// arquivo não é documentado, muda entre versões e entre macOS e Windows, e
// descreve o que o usuário CONFIGUROU — não o que o daemon fará. Montar mede a
// propriedade. É a mesma régua que o produto já aplica aos providers de LLM:
// capability só é declarada quando provada por execução (ADR 0041/0042).

/**
 * Uma imagem que já está no daemon. `null` quando não há nenhuma.
 *
 * Não puxa imagem nenhuma de propósito: um passo de consentimento que baixa
 * centenas de megabytes para responder uma pergunta de configuração está
 * fazendo outra coisa. Sem imagem local, a prova não roda — e isso vira um
 * desfecho PRÓPRIO, nunca um "passou".
 */
function imagemLocal() {
  try {
    const saida = rodar('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}']);
    const candidatas = saida
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.includes('<none>'));
    // Preferência por imagens pequenas e previsíveis quando existirem; senão a
    // primeira serve — o que se está provando é o MOUNT, não a imagem.
    const preferida = candidatas.find((c) => /^(alpine|busybox)[:@]/.test(c));
    return preferida ?? candidatas[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * O Docker enxerga esta pasta?
 *
 * Devolve `'ok'`, `'nao-compartilhada'` ou `'nao-provado'` — TRÊS estados, e
 * eles não colapsam. "Não consegui olhar" virar "está tudo bem" é exatamente
 * como uma base não compartilhada chegaria ao usuário como um container que
 * sobe com a pasta vazia, longe da tela onde a escolha foi feita.
 *
 * O teste é uma SENTINELA, não um `ls` seco: uma pasta vazia e uma pasta não
 * compartilhada produzem a mesma listagem vazia. Escrevemos um arquivo, e a
 * pergunta passa a ser "o container vê o que eu acabei de escrever?".
 */
function provarCompartilhamento(base) {
  const imagem = imagemLocal();
  if (imagem === null) return { estado: 'nao-provado', motivo: 'nenhuma imagem Docker local' };

  const nome = `.brabo-sonda-${process.pid}-${Date.now()}`;
  const sentinela = path.join(base, nome);
  try {
    writeFileSync(sentinela, '');
  } catch (erro) {
    return { estado: 'nao-provado', motivo: `não consegui escrever em ${base}: ${erro.code ?? erro}` };
  }

  try {
    const saida = rodar('docker', [
      'run', '--rm',
      '-v', `${base}:/sonda`,
      imagem,
      'ls', '-a', '/sonda',
    ]);
    return saida.includes(nome)
      ? { estado: 'ok', imagem }
      : { estado: 'nao-compartilhada', imagem };
  } catch (erro) {
    // O Docker Desktop recusa o mount com erro quando o caminho está fora da
    // lista; o Docker Engine do Linux não tem essa recusa. Falha aqui é sinal
    // de não-compartilhado na plataforma em que a prova é exigida.
    const texto = String(erro.stderr ?? erro.message ?? erro);
    return { estado: 'nao-compartilhada', imagem, detalhe: texto.trim().split('\n').at(-1) };
  } finally {
    try {
      rmSync(sentinela, { force: true });
    } catch {
      /* a sentinela é lixo inofensivo; não vale derrubar o passo por ela */
    }
  }
}

// ------------------------------------------------------------- mensagens

function recusa(veredito) {
  const { motivo, base, outro } = veredito;
  const cabecalho = `\n[base] caminho recusado: ${base ?? '(vazio)'}\n\n`;
  const mapa = {
    [RECUSA.VAZIA]: 'Um caminho vazio não é uma base.',
    [RECUSA.TIL]:
      'Use o caminho absoluto, não `~`. O Compose não expande til, e gravar\n' +
      '`~/algo` cria uma pasta chamada `~` dentro do repositório.',
    [RECUSA.RELATIVA]: 'A base precisa ser um caminho ABSOLUTO.',
    [RECUSA.RAIZ]:
      'A base não pode ser `/`: tudo que estiver sob ela fica alcançável de\n' +
      'dentro dos containers do produto.',
    [RECUSA.SOBREPOE_CHECKOUT]:
      `Ela se sobrepõe ao checkout do Brabo (${outro}).\n\n` +
      'Os agentes de dev executam comandos dentro das pastas dos projetos. Com\n' +
      'a base sobreposta ao checkout, esses comandos rodariam na árvore do\n' +
      'PRÓPRIO Brabo — a falha que o ADR 0055 existe para impedir.',
    [RECUSA.SOBREPOE_GERENCIADA]:
      `Ela se sobrepõe a PROJECT_WORKSPACES_HOST_DIR (${outro}).\n\n` +
      'São duas raízes de donos opostos: aquela é a pasta que o PRODUTO\n' +
      'gerencia (nomeada por `workspace_dir_name`), esta é nomeada por você.\n' +
      'Sobrepostas, um projeto "Pasta montada" chamado `loja` cairia na mesma\n' +
      'pasta física de um projeto `container` cujo diretório também é `loja`,\n' +
      'e o bootstrap daria `git init` dentro do projeto do outro (ADR 0141).',
  };
  return `${cabecalho}  ${mapa[motivo] ?? 'Caminho inválido.'}\n`;
}

function relatorio(atual, raizGerenciada) {
  const linhas = [`\n[base] estado atual\n`];
  linhas.push(`  ${VARIAVEL}  ${atual ?? '(não configurada)'}`);
  if (raizGerenciada) linhas.push(`  PROJECT_WORKSPACES_HOST_DIR  ${raizGerenciada}`);
  linhas.push('');
  if (atual === null) {
    linhas.push('  Sem base configurada, o modo "Pasta montada" não é oferecido na');
    linhas.push('  criação de projeto (RN-500) — o código fica na pasta que o Brabo');
    linhas.push('  gerencia, e você não a abre no editor.');
  } else if (!existsSync(atual)) {
    linhas.push('  A pasta ainda NÃO existe no disco. Isso é normal antes do primeiro');
    linhas.push('  projeto; ela é criada quando a Infra sobe o container (ADR 0142).');
  } else {
    linhas.push('  A pasta existe.');
  }
  return `${linhas.join('\n')}\n`;
}

// ----------------------------------------------------------------- main

async function main() {
  const env = lerEnv();
  const atual = normalizarBase(process.env[VARIAVEL] ?? env.get(VARIAVEL));
  const raizGerenciada = normalizarBase(
    process.env.PROJECT_WORKSPACES_HOST_DIR ?? env.get('PROJECT_WORKSPACES_HOST_DIR'),
  );
  const checkout = checkoutDoBrabo();

  // Sem TTY, RELATA e não faz nada. Um script de consentimento que "consente"
  // sozinho num pipe de CI — ou dentro do menu, cujo stdin é /dev/null — é a
  // negação da palavra. Mesmo desenho de `perguntarUsoDoOllama`, que sem
  // terminal aplica o default e avisa em vez de travar.
  if (!process.stdin.isTTY) {
    process.stdout.write(relatorio(atual, raizGerenciada));
    process.stdout.write(
      '\n  Para ESCOLHER a base, rode no seu terminal:\n' +
        '    node scripts/dev/consentir-base.mjs\n\n' +
        '  (o menu do bootstrap roda os itens sem stdin, de propósito — por isso\n' +
        '  ele relata em vez de perguntar)\n',
    );
    return 0;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(relatorio(atual, raizGerenciada));

    if (atual !== null) {
      const troca = (await rl.question(`\n  Trocar a base atual? [s/N] `)).trim().toLowerCase();
      if (troca !== 's' && troca !== 'sim') {
        process.stdout.write('\n  Mantida.\n');
        return 0;
      }
    }

    const sugerida = basePadrao(homedir());
    const resposta = (
      await rl.question(`\n  Caminho da base [${sugerida}]: `)
    ).trim();
    const candidata = resposta.length > 0 ? resposta : sugerida;

    const veredito = validarBase(candidata, { checkout, raizGerenciada });
    if (!veredito.ok) {
      process.stderr.write(recusa(veredito));
      return 1;
    }
    const base = veredito.base;

    // `mkdir -p` só DEPOIS do aceite e da validação — criar pasta a partir de
    // um caminho que ainda não passou pelas recusas é criar pasta em qualquer
    // lugar que o processo alcance.
    mkdirSync(base, { recursive: true });
    if (!statSync(base).isDirectory()) {
      process.stderr.write(`\n[base] ${base} existe e não é uma pasta.\n`);
      return 1;
    }

    if (exigeProvaDeCompartilhamento(process.platform)) {
      const prova = provarCompartilhamento(base);
      if (prova.estado === 'nao-compartilhada') {
        process.stderr.write(
          `\n[base] o Docker NÃO enxerga ${base}.\n\n` +
            '  A pasta existe no seu disco, mas está fora da lista de\n' +
            '  compartilhamento de arquivos do Docker Desktop — um container que a\n' +
            '  montasse subiria com ela VAZIA.\n\n' +
            '  Adicione em: Docker Desktop → Settings → Resources → File sharing\n' +
            `  e rode este passo de novo.\n${
              prova.detalhe ? `\n  O Docker disse: ${prova.detalhe}\n` : ''
            }`,
        );
        return 1;
      }
      if (prova.estado === 'nao-provado') {
        // Terceiro estado, e ele NÃO vira "passou": a variável é gravada, mas
        // o relato diz que a prova não rodou e como rodá-la.
        process.stdout.write(
          `\n  [aviso] não consegui PROVAR o compartilhamento (${prova.motivo}).\n` +
            '  A base foi gravada assim mesmo; prove depois com:\n' +
            `    docker run --rm -v ${base}:/sonda alpine ls -a /sonda\n`,
        );
      } else {
        process.stdout.write(`\n  Compartilhamento provado (imagem ${prova.imagem}).\n`);
      }
    }

    escreverEnv({ [VARIAVEL]: base });
    process.stdout.write(
      `\n  ${VARIAVEL}=${base} gravada no .env\n\n` +
        '  Para os containers enxergarem a base:\n' +
        '    docker compose -f docker/docker-compose.yml --env-file .env up -d api engine\n',
    );
    return 0;
  } finally {
    rl.close();
  }
}

process.exit(await main());
