/**
 * POST /api/signup/checkout — cria uma jornada recorrente hospedada no Asaas.
 *
 * O browser não escolhe nem envia dados de cobrança. Plano, preço, ciclo,
 * trial, tenant e papel continuam resolvidos no servidor, e o Asaas coleta os
 * dados do pagador na página hospedada. Um 200 desta rota
 * significa apenas "Checkout criado"; o tenant nasce somente na rota de status,
 * depois do readback autoritativo da assinatura.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  completeSignupHostedCheckout,
  provisionTenantFromSignup,
  readSignupBilling,
  reconcileSignupSubscription,
  resolveReadyOwnedSignupOnboarding,
  startSignupHostedCheckout,
  type StartSignupHostedCheckoutOutcome,
} from '@/contexts/onboarding';
import { assertSignupDraftWriteAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { hashSignupUserId } from '@/lib/auth/signup-user-hash';
import { env } from '@/lib/env';
import { resolveTrustedApplicationOrigin } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';
import { asaasProvider } from '@/lib/payments/asaas';
import { parseDocument } from '@/lib/validation/document';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CHECKOUT_BODY_BYTES = 256;
const checkoutBodySchema = z.object({}).strict();

function json(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function authFailure(reason: string): NextResponse {
  if (
    reason === 'profile_denied' ||
    reason === 'credentials_pending' ||
    reason === 'credentials_invalid'
  ) {
    return json({ error: 'forbidden' }, 403);
  }
  if (reason === 'unavailable') return json({ error: 'unavailable' }, 503);
  return json({ error: 'unauthorized' }, 401);
}

function billingFailure(
  reason: Extract<StartSignupHostedCheckoutOutcome, { ok: false }>['reason'],
) {
  switch (reason) {
    case 'gone':
      return json({ error: 'gone' }, 410);
    case 'no_plan':
    case 'invalid_plan':
    case 'conflict':
      return json({ error: reason }, 409);
    case 'declined':
      return json({ error: 'declined' }, 402);
    case 'reconcile_required':
      return json({ error: 'reconcile_required' }, 409);
    case 'provider_unreachable':
    case 'unavailable':
    case 'already_active':
    default:
      return json({ error: 'unavailable' }, 503);
  }
}

async function provisionLegacyActiveDraft(input: {
  userId: string;
  email: string;
}): Promise<Response> {
  const billing = await readSignupBilling(input.userId);
  if (!billing.ok || !billing.snapshot.asaasCustomerId) {
    return json({ error: 'unavailable' }, 503);
  }
  const customer = await asaasProvider.getCustomer(billing.snapshot.asaasCustomerId, {
    attempts: 1,
  });
  const document =
    customer.customerId === billing.snapshot.asaasCustomerId
      ? parseDocument(customer.cpfCnpj ?? '')
      : null;
  if (!document) return json({ error: 'conflict' }, 409);
  const provisioned = await provisionTenantFromSignup({
    userId: input.userId,
    verifiedEmail: input.email,
    cpfCnpj: document.digits,
    ...(billing.snapshot.asaasSubscriptionId && {
      expectedAsaasSubscriptionId: billing.snapshot.asaasSubscriptionId,
    }),
  });
  if (provisioned.ok) {
    return json({ state: 'provisioned' });
  }
  return json(
    { error: provisioned.reason },
    provisioned.reason === 'unavailable' ? 503 : provisioned.reason === 'gone' ? 410 : 409,
  );
}

export async function POST(req: Request): Promise<Response> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED) {
    return json({ error: 'unavailable' }, 503);
  }

  const publicOrigin = resolveTrustedApplicationOrigin(req);
  if (publicOrigin === undefined) return json({ error: 'unavailable' }, 503);
  if (publicOrigin === null) return json({ error: 'blocked' }, 403);

  try {
    const onboarding = await resolveReadyOwnedSignupOnboarding();
    if (!onboarding.ok) return authFailure(onboarding.reason);
    if (onboarding.kind !== 'pretenant') return json({ error: 'forbidden' }, 403);

    const limit = await assertSignupDraftWriteAllowed(
      getClientIp(req.headers),
      hashSignupUserId(onboarding.userId),
    );
    if (!limit.ok) {
      const response = json({ error: limit.reason }, limit.reason === 'rate_limited' ? 429 : 503);
      if (limit.reason === 'rate_limited') {
        response.headers.set('Retry-After', String('retryAfter' in limit ? limit.retryAfter : 1));
      }
      return response;
    }

    const raw = await readWebhookBodyCapped(req, MAX_CHECKOUT_BODY_BYTES);
    if (raw === null) return json({ error: 'body_too_large' }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const body = checkoutBodySchema.safeParse(parsed);
    if (!body.success) return json({ error: 'invalid_body' }, 400);

    const checkout = await startSignupHostedCheckout({
      userId: onboarding.userId,
      publicOrigin,
    });
    if (checkout.ok) {
      return json({ state: checkout.state, checkoutUrl: checkout.checkoutUrl });
    }

    // Compatibilidade de recuperação para drafts criados pelo contrato anterior.
    if (checkout.reason === 'already_active') {
      const billing = await readSignupBilling(onboarding.userId);
      if (!billing.ok) return billingFailure('unavailable');
      if (billing.snapshot.asaasCheckoutId) {
        const completed = await completeSignupHostedCheckout({
          userId: onboarding.userId,
          verifiedEmail: onboarding.email,
        });
        return completed.ok
          ? json({ state: completed.state })
          : billingFailure(completed.reason === 'gone' ? 'gone' : 'unavailable');
      }
      return provisionLegacyActiveDraft({
        userId: onboarding.userId,
        email: onboarding.email,
      });
    }
    if (checkout.reason === 'reconcile_required') {
      const reconciled = await reconcileSignupSubscription({ userId: onboarding.userId });
      if (!reconciled.ok) return billingFailure('reconcile_required');
      if (reconciled.state === 'not_found') return billingFailure('reconcile_required');
      return provisionLegacyActiveDraft({
        userId: onboarding.userId,
        email: onboarding.email,
      });
    }
    return billingFailure(checkout.reason);
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}
