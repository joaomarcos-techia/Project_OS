/**
 * Projeção das despesas reais do provedor no ledger do Financial.
 *
 * O `patient_charge_id` é uma identidade opaca vinda de Payments. A UNIQUE do
 * banco torna a projeção idempotente sob reentrega at-least-once do outbox.
 */
import type { Tx } from '@/lib/db';

import { lancamentos, paymentTransactions } from '../schema';

export type ProviderExpenseKind = 'payment_processing_fee' | 'early_settlement_fee';

const DESCRIPTION: Record<ProviderExpenseKind, string> = {
  payment_processing_fee: 'Taxa Asaas — cobrança de paciente',
  early_settlement_fee: 'Taxa Asaas — antecipação de recebível',
};

export async function recordProviderExpense(
  tx: Tx,
  input: {
    clinicId: string;
    patientChargeId: string;
    kind: ProviderExpenseKind;
    amount: number;
    occurredAt: Date;
  },
): Promise<string | null> {
  const cents = Math.round(input.amount * 100);
  if (cents <= 0) return null;
  const amount = (cents / 100).toFixed(2);

  const [expense] = await tx
    .insert(lancamentos)
    .values({
      clinicId: input.clinicId,
      tipo: 'pagar',
      descricao: DESCRIPTION[input.kind],
      valor: amount,
      valorPago: amount,
      status: 'pago',
      paidAt: input.occurredAt,
      sourcePatientChargeId: input.patientChargeId,
      financialExpenseKind: input.kind,
      createdVia: 'auto',
    })
    .onConflictDoNothing()
    .returning({ id: lancamentos.id });
  if (!expense) return null;

  await tx.insert(paymentTransactions).values({
    clinicId: input.clinicId,
    lancamentoId: expense.id,
    kind: 'payment',
    amount,
    occurredAt: input.occurredAt,
  });
  return expense.id;
}

/** Ajuste posterior: um lançamento novo, nunca alteração da despesa original. */
export async function recordProviderFeeAdjustment(
  tx: Tx,
  input: {
    clinicId: string;
    patientChargeId: string;
    providerPaymentId: string;
    revision: number;
    sourceEventId: string;
    deltaCents: number;
    occurredAt: Date;
  },
): Promise<string | null> {
  if (!Number.isInteger(input.deltaCents) || input.revision < 2) {
    throw new Error('[financial] revisão de tarifa inválida');
  }
  if (input.deltaCents === 0) return null;
  const amount = (Math.abs(input.deltaCents) / 100).toFixed(2);
  const [adjustment] = await tx
    .insert(lancamentos)
    .values({
      clinicId: input.clinicId,
      tipo: input.deltaCents > 0 ? 'pagar' : 'receber',
      descricao:
        input.deltaCents > 0
          ? 'Ajuste de taxa Asaas — cobrança de paciente'
          : 'Reversão de taxa Asaas — cobrança de paciente',
      valor: amount,
      valorPago: amount,
      status: 'pago',
      paidAt: input.occurredAt,
      sourcePatientChargeId: input.patientChargeId,
      financialExpenseKind: 'payment_processing_fee_adjustment',
      providerEconomicsRevision: input.revision,
      sourceEventId: input.sourceEventId,
      providerPaymentId: input.providerPaymentId,
      createdVia: 'auto',
    })
    .onConflictDoNothing()
    .returning({ id: lancamentos.id });
  if (!adjustment) return null;
  await tx.insert(paymentTransactions).values({
    clinicId: input.clinicId,
    lancamentoId: adjustment.id,
    kind: 'payment',
    amount,
    occurredAt: input.occurredAt,
  });
  return adjustment.id;
}
