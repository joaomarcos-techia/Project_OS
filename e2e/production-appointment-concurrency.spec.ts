import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized =
  process.env.E2E_PRODUCTION_SCHEDULING_CONCURRENCY === 'ALLOW_SYNTHETIC_APPOINTMENT';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_TENANT_B_EMAIL;
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

function futureDate(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

async function createPatient(
  page: Page,
  input: { name: string; cpf: string; email: string },
): Promise<string> {
  await page.goto('/pacientes?novo=1');
  const drawer = page.getByRole('dialog', { name: 'Novo paciente' });
  await expect(drawer).toBeVisible();
  await drawer.locator('input[name="nome"]').fill(input.name);
  await drawer.locator('input[name="cpf"]').fill(input.cpf);
  await drawer.locator('input[name="email"]').fill(input.email);
  await drawer.getByRole('button', { name: 'Criar paciente' }).click();
  await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/u, { timeout: 90_000 });
  const id = new URL(page.url()).pathname.split('/').at(-1);
  if (!id || !/^[0-9a-f-]{36}$/iu.test(id)) throw new Error('Paciente sintético sem ID válido.');
  return id;
}

async function prepareAppointment(
  page: Page,
  input: { patientName: string; procedureName: string; date: string; time: string },
): Promise<ReturnType<Page['getByRole']>> {
  await page.goto('/agenda');
  await page.getByRole('button', { name: 'Novo atendimento' }).click();
  const drawer = page.getByRole('dialog', { name: 'Novo atendimento' });
  await expect(drawer).toBeVisible();
  await drawer.getByPlaceholder('Buscar por nome (mín. 2 letras)').fill(input.patientName);
  await drawer.getByRole('option', { name: input.patientName, exact: true }).click();
  await drawer.getByLabel('Procedimento', { exact: true }).selectOption({
    label: input.procedureName,
  });
  const doctorSelect = drawer.getByLabel('Profissional', { exact: true });
  if ((await doctorSelect.count()) > 0) await doctorSelect.selectOption({ index: 1 });
  await drawer.getByLabel('Data', { exact: true }).fill(input.date);
  await drawer.getByLabel('Hora', { exact: true }).fill(input.time);
  return drawer.getByRole('button', { name: 'Agendar', exact: true });
}

