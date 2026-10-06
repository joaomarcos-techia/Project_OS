import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0109_patient_payment_reconcile_guard.sql'),
  'utf8',
);

const functionStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.validate_appointment_commercial_price_snapshot()',
);
const functionEnd = migration.indexOf('$$;', functionStart);
const guard = migration.slice(functionStart, functionEnd);

describe('0109 — integridade comercial e varredura de pagamentos', () => {
  it('recusa absorb_fees em criacao nova sob politica efetiva e preserva remarcacao exata', () => {
    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(functionEnd).toBeGreaterThan(functionStart);

    const reschedule = guard.slice(
      guard.indexOf('SELECT EXISTS ('),
      guard.indexOf('INTO exact_reschedule;'),
    );
    for (const condition of [
      'previous.id = NEW.rescheduled_from_appointment_id',
      'previous.clinic_id = NEW.clinic_id',
      'previous.patient_id IS NOT DISTINCT FROM NEW.patient_id',
      'previous.doctor_id = NEW.doctor_id',
      'previous.procedure_id = NEW.procedure_id',
      "previous.status = 'cancelado'",
      'previous.valor = NEW.valor',
      'previous.pricing_policy_mode = NEW.pricing_policy_mode',
      'previous.commercial_payment_method IS NOT DISTINCT FROM NEW.commercial_payment_method',
      'previous.commercial_installment_count IS NOT DISTINCT FROM NEW.commercial_installment_count',
      'previous.commercial_price_id IS NOT DISTINCT FROM NEW.commercial_price_id',
    ]) {
      expect(reschedule).toContain(condition);
    }
    expect(guard).toMatch(
      /IF TG_OP = 'INSERT' AND NEW\.rescheduled_from_appointment_id IS NOT NULL THEN\s+SELECT EXISTS \(/u,
    );

    const absorbGuard = guard.match(
      /IF TG_OP = 'INSERT'\s+AND NEW\.pricing_policy_mode = 'absorb_fees'[\s\S]*?RAISE EXCEPTION 'Politica comercial ativa exige preco por meio de pagamento\.';/u,
    )?.[0];
    expect(absorbGuard).toBeDefined();
    expect(absorbGuard).toContain('AND NOT exact_reschedule');
    expect(absorbGuard).toContain('policy.clinic_id = NEW.clinic_id');
    expect(absorbGuard).toContain("policy.mode = 'payment_method_pricing'");
    expect(absorbGuard).toContain("plan.code IN ('clinica', 'pro')");

    const methodGuard = guard.slice(
      guard.indexOf("IF NEW.pricing_policy_mode = 'payment_method_pricing'"),
    );
    expect(methodGuard).toContain('price.id = NEW.commercial_price_id');
    expect(methodGuard).toContain('price.gross_amount = NEW.valor');
    expect(methodGuard).toContain('price.active = true');
    expect(methodGuard).toContain('price.effective_from <= now()');
    expect(methodGuard).toContain('OR exact_reschedule');
  });

  it('adiciona a data de releitura e indices parciais nas ordens dos scans', () => {
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS provider_reconcile_checked_at timestamptz',
    );
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS patient_charges_pending_economics_scan_idx\s+ON public\.patient_charges \(\s+provider_reconcile_checked_at ASC NULLS FIRST,\s+paid_at ASC NULLS FIRST,\s+id ASC\s+\)\s+WHERE status = 'paid'\s+AND provider_payment_id IS NOT NULL\s+AND economics_reconciled_at IS NULL;/u,
    );
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS patient_charges_pending_mismatch_scan_idx\s+ON public\.patient_charges \(\s+provider_reconcile_checked_at ASC NULLS FIRST,\s+updated_at ASC,\s+id ASC\s+\)\s+WHERE status = 'pending'\s+AND provider_payment_id IS NOT NULL\s+AND failure_code IN \(\s+'payment_method_mismatch',\s+'payment_installment_mismatch',\s+'payment_amount_mismatch'\s+\);/u,
    );
  });

  it('registra a migration depois de 0108 no journal', () => {
    const journal = JSON.parse(
      readFileSync(resolve(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string; when: number }> };
    const economicsIndex = journal.entries.findIndex(
      (entry) => entry.tag === '0108_patient_payment_economics',
    );
    expect(economicsIndex).toBeGreaterThanOrEqual(0);
    expect(journal.entries[economicsIndex + 1]).toMatchObject({
      idx: 109,
      tag: '0109_patient_payment_reconcile_guard',
    });
    expect(journal.entries[economicsIndex + 1]!.when).toBeGreaterThan(
      journal.entries[economicsIndex]!.when,
    );
  });
});
