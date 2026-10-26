import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  calls: [] as string[],
  removeCharges: vi.fn(),
  cancellationContext: vi.fn(),
  revocationContext: vi.fn(),
  reactivationContext: vi.fn(),
  requestCancellation: vi.fn(),
  revokeCancellation: vi.fn(),
  reactivate: vi.fn(),
  updateSubscription: vi.fn(),
  ensureUpgradePayment: vi.fn(),
  requestPlanChange: vi.fn(),
  reopen: vi.fn(),
  idempotent: vi.fn(),
  PlanChangeError: class PlanChangeError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  },
  BillingProviderError: class BillingProviderError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly httpStatus: number | null,
    ) {
      super(message);
    }
  },
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ origin: 'https://app.test' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit/request-context', () => ({
  buildRequestContext: () => ({ ip: '127.0.0.1', requestId: 'req_1' }),
}));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: async () => ({ userId: 'user_1' }),
  requireFreshPermission: async () => undefined,
  requireClinicId: async () => 'clinic_1',
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/idempotency/mutation', () => ({
  idempotentMutation: (_opts: unknown, fn: (tx: unknown) => unknown) => {
    m.calls.push('local');
    m.idempotent();
    return fn({});
  },
}));
vi.mock('@/contexts/billing/internal/plan-change-payment', () => ({
  ensureUpgradePayment: m.ensureUpgradePayment,
}));
vi.mock('@/lib/payments/asaas', () => ({
  asaasProvider: { updateSubscription: m.updateSubscription },
  BillingProviderError: m.BillingProviderError,
}));
vi.mock('@/contexts/billing/internal/cancellation-charges', () => ({
  removeSubscriptionCharges: m.removeCharges,
}));
vi.mock('@/contexts/billing/internal/clinic-status', () => ({
  reopenClinicAfterReactivation: m.reopen,
}));
vi.mock('@/contexts/billing/internal/plan-changes', () => ({
  PlanChangeError: m.PlanChangeError,
  getSubscriptionCancellationContext: m.cancellationContext,
  getSubscriptionRevocationContext: m.revocationContext,
  getSubscriptionReactivationContext: m.reactivationContext,
  requestSubscriptionCancellation: m.requestCancellation,
  revokeSubscriptionCancellation: m.revokeCancellation,
  reactivateSubscription: m.reactivate,
  requestPlanChange: m.requestPlanChange,
}));

import {
  reactivateSubscriptionAction,
  requestPlanChangeAction,
  requestSubscriptionCancellationAction,
  revokeSubscriptionCancellationAction,
} from './actions';

const KEY = '00000000-0000-4000-8000-000000000001';
function form(): FormData {
  const data = new FormData();
  data.set('idempotencyKey', KEY);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.calls.length = 0;
  m.cancellationContext.mockResolvedValue({
    asaasSubscriptionId: 'sub_asaas',
    extraPaymentIds: ['pay_upgrade'],
    effectiveAt: new Date('2099-10-10T00:00:00Z'),
  });
  m.removeCharges.mockImplementation(async () => {
    m.calls.push('asaas');
    return { ok: true, removedPaymentIds: ['pay_1', 'pay_upgrade'], paidPaymentIds: [] };
  });
  m.updateSubscription.mockResolvedValue(undefined);
  m.requestCancellation.mockResolvedValue({
    id: 'change_1',
    effectiveAt: new Date('2099-10-10T00:00:00Z'),
    removedCharges: 2,
  });
});

describe('médico adicional', () => {
  beforeEach(() => {
    m.requestPlanChange.mockResolvedValue({
      id: 'change_1',
      kind: 'upgrade',
      targetPlanName: 'Clínica com 3 médicos',
      prorationAmount: '73.50',
    });
  });

  it('mostra recusa definitiva do Asaas sem afirmar que há cobrança em conciliação', async () => {
    m.ensureUpgradePayment.mockRejectedValue(
      new m.BillingProviderError('payload inválido', 'invalid_object', 400),
    );
    const data = form();
    data.set('targetPlanId', '00000000-0000-4000-8000-000000000002');

    const result = await requestPlanChangeAction({ error: null }, data);

    expect(result.error).toContain('O Asaas recusou o Checkout');
    expect(result.success).toBeUndefined();
    expect(result.paymentUrl).toBeUndefined();
    expect(m.ensureUpgradePayment).toHaveBeenCalledWith('clinic_1', 'change_1');
  });

  it('mantém resultado incerto quando o Asaas devolve erro transitório', async () => {
    m.ensureUpgradePayment.mockRejectedValue(
      new m.BillingProviderError('indisponível', 'provider_unavailable', 503),
    );
    const data = form();
    data.set('targetPlanId', '00000000-0000-4000-8000-000000000002');

    const result = await requestPlanChangeAction({ error: null }, data);

    expect(result.error).toContain('Não foi possível confirmar a criação do Checkout');
    expect(result.success).toBeUndefined();
    expect(result.paymentUrl).toBeUndefined();
  });
});

