import { beforeEach, describe, expect, it, vi } from 'vitest';

const { syncInvoice, tenantTx } = vi.hoisted(() => ({
  syncInvoice: vi.fn(),
  tenantTx: { current: null as unknown },
}));

vi.mock('@/lib/outbox/publish', () => ({ publishEvent: vi.fn() }));
vi.mock('@/lib/db/tenant', () => ({
  withTenant: (_clinicId: string, fn: (tx: unknown) => unknown) => fn(tenantTx.current),
}));
vi.mock('./subscriptions', () => ({
  setClinicAccess: vi.fn(),
  syncInvoiceFromProviderPayment: syncInvoice,
}));

import type { Tx } from '@/lib/db';

import {
  cancellationEffectiveAt,
  earliestReactivationDueDate,
  getSubscriptionCancellationContext,
  getSubscriptionReactivationContext,
  getSubscriptionRevocationContext,
  PlanChangeError,
  requestPlanChange,
  requestSubscriptionCancellation,
} from './plan-changes';

const NOW = new Date('2026-09-28T12:00:00Z');
const FIM_CICLO = new Date('2026-10-10T00:00:00Z');
const FIM_ANUAL = new Date('2027-09-10T00:00:00Z');
const FIM_TESTE = new Date('2026-10-02T00:00:00Z');

type Sub = Parameters<typeof cancellationEffectiveAt>[0] & Record<string, unknown>;

function current(over: Record<string, unknown> = {}): Sub {
  return {
    id: 'sub_local',
    planId: 'plan_solo',
    priceId: 'price_solo',
    planCode: 'solo',
    planName: 'Solo',
    priceAmount: '149.00',
    campaignCode: null,
    billingCycle: 'monthly',
    billingStatus: 'active',
    currentPeriodStart: new Date('2026-09-10T00:00:00Z'),
    currentPeriodEnd: FIM_CICLO,
    trialEndsAt: null,
    asaasSubscriptionId: 'sub_asaas',
    ...over,
  } as Sub;
}

/**
 * `tx` roteirizada: cada `select` devolve o próximo resultado da fila, na ordem
 * em que o código consulta; inserts e updates ficam registrados.
 */
function scripted(selects: unknown[][], superseded: unknown[] = []) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  let i = 0;
  const thenable = (result: unknown) => {
    const self: Record<string, unknown> = {};
    for (const key of ['from', 'innerJoin', 'leftJoin', 'where', 'limit', 'orderBy']) {
      self[key] = () => self;
    }
    self.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(ok, err);
    return self;
  };
  const tx = {
    select: () => thenable(selects[i++] ?? []),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return {
          returning: async () => [{ id: 'change_novo' }],
          then: (ok: (v: unknown) => unknown) => Promise.resolve(undefined).then(ok),
        };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: () => ({
            returning: async () => superseded,
            then: (ok: (v: unknown) => unknown) => Promise.resolve(undefined).then(ok),
          }),
        };
      },
    }),
  };
  return { tx: tx as unknown as Tx, inserts, updates };
}

const baseInput = {
  clinicId: 'clinic_1',
  requestedBy: 'user_1',
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  request: { ip: null, origin: null, requestId: 'req_1' },
  now: NOW,
};

beforeEach(() => vi.clearAllMocks());

describe('cancellationEffectiveAt — até quando o acesso dura', () => {
  it('ativa: no fim do ciclo JÁ PAGO', () => {
    expect(cancellationEffectiveAt(current(), NOW)).toEqual(FIM_CICLO);
  });

  it('anual pré-pago: preserva acesso até o fim do ano contratado', () => {
    expect(
      cancellationEffectiveAt(
        current({ billingCycle: 'annual', currentPeriodEnd: FIM_ANUAL }),
        NOW,
      ),
    ).toEqual(FIM_ANUAL);
  });

  it('teste: no fim do teste prometido', () => {
    expect(
      cancellationEffectiveAt(
        current({ billingStatus: 'trial', currentPeriodEnd: null, trialEndsAt: FIM_TESTE }),
        NOW,
      ),
    ).toEqual(FIM_TESTE);
  });

  it('inadimplente: agora — não há período pago a honrar', () => {
    expect(cancellationEffectiveAt(current({ billingStatus: 'past_due' }), NOW)).toEqual(NOW);
  });

  it('prazo já vencido vira agora, nunca uma data no passado', () => {
    const ontem = new Date('2026-09-27T00:00:00Z');
    expect(cancellationEffectiveAt(current({ currentPeriodEnd: ontem }), NOW)).toEqual(NOW);
    expect(
      cancellationEffectiveAt(current({ billingStatus: 'trial', trialEndsAt: null }), NOW),
    ).toEqual(NOW);
  });
});

