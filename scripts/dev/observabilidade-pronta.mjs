#!/usr/bin/env node
// Confere que o stack de observabilidade local está REALMENTE servindo, e não
// só que os containers subiram.
//
// POR QUE EXISTE: `docker compose up -d` volta assim que o container inicia.
// Entre isso e o Grafana responder, o Prometheus fazer o primeiro scrape e o
// Alloy entregar a primeira linha ao Loki passam dezenas de segundos — e quem
// abre a URL nesse intervalo vê painel vazio e conclui que não funciona. Este
// script espera cada peça e diz qual delas ainda não chegou.
//
// Sem dependência nova: `fetch` global do Node. Mesma regra de
// scripts/dev/validacao-visual.js — verificador que exige instalar runtime não
// é rodado.
//
// Uso:
//   node scripts/dev/observabilidade-pronta.mjs
//   GRAFANA_PORT=3001 LOKI_PORT=3100 PROMETHEUS_PORT=9090 node ...

const GRAFANA = `http://localhost:${process.env.GRAFANA_PORT ?? 3001}`;
const LOKI = `http://localhost:${process.env.LOKI_PORT ?? 3100}`;
const PROM = `http://localhost:${process.env.PROMETHEUS_PORT ?? 9090}`;

const TETO_MS = 180_000;
const INTERVALO_MS = 3_000;

const cor = process.stdout.isTTY && !process.env.NO_COLOR;
const verde = (t) => (cor ? `[32m${t}[0m` : t);
const amarelo = (t) => (cor ? `[33m${t}[0m` : t);
const vermelho = (t) => (cor ? `[31m${t}[0m` : t);
const forte = (t) => (cor ? `[1m${t}[0m` : t);

function ok(msg) {
  console.log(`  ${verde('ok')}   ${msg}`);
}
function aviso(msg) {
  console.log(`  ${amarelo('aviso')} ${msg}`);
}

async function buscar(url, opcoes = {}) {
  const controle = AbortSignal.timeout(4_000);
  try {
    const r = await fetch(url, { ...opcoes, signal: controle });
    return r.ok ? r : null;
  } catch {
    return null;
  }
}

/** Repete `tentativa` até devolver verdade ou estourar o teto. */
async function esperar(rotulo, tentativa) {
  const limite = Date.now() + TETO_MS;
  let ultimo = null;
  while (Date.now() < limite) {
    ultimo = await tentativa();
    if (ultimo) {
      ok(`${rotulo}${typeof ultimo === 'string' ? ` — ${ultimo}` : ''}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, INTERVALO_MS));
  }
  console.log(`  ${vermelho('falhou')} ${rotulo} — não respondeu em ${TETO_MS / 1000}s`);
  return false;
}

async function main() {
  console.log(`\n${forte('[observabilidade]')} esperando o stack ficar servível…\n`);

  let tudoBem = true;
  const registrar = (r) => { tudoBem = tudoBem && r; return r; };

  registrar(await esperar('Loki respondendo', async () => {
    const r = await buscar(`${LOKI}/ready`);
    return r ? 'pronto para receber log' : null;
  }));

  registrar(await esperar('Prometheus respondendo', async () => {
    const r = await buscar(`${PROM}/-/ready`);
    return r ? 'pronto' : null;
  }));

  registrar(await esperar('Grafana respondendo', async () => {
    const r = await buscar(`${GRAFANA}/api/health`);
    if (!r) return null;
    const corpo = await r.json().catch(() => ({}));
    return `versão ${corpo.version ?? '?'}`;
  }));

  // Servir não é o mesmo que ter DADO. As três checagens abaixo são o que
  // separa "subiu" de "o painel vai mostrar algo".
  registrar(await esperar('Prometheus raspando api e engine', async () => {
    const r = await buscar(`${PROM}/api/v1/targets?state=active`);
    if (!r) return null;
    const corpo = await r.json().catch(() => null);
    const alvos = corpo?.data?.activeTargets ?? [];
    const saudaveis = alvos
      .filter((a) => a.health === 'up')
      .map((a) => a.labels?.job)
      .filter((j) => j === 'brabo-api' || j === 'brabo-engine');
    return saudaveis.length === 2 ? 'os dois alvos de pé' : null;
  }));

  registrar(await esperar('Loki recebendo log dos serviços', async () => {
    const r = await buscar(`${LOKI}/loki/api/v1/label/app/values`);
    if (!r) return null;
    const corpo = await r.json().catch(() => null);
    const apps = corpo?.data ?? [];
    return apps.length > 0 ? apps.sort().join(', ') : null;
  }));

  const datasources = await buscar(`${GRAFANA}/api/datasources`);
  if (datasources) {
    const lista = await datasources.json().catch(() => []);
    const uids = lista.map((d) => d.uid).sort();
    const esperados = ['brabo-loki', 'brabo-prometheus'];
    const faltando = esperados.filter((u) => !uids.includes(u));
    if (faltando.length === 0) ok(`datasources provisionados — ${uids.join(', ')}`);
    else aviso(`datasource faltando: ${faltando.join(', ')}`);
  }

  const dash = await buscar(`${GRAFANA}/api/search?type=dash-db`);
  if (dash) {
    const lista = await dash.json().catch(() => []);
    if (lista.length > 0) ok(`${lista.length} dashboards carregados — ${lista.map((d) => d.title).join(' · ')}`);
    else aviso('nenhum dashboard carregado');
  }

  console.log(`\n  ${forte('Grafana')}     ${GRAFANA}  (sem login)`);
  console.log(`  ${forte('Logs')}        ${GRAFANA}/d/brabo-logs`);
  console.log(`  Prometheus  ${PROM}`);
  console.log(`  Loki        ${LOKI}`);
  console.log(
    `\n  ${amarelo('nota')}  Painel de custo/tokens só mostra série DEPOIS da primeira chamada de LLM:\n` +
      '        são métricas com rótulo, e no prom-client elas não existem antes da\n' +
      '        primeira observação. Não é painel quebrado.\n',
  );

  process.exit(tudoBem ? 0 : 1);
}

main().catch((erro) => {
  console.error(vermelho(`[observabilidade] ${erro?.message ?? erro}`));
  process.exit(1);
});
