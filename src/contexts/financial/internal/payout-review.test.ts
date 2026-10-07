import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { Tx } from '@/lib/db';

import {
  computePayoutReviewBounds,
  recordProfessionalPayoutReview,
  reviewStillMatches,
} from './payout-review';

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

function reviewTx(reads: unknown[][]) {
  const pending = [...reads];
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const tx = {
    select: vi.fn(() => queryResolving(pending.shift() ?? [])),
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => {
        inserted.push(values);
        return {
          returning: () => Promise.resolve([{ createdAt: new Date('2026-10-07T15:00:00Z') }]),
        };
      },
    })),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        updated.push(values);
        return { where: () => Promise.resolve() };
      },
    })),
  } as unknown as Tx;
  return { tx, inserted, updated };
}

const CLINIC = 'clinic-1';
const grossPayout = {
  id: 'payout-1',
  clinicId: CLINIC,
  appointmentId: 'appointment-1',
  status: 'cancelled',
  calculationBasis: 'gross' as const,
  grossAmount: '150.00',
  ruleKind: 'percentage' as const,
  rulePercentage: '50.0000',
  ruleFixedAmount: null,
};
const netPayout = { ...grossPayout, calculationBasis: 'net' as const };
// Pagamento original de R$ 150 conciliado: tarifa R$ 3, líquido R$ 147.
const providerPayment = {
  transactionAmount: '150.00',
  createdBy: null,
  creditAmount: '150.00',
  providerGrossAmount: '150.00',
  providerNetAmount: '147.00',
};

beforeEach(() => vi.clearAllMocks());

describe('limites da revisão humana do repasse', () => {
  it('reproduz o exemplo decidido: R$ 150, 50% GROSS, estorno de R$ 50', async () => {
    const { tx } = reviewTx([[{ total: '50.00' }], [], [providerPayment]]);
    await expect(computePayoutReviewBounds(tx, grossPayout)).resolves.toEqual({
      basisCents: 15_000,
      ceilingCents: 7_500,
      referenceCents: 5_000,
      fingerprint: { refundedCents: 5_000, loss: false },
    });
  });

  it('usa o líquido original como base NET, sem descontar a reversão do teto', async () => {
    const { tx } = reviewTx([[{ total: '50.00' }], [], [providerPayment]]);
    await expect(computePayoutReviewBounds(tx, netPayout)).resolves.toMatchObject({
      basisCents: 14_700,
      ceilingCents: 7_350,
      referenceCents: 4_900,
    });
  });

  it('não inventa teto NET enquanto o provedor não informou o líquido original', async () => {
    const { tx } = reviewTx([
      [{ total: '50.00' }],
      [],
      [{ ...providerPayment, providerNetAmount: null }],
    ]);
    await expect(computePayoutReviewBounds(tx, netPayout)).resolves.toBeNull();
  });

  it('referência zero quando a perda do provedor levou o pagamento inteiro', async () => {
    const { tx } = reviewTx([[{ total: '0' }], [{ id: 'lost-credit' }], [providerPayment]]);
    await expect(computePayoutReviewBounds(tx, grossPayout)).resolves.toMatchObject({
      ceilingCents: 7_500,
      referenceCents: 0,
      fingerprint: { refundedCents: 0, loss: true },
    });
  });

  it('a decisão só continua válida para o estado de reversão que ela considerou', () => {
    const review = { reversalRefundedAmount: '50.00', reversalLoss: false };
    expect(reviewStillMatches(review, { refundedCents: 5_000, loss: false })).toBe(true);
    expect(reviewStillMatches(review, { refundedCents: 8_000, loss: false })).toBe(false);
    expect(reviewStillMatches(review, { refundedCents: 5_000, loss: true })).toBe(false);
  });
});

