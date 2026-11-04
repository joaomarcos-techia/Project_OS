/** Real local GoTrue + migrated PostgreSQL. Only the Next cookie adapter is replaced.
 * No email is sent, no Asaas request/payment is made. This is not browser E2E.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted((): { client: SupabaseClient | null } => ({ client: null }));
vi.mock('@/lib/auth/supabase-server', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const fresh = () =>
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  return {
    clearSupabaseSessionSelector: async () => {
      state.client = null;
    },
    createServerClient: async (options?: { newSession?: boolean }) => {
      if (!state.client || options?.newSession) state.client = fresh();
      return state.client;
    },
  };
});

import { hashEmail } from '@/lib/auth/email-hash';
import { dbAdmin } from '@/lib/db';
import { createAdminClient } from '@/lib/auth/supabase-admin';
import {
  createPendingSignupAppMetadata,
  deriveSignupHandoffCode,
  readSignupAuthBinding,
  markSignupPasswordSet,
} from '@/contexts/onboarding/internal/signup-auth-binding';
import {
  reserveSignupAuthAttempt,
  readReservedSignupAttemptEpoch,
  finishSignupAuthAttempt,
  hashSignupToken,
} from '@/contexts/onboarding/internal/signup-session';
import { confirmSignupEmailCode } from '@/contexts/onboarding/internal/signup-email-code';
import {
  prepareSignupRecovery,
  consumeSignupRecovery,
  completeRecoveredSignupPassword,
} from '@/contexts/onboarding/internal/signup-recovery';

const fixtures: { userId: string; ref: string; email: string }[] = [];
const sql = postgres(process.env.DATABASE_URL!, {
  ssl: 'require',
  max: 2,
  onnotice: () => undefined,
});
const admin = createAdminClient();
const fresh = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
beforeAll(() => {
  assert.equal(process.env.SIGNUP_LOCAL_INTEGRATION, 'ONLY_SYNTHETIC_LOCAL_55442');
  const api = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const db = new URL(process.env.DATABASE_URL!);
  assert.equal(api.hostname, '127.0.0.1');
  assert.equal(api.port, '55441');
  assert.equal(db.hostname, '127.0.0.1');
  assert.equal(db.port, '55442');
});
afterAll(async () => {
  for (const fixture of fixtures) {
    assert.match(fixture.email, /^qoro-local-[0-9a-f-]+@example\.test$/u);
    const [profiles] =
      await sql`select count(*)::int as n from public.profiles where id=${fixture.userId}::uuid`;
    assert.equal(profiles?.n, 0, 'Refuse automatic cleanup of an unexpected provisioned profile');
    await sql`delete from signup_recovery_grants where auth_user_id=${fixture.userId}::uuid`;
    await sql`delete from signup_sessions where token_hash=${fixture.ref} or auth_user_id=${fixture.userId}::uuid or pending_auth_user_id=${fixture.userId}::uuid`;
    const removed = await admin.auth.admin.deleteUser(fixture.userId);
    assert.equal(removed.error, null);
  }
  await sql.end({ timeout: 2 });
  await dbAdmin.$client.end({ timeout: 2 });
});

async function account(withDraft: boolean, legacyPasswordless = false) {
  const email = `qoro-local-${randomUUID()}@example.test`;
  const password = `${randomBytes(16).toString('hex')}Aa9!`;
  const token = randomBytes(32).toString('base64url');
  const ref = hashSignupToken(token);
  const created = await admin.auth.admin.createUser({
    email,
    ...(legacyPasswordless ? {} : { password }),
    email_confirm: false,
    app_metadata: createPendingSignupAppMetadata(ref, !legacyPasswordless),
  });
  assert.equal(created.error, null);
  assert.ok(created.data.user);
  const userId = created.data.user.id;
  fixtures.push({ userId, email, ref });
  if (withDraft) {
    await sql`insert into signup_sessions(token_hash,status,idle_expires_at,absolute_expires_at,owner_name,clinic_name,email_hash,accepted_at,
      professionals_band,weekly_appointments_band,current_tooling,discovery_source,answered_at)
      values(${ref},'identity_pending',now()+interval '15 minutes',now()+interval '1 hour','Synthetic owner','Synthetic clinic',${hashEmail(email)},now(),
      '1','ate_20','nada_papel','outro',now())`;
    const reserved = await reserveSignupAuthAttempt(token, {
      rowVersion: 1,
      email,
      password,
      accepted: true,
    });
    assert.ok(reserved.ok);
    const epoch = await readReservedSignupAttemptEpoch(token, reserved.rowVersion, 'initial');
    assert.ok(epoch);
    assert.equal((await finishSignupAuthAttempt(token, reserved.rowVersion, 'completed')).ok, true);
    await sql`update signup_sessions set pending_auth_user_id=${userId}::uuid where token_hash=${ref}`;
    return { userId, email, ref, password, token, code: deriveSignupHandoffCode(ref, epoch) };
  }
  return { userId, email, ref, password, token, code: '' };
}

describe('real local Auth + DB', () => {
  it('confirms email with code, preserves the chosen password and grants only pre-tenant continuation', async () => {
    const f = await account(true);
    state.client = fresh();
    const before = await fresh().auth.signInWithPassword({ email: f.email, password: f.password });
    expect(before.error?.code).toBe('email_not_confirmed');
    const result = await confirmSignupEmailCode(f.token, { email: f.email, code: f.code });
    expect(result).toEqual({ ok: true, next: '/cadastro/plano' });
    const actual = await admin.auth.admin.getUserById(f.userId);
    assert.ok(actual.data.user?.email_confirmed_at);
    expect(readSignupAuthBinding(actual.data.user)).toEqual({
      signupRef: f.ref,
      passwordState: 'set',
    });
    const signed = await fresh().auth.signInWithPassword({ email: f.email, password: f.password });
    assert.equal(signed.error, null);
    const [row] =
      await sql`select row_to_json(s) as value from signup_sessions s where token_hash=${f.ref}`;
    assert.ok(
      !JSON.stringify(row?.value).includes(f.password),
      'Password must never enter signup staging',
    );
    expect(row?.value.status).toBe('email_verified');
    expect(row?.value.email_code_state).toBe('verified');
    const [profile] = await sql`select count(*)::int as n from profiles where id=${f.userId}::uuid`;
    expect(profile?.n).toBe(0);
    const repeat = await confirmSignupEmailCode(f.token, { email: f.email, code: f.code });
    expect(repeat).toEqual(result);
  });
  it('recovers a legacy account without staging and accepts its first chosen password without another Auth user', async () => {
    const f = await account(false, true);
    state.client = fresh();
    const prepared = await prepareSignupRecovery({
      userId: f.userId,
      operationKey: `local-${randomUUID()}`,
      purpose: 'verify_email',
    });
    assert.ok(prepared.ok);
    // Synthetic provider acknowledgment only; this does NOT prove external mail delivery.
    await sql`update signup_recovery_grants set state='sent' where id=${prepared.id}::uuid`;
    const proof = await consumeSignupRecovery({ token: prepared.token });
    expect(proof.ok).toBe(true);
    expect(await consumeSignupRecovery({ token: prepared.token })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    const chosen = `${randomBytes(16).toString('hex')}Bb7!`;
    const result = await completeRecoveredSignupPassword({
      userId: f.userId,
      email: f.email,
      signupRef: f.ref,
      password: chosen,
    });
    expect(result).toEqual({ ok: true, next: '/cadastro/continuar' });
    const signed = await fresh().auth.signInWithPassword({ email: f.email, password: chosen });
    assert.equal(signed.error, null);
    const [count] = await sql`select count(*)::int as n from auth.users where email=${f.email}`;
    expect(count?.n).toBe(1);
  });
  it('preserves a confirmed ready account password and resumes its actual missing details', async () => {
    const f = await account(false);
    state.client = fresh();
    const original = await admin.auth.admin.getUserById(f.userId);
    assert.ok(original.data.user);
    const updated = await admin.auth.admin.updateUserById(f.userId, {
      email_confirm: true,
      app_metadata: markSignupPasswordSet(original.data.user, f.ref),
    });
    assert.equal(updated.error, null);
    const prepared = await prepareSignupRecovery({
      userId: f.userId,
      operationKey: `local-${randomUUID()}`,
      purpose: 'resume_signup',
    });
    assert.ok(prepared.ok);
    await sql`update signup_recovery_grants set state='sent' where id=${prepared.id}::uuid`;
    const result = await consumeSignupRecovery({ token: prepared.token });
    expect(result.ok && result.next).toBe('/cadastro/continuar');
    const signed = await fresh().auth.signInWithPassword({ email: f.email, password: f.password });
    assert.equal(signed.error, null);
  });
});
