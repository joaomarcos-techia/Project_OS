/**
 * Webhook Asaas do PACIENTE (ADR-049 1.4). Irmão do `/api/webhooks/asaas`, que é
 * da conta do Qoro (assinatura) — este é da conta DA CLÍNICA (sinal).
 *
 * MODELO DE CONFIANÇA (o mesmo "A2", e vale repetir porque é o que sustenta tudo):
 * o Asaas não assina o corpo. A única prova é um token compartilhado. Logo o corpo
 * é uma NOTIFICAÇÃO, não um dado: dele saem apenas identificadores. Status e valor
 * vêm de `getPayment()` **com a chave daquela clínica** — quem tiver o token não
 * consegue fazer a API do Asaas mentir. Sem isso, um `PAYMENT_RECEIVED` forjado
 * confirmaria um agendamento sem ninguém ter pago.
 *
 * O que é diferente do webhook de assinatura, e por quê:
 *   - **cada clínica tem sua URL** (`/patient/<webhook_ref>`) e seu token. Uma
 *     conta é de um cliente; o token não pode ser compartilhado entre clínicas;
 *   - o `ref` é ENDEREÇO, não segredo, e **não é o `clinic_id`** — id de tenant em
 *     URL pública vira oráculo de enumeração;
 *   - **404 para todo ref que não resolve**, sem distinguir "não existe" de "sem
 *     token": distinguir transformaria a rota num oráculo de refs válidos;
 *   - dedup por `(clinic_id, asaas_event_id)`: os emissores são N contas
 *     diferentes, e nada garante que dois provedores nunca repitam um id.
 *
 * Ordem inviolável (a mesma do irmão):
 *   0. size guard → 413.
 *   1. resolver o ref → 404 se não resolver.
 *   2. validar token da CLÍNICA (constant-time) → 401.
 *   3. parse → só ids → 400 sem `body.id`.
 *   4. getPayment FORA de transação (tx atravessando HTTP prende conexão).
 *   5. transação: dedup + conciliação + evento, atômicos.
 *   6. 200 sempre que aceito; ≠2xx faz o Asaas re-entregar.
 */
import { buildRequestContext } from '@/lib/audit/request-context';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';
import { captureBackgroundError } from '@/lib/observability/capture';
import { runWithContext } from '@/lib/observability/context';
import { metrics } from '@/lib/observability/metrics';
import { resolvePatientWebhookAccount } from '@/lib/payments/account-store';
import { safeEqual } from '@/lib/auth/secret-compare';
import type { ProviderPayment } from '@/lib/payments/asaas';

import { PAYMENTS_EVENTS } from '@/contexts/payments';
import { markDepositPaid } from '@/contexts/payments/internal/charge-store';
import { reconcileRefundIntentsForPayment } from '@/contexts/payments/internal/excess-refund';
import { reconcileExternalRefund } from '@/contexts/payments/internal/external-refund';
import {
  classifyPatientPaymentRisk,
  reconcilePatientPaymentRisk,
} from '@/contexts/payments/internal/patient-payment-risk';

import { scheduleRefundFollowUp, scheduleSettlementFollowUp } from '../settlement-follow-up';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_WEBHOOK_BYTES = 1_000_000;
const FLOW = 'payments.webhook';
const REFUND_EVENTS = new Set([
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_REFUND_DENIED',
]);
/** Status do pagamento (lido do Asaas) que dizem "houve devolução". */
const REFUNDED_PAYMENT_STATUSES = new Set(['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS']);

/**
 * Status do provider → ação. Mesma tabela do webhook de assinatura, de propósito:
 * se os dois discordarem, um desfaz o outro. O `event` do corpo é só rótulo.
 */
function isPaid(status: string): boolean {
  return status === 'RECEIVED' || status === 'CONFIRMED' || status === 'RECEIVED_IN_CASH';
}

export async function POST(
  req: Request,
  context: { params: Promise<{ ref: string }> },
): Promise<Response> {
  const { requestId } = buildRequestContext(req.headers);
  return runWithContext({ requestId, flow: FLOW }, () => handlePatientWebhook(req, context));
}

