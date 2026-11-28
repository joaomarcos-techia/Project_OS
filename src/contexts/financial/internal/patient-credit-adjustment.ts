/** Ledger complementar do crédito do paciente (D50/D27). */
import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

/* eslint-disable boundaries/element-types -- contrato público é a fronteira Payments -> Financial. */
import type { PatientPaymentRiskChangedPayload } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

import { statusAoCriar } from '../logic';
import {
  faturamentoPendencias,
  lancamentos,
  patientCreditAdjustments,
  patientCredits,
  paymentTransactions,
} from '../schema';

export const EXCESS_REFUND_PENDING_REASON =
  'Pagamento acima do saldo aguardando estorno do excedente.';
export const CHARGEBACK_PENDING_REASON =
  'Pagamento em disputa no Asaas; não cobrar novamente até o desfecho.';
export const CHARGEBACK_LOST_REASON =
  'Chargeback perdido: saldo financeiro reaberto para revisão humana.';
export const CASH_UNDONE_REASON =
  'Recebimento em dinheiro desfeito: saldo financeiro reaberto para revisão humana.';
export const PAYMENT_REVERSAL_MANUAL_REASON =
  'Reversão exige conciliação manual por ausência de vínculo financeiro histórico.';
export const EXTERNAL_REFUND_REASON =
  'Estorno feito direto no Asaas: baixa compensada e saldo reaberto para revisão humana. Não cobrar novamente sem decisão.';
const EXTERNAL_REFUND_REVIEW_DETAIL = {
  dispute: 'há disputa (chargeback) nesta cobrança',
  open_refund_intent: 'há devolução pedida pelo Qoro ainda sem confirmação',
  amount_mismatch: 'o valor da cobrança no Asaas difere do registrado no Qoro',
  amount_exceeds: 'o Asaas devolveu mais que o valor da cobrança',
} as const;
export type ExternalRefundReviewCode = keyof typeof EXTERNAL_REFUND_REVIEW_DETAIL;
export function externalRefundReviewReason(code: ExternalRefundReviewCode): string {
  return `Estorno no Asaas sem conciliação automática (${EXTERNAL_REFUND_REVIEW_DETAIL[code]}): revisar antes de cobrar ou compensar.`;
}

async function upsertFinancialPending(
  tx: Tx,
  input: { clinicId: string; appointmentId: string; reason: string; amount: number },
): Promise<void> {
  await tx
    .insert(faturamentoPendencias)
    .values({
      clinicId: input.clinicId,
      appointmentId: input.appointmentId,
      motivo: input.reason,
      valor: input.amount.toFixed(2),
      status: 'aberta',
    })
    .onConflictDoUpdate({
      target: faturamentoPendencias.appointmentId,
      set: {
        motivo: input.reason,
        valor: input.amount.toFixed(2),
        status: 'aberta',
        resolvedAt: null,
        resolvedBy: null,
      },
    });
}

export async function recordExcessRefund(
  tx: Tx,
  input: {
    clinicId: string;
    appointmentId: string;
    patientChargeId: string;
    amount: number;
    sourceEventId: string;
    occurredAt: Date;
  },
): Promise<'recorded' | 'duplicate'> {
  const [credit] = await tx
    .select({
      id: patientCredits.id,
      amount: patientCredits.amount,
      allocatedAmount: patientCredits.allocatedAmount,
      unallocatedReversedAmount: patientCredits.unallocatedReversedAmount,
    })
    .from(patientCredits)
    .where(
      and(
        eq(patientCredits.clinicId, input.clinicId),
        eq(patientCredits.patientChargeId, input.patientChargeId),
      ),
    )
    .for('update')
    .limit(1);
  if (!credit) throw new Error(`crédito da cobrança ${input.patientChargeId} não encontrado`);

  const inserted = await tx
    .insert(patientCreditAdjustments)
    .values({
      clinicId: input.clinicId,
      patientCreditId: credit.id,
      patientChargeId: input.patientChargeId,
      kind: 'excess_refund',
      amount: input.amount.toFixed(2),
      sourceEventId: input.sourceEventId,
      occurredAt: input.occurredAt,
    })
    .onConflictDoNothing()
    .returning({ id: patientCreditAdjustments.id });
  if (inserted.length === 0) return 'duplicate';

  const available = Number(
    (
      Number(credit.amount) -
      Number(credit.allocatedAmount) -
      Number(credit.unallocatedReversedAmount)
    ).toFixed(2),
  );
  if (input.amount > available + 1e-9) {
    throw new Error(
      `estorno excedente ${input.amount.toFixed(2)} supera saldo não alocado ${available.toFixed(2)}`,
    );
  }
  const nextReversed = Number((Number(credit.unallocatedReversedAmount) + input.amount).toFixed(2));
  await tx
    .update(patientCredits)
    .set({ unallocatedReversedAmount: nextReversed.toFixed(2), updatedAt: sql`now()` })
    .where(and(eq(patientCredits.id, credit.id), eq(patientCredits.clinicId, input.clinicId)));

  await tx
    .update(faturamentoPendencias)
    .set({ status: 'resolvida', resolvedAt: input.occurredAt })
    .where(
      and(
        eq(faturamentoPendencias.clinicId, input.clinicId),
        eq(faturamentoPendencias.appointmentId, input.appointmentId),
        eq(faturamentoPendencias.motivo, EXCESS_REFUND_PENDING_REASON),
      ),
    );
  return 'recorded';
}

