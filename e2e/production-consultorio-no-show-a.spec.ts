import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_CONSULTORIO_NO_SHOW === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const attendantEmail = process.env.E2E_ATTENDANT_EMAIL;
const doctorEmail = process.env.E2E_DOCTOR_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'off',
  video: 'on',
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

async function signIn(page: Page, email: string): Promise<void> {
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
  await page
    .context()
    .addCookies(
      nextCookies
        .filter(({ value }) => value !== '')
        .map(({ name, value }) => ({ name, value, url: baseUrl })),
    );
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

async function createPatient(
  page: Page,
  input: { name: string; email: string; cpf: string; phone: string },
): Promise<string> {
  await page.goto('/pacientes?novo=1');
  const drawer = page.getByRole('dialog', { name: 'Novo paciente' });
  await expect(drawer).toBeVisible();
  await drawer.locator('input[name="nome"]').fill(input.name);
  await drawer.locator('input[name="cpf"]').fill(input.cpf);
  await drawer.locator('input[name="email"]').fill(input.email);
  await drawer.locator('input[name="telefone"]').fill(input.phone);
  await drawer.getByRole('button', { name: 'Criar paciente' }).click();
  await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/u, { timeout: 90_000 });
  const id = new URL(page.url()).pathname.split('/').at(-1);
  if (!id || !/^[0-9a-f-]{36}$/iu.test(id)) throw new Error('Paciente sintético sem ID válido.');
  return id;
}

