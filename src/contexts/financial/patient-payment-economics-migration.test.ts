import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0108_patient_payment_economics.sql'),
  'utf8',
);

function triggerFunction(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}()`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf('$$;', start);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe('0108 — integridade dos snapshots comerciais e repasses', () => {
  it('preserva os campos comerciais do atendimento e valida a versão de preço', () => {
    const immutable = triggerFunction('block_appointment_commercial_snapshot_rewrite');
    for (const column of [
      'pricing_policy_mode',
      'commercial_payment_method',
      'commercial_installment_count',
      'commercial_price_id',
    ]) {
      expect(immutable).toContain(`NEW.${column} IS DISTINCT FROM OLD.${column}`);
    }
    expect(migration).toContain('BEFORE UPDATE ON public.appointments');

    const price = triggerFunction('validate_appointment_commercial_price_snapshot');
    for (const condition of [
      'price.id = NEW.commercial_price_id',
      'price.clinic_id = NEW.clinic_id',
      'price.procedure_id = NEW.procedure_id',
      'price.payment_method = NEW.commercial_payment_method',
      'price.installment_count IS NOT DISTINCT FROM NEW.commercial_installment_count',
      'price.gross_amount = NEW.valor',
      'price.active = true',
      'price.effective_from <= now()',
      "policy.mode = 'payment_method_pricing'",
      "plan.code IN ('clinica', 'pro')",
      'previous.id = NEW.rescheduled_from_appointment_id',
      'previous.clinic_id = NEW.clinic_id',
      'previous.valor = NEW.valor',
      'previous.commercial_price_id = NEW.commercial_price_id',
    ]) {
      expect(price).toContain(condition);
    }
  });

  it('confere a clínica em todas as referências do repasse', () => {
    const references = triggerFunction('validate_professional_payout_references');
    for (const condition of [
      'a.id = NEW.appointment_id AND a.clinic_id = NEW.clinic_id',
      'a.doctor_id = NEW.professional_id AND a.procedure_id = NEW.procedure_id',
      'p.id = NEW.professional_id AND p.clinic_id = NEW.clinic_id',
      'pr.id = NEW.procedure_id AND pr.clinic_id = NEW.clinic_id',
      'v.id = NEW.policy_version_id AND v.clinic_id = NEW.clinic_id',
      'r.id = NEW.rule_id AND r.clinic_id = NEW.clinic_id',
    ]) {
      expect(references).toContain(condition);
    }
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF clinic_id, appointment_id');
  });

  it('mantém as tabelas novas sob RLS forçada e registra a migração', () => {
    for (const table of [
      'clinic_financial_policies',
      'clinic_financial_policy_versions',
      'professional_payout_rules',
      'professional_payouts',
      'clinic_payment_pricing_policies',
      'procedure_payment_prices',
    ]) {
      expect(migration).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);
    }
    const journal = JSON.parse(
      readFileSync(resolve(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries?: Array<{ tag?: string }> };
    expect(journal.entries?.some((entry) => entry.tag === '0108_patient_payment_economics')).toBe(
      true,
    );
  });
});
