import { createServerClient as createSsrClient } from '@supabase/ssr';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { readMutationFixture, type MutationFixture } from './mutation-fixture';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_DEV ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function authenticateSyntheticDoctor(
  context: BrowserContext,
  fixture: MutationFixture,
): Promise<void> {
  if (!fixture.doctorPassword || !supabaseUrl || !supabaseKey) {
    throw new Error('Fixture clínica ou configuração pública do Supabase incompleta.');
  }

  let cookies: Array<{ name: string; value: string }> = [];
  const client = createSsrClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => [],
      setAll: (items) => {
        cookies = items.map(({ name, value }) => ({ name, value }));
      },
    },
    auth: { autoRefreshToken: false, persistSession: true },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: fixture.doctorEmail,
    password: fixture.doctorPassword,
  });
  if (error || !data.session || cookies.length === 0) {
    throw new Error(error?.message ?? 'Login do profissional sintético não produziu sessão.');
  }
  await context.addCookies(
    cookies
      .filter(({ value }) => value !== '')
      .map(({ name, value }) => ({ name, value, url: baseUrl })),
  );
}

async function createPatient(page: Page, fixture: MutationFixture): Promise<string> {
  await page.goto('/pacientes?novo=1');
  const drawer = page.getByRole('dialog', { name: 'Novo paciente' });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel('Nome', { exact: true }).fill(fixture.patientName);
  await drawer.getByLabel('CPF', { exact: true }).fill(fixture.patientCpf);
  await drawer.getByLabel('E-mail', { exact: true }).fill(fixture.patientEmail);
  await drawer.getByRole('button', { name: 'Criar paciente' }).click();
  await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/u, { timeout: 90_000 });
  const patientId = new URL(page.url()).pathname.split('/').at(-1);
  if (!patientId) throw new Error('A criação não retornou o id do paciente sintético.');
  return patientId;
}

