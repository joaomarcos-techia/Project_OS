/**
 * Webhook Asaas (C13 — ADR-025). Asaas atualiza BILLING; ClinicaOS DECIDE acesso.
 *
 * MODELO DE CONFIANÇA (A2 — auditoria de APIs): o Asaas não assina o corpo; a
 * única prova é um token estático compartilhado. Logo o corpo é uma NOTIFICAÇÃO,
 * não um dado: dele saem apenas identificadores (`body.id` p/ dedup, `payment.id`
 * p/ consulta). Status, valor, vencimento e o vínculo com a subscription vêm de
 * `getPayment()` — quem tem o token não consegue fazer a API do Asaas mentir.
 * Sem isso, um `PAYMENT_CONFIRMED` forjado reabria uma clínica bloqueada sem pagar.
 *
 * Ordem inviolável:
 *   0. size guard (413 antes de tudo).
 *   1. validar token `asaas-access-token` (constant-time) → 401.
 *   2. parseWebhook → só ids; sem `body.id` → 400 (ver ParsedWebhook).
 *   3. getPayment → FORA da transação. Segurar tx atravessando HTTP prenderia
 *      conexão + lock de processed_webhooks por até 30s: um Asaas lento esgotaria
 *      o pool. `attempts: 1` mantém o teto em ~1× ASAAS_HTTP_TIMEOUT_MS, dentro do
 *      maxDuration=30 (o default de 3 tentativas daria 3×10s+600ms = 30,6s). Não
 *      re-tentar aqui é seguro: o Asaas re-entrega em ≠2xx e o billing-reconcile
 *      é o backstop diário.
 *   4. dbAdmin.transaction: dedup (processed_webhooks) → resolve clínica →
 *      transição idempotente/monotônica (subscriptions.ts). Tudo atômico: se a tx
 *      falha, o dedup também rola → replay seguro.
 *   5. 200 sempre que aceito (Asaas re-tenta se ≠ 2xx). Duplicado → 200 ignora.
 *
 * dbAdmin permitido aqui (allowlist eslint + arch-db-check): resolve cross-tenant.
 */
import { eq } from 'drizzle-orm';

import { buildRequestContext } from '@/lib/audit/request-context';
import { dbAdmin } from '@/lib/db';
import { assertBillingWebhookReady } from '@/lib/env';
import { captureBackgroundError } from '@/lib/observability/capture';
import { runWithContext } from '@/lib/observability/context';
import { metrics } from '@/lib/observability/metrics';

import { asaasProvider, type ProviderPayment } from '@/contexts/billing/internal/providers/asaas';
import { applyPaidUpgradeForPayment } from '@/contexts/billing/internal/plan-changes';
import {
  ensureInvoiceForPayment,
  markInvoiceOverdue,
  markInvoicePaid,
  markInvoiceRefunded,
} from '@/contexts/billing/internal/subscriptions';
import { processedWebhooks, subscriptionChangeRequests } from '@/contexts/billing/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_WEBHOOK_BYTES = 1_000_000;

/**
 * Status do provider → ação. Mesma tabela do billing-reconcile (PAID_STATUSES),
 * de propósito: webhook e reconciliação precisam concordar, senão um desfaz o
 * outro. O `event` do corpo é só rótulo — quem decide é o status real.
 */
function actionFor(status: string): 'paid' | 'overdue' | 'refunded' | null {
  if (status === 'RECEIVED' || status === 'CONFIRMED' || status === 'RECEIVED_IN_CASH')
    return 'paid';
  if (status === 'OVERDUE') return 'overdue';
  if (status === 'REFUNDED') return 'refunded';
  return null; // PENDING e afins: materializa a invoice, sem transição.
}

const FLOW = 'billing.webhook';

/**
 * Abre o escopo de correlação e delega. O corpo fica em `handleWebhook` para
 * este wrapper não custar uma reindentação inteira de uma rota de pagamento.
 *
 * NÃO fixa `clinicId` no contexto: ele só é resolvido DENTRO da transação (via
 * `ensureInvoiceForPayment`), e um webhook pode ser de uma clínica que ainda não
 * conhecemos. Correlacionar pelo `request_id` é honesto; carimbar um clinicId
 * adivinhado não seria.
 */
export async function POST(req: Request): Promise<Response> {
  const { requestId } = buildRequestContext(req.headers);
  return runWithContext({ requestId, flow: FLOW }, () => handleWebhook(req));
}

