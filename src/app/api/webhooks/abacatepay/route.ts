import { dbAdmin } from '@/lib/db';
import { env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';
import { assertAbacatePaySandboxRuntime } from '@/lib/payments/saas/acquisition';
import { createPostgresGatewayInbox } from '@/lib/payments/saas/postgres-store';
import { createAbacatePayWebhookHandler } from '@/lib/payments/abacatepay/webhook-handler';
import { reconcileAbacatePayInbox } from '@/contexts/billing/internal/abacatepay-processing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  // This route cannot be enabled for production by merely adding an API key.
  try {
    assertAbacatePaySandboxRuntime();
    if (!env.ABACATEPAY_STORE_ID || !env.ABACATEPAY_WEBHOOK_SECRET)
      throw new Error('Missing webhook configuration');
    const account = {
      provider: 'abacatepay',
      environment: 'sandbox',
      accountId: env.ABACATEPAY_STORE_ID,
    } as const;
    const persistence = createPostgresGatewayInbox(account, dbAdmin);
    let eventId: string | undefined;
    const accepted = await createAbacatePayWebhookHandler({
      account,
      expectedSecret: env.ABACATEPAY_WEBHOOK_SECRET,
      inbox: {
        account,
        async accept(notification, hash) {
          const outcome = await persistence.accept(notification, hash);
          eventId = notification.eventId;
          return outcome;
        },
      },
      onFailure: (reason) => metrics.emit('billing.abacatepay.webhook_failed', { reason }),
    })(request);
    if ((accepted.status === 202 || accepted.status === 200) && eventId) {
      const outcome = await reconcileAbacatePayInbox({ eventId });
      // Ask the provider to redeliver transient failures. The durable inbox and
      // paid-checkout uniqueness make that replay safe. Do not wait for daily cron.
      if (outcome.retry)
        return Response.json(
          { received: true, retry: true },
          {
            status: 503,
            headers: { 'Cache-Control': 'no-store' },
          },
        );
    }
    return accepted;
  } catch {
    metrics.emit('billing.abacatepay.webhook_failed', { reason: 'configuration_or_persistence' });
    return Response.json(
      { error: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
