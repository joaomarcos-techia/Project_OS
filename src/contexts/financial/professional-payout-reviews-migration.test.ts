import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0113_professional_payout_reviews.sql'),
  'utf8',
);
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> };

const createTable = migration.slice(
  migration.indexOf('CREATE TABLE IF NOT EXISTS public.professional_payout_reviews'),
  migration.indexOf('CREATE INDEX IF NOT EXISTS professional_payout_reviews_clinic_payout_idx'),
);

describe('0113 — revisão humana do repasse em versões imutáveis', () => {
  it('aceita o status reviewed somente com base, valor e instante da decisão', () => {
    expect(migration).toContain('DROP CONSTRAINT professional_payouts_status_chk');
    expect(migration).toMatch(
      /OR \(status = 'reviewed' AND basis_amount IS NOT NULL\s+AND payout_amount IS NOT NULL AND calculated_at IS NOT NULL\)/u,
    );
    expect(migration).toContain("OR status = 'cancelled'");
  });

  it('limita o valor decidido ao teto e exige motivo', () => {
    expect(createTable).toContain('decided_amount >= 0 AND decided_amount <= ceiling_amount');
    expect(createTable).toContain(
      'reference_amount IS NULL OR (reference_amount >= 0 AND reference_amount <= ceiling_amount)',
    );
    expect(createTable).toContain('char_length(btrim(reason)) BETWEEN 3 AND 500');
    expect(createTable).toContain('UNIQUE (payout_id, version)');
    expect(createTable).toContain('CHECK (version >= 1)');
    expect(createTable).toContain('reversal_refunded_amount numeric(12,2) NOT NULL');
    expect(createTable).toContain('reversal_loss boolean NOT NULL');
    expect(createTable).not.toMatch(/decided_by uuid[^,]*REFERENCES/u);
  });

  it('é append-only: sem UPDATE/DELETE para authenticated e UPDATE bloqueado por trigger', () => {
    expect(migration).toContain(
      'REVOKE ALL ON public.professional_payout_reviews FROM anon, authenticated;',
    );
    expect(migration).toContain(
      'GRANT SELECT, INSERT ON public.professional_payout_reviews TO authenticated;',
    );
    expect(migration).not.toMatch(
      /GRANT[^;]*(UPDATE|DELETE)[^;]*professional_payout_reviews TO authenticated/u,
    );
    expect(migration).not.toMatch(
      /CREATE POLICY [^\n]* ON public\.professional_payout_reviews\s+FOR (UPDATE|DELETE)/u,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER professional_payout_reviews_immutable\s+BEFORE UPDATE ON public\.professional_payout_reviews/u,
    );
  });

  it('isola o tenant por RLS forçada e confere a clínica do repasse', () => {
    expect(migration).toContain(
      'ALTER TABLE public.professional_payout_reviews ENABLE ROW LEVEL SECURITY;',
    );
    expect(migration).toContain(
      'ALTER TABLE public.professional_payout_reviews FORCE ROW LEVEL SECURITY;',
    );
    expect(migration).toContain(
      "clinic_id::text = (select current_setting('app.current_clinic', true))",
    );
    expect(migration).toContain('WHERE p.id = NEW.payout_id AND p.clinic_id = NEW.clinic_id');
    expect(migration).toMatch(
      /CREATE TRIGGER professional_payout_reviews_validate\s+BEFORE INSERT ON public\.professional_payout_reviews/u,
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.validate_professional_payout_review() FROM PUBLIC, anon, authenticated;',
    );
  });

  it('está no journal depois da 0112 e grava o marcador', () => {
    const entry = journal.entries.find((item) => item.tag === '0113_professional_payout_reviews');
    const previous = journal.entries.find(
      (item) => item.tag === '0112_payment_account_pause_default',
    );
    expect(entry).toBeDefined();
    expect(previous).toBeDefined();
    expect(entry!.idx).toBe(previous!.idx + 1);
    expect(entry!.when).toBeGreaterThan(previous!.when);
    expect(migration).toContain("VALUES ('0113-professional-payout-reviews')");
  });
});
