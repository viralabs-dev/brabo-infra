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
 */

import { execFileSync } from 'node:child_process';

const COMPOSE = ['-f', 'docker/docker-compose.yml', '--env-file', '.env'];

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

// ------------------------------------------------------------------- main

let compose;
try {
  compose = portasDoCompose();
} catch (erro) {
  // Preflight que bloqueia por defeito PRÓPRIO é pior que preflight nenhum:
  // ele impede o trabalho por um motivo que não é do trabalho. Avisa e sai da
  // frente — quem decide se o stack sobe é o `docker compose up`.
  console.warn(
    `[preflight] não consegui ler as portas do compose (${erro.message.split('\n')[0]}).\n` +
      '            Seguindo assim mesmo — o `up` dirá se algo estiver errado.',
  );
  process.exit(0);
}

const containers = donosContainer();
const host = escutandoNoHost();

const conflitos = [];
for (const [porta, servico] of [...compose.portas].sort((a, b) => a[0] - b[0])) {
  const container = containers.get(porta);

  if (container) {
    // Porta do PRÓPRIO projeto não é conflito: é o serviço já de pé, e o `up`
    // sabe lidar com isso.
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
