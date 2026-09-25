/**
 * POST /api/signup/checkout — O-5 + O-6, na ordem que a decisão de 02/09 exige.
 *
 * O corpo carrega EXATAMENTE um campo: o CPF/CNPJ do responsável pela cobrança.
 * Ele está aqui porque o contrato do Asaas exige documento para assinar — medido
 * no sandbox, não suposto (ADR-053). E ele não é uma afirmação de autoridade: é
 * dado da própria pessoa. O browser continua sem escolher plano, valor, ciclo,
 * trial, `clinic_id` ou papel — tudo isso vem do draft verificado ou do servidor,
 * e a identidade de quem pede vem de `getUser()`.
 *
 * O documento NÃO é persistido nesta etapa. Ele atravessa a requisição em
 * memória e só descansa cifrado por tenant em `billing_customers`, no
 * provisionamento. Antes disso não existe chave de tenant para cifrá-lo.
 *
 * A rota é idempotente por construção. Chamada de novo depois de a assinatura
 * existir, `reserveSignupBillingAttempt` devolve `already_active` e o
 * provisionamento é tentado de novo — é assim que uma resposta perdida, um
 * refresh ou uma segunda aba se recuperam sem criar a segunda assinatura.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  provisionTenantFromSignup,
  reconcileSignupSubscription,
  resolveReadyOwnedSignupOnboarding,
  startSignupSubscription,
  type StartSignupSubscriptionOutcome,
} from '@/contexts/onboarding';
import { assertSignupDraftWriteAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { parseDocument } from '@/lib/validation/document';
import { hashSignupUserId } from '@/lib/auth/signup-user-hash';
import { env } from '@/lib/env';
import { buildApplicationUrl } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Um documento com máscara cabe folgado; o resto é cliente tentando opinar. */
const MAX_CHECKOUT_BODY_BYTES = 256;

/**
 * `.strict()` recusa qualquer campo extra em vez de ignorar. Ignorar ensinaria
 * o cliente a mandar `planId`/`priceCents`/`clinicId` e esconderia a divergência
 * na fatia seguinte.
 */
const checkoutBodySchema = z.object({ cpfCnpj: z.string().min(1).max(32) }).strict();

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

/** Cada motivo tem um status próprio porque a UI reage diferente a cada um. */
function billingFailure(reason: Extract<StartSignupSubscriptionOutcome, { ok: false }>['reason']) {
  switch (reason) {
    case 'gone':
      return json({ error: 'gone' }, 410);
    case 'no_plan':
      return json({ error: 'no_plan' }, 409);
    case 'invalid_plan':
      return json({ error: 'invalid_plan' }, 409);
    case 'conflict':
      return json({ error: 'conflict' }, 409);
    case 'declined':
      // 402: o provedor recusou. É definitivo e retentável com outros dados —
      // não é erro nosso nem indisponibilidade.
      return json({ error: 'declined' }, 402);
    case 'reconcile_required':
      // 409 e não 503: o estado é conhecido e exige conciliação, não espera.
      return json({ error: 'reconcile_required' }, 409);
    case 'provider_unreachable':
    case 'unavailable':
    default:
      return json({ error: 'unavailable' }, 503);
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return json({ error: 'unavailable' }, 503);

  let origin: string;
  try {
    origin = new URL(
      buildApplicationUrl(env.APP_BASE_URL ?? '', '/', {
        allowInsecureLocalhost: env.NODE_ENV !== 'production',
      }),
    ).origin;
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
  if (req.headers.get('origin') !== origin || req.headers.get('sec-fetch-site') === 'cross-site') {
    return json({ error: 'blocked' }, 403);
  }

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

    // Validação no SERVIDOR, com dígitos verificadores. O campo é do usuário,
    // mas a aceitação não: um documento inválido vira 422 aqui, antes de gastar
    // uma chamada ao provedor e antes de reservar a tentativa.
    const document = parseDocument(body.data.cpfCnpj);
    if (!document) return json({ error: 'invalid_document' }, 422);

    const subscription = await startSignupSubscription({
      userId: onboarding.userId,
      verifiedEmail: onboarding.email,
      cpfCnpj: document.digits,
    });

    if (!subscription.ok && subscription.reason === 'reconcile_required') {
      // A tentativa anterior morreu em timeout e a assinatura pode existir do
      // outro lado. Conciliar é PERGUNTAR, não criar — e é o único caminho de
      // saída desse estado. Sem isto, quem cai nele fica preso para sempre.
      const reconciled = await reconcileSignupSubscription({ userId: onboarding.userId });
      if (!reconciled.ok) return billingFailure('unavailable');
      if (reconciled.state === 'not_found') {
        // O provedor não tem nada com esta referência. Não liberamos nova
        // criação automaticamente: a decisão é da operação, com o runbook.
        return json({ error: 'reconcile_required' }, 409);
      }
      // Encontrou: o estado virou `active` e o fluxo segue para o tenant.
    } else if (!subscription.ok && subscription.reason !== 'already_active') {
      // `already_active` não é falha: é a resposta perdida voltando. Segue para
      // o provisionamento, que é quem sabe se o tenant já nasceu.
      return billingFailure(subscription.reason);
    }

    const provisioned = await provisionTenantFromSignup({
      userId: onboarding.userId,
      verifiedEmail: onboarding.email,
      cpfCnpj: document.digits,
    });
    if (!provisioned.ok) {
      if (provisioned.reason === 'gone') {
        // A sessão sumiu porque o provisionamento anterior a consumiu. Para quem
        // chamou, isto é sucesso: a clínica existe e o destino é o dashboard.
        return json({ state: 'provisioned' });
      }
      const status =
        provisioned.reason === 'not_paid' || provisioned.reason === 'no_plan'
          ? 409
          : provisioned.reason === 'slug_unavailable'
            ? 409
            : 503;
      return json({ error: provisioned.reason }, status);
    }

    return json({ state: 'provisioned' });
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}
