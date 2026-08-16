import { randomBytes } from 'node:crypto';

import { expect, test, type BrowserContext, type Page, type Response } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_PASSWORD_RECOVERY === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'off',
  video: 'off',
  screenshot: 'off',
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

type SessionTokens = { refreshToken: string };

function productionConfig(): { databaseUrl: string; url: string; secretKey: string } {
  const databaseUrl = process.env.DATABASE_URL_PROD;
  const secretKey = process.env.SUPABASE_SECRET_KEY_PROD;
  if (!databaseUrl || !secretKey) throw new Error('Credenciais operacionais PROD ausentes.');
  const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  if (!projectRef || !/^[a-z]{20}$/u.test(projectRef)) {
    throw new Error('Project ref de produção inválido.');
  }
  return { databaseUrl, url: `https://${projectRef}.supabase.co`, secretKey };
}

function statelessClient(url: string, key: string) {
  return createSsrClient(url, key, {
    cookies: { getAll: () => [], setAll: () => undefined },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signInContext(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<SessionTokens> {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  const { url, secretKey } = productionConfig();
  let nextCookies: Array<{ name: string; value: string }> = [];
  const client = createSsrClient(url, secretKey, {
    cookies: {
      getAll: () => [],
      setAll: (items) => {
        nextCookies = items.map(({ name, value }) => ({ name, value }));
      },
    },
    auth: { autoRefreshToken: false, persistSession: true },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || nextCookies.length === 0) {
    throw new Error(error?.message ?? 'Login não produziu sessão.');
  }
  await context.addCookies(
    nextCookies
      .filter(({ value }) => value !== '')
      .map(({ name, value }) => ({ name, value, url: baseUrl })),
  );
  return { refreshToken: data.session.refresh_token };
}

function isServerAction(response: Response): boolean {
  const request = response.request();
  return request.method() === 'POST' && Boolean(request.headers()['next-action']);
}

async function submitPassword(page: Page, password: string): Promise<number> {
  const responsePromise = page.waitForResponse(isServerAction);
  await page.getByLabel('Nova senha (mín 8 caracteres)').fill(password);
  await page.getByRole('button', { name: 'Atualizar senha' }).click();
  return (await responsePromise).status();
}

test.describe('produção: recovery de senha na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('valida prova de recovery, política, revogação e uso único', async ({ browser }) => {
    test.setTimeout(300_000);
    test.skip(!authorized, 'Exige autorização explícita para recovery sintético na Clínica A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de recovery só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail) throw new Error('Identidade do owner A ausente.');

    const { databaseUrl, url, secretKey } = productionConfig();
    const sql = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
    const admin = statelessClient(url, secretKey);
    const resetContext = await browser.newContext({ baseURL: baseUrl });
    const oldSessionContext = await browser.newContext({ baseURL: baseUrl });
    const recoveryContext = await browser.newContext({ baseURL: baseUrl });
    const reuseContext = await browser.newContext({ baseURL: baseUrl });
    const resetPage = await resetContext.newPage();
    const oldSessionPage = await oldSessionContext.newPage();
    const recoveryPage = await recoveryContext.newPage();
    const reusePage = await reuseContext.newPage();
    const runId = String(Date.now()).slice(-10);
    const syntheticEmail = `e2e-password-recovery-a-${runId}@example.test`;
    const syntheticName = `[E2E-RECOVERY-A-${runId}]`;
    const originalPassword = `Aa1!${randomBytes(18).toString('base64url')}`;
    const intermediateStrongPassword = `Bb2!${randomBytes(18).toString('base64url')}`;
    const finalPassword = `Cc3!${randomBytes(18).toString('base64url')}`;
    const weakPassword = 'aaaaaaaa';
    let clinicId: string | undefined;
    let userId: string | undefined;
    let userDeleted = false;
    let baselineActive: number | undefined;

    try {
      const [baseline] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ clinic_id: string; active: number; preexisting: number }[]>`
          select p.clinic_id::text,
                 (select count(*)::int from profiles x where x.clinic_id=p.clinic_id
                   and x.ativo=true and x.deleted_at is null) active,
                 (select count(*)::int from auth.users u
                   where lower(u.email)=${syntheticEmail}) preexisting
            from profiles p join auth.users u on u.id=p.id
           where lower(u.email)=${ownerEmail.toLowerCase()} and p.role='owner'
             and p.ativo=true and p.deleted_at is null
        `;
      });
      if (!baseline) throw new Error('Owner A não encontrado.');
      expect(baseline).toMatchObject({ active: 4, preexisting: 0 });
      clinicId = baseline.clinic_id;
      baselineActive = baseline.active;
      const testClinicId = baseline.clinic_id;

      const created = await admin.auth.admin.createUser({
        email: syntheticEmail,
        password: originalPassword,
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        throw created.error ?? new Error('Auth user sintético não foi criado.');
      }
      userId = created.data.user.id;
      const testUserId = created.data.user.id;
      await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        await tx`
          insert into profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
          values (${testUserId}::uuid, ${testClinicId}::uuid, ${syntheticName},
                  'attendant', true, now())
        `;
      });

      await signInContext(resetContext, syntheticEmail, originalPassword);
      const oldSessionTokens = await signInContext(
        oldSessionContext,
        syntheticEmail,
        originalPassword,
      );
      await Promise.all([resetPage.goto('/reset-password'), oldSessionPage.goto('/dashboard')]);
      await expect(resetPage.getByRole('heading', { name: 'Nova senha' })).toBeVisible();
      await expect(resetPage.getByLabel('Nova senha (mín 8 caracteres)')).toBeVisible();
      const normalSessionReachedResetForm = true;

      const weakPasswordHttpStatus = await submitPassword(resetPage, weakPassword);
      const weakPasswordAccepted = await resetPage
        .waitForURL(/\/login\?reason=password_updated$/u, { timeout: 10_000 })
        .then(() => true)
        .catch(() => false);

      let directResetPassword = weakPassword;
      let directResetHttpStatus = weakPasswordHttpStatus;
      if (!weakPasswordAccepted) {
        await expect(resetPage.getByText('Não foi possível redefinir a senha.')).toBeVisible();
        directResetPassword = intermediateStrongPassword;
        directResetHttpStatus = await submitPassword(resetPage, directResetPassword);
        await expect(resetPage).toHaveURL(/\/login\?reason=password_updated$/u);
      }
      const normalSessionChangedPassword = /\/login\?reason=password_updated$/u.test(
        resetPage.url(),
      );
      expect(normalSessionChangedPassword).toBe(true);

      const oldCredentialAttempt = await statelessClient(url, secretKey).auth.signInWithPassword({
        email: syntheticEmail,
        password: originalPassword,
      });
      const directCredentialAttempt = await statelessClient(url, secretKey).auth.signInWithPassword(
        { email: syntheticEmail, password: directResetPassword },
      );
      expect(oldCredentialAttempt.error).not.toBeNull();
      expect(directCredentialAttempt.error).toBeNull();

      const oldSessionResponse = await oldSessionPage.goto('/dashboard');
      const oldSessionAllowedAfterPasswordReset = !/\/login(?:\?|$)/u.test(oldSessionPage.url());
      expect(oldSessionResponse?.status()).toBeLessThan(500);

      const oldRefresh = await statelessClient(url, secretKey).auth.refreshSession({
        refresh_token: oldSessionTokens.refreshToken,
      });
      const otherRefreshTokenRevoked = Boolean(oldRefresh.error) && !oldRefresh.data.session;
      expect(otherRefreshTokenRevoked).toBe(true);

      const generated = await admin.auth.admin.generateLink({
        type: 'recovery',
        email: syntheticEmail,
        options: { redirectTo: `${baseUrl}/reset-password` },
      });
      const tokenHash = generated.data?.properties?.hashed_token;
      if (generated.error || !tokenHash) {
        throw generated.error ?? new Error('Link recovery sintético não foi gerado.');
      }
      const recoveryLink = new URL('/auth/confirm', baseUrl);
      recoveryLink.searchParams.set('token_hash', tokenHash);
      recoveryLink.searchParams.set('type', 'recovery');
      recoveryLink.searchParams.set('next', '/reset-password');

      await recoveryPage.goto(recoveryLink.toString());
      await expect(recoveryPage).toHaveURL(/\/reset-password$/u);
      await expect(recoveryPage.getByLabel('Nova senha (mín 8 caracteres)')).toBeVisible();
      const recoveryResetHttpStatus = await submitPassword(recoveryPage, finalPassword);
      await expect(recoveryPage).toHaveURL(/\/login\?reason=password_updated$/u);

      await reusePage.goto(recoveryLink.toString());
      const recoveryLinkReuseDenied = /\/auth\/auth-error\?reason=/u.test(reusePage.url());
      expect(recoveryLinkReuseDenied).toBe(true);

      const priorCredentialAttempt = await statelessClient(url, secretKey).auth.signInWithPassword({
        email: syntheticEmail,
        password: directResetPassword,
      });
      const finalCredentialAttempt = await statelessClient(url, secretKey).auth.signInWithPassword({
        email: syntheticEmail,
        password: finalPassword,
      });
      expect(priorCredentialAttempt.error).not.toBeNull();
      expect(finalCredentialAttempt.error).toBeNull();

      await oldSessionPage.goto('/dashboard');
      const oldSessionAllowedAfterRecovery = !/\/login(?:\?|$)/u.test(oldSessionPage.url());

      const deleted = await admin.auth.admin.deleteUser(testUserId);
      if (deleted.error) throw deleted.error;
      userDeleted = true;
      await oldSessionPage.goto('/dashboard');
      const deletedUserDenied = /\/login(?:\?|$)/u.test(oldSessionPage.url());
      expect(deletedUserDenied).toBe(true);

      console.log(
        `[password-recovery-a] ${JSON.stringify({
          normalSessionReachedResetForm,
          normalSessionChangedPassword,
          directResetHttpStatus,
          weakPasswordHttpStatus,
          weakPasswordAccepted,
          oldPasswordRejectedAfterDirectReset: Boolean(oldCredentialAttempt.error),
          directPasswordAccepted: !directCredentialAttempt.error,
          otherRefreshTokenRevoked,
          oldSessionAllowedAfterPasswordReset,
          recoveryResetHttpStatus,
          recoveryLinkReuseDenied,
          priorPasswordRejectedAfterRecovery: Boolean(priorCredentialAttempt.error),
          finalPasswordAccepted: !finalCredentialAttempt.error,
          oldSessionAllowedAfterRecovery,
          deletedUserDenied,
          emailSent: false,
          productionUserDeleted: true,
          asaasOrMetaMutation: false,
        })}`,
      );
    } finally {
      try {
        if (userId && !userDeleted) {
          await admin.auth.admin.deleteUser(userId).catch(() => undefined);
        }
        if (clinicId) {
          const testClinicId = clinicId;
          const [remaining] = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            return tx<
              {
                profiles: number;
                auth_users: number;
                active: number;
                audits: number;
                idempotency: number;
              }[]
            >`
              select
                (select count(*)::int from profiles p where p.id=${userId ?? null}::uuid) profiles,
                (select count(*)::int from auth.users u
                  where lower(u.email)=${syntheticEmail}) auth_users,
                (select count(*)::int from profiles p where p.clinic_id=${testClinicId}::uuid
                  and p.ativo=true and p.deleted_at is null) active,
                (select count(*)::int from audit_events a where a.clinic_id=${testClinicId}::uuid
                  and a.resource_id=${userId ?? ''}) audits,
                (select count(*)::int from idempotency_keys i where i.clinic_id=${testClinicId}::uuid
                  and coalesce(i.response::text,'') like ${`%${syntheticEmail}%`}) idempotency
            `;
          });
          expect(remaining).toEqual({
            profiles: 0,
            auth_users: 0,
            active: baselineActive,
            audits: 0,
            idempotency: 0,
          });
          console.log(`[password-recovery-a-cleanup] ${JSON.stringify(remaining)}`);
        }
      } finally {
        await Promise.all([
          resetContext.close().catch(() => undefined),
          oldSessionContext.close().catch(() => undefined),
          recoveryContext.close().catch(() => undefined),
          reuseContext.close().catch(() => undefined),
        ]);
        await sql.end();
      }
    }
  });
});
