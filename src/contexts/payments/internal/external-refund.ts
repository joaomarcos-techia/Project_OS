/**
 * R54 — estorno feito DIRETO no Asaas, sem intenção do Qoro.
 *
 * Até aqui o webhook de estorno só confirmava devoluções que o Qoro tinha pedido (D50/D77:
 * a intenção é persistida antes e o read-back a confirma). Uma devolução feita pela clínica
 * no painel do Asaas, sem intenção, deixava a baixa inteira no livro.
 *
 * Fonte da verdade: os estornos `DONE` de `GET /payments/{id}/refunds`, lidos com a chave DA
 * CLÍNICA (o corpo do webhook só acorda; quem tem o token não faz a API mentir). Nada é
 * reconhecido por valor e data, nem porque alguém disse que devolveu.
 *
 * Atribuição: do total devolvido no Asaas sai o que as intenções CONFIRMADAS do Qoro já
 * explicam; o resto é externo. Havendo intenção ainda aberta, a atribuição é ambígua e vai
 * para revisão humana (nunca se compensa duas vezes o mesmo dinheiro).
 *
 * Idempotência: o item de estorno pode vir sem id, então a chave é o patamar acumulado
 * devolvido por fora do Qoro (`patient_external_refunds.external_total`, UNIQUE por cobrança),
 * com a linha da cobrança travada. Reentrega, varredura e instância concorrente caem no
 * mesmo patamar; um estorno parcial novo cria o patamar seguinte com só a diferença.
 *
 * Efeitos (mesma transação): evidência só de inclusão, cobrança `refunded` quando a
 * devolução cobre o valor, evento para o Financial (que compensa a baixa original sem
 * apagá-la, abre a pendência para revisão e recalcula o repasse) e auditoria com ator de
 * sistema. Nenhuma cobrança nova é criada: cobrar de novo exige decisão humana.
 */
import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';
import { publishEvent } from '@/lib/outbox/publish';
import type { ProviderPayment, ProviderRefund } from '@/lib/payments/asaas';

import {
  PAYMENTS_EVENTS,
  type ExternalRefundRecognizedPayload,
  type ExternalRefundReviewRequiredPayload,
} from '../events';
import {
  patientCharges,
  patientExternalRefunds,
  patientRefundIntents,
  type ExternalRefundEvidenceItem,
} from '../schema';
import { confirmedRefundTotal } from './excess-refund';

const EPS = 0.004;
const round2 = (n: number): number => Math.round(n * 100) / 100;
/** Estados do pagamento que dizem "houve devolução" mesmo antes de o item ficar DONE. */
const REFUND_PAYMENT_STATUSES = new Set(['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS']);
/** Intenção que ainda pode ser confirmada por um estorno que apareça agora. */
const OPEN_INTENT_STATUSES = new Set(['pending', 'submitting', 'confirmation_pending']);
const RECONFIRMABLE_FAILURES = new Set([
  'manual_refund_cancelled',
  'manual_refund_denied',
  'refund_cancelled',
  'refund_denied',
]);

export type ExternalRefundReviewReason = ExternalRefundReviewRequiredPayload['reason'];

export interface ExternalRefundFacts {
  /** `patient_charges.status` no Qoro. */
  chargeStatus: string;
  disputeStatus: string | null;
  /** Valor bruto da cobrança no Qoro (o lido do Asaas na baixa, ou o pedido). */
  chargeGross: number;
  /** Maior patamar externo já reconhecido para esta cobrança. */
  recordedExternal: number;
  intents: ReadonlyArray<{ status: string; amount: number; failureCode: string | null }>;
  payment: Pick<ProviderPayment, 'status' | 'value' | 'chargebackStatus' | 'deleted'>;
  refunds: readonly ProviderRefund[];
}

export type ExternalRefundDecision =
  | {
      kind: 'record';
      providerTotal: number;
      claimed: number;
      externalTotal: number;
      delta: number;
      full: boolean;
    }
  | { kind: 'unchanged'; providerTotal: number; claimed: number; stale?: true }
  /** O Qoro nunca deu baixa nesta cobrança: não há o que compensar (e nada é confirmado). */
  | { kind: 'not_settled'; providerTotal: number }
  /** O pagamento já diz devolvido, mas nenhum estorno está DONE: espera o Asaas. */
  | { kind: 'pending_provider' }
  | { kind: 'manual_review'; reason: ExternalRefundReviewReason; unexplained: number };

