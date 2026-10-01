import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_FINANCIAL_LIFECYCLE === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
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

function financialCard(page: Page, description: string): Locator {
  return page
    .getByText(description, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-(--card-radius)")][1]');
}

async function clickServerAction(page: Page, button: Locator): Promise<number> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      Boolean(response.request().headers()['next-action']),
  );
  await button.click();
  return (await responsePromise).status();
}

async function openCreateDrawer(page: Page): Promise<Locator> {
  await page.goto('/financeiro?novo=1');
  const drawer = page.getByRole('dialog', { name: 'Novo lançamento' });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function becomesVisible(locator: Locator, timeout = 10_000): Promise<boolean> {
  return locator
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
}

async function createLancamento(
  page: Page,
  input: { description: string; value: string; tipo?: 'receber' | 'pagar' },
): Promise<number> {
  const drawer = await openCreateDrawer(page);
  if (input.tipo) await drawer.getByLabel('Tipo').selectOption(input.tipo);
  await drawer.getByLabel('Descrição').fill(input.description);
  await drawer.getByLabel('Valor (R$)').fill(input.value);
  return clickServerAction(page, drawer.getByRole('button', { name: 'Criar lançamento' }));
}

test.describe('produção: ciclo financeiro e caixa na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('valores inválidos, arredondamento, cancelamento e estorno multipartes', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    test.skip(!authorized, 'Exige autorização explícita para dados sintéticos na Clínica A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste financeiro só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !sharedPassword) throw new Error('Credenciais da Clínica A ausentes.');
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const sql = postgres(databaseUrl, { max: 3, ssl: 'require', prepare: false });
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-FIN-LIFE-A-${runId}]`;
    const mainDescription = `${marker} Recebimento multipartes`;
    const cancelDescription = `${marker} Despesa arredondada e cancelada`;
    const invalidInputs = [
      { suffix: 'negativo', value: '-1' },
      { suffix: 'zero', value: '0' },
      { suffix: 'acima-limite', value: '100000000' },
      { suffix: 'nao-numerico', value: 'abc' },
    ];
    let clinicId: string | undefined;
    let originalId: string | undefined;

    try {
      const [identity] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ clinic_id: string; role: string; permissions: string[] }[]>`
          select ep.clinic_id::text, ep.role::text, ep.permissions
            from auth.users u
            join effective_permissions_v ep on ep.user_id = u.id
           where lower(u.email) = ${ownerEmail.toLowerCase()}
             and ep.ativo = true
             and ep.deleted_at is null
        `;
      });
      if (!identity) throw new Error('Owner da Clínica A não encontrado.');
      expect(identity.role).toBe('owner');
      expect(identity.permissions).toEqual(
        expect.arrayContaining(['view:financial', 'manage:financial', 'operate:caixa']),
      );
      clinicId = identity.clinic_id;

      await signInContext(page.context(), ownerEmail, sharedPassword);

      const invalidResults: Array<{
        input: string;
        httpStatus: number;
        persistedRows: number;
        formHasErrorText: boolean;
      }> = [];
      for (const invalid of invalidInputs) {
        const description = `${marker} inválido ${invalid.suffix}`;
        const status = await createLancamento(page, {
          description,
          value: invalid.value,
        });
        await expect(page.getByRole('dialog', { name: 'Novo lançamento' })).toBeVisible();
        const errorText =
          (await page
            .getByRole('dialog', { name: 'Novo lançamento' })
            .getByRole('alert')
            .textContent()) ?? '';
        const [persisted] = await sql.begin(async (tx) => {
          await tx.unsafe('RESET ROLE');
          return tx<{ count: number }[]>`
            select count(*)::int count from lancamentos
             where clinic_id = ${clinicId!}::uuid and descricao = ${description}
          `;
        });
        invalidResults.push({
          input: invalid.suffix,
          httpStatus: status,
          persistedRows: persisted?.count ?? -1,
          formHasErrorText: errorText.trim().length > 0,
        });
      }
      expect(invalidResults.every(({ httpStatus }) => httpStatus < 500)).toBe(true);
      expect(invalidResults.every(({ persistedRows }) => persistedRows === 0)).toBe(true);
      expect(invalidResults.every(({ formHasErrorText }) => formHasErrorText)).toBe(true);

      const roundedCreateStatus = await createLancamento(page, {
        description: cancelDescription,
        value: '10,005',
        tipo: 'pagar',
      });
      expect(roundedCreateStatus).toBeLessThan(500);
      await expect(page).toHaveURL(/\/financeiro$/u);

      const mainCreateStatus = await createLancamento(page, {
        description: mainDescription,
        value: '10,00',
      });
      expect(mainCreateStatus).toBeLessThan(500);
      await expect(page).toHaveURL(/\/financeiro$/u);

      const created = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; descricao: string; tipo: string; valor: string; status: string }[]>`
          select id::text, descricao, tipo::text, valor::text, status::text
            from lancamentos
           where clinic_id = ${clinicId!}::uuid
             and descricao = any(${[mainDescription, cancelDescription]}::text[])
           order by descricao
        `;
      });
      expect(created).toHaveLength(2);
      const main = created.find(({ descricao }) => descricao === mainDescription);
      const cancelTarget = created.find(({ descricao }) => descricao === cancelDescription);
      if (!main || !cancelTarget) throw new Error('Lançamentos sintéticos não persistiram.');
      originalId = main.id;
      expect(main).toMatchObject({ tipo: 'receber', valor: '10.00', status: 'pendente' });
      expect(cancelTarget).toMatchObject({ tipo: 'pagar', valor: '10.01', status: 'pendente' });

      await page.goto('/caixa');
      const cancelCard = financialCard(page, cancelDescription);
      await expect(cancelCard).toBeVisible();
      await cancelCard.getByRole('button', { name: 'Cancelar' }).click();
      const cancelStatus = await clickServerAction(
        page,
        cancelCard.getByRole('button', { name: 'Sim, cancelar' }),
      );
      expect(cancelStatus).toBeLessThan(500);
      await expect
        .poll(async () => {
          const [row] = await sql<{ status: string }[]>`
            select status::text from lancamentos
             where clinic_id = ${clinicId!}::uuid and id = ${cancelTarget.id}::uuid
          `;
          return row?.status;
        })
        .toBe('cancelado');

      await page.reload();
      let mainCard = financialCard(page, mainDescription);
      await expect(mainCard).toBeVisible();
      await mainCard.getByRole('button', { name: 'Confirmar pagamento' }).click();
      await mainCard.getByLabel('Valor recebido').fill('3,33');
      const firstPaymentStatus = await clickServerAction(
        page,
        mainCard.getByRole('button', { name: /Receber R\$/u }),
      );
      expect(firstPaymentStatus).toBeLessThan(500);
      await expect
        .poll(async () => {
          const [row] = await sql<{ status: string; valor_pago: string }[]>`
            select status::text, valor_pago::text from lancamentos
             where clinic_id = ${clinicId!}::uuid and id = ${originalId!}::uuid
          `;
          return row ? `${row.status}:${row.valor_pago}` : null;
        })
        .toBe('parcial:3.33');

      await page.reload();
      mainCard = financialCard(page, mainDescription);
      await mainCard.getByRole('button', { name: 'Confirmar pagamento' }).click();
      await mainCard.getByLabel('Valor recebido').fill('6,67');
      const secondPaymentStatus = await clickServerAction(
        page,
        mainCard.getByRole('button', { name: /Receber R\$/u }),
      );
      expect(secondPaymentStatus).toBeLessThan(500);
      await expect
        .poll(async () => {
          const [row] = await sql<{ status: string; valor_pago: string }[]>`
            select status::text, valor_pago::text from lancamentos
             where clinic_id = ${clinicId!}::uuid and id = ${originalId!}::uuid
          `;
          return row ? `${row.status}:${row.valor_pago}` : null;
        })
        .toBe('pago:10.00');

      const payments = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; amount: string }[]>`
          select id::text, amount::text
            from payment_transactions
           where clinic_id = ${clinicId!}::uuid
             and lancamento_id = ${originalId!}::uuid
             and kind = 'payment'
           order by amount asc, occurred_at asc
        `;
      });
      expect(payments.map(({ amount }) => amount)).toEqual(['3.33', '6.67']);

      for (const [index, payment] of payments.entries()) {
        await page.reload();
        mainCard = financialCard(page, mainDescription);
        await expect(mainCard).toBeVisible();
        await mainCard.getByRole('button', { name: 'Reembolsar' }).click();
        await mainCard.getByLabel('Pagamento original').selectOption(payment.id);
        await mainCard.getByLabel('Motivo do reembolso').fill(`${marker} estorno ${index + 1}`);
        const refundStatus = await clickServerAction(
          page,
          mainCard.getByRole('button', { name: 'Confirmar reembolso' }),
        );
        expect(refundStatus).toBeLessThan(500);
        await expect
          .poll(async () => {
            const [row] = await sql<{ count: number }[]>`
              select count(*)::int count from payment_transactions
               where clinic_id = ${clinicId!}::uuid
                 and lancamento_id = ${originalId!}::uuid
                 and kind = 'refund'
            `;
            return row?.count;
          })
          .toBe(index + 1);
      }

      const evidence = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const [original] = await tx<
          { status: string; valor: string; valor_pago: string; paid_at: string | null }[]
        >`
          select status::text, valor::text, valor_pago::text, paid_at::text
            from lancamentos
           where clinic_id = ${clinicId!}::uuid and id = ${originalId!}::uuid
        `;
        const transactions = await tx<
          { kind: string; count: number; total: string; actors: number }[]
        >`
          select kind::text, count(*)::int count, sum(amount)::text total,
                 count(distinct created_by)::int actors
            from payment_transactions
           where clinic_id = ${clinicId!}::uuid and lancamento_id = ${originalId!}::uuid
           group by kind order by kind
        `;
        const compensations = await tx<
          { status: string; count: number; total: string; paid_rows: number }[]
        >`
          select min(status::text) status, count(*)::int count, sum(valor)::text total,
                 count(*) filter (where status = 'pago')::int paid_rows
            from lancamentos
           where clinic_id = ${clinicId!}::uuid
             and reverses_lancamento_id = ${originalId!}::uuid
        `;
        const [cancelAudit] = await tx<{ count: number }[]>`
          select count(*)::int count from audit_events
           where clinic_id = ${clinicId!}::uuid
             and resource_id = ${cancelTarget.id}
             and action = 'financial.lancamento.cancelled'
        `;
        const [refundAudit] = await tx<{ count: number }[]>`
          select count(*)::int count from audit_events
           where clinic_id = ${clinicId!}::uuid
             and resource_id = ${originalId!}
             and action = 'financial.lancamento.estornado'
        `;
        return {
          original,
          transactions,
          compensation: compensations?.[0],
          cancelAuditRows: cancelAudit?.count,
          refundAuditRows: refundAudit?.count,
        };
      });
      expect(evidence.transactions).toEqual([
        { kind: 'payment', count: 2, total: '10.00', actors: 1 },
        { kind: 'refund', count: 2, total: '10.00', actors: 1 },
      ]);
      // DATA-003 — o achado: com estorno INTEGRAL em multiplas parcelas, o
      // lancamento original e as compensacoes ficavam `pago`, o filtro "Pago"
      // ainda os listava e nao havia acao para terminalizar. Agora o estorno
      // total marca tudo como `estornado`, entao nenhuma compensacao permanece
      // paga.
      expect(evidence.compensation).toMatchObject({ count: 2, total: '10.00', paid_rows: 0 });
      expect(evidence.cancelAuditRows).toBe(1);
      expect(evidence.refundAuditRows).toBe(2);

      // DATA-003 — terminalizado, o lancamento sai da lista padrao e passa a
      // aparecer sob o status `estornado`. Antes ele continuava em "Pago", que
      // era justamente a classificacao mentirosa do achado.
      await page.goto('/financeiro?tipo=receber&status=estornado');
      // Espera a lista renderizar antes de procurar o card (a rota tem
      // loading.tsx, entao o shell aparece primeiro).
      await page.getByLabel('Filtrar por status').waitFor({ timeout: 30_000 });
      // O card terminalizado nao expoe o mesmo wrapper das linhas acionaveis,
      // entao ancora-se no texto e checa-se a acao no escopo da lista.
      await expect(page.getByText(mainDescription, { exact: true })).toBeVisible();
      const refundStillExposed = await page
        .getByRole('button', { name: 'Reembolsar' })
        .first()
        .isVisible()
        .catch(() => false);

      await page.goto('/financeiro?tipo=receber&status=pago');
      await expect(page.getByLabel('Filtrar por tipo')).toHaveValue('receber');
      await expect(page.getByLabel('Filtrar por status')).toHaveValue('pago');
      const remainsInPaidFilter = await becomesVisible(
        page.getByText(mainDescription, { exact: true }),
      );
      await page.goto('/financeiro?tipo=receber&status=estornado');
      // Espera a lista renderizar antes de procurar o card (a rota tem
      // loading.tsx, entao o shell aparece primeiro).
      await page.getByLabel('Filtrar por status').waitFor({ timeout: 30_000 });
      await expect(page.getByLabel('Filtrar por tipo')).toHaveValue('receber');
      await expect(page.getByLabel('Filtrar por status')).toHaveValue('estornado');
      const appearsInRefundedFilter = await page
        .getByText(mainDescription, { exact: true })
        .isVisible()
        .catch(() => false);
      await page.goto('/financeiro?tipo=manipulado&status=qualquer');
      await expect(page.getByLabel('Filtrar por tipo')).toHaveValue('');
      await expect(page.getByLabel('Filtrar por status')).toHaveValue('');
      const invalidFiltersIgnored = await becomesVisible(
        page.getByText(mainDescription, { exact: true }),
      );

      // DATA-003 — o achado: apesar do estorno INTEGRAL em duas parcelas, o
      // original continuava `pago`, aparecia no filtro "Pago", nao aparecia em
      // "Estornado" e nao havia acao para terminalizar. O razao fechava, mas a
      // classificacao mentia. Agora o estorno total terminaliza.
      const fullRefundTerminalized = evidence.original?.status === 'estornado';
      expect(fullRefundTerminalized).toBe(true);
      expect(evidence.original).toMatchObject({
        status: 'estornado',
        valor: '10.00',
        valor_pago: '10.00',
      });
      expect(refundStillExposed).toBe(false);
      expect(remainsInPaidFilter).toBe(false);
      expect(appearsInRefundedFilter).toBe(true);
      expect(invalidFiltersIgnored).toBe(true);

      console.log(
        `[financial-lifecycle-a] ${JSON.stringify({
          invalidResults,
          threeDecimalInput: '10.005',
          persistedRoundedValue: cancelTarget.valor,
          cancelledExpenseStatus: 'cancelado',
          splitPayments: payments.map(({ amount }) => Number(amount)),
          paymentTotal: 10,
          refundTotal: 10,
          compensationRows: evidence.compensation?.count,
          compensationTotal: Number(evidence.compensation?.total),
          originalStatusAfterFullRefund: evidence.original?.status,
          fullRefundTerminalized,
          refundStillExposed,
          remainsInPaidFilter,
          appearsInRefundedFilter,
          invalidFiltersIgnored,
          externalProviderMutation: false,
          finding: 'multi-payment-full-refund-does-not-terminalize-original',
        })}`,
      );
    } finally {
      try {
        if (clinicId) {
          const cleanup = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            const originals = await tx<{ id: string }[]>`
              select id::text from lancamentos
               where clinic_id = ${clinicId!}::uuid
                 and descricao like ${`${marker}%`}
                 and reverses_lancamento_id is null
            `;
            const originalIds = originals.map(({ id }) => id);
            const compensations = await tx<{ id: string }[]>`
              select id::text from lancamentos
               where clinic_id = ${clinicId!}::uuid
                 and reverses_lancamento_id::text = any(${originalIds}::text[])
            `;
            const targetIds = [...originalIds, ...compensations.map(({ id }) => id)];
            const transactions = await tx<{ id: string }[]>`
              select id::text from payment_transactions
               where clinic_id = ${clinicId!}::uuid
                 and lancamento_id::text = any(${targetIds}::text[])
            `;
            const transactionIds = transactions.map(({ id }) => id);
            const patterns = targetIds.map((id) => `%${id}%`);
            const removedProofs = await tx<{ id: string }[]>`
              delete from payment_proofs
               where clinic_id = ${clinicId!}::uuid
                 and (lancamento_id::text = any(${targetIds}::text[])
                      or transaction_id::text = any(${transactionIds}::text[]))
              returning id::text
            `;
            const removedOutbox = await tx<{ id: string }[]>`
              delete from outbox
               where clinic_id = ${clinicId!}::uuid
                 and (payload::text like ${`%${marker}%`}
                      or payload::text like any(${patterns}::text[]))
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
                 and (response::text like any(${patterns}::text[])
                      or response::text like ${`%${marker}%`})
              returning key
            `;
            const removedTransactions = await tx<{ id: string }[]>`
              delete from payment_transactions
               where clinic_id = ${clinicId!}::uuid
                 and id::text = any(${transactionIds}::text[])
              returning id::text
            `;
            const removedCompensations = await tx<{ id: string }[]>`
              delete from lancamentos
               where clinic_id = ${clinicId!}::uuid
                 and id::text = any(${compensations.map(({ id }) => id)}::text[])
              returning id::text
            `;
            const removedOriginals = await tx<{ id: string }[]>`
              delete from lancamentos
               where clinic_id = ${clinicId!}::uuid
                 and id::text = any(${originalIds}::text[])
              returning id::text
            `;
            const [remaining] = await tx<
              { lancamentos: number; transactions: number; outbox: number; audit: number }[]
            >`
              select
                (select count(*)::int from lancamentos
                  where clinic_id = ${clinicId!}::uuid
                    and descricao like ${`%${marker}%`}) lancamentos,
                (select count(*)::int from payment_transactions
                  where clinic_id = ${clinicId!}::uuid
                    and lancamento_id::text = any(${targetIds}::text[])) transactions,
                (select count(*)::int from outbox
                  where clinic_id = ${clinicId!}::uuid
                    and payload::text like ${`%${marker}%`}) outbox,
                (select count(*)::int from audit_events
                  where clinic_id = ${clinicId!}::uuid
                    and (resource_id = any(${targetIds}::text[])
                         or coalesce(before::text, '') like ${`%${marker}%`}
                         or coalesce(after::text, '') like ${`%${marker}%`})) audit
            `;
            return {
              removed: {
                proofs: removedProofs.length,
                outbox: removedOutbox.length,
                audit: removedAudit.length,
                idempotency: removedIdempotency.length,
                transactions: removedTransactions.length,
                compensations: removedCompensations.length,
                originals: removedOriginals.length,
              },
              remaining,
            };
          });
          expect(cleanup.remaining).toEqual({
            lancamentos: 0,
            transactions: 0,
            outbox: 0,
            audit: 0,
          });
          console.log(`[financial-lifecycle-a-cleanup] ${JSON.stringify(cleanup)}`);
        }
      } finally {
        await sql.end();
      }
    }
  });
});
