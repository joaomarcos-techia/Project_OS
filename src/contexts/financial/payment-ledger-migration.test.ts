import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0057_financial_payment_ledger.sql'),
  'utf8',
);
const actions = readFileSync(resolve(process.cwd(), 'src/contexts/financial/actions.ts'), 'utf8');
const queries = readFileSync(resolve(process.cwd(), 'src/contexts/financial/queries.ts'), 'utf8');
const rollup = readFileSync(
  resolve(process.cwd(), 'src/app/api/cron/cash-flow-rollup/route.ts'),
  'utf8',
);

describe('financial payment ledger integration', () => {
  it('cria ledger append-only, tenant-scoped e liga comprovante a transacao', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS payment_transactions');
    expect(migration).toContain('ALTER TABLE payment_transactions FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('GRANT SELECT, INSERT ON payment_transactions TO authenticated');
    expect(migration).toContain('payment_proofs_transaction_id_payment_transactions_id_fk');
    expect(migration).toContain('trg_payment_transactions_validate_insert');
    expect(migration).toContain('refund exceeds original payment available amount');
  });

  it('protege reembolso com permissao granular e registra ledger antes do evento', () => {
    expect(actions).toContain('requireCachedPermission(PERMISSIONS.REFUND_FINANCIAL)');
    expect(actions).toContain("kind: 'payment'");
    expect(actions).toContain("kind: 'refund'");
    expect(actions).toContain('originalPaymentId: payment.id');
    expect(actions.indexOf('.insert(paymentTransactions)')).toBeLessThan(
      actions.indexOf('eventType: FINANCIAL_EVENTS.LANCAMENTO_PAID'),
    );
  });

  it('migra apenas saldos pagos conhecidos sem inventar reembolso legado', () => {
    expect(migration).toContain("WHERE status IN ('parcial', 'pago')");
    expect(migration).not.toMatch(/INSERT INTO payment_transactions[\s\S]*?'refund'::payment_transaction_kind/);
  });

  it('calcula caixa e consolidacao pela data de cada movimentacao', () => {
    expect(queries).toContain('.from(paymentTransactions)');
    expect(queries).toContain('gte(paymentTransactions.occurredAt, todayFrom)');
    expect(rollup).toContain('FROM payment_transactions pt');
    expect(rollup).toContain("l.tipo = 'receber' and pt.kind = 'refund'");
  });
});
