#!/usr/bin/env node
/**
 * preflight — confere se as portas do stack de dev estão livres ANTES de
 * chamar o `docker compose up`.
 *
 * POR QUE EXISTE. O repositório tem dois modos de rodar local, e eles usam as
 * mesmas portas de propósito (ADR 0025, decisão 10: assim o `smoke.sh` e o
 * realm de dev valem nos dois):
 *
 *   `make deploy-local`  → k3d, imagem de produção, web em :8088
 *   `pnpm dev`           → compose + Vite, hot reload,   web em :5173
 *
 * Os dois disputam 3000, 4000 e 8080. Com o k3d de pé, o `api` do compose não
 * publica a porta; como `web` tem `depends_on: api`, o `up` aborta e a 5173
 * NUNCA abre. O erro do Docker é `port is already allocated` — não diz quem
 * está segurando nem o que fazer. Este script diz.
 *
 * TAMBÉM RECUSA subir quando `BRABO_PROJECTS_BASE` (ADR 0141) se sobrepõe ao
 * checkout do Brabo, nos dois sentidos. Esta é a única checagem do produto que
 * consegue ver isso: a api compara o caminho de um projeto contra o checkout
 * que ELA enxerga, que dentro do container dela é `/workspace` — nunca o
 * caminho real no disco de quem desenvolve. Ver `base-de-projetos.mjs`.
 *
 * TAMBÉM detecta um caso mais específico na porta do `ollama` (OLLAMA_PORT,
 * default 11434, o MESMO default de uma instalação nativa de Ollama na
 * máquina do desenvolvedor): em vez de reportar "porta ocupada" genérico,
 * confirma por HTTP que é mesmo um Ollama e PERGUNTA se é para usar essa
 * instância — ver `detectarOllamaNativo`, abaixo.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline/promises';
import {
  baseSobrepoeOCheckout,
  mensagemDeBaseSobreposta,
} from './base-de-projetos.mjs';

const COMPOSE = ['-f', 'docker/docker-compose.yml', '--env-file', '.env'];
const ENV_PATH = path.resolve('.env');

function rodar(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** As portas que o compose quer, lidas DA FONTE já resolvida com o `.env`. */
function portasDoCompose() {
  const bruto = rodar('docker', ['compose', ...COMPOSE, 'config', '--format', 'json']);
  const cfg = JSON.parse(bruto);

  const portas = new Map(); // porta publicada → serviço
  for (const [servico, def] of Object.entries(cfg.services ?? {})) {
    for (const p of def.ports ?? []) {
      const publicada = Number(p.published);
      if (Number.isFinite(publicada)) portas.set(publicada, servico);
    }
  }
  return { projeto: cfg.name, portas };
}

/** Quem segura cada porta, entre os containers de pé. */
function donosContainer() {
  const linhas = rodar('docker', [
    'ps',
    '--format',
    '{{.Names}}§{{.Label "com.docker.compose.project"}}§{{.Ports}}',
  ])
    .split('\n')
    .filter(Boolean);

  const donos = new Map(); // porta → { nome, projeto }
  for (const linha of linhas) {
    const [nome, projeto, portas = ''] = linha.split('§');
    // "0.0.0.0:3000->30300/tcp" e "[::]:3000->30300/tcp" — só a porta de HOST.
    for (const m of portas.matchAll(/(?:^|\s|,)(?:[\d.]+|\[[^\]]+\]):(\d+)->/g)) {
      const porta = Number(m[1]);
      if (!donos.has(porta)) donos.set(porta, { nome, projeto });
    }
  }
  return donos;
}

/**
 * Portas escutando fora do Docker. Só é consultado quando nenhum container
 * assume a porta — se ela está ocupada e ninguém aparece, a resposta é "dono
 * desconhecido", nunca "está livre".
 */
function escutandoNoHost() {
  let saida;
  try {
    saida = rodar('ss', ['-tlnpH']);
  } catch {
    return null; // sem `ss`: não dá para saber. Não é o mesmo que vazio.
  }

  const portas = new Map(); // porta → processo (ou null)
  for (const linha of saida.split('\n')) {
    const alvo = /(?:^|\s)(?:[\d.]+|\[[^\]]*\]|\*):(\d+)\s/.exec(linha);
    if (!alvo) continue;
    const proc = /users:\(\("([^"]+)"/.exec(linha);
    const porta = Number(alvo[1]);
    if (!portas.has(porta)) portas.set(porta, proc ? proc[1] : null);
  }
  return portas;
}

