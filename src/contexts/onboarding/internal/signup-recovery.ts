import 'server-only';

import { createHmac, randomUUID } from 'node:crypto';
import { and, desc, eq, gt, inArray, or, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { signupRecoveryGrants, signupSessions } from '@/contexts/onboarding/schema';
import { hashEmail } from '@/lib/auth/email-hash';
import { createAdminClient, findAdminUserByEmail } from '@/lib/auth/supabase-admin';
import { clearSupabaseSessionSelector, createServerClient } from '@/lib/auth/supabase-server';
import { readAuthoritativeProfile } from '@/lib/auth/tenant-context';
import { env } from '@/lib/env';
import { dbAdmin } from '@/lib/db';
import { logger } from '@/lib/observability/logger';

import { readSignupAuthBinding } from './signup-auth-binding';
import { markSignupPasswordSet } from './signup-auth-binding';
import { resumeRetainedOwnedSignupDraft, ensureSignupDraftForVerifiedEmail } from './signup-draft';
import { resolveSignupContinuation } from './signup-email-code';
import { checkSignupPasswordExposure } from './signup-confirmation-email';
import { signupPasswordSchema } from '@/lib/auth/signup-password';
import { sendTransactionalEmailRetried } from '@/lib/email/retry';
import { renderSignupRecoveryEmail } from '@/lib/email/templates/signup-recovery';
import { buildApplicationUrl, resolvePreviewCallbackOrigin } from '@/lib/http/application-url';
import { isUniqueViolation } from '@/lib/outbox/errors';

export { SIGNUP_RECOVERY_COOKIE } from '@/lib/auth/signup-confirmation-grant';
export const signupRecoveryInputSchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) })
  .strict();

/** Public re-entry never creates an Auth user, and never enumerates an account. */
export async function requestSignupRecovery(email: string, publicOrigin: string): Promise<void> {
  const found = await findAdminUserByEmail(email);
  if (found.kind !== 'found') return;
  const binding = readSignupAuthBinding(found.user);
  if (!binding || (await readAuthoritativeProfile(found.user.id))) return;
  const emailHash = hashEmail(email);
  const [session] = await dbAdmin
    .select({ messageId: signupSessions.confirmationMessageId })
    .from(signupSessions)
    .where(
      and(
        eq(signupSessions.emailHash, emailHash),
        or(
          eq(signupSessions.pendingAuthUserId, found.user.id),
          eq(signupSessions.authUserId, found.user.id),
        ),
        isNotNull(signupSessions.confirmationMessageId),
      ),
    )
    .orderBy(desc(signupSessions.createdAt))
    .limit(1);
  const previous = session?.messageId
    ? null
    : (
        await dbAdmin
          .select({ messageId: signupRecoveryGrants.providerMessageId })
          .from(signupRecoveryGrants)
          .where(
            and(
              eq(signupRecoveryGrants.authUserId, found.user.id),
              eq(signupRecoveryGrants.emailHash, emailHash),
              isNotNull(signupRecoveryGrants.providerMessageId),
            ),
          )
          .orderBy(desc(signupRecoveryGrants.createdAt))
          .limit(1)
      )[0];
  const priorMessageId = session?.messageId ?? previous?.messageId;
  if (!priorMessageId) return;
  const result = await sendSignupLeadRecovery({
    userId: found.user.id,
    operationKey: `request:${emailHash}:${Math.floor(Date.now() / 60_000)}`,
    purpose: found.user.email_confirmed_at ? 'resume_signup' : 'verify_email',
    priorMessageId,
    publicOrigin,
  });
  if (!result.ok) logger.warn('signup.recovery.request_not_sent', { reason: result.reason });
}

function digest(value: string): string {
  if (!env.MAGIC_TOKEN_SECRET) throw new Error('[signup] recovery secret unavailable');
  return createHmac('sha256', env.MAGIC_TOKEN_SECRET)
    .update(`qoro/signup-recovery/v1:${value}`)
    .digest('hex');
}

/** Deterministic per operation: the raw secret is never stored, even for retries. */
function grantToken(id: string, operation: string): string {
  return Buffer.from(digest(`issue:${id}:${operation}`), 'hex').toString('base64url');
}