async function handlePatientWebhook(
  req: Request,
  context: { params: Promise<{ ref: string }> },
): Promise<Response> {
  // 0. size guard — antes de qualquer trabalho.
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    metrics.emit('payments.webhook.oversized', { contentLength });
    return new Response('payload too large', { status: 413 });
  }

  const { ref } = await context.params;
  // Formato antes do banco: um `ref` que nem parece uuid não merece uma query.
  if (!/^[0-9a-fA-F-]{36}$/.test(ref)) {
    metrics.emit('payments.webhook.unknown_ref', {});
    return new Response('not found', { status: 404 });
  }

  const raw = await readWebhookBodyCapped(req, MAX_WEBHOOK_BYTES);
  if (raw === null) {
    return new Response('payload too large', { status: 413 });
  }

  // 1. resolver a clínica. 404 para TODO caso que não resolve — não existe, conta
  // inativa, sem chave ou sem token dão a mesma resposta.
  const account = await resolvePatientWebhookAccount(ref);
  if (!account) {
    metrics.emit('payments.webhook.unknown_ref', {});
    return new Response('not found', { status: 404 });
  }

  // 2. token DESTA clínica, constant-time.
  if (!safeEqual(req.headers.get('asaas-access-token'), account.webhookToken)) {
    metrics.emit('payments.webhook.invalid_token', { clinicId: account.clinicId });
    return new Response('invalid token', { status: 401 });
  }

  // 3. parse — só identificadores.
  let parsed: ReturnType<typeof account.client.parseWebhook>;
  try {
    parsed = account.client.parseWebhook(raw);
  } catch (err) {
    metrics.emit('payments.webhook.unparseable', {
      clinicId: account.clinicId,
      code: err instanceof Error ? err.name : 'unknown',
    });
    return new Response('bad request', { status: 400 });
  }

  metrics.emit('payments.webhook.received', {
    clinicId: account.clinicId,
    event: parsed.event,
  });

  // 4. verify — a fonte da verdade, fora da transação. `attempts: 1` mantém o teto
  // dentro do maxDuration; não re-tentar aqui é seguro porque o Asaas re-entrega
  // em ≠2xx.
  const t0 = Date.now();
  let payment: ProviderPayment | null;
  try {
    if (parsed.paymentId) {
      payment = await account.client.getPayment(parsed.paymentId, { attempts: 1 });
    } else if (parsed.event === 'CHECKOUT_PAID' && parsed.checkoutId) {
      payment = await account.client.findPaymentByCheckoutSession(parsed.checkoutId, {
        attempts: 1,
      });
      // O evento pode chegar antes de a listagem refletir a cobrança. 500 pede
      // reentrega; aceitar 200 aqui perderia definitivamente a confirmação.
      if (!payment) throw new Error('[payments] Checkout pago ainda sem cobrança consultável');
    } else {
      return Response.json({ received: true }, { status: 200 });
    }
    metrics.emit('payments.webhook.verify', {
      clinicId: account.clinicId,
      duration_ms: Date.now() - t0,
      outcome: 'ok',
    });
  } catch (err) {
    metrics.emit('payments.webhook.verify', {
      clinicId: account.clinicId,
      duration_ms: Date.now() - t0,
      outcome: err instanceof Error ? err.name : 'unknown',
    });
    // 500 (não 4xx): corpo que não confere é anomalia que merece re-entrega.
    return new Response('verification failed', { status: 500 });
  }

  // D50 + R54: o evento apenas acorda a reconciliação. A confirmação vem de
  // GET /payments/{id}/refunds (com a chave DESTA clínica), nunca do corpo do webhook.
  // Primeiro as devoluções que o Qoro pediu; o que sobrar é estorno feito direto no
  // Asaas. Também entra aqui uma entrega atrasada que já encontra o pagamento devolvido.
  if (
    parsed.paymentId &&
    (REFUND_EVENTS.has(parsed.event) || REFUNDED_PAYMENT_STATUSES.has(payment.status))
  ) {
    const providerPaymentId = parsed.paymentId;
    try {
      const refunds = await account.client.listPaymentRefunds(providerPaymentId, {
        attempts: 1,
      });
      const confirmed = await reconcileRefundIntentsForPayment({
        clinicId: account.clinicId,
        providerPaymentId,
        loadRefunds: async () => refunds,
      });
      const external = await reconcileExternalRefund({
        clinicId: account.clinicId,
        providerPaymentId,
        payment,
        refunds,
        source: 'webhook',
        asaasEventId: parsed.eventId,
      });
      metrics.emit('payments.webhook.refund_reconciled', {
        clinicId: account.clinicId,
        confirmed,
        external: external.outcome,
      });
      if (
        (external.outcome === 'recorded' || external.outcome === 'manual_review') &&
        external.chargeId &&
        external.appointmentId &&
        external.eventKey
      ) {
        scheduleRefundFollowUp({
          clinicId: account.clinicId,
          chargeId: external.chargeId,
          appointmentId: external.appointmentId,
          eventKey: external.eventKey,
          eventType:
            external.outcome === 'recorded'
              ? PAYMENTS_EVENTS.EXTERNAL_REFUND_RECOGNIZED
              : PAYMENTS_EVENTS.EXTERNAL_REFUND_REVIEW_REQUIRED,
        });
      }
    } catch (err) {
      captureBackgroundError(err, { flow: FLOW });
      metrics.emit('payments.webhook.refund_reconcile_error', {
        clinicId: account.clinicId,
        error: err,
      });
      return new Response('verification failed', { status: 500 });
    }
  }

  // D27: disputa e reversão são fatos do dinheiro. A consulta/prontuário não
  // entra neste caminho; o Financial projeta o alerta ou a compensação.
  const riskState = classifyPatientPaymentRisk(parsed.event, payment);
  if (riskState) {
    try {
      const outcome = await reconcilePatientPaymentRisk({
        clinicId: account.clinicId,
        providerPaymentId: payment.paymentId,
        asaasEventId: parsed.eventId,
        eventType: parsed.event,
        state: riskState,
        reason: payment.chargebackReason ?? null,
        changedAt: new Date(),
      });
      metrics.emit('payments.webhook.risk_processed', {
        clinicId: account.clinicId,
        state: riskState,
        outcome,
      });
      return Response.json({ received: true, outcome }, { status: 200 });
    } catch (err) {
      captureBackgroundError(err, { flow: FLOW });
      metrics.emit('payments.webhook.risk_error', {
        clinicId: account.clinicId,
        state: riskState,
        error: err,
      });
      return new Response('internal', { status: 500 });
    }
  }

  // Só o pagamento REAL decide. `PENDING`, `OVERDUE` e afins não movem nada aqui:
  // quem libera a vaga não paga é a expiração do hold.
  if (!isPaid(payment.status)) {
    metrics.emit('payments.webhook.ignored', {
      clinicId: account.clinicId,
      status: payment.status,
    });
    return Response.json({ received: true }, { status: 200 });
  }

  // 5. dedup + conciliação + evento, atômicos.
  try {
    const outcome = await markDepositPaid({
      clinicId: account.clinicId,
      providerPaymentId: payment.paymentId,
      asaasEventId: parsed.eventId,
      eventType: parsed.event,
      paidAt: new Date(),
      providerGrossAmount: payment.value,
      providerNetAmount: payment.netValue ?? null,
      // ADR-051 — vem do `getPayment` (fonte da verdade), nunca do corpo do
      // webhook: é ele que vira a forma de pagamento da baixa no Caixa.
      billingType: payment.billingType,
      checkoutSessionId: payment.checkoutSessionId,
      providerInstallmentId: payment.installmentId ?? null,
      providerInstallmentNumber: payment.installmentNumber ?? null,
    });
    metrics.emit('payments.webhook.processed', { clinicId: account.clinicId, outcome });
    // Baixa e coparticipação logo depois da resposta (o cron é a garantia). A reentrega
    // (`already_paid`) agenda de novo: o que já rodou não repete, o que ficou para trás anda.
    if (outcome === 'paid' || outcome === 'already_paid') {
      scheduleSettlementFollowUp(account.clinicId, payment.paymentId);
    }
    if (outcome === 'amount_mismatch') {
      metrics.emit('payments.webhook.amount_mismatch', { clinicId: account.clinicId });
    }
    if (outcome === 'method_mismatch') {
      metrics.emit('payments.webhook.method_mismatch', { clinicId: account.clinicId });
    }
    if (outcome === 'installment_mismatch') {
      metrics.emit('payments.webhook.installment_mismatch', { clinicId: account.clinicId });
    }
    return Response.json({ received: true, outcome }, { status: 200 });
  } catch (err) {
    captureBackgroundError(err, { flow: FLOW });
    metrics.emit('payments.webhook.error', { clinicId: account.clinicId, error: err });
    return new Response('internal', { status: 500 });
  }
}
