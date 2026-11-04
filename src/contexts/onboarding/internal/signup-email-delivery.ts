import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import {
  signupEmailDeliveryEvents,
  signupRecoveryGrants,
  signupSessions,
} from '@/contexts/onboarding/schema';
import { dbAdmin, type Tx } from '@/lib/db';
import type { EmailDeliveryState } from '@/lib/email/resend-webhook';
import { metrics } from '@/lib/observability/metrics';

async function applyDeliveryProjection(tx: Tx, messageId: string): Promise<void> {
  const [session] = await tx
    .select({ id: signupSessions.id })
    .from(signupSessions)
    .where(eq(signupSessions.confirmationMessageId, messageId))
    .for('update')
    .limit(1);
  if (!session) return;
  const [latest] = await tx
    .select({ state: signupEmailDeliveryEvents.event, at: signupEmailDeliveryEvents.occurredAt })
    .from(signupEmailDeliveryEvents)
    .where(eq(signupEmailDeliveryEvents.messageId, messageId))
    .orderBy(
      sql`CASE ${signupEmailDeliveryEvents.event}
      WHEN 'complained' THEN 100 WHEN 'suppressed' THEN 90 WHEN 'bounced' THEN 80
      WHEN 'failed' THEN 70 WHEN 'delivered' THEN 50 WHEN 'delivery_delayed' THEN 20 ELSE 10 END DESC`,
      sql`${signupEmailDeliveryEvents.occurredAt} DESC`,
    )
    .limit(1);
  if (latest)
    await tx
      .update(signupSessions)
      .set({
        confirmationDeliveryStatus: latest.state,
        confirmationDeliveryAt: latest.at,
      })
      .where(
        and(eq(signupSessions.id, session.id), eq(signupSessions.confirmationMessageId, messageId)),
      );
}

/** Covers the race where a provider webhook arrives before its send receipt. */
export async function reconcileSignupEmailDelivery(messageId: string): Promise<void> {
  await dbAdmin.transaction(async (tx) => {
    await applyDeliveryProjection(tx, messageId);
  });
}

export async function recordSignupEmailDelivery(input: {
  id: string;
  messageId: string;
  state: EmailDeliveryState;
  occurredAt: Date;
  bounceType: string | null;
}): Promise<'recorded' | 'duplicate'> {
  const result = await dbAdmin.transaction(async (tx) => {
    const [event] = await tx
      .insert(signupEmailDeliveryEvents)
      .values({
        id: input.id,
        messageId: input.messageId,
        event: input.state,
        occurredAt: input.occurredAt,
        bounceType: input.bounceType,
      })
      .onConflictDoNothing({ target: signupEmailDeliveryEvents.id })
      .returning({ id: signupEmailDeliveryEvents.id });
    if (!event) return 'duplicate' as const;
    // Serialize updates to one message. Old-message events stay in the ledger
    // and cannot overwrite the outcome of a newly resent code.
    await applyDeliveryProjection(tx, input.messageId);
    return 'recorded' as const;
  });
  if (result === 'recorded')
    metrics.emit('signup.email.delivery', { outcome: input.state, bounceType: input.bounceType });
  return result;
}

const SIGNUP_EMAIL_ARTIFACT_RETENTION_DAYS = 14;
/** Bounded janitor. Unknown external writes remain for explicit reconciliation. */
export async function purgeExpiredSignupEmailArtifacts(
  batch: number,
): Promise<{ grants: number; events: number }> {
  if (!Number.isInteger(batch) || batch < 1 || batch > 500)
    throw new Error('[signup] invalid email cleanup batch');
  const grants = await dbAdmin
    .delete(signupRecoveryGrants)
    .where(
      sql`${signupRecoveryGrants.id} IN (
    SELECT id FROM ${signupRecoveryGrants} WHERE expires_at < now() - make_interval(days => ${SIGNUP_EMAIL_ARTIFACT_RETENTION_DAYS})
    AND state IN ('prepared','sent','consumed','revoked') AND password_state IN ('none','set') LIMIT ${batch}
  )`,
    )
    .returning({ id: signupRecoveryGrants.id });
  const events = await dbAdmin
    .delete(signupEmailDeliveryEvents)
    .where(
      sql`${signupEmailDeliveryEvents.id} IN (
    SELECT e.id FROM ${signupEmailDeliveryEvents} e
    WHERE e.received_at < now() - make_interval(days => ${SIGNUP_EMAIL_ARTIFACT_RETENTION_DAYS})
    AND NOT EXISTS (SELECT 1 FROM ${signupSessions} s WHERE s.confirmation_message_id=e.message_id)
    AND NOT EXISTS (SELECT 1 FROM ${signupRecoveryGrants} g WHERE g.provider_message_id=e.message_id)
    LIMIT ${batch}
  )`,
    )
    .returning({ id: signupEmailDeliveryEvents.id });
  if (grants.length || events.length)
    metrics.emit('signup.email.artifacts_purged', { grants: grants.length, events: events.length });
  return { grants: grants.length, events: events.length };
}
