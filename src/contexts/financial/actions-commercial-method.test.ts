import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireCachedAnyPermission: vi.fn(),
  requireClinicId: vi.fn(),
  idempotentMutation: vi.fn(),
  publishEvent: vi.fn(),
  refreshProfessionalPayout: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: mocks.requireUser,
  requireCachedAnyPermission: mocks.requireCachedAnyPermission,
  requireClinicId: mocks.requireClinicId,
}));
vi.mock('@/lib/idempotency/mutation', () => ({ idempotentMutation: mocks.idempotentMutation }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: mocks.publishEvent }));
vi.mock('./internal/action-helpers', () => ({
  idemKey: (_action: string, key: string) => key,
  jsonSafe: (value: unknown) => value,
  requestContext: () => Promise.resolve({}),
}));
vi.mock('./internal/professional-payout', () => ({
  refreshProfessionalPayout: mocks.refreshProfessionalPayout,
}));
vi.mock('./queries', () => ({
  toLancamentoSummary: (row: { id: string }) => ({ id: row.id }),
}));

import { confirmPayment } from './actions';

const CLINIC_ID = '11111111-1111-4111-8111-111111111111';
const APPOINTMENT_ID = '22222222-2222-4222-8222-222222222222';
const LANCAMENTO_ID = '33333333-3333-4333-8333-333333333333';

function queryResolving(rows: unknown[]) {
  const query = Object.assign(Promise.resolve(rows), {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
    limit: vi.fn(),
  });
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.for.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function stubTransaction(
  appointment: {
    pricingPolicyMode: string;
    commercialPaymentMethod: string | null;
  } | null,
) {
  const lancamento = {
    id: LANCAMENTO_ID,
    clinicId: CLINIC_ID,
    appointmentId: APPOINTMENT_ID,
    tipo: 'receber',
    status: 'pendente',
    valor: '100.00',
    valorPago: '0.00',
  };
  const returning = vi.fn().mockResolvedValue([{ id: LANCAMENTO_ID }]);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const tx = {
    select: vi.fn(() => queryResolving([lancamento])),
    execute: vi.fn().mockResolvedValue(appointment ? [appointment] : []),
    update: vi.fn(() => ({ set })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning })) })),
  };
  mocks.idempotentMutation.mockImplementation(
    async (_options: unknown, operation: (transaction: typeof tx) => Promise<unknown>) =>
      operation(tx),
  );
  return tx;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: 'user-1' });
  mocks.requireClinicId.mockResolvedValue(CLINIC_ID);
});

describe('confirmPayment e condição comercial do atendimento', () => {
  it('recusa método divergente antes de registrar baixa ou publicar evento', async () => {
    const tx = stubTransaction({
      pricingPolicyMode: 'payment_method_pricing',
      commercialPaymentMethod: 'cash',
    });

    await expect(
      confirmPayment(
        { lancamentoId: LANCAMENTO_ID, valorPago: 25, paymentMethod: 'pix' },
        'idem-divergent',
      ),
    ).rejects.toThrow('difere da condição comercial');
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(mocks.publishEvent).not.toHaveBeenCalled();

    const query = new PgDialect().sqlToQuery(tx.execute.mock.calls[0]![0] as SQL);
    expect(query.sql).toMatch(/FROM appointments/i);
    expect(query.sql).toMatch(/clinic_id =/i);
    expect(query.params).toContain(CLINIC_ID);
    expect(query.params).toContain(APPOINTMENT_ID);
  });

  it('aceita o método acordado e mantém o modo padrão flexível', async () => {
    const explicit = stubTransaction({
      pricingPolicyMode: 'payment_method_pricing',
      commercialPaymentMethod: 'cash',
    });
    await expect(
      confirmPayment(
        { lancamentoId: LANCAMENTO_ID, valorPago: 25, paymentMethod: 'dinheiro' },
        'idem-cash',
      ),
    ).resolves.toEqual({ id: LANCAMENTO_ID });
    expect(explicit.insert).toHaveBeenCalledOnce();
    expect(mocks.publishEvent).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ userId: 'user-1' });
    mocks.requireClinicId.mockResolvedValue(CLINIC_ID);
    const standard = stubTransaction({
      pricingPolicyMode: 'absorb_fees',
      commercialPaymentMethod: null,
    });
    await expect(
      confirmPayment(
        { lancamentoId: LANCAMENTO_ID, valorPago: 25, paymentMethod: 'cartao_credito' },
        'idem-standard',
      ),
    ).resolves.toEqual({ id: LANCAMENTO_ID });
    expect(standard.insert).toHaveBeenCalledOnce();
  });

  it.each([
    ['pix', 'pix'],
    ['credit_card', 'cartao_credito'],
  ])(
    'aceita o método comercial %s como %s no catálogo',
    async (commercialPaymentMethod, paymentMethod) => {
      const tx = stubTransaction({
        pricingPolicyMode: 'payment_method_pricing',
        commercialPaymentMethod,
      });

      await expect(
        confirmPayment(
          { lancamentoId: LANCAMENTO_ID, valorPago: 25, paymentMethod },
          'idem-matched',
        ),
      ).resolves.toEqual({ id: LANCAMENTO_ID });
      expect(tx.insert).toHaveBeenCalledOnce();
    },
  );

  it('falha fechado se o atendimento referenciado não pertence à clínica', async () => {
    const tx = stubTransaction(null);
    await expect(
      confirmPayment(
        { lancamentoId: LANCAMENTO_ID, valorPago: 25, paymentMethod: 'dinheiro' },
        'idem-missing',
      ),
    ).rejects.toThrow('atendimento não encontrado nesta clínica');
    expect(tx.update).not.toHaveBeenCalled();
  });
});
