import { randomBytes } from 'node:crypto';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_ROLE_MATRIX === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

type Role = 'gestor' | 'doctor' | 'attendant' | 'financial';

const TRANSITIONS: ReadonlyArray<{ from: Role; to: Role; required: boolean }> = [
  { from: 'attendant', to: 'doctor', required: true },
  { from: 'doctor', to: 'attendant', required: true },
  { from: 'attendant', to: 'financial', required: true },
  { from: 'financial', to: 'attendant', required: true },
  { from: 'attendant', to: 'gestor', required: true },
  { from: 'gestor', to: 'doctor', required: false },
  { from: 'doctor', to: 'financial', required: true },
  { from: 'financial', to: 'doctor', required: true },
  { from: 'doctor', to: 'gestor', required: true },
  { from: 'gestor', to: 'financial', required: false },
  { from: 'financial', to: 'gestor', required: true },
  { from: 'gestor', to: 'attendant', required: false },
] as const;

test.use({
  storageState: { cookies: [], origins: [] },
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

function productionConfig(): { url: string; key: string; databaseUrl: string } {
  const databaseUrl = process.env.DATABASE_URL_PROD;
  const adminSecret = process.env.SUPABASE_SECRET_KEY_PROD;
  if (!databaseUrl || !adminSecret) throw new Error('Credenciais operacionais PROD ausentes.');
  const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  if (!projectRef || !/^[a-z]{20}$/u.test(projectRef)) {
    throw new Error('Project ref de produção inválido.');
  }
  return { url: `https://${projectRef}.supabase.co`, key: adminSecret, databaseUrl };
}

async function signInContext(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<void> {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  await context.clearCookies();
  let nextCookies: Array<{ name: string; value: string }> = [];
  const { url, key } = productionConfig();
  const client = createSsrClient(url, key, {
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
}

function sessionClaims(cookies: Array<{ name: string; value: string }>): Record<string, unknown> {
  const value = cookies
    .filter((cookie) => cookie.name.includes('auth-token'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((cookie) => cookie.value)
    .join('');
  if (!value.startsWith('base64-')) throw new Error('Cookie Auth inesperado.');
  const session = JSON.parse(Buffer.from(value.slice(7), 'base64url').toString('utf8')) as {
    access_token?: unknown;
  };
  if (typeof session.access_token !== 'string') throw new Error('Access token ausente.');
  const payload = session.access_token.split('.')[1];
  if (!payload) throw new Error('JWT malformado.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function assertConfirmationUrl(link: string): void {
  const parsed = new URL(link);
  expect(parsed.origin).toBe('https://app.qoro.dev');
  expect(parsed.pathname).toBe('/auth/confirm');
  expect(parsed.searchParams.has('token_hash')).toBe(true);
  expect(parsed.searchParams.get('type')).toBe('recovery');
  expect(parsed.searchParams.get('next')).toBe('/convite');
  expect(parsed.hash).toBe('');
}

async function acceptInvite(
  context: BrowserContext,
  link: string,
  password: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(link);
  const destination = new URL(page.url());
  expect(destination.origin).toBe('https://app.qoro.dev');
  expect(destination.pathname).toBe('/convite');
  expect(destination.hash).toBe('');
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByLabel('Confirmar senha').fill(password);
  await page.getByRole('button', { name: 'Criar senha e entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 60_000 });
  return page;
}

async function changeRole(ownerPage: Page, memberName: string, targetRole: Role): Promise<void> {
  await ownerPage.goto('/equipe');
  const row = ownerPage.getByText(memberName, { exact: true }).locator('xpath=ancestor::tr[1]');
  await row.getByRole('button', { name: `Ações de ${memberName}` }).click();
  await ownerPage.getByRole('menuitem', { name: 'Trocar função' }).click();
  const dialog = ownerPage.getByRole('dialog', { name: `Trocar função de ${memberName}` });
  await dialog.getByLabel('Função').selectOption(targetRole);
  await dialog.getByRole('button', { name: 'Salvar função' }).click();
  await expect(ownerPage.getByText('Função atualizada', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('produção: matriz de transições de role na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('cobre todas as nove transições exigidas, invalida sessão e restaura attendant', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(900_000);
    test.skip(!authorized, 'Exige E2E_PRODUCTION_ROLE_MATRIX=ALLOW_SYNTHETIC_CLINIC_A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('A matriz de roles só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !sharedPassword) throw new Error('Credencial do owner A ausente.');

    const { url, key, databaseUrl } = productionConfig();
    const admin = createSsrClient(url, key, {
      cookies: { getAll: () => [], setAll: () => undefined },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const sql = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
    const runId = String(Date.now()).slice(-10);
    const memberName = `[E2E-ROLE-MATRIX-A-${runId}] Colaborador`;
    const memberEmail = `e2e-role-matrix-a-${runId}@example.test`;
    const memberPassword = `Aa1!${randomBytes(24).toString('base64url')}`;
    let clinicId: string | undefined;
    let memberId: string | undefined;
    let memberContext: BrowserContext | undefined;

    try {
      const [owner] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ clinic_id: string; active_users: number; seat_limit: number }[]>`
          select ep.clinic_id::text,
                 (select count(*)::int from profiles p
                   where p.clinic_id = ep.clinic_id and p.ativo = true and p.deleted_at is null) active_users,
                 coalesce((select pl.limit_value::int
                   from subscriptions s
                   join plan_limits pl on pl.plan_id = s.plan_id and pl.metric = 'users'
                  where s.clinic_id = ep.clinic_id limit 1), 0) seat_limit
            from auth.users u
            join effective_permissions_v ep on ep.user_id = u.id
           where lower(u.email) = ${ownerEmail.toLowerCase()}
             and ep.role = 'owner'
             and ep.ativo = true
             and 'manage:employees' = any(ep.permissions)
             and 'manage:permissions' = any(ep.permissions)
        `;
      });
      if (!owner) throw new Error('Owner A não encontrado ou sem permissões administrativas.');
      expect(owner.seat_limit - owner.active_users).toBeGreaterThanOrEqual(1);
      clinicId = owner.clinic_id;

      await signInContext(page.context(), ownerEmail, sharedPassword);
      await page.goto('/equipe');
      await page.getByRole('button', { name: 'Convidar', exact: true }).click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'Convidar para a equipe' });
      await drawer.getByRole('radio', { name: 'Atendente', exact: true }).click();
      await drawer.getByPlaceholder('Nome completo').fill(memberName);
      await drawer.getByPlaceholder('pessoa@email.com').fill(memberEmail);
      await drawer.getByRole('button', { name: 'Enviar convite' }).click();
      await expect(page.getByText('Convite enviado', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      const generated = await admin.auth.admin.generateLink({
        type: 'recovery',
        email: memberEmail,
        options: { redirectTo: 'https://app.qoro.dev/convite' },
      });
      if (generated.error || !generated.data.properties.hashed_token) {
        throw generated.error ?? new Error('Não foi possível gerar a fixture de aceite.');
      }
      const link = new URL('https://app.qoro.dev/auth/confirm');
      link.searchParams.set('token_hash', generated.data.properties.hashed_token);
      link.searchParams.set('type', 'recovery');
      link.searchParams.set('next', '/convite');
      assertConfirmationUrl(link.toString());

      memberContext = await browser.newContext({
        baseURL: baseUrl,
        storageState: { cookies: [], origins: [] },
        recordVideo: { dir: testInfo.outputPath('member-video') },
      });
      const memberPage = await acceptInvite(memberContext, link.toString(), memberPassword);
      const initialClaims = sessionClaims(await memberContext.cookies());
      expect(initialClaims.app_role).toBe('attendant');
      if (typeof initialClaims.sub !== 'string') throw new Error('ID do convidado ausente no JWT.');
      memberId = initialClaims.sub;

      const [initialState] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ claims_version: number; overrides: number }[]>`
          select p.claims_version,
                 (select count(*)::int from user_permission_overrides o where o.user_id = p.id) overrides
            from profiles p
           where p.id = ${memberId!}::uuid
             and p.clinic_id = ${clinicId!}::uuid
             and p.role = 'attendant'
        `;
      });
      if (!initialState) throw new Error('Perfil convidado não persistiu como attendant.');
      expect(initialState.overrides).toBe(0);
      let previousVersion = initialState.claims_version;
      let currentRole: Role = 'attendant';
      let requiredTransitions = 0;

      for (const [index, transition] of TRANSITIONS.entries()) {
        expect(currentRole).toBe(transition.from);
        await changeRole(page, memberName, transition.to);

        const staleResponse = await memberPage.goto('/dashboard');
        expect(staleResponse?.status() ?? 500).toBeLessThan(500);
        await expect(memberPage).toHaveURL(/\/login(?:\?|$)/u, { timeout: 30_000 });

        const [state] = await sql.begin(async (tx) => {
          await tx.unsafe('RESET ROLE');
          return tx<
            {
              role: Role;
              claims_version: number;
              effective_permissions: string[];
              bundle_permissions: string[];
              overrides: number;
              audit_count: number;
            }[]
          >`
            select p.role::text as role,
                   p.claims_version,
                   (select coalesce(array_agg(permission order by permission), array[]::text[])
                      from unnest(ep.permissions) permission) effective_permissions,
                   (select coalesce(array_agg(rp.permission_code order by rp.permission_code), array[]::text[])
                      from role_permissions rp where rp.role = p.role) bundle_permissions,
                   (select count(*)::int from user_permission_overrides o where o.user_id = p.id) overrides,
                   (select count(*)::int from audit_events a
                     where a.clinic_id = p.clinic_id
                       and a.resource_id = p.id::text
                       and a.action = 'internal.user.role_changed') audit_count
              from profiles p
              join effective_permissions_v ep on ep.user_id = p.id
             where p.id = ${memberId!}::uuid
               and p.clinic_id = ${clinicId!}::uuid
          `;
        });
        if (!state) throw new Error(`Estado ausente após transição ${index + 1}.`);
        expect(state.role).toBe(transition.to);
        expect(state.claims_version).toBe(previousVersion + 1);
        expect(state.effective_permissions).toEqual(state.bundle_permissions);
        expect(state.overrides).toBe(0);
        expect(state.audit_count).toBe(index + 1);

        await signInContext(memberContext, memberEmail, memberPassword);
        await memberPage.goto('/dashboard');
        await expect(memberPage).toHaveURL(/\/dashboard(?:\?|$)/u);
        const claims = sessionClaims(await memberContext.cookies());
        expect(claims.app_role).toBe(transition.to);
        expect(
          Array.isArray(claims.permissions) ? [...claims.permissions].sort() : claims.permissions,
        ).toEqual(state.bundle_permissions);

        await memberPage.goto('/equipe');
        if (transition.to === 'gestor') {
          await expect(
            memberPage.getByRole('button', { name: 'Convidar', exact: true }),
          ).toBeVisible();
        } else {
          await expect(memberPage.getByText('Sem acesso', { exact: true })).toBeVisible();
        }

        if (transition.required) requiredTransitions += 1;
        previousVersion = state.claims_version;
        currentRole = transition.to;
      }

      expect(requiredTransitions).toBe(9);
      expect(currentRole).toBe('attendant');
      console.log(
        `[role-transition-matrix-a] ${JSON.stringify({
          requiredTransitions: 9,
          bridgeTransitions: TRANSITIONS.length - 9,
          totalTransitions: TRANSITIONS.length,
          staleSessionsRejected: TRANSITIONS.length,
          freshClaimsMatched: TRANSITIONS.length,
          databaseBundlesMatched: TRANSITIONS.length,
          auditRows: TRANSITIONS.length,
          finalRole: currentRole,
          result: 'pass',
        })}`,
      );
    } finally {
      await memberContext?.close().catch(() => undefined);
      try {
        if (clinicId) {
          const [target] = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            return tx<{ id: string }[]>`
              select p.id::text
                from profiles p
                join auth.users u on u.id = p.id
               where p.clinic_id = ${clinicId!}::uuid
                 and lower(u.email) = ${memberEmail}
                 and p.nome = ${memberName}
            `;
          });
          memberId ??= target?.id;
          if (memberId) {
            const cleanupMemberId = memberId;
            const cleanup = await sql.begin(async (tx) => {
              await tx.unsafe('RESET ROLE');
              const removedOutbox = await tx<{ id: string }[]>`
                delete from outbox
                 where clinic_id = ${clinicId!}::uuid
                   and (payload::text like ${`%${cleanupMemberId}%`}
                        or payload::text like ${`%${memberName}%`}
                        or payload::text like ${`%${memberEmail}%`})
                returning id::text
              `;
              const removedIdempotency = await tx<{ key: string }[]>`
                delete from idempotency_keys
                 where clinic_id = ${clinicId!}::uuid
                   and (response::text like ${`%${cleanupMemberId}%`}
                        or response::text like ${`%${memberName}%`}
                        or response::text like ${`%${memberEmail}%`})
                returning key
              `;
              const removedAudit = await tx<{ id: string }[]>`
                delete from audit_events
                 where clinic_id = ${clinicId!}::uuid
                   and (resource_id = ${cleanupMemberId}
                        or coalesce(before::text, '') like ${`%${memberName}%`}
                        or coalesce(after::text, '') like ${`%${memberName}%`}
                        or coalesce(before::text, '') like ${`%${memberEmail}%`}
                        or coalesce(after::text, '') like ${`%${memberEmail}%`})
                returning id::text
              `;
              return {
                outbox: removedOutbox.length,
                idempotency: removedIdempotency.length,
                audit: removedAudit.length,
              };
            });
            const removed = await admin.auth.admin.deleteUser(cleanupMemberId);
            if (removed.error) throw removed.error;
            const [remaining] = await sql.begin(async (tx) => {
              await tx.unsafe('RESET ROLE');
              return tx<{ profiles: number; outbox: number; audit: number }[]>`
                select
                  (select count(*)::int from profiles where id = ${cleanupMemberId}::uuid) profiles,
                  (select count(*)::int from outbox
                    where clinic_id = ${clinicId!}::uuid
                      and payload::text like ${`%${cleanupMemberId}%`}) outbox,
                  (select count(*)::int from audit_events
                    where clinic_id = ${clinicId!}::uuid
                      and resource_id = ${cleanupMemberId}) audit
              `;
            });
            expect(remaining).toEqual({ profiles: 0, outbox: 0, audit: 0 });
            console.log(
              `[role-transition-matrix-a-cleanup] ${JSON.stringify({ ...cleanup, remaining })}`,
            );
          }
        }
      } finally {
        await sql.end();
      }
    }
  });
});
