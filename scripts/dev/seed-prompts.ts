/**
 * seed-prompts — envia os templates de `prompts/*.md` para o catálogo de
 * prompts da api (`POST /internal/graph/prompt-templates`).
 *
 * Contrato combinado com a frente N2 (api) e N3 (engine), que constroem a
 * infraestrutura de LEITURA desses templates em paralelo a esta extração de
 * conteúdo (N1):
 *
 *   POST /internal/graph/prompt-templates
 *   Body: { name: string, version: string, body: string, hash: string }
 *   -> 201 { name, version, body, hash, active: true }
 *
 * Idempotente por HASH do lado da api: reenviar o MESMO corpo não cria
 * versão nova. O contrato documenta só a resposta 201 — sem campo que
 * distinga "criou agora" de "hash já existia" —, então este script NÃO
 * inventa essa distinção: o resumo final agrupa por resultado da CHAMADA
 * (enviado / erro HTTP / sem conexão / sem token), nunca por
 * criado-vs-já-existia, até o contrato ganhar esse campo.
 *
 * Uso:
 *   node scripts/dev/seed-prompts.ts
 *
 * Variáveis de ambiente:
 *   API_PUBLIC_URL       — default http://localhost:3000 (mesmo default de
 *                           apps/api/src/**, ver .env.example)
 *   BRABO_SERVICE_TOKEN  — obrigatória; mesma credencial que
 *                           apps/api/src/infrastructure/http-clients/api-to-engine-client.ts
 *                           usa no cabeçalho x-brabo-service-token
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping,
 * mesmo padrão de scripts/ci/*.ts).
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const PROMPTS_DIR = path.resolve(AQUI, '../../prompts');
const CABECALHO_SERVICE_TOKEN = 'x-brabo-service-token';

export interface TemplateParseado {
  name: string;
  version: string;
  body: string;
}

export interface TemplateComHash extends TemplateParseado {
  file: string;
  hash: string;
}

/**
 * Extrai `name`/`version`/`body` de um arquivo `prompts/*.md`. O
 * front-matter é o bloco `---\n...\n---` no topo, YAML puro (a lib `yaml`
 * já é dependência do workspace `scripts`, sem precisar de `gray-matter` —
 * não há outra lib de front-matter em uso no repo). `sourceLabel` só entra
 * nas mensagens de erro, para apontar qual arquivo falhou.
 */
export function parseFrontMatter(raw: string, sourceLabel: string): TemplateParseado {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    throw new Error(
      `${sourceLabel}: front-matter ausente ou malformado — esperava um bloco ` +
        '"---" ... "---" no topo do arquivo, seguido do corpo do template.',
    );
  }
  const frontMatterRaw = match[1] ?? '';
  const bodyRaw = match[2] ?? '';

  let frontMatter: unknown;
  try {
    frontMatter = parseYaml(frontMatterRaw);
  } catch (err) {
    throw new Error(
      `${sourceLabel}: front-matter não é YAML válido — ${erroComoTexto(err)}`,
    );
  }

  if (typeof frontMatter !== 'object' || frontMatter === null || Array.isArray(frontMatter)) {
    throw new Error(
      `${sourceLabel}: front-matter precisa ser um mapeamento YAML (chave: valor), ` +
        `recebeu ${Array.isArray(frontMatter) ? 'uma lista' : typeof frontMatter}.`,
    );
  }

  const { name, version } = frontMatter as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(`${sourceLabel}: front-matter sem campo "name" (string não vazia).`);
  }
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error(
      `${sourceLabel}: front-matter sem campo "version" (string, ex.: "1" — não número).`,
    );
  }

  const body = bodyRaw.replace(/^\n+/, '').replace(/[ \t\r\n]+$/, '\n');
  if (body.trim() === '') {
    throw new Error(`${sourceLabel}: corpo do template está vazio depois do front-matter.`);
  }

  return { name, version, body };
}