// ------------------------------------------------------------------- .env
//
// Leitura/escrita simples de `.env`, no mesmo espírito de
// `scripts/dev/reset-total.sh` lendo as chaves `*_TEST_KEY` linha a linha
// (grep, não um parser de biblioteca) — só que aqui também na direção
// contrária (escrita), e por isso in-place: comentários e o resto das
// chaves saem intocados; quem já existe é ATUALIZADO na própria linha, quem
// não existe é ANEXADO ao final.

function lerEnv() {
  const mapa = new Map();
  if (!existsSync(ENV_PATH)) return mapa;
  for (const linha of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(linha);
    if (m) mapa.set(m[1], m[2]);
  }
  return mapa;
}

function escreverEnv(chaves) {
  const original = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const linhas = original.length > 0 ? original.split('\n') : [];
  const pendentes = new Map(Object.entries(chaves));

  const atualizadas = linhas.map((linha) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(linha);
    if (m && pendentes.has(m[1])) {
      const valor = pendentes.get(m[1]);
      pendentes.delete(m[1]);
      return `${m[1]}=${valor}`;
    }
    return linha;
  });

  // Uma última linha vazia (arquivo terminado em `\n`) some antes de anexar,
  // senão cada escrita deixaria uma linha em branco a mais no meio do arquivo.
  if (atualizadas.length > 0 && atualizadas.at(-1) === '') atualizadas.pop();
  for (const [chave, valor] of pendentes) atualizadas.push(`${chave}=${valor}`);
  writeFileSync(ENV_PATH, `${atualizadas.join('\n')}\n`);
}

// ------------------------------------------------------------- Ollama nativo
//
// Evita o "port is already allocated" contra uma instalação NATIVA de Ollama
// na máquina do desenvolvedor — mesmo default de porta (11434) do serviço
// `ollama` do compose. Ver docker/docker-compose.yml (profiles: local-llm) e
// scripts/dev/perfil-ollama.sh, que leem o que este bloco grava em `.env`.

/**
 * GET curto em `/api/tags` — o endpoint que o Ollama sempre responde, mesmo
 * sem nenhum modelo baixado (`{"models":[]}`), e nenhum outro serviço comum
 * devolve nesse formato. Timeout curto: isto roda ANTES de qualquer
 * container subir, e travar aqui travaria todo `docker compose up`.
 */