describe('cancelar assinatura', () => {
  it('apaga no Asaas ANTES de registrar localmente, e repassa a prova', async () => {
    const result = await requestSubscriptionCancellationAction({ error: null }, form());

    expect(m.calls).toEqual(['asaas', 'local']);
    expect(m.removeCharges).toHaveBeenCalledWith(expect.anything(), {
      asaasSubscriptionId: 'sub_asaas',
      extraPaymentIds: ['pay_upgrade'],
    });
    expect(m.requestCancellation).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        removedPaymentIds: ['pay_1', 'pay_upgrade'],
        paidPaymentIds: [],
      }),
    );
    expect(result.success).toBe('cancellation_scheduled');
    expect(result.message).toContain('Nenhuma nova cobrança será feita');
    expect(result.message).toContain('10/10/2099');
  });

  it.each([
    ['in_flight', /cartão sendo analisado/u],
    ['provider_unavailable', /Não foi possível confirmar no Asaas/u],
  ] as const)('Asaas incompleto (%s): NADA é gravado no Qoro', async (reason, texto) => {
    m.removeCharges.mockResolvedValue({
      ok: false,
      reason,
      removedPaymentIds: [],
      paidPaymentIds: [],
    });

    const result = await requestSubscriptionCancellationAction({ error: null }, form());

    // Registrar localmente aqui seria o defeito original ao contrário: o app
    // diria "cancelado" com cobrança viva no Asaas.
    expect(m.idempotent).not.toHaveBeenCalled();
    expect(m.requestCancellation).not.toHaveBeenCalled();
    expect(result.error).toMatch(texto);
  });

  it.each([
    ['subscription_already_cancelled', 'A assinatura já está cancelada.', /já estava cancelada/u],
    [
      'cancellation_already_scheduled',
      'O cancelamento desta assinatura já está agendado.',
      /já estava confirmado/u,
    ],
  ] as const)(
    'uma repetição idempotente (%s) volta como confirmação visual',
    async (code, message, expected) => {
      m.cancellationContext.mockRejectedValue(new m.PlanChangeError(message, code));

      const result = await requestSubscriptionCancellationAction({ error: null }, form());

      expect(m.removeCharges).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        error: null,
        success: 'cancellation_already_applied',
        message: expect.stringMatching(expected),
      });
    },
  );
});

describe('manter assinatura', () => {
  it('religa a recorrência no Asaas ANTES de revogar localmente', async () => {
    m.revocationContext.mockResolvedValue({
      asaasSubscriptionId: 'sub_asaas',
      value: 149,
      nextDueDate: '2026-10-10',
    });
    m.updateSubscription.mockImplementation(async () => m.calls.push('asaas'));

    const result = await revokeSubscriptionCancellationAction({ error: null }, form());

    expect(m.updateSubscription).toHaveBeenCalledWith('sub_asaas', {
      value: 149,
      status: 'ACTIVE',
      nextDueDate: '2026-10-10',
      updatePendingPayments: false,
    });
    expect(m.calls).toEqual(['asaas', 'local']);
    expect(result.success).toBe('cancellation_revoked');
  });

  it('Asaas recusou religar: o cancelamento continua de pé', async () => {
    m.revocationContext.mockResolvedValue({
      asaasSubscriptionId: 'sub_asaas',
      value: 149,
      nextDueDate: '2026-10-10',
    });
    m.updateSubscription.mockRejectedValue(new Error('asaas fora'));

    const result = await revokeSubscriptionCancellationAction({ error: null }, form());

    expect(m.revokeCancellation).not.toHaveBeenCalled();
    expect(result.error).toBeTruthy();
  });
});

describe('reativar assinatura', () => {
  it('reabre a clínica pelo caminho privilegiado depois de reativar', async () => {
    // Dentro de withTenant o UPDATE em `clinics` casa zero linhas (medido em
    // 28/09): sem esta chamada a clínica pagava e continuava bloqueada.
    m.reactivationContext.mockResolvedValue({
      asaasSubscriptionId: 'sub_asaas',
      value: 149,
      nextDueDate: '2026-09-28',
    });
    m.reactivate.mockResolvedValue({ reactivated: true });
    m.reopen.mockImplementation(async () => {
      m.calls.push('reopen');
      return true;
    });

    const result = await reactivateSubscriptionAction({ error: null }, form());

    expect(m.calls).toEqual(['local', 'reopen']);
    expect(m.reopen).toHaveBeenCalledWith('clinic_1');
    expect(result.success).toBe('subscription_reactivated');
  });
});