/** A regra, sem banco: o que o Asaas mostra contra o que o Qoro já explica. */
export function decideExternalRefund(f: ExternalRefundFacts): ExternalRefundDecision {
  const providerTotal = confirmedRefundTotal(f.refunds);
  if (f.payment.deleted) return { kind: 'unchanged', providerTotal, claimed: 0 };
  if (f.chargeStatus !== 'paid' && f.chargeStatus !== 'refunded') {
    return providerTotal > EPS || REFUND_PAYMENT_STATUSES.has(f.payment.status)
      ? { kind: 'not_settled', providerTotal }
      : { kind: 'unchanged', providerTotal, claimed: 0 };
  }
  if (providerTotal <= EPS) {
    return REFUND_PAYMENT_STATUSES.has(f.payment.status)
      ? { kind: 'pending_provider' }
      : { kind: 'unchanged', providerTotal, claimed: 0 };
  }

  const claimed = round2(
    f.intents.filter((i) => i.status === 'confirmed').reduce((t, i) => t + i.amount, 0),
  );
  const externalTotal = round2(providerTotal - claimed);
  const delta = round2(externalTotal - f.recordedExternal);
  if (delta < -EPS) {
    // Leitura MAIS ANTIGA que a já reconhecida (webhook atrasado, duas instâncias): o estorno
    // DONE não volta atrás e a intenção do Qoro só confirma dinheiro NOVO (baseline já inclui
    // o externo), então isto é leitura velha. Nunca se "devolve a devolução": nada muda.
    return { kind: 'unchanged', providerTotal, claimed, stale: true };
  }
  if (delta <= EPS) return { kind: 'unchanged', providerTotal, claimed };

  const chargeback = f.payment.chargebackStatus ?? null;
  // Perda por chargeback é do D27 (ADR-052): o "devolvido" que o Asaas mostra É a perda, que o
  // caminho do risco já compensa (ou vai compensar nesta mesma entrega). Nada a fazer aqui.
  if (
    f.disputeStatus === 'lost' ||
    f.disputeStatus === 'cash_undone' ||
    chargeback === 'DISPUTE_LOST' ||
    (chargeback !== null && f.payment.status === 'REFUNDED')
  ) {
    return { kind: 'unchanged', providerTotal, claimed };
  }
  // Disputa ainda aberta e devolução nova: quem decide é uma pessoa.
  const openDispute =
    f.disputeStatus === 'requested' ||
    f.disputeStatus === 'in_dispute' ||
    f.disputeStatus === 'awaiting_reversal' ||
    chargeback === 'REQUESTED' ||
    chargeback === 'IN_DISPUTE';
  if (openDispute) return { kind: 'manual_review', reason: 'dispute', unexplained: delta };
  const openIntent = f.intents.some(
    (i) =>
      OPEN_INTENT_STATUSES.has(i.status) ||
      (i.status === 'failed' &&
        i.failureCode !== null &&
        RECONFIRMABLE_FAILURES.has(i.failureCode)),
  );
  if (openIntent)
    return { kind: 'manual_review', reason: 'open_refund_intent', unexplained: delta };
  if (Math.abs(f.payment.value - f.chargeGross) > EPS) {
    return { kind: 'manual_review', reason: 'amount_mismatch', unexplained: delta };
  }
  if (providerTotal > f.payment.value + EPS) {
    return { kind: 'manual_review', reason: 'amount_exceeds', unexplained: delta };
  }
  return {
    kind: 'record',
    providerTotal,
    claimed,
    externalTotal,
    delta,
    full: providerTotal >= f.chargeGross - EPS,
  };
}

export type ExternalRefundOutcome =
  | 'recorded'
  | 'unchanged'
  | 'not_settled'
  | 'pending_provider'
  | 'manual_review'
  | 'unknown_charge';

export interface ExternalRefundResult {
  outcome: ExternalRefundOutcome;
  externalRefundId: string | null;
  chargeId: string | null;
  appointmentId: string | null;
  /** Chave do evento publicado agora (para o passo pós-resposta processar só ele). */
  eventKey: string | null;
  amount: number;
  reason?: ExternalRefundReviewReason;
}