async function ehOllama(porta) {
  try {
    const resposta = await fetch(`http://localhost:${porta}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!resposta.ok) return false;
    const corpo = await resposta.json();
    return Array.isArray(corpo?.models);
  } catch {
    return false;
  }
}

function portaLivre(porta) {
  return new Promise((resolve) => {
    const servidor = net.createServer();
    servidor.once('error', () => resolve(false));
    servidor.once('listening', () => servidor.close(() => resolve(true)));
    servidor.listen({ port: porta, host: '0.0.0.0' });
  });
}

async function proximaPortaLivre(inicial) {
  let porta = inicial;
  // eslint-disable-next-line no-await-in-loop -- sequencial de propósito: é
  // uma varredura curta (dezenas de portas, no pior caso) e paralelizar só
  // complicaria sem ganho perceptível.
  while (!(await portaLivre(porta))) porta += 1;
  return porta;
}

function respostaAfirmativa(resposta) {
  const normalizada = resposta.trim().toLowerCase();
  return normalizada === '' || normalizada === 's' || normalizada === 'sim';
}

/**
 * Pergunta uma vez, de forma síncrona, se é para usar o Ollama nativo
 * detectado. SEM TTY em stdin (é exatamente o caso do bootstrap.sh: o item
 * de menu roda o comando em BACKGROUND com stdin de `/dev/null`, de
 * propósito — ver o comentário em `executar()` no bootstrap.sh — para não
 * roubar as setas do usuário), não há keyboard nenhum para ler: perguntar
 * ali travaria esperando uma resposta que nunca chega. Sem TTY, aplica o
 * default (Sim) direto e avisa por quê.
 */
async function perguntarUsoDoOllama(porta) {
  if (!process.stdin.isTTY) {
    console.log(
      `[preflight] Ollama nativo detectado na porta ${porta}, mas sem terminal interativo` +
        ' para perguntar — usando o default (Sim).',
    );
    return true;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const resposta = await rl.question(
      `Detectamos Ollama já rodando na porta ${porta}. ` +
        'Usar essa instância para os LLMs locais do Brabo? [S/n] ',
    );
    return respostaAfirmativa(resposta);
  } finally {
    rl.close();
  }
}

/**
 * Devolve `null` quando não há conflito nenhum a reportar sobre a porta de
 * OLLAMA_PORT — porta livre, `.env` já tem OLLAMA_MODE (decisão já tomada —
 * "Docker › Reconfigurar Ollama" no bootstrap.sh é quem reabre a pergunta,
 * removendo a chave), ou a porta ESTAVA ocupada mas era mesmo Ollama, e já
 * foi tratada (perguntado e gravado em `.env`).
 *
 * Devolve `{ porta, servico, dono }` — o MESMO formato de item de
 * `conflitos` que o laço genérico monta, abaixo — quando a porta está
 * ocupada por algo que NÃO é Ollama: com `ollama`/`ollama-model-loader` sob
 * `profiles: ["local-llm"]` no compose, a porta nem aparece mais em
 * `compose.portas` por padrão (perfil inativo), então sem este caso a
 * detecção simplesmente NÃO reportaria — regressão silenciosa em relação ao
 * comportamento de antes desta função existir.
 */
async function detectarOllamaNativo({ containers, host }) {
  const env = lerEnv();
  if (env.has('OLLAMA_MODE')) return null;

  const porta = Number(process.env.OLLAMA_PORT ?? env.get('OLLAMA_PORT') ?? 11434);
  if (!Number.isFinite(porta)) return null;

  const container = containers.get(porta);
  if (!container) {
    if (host === null) return null; // sem `ss`, e nenhum container: nada a afirmar.
    if (!host.has(porta)) return null; // porta livre
  }

  if (await ehOllama(porta)) {
    console.log(`\n[preflight] Ollama nativo detectado na porta ${porta}.`);
    if (await perguntarUsoDoOllama(porta)) {
      escreverEnv({ OLLAMA_MODE: 'host', OLLAMA_HOST: `http://host.docker.internal:${porta}` });
      console.log(
        '[preflight] OLLAMA_MODE=host gravado em .env — os serviços ollama/ollama-model-loader' +
          ' do compose não sobem.',
      );
    } else {
      const livre = await proximaPortaLivre(11500);
      escreverEnv({ OLLAMA_MODE: 'container', OLLAMA_PORT: String(livre) });
      console.log(`[preflight] OLLAMA_MODE=container e OLLAMA_PORT=${livre} gravados em .env.`);
    }
    return null; // tratado — nada a reportar como conflito
  }

  const dono = container ? container.nome : (host.get(porta) ?? 'processo desconhecido');
  return { porta, servico: 'ollama', dono };
}

// ------------------------------------------------- base dos projetos montados

/**
 * O checkout do Brabo no HOST, ou `null` quando não dá para afirmar.
 *
 * `null` (fora de um repositório git, `git` indisponível) NÃO bloqueia: o
 * preflight avisa e sai da frente quando não sabe, nunca impede o trabalho por
 * um defeito que não é do trabalho — a mesma regra do `catch` de
 * `portasDoCompose`, abaixo.
 */
function checkoutDoBrabo() {
  try {
    return rodar('git', ['rev-parse', '--show-toplevel']).trim();
  } catch {
    return null;
  }
}

/**
 * Recusa a subida quando `BRABO_PROJECTS_BASE` se sobrepõe ao checkout
 * (ADR 0141, RN-500). Devolve `true` quando é para PARAR.
 *
 * O ambiente do processo tem precedência sobre o `.env`, na mesma ordem que o
 * Compose aplica — checar o `.env` quando alguém exportou outro valor na shell
 * aprovaria uma base que não é a que vai subir.
 */
