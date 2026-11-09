import { NextResponse } from 'next/server';
import { z } from 'zod';

import { authorizeAction } from '@/lib/auth/action-guard';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { resolveTrustedApplicationOrigin } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';
import { metrics } from '@/lib/observability/metrics';
import { requestDeferredSubscriptionCancellation } from '@/contexts/billing/internal/deferred-checkout';
import { AbacatePayManagementError } from '@/contexts/billing/internal/abacatepay-management';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.object({ contractId: z.uuid() }).strict();
const response = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: Request): Promise<Response> {
  const origin = resolveTrustedApplicationOrigin(request);
  if (!origin) return response({ error: 'blocked' }, origin === null ? 403 : 503);
  try {
    const actor = await authorizeAction(PERMISSIONS.MANAGE_SETTINGS);
    if (!actor.ok) return response({ error: 'unauthorized' }, actor.httpStatus);
    const raw = await readWebhookBodyCapped(request, 256);
    if (raw === null) return response({ error: 'body_too_large' }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return response({ error: 'invalid_body' }, 400);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return response({ error: 'invalid_body' }, 400);
    return response(
      await requestDeferredSubscriptionCancellation({
        clinicId: actor.clinicId,
        requestedBy: actor.user.userId,
        contractId: parsed.data.contractId,
      }),
    );
  } catch (error) {
    if (error instanceof AbacatePayManagementError)
      return response({ error: error.code }, error.code === 'unavailable' ? 503 : 409);
    metrics.emit('billing.abacatepay.cancellation_pending', {
      reason: 'unexpected_or_configuration',
    });
    return response({ error: 'reconcile_required' }, 503);
  }
}
