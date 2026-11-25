import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_FINANCIAL_CONCURRENCY === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const attendantEmail = process.env.E2E_ATTENDANT_EMAIL;
const financialEmail = process.env.E2E_FINANCIAL_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

test.use({
  storageState: { cookies: [], origins: [] },
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

function productionSupabaseConfig(): { url: string; key: string } {
  const databaseUrl = process.env.DATABASE_URL_PROD;
  const adminSecret = process.env.SUPABASE_SECRET_KEY_PROD;
  if (!databaseUrl || !adminSecret) throw new Error('Credenciais operacionais PROD ausentes.');
  const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  if (!projectRef || !/^[a-z]{20}$/u.test(projectRef)) {
    throw new Error('Project ref de produção inválido.');
  }
  return { url: `https://${projectRef}.supabase.co`, key: adminSecret };
}

async function signInContext(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<void> {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  let nextCookies: Array<{ name: string; value: string }> = [];
  const { url, key } = productionSupabaseConfig();
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

function financialCard(page: Page, description: string) {
  return page
    .getByText(description, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-(--card-radius)")][1]');
}

test.describe('produção: concorrência financeira na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('Financeiro e Atendente não conseguem receber o mesmo lançamento duas vezes', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(420_000);
    test.skip(!authorized, 'Exige E2E_PRODUCTION_FINANCIAL_CONCURRENCY=ALLOW_SYNTHETIC_CLINIC_A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste financeiro só pode apontar para app.qoro.dev.');
    }
    if (!attendantEmail || !financialEmail || !sharedPassword) {
      throw new Error('Credenciais da Clínica A ausentes.');
    }
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const sql = postgres(databaseUrl, { max: 3, ssl: 'require', prepare: false });
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-FIN-RACE-A-${runId}]`;
    const description = `${marker} Recebimento simultâneo`;
    const amount = 17.03;
    let clinicId: string | undefined;
    let lancamentoId: string | undefined;
    let attendantContext: BrowserContext | undefined;

    try {
      const identities = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ email: string; clinic_id: string; role: string; permissions: string[] }[]>`
          select lower(u.email) email, ep.clinic_id::text, ep.role::text, ep.permissions
            from auth.users u
            join effective_permissions_v ep on ep.user_id = u.id
           where lower(u.email) = any(${[
             attendantEmail.toLowerCase(),
             financialEmail.toLowerCase(),
           ]}::text[])
             and ep.ativo = true
             and ep.deleted_at is null
        `;
      });
      expect(identities).toHaveLength(2);
      expect(new Set(identities.map(({ clinic_id: id }) => id)).size).toBe(1);
      const attendant = identities.find(({ role }) => role === 'attendant');
      const financial = identities.find(({ role }) => role === 'financial');
      if (!attendant || !financial) throw new Error('Roles da corrida financeira ausentes.');
      expect(attendant.permissions).toEqual(
        expect.arrayContaining(['view:financial', 'operate:caixa']),
      );
      expect(financial.permissions).toEqual(
        expect.arrayContaining(['view:financial', 'manage:financial', 'operate:caixa']),
      );
      clinicId = financial.clinic_id;

      await signInContext(page.context(), financialEmail, sharedPassword);
      await page.goto('/financeiro?novo=1');
      const drawer = page.getByRole('dialog', { name: 'Novo lançamento' });
      await drawer.getByLabel('Descrição').fill(description);
      await drawer.getByLabel('Valor (R$)').fill(String(amount).replace('.', ','));
      await drawer.getByRole('button', { name: 'Criar lançamento' }).click();
      await expect(page).toHaveURL(/\/financeiro$/u, { timeout: 30_000 });

      const [lancamento] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; status: string; valor_pago: string }[]>`
          select id::text, status::text, valor_pago::text
            from lancamentos
           where clinic_id = ${clinicId!}::uuid
             and descricao = ${description}
             and valor = ${amount}
        `;
      });
      if (!lancamento) throw new Error('Lançamento sintético não persistiu.');
      expect(lancamento).toMatchObject({ status: 'pendente', valor_pago: '0.00' });
      lancamentoId = lancamento.id;

      attendantContext = await browser.newContext({
        baseURL: baseUrl,
        storageState: { cookies: [], origins: [] },
        recordVideo: { dir: testInfo.outputPath('attendant-video') },
      });
      await signInContext(attendantContext, attendantEmail, sharedPassword);
      const attendantPage = await attendantContext.newPage();

      await Promise.all([page.goto('/caixa'), attendantPage.goto('/caixa')]);
      const financialItem = financialCard(page, description);
      const attendantItem = financialCard(attendantPage, description);
      await expect(financialItem).toBeVisible({ timeout: 30_000 });
      await expect(attendantItem).toBeVisible({ timeout: 30_000 });
      await Promise.all([
        financialItem.getByRole('button', { name: 'Registrar recebimento' }).click(),
        attendantItem.getByRole('button', { name: 'Registrar recebimento' }).click(),
      ]);

      const financialSubmit = financialItem.getByRole('button', { name: /Registrar R\$/u });
      const attendantSubmit = attendantItem.getByRole('button', { name: /Registrar R\$/u });
      await expect(financialSubmit).toBeEnabled();
      await expect(attendantSubmit).toBeEnabled();

      const requestTimes: number[] = [];
      for (const candidate of [page, attendantPage]) {
        candidate.on('request', (request) => {
          if (request.method() === 'POST' && request.headers()['next-action']) {
            requestTimes.push(Date.now());
          }
        });
      }
      const responseA = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          Boolean(response.request().headers()['next-action']),
      );
      const responseB = attendantPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          Boolean(response.request().headers()['next-action']),
      );
      await Promise.all([financialSubmit.click(), attendantSubmit.click()]);
      const [actionResponseA, actionResponseB] = await Promise.all([responseA, responseB]);
      const statuses = [actionResponseA.status(), actionResponseB.status()];
      expect(statuses.every((status) => status < 500)).toBe(true);
      expect(requestTimes).toHaveLength(2);
      const dispatchSkewMs = Math.abs(requestTimes[0]! - requestTimes[1]!);
      expect(dispatchSkewMs).toBeLessThan(5_000);

      const loserMessage = 'Valor pago excede o valor do lancamento.';
      await expect
        .poll(
          async () =>
            Number(
              await page
                .getByText(loserMessage, { exact: true })
                .isVisible()
                .catch(() => false),
            ) +
            Number(
              await attendantPage
                .getByText(loserMessage, { exact: true })
                .isVisible()
                .catch(() => false),
            ),
          { timeout: 30_000, intervals: [100, 250, 500] },
        )
        .toBe(1);

      const evidence = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const [state] = await tx<
          { status: string; valor: string; valor_pago: string; paid_at: string | null }[]
        >`
          select status::text, valor::text, valor_pago::text, paid_at::text
            from lancamentos
           where clinic_id = ${clinicId!}::uuid
             and id = ${lancamentoId!}::uuid
        `;
        const [transactions] = await tx<{ count: number; total: string }[]>`
          select count(*)::int count, coalesce(sum(amount), 0)::text total
            from payment_transactions
           where clinic_id = ${clinicId!}::uuid
             and lancamento_id = ${lancamentoId!}::uuid
             and kind = 'payment'
        `;
        const [audit] = await tx<{ count: number }[]>`
          select count(*)::int count
            from audit_events
           where clinic_id = ${clinicId!}::uuid
             and resource_id = ${lancamentoId!}
             and action = 'financial.lancamento.paid'
        `;
        const [outbox] = await tx<{ count: number }[]>`
          select count(*)::int count
            from outbox
           where clinic_id = ${clinicId!}::uuid
             and payload ->> 'lancamentoId' = ${lancamentoId!}
             and event_type = 'financial.lancamento.paid'
        `;
        const [idempotency] = await tx<{ count: number }[]>`
          select count(*)::int count
            from idempotency_keys
           where clinic_id = ${clinicId!}::uuid
             and response ->> 'id' = ${lancamentoId!}
        `;
        return {
          status: state?.status,
          valueMatches: Number(state?.valor) === amount,
          paidValueMatches: Number(state?.valor_pago) === amount,
          hasPaidAt: Boolean(state?.paid_at),
          paymentTransactions: transactions?.count,
          transactionTotalMatches: Number(transactions?.total) === amount,
          auditRows: audit?.count,
          outboxRows: outbox?.count,
          idempotencyRows: idempotency?.count,
        };
      });
      expect(evidence).toEqual({
        status: 'pago',
        valueMatches: true,
        paidValueMatches: true,
        hasPaidAt: true,
        paymentTransactions: 1,
        transactionTotalMatches: true,
        auditRows: 1,
        outboxRows: 1,
        idempotencyRows: 2,
      });

      console.log(
        `[financial-concurrency-a] ${JSON.stringify({
          concurrentActors: ['financial', 'attendant'],
          requests: 2,
          dispatchSkewMs,
          statuses,
          outcomes: ['success', 'controlled-balance-rejection'],
          ...evidence,
          result: 'single-payment-ledger-entry',
        })}`,
      );
    } finally {
      await attendantContext?.close().catch(() => undefined);
      try {
        if (clinicId) {
          const cleanup = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            const targets = await tx<{ id: string }[]>`
              select id::text from lancamentos
               where clinic_id = ${clinicId!}::uuid
                 and descricao = ${description}
            `;
            const targetIds = targets.map(({ id }) => id);
            const transactions = await tx<{ id: string }[]>`
              select id::text from payment_transactions
               where clinic_id = ${clinicId!}::uuid
                 and lancamento_id::text = any(${targetIds}::text[])
            `;
            const transactionIds = transactions.map(({ id }) => id);
            const removedOutbox = await tx<{ id: string }[]>`
              delete from outbox
               where clinic_id = ${clinicId!}::uuid
                 and (payload ->> 'lancamentoId' = any(${targetIds}::text[])
                      or payload ->> 'transactionId' = any(${transactionIds}::text[])
                      or payload::text like ${`%${marker}%`})
              returning id::text
            `;
            const removedAudit = await tx<{ id: string }[]>`
              delete from audit_events
               where clinic_id = ${clinicId!}::uuid
                 and (resource_id = any(${targetIds}::text[])
                      or coalesce(before::text, '') like ${`%${marker}%`}
                      or coalesce(after::text, '') like ${`%${marker}%`})
              returning id::text
            `;
            const removedIdempotency = await tx<{ key: string }[]>`
              delete from idempotency_keys
               where clinic_id = ${clinicId!}::uuid
                 and response ->> 'id' = any(${targetIds}::text[])
              returning key
            `;
            const removedTransactions = await tx<{ id: string }[]>`
              delete from payment_transactions
               where clinic_id = ${clinicId!}::uuid
                 and id::text = any(${transactionIds}::text[])
              returning id::text
            `;
            const removedLancamentos = await tx<{ id: string }[]>`
              delete from lancamentos
               where clinic_id = ${clinicId!}::uuid
                 and id::text = any(${targetIds}::text[])
              returning id::text
            `;
            const [remaining] = await tx<
              { lancamentos: number; transactions: number; outbox: number }[]
            >`
              select
                (select count(*)::int from lancamentos
                  where clinic_id = ${clinicId!}::uuid and descricao = ${description}) lancamentos,
                (select count(*)::int from payment_transactions
                  where clinic_id = ${clinicId!}::uuid
                    and lancamento_id::text = any(${targetIds}::text[])) transactions,
                (select count(*)::int from outbox
                  where clinic_id = ${clinicId!}::uuid
                    and payload::text like ${`%${marker}%`}) outbox
            `;
            return {
              outbox: removedOutbox.length,
              audit: removedAudit.length,
              idempotency: removedIdempotency.length,
              transactions: removedTransactions.length,
              lancamentos: removedLancamentos.length,
              remaining,
            };
          });
          expect(cleanup.remaining).toEqual({ lancamentos: 0, transactions: 0, outbox: 0 });
          console.log(`[financial-concurrency-a-cleanup] ${JSON.stringify(cleanup)}`);
        }
      } finally {
        await sql.end();
      }
    }
  });
});
