import { NextResponse } from 'next/server';
import { z } from 'zod';

import { authorizeAction } from '@/lib/auth/action-guard';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { resolveTrustedApplicationOrigin } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';
import { CommandOperationError } from '@/lib/payments/saas/command-operation';
import { metrics } from '@/lib/observability/metrics';
import {
  createDeferredSubscriptionCheckout,
  DeferredCheckoutError,
} from '@/contexts/billing/internal/deferred-checkout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const bodySchema = z.object({ targetPlanId: z.uuid().optional() }).strict();
const response = (body: object, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

export async function POST(request: Request): Promise<Response> {
  const origin = resolveTrustedApplicationOrigin(request);
  if (!origin) return response({ error: 'blocked' }, origin === null ? 403 : 503);
  try {
    const authorization = await authorizeAction(PERMISSIONS.MANAGE_SETTINGS);
    if (!authorization.ok) return response({ error: 'unauthorized' }, authorization.httpStatus);
    const raw = await readWebhookBodyCapped(request, 256);
    if (raw === null) return response({ error: 'body_too_large' }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return response({ error: 'invalid_body' }, 400);
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return response({ error: 'invalid_body' }, 400);
    return response(
      await createDeferredSubscriptionCheckout({
        clinicId: authorization.clinicId,
        ...(parsed.data.targetPlanId ? { targetPlanId: parsed.data.targetPlanId } : {}),
      }),
    );
  } catch (error) {
    if (error instanceof DeferredCheckoutError) {
      return response({ error: error.code }, error.code === 'unavailable' ? 503 : 409);
    }
    if (error instanceof CommandOperationError)
      return response({ error: 'reconcile_required' }, 409);
    // No provider body, financial identifiers, credentials or callback URL leaks.
    metrics.emit('billing.abacatepay.checkout_unavailable', {
      reason: 'unexpected_or_configuration',
    });
    return response({ error: 'unavailable' }, 503);
  }
}
