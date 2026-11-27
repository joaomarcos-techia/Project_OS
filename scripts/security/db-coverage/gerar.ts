/**
 * Gera um teste do Vitest por harness de banco a partir dos DOIS workflows de provas (`convenios-synthetic-db*.yml`):
 * a fonte da lista é o que a CI já roda, com as variáveis da própria linha de comando (`PORT`, refs). Assim a
 * cobertura dos harnesses (`vitest.coverage-db.config.ts`) não diverge das provas.
 *
 *   npx tsx scripts/security/db-coverage/gerar.ts           # escreve
 *   npx tsx scripts/security/db-coverage/gerar.ts --check   # falha se algum teste gerado estiver desatualizado
 */
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { format, resolveConfig } from 'prettier';

const WORKFLOWS = [
  '.github/workflows/convenios-synthetic-db.yml',
  '.github/workflows/convenios-synthetic-db-legacy.yml',
];
const DIR = 'scripts/security/db-coverage';
/** Variáveis do passo que não viram ambiente do teste: o binário do Postgres vem do job, e as condições do
 * `NODE_OPTIONS` (react-server) o Vitest já resolve com o alias de `server-only`. */
const SKIP_ENV = new Set(['SECURITY_PG_BIN', 'NODE_OPTIONS']);

type Step = { file: string; env: Record<string, string> };

function steps(): Step[] {
  const found: Step[] = [];
  for (const wf of WORKFLOWS) {
    const text = readFileSync(wf, 'utf8').replace(/\\\r?\n\s*/g, ' ');
    for (const m of text.matchAll(
      /^\s*(.*?)pnpm exec tsx (scripts\/security\/[\w.-]+-db\.ts)\s*$/gm,
    )) {
      const env: Record<string, string> = {};
      for (const a of m[1]!.matchAll(/([A-Z][A-Z0-9_]+)=("[^"]*"|'[^']*'|\S+)/g)) {
        if (!SKIP_ENV.has(a[1]!)) env[a[1]!] = a[2]!.replace(/^["']|["']$/g, '');
      }
      found.push({ file: m[2]!, env });
    }
  }
  return found;
}

async function render(step: Step): Promise<{ name: string; body: string }> {
  const base = path.basename(step.file, '.ts');
  const body = `// Gerado por scripts/security/db-coverage/gerar.ts a partir dos workflows de provas de banco — não editar.
import { test } from 'vitest';

import { runHarness } from './run-harness';

test.skipIf(!process.env.SECURITY_PG_BIN)(
  '${base}',
  () => runHarness(() => import('../${base}'), ${JSON.stringify(step.env)}),
  20 * 60_000,
);
`;
  const name = `${base}.db.test.ts`;
  const filepath = path.join(DIR, name);
  return { name, body: await format(body, { ...(await resolveConfig(filepath)), filepath }) };
}

const check = process.argv.includes('--check');
const wanted = new Map((await Promise.all(steps().map(render))).map((r) => [r.name, r.body]));
const existing = readdirSync(DIR).filter((f) => f.endsWith('.db.test.ts'));
const problems: string[] = [];
for (const [name, body] of wanted) {
  const file = path.join(DIR, name);
  let current: string | null = null;
  try {
    current = readFileSync(file, 'utf8');
  } catch {
    current = null;
  }
  if (current === body) continue;
  if (check) problems.push(current === null ? `falta ${name}` : `desatualizado ${name}`);
  else writeFileSync(file, body);
}
for (const name of existing.filter((f) => !wanted.has(f))) {
  if (check) problems.push(`sobra ${name}`);
  else unlinkSync(path.join(DIR, name));
}
if (problems.length > 0) {
  console.error(
    `[db-coverage] ${problems.length} divergência(s) com os workflows:\n  ${problems.join('\n  ')}`,
  );
  process.exit(1);
}
console.log(`[db-coverage] ${wanted.size} harnesses ${check ? 'conferidos' : 'gerados'}`);
