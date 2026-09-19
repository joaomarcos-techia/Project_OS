import { createServerClient as createSsrClient } from '@supabase/ssr';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { readMutationFixture, type MutationFixture } from './mutation-fixture';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_DEV ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PDF_VIEWER_ROUTE = /\/(?:prescricoes|documentos)\/[0-9a-f-]{36}\/pdf(?:\?.*)?$/u;

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

async function emitPrescription(page: Page, marker: string): Promise<string> {
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
  const pathname = new URL(request.url()).pathname;
  expect(pathname).toMatch(/\/prescricoes\/[0-9a-f-]{36}\/pdf$/u);
  return pathname;
}

async function emitMedicalDocument(page: Page, text: string): Promise<string> {
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
  const pathname = new URL(request.url()).pathname;
  expect(pathname).toMatch(/\/documentos\/[0-9a-f-]{36}\/pdf$/u);
  return pathname;
}

test.describe('C2.1 — documentos clínicos fora da consulta', () => {
  // O primeiro run em `next dev` compila as rotas clínicas e os geradores de
  // PDF sob demanda. O limite amplo evita confundir esse warm-up local com
  // falha funcional; cada expectativa sensível mantém seu próprio timeout.
  test.describe.configure({ timeout: 900_000 });

  test('converge /documentos, ficha do paciente e Consultório sem consulta artificial', async ({
    context,
    page,
    request,
  }) => {
    test.skip(
      process.env.E2E_MUTATION !== '1' || !process.env.E2E_USER_EMAIL,
      'Exige E2E_MUTATION=1, localhost e conta DEV descartável para definir o tenant.',
    );

    const fixture = await readMutationFixture();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await context.route(PDF_VIEWER_ROUTE, (route) => route.fulfill({ status: 204 }));
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
    const prescriptionPdfRoute = await emitPrescription(page, fixture.runId);

    // A ficha do paciente abre o mesmo builder sem prontuário ou consulta obrigatórios.
    await page.goto(`/pacientes/${patientId}?novo=documento`);
    const standaloneDocumentPdfRoute = await emitMedicalDocument(
      page,
      `[E2E C2.1] avulso ${fixture.runId}`,
    );

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
    const consultorioDocumentPdfRoute = await emitMedicalDocument(
      page,
      `[E2E C2.1] consultório ${fixture.runId}`,
    );

    await page.goto(`/documentos?q=${encodeURIComponent(fixture.patientName)}`);
    await expect(page.getByText(fixture.patientName, { exact: true })).toHaveCount(3, {
      timeout: 30_000,
    });

    // 2.H: a criação continua abrindo o viewer, mas o browser nunca recebe uma
    // signed URL do Storage. Cada PDF é lido pelo endpoint Qoro autenticado.
    await context.unroute(PDF_VIEWER_ROUTE);
    for (const viewerRoute of [
      prescriptionPdfRoute,
      standaloneDocumentPdfRoute,
      consultorioDocumentPdfRoute,
    ]) {
      const filePath = `${viewerRoute}/arquivo`;
      const fileResponsePromise = page.waitForResponse(
        (response) => new URL(response.url()).pathname === filePath,
      );
      await page.goto(viewerRoute);
      const fileResponse = await fileResponsePromise;
      const frameSrc = await page.locator('iframe').getAttribute('src');

      expect(frameSrc).toBe(filePath);
      expect(new URL(page.url()).origin).toBe(new URL(baseUrl).origin);
      expect(new URL(fileResponse.url()).origin).toBe(new URL(baseUrl).origin);
      expect(page.url()).not.toMatch(/supabase|token=/iu);
      expect(await page.content()).not.toMatch(/supabase|signedUrl|token=/iu);
      expect(fileResponse.status()).toBe(200);
      expect(fileResponse.headers()['content-type']).toContain('application/pdf');
      expect(fileResponse.headers()['cache-control']).toContain('no-store');
      expect(fileResponse.headers()['cross-origin-resource-policy']).toBe('same-origin');
      expect(fileResponse.headers()['content-disposition']).toContain('inline');

      // O visualizador nativo do Chromium pode descartar o corpo da resposta
      // do iframe depois de carregá-lo. O request context compartilha os
      // cookies autenticados do browser e permite validar os bytes sem uma
      // signed URL ou acesso direto ao Storage.
      const bodyResponse = await context.request.get(`${baseUrl}${filePath}`);
      expect(bodyResponse.status()).toBe(200);
      expect(bodyResponse.headers()['content-type']).toContain('application/pdf');
      expect((await bodyResponse.body()).subarray(0, 4).toString('ascii')).toBe('%PDF');
      await bodyResponse.dispose();
    }

    const firstFilePath = `${prescriptionPdfRoute}/arquivo`;
    const downloadResponse = await context.request.get(`${baseUrl}${firstFilePath}?download=1`);
    expect(downloadResponse.status()).toBe(200);
    expect(downloadResponse.headers()['content-disposition']).toContain('attachment');
    expect((await downloadResponse.body()).subarray(0, 4).toString('ascii')).toBe('%PDF');
    await downloadResponse.dispose();

    const anonymousResponse = await request.get(`${baseUrl}${firstFilePath}`, {
      maxRedirects: 0,
    });
    expect(anonymousResponse.status()).toBe(307);
    expect(anonymousResponse.headers()['content-type'] ?? '').not.toContain('application/pdf');
    const anonymousLocation = anonymousResponse.headers().location;
    if (!anonymousLocation) throw new Error('Resposta anônima não redirecionou para o login.');
    expect(new URL(anonymousLocation, baseUrl).pathname).toBe('/login');
    await anonymousResponse.dispose();
    expect(pageErrors).toEqual([]);
  });
});
