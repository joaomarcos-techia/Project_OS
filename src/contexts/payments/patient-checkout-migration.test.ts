import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const PATH = 'drizzle/migrations/0091_patient_checkout_generations.sql';
const migration = readFileSync(resolve(process.cwd(), PATH), 'utf8');
const MONEY_PATH = 'drizzle/migrations/0092_patient_money_adjustments.sql';
const moneyMigration = readFileSync(resolve(process.cwd(), MONEY_PATH), 'utf8');

describe('0091 — gerações de Checkout de paciente', () => {
  it('é aditiva e preserva a dívida única em patient_charges', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS patient_checkout_generations');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS provider_checkout_id text');
    expect(migration).toContain('UNIQUE (patient_charge_id, generation)');
    expect(migration).toContain('patient_checkout_generations_one_open_uniq');
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE)/i);
    expect(migration).not.toMatch(/TRUNCATE/i);
  });

  it('impõe identidade única para checkout e payment dentro da clínica', () => {
    expect(migration).toContain('patient_charges_provider_checkout_uniq');
    expect(migration).toContain('patient_charges_provider_payment_uniq');
    expect(migration).toContain('patient_checkout_generations_provider_checkout_uniq');
  });

  it('mantém RLS forçada e escrita tenant-scoped sem DELETE autenticado', () => {
    expect(migration).toContain(
      'ALTER TABLE public.patient_checkout_generations FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain(
      "clinic_id::text = (select current_setting('app.current_clinic', true))",
    );
    expect(migration).toContain(
      'GRANT SELECT, INSERT, UPDATE ON public.patient_checkout_generations TO authenticated',
    );
    expect(migration).not.toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_checkout_generations',
    );
  });

  it('está registrada no journal do Drizzle', () => {
    const journal = JSON.parse(
      readFileSync(resolve(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries?: Array<{ tag?: string }> };

    expect(journal.entries?.some(({ tag }) => tag === '0091_patient_checkout_generations')).toBe(
      true,
    );
  });
});

describe('0092 — estorno excedente e risco financeiro', () => {
  it('é aditiva, preserva fatos financeiros e não concede DELETE', () => {
    expect(moneyMigration).toContain('CREATE TABLE IF NOT EXISTS public.patient_refund_intents');
    expect(moneyMigration).toContain(
      'CREATE TABLE IF NOT EXISTS public.patient_credit_adjustments',
    );
    expect(moneyMigration).toContain('ADD COLUMN IF NOT EXISTS dispute_status');
    expect(moneyMigration).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE)/i);
    expect(moneyMigration).not.toMatch(/TRUNCATE/i);
    expect(moneyMigration).not.toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_refund_intents',
    );
    expect(moneyMigration).not.toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_credit_adjustments',
    );
  });

  it('impõe idempotência e lineage 1:1 sem backfill ambíguo', () => {
    expect(moneyMigration).toContain('patient_refund_intents_charge_purpose_uniq');
    expect(moneyMigration).toContain('patient_refund_intents_source_event_uniq');
    expect(moneyMigration).toContain('patient_credit_adjustments_source_event_uniq');
    expect(moneyMigration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS patient_credits_allocated_payment_transaction_idx',
    );
    expect(moneyMigration).toContain('candidates.credit_matches = 1');
    expect(moneyMigration).toContain('candidates.payment_matches = 1');
  });

  it('mantém RLS forçada nas duas tabelas novas', () => {
    expect(moneyMigration).toContain(
      'ALTER TABLE public.patient_refund_intents FORCE ROW LEVEL SECURITY',
    );
    expect(moneyMigration).toContain(
      'ALTER TABLE public.patient_credit_adjustments FORCE ROW LEVEL SECURITY',
    );
  });

  it('está registrada no journal do Drizzle', () => {
    const journal = JSON.parse(
      readFileSync(resolve(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries?: Array<{ tag?: string }> };
    expect(journal.entries?.some(({ tag }) => tag === '0092_patient_money_adjustments')).toBe(true);
  });
});
