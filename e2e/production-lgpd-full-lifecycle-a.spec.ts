import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_LGPD_LIFECYCLE === 'ALLOW_DESTRUCTIVE_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_TENANT_A_EMAIL;
const doctorEmail = process.env.E2E_DOCTOR_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;
const controlledMailbox = process.env.E2E_CONTROLLED_EMAIL;
const cronSecret = process.env.CRON_SECRET;

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

function controlledAlias(mailbox: string, runId: string): string {
  const match = /^([^+@]+)(?:\+[^@]*)?@gmail\.com$/iu.exec(mailbox.trim().toLowerCase());
  if (!match?.[1]) {
    throw new Error('E2E_CONTROLLED_EMAIL deve ser uma caixa Gmail controlada.');
  }
  return `${match[1]}+clinicaos-lgpd-a-${runId}@gmail.com`;
}

function validCpf(seed: string): string {
  const digits = Array.from(seed.replace(/\D/gu, '').padStart(9, '8').slice(-9), Number);
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

async function requestDelete(page: Page, patientId: string): Promise<string> {
  await page.goto(`/pacientes/${patientId}`);
  const button = page.getByRole('button', { name: 'Solicitar exclusão (LGPD)' });
  const form = button.locator('xpath=ancestor::form[1]');
  const clientKey = await form.locator('input[name="idempotencyKey"]').inputValue();
  page.once('dialog', (dialog) => dialog.accept());
  await button.click();
  await expect(page).toHaveURL(/\/pacientes(?:\?|$)/u, { timeout: 60_000 });
  return mutationKey('patient:lgpd_delete', clientKey);
}

type ExportEvidence = {
  id: string;
  status: string;
  status_reason: string | null;
  export_signed_url: string | null;
  export_signed_url_expires_at: string | null;
  requester_notification_channel: string | null;
  outbox_status: string | null;
};

test.describe('produção: ciclo LGPD destrutivo completo na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('exporta, retém, elimina fisicamente e anonimiza duas fixtures controladas', async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    test.skip(!authorized, 'Exige E2E_PRODUCTION_LGPD_LIFECYCLE=ALLOW_DESTRUCTIVE_CLINIC_A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O ciclo LGPD destrutivo só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !doctorEmail || !sharedPassword || !controlledMailbox || !cronSecret) {
      throw new Error('Credenciais da Clínica A, caixa controlada ou segredo de cron ausentes.');
    }
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const sql = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
    const ownerContext = await browser.newContext({ baseURL: baseUrl });
    const doctorContext = await browser.newContext({ baseURL: baseUrl });
    const ownerPage = await ownerContext.newPage();
    const doctorPage = await doctorContext.newPage();
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-LGPD-A-${runId}]`;
    const retainedName = `${marker} Retenção clínica`;
    const physicalName = `${marker} Exclusão física`;
    const retainedEmail = controlledAlias(controlledMailbox, runId);
    const physicalEmail = `e2e-lgpd-a-${runId}@example.test`;
    const idempotencyKeys: string[] = [];
    const storagePaths: string[] = [];
    const suppressionHashes: string[] = [];
    let suppressionBaseline = new Set<string>();
    let clinicId: string | undefined;
    let retainedPatientId: string | undefined;
    let physicalPatientId: string | undefined;
    let prontuarioId: string | undefined;
    let exportRequestId: string | undefined;
    let signedUrl: string | undefined;
    const { url: supabaseUrl, key: adminSecret } = productionSupabaseConfig();
    const admin = createSsrClient(supabaseUrl, adminSecret, {
      cookies: { getAll: () => [], setAll: () => {} },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    try {
      const identities = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ email: string; user_id: string; clinic_id: string; role: string }[]>`
          select lower(u.email) as email,
                 p.id::text as user_id,
                 p.clinic_id::text,
                 p.role::text
            from auth.users u
            join profiles p on p.id = u.id
           where lower(u.email) = any(${[
             ownerEmail.toLowerCase(),
             doctorEmail.toLowerCase(),
           ]}::text[])
             and p.ativo = true
             and p.deleted_at is null
        `;
      });
      expect(identities).toHaveLength(2);
      expect(new Set(identities.map(({ clinic_id: id }) => id)).size).toBe(1);
      expect(new Set(identities.map(({ role }) => role))).toEqual(new Set(['owner', 'doctor']));
      clinicId = identities[0]!.clinic_id;
      const baselineSuppressions = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ contact_hash: string }[]>`
          select contact_hash
            from suppression_list
           where clinic_id = ${clinicId!}::uuid
             and reason = 'lgpd_delete'
        `;
      });
      suppressionBaseline = new Set(
        baselineSuppressions.map(({ contact_hash: contactHash }) => contactHash),
      );

      await signInContext(ownerContext, ownerEmail, sharedPassword);
      const retained = await createPatient(ownerPage, {
        name: retainedName,
        cpf: validCpf(`${runId}1`),
        email: retainedEmail,
      });
      retainedPatientId = retained.id;
      idempotencyKeys.push(retained.idempotencyKey);
      const physical = await createPatient(ownerPage, {
        name: physicalName,
        cpf: validCpf(`${runId}2`),
        email: physicalEmail,
      });
      physicalPatientId = physical.id;
      idempotencyKeys.push(physical.idempotencyKey);

      await ownerPage.goto(`/pacientes/${retainedPatientId}`);
      const exportButton = ownerPage.getByRole('button', { name: 'Exportar dados (LGPD)' });
      const exportForm = exportButton.locator('xpath=ancestor::form[1]');
      const exportClientKey = await exportForm.locator('input[name="idempotencyKey"]').inputValue();
      idempotencyKeys.push(mutationKey('patient:lgpd_export', exportClientKey));
      await exportButton.click();
      await expect(ownerPage.getByText(/Exportação solicitada/iu)).toBeVisible({ timeout: 30_000 });

      let exportEvidence: ExportEvidence | undefined;
      await expect
        .poll(
          async () => {
            const [row] = await sql.begin(async (tx) => {
              await tx.unsafe('RESET ROLE');
              return tx<ExportEvidence[]>`
                select r.id::text,
                       r.status::text,
                       r.status_reason,
                       r.export_signed_url,
                       r.export_signed_url_expires_at::text,
                       r.requester_notification_channel::text,
                       o.status::text as outbox_status
                  from lgpd_requests r
                  left join outbox o
                    on o.clinic_id = r.clinic_id
                   and o.event_type = 'patient.lgpd.export_requested'
                   and o.payload ->> 'requestId' = r.id::text
                 where r.clinic_id = ${clinicId!}::uuid
                   and r.patient_id = ${retainedPatientId!}::uuid
                   and r.type = 'export'
                 order by r.requested_at desc
                 limit 1
              `;
            });
            exportEvidence = row;
            return row?.status ?? 'missing';
          },
          { timeout: 180_000, intervals: [2_000, 5_000, 10_000] },
        )
        .toBe('completed');
      if (!exportEvidence?.id || !exportEvidence.export_signed_url) {
        throw new Error('Exportação concluída sem evidência utilizável.');
      }
      expect(exportEvidence.status_reason).toBe('export_ready_email_sent');
      expect(exportEvidence.requester_notification_channel).toBe('email');
      expect(exportEvidence.outbox_status).toBe('processed');
      exportRequestId = exportEvidence.id;
      signedUrl = exportEvidence.export_signed_url;
      storagePaths.push(
        `${clinicId}/${retainedPatientId}/${exportRequestId}.pdf`,
        `${clinicId}/${retainedPatientId}/${exportRequestId}.json`,
      );

      const pdfBeforeDelete = await ownerContext.request.get(signedUrl);
      expect(pdfBeforeDelete.status()).toBe(200);
      expect((await pdfBeforeDelete.body()).subarray(0, 4).toString('ascii')).toBe('%PDF');
      await pdfBeforeDelete.dispose();
      const jsonBeforeDelete = await admin.storage.from('lgpd-exports').download(storagePaths[1]!);
      if (jsonBeforeDelete.error || !jsonBeforeDelete.data) {
        throw new Error('JSON LGPD não foi gravado no Storage privado.');
      }
      const exportedJson = JSON.parse(await jsonBeforeDelete.data.text()) as {
        patientId?: unknown;
        clinicId?: unknown;
      };
      expect(exportedJson.patientId).toBe(retainedPatientId);
      expect(exportedJson.clinicId).toBe(clinicId);

      await signInContext(doctorContext, doctorEmail, sharedPassword);
      await doctorPage.goto(`/pacientes/${retainedPatientId}?tab=prontuarios`);
      const createProntuarioButton = doctorPage.getByRole('button', { name: 'Novo prontuário' });
      const prontuarioForm = createProntuarioButton.locator('xpath=ancestor::form[1]');
      const prontuarioClientKey = await prontuarioForm
        .locator('input[name="idempotencyKey"]')
        .inputValue();
      idempotencyKeys.push(mutationKey('clinical:create_prontuario', prontuarioClientKey));
      await createProntuarioButton.click();
      await expect(doctorPage).toHaveURL(
        /\/pacientes\/[0-9a-f-]{36}\/prontuarios\/[0-9a-f-]{36}(?:\?|$)/u,
        { timeout: 60_000 },
      );
      prontuarioId = new URL(doctorPage.url()).pathname.split('/').at(-1);
      expect(prontuarioId).toMatch(/^[0-9a-f-]{36}$/iu);

      idempotencyKeys.push(await requestDelete(ownerPage, retainedPatientId));
      const suppressionAfterFirstDelete = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ contact_hash: string }[]>`
          select contact_hash
            from suppression_list
           where clinic_id = ${clinicId!}::uuid
             and reason = 'lgpd_delete'
        `;
      });
      const firstDelta = suppressionAfterFirstDelete.filter(
        ({ contact_hash: contactHash }) => !suppressionBaseline.has(contactHash),
      );
      expect(firstDelta).toHaveLength(1);
      suppressionHashes.push(firstDelta[0]!.contact_hash);

      idempotencyKeys.push(await requestDelete(ownerPage, physicalPatientId));
      const suppressionAfterSecondDelete = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ contact_hash: string }[]>`
          select contact_hash
            from suppression_list
           where clinic_id = ${clinicId!}::uuid
             and reason = 'lgpd_delete'
        `;
      });
      const secondDelta = suppressionAfterSecondDelete.filter(
        ({ contact_hash: contactHash }) => !suppressionBaseline.has(contactHash),
      );
      expect(secondDelta).toHaveLength(2);
      suppressionHashes.splice(
        0,
        suppressionHashes.length,
        ...secondDelta.map(({ contact_hash: contactHash }) => contactHash),
      );

      await expect
        .poll(
          async () => {
            const rows = await sql<{ patient_id: string; status: string }[]>`
              select patient_id::text, status::text
                from lgpd_requests
               where clinic_id = ${clinicId!}::uuid
                 and patient_id = any(${[retainedPatientId!, physicalPatientId!]}::uuid[])
                 and type = 'delete'
            `;
            return rows.length === 2 && rows.every(({ status }) => status === 'processing');
          },
          { timeout: 120_000, intervals: [2_000, 5_000, 10_000] },
        )
        .toBe(true);

      const softDeleted = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            id: string;
            deleted_at: string | null;
            anonymized_at: string | null;
            nome: string;
            email: string;
          }[]
        >`
          select id::text, deleted_at::text, anonymized_at::text, nome, email
            from patients
           where clinic_id = ${clinicId!}::uuid
             and id = any(${[retainedPatientId!, physicalPatientId!]}::uuid[])
           order by id
        `;
      });
      expect(softDeleted).toHaveLength(2);
      expect(softDeleted.every(({ deleted_at: deletedAt }) => deletedAt !== null)).toBe(true);
      expect(softDeleted.every(({ anonymized_at: anonymizedAt }) => anonymizedAt === null)).toBe(
        true,
      );
      expect(new Set(softDeleted.map(({ nome }) => nome))).toEqual(
        new Set([retainedName, physicalName]),
      );

      const pdfDuringRetention = await ownerContext.request.get(signedUrl);
      expect(pdfDuringRetention.status()).toBe(200);
      await pdfDuringRetention.dispose();
      await ownerPage.goto(`/pacientes/${retainedPatientId}`);
      await expect(ownerPage.getByText('Página não encontrada', { exact: true })).toBeVisible();
      await ownerPage.goto(`/pacientes/${physicalPatientId}`);
      await expect(ownerPage.getByText('Página não encontrada', { exact: true })).toBeVisible();

      await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        await tx`
          update patients
             set deleted_at = case id
               when ${physicalPatientId!}::uuid then '1900-01-01 00:00:00+00'::timestamptz
               when ${retainedPatientId!}::uuid then '1900-01-02 00:00:00+00'::timestamptz
             end
           where clinic_id = ${clinicId!}::uuid
             and id = any(${[physicalPatientId!, retainedPatientId!]}::uuid[])
             and deleted_at is not null
             and anonymized_at is null
        `;
      });
      const oldestEligible = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; clinic_id: string }[]>`
          select id::text, clinic_id::text
            from patients
           where deleted_at is not null
             and deleted_at < now() - interval '30 days'
             and anonymized_at is null
           order by deleted_at asc
           limit 2
        `;
      });
      expect(oldestEligible.map(({ id }) => id)).toEqual([physicalPatientId, retainedPatientId]);
      expect(oldestEligible.every(({ clinic_id: id }) => id === clinicId)).toBe(true);

      const hardDeleteResponse = await ownerContext.request.get(
        '/api/cron/patient-hard-delete?limit=2',
        {
          headers: {
            authorization: `Bearer ${cronSecret}`,
            'x-vercel-cron-schedule': 'pentest-controlled-clinic-a',
          },
        },
      );
      expect(hardDeleteResponse.status()).toBe(200);
      const hardDeleteResult = (await hardDeleteResponse.json()) as {
        ok?: unknown;
        deleted?: unknown;
        anonymized?: unknown;
        failed?: unknown;
        clinics?: unknown;
      };
      expect(hardDeleteResult).toEqual({
        ok: true,
        deleted: 1,
        anonymized: 1,
        failed: 0,
        clinics: 1,
      });

      const [postState] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            physical_rows: number;
            retained_rows: number;
            retained_anonymized: number;
            retained_clinical_rows: number;
            completed_delete_requests: number;
            audit_pii_keys: number;
            outbox_pii_rows: number;
            outbox_rows_for_patients: number;
          }[]
        >`
          select
            (select count(*)::int from patients where id = ${physicalPatientId!}::uuid) physical_rows,
            (select count(*)::int from patients where id = ${retainedPatientId!}::uuid) retained_rows,
            (select count(*)::int
               from patients
              where id = ${retainedPatientId!}::uuid
                and clinic_id = ${clinicId!}::uuid
                and nome = 'Paciente anonimizado (LGPD)'
                and email = ${`anon+${retainedPatientId}@lgpd.invalid`}
                and cpf_hash = ${`anon:${retainedPatientId}`}
                and telefone_encrypted is null
                and telefone_hash is null
                and data_nascimento is null
                and sexo is null
                and obito_em is null
                and anonymized_at is not null) retained_anonymized,
            (select count(*)::int
               from prontuarios
              where id = ${prontuarioId!}::uuid
                and clinic_id = ${clinicId!}::uuid
                and patient_id = ${retainedPatientId!}::uuid) retained_clinical_rows,
            (select count(*)::int
               from lgpd_requests
              where clinic_id = ${clinicId!}::uuid
                and patient_id = any(${[retainedPatientId!, physicalPatientId!]}::uuid[])
                and type = 'delete'
                and status = 'completed'
                and fulfilled_at is not null) completed_delete_requests,
            (select count(*)::int
               from audit_events
              where clinic_id = ${clinicId!}::uuid
                and resource_type = 'patient'
                and resource_id = any(${[retainedPatientId!, physicalPatientId!]}::text[])
                and (coalesce(before, '{}'::jsonb) ?| array['nome','email','dataNascimento','sexo','obitoEm']
                  or coalesce(after, '{}'::jsonb) ?| array['nome','email','dataNascimento','sexo','obitoEm'])) audit_pii_keys,
            (select count(*)::int
               from outbox
              where clinic_id = ${clinicId!}::uuid
                and payload ->> 'patientId' = any(${[
                  retainedPatientId!,
                  physicalPatientId!,
                ]}::text[])
                and (payload::text like ${`%${marker}%`}
                  or payload::text like ${`%${retainedEmail}%`}
                  or payload::text like ${`%${physicalEmail}%`})) outbox_pii_rows,
            (select count(*)::int
               from outbox
              where clinic_id = ${clinicId!}::uuid
                and payload ->> 'patientId' = any(${[
                  retainedPatientId!,
                  physicalPatientId!,
                ]}::text[])) outbox_rows_for_patients
        `;
      });
      expect(postState).toEqual({
        physical_rows: 0,
        retained_rows: 1,
        retained_anonymized: 1,
        retained_clinical_rows: 1,
        completed_delete_requests: 2,
        audit_pii_keys: 0,
        outbox_pii_rows: 0,
        outbox_rows_for_patients: expect.any(Number),
      });
      // O outbox referencia o paciente por id, nunca por nome/e-mail. A coluna
      // companheira separa "nao ha linha nenhuma" de "ha linha, sem PII" — so a
      // segunda prova que a eliminacao nao dependeu de o evento inexistir.
      expect(postState!.outbox_rows_for_patients).toBeGreaterThan(0);

      // O hard-delete purga os artefatos de exportacao junto com o paciente.
      // Manter um PDF/JSON com a PII integral anularia a anonimizacao — vale
      // tanto para quem foi eliminado fisicamente quanto para quem ficou por
      // retencao clinica, porque o snapshot exportado nao anonimiza.
      const pdfObjectAfterErasure = await admin.storage
        .from('lgpd-exports')
        .download(storagePaths[0]!);
      const jsonObjectAfterErasure = await admin.storage
        .from('lgpd-exports')
        .download(storagePaths[1]!);
      expect(pdfObjectAfterErasure.error).not.toBeNull();
      expect(jsonObjectAfterErasure.error).not.toBeNull();

      // A URL assinada emitida ANTES da eliminacao nao pode seguir entregando o
      // arquivo: o portador dela nao deve virar uma copia residual da PII.
      // O objeto ja nao existe, mas a resposta da URL assinada pode estar no
      // cache do CDN. Medimos por quanto tempo ela ainda entrega PII em vez de
      // assumir invalidacao imediata.
      const startedAt = Date.now();
      let signedPdfAfterErasureHttp = 0;
      let signedPdfCacheStatus = '';
      let signedPdfStillServesContent = true;
      let signedPdfInvalidatedAfterMs: number | null = null;
      while (Date.now() - startedAt < 120_000) {
        const probe = await ownerContext.request.get(signedUrl);
        signedPdfAfterErasureHttp = probe.status();
        signedPdfCacheStatus = probe.headers()['cf-cache-status'] ?? '';
        const body = await probe.body();
        await probe.dispose();
        signedPdfStillServesContent =
          signedPdfAfterErasureHttp === 200 && body.subarray(0, 4).toString('ascii') === '%PDF';
        if (!signedPdfStillServesContent) {
          signedPdfInvalidatedAfterMs = Date.now() - startedAt;
          break;
        }
        await ownerPage.waitForTimeout(5_000);
      }
      expect(signedPdfStillServesContent).toBe(false);

      await ownerPage.goto(`/pacientes/${retainedPatientId}`);
      await expect(ownerPage.getByText('Página não encontrada', { exact: true })).toBeVisible();
      await ownerPage.goto(`/pacientes/${physicalPatientId}`);
      await expect(ownerPage.getByText('Página não encontrada', { exact: true })).toBeVisible();

      console.log(
        `[lgpd-lifecycle-a] ${JSON.stringify({
          sameFixtureExported: true,
          softDeleteHiddenFromUi: true,
          retentionAcceleratedForSyntheticIdsOnly: true,
          oldestEligibleExactlyMatched: true,
          hardDelete: hardDeleteResult,
          physicalPatientRows: postState!.physical_rows,
          anonymizedPatientRows: postState!.retained_anonymized,
          retainedClinicalRows: postState!.retained_clinical_rows,
          completedDeleteRequests: postState!.completed_delete_requests,
          auditPiiKeys: postState!.audit_pii_keys,
          outboxPiiRows: postState!.outbox_pii_rows,
          outboxRowsForPatients: postState!.outbox_rows_for_patients,
          signedPdfAfterErasureHttp,
          signedPdfCacheStatus,
          signedPdfStillServesContent,
          signedPdfInvalidatedAfterMs,
          exportArtifactsPurged: true,
          result: 'functional-pass-without-residual-pii',
        })}`,
      );
    } finally {
      const patientIds = [retainedPatientId, physicalPatientId].filter(
        (id): id is string => typeof id === 'string',
      );
      if (storagePaths.length > 0) {
        const removed = await admin.storage.from('lgpd-exports').remove([...new Set(storagePaths)]);
        if (removed.error) throw new Error('Cleanup dos artefatos LGPD falhou.');
      }
      if (clinicId && patientIds.length > 0) {
        const cleanup = await sql.begin(async (tx) => {
          await tx.unsafe('RESET ROLE');
          const outbox = await tx<{ id: string }[]>`
            delete from outbox
             where clinic_id = ${clinicId!}::uuid
               and payload ->> 'patientId' = any(${patientIds}::text[])
            returning id::text
          `;
          const audits = await tx<{ id: string }[]>`
            delete from audit_events
             where clinic_id = ${clinicId!}::uuid
               and (resource_id = any(${[
                 ...patientIds,
                 ...(prontuarioId ? [prontuarioId] : []),
               ]}::text[])
                 or coalesce(before::text, '') like ${`%${marker}%`}
                 or coalesce(after::text, '') like ${`%${marker}%`})
            returning id::text
          `;
          const idempotency =
            idempotencyKeys.length > 0
              ? await (async () => {
                  // O hard-delete zera a response das chaves que retornavam o
                  // paciente. O trigger interpreta response=NULL como in-flight;
                  // para cleanup exclusivo da fixture, aplica o mesmo sentinel
                  // diagnóstico usado pelos smokes antes do DELETE.
                  await tx`
                    update idempotency_keys
                       set response = '{"cleanup":true,"reason":"synthetic_lgpd_fixture"}'::jsonb
                     where clinic_id = ${clinicId!}::uuid
                       and key in ${tx([...new Set(idempotencyKeys)])}
                       and response is null
                       and status_code = 200
                  `;
                  return tx<{ key: string }[]>`
                    delete from idempotency_keys
                     where clinic_id = ${clinicId!}::uuid
                       and key in ${tx([...new Set(idempotencyKeys)])}
                    returning key
                  `;
                })()
              : [];
          const prontuarios = prontuarioId
            ? await tx<{ id: string }[]>`
                delete from prontuarios
                 where id = ${prontuarioId}::uuid
                   and clinic_id = ${clinicId!}::uuid
                   and patient_id = ${retainedPatientId!}::uuid
                returning id::text
              `
            : [];
          const requests = await tx<{ id: string }[]>`
            delete from lgpd_requests
             where clinic_id = ${clinicId!}::uuid
               and patient_id = any(${patientIds}::uuid[])
            returning id::text
          `;
          const suppressions =
            suppressionHashes.length > 0
              ? await tx<{ contact_hash: string }[]>`
                  delete from suppression_list
                   where clinic_id = ${clinicId!}::uuid
                     and reason = 'lgpd_delete'
                     and contact_hash = any(${[...new Set(suppressionHashes)]}::text[])
                  returning contact_hash
                `
              : [];
          const patients = await tx<{ id: string }[]>`
            delete from patients
             where clinic_id = ${clinicId!}::uuid
               and id = any(${patientIds}::uuid[])
               and (nome like ${`${marker}%`} or nome = 'Paciente anonimizado (LGPD)')
            returning id::text
          `;
          const [remaining] = await tx<
            {
              patients: number;
              requests: number;
              outbox: number;
              prontuarios: number;
              audit: number;
            }[]
          >`
            select
              (select count(*)::int from patients where id = any(${patientIds}::uuid[])) patients,
              (select count(*)::int from lgpd_requests where patient_id = any(${patientIds}::uuid[])) requests,
              (select count(*)::int from outbox where payload ->> 'patientId' = any(${patientIds}::text[])) outbox,
              (select count(*)::int from prontuarios where patient_id = any(${patientIds}::uuid[])) prontuarios,
              (select count(*)::int
                 from audit_events
                where clinic_id = ${clinicId!}::uuid
                  and resource_id = any(${patientIds}::text[])) audit
          `;
          return {
            outbox: outbox.length,
            audits: audits.length,
            idempotency: idempotency.length,
            prontuarios: prontuarios.length,
            requests: requests.length,
            suppressions: suppressions.length,
            patients: patients.length,
            remaining,
          };
        });
        expect(cleanup.remaining).toEqual({
          patients: 0,
          requests: 0,
          outbox: 0,
          prontuarios: 0,
          audit: 0,
        });
        console.log(`[lgpd-lifecycle-a-cleanup] ${JSON.stringify(cleanup)}`);
      }
      await ownerContext.close();
      await doctorContext.close();
      await sql.end();
    }
  });
});
