import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ hasAdvancedFinancialPolicies: vi.fn(), logAudit: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/contexts/billing/api', () => ({
  billingApiV1: { hasAdvancedFinancialPolicies: mocks.hasAdvancedFinancialPolicies },
}));
vi.mock('@/lib/audit/log', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));

import type { Tx } from '@/lib/db';
import { createProfessionalPayoutSnapshot, refreshProfessionalPayout } from './professional-payout';

function queryResolving(rows: unknown[]) {
  const query = Object.assign(Promise.resolve(rows), {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
    limit: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    orderBy: vi.fn(),
  });
  for (const method of [
    'from',
    'where',
    'for',
    'limit',
    'innerJoin',
    'leftJoin',
    'orderBy',
  ] as const) {
    query[method].mockReturnValue(query);
  }
  return query;
}

function refreshTx(reads: unknown[][]) {
  const pendingReads = [...reads];
  const updates: Array<Record<string, unknown>> = [];
  const tx = {
    select: vi.fn(() => queryResolving(pendingReads.shift() ?? [])),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: () => Promise.resolve() };
      },
    })),
  } as unknown as Tx;
  return { tx, updates };
}

const payout = {
  id: 'payout-1',
  clinicId: 'clinic-1',
  appointmentId: 'appointment-1',
  status: 'calculated',
  calculationBasis: 'net',
  grossAmount: '100.00',
  ruleKind: 'percentage',
  rulePercentage: '50.0000',
  ruleFixedAmount: null,
  calculatedAt: new Date('2026-10-02T10:00:00Z'),
};

const refreshInput = { clinicId: 'clinic-1', appointmentId: 'appointment-1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasAdvancedFinancialPolicies.mockResolvedValue(false);
  mocks.logAudit.mockResolvedValue('audit-1');
});

describe('snapshot profissional por plano', () => {
  it('não cria passivo novo no Solo após downgrade, sem consultar regras', async () => {
    const tx = { select: vi.fn(), insert: vi.fn() } as unknown as Tx;
    await expect(
      createProfessionalPayoutSnapshot(tx, {
        clinicId: 'clinic-test',
        appointmentId: 'appointment-test',
        professionalId: 'professional-test',
        procedureId: 'procedure-test',
        grossAmount: 250,
        occurredAt: new Date('2026-10-02T10:00:00Z'),
      }),
    ).resolves.toBeNull();
    expect(mocks.hasAdvancedFinancialPolicies).toHaveBeenCalledWith('clinic-test', tx);
    expect(tx.select).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('não gera novo passivo quando a regra existe mas o profissional perdeu elegibilidade', async () => {
    mocks.hasAdvancedFinancialPolicies.mockResolvedValue(true);
    const tx = {
      select: vi.fn(() => queryResolving([{ id: 'stale-rule' }])),
      execute: vi.fn().mockResolvedValue([]),
      insert: vi.fn(),
    } as unknown as Tx;

    await expect(
      createProfessionalPayoutSnapshot(tx, {
        clinicId: 'clinic-test',
        appointmentId: 'appointment-test',
        professionalId: 'professional-test',
        procedureId: 'procedure-test',
        grossAmount: 250,
        occurredAt: new Date('2026-10-02T10:00:00Z'),
      }),
    ).resolves.toBeNull();
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('mantém o snapshot quando o profissional segue elegível', async () => {
    mocks.hasAdvancedFinancialPolicies.mockResolvedValue(true);
    const reads = [
      [{ id: 'rule-1', kind: 'percentage', percentage: '50.0000' }],
      [{ id: 'policy-1', basis: 'gross' }],
    ];
    const insertValues = vi.fn(() => ({
      onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: 'payout-1' }]) }),
    }));
    const tx = {
      select: vi.fn(() => queryResolving(reads.shift() ?? [])),
      execute: vi.fn().mockResolvedValue([{ ok: 1 }]),
      insert: vi.fn(() => ({ values: insertValues })),
    } as unknown as Tx;

    await expect(
      createProfessionalPayoutSnapshot(tx, {
        clinicId: 'clinic-test',
        appointmentId: 'appointment-test',
        professionalId: 'professional-test',
        procedureId: 'procedure-test',
        grossAmount: 250,
        occurredAt: new Date('2026-10-02T10:00:00Z'),
      }),
    ).resolves.toBe('payout-1');
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'professional-test',
        basisAmount: '250.00',
        payoutAmount: '125.00',
      }),
    );
  });
});