describe('requestSubscriptionCancellation', () => {
  it('anual pré-pago: cancela só a renovação e agenda o fim para o período pago', async () => {
    const { tx, inserts, updates } = scripted([
      [current({ billingCycle: 'annual', currentPeriodEnd: FIM_ANUAL })],
      [],
    ]);

    const result = await requestSubscriptionCancellation(tx, {
      ...baseInput,
      removedPaymentIds: [],
      paidPaymentIds: [],
    });

    expect(result).toMatchObject({ kind: 'cancellation', effectiveAt: FIM_ANUAL });
    expect(inserts[0]).toMatchObject({
      kind: 'cancellation',
      status: 'scheduled',
      effectiveAt: FIM_ANUAL,
    });
    expect(updates).toContainEqual({ cancelAtPeriodEnd: true });
    expect(inserts.some((entry) => entry.type === 'refund.requested')).toBe(false);
  });

  it('aceita cancelar DURANTE O TESTE (antes a tela dizia que não havia o que cancelar)', async () => {
    const { tx, inserts, updates } = scripted([
      [current({ billingStatus: 'trial', currentPeriodEnd: null, trialEndsAt: FIM_TESTE })],
      [], // nenhum cancelamento agendado
    ]);

    const result = await requestSubscriptionCancellation(tx, {
      ...baseInput,
      removedPaymentIds: [],
      paidPaymentIds: [],
    });

    expect(result).toMatchObject({ kind: 'cancellation', effectiveAt: FIM_TESTE });
    expect(inserts[0]).toMatchObject({ kind: 'cancellation', status: 'scheduled' });
    expect(updates).toContainEqual({ cancelAtPeriodEnd: true });
  });

  it('aceita cancelar INADIMPLENTE, com efeito imediato', async () => {
    const { tx } = scripted([[current({ billingStatus: 'past_due' })], []]);

    const result = await requestSubscriptionCancellation(tx, {
      ...baseInput,
      removedPaymentIds: [],
      paidPaymentIds: [],
    });

    expect(result.effectiveAt).toEqual(NOW);
  });

  it('recusa assinatura já cancelada', async () => {
    const { tx } = scripted([[current({ billingStatus: 'cancelled' })]]);

    await expect(
      requestSubscriptionCancellation(tx, {
        ...baseInput,
        removedPaymentIds: [],
        paidPaymentIds: [],
      }),
    ).rejects.toMatchObject({ code: 'subscription_already_cancelled' });
  });

  it('supera upgrade/downgrade pendente em vez de recusar — cancelar é sempre possível', async () => {
    const { tx, inserts } = scripted(
      [[current()], []],
      [{ id: 'change_upgrade', kind: 'upgrade' }],
    );

    await requestSubscriptionCancellation(tx, {
      ...baseInput,
      removedPaymentIds: [],
      paidPaymentIds: [],
    });

    const evento = inserts.find((v) => v.type === 'subscription.cancellation.requested');
    expect(evento?.payload).toMatchObject({
      supersededChanges: [{ id: 'change_upgrade', kind: 'upgrade' }],
    });
  });

  it('marca como canceladas as invoices locais das cobranças apagadas no Asaas', async () => {
    const invoiceAberta = { id: 'inv_1', asaasPaymentId: 'pay_apagada', status: 'open' };
    const { tx } = scripted([[current()], [], [invoiceAberta]]);

    await requestSubscriptionCancellation(tx, {
      ...baseInput,
      removedPaymentIds: ['pay_apagada'],
      paidPaymentIds: [],
    });

    expect(syncInvoice).toHaveBeenCalledWith(
      tx,
      'clinic_1',
      invoiceAberta,
      { exists: false },
      expect.objectContaining({ providerConfirmedMissing: true }),
    );
  });

  it('cobrança que já estava paga vira evento próprio, para estorno humano', async () => {
    const { tx, inserts } = scripted([[current()], []]);

    await requestSubscriptionCancellation(tx, {
      ...baseInput,
      removedPaymentIds: [],
      paidPaymentIds: ['pay_cartao_corrida'],
    });

    expect(inserts).toContainEqual(
      expect.objectContaining({
        type: 'subscription.cancellation.paid_charge_detected',
        payload: expect.objectContaining({ paymentIds: ['pay_cartao_corrida'] }),
      }),
    );
  });
});

