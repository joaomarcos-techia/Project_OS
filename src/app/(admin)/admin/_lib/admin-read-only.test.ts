import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Arch test (C15, OR-A3 / review #11): o painel `/admin/**` é READ-ONLY sobre
 * dados de clínica. Nenhuma mutação tenant pode nascer aqui — toda alteração de
 * dados de clínica ocorre via impersonate (no app tenant). Portanto NENHUM
 * arquivo sob src/app/(admin)/** pode importar os funis de mutação tenant nem o
 * setter de contexto RLS:
 *   - @/lib/db/tenant        (withTenant — sole RLS-write entry)
 *   - @/lib/audit/mutation   (auditedMutation)
 *   - @/lib/idempotency/mutation (idempotentMutation)
 *
 * As únicas escritas do painel (impersonate + audit_export) são platform-level
 * (super_admin_actions / impersonation_sessions via superAdminAction/dbAdmin) —
 * NÃO mutações de dados de clínica — e por isso não passam por esses funis.
 */
const ADMIN_DIR = resolve(process.cwd(), 'src/app/(admin)');
const FORBIDDEN = [
  '@/lib/db/tenant',
  '@/lib/audit/mutation',
  '@/lib/idempotency/mutation',
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (['.ts', '.tsx'].includes(extname(e.name)) && !e.name.endsWith('.test.ts'))
      out.push(full);
  }
  return out;
}

describe('Platform Admin é read-only sobre dados de clínica (C15)', () => {
  const files = walk(ADMIN_DIR);

  it('o scan encontra arquivos do painel (não é vácuo)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const spec of FORBIDDEN) {
    it(`nenhum arquivo de (admin) importa ${spec}`, () => {
      const offenders = files.filter((f) => {
        const text = readFileSync(f, 'utf8');
        return new RegExp(`from\\s+['"]${spec.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&')}['"]`).test(text);
      });
      expect(
        offenders,
        `Mutação tenant proibida no painel. Ofensores:\n${offenders
          .map((f) => relative(process.cwd(), f).split(sep).join('/'))
          .join('\n')}`,
      ).toEqual([]);
    });
  }
});
