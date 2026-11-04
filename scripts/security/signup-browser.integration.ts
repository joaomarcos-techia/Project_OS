/** Browser -> actual Next HTTP/cookies -> local GoTrue -> migrated PostgreSQL.
 * Fixtures begin at code issuance. No external email, Checkout or payment.
 * No traces, video, network bodies, passwords or active tokens are recorded.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { dbAdmin } from '@/lib/db';
import { createAdminClient } from '@/lib/auth/supabase-admin';
import { hashEmail } from '@/lib/auth/email-hash';
import {
  createPendingSignupAppMetadata,
  deriveSignupHandoffCode,
  readSignupAuthBinding,
} from '@/contexts/onboarding/internal/signup-auth-binding';
import {
  reserveSignupAuthAttempt,
  readReservedSignupAttemptEpoch,
  finishSignupAuthAttempt,
  hashSignupToken,
} from '@/contexts/onboarding/internal/signup-session';
import { prepareSignupRecovery } from '@/contexts/onboarding/internal/signup-recovery';

const origin = 'http://localhost:3210';
const sql = postgres(process.env.DATABASE_URL!, {
  ssl: 'require',
  max: 2,
  onnotice: () => undefined,
});
const admin = createAdminClient();
const fixtures: { userId: string; ref: string; email: string }[] = [];
let browser: Browser;
beforeAll(async () => {
  assert.equal(process.env.SIGNUP_LOCAL_BROWSER, 'true');
  const target = new URL(process.env.DATABASE_URL!);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, '55442');
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  for (const f of fixtures) {
    assert.match(f.email, /^qoro-browser-[0-9a-f-]+@example\.test$/u);
    const [profile] = await sql`select count(*)::int as n from profiles where id=${f.userId}::uuid`;
    assert.equal(profile?.n, 0);
    await sql`delete from signup_recovery_grants where auth_user_id=${f.userId}::uuid`;
    await sql`delete from signup_sessions where token_hash=${f.ref}`;
    assert.equal((await admin.auth.admin.deleteUser(f.userId)).error, null);
    const [remaining] =
      await sql`select count(*)::int as n from signup_sessions where token_hash=${f.ref}`;
    assert.equal(remaining?.n, 0);
  }
  await sql.end({ timeout: 2 });
  await dbAdmin.$client.end({ timeout: 2 });
});
async function fixture() {
  const email = `qoro-browser-${randomUUID()}@example.test`;
  const password = `${randomBytes(16).toString('hex')}Aa9!`;
  const token = randomBytes(32).toString('base64url');
  const ref = hashSignupToken(token);
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    app_metadata: createPendingSignupAppMetadata(ref, true),
  });
  assert.equal(created.error, null);
  assert.ok(created.data.user);
  const userId = created.data.user.id;
  fixtures.push({ userId, ref, email });
  await sql`insert into signup_sessions(token_hash,status,idle_expires_at,absolute_expires_at,owner_name,clinic_name,email_hash,accepted_at,professionals_band,weekly_appointments_band,current_tooling,discovery_source,answered_at)
    values(${ref},'identity_pending',now()+interval '15 minutes',now()+interval '1 hour','Synthetic owner','Synthetic clinic',${hashEmail(email)},now(),'1','ate_20','nada_papel','outro',now())`;
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
  return { userId, ref, email, token, password, code: deriveSignupHandoffCode(ref, epoch) };
}
async function context(width: number, token?: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width, height: 850 } });
  if (token)
    await ctx.addCookies([
      {
        name: '__Host-qoro_signup',
        value: token,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
  return ctx;
}
describe('local browser signup confirmation and continuation', () => {
  it('rejects a direct provider session using a pre-confirmation password without independent mail proof', async () => {
    const f = await fixture();
    assert.equal(
      (await admin.auth.admin.updateUserById(f.userId, { email_confirm: true })).error,
      null,
    );
    await sql`update signup_sessions set status='email_verified',auth_user_id=${f.userId}::uuid,consumed_at=now() where token_hash=${f.ref}`;
    const outsider = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const signed = await outsider.auth.signInWithPassword({ email: f.email, password: f.password });
    assert.equal(signed.error, null);
    assert.ok(signed.data.session);
    const generation = randomBytes(16).toString('hex');
    const ctx = await context(390);
    try {
      await ctx.addCookies([
        {
          name: 'qoro-auth-session',
          value: generation,
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
        },
        {
          name: `sb-127-auth-token-v2-${generation}`,
          value: `base64-${Buffer.from(JSON.stringify(signed.data.session)).toString('base64url')}`,
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      const response = await ctx.request.post(`${origin}/api/signup/password`, {
        headers: { origin, 'sec-fetch-site': 'same-origin' },
        data: { password: `${randomBytes(16).toString('hex')}Cc8!` },
      });
      expect(response.status()).toBe(401);
      const user = await admin.auth.admin.getUserById(f.userId);
      expect(readSignupAuthBinding(user.data.user!)?.passwordState).toBe('pending');
    } finally {
      await ctx.close();
      await outsider.auth.signOut({ scope: 'local' });
    }
  });
  it.each([390, 1280])(
    'confirms in the same UI at %s px, reloads safely and preserves the password',
    async (width) => {
      const f = await fixture();
      const ctx = await context(width, f.token);
      try {
        const page = await ctx.newPage();
        page.setDefaultNavigationTimeout(60_000);
        await page.goto(`${origin}/cadastro`);
        const input = page.getByLabel('Código de confirmação');
        await input.waitFor({ timeout: 60_000 });
        expect(await page.locator('input[type=password]').count()).toBe(0);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await input.waitFor();
        await page.getByText(f.email, { exact: true }).waitFor();
        expect(await page.getByText(f.email, { exact: true }).count()).toBe(1);
        await input.fill(f.code === '00000000' ? '11111111' : '00000000');
        await page.getByRole('button', { name: 'Confirmar e-mail' }).click();
        await page.getByText('O código não confere.', { exact: false }).waitFor();
        await input.fill(f.code);
        await page.getByRole('button', { name: 'Confirmar e-mail' }).click();
        await page.waitForURL('**/cadastro/plano', { timeout: 60_000 });
        await page.getByRole('radio', { name: /Consultório/u }).waitFor();
        expect(await page.getByRole('radio').count()).toBe(2);
        if (width === 390) {
          let planWrites = 0;
          let checkoutRequests = 0;
          // Real UI, auth and plan persistence; only the external billing boundary is simulated.
          await page.route('**/api/signup/checkout', async (route) => {
            checkoutRequests++;
            await route.fulfill({ status: 503, json: { error: 'unavailable' } });
          });
          page.on('request', (request) => {
            if (
              new URL(request.url()).pathname === '/api/signup/plan' &&
              request.method() === 'PUT'
            )
              planWrites++;
          });
          await page.getByText('Consultório', { exact: true }).click();
          await page
            .getByRole('button', { name: 'Continuar para o checkout', exact: true })
            .click();
          await page
            .getByRole('button', { name: 'Continuar para o checkout', exact: true })
            .waitFor();
          await page.getByText('Não foi possível concluir agora.', { exact: false }).waitFor();
          expect(planWrites).toBe(1);
          expect(checkoutRequests).toBe(1);
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page
            .getByRole('button', { name: 'Continuar para o checkout', exact: true })
            .waitFor();
          expect(planWrites).toBe(1);
          await page
            .getByRole('button', { name: 'Continuar para o checkout', exact: true })
            .click();
          await page.getByText('Não foi possível concluir agora.', { exact: false }).waitFor();
          expect(planWrites).toBe(1);
          expect(checkoutRequests).toBe(2);
          const [selected] =
            await sql`select p.code from signup_sessions s join plans p on p.id=s.selected_plan_id where s.token_hash=${f.ref}`;
          expect(selected?.code).toBe('consultorio_2026');
        }
        expect(await page.locator('input[type=password]').count()).toBe(0);
        const cookies = await ctx.cookies();
        expect(cookies.some((c) => c.name.startsWith('sb-127-auth-token-v2-') && c.httpOnly)).toBe(
          true,
        );
        expect(
          await page.evaluate(() =>
            Object.keys(localStorage).some((k) => k.includes('auth-token')),
          ),
        ).toBe(false);
        const user = await admin.auth.admin.getUserById(f.userId);
        expect(readSignupAuthBinding(user.data.user!)).toEqual({
          signupRef: f.ref,
          passwordState: 'set',
        });
        const [row] =
          await sql`select email_code_state,status,owner_name,clinic_name,asaas_checkout_id from signup_sessions where token_hash=${f.ref}`;
        expect(row?.email_code_state).toBe('verified');
        expect(row?.status).toBe('email_verified');
        expect(row?.owner_name).toBe('Synthetic owner');
        expect(row?.asaas_checkout_id).toBeNull();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
      } finally {
        await ctx.close();
      }
    },
  );
  it('uses the same recovery handler on another device, with no GET consumption or token in the URL', async () => {
    const f = await fixture();
    // Confirmed credentials represent the fourth lead; never reset a ready password.
    const { markSignupPasswordSet } =
      await import('@/contexts/onboarding/internal/signup-auth-binding');
    const original = await admin.auth.admin.getUserById(f.userId);
    assert.ok(original.data.user);
    assert.equal(
      (
        await admin.auth.admin.updateUserById(f.userId, {
          email_confirm: true,
          app_metadata: markSignupPasswordSet(original.data.user, f.ref),
        })
      ).error,
      null,
    );
    await sql`update signup_sessions set status='email_verified', auth_user_id=${f.userId}::uuid, consumed_at=now() where token_hash=${f.ref}`;
    const prepared = await prepareSignupRecovery({
      userId: f.userId,
      operationKey: `browser-${randomUUID()}`,
      purpose: 'resume_signup',
    });
    assert.ok(prepared.ok);
    await sql`update signup_recovery_grants set state='sent' where id=${prepared.id}::uuid`;
    const ctx = await context(390);
    try {
      const page = await ctx.newPage();
      try {
        await page.goto(`${origin}/cadastro/retomar#token=${prepared.token}`, { timeout: 60_000 });
      } catch {
        throw new Error('Local recovery bridge navigation failed; bearer URL suppressed');
      }
      await page.waitForFunction(() => location.hash === '');
      const [before] =
        await sql`select state from signup_recovery_grants where id=${prepared.id}::uuid`;
      expect(before?.state).toBe('sent');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.getByRole('button', { name: 'Continuar meu cadastro', exact: true }).click();
      await page.waitForURL('**/cadastro/plano', { timeout: 60_000 });
      expect(await page.locator('input[type=password]').count()).toBe(0);
      const [after] =
        await sql`select state from signup_recovery_grants where id=${prepared.id}::uuid`;
      expect(after?.state).toBe('consumed');
      const replay = await page.evaluate(
        async (token) =>
          (
            await fetch('/api/signup/recovery/consume', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ token }),
            })
          ).status,
        prepared.token,
      );
      expect(replay).toBe(410);
    } finally {
      await ctx.close();
    }
  });
});
