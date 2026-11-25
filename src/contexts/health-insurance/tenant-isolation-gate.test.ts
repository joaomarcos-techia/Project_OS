/**
 * P12.1 — isolamento de TODAS as tabelas do módulo (gate estático, roda no CI).
 *
 * Varre as migrations e exige, para cada tabela `public.hi_*` (e a evidência de estorno externo
 * do R54, `patient_external_refunds`):
 *  - `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY`;
 *  - pelo menos uma política;
 *  - toda política referencia `clinic_id` e o predicado da clínica da sessão
 *    (`app.current_clinic` ou `current_clinic_id()`), em USING e, quando houver, em WITH CHECK.
 * A prova pelo catálogo real (a cadeia inteira aplicada, `pg_class`/`pg_policies` e privilégios
 * de `anon`/`authenticated`) está em scripts/security/health-insurance-tenant-isolation-db.ts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'drizzle/migrations');
const sql = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(DIR, f), 'utf8').replace(/--.*$/gmu, ''))
  .join('\n');

const tables = [
  ...new Set(
    [
      ...sql.matchAll(
        /CREATE TABLE (?:IF NOT EXISTS )?public\.(hi_[a-z0-9_]+|patient_external_refunds)\b/gu,
      ),
    ].map((m) => m[1]!),
  ),
].sort();

/** Corpo de cada CREATE POLICY ... ON public.<t> ...; (até o ponto e vírgula do comando). */
function policiesOf(table: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`CREATE POLICY [a-z0-9_"]+ ON public\\.${table}\\b[\\s\\S]*?;`, 'gu');
  for (const m of sql.matchAll(re)) out.push(m[0]);
  return out;
}

const TENANT = /current_setting\('app\.current_clinic'|current_clinic_id\(\)/u;

describe('P12.1 — isolamento por clínica de todas as tabelas do módulo', () => {
  it('encontra as tabelas do módulo (sanidade da varredura)', () => {
    expect(tables.length).toBeGreaterThanOrEqual(40);
    expect(tables).toContain('hi_guides');
    expect(tables).toContain('patient_external_refunds');
  });

  it('toda tabela tem RLS habilitada E forçada', () => {
    const missing = tables.filter(
      (t) =>
        !new RegExp(
          `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?public\\.${t}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'u',
        ).test(sql) ||
        !new RegExp(
          `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?public\\.${t}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'u',
        ).test(sql),
    );
    expect(missing).toEqual([]);
  });

  it('toda tabela tem política, e toda política filtra pela clínica da sessão', () => {
    const problems: string[] = [];
    for (const t of tables) {
      const ps = policiesOf(t);
      if (ps.length === 0) problems.push(`${t}: sem política`);
      for (const p of ps) {
        const name = /CREATE POLICY ([a-z0-9_"]+)/u.exec(p)![1];
        if (!/clinic_id/u.test(p) || !TENANT.test(p))
          problems.push(`${t}.${name}: sem predicado da clínica`);
        const check = /WITH CHECK\s*\(([\s\S]*)\)\s*;$/u.exec(p)?.[1];
        if (check !== undefined && !TENANT.test(check)) {
          problems.push(`${t}.${name}: WITH CHECK sem predicado da clínica`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
