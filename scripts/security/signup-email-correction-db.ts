/** Existing migrations + real local SQL; synthetic identities only, zero provider traffic. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { startScratchSchema, readMigrations } from './scratch-schema';

const allowed = new Set([
  'PATH',
  'Path',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'COMSPEC',
  'PATHEXT',
  'SECURITY_PG_BIN',
]);
for (const key of Object.keys(process.env)) if (!allowed.has(key)) delete process.env[key];
const cluster = await startScratchSchema({ port: 55479 });
const checks: { name: string; status: 'PASS' | 'FAIL' }[] = [];
let networkCalls = 0;
try {
  assert.equal(new URL(cluster.url).hostname, '127.0.0.1');
  process.env.DATABASE_URL = cluster.url;
  process.env.DATABASE_URL_DEV = cluster.url;
  process.env.DATABASE_URL_RUNTIME = cluster.url;
  process.env.SUPABASE_PROJECT_ENV = 'dev';
  process.env.SIGNUP_AUTH_ENABLED = 'true';
  process.env.SIGNUP_IDENTITY_ENABLED = 'true';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_synthetic';
  process.env.MAGIC_TOKEN_SECRET = 'synthetic-email-correction-secret-only-32';
  process.env.LOGIN_HASH_PEPPER = 'synthetic-email-correction-pepper-only-32';
  process.env.LOG_LEVEL = 'error';
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error('External traffic forbidden by email correction proof');
  };
  const { correctSignupEmail, hashSignupToken, readSignupSession } =
    await import('../../src/contexts/onboarding/internal/signup-session');
  const { hashEmail } = await import('../../src/lib/auth/email-hash');
  const sql = cluster.sql;
  async function check(name: string, run: () => Promise<void>) {
    try {
      await run();
      checks.push({ name, status: 'PASS' });
      console.log(`PASS ${name}`);
    } catch (error) {
      checks.push({ name, status: 'FAIL' });
      console.error(`FAIL ${name}: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }
  async function seed() {
    const token = randomBytes(32).toString('base64url'),
      id = randomUUID(),
      pending = randomUUID();
    const currentEmail = `old-${id}@example.test`;
    const email = `new-${id}@example.test`;
    await sql`INSERT INTO public.signup_sessions(id,token_hash,status,risk_level,failed_attempts,row_version,idle_expires_at,absolute_expires_at,
   professionals_band,weekly_appointments_band,current_tooling,discovery_source,answered_at,owner_name,clinic_name,email_hash,accepted_at,
   auth_attempt_kind,auth_attempt_state,auth_attempted_at,pending_auth_user_id,verification_flow_version,email_code_state,email_code_attempts,email_code_expires_at,
   confirmation_message_id,confirmation_delivery_status,recovery_expires_at)
 VALUES(${id}::uuid,${hashSignupToken(token)},'email_pending',1,2,5,now()+interval '20 minutes',now()+interval '40 minutes',
   '1','ate_20','nada_papel','busca_google',now(),'Nome sintético','Clínica sintética',${hashEmail(currentEmail)},now(),
   'initial','completed',now(),${pending}::uuid,2,'issued',0,now()+interval '10 minutes',${randomUUID()}::uuid,'bounced',now()+interval '1 day')`;
    return {
      token,
      id,
      pending,
      input: { rowVersion: 5, currentEmail, email },
    };
  }
  async function row(id: string) {
    const [r] = await sql`SELECT * FROM public.signup_sessions WHERE id=${id}::uuid`;
    assert.ok(r);
    return r;
  }
  await check(
    'correction preserves staging, risk, consent, limits and invalidates old receipt/code',
    async () => {
      const f = await seed(),
        before = await row(f.id);
      assert.deepEqual(await correctSignupEmail(f.token, f.input), { ok: true, rowVersion: 6 });
      const after = await row(f.id);
      for (const key of [
        'owner_name',
        'clinic_name',
        'professionals_band',
        'weekly_appointments_band',
        'current_tooling',
        'discovery_source',
        'answered_at',
        'accepted_at',
        'created_at',
        'idle_expires_at',
        'absolute_expires_at',
        'recovery_expires_at',
        'risk_level',
        'failed_attempts',
      ])
        assert.deepEqual(after[key], before[key]);
      assert.equal(after.status, 'identity_pending');
      assert.equal(after.email_hash, hashEmail(f.input.email));
      for (const key of [
        'pending_auth_user_id',
        'auth_attempt_kind',
        'auth_attempt_state',
        'auth_attempted_at',
        'email_code_expires_at',
        'confirmation_message_id',
        'confirmation_delivery_status',
      ])
        assert.equal(after[key], null);
      assert.equal(after.email_code_state, 'none');
      assert.equal((await readSignupSession(f.token))?.status, 'identity_pending');
    },
  );
  await check('two tabs can correct one epoch only once', async () => {
    const f = await seed();
    const results = await Promise.all([
      correctSignupEmail(f.token, f.input),
      correctSignupEmail(f.token, { ...f.input, email: 'other@example.test' }),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal((await row(f.id)).row_version, 6);
  });
  await check('verified, consumed or reserved confirmation cannot be reset', async () => {
    for (const state of ['reserved', 'verified', 'uncertain']) {
      const f = await seed();
      await sql`UPDATE public.signup_sessions SET email_code_state=${state} WHERE id=${f.id}::uuid`;
      const before = await row(f.id);
      assert.equal((await correctSignupEmail(f.token, f.input)).ok, false);
      assert.deepEqual(await row(f.id), before);
    }
    const f = await seed();
    await sql`UPDATE public.signup_sessions SET status='email_verified',auth_user_id=${f.pending}::uuid,consumed_at=now(),email_code_state='verified' WHERE id=${f.id}::uuid`;
    assert.equal((await correctSignupEmail(f.token, f.input)).ok, false);
  });
  await check('expired authority cannot revive fourteen-day retained staging', async () => {
    const f = await seed();
    await sql`UPDATE public.signup_sessions SET idle_expires_at=now()-interval '1 second' WHERE id=${f.id}::uuid`;
    assert.deepEqual(await correctSignupEmail(f.token, f.input), { ok: false, reason: 'gone' });
  });
  await check('another browser or prior email cannot alter the draft', async () => {
    const f = await seed(),
      other = await seed(),
      before = await row(f.id);
    assert.equal(
      (await correctSignupEmail(f.token, { ...f.input, currentEmail: 'different@example.test' }))
        .ok,
      false,
    );
    assert.equal(
      (await correctSignupEmail(other.token, { ...f.input, rowVersion: 999 })).ok,
      false,
    );
    assert.deepEqual(await row(f.id), before);
  });
  await check('legacy flow and uncertain send cannot be changed anonymously', async () => {
    const f = await seed();
    await sql`UPDATE public.signup_sessions SET verification_flow_version=1 WHERE id=${f.id}::uuid`;
    assert.equal((await correctSignupEmail(f.token, f.input)).ok, false);
    const g = await seed();
    await sql`UPDATE public.signup_sessions SET auth_attempt_state='uncertain' WHERE id=${g.id}::uuid`;
    assert.equal((await correctSignupEmail(g.token, g.input)).ok, false);
  });
  await check(
    'session feedback changes after provider event without exposing provider IDs',
    async () => {
      const f = await seed();
      const state = await readSignupSession(f.token);
      assert.equal(state?.emailDelivery, 'failed');
      const body = JSON.stringify(state);
      assert.ok(!body.includes(f.pending));
      assert.ok(!body.includes(f.input.currentEmail));
      assert.ok(!body.includes('confirmation_message_id'));
      await sql`UPDATE public.signup_sessions SET confirmation_delivery_status='delivery_delayed' WHERE id=${f.id}::uuid`;
      assert.equal((await readSignupSession(f.token))?.emailDelivery, 'delayed');
    },
  );
  assert.equal(networkCalls, 0);
} finally {
  await cluster.stop();
  await mkdir('dist', { recursive: true });
  await writeFile(
    'dist/signup-email-correction-db.json',
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        environment: 'local_synthetic',
        migrations: (await readMigrations()).length,
        checks,
        networkCalls,
        productionWrites: 0,
      },
      null,
      2,
    ),
  );
}
process.exit(checks.some((c) => c.status === 'FAIL') ? 1 : 0);
