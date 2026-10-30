import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { signupSessions } from '@/contexts/onboarding/schema';

/**
 * O Checkout hospedado pode terminar depois do TTL do formulario. Isto autoriza
 * apenas a conciliacao financeira da mesma conta Auth: nao reabre a edicao do
 * cadastro nem permite criar outra tentativa de cobranca.
 */
export function recoverableHostedCheckoutCondition(userId: string) {
  return and(
    eq(signupSessions.authUserId, userId),
    eq(signupSessions.status, 'email_verified'),
    eq(signupSessions.authAttemptState, 'completed'),
    isNotNull(signupSessions.consumedAt),
    inArray(signupSessions.billingAttemptState, ['checkout_pending', 'active']),
    isNotNull(signupSessions.billingAttemptedAt),
    isNotNull(signupSessions.asaasCheckoutId),
  );
}