function erroComoTexto(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** sha256 hex do corpo — determinístico, mesmo body sempre produz o mesmo hash. */
export function hashBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** Lê `prompts/*.md` (exceto README.md) e devolve cada template já com hash. */
export async function carregarTemplates(dir: string = PROMPTS_DIR): Promise<TemplateComHash[]> {
  const entradas = await readdir(dir);
  const arquivos = entradas
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .sort();

  const templates: TemplateComHash[] = [];
  for (const file of arquivos) {
    const raw = await readFile(path.join(dir, file), 'utf8');
    const parsed = parseFrontMatter(raw, file);
    templates.push({ file, ...parsed, hash: hashBody(parsed.body) });
  }
  return templates;
}

export type ResultadoEnvio =
  | { file: string; name: string; status: 'enviado'; detail: unknown }
  | { file: string; name: string; status: 'erro-http'; detail: string }
  | { file: string; name: string; status: 'sem-conexao'; detail: string }
  | { file: string; name: string; status: 'sem-token'; detail: string };

async function enviarTemplate(
  template: TemplateComHash,
  apiBase: string,
  token: string | undefined,
): Promise<ResultadoEnvio> {
  if (!token) {
    return {
      file: template.file,
      name: template.name,
      status: 'sem-token',
      detail: 'BRABO_SERVICE_TOKEN não definida no ambiente — nenhuma chamada foi feita.',
    };
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase}/internal/graph/prompt-templates`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [CABECALHO_SERVICE_TOKEN]: token,
      },
      body: JSON.stringify({
        name: template.name,
        version: template.version,
        body: template.body,
        hash: template.hash,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return {
      file: template.file,
      name: template.name,
      status: 'sem-conexao',
      detail: erroComoTexto(err),
    };
  }

  if (!response.ok) {
    const texto = await response.text().catch(() => '');
    return {
      file: template.file,
      name: template.name,
      status: 'erro-http',
      detail: `HTTP ${response.status}${texto ? ` — ${texto}` : ''}`,
    };
  }

  const corpo = await response.json().catch(() => null);
  return { file: template.file, name: template.name, status: 'enviado', detail: corpo };
}

function imprimirResumo(resultados: ResultadoEnvio[]): void {
  console.log('\nResumo do seed de prompts:\n');
  for (const r of resultados) {
    const rotulo =
      r.status === 'enviado'
        ? 'ok      '
        : r.status === 'erro-http'
          ? 'erro-http'
          : r.status === 'sem-conexao'
            ? 'sem-rede '
            : 'sem-token';
    console.log(`  ${rotulo}  ${r.file.padEnd(32)} ${r.name}`);
    if (r.status !== 'enviado') {
      console.log(`            ${r.detail}`);
    }
  }

  const porStatus = resultados.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `\nTotal: ${resultados.length} template(s) — ` +
      Object.entries(porStatus)
        .map(([status, n]) => `${n} ${status}`)
        .join(', '),
  );

  if (porStatus['enviado'] !== resultados.length) {
    console.log(
      '\nNota: nem todos os templates foram enviados com sucesso. Se a rota ' +
        '/internal/graph/prompt-templates ainda não existe do lado da api ' +
        '(frente N2 em paralelo pode não ter terminado), isso é esperado — ' +
        'a leitura/parsing/hash locais já rodaram e estão corretas; só o ' +
        'roundtrip HTTP depende da N2.',
    );
  }
}

async function main(): Promise<void> {
  const apiBase = process.env.API_PUBLIC_URL ?? 'http://localhost:3000';
  const token = process.env.BRABO_SERVICE_TOKEN;

  const templates = await carregarTemplates();
  if (templates.length === 0) {
    console.log(`Nenhum template encontrado em ${PROMPTS_DIR} (fora README.md).`);
    return;
  }

  console.log(`Encontrados ${templates.length} template(s) em ${PROMPTS_DIR}:`);
  for (const t of templates) {
    console.log(`  - ${t.file}  (${t.name}@${t.version}, hash ${t.hash.slice(0, 12)}…)`);
  }

  const resultados: ResultadoEnvio[] = [];
  for (const template of templates) {
    resultados.push(await enviarTemplate(template, apiBase, token));
  }

  imprimirResumo(resultados);

  const falhou = resultados.some((r) => r.status !== 'enviado');
  if (falhou) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('seed-prompts falhou:', err);
    process.exitCode = 1;
  });
}
