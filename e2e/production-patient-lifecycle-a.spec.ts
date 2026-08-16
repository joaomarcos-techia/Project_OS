import { randomUUID } from 'node:crypto';

import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_PATIENT_LIFECYCLE === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const attendantEmail = process.env.E2E_ATTENDANT_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

type CapturedAction = {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
};

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'retain-on-failure',
  video: 'on',
  screenshot: 'only-on-failure',
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

function productionConfig(): { url: string; key: string; databaseUrl: string } {
  const databaseUrl = process.env.DATABASE_URL_PROD;
  const adminSecret = process.env.SUPABASE_SECRET_KEY_PROD;
  if (!databaseUrl || !adminSecret) throw new Error('Credenciais operacionais PROD ausentes.');
  const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  if (!projectRef || !/^[a-z]{20}$/u.test(projectRef)) {
    throw new Error('Project ref de producao invalido.');
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
    throw new Error(error?.message ?? 'Login nao produziu sessao.');
  }
  await context.addCookies(
    nextCookies
      .filter(({ value }) => value !== '')
      .map(({ name, value }) => ({ name, value, url: baseUrl })),
  );
}

function validCpf(seed: string): string {
  const digits = Array.from(seed.replace(/\D/gu, '').padStart(9, '6').slice(-9), Number);
  const digit = (values: number[], weight: number) => {
    const rest =
      (values.reduce((sum, value, index) => sum + value * (weight - index), 0) * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const first = digit(digits, 10);
  return [...digits, first, digit([...digits, first], 11)].join('');
}

function clinicDate(daysAhead = 0): string {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + daysAhead);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function isServerAction(request: Request): boolean {
  return request.method() === 'POST' && Boolean(request.headers()['next-action']);
}

function capturedAction(request: Request): CapturedAction {
  const body = request.postDataBuffer();
  if (!body) throw new Error('Server Action sem corpo capturavel.');
  const sourceHeaders = request.headers();
  const allowedHeaders = [
    'accept',
    'content-type',
    'next-action',
    'next-router-state-tree',
    'next-url',
    'origin',
    'referer',
  ];
  return {
    url: request.url(),
    headers: Object.fromEntries(
      allowedHeaders.flatMap((header) =>
        sourceHeaders[header] ? [[header, sourceHeaders[header]]] : [],
      ),
    ),
    body,
  };
}

function idempotencyDbKey(action: string, clientKey: string): string {
  return `patient:${action}:${clientKey.replaceAll('-', '').toLowerCase()}`;
}

async function createPatient(
  page: Page,
  input: {
    name: string;
    cpf: string;
    email: string;
    phone: string;
    address?: {
      street: string;
      complement: string;
      city: string;
      state: string;
      zip: string;
    };
  },
): Promise<{ id: string; clientKey: string }> {
  await page.goto('/pacientes?novo=1');
  const drawer = page.getByRole('dialog', { name: 'Novo paciente' });
  await expect(drawer).toBeVisible();
  await drawer.locator('input[name="nome"]').fill(input.name);
  await drawer.locator('input[name="cpf"]').fill(input.cpf);
  await drawer.locator('input[name="email"]').fill(input.email);
  await drawer.locator('input[name="telefone"]').fill(input.phone);
  if (input.address) {
    await drawer.locator('input[name="endLogradouro"]').fill(input.address.street);
    await drawer.locator('input[name="endComplemento"]').fill(input.address.complement);
    await drawer.locator('input[name="endCidade"]').fill(input.address.city);
    await drawer.locator('input[name="endEstado"]').fill(input.address.state);
    await drawer.locator('input[name="endCep"]').fill(input.address.zip);
  }
  const clientKey = await drawer.locator('input[name="idempotencyKey"]').inputValue();
  expect(clientKey).toMatch(/^[0-9a-f-]{36}$/iu);
  await drawer.getByRole('button', { name: 'Criar paciente' }).click();
  await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/u, { timeout: 90_000 });
  const id = new URL(page.url()).pathname.split('/').at(-1);
  if (!id || !/^[0-9a-f-]{36}$/iu.test(id)) throw new Error('Paciente sintetico sem ID.');
  return { id, clientKey };
}

async function requestSubmitAndRead(page: Page, form: ReturnType<Page['locator']>) {
  const valid = await form.evaluate((element) => (element as HTMLFormElement).checkValidity());
  if (!valid) throw new Error('Formulario de teste ficou invalido antes da Server Action.');
  const responsePromise = page.waitForResponse((response) => isServerAction(response.request()));
  await form.evaluate((element) => (element as HTMLFormElement).requestSubmit());
  const response = await responsePromise;
  return { status: response.status() };
}

test.describe('producao: lifecycle reversivel de pacientes na Clinica A', () => {
  test.describe.configure({ retries: 0 });

  test('valida entradas, busca, vinculo, concorrencia, obito, delete e ausencia de recovery', async ({
    browser,
  }) => {
    test.setTimeout(600_000);
    test.skip(!authorized, 'Exige E2E_PRODUCTION_PATIENT_LIFECYCLE=ALLOW_SYNTHETIC_CLINIC_A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de pacientes so pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !attendantEmail || !sharedPassword) {
      throw new Error('Credenciais da Clinica A ausentes.');
    }

    const { databaseUrl } = productionConfig();
    const sql = postgres(databaseUrl, { max: 3, ssl: 'require', prepare: false });
    const ownerContext = await browser.newContext({ baseURL: baseUrl });
    const attendantContext = await browser.newContext({ baseURL: baseUrl });
    const ownerPage = await ownerContext.newPage();
    const attendantPage = await attendantContext.newPage();
    const startedAt = new Date().toISOString();
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-PAT-A-${runId}]`;
    const subjectName = `${marker} João 🩺 <img src=x onerror=globalThis.__pentestXss=1>`;
    const responsibleName = `${marker} RESPONSAVEL`;
    const deleteName = `${marker} DELETE-RACE`;
    const invalidEmail = `e2e-pat-invalid-${runId}@example.test`;
    const subjectEmail = `e2e-pat-subject-${runId}@example.test`;
    const responsibleEmail = `e2e-pat-responsible-${runId}@example.test`;
    const deleteEmail = `e2e-pat-delete-${runId}@example.test`;
    const patientIds: string[] = [];
    const idempotencyKeys = new Set<string>();
    let clinicId: string | undefined;
    let subjectId: string | undefined;
    let responsibleId: string | undefined;
    let deleteId: string | undefined;
    let relationshipId: string | undefined;
    let finalConcurrentName: string | undefined;
    let malformedIdStatus = -1;
    let unknownIdStatus = -1;
    let deletedRouteStatus = -1;
    let malformedIdVisibleChars = -1;
    let unknownIdVisibleChars = -1;
    let deletedRouteVisibleChars = -1;
    let recoverySurfaceExposed = false;

    try {
      const identities = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; clinic_id: string; email: string; role: string }[]>`
          select p.id::text, p.clinic_id::text, lower(u.email) as email, p.role::text
            from auth.users u
            join profiles p on p.id = u.id
           where lower(u.email) in (${ownerEmail.toLowerCase()}, ${attendantEmail.toLowerCase()})
             and p.ativo = true
             and p.deleted_at is null
        `;
      });
      const owner = identities.find((row) => row.email === ownerEmail.toLowerCase());
      const attendant = identities.find((row) => row.email === attendantEmail.toLowerCase());
      if (!owner || !attendant || owner.clinic_id !== attendant.clinic_id) {
        throw new Error('Owner e atendente nao pertencem a mesma Clinica A.');
      }
      expect(owner.role).toBe('owner');
      expect(attendant.role).toBe('attendant');
      clinicId = owner.clinic_id;

      await Promise.all([
        signInContext(ownerContext, ownerEmail, sharedPassword),
        signInContext(attendantContext, attendantEmail, sharedPassword),
      ]);

      // Backend validation: remove only the browser maxLength and submit 121 chars.
      await ownerPage.goto('/pacientes?novo=1');
      const invalidDrawer = ownerPage.getByRole('dialog', { name: 'Novo paciente' });
      const invalidName = invalidDrawer.locator('input[name="nome"]');
      await invalidName.evaluate((element) => element.removeAttribute('maxlength'));
      await invalidName.fill('X'.repeat(121));
      await invalidDrawer.locator('input[name="cpf"]').fill(validCpf(`${runId}91`));
      await invalidDrawer.locator('input[name="email"]').fill(invalidEmail);
      const invalidForm = invalidName.locator('xpath=ancestor::form[1]');
      const invalidCreate = await requestSubmitAndRead(ownerPage, invalidForm);
      expect(invalidCreate.status).toBeLessThan(500);
      await expect(invalidDrawer.getByRole('alert')).toBeVisible();
      const [invalidPersisted] = await sql<{ n: number }[]>`
        select count(*)::int as n from patients where clinic_id = ${clinicId}::uuid and email = ${invalidEmail}
      `;
      expect(invalidPersisted?.n).toBe(0);

      const responsible = await createPatient(ownerPage, {
        name: responsibleName,
        cpf: validCpf(`${runId}11`),
        email: responsibleEmail,
        phone: `11955${runId.slice(-6)}`,
      });
      responsibleId = responsible.id;
      patientIds.push(responsible.id);
      idempotencyKeys.add(idempotencyDbKey('create', responsible.clientKey));

      const subject = await createPatient(ownerPage, {
        name: subjectName,
        cpf: validCpf(`${runId}22`),
        email: subjectEmail,
        phone: `11956${runId.slice(-6)}`,
        address: {
          street: 'Rua Unicode Omega, 42',
          complement: `<b>apto</b> ' OR 1=1 -- {"x":true} 😀`,
          city: 'Sao Paulo',
          state: 'sp',
          zip: '01000-000',
        },
      });
      subjectId = subject.id;
      patientIds.push(subject.id);
      idempotencyKeys.add(idempotencyDbKey('create', subject.clientKey));

      const deletionFixture = await createPatient(ownerPage, {
        name: deleteName,
        cpf: validCpf(`${runId}33`),
        email: deleteEmail,
        phone: `11957${runId.slice(-6)}`,
      });
      deleteId = deletionFixture.id;
      patientIds.push(deletionFixture.id);
      idempotencyKeys.add(idempotencyDbKey('create', deletionFixture.clientKey));

      // Search is parameterized, Unicode-safe and React must render the HTML-like name as text.
      await ownerPage.goto(`/pacientes?q=${encodeURIComponent('João 🩺')}`);
      const subjectLink = ownerPage
        .locator(`a[href="/pacientes/${subjectId}"]`)
        .filter({ hasText: subjectName });
      await expect(subjectLink).toHaveText(subjectName);
      expect(await ownerPage.locator('img[src="x"]').count()).toBe(0);
      expect(
        await ownerPage.evaluate(
          () => (globalThis as typeof globalThis & { __pentestXss?: number }).__pentestXss ?? null,
        ),
      ).toBeNull();
      await ownerPage.goto(
        `/pacientes?q=${encodeURIComponent(`%' OR 1=1 -- {"unexpected":true}`)}`,
      );
      expect((await ownerPage.goto(ownerPage.url()))?.status()).toBeLessThan(500);
      await expect(ownerPage.locator(`a[href="/pacientes/${subjectId}"]`)).toHaveCount(0);

      const malformedId = await ownerPage.goto('/pacientes/not-a-uuid');
      malformedIdStatus = malformedId?.status() ?? -1;
      expect(malformedIdStatus).toBeLessThan(500);
      malformedIdVisibleChars = (await ownerPage.locator('body').innerText()).trim().length;
      const unknownId = await ownerPage.goto(`/pacientes/${randomUUID()}`);
      unknownIdStatus = unknownId?.status() ?? -1;
      expect(unknownIdStatus).toBeLessThan(500);
      unknownIdVisibleChars = (await ownerPage.locator('body').innerText()).trim().length;

      // Self-link via tampered hidden field must fail server-side without a row.
      await ownerPage.goto(`/pacientes/${subjectId}`);
      const linkButton = ownerPage.getByRole('button', { name: /Adicionar v.nculo/u });
      const linkForm = linkButton.locator('xpath=ancestor::form[1]');
      await linkForm.locator('input[name="responsiblePatientId"]').evaluate((element, id) => {
        (element as HTMLInputElement).value = id;
      }, subjectId);
      const invalidSelfLink = await requestSubmitAndRead(ownerPage, linkForm);
      expect(invalidSelfLink.status).toBeLessThan(500);
      await expect(linkForm.getByRole('alert')).toBeVisible();
      const [selfLinks] = await sql<{ n: number }[]>`
        select count(*)::int as n from patient_relationships
         where clinic_id = ${clinicId}::uuid
           and responsible_patient_id = ${subjectId}::uuid
           and dependent_patient_id = ${subjectId}::uuid
      `;
      expect(selfLinks?.n).toBe(0);

      // Real relationship + concurrent exact replay should produce exactly one mutation.
      await ownerPage.reload();
      const relationshipSearch = ownerPage.getByPlaceholder(/Buscar paciente por nome/u);
      await relationshipSearch.fill(responsibleName);
      await ownerPage.getByRole('option', { name: responsibleName, exact: true }).click();
      const liveLinkButton = ownerPage.getByRole('button', { name: /Adicionar v.nculo/u });
      const liveLinkForm = liveLinkButton.locator('xpath=ancestor::form[1]');
      const linkClientKey = await liveLinkForm.locator('input[name="idempotencyKey"]').inputValue();
      idempotencyKeys.add(idempotencyDbKey('relationship_link', linkClientKey));
      const linkRequestPromise = ownerPage.waitForRequest(isServerAction);
      const linkSubmitPromise = liveLinkButton.click();
      const linkAction = capturedAction(await linkRequestPromise);
      const linkReplayResponses = await Promise.all(
        Array.from({ length: 3 }, () =>
          ownerContext.request.fetch(linkAction.url, {
            method: 'POST',
            headers: linkAction.headers,
            data: linkAction.body,
            failOnStatusCode: false,
          }),
        ),
      );
      await linkSubmitPromise;
      for (const response of linkReplayResponses) {
        expect(response.status()).toBeLessThan(500);
        await response.dispose();
      }
      await expect(ownerPage).toHaveURL(new RegExp(`/pacientes/${subjectId}(?:\\?|$)`, 'u'));

      const [linkedEvidence] = await sql<
        { id: string; rows: number; audit: number; outbox: number; idem: number }[]
      >`
        select
          r.id::text as id,
          1::int as rows,
          (select count(*)::int from audit_events a
            where a.clinic_id = ${clinicId}::uuid and a.action = 'patient.relationship.linked'
              and a.resource_id = ${subjectId} and a.created_at >= ${startedAt}::timestamptz) audit,
          (select count(*)::int from outbox o
            where o.clinic_id = ${clinicId}::uuid and o.event_type = 'patient.relationship.linked'
              and o.payload ->> 'dependentPatientId' = ${subjectId}
              and o.created_at >= ${startedAt}::timestamptz) outbox,
          (select count(*)::int from idempotency_keys i
            where i.clinic_id = ${clinicId}::uuid
              and i.key = ${idempotencyDbKey('relationship_link', linkClientKey)}) idem
        from patient_relationships r
       where r.clinic_id = ${clinicId}::uuid
         and r.responsible_patient_id = ${responsibleId}::uuid
         and r.dependent_patient_id = ${subjectId}::uuid
      `;
      expect(linkedEvidence).toMatchObject({ rows: 1, audit: 1, outbox: 1, idem: 1 });
      relationshipId = linkedEvidence?.id;
      if (!relationshipId) throw new Error('Vinculo valido sem ID.');

      const removeButton = ownerPage.getByRole('button', { name: 'Remover', exact: true });
      const removeForm = removeButton.locator('xpath=ancestor::form[1]');
      const unlinkClientKey = await removeForm.locator('input[name="idempotencyKey"]').inputValue();
      idempotencyKeys.add(idempotencyDbKey('relationship_unlink', unlinkClientKey));
      const unlinkResponsePromise = ownerPage.waitForResponse((response) =>
        isServerAction(response.request()),
      );
      await removeButton.click();
      expect((await unlinkResponsePromise).status()).toBeLessThan(500);
      await expect
        .poll(async () => {
          const [remainingRelationship] = await sql<{ n: number }[]>`
            select count(*)::int as n from patient_relationships where id = ${relationshipId!}::uuid
          `;
          return remainingRelationship?.n;
        })
        .toBe(0);

      // Merge invalid branches are reversible; valid merge is deliberately not executed.
      const mergeButton = ownerPage.getByRole('button', { name: 'Mesclar cadastro' });
      const mergeForm = mergeButton.locator('xpath=ancestor::form[1]');
      await mergeForm.locator('textarea[name="reason"]').fill('Teste controlado de merge invalido');
      await mergeForm.locator('input[name="targetPatientId"]').evaluate((element, id) => {
        (element as HTMLInputElement).value = id;
      }, subjectId);
      const selfMerge = await requestSubmitAndRead(ownerPage, mergeForm);
      expect(selfMerge.status).toBeLessThan(500);
      await expect(mergeForm.getByRole('alert')).toContainText('diferentes');

      await mergeForm.locator('input[name="targetPatientId"]').evaluate((element, id) => {
        (element as HTMLInputElement).value = id;
      }, randomUUID());
      await mergeForm
        .locator('textarea[name="reason"]')
        .fill('Teste controlado com destino ausente');
      const unknownMerge = await requestSubmitAndRead(ownerPage, mergeForm);
      expect(unknownMerge.status).toBeLessThan(500);
      await expect(mergeForm.getByRole('alert')).toBeVisible();
      const [mergeRows] = await sql<{ n: number }[]>`
        select count(*)::int as n from patient_merges
         where clinic_id = ${clinicId}::uuid and source_patient_id = ${subjectId}::uuid
      `;
      expect(mergeRows?.n).toBe(0);

      // LGPD-005 — o hub do paciente ganhou o cartao de consentimento no ciclo
      // anterior. Este spec procurava o texto "conceder consentimento", que
      // nunca existiu: os controles se chamam Conceder/Revogar.
      const consentControls =
        (await ownerPage.getByRole('button', { name: /^(Conceder|Revogar)$/u }).count()) > 0;
      expect(consentControls).toBe(true);

      // Two users start from the same patient state. A held row lock makes both writes overlap.
      await Promise.all([
        ownerPage.goto(`/pacientes/${subjectId}`),
        attendantPage.goto(`/pacientes/${subjectId}`),
      ]);
      const ownerEditName = `${marker} EDIT-A`;
      const attendantEditName = `${marker} EDIT-B`;
      await ownerPage.locator('input[name="nome"]').fill(ownerEditName);
      await attendantPage.locator('input[name="nome"]').fill(attendantEditName);
      const ownerEditForm = ownerPage
        .locator('input[name="nome"]')
        .locator('xpath=ancestor::form[1]');
      const attendantEditForm = attendantPage
        .locator('input[name="nome"]')
        .locator('xpath=ancestor::form[1]');
      const ownerUpdateKey = await ownerEditForm
        .locator('input[name="idempotencyKey"]')
        .inputValue();
      const attendantUpdateKey = await attendantEditForm
        .locator('input[name="idempotencyKey"]')
        .inputValue();
      idempotencyKeys.add(idempotencyDbKey('update', ownerUpdateKey));
      idempotencyKeys.add(idempotencyDbKey('update', attendantUpdateKey));

      let releaseUpdateLock!: () => void;
      let announceUpdateLock!: () => void;
      const updateLockReleased = new Promise<void>((resolve) => {
        releaseUpdateLock = resolve;
      });
      const updateLockReady = new Promise<void>((resolve) => {
        announceUpdateLock = resolve;
      });
      const updateLockTask = sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        await tx`select id from patients where id = ${subjectId!}::uuid for update`;
        announceUpdateLock();
        await updateLockReleased;
      });
      await updateLockReady;
      const ownerUpdateRequest = ownerPage.waitForRequest(isServerAction);
      const attendantUpdateRequest = attendantPage.waitForRequest(isServerAction);
      const ownerUpdateResponse = ownerPage.waitForResponse((response) =>
        isServerAction(response.request()),
      );
      const attendantUpdateResponse = attendantPage.waitForResponse((response) =>
        isServerAction(response.request()),
      );
      const ownerUpdateClick = ownerEditForm
        .getByRole('button', { name: /Salvar altera..es/u })
        .click();
      const attendantUpdateClick = attendantEditForm
        .getByRole('button', { name: /Salvar altera..es/u })
        .click();
      await Promise.all([ownerUpdateRequest, attendantUpdateRequest]);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      releaseUpdateLock();
      await updateLockTask;
      const [ownerUpdateHttp, attendantUpdateHttp] = await Promise.all([
        ownerUpdateResponse,
        attendantUpdateResponse,
      ]);
      expect(ownerUpdateHttp.status()).toBeLessThan(500);
      expect(attendantUpdateHttp.status()).toBeLessThan(500);
      await Promise.all([ownerUpdateClick, attendantUpdateClick]);

      const [updateEvidence] = await sql<
        {
          name: string;
          audits: number;
          actors: number;
          outbox: number;
          idempotency: number;
        }[]
      >`
        select p.nome as name,
          (select count(*)::int from audit_events a
            where a.clinic_id = ${clinicId}::uuid and a.action = 'patient.core.updated'
              and a.resource_id = ${subjectId} and a.created_at >= ${startedAt}::timestamptz) audits,
          (select count(distinct a.user_id)::int from audit_events a
            where a.clinic_id = ${clinicId}::uuid and a.action = 'patient.core.updated'
              and a.resource_id = ${subjectId} and a.created_at >= ${startedAt}::timestamptz) actors,
          (select count(*)::int from outbox o
            where o.clinic_id = ${clinicId}::uuid and o.event_type = 'patient.core.updated'
              and o.payload ->> 'patientId' = ${subjectId}
              and o.created_at >= ${startedAt}::timestamptz) outbox,
          (select count(*)::int from idempotency_keys i
            where i.clinic_id = ${clinicId}::uuid
              and i.key = any(${[
                idempotencyDbKey('update', ownerUpdateKey),
                idempotencyDbKey('update', attendantUpdateKey),
              ]}::text[])) idempotency
        from patients p where p.id = ${subjectId}::uuid
      `;
      // DATA-002 — este spec reproduzia o lost update e afirmava DUAS escritas
      // aceitas (2 auditorias, 2 atores). Com o compare-and-swap so uma vence;
      // a perdedora reverte e nao deixa trilha de sucesso.
      expect(updateEvidence).toMatchObject({ audits: 1, actors: 1, outbox: 1, idempotency: 1 });
      expect([ownerEditName, attendantEditName]).toContain(updateEvidence?.name);
      finalConcurrentName = updateEvidence?.name;

      // Future death is rejected; exact replay of a valid death stays exactly-once.
      await ownerPage.goto(`/pacientes/${subjectId}`);
      let deathButton = ownerPage.getByRole('button', { name: 'Registrar falecimento' });
      let deathForm = deathButton.locator('xpath=ancestor::form[1]');
      await deathForm.locator('input[name="deceasedAt"]').fill(clinicDate(1));
      await deathForm.locator('textarea[name="reason"]').fill('Data futura invalida');
      ownerPage.once('dialog', (dialog) => dialog.accept());
      const futureDeathResponse = ownerPage.waitForResponse((response) =>
        isServerAction(response.request()),
      );
      await deathButton.click();
      expect((await futureDeathResponse).status()).toBeLessThan(500);
      await expect(
        deathForm.getByText('a data do falecimento nao pode estar no futuro', { exact: true }),
      ).toBeVisible();
      const [beforeDeath] = await sql<{ deceased_at: string | null; events: number }[]>`
        select p.obito_em::text as deceased_at,
          (select count(*)::int from outbox o
            where o.clinic_id = ${clinicId}::uuid and o.event_type = 'patient.core.deceased'
              and o.payload ->> 'patientId' = ${subjectId}
              and o.created_at >= ${startedAt}::timestamptz) events
        from patients p where p.id = ${subjectId}::uuid
      `;
      expect(beforeDeath).toEqual({ deceased_at: null, events: 0 });

      await ownerPage.reload();
      deathButton = ownerPage.getByRole('button', { name: 'Registrar falecimento' });
      deathForm = deathButton.locator('xpath=ancestor::form[1]');
      await deathForm.locator('input[name="deceasedAt"]').fill(clinicDate());
      await deathForm.locator('textarea[name="reason"]').fill('Teste controlado autorizado');
      const deathClientKey = await deathForm.locator('input[name="idempotencyKey"]').inputValue();
      idempotencyKeys.add(idempotencyDbKey('record_death', deathClientKey));
      ownerPage.once('dialog', (dialog) => dialog.accept());
      const deathRequestPromise = ownerPage.waitForRequest(isServerAction);
      const deathClickPromise = deathButton.click();
      const deathAction = capturedAction(await deathRequestPromise);
      const deathReplayResponses = await Promise.all(
        Array.from({ length: 3 }, () =>
          ownerContext.request.fetch(deathAction.url, {
            method: 'POST',
            headers: deathAction.headers,
            data: deathAction.body,
            failOnStatusCode: false,
          }),
        ),
      );
      await deathClickPromise;
      for (const response of deathReplayResponses) {
        expect(response.status()).toBeLessThan(500);
        await response.dispose();
      }
      await expect(ownerPage.getByText(/Falecimento registrado em/i)).toBeVisible();

      const [deathEvidence] = await sql<
        {
          deceased_at: string | null;
          audit: number;
          outbox: number;
          idem: number;
          suppression: number;
        }[]
      >`
        select p.obito_em::text as deceased_at,
          (select count(*)::int from audit_events a
            where a.clinic_id = ${clinicId}::uuid and a.action = 'patient.core.deceased'
              and a.resource_id = ${subjectId} and a.created_at >= ${startedAt}::timestamptz) audit,
          (select count(*)::int from outbox o
            where o.clinic_id = ${clinicId}::uuid and o.event_type = 'patient.core.deceased'
              and o.payload ->> 'patientId' = ${subjectId}
              and o.created_at >= ${startedAt}::timestamptz) outbox,
          (select count(*)::int from idempotency_keys i
            where i.clinic_id = ${clinicId}::uuid
              and i.key = ${idempotencyDbKey('record_death', deathClientKey)}) idem,
          (select count(*)::int from suppression_list s
            where s.clinic_id = ${clinicId}::uuid and s.reason = 'patient_deceased'
              and s.created_at >= ${startedAt}::timestamptz) suppression
        from patients p where p.id = ${subjectId}::uuid
      `;
      expect(deathEvidence).toEqual({
        deceased_at: clinicDate(),
        audit: 1,
        outbox: 1,
        idem: 1,
        suppression: 3,
      });

      // UX-001 — o seletor de "Novo atendimento" NAO oferece mais o falecido.
      // Este spec foi escrito quando ele aparecia e so era recusado no submit;
      // a assercao agora e a do comportamento correto, e continua provando o
      // essencial: nenhuma consulta e criada para um paciente com obito.
      await ownerPage.goto('/agenda');
      await ownerPage.getByRole('button', { name: 'Novo atendimento' }).click();
      const appointmentDrawer = ownerPage.getByRole('dialog', { name: 'Novo atendimento' });
      await appointmentDrawer.getByPlaceholder(/Buscar por nome/).fill(finalConcurrentName!);
      await expect(
        appointmentDrawer.getByRole('option', { name: finalConcurrentName!, exact: true }),
      ).toHaveCount(0, { timeout: 15_000 });
      const deceasedOfferedInSelector = false;
      await ownerPage.keyboard.press('Escape');
      const [deceasedAppointments] = await sql<{ n: number }[]>`
        select count(*)::int as n from appointments
         where clinic_id = ${clinicId}::uuid and patient_id = ${subjectId}::uuid
      `;
      expect(deceasedAppointments?.n).toBe(0);

      // Deterministic two-user soft-delete race.
      await Promise.all([
        ownerPage.goto(`/pacientes/${deleteId}`),
        attendantPage.goto(`/pacientes/${deleteId}`),
      ]);
      const ownerDeleteForm = ownerPage
        .getByRole('button', { name: 'Excluir paciente' })
        .locator('xpath=ancestor::form[1]');
      const attendantDeleteForm = attendantPage
        .getByRole('button', { name: 'Excluir paciente' })
        .locator('xpath=ancestor::form[1]');
      const ownerDeleteKey = await ownerDeleteForm
        .locator('input[name="idempotencyKey"]')
        .inputValue();
      const attendantDeleteKey = await attendantDeleteForm
        .locator('input[name="idempotencyKey"]')
        .inputValue();
      idempotencyKeys.add(idempotencyDbKey('delete', ownerDeleteKey));
      idempotencyKeys.add(idempotencyDbKey('delete', attendantDeleteKey));

      let releaseDeleteLock!: () => void;
      let announceDeleteLock!: () => void;
      const deleteLockReleased = new Promise<void>((resolve) => {
        releaseDeleteLock = resolve;
      });
      const deleteLockReady = new Promise<void>((resolve) => {
        announceDeleteLock = resolve;
      });
      const deleteLockTask = sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        await tx`select id from patients where id = ${deleteId!}::uuid for update`;
        announceDeleteLock();
        await deleteLockReleased;
      });
      await deleteLockReady;
      ownerPage.once('dialog', (dialog) => dialog.accept());
      attendantPage.once('dialog', (dialog) => dialog.accept());
      const ownerDeleteRequest = ownerPage.waitForRequest(isServerAction);
      const attendantDeleteRequest = attendantPage.waitForRequest(isServerAction);
      const ownerDeleteResponse = ownerPage.waitForResponse((response) =>
        isServerAction(response.request()),
      );
      const attendantDeleteResponse = attendantPage.waitForResponse((response) =>
        isServerAction(response.request()),
      );
      const ownerDeleteClick = ownerDeleteForm
        .getByRole('button', { name: 'Excluir paciente' })
        .click();
      const attendantDeleteClick = attendantDeleteForm
        .getByRole('button', { name: 'Excluir paciente' })
        .click();
      await Promise.all([ownerDeleteRequest, attendantDeleteRequest]);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      releaseDeleteLock();
      await deleteLockTask;
      const [ownerDeleteHttp, attendantDeleteHttp] = await Promise.all([
        ownerDeleteResponse,
        attendantDeleteResponse,
      ]);
      expect(ownerDeleteHttp.status()).toBeLessThan(500);
      expect(attendantDeleteHttp.status()).toBeLessThan(500);
      await Promise.all([ownerDeleteClick, attendantDeleteClick]);

      const [deleteEvidence] = await sql<
        {
          deleted: boolean;
          audit: number;
          actors: number;
          outbox: number;
          idem: number;
          suppression: number;
        }[]
      >`
        select (p.deleted_at is not null) as deleted,
          (select count(*)::int from audit_events a
            where a.clinic_id = ${clinicId}::uuid and a.action = 'patient.core.deleted'
              and a.resource_id = ${deleteId} and a.created_at >= ${startedAt}::timestamptz) audit,
          (select count(distinct a.user_id)::int from audit_events a
            where a.clinic_id = ${clinicId}::uuid and a.action = 'patient.core.deleted'
              and a.resource_id = ${deleteId} and a.created_at >= ${startedAt}::timestamptz) actors,
          (select count(*)::int from outbox o
            where o.clinic_id = ${clinicId}::uuid and o.event_type = 'patient.core.deleted'
              and o.payload ->> 'patientId' = ${deleteId}
              and o.created_at >= ${startedAt}::timestamptz) outbox,
          (select count(*)::int from idempotency_keys i
            where i.clinic_id = ${clinicId}::uuid
              and i.key like 'patient:delete:%'
              and i.response ->> 'patientId' = ${deleteId}
              and i.created_at >= ${startedAt}::timestamptz) idem,
          (select count(*)::int from suppression_list s
            where s.clinic_id = ${clinicId}::uuid and s.reason = 'patient_deleted'
              and s.created_at >= ${startedAt}::timestamptz) suppression
        from patients p where p.id = ${deleteId}::uuid
      `;
      expect(deleteEvidence?.deleted).toBe(true);
      expect(deleteEvidence?.suppression).toBe(3);
      expect(deleteEvidence?.audit).toBeGreaterThanOrEqual(1);
      expect(deleteEvidence?.audit).toBeLessThanOrEqual(2);
      expect(deleteEvidence?.actors).toBe(deleteEvidence?.audit);
      expect(deleteEvidence?.outbox).toBe(deleteEvidence?.audit);
      expect(deleteEvidence?.idem).toBe(deleteEvidence?.audit);

      await ownerPage.goto(`/pacientes?q=${encodeURIComponent(deleteName)}`);
      await expect(ownerPage.locator(`a[href="/pacientes/${deleteId}"]`)).toHaveCount(0);
      await ownerPage.goto(`/pacientes?includeDeleted=1&q=${encodeURIComponent(deleteName)}`);
      await expect(ownerPage.locator(`a[href="/pacientes/${deleteId}"]`)).toHaveCount(0);
      deletedRouteStatus = (await ownerPage.goto(`/pacientes/${deleteId}`))?.status() ?? -1;
      // HTTP-001 — antes era 200 (soft-404). O status agora e distinguivel por
      // monitoramento e cache.
      expect(deletedRouteStatus).toBe(404);
      deletedRouteVisibleChars = (await ownerPage.locator('body').innerText()).trim().length;

      // PAT-001 — a janela de 30 dias passou a ter recuperacao de verdade. A
      // lixeira lista o removido (sem link, porque a rota dele responde 404) e
      // o restore o traz de volta.
      await ownerPage.goto(`/pacientes?removidos=1&q=${encodeURIComponent(deleteName)}`);
      await expect(ownerPage.getByText(deleteName, { exact: true })).toBeVisible();
      const restoreResponse = ownerPage.waitForResponse((r) => isServerAction(r.request()));
      await ownerPage.getByRole('button', { name: 'Restaurar', exact: true }).first().click();
      expect((await restoreResponse).status()).toBeLessThan(500);

      await ownerPage.goto(`/pacientes?q=${encodeURIComponent(deleteName)}`);
      // A linha da lista tem dois links para o mesmo paciente (nome + chevron):
      // o que importa e o paciente ter voltado a ser listado.
      await expect(ownerPage.locator(`a[href="/pacientes/${deleteId}"]`).first()).toBeVisible();
      const [restored] = await sql<{ deleted: boolean }[]>`
        select (deleted_at is not null) as deleted from patients where id=${deleteId!}::uuid`;
      expect(restored?.deleted).toBe(false);
      recoverySurfaceExposed = true;
      // Contraprova: depois do restore a MESMA rota volta a 200 — o 404 anterior
      // era ausencia do recurso, nao rota quebrada.
      expect((await ownerPage.goto(`/pacientes/${deleteId}`))?.status()).toBe(200);

      console.log(
        `[patient-lifecycle-a] ${JSON.stringify({
          invalidLongNameRejected: true,
          malformedIdHttp: malformedIdStatus,
          unknownIdHttp: unknownIdStatus,
          malformedIdVisibleChars,
          unknownIdVisibleChars,
          unicodeSearchMatched: true,
          htmlLikeNameRenderedAsText: true,
          sqlLikeSearchDidNotBroadenResults: true,
          selfRelationshipRejected: true,
          relationshipReplayResponses: 4,
          relationshipRows: linkedEvidence!.rows,
          selfAndUnknownMergeRejected: true,
          validMergeNotRun: 'append-only history has no supported fixture cleanup',
          consentControlsExposed: consentControls,
          concurrentUpdateAccepted: updateEvidence!.audits,
          concurrentUpdateActors: updateEvidence!.actors,
          concurrentUpdateConflictDetected: false,
          futureDeathRejected: true,
          deathReplayResponses: 4,
          deathExactlyOnce: deathEvidence!.audit === 1,
          deceasedPatientVisibleInAgendaSelector: deceasedOfferedInSelector,
          deceasedSchedulingBlocked: deceasedAppointments!.n === 0,
          concurrentDeleteAccepted: deleteEvidence!.audit,
          concurrentDeleteActors: deleteEvidence!.actors,
          duplicateDeleteEvents: deleteEvidence!.outbox,
          concurrentDeleteDuplicateObserved: deleteEvidence!.outbox > 1,
          deceasedOfferedInSelector,
          softDeletedHidden: true,
          softDeletedRouteHttp: deletedRouteStatus,
          softDeletedRouteVisibleChars: deletedRouteVisibleChars,
          recoverySurfaceExposed,
          externalProviderMutation: false,
        })}`,
      );
    } finally {
      if (clinicId && patientIds.length > 0) {
        const cleanup = await sql.begin(async (tx) => {
          await tx.unsafe('RESET ROLE');
          const suppressions = await tx<{ id: string }[]>`
            delete from suppression_list
             where clinic_id = ${clinicId!}::uuid
               and created_at >= ${startedAt}::timestamptz
               and reason in ('patient_deceased', 'patient_deleted')
            returning id::text
          `;
          const outbox = await tx<{ id: string }[]>`
            delete from outbox
             where clinic_id = ${clinicId!}::uuid
               and created_at >= ${startedAt}::timestamptz
               and (
                 payload ->> 'patientId' = any(${patientIds}::text[])
                 or payload ->> 'responsiblePatientId' = any(${patientIds}::text[])
                 or payload ->> 'dependentPatientId' = any(${patientIds}::text[])
                 or payload ->> 'relationshipId' = ${relationshipId ?? ''}
               )
            returning id::text
          `;
          const audits = await tx<{ id: string }[]>`
            delete from audit_events
             where clinic_id = ${clinicId!}::uuid
               and created_at >= ${startedAt}::timestamptz
               and (
                 resource_id = any(${[
                   ...patientIds,
                   ...(relationshipId ? [relationshipId] : []),
                 ]}::text[])
                 or (action = 'patient.core.created' and after ->> 'nome' like ${`${marker}%`})
               )
            returning id::text
          `;
          const idempotency =
            idempotencyKeys.size > 0
              ? await tx<{ key: string }[]>`
                  delete from idempotency_keys
                   where clinic_id = ${clinicId!}::uuid
                     and (
                       key = any(${[...idempotencyKeys]}::text[])
                       or (created_at >= ${startedAt}::timestamptz
                         and (response ->> 'id' = any(${patientIds}::text[])
                           or response ->> 'patientId' = any(${patientIds}::text[])))
                     )
                  returning key
                `
              : [];
          const relationships = await tx<{ id: string }[]>`
            delete from patient_relationships
             where clinic_id = ${clinicId!}::uuid
               and (responsible_patient_id = any(${patientIds}::uuid[])
                 or dependent_patient_id = any(${patientIds}::uuid[]))
            returning id::text
          `;
          const patients = await tx<{ id: string }[]>`
            delete from patients where id = any(${patientIds}::uuid[]) returning id::text
          `;
          const [remaining] = await tx<
            {
              patients: number;
              relationships: number;
              merges: number;
              outbox: number;
              audit: number;
              idempotency: number;
              suppression: number;
            }[]
          >`
            select
              (select count(*)::int from patients where id = any(${patientIds}::uuid[])) patients,
              (select count(*)::int from patient_relationships
                where responsible_patient_id = any(${patientIds}::uuid[])
                   or dependent_patient_id = any(${patientIds}::uuid[])) relationships,
              (select count(*)::int from patient_merges
                where source_patient_id = any(${patientIds}::uuid[])
                   or target_patient_id = any(${patientIds}::uuid[])) merges,
              (select count(*)::int from outbox
                where clinic_id = ${clinicId!}::uuid and created_at >= ${startedAt}::timestamptz
                  and (payload ->> 'patientId' = any(${patientIds}::text[])
                    or payload ->> 'responsiblePatientId' = any(${patientIds}::text[])
                    or payload ->> 'dependentPatientId' = any(${patientIds}::text[]))) outbox,
              (select count(*)::int from audit_events
                where clinic_id = ${clinicId!}::uuid and created_at >= ${startedAt}::timestamptz
                  and (resource_id = any(${[
                    ...patientIds,
                    ...(relationshipId ? [relationshipId] : []),
                  ]}::text[])
                    or (action = 'patient.core.created' and after ->> 'nome' like ${`${marker}%`}))) audit,
              (select count(*)::int from idempotency_keys
                where clinic_id = ${clinicId!}::uuid
                  and (key = any(${[...idempotencyKeys]}::text[])
                    or (created_at >= ${startedAt}::timestamptz
                      and (response ->> 'id' = any(${patientIds}::text[])
                        or response ->> 'patientId' = any(${patientIds}::text[]))))) idempotency,
              (select count(*)::int from suppression_list
                where clinic_id = ${clinicId!}::uuid and created_at >= ${startedAt}::timestamptz
                  and reason in ('patient_deceased', 'patient_deleted')) suppression
          `;
          return {
            removed: {
              suppressions: suppressions.length,
              outbox: outbox.length,
              audits: audits.length,
              idempotency: idempotency.length,
              relationships: relationships.length,
              patients: patients.length,
            },
            remaining,
          };
        });
        expect(cleanup.remaining).toEqual({
          patients: 0,
          relationships: 0,
          merges: 0,
          outbox: 0,
          audit: 0,
          idempotency: 0,
          suppression: 0,
        });
        console.log(`[patient-lifecycle-a] cleanup ${JSON.stringify(cleanup)}`);
      }
      await Promise.all([ownerContext.close(), attendantContext.close()]);
      await sql.end();
    }
  });
});
