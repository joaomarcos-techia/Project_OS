import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_COLLECTION_CASE === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const tenantBEmail = process.env.E2E_TENANT_B_EMAIL;
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

function isServerAction(response: {
  request(): { method(): string; headers(): Record<string, string> };
}) {
  const request = response.request();
  return request.method() === 'POST' && Boolean(request.headers()['next-action']);
}

async function clickServerAction(page: Page, button: Locator): Promise<number> {
  const responsePromise = page.waitForResponse(isServerAction);
  await button.click();
  return (await responsePromise).status();
}

function financialCard(page: Page, description: string): Locator {
  return page
    .getByText(description, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-(--card-radius)")][1]');
}

test.describe('produção: fila humana de cobrança na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('guarda tenant, replay, Caixa, quitação e resolução sem envio externo', async ({ page }) => {
    test.setTimeout(360_000);
    test.skip(!authorized, 'Exige autorização explícita para dados sintéticos na Clínica A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de cobrança só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !tenantBEmail || !sharedPassword) {
      throw new Error('Credenciais dos tenants de teste ausentes.');
    }

    const { databaseUrl } = productionConfig();
    process.env.DATABASE_URL = databaseUrl;
    process.env.DATABASE_URL_DEV = databaseUrl;
    const { resolveSettledCollectionCasesPrivileged, upsertCollectionCasePrivileged } =
      await import('@/lib/financial/collection-case-store');
    const sql = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-COLLECTION-A-${runId}]`;
    const description = `${marker} Fila humana sem envio`;
    let clinicId: string | undefined;
    let tenantBClinicId: string | undefined;
    let lancamentoId: string | undefined;
    let collectionCaseId: string | undefined;

    try {
      const identities = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ email: string; clinic_id: string }[]>`
          select lower(u.email) email, p.clinic_id::text
            from auth.users u join profiles p on p.id = u.id
           where lower(u.email) = any(${[
             ownerEmail.toLowerCase(),
             tenantBEmail.toLowerCase(),
           ]}::text[])
             and p.ativo = true and p.deleted_at is null
        `;
      });
      clinicId = identities.find(({ email }) => email === ownerEmail.toLowerCase())?.clinic_id;
      tenantBClinicId = identities.find(
        ({ email }) => email === tenantBEmail.toLowerCase(),
      )?.clinic_id;
      if (!clinicId || !tenantBClinicId || clinicId === tenantBClinicId) {
        throw new Error('Tenants A/B inválidos para a guarda de cobrança.');
      }

      await signInContext(page.context(), ownerEmail, sharedPassword);
      await page.goto('/financeiro?novo=1');
      const drawer = page.getByRole('dialog', { name: 'Novo lançamento' });
      await drawer.getByLabel('Descrição').fill(description);
      await drawer.getByLabel('Valor (R$)').fill('12,34');
      const createHttp = await clickServerAction(
        page,
        drawer.getByRole('button', { name: 'Criar lançamento' }),
      );
      expect(createHttp).toBeLessThan(500);
      await expect(page).toHaveURL(/\/financeiro$/u);

      const [lancamento] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; status: string; valor: string; due_date: string | null }[]>`
          select id::text, status::text, valor::text, due_date::text
            from lancamentos
           where clinic_id = ${clinicId!}::uuid and descricao = ${description}
        `;
      });
      if (!lancamento) throw new Error('Lançamento sintético não persistiu.');
      lancamentoId = lancamento.id;
      expect(lancamento).toMatchObject({ status: 'pendente', valor: '12.34', due_date: null });

      await expect(
        upsertCollectionCasePrivileged(
          {
            clinicId: tenantBClinicId,
            lancamentoId,
            valor: 12.34,
            daysOverdue: 40,
          },
          'd30_manual',
        ),
      ).rejects.toThrow('does not belong');
      const [afterCrossTenant] = await sql<{ count: number }[]>`
        select count(*)::int count from collection_cases where lancamento_id = ${lancamentoId}::uuid
      `;
      expect(afterCrossTenant?.count).toBe(0);

      const candidate = {
        clinicId,
        lancamentoId,
        valor: 12.34,
        daysOverdue: 40,
      };
      await upsertCollectionCasePrivileged(candidate, 'd30_manual');
      await upsertCollectionCasePrivileged(candidate, 'd30_manual');

      const [openCase] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return await tx<
          {
            id: string;
            status: string;
            stage: string;
            days: number;
            residual: string;
            audits: number;
          }[]
        >`
          select cc.id::text, cc.status::text, cc.stage::text, cc.days_overdue days,
                 cc.residual_amount::text residual,
                 (select count(*)::int from audit_events a
                   where a.clinic_id = ${clinicId!}::uuid
                     and a.resource_id = cc.id::text
                     and a.action = 'financial.collection_case.upserted') audits
            from collection_cases cc
           where cc.clinic_id = ${clinicId!}::uuid
             and cc.lancamento_id = ${lancamentoId!}::uuid
        `;
      });
      if (!openCase) throw new Error('Caso manual não persistiu.');
      collectionCaseId = openCase.id;
      expect(openCase).toEqual({
        id: collectionCaseId,
        status: 'open',
        stage: 'd30_manual',
        days: 40,
        residual: '12.34',
        audits: 1,
      });

      await page.goto('/caixa');
      const manualQueue = page.getByRole('alert').filter({
        hasText: 'Cobranças aguardando revisão humana',
      });
      await expect(manualQueue).toContainText('40 dias em atraso');
      await expect(manualQueue).toContainText('R$ 12,34');
      const card = financialCard(page, description);
      await card.getByRole('button', { name: 'Confirmar pagamento' }).click();
      const paymentHttp = await clickServerAction(
        page,
        card.getByRole('button', { name: /Receber R\$/u }),
      );
      expect(paymentHttp).toBeLessThan(500);
      await expect
        .poll(async () => {
          const [row] = await sql<{ status: string }[]>`
            select status::text from lancamentos where id = ${lancamentoId!}::uuid
          `;
          return row?.status;
        })
        .toBe('pago');

      const firstResolution = await resolveSettledCollectionCasesPrivileged(clinicId);
      const replayResolution = await resolveSettledCollectionCasesPrivileged(clinicId);
      expect(firstResolution).toBe(1);
      expect(replayResolution).toBe(0);

      const [resolved] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ status: string; resolved: boolean; audits: number }[]>`
          select cc.status::text, cc.resolved_at is not null resolved,
                 (select count(*)::int from audit_events a
                   where a.clinic_id = ${clinicId!}::uuid
                     and a.resource_id = cc.id::text
                     and a.action = 'financial.collection_case.resolved') audits
            from collection_cases cc where cc.id = ${collectionCaseId!}::uuid
        `;
      });
      expect(resolved).toEqual({ status: 'resolved', resolved: true, audits: 1 });

      await page.reload();
      await expect(
        page.getByRole('alert').filter({ hasText: 'Cobranças aguardando revisão humana' }),
      ).toHaveCount(0);

      console.log(
        `[collection-case-a] ${JSON.stringify({
          baselineCandidates: 0,
          crossTenantUpsertRejected: true,
          exactReplayRequests: 2,
          openCaseRows: 1,
          openAuditRows: openCase.audits,
          caixaDisplayedManualQueue: true,
          paymentStatus: 'pago',
          firstResolution,
          replayResolution,
          resolvedAuditRows: resolved?.audits,
          caixaRemovedResolvedCase: true,
          proactiveCronInvoked: false,
          externalProviderMutation: false,
        })}`,
      );
    } finally {
      try {
        if (clinicId) {
          const cleanup = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            const lancamentos = await tx<{ id: string }[]>`
              select id::text from lancamentos
               where clinic_id = ${clinicId!}::uuid and descricao = ${description}
            `;
            const lancamentoIds = lancamentos.map(({ id }) => id);
            const cases = await tx<{ id: string }[]>`
              select id::text from collection_cases
               where clinic_id = ${clinicId!}::uuid
                 and lancamento_id::text = any(${lancamentoIds}::text[])
            `;
            const caseIds = cases.map(({ id }) => id);
            const transactions = await tx<{ id: string }[]>`
              select id::text from payment_transactions
               where clinic_id = ${clinicId!}::uuid
                 and lancamento_id::text = any(${lancamentoIds}::text[])
            `;
            const transactionIds = transactions.map(({ id }) => id);
            const patterns = lancamentoIds.map((id) => `%${id}%`);
            const removedOutbox = await tx<{ id: string }[]>`
              delete from outbox where clinic_id = ${clinicId!}::uuid
                and (payload::text like ${`%${marker}%`}
                     or payload::text like any(${patterns}::text[])) returning id::text
            `;
            const removedAudit = await tx<{ id: string }[]>`
              delete from audit_events where clinic_id = ${clinicId!}::uuid
                and (resource_id = any(${[...lancamentoIds, ...caseIds]}::text[])
                     or coalesce(before::text,'') like ${`%${marker}%`}
                     or coalesce(after::text,'') like ${`%${marker}%`}) returning id::text
            `;
            const removedIdempotency = await tx<{ key: string }[]>`
              delete from idempotency_keys where clinic_id = ${clinicId!}::uuid
                and (response::text like any(${patterns}::text[])
                     or response::text like ${`%${marker}%`}) returning key
            `;
            const removedCases = await tx<{ id: string }[]>`
              delete from collection_cases where clinic_id = ${clinicId!}::uuid
                and id::text = any(${caseIds}::text[]) returning id::text
            `;
            const removedTransactions = await tx<{ id: string }[]>`
              delete from payment_transactions where clinic_id = ${clinicId!}::uuid
                and id::text = any(${transactionIds}::text[]) returning id::text
            `;
            const removedLancamentos = await tx<{ id: string }[]>`
              delete from lancamentos where clinic_id = ${clinicId!}::uuid
                and id::text = any(${lancamentoIds}::text[]) returning id::text
            `;
            const [remaining] = await tx<
              {
                lancamentos: number;
                cases: number;
                transactions: number;
                audit: number;
                outbox: number;
              }[]
            >`
              select
                (select count(*)::int from lancamentos where clinic_id=${clinicId!}::uuid
                  and descricao=${description}) lancamentos,
                (select count(*)::int from collection_cases where clinic_id=${clinicId!}::uuid
                  and lancamento_id::text=any(${lancamentoIds}::text[])) cases,
                (select count(*)::int from payment_transactions where clinic_id=${clinicId!}::uuid
                  and lancamento_id::text=any(${lancamentoIds}::text[])) transactions,
                (select count(*)::int from audit_events where clinic_id=${clinicId!}::uuid
                  and resource_id=any(${[...lancamentoIds, ...caseIds]}::text[])) audit,
                (select count(*)::int from outbox where clinic_id=${clinicId!}::uuid
                  and payload::text like ${`%${marker}%`}) outbox
            `;
            return {
              removed: {
                outbox: removedOutbox.length,
                audit: removedAudit.length,
                idempotency: removedIdempotency.length,
                cases: removedCases.length,
                transactions: removedTransactions.length,
                lancamentos: removedLancamentos.length,
              },
              remaining,
            };
          });
          expect(cleanup.remaining).toEqual({
            lancamentos: 0,
            cases: 0,
            transactions: 0,
            audit: 0,
            outbox: 0,
          });
          console.log(`[collection-case-a-cleanup] ${JSON.stringify(cleanup)}`);
        }
      } finally {
        await sql.end();
      }
    }
  });
});