describe('registro versionado da revisão', () => {
  const input = {
    clinicId: CLINIC,
    payoutId: 'payout-1',
    amount: 60,
    reason: '  Atendimento realizado; devolução parcial acordada.  ',
    decidedBy: 'user-1',
  };

  it('grava a versão 1 com teto, referência e estado da reversão, e aplica o valor decidido', async () => {
    const { tx, inserted, updated } = reviewTx([
      [grossPayout],
      [{ total: '50.00' }],
      [],
      [providerPayment],
      [{ version: null }],
    ]);

    await expect(recordProfessionalPayoutReview(tx, input)).resolves.toEqual({
      payoutId: 'payout-1',
      version: 1,
      decidedAmount: 60,
      ceilingAmount: 75,
      referenceAmount: 50,
      decidedAt: '2026-10-07T15:00:00.000Z',
    });
    expect(inserted).toEqual([
      {
        clinicId: CLINIC,
        payoutId: 'payout-1',
        version: 1,
        ceilingAmount: '75.00',
        referenceAmount: '50.00',
        decidedAmount: '60.00',
        reason: 'Atendimento realizado; devolução parcial acordada.',
        reversalRefundedAmount: '50.00',
        reversalLoss: false,
        decidedBy: 'user-1',
      },
    ]);
    expect(updated[0]).toMatchObject({
      status: 'reviewed',
      basisAmount: '150.00',
      payoutAmount: '60.00',
    });
  });

  it('corrigir é registrar a versão seguinte, nunca reescrever a anterior', async () => {
    const { tx, inserted } = reviewTx([
      [{ ...grossPayout, status: 'reviewed' }],
      [{ total: '50.00' }],
      [],
      [providerPayment],
      [{ version: 2 }],
    ]);
    await expect(recordProfessionalPayoutReview(tx, input)).resolves.toMatchObject({
      version: 3,
    });
    expect(inserted[0]).toMatchObject({ version: 3 });
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it('recusa valor acima do cálculo original sem gravar nada', async () => {
    const { tx, inserted, updated } = reviewTx([
      [grossPayout],
      [{ total: '50.00' }],
      [],
      [providerPayment],
    ]);
    await expect(recordProfessionalPayoutReview(tx, { ...input, amount: 75.01 })).rejects.toThrow(
      /não pode passar de R\$\s*75,00/,
    );
    expect(inserted).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });

  it('aceita zero e o teto exato', async () => {
    for (const amount of [0, 75]) {
      const { tx, inserted } = reviewTx([
        [grossPayout],
        [{ total: '50.00' }],
        [],
        [providerPayment],
        [{ version: null }],
      ]);
      await recordProfessionalPayoutReview(tx, { ...input, amount });
      expect(inserted[0]).toMatchObject({ decidedAmount: amount.toFixed(2) });
    }
  });

  it('não revisa repasse que não está suspenso nem revisado', async () => {
    const { tx, inserted } = reviewTx([[{ ...grossPayout, status: 'calculated' }]]);
    await expect(recordProfessionalPayoutReview(tx, input)).rejects.toThrow(
      'Somente repasse suspenso',
    );
    expect(inserted).toHaveLength(0);
  });

  it('não encontra repasse de outra clínica e não grava nada', async () => {
    const { tx, inserted } = reviewTx([[]]);
    await expect(recordProfessionalPayoutReview(tx, input)).rejects.toThrow(
      'Repasse não encontrado nesta clínica.',
    );
    expect(inserted).toHaveLength(0);
  });

  it('bloqueia a revisão NET enquanto o líquido original é desconhecido', async () => {
    const { tx, inserted } = reviewTx([
      [netPayout],
      [{ total: '50.00' }],
      [],
      [{ ...providerPayment, providerNetAmount: null }],
    ]);
    await expect(recordProfessionalPayoutReview(tx, input)).rejects.toThrow('ainda não informou');
    expect(inserted).toHaveLength(0);
  });

  it('exige motivo com conteúdo mesmo se a action for contornada', async () => {
    const { tx, inserted } = reviewTx([[grossPayout], [{ total: '50.00' }], [], [providerPayment]]);
    await expect(recordProfessionalPayoutReview(tx, { ...input, reason: '  ok ' })).rejects.toThrow(
      'Informe o motivo',
    );
    expect(inserted).toHaveLength(0);
  });
});
