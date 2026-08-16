import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_CLINICAL_IDOR === 'ALLOW_READ_ONLY';
const baseUrl = process.env.E2E_BASE_URL;
const emailA = process.env.E2E_TENANT_A_EMAIL;
const emailB = process.env.E2E_TENANT_B_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

type Identity = { clinicId: string; email: string };
type PdfSample = { id: string; patient_name: string };
type ProntuarioSample = { id: string; patient_id: string };

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'off',
  video: 'off',
  screenshot: 'off',
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
): Promise<Page> {
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
  const page = await context.newPage();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 30_000 });
  return page;
}

async function assertNotFound(page: Page, route: string): Promise<void> {
  const response = await page.goto(route);
  expect([200, 404]).toContain(response?.status());
  await expect(page.getByText('Página não encontrada', { exact: true })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
}

test.describe('produção: IDOR clínico A↔B', () => {
  test.describe.configure({ retries: 0 });

  test('bloqueia prontuário, PDFs e conversa por ID estrangeiro', async ({ browser }) => {
    test.setTimeout(420_000);
    test.skip(
      !authorized,
      'Exige E2E_PRODUCTION_CLINICAL_IDOR=ALLOW_READ_ONLY para consultar fixtures de PROD.',
    );
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste IDOR só pode apontar para app.qoro.dev.');
    }
    if (!emailA || !emailB || !sharedPassword || emailA === emailB) {
      throw new Error('Credenciais distintas dos tenants A/B são obrigatórias.');
    }
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });
    const contextA = await browser.newContext({ baseURL: baseUrl });
    const contextB = await browser.newContext({ baseURL: baseUrl });

    try {
      const identities = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const rows = await tx<{ email: string; clinic_id: string }[]>`
          select lower(u.email) as email, p.clinic_id::text
            from auth.users u
            join profiles p on p.id = u.id
           where lower(u.email) in (${emailA.toLowerCase()}, ${emailB.toLowerCase()})
             and p.role = 'owner'
             and p.ativo = true
             and p.deleted_at is null
        `;
        const a = rows.find((row) => row.email === emailA.toLowerCase());
        const b = rows.find((row) => row.email === emailB.toLowerCase());
        if (!a || !b || a.clinic_id === b.clinic_id) throw new Error('Tenants A/B inválidos.');
        return {
          A: { email: a.email, clinicId: a.clinic_id } satisfies Identity,
          B: { email: b.email, clinicId: b.clinic_id } satisfies Identity,
        };
      });

      const samples = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const loadPdf = async (
          table: 'medical_documents' | 'prescriptions',
          clinicId: string,
        ): Promise<PdfSample | undefined> => {
          const rows = await tx.unsafe<PdfSample[]>(
            `select id::text, snapshot_patient_nome as patient_name
               from ${table}
              where clinic_id = $1::uuid and pdf_storage_path is not null
              order by created_at desc limit 1`,
            [clinicId],
          );
          return rows[0];
        };
        const loadProntuario = async (clinicId: string): Promise<ProntuarioSample | undefined> => {
          const rows = await tx<ProntuarioSample[]>`
            select id::text, patient_id::text
              from prontuarios
             where clinic_id = ${clinicId}::uuid
             order by updated_at desc
             limit 1
          `;
          return rows[0];
        };
        const [prescriptionA, prescriptionB, documentA, documentB, prontuarioA, prontuarioB] =
          await Promise.all([
            loadPdf('prescriptions', identities.A.clinicId),
            loadPdf('prescriptions', identities.B.clinicId),
            loadPdf('medical_documents', identities.A.clinicId),
            loadPdf('medical_documents', identities.B.clinicId),
            loadProntuario(identities.A.clinicId),
            loadProntuario(identities.B.clinicId),
          ]);
        const [conversationA] = await tx<{ id: string }[]>`
          select id::text
            from ai_conversations
           where clinic_id = ${identities.A.clinicId}::uuid
           order by updated_at desc
           limit 1
        `;
        if (
          !prescriptionA ||
          !prescriptionB ||
          !documentA ||
          !documentB ||
          !prontuarioA ||
          !prontuarioB ||
          !conversationA
        ) {
          throw new Error('Fixtures clínicas A/B insuficientes para o teste read-only.');
        }
        return {
          prescriptionA,
          prescriptionB,
          documentA,
          documentB,
          prontuarioA,
          prontuarioB,
          conversationA,
        };
      });

      const pageA = await signInContext(contextA, emailA, sharedPassword);
      const pageB = await signInContext(contextB, emailB, sharedPassword);

      for (const [ownerPage, own, cross, prefix] of [
        [pageA, samples.prescriptionA, samples.prescriptionB, '/prescricoes'] as const,
        [pageB, samples.prescriptionB, samples.prescriptionA, '/prescricoes'] as const,
        [pageA, samples.documentA, samples.documentB, '/documentos'] as const,
        [pageB, samples.documentB, samples.documentA, '/documentos'] as const,
      ]) {
        await ownerPage.goto(`${prefix}/${own.id}/pdf`);
        await expect(
          ownerPage.getByRole('heading').filter({ hasText: own.patient_name }),
        ).toBeVisible();
        await expect(ownerPage.locator('iframe')).toHaveCount(1);
        await assertNotFound(ownerPage, `${prefix}/${cross.id}/pdf`);
        await expect(ownerPage.getByText(cross.patient_name, { exact: true })).toHaveCount(0);
      }

      for (const [ownerPage, own, cross] of [
        [pageA, samples.prontuarioA, samples.prontuarioB] as const,
        [pageB, samples.prontuarioB, samples.prontuarioA] as const,
      ]) {
        await ownerPage.goto(`/pacientes/${own.patient_id}/prontuarios/${own.id}`);
        await expect(ownerPage.getByRole('heading', { name: /Prontuário/u })).toBeVisible();
        await assertNotFound(ownerPage, `/pacientes/${cross.patient_id}/prontuarios/${cross.id}`);
      }

      await pageA.goto(`/conversas/${samples.conversationA.id}`);
      await expect(pageA.getByText('Histórico', { exact: true })).toBeVisible();
      await assertNotFound(pageB, `/conversas/${samples.conversationA.id}`);

      console.log(
        `[cross-tenant-clinical-idor] ${JSON.stringify({
          directions: ['A-to-B', 'B-to-A'],
          resources: ['prescription-pdf', 'medical-document-pdf', 'prontuario', 'conversation'],
          ownControls: 7,
          crossTenantAttempts: 7,
          result: 'blocked-correctly',
        })}`,
      );
    } finally {
      await contextA.close();
      await contextB.close();
      await sql.end();
    }
  });
});
