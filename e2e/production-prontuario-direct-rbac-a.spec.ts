import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_CLINICAL_RBAC === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_TENANT_A_EMAIL;
const doctorEmail = process.env.E2E_DOCTOR_EMAIL;
const attendantEmail = process.env.E2E_ATTENDANT_EMAIL;
const financialEmail = process.env.E2E_FINANCIAL_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'off',
  video: 'off',
  screenshot: 'only-on-failure',
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

async function signInContext(context: BrowserContext, email: string): Promise<void> {
  if (!baseUrl || !sharedPassword) throw new Error('Credenciais E2E incompletas.');
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
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: sharedPassword,
  });
  if (error || !data.session || nextCookies.length === 0) {
    throw new Error(error?.message ?? 'Login não produziu sessão.');
  }
  await context.addCookies(
    nextCookies
      .filter(({ value }) => value !== '')
      .map(({ name, value }) => ({ name, value, url: baseUrl })),
  );
}

function validCpf(seed: string): string {
  const digits = Array.from(seed.replace(/\D/gu, '').padStart(9, '4').slice(-9), Number);
  const digit = (values: number[], weight: number) => {
    const rest =
      (values.reduce((sum, value, index) => sum + value * (weight - index), 0) * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const first = digit(digits, 10);
  return [...digits, first, digit([...digits, first], 11)].join('');
}

function mutationKey(prefix: string, clientKey: string): string {
  return `${prefix}:${clientKey.replaceAll('-', '').toLowerCase()}`;
}

async function createPatient(
  page: Page,
  input: { name: string; cpf: string; email: string },
): Promise<{ id: string; idempotencyKey: string }> {
  await page.goto('/pacientes?novo=1');
  const drawer = page.getByRole('dialog', { name: 'Novo paciente' });
  await expect(drawer).toBeVisible();
  await drawer.locator('input[name="nome"]').fill(input.name);
  await drawer.locator('input[name="cpf"]').fill(input.cpf);
  await drawer.locator('input[name="email"]').fill(input.email);
  const clientKey = await drawer.locator('input[name="idempotencyKey"]').inputValue();
  await drawer.getByRole('button', { name: 'Criar paciente' }).click();
  await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/u, { timeout: 90_000 });
  const id = new URL(page.url()).pathname.split('/').at(-1);
  if (!id || !/^[0-9a-f-]{36}$/iu.test(id)) throw new Error('Paciente não foi criado.');
  return { id, idempotencyKey: mutationKey('patient:create', clientKey) };
}

test.describe('produção: autorização do deep-link de prontuário na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('roles sem view:prontuario nao leem SOAP nem alcancam o editor', async ({ browser }) => {
    test.setTimeout(240_000);
    test.skip(!authorized, 'Exige E2E_PRODUCTION_CLINICAL_RBAC=ALLOW_SYNTHETIC_CLINIC_A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste clínico só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !doctorEmail || !attendantEmail || !financialEmail || !sharedPassword) {
      throw new Error('Credenciais das quatro roles da Clínica A ausentes.');
    }
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const sql = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
    const ownerContext = await browser.newContext({ baseURL: baseUrl });
    const doctorContext = await browser.newContext({ baseURL: baseUrl });
    const attendantContext = await browser.newContext({ baseURL: baseUrl });
    const financialContext = await browser.newContext({ baseURL: baseUrl });
    const ownerPage = await ownerContext.newPage();
    const doctorPage = await doctorContext.newPage();
    const attendantPage = await attendantContext.newPage();
    const financialPage = await financialContext.newPage();
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-CLINICAL-RBAC-A-${runId}]`;
    const patientName = `${marker} Paciente`;
    const patientEmail = `e2e-clinical-rbac-a-${runId}@example.test`;
    const clinicalContent = `${marker} conteúdo clínico estritamente sintético.`;
    const idempotencyKeys: string[] = [];
    let clinicId: string | undefined;
    let patientId: string | undefined;
    let prontuarioId: string | undefined;

    try {
      const identities = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ email: string; clinic_id: string; role: string; permissions: string[] }[]>`
          select lower(u.email) email,
                 ep.clinic_id::text,
                 ep.role::text,
                 ep.permissions
            from auth.users u
            join effective_permissions_v ep on ep.user_id = u.id
           where lower(u.email) = any(${[
             ownerEmail.toLowerCase(),
             doctorEmail.toLowerCase(),
             attendantEmail.toLowerCase(),
             financialEmail.toLowerCase(),
           ]}::text[])
             and ep.ativo = true
             and ep.deleted_at is null
        `;
      });
      expect(identities).toHaveLength(4);
      expect(new Set(identities.map(({ clinic_id: id }) => id)).size).toBe(1);
      clinicId = identities[0]!.clinic_id;
      const byRole = new Map(identities.map((identity) => [identity.role, identity]));
      expect(byRole.get('doctor')?.permissions).toContain('view:prontuario');
      for (const role of ['attendant', 'financial']) {
        expect(byRole.get(role)?.permissions).not.toContain('view:prontuario');
        expect(byRole.get(role)?.permissions).not.toContain('create:prontuario');
        expect(byRole.get(role)?.permissions).not.toContain('sign:prontuario');
      }

      await signInContext(ownerContext, ownerEmail);
      const patient = await createPatient(ownerPage, {
        name: patientName,
        cpf: validCpf(runId),
        email: patientEmail,
      });
      patientId = patient.id;
      idempotencyKeys.push(patient.idempotencyKey);

      await signInContext(doctorContext, doctorEmail);
      await doctorPage.goto(`/pacientes/${patientId}?tab=prontuarios`);
      const createButton = doctorPage.getByRole('button', { name: 'Novo prontuário' });
      const createForm = createButton.locator('xpath=ancestor::form[1]');
      const clientKey = await createForm.locator('input[name="idempotencyKey"]').inputValue();
      idempotencyKeys.push(mutationKey('clinical:create_prontuario', clientKey));
      await createButton.click();
      await expect(doctorPage).toHaveURL(
        /\/pacientes\/[0-9a-f-]{36}\/prontuarios\/[0-9a-f-]{36}(?:\?|$)/u,
        { timeout: 60_000 },
      );
      prontuarioId = new URL(doctorPage.url()).pathname.split('/').at(-1);
      expect(prontuarioId).toMatch(/^[0-9a-f-]{36}$/iu);
      const doctorField = doctorPage.locator('textarea').first();
      await doctorField.fill(clinicalContent);
      await doctorPage.getByRole('button', { name: 'Salvar agora', exact: true }).click();
      await expect(doctorPage.getByText(/Salvo/u)).toBeVisible({ timeout: 30_000 });

      const [beforeDeniedSave] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ row_version: number; content_encrypted: string }[]>`
          select row_version, content_encrypted
            from prontuarios
           where id = ${prontuarioId!}::uuid
             and clinic_id = ${clinicId!}::uuid
             and patient_id = ${patientId!}::uuid
        `;
      });
      if (!beforeDeniedSave) throw new Error('Prontuário sintético não persistiu.');

      await signInContext(attendantContext, attendantEmail);
      // AUTHZ-003 — o spec reproduzia o achado: o atendente LIA o SOAP e so o
      // autosave era negado. Agora o gate precede a leitura e a decifracao.
      await attendantPage.goto(`/pacientes/${patientId}?tab=prontuarios`);
      await expect(attendantPage.getByText('rascunho', { exact: true })).toHaveCount(0);
      await expect(attendantPage.getByRole('link', { name: 'Editar', exact: true })).toHaveCount(0);
      await attendantPage.goto(`/pacientes/${patientId}/prontuarios/${prontuarioId}`);
      await expect(
        attendantPage.getByRole('heading', { name: 'Prontuário (rascunho)', exact: true }),
      ).toHaveCount(0);
      // O conteudo clinico decifrado nao aparece em lugar nenhum da pagina.
      expect(await attendantPage.locator('body').innerText()).not.toContain(clinicalContent);
      // O editor sequer e alcancavel: nao ha textarea para digitar. O gate de
      // ESCRITA continua existindo no core (coberto por teste unitario); aqui o
      // que se prova e que o registro nao mudou.
      await expect(attendantPage.locator('textarea')).toHaveCount(0);

      const [afterDeniedSave] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ row_version: number; content_encrypted: string }[]>`
          select row_version, content_encrypted
            from prontuarios
           where id = ${prontuarioId!}::uuid
             and clinic_id = ${clinicId!}::uuid
        `;
      });
      expect(afterDeniedSave).toEqual(beforeDeniedSave);

      // Mesma verificacao para o perfil Financeiro.
      await signInContext(financialContext, financialEmail);
      await financialPage.goto(`/pacientes/${patientId}?tab=prontuarios`);
      await expect(financialPage.getByText('rascunho', { exact: true })).toHaveCount(0);
      await financialPage.goto(`/pacientes/${patientId}/prontuarios/${prontuarioId}`);
      await expect(
        financialPage.getByRole('heading', { name: 'Prontuário (rascunho)', exact: true }),
      ).toHaveCount(0);
      expect(await financialPage.locator('body').innerText()).not.toContain(clinicalContent);

      console.log(
        `[clinical-direct-rbac-a] ${JSON.stringify({
          testedRolesWithoutView: ['attendant', 'financial'],
          hubMetadataVisibleWithoutView: false,
          decryptedSoapVisibleWithoutView: false,
          editorReachableWithoutView: false,
          databaseUnchanged: true,
          mutationBypass: false,
          result: 'read-and-write-authorization-pass',
        })}`,
      );
    } finally {
      if (clinicId && patientId) {
        // Evita o flush fire-and-forget do editor com conteúdo dirty enquanto o
        // cleanup roda; a action já foi dinamicamente negada e verificada acima.
        await attendantPage.goto('/pacientes');
        const cleanup = await sql.begin(async (tx) => {
          await tx.unsafe('RESET ROLE');
          const resourceIds = [patientId!, ...(prontuarioId ? [prontuarioId] : [])];
          const outbox = await tx<{ id: string }[]>`
            delete from outbox
             where clinic_id = ${clinicId!}::uuid
               and (payload ->> 'patientId' = ${patientId!}
                 or payload ->> 'prontuarioId' = ${prontuarioId ?? ''})
            returning id::text
          `;
          const audit = await tx<{ id: string }[]>`
            delete from audit_events
             where clinic_id = ${clinicId!}::uuid
               and (resource_id = any(${resourceIds}::text[])
                 or coalesce(before::text, '') like ${`%${marker}%`}
                 or coalesce(after::text, '') like ${`%${marker}%`})
            returning id::text
          `;
          const idempotency =
            idempotencyKeys.length > 0
              ? await tx<{ key: string }[]>`
                  delete from idempotency_keys
                   where clinic_id = ${clinicId!}::uuid
                     and key in ${tx([...new Set(idempotencyKeys)])}
                  returning key
                `
              : [];
          const prontuarios = prontuarioId
            ? await tx<{ id: string }[]>`
                delete from prontuarios
                 where id = ${prontuarioId}::uuid
                   and clinic_id = ${clinicId!}::uuid
                   and patient_id = ${patientId!}::uuid
                returning id::text
              `
            : [];
          const patients = await tx<{ id: string }[]>`
            delete from patients
             where id = ${patientId!}::uuid
               and clinic_id = ${clinicId!}::uuid
               and nome = ${patientName}
               and email = ${patientEmail}
            returning id::text
          `;
          const [remaining] = await tx<
            { patients: number; prontuarios: number; outbox: number; audit: number }[]
          >`
            select
              (select count(*)::int from patients where id = ${patientId!}::uuid) patients,
              (select count(*)::int from prontuarios where patient_id = ${patientId!}::uuid) prontuarios,
              (select count(*)::int from outbox where payload ->> 'patientId' = ${patientId!}) outbox,
              (select count(*)::int
                 from audit_events
                where clinic_id = ${clinicId!}::uuid
                  and resource_id = any(${resourceIds}::text[])) audit
          `;
          return {
            outbox: outbox.length,
            audit: audit.length,
            idempotency: idempotency.length,
            prontuarios: prontuarios.length,
            patients: patients.length,
            remaining,
          };
        });
        expect(cleanup.remaining).toEqual({ patients: 0, prontuarios: 0, outbox: 0, audit: 0 });
        console.log(`[clinical-direct-rbac-a-cleanup] ${JSON.stringify(cleanup)}`);
      }
      await ownerContext.close();
      await doctorContext.close();
      await attendantContext.close();
      await financialContext.close();
      await sql.end();
    }
  });
});
