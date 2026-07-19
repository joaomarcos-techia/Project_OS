/**
 * check:observability — gate anti-drift da camada de monitoramento.
 *
 * POR QUE existe (achados M5 e N1 da auditoria de monitoramento): a doc
 * operacional é a fonte de verdade DURANTE UM INCIDENTE, e ela estava mentindo
 * em dois eixos, ambos invisíveis a qualquer gate existente:
 *
 *  1. CONTAGEM DE CRONS — `vercel.json` tinha 13, o `c16-inventory.md` dizia 12
 *     e o `production-readiness.md` dizia 6. Às 3h da manhã, o operador consulta
 *     a lista, não acha o cron problemático e perde tempo achando que é outro
 *     sistema.
 *
 *  2. EVENTO FANTASMA EM SAVED-SEARCH — o `log-search.md` alertava sobre
 *     `ai.provider.error`, um evento que NUNCA foi emitido. A busca retorna
 *     vazio para sempre, e busca vazia é indistinguível de "está tudo bem". Um
 *     alerta que não pode disparar é pior que alerta nenhum: dá falsa cobertura.
 *
 * Os dois casos têm a mesma causa: a doc afirma algo sobre o código sem nada
 * conferir. Este script confere.
 */
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const findings: string[] = [];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

// ─── 1. Crons: vercel.json é a FONTE DA VERDADE ──────────────────────────────

const vercel = JSON.parse(read('vercel.json')) as { crons?: Array<{ path: string }> };
const manifestPaths = new Set((vercel.crons ?? []).map((c) => c.path));

// O código também precisa bater: uma rota sem entrada no manifesto nunca roda.
const cronDir = join(ROOT, 'src/app/api/cron');
const routePaths = new Set(
  readdirSync(cronDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `/api/cron/${d.name}`),
);

for (const p of manifestPaths) {
  if (!routePaths.has(p)) findings.push(`vercel.json agenda "${p}", mas não existe route.ts para ela`);
}
for (const p of routePaths) {
  if (!manifestPaths.has(p)) findings.push(`existe route.ts para "${p}", mas o vercel.json NÃO a agenda (nunca roda)`);
}

// Docs que enumeram crons: o conjunto citado tem de ser subconjunto do real, e
// a contagem declarada em prosa tem de bater.
const CRON_DOCS = ['docs/c16/c16-inventory.md', 'docs/runbooks/production-readiness.md'];
for (const doc of CRON_DOCS) {
  const text = read(doc);
  const cited = new Set([...text.matchAll(/\/api\/cron\/([a-z-]+)/g)].map((m) => `/api/cron/${m[1]}`));
  for (const p of cited) {
    if (!manifestPaths.has(p)) findings.push(`${doc} cita "${p}", que não está no vercel.json`);
  }
  const missing = [...manifestPaths].filter((p) => !cited.has(p));
  if (cited.size > 0 && missing.length > 0) {
    findings.push(`${doc} enumera crons mas OMITE ${missing.length}: ${missing.join(', ')}`);
  }
  // Contagem em prosa ("os 6 crons", "13 jobs", "Crons (12)").
  for (const m of text.matchAll(/(?:os\s+)?(\d{1,2})\s+(?:crons|jobs)|[Cc]rons?\s*\((\d{1,2})\)/g)) {
    const n = Number(m[1] ?? m[2]);
    if (n !== manifestPaths.size) {
      findings.push(
        `${doc} afirma "${m[0].trim()}" mas o vercel.json tem ${manifestPaths.size} crons`,
      );
    }
  }
}

// ─── 2. Saved-searches: todo evento citado tem de ser emitido pelo código ────

function collectSource(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) collectSource(full, acc);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) acc.push(readFileSync(full, 'utf8'));
  }
  return acc;
}
const sources = collectSource(join(ROOT, 'src')).join('\n');

const logSearch = read('docs/runbooks/log-search.md');
const citedEvents = new Set(
  [...logSearch.matchAll(/message\.event:"([^"]+)"/g)].map((m) => m[1]!).filter((e) => !e.includes('*')),
);
for (const ev of citedEvents) {
  if (!sources.includes(`'${ev}'`) && !sources.includes(`"${ev}"`)) {
    findings.push(
      `log-search.md alerta sobre o evento "${ev}", que NENHUM código emite (busca vazia para sempre)`,
    );
  }
}

// ─── Resultado ───────────────────────────────────────────────────────────────

if (findings.length > 0) {
  console.error(`[check:observability] ${findings.length} divergência(s):\n`);
  for (const f of findings) console.error(`  ✗ ${f}`);
  console.error(
    '\nA doc operacional é lida DURANTE incidente. Corrija a doc (ou o código) antes de mergear.',
  );
  process.exit(1);
}
console.log(
  `[check:observability] OK — ${manifestPaths.size} crons coerentes (manifesto ⇔ rotas ⇔ docs), ${citedEvents.size} evento(s) de saved-search existem no código.`,
);
