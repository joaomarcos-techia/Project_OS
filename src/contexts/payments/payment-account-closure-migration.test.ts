import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0115_payment_account_closure.sql'),
  'utf8',
);
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> };

describe('0115 — encerramento da conta Asaas pausada', () => {
  it('acrescenta só a data do aviso, anulável e sem default', () => {
    expect(migration).toContain(
      'ALTER TABLE public.clinic_payment_accounts\n  ADD COLUMN IF NOT EXISTS closure_notice_sent_at timestamptz;',
    );
    expect(migration).not.toMatch(/NOT NULL|DEFAULT/u);
  });

  it('não concede a coluna a authenticated: só o seam privilegiado a lê', () => {
    expect(migration).not.toMatch(/^GRANT/mu);
  });

  it('registra o marcador e entra no journal depois da 0114', () => {
    expect(migration).toContain("VALUES ('0115-payment-account-closure')");
    const previous = journal.entries.find((entry) => entry.idx === 114);
    const entry = journal.entries.find((candidate) => candidate.idx === 115);
    expect(entry?.tag).toBe('0115_payment_account_closure');
    expect(entry && previous && entry.when > previous.when).toBe(true);
  });
});
