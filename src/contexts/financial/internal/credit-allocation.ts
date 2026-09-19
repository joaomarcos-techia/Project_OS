/**
 * Aplica dinheiro recém-confirmado a um recebível que já existe (ADR-051 D4).
 *
 * O sinal normalmente chega antes do lançamento e fica `available` até o
 * atendimento. O restante percorre a ordem inversa: o lançamento já existe
 * quando o dinheiro chega. Este caso de uso fecha essa segunda metade sem criar
 * outro recebível e mantém crédito, lançamento, ledger e evento na mesma TX.
 */
import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { publishEvent } from '@/lib/outbox/publish';

import { FINANCIAL_EVENTS } from '../events';
import { calcStatusPagamento, round2 } from '../logic';
import { lancamentos, paymentTransactions } from '../schema';
import { allocateCredit } from './credit-store';

export type ApplyCreditOutcome =
  | { outcome: 'deferred'; reason: 'receivable_not_open' | 'no_balance' }
  | {
      outcome: 'applied';
      lancamentoId: string;
      transactionId: string;
      appliedAmount: number;
      unappliedAmount: number;
      status: 'parcial' | 'pago';
    };

export async function applyCreditToExistingReceivable(
  tx: Tx,
  input: {
    clinicId: string;
    appointmentId: string;
    creditId: string;
    patientChargeId: string;
    amount: number;
    paymentMethod: string | null;
    paidAt: Date;
    correlationId: string;
  },
): Promise<ApplyCreditOutcome> {
  const [receivable] = await tx
    .select({
      id: lancamentos.id,
      valor: lancamentos.valor,
      valorPago: lancamentos.valorPago,
    })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.clinicId, input.clinicId),
        eq(lancamentos.appointmentId, input.appointmentId),
        eq(lancamentos.tipo, 'receber'),
        inArray(lancamentos.status, ['pendente', 'parcial']),
      ),
    )
    .for('update')
    .limit(1);

  if (!receivable) return { outcome: 'deferred', reason: 'receivable_not_open' };

  const valor = round2(Number(receivable.valor));
  const valorPago = round2(Number(receivable.valorPago));
  const balance = round2(valor - valorPago);
  if (balance <= 0) return { outcome: 'deferred', reason: 'no_balance' };

  // Se houve uma baixa manual depois de o link nascer, aplica somente o saldo
  // ainda aberto. O excesso continua explícito no crédito (`amount` maior que
  // `allocated_amount`) em vez de inflar `valor_pago` acima do recebível.
  const appliedAmount = Math.min(round2(input.amount), balance);
  const unappliedAmount = round2(input.amount - appliedAmount);
  const newPaid = round2(valorPago + appliedAmount);
  const newStatus = calcStatusPagamento(valor, newPaid);

  const [payment] = await tx
    .insert(paymentTransactions)
    .values({
      clinicId: input.clinicId,
      lancamentoId: receivable.id,
      kind: 'payment',
      amount: appliedAmount.toFixed(2),
      paymentMethod: input.paymentMethod,
      occurredAt: input.paidAt,
    })
    .returning({ id: paymentTransactions.id });
  if (!payment) throw new Error(`ledger não registrou a baixa do crédito ${input.creditId}`);

  const consumed = await allocateCredit(tx, {
    clinicId: input.clinicId,
    creditId: input.creditId,
    lancamentoId: receivable.id,
    paymentTransactionId: payment.id,
    amount: appliedAmount,
  });
  if (!consumed) {
    // Tudo roda na mesma TX: o INSERT do ledger e o UPDATE do recebível também
    // caem se outra entrega já tiver consumido o crédito.
    throw new Error(`crédito ${input.creditId} não estava disponível para alocação`);
  }

  const updated = await tx
    .update(lancamentos)
    .set({
      valorPago: newPaid.toFixed(2),
      status: newStatus,
      updatedAt: sql`now()`,
      ...(newStatus === 'pago' ? { paidAt: input.paidAt } : {}),
    })
    .where(and(eq(lancamentos.id, receivable.id), eq(lancamentos.clinicId, input.clinicId)))
    .returning({ id: lancamentos.id });
  if (updated.length === 0) {
    throw new Error(`lançamento ${receivable.id} desapareceu durante a alocação`);
  }

  await publishEvent(tx, {
    clinicId: input.clinicId,
    eventType: FINANCIAL_EVENTS.LANCAMENTO_PAID,
    payload: {
      lancamentoId: receivable.id,
      transactionId: payment.id,
      clinicId: input.clinicId,
      valor,
      amount: appliedAmount,
      valorPago: newPaid,
      status: newStatus,
      paymentMethod: input.paymentMethod,
    },
    idempotencyKey: `patient-credit-applied:${input.patientChargeId}`,
    correlationId: input.correlationId,
  });

  return {
    outcome: 'applied',
    lancamentoId: receivable.id,
    transactionId: payment.id,
    appliedAmount,
    unappliedAmount,
    status: newStatus,
  };
}
