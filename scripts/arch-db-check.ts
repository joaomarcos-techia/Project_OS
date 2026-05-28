/**
 * `pnpm arch:db-check`
 *
 * MINUSCULE structural guard against patterns ESLint can't fully catch.
 * NOT a lint parallel — only 4 patterns + migration filename validation.
 *
 * Add a pattern here only if it has burned us in production. Resist the urge
 * to grow this into a general-purpose linter.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

const REPO_ROOT = process.cwd();
// Files allowed to import the `postgres` driver directly:
// - src/lib/db/index.ts : the canonical pool factory used by the app
// - scripts/db-migrate-prod.ts : prod migrator needs a dedicated 1-shot
//   connection to acquire pg_advisory_lock against DATABASE_URL_PROD (not the
//   env-bound URL used by src/lib/db). Keeping this allowlist explicit ensures
//   adding a 3rd file requires updating this guard intentionally.
const ALLOWED_POSTGRES_IMPORTS = new Set([
  ['src', 'lib', 'db', 'index.ts'].join('/'),
  ['scripts', 'db-migrate-prod.ts'].join('/'),
]);
// This script itself defines pattern strings (e.g. "new Pool(") that would
// false-positive against its own grep. Exclude it from its own scan.
const SELF_RELATIVE = ['scripts', 'arch-db-check.ts'].join('/');
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

for (const file of sourceFiles) {
  const rel = relative(REPO_ROOT, file).split(sep).join('/');
  if (rel === SELF_RELATIVE) continue; // skip self — defines the pattern strings
  const allowed = ALLOWED_POSTGRES_IMPORTS.has(rel);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    // 1. Direct postgres driver import (outside allowlist).
    if (!allowed && /\bfrom\s+['"]postgres['"]/.test(line)) {
      findings.push({ file: rel, line: i + 1, pattern: 'import postgres', excerpt: line.trim() });
    }
    // 2. node-postgres `new Pool(` — we don't use `pg`, and adding it later
    //    would create a second pool. Block early.
    if (/\bnew\s+Pool\s*\(/.test(line)) {
      findings.push({ file: rel, line: i + 1, pattern: 'new Pool(', excerpt: line.trim() });
    }
    // 3. CJS-style require of postgres.
    if (/require\(\s*['"]postgres['"]\s*\)/.test(line)) {
      findings.push({ file: rel, line: i + 1, pattern: "require('postgres')", excerpt: line.trim() });
    }
    // 4. Suspicious lint disables of the no-restricted-imports rule.
    if (/eslint-disable.*no-restricted-imports/.test(line)) {
      findings.push({
        file: rel,
        line: i + 1,
        pattern: 'eslint-disable no-restricted-imports',
        excerpt: line.trim(),
      });
    }
  });
}

// 5. Migration filename convention.
try {
  for (const entry of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.sql')) {
      if (!MIGRATION_NAME_RE.test(entry.name)) {
        findings.push({
          file: `drizzle/migrations/${entry.name}`,
          line: 0,
          pattern: 'migration filename',
          excerpt: `expected ${MIGRATION_NAME_RE.source}, got "${entry.name}"`,
        });
      }
    }
  }
} catch {
  // First run: directory may not exist yet. Don't fail.
}

if (findings.length > 0) {
  console.error('[arch:db-check] FAILED with', findings.length, 'finding(s):');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} — ${f.pattern}`);
    console.error(`    ${f.excerpt}`);
  }
  process.exit(1);
}

// Sanity: confirm src/lib/db/index.ts still exists and imports postgres
// (catches accidental deletion / refactor away).
const CANONICAL = join('src', 'lib', 'db', 'index.ts');
try {
  const content = readFileSync(resolve(REPO_ROOT, CANONICAL), 'utf8');
  if (!/\bfrom\s+['"]postgres['"]/.test(content)) {
    console.error(
      `[arch:db-check] ${CANONICAL} does not import postgres. Did src/lib/db/index.ts move?`,
    );
    process.exit(1);
  }
  statSync(resolve(REPO_ROOT, CANONICAL));
} catch {
  console.error(`[arch:db-check] missing required file: ${CANONICAL}`);
  process.exit(1);
}

console.log(`[arch:db-check] OK — scanned ${sourceFiles.length} files, 0 findings.`);