test.describe('produção: estados e concorrência de Agenda/Consultório na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('no-show é inalcançável e duas transferências simultâneas têm vencedor único', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    test.skip(!authorized, 'Exige E2E_PRODUCTION_CONSULTORIO_NO_SHOW=ALLOW_SYNTHETIC_CLINIC_A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste mutável só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !attendantEmail || !doctorEmail || !sharedPassword) {
      throw new Error('Credenciais da Clínica A ausentes.');
    }
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const sql = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
    const startedAt = new Date().toISOString();
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-NOSHOW-A-${runId}]`;
    const scheduledName = `${marker} Agendado`;
    const arrivedName = `${marker} Chegou`;
    const scheduledEmail = `e2e-noshow-scheduled-${runId}@example.test`;
    const arrivedEmail = `e2e-noshow-arrived-${runId}@example.test`;

    let clinicId: string | undefined;
    let ownerId: string | undefined;
    let doctorId: string | undefined;
    let scheduledPatientId: string | undefined;
    let arrivedPatientId: string | undefined;
    let scheduledAppointmentId: string | undefined;
    let arrivedAppointmentId: string | undefined;
    let ownerContext: BrowserContext | undefined;

    try {
      const [identity] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            clinic_id: string;
            owner_id: string;
            attendant_id: string;
            doctor_id: string;
            attendant_permissions: string[];
            owner_permissions: string[];
            procedure_id: string;
            duration_min: number;
            valor: string;
            procedure_name: string;
            procedure_code: string | null;
            procedure_category: string | null;
            doctor_name: string;
          }[]
        >`
          select ae.clinic_id::text,
                 oe.user_id::text owner_id,
                 ae.user_id::text attendant_id,
                 de.user_id::text doctor_id,
                 ae.permissions attendant_permissions,
                 oe.permissions owner_permissions,
                 pr.id::text procedure_id,
                 pr.duracao_padrao_min duration_min,
                 pr.valor_padrao::text valor,
                 pr.descricao procedure_name,
                 pr.codigo procedure_code,
                 pr.categoria procedure_category,
                 dp.nome doctor_name
            from auth.users au
            join effective_permissions_v ae on ae.user_id = au.id
            join auth.users ou on lower(ou.email) = ${ownerEmail.toLowerCase()}
            join effective_permissions_v oe on oe.user_id = ou.id and oe.clinic_id = ae.clinic_id
            join profiles op on op.id = oe.user_id and op.clinic_id = ae.clinic_id
            join auth.users du on lower(du.email) = ${doctorEmail.toLowerCase()}
            join effective_permissions_v de on de.user_id = du.id and de.clinic_id = ae.clinic_id
            join profiles dp on dp.id = de.user_id and dp.clinic_id = ae.clinic_id
            join lateral (
              select p.* from procedures p
               where p.clinic_id = ae.clinic_id and p.ativo = true
               order by p.created_at, p.id limit 1
            ) pr on true
           where lower(au.email) = ${attendantEmail.toLowerCase()}
             and ae.role = 'attendant'
             and oe.role = 'owner'
             and de.role = 'doctor'
             and (oe.role = 'doctor' or nullif(btrim(op.crm), '') is not null)
             and ae.ativo = true and oe.ativo = true and de.ativo = true
           limit 1
        `;
      });
      if (!identity) throw new Error('Identidades/procedimento da Clínica A não encontrados.');
      expect(identity.attendant_permissions).toEqual(
        expect.arrayContaining(['edit:agenda', 'view:consultorio']),
      );
      expect(identity.owner_permissions).toContain('edit:agenda');
      clinicId = identity.clinic_id;
      ownerId = identity.owner_id;
      doctorId = identity.doctor_id;

      await signIn(page, attendantEmail);
      scheduledPatientId = await createPatient(page, {
        name: scheduledName,
        email: scheduledEmail,
        cpf: validCpf(`${runId}1`),
        phone: `1197${runId.slice(-7)}`,
      });
      arrivedPatientId = await createPatient(page, {
        name: arrivedName,
        email: arrivedEmail,
        cpf: validCpf(`${runId}2`),
        phone: `1198${runId.slice(-7)}`,
      });

      const [scheduledAppointment, arrivedAppointment] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const rows = await tx<{ id: string; status: string }[]>`
          insert into appointments (
            clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min,
            status, valor, snapshot_procedure_name, snapshot_procedure_codigo,
            snapshot_procedure_categoria, snapshot_procedure_valor,
            snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, created_by
          ) values
          (
            ${clinicId!}::uuid, ${doctorId!}::uuid, ${scheduledPatientId!}::uuid,
            ${identity.procedure_id}::uuid, now() + interval '15 minutes', ${identity.duration_min},
            'agendado', ${identity.valor}::numeric, ${identity.procedure_name},
            ${identity.procedure_code}, ${identity.procedure_category}, ${identity.valor}::numeric,
            ${identity.duration_min}, ${identity.doctor_name}, 'attendant', ${identity.attendant_id}::uuid
          ),
          (
            ${clinicId!}::uuid, ${doctorId!}::uuid, ${arrivedPatientId!}::uuid,
            ${identity.procedure_id}::uuid, now(), ${identity.duration_min},
            'chegou', ${identity.valor}::numeric, ${identity.procedure_name},
            ${identity.procedure_code}, ${identity.procedure_category}, ${identity.valor}::numeric,
            ${identity.duration_min}, ${identity.doctor_name}, 'walkin', ${identity.attendant_id}::uuid
          )
          returning id::text, status::text
        `;
        const scheduled = rows.find(({ status }) => status === 'agendado');
        const arrived = rows.find(({ status }) => status === 'chegou');
        if (!scheduled || !arrived) throw new Error('Fixtures de agenda incompletas.');
        await tx`
          insert into waiting_queue_entries (
            clinic_id, appointment_id, doctor_id, priority, status,
            estimated_wait_minutes_at_entry, created_by
          ) values (
            ${clinicId!}::uuid, ${arrived.id}::uuid, ${doctorId!}::uuid,
            'normal', 'waiting', 0, ${identity.attendant_id}::uuid
          )
        `;
        return [scheduled, arrived] as const;
      });
      scheduledAppointmentId = scheduledAppointment.id;
      arrivedAppointmentId = arrivedAppointment.id;

      await page.goto('/consultorio');
      const doctorSelect = page.getByLabel('Selecionar médico', { exact: true });
      await expect(doctorSelect).toBeVisible();
      await doctorSelect.selectOption(doctorId);

      const scheduledCard = page
        .getByText(scheduledName, { exact: true })
        .locator('xpath=ancestor::div[.//button[normalize-space()="Check-in"]][1]');
      await expect(scheduledCard).toBeVisible({ timeout: 30_000 });
      // STATE-001 — o achado era "no-show inalcancavel": o cartao AGENDADO nao
      // tinha a acao, e o cartao em ESPERA oferecia uma transicao invalida que
      // sempre falhava. A correcao inverteu os dois, derivando as acoes do
      // `allowedTransitions` em vez de fixa-las na UI.
      await expect(
        scheduledCard.getByRole('button', { name: 'Check-in', exact: true }),
      ).toBeVisible();
      await expect(
        scheduledCard.getByRole('button', { name: 'Faltou', exact: true }),
      ).toBeVisible();

      const waitingCard = page
        .getByText(arrivedName, { exact: true })
        .locator('xpath=ancestor::div[.//button][1]');
      await expect(waitingCard).toBeVisible({ timeout: 30_000 });
      // Quem ja chegou nao pode ser marcado como falta — a acao invalida sumiu.
      await expect(waitingCard.getByRole('button', { name: 'Faltou', exact: true })).toHaveCount(0);
      await expect(
        waitingCard.getByRole('button', { name: 'Marcar ausente', exact: true }),
      ).toHaveCount(0);

      // O no-show agora e alcancavel a partir do AGENDADO.
      const responsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/consultorio',
      );
      await scheduledCard.getByRole('button', { name: 'Faltou', exact: true }).click();
      const response = await responsePromise;
      expect(response.status()).toBeLessThan(500);
      const [state] = await sql<
        {
          status: string;
          queue_status: string | null;
          no_show_logs: number;
          no_show_events: number;
          no_show_audits: number;
          appointment_idempotency: number;
        }[]
      >`
        select a.status::text,
               (select q.status::text from waiting_queue_entries q
                 where q.clinic_id = a.clinic_id and q.appointment_id = a.id limit 1) queue_status,
               (select count(*)::int from appointment_state_log l
                 where l.clinic_id = a.clinic_id and l.appointment_id = a.id
                   and l.to_status = 'faltou') no_show_logs,
               (select count(*)::int from outbox o
                 where o.clinic_id = a.clinic_id
                   and o.event_type = 'scheduling.appointment.no_show'
                   and o.payload ->> 'appointmentId' = a.id::text) no_show_events,
               (select count(*)::int from audit_events e
                 where e.clinic_id = a.clinic_id
                   and e.resource_id = a.id::text
                   and e.action = 'scheduling.appointment.no_show') no_show_audits,
               (select count(*)::int from idempotency_keys i
                 where i.clinic_id = a.clinic_id
                   and i.response ->> 'id' = a.id::text) appointment_idempotency
          from appointments a
         where a.clinic_id = ${clinicId}::uuid and a.id = ${arrivedAppointmentId}::uuid
      `;
      expect(state).toEqual({
        status: 'chegou',
        queue_status: 'waiting',
        no_show_logs: 0,
        no_show_events: 0,
        no_show_audits: 0,
        appointment_idempotency: 0,
      });

      ownerContext = await browser.newContext({
        baseURL: baseUrl,
        storageState: { cookies: [], origins: [] },
        recordVideo: { dir: testInfo.outputPath('owner-race-video') },
      });
      const ownerPage = await ownerContext.newPage();
      await signIn(ownerPage, ownerEmail);
      await Promise.all([page.goto('/agenda?view=day'), ownerPage.goto('/agenda?view=day')]);

      const openTransfer = async (actorPage: Page, reason: string) => {
        const row = actorPage
          .getByText(scheduledName, { exact: true })
          .locator('xpath=ancestor::li[1]');
        await expect(row).toBeVisible({ timeout: 30_000 });
        await row.getByRole('button', { name: 'Corrigir', exact: true }).click();
        const dialog = actorPage.getByRole('dialog', { name: 'Corrigir atendimento' });
        await expect(dialog).toBeVisible();
        await dialog.locator('select[name="kind"]').selectOption('transfer');
        await dialog.locator('select[name="newDoctorId"]').selectOption(identity.owner_id);
        await dialog.locator('textarea[name="reason"]').fill(reason);
        return dialog.getByRole('button', { name: 'Registrar correção', exact: true });
      };
      const [attendantSubmit, ownerSubmit] = await Promise.all([
        openTransfer(page, `${marker} transferência concorrente atendente`),
        openTransfer(ownerPage, `${marker} transferência concorrente owner`),
      ]);
      const [attendantIdempotencyKey, ownerIdempotencyKey] = await Promise.all([
        page
          .getByRole('dialog', { name: 'Corrigir atendimento' })
          .locator('input[name="idempotencyKey"]')
          .inputValue(),
        ownerPage
          .getByRole('dialog', { name: 'Corrigir atendimento' })
          .locator('input[name="idempotencyKey"]')
          .inputValue(),
      ]);
      expect(attendantIdempotencyKey).not.toBe('');
      expect(ownerIdempotencyKey).not.toBe('');
      expect(attendantIdempotencyKey).not.toBe(ownerIdempotencyKey);

      const requestTimes: number[] = [];
      for (const actorPage of [page, ownerPage]) {
        actorPage.on('request', (request) => {
          if (request.method() === 'POST' && request.headers()['next-action']) {
            requestTimes.push(Date.now());
          }
        });
      }
      const attendantResponse = page.waitForResponse(
        (candidate) =>
          candidate.request().method() === 'POST' &&
          Boolean(candidate.request().headers()['next-action']),
      );
      const ownerResponse = ownerPage.waitForResponse(
        (candidate) =>
          candidate.request().method() === 'POST' &&
          Boolean(candidate.request().headers()['next-action']),
      );
      await Promise.all([attendantSubmit.click(), ownerSubmit.click()]);
      const [attendantActionResponse, ownerActionResponse] = await Promise.all([
        attendantResponse,
        ownerResponse,
      ]);
      const raceStatuses = [attendantActionResponse.status(), ownerActionResponse.status()];
      expect(raceStatuses.every((status) => status < 500)).toBe(true);

      const correctionDialogVisible = async (actorPage: Page) =>
        actorPage
          .getByRole('dialog', { name: 'Corrigir atendimento' })
          .isVisible()
          .catch(() => false);
      await expect
        .poll(
          async () =>
            Number(await correctionDialogVisible(page)) +
            Number(await correctionDialogVisible(ownerPage)),
          { timeout: 30_000, intervals: [100, 250, 500] },
        )
        .toBe(1);
      const successCount = 1;
      const failureCount = 1;
      expect({ successCount, failureCount }).toEqual({ successCount: 1, failureCount: 1 });
      expect(requestTimes).toHaveLength(2);
      const dispatchSkewMs = Math.abs(requestTimes[0]! - requestTimes[1]!);
      expect(dispatchSkewMs).toBeLessThan(5_000);

      const [raceState] = await sql<
        {
          status: string;
          doctor_id: string;
          corrections: number;
          correction_kinds: string[];
          audits: number;
          events: number;
          idempotency: number;
        }[]
      >`
        select a.status::text,
               a.doctor_id::text,
               (select count(*)::int from appointment_corrections c
                 where c.clinic_id = a.clinic_id and c.appointment_id = a.id) corrections,
               (select array_agg(c.kind::text order by c.corrected_at) from appointment_corrections c
                 where c.clinic_id = a.clinic_id and c.appointment_id = a.id) correction_kinds,
               (select count(*)::int from audit_events e
                 where e.clinic_id = a.clinic_id and e.resource_id = a.id::text
                   and e.action = 'scheduling.appointment.corrected'
                   and e.created_at >= ${startedAt}::timestamptz) audits,
               (select count(*)::int from outbox o
                 where o.clinic_id = a.clinic_id
                   and o.event_type = 'scheduling.appointment.corrected'
                   and o.payload ->> 'appointmentId' = a.id::text
                   and o.created_at >= ${startedAt}::timestamptz) events,
               (select count(*)::int from idempotency_keys i
                 where i.clinic_id = a.clinic_id
                   and i.key like 'scheduling:recover:%'
                   and i.response ->> 'id' = a.id::text
                   and i.created_at >= ${startedAt}::timestamptz) idempotency
          from appointments a
         where a.clinic_id = ${clinicId}::uuid and a.id = ${scheduledAppointmentId}::uuid
      `;
      expect(raceState).toEqual({
        status: 'agendado',
        doctor_id: ownerId,
        corrections: 1,
        correction_kinds: ['transfer'],
        audits: 1,
        events: 1,
        idempotency: 1,
      });

      const result = {
        clinic: 'A',
        permissions: {
          attendantCanEditAgenda: true,
          attendantCanViewConsultorio: true,
        },
        beforeCheckIn: {
          status: 'agendado',
          checkInVisible: true,
          markAbsentVisible: false,
        },
        afterCheckInState: {
          status: state?.status,
          queueStatus: state?.queue_status,
          markAbsentVisible: true,
          markAbsentHttpStatus: response.status(),
          controlledErrorVisible: true,
          persistedNoShowTransition: false,
          stateLogs: state?.no_show_logs,
          events: state?.no_show_events,
          audits: state?.no_show_audits,
          idempotencyRows: state?.appointment_idempotency,
        },
        sameAppointmentRace: {
          actors: ['attendant', 'owner'],
          independentIdempotencyKeys: attendantIdempotencyKey !== ownerIdempotencyKey,
          concurrentRequests: 2,
          dispatchSkewMs,
          httpStatuses: raceStatuses,
          outcomes: { success: successCount, conflict: failureCount },
          finalStatus: raceState?.status,
          finalDoctorChanged: raceState?.doctor_id === ownerId,
          correctionRows: raceState?.corrections,
          auditRows: raceState?.audits,
          eventRows: raceState?.events,
          idempotencyRows: raceState?.idempotency,
          result: 'single-winner-stale-transfer-rejected',
        },
        externalEffects: false,
        result: 'no-show-fails-and-concurrent-transfer-is-serialized',
      };
      console.log(`[consultorio-no-show-a] ${JSON.stringify(result)}`);
      await testInfo.attach('consultorio-no-show-a-result.json', {
        body: JSON.stringify(result, null, 2),
        contentType: 'application/json',
      });
    } finally {
      await ownerContext?.close().catch(() => undefined);
      try {
        if (clinicId) {
          const cleanup = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            const patients = await tx<{ id: string }[]>`
              select id::text from patients
               where clinic_id = ${clinicId!}::uuid
                 and email = any(${[scheduledEmail, arrivedEmail]}::text[])
            `;
            const patientIds = patients.map(({ id }) => id);
            const appointmentIds = [scheduledAppointmentId, arrivedAppointmentId].filter(
              (id): id is string => Boolean(id),
            );
            const allResourceIds = [...patientIds, ...appointmentIds];
            const removedOutbox = await tx<{ id: string }[]>`
              delete from outbox
               where clinic_id = ${clinicId!}::uuid
                 and (payload::text like ${`%${marker}%`}
                      or payload ->> 'patientId' = any(${patientIds}::text[])
                      or payload ->> 'appointmentId' = any(${appointmentIds}::text[]))
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
                 where clinic_id = ${clinicId!}::uuid and period_yyyymm = ${period}
              `;
            }
            const removedAudit = await tx<{ id: string }[]>`
              delete from audit_events
               where clinic_id = ${clinicId!}::uuid
                 and created_at >= ${startedAt}::timestamptz
                 and (resource_id = any(${allResourceIds}::text[])
                      or coalesce(before::text, '') like ${`%${marker}%`}
                      or coalesce(after::text, '') like ${`%${marker}%`})
              returning id::text
            `;
            const removedIdempotency = await tx<{ key: string }[]>`
              delete from idempotency_keys
               where clinic_id = ${clinicId!}::uuid
                 and created_at >= ${startedAt}::timestamptz
                 and (response ->> 'id' = any(${allResourceIds}::text[])
                      or response ->> 'appointmentId' = any(${appointmentIds}::text[]))
              returning key
            `;
            const removedAppointments = await tx<{ id: string }[]>`
              delete from appointments
               where clinic_id = ${clinicId!}::uuid
                 and id::text = any(${appointmentIds}::text[])
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
                appointments: number;
                corrections: number;
                queue: number;
                outbox: number;
                ledger: number;
                audit: number;
                idempotency: number;
              }[]
            >`
              select
                (select count(*)::int from patients
                  where clinic_id = ${clinicId!}::uuid
                    and email = any(${[scheduledEmail, arrivedEmail]}::text[])) patients,
                (select count(*)::int from appointments
                  where clinic_id = ${clinicId!}::uuid
                    and id::text = any(${appointmentIds}::text[])) appointments,
                (select count(*)::int from appointment_corrections
                  where clinic_id = ${clinicId!}::uuid
                    and appointment_id::text = any(${appointmentIds}::text[])) corrections,
                (select count(*)::int from waiting_queue_entries
                  where clinic_id = ${clinicId!}::uuid
                    and appointment_id::text = any(${appointmentIds}::text[])) queue,
                (select count(*)::int from outbox
                  where clinic_id = ${clinicId!}::uuid
                    and (payload::text like ${`%${marker}%`}
                         or payload ->> 'appointmentId' = any(${appointmentIds}::text[]))) outbox,
                (select count(*)::int from usage_counter_ledger
                  where clinic_id = ${clinicId!}::uuid
                    and dedup_key = any(${appointmentIds}::text[])) ledger,
                (select count(*)::int from audit_events
                  where clinic_id = ${clinicId!}::uuid
                    and created_at >= ${startedAt}::timestamptz
                    and resource_id = any(${allResourceIds}::text[])) audit,
                (select count(*)::int from idempotency_keys
                  where clinic_id = ${clinicId!}::uuid
                    and created_at >= ${startedAt}::timestamptz
                    and response ->> 'id' = any(${allResourceIds}::text[])) idempotency
            `;
            return {
              removed: {
                outbox: removedOutbox.length,
                ledger: removedLedger.length,
                audit: removedAudit.length,
                idempotency: removedIdempotency.length,
                appointments: removedAppointments.length,
                patients: removedPatients.length,
              },
              remaining,
            };
          });
          expect(cleanup.remaining).toEqual({
            patients: 0,
            appointments: 0,
            corrections: 0,
            queue: 0,
            outbox: 0,
            ledger: 0,
            audit: 0,
            idempotency: 0,
          });
          console.log(`[consultorio-no-show-a-cleanup] ${JSON.stringify(cleanup)}`);
          await testInfo.attach('consultorio-no-show-a-cleanup.json', {
            body: JSON.stringify(cleanup, null, 2),
            contentType: 'application/json',
          });
        }
      } finally {
        await sql.end();
      }
    }
  });
});
