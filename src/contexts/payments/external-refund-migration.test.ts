import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * R54 (0160): evidência do estorno feito direto no Asaas. Prova estática do contrato da
 * migration; o comportamento (webhook real, livro, worker, concorrência, RLS) está em
 * `scripts/security/payments-external-refund-db.ts`.
 */
const read = (f: string): string =>
  readFileSync(resolve(process.cwd(), 'drizzle/migrations', f), 'utf8');
const m = read('0160_patient_external_refunds.sql');
const journal = JSON.parse(read('meta/_journal.json')) as {
  entries: Array<{ idx: number; when: number; tag: string }>;
};
const code = m.replace(/^\s*--(?!>).*\n/gmu, '');
/** `when` da 0159 do #53 aplicada no DEV (release-manifest do #53). */
const DEV_0159_WHEN = 1795036973858;

describe('migration 0160 — estorno externo do Asaas (R54)', () => {
  it('journal: idx 160 depois da 0158, 0159 reservada ao #53, `when` acima do aplicado no DEV', () => {
    const i = journal.entries.findIndex((e) => e.tag === '0160_patient_external_refunds');
    const [prev, cur] = [journal.entries[i - 1]!, journal.entries[i]!];
    expect([prev.tag, cur.idx]).toEqual(['0158_hi_copay_charge', 160]);
    expect(journal.entries.some((e) => e.idx === 159)).toBe(false);
    expect(cur.when).toBeGreaterThan(DEV_0159_WHEN);
  });

  it('acrescenta o tipo de ajuste, o cursor da varredura e a tabela de evidência', () => {
    expect(code).toMatch(
      /ALTER TYPE public\.patient_credit_adjustment_kind ADD VALUE IF NOT EXISTS 'external_refund'/u,
    );
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS refund_checked_at timestamptz/u);
    expect(code).toMatch(/CREATE INDEX IF NOT EXISTS patient_charges_refund_check_idx/u);
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.patient_external_refunds/u);
  });

  it('idempotência pelo patamar acumulado e valores coerentes no banco', () => {
    expect(code).toMatch(
      /patient_external_refunds_level_uniq UNIQUE \(clinic_id, patient_charge_id, external_total\)/u,
    );
    expect(code).toMatch(/CHECK \(amount > 0 AND external_total >= amount\)/u);
    expect(code).toMatch(/provider_refunded_total >= external_total/u);
    expect(code).toMatch(/source IN \('webhook', 'reconcile'\)/u);
  });

  it('RLS forçada por clínica e runtime só com SELECT/INSERT (sem UPDATE/DELETE)', () => {
    expect(code).toMatch(/ALTER TABLE public\.patient_external_refunds ENABLE ROW LEVEL SECURITY/u);
    expect(code).toMatch(/ALTER TABLE public\.patient_external_refunds FORCE ROW LEVEL SECURITY/u);
    expect(code).toMatch(
      /REVOKE ALL ON public\.patient_external_refunds FROM anon, authenticated/u,
    );
    expect(code).toMatch(
      /GRANT SELECT, INSERT ON public\.patient_external_refunds TO authenticated/u,
    );
    expect(code).not.toMatch(
      /GRANT[^;]*(UPDATE|DELETE)[^;]*patient_external_refunds[^;]*authenticated/u,
    );
    expect(code).not.toMatch(/DISABLE ROW LEVEL SECURITY/u);
    expect(code).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE FROM\b(?! public\._schema_version)/u);
  });

  it('registra a versão', () => {
    expect(code).toMatch(/'0160-patient-external-refunds'/u);
  });
});
