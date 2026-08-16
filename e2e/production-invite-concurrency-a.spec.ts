import { expect, test, type BrowserContext, type Page, type Response } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_INVITE_CONCURRENCY === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'off',
  video: 'on',
  screenshot: 'only-on-failure',
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

function productionConfig(): { databaseUrl: string; url: string; key: string } {
  const databaseUrl = process.env.DATABASE_URL_PROD;
  const key = process.env.SUPABASE_SECRET_KEY_PROD;
  if (!databaseUrl || !key) throw new Error('Credenciais operacionais PROD ausentes.');
  const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  if (!projectRef || !/^[a-z]{20}$/u.test(projectRef)) {
    throw new Error('Project ref de produção inválido.');
  }
  return { databaseUrl, url: `https://${projectRef}.supabase.co`, key };
}

async function signInContext(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<void> {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  const { url, key } = productionConfig();
  let nextCookies: Array<{ name: string; value: string }> = [];
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

function isServerAction(response: Response): boolean {
  const request = response.request();
  return request.method() === 'POST' && Boolean(request.headers()['next-action']);
}

async function prepareInvite(page: Page, name: string, email: string): Promise<void> {
  await page.goto('/equipe');
  await expect(page.getByText('Usuários: 4 de 5', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Convidar', exact: true }).click();
  const drawer = page.getByRole('dialog').filter({ hasText: 'Convidar para a equipe' });
  await drawer.getByRole('radio', { name: 'Atendente', exact: true }).click();
  await drawer.getByPlaceholder('Nome completo').fill(name);
  await drawer.getByPlaceholder('pessoa@email.com').fill(email);
}

async function inviteOutcome(page: Page): Promise<'success' | 'upgrade' | 'error'> {
  await expect
    .poll(
      async () => {
        if (
          await page
            .getByText('Convite enviado', { exact: true })
            .isVisible()
            .catch(() => false)
        ) {
          return 'success';
        }
        if (
          await page
            .getByText('Limite do plano atingido', { exact: true })
            .isVisible()
            .catch(() => false)
        ) {
          return 'upgrade';
        }
        if (
          await page
            .getByText('Não foi possível enviar o convite. Tente novamente.', { exact: true })
            .isVisible()
            .catch(() => false)
        ) {
          return 'error';
        }
        return 'pending';
      },
      { timeout: 30_000 },
    )
    .not.toBe('pending');

  if (
    await page
      .getByText('Convite enviado', { exact: true })
      .isVisible()
      .catch(() => false)
  ) {
    return 'success';
  }
  if (
    await page
      .getByText('Limite do plano atingido', { exact: true })
      .isVisible()
      .catch(() => false)
  ) {
    return 'upgrade';
  }
  return 'error';
}

async function prepareCancellation(page: Page, name: string): Promise<void> {
  await page.goto('/equipe');
  const row = page.getByText(name, { exact: true }).locator('xpath=ancestor::tr[1]');
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `Ações do convite de ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Cancelar convite' }).click();
  await expect(page.getByRole('dialog', { name: 'Cancelar convite' })).toBeVisible();
}

async function cancellationOutcome(page: Page): Promise<'success' | 'rejected'> {
  await expect
    .poll(
      async () => {
        if (
          await page
            .getByText('Convite cancelado', { exact: true })
            .isVisible()
            .catch(() => false)
        ) {
          return 'success';
        }
        if (
          await page
            .getByText('Não foi possível cancelar', { exact: true })
            .isVisible()
            .catch(() => false)
        ) {
          return 'rejected';
        }
        return 'pending';
      },
      { timeout: 30_000 },
    )
    .not.toBe('pending');
  return (await page
    .getByText('Convite cancelado', { exact: true })
    .isVisible()
    .catch(() => false))
    ? 'success'
    : 'rejected';
}

test.describe('produção: concorrência de convite e cancelamento na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('uma vaga aceita somente um convite e um único cancelamento vence', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(360_000);
    test.skip(!authorized, 'Exige autorização explícita para convites sintéticos na Clínica A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de concorrência só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !sharedPassword) throw new Error('Credencial do owner A ausente.');

    const { databaseUrl, url, key } = productionConfig();
    const sql = postgres(databaseUrl, { max: 3, ssl: 'require', prepare: false });
    const admin = createSsrClient(url, key, {
      cookies: { getAll: () => [], setAll: () => undefined },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const firstContext = await browser.newContext({
      baseURL: baseUrl,
      recordVideo: { dir: testInfo.outputPath('first-video') },
    });
    const secondContext = await browser.newContext({
      baseURL: baseUrl,
      recordVideo: { dir: testInfo.outputPath('second-video') },
    });
    const firstPage = await firstContext.newPage();
    const secondPage = await secondContext.newPage();
    const runId = String(Date.now()).slice(-10);
    const firstName = `[E2E-INVITE-RACE-A-${runId}] Alfa`;
    const secondName = `[E2E-INVITE-RACE-A-${runId}] Beta`;
    const emails = [
      `e2e-invite-race-a-${runId}-1@example.test`,
      `e2e-invite-race-a-${runId}-2@example.test`,
    ];
    let clinicId: string | undefined;
    let baselineActive: number | undefined;
    const observedIds = new Set<string>();

    try {
      const [baseline] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            clinic_id: string;
            active_users: number;
            pending_invites: number;
            seat_limit: number;
            preexisting: number;
          }[]
        >`
          select ep.clinic_id::text,
                 (select count(*)::int from profiles p
                   where p.clinic_id=ep.clinic_id and p.ativo=true and p.deleted_at is null) active_users,
                 (select count(*)::int from profiles p
                   where p.clinic_id=ep.clinic_id and p.ativo=true and p.deleted_at is null
                     and p.invite_accepted_at is null) pending_invites,
                 coalesce((select pl.limit_value::int from subscriptions s
                   join plan_limits pl on pl.plan_id=s.plan_id and pl.metric='users'
                  where s.clinic_id=ep.clinic_id limit 1), 0) seat_limit,
                 (select count(*)::int from auth.users au
                   where lower(au.email)=any(${emails}::text[])) preexisting
            from auth.users u
            join effective_permissions_v ep on ep.user_id=u.id
           where lower(u.email)=${ownerEmail.toLowerCase()}
             and ep.role='owner' and ep.ativo=true
             and 'manage:employees'=any(ep.permissions)
        `;
      });
      if (!baseline) throw new Error('Owner A não encontrado ou sem permissão de equipe.');
      expect(baseline).toMatchObject({
        active_users: 4,
        pending_invites: 0,
        seat_limit: 5,
        preexisting: 0,
      });
      clinicId = baseline.clinic_id;
      baselineActive = baseline.active_users;

      await Promise.all([
        signInContext(firstContext, ownerEmail, sharedPassword),
        signInContext(secondContext, ownerEmail, sharedPassword),
      ]);
      await Promise.all([
        prepareInvite(firstPage, firstName, emails[0]!),
        prepareInvite(secondPage, secondName, emails[1]!),
      ]);

      const firstResponse = firstPage.waitForResponse(isServerAction);
      const secondResponse = secondPage.waitForResponse(isServerAction);
      await Promise.all([
        firstPage.getByRole('button', { name: 'Enviar convite' }).click(),
        secondPage.getByRole('button', { name: 'Enviar convite' }).click(),
      ]);
      const inviteResponses = await Promise.all([firstResponse, secondResponse]);
      const inviteOutcomes = await Promise.all([
        inviteOutcome(firstPage),
        inviteOutcome(secondPage),
      ]);
      expect(inviteResponses.map((response) => response.status())).toEqual([200, 200]);
      expect(inviteOutcomes.toSorted()).toEqual(['success', 'upgrade']);

      const inviteState = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const rows = await tx<{ id: string; email: string; nome: string; pending: boolean }[]>`
          select p.id::text, lower(u.email) email, p.nome,
                 p.invite_accepted_at is null pending
            from auth.users u join profiles p on p.id=u.id
           where lower(u.email)=any(${emails}::text[])
             and p.clinic_id=${clinicId!}::uuid and p.deleted_at is null
        `;
        for (const row of rows) observedIds.add(row.id);
        const ids = rows.map(({ id }) => id);
        const [counts] = await tx<
          { active_users: number; auth_users: number; audits: number; idempotency: number }[]
        >`
          select
            (select count(*)::int from profiles p where p.clinic_id=${clinicId!}::uuid
              and p.ativo=true and p.deleted_at is null) active_users,
            (select count(*)::int from auth.users u
              where lower(u.email)=any(${emails}::text[])) auth_users,
            (select count(*)::int from audit_events a where a.clinic_id=${clinicId!}::uuid
              and a.action='internal.user.created' and a.resource_id=any(${ids}::text[])) audits,
            (select count(*)::int from idempotency_keys i where i.clinic_id=${clinicId!}::uuid
              and i.response->>'userId'=any(${ids}::text[])) idempotency
        `;
        return { rows, counts };
      });
      expect(inviteState.rows).toHaveLength(1);
      expect(inviteState.rows[0]?.pending).toBe(true);
      expect(inviteState.counts).toMatchObject({
        active_users: 5,
        auth_users: 1,
        audits: 1,
        idempotency: 1,
      });

      const winnerName = inviteState.rows[0]!.nome;
      await Promise.all([
        prepareCancellation(firstPage, winnerName),
        prepareCancellation(secondPage, winnerName),
      ]);
      const firstCancelResponse = firstPage.waitForResponse(isServerAction);
      const secondCancelResponse = secondPage.waitForResponse(isServerAction);
      await Promise.all([
        firstPage
          .getByRole('dialog', { name: 'Cancelar convite' })
          .getByRole('button', {
            name: 'Cancelar convite',
          })
          .click(),
        secondPage
          .getByRole('dialog', { name: 'Cancelar convite' })
          .getByRole('button', {
            name: 'Cancelar convite',
          })
          .click(),
      ]);
      const cancelResponses = await Promise.all([firstCancelResponse, secondCancelResponse]);
      const cancelOutcomes = await Promise.all([
        cancellationOutcome(firstPage),
        cancellationOutcome(secondPage),
      ]);
      expect(cancelResponses.map((response) => response.status())).toEqual([200, 200]);
      expect(cancelOutcomes.toSorted()).toEqual(['rejected', 'success']);

      await expect
        .poll(async () => {
          const [state] = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            return tx<
              {
                active_users: number;
                profiles: number;
                auth_users: number;
                created_audits: number;
                cancelled_audits: number;
              }[]
            >`
              select
                (select count(*)::int from profiles p where p.clinic_id=${clinicId!}::uuid
                  and p.ativo=true and p.deleted_at is null) active_users,
                (select count(*)::int from profiles p join auth.users u on u.id=p.id
                  where lower(u.email)=any(${emails}::text[])) profiles,
                (select count(*)::int from auth.users u
                  where lower(u.email)=any(${emails}::text[])) auth_users,
                (select count(*)::int from audit_events a where a.clinic_id=${clinicId!}::uuid
                  and a.action='internal.user.created'
                  and a.resource_id=any(${[...observedIds]}::text[])) created_audits,
                (select count(*)::int from audit_events a where a.clinic_id=${clinicId!}::uuid
                  and a.action='internal.user.invite_cancelled'
                  and a.resource_id=any(${[...observedIds]}::text[])) cancelled_audits
            `;
          });
          return state;
        })
        .toMatchObject({
          active_users: baselineActive,
          profiles: 0,
          auth_users: 0,
          created_audits: 1,
          cancelled_audits: 1,
        });

      console.log(
        `[invite-concurrency-a] ${JSON.stringify({
          baselineActiveUsers: baseline.active_users,
          seatLimit: baseline.seat_limit,
          pendingBefore: baseline.pending_invites,
          inviteHttpStatuses: inviteResponses.map((response) => response.status()),
          inviteOutcomes,
          persistedInvitesAtPeak: inviteState.rows.length,
          authUsersAtPeak: inviteState.counts?.auth_users,
          activeUsersAtPeak: inviteState.counts?.active_users,
          loserAuthUserCompensated: inviteState.counts?.auth_users === 1,
          createdAudits: inviteState.counts?.audits,
          idempotencyRows: inviteState.counts?.idempotency,
          cancelHttpStatuses: cancelResponses.map((response) => response.status()),
          cancelOutcomes,
          finalActiveUsers: baselineActive,
          finalSyntheticProfiles: 0,
          finalSyntheticAuthUsers: 0,
          asaasOrMetaMutation: false,
          supabaseAuthInvitationsAttempted: 2,
        })}`,
      );
    } finally {
      try {
        if (clinicId) {
          const existing = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            return tx<{ id: string }[]>`
              select id::text from auth.users where lower(email)=any(${emails}::text[])
            `;
          });
          for (const { id } of existing) observedIds.add(id);
          const ids = [...observedIds];
          const cleanup = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            const removedAudit = await tx<{ id: string }[]>`
              delete from audit_events where clinic_id=${clinicId!}::uuid
                and resource_id=any(${ids}::text[])
                and action in ('internal.user.created','internal.user.invite_cancelled')
              returning id::text
            `;
            const removedIdempotency = await tx<{ key: string }[]>`
              delete from idempotency_keys where clinic_id=${clinicId!}::uuid
                and response->>'userId'=any(${ids}::text[])
              returning key
            `;
            const removedProfiles = await tx<{ id: string }[]>`
              delete from profiles where clinic_id=${clinicId!}::uuid
                and id::text=any(${ids}::text[]) and invite_accepted_at is null
              returning id::text
            `;
            return {
              removed: {
                audit: removedAudit.length,
                idempotency: removedIdempotency.length,
                profiles: removedProfiles.length,
              },
            };
          });
          for (const id of ids) {
            await admin.auth.admin.deleteUser(id).catch(() => undefined);
          }
          const [remaining] = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            return tx<
              {
                profiles: number;
                auth_users: number;
                audit: number;
                idempotency: number;
                active: number;
              }[]
            >`
              select
                (select count(*)::int from profiles p join auth.users u on u.id=p.id
                  where lower(u.email)=any(${emails}::text[])) profiles,
                (select count(*)::int from auth.users u
                  where lower(u.email)=any(${emails}::text[])) auth_users,
                (select count(*)::int from audit_events a where a.clinic_id=${clinicId!}::uuid
                  and a.resource_id=any(${ids}::text[])) audit,
                (select count(*)::int from idempotency_keys i where i.clinic_id=${clinicId!}::uuid
                  and i.response->>'userId'=any(${ids}::text[])) idempotency,
                (select count(*)::int from profiles p where p.clinic_id=${clinicId!}::uuid
                  and p.ativo=true and p.deleted_at is null) active
            `;
          });
          expect(remaining).toEqual({
            profiles: 0,
            auth_users: 0,
            audit: 0,
            idempotency: 0,
            active: baselineActive,
          });
          console.log(
            `[invite-concurrency-a-cleanup] ${JSON.stringify({ ...cleanup, remaining })}`,
          );
        }
      } finally {
        await Promise.all([
          firstContext.close().catch(() => undefined),
          secondContext.close().catch(() => undefined),
        ]);
        await sql.end();
      }
    }
  });
});