function baseDeProjetosProibida() {
  const base = process.env.BRABO_PROJECTS_BASE ?? lerEnv().get('BRABO_PROJECTS_BASE');
  const checkout = checkoutDoBrabo();
  if (!baseSobrepoeOCheckout(base, checkout)) return false;
  console.error(mensagemDeBaseSobreposta(base, checkout));
  return true;
}

// ------------------------------------------------------------------- main

async function main() {
  // ANTES de qualquer coisa: não depende de Docker, e é a única checagem aqui
  // que impede um dano em vez de um inconveniente.
  if (baseDeProjetosProibida()) process.exit(1);

  let compose;
  try {
    compose = portasDoCompose();
  } catch (erro) {
    // Preflight que bloqueia por defeito PRÓPRIO é pior que preflight nenhum:
    // ele impede o trabalho por um motivo que não é do trabalho. Avisa e sai
    // da frente — quem decide se o stack sobe é o `docker compose up`.
    console.warn(
      `[preflight] não consegui ler as portas do compose (${erro.message.split('\n')[0]}).\n` +
        '            Seguindo assim mesmo — o `up` dirá se algo estiver errado.',
    );
    process.exit(0);
    return;
  }

  const containers = donosContainer();
  const host = escutandoNoHost();

  // Roda ANTES do relato genérico: com `ollama`/`ollama-model-loader` sob
  // `profiles: ["local-llm"]` no compose, a porta do Ollama já nem aparece
  // em `compose.portas` por padrão (perfil inativo por default em `docker
  // compose config`) — esta detecção é autônoma, não um caso do laço abaixo.
  // Quando a porta está ocupada por algo que NÃO é Ollama, ela devolve um
  // conflito no MESMO formato do laço, que entra na lista abaixo.
  const conflitoOllama = await detectarOllamaNativo({ containers, host });

  const conflitos = conflitoOllama ? [conflitoOllama] : [];
  for (const [porta, servico] of [...compose.portas].sort((a, b) => a[0] - b[0])) {
    const container = containers.get(porta);

    if (container) {
      // Porta do PRÓPRIO projeto não é conflito: é o serviço já de pé, e o
      // `up` sabe lidar com isso.
      if (container.projeto === compose.projeto) continue;
      conflitos.push({ porta, servico, dono: container.nome });
      continue;
    }

    if (host === null) continue; // sem `ss`, e nenhum container: nada a afirmar.

    if (host.has(porta)) {
      const proc = host.get(porta);
      conflitos.push({ porta, servico, dono: proc ?? 'processo desconhecido' });
    }
  }

  if (conflitos.length === 0) process.exit(0);

  const larguraServico = Math.max(...conflitos.map((c) => c.servico.length));
  console.error(
    `\n[preflight] ${conflitos.length} porta(s) que o \`pnpm dev\` precisa estão ocupadas:\n`,
  );
  for (const { porta, servico, dono } of conflitos) {
    console.error(`  ${String(porta).padEnd(6)}${servico.padEnd(larguraServico + 2)}← ${dono}`);
  }

  // O caso comum, e o que motivou o script: o cluster local de validação.
  const doK3d = conflitos.filter((c) => /^k3d-/.test(c.dono));
  if (doK3d.length > 0) {
    const lb = [...containers.entries()].find(([, d]) => /^k3d-/.test(d.nome));
    const publicaWeb = lb && containers.get(8088) && /^k3d-/.test(containers.get(8088).nome);

    console.error(
      '\nO cluster k3d está de pé. Ele e o compose usam as mesmas portas de\n' +
        'propósito (ADR 0025, decisão 10), então os dois modos não coexistem.\n',
    );
    if (publicaWeb) {
      console.error('  • o web do cluster está publicado em  http://localhost:8088');
    }
    console.error('  • para usar o Vite na 5173:           make k8s-down && pnpm dev\n');
    console.error('Os dois modos estão explicados em docs/getting-started.md.\n');
  } else {
    console.error(
      '\nLibere as portas acima, ou aponte outras pelo `.env`\n' +
        '(API_PORT, ENGINE_PORT, WEB_PORT, OLLAMA_PORT).\n',
    );
  }

  process.exit(1);
}

await main();