async function selectPatientInDocumentLauncher(
  page: Page,
  fixture: MutationFixture,
): Promise<Locator> {
  await page.goto('/documentos');
  await page.getByRole('button', { name: 'Novo documento', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Novo documento clínico' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('combobox', { name: 'Buscar paciente' }).fill(fixture.patientName);
  await drawer.getByRole('option', { name: fixture.patientName }).click();
  return drawer;
}

async function emitPrescription(page: Page, marker: string): Promise<void> {
  const drawer = page.getByRole('dialog', { name: 'Emitir prescrição' });
  await expect(drawer).toBeVisible({ timeout: 90_000 });
  await drawer.getByLabel('Medicamento 1', { exact: true }).fill(`Medicamento sintético ${marker}`);
  await drawer.getByLabel('Dosagem 1', { exact: true }).fill('1 unidade');
  await drawer.getByLabel('Posologia 1', { exact: true }).fill('uso conforme orientação');
  const [request] = await Promise.all([
    page.context().waitForEvent('request', {
      predicate: (candidate) =>
        /\/prescricoes\/[0-9a-f-]{36}\/pdf$/u.test(new URL(candidate.url()).pathname),
    }),
    drawer.getByRole('button', { name: 'Emitir prescrição (PDF)' }).click(),
  ]);
  expect(new URL(request.url()).pathname).toMatch(/\/prescricoes\/[0-9a-f-]{36}\/pdf$/u);
}

async function emitMedicalDocument(page: Page, text: string): Promise<void> {
  const drawer = page.getByRole('dialog', { name: 'Emitir documento' });
  await expect(drawer).toBeVisible({ timeout: 90_000 });
  await drawer.getByLabel('Descrição').fill(text);
  const [request] = await Promise.all([
    page.context().waitForEvent('request', {
      predicate: (candidate) =>
        /\/documentos\/[0-9a-f-]{36}\/pdf$/u.test(new URL(candidate.url()).pathname),
    }),
    drawer.getByRole('button', { name: 'Emitir documento (PDF)' }).click(),
  ]);
  expect(new URL(request.url()).pathname).toMatch(/\/documentos\/[0-9a-f-]{36}\/pdf$/u);
}

test.describe('C2.1 — documentos clínicos fora da consulta', () => {
  // O primeiro run em `next dev` compila as rotas clínicas e os geradores de
  // PDF sob demanda. O limite amplo evita confundir esse warm-up local com
  // falha funcional; cada expectativa sensível mantém seu próprio timeout.
  test.describe.configure({ timeout: 900_000 });

  test('converge /documentos, ficha do paciente e Consultório sem consulta artificial', async ({
    context,
    page,
  }) => {
    test.skip(
      process.env.E2E_MUTATION !== '1' || !process.env.E2E_USER_EMAIL,
      'Exige E2E_MUTATION=1, localhost e conta DEV descartável para definir o tenant.',
    );

    const fixture = await readMutationFixture();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await context.route(/\/(?:prescricoes|documentos)\/[0-9a-f-]{36}\/pdf(?:\?.*)?$/u, (route) =>
      route.fulfill({ status: 204 }),
    );
    await authenticateSyntheticDoctor(context, fixture);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 30_000 });

    const patientId = await createPatient(page, fixture);

    // Entrada central: cria prontuário longitudinal sem fabricar appointment_id.
    const recordLauncher = await selectPatientInDocumentLauncher(page, fixture);
    const recordUrl = new RegExp(`/pacientes/${patientId}\\?tab=prontuarios$`, 'u');
    await Promise.all([
      page.waitForURL(recordUrl, { timeout: 90_000 }),
      recordLauncher.getByRole('link', { name: /Prontuário/u }).click(),
    ]);
    await page.getByRole('button', { name: 'Novo prontuário', exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/pacientes/${patientId}/prontuarios/[0-9a-f-]{36}(?:\\?|$)`, 'u'),
      { timeout: 90_000 },
    );

    // Mesmo launcher resolve o paciente no send-time da action e abre o builder tipado.
    const prescriptionLauncher = await selectPatientInDocumentLauncher(page, fixture);
    const prescriptionUrl = new RegExp(`/pacientes/${patientId}\\?novo=prescricao$`, 'u');
    await Promise.all([
      page.waitForURL(prescriptionUrl, { timeout: 90_000 }),
      prescriptionLauncher.getByRole('link', { name: /Prescrição/u }).click(),
    ]);
    await emitPrescription(page, fixture.runId);

    // A ficha do paciente abre o mesmo builder sem prontuário ou consulta obrigatórios.
    await page.goto(`/pacientes/${patientId}?novo=documento`);
    await emitMedicalDocument(page, `[E2E C2.1] avulso ${fixture.runId}`);

    // Regressão do caminho original: atendimento real cria seu próprio vínculo e usa o mesmo drawer.
    await page.goto('/agenda');
    await page.getByRole('button', { name: 'Novo atendimento', exact: true }).click();
    const appointmentDrawer = page.getByRole('dialog', { name: 'Novo atendimento' });
    await appointmentDrawer.getByRole('radio', { name: 'Encaixe (agora)' }).click();
    await appointmentDrawer
      .getByPlaceholder('Buscar por nome (mín. 2 letras)')
      .fill(fixture.patientName);
    await appointmentDrawer.getByRole('option', { name: fixture.patientName }).click();
    await appointmentDrawer.getByLabel('Procedimento', { exact: true }).selectOption({
      label: fixture.procedureName,
    });
    await appointmentDrawer.getByRole('button', { name: 'Criar encaixe', exact: true }).click();
    await expect(page.getByText('Encaixe criado', { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await page.goto('/consultorio');
    const waitingCard = page
      .getByText(fixture.patientName, { exact: true })
      .locator('xpath=ancestor::div[.//button[normalize-space()="Chamar"]][1]');
    await expect(waitingCard).toBeVisible({ timeout: 30_000 });
    await waitingCard.getByRole('button', { name: 'Chamar', exact: true }).click();
    await expect(page.getByRole('heading', { name: fixture.patientName, exact: true })).toBeVisible(
      {
        timeout: 120_000,
      },
    );
    await page.getByRole('button', { name: 'Documento', exact: true }).click();
    await emitMedicalDocument(page, `[E2E C2.1] consultório ${fixture.runId}`);

    await page.goto(`/documentos?q=${encodeURIComponent(fixture.patientName)}`);
    await expect(page.getByText(fixture.patientName, { exact: true })).toHaveCount(3, {
      timeout: 30_000,
    });
    expect(pageErrors).toEqual([]);
  });
});
