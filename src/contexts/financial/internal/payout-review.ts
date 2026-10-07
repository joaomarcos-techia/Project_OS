import 'server-only';

import { and, desc, eq, inArray, max, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { formatBRL } from '@/lib/format';

import { FinancialValidationError } from '../errors';
import { calculateProfessionalPayout, centsToMoney, moneyToCents } from '../payout';
import {
  lancamentos,
  patientCredits,
  paymentTransactions,
  professionalPayoutReviews,
  professionalPayouts,
  type ProfessionalPayoutRow,
} from '../schema';

/**
 * Revisão humana do repasse suspenso após estorno ou perda (decisão de produto
 * de 07/10/2026). Quem tem MANAGE_FINANCIAL decide um valor entre zero e o que a
 * regra produzia sobre o pagamento original; a proporção do valor que ficou com
 * a clínica é só referência. Cada decisão é uma versão append-only.
 */

/** Estado da reversão que a decisão humana considerou. */
export interface ReversalFingerprint {
  refundedCents: number;
  loss: boolean;
}

export async function collectReversalFingerprint(
  tx: Tx,
  input: { clinicId: string; appointmentId: string },
): Promise<ReversalFingerprint> {
  const [refunds] = await tx
    .select({ total: sql<string | null>`coalesce(sum(${paymentTransactions.amount}), 0)` })
    .from(paymentTransactions)
    .innerJoin(lancamentos, eq(lancamentos.id, paymentTransactions.lancamentoId))
    .where(
      and(
        eq(paymentTransactions.clinicId, input.clinicId),
        eq(lancamentos.clinicId, input.clinicId),
        eq(lancamentos.appointmentId, input.appointmentId),
        eq(lancamentos.tipo, 'receber'),
        eq(paymentTransactions.kind, 'refund'),
      ),
    );
  const [loss] = await tx
    .select({ id: patientCredits.id })
    .from(patientCredits)
    .where(
      and(
        eq(patientCredits.clinicId, input.clinicId),
        eq(patientCredits.appointmentId, input.appointmentId),
        inArray(patientCredits.disputeStatus, ['lost', 'cash_undone']),
      ),
    )
    .limit(1);
  return { refundedCents: moneyToCents(Number(refunds?.total ?? 0)), loss: Boolean(loss) };
}

/** Pagamentos originais do atendimento, sem descontar reversões. */
async function collectOriginalPayments(
  tx: Tx,
  input: { clinicId: string; appointmentId: string },
): Promise<{ paidCents: number; netCents: number | null }> {
  const rows = await tx
    .select({
      transactionAmount: paymentTransactions.amount,
      createdBy: paymentTransactions.createdBy,
      creditAmount: patientCredits.amount,
      providerGrossAmount: patientCredits.providerGrossAmount,
      providerNetAmount: patientCredits.providerNetAmount,
    })
    .from(paymentTransactions)
    .innerJoin(lancamentos, eq(lancamentos.id, paymentTransactions.lancamentoId))
    .leftJoin(
      patientCredits,
      eq(patientCredits.allocatedPaymentTransactionId, paymentTransactions.id),
    )
    .where(
      and(
        eq(paymentTransactions.clinicId, input.clinicId),
        eq(lancamentos.appointmentId, input.appointmentId),
        eq(lancamentos.tipo, 'receber'),
        eq(paymentTransactions.kind, 'payment'),
      ),
    );

  let paidCents = 0;
  let netCents = 0;
  let netKnown = rows.length > 0;
  for (const row of rows) {
    const transactionCents = moneyToCents(Number(row.transactionAmount));
    paidCents += transactionCents;
    if (row.creditAmount === null) {
      // Baixa manual não tem tarifa; automática legada sem vínculo fica desconhecida.
      if (row.createdBy === null) netKnown = false;
      else netCents += transactionCents;
      continue;
    }
    if (row.providerGrossAmount === null || row.providerNetAmount === null) {
      netKnown = false;
      continue;
    }
    const creditGrossCents = moneyToCents(Number(row.providerGrossAmount));
    if (creditGrossCents === 0) {
      netKnown = false;
      continue;
    }
    netCents += Math.round(
      moneyToCents(Number(row.providerNetAmount)) * (transactionCents / creditGrossCents),
    );
  }
  return { paidCents, netCents: netKnown ? netCents : null };
}

export interface PayoutReviewBounds {
  /** Base da regra sobre o pagamento original (bruto ou líquido original). */
  basisCents: number;
  /** Teto: o que a regra produzia antes da reversão. */
  ceilingCents: number;
  /** Proporção do teto pelo dinheiro que ficou com a clínica; nunca aplicada sozinha. */
  referenceCents: number | null;
  fingerprint: ReversalFingerprint;
}

/** `null` quando a base NET ainda depende de fatos do provedor. */
export async function computePayoutReviewBounds(
  tx: Tx,
  payout: Pick<
    ProfessionalPayoutRow,
    | 'clinicId'
    | 'appointmentId'
    | 'calculationBasis'
    | 'grossAmount'
    | 'ruleKind'
    | 'rulePercentage'
    | 'ruleFixedAmount'
  >,
): Promise<PayoutReviewBounds | null> {
  const scope = { clinicId: payout.clinicId, appointmentId: payout.appointmentId };
  const fingerprint = await collectReversalFingerprint(tx, scope);
  const original = await collectOriginalPayments(tx, scope);
  const rule =
    payout.ruleKind === 'percentage'
      ? { kind: 'percentage' as const, percentage: Number(payout.rulePercentage) }
      : { kind: 'fixed' as const, fixedAmount: Number(payout.ruleFixedAmount) };
  const calculation = calculateProfessionalPayout({
    grossAmount: Number(payout.grossAmount),
    netAmount: original.netCents === null ? null : centsToMoney(original.netCents),
    payoutBasis: payout.calculationBasis,
    rule,
  });
  if (calculation.status !== 'calculated') return null;

  const ceilingCents = moneyToCents(calculation.payoutAmount);
  let referenceCents: number | null = null;
  if (fingerprint.loss) {
    referenceCents = 0;
  } else if (original.paidCents > 0) {
    const keptCents = Math.max(0, original.paidCents - fingerprint.refundedCents);
    referenceCents = Math.min(
      ceilingCents,
      Math.round((ceilingCents * keptCents) / original.paidCents),
    );
  }
  return {
    basisCents: moneyToCents(calculation.basisAmount),
    ceilingCents,
    referenceCents,
    fingerprint,
  };
}

export interface ProfessionalPayoutReviewResult {
  payoutId: string;
  version: number;
  decidedAmount: number;
  ceilingAmount: number;
  referenceAmount: number | null;
  decidedAt: string;
}

/**
 * Grava a versão seguinte sob o lock do repasse. O motivo fica somente na
 * versão; o retorno (que vira `after` da auditoria) leva apenas valores.
 */
export async function recordProfessionalPayoutReview(
  tx: Tx,
  input: {
    clinicId: string;
    payoutId: string;
    amount: number;
    reason: string;
    decidedBy: string;
  },
): Promise<ProfessionalPayoutReviewResult> {
  const [payout] = await tx
    .select()
    .from(professionalPayouts)
    .where(
      and(
        eq(professionalPayouts.id, input.payoutId),
        eq(professionalPayouts.clinicId, input.clinicId),
      ),
    )
    .for('update')
    .limit(1);
  if (!payout) throw new FinancialValidationError('Repasse não encontrado nesta clínica.');
  if (payout.status !== 'cancelled' && payout.status !== 'reviewed') {
    throw new FinancialValidationError(
      'Somente repasse suspenso após estorno ou perda pode ser revisado.',
    );
  }

  const bounds = await computePayoutReviewBounds(tx, payout);
  if (!bounds) {
    throw new FinancialValidationError(
      'O teto deste repasse depende do líquido do pagamento original, que o provedor ainda não informou.',
    );
  }
  const amountCents = moneyToCents(input.amount);
  if (amountCents > bounds.ceilingCents) {
    throw new FinancialValidationError(
      `O valor revisado não pode passar de ${formatBRL(centsToMoney(bounds.ceilingCents))}, o cálculo original.`,
    );
  }
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new FinancialValidationError('Informe o motivo da revisão (3 a 500 caracteres).');
  }

  const [last] = await tx
    .select({ version: max(professionalPayoutReviews.version) })
    .from(professionalPayoutReviews)
    .where(
      and(
        eq(professionalPayoutReviews.clinicId, input.clinicId),
        eq(professionalPayoutReviews.payoutId, payout.id),
      ),
    );
  const version = (last?.version ?? 0) + 1;
  const ceilingAmount = centsToMoney(bounds.ceilingCents);
  const referenceAmount =
    bounds.referenceCents === null ? null : centsToMoney(bounds.referenceCents);
  const decidedAmount = centsToMoney(amountCents);

  const [review] = await tx
    .insert(professionalPayoutReviews)
    .values({
      clinicId: input.clinicId,
      payoutId: payout.id,
      version,
      ceilingAmount: ceilingAmount.toFixed(2),
      referenceAmount: referenceAmount === null ? null : referenceAmount.toFixed(2),
      decidedAmount: decidedAmount.toFixed(2),
      reason,
      reversalRefundedAmount: centsToMoney(bounds.fingerprint.refundedCents).toFixed(2),
      reversalLoss: bounds.fingerprint.loss,
      decidedBy: input.decidedBy,
    })
    .returning({ createdAt: professionalPayoutReviews.createdAt });
  if (!review) throw new Error('revisão de repasse não foi persistida');

  await tx
    .update(professionalPayouts)
    .set({
      basisAmount: centsToMoney(bounds.basisCents).toFixed(2),
      payoutAmount: decidedAmount.toFixed(2),
      status: 'reviewed',
      calculatedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(professionalPayouts.id, payout.id), eq(professionalPayouts.clinicId, input.clinicId)),
    );

  return {
    payoutId: payout.id,
    version,
    decidedAmount,
    ceilingAmount,
    referenceAmount,
    decidedAt: new Date(review.createdAt).toISOString(),
  };
}