describe('reconciliação de repasse após reversão', () => {
  it('mantém NET pendente quando o recebível ainda não está pago', async () => {
    const { tx, updates } = refreshTx([[payout], [{ status: 'parcial' }]]);

    await expect(refreshProfessionalPayout(tx, refreshInput)).resolves.toBe('pending');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      status: 'pending_economics',
      providerFeeAmount: null,
      earlySettlementFeeAmount: null,
      netAmount: null,
      basisAmount: null,
      payoutAmount: null,
      calculatedAt: null,
    });
  });

  it('preserva o repasse GROSS de atendimento concluído durante pagamento parcial sem estorno', async () => {
    const { tx, updates } = refreshTx([
      [{ ...payout, calculationBasis: 'gross' }],
      [{ status: 'parcial' }],
      [],
      [],
    ]);

    await expect(refreshProfessionalPayout(tx, refreshInput)).resolves.toBe('calculated');
    expect(updates[0]).toMatchObject({
      status: 'calculated',
      basisAmount: '100.00',
      payoutAmount: '50.00',
    });
  });

  it('suspende GROSS após estorno explícito mesmo se outro pagamento deixou o recebível pago', async () => {
    const { tx, updates } = refreshTx([
      [{ ...payout, calculationBasis: 'gross' }],
      [{ status: 'pago' }],
      [],
      [{ transactionKind: 'refund' }],
    ]);

    await expect(refreshProfessionalPayout(tx, refreshInput)).resolves.toBe('cancelled');
    expect(updates[0]).toMatchObject({
      status: 'cancelled',
      basisAmount: null,
      payoutAmount: null,
    });
  });

  it('preserva cálculo anterior em auditoria na primeira suspensão, sem duplicar no replay', async () => {
    const calculated = {
      ...payout,
      calculationBasis: 'gross' as const,
      basisAmount: '100.00',
      payoutAmount: '50.00',
      providerFeeAmount: '2.00',
      netAmount: '98.00',
    };
    const { tx, updates } = refreshTx([
      [calculated],
      [{ status: 'pago' }],
      [],
      [{ transactionKind: 'refund' }],
      [{ ...calculated, status: 'cancelled', basisAmount: null, payoutAmount: null }],
    ]);

    await expect(refreshProfessionalPayout(tx, refreshInput)).resolves.toBe('cancelled');
    expect(mocks.logAudit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        clinicId: 'clinic-1',
        action: 'financial.professional_payout.suspended',
        resourceId: 'payout-1',
        before: expect.objectContaining({
          basisAmount: '100.00',
          payoutAmount: '50.00',
          providerFeeAmount: '2.00',
          netAmount: '98.00',
        }),
        after: { status: 'cancelled', reason: 'payment_reversed' },
      }),
    );
    expect(updates[0]).toMatchObject({ status: 'cancelled', payoutAmount: null });

    await expect(refreshProfessionalPayout(tx, refreshInput)).resolves.toBe('cancelled');
    expect(mocks.logAudit).toHaveBeenCalledTimes(1);
    expect(tx.select).toHaveBeenCalledTimes(5);
  });

  it('não reabre repasse suspenso quando uma leitura posterior não encontra mais a perda', async () => {
    const { tx, updates } = refreshTx([[{ ...payout, status: 'cancelled' }]]);

    await expect(refreshProfessionalPayout(tx, refreshInput)).resolves.toBe('cancelled');
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(0);
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it('não suspende o repasse se a auditoria da reversão falhar', async () => {
    const { tx, updates } = refreshTx([
      [{ ...payout, payoutAmount: '50.00' }],
      [{ status: 'pago' }],
      [],
      [{ transactionKind: 'refund' }],
    ]);
    mocks.logAudit.mockRejectedValueOnce(new Error('audit indisponível'));

    await expect(refreshProfessionalPayout(tx, refreshInput)).rejects.toThrow('audit indisponível');
    expect(updates).toHaveLength(0);
  });

  it('suspende GROSS quando há perda do provedor mesmo com recebível parcial', async () => {
    const { tx, updates } = refreshTx([
      [{ ...payout, calculationBasis: 'gross' }],
      [{ status: 'parcial' }],
      [{ id: 'lost-credit' }],
    ]);

    await expect(refreshProfessionalPayout(tx, refreshInput)).resolves.toBe('cancelled');
    expect(updates[0]).toMatchObject({ status: 'cancelled', payoutAmount: null });
    expect(tx.select).toHaveBeenCalledTimes(3);
  });

  it('preserva GROSS pago enquanto faltam fatos econômicos do provedor', async () => {
    const { tx, updates } = refreshTx([
      [{ ...payout, calculationBasis: 'gross' }],
      [{ status: 'pago' }],
      [],
      [
        {
          transactionId: 'payment-1',
          transactionKind: 'payment',
          transactionAmount: '100.00',
          createdBy: null,
          creditAmount: '100.00',
          providerGrossAmount: '100.00',
          providerNetAmount: null,
        },
      ],
    ]);

    await expect(refreshProfessionalPayout(tx, refreshInput)).resolves.toBe('calculated');
    expect(updates[0]).toMatchObject({
      status: 'calculated',
      basisAmount: '100.00',
      payoutAmount: '50.00',
      netAmount: null,
    });
  });

  it('não calcula líquido de pagamento do provedor estornado sem economia pós-estorno', async () => {
    const { tx, updates } = refreshTx([
      [payout],
      [{ status: 'pago' }],
      [],
      [
        {
          transactionId: 'payment-1',
          transactionKind: 'payment',
          transactionAmount: '100.00',
          originalPaymentId: null,
          creditAmount: '100.00',
          providerGrossAmount: '100.00',
          providerFeeAmount: '2.00',
          providerNetAmount: '98.00',
          earlySettlementFeeAmount: null,
        },
        {
          transactionId: 'refund-1',
          transactionKind: 'refund',
          transactionAmount: '30.00',
          originalPaymentId: 'payment-1',
          creditAmount: null,
          providerGrossAmount: null,
          providerFeeAmount: null,
          providerNetAmount: null,
          earlySettlementFeeAmount: null,
        },
      ],
    ]);

    await expect(refreshProfessionalPayout(tx, refreshInput)).resolves.toBe('cancelled');
    expect(updates[0]).toMatchObject({
      status: 'cancelled',
      payoutAmount: null,
      netAmount: null,
    });
  });

  it('suspende NET após estorno até existir regra de repasse pós-reversão', async () => {
    const { tx, updates } = refreshTx([
      [payout],
      [{ status: 'pago' }],
      [],
      [
        {
          transactionId: 'payment-1',
          transactionKind: 'payment',
          transactionAmount: '100.00',
          originalPaymentId: null,
          createdBy: 'user-1',
          creditAmount: null,
        },
        {
          transactionId: 'refund-1',
          transactionKind: 'refund',
          transactionAmount: '30.00',
          originalPaymentId: 'payment-1',
          creditAmount: null,
        },
      ],
    ]);

    await expect(refreshProfessionalPayout(tx, refreshInput)).resolves.toBe('cancelled');
    expect(updates[0]).toMatchObject({
      status: 'cancelled',
      netAmount: null,
      basisAmount: null,
      payoutAmount: null,
    });
  });

  it('não presume baixa manual quando um pagamento automático legado perdeu o vínculo', async () => {
    const { tx, updates } = refreshTx([
      [payout],
      [{ status: 'pago' }],
      [],
      [
        {
          transactionId: 'payment-1',
          transactionKind: 'payment',
          transactionAmount: '100.00',
          originalPaymentId: null,
          createdBy: null,
          creditAmount: null,
        },
        {
          transactionId: 'refund-1',
          transactionKind: 'refund',
          transactionAmount: '30.00',
          originalPaymentId: 'payment-1',
          createdBy: 'user-1',
          creditAmount: null,
        },
      ],
    ]);

    await expect(refreshProfessionalPayout(tx, refreshInput)).resolves.toBe('cancelled');
    expect(updates[0]).toMatchObject({ status: 'cancelled', payoutAmount: null });
  });

  it('suspende repasse quando perda alocada ficou em revisão manual sem vínculo legado', async () => {
    const { tx, updates } = refreshTx([
      [payout],
      [{ status: 'pago' }],
      [{ id: 'credit-without-ledger-link' }],
    ]);

    await expect(refreshProfessionalPayout(tx, refreshInput)).resolves.toBe('cancelled');
    expect(updates[0]).toMatchObject({ status: 'cancelled', payoutAmount: null });
    expect(tx.select).toHaveBeenCalledTimes(3);
  });
});