test.describe('produção: concorrência de agenda', () => {
  test.describe.configure({ retries: 0 });

  test('impede double booking simultâneo para o mesmo profissional e horário', async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    test.skip(
      !authorized,
      'Exige E2E_PRODUCTION_SCHEDULING_CONCURRENCY=ALLOW_SYNTHETIC_APPOINTMENT.',
    );
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de concorrência só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !sharedPassword) throw new Error('Credencial do owner B ausente.');
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const sql = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
    const context = await browser.newContext({ baseURL: baseUrl });
    const setupPage = await context.newPage();
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-RACE-${runId}]`;
    const patientNames = [`${marker}-PATIENT-A`, `${marker}-PATIENT-B`] as const;
    const patientEmails = [
      `e2e-race-${runId}-a@example.test`,
      `e2e-race-${runId}-b@example.test`,
    ] as const;
    const procedureCode = `RACE${runId}`;
    const procedureName = `${marker}-PROCEDURE`;
    const appointmentDate = futureDate(28);
    const appointmentTime = '13:47';
    let clinicId: string | undefined;

    try {
      const [identity] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ clinic_id: string }[]>`
          select p.clinic_id::text
            from auth.users u
            join profiles p on p.id = u.id
           where lower(u.email) = ${ownerEmail.toLowerCase()}
             and p.role = 'owner'
             and p.ativo = true
             and p.deleted_at is null
             and p.invite_accepted_at is not null
             and (p.role = 'doctor' or nullif(btrim(p.crm), '') is not null)
        `;
      });
      if (!identity) throw new Error('Owner B não está apto como profissional.');
      clinicId = identity.clinic_id;

      await signInContext(context, ownerEmail, sharedPassword);
      await createPatient(setupPage, {
        name: patientNames[0],
        cpf: validCpf(`${runId}1`),
        email: patientEmails[0],
      });
      await createPatient(setupPage, {
        name: patientNames[1],
        cpf: validCpf(`${runId}2`),
        email: patientEmails[1],
      });

      await setupPage.goto('/configuracoes/procedimentos');
      await setupPage.getByRole('button', { name: 'Novo procedimento' }).click();
      await setupPage.getByPlaceholder('Código * (ex: CONS)').fill(procedureCode);
      await setupPage.getByPlaceholder('Descrição * (ex: Consulta)').fill(procedureName);
      await setupPage.getByPlaceholder('0,00').fill('10,00');
      await setupPage.getByPlaceholder('30').fill('30');
      await setupPage.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect(setupPage.getByText('Procedimento salvo.', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      const pageA = setupPage;
      const pageB = await context.newPage();
      const [submitA, submitB] = await Promise.all([
        prepareAppointment(pageA, {
          patientName: patientNames[0],
          procedureName,
          date: appointmentDate,
          time: appointmentTime,
        }),
        prepareAppointment(pageB, {
          patientName: patientNames[1],
          procedureName,
          date: appointmentDate,
          time: appointmentTime,
        }),
      ]);

      const requestTimes: number[] = [];
      for (const page of [pageA, pageB]) {
        page.on('request', (request) => {
          if (request.method() === 'POST' && request.headers()['next-action']) {
            requestTimes.push(Date.now());
          }
        });
      }
      const responseA = pageA.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          Boolean(response.request().headers()['next-action']),
      );
      const responseB = pageB.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          Boolean(response.request().headers()['next-action']),
      );
      await Promise.all([submitA.click(), submitB.click()]);
      const [actionResponseA, actionResponseB] = await Promise.all([responseA, responseB]);
      const statuses = [actionResponseA.status(), actionResponseB.status()];
      expect(statuses.every((status) => status < 500)).toBe(true);
      const conflictAlert = (page: Page) =>
        page
          .getByRole('alert')
          .filter({ hasText: /Já existe um atendimento nesse horário para este profissional/iu });
      await expect
        .poll(
          async () =>
            Number(
              await conflictAlert(pageA)
                .isVisible()
                .catch(() => false),
            ) +
            Number(
              await conflictAlert(pageB)
                .isVisible()
                .catch(() => false),
            ),
          { timeout: 30_000, intervals: [100, 250, 500] },
        )
        .toBe(1);
      const pageAConflict = await conflictAlert(pageA).isVisible();
      const conflictPage = pageAConflict ? pageA : pageB;
      const successPage = pageAConflict ? pageB : pageA;
      await expect(conflictAlert(conflictPage)).toBeVisible({ timeout: 30_000 });
      await expect(successPage.getByRole('dialog', { name: 'Novo atendimento' })).toBeHidden({
        timeout: 30_000,
      });
      expect(requestTimes).toHaveLength(2);
      const dispatchSkewMs = Math.abs(requestTimes[0]! - requestTimes[1]!);
      expect(dispatchSkewMs).toBeLessThan(5_000);

      const evidence = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const appointments = await tx<{ id: string; status: string; patient_id: string }[]>`
          select a.id::text, a.status::text, a.patient_id::text
            from appointments a
            join procedures p on p.id = a.procedure_id
           where a.clinic_id = ${clinicId!}::uuid
             and p.codigo = ${procedureCode}
        `;
        const appointmentIds = appointments.map(({ id }) => id);
        const [stateLog] = await tx<{ n: number }[]>`
          select count(*)::int as n
            from appointment_state_log
           where clinic_id = ${clinicId!}::uuid
             and appointment_id::text = any(${appointmentIds}::text[])
        `;
        const [audit] = await tx<{ n: number }[]>`
          select count(*)::int as n
            from audit_events
           where clinic_id = ${clinicId!}::uuid
             and action = 'scheduling.appointment.created'
             and after ->> 'id' = any(${appointmentIds}::text[])
        `;
        const [outbox] = await tx<{ n: number }[]>`
          select count(*)::int as n
            from outbox
           where clinic_id = ${clinicId!}::uuid
             and event_type = 'scheduling.appointment.created'
             and payload ->> 'appointmentId' = any(${appointmentIds}::text[])
        `;
        const [idempotency] = await tx<{ n: number }[]>`
          select count(*)::int as n
            from idempotency_keys
           where clinic_id = ${clinicId!}::uuid
             and response ->> 'id' = any(${appointmentIds}::text[])
        `;
        return {
          appointmentCount: appointments.length,
          activeAppointmentCount: appointments.filter(({ status }) => status === 'agendado').length,
          stateLogCount: stateLog?.n ?? -1,
          auditCount: audit?.n ?? -1,
          outboxCount: outbox?.n ?? -1,
          idempotencyCount: idempotency?.n ?? -1,
        };
      });
      expect(evidence).toEqual({
        appointmentCount: 1,
        activeAppointmentCount: 1,
        stateLogCount: 1,
        auditCount: 1,
        outboxCount: 1,
        idempotencyCount: 1,
      });

      console.log(
        `[appointment-concurrency] ${JSON.stringify({
          concurrentRequests: 2,
          dispatchSkewMs,
          statuses,
          outcomes: ['conflict', 'success'],
          ...evidence,
          result: 'single-winner-conflict-rejected',
        })}`,
      );
    } finally {
      if (clinicId) {
        const cleanup = await sql.begin(async (tx) => {
          await tx.unsafe('RESET ROLE');
          const patients = await tx<{ id: string }[]>`
            select id::text
              from patients
             where clinic_id = ${clinicId!}::uuid
               and email = any(${patientEmails}::text[])
               and nome like ${`${marker}%`}
          `;
          const procedures = await tx<{ id: string }[]>`
            select id::text
              from procedures
             where clinic_id = ${clinicId!}::uuid
               and codigo = ${procedureCode}
               and descricao = ${procedureName}
          `;
          const patientIds = patients.map(({ id }) => id);
          const procedureIds = procedures.map(({ id }) => id);
          const appointments = await tx<{ id: string }[]>`
            select id::text
              from appointments
             where clinic_id = ${clinicId!}::uuid
               and (
                 patient_id::text = any(${patientIds}::text[])
                 or procedure_id::text = any(${procedureIds}::text[])
               )
          `;
          const appointmentIds = appointments.map(({ id }) => id);
          const allResourceIds = [...patientIds, ...procedureIds, ...appointmentIds];

          const removedOutbox = await tx<{ id: string }[]>`
            delete from outbox
             where clinic_id = ${clinicId!}::uuid
               and (
                 (event_type = 'patient.core.created'
                  and payload ->> 'patientId' = any(${patientIds}::text[]))
                 or
                 (event_type = 'scheduling.appointment.created'
                  and payload ->> 'appointmentId' = any(${appointmentIds}::text[]))
               )
            returning id::text
          `;
          const removedLedger = await tx<{ period_yyyymm: string }[]>`
            delete from usage_counter_ledger
             where clinic_id = ${clinicId!}::uuid
               and metric = 'agendamentos'
               and dedup_key = any(${appointmentIds}::text[])
            returning period_yyyymm
          `;
          const ledgerByPeriod = new Map<string, number>();
          for (const { period_yyyymm: period } of removedLedger) {
            ledgerByPeriod.set(period, (ledgerByPeriod.get(period) ?? 0) + 1);
          }
          for (const [period, count] of ledgerByPeriod) {
            await tx`
              update usage_metrics
                 set agendamentos_count = greatest(0, agendamentos_count - ${count}),
                     updated_at = now()
               where clinic_id = ${clinicId!}::uuid
                 and period_yyyymm = ${period}
            `;
          }
          const removedAudit = await tx<{ id: string }[]>`
            delete from audit_events
             where clinic_id = ${clinicId!}::uuid
               and action in ('patient.core.created', 'procedure.created', 'scheduling.appointment.created')
               and (after ->> 'id' = any(${allResourceIds}::text[])
                    or resource_id = any(${allResourceIds}::text[]))
            returning id::text
          `;
          const removedIdempotency = await tx<{ key: string }[]>`
            delete from idempotency_keys
             where clinic_id = ${clinicId!}::uuid
               and response ->> 'id' = any(${allResourceIds}::text[])
            returning key
          `;
          const removedAppointments = await tx<{ id: string }[]>`
            delete from appointments
             where clinic_id = ${clinicId!}::uuid
               and id::text = any(${appointmentIds}::text[])
            returning id::text
          `;
          const removedProcedures = await tx<{ id: string }[]>`
            delete from procedures
             where clinic_id = ${clinicId!}::uuid
               and id::text = any(${procedureIds}::text[])
            returning id::text
          `;
          const removedPatients = await tx<{ id: string }[]>`
            delete from patients
             where clinic_id = ${clinicId!}::uuid
               and id::text = any(${patientIds}::text[])
            returning id::text
          `;
          const [remaining] = await tx<
            {
              patients: number;
              procedures: number;
              appointments: number;
              outbox: number;
              ledger: number;
            }[]
          >`
            select
              (select count(*)::int from patients
                where clinic_id = ${clinicId!}::uuid and email = any(${patientEmails}::text[])) patients,
              (select count(*)::int from procedures
                where clinic_id = ${clinicId!}::uuid and codigo = ${procedureCode}) procedures,
              (select count(*)::int from appointments
                where clinic_id = ${clinicId!}::uuid
                  and (patient_id::text = any(${patientIds}::text[])
                       or procedure_id::text = any(${procedureIds}::text[]))) appointments,
              (select count(*)::int from outbox
                where clinic_id = ${clinicId!}::uuid
                  and (payload ->> 'patientId' = any(${patientIds}::text[])
                       or payload ->> 'appointmentId' = any(${appointmentIds}::text[]))) outbox,
              (select count(*)::int from usage_counter_ledger
                where clinic_id = ${clinicId!}::uuid
                  and dedup_key = any(${appointmentIds}::text[])) ledger
          `;
          return {
            outbox: removedOutbox.length,
            ledger: removedLedger.length,
            audit: removedAudit.length,
            idempotency: removedIdempotency.length,
            appointments: removedAppointments.length,
            procedures: removedProcedures.length,
            patients: removedPatients.length,
            remaining,
          };
        });
        console.log(`[appointment-concurrency-cleanup] ${JSON.stringify(cleanup)}`);
        expect(cleanup.remaining).toEqual({
          patients: 0,
          procedures: 0,
          appointments: 0,
          outbox: 0,
          ledger: 0,
        });
      }
      await context.close();
      await sql.end();
    }
  });
});
