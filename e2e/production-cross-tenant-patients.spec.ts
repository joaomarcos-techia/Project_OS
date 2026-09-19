import { randomUUID } from 'node:crypto';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_CROSS_TENANT === 'ALLOW_TEST_ACCOUNTS';
const baseUrl = process.env.E2E_BASE_URL;
const emailA = process.env.E2E_TENANT_A_EMAIL;
const emailB = process.env.E2E_TENANT_B_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'off',
  video: 'on',
  screenshot: 'off',
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

type Identity = { userId: string; clinicId: string };
type PatientFixture = { id: string; name: string; url: string; owner: 'A' | 'B' };

function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

function validCpf(seed: string): string {
  const digits = Array.from(seed.replace(/\D/gu, '').padStart(9, '7').slice(-9), Number);
  const digit = (values: number[], weight: number) => {
    const rest =
      (values.reduce((sum, value, index) => sum + value * (weight - index), 0) * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const first = digit(digits, 10);
  return [...digits, first, digit([...digits, first], 11)].join('');
}

async function login(context: BrowserContext, email: string, password: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 30_000 });
  return page;
}

async function createPatient(
  page: Page,
  runId: string,
  owner: 'A' | 'B',
  suffix: string,
  injectedClinicId?: string,
): Promise<PatientFixture> {
  const name = `[E2E-MT-${runId}] Paciente ${owner}-${suffix}`;
  const cpfDiscriminator =
    owner === 'A' ? (suffix === 'base' ? '1' : '3') : suffix === 'base' ? '2' : '4';
  await page.goto('/pacientes?novo=1');
  const drawer = page.getByRole('dialog', { name: 'Novo paciente' });
  await expect(drawer).toBeVisible();

  if (injectedClinicId) {
    await drawer.locator('form').evaluate((form, clinicId) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'clinic_id';
      input.value = clinicId;
      form.append(input);
    }, injectedClinicId);
  }

  await drawer.locator('input[name="nome"]').fill(name);
  await drawer.locator('input[name="cpf"]').fill(validCpf(`${runId}${cpfDiscriminator}`));
  await drawer
    .locator('input[name="email"]')
    .fill(`e2e-mt-${runId}-${owner.toLowerCase()}-${suffix}@example.test`);
  await drawer.getByRole('button', { name: 'Criar paciente' }).click();
  await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/u, { timeout: 60_000 });
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();

  const url = page.url();
  const id = new URL(url).pathname.split('/').at(-1) ?? '';
  expect(id).toMatch(/^[0-9a-f-]{36}$/iu);
  return { id, name, url, owner };
}

async function assertCrossDirection(
  actorPage: Page,
  actorOwn: PatientFixture,
  target: PatientFixture,
): Promise<void> {
  await actorPage.goto(`/pacientes?q=${encodeURIComponent(target.name)}`);
  await expect(actorPage.getByText(target.name, { exact: true })).toHaveCount(0);
  await expect(actorPage.getByText('Nenhum paciente encontrado', { exact: true })).toBeVisible();

  const directResponse = await actorPage.goto(target.url);
  expect([200, 404]).toContain(directResponse?.status());
  await expect(actorPage.getByText('Página não encontrada', { exact: true })).toBeVisible();
  await expect(actorPage.getByText(target.name, { exact: true })).toHaveCount(0);

  await actorPage.goto(actorOwn.url);
  const editForm = actorPage.getByRole('heading', { name: 'Editar', exact: true }).locator('..');
  await editForm.locator('input[name="nome"]').fill(`${actorOwn.name} cross-update-denied`);
  await editForm.locator('input[name="id"]').evaluate((input, targetId) => {
    if (!(input instanceof HTMLInputElement)) throw new Error('Campo id de edição inválido.');
    input.value = targetId;
    input.setAttribute('value', targetId);
  }, target.id);
  await editForm.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(editForm.getByRole('alert')).toContainText('patient not found', {
    timeout: 30_000,
  });

  await actorPage.goto(actorOwn.url);
  const deleteForm = actorPage
    .getByRole('heading', { name: 'Excluir (operacional)' })
    .locator('..');
  await deleteForm.locator('input[name="id"]').evaluate((input, targetId) => {
    if (!(input instanceof HTMLInputElement)) throw new Error('Campo id de exclusão inválido.');
    input.value = targetId;
  }, target.id);
  actorPage.once('dialog', (dialog) => dialog.accept());
  await deleteForm.getByRole('button', { name: 'Excluir paciente', exact: true }).click();
  await expect(deleteForm.getByText(/patient not found/u)).toBeVisible({ timeout: 30_000 });
}

