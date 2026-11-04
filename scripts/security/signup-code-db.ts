/** Isolated synthetic PostgreSQL proof. No Auth provider, email, Sandbox or remote DB. */
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { startScratchSchema } from './scratch-schema';

const legacyId = randomUUID();
let legacyBefore: unknown;
let cleanupTargetVerified = false;
const cluster = await startScratchSchema({
  port: 55493,
  beforeMigration: {
    file: '0134_signup_code_and_recovery.sql',
    async run(sql) {
      const [directory] = await sql<{ data_directory: string }[]>`show data_directory`;
      assert.ok(directory);
      const root = path.dirname(path.resolve(directory.data_directory));
      assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
      assert.match(path.basename(root), /^qoro-scratch-schema-[a-z0-9]+$/iu);
      cleanupTargetVerified = true;
      await sql`insert into signup_sessions(id,token_hash,idle_expires_at,absolute_expires_at)
        values(${legacyId}::uuid,${'a'.repeat(64)},now()+interval '15 minutes',now()+interval '1 hour')`;
      legacyBefore = (
        await sql`select to_jsonb(s) as row from signup_sessions s where id=${legacyId}::uuid`
      )[0]?.row;
    },
  },
});
let passed = 0;
async function denies(run: () => Promise<unknown>, code: string) {
  await assert.rejects(run, (error: unknown) => {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
  });
  passed += 1;
}
try {
  assert.ok(cleanupTargetVerified);
  const [after] = await cluster.sql`select to_jsonb(s)
    - 'recovery_expires_at' - 'verification_flow_version' - 'email_code_state'
    - 'email_code_attempts' - 'email_code_expires_at' - 'email_code_reserved_at'
    - 'email_code_verified_at' - 'confirmation_message_id' - 'confirmation_delivery_status'
    - 'confirmation_delivery_at' - 'pending_auth_user_id' as row from signup_sessions s where id=${legacyId}::uuid`;
  assert.deepEqual(after?.row, legacyBefore);
  passed += 1;
  await cluster.sql`update signup_sessions set owner_name='Synthetic owner',clinic_name='Synthetic clinic',
    email_hash=${'c'.repeat(64)},accepted_at=now(),recovery_expires_at=created_at+interval '14 days'
    where id=${legacyId}::uuid`;
  passed += 1;
  await denies(
    () =>
      cluster.sql`update signup_sessions set recovery_expires_at=created_at+interval '14 days 1 second' where id=${legacyId}::uuid`,
    '23514',
  );
  await denies(
    () => cluster.sql`update signup_sessions set email_code_attempts=6 where id=${legacyId}::uuid`,
    '23514',
  );
  await denies(
    () =>
      cluster.sql`update signup_sessions set email_code_state='arbitrary' where id=${legacyId}::uuid`,
    '23514',
  );
  const messageId = randomUUID();
  await cluster.sql`insert into signup_email_delivery_events(id,message_id,event,occurred_at,bounce_type)
    values('synthetic-svix-event',${messageId}::uuid,'bounced',now(),'Permanent')`;
  await denies(
    () => cluster.sql`insert into signup_email_delivery_events(id,message_id,event,occurred_at)
      values('synthetic-svix-event',${messageId}::uuid,'sent',now())`,
    '23505',
  );
  for (const role of ['anon', 'authenticated', 'qoro_runtime'] as const) {
    await denies(
      () =>
        cluster.sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select * from signup_email_delivery_events`;
        }),
      '42501',
    );
    await denies(
      () =>
        cluster.sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select * from signup_recovery_grants`;
        }),
      '42501',
    );
  }
  const userId = randomUUID();
  await cluster.sql`insert into signup_recovery_grants(token_hash,operation_key,auth_user_id,email_hash,signup_ref,purpose,expires_at)
    values(${'d'.repeat(64)},'synthetic-recovery-op',${userId}::uuid,${'c'.repeat(64)},${'a'.repeat(64)},'verify_email',now()+interval '10 minutes')`;
  passed += 1;
  await denies(
    () => cluster.sql`insert into signup_recovery_grants(token_hash,operation_key,auth_user_id,email_hash,signup_ref,purpose,expires_at)
      values(${'e'.repeat(64)},'synthetic-recovery-op',${userId}::uuid,${'c'.repeat(64)},${'a'.repeat(64)},'verify_email',now()+interval '10 minutes')`,
    '23505',
  );
  await denies(
    () =>
      cluster.sql`update signup_recovery_grants set expires_at=created_at+interval '24 hours 1 second'`,
    '23514',
  );
  await denies(() => cluster.sql`update signup_recovery_grants set state='consumed'`, '23514');
  await cluster.sql`update signup_recovery_grants set state='consumed',consumed_at=now()`;
  passed += 1;
  // Import the real repository against ONLY this verified loopback cluster.
  Object.assign(process.env, { NODE_ENV: 'test' });
  process.env.DATABASE_URL = cluster.url;
  delete process.env.DATABASE_URL_DEV;
  delete process.env.DATABASE_URL_PROD;
  delete process.env.DATABASE_URL_RUNTIME;
  delete process.env.SUPABASE_PROJECT_ENV;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'synthetic-local-key';
  process.env.MAGIC_TOKEN_SECRET = 'synthetic-code-database-secret-32-characters';
  process.env.LOGIN_HASH_PEPPER = 'synthetic-code-database-pepper-32-characters';
  process.env.SIGNUP_AUTH_ENABLED = 'true';
  process.env.SIGNUP_IDENTITY_ENABLED = 'true';
  const repository =
    await import('../../src/contexts/onboarding/internal/signup-email-code-repository');
  const sessions = await import('../../src/contexts/onboarding/internal/signup-session');
  const binding = await import('../../src/contexts/onboarding/internal/signup-auth-binding');
  const delivery = await import('../../src/contexts/onboarding/internal/signup-email-delivery');
  const { hashEmail } = await import('../../src/lib/auth/email-hash');
  const email = 'synthetic-code@example.test';
  async function fixture(ageSeconds = 65) {
    const token = randomBytes(32).toString('base64url');
    const ref = sessions.hashSignupToken(token);
    const [row] = await cluster.sql<{ epoch: Date }[]>`insert into signup_sessions(
      token_hash,status,idle_expires_at,absolute_expires_at,owner_name,clinic_name,email_hash,accepted_at,
      professionals_band,weekly_appointments_band,current_tooling,discovery_source,answered_at,
      auth_attempt_kind,auth_attempt_state,auth_attempted_at,verification_flow_version,email_code_state,email_code_expires_at,recovery_expires_at)
      values(${ref},'email_pending',now()+interval '1 hour',now()+interval '1 hour','Synthetic','Synthetic clinic',${hashEmail(email)},now(),
      '1','ate_20','nada_papel','outro',now(),'initial','completed',date_trunc('milliseconds',now()-make_interval(secs => ${ageSeconds})),
      2,'issued',date_trunc('milliseconds',now()-make_interval(secs => ${ageSeconds}))+interval '10 minutes',now()+interval '14 days')
      returning auth_attempted_at as epoch`;
    assert.ok(row);
    return {
      token,
      ref,
      epoch: row.epoch.getTime(),
      code: binding.deriveSignupHandoffCode(ref, row.epoch.getTime()),
    };
  }
  const guesses = await fixture();
  const wrong = guesses.code === '00000000' ? '11111111' : '00000000';
  const attempts = await Promise.all(
    Array.from({ length: 8 }, () =>
      repository.reserveSignupEmailCode(guesses.token, { email, code: wrong }),
    ),
  );
  assert.equal(attempts.filter((r) => !r.ok && r.reason === 'invalid').length, 4);
  const [counter] =
    await cluster.sql`select email_code_attempts as n from signup_sessions where token_hash=${guesses.ref}`;
  assert.equal(counter?.n, 5);
  assert.deepEqual(
    await repository.reserveSignupEmailCode(guesses.token, { email, code: guesses.code }),
    { ok: false, reason: 'locked' },
  );
  passed += 3;
  const concurrent = await fixture();
  const winners = await Promise.all(
    Array.from({ length: 10 }, () =>
      repository.reserveSignupEmailCode(concurrent.token, { email, code: concurrent.code }),
    ),
  );
  assert.equal(winners.filter((r) => r.ok).length, 1);
  assert.equal(winners.filter((r) => !r.ok && r.reason === 'conflict').length, 9);
  assert.equal(
    await repository.finishSignupEmailCode(concurrent.ref, concurrent.epoch, 'verified'),
    true,
  );
  assert.equal(
    await repository.finishSignupEmailCode(concurrent.ref, concurrent.epoch, 'verified'),
    false,
  );
  passed += 4;
  const expired = await fixture(601);
  assert.deepEqual(
    await repository.reserveSignupEmailCode(expired.token, { email, code: expired.code }),
    { ok: false, reason: 'expired' },
  );
  assert.equal(
    (await sessions.reserveSignupResendAttempt(expired.token, { email, rowVersion: 1 })).ok,
    true,
  );
  await cluster.sql`update signup_sessions set auth_attempt_state='completed' where token_hash=${expired.ref}`;
  const [rotated] = await cluster.sql<
    { epoch: Date }[]
  >`select auth_attempted_at as epoch from signup_sessions where token_hash=${expired.ref}`;
  assert.ok(rotated);
  assert.equal(
    (await repository.reserveSignupEmailCode(expired.token, { email, code: expired.code })).ok,
    false,
  );
  assert.equal(
    (
      await repository.reserveSignupEmailCode(expired.token, {
        email,
        code: binding.deriveSignupHandoffCode(expired.ref, rotated.epoch.getTime()),
      })
    ).ok,
    true,
  );
  passed += 4;
  const racing = await fixture();
  const [confirmation, resend] = await Promise.all([
    repository.reserveSignupEmailCode(racing.token, { email, code: racing.code }),
    sessions.reserveSignupResendAttempt(racing.token, { email, rowVersion: 1 }),
  ]);
  assert.equal(Number(confirmation.ok) + Number(resend.ok), 1);
  passed += 1;
  const beforeReceipt = await fixture();
  const earlyMessageId = randomUUID();
  assert.equal(
    await delivery.recordSignupEmailDelivery({
      id: 'early-delivered',
      messageId: earlyMessageId,
      state: 'delivered',
      occurredAt: new Date(),
      bounceType: null,
    }),
    'recorded',
  );
  await repository.recordSignupCodeDelivery({
    signupRef: beforeReceipt.ref,
    attemptEpoch: beforeReceipt.epoch,
    messageId: earlyMessageId,
  });
  const [projection] =
    await cluster.sql`select confirmation_delivery_status as state from signup_sessions where token_hash=${beforeReceipt.ref}`;
  assert.equal(projection?.state, 'delivered');
  assert.equal(
    await delivery.recordSignupEmailDelivery({
      id: 'early-delivered',
      messageId: earlyMessageId,
      state: 'delivered',
      occurredAt: new Date(),
      bounceType: null,
    }),
    'duplicate',
  );
  await delivery.recordSignupEmailDelivery({
    id: 'late-sent',
    messageId: earlyMessageId,
    state: 'sent',
    occurredAt: new Date(),
    bounceType: null,
  });
  const [nonregression] =
    await cluster.sql`select confirmation_delivery_status as state from signup_sessions where token_hash=${beforeReceipt.ref}`;
  assert.equal(nonregression?.state, 'delivered');
  await delivery.recordSignupEmailDelivery({
    id: 'hard-bounce',
    messageId: earlyMessageId,
    state: 'bounced',
    occurredAt: new Date(),
    bounceType: 'Permanent',
  });
  await delivery.recordSignupEmailDelivery({
    id: 'late-delivered',
    messageId: earlyMessageId,
    state: 'delivered',
    occurredAt: new Date(),
    bounceType: null,
  });
  const [bounce] =
    await cluster.sql`select confirmation_delivery_status as state from signup_sessions where token_hash=${beforeReceipt.ref}`;
  assert.equal(bounce?.state, 'bounced');
  passed += 4;
  const staleGrant = randomUUID();
  const uncertainGrant = randomUUID();
  const currentGrant = randomUUID();
  const writerUser = randomUUID();
  await cluster.sql`insert into signup_recovery_grants(id,token_hash,operation_key,auth_user_id,email_hash,signup_ref,purpose,created_at,expires_at,state,password_state) values
    (${staleGrant}::uuid,${randomBytes(32).toString('hex')},'retention-stale',${randomUUID()}::uuid,${'e'.repeat(64)},${'f'.repeat(64)},'verify_email',now()-interval '31 days',now()-interval '30 days','prepared','none'),
    (${uncertainGrant}::uuid,${randomBytes(32).toString('hex')},'retention-uncertain',${writerUser}::uuid,${'e'.repeat(64)},${'f'.repeat(64)},'verify_email',now()-interval '31 days',now()-interval '30 days','uncertain','uncertain'),
    (${currentGrant}::uuid,${randomBytes(32).toString('hex')},'retention-current',${writerUser}::uuid,${'e'.repeat(64)},${'f'.repeat(64)},'verify_email',now(),now()+interval '1 hour','prepared','none')`;
  await denies(
    () =>
      cluster.sql`update signup_recovery_grants set password_state='reserved' where id=${currentGrant}::uuid`,
    '23505',
  );
  await cluster.sql`insert into signup_email_delivery_events(id,message_id,event,occurred_at,received_at) values
    ('retention-unreferenced',${randomUUID()}::uuid,'sent',now()-interval '30 days',now()-interval '30 days'),
    ('retention-referenced',${earlyMessageId}::uuid,'sent',now()-interval '30 days',now()-interval '30 days')`;
  assert.deepEqual(await delivery.purgeExpiredSignupEmailArtifacts(500), { grants: 1, events: 1 });
  const remaining =
    await cluster.sql`select id from signup_recovery_grants where id in (${staleGrant}::uuid,${uncertainGrant}::uuid,${currentGrant}::uuid)`;
  assert.deepEqual(remaining.map((row) => row.id).sort(), [uncertainGrant, currentGrant].sort());
  const keptEvents =
    await cluster.sql`select id from signup_email_delivery_events where id in ('retention-unreferenced','retention-referenced')`;
  assert.deepEqual(
    keptEvents.map((row) => row.id),
    ['retention-referenced'],
  );
  await assert.rejects(
    () => delivery.purgeExpiredSignupEmailArtifacts(0),
    /invalid email cleanup batch/u,
  );
  passed += 4;
  const { dbAdmin } = await import('../../src/lib/db');
  const { resumeRetainedOwnedSignupDraft } =
    await import('../../src/contexts/onboarding/internal/signup-draft');
  for (const billingState of [null, 'creation_unknown'] as const) {
    const retained = await fixture();
    const userId = randomUUID();
    await cluster.sql`update signup_sessions set status='email_verified',auth_user_id=${userId}::uuid,consumed_at=now(),
      auth_attempt_state=${billingState === null ? null : 'completed'},accepted_at=now(),recovery_expires_at=created_at+interval '14 days',
      auth_attempt_kind=${billingState === null ? null : 'initial'},
      auth_attempted_at=case when ${billingState}::text is null then null else auth_attempted_at end,
      idle_expires_at=now()-interval '1 minute',absolute_expires_at=now()-interval '1 minute',
      billing_attempt_state=${billingState},billing_attempted_at=case when ${billingState}::text is null then null else now() end,
      selected_plan_id=case when ${billingState}::text is null then null else (select id from plans where code='solo') end,
      asaas_customer_id=${billingState ? 'cus_synthetic_unknown' : null}
      where token_hash=${retained.ref}`;
    await resumeRetainedOwnedSignupDraft(userId, email, retained.ref);
    const [readable] =
      await cluster.sql`select absolute_expires_at>now() as live,billing_attempt_state as state,asaas_customer_id as customer from signup_sessions where token_hash=${retained.ref}`;
    assert.deepEqual(readable, {
      live: true,
      state: billingState,
      customer: billingState ? 'cus_synthetic_unknown' : null,
    });
    passed++;
  }
  // Guarded recovery of the separately protected snapshot; no Auth service or real data.
  await cluster.sql`alter table auth.users add column encrypted_password text,
    add column invited_at timestamptz, add column deleted_at timestamptz,
    add column banned_until timestamptz`;
  const { restoreSignupDraftSnapshot } =
    await import('../../src/contexts/onboarding/internal/signup-draft-snapshot');
  const restoreUser = randomUUID();
  const restoreEmail = 'synthetic-snapshot@example.test';
  const restoreRef = randomBytes(32).toString('hex');
  const bornAt = new Date(Date.now() - 60_000).toISOString();
  const readyMetadata = {
    qoro_self_service_signup: {
      version: 1,
      kind: 'self_service',
      signup_ref: restoreRef,
      password_state: 'set',
    },
  };
  await cluster.sql`insert into auth.users(id,email,created_at,email_confirmed_at,encrypted_password,raw_app_meta_data)
    values(${restoreUser}::uuid,${restoreEmail},${bornAt}::timestamptz,now(),'synthetic-not-a-real-password-hash',${cluster.sql.json(readyMetadata)})`;
  const protectedSnapshot = {
    version: 1,
    purpose: 'Authorized lead-04 onboarding recovery; not account authority',
    capturedAt: new Date(Date.now() - 1000).toISOString(),
    retainUntil: new Date(Date.now() + 86_400_000).toISOString(),
    data: {
      user_id: restoreUser,
      auth_created_at: bornAt,
      owner_name: 'Synthetic preserved owner',
      clinic_name: 'Synthetic preserved clinic',
      email_hash: hashEmail(restoreEmail),
      accepted_at: bornAt,
      professionals_band: '1',
      weekly_appointments_band: 'ate_20',
      current_tooling: 'nada_papel',
      discovery_source: 'outro',
      answered_at: bornAt,
      selected_plan_id: null,
      selected_billing_cycle: 'monthly',
    },
  };
  const [authFingerprintBefore] =
    await cluster.sql`select md5(to_jsonb(u)::text) as fingerprint from auth.users u where id=${restoreUser}::uuid`;
  const restoreRace = await Promise.all([
    restoreSignupDraftSnapshot(protectedSnapshot),
    restoreSignupDraftSnapshot(protectedSnapshot),
  ]);
  assert.equal(
    restoreRace.filter((result) => result.ok && result.state === 'restored').length,
    1,
    JSON.stringify(restoreRace),
  );
  assert.equal(
    restoreRace.filter((result) => result.ok && result.state === 'already_present').length,
    1,
  );
  const [restored] = await cluster.sql`
    select count(*)::int as count, bool_and(owner_name=${protectedSnapshot.data.owner_name}
      and recovery_expires_at=${protectedSnapshot.retainUntil}::timestamptz
      and auth_attempt_state is null and billing_attempt_state is null
      and selected_plan_id is null and asaas_checkout_id is null) as preserved
    from signup_sessions where auth_user_id=${restoreUser}::uuid`;
  assert.deepEqual(restored, { count: 1, preserved: true });
  const [authFingerprintAfter] =
    await cluster.sql`select md5(to_jsonb(u)::text) as fingerprint from auth.users u where id=${restoreUser}::uuid`;
  assert.equal(authFingerprintAfter?.fingerprint, authFingerprintBefore?.fingerprint);
  passed += 3;
  for (const data of [
    { ...protectedSnapshot.data, auth_created_at: new Date(Date.now() - 120_000).toISOString() },
    { ...protectedSnapshot.data, email_hash: '0'.repeat(64) },
  ]) {
    assert.deepEqual(await restoreSignupDraftSnapshot({ ...protectedSnapshot, data }), {
      ok: false,
      reason: 'identity_changed',
    });
    passed++;
  }
  await cluster.sql`update auth.users set banned_until=now()+interval '1 hour' where id=${restoreUser}::uuid`;
  assert.deepEqual(await restoreSignupDraftSnapshot(protectedSnapshot), {
    ok: false,
    reason: 'identity_changed',
  });
  await cluster.sql`update auth.users set banned_until=null where id=${restoreUser}::uuid`;
  passed++;
  const [snapshotPlan] = await cluster.sql`select id from plans where code='consultorio_2026'`;
  assert.ok(snapshotPlan);
  await cluster.sql`update signup_sessions set selected_plan_id=${snapshotPlan.id}::uuid,auth_attempt_kind='initial',auth_attempt_state='completed',auth_attempted_at=now(),
    billing_attempt_state='creation_unknown',billing_attempted_at=now(),asaas_customer_id='cus_synthetic_snapshot_unknown' where auth_user_id=${restoreUser}::uuid`;
  const [progressBefore] =
    await cluster.sql`select md5(to_jsonb(s)::text) as fingerprint from signup_sessions s where auth_user_id=${restoreUser}::uuid`;
  assert.deepEqual(await restoreSignupDraftSnapshot(protectedSnapshot), {
    ok: false,
    reason: 'existing_progress',
  });
  const [progressAfter] =
    await cluster.sql`select md5(to_jsonb(s)::text) as fingerprint from signup_sessions s where auth_user_id=${restoreUser}::uuid`;
  assert.equal(progressAfter?.fingerprint, progressBefore?.fingerprint);
  passed++;
  await cluster.sql`insert into clinic_invites(token_hash,email,expires_at)
    values(${randomBytes(32).toString('hex')},${restoreEmail},now()+interval '1 day')`;
  assert.deepEqual(await restoreSignupDraftSnapshot(protectedSnapshot), {
    ok: false,
    reason: 'existing_progress',
  });
  passed++;
  await dbAdmin.$client.end({ timeout: 2 });
  console.log(
    `PASS ${passed}/${passed}: real migration, repository, code/resend concurrency, delivery reconciliation and ACL. Synthetic local DB; external Auth/checkout not covered.`,
  );
} finally {
  assert.ok(cleanupTargetVerified, 'Refuse cleanup without the verified local scratch target');
  await cluster.stop();
}
