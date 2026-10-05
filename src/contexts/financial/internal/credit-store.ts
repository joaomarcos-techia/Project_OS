/**
 * Créditos do paciente (ADR-051 1.5b.1) — dinheiro que chegou ANTES da obrigação.
 *
 * **Invariantes que este arquivo existe para sustentar** (ADR-051 §2.1):
 *   1. `patient_charges` nunca é ledger financeiro — ele fica no Payments;
 *   2. todo dinheiro confirmado antes de existir um lançamento existe aqui;
 *   3. o lançamento do atendimento representa o valor BRUTO;
 *   4. `valorPago` só cresce por dinheiro comprovadamente recebido e alocado.
 *
 * A tabela é do FINANCIAL de propósito: quem lê os créditos no faturamento lê a
 * própria tabela, e é isso que mantém o Financial independente do modelo interno
 * do Payments.
 *
 * Idempotência por CONSTRAINT, não por `if (!existe)`: o worker do outbox entrega
 * at-least-once, e duas execuções simultâneas do mesmo evento não podem gerar
 * dois créditos — isso daria baixa em dobro por um pagamento só. Quem garante é
 * o `UNIQUE (clinic_id, patient_charge_id)` + `onConflictDoNothing`.
 */
import 'server-only';

import { and, eq, isNull, or, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import { patientCredits, type PatientCreditRow } from '../schema';

export interface GrantCreditInput {
  clinicId: string;
  patientChargeId: string;
  appointmentId: string;
  patientId: string | null;
  amount: number;
  providerGrossAmount: number | null;
  providerFeeAmount: number | null;
  providerNetAmount: number | null;
  earlySettlementFeeAmount: number | null;
  kind: 'deposit' | 'remaining_payment';
  paymentMethod: string | null;
  grantedAt: Date;
}

/**
 * Registra o crédito. Devolve o id criado, ou `null` quando o `UNIQUE` barrou —
 * outra entrega chegou primeiro, e isso é sucesso, não erro.
 */
export async function grantCredit(tx: Tx, input: GrantCreditInput): Promise<string | null> {
  const rows = await tx
    .insert(patientCredits)
    .values({
      clinicId: input.clinicId,
      patientId: input.patientId,
      appointmentId: input.appointmentId,
      patientChargeId: input.patientChargeId,
      amount: input.amount.toFixed(2),
      providerGrossAmount:
        input.providerGrossAmount == null ? null : input.providerGrossAmount.toFixed(2),
      providerFeeAmount:
        input.providerFeeAmount == null ? null : input.providerFeeAmount.toFixed(2),
      providerNetAmount:
        input.providerNetAmount == null ? null : input.providerNetAmount.toFixed(2),
      earlySettlementFeeAmount:
        input.earlySettlementFeeAmount == null ? null : input.earlySettlementFeeAmount.toFixed(2),
      providerEconomicsReconciledAt:
        input.providerGrossAmount != null &&
        input.providerFeeAmount != null &&
        input.providerNetAmount != null
          ? input.grantedAt
          : null,
      allocatedAmount: '0',
      kind: input.kind,
      status: 'available',
      paymentMethod: input.paymentMethod,
      grantedAt: input.grantedAt,
    })
    .onConflictDoNothing()
    .returning({ id: patientCredits.id });
  return rows[0]?.id ?? null;
}

export type ReconcileCreditEconomicsOutcome = 'reconciled' | 'already_reconciled' | 'not_found';

/**
 * Completa fatos do provedor que chegaram depois da baixa original. Não cria
 * crédito e não altera alocação: o dinheiro já existia; apenas bruto, taxa e
 * líquido passam a ter uma fonte autoritativa.
 */
export async function reconcileCreditEconomics(
  tx: Tx,
  input: {
    clinicId: string;
    patientChargeId: string;
    providerGrossAmount: number;
    providerFeeAmount: number | null;
    providerNetAmount: number;
    earlySettlementFeeAmount: number | null;
    paymentMethod: string | null;
    reconciledAt: Date;
  },
): Promise<ReconcileCreditEconomicsOutcome> {
  const [existing] = await tx
    .select({
      id: patientCredits.id,
      providerEconomicsReconciledAt: patientCredits.providerEconomicsReconciledAt,
    })
    .from(patientCredits)
    .where(
      and(
        eq(patientCredits.clinicId, input.clinicId),
        eq(patientCredits.patientChargeId, input.patientChargeId),
      ),
    )
    .limit(1);
  if (!existing) return 'not_found';
  if (existing.providerEconomicsReconciledAt) return 'already_reconciled';

  const updated = await tx
    .update(patientCredits)
    .set({
      providerGrossAmount: input.providerGrossAmount.toFixed(2),
      providerFeeAmount:
        input.providerFeeAmount == null ? null : input.providerFeeAmount.toFixed(2),
      providerNetAmount: input.providerNetAmount.toFixed(2),
      earlySettlementFeeAmount:
        input.earlySettlementFeeAmount == null ? null : input.earlySettlementFeeAmount.toFixed(2),
      providerEconomicsReconciledAt: input.providerFeeAmount === null ? null : input.reconciledAt,
      ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(patientCredits.id, existing.id), isNull(patientCredits.providerEconomicsReconciledAt)),
    )
    .returning({ id: patientCredits.id });
  return updated.length > 0 ? 'reconciled' : 'already_reconciled';
}

export type ReleaseOutcome = 'released' | 'not_found' | 'already_resolved';

/**
 * Tira o crédito de `available` sem alocá-lo: o dinheiro voltou ao paciente
 * (`refunded`) ou ficou com a clínica sem atendimento (`retained`).
 *
 * `WHERE status = 'available'` é a trava. Um crédito **já alocado** não pode ser
 * liberado: o dinheiro dele virou `valorPago` de um lançamento, e desfazer isso
 * por aqui deixaria o recebível quitado sem lastro. Esse caso é estorno de
 * lançamento, um caminho que já existe no Financial e tem regra própria.
 */
export async function releaseCredit(
  tx: Tx,
  input: {
    clinicId: string;
    patientChargeId: string;
    disposition: 'refunded' | 'retained';
    releasedAt: Date;
  },
): Promise<ReleaseOutcome> {
  const [existing] = await tx
    .select({ id: patientCredits.id, status: patientCredits.status })
    .from(patientCredits)
    .where(
      and(
        eq(patientCredits.clinicId, input.clinicId),
        eq(patientCredits.patientChargeId, input.patientChargeId),
      ),
    )
    .limit(1);
  // Cobrança paga ANTES da 1.5b.1 subir não tem crédito. Não é erro: é a janela
  // de deploy, e falhar aqui prenderia o evento num laço de retentativa.
  if (!existing) return 'not_found';
  if (existing.status !== 'available') return 'already_resolved';

  const updated = await tx
    .update(patientCredits)
    .set({
      status: input.disposition,
      releasedAt: input.releasedAt,
      updatedAt: sql`now()`,
    })
    .where(and(eq(patientCredits.id, existing.id), eq(patientCredits.status, 'available')))
    .returning({ id: patientCredits.id });
  return updated.length > 0 ? 'released' : 'already_resolved';
}

/**
 * Créditos disponíveis de um agendamento, mais antigo primeiro.
 *
 * Ordem por `granted_at` para a alocação ser determinística: com dois créditos e
 * um saldo que só cobre um, qual é consumido não pode depender da ordem que o
 * Postgres devolveu.
 */
export async function listAvailableCredits(
  tx: Tx,
  clinicId: string,
  appointmentId: string,
): Promise<PatientCreditRow[]> {
  return tx
    .select()
    .from(patientCredits)
    .where(
      and(
        eq(patientCredits.clinicId, clinicId),
        eq(patientCredits.appointmentId, appointmentId),
        eq(patientCredits.status, 'available'),
        or(isNull(patientCredits.disputeStatus), eq(patientCredits.disputeStatus, 'reversed')),
      ),
    )
    .orderBy(patientCredits.grantedAt);
}

/**
 * Marca o crédito como consumido por um lançamento.
 *
 * `WHERE status = 'available'` de novo: sob reentrega do `appointment.completed`,
 * o segundo passo não pode alocar o mesmo dinheiro duas vezes.
 */
export async function allocateCredit(
  tx: Tx,
  input: {
    clinicId: string;
    creditId: string;
    lancamentoId: string;
    /** Presente nos caminhos novos; nulo apenas para dados/smokes anteriores à 0092. */
    paymentTransactionId?: string;
    amount: number;
  },
): Promise<boolean> {
  const rows = await tx
    .update(patientCredits)
    .set({
      status: 'allocated',
      allocatedAmount: input.amount.toFixed(2),
      allocatedLancamentoId: input.lancamentoId,
      ...(input.paymentTransactionId
        ? { allocatedPaymentTransactionId: input.paymentTransactionId }
        : {}),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(patientCredits.id, input.creditId),
        eq(patientCredits.clinicId, input.clinicId),
        eq(patientCredits.status, 'available'),
        or(isNull(patientCredits.disputeStatus), eq(patientCredits.disputeStatus, 'reversed')),
      ),
    )
    .returning({ id: patientCredits.id });
  return rows.length > 0;
}