export type PatientPaymentRiskResult =
  | 'dispute_opened'
  | 'dispute_reversed'
  | 'loss_recorded'
  | 'duplicate'
  | 'manual_review';

/**
 * Projeta o fato observado pelo Payments no ledger do Financial.
 *
 * A consulta/prontuário nunca é alterada. Perda já alocada gera uma transação
 * `refund` vinculada à baixa original e reduz apenas `valorPago`; perda ainda
 * não alocada fica registrada no ledger complementar do crédito.
 */
export async function applyPatientPaymentRisk(
  tx: Tx,
  input: {
    clinicId: string;
    payload: PatientPaymentRiskChangedPayload;
    sourceEventId: string;
  },
): Promise<PatientPaymentRiskResult> {
  const { clinicId, payload, sourceEventId } = input;
  const credit = await lockCreditOfCharge(tx, clinicId, payload.chargeId);

  if (
    payload.state === 'requested' ||
    payload.state === 'in_dispute' ||
    payload.state === 'awaiting_reversal'
  ) {
    await tx
      .update(patientCredits)
      .set({ disputeStatus: payload.state, updatedAt: sql`now()` })
      .where(and(eq(patientCredits.id, credit.id), eq(patientCredits.clinicId, clinicId)));
    await upsertFinancialPending(tx, {
      clinicId,
      appointmentId: payload.appointmentId,
      reason: CHARGEBACK_PENDING_REASON,
      amount: payload.amount,
    });
    return 'dispute_opened';
  }

  if (payload.state === 'reversed') {
    await tx
      .update(patientCredits)
      .set({ disputeStatus: 'reversed', updatedAt: sql`now()` })
      .where(and(eq(patientCredits.id, credit.id), eq(patientCredits.clinicId, clinicId)));
    await tx
      .update(faturamentoPendencias)
      .set({ status: 'resolvida', resolvedAt: new Date(payload.changedAt) })
      .where(
        and(
          eq(faturamentoPendencias.clinicId, clinicId),
          eq(faturamentoPendencias.appointmentId, payload.appointmentId),
          eq(faturamentoPendencias.motivo, CHARGEBACK_PENDING_REASON),
        ),
      );
    return 'dispute_reversed';
  }

  return applyMoneyLoss(tx, {
    clinicId,
    appointmentId: payload.appointmentId,
    chargeId: payload.chargeId,
    credit,
    requested: payload.amount,
    kind: payload.state === 'cash_undone' ? 'cash_undone' : 'chargeback_loss',
    sourceEventId,
    occurredAt: new Date(payload.changedAt),
    ledgerReason:
      payload.state === 'cash_undone'
        ? 'Recebimento em dinheiro desfeito no Asaas.'
        : 'Chargeback perdido no Asaas.',
    pendingReason: payload.state === 'cash_undone' ? CASH_UNDONE_REASON : CHARGEBACK_LOST_REASON,
    disputeStatus: payload.state,
  });
}

