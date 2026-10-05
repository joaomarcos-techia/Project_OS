import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireCachedPermission: vi.fn(),
  requireClinicId: vi.fn(),
  idempotentMutation: vi.fn(),
  publishEvent: vi.fn(),
  refreshProfessionalPayout: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: mocks.requireUser,
  requireCachedPermission: mocks.requireCachedPermission,
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
  toPaymentTransactionSummary: (row: { id: string }) => ({ id: row.id }),
}));

import { createEstorno } from './actions';

const CLINIC_ID = '11111111-1111-4111-8111-111111111111';
const LANCAMENTO_ID = '22222222-2222-4222-8222-222222222222';
const PAYMENT_ID = '33333333-3333-4333-8333-333333333333';
const APPOINTMENT_ID = '44444444-4444-4444-8444-444444444444';

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: 'user-1' });
  mocks.requireClinicId.mockResolvedValue(CLINIC_ID);
  mocks.refreshProfessionalPayout.mockResolvedValue('cancelled');
});

describe('createEstorno e repasse profissional', () => {
  it('reconcilia o repasse na mesma transação do refund de recebível', async () => {
    const reads = [
      [
        {
          id: LANCAMENTO_ID,
          clinicId: CLINIC_ID,
          appointmentId: APPOINTMENT_ID,
          status: 'pago',
          tipo: 'receber',
          valor: '100.00',
          valorPago: '100.00',
          descricao: 'Consulta',
          unitId: null,
          dueDate: null,
          patientId: null,
          supplierId: null,
          snapshotProcedureName: null,
          snapshotDoctorNome: null,
        },
      ],
      [{ id: PAYMENT_ID, amount: '100.00' }],
      [{ total: '0.00' }],
      [{ payments: '100.00', refunds: '0.00' }],
    ];
    const inserted = [[{ id: 'refund-1' }], [{ id: 'compensation-1' }]];
    const tx = {
      select: () => queryResolving(reads.shift() ?? []),
      insert: () => ({
        values: () => ({ returning: () => Promise.resolve(inserted.shift() ?? []) }),
      }),
    };
    mocks.idempotentMutation.mockImplementation(
      async (_options: unknown, operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await createEstorno(
      {
        lancamentoId: LANCAMENTO_ID,
        paymentId: PAYMENT_ID,
        valor: 30,
        paymentMethod: 'pix',
        motivo: 'Devolução parcial',
      },
      'idem-1',
    );

    expect(mocks.refreshProfessionalPayout).toHaveBeenCalledOnce();
    expect(mocks.refreshProfessionalPayout).toHaveBeenCalledWith(tx, {
      clinicId: CLINIC_ID,
      appointmentId: APPOINTMENT_ID,
    });
    expect(mocks.publishEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ idempotencyKey: 'idem-1:estornado' }),
    );
  });

  it('não terminaliza o lançamento enquanto há pagamento refeito ainda não estornado', async () => {
    // Um chargeback parcial de R$ 30 reabriu o recebível de R$ 100; outra baixa
    // de R$ 30 voltou a quitá-lo. O ledger tem R$ 130 em pagamentos no total.
    const reads = [
      [
        {
          id: LANCAMENTO_ID,
          clinicId: CLINIC_ID,
          appointmentId: APPOINTMENT_ID,
          status: 'pago',
          tipo: 'receber',
          valor: '100.00',
          valorPago: '100.00',
          descricao: 'Consulta',
          unitId: null,
          dueDate: null,
          patientId: null,
          supplierId: null,
          snapshotProcedureName: null,
          snapshotDoctorNome: null,
        },
      ],
      [{ id: PAYMENT_ID, amount: '100.00' }],
      [{ total: '30.00' }],
      [{ payments: '130.00', refunds: '30.00' }],
    ];
    const insertedValues: Array<Record<string, unknown>> = [];
    const inserted = [[{ id: 'refund-2' }], [{ id: 'compensation-2' }]];
    const tx = {
      select: () => queryResolving(reads.shift() ?? []),
      insert: () => ({
        values: (value: Record<string, unknown>) => {
          insertedValues.push(value);
          return { returning: () => Promise.resolve(inserted.shift() ?? []) };
        },
      }),
      update: vi.fn(() => ({
        set: () => ({
          where: () => ({ returning: () => Promise.resolve([{ id: LANCAMENTO_ID }]) }),
        }),
      })),
    };
    mocks.idempotentMutation.mockImplementation(
      async (_options: unknown, operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await createEstorno(
      {
        lancamentoId: LANCAMENTO_ID,
        paymentId: PAYMENT_ID,
        valor: 70,
        paymentMethod: 'pix',
        motivo: 'Devolução parcial após nova baixa',
      },
      'idem-repayment',
    );

    expect(insertedValues[0]).toMatchObject({ kind: 'refund', amount: '70.00' });
    expect(insertedValues[1]).toMatchObject({ status: 'pago', valor: '70.00' });
    expect(tx.update).not.toHaveBeenCalled();
  });
});