async function handleWebhook(req: Request): Promise<Response> {
  assertBillingWebhookReady();

  // 0. size guard.
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    metrics.emit('billing.webhook.oversized', { contentLength });
    return new Response('payload too large', { status: 413 });
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_WEBHOOK_BYTES) {
    return new Response('payload too large', { status: 413 });
  }

  // 1. token.
  if (!asaasProvider.validateWebhookToken(req.headers.get('asaas-access-token'))) {
    metrics.emit('billing.webhook.invalid_token', {});
    return new Response('invalid token', { status: 401 });
  }

  // 2. parse (só ids).
  let parsed: ReturnType<typeof asaasProvider.parseWebhook>;
  try {
    parsed = asaasProvider.parseWebhook(raw);
  } catch (err) {
    metrics.emit('billing.webhook.unparseable', {
      code: err instanceof Error ? err.name : 'unknown',
    });
    return new Response('bad request', { status: 400 });
  }

  if (!parsed.paymentId) {
    metrics.emit('billing.webhook.received', { event: parsed.event, status: 'ignored' });
    return Response.json({ received: true }, { status: 200 });
  }

  // 3. verify — fonte da verdade, fora da tx.
  const t0 = Date.now();
  let payment: ProviderPayment;
  try {
    payment = await asaasProvider.getPayment(parsed.paymentId, { attempts: 1 });
    metrics.emit('billing.webhook.verify', { duration_ms: Date.now() - t0, outcome: 'ok' });
  } catch (err) {
    const name = err instanceof Error ? err.name : 'unknown';
    metrics.emit('billing.webhook.verify', {
      duration_ms: Date.now() - t0,
      // 4xx = o pagamento não existe/não é nosso → forjado ou apagado (definitivo).
      // Timeout/circuito aberto = indeterminado → o Asaas re-entrega.
      outcome: name === 'BillingProviderError' ? 'failure' : 'timeout',
      error: name,
    });
    // 500 (não 4xx) mesmo no caso definitivo: um corpo que não confere é anomalia
    // que merece re-entrega + investigação, e o reconcile cobre o resto.
    return new Response('verification failed', { status: 500 });
  }

  // 4. dedup + resolve + processar (atômico).
  try {
    const result = await dbAdmin.transaction(async (tx) => {
      const dedup = await tx
        .insert(processedWebhooks)
        .values({ asaasEventId: parsed.eventId, eventType: parsed.event })
        .onConflictDoNothing()
        .returning({ id: processedWebhooks.asaasEventId });
      if (dedup.length === 0) return { status: 'duplicate' as const };

      // Cobrança avulsa de upgrade: ela não possui `subscription` no Asaas, por
      // isso precisa ser resolvida pela externalReference verificada em getPayment
      // ANTES do caminho normal de invoices recorrentes.
      const upgradeApplied = await applyPaidUpgradeForPayment(tx, payment, parsed.eventId);
      if (upgradeApplied) {
        const [change] = await tx
          .select({ clinicId: subscriptionChangeRequests.clinicId })
          .from(subscriptionChangeRequests)
          .where(eq(subscriptionChangeRequests.providerPaymentId, payment.paymentId))
          .limit(1);
        if (change) {
          await tx
            .update(processedWebhooks)
            .set({ clinicId: change.clinicId })
            .where(eq(processedWebhooks.asaasEventId, parsed.eventId));
        }
        return { status: 'processed' as const };
      }

      // Materializa a invoice local a partir do pagamento REAL (resolve subscription
      // por asaas_subscription_id). Out-of-order safe: RECEIVED antes de CREATED ainda
      // cria a invoice e a paga. null = sem subscription local atribuível.
      const inv = await ensureInvoiceForPayment(tx, {
        paymentId: payment.paymentId,
        subscriptionId: payment.subscriptionId,
        value: payment.value,
        dueDate: payment.dueDate,
      });
      if (!inv) return { status: 'ignored' as const, reason: 'unknown_subscription' };

      const clinicId = inv.clinicId;
      await tx
        .update(processedWebhooks)
        .set({ clinicId })
        .where(eq(processedWebhooks.asaasEventId, parsed.eventId));

      const idem = parsed.eventId;
      switch (actionFor(payment.status)) {
        case 'paid':
          await markInvoicePaid(tx, clinicId, inv, {
            paymentMethod: payment.billingType,
            providerPaymentId: payment.paymentId,
            idemSuffix: idem,
          });
          break;
        case 'overdue':
          await markInvoiceOverdue(tx, clinicId, inv, {
            providerPaymentId: payment.paymentId,
            idemSuffix: idem,
            daysOverdue: 0,
          });
          break;
        case 'refunded':
          await markInvoiceRefunded(tx, clinicId, inv, {
            providerPaymentId: payment.paymentId,
            idemSuffix: idem,
          });
          break;
        default:
          break; // invoice já materializada acima
      }
      return { status: 'processed' as const };
    });

    // B5: `clinicId` (UUID interno) NÃO vai no corpo — o chamador não precisa dele.
    // O detalhe fica na métrica, que é interna.
    metrics.emit('billing.webhook.received', {
      event: parsed.event,
      provider_status: payment.status,
      ...result,
    });
    return Response.json({ received: true }, { status: 200 });
  } catch (err) {
    // C3: o Sentry é o ÚNICO caminho do stack aqui — o stream de métricas reduz
    // Error a {name,message} por design. Sem isto, diagnosticar um
    // PAYMENT_RECEIVED que quebrou exigia reproduzir local com um payload que os
    // logs redigiram. O `event` não vai na tag (ctx é allowlist fechada): ele já
    // está na métrica abaixo, e o `request_id` une as duas pontas.
    captureBackgroundError(err, { flow: FLOW });
    metrics.emit('billing.webhook.error', { event: parsed.event, error: err });
    return new Response('internal error', { status: 500 });
  }
}
