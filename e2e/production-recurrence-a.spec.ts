import { expect, test, type BrowserContext, type Page, type Response } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_RECURRENCE === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const attendantEmail = process.env.E2E_ATTENDANT_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

test.use({
  storageState: { cookies: [], origins: [] },
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

function productionConfig(): { databaseUrl: string; url: string; secretKey: string } {
  const databaseUrl = process.env.DATABASE_URL_PROD;
  const secretKey = process.env.SUPABASE_SECRET_KEY_PROD;
  if (!databaseUrl || !secretKey) throw new Error('Credenciais operacionais PROD ausentes.');
  const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  if (!projectRef || !/^[a-z]{20}$/u.test(projectRef)) {
    throw new Error('Project ref de produção inválido.');
  }
  return { databaseUrl, url: `https://${projectRef}.supabase.co`, secretKey };
}

async function signInContext(context: BrowserContext, email: string, password: string) {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  const { url, secretKey } = productionConfig();
  let nextCookies: Array<{ name: string; value: string }> = [];
  const client = createSsrClient(url, secretKey, {
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
  const digits = Array.from(seed.replace(/\D/gu, '').padStart(9, '7').slice(-9), Number);
  const digit = (values: number[], weight: number) => {
    const rest =
      (values.reduce((sum, value, index) => sum + value * (weight - index), 0) * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const first = digit(digits, 10);
  return [...digits, first, digit([...digits, first], 11)].join('');
}

function addDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isServerAction(response: Response): boolean {
  const request = response.request();
  return request.method() === 'POST' && Boolean(request.headers()['next-action']);
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
  if (!id || !/^[0-9a-f-]{36}$/iu.test(id)) throw new Error('Paciente sintético sem ID.');
  return id;
}

async function prepareAppointment(
  page: Page,
  input: {
    patientName: string;
    procedureId: string;
    doctorId: string;
    date: string;
    time: string;
    recurring: boolean;
  },
) {
  await page.goto('/agenda');
  await page.getByRole('button', { name: 'Novo atendimento' }).click();
  const drawer = page.getByRole('dialog', { name: 'Novo atendimento' });
  await drawer.getByPlaceholder('Buscar por nome (mín. 2 letras)').fill(input.patientName);
  await drawer.getByRole('option', { name: input.patientName, exact: true }).click();
  await drawer.getByLabel('Procedimento', { exact: true }).selectOption(input.procedureId);
  await drawer.getByLabel('Profissional', { exact: true }).selectOption(input.doctorId);
  await drawer.getByLabel('Data', { exact: true }).fill(input.date);
  await drawer.getByLabel('Hora', { exact: true }).fill(input.time);
  if (input.recurring) {
    await drawer.getByRole('checkbox', { name: 'Repetir semanalmente' }).check();
  }
  return drawer;
}

async function submitAction(page: Page, drawer: Awaited<ReturnType<typeof prepareAppointment>>) {
  const responsePromise = page.waitForResponse(isServerAction);
  await drawer.getByRole('button', { name: 'Agendar', exact: true }).click();
  return (await responsePromise).status();
}

test.describe('produção: recorrência de Agenda na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('valida limites, persistência, duplicidade diária, rollback de conflito e cleanup', async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    test.skip(!authorized, 'Exige autorização explícita para recorrência sintética na Clínica A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de recorrência só pode apontar para app.qoro.dev.');
    }
    if (!attendantEmail || !sharedPassword) {
      throw new Error('Credencial do atendente A ausente.');
    }

    const { databaseUrl } = productionConfig();
    const sql = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
    const context = await browser.newContext({ baseURL: baseUrl });
    const page = await context.newPage();
    const startedAt = new Date();
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-RECURRENCE-A-${runId}]`;
    const patientName = `${marker} Paciente`;
    const patientEmail = `e2e-recurrence-a-${runId}@example.test`;
    const recurrenceTime = '07:13';
    const standaloneTime = '15:37';
    let clinicId: string | undefined;
    let actorId: string | undefined;
    let doctorId: string | undefined;
    let procedureId: string | undefined;
    let patientId: string | undefined;
    let blockerId: string | undefined;
    let seriesId: string | undefined;
    let appointmentIds: string[] = [];
    let chosenYear: number | undefined;
    let cleanup: Record<string, number> | undefined;

    try {
      const [setup] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const [identity] = await tx<
          { clinic_id: string; actor_id: string; timezone: string; can_edit: boolean }[]
        >`
          select p.clinic_id::text, p.id::text actor_id, c.timezone,
                 'edit:agenda'=any(ep.permissions) can_edit
            from profiles p
            join auth.users u on u.id=p.id
            join effective_permissions_v ep on ep.user_id=p.id and ep.clinic_id=p.clinic_id
            join clinics c on c.id=p.clinic_id
           where lower(u.email)=${attendantEmail.toLowerCase()}
             and p.role='attendant' and p.ativo=true and p.deleted_at is null
           limit 1
        `;
        if (!identity?.can_edit) throw new Error('Atendente A sem edit:agenda.');
        const [doctor] = await tx<{ id: string; nome: string }[]>`
          select id::text, nome from profiles
           where clinic_id=${identity.clinic_id}::uuid and ativo=true and deleted_at is null
             and invite_accepted_at is not null and (role='doctor' or crm is not null)
           order by case when role='doctor' then 0 else 1 end, created_at, id
           limit 1
        `;
        const [procedure] = await tx<
          {
            id: string;
            descricao: string;
            codigo: string | null;
            categoria: string | null;
            valor: string;
            duration: number;
          }[]
        >`
          select id::text, descricao, codigo, categoria, valor_padrao::text valor,
                 duracao_padrao_min duration
            from procedures
           where clinic_id=${identity.clinic_id}::uuid and ativo=true
           order by created_at, id
           limit 1
        `;
        if (!doctor || !procedure) throw new Error('Clínica A sem médico ou procedimento ativo.');
        const [freeYear] = await tx<{ chosen_year: number }[]>`
          select candidate::int chosen_year
            from (values (2098), (2097), (2099)) as years(candidate)
           where not exists (
             select 1 from appointments a
              where a.doctor_id=${doctor.id}::uuid
                and a.scheduled_at >= (make_date(candidate,1,1)::timestamp at time zone ${identity.timezone})
                and a.scheduled_at < (make_date(candidate+1,1,1)::timestamp at time zone ${identity.timezone})
           )
           order by abs(candidate-2098)
           limit 1
        `;
        if (!freeYear) throw new Error('Sem ano futuro vazio para recorrência sintética.');
        const [preexisting] = await tx<{ patients: number }[]>`
          select count(*)::int patients from patients
           where clinic_id=${identity.clinic_id}::uuid and lower(email)=lower(${patientEmail})
        `;
        if (!preexisting || preexisting.patients !== 0) {
          throw new Error('Fixture de recorrência já existe.');
        }
        return [{ identity, doctor, procedure, year: freeYear.chosen_year }];
      });
      if (!setup) throw new Error('Setup autoritativo ausente.');
      clinicId = setup.identity.clinic_id;
      actorId = setup.identity.actor_id;
      doctorId = setup.doctor.id;
      procedureId = setup.procedure.id;
      chosenYear = setup.year;
      const validFirstDate = `${setup.year}-01-08`;
      const validSecondDate = addDays(validFirstDate, 7);
      const validThirdDate = addDays(validFirstDate, 14);
      // DATA-007 — a guarda de duplicidade diaria passou a valer para TODAS as
      // ocorrencias. A consulta isolada precisa ficar fora da janela da serie,
      // senao a criacao e (corretamente) recusada.
      const standaloneDate = addDays(validFirstDate, 28);
      const conflictFirstDate = `${setup.year}-06-08`;
      const conflictSecondDate = addDays(conflictFirstDate, 7);

      await signInContext(context, attendantEmail, sharedPassword);
      patientId = await createPatient(page, {
        name: patientName,
        cpf: validCpf(runId),
        email: patientEmail,
      });

      const clientInvalid = await prepareAppointment(page, {
        patientName,
        procedureId,
        doctorId,
        date: validFirstDate,
        time: recurrenceTime,
        recurring: true,
      });
      const recurrenceNumbers = clientInvalid.locator('input[type="number"]');
      await expect(recurrenceNumbers).toHaveCount(2);
      // A11Y-002 — os tres campos ganharam nome acessivel no ciclo anterior.
      expect(await clientInvalid.getByLabel('Intervalo (semanas)', { exact: true }).count()).toBe(
        1,
      );
      expect(
        await clientInvalid.getByLabel('Quantidade de consultas', { exact: true }).count(),
      ).toBe(1);
      expect(
        await clientInvalid.getByLabel('Observações (opcional)', { exact: true }).count(),
      ).toBe(1);
      await recurrenceNumbers.nth(1).evaluate((element) => element.removeAttribute('min'));
      await recurrenceNumbers.nth(1).fill('1');
      await clientInvalid.getByRole('button', { name: 'Agendar', exact: true }).click();
      await expect(
        clientInvalid.getByText('A recorrência precisa de ao menos duas consultas.', {
          exact: true,
        }),
      ).toBeVisible();

      const serverInvalid = await prepareAppointment(page, {
        patientName,
        procedureId,
        doctorId,
        date: validFirstDate,
        time: recurrenceTime,
        recurring: true,
      });
      const serverInvalidCount = serverInvalid.locator('input[type="number"]').nth(1);
      await serverInvalidCount.evaluate((element) => element.removeAttribute('max'));
      await serverInvalidCount.fill('105');
      const oversizedHttpStatus = await submitAction(page, serverInvalid);
      await expect(serverInvalid.getByRole('alert')).toBeVisible();

      const standalone = await prepareAppointment(page, {
        patientName,
        procedureId,
        doctorId,
        date: standaloneDate,
        time: standaloneTime,
        recurring: false,
      });
      const standaloneHttpStatus = await submitAction(page, standalone);
      await expect(page.getByText('Atendimento agendado', { exact: true })).toBeVisible();

      const validRecurrence = await prepareAppointment(page, {
        patientName,
        procedureId,
        doctorId,
        date: validFirstDate,
        time: recurrenceTime,
        recurring: true,
      });
      await validRecurrence.locator('input[type="number"]').nth(0).fill('1');
      await validRecurrence.locator('input[type="number"]').nth(1).fill('3');
      const recurrenceHttpStatus = await submitAction(page, validRecurrence);
      await expect(
        page.getByText(`3 consultas semanais criadas para ${patientName}.`, { exact: true }),
      ).toBeVisible({ timeout: 30_000 });

      const persisted = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const series = await tx<{ id: string }[]>`
          select id::text from recurrence_series
           where clinic_id=${clinicId!}::uuid and patient_id=${patientId!}::uuid
             and created_at>=${startedAt}::timestamptz
           order by created_at
        `;
        if (series.length !== 1) throw new Error(`Séries esperadas=1, observado=${series.length}.`);
        seriesId = series[0]!.id;
        const appointments = await tx<
          { id: string; scheduled_date: string; status: string; occurrence: number | null }[]
        >`
          select id::text,
                 (scheduled_at at time zone ${setup.identity.timezone})::date::text scheduled_date,
                 status::text, recurrence_occurrence occurrence
            from appointments
           where clinic_id=${clinicId!}::uuid and patient_id=${patientId!}::uuid
             and scheduled_at >= (make_date(${setup.year},1,1)::timestamp at time zone ${setup.identity.timezone})
             and scheduled_at < (make_date(${setup.year + 1},1,1)::timestamp at time zone ${setup.identity.timezone})
           order by scheduled_at
        `;
        appointmentIds = appointments.map(({ id }) => id);
        const [trails] = await tx<
          { outbox: number; audits: number; idempotency: number; duplicate_day: number }[]
        >`
          select
            (select count(*)::int from outbox
              where clinic_id=${clinicId!}::uuid
                and (payload ->> 'patientId'=${patientId!}
                     or payload ->> 'seriesId'=${seriesId!}
                     or payload::text like ${`%${marker}%`})) outbox,
            (select count(*)::int from audit_events
              where clinic_id=${clinicId!}::uuid and created_at>=${startedAt}::timestamptz
                and (resource_id=${patientId!} or resource_id=${seriesId!}
                     or resource_id=any(${appointmentIds}::text[]))) audits,
            (select count(*)::int from idempotency_keys
              where clinic_id=${clinicId!}::uuid and created_at>=${startedAt}::timestamptz
                and response::text like ${`%${patientId!}%`}) idempotency,
            (select count(*)::int from appointments
              where clinic_id=${clinicId!}::uuid and patient_id=${patientId!}::uuid
                and doctor_id=${doctorId!}::uuid
                and (scheduled_at at time zone ${setup.identity.timezone})::date=${validSecondDate}::date
                and status in ('agendado','confirmado','chegou','em_atendimento')) duplicate_day
        `;
        if (!trails) throw new Error('Trilhas da recorrência ausentes.');
        return { series, appointments, trails };
      });
      expect(persisted.appointments).toHaveLength(4);
      expect(persisted.appointments.filter(({ occurrence }) => occurrence !== null)).toMatchObject([
        { scheduled_date: validFirstDate, occurrence: 1, status: 'agendado' },
        { scheduled_date: validSecondDate, occurrence: 2, status: 'agendado' },
        { scheduled_date: validThirdDate, occurrence: 3, status: 'agendado' },
      ]);
      // DATA-007 — antes este numero era 2 (duas consultas ativas do mesmo par
      // no mesmo dia, que era o achado). Agora so existe a ocorrencia da serie.
      expect(persisted.trails.duplicate_day).toBe(1);

      await page.goto(`/agenda?view=day&date=${validSecondDate}`);
      await expect(page.getByText(patientName, { exact: true })).toHaveCount(1);
      await page.reload();
      await expect(page.getByText(patientName, { exact: true })).toHaveCount(1);
      // UX-003 — a projecao passou a transportar serie/ocorrencia e a Agenda
      // renderiza o vinculo. Antes os dois eram `false`, que era o achado.
      const seriesUiIndicator = (await page.getByText(/recorr|série/iu).count()) > 0;
      expect(seriesUiIndicator).toBe(true);
      // O badge "Serie N/M" abre o dialogo de cancelamento da serie.
      await page
        .getByRole('button', { name: /^Série \d+\/\d+$/u })
        .first()
        .click();
      const seriesCancelControl =
        (await page.getByRole('button', { name: 'Cancelar série', exact: true }).count()) > 0;
      expect(seriesCancelControl).toBe(true);
      await page.getByRole('button', { name: 'Voltar', exact: true }).click();

      const [blocker] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string }[]>`
          insert into appointments (
            clinic_id, doctor_id, procedure_id, scheduled_at, duration_min, status, valor,
            snapshot_procedure_name, snapshot_procedure_codigo, snapshot_procedure_categoria,
            snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome,
            created_via, observacoes, created_by
          ) values (
            ${clinicId!}::uuid, ${doctorId!}::uuid, ${procedureId!}::uuid,
            ((${conflictSecondDate}::date + ${recurrenceTime}::time) at time zone ${setup.identity.timezone}),
            ${setup.procedure.duration}, 'agendado', ${setup.procedure.valor}::numeric,
            ${setup.procedure.descricao}, ${setup.procedure.codigo}, ${setup.procedure.categoria},
            ${setup.procedure.valor}::numeric, ${setup.procedure.duration}, ${setup.doctor.nome},
            'attendant', ${marker}, ${actorId!}::uuid
          ) returning id::text
        `;
      });
      if (!blocker) throw new Error('Blocker sintético não foi criado.');
      blockerId = blocker.id;

      const beforeConflict = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const [counts] = await tx<
          {
            series: number;
            appointments: number;
            outbox: number;
            audits: number;
            idempotency: number;
          }[]
        >`
          select
            (select count(*)::int from recurrence_series where clinic_id=${clinicId!}::uuid and patient_id=${patientId!}::uuid) series,
            (select count(*)::int from appointments where clinic_id=${clinicId!}::uuid and patient_id=${patientId!}::uuid) appointments,
            (select count(*)::int from outbox where clinic_id=${clinicId!}::uuid and payload::text like ${`%${patientId!}%`}) outbox,
            (select count(*)::int from audit_events where clinic_id=${clinicId!}::uuid and created_at>=${startedAt}::timestamptz and (resource_id=${patientId!} or resource_id=${seriesId!})) audits,
            (select count(*)::int from idempotency_keys where clinic_id=${clinicId!}::uuid and created_at>=${startedAt}::timestamptz and response::text like ${`%${patientId!}%`}) idempotency
        `;
        return counts;
      });
      if (!beforeConflict) throw new Error('Baseline do conflito ausente.');

      const conflict = await prepareAppointment(page, {
        patientName,
        procedureId,
        doctorId,
        date: conflictFirstDate,
        time: recurrenceTime,
        recurring: true,
      });
      await conflict.locator('input[type="number"]').nth(1).fill('3');
      const conflictHttpStatus = await submitAction(page, conflict);
      await expect(
        conflict.getByText('Já existe um atendimento nesse horário para este profissional.', {
          exact: true,
        }),
      ).toBeVisible();

      const [afterConflict] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            series: number;
            appointments: number;
            outbox: number;
            audits: number;
            idempotency: number;
            rolled_back_first: number;
          }[]
        >`
          select
            (select count(*)::int from recurrence_series where clinic_id=${clinicId!}::uuid and patient_id=${patientId!}::uuid) series,
            (select count(*)::int from appointments where clinic_id=${clinicId!}::uuid and patient_id=${patientId!}::uuid) appointments,
            (select count(*)::int from outbox where clinic_id=${clinicId!}::uuid and payload::text like ${`%${patientId!}%`}) outbox,
            (select count(*)::int from audit_events where clinic_id=${clinicId!}::uuid and created_at>=${startedAt}::timestamptz and (resource_id=${patientId!} or resource_id=${seriesId!})) audits,
            (select count(*)::int from idempotency_keys where clinic_id=${clinicId!}::uuid and created_at>=${startedAt}::timestamptz and response::text like ${`%${patientId!}%`}) idempotency,
            (select count(*)::int from appointments
              where clinic_id=${clinicId!}::uuid and patient_id=${patientId!}::uuid
                and (scheduled_at at time zone ${setup.identity.timezone})::date=${conflictFirstDate}::date) rolled_back_first
        `;
      });
      if (!afterConflict) throw new Error('Estado pós-conflito ausente.');
      expect(afterConflict).toMatchObject({ ...beforeConflict, rolled_back_first: 0 });

      console.log(
        `[recurrence-a] ${JSON.stringify({
          year: setup.year,
          invalid: { clientOccurrences: 1, serverOccurrences: 105, http: oversizedHttpStatus },
          standaloneHttpStatus,
          recurrenceHttpStatus,
          series: persisted.series.length,
          appointments: persisted.appointments.length,
          occurrences: persisted.appointments
            .map(({ occurrence }) => occurrence)
            .filter((value) => value !== null),
          duplicateSamePatientDoctorDay: persisted.trails.duplicate_day,
          persistenceAfterRefresh: true,
          seriesUiIndicator,
          seriesCancelControl,
          conflictHttpStatus,
          conflictAtomicRollback: afterConflict.rolled_back_first === 0,
          accessibility: {
            intervalLabelled: true,
            occurrencesLabelled: true,
            observationsLabelled: true,
          },
          externalEffects: false,
        })}`,
      );
    } finally {
      if (clinicId) {
        const result = await sql.begin(async (tx) => {
          await tx.unsafe('RESET ROLE');
          const patients = await tx<{ id: string }[]>`
            select id::text from patients
             where clinic_id=${clinicId!}::uuid and lower(email)=lower(${patientEmail})
          `;
          const patientIds = patients.map(({ id }) => id);
          const appointments = await tx<{ id: string }[]>`
            select id::text from appointments
             where clinic_id=${clinicId!}::uuid
               and (patient_id::text=any(${patientIds}::text[]) or observacoes=${marker})
          `;
          const ids = [...new Set([...appointmentIds, ...appointments.map(({ id }) => id)])];
          const series = await tx<{ id: string }[]>`
            select id::text from recurrence_series
             where clinic_id=${clinicId!}::uuid and patient_id::text=any(${patientIds}::text[])
          `;
          const seriesIds = series.map(({ id }) => id);
          const removedOutbox = await tx<{ id: string }[]>`
            delete from outbox where clinic_id=${clinicId!}::uuid
             and (payload ->> 'patientId'=any(${patientIds}::text[])
                  or payload ->> 'appointmentId'=any(${ids}::text[])
                  or payload ->> 'seriesId'=any(${seriesIds}::text[])
                  or payload::text like ${`%${marker}%`})
            returning id::text
          `;
          const removedLedger = await tx<{ period_yyyymm: string }[]>`
            delete from usage_counter_ledger
             where clinic_id=${clinicId!}::uuid and metric='agendamentos'
               and dedup_key=any(${ids}::text[])
            returning period_yyyymm
          `;
          const ledgerByPeriod = new Map<string, number>();
          for (const { period_yyyymm: period } of removedLedger) {
            ledgerByPeriod.set(period, (ledgerByPeriod.get(period) ?? 0) + 1);
          }
          for (const [period, count] of ledgerByPeriod) {
            await tx`
              update usage_metrics set agendamentos_count=greatest(0,agendamentos_count-${count}),
                updated_at=now()
               where clinic_id=${clinicId!}::uuid and period_yyyymm=${period}
            `;
          }
          const allResourceIds = [...patientIds, ...ids, ...seriesIds];
          const removedAudit = await tx<{ id: string }[]>`
            delete from audit_events where clinic_id=${clinicId!}::uuid
             and created_at>=${startedAt}::timestamptz
             and (resource_id=any(${allResourceIds}::text[])
                  or after ->> 'id'=any(${ids}::text[])
                  or after ->> 'seriesId'=any(${seriesIds}::text[])
                  or coalesce(before::text,'') like ${`%${marker}%`}
                  or coalesce(after::text,'') like ${`%${marker}%`})
            returning id::text
          `;
          const removedIdempotency = await tx<{ key: string }[]>`
            delete from idempotency_keys where clinic_id=${clinicId!}::uuid
             and created_at>=${startedAt}::timestamptz
             and (${patientIds.length > 0 ? tx`response::text like ${`%${patientIds[0]}%`}` : tx`false`}
                  or ${seriesIds.length > 0 ? tx`response::text like ${`%${seriesIds[0]}%`}` : tx`false`})
            returning key
          `;
          const removedAppointments = await tx<{ id: string }[]>`
            delete from appointments where clinic_id=${clinicId!}::uuid and id::text=any(${ids}::text[])
            returning id::text
          `;
          const removedSeries = await tx<{ id: string }[]>`
            delete from recurrence_series where clinic_id=${clinicId!}::uuid
              and id::text=any(${seriesIds}::text[])
            returning id::text
          `;
          const removedPatients = await tx<{ id: string }[]>`
            delete from patients where clinic_id=${clinicId!}::uuid
              and id::text=any(${patientIds}::text[])
            returning id::text
          `;
          const [remaining] = await tx<
            {
              patients: number;
              series: number;
              appointments: number;
              outbox: number;
              ledger: number;
              audits: number;
              idempotency: number;
            }[]
          >`
            select
              (select count(*)::int from patients where clinic_id=${clinicId!}::uuid and lower(email)=lower(${patientEmail})) patients,
              (select count(*)::int from recurrence_series where clinic_id=${clinicId!}::uuid and id::text=any(${seriesIds}::text[])) series,
              (select count(*)::int from appointments where clinic_id=${clinicId!}::uuid and id::text=any(${ids}::text[])) appointments,
              (select count(*)::int from outbox where clinic_id=${clinicId!}::uuid and (payload::text like ${`%${marker}%`} or payload ->> 'appointmentId'=any(${ids}::text[]))) outbox,
              (select count(*)::int from usage_counter_ledger where clinic_id=${clinicId!}::uuid and dedup_key=any(${ids}::text[])) ledger,
              (select count(*)::int from audit_events where clinic_id=${clinicId!}::uuid
                and created_at>=${startedAt}::timestamptz
                and (resource_id=any(${allResourceIds}::text[])
                     or after ->> 'id'=any(${ids}::text[])
                     or after ->> 'seriesId'=any(${seriesIds}::text[])
                     or coalesce(after::text,'') like ${`%${marker}%`})) audits,
              (select count(*)::int from idempotency_keys where clinic_id=${clinicId!}::uuid and created_at>=${startedAt}::timestamptz and response::text like ${`%${marker}%`}) idempotency
          `;
          return {
            removed: {
              patients: removedPatients.length,
              series: removedSeries.length,
              appointments: removedAppointments.length,
              outbox: removedOutbox.length,
              ledger: removedLedger.length,
              audits: removedAudit.length,
              idempotency: removedIdempotency.length,
            },
            remaining,
          };
        });
        cleanup = result.remaining;
        expect(result.remaining).toEqual({
          patients: 0,
          series: 0,
          appointments: 0,
          outbox: 0,
          ledger: 0,
          audits: 0,
          idempotency: 0,
        });
        console.log(`[recurrence-a-cleanup] ${JSON.stringify(result)}`);
      }
      await context.close().catch(() => undefined);
      await sql.end();
      if (chosenYear && !cleanup) throw new Error('Cleanup da recorrência não foi comprovado.');
      void blockerId;
      void seriesId;
    }
  });
});