type LockedCredit = {
  id: string;
  amount: string;
  allocatedAmount: string;
  allocatedLancamentoId: string | null;
  allocatedPaymentTransactionId: string | null;
  unallocatedReversedAmount: string;
  allocatedReversedAmount: string;
  status: string;
};

/** O crédito da cobrança, travado. Toda compensação passa por ele (uma de cada vez). */
async function lockCreditOfCharge(
  tx: Tx,
  clinicId: string,
  chargeId: string,
): Promise<LockedCredit> {
  const [credit] = await tx
    .select({
      id: patientCredits.id,
      amount: patientCredits.amount,
      allocatedAmount: patientCredits.allocatedAmount,
      allocatedLancamentoId: patientCredits.allocatedLancamentoId,
      allocatedPaymentTransactionId: patientCredits.allocatedPaymentTransactionId,
      unallocatedReversedAmount: patientCredits.unallocatedReversedAmount,
      allocatedReversedAmount: patientCredits.allocatedReversedAmount,
      status: patientCredits.status,
    })
    .from(patientCredits)
    .where(and(eq(patientCredits.clinicId, clinicId), eq(patientCredits.patientChargeId, chargeId)))
    .for('update')
    .limit(1);
  if (!credit) throw new Error(`crédito da cobrança ${chargeId} não encontrado`);
  return credit;
}

/**
 * Dinheiro que SAIU depois da baixa (chargeback perdido, dinheiro desfeito, estorno feito no
 * Asaas). A baixa original nunca é apagada: a parte já alocada vira uma transação `refund`
 * vinculada a ela (`original_payment_id`) e reduz só `valorPago`; a parte ainda não
 * alocada fica no ledger complementar do crédito. Idempotente pelo evento de origem
 * (UNIQUE clinic_id + source_event_id) e limitada ao que ainda está disponível.
 */
