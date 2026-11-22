import { beforeEach, describe, expect, it, vi } from 'vitest';

const { publishEvent, emit } = vi.hoisted(() => ({ publishEvent: vi.fn(), emit: vi.fn() }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));

import type { Tx } from '@/lib/db';

import { markInvoicePaid } from './subscriptions';
import { releaseTrialAfterVerifiedPaymentTx } from '@/lib/trial-access';
vi.mock('@/lib/trial-access', () => ({
  releaseTrialAfterVerifiedPaymentTx: vi.fn(async () => {}),
}));

/**
 * O caminho do webhook `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED` e do reconcile.
 *
 * O defeito: uma parcela que sobrava no Asaas depois do cancelamento era
 * cobrada, e o pagamento dela voltava o billing para `active` e liberava o
 * acesso — o cancelamento se desfazia sozinho. Esta suíte trava que pagamento
 * de assinatura CANCELADA registra o dinheiro e não reabre nada.
 */
function scriptedTx(subscription: Record<string, unknown>) {
  const ops: string[] = [];
  const inserts: Array<Record<string, unknown>> = [];
  const thenable = (result: unknown) => {
    const self: Record<string, unknown> = {};
    for (const key of ['from', 'innerJoin', 'where', 'limit', 'returning']) self[key] = () => self;
    self.set = (values: Record<string, unknown>) => {
      ops.push(`update:${Object.keys(values).join(',')}`);
      return self;
    };
    self.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(ok, err);
    return self;
  };
  const tx = {
    select: () => {
      ops.push('select');
      return thenable([subscription]);
    },
    update: () => thenable([]),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return thenable([]);
      },
    }),
    execute: async (query: unknown) => {
      ops.push('execute');
      return query;
    },
  };
  return { tx: tx as unknown as Tx, ops, inserts };
}

const invoice = {
  id: 'inv_sobra',
  clinicId: 'clinic_1',
  status: 'open',
  totalAmount: '149.00',
  dueDate: '2026-10-10',
  periodStart: null,
  periodEnd: null,
} as never;

const opts = { paymentMethod: 'CREDIT_CARD', providerPaymentId: 'pay_sobra', idemSuffix: 'evt_1' };

beforeEach(() => vi.clearAllMocks());

describe('markInvoicePaid numa assinatura cancelada', () => {
  it('registra o dinheiro, mas NÃO reativa nem reabre a clínica', async () => {
    const { tx, ops, inserts } = scriptedTx({
      billingStatus: 'cancelled',
      cancelAtPeriodEnd: true,
    });

    await markInvoicePaid(tx, 'clinic_1', invoice, opts);

    // A invoice é marcada paga (o dinheiro entrou de verdade)...
    expect(ops).toContain('update:status,paidAt,paymentMethod');
    // ...mas nada de ciclo novo, billing ativo ou `UPDATE clinics`.
    expect(ops.filter((op) => op.startsWith('update:'))).toEqual([
      'update:status,paidAt,paymentMethod',
    ]);
    expect(ops).not.toContain('execute');
    expect(releaseTrialAfterVerifiedPaymentTx).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'billing.subscription.activated' }),
    );
    // E o caso sai daqui como evento, para estorno humano.
    expect(inserts).toContainEqual(
      expect.objectContaining({ type: 'invoice.paid_after_cancellation' }),
    );
    expect(emit).toHaveBeenCalledWith('billing.invoice.paid_after_cancellation', {
      clinicId: 'clinic_1',
      invoiceId: 'inv_sobra',
    });
  });

  it('controle: numa assinatura ATIVA o pagamento segue liberando o acesso', async () => {
    // Sem este contraste, o teste acima passaria também se o caminho inteiro
    // tivesse parado de funcionar.
    const { tx, ops } = scriptedTx({
      billingStatus: 'active',
      cancelAtPeriodEnd: false,
      id: 'sub_1',
      cycle: 'monthly',
      currentPeriodEnd: null,
      status: 'active',
      planCode: 'solo',
    });

    await markInvoicePaid(tx, 'clinic_1', invoice, opts);

    expect(ops).toContain('execute'); // setClinicAccess('enabled')
    expect(releaseTrialAfterVerifiedPaymentTx).toHaveBeenCalledWith(tx, 'clinic_1', 'inv_sobra');
  });

  it('cancelamento AGENDADO e cobrança paga: segue, mas sinaliza para revisão', async () => {
    const { tx, inserts } = scriptedTx({
      billingStatus: 'active',
      cancelAtPeriodEnd: true,
      id: 'sub_1',
      cycle: 'monthly',
      currentPeriodEnd: null,
      status: 'active',
      planCode: 'solo',
    });

    await markInvoicePaid(tx, 'clinic_1', invoice, opts);

    expect(inserts).toContainEqual(
      expect.objectContaining({ type: 'invoice.paid_during_scheduled_cancellation' }),
    );
  });
  it('does not release evaluation quotas without a provider payment identifier', async () => {
    const { tx } = scriptedTx({
      billingStatus: 'active',
      cancelAtPeriodEnd: false,
      id: 'sub_1',
      cycle: 'monthly',
      currentPeriodEnd: null,
      status: 'active',
      planCode: 'solo',
    });
    await markInvoicePaid(tx, 'clinic_1', invoice, { ...opts, providerPaymentId: null });
    expect(releaseTrialAfterVerifiedPaymentTx).not.toHaveBeenCalled();
  });
});