function evidenceOf(refunds: readonly ProviderRefund[]): ExternalRefundEvidenceItem[] {
  return refunds.slice(0, 100).map((r) => ({
    status: /^[A-Z_]{1,40}$/u.test(r.status) ? r.status : 'UNKNOWN',
    value: round2(r.value),
    dateCreated:
      r.dateCreated && /^\d{4}-\d{2}-\d{2}/u.test(r.dateCreated)
        ? r.dateCreated.slice(0, 25)
        : null,
  }));
}

/**
 * Concilia o que o Asaas mostra para UM pagamento desta clínica. A cobrança é achada só
 * dentro da clínica da sessão (RLS): pagamento de outra clínica é `unknown_charge`.
 */
export async function reconcileExternalRefund(input: {
  clinicId: string;
  providerPaymentId: string;
  payment: Pick<ProviderPayment, 'paymentId' | 'status' | 'value' | 'chargebackStatus' | 'deleted'>;
  refunds: readonly ProviderRefund[];
  source: 'webhook' | 'reconcile';
  asaasEventId: string | null;
  observedAt?: Date;
}): Promise<ExternalRefundResult> {
  if (input.payment.paymentId !== input.providerPaymentId) {
    throw new Error('[payments] leitura do Asaas de outro pagamento');
  }
  const observedAt = input.observedAt ?? new Date();
  const result = await withTenant(input.clinicId, async (tx): Promise<ExternalRefundResult> => {
    const [charge] = await tx
      .select({
        id: patientCharges.id,
        appointmentId: patientCharges.appointmentId,
        status: patientCharges.status,
        amount: patientCharges.amount,
        providerGrossAmount: patientCharges.providerGrossAmount,
        disputeStatus: patientCharges.disputeStatus,
      })
      .from(patientCharges)
      .where(
        and(
          eq(patientCharges.clinicId, input.clinicId),
          eq(patientCharges.providerPaymentId, input.providerPaymentId),
        ),
      )
      .for('update')
      .limit(1);
    if (!charge) {
      return {
        outcome: 'unknown_charge',
        externalRefundId: null,
        chargeId: null,
        appointmentId: null,
        eventKey: null,
        amount: 0,
      };
    }

    const [recorded] = await tx
      .select({
        total: sql<string | null>`max(${patientExternalRefunds.externalTotal})::text`,
      })
      .from(patientExternalRefunds)
      .where(
        and(
          eq(patientExternalRefunds.clinicId, input.clinicId),
          eq(patientExternalRefunds.patientChargeId, charge.id),
        ),
      );
    const intents = await tx
      .select({
        status: patientRefundIntents.status,
        amount: patientRefundIntents.amount,
        failureCode: patientRefundIntents.failureCode,
      })
      .from(patientRefundIntents)
      .where(
        and(
          eq(patientRefundIntents.clinicId, input.clinicId),
          eq(patientRefundIntents.patientChargeId, charge.id),
        ),
      );

    const chargeGross = Number(charge.providerGrossAmount ?? charge.amount);
    const recordedExternal = recorded?.total ? Number(recorded.total) : 0;
    const decision = decideExternalRefund({
      chargeStatus: charge.status,
      disputeStatus: charge.disputeStatus,
      chargeGross,
      recordedExternal,
      intents: intents.map((i) => ({
        status: i.status,
        amount: Number(i.amount),
        failureCode: i.failureCode,
      })),
      payment: input.payment,
      refunds: input.refunds,
    });
    const base = {
      externalRefundId: null,
      chargeId: charge.id,
      appointmentId: charge.appointmentId,
      eventKey: null,
    };

    if (decision.kind === 'manual_review') {
      const payload: ExternalRefundReviewRequiredPayload = {
        clinicId: input.clinicId,
        appointmentId: charge.appointmentId,
        chargeId: charge.id,
        amount: decision.unexplained,
        reason: decision.reason,
      };
      // A chave muda só quando muda o que está sem explicação: a varredura repetida não
      // abre aviso novo para o mesmo fato.
      const eventKey = `external-refund-review:${charge.id}:${decision.reason}:${Math.round(decision.unexplained * 100)}:${Math.round(recordedExternal * 100)}`;
      await publishEvent(tx, {
        clinicId: input.clinicId,
        eventType: PAYMENTS_EVENTS.EXTERNAL_REFUND_REVIEW_REQUIRED,
        payload,
        idempotencyKey: eventKey,
      });
      return {
        ...base,
        eventKey,
        outcome: 'manual_review',
        amount: decision.unexplained,
        reason: decision.reason,
      };
    }
    if (decision.kind !== 'record') {
      if (decision.kind === 'unchanged' && decision.stale) {
        metrics.emit('payments.external_refund.stale_reading', {
          clinicId: input.clinicId,
          source: input.source,
        });
      }
      return { ...base, outcome: decision.kind, amount: 0 };
    }

    const [row] = await tx
      .insert(patientExternalRefunds)
      .values({
        clinicId: input.clinicId,
        patientChargeId: charge.id,
        appointmentId: charge.appointmentId,
        providerPaymentId: input.providerPaymentId,
        externalTotal: decision.externalTotal.toFixed(2),
        amount: decision.delta.toFixed(2),
        providerRefundedTotal: decision.providerTotal.toFixed(2),
        intentsClaimed: decision.claimed.toFixed(2),
        providerStatus: /^[A-Z_]{1,40}$/u.test(input.payment.status)
          ? input.payment.status
          : 'UNKNOWN',
        fullRefund: decision.full,
        source: input.source,
        asaasEventId: input.asaasEventId,
        evidence: evidenceOf(input.refunds),
        observedAt,
      })
      .onConflictDoNothing()
      .returning({ id: patientExternalRefunds.id });
    // Com a cobrança travada o patamar já estaria visível; conflito aqui é corrida
    // que outra transação já resolveu.
    if (!row) return { ...base, outcome: 'unchanged', amount: 0 };

    const nextStatus = decision.full && charge.status === 'paid' ? 'refunded' : charge.status;
    if (nextStatus !== charge.status) {
      await tx
        .update(patientCharges)
        .set({
          status: 'refunded',
          refundedAt: observedAt,
          holdExpiresAt: null,
          updatedAt: sql`now()`,
        })
        .where(and(eq(patientCharges.id, charge.id), eq(patientCharges.clinicId, input.clinicId)));
    }

    const payload: ExternalRefundRecognizedPayload = {
      clinicId: input.clinicId,
      appointmentId: charge.appointmentId,
      chargeId: charge.id,
      externalRefundId: row.id,
      amount: decision.delta,
      externalTotal: decision.externalTotal,
      fullRefund: decision.full,
      observedAt: observedAt.toISOString(),
    };
    await publishEvent(tx, {
      clinicId: input.clinicId,
      eventType: PAYMENTS_EVENTS.EXTERNAL_REFUND_RECOGNIZED,
      payload,
      idempotencyKey: externalRefundEventKey(row.id),
    });
    await logAudit(tx, {
      clinicId: input.clinicId,
      userId: null,
      action: 'payments.patient_charge.external_refund_recognized',
      resourceType: 'patient_charge',
      resourceId: charge.id,
      before: { status: charge.status, externalRefundedTotal: recordedExternal },
      after: {
        status: nextStatus,
        externalRefundedTotal: decision.externalTotal,
        amount: decision.delta,
        providerRefundedTotal: decision.providerTotal,
        intentsClaimed: decision.claimed,
        fullRefund: decision.full,
        source: input.source,
        externalRefundId: row.id,
      },
      requestContext: {
        ip: null,
        userAgent: 'clinicaos-payments-worker',
        requestId: randomUUID(),
      },
    });
    return {
      outcome: 'recorded',
      externalRefundId: row.id,
      chargeId: charge.id,
      appointmentId: charge.appointmentId,
      eventKey: externalRefundEventKey(row.id),
      amount: decision.delta,
    };
  });
  metrics.emit('payments.external_refund.reconciled', {
    clinicId: input.clinicId,
    source: input.source,
    outcome: result.outcome,
    ...(result.reason ? { reason: result.reason } : {}),
  });
  return result;
}

export const externalRefundEventKey = (externalRefundId: string): string =>
  `external-refund:${externalRefundId}`;

/** Cursor da varredura: a cobrança foi lida agora (com ou sem estorno). */
export async function markRefundChecked(clinicId: string, chargeId: string): Promise<void> {
  await withTenant(clinicId, (tx) =>
    tx
      .update(patientCharges)
      .set({ refundCheckedAt: sql`now()` })
      .where(and(eq(patientCharges.id, chargeId), eq(patientCharges.clinicId, clinicId))),
  );
}