async function applyMoneyLoss(
  tx: Tx,
  input: {
    clinicId: string;
    appointmentId: string;
    chargeId: string;
    credit: LockedCredit;
    requested: number;
    kind: 'chargeback_loss' | 'cash_undone' | 'external_refund';
    sourceEventId: string;
    occurredAt: Date;
    ledgerReason: string;
    pendingReason: string;
    /** Só a disputa (D27) projeta estado; o estorno externo não mexe nele. */
    disputeStatus?: PatientPaymentRiskChangedPayload['state'];
  },
): Promise<'loss_recorded' | 'duplicate' | 'manual_review'> {
  const { clinicId, credit } = input;
  const dispute = input.disputeStatus ? { disputeStatus: input.disputeStatus } : null;
  const amount = Number(credit.amount);
  const allocated = Number(credit.allocatedAmount);
  const unallocatedReversed = Number(credit.unallocatedReversedAmount);
  const allocatedReversed = Number(credit.allocatedReversedAmount);
  const unallocatedAvailable = Number(
    Math.max(0, amount - allocated - unallocatedReversed).toFixed(2),
  );
  const allocatedAvailable = Number(Math.max(0, allocated - allocatedReversed).toFixed(2));
  const lossAmount = Number(
    Math.min(input.requested, unallocatedAvailable + allocatedAvailable).toFixed(2),
  );

  if (lossAmount <= 0) {
    if (dispute) {
      await tx
        .update(patientCredits)
        .set({ ...dispute, updatedAt: sql`now()` })
        .where(and(eq(patientCredits.id, credit.id), eq(patientCredits.clinicId, clinicId)));
    }
    return 'duplicate';
  }

  const unallocatedLoss = Number(Math.min(lossAmount, unallocatedAvailable).toFixed(2));
  const allocatedLoss = Number((lossAmount - unallocatedLoss).toFixed(2));
  if (
    allocatedLoss > 0 &&
    (!credit.allocatedLancamentoId || !credit.allocatedPaymentTransactionId)
  ) {
    if (dispute) {
      await tx
        .update(patientCredits)
        .set({ ...dispute, updatedAt: sql`now()` })
        .where(and(eq(patientCredits.id, credit.id), eq(patientCredits.clinicId, clinicId)));
    }
    await upsertFinancialPending(tx, {
      clinicId,
      appointmentId: input.appointmentId,
      reason: PAYMENT_REVERSAL_MANUAL_REASON,
      amount: allocatedLoss,
    });
    return 'manual_review';
  }

  const inserted = await tx
    .insert(patientCreditAdjustments)
    .values({
      clinicId,
      patientCreditId: credit.id,
      patientChargeId: input.chargeId,
      kind: input.kind,
      amount: lossAmount.toFixed(2),
      sourceEventId: input.sourceEventId,
      occurredAt: input.occurredAt,
    })
    .onConflictDoNothing()
    .returning({ id: patientCreditAdjustments.id });
  if (inserted.length === 0) return 'duplicate';

  if (allocatedLoss > 0) {
    const [receivable] = await tx
      .select({
        id: lancamentos.id,
        valor: lancamentos.valor,
        valorPago: lancamentos.valorPago,
        status: lancamentos.status,
      })
      .from(lancamentos)
      .where(
        and(eq(lancamentos.id, credit.allocatedLancamentoId!), eq(lancamentos.clinicId, clinicId)),
      )
      .for('update')
      .limit(1);
    if (!receivable || receivable.status === 'cancelado' || receivable.status === 'estornado') {
      throw new Error(`recebível alocado do crédito ${credit.id} não pode ser recomposto`);
    }

    const nextPaid = Number(Math.max(0, Number(receivable.valorPago) - allocatedLoss).toFixed(2));
    await tx.insert(paymentTransactions).values({
      clinicId,
      lancamentoId: receivable.id,
      kind: 'refund',
      amount: allocatedLoss.toFixed(2),
      originalPaymentId: credit.allocatedPaymentTransactionId!,
      reason: input.ledgerReason,
      occurredAt: input.occurredAt,
    });
    await tx
      .update(lancamentos)
      .set({
        valorPago: nextPaid.toFixed(2),
        status: statusAoCriar(Number(receivable.valor), nextPaid),
        paidAt:
          nextPaid >= Number(receivable.valor) ? sql`coalesce(${lancamentos.paidAt}, now())` : null,
        updatedAt: sql`now()`,
      })
      .where(and(eq(lancamentos.id, receivable.id), eq(lancamentos.clinicId, clinicId)));
  }

  await tx
    .update(patientCredits)
    .set({
      unallocatedReversedAmount: (unallocatedReversed + unallocatedLoss).toFixed(2),
      allocatedReversedAmount: (allocatedReversed + allocatedLoss).toFixed(2),
      ...(dispute ?? {}),
      ...(allocated === 0 && unallocatedLoss >= amount
        ? { status: 'refunded' as const, releasedAt: input.occurredAt }
        : {}),
      updatedAt: sql`now()`,
    })
    .where(and(eq(patientCredits.id, credit.id), eq(patientCredits.clinicId, clinicId)));

  await upsertFinancialPending(tx, {
    clinicId,
    appointmentId: input.appointmentId,
    reason: input.pendingReason,
    amount: lossAmount,
  });
  return 'loss_recorded';
}

/** R54: o Pagamentos confirmou no Asaas uma devolução feita fora do Qoro. */
export async function recordExternalRefund(
  tx: Tx,
  input: {
    clinicId: string;
    appointmentId: string;
    patientChargeId: string;
    amount: number;
    sourceEventId: string;
    occurredAt: Date;
  },
): Promise<'loss_recorded' | 'duplicate' | 'manual_review'> {
  const credit = await lockCreditOfCharge(tx, input.clinicId, input.patientChargeId);
  return applyMoneyLoss(tx, {
    clinicId: input.clinicId,
    appointmentId: input.appointmentId,
    chargeId: input.patientChargeId,
    credit,
    requested: input.amount,
    kind: 'external_refund',
    sourceEventId: input.sourceEventId,
    occurredAt: input.occurredAt,
    ledgerReason: 'Estorno feito direto no Asaas.',
    pendingReason: EXTERNAL_REFUND_REASON,
  });
}

/** R54: devolução no Asaas que não dá para atribuir sozinho — só a pendência, nada compensado. */
export async function openExternalRefundReview(
  tx: Tx,
  input: {
    clinicId: string;
    appointmentId: string;
    amount: number;
    reason: ExternalRefundReviewCode;
  },
): Promise<void> {
  await upsertFinancialPending(tx, {
    clinicId: input.clinicId,
    appointmentId: input.appointmentId,
    reason: externalRefundReviewReason(input.reason),
    amount: input.amount,
  });
}
