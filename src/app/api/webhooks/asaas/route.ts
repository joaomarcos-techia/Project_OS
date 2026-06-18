/**
 * Webhook Asaas (C13 — ADR-025). Asaas atualiza BILLING; ClinicaOS DECIDE acesso.
 *
 * Ordem inviolável:
 *   0. size guard (413 antes de tudo).
 *   1. validar token `asaas-access-token` (constant-time) → 401. Asaas usa token
 *      configurado (não HMAC); replay protection = dedup por eventId.
 *   2. parseWebhook (normaliza, sem wire format cru).
 *   3. dbAdmin.transaction: dedup (processed_webhooks) → resolve clínica por
 *      asaas_payment_id → transição idempotente/monotônica (subscriptions.ts).
 *      Tudo atômico: se a tx falha, o dedup também rola → replay seguro.
 *   4. 200 sempre que aceito (Asaas re-tenta se ≠ 2xx). Duplicado → 200 ignora.
 *
 * dbAdmin permitido aqui (allowlist eslint + arch-db-check): resolve cross-tenant.
 */
import { eq } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { assertBillingWebhookReady } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

import { asaasProvider } from '@/contexts/billing/internal/providers/asaas';
import {
  markInvoiceOverdue,
  markInvoicePaid,
  markInvoiceRefunded,
} from '@/contexts/billing/internal/subscriptions';
import { invoices, processedWebhooks } from '@/contexts/billing/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_WEBHOOK_BYTES = 1_000_000;

export async function POST(req: Request): Promise<Response> {
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

  // 2. parse.
  let parsed: ReturnType<typeof asaasProvider.parseWebhook>;
  try {
    parsed = asaasProvider.parseWebhook(raw);
  } catch {
    return new Response('bad request', { status: 400 });
  }

  // 3. dedup + resolve + processar (atômico).
  try {
    const result = await dbAdmin.transaction(async (tx) => {
      const dedup = await tx
        .insert(processedWebhooks)
        .values({ asaasEventId: parsed.eventId, eventType: parsed.event })
        .onConflictDoNothing()
        .returning({ id: processedWebhooks.asaasEventId });
      if (dedup.length === 0) return { status: 'duplicate' as const };

      if (!parsed.paymentId) return { status: 'ignored' as const, reason: 'no_payment' };

      const [inv] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.asaasPaymentId, parsed.paymentId))
        .limit(1);
      if (!inv) return { status: 'ignored' as const, reason: 'unknown_payment' };

      const clinicId = inv.clinicId;
      await tx
        .update(processedWebhooks)
        .set({ clinicId })
        .where(eq(processedWebhooks.asaasEventId, parsed.eventId));

      const idem = parsed.eventId;
      switch (parsed.event) {
        case 'PAYMENT_RECEIVED':
        case 'PAYMENT_CONFIRMED':
          await markInvoicePaid(tx, clinicId, inv, {
            paymentMethod: parsed.billingType,
            providerPaymentId: parsed.paymentId,
            idemSuffix: idem,
          });
          break;
        case 'PAYMENT_OVERDUE':
          await markInvoiceOverdue(tx, clinicId, inv, {
            providerPaymentId: parsed.paymentId,
            idemSuffix: idem,
            daysOverdue: 0,
          });
          break;
        case 'PAYMENT_REFUNDED':
          await markInvoiceRefunded(tx, clinicId, inv, {
            providerPaymentId: parsed.paymentId,
            idemSuffix: idem,
          });
          break;
        default:
          return { status: 'ignored' as const, reason: parsed.event };
      }
      return { status: 'processed' as const, event: parsed.event, clinicId };
    });

    metrics.emit('billing.webhook.received', { event: parsed.event, ...result });
    return Response.json(result, { status: 200 });
  } catch (err) {
    metrics.emit('billing.webhook.error', { event: parsed.event, error: err });
    return new Response('internal error', { status: 500 });
  }
}
