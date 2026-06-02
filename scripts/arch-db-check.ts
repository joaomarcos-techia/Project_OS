/**
 * `pnpm arch:db-check`
 *
 * Structural guard mirroring the ESLint rules AND a FAIL-CLOSED allowlist for DB
 * connection origins (F-01): the multi-tenant boundary is enforced by tooling,
 * not convention.
 *
 * F-01 — connection-origin allowlist (default-deny). The runtime `db` pool
 * connects with a BYPASSRLS role; `withTenant` (SET LOCAL ROLE authenticated) is
 * the principal isolation defense, NOT FORCE RLS (which does not stop BYPASSRLS —
 * ADR-007). Any path reaching a connection origin OUTSIDE the explicit allowlist
 * is a latent cross-tenant bypass.
 *
 * Detection is AST-based (src/lib/db/connection-origin-guard.ts) and covers
 * import / dynamic import() / require() / re-export (`export { db } from`,
 * `export *`), with re-export chains tracked transitively to a fixed point.
 *
 * Origins + per-file allowlists:
 *   - bare `postgres`                        → src/lib/db/index.ts, scripts/db-migrate-prod.ts
 *   - `drizzle` from drizzle-orm/postgres-js  → src/lib/db/index.ts
 *   - `db`      (named export of @/lib/db)    → src/lib/db/tenant.ts (withTenant)
 *   - `dbAdmin` (named export of @/lib/db)    → ALLOWED_DB_VALUE_IMPORTS.dbAdmin
 *   - `dbWorker`(named export of @/lib/db)    → ALLOWED_DB_VALUE_IMPORTS.dbWorker
 *   - namespace import / dynamic / require of an origin → only src/lib/db/index.ts
 *   - any re-export of a pool name/origin     → forbidden everywhere except origin
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep, posix } from 'node:path';

import { findOriginUsages, type Classify, type SpecifierClass } from '@/lib/db/connection-origin-guard';

const REPO_ROOT = process.cwd();
const DB_ORIGIN = 'src/lib/db/index.ts';

const ALLOWED_POSTGRES_IMPORTS = new Set(['src/lib/db/index.ts', 'scripts/db-migrate-prod.ts']);
const ALLOWED_DRIZZLE_PG_IMPORTS = new Set(['src/lib/db/index.ts']);
const ALLOWED_DB_VALUE_IMPORTS: Record<string, Set<string>> = {
  db: new Set(['src/lib/db/tenant.ts']),
  dbAdmin: new Set([
    'src/lib/audit/super-admin.ts',
    'src/lib/auth/tenant-context.ts',
    'src/lib/idempotency/cleanup.ts',
    'src/app/api/cron/patient-hard-delete/route.ts',
    'src/app/api/cron/audit-partitions/route.ts',
    'src/app/api/health/outbox/route.ts',
    'src/app/api/health/auth-hook/route.ts',
  ]),
  dbWorker: new Set([
    'src/lib/outbox/worker.ts',
    'src/lib/outbox/janitor.ts',
    'src/lib/outbox/circuit.ts',
  ]),
};

const ALLOWED_RESTRICTED_DISABLES = new Set(['src/app/api/health/auth-hook/route.ts']);
const SELF_RELATIVE = 'scripts/arch-db-check.ts';
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'drizzle', 'migrations');
const MIGRATION_NAME_RE = /^\d{4}_[a-z][a-z0-9_]*\.sql$/;

interface Finding {
  file: string;
  line: number;
  pattern: string;
  excerpt: string;
}
const findings: Finding[] = [];

function walk(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
      out.push(...walk(full, extensions));
    } else if (extensions.includes(extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = [
  ...walk(resolve(REPO_ROOT, 'src'), ['.ts', '.tsx']),
  ...walk(resolve(REPO_ROOT, 'scripts'), ['.ts']),
];
const relOf = (file: string) => relative(REPO_ROOT, file).split(sep).join('/');
const relSet = new Set(sourceFiles.map(relOf));
const textCache = new Map<string, string>();
const textOf = (rel: string): string => {
  let t = textCache.get(rel);
  if (t === undefined) {
    t = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    textCache.set(rel, t);
  }
  return t;
};

/** Resolve a specifier to a repo-relative .ts path, or `{ bare }`. */
function resolveSpecifier(fromRel: string, spec: string): { rel?: string; bare?: string } {
  let base: string;
  if (spec.startsWith('@/')) base = posix.join('src', spec.slice(2));
  else if (spec.startsWith('.')) base = posix.join(posix.dirname(fromRel), spec);
  else return { bare: spec };
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  for (const c of candidates) if (relSet.has(c)) return { rel: c };
  return { rel: base.endsWith('.ts') || base.endsWith('.tsx') ? base : `${base}/index.ts` };
}

// classify factory: poolOrigin = the origin module OR a tainted re-exporter.
const makeClassify = (fromRel: string, tainted: ReadonlySet<string>): Classify => (spec: string): SpecifierClass => {
  const t = resolveSpecifier(fromRel, spec);
  return {
    postgresDriver: t.bare === 'postgres',
    drizzlePgFactory: t.bare === 'drizzle-orm/postgres-js',
    poolOrigin: t.rel === DB_ORIGIN || (t.rel ? tainted.has(t.rel) : false),
  };
};

