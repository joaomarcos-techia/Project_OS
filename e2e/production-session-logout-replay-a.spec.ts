import { randomBytes } from 'node:crypto';

import { expect, test, type BrowserContext } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_LOGOUT_REPLAY === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;

test.use({
  storageState: { cookies: [], origins: [] },
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

type SessionTokens = { accessToken: string; refreshToken: string };

function statelessClient(url: string, key: string) {
  return createSsrClient(url, key, {
    cookies: { getAll: () => [], setAll: () => undefined },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function productionConfig(): {
  databaseUrl: string;
  url: string;
  secretKey: string;
} {
  const databaseUrl = process.env.DATABASE_URL_PROD;
  const secretKey = process.env.SUPABASE_SECRET_KEY_PROD;
  if (!databaseUrl || !secretKey) {
    throw new Error('Credenciais operacionais PROD ausentes.');
  }
  const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  if (!projectRef || !/^[a-z]{20}$/u.test(projectRef)) {
    throw new Error('Project ref de produção inválido.');
  }
  return { databaseUrl, url: `https://${projectRef}.supabase.co`, secretKey };
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
  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}

test.describe('produção: logout e replay de sessão na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('revoga refresh, testa dois dispositivos e reapresenta o cookie anterior', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    test.skip(!authorized, 'Exige autorização explícita para usuário sintético na Clínica A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de logout só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail) throw new Error('Identidade do owner A ausente.');

    const { databaseUrl, url, secretKey } = productionConfig();
    const sql = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
    const admin = statelessClient(url, secretKey);
    const firstContext = await browser.newContext({ baseURL: baseUrl });
    const secondContext = await browser.newContext({ baseURL: baseUrl });
    let replayContext: BrowserContext | undefined;
    const firstPage = await firstContext.newPage();
    const secondPage = await secondContext.newPage();
    const runId = String(Date.now()).slice(-10);
    const syntheticEmail = `e2e-logout-replay-a-${runId}@example.test`;
    const syntheticName = `[E2E-LOGOUT-A-${runId}]`;
    const syntheticPassword = `Aa1!${randomBytes(18).toString('base64url')}`;
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
        password: syntheticPassword,
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

      const firstTokens = await signInContext(firstContext, syntheticEmail, syntheticPassword);
      await signInContext(secondContext, syntheticEmail, syntheticPassword);
      const replayCookies = await firstContext.cookies();

      await Promise.all([firstPage.goto('/dashboard'), secondPage.goto('/dashboard')]);
      await expect(firstPage).not.toHaveURL(/\/login(?:\?|$)/u);
      await expect(secondPage).not.toHaveURL(/\/login(?:\?|$)/u);

      const logoutResponse = firstPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && new URL(response.url()).pathname === '/logout',
      );
      await firstPage.getByRole('button', { name: 'Sair' }).click();
      const logoutHttpStatus = (await logoutResponse).status();
      await expect(firstPage).toHaveURL(/\/login(?:\?|$)/u);

      await firstPage.goto('/dashboard');
      const clearedContextDenied = /\/login(?:\?|$)/u.test(firstPage.url());

      replayContext = await browser.newContext({ baseURL: baseUrl });
      await replayContext.addCookies(
        replayCookies.map(({ name, value }) => ({ name, value, url: baseUrl })),
      );
      const replayPage = await replayContext.newPage();
      const replayResponse = await replayPage.goto('/dashboard');
      const replayedCookieAllowed = !/\/login(?:\?|$)/u.test(replayPage.url());

      const secondResponse = await secondPage.goto('/dashboard');
      const secondDeviceAllowed = !/\/login(?:\?|$)/u.test(secondPage.url());

      const refreshClient = statelessClient(url, secretKey);
      const refresh = await refreshClient.auth.refreshSession({
        refresh_token: firstTokens.refreshToken,
      });
      const refreshTokenRevoked = Boolean(refresh.error) && !refresh.data.session;

      expect(logoutHttpStatus).toBeLessThan(500);
      expect(clearedContextDenied).toBe(true);
      expect(refreshTokenRevoked).toBe(true);
      expect(replayResponse?.status()).toBeLessThan(500);
      expect(secondResponse?.status()).toBeLessThan(500);

      const deleted = await admin.auth.admin.deleteUser(testUserId);
      if (deleted.error) throw deleted.error;
      userDeleted = true;

      const deletedReplayResponse = await replayPage.goto('/dashboard');
      const deletedUserDenied = /\/login(?:\?|$)/u.test(replayPage.url());
      expect(deletedReplayResponse?.status()).toBeLessThan(500);
      expect(deletedUserDenied).toBe(true);

      console.log(
        `[session-logout-replay-a] ${JSON.stringify({
          logoutHttpStatus,
          clearedContextDenied,
          refreshTokenRevoked,
          replayedCookieAllowed,
          secondDeviceAllowed,
          deletedUserDenied,
          accessTokenRetainedOnlyInMemory: firstTokens.accessToken.length > 0,
          productionUserDeleted: true,
          emailSent: false,
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
                (select count(*)::int from profiles p
                  where p.id=${userId ?? null}::uuid) profiles,
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
          console.log(`[session-logout-replay-a-cleanup] ${JSON.stringify(remaining)}`);
        }
      } finally {
        await Promise.all([
          firstContext.close().catch(() => undefined),
          secondContext.close().catch(() => undefined),
          replayContext?.close().catch(() => undefined),
        ]);
        await sql.end();
      }
    }
  });
});