async function requestLgpdCleanup(page: Page, fixture: PatientFixture): Promise<void> {
  await page.goto(fixture.url);
  if ((await page.getByRole('button', { name: 'Solicitar exclusão (LGPD)' }).count()) === 0) return;
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Solicitar exclusão (LGPD)' }).click();
  await expect(page).toHaveURL(/\/pacientes(?:\?|$)/u, { timeout: 30_000 });
}

test.describe('produção: isolamento A↔B de pacientes', () => {
  test.describe.configure({ retries: 0 });

  test('bloqueia listagem, detalhe e CRUD adulterado nas duas direções', async ({ browser }) => {
    test.setTimeout(600_000);
    test.skip(
      !authorized,
      'Exige E2E_PRODUCTION_CROSS_TENANT=ALLOW_TEST_ACCOUNTS para fixtures sintéticas.',
    );
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste cross-tenant só pode apontar para app.qoro.dev.');
    }
    if (!emailA || !emailB || !sharedPassword || emailA === emailB) {
      throw new Error('Credenciais distintas dos tenants A e B são obrigatórias.');
    }
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const artifactRoot = process.env.E2E_ARTIFACTS;
    const contextA = await browser.newContext({
      baseURL: baseUrl,
      ...(artifactRoot ? { recordVideo: { dir: `${artifactRoot}/tenant-a` } } : {}),
    });
    const contextB = await browser.newContext({
      baseURL: baseUrl,
      ...(artifactRoot ? { recordVideo: { dir: `${artifactRoot}/tenant-b` } } : {}),
    });
    const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });
    const fixtures: PatientFixture[] = [];
    let pageA: Page | undefined;
    let pageB: Page | undefined;
    const runId = String(Date.now()).slice(-10);

    const loadIdentities = async (): Promise<{ A: Identity; B: Identity }> => {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            email: string;
            user_id: string;
            clinic_id: string;
          }[]
        >`select lower(u.email) as email, p.id::text as user_id, p.clinic_id::text as clinic_id
          from auth.users u join profiles p on p.id = u.id
          where lower(u.email) in (${emailA.toLowerCase()}, ${emailB.toLowerCase()})
            and p.ativo = true and p.deleted_at is null`;
      });
      const a = rows.find((row) => row.email === emailA.toLowerCase());
      const b = rows.find((row) => row.email === emailB.toLowerCase());
      if (!a || !b || a.clinic_id === b.clinic_id) throw new Error('Tenants A/B inválidos.');
      return {
        A: { userId: a.user_id, clinicId: a.clinic_id },
        B: { userId: b.user_id, clinicId: b.clinic_id },
      };
    };

    const withIdentity = async <T>(
      identity: Identity,
      callback: (tx: postgres.TransactionSql) => Promise<T>,
    ) =>
      sql.begin(async (tx) => {
        await tx.unsafe('SET LOCAL ROLE authenticated');
        await tx`select set_config('app.current_clinic', ${identity.clinicId}, true)`;
        await tx`select set_config('app.current_user', ${identity.userId}, true)`;
        await tx`select set_config('request.jwt.claim.sub', ${identity.userId}, true)`;
        await tx`select set_config(
          'request.jwt.claims',
          ${JSON.stringify({ sub: identity.userId, clinic_id: identity.clinicId, role: 'authenticated' })},
          true
        )`;
        return callback(tx);
      });

    try {
      const identities = await loadIdentities();
      pageA = await login(contextA, emailA, sharedPassword);
      pageB = await login(contextB, emailB, sharedPassword);

      const patientA = await createPatient(pageA, runId, 'A', 'base');
      const patientB = await createPatient(pageB, runId, 'B', 'base');
      fixtures.push(patientA, patientB);

      await assertCrossDirection(pageA, patientA, patientB);
      await assertCrossDirection(pageB, patientB, patientA);

      await pageA.goto(patientA.url);
      await expect(pageA.getByRole('heading', { name: patientA.name, exact: true })).toBeVisible();
      await pageB.goto(patientB.url);
      await expect(pageB.getByRole('heading', { name: patientB.name, exact: true })).toBeVisible();

      const injectedA = await createPatient(pageA, runId, 'A', 'injected', identities.B.clinicId);
      const injectedB = await createPatient(pageB, runId, 'B', 'injected', identities.A.clinicId);
      fixtures.push(injectedA, injectedB);
      const fixtureOwnership = await sql<
        {
          id: string;
          clinic_id: string;
        }[]
      >`select id::text, clinic_id::text
          from patients
         where id in ${sql(fixtures.map((fixture) => fixture.id))}`;
      expect(Object.fromEntries(fixtureOwnership.map((row) => [row.id, row.clinic_id]))).toEqual({
        [patientA.id]: identities.A.clinicId,
        [patientB.id]: identities.B.clinicId,
        [injectedA.id]: identities.A.clinicId,
        [injectedB.id]: identities.B.clinicId,
      });
      await pageB.goto(`/pacientes?q=${encodeURIComponent(injectedA.name)}`);
      await expect(pageB.getByText(injectedA.name, { exact: true })).toHaveCount(0);
      await pageA.goto(`/pacientes?q=${encodeURIComponent(injectedB.name)}`);
      await expect(pageA.getByText(injectedB.name, { exact: true })).toHaveCount(0);

      for (const [actor, ownId, target] of [
        [identities.A, patientA.id, patientB] as const,
        [identities.B, patientB.id, patientA] as const,
      ]) {
        const [ownSelect, crossSelect, crossUpdate, crossDelete] = await withIdentity(
          actor,
          async (tx) => {
            const own = await tx<{ n: number }[]>`
              select count(*)::int as n from patients where id = ${ownId}::uuid
            `;
            const cross = await tx<{ n: number }[]>`
              select count(*)::int as n from patients where id = ${target.id}::uuid
            `;
            const updated = await tx<{ id: string }[]>`
              update patients set nome = nome where id = ${target.id}::uuid returning id
            `;
            const deleted = await tx<{ id: string }[]>`
              delete from patients where id = ${target.id}::uuid returning id
            `;
            return [own[0]?.n ?? -1, cross[0]?.n ?? -1, updated.length, deleted.length];
          },
        );
        expect({ ownSelect, crossSelect, crossUpdate, crossDelete }).toEqual({
          ownSelect: 1,
          crossSelect: 0,
          crossUpdate: 0,
          crossDelete: 0,
        });

        let crossInsertDenied = false;
        try {
          await withIdentity(actor, async (tx) => {
            await tx`
              insert into patients (id, clinic_id, nome, cpf_encrypted, cpf_hash)
              values (
                ${randomUUID()}::uuid,
                ${target.owner === 'A' ? identities.A.clinicId : identities.B.clinicId}::uuid,
                '[E2E-MT] cross insert must fail',
                'synthetic-non-pii',
                ${randomUUID().replaceAll('-', '')}
              )
            `;
          });
        } catch (error) {
          crossInsertDenied = postgresErrorCode(error) === '42501';
        }
        expect(crossInsertDenied).toBe(true);
      }

      console.log(
        `[cross-tenant-patients] ${JSON.stringify({
          directions: ['A-to-B', 'B-to-A'],
          ui: ['search', 'detail', 'update-id-tamper', 'delete-id-tamper', 'clinic-id-injection'],
          rls: ['select', 'insert', 'update', 'delete'],
          result: 'blocked-correctly',
        })}`,
      );
    } finally {
      for (const fixture of fixtures) {
        const cleanupPage = fixture.owner === 'A' ? pageA : pageB;
        if (cleanupPage && !cleanupPage.isClosed()) {
          try {
            await requestLgpdCleanup(cleanupPage, fixture);
          } catch {
            console.warn(`[cross-tenant-patients] UI cleanup fallback for ${fixture.id}`);
          }
        }
      }
      if (fixtures.length > 0) {
        const ids = fixtures.map((fixture) => fixture.id);
        const cleanup = await sql.begin(async (tx) => {
          await tx.unsafe('RESET ROLE');
          const removed = await tx<{ id: string }[]>`
            update patients
               set deleted_at = coalesce(deleted_at, now())
             where id in ${sql(ids)}
               and nome like ${`[E2E-MT-${runId}]%`}
            returning id
          `;
          const remaining = await tx<{ n: number }[]>`
            select count(*)::int as n
              from patients
             where id in ${sql(ids)}
               and nome like ${`[E2E-MT-${runId}]%`}
               and deleted_at is null
          `;
          expect(remaining[0]?.n).toBe(0);
          return { matched: removed.length, active: remaining[0]?.n ?? -1 };
        });
        console.log(`[cross-tenant-patients] cleanup ${JSON.stringify(cleanup)}`);
      }
      await contextA.close();
      await contextB.close();
      await sql.end();
    }
  });
});