/** Operator-only preparation; does not send email, verify Auth, or create billing. */
export async function prepareSignupRecovery(input: {
  userId: string;
  operationKey: string;
  purpose: 'verify_email' | 'resume_signup';
}): Promise<
  | { ok: true; id: string; token: string; email: string; expiresAt: Date }
  | { ok: false; reason: 'ineligible' | 'unavailable' }
> {
  const parsed = z
    .object({
      userId: z.string().uuid(),
      operationKey: z.string().min(1).max(200),
      purpose: z.enum(['verify_email', 'resume_signup']),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'ineligible' };
  const admin = createAdminClient();
  const account = await admin.auth.admin.getUserById(input.userId);
  const user = account.data.user;
  if (account.error) return { ok: false, reason: 'unavailable' };
  const binding = user ? readSignupAuthBinding(user) : null;
  if (
    !user?.email ||
    !binding ||
    (await readAuthoritativeProfile(input.userId)) ||
    user.invited_at ||
    user.banned_until ||
    (input.purpose === 'verify_email' &&
      (user.email_confirmed_at || binding.passwordState !== 'pending')) ||
    (input.purpose === 'resume_signup' && !user.email_confirmed_at)
  )
    return { ok: false, reason: 'ineligible' };
  const existing = await dbAdmin
    .select()
    .from(signupRecoveryGrants)
    .where(eq(signupRecoveryGrants.operationKey, input.operationKey))
    .limit(1);
  let grant = existing[0];
  if (!grant) {
    const id = randomUUID();
    const token = grantToken(id, input.operationKey);
    await dbAdmin
      .insert(signupRecoveryGrants)
      .values({
        id,
        tokenHash: digest(`consume:${token}`),
        operationKey: input.operationKey,
        authUserId: user.id,
        emailHash: hashEmail(user.email),
        signupRef: binding.signupRef,
        purpose: input.purpose,
        expiresAt: sql`now() + interval '24 hours'`,
      })
      .onConflictDoNothing({ target: signupRecoveryGrants.operationKey });
    grant = (
      await dbAdmin
        .select()
        .from(signupRecoveryGrants)
        .where(eq(signupRecoveryGrants.operationKey, input.operationKey))
        .limit(1)
    )[0];
  }
  if (
    !grant ||
    grant.authUserId !== user.id ||
    grant.emailHash !== hashEmail(user.email) ||
    grant.signupRef !== binding.signupRef ||
    grant.purpose !== input.purpose ||
    grant.expiresAt.getTime() <= Date.now() ||
    grant.state !== 'prepared'
  )
    return { ok: false, reason: 'ineligible' };
  return {
    ok: true,
    id: grant.id,
    token: grantToken(grant.id, grant.operationKey),
    email: user.email,
    expiresAt: grant.expiresAt,
  };
}

/** Explicit operator command only. Rechecks eligibility, prior delivery and CAS before sending once. */
export async function sendSignupLeadRecovery(input: {
  userId: string;
  operationKey: string;
  purpose: 'verify_email' | 'resume_signup';
  priorMessageId: string;
  publicOrigin: string;
}): Promise<
  | { ok: true; messageId: string }
  | { ok: false; reason: 'ineligible' | 'suppressed' | 'unavailable' | 'uncertain' }
> {
  const configuredOrigin = resolvePreviewCallbackOrigin() ?? env.APP_BASE_URL;
  if (!configuredOrigin || new URL(configuredOrigin).origin !== input.publicOrigin)
    return { ok: false, reason: 'unavailable' };
  if (!z.string().uuid().safeParse(input.priorMessageId).success || !env.RESEND_API_KEY)
    return { ok: false, reason: 'unavailable' };
  const prepared = await prepareSignupRecovery({
    userId: input.userId,
    operationKey: input.operationKey,
    purpose: input.purpose,
  });
  if (!prepared.ok) return prepared;
  const prior = await fetch(`https://api.resend.com/emails/${input.priorMessageId}`, {
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!prior.ok) return { ok: false, reason: 'unavailable' };
  const check = z
    .object({
      to: z.array(z.string().email()),
      last_event: z.string(),
      bounce: z.unknown().optional(),
    })
    .safeParse(await prior.json());
  if (
    !check.success ||
    check.data.to.length !== 1 ||
    hashEmail(check.data.to[0]!) !== hashEmail(prepared.email)
  )
    return { ok: false, reason: 'ineligible' };
  if (['bounced', 'complained', 'suppressed', 'failed'].includes(check.data.last_event))
    return { ok: false, reason: 'suppressed' };
  if (
    !['sent', 'delivered', 'delivery_delayed', 'opened', 'clicked'].includes(check.data.last_event)
  )
    return { ok: false, reason: 'unavailable' };
  // prepare re-reads Auth/profile immediately before the irreversible send.
  const current = await prepareSignupRecovery({
    userId: input.userId,
    operationKey: input.operationKey,
    purpose: input.purpose,
  });
  if (!current.ok || current.email !== prepared.email || current.id !== prepared.id)
    return { ok: false, reason: 'ineligible' };
  const [details] = await dbAdmin
    .select({ ownerName: signupSessions.ownerName })
    .from(signupSessions)
    .where(
      and(
        eq(signupSessions.emailHash, hashEmail(prepared.email)),
        or(
          eq(signupSessions.authUserId, input.userId),
          eq(signupSessions.pendingAuthUserId, input.userId),
        ),
        isNotNull(signupSessions.ownerName),
        isNotNull(signupSessions.clinicName),
        isNotNull(signupSessions.answeredAt),
        or(
          gt(signupSessions.absoluteExpiresAt, sql`now()`),
          gt(signupSessions.recoveryExpiresAt, sql`now()`),
        ),
      ),
    )
    .limit(1);
  const [reserved] = await dbAdmin
    .update(signupRecoveryGrants)
    .set({ state: 'sending' })
    .where(
      and(
        eq(signupRecoveryGrants.id, prepared.id),
        eq(signupRecoveryGrants.state, 'prepared'),
        gt(signupRecoveryGrants.expiresAt, sql`now()`),
      ),
    )
    .returning({ id: signupRecoveryGrants.id });
  if (!reserved) return { ok: false, reason: 'ineligible' };
  try {
    const url = new URL(
      buildApplicationUrl(input.publicOrigin, '/cadastro/retomar', {
        allowInsecureLocalhost: env.NODE_ENV !== 'production',
      }),
    );
    url.hash = new URLSearchParams({ token: prepared.token }).toString();
    const content = renderSignupRecoveryEmail({
      url: url.href,
      publicOrigin: input.publicOrigin,
      ...(details?.ownerName ? { name: details.ownerName } : {}),
      kind: input.purpose,
      retainedDetails: Boolean(details),
    });
    const result = await sendTransactionalEmailRetried({
      to: prepared.email,
      ...content,
      idempotencyKey: `signup-recovery:${prepared.id}`,
    });
    if (!z.string().uuid().safeParse(result.providerMessageId).success)
      throw new Error('recovery_receipt_invalid');
    const [saved] = await dbAdmin
      .update(signupRecoveryGrants)
      .set({ state: 'sent', providerMessageId: result.providerMessageId })
      .where(
        and(eq(signupRecoveryGrants.id, prepared.id), eq(signupRecoveryGrants.state, 'sending')),
      )
      .returning({ id: signupRecoveryGrants.id });
    if (!saved) throw new Error('recovery_receipt_unavailable');
    return { ok: true, messageId: result.providerMessageId };
  } catch {
    await dbAdmin
      .update(signupRecoveryGrants)
      .set({ state: 'uncertain' })
      .where(
        and(eq(signupRecoveryGrants.id, prepared.id), eq(signupRecoveryGrants.state, 'sending')),
      );
    logger.warn('signup.recovery.send_failed', { stage: 'delivery' });
    return { ok: false, reason: 'uncertain' };
  }
}

/** Token proof converges on the same Auth identity and continuation resolver as the code. */
export async function consumeSignupRecovery(
  input: unknown,
): Promise<
  | { ok: true; next: string; userId: string; signupRef: string }
  | { ok: false; reason: 'invalid' | 'unavailable' }
> {
  const parsed = signupRecoveryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  const [grant] = await dbAdmin
    .update(signupRecoveryGrants)
    .set({ state: 'reserved' })
    .where(
      and(
        eq(signupRecoveryGrants.tokenHash, digest(`consume:${parsed.data.token}`)),
        inArray(signupRecoveryGrants.state, ['sent', 'uncertain']),
        gt(signupRecoveryGrants.expiresAt, sql`now()`),
      ),
    )
    .returning();
  if (!grant) return { ok: false, reason: 'invalid' };
  let client: Awaited<ReturnType<typeof createServerClient>> | undefined;
  try {
    const admin = createAdminClient();
    const found = await admin.auth.admin.getUserById(grant.authUserId);
    const user = found.data.user;
    const binding = user ? readSignupAuthBinding(user) : null;
    if (found.error) throw new Error('recovery_lookup_unavailable');
    if (
      !user?.email ||
      !binding ||
      hashEmail(user.email) !== grant.emailHash ||
      user.invited_at ||
      user.banned_until ||
      (await readAuthoritativeProfile(grant.authUserId))
    ) {
      await dbAdmin
        .update(signupRecoveryGrants)
        .set({ state: 'revoked' })
        .where(eq(signupRecoveryGrants.id, grant.id));
      return { ok: false, reason: 'invalid' };
    }
    // This link never changes a password or clears its untrusted provenance.
    // A prepared credential stays pending until the mailbox owner chooses it
    // through the protected password step, or proves the original browser code.
    if (binding.signupRef !== grant.signupRef) throw new Error('recovery_binding_changed');
    const link = await admin.auth.admin.generateLink({ type: 'recovery', email: user.email });
    if (link.error || link.data.user.id !== user.id || !link.data.properties.hashed_token)
      throw new Error('recovery_proof_unavailable');
    await clearSupabaseSessionSelector();
    client = await createServerClient({ cookieWrites: 'required', newSession: true });
    const proof = await client.auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: 'recovery',
    });
    if (
      proof.error ||
      proof.data.user?.id !== user.id ||
      !proof.data.user.email_confirmed_at ||
      !proof.data.user.email ||
      hashEmail(proof.data.user.email) !== grant.emailHash
    )
      throw new Error('recovery_proof_rejected');
    // Fresh mail proof may restore retained progress, never an expired anonymous
    // cookie. No names, consent, selected plan or provider IDs are replaced.
    await dbAdmin
      .update(signupSessions)
      .set({
        absoluteExpiresAt: sql`least(now() + interval '1 hour', coalesce(${signupSessions.recoveryExpiresAt}, ${signupSessions.absoluteExpiresAt}))`,
        idleExpiresAt: sql`least(now() + interval '1 hour', coalesce(${signupSessions.recoveryExpiresAt}, ${signupSessions.absoluteExpiresAt}))`,
        rowVersion: sql`${signupSessions.rowVersion} + 1`,
      })
      .where(
        and(
          eq(signupSessions.tokenHash, grant.signupRef),
          eq(signupSessions.emailHash, grant.emailHash),
          eq(signupSessions.status, 'email_pending'),
          or(
            gt(signupSessions.recoveryExpiresAt, sql`now()`),
            gt(signupSessions.absoluteExpiresAt, sql`now()`),
          ),
        ),
      );
    const claimed = await ensureSignupDraftForVerifiedEmail(user.id, user.email, grant.signupRef);
    if (!claimed.ok && claimed.reason === 'unavailable')
      throw new Error('recovery_progress_unavailable');
    const [consumed] = await dbAdmin
      .update(signupRecoveryGrants)
      .set({ state: 'consumed', consumedAt: sql`now()` })
      .where(
        and(
          eq(signupRecoveryGrants.id, grant.id),
          eq(signupRecoveryGrants.state, 'reserved'),
          sql`NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = ${user.id}::uuid)`,
        ),
      )
      .returning({ id: signupRecoveryGrants.id });
    if (!consumed) throw new Error('recovery_finalization_unavailable');
    if (binding.passwordState === 'pending')
      return {
        ok: true,
        next: '/cadastro/confirmado',
        userId: user.id,
        signupRef: grant.signupRef,
      };
    await resumeRetainedOwnedSignupDraft(user.id, user.email, grant.signupRef);
    const continuation = await resolveSignupContinuation();
    if (!continuation.ok) throw new Error('recovery_continuation_unavailable');
    return { ...continuation, userId: user.id, signupRef: grant.signupRef };
  } catch {
    if (client) await client.auth.signOut({ scope: 'local' });
    await clearSupabaseSessionSelector();
    // A partially executed grant is not automatically made reusable.
    logger.warn('signup.recovery.consume_failed', { stage: 'proof' });
    return { ok: false, reason: 'unavailable' };
  }
}

