import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_SUPPLIER_LIFECYCLE === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const financialEmail = process.env.E2E_FINANCIAL_EMAIL;
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

function supplierItem(page: Page, name: string): Locator {
  return page.getByText(name, { exact: true }).locator('xpath=ancestor::li[1]');
}

test.describe('produção: fornecedores financeiros na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('valida CNPJ, isolamento, edição concorrente, desativação e recuperação', async ({
    browser,
  }) => {
    test.setTimeout(480_000);
    test.skip(!authorized, 'Exige autorização explícita para dados sintéticos na Clínica A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de fornecedores só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !financialEmail || !tenantBEmail || !sharedPassword) {
      throw new Error('Credenciais dos tenants de teste ausentes.');
    }

    const { databaseUrl } = productionConfig();
    const sql = postgres(databaseUrl, { max: 4, ssl: 'require', prepare: false });
    const ownerContext = await browser.newContext({ baseURL: baseUrl });
    const financialContext = await browser.newContext({ baseURL: baseUrl });
    const tenantBContext = await browser.newContext({ baseURL: baseUrl });
    const ownerPage = await ownerContext.newPage();
    const financialPage = await financialContext.newPage();
    const tenantBPage = await tenantBContext.newPage();
    const startedAt = new Date().toISOString();
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-SUP-A-${runId}]`;
    const originalName = `${marker} <img src=x onerror=globalThis.__supplierXss=1>`;
    const ownerEditName = `${marker} EDIT-OWNER`;
    const financialEditName = `${marker} EDIT-FINANCIAL`;
    let clinicId: string | undefined;
    let supplierId: string | undefined;

    try {
      const identities = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ email: string; clinic_id: string; role: string; permissions: string[] }[]>`
          select lower(u.email) email, ep.clinic_id::text, ep.role::text, ep.permissions
            from auth.users u
            join effective_permissions_v ep on ep.user_id = u.id
           where lower(u.email) = any(${[
             ownerEmail.toLowerCase(),
             financialEmail.toLowerCase(),
             tenantBEmail.toLowerCase(),
           ]}::text[])
             and ep.ativo = true
             and ep.deleted_at is null
        `;
      });
      const owner = identities.find(({ email }) => email === ownerEmail.toLowerCase());
      const financial = identities.find(({ email }) => email === financialEmail.toLowerCase());
      const tenantB = identities.find(({ email }) => email === tenantBEmail.toLowerCase());
      if (!owner || !financial || !tenantB) throw new Error('Identidades de teste incompletas.');
      expect(owner.role).toBe('owner');
      expect(financial.role).toBe('financial');
      expect(financial.permissions).toEqual(
        expect.arrayContaining(['view:financial', 'manage:financial']),
      );
      expect(owner.clinic_id).toBe(financial.clinic_id);
      expect(tenantB.clinic_id).not.toBe(owner.clinic_id);
      clinicId = owner.clinic_id;

      await Promise.all([
        signInContext(ownerContext, ownerEmail, sharedPassword),
        signInContext(financialContext, financialEmail, sharedPassword),
        signInContext(tenantBContext, tenantBEmail, sharedPassword),
      ]);

      await ownerPage.goto('/financeiro/fornecedores');
      await ownerPage.getByRole('button', { name: 'Novo fornecedor' }).click();
      let dialog = ownerPage.getByRole('dialog', { name: 'Novo fornecedor' });
      const createInputs = dialog.locator('input');
      await createInputs.nth(0).fill(originalName);
      await createInputs.nth(1).fill('1');
      await createInputs.nth(2).fill('119');
      await createInputs.nth(3).fill("30 dias ' OR 1=1 --");
      const createStatus = await clickServerAction(
        ownerPage,
        dialog.getByRole('button', { name: 'Criar' }),
      );
      expect(createStatus).toBeLessThan(500);
      await expect(dialog).toBeHidden();
      await expect(ownerPage.getByText(originalName, { exact: true })).toBeVisible();
      expect(await ownerPage.evaluate(() => Boolean(globalThis.__supplierXss))).toBe(false);

      const [created] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; cnpj: string | null; contato: string | null; ativo: boolean }[]>`
          select id::text, cnpj, contato, ativo from suppliers
           where clinic_id = ${clinicId!}::uuid and razao_social = ${originalName}
        `;
      });
      if (!created) throw new Error('Fornecedor sintético não persistiu.');
      supplierId = created.id;
      expect(created).toMatchObject({ cnpj: '1', contato: '(11) 9', ativo: true });

      await tenantBPage.goto('/financeiro/fornecedores');
      await expect(tenantBPage.getByText(originalName, { exact: true })).toHaveCount(0);

      await Promise.all([
        ownerPage.goto('/financeiro/fornecedores'),
        financialPage.goto('/financeiro/fornecedores'),
      ]);
      await supplierItem(ownerPage, originalName).getByRole('button', { name: 'Editar' }).click();
      await supplierItem(financialPage, originalName)
        .getByRole('button', { name: 'Editar' })
        .click();
      const ownerDialog = ownerPage.getByRole('dialog', { name: 'Editar fornecedor' });
      const financialDialog = financialPage.getByRole('dialog', { name: 'Editar fornecedor' });
      await ownerDialog.locator('input').nth(0).fill(ownerEditName);
      await financialDialog.locator('input').nth(0).fill(financialEditName);

      let releaseLock!: () => void;
      let announceLock!: () => void;
      const lockReleased = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      const lockReady = new Promise<void>((resolve) => {
        announceLock = resolve;
      });
      const lockTask = sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        await tx`select id from suppliers where id = ${supplierId!}::uuid for update`;
        announceLock();
        await lockReleased;
      });
      await lockReady;

      const ownerRequest = ownerPage.waitForRequest((request) =>
        isServerAction({ request: () => request }),
      );
      const financialRequest = financialPage.waitForRequest((request) =>
        isServerAction({ request: () => request }),
      );
      const ownerResponse = ownerPage.waitForResponse(isServerAction);
      const financialResponse = financialPage.waitForResponse(isServerAction);
      const ownerClick = ownerDialog.getByRole('button', { name: 'Salvar' }).click();
      const financialClick = financialDialog.getByRole('button', { name: 'Salvar' }).click();
      await Promise.all([ownerRequest, financialRequest]);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      releaseLock();
      await lockTask;
      const [ownerHttp, financialHttp] = await Promise.all([ownerResponse, financialResponse]);
      expect(ownerHttp.status()).toBeLessThan(500);
      expect(financialHttp.status()).toBeLessThan(500);
      await Promise.all([ownerClick, financialClick]);

      const [concurrentState] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ name: string; updates: number; actors: number; idempotency: number }[]>`
          select s.razao_social name,
            (select count(*)::int from audit_events a
              where a.clinic_id = ${clinicId!}::uuid
                and a.action = 'financial.supplier.updated'
                and a.resource_id = ${supplierId!}
                and a.created_at >= ${startedAt}::timestamptz) updates,
            (select count(distinct a.user_id)::int from audit_events a
              where a.clinic_id = ${clinicId!}::uuid
                and a.action = 'financial.supplier.updated'
                and a.resource_id = ${supplierId!}
                and a.created_at >= ${startedAt}::timestamptz) actors,
            (select count(*)::int from idempotency_keys i
              where i.clinic_id = ${clinicId!}::uuid
                and i.created_at >= ${startedAt}::timestamptz
                and i.response ->> 'id' = ${supplierId!}) idempotency
            from suppliers s where s.id = ${supplierId!}::uuid
        `;
      });
      expect(concurrentState).toMatchObject({ updates: 2, actors: 2, idempotency: 3 });
      expect([ownerEditName, financialEditName]).toContain(concurrentState?.name);
      const finalName = concurrentState!.name;

      await ownerPage.goto('/financeiro/fornecedores');
      let item = supplierItem(ownerPage, finalName);
      const deactivateStatus = await clickServerAction(
        ownerPage,
        item.getByRole('button', { name: 'Desativar' }),
      );
      expect(deactivateStatus).toBeLessThan(500);
      await expect
        .poll(async () => {
          const [row] = await sql<{ ativo: boolean }[]>`
            select ativo from suppliers where id = ${supplierId!}::uuid
          `;
          return row?.ativo;
        })
        .toBe(false);

      await ownerPage.goto('/financeiro?novo=1');
      dialog = ownerPage.getByRole('dialog', { name: 'Novo lançamento' });
      await dialog.getByLabel('Tipo').selectOption('pagar');
      await expect(
        dialog.getByLabel('Fornecedor').getByRole('option', { name: finalName }),
      ).toHaveCount(0);

      await ownerPage.goto('/financeiro/fornecedores');
      item = supplierItem(ownerPage, finalName);
      await expect(item.getByText('Inativo', { exact: true })).toBeVisible();
      const reactivateStatus = await clickServerAction(
        ownerPage,
        item.getByRole('button', { name: 'Ativar' }),
      );
      expect(reactivateStatus).toBeLessThan(500);
      await expect
        .poll(async () => {
          const [row] = await sql<{ ativo: boolean }[]>`
            select ativo from suppliers where id = ${supplierId!}::uuid
          `;
          return row?.ativo;
        })
        .toBe(true);

      await ownerPage.goto('/financeiro?novo=1');
      dialog = ownerPage.getByRole('dialog', { name: 'Novo lançamento' });
      await dialog.getByLabel('Tipo').selectOption('pagar');
      await expect(
        dialog.getByLabel('Fornecedor').getByRole('option', { name: finalName }),
      ).toHaveCount(1);

      const [trails] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ audits: number; actors: number; idempotency: number }[]>`
          select
            (select count(*)::int from audit_events a
              where a.clinic_id = ${clinicId!}::uuid and a.created_at >= ${startedAt}::timestamptz
                and (a.resource_id = ${supplierId!}
                     or coalesce(a.after::text, '') like ${`%${marker}%`})) audits,
            (select count(distinct a.user_id)::int from audit_events a
              where a.clinic_id = ${clinicId!}::uuid and a.created_at >= ${startedAt}::timestamptz
                and (a.resource_id = ${supplierId!}
                     or coalesce(a.after::text, '') like ${`%${marker}%`})) actors,
            (select count(*)::int from idempotency_keys i
              where i.clinic_id = ${clinicId!}::uuid and i.created_at >= ${startedAt}::timestamptz
                and i.response ->> 'id' = ${supplierId!}) idempotency
        `;
      });
      expect(trails).toEqual({ audits: 5, actors: 2, idempotency: 5 });

      console.log(
        `[supplier-lifecycle-a] ${JSON.stringify({
          invalidCnpjAccepted: created.cnpj === '1',
          storedInvalidCnpj: created.cnpj,
          htmlLikeNameRenderedAsText: true,
          crossTenantHidden: true,
          concurrentUpdateAccepted: concurrentState?.updates,
          concurrentUpdateActors: concurrentState?.actors,
          concurrentUpdateConflictDetected: false,
          finalConcurrentNameIsOneSubmission: [ownerEditName, financialEditName].includes(
            finalName,
          ),
          inactiveSupplierHiddenFromExpenseForm: true,
          reactivatedSupplierRestoredToExpenseForm: true,
          auditRows: trails?.audits,
          idempotencyRows: trails?.idempotency,
          externalProviderMutation: false,
        })}`,
      );
    } finally {
      try {
        if (clinicId) {
          const cleanup = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            const targets = await tx<{ id: string }[]>`
              select id::text from suppliers
               where clinic_id = ${clinicId!}::uuid and razao_social like ${`${marker}%`}
            `;
            const targetIds = targets.map(({ id }) => id);
            const patterns = targetIds.map((id) => `%${id}%`);
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
            const removedSuppliers = await tx<{ id: string }[]>`
              delete from suppliers
               where clinic_id = ${clinicId!}::uuid and id::text = any(${targetIds}::text[])
              returning id::text
            `;
            const [remaining] = await tx<
              { suppliers: number; audit: number; idempotency: number }[]
            >`
              select
                (select count(*)::int from suppliers
                  where clinic_id = ${clinicId!}::uuid
                    and razao_social like ${`${marker}%`}) suppliers,
                (select count(*)::int from audit_events
                  where clinic_id = ${clinicId!}::uuid
                    and (resource_id = any(${targetIds}::text[])
                         or coalesce(before::text, '') like ${`%${marker}%`}
                         or coalesce(after::text, '') like ${`%${marker}%`})) audit,
                (select count(*)::int from idempotency_keys
                  where clinic_id = ${clinicId!}::uuid
                    and response::text like any(${patterns}::text[])) idempotency
            `;
            return {
              removed: {
                audit: removedAudit.length,
                idempotency: removedIdempotency.length,
                suppliers: removedSuppliers.length,
              },
              remaining,
            };
          });
          expect(cleanup.remaining).toEqual({ suppliers: 0, audit: 0, idempotency: 0 });
          console.log(`[supplier-lifecycle-a-cleanup] ${JSON.stringify(cleanup)}`);
        }
      } finally {
        await Promise.all([
          ownerContext.close().catch(() => undefined),
          financialContext.close().catch(() => undefined),
          tenantBContext.close().catch(() => undefined),
        ]);
        await sql.end();
      }
    }
  });
});

declare global {
  var __supplierXss: number | undefined;
}
