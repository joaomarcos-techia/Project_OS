import { NextResponse } from 'next/server';

import { recordSignupEmailDelivery } from '@/contexts/onboarding';
import { parseResendDeliveryEvent, verifyResendWebhook } from '@/lib/email/resend-webhook';
import { env } from '@/lib/env';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const json = (status: number, body: object) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!env.RESEND_WEBHOOK_SECRET) return json(503, { error: 'unavailable' });
  try {
    const raw = await readWebhookBodyCapped(request, 262144);
    if (raw === null) return json(413, { error: 'body_too_large' });
    if (!verifyResendWebhook({ raw, headers: request.headers, secret: env.RESEND_WEBHOOK_SECRET }))
      return json(401, { error: 'invalid_signature' });
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return json(400, { error: 'invalid_body' });
    }
    const event = parseResendDeliveryEvent(value);
    if (!event) return json(200, { received: true, outcome: 'ignored' });
    const id = request.headers.get('svix-id');
    if (!id) return json(401, { error: 'invalid_signature' });
    const outcome = await recordSignupEmailDelivery({ id, ...event });
    return json(200, { received: true, outcome });
  } catch {
    logger.warn('signup.email.webhook_failed', { stage: 'persistence' });
    return json(503, { error: 'unavailable' });
  }
}