export async function readConsumedSignupRecovery(userId: string, signupRef: string) {
  const [grant] = await dbAdmin
    .select()
    .from(signupRecoveryGrants)
    .where(
      and(
        eq(signupRecoveryGrants.authUserId, userId),
        eq(signupRecoveryGrants.signupRef, signupRef),
        eq(signupRecoveryGrants.state, 'consumed'),
        gt(signupRecoveryGrants.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(signupRecoveryGrants.consumedAt))
    .limit(1);
  return grant ?? null;
}

/** First chosen password for a proven recovered account whose old staging is gone. */
export async function completeRecoveredSignupPassword(input: {
  userId: string;
  email: string;
  signupRef: string;
  password: string;
}): Promise<
  | { ok: true; next: string }
  | { ok: false; reason: 'unauthorized' | 'weak_password' | 'conflict' | 'unavailable' }
> {
  if (!signupPasswordSchema.safeParse(input.password).success)
    return { ok: false, reason: 'weak_password' };
  const grant = await readConsumedSignupRecovery(input.userId, input.signupRef);
  if (!grant || grant.emailHash !== hashEmail(input.email))
    return { ok: false, reason: 'unauthorized' };
  const admin = createAdminClient();
  const found = await admin.auth.admin.getUserById(input.userId);
  const user = found.data.user;
  const binding = user ? readSignupAuthBinding(user) : null;
  if (found.error) return { ok: false, reason: 'unavailable' };
  if (
    !user?.email_confirmed_at ||
    !user.email ||
    hashEmail(user.email) !== grant.emailHash ||
    binding?.signupRef !== input.signupRef ||
    (await readAuthoritativeProfile(input.userId))
  )
    return { ok: false, reason: 'unauthorized' };
  if (binding.passwordState === 'pending') {
    const exposure = await checkSignupPasswordExposure(input.password);
    if (exposure !== 'safe')
      return { ok: false, reason: exposure === 'pwned' ? 'weak_password' : 'unavailable' };
    try {
      const [reserved] = await dbAdmin
        .update(signupRecoveryGrants)
        .set({ passwordState: 'reserved' })
        .where(
          and(
            eq(signupRecoveryGrants.id, grant.id),
            eq(signupRecoveryGrants.state, 'consumed'),
            eq(signupRecoveryGrants.passwordState, 'none'),
            gt(signupRecoveryGrants.expiresAt, sql`now()`),
          ),
        )
        .returning({ id: signupRecoveryGrants.id });
      if (!reserved) return { ok: false, reason: 'conflict' };
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false, reason: 'conflict' };
      throw error;
    }
    try {
      const changed = await admin.auth.admin.updateUserById(user.id, {
        password: input.password,
        app_metadata: markSignupPasswordSet(user, input.signupRef),
      });
      if (changed.error?.code === 'weak_password') {
        await dbAdmin
          .update(signupRecoveryGrants)
          .set({ passwordState: 'none' })
          .where(
            and(
              eq(signupRecoveryGrants.id, grant.id),
              eq(signupRecoveryGrants.passwordState, 'reserved'),
            ),
          );
        return { ok: false, reason: 'weak_password' };
      }
      if (changed.error || readSignupAuthBinding(changed.data.user)?.passwordState !== 'set')
        throw new Error('recovery_password_unavailable');
    } catch {
      await dbAdmin
        .update(signupRecoveryGrants)
        .set({ passwordState: 'uncertain' })
        .where(
          and(
            eq(signupRecoveryGrants.id, grant.id),
            eq(signupRecoveryGrants.passwordState, 'reserved'),
          ),
        );
      return { ok: false, reason: 'unavailable' };
    }
  }
  await dbAdmin
    .update(signupRecoveryGrants)
    .set({ passwordState: 'set' })
    .where(
      and(
        eq(signupRecoveryGrants.id, grant.id),
        eq(signupRecoveryGrants.state, 'consumed'),
        inArray(signupRecoveryGrants.passwordState, ['none', 'reserved', 'uncertain', 'set']),
      ),
    );
  const client = await createServerClient({ cookieWrites: 'required', newSession: true });
  const authenticated = await client.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });
  if (authenticated.error || authenticated.data.user?.id !== input.userId) {
    await client.auth.signOut({ scope: 'local' });
    await clearSupabaseSessionSelector();
    return { ok: false, reason: 'unauthorized' };
  }
  const next = await resolveSignupContinuation();
  return next.ok ? next : { ok: false, reason: 'unavailable' };
}
