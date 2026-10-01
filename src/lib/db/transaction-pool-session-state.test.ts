import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOTS = ['src', 'scripts', 'drizzle/migrations'] as const;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.sql']);
const FORBIDDEN_SESSION_READ_ONLY = [
  /set\s+default_transaction_read_only\s*=\s*(?:on|true|1)/iu,
  /set\s+session\s+characteristics\s+as\s+transaction\s+read\s+only/iu,
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) return [];
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)) return [];
    return [path];
  });
}

describe('estado de sessão no Supavisor transaction pooler', () => {
  it('não permite comandos read-only persistentes em código executável', () => {
    const violations = ROOTS.flatMap((root) =>
      sourceFiles(root).flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return FORBIDDEN_SESSION_READ_ONLY.some((pattern) => pattern.test(source))
          ? [relative(process.cwd(), file)]
          : [];
      }),
    );

    // `BEGIN READ ONLY` é seguro porque termina com a transação. Os comandos
    // recusados acima persistem no backend compartilhado e contaminam o próximo
    // cliente do transaction pooler, que passa a falhar em qualquer INSERT/UPDATE.
    expect(violations).toEqual([]);
  });
});