interface ReversalFingerprintRow {
  reversalRefundedAmount: string;
  reversalLoss: boolean;
}

/** Última versão decidida para cada repasse informado. */
export async function listLatestPayoutReviews(
  tx: Tx,
  clinicId: string,
  payoutIds: readonly string[],
): Promise<
  Map<
    string,
    { version: number; decidedAmount: number; decidedAt: string } & ReversalFingerprintRow
  >
> {
  const latest = new Map<
    string,
    { version: number; decidedAmount: number; decidedAt: string } & ReversalFingerprintRow
  >();
  if (payoutIds.length === 0) return latest;
  const rows = await tx
    .select({
      payoutId: professionalPayoutReviews.payoutId,
      version: professionalPayoutReviews.version,
      decidedAmount: professionalPayoutReviews.decidedAmount,
      createdAt: professionalPayoutReviews.createdAt,
      reversalRefundedAmount: professionalPayoutReviews.reversalRefundedAmount,
      reversalLoss: professionalPayoutReviews.reversalLoss,
    })
    .from(professionalPayoutReviews)
    .where(
      and(
        eq(professionalPayoutReviews.clinicId, clinicId),
        inArray(professionalPayoutReviews.payoutId, [...payoutIds]),
      ),
    )
    .orderBy(professionalPayoutReviews.payoutId, desc(professionalPayoutReviews.version));
  for (const row of rows) {
    if (latest.has(row.payoutId)) continue;
    latest.set(row.payoutId, {
      version: row.version,
      decidedAmount: Number(row.decidedAmount),
      decidedAt: new Date(row.createdAt).toISOString(),
      reversalRefundedAmount: row.reversalRefundedAmount,
      reversalLoss: row.reversalLoss,
    });
  }
  return latest;
}

/** A decisão vale só para o estado de reversão que ela considerou. */
export function reviewStillMatches(
  review: ReversalFingerprintRow,
  current: ReversalFingerprint,
): boolean {
  return (
    moneyToCents(Number(review.reversalRefundedAmount)) === current.refundedCents &&
    review.reversalLoss === current.loss
  );
}