// ---- Pass 1: transitive taint set (modules that re-export a pool/origin) ----
const tainted = new Set<string>();
for (let changed = true, guard = 0; changed && guard < 10; guard++) {
  changed = false;
  for (const rel of relSet) {
    if (rel === SELF_RELATIVE || rel === DB_ORIGIN || tainted.has(rel)) continue;
    const usages = findOriginUsages(textOf(rel), rel, makeClassify(rel, tainted));
    if (usages.some((u) => u.kind === 'pool-reexport')) {
      tainted.add(rel);
      changed = true;
    }
  }
}

// Operator tooling + admin surface may hold the admin/worker pools (mirrors the
// original ESLint allowlist: scripts/, src/app/(admin)/, src/app/api/admin/).
// The bare `postgres` driver + `drizzle` factory stay strict (only index.ts +
// db-migrate-prod) — there is exactly ONE pool factory.
const isOperatorOrAdmin = (rel: string): boolean =>
  rel.startsWith('scripts/') ||
  rel.startsWith('src/app/(admin)/') ||
  rel.startsWith('src/app/api/admin/');
const poolHolderAllowed = (rel: string, name?: string): boolean => {
  if (isOperatorOrAdmin(rel)) return true;
  const allow = name ? ALLOWED_DB_VALUE_IMPORTS[name] : undefined;
  return !!allow && allow.has(rel);
};
const originAccessAllowed = (rel: string): boolean => rel === DB_ORIGIN || isOperatorOrAdmin(rel);

// ---- Pass 2: apply the allowlist policy to every usage ----
for (const rel of relSet) {
  if (rel === SELF_RELATIVE) continue;
  const text = textOf(rel);
  const usages = findOriginUsages(text, rel, makeClassify(rel, tainted));
  for (const u of usages) {
    const deny = (pattern: string) => findings.push({ file: rel, line: u.line, pattern, excerpt: u.excerpt });
    switch (u.kind) {
      case 'postgres':
        if (!ALLOWED_POSTGRES_IMPORTS.has(rel)) deny('import postgres (driver)');
        break;
      case 'drizzle-pg':
        if (!ALLOWED_DRIZZLE_PG_IMPORTS.has(rel)) deny("import { drizzle } from 'drizzle-orm/postgres-js'");
        break;
      case 'pool-import':
        if (!poolHolderAllowed(rel, u.name)) deny(`import { ${u.name} } (connection origin)`);
        break;
      case 'pool-namespace':
        if (!originAccessAllowed(rel)) deny('namespace import of connection origin');
        break;
      case 'pool-reexport':
        if (!originAccessAllowed(rel)) deny('re-export of connection origin');
        break;
      case 'dynamic':
        if (!originAccessAllowed(rel)) deny('dynamic import() of connection origin');
        break;
      case 'require':
        if (!originAccessAllowed(rel) && !ALLOWED_POSTGRES_IMPORTS.has(rel)) deny('require() of connection origin');
        break;
    }
  }

  // line-based: new Pool( + suspicious eslint-disable of no-restricted-imports
  text.split(/\r?\n/).forEach((line, i) => {
    if (/\bnew\s+Pool\s*\(/.test(line)) {
      findings.push({ file: rel, line: i + 1, pattern: 'new Pool(', excerpt: line.trim() });
    }
    if (!ALLOWED_RESTRICTED_DISABLES.has(rel) && /eslint-disable.*no-restricted-imports/.test(line)) {
      findings.push({
        file: rel,
        line: i + 1,
        pattern: 'eslint-disable no-restricted-imports',
        excerpt: line.trim(),
      });
    }
  });
}

// ---- Migration filename convention ----
try {
  for (const entry of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.sql') && !MIGRATION_NAME_RE.test(entry.name)) {
      findings.push({
        file: `drizzle/migrations/${entry.name}`,
        line: 0,
        pattern: 'migration filename',
        excerpt: `expected ${MIGRATION_NAME_RE.source}, got "${entry.name}"`,
      });
    }
  }
} catch {
  // First run: directory may not exist yet.
}

if (findings.length > 0) {
  console.error('[arch:db-check] FAILED with', findings.length, 'finding(s):');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} — ${f.pattern}`);
    console.error(`    ${f.excerpt}`);
  }
  process.exit(1);
}

// Sanity: the canonical origin still imports postgres.
const CANONICAL = join('src', 'lib', 'db', 'index.ts');
try {
  const content = readFileSync(resolve(REPO_ROOT, CANONICAL), 'utf8');
  if (!/\bfrom\s+['"]postgres['"]/.test(content)) {
    console.error(`[arch:db-check] ${CANONICAL} does not import postgres. Did src/lib/db/index.ts move?`);
    process.exit(1);
  }
  statSync(resolve(REPO_ROOT, CANONICAL));
} catch {
  console.error(`[arch:db-check] missing required file: ${CANONICAL}`);
  process.exit(1);
}

console.log(
  `[arch:db-check] OK — scanned ${sourceFiles.length} files (${tainted.size} tainted re-export module(s)), 0 findings.`,
);