describe('getSubscriptionCancellationContext', () => {
  it('inclui as cobranças avulsas que a listagem da recorrência não enxerga', async () => {
    tenantTx.current = scripted([
      [current()],
      [], // nenhum cancelamento agendado
      [{ paymentId: 'pay_upgrade' }], // upgrade aguardando pagamento
      [{ paymentId: 'pay_invoice' }, { paymentId: 'pay_upgrade' }, { paymentId: null }],
    ]).tx;

    const ctx = await getSubscriptionCancellationContext('clinic_1', NOW);

    expect(ctx).toEqual({
      asaasSubscriptionId: 'sub_asaas',
      extraPaymentIds: ['pay_upgrade', 'pay_invoice'],
      effectiveAt: FIM_CICLO,
    });
  });

  it('recusa um segundo cancelamento', async () => {
    tenantTx.current = scripted([[current()], [{ id: 'c1', effectiveAt: FIM_CICLO }]]).tx;

    await expect(getSubscriptionCancellationContext('clinic_1', NOW)).rejects.toMatchObject({
      code: 'cancellation_already_scheduled',
    });
  });
});

describe('manter assinatura (revogação)', () => {
  it('religa a recorrência com vencimento na data em que o cancelamento valeria', async () => {
    tenantTx.current = scripted([[current()], [{ id: 'c1', effectiveAt: FIM_CICLO }]]).tx;

    await expect(getSubscriptionRevocationContext('clinic_1', NOW)).resolves.toEqual({
      asaasSubscriptionId: 'sub_asaas',
      value: 149,
      nextDueDate: '2026-10-10',
    });
  });
});

describe('troca de plano com cancelamento agendado', () => {
  it('é RECUSADA — revogar só no banco deixaria o Asaas parado e a clínica ativa', async () => {
    const { tx } = scripted([
      [current()],
      [
        {
          id: 'plan_pro',
          name: 'Pro',
          code: 'pro',
          priceId: 'price_pro',
          priceAmount: '399.00',
          campaignCode: null,
        },
      ],
      [{ id: 'c1', kind: 'cancellation', status: 'scheduled' }],
    ]);

    const tentativa = requestPlanChange(tx, { ...baseInput, targetPlanId: 'plan_pro' });

    await expect(tentativa).rejects.toBeInstanceOf(PlanChangeError);
    await expect(tentativa).rejects.toMatchObject({ code: 'cancellation_scheduled' });
  });
});

describe('vencimento ao religar a recorrência no Asaas', () => {
  // Medido no sandbox: vencimento hoje (ou antes) volta 400 invalid_nextDueDate —
  // "é necessário que a data do próximo vencimento seja maior que hoje". A
  // reativação mandava hoje e por isso nunca funcionou contra o Asaas real.
  it('é sempre amanhã, nunca hoje', () => {
    expect(earliestReactivationDueDate(NOW)).toBe('2026-09-29');
  });

  it('na madrugada UTC (ainda "ontem" em Brasília) continua maior que os dois "hojes"', () => {
    // 01:00 UTC de 29/09 = 22:00 de 28/09 em Brasília.
    expect(earliestReactivationDueDate(new Date('2026-09-29T01:00:00Z'))).toBe('2026-09-30');
  });

  it('reativar uma assinatura cancelada pede vencimento amanhã', async () => {
    tenantTx.current = scripted([[current({ billingStatus: 'cancelled' })]]).tx;

    await expect(getSubscriptionReactivationContext('clinic_1', NOW)).resolves.toEqual({
      asaasSubscriptionId: 'sub_asaas',
      value: 149,
      nextDueDate: '2026-09-29',
    });
  });

  it('manter assinatura com vigência imediata (inadimplente) também pede amanhã', async () => {
    tenantTx.current = scripted([
      [current({ billingStatus: 'past_due' })],
      [{ id: 'c1', effectiveAt: NOW }],
    ]).tx;

    await expect(getSubscriptionRevocationContext('clinic_1', NOW)).resolves.toMatchObject({
      nextDueDate: '2026-09-29',
    });
  });
});
