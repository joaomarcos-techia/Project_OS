import { randomUUID } from 'node:crypto';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_APPOINTMENT_RECOVERY === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const doctorEmail = process.env.E2E_DOCTOR_EMAIL;
const attendantEmail = process.env.E2E_ATTENDANT_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

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
    throw new Error('Project ref de produção inválido.');
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

function hhmm(totalMinutes: number): string {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

function timeMinutes(value: string): number {
  const [hours, minutes] = value.slice(0, 5).split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    throw new Error(`Horário de banco inválido: ${value}`);
  }
  return hours! * 60 + minutes!;
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
  await drawer.locator('input[name="telefone"]').fill('11955550123');
  await drawer.getByRole('button', { name: 'Criar paciente' }).click();
  await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/u, { timeout: 90_000 });
  const id = new URL(page.url()).pathname.split('/').at(-1);
  if (!id || !/^[0-9a-f-]{36}$/iu.test(id)) throw new Error('Paciente sintético sem ID.');
  return id;
}

async function createProcedure(page: Page, input: { code: string; name: string }): Promise<void> {
  await page.goto('/configuracoes/procedimentos');
  await page.getByRole('button', { name: 'Novo procedimento' }).click();
  await page.getByPlaceholder('Código * (ex: CONS)').fill(input.code);
  await page.getByPlaceholder('Descrição * (ex: Consulta)').fill(input.name);
  await page.getByPlaceholder('0,00').fill('1,23');
  await page.getByPlaceholder('30').fill('5');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Procedimento salvo.', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function createScheduledAppointment(
  page: Page,
  input: {
    patientName: string;
    procedureId: string;
    doctorId: string;
    date: string;
    time: string;
  },
): Promise<void> {
  await page.goto('/agenda');
  await page.getByRole('button', { name: 'Novo atendimento' }).click();
  const drawer = page.getByRole('dialog', { name: 'Novo atendimento' });
  await drawer.getByPlaceholder('Buscar por nome (mín. 2 letras)').fill(input.patientName);
  await drawer.getByRole('option', { name: input.patientName, exact: true }).click();
  await drawer.getByLabel('Procedimento', { exact: true }).selectOption(input.procedureId);
  await drawer.getByLabel('Profissional', { exact: true }).selectOption(input.doctorId);
  await drawer.getByLabel('Data', { exact: true }).fill(input.date);
  await drawer.getByLabel('Hora', { exact: true }).fill(input.time);
  await drawer.getByRole('button', { name: 'Agendar', exact: true }).click();
  await expect(page.getByText('Atendimento agendado', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function createWalkIn(
  page: Page,
  input: { patientName: string; procedureId: string; doctorId: string },
): Promise<void> {
  await page.goto('/agenda');
  await page.getByRole('button', { name: 'Novo atendimento' }).click();
  const drawer = page.getByRole('dialog', { name: 'Novo atendimento' });
  await drawer.getByRole('radio', { name: 'Encaixe (agora)' }).click();
  await drawer.getByPlaceholder('Buscar por nome (mín. 2 letras)').fill(input.patientName);
  await drawer.getByRole('option', { name: input.patientName, exact: true }).click();
  await drawer.getByLabel('Procedimento', { exact: true }).selectOption(input.procedureId);
  await drawer.getByLabel('Profissional', { exact: true }).selectOption(input.doctorId);
  await drawer.getByRole('button', { name: 'Criar encaixe', exact: true }).click();
  await expect(page.getByText('Encaixe criado', { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function changeRole(page: Page, memberName: string, targetRole: 'doctor' | 'attendant') {
  await page.goto('/equipe');
  const row = page.getByText(memberName, { exact: true }).locator('xpath=ancestor::tr[1]');
  await row.getByRole('button', { name: `Ações de ${memberName}` }).click();
  await page.getByRole('menuitem', { name: 'Trocar função' }).click();
  const dialog = page.getByRole('dialog', { name: `Trocar função de ${memberName}` });
  await dialog.getByLabel('Função').selectOption(targetRole);
  await dialog.getByRole('button', { name: 'Salvar função' }).click();
  await expect(page.getByText('Função atualizada', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

function appointmentRow(page: Page, patientName: string) {
  return page.getByText(patientName, { exact: true }).locator('xpath=ancestor::li[1]');
}

async function openCorrection(page: Page, patientName: string) {
  const row = appointmentRow(page, patientName);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: 'Corrigir' }).click();
  const dialog = page.getByRole('dialog', { name: 'Corrigir atendimento' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function setHiddenValue(locator: ReturnType<Page['locator']>, value: string): Promise<void> {
  await locator.evaluate((element, nextValue) => {
    if (!(element instanceof HTMLInputElement)) throw new Error('Campo oculto inesperado.');
    element.value = nextValue;
  }, value);
}

test.describe('produção: recuperação de agenda na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('valida transferência, replay, interrupção, cancelamento, reabertura e entrada inválida', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(900_000);
    test.skip(!authorized, 'Exige E2E_PRODUCTION_APPOINTMENT_RECOVERY=ALLOW_SYNTHETIC_CLINIC_A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de recuperação só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !doctorEmail || !attendantEmail || !sharedPassword) {
      throw new Error('Credenciais das roles da Clínica A ausentes.');
    }

    const { databaseUrl } = productionConfig();
    const sql = postgres(databaseUrl, { max: 3, ssl: 'require', prepare: false });
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-RECOVERY-A-${runId}]`;
    const patientName = `${marker} Paciente`;
    const patientEmail = `e2e-recovery-a-${runId}@example.test`;
    const procedureCode = `REC${runId}`;
    const procedureName = `${marker} Procedimento`;
    const today = clinicDate();
    const future = clinicDate(35);
    const futureTime = '03:17';
    const startedAt = new Date().toISOString();
    let clinicId: string | undefined;
    let attendantId: string | undefined;
    let attendantName: string | undefined;
    let primaryDoctorId: string | undefined;
    let secondaryDoctorId: string | undefined;
    let patientId: string | undefined;
    let procedureId: string | undefined;
    let scheduledAppointmentId: string | undefined;
    let walkInAppointmentId: string | undefined;
    let temporaryAvailabilityId: string | undefined;
    let roleChanged = false;
    let roleRestoredVia: 'not-needed' | 'ui' | 'database-recovery' = 'not-needed';
    let attendantContext: BrowserContext | undefined;
    let doctorContext: BrowserContext | undefined;

    try {
      const identities = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            email: string;
            id: string;
            clinic_id: string;
            nome: string;
            role: string;
            practitioner: boolean;
          }[]
        >`
          select lower(u.email) email, p.id::text, p.clinic_id::text, p.nome,
                 p.role::text,
                 (p.role = 'doctor' or nullif(btrim(p.crm), '') is not null) practitioner
            from auth.users u
            join profiles p on p.id = u.id
           where lower(u.email) = any(${[ownerEmail, doctorEmail, attendantEmail].map((email) => email.toLowerCase())}::text[])
             and p.ativo = true
             and p.deleted_at is null
             and p.invite_accepted_at is not null
        `;
      });
      const owner = identities.find(({ email }) => email === ownerEmail.toLowerCase());
      const doctor = identities.find(({ email }) => email === doctorEmail.toLowerCase());
      const attendant = identities.find(({ email }) => email === attendantEmail.toLowerCase());
      if (!owner || owner.role !== 'owner') throw new Error('Owner A ativo não encontrado.');
      if (!doctor || doctor.role !== 'doctor') throw new Error('Médico A ativo não encontrado.');
      if (!attendant || attendant.role !== 'attendant') {
        throw new Error('Atendente A não está no papel original esperado.');
      }
      if (new Set(identities.map(({ clinic_id }) => clinic_id)).size !== 1) {
        throw new Error('As contas fornecidas não pertencem à mesma Clínica A.');
      }
      clinicId = owner.clinic_id;
      attendantId = attendant.id;
      attendantName = attendant.nome;
      primaryDoctorId = doctor.id;

      const practitioners = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; nome: string }[]>`
          select id::text, nome
            from profiles
           where clinic_id = ${clinicId!}::uuid
             and ativo = true
             and deleted_at is null
             and invite_accepted_at is not null
             and (role = 'doctor' or nullif(btrim(crm), '') is not null)
           order by id
        `;
      });
      secondaryDoctorId = practitioners.find(({ id }) => id !== primaryDoctorId)?.id;

      await signInContext(page.context(), ownerEmail, sharedPassword);
      attendantContext = await browser.newContext({
        baseURL: baseUrl,
        storageState: { cookies: [], origins: [] },
        recordVideo: { dir: testInfo.outputPath('attendant-video') },
      });
      await signInContext(attendantContext, attendantEmail, sharedPassword);
      const attendantPage = await attendantContext.newPage();

      patientId = await createPatient(page, {
        name: patientName,
        cpf: validCpf(runId),
        email: patientEmail,
      });
      await createProcedure(page, { code: procedureCode, name: procedureName });
      const [procedure] = await sql<{ id: string }[]>`
        select id::text
          from procedures
         where clinic_id = ${clinicId}::uuid
           and codigo = ${procedureCode}
           and descricao = ${procedureName}
      `;
      if (!procedure) throw new Error('Procedimento sintético não persistiu.');
      procedureId = procedure.id;

      const [capacity] = await sql<
        {
          local_minute: number;
          weekday: number;
          remaining: number;
          committed: number;
        }[]
      >`
        with clock as (
          select timezone(c.timezone, now()) local_now
            from clinics c where c.id = ${clinicId}::uuid
        )
        select (extract(hour from local_now)::int * 60 + extract(minute from local_now)::int) local_minute,
               extract(dow from local_now)::int weekday,
               coalesce((select sum(greatest(0, extract(epoch from (
                 da.end_time - greatest(da.start_time, clock.local_now::time)
               )) / 60))::int
                 from doctor_availability da
                where da.clinic_id = ${clinicId}::uuid
                  and da.doctor_id = ${primaryDoctorId}::uuid
                  and da.weekday = extract(dow from clock.local_now)::int
                  and da.end_time > clock.local_now::time), 0) remaining,
               coalesce((select sum(a.duration_min)::int
                 from appointments a
                where a.clinic_id = ${clinicId}::uuid
                  and a.doctor_id = ${primaryDoctorId}::uuid
                  and a.status in ('agendado','confirmado','chegou','em_atendimento')
                  and timezone('America/Sao_Paulo', a.scheduled_at)::date = clock.local_now::date
                  and (a.scheduled_at >= now() or a.status in ('chegou','em_atendimento'))), 0) committed
          from clock
      `;
      if (!capacity) throw new Error('Capacidade operacional não calculada.');
      if (capacity.remaining - capacity.committed < 5) {
        const windows = await sql<{ start_time: string; end_time: string }[]>`
          select start_time::text, end_time::text
            from doctor_availability
           where clinic_id = ${clinicId}::uuid
             and doctor_id = ${primaryDoctorId}::uuid
             and weekday = ${capacity.weekday}
           order by start_time
        `;
        const needed = capacity.committed - capacity.remaining + 10;
        let cursor = Math.min(1438, capacity.local_minute + 2);
        let gap: { start: number; end: number } | undefined;
        for (const window of windows) {
          const start = timeMinutes(window.start_time);
          const end = timeMinutes(window.end_time);
          if (end <= cursor) continue;
          if (start - cursor >= needed) {
            gap = { start: cursor, end: start };
            break;
          }
          cursor = Math.max(cursor, end);
        }
        if (!gap && 1439 - cursor >= needed) gap = { start: cursor, end: 1439 };
        if (!gap)
          throw new Error('Não há janela sintética segura para o encaixe de cinco minutos.');

        await page.goto('/configuracoes/horarios');
        await page.getByLabel('Profissional', { exact: true }).selectOption(primaryDoctorId);
        await page.getByLabel('Dia', { exact: true }).selectOption(String(capacity.weekday));
        const lunchBreak = page.getByRole('checkbox').first();
        if (await lunchBreak.isChecked()) await lunchBreak.uncheck();
        await page.getByLabel('Início', { exact: true }).fill(hhmm(gap.start));
        await page.getByLabel('Fim', { exact: true }).fill(hhmm(gap.end));
        await page.getByRole('button', { name: 'Adicionar janela', exact: true }).click();
        await expect(page.getByText('Janela adicionada.', { exact: true })).toBeVisible({
          timeout: 30_000,
        });
        const [createdAvailability] = await sql<{ id: string }[]>`
          select id::text
            from doctor_availability
           where clinic_id = ${clinicId}::uuid
             and doctor_id = ${primaryDoctorId}::uuid
             and weekday = ${capacity.weekday}
             and start_time = ${hhmm(gap.start)}::time
             and end_time = ${hhmm(gap.end)}::time
           order by created_at desc
           limit 1
        `;
        if (!createdAvailability) throw new Error('Disponibilidade sintética não persistiu.');
        temporaryAvailabilityId = createdAvailability.id;
      }

      await createScheduledAppointment(attendantPage, {
        patientName,
        procedureId,
        doctorId: primaryDoctorId,
        date: future,
        time: futureTime,
      });
      await createWalkIn(attendantPage, { patientName, procedureId, doctorId: primaryDoctorId });

      const createdAppointments = await sql<
        { id: string; status: string; created_via: string; scheduled_at: string }[]
      >`
        select id::text, status::text, created_via::text, scheduled_at::text
          from appointments
         where clinic_id = ${clinicId}::uuid
           and patient_id = ${patientId}::uuid
           and procedure_id = ${procedureId}::uuid
         order by created_at
      `;
      scheduledAppointmentId = createdAppointments.find(
        ({ created_via }) => created_via !== 'walkin',
      )?.id;
      walkInAppointmentId = createdAppointments.find(
        ({ created_via }) => created_via === 'walkin',
      )?.id;
      if (!scheduledAppointmentId || !walkInAppointmentId) {
        throw new Error('Os dois atendimentos sintéticos não persistiram.');
      }

      if (!secondaryDoctorId) {
        await changeRole(page, attendantName, 'doctor');
        roleChanged = true;
        secondaryDoctorId = attendantId;
        const [promoted] = await sql<{ role: string; practitioner: boolean }[]>`
          select role::text,
                 (role = 'doctor' or nullif(btrim(crm), '') is not null) practitioner
            from profiles
           where id = ${attendantId}::uuid and clinic_id = ${clinicId}::uuid
        `;
        expect(promoted).toEqual({ role: 'doctor', practitioner: true });
      }

      const correctionContext = roleChanged ? page.context() : attendantContext;
      const correctionPage = roleChanged ? page : attendantPage;
      await correctionPage.goto(`/agenda?view=day&date=${future}`);
      let dialog = await openCorrection(correctionPage, patientName);
      const transferSelect = dialog.locator('select[name="newDoctorId"]');
      await transferSelect.evaluate((element, currentDoctorId) => {
        if (!(element instanceof HTMLSelectElement)) throw new Error('Select inesperado.');
        const option = document.createElement('option');
        option.value = currentDoctorId;
        option.textContent = 'Profissional atual';
        element.append(option);
        element.value = currentDoctorId;
      }, primaryDoctorId);
      await dialog.locator('textarea[name="reason"]').fill(`${marker} transferência inválida`);
      await dialog.getByRole('button', { name: 'Registrar correção' }).click();
      await expect(
        correctionPage.getByText('Não foi possível corrigir', { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      const [afterInvalidTransfer] = await sql<{ doctor_id: string; corrections: number }[]>`
        select a.doctor_id::text,
               (select count(*)::int from appointment_corrections c
                 where c.appointment_id = a.id) corrections
          from appointments a
         where a.id = ${scheduledAppointmentId}::uuid and a.clinic_id = ${clinicId}::uuid
      `;
      expect(afterInvalidTransfer).toEqual({ doctor_id: primaryDoctorId, corrections: 0 });

      await correctionPage.goto(`/agenda?view=day&date=${future}`);
      dialog = await openCorrection(correctionPage, patientName);
      await dialog.locator('select[name="newDoctorId"]').selectOption(secondaryDoctorId);
      await dialog.locator('textarea[name="reason"]').fill(`${marker} transferência válida`);
      await dialog.getByRole('button', { name: 'Registrar correção' }).click();
      await expect(correctionPage.getByText('Agenda corrigida', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await correctionPage.goto(`/agenda?view=day&date=${future}`);
      const transferredRow = appointmentRow(correctionPage, patientName);
      const [transferred] = await sql<
        {
          doctor_id: string;
          current_doctor_name: string;
          snapshot_doctor_nome: string;
          corrections: number;
        }[]
      >`
        select a.doctor_id::text, p.nome current_doctor_name, a.snapshot_doctor_nome,
               (select count(*)::int from appointment_corrections c
                 where c.appointment_id = a.id and c.kind = 'transfer') corrections
          from appointments a
          join profiles p on p.id = a.doctor_id
         where a.id = ${scheduledAppointmentId}::uuid and a.clinic_id = ${clinicId}::uuid
      `;
      if (!transferred) throw new Error('Atendimento transferido ausente.');
      expect(transferred.doctor_id).toBe(secondaryDoctorId);
      expect(transferred.corrections).toBe(1);
      await expect(
        transferredRow.getByText(transferred.current_doctor_name, { exact: true }),
      ).toBeVisible();

      doctorContext = await browser.newContext({
        baseURL: baseUrl,
        storageState: { cookies: [], origins: [] },
        recordVideo: { dir: testInfo.outputPath('doctor-video') },
      });
      await signInContext(doctorContext, doctorEmail, sharedPassword);
      const doctorPage = await doctorContext.newPage();
      await doctorPage.goto('/consultorio');
      let waitingCard = doctorPage
        .getByText(patientName, { exact: true })
        .locator('xpath=ancestor::div[.//button[normalize-space()="Chamar"]][1]');
      await expect(waitingCard).toBeVisible({ timeout: 30_000 });
      await waitingCard.getByRole('button', { name: 'Chamar' }).click();
      await expect(doctorPage.getByRole('heading', { name: patientName, exact: true })).toBeVisible(
        {
          timeout: 30_000,
        },
      );

      const replayPage = await correctionContext.newPage();
      await Promise.all([
        correctionPage.goto(`/agenda?view=day&date=${today}`),
        replayPage.goto(`/agenda?view=day&date=${today}`),
      ]);
      const [firstDialog, replayDialog] = await Promise.all([
        openCorrection(correctionPage, patientName),
        openCorrection(replayPage, patientName),
      ]);
      const replayKey = randomUUID();
      const interruptReason = `${marker} interrupção idempotente`;
      for (const current of [firstDialog, replayDialog]) {
        await current.locator('select[name="kind"]').selectOption('interrupt');
        await current.locator('textarea[name="reason"]').fill(interruptReason);
        await setHiddenValue(current.locator('input[name="idempotencyKey"]'), replayKey);
      }
      await firstDialog.getByRole('button', { name: 'Registrar correção' }).click();
      await expect(correctionPage.getByText('Agenda corrigida', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await replayDialog.getByRole('button', { name: 'Registrar correção' }).click();
      await expect(replayPage.getByText('Agenda corrigida', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      const [afterReplay] = await sql<
        {
          status: string;
          corrections: number;
          audit: number;
          outbox: number;
          idempotency: number;
        }[]
      >`
        select a.status::text,
               (select count(*)::int from appointment_corrections c
                 where c.appointment_id = a.id and c.kind = 'interrupt') corrections,
               (select count(*)::int from audit_events e
                 where e.clinic_id = a.clinic_id and e.resource_id = a.id::text
                   and e.action = 'scheduling.appointment.corrected'
                   and e.created_at >= ${startedAt}::timestamptz) audit,
               (select count(*)::int from outbox o
                 where o.clinic_id = a.clinic_id and o.event_type = 'scheduling.appointment.corrected'
                   and o.payload ->> 'appointmentId' = a.id::text
                   and o.created_at >= ${startedAt}::timestamptz) outbox,
               (select count(*)::int from idempotency_keys i
                 where i.clinic_id = a.clinic_id and i.key like 'scheduling:recover:%'
                   and i.response ->> 'id' = a.id::text
                   and i.created_at >= ${startedAt}::timestamptz) idempotency
          from appointments a
         where a.id = ${walkInAppointmentId}::uuid and a.clinic_id = ${clinicId}::uuid
      `;
      expect(afterReplay).toEqual({
        status: 'chegou',
        corrections: 1,
        audit: 1,
        outbox: 1,
        idempotency: 1,
      });
      await replayPage.close();

      await doctorPage.goto('/consultorio');
      waitingCard = doctorPage
        .getByText(patientName, { exact: true })
        .locator('xpath=ancestor::div[.//button[normalize-space()="Chamar"]][1]');
      await expect(waitingCard).toBeVisible({ timeout: 30_000 });
      await waitingCard.getByRole('button', { name: 'Chamar' }).click();
      await expect(doctorPage.getByRole('heading', { name: patientName, exact: true })).toBeVisible(
        {
          timeout: 30_000,
        },
      );

      await correctionPage.goto(`/agenda?view=day&date=${today}`);
      dialog = await openCorrection(correctionPage, patientName);
      await dialog.locator('select[name="kind"]').selectOption('exceptional_cancel');
      await dialog.locator('textarea[name="reason"]').fill(`${marker} cancelamento excepcional`);
      await dialog.getByRole('button', { name: 'Registrar correção' }).click();
      await expect(correctionPage.getByText('Agenda corrigida', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await correctionPage.goto(`/agenda?view=day&date=${today}`);
      dialog = await openCorrection(correctionPage, patientName);
      await dialog.locator('select[name="kind"]').selectOption('reopen');
      await dialog.locator('textarea[name="reason"]').fill(`${marker} reabertura controlada`);
      await dialog.getByRole('button', { name: 'Registrar correção' }).click();
      await expect(correctionPage.getByText('Agenda corrigida', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      const [beforeInvalidReopen] = await sql<{ corrections: number }[]>`
        select count(*)::int corrections
          from appointment_corrections
         where clinic_id = ${clinicId}::uuid and appointment_id = ${walkInAppointmentId}::uuid
      `;
      expect(beforeInvalidReopen?.corrections).toBe(3);
      await correctionPage.goto(`/agenda?view=day&date=${today}`);
      dialog = await openCorrection(correctionPage, patientName);
      const kindSelect = dialog.locator('select[name="kind"]');
      await kindSelect.evaluate((element) => {
        if (!(element instanceof HTMLSelectElement)) throw new Error('Select inesperado.');
        const option = document.createElement('option');
        option.value = 'reopen';
        option.textContent = 'Reabertura inválida';
        element.append(option);
        element.value = 'reopen';
      });
      const staleDoctorSelect = dialog.locator('select[name="newDoctorId"]');
      await staleDoctorSelect.evaluate((element) => {
        if (!(element instanceof HTMLSelectElement)) throw new Error('Select inesperado.');
        element.required = false;
        element.disabled = true;
      });
      await dialog.locator('textarea[name="reason"]').fill(`${marker} reabertura inválida`);
      await dialog.getByRole('button', { name: 'Registrar correção' }).click();
      await expect(
        correctionPage.getByText('Não foi possível corrigir', { exact: true }),
      ).toBeVisible({ timeout: 30_000 });

      const [finalEvidence] = await sql<
        {
          status: string;
          corrections: number;
          correction_kinds: string[];
          state_logs: number;
          correction_audits: number;
          correction_outbox: number;
          recovery_idempotency: number;
          queue_status: string | null;
        }[]
      >`
        select a.status::text,
               (select count(*)::int from appointment_corrections c
                 where c.appointment_id = a.id) corrections,
               (select array_agg(c.kind::text order by c.corrected_at)
                  from appointment_corrections c where c.appointment_id = a.id) correction_kinds,
               (select count(*)::int from appointment_state_log l
                 where l.appointment_id = a.id) state_logs,
               (select count(*)::int from audit_events e
                 where e.clinic_id = a.clinic_id and e.resource_id = a.id::text
                   and e.action = 'scheduling.appointment.corrected'
                   and e.created_at >= ${startedAt}::timestamptz) correction_audits,
               (select count(*)::int from outbox o
                 where o.clinic_id = a.clinic_id and o.event_type = 'scheduling.appointment.corrected'
                   and o.payload ->> 'appointmentId' = a.id::text
                   and o.created_at >= ${startedAt}::timestamptz) correction_outbox,
               (select count(*)::int from idempotency_keys i
                 where i.clinic_id = a.clinic_id and i.key like 'scheduling:recover:%'
                   and i.response ->> 'id' = a.id::text
                   and i.created_at >= ${startedAt}::timestamptz) recovery_idempotency,
               (select q.status::text from waiting_queue_entries q
                 where q.appointment_id = a.id limit 1) queue_status
          from appointments a
         where a.id = ${walkInAppointmentId}::uuid and a.clinic_id = ${clinicId}::uuid
      `;
      expect(finalEvidence).toEqual({
        status: 'agendado',
        corrections: 3,
        correction_kinds: ['interrupt', 'exceptional_cancel', 'reopen'],
        state_logs: 6,
        correction_audits: 3,
        correction_outbox: 3,
        recovery_idempotency: 3,
        queue_status: 'cancelled',
      });
      if (!finalEvidence) throw new Error('Evidência final do encaixe ausente.');

      const [totalCorrectionEvidence] = await sql<
        { corrections: number; audits: number; outbox: number; idempotency: number }[]
      >`
        select
          (select count(*)::int from appointment_corrections
            where clinic_id = ${clinicId}::uuid
              and appointment_id::text = any(${[scheduledAppointmentId, walkInAppointmentId]}::text[])) corrections,
          (select count(*)::int from audit_events
            where clinic_id = ${clinicId}::uuid
              and action = 'scheduling.appointment.corrected'
              and resource_id = any(${[scheduledAppointmentId, walkInAppointmentId]}::text[])
              and created_at >= ${startedAt}::timestamptz) audits,
          (select count(*)::int from outbox
            where clinic_id = ${clinicId}::uuid
              and event_type = 'scheduling.appointment.corrected'
              and payload ->> 'appointmentId' = any(${[scheduledAppointmentId, walkInAppointmentId]}::text[])
              and created_at >= ${startedAt}::timestamptz) outbox,
          (select count(*)::int from idempotency_keys
            where clinic_id = ${clinicId}::uuid
              and key like 'scheduling:recover:%'
              and response ->> 'id' = any(${[scheduledAppointmentId, walkInAppointmentId]}::text[])
              and created_at >= ${startedAt}::timestamptz) idempotency
      `;
      expect(totalCorrectionEvidence).toEqual({
        corrections: 4,
        audits: 4,
        outbox: 4,
        idempotency: 4,
      });

      const result = {
        clinic: 'A',
        syntheticAppointments: 2,
        temporaryRolePromotion: roleChanged,
        invalidSameDoctorTransferRejected: true,
        validTransferPersisted: true,
        agendaShowsCurrentDoctor: true,
        transferSnapshotMatchesCurrentDoctor:
          transferred.snapshot_doctor_nome === transferred.current_doctor_name,
        interruptReplayResponsesSucceeded: 2,
        interruptReplayRows: 1,
        recoveryKinds: finalEvidence.correction_kinds,
        invalidReopenFromScheduledRejected: true,
        finalWalkInState: finalEvidence.status,
        waitingQueueState: finalEvidence.queue_status,
        totalCorrectionRows: totalCorrectionEvidence?.corrections,
        totalCorrectionAudits: totalCorrectionEvidence?.audits,
        totalCorrectionOutbox: totalCorrectionEvidence?.outbox,
        totalRecoveryIdempotency: totalCorrectionEvidence?.idempotency,
        result: 'pass-with-transfer-snapshot-observation',
      };
      console.log(`[appointment-recovery-a] ${JSON.stringify(result)}`);
      await testInfo.attach('appointment-recovery-a-result.json', {
        body: JSON.stringify(result, null, 2),
        contentType: 'application/json',
      });
    } finally {
      await doctorContext?.close().catch(() => undefined);
      await attendantContext?.close().catch(() => undefined);
      try {
        if (clinicId) {
          const cleanup = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            const patients = await tx<{ id: string }[]>`
              select id::text from patients
               where clinic_id = ${clinicId!}::uuid and email = ${patientEmail} and nome = ${patientName}
            `;
            const procedures = await tx<{ id: string }[]>`
              select id::text from procedures
               where clinic_id = ${clinicId!}::uuid and codigo = ${procedureCode} and descricao = ${procedureName}
            `;
            const patientIds = patients.map(({ id }) => id);
            const procedureIds = procedures.map(({ id }) => id);
            const appointments = await tx<{ id: string }[]>`
              select id::text from appointments
               where clinic_id = ${clinicId!}::uuid
                 and (patient_id::text = any(${patientIds}::text[])
                      or procedure_id::text = any(${procedureIds}::text[]))
            `;
            const appointmentIds = appointments.map(({ id }) => id);
            const prontuarios = await tx<{ id: string }[]>`
              select id::text from prontuarios
               where clinic_id = ${clinicId!}::uuid
                 and (patient_id::text = any(${patientIds}::text[])
                      or appointment_id::text = any(${appointmentIds}::text[]))
            `;
            const prontuarioIds = prontuarios.map(({ id }) => id);
            const allResourceIds = [
              ...patientIds,
              ...procedureIds,
              ...appointmentIds,
              ...prontuarioIds,
              ...(temporaryAvailabilityId ? [temporaryAvailabilityId] : []),
            ];

            const removedOutbox = await tx<{ id: string }[]>`
              delete from outbox
               where clinic_id = ${clinicId!}::uuid
                 and (payload::text like ${`%${marker}%`}
                      or payload ->> 'patientId' = any(${patientIds}::text[])
                      or payload ->> 'procedureId' = any(${procedureIds}::text[])
                      or payload ->> 'appointmentId' = any(${appointmentIds}::text[])
                      or payload ->> 'prontuarioId' = any(${prontuarioIds}::text[]))
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
                   set agendamentos_count = greatest(0, agendamentos_count - ${count}), updated_at = now()
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
                      or response ->> 'appointmentId' = any(${appointmentIds}::text[])
                      or response ->> 'prontuarioId' = any(${prontuarioIds}::text[]))
              returning key
            `;
            const removedProntuarios = await tx<{ id: string }[]>`
              delete from prontuarios
               where clinic_id = ${clinicId!}::uuid and id::text = any(${prontuarioIds}::text[])
              returning id::text
            `;
            const removedAppointments = await tx<{ id: string }[]>`
              delete from appointments
               where clinic_id = ${clinicId!}::uuid and id::text = any(${appointmentIds}::text[])
              returning id::text
            `;
            const removedAvailability = await tx<{ id: string }[]>`
              delete from doctor_availability
               where clinic_id = ${clinicId!}::uuid
                 and id::text = any(${temporaryAvailabilityId ? [temporaryAvailabilityId] : []}::text[])
              returning id::text
            `;
            const removedProcedures = await tx<{ id: string }[]>`
              delete from procedures
               where clinic_id = ${clinicId!}::uuid and id::text = any(${procedureIds}::text[])
              returning id::text
            `;
            const removedPatients = await tx<{ id: string }[]>`
              delete from patients
               where clinic_id = ${clinicId!}::uuid and id::text = any(${patientIds}::text[])
              returning id::text
            `;
            return {
              outbox: removedOutbox.length,
              ledger: removedLedger.length,
              audit: removedAudit.length,
              idempotency: removedIdempotency.length,
              prontuarios: removedProntuarios.length,
              appointments: removedAppointments.length,
              availability: removedAvailability.length,
              procedures: removedProcedures.length,
              patients: removedPatients.length,
            };
          });

          if (roleChanged && attendantId && attendantName) {
            try {
              await signInContext(page.context(), ownerEmail!, sharedPassword!);
              await changeRole(page, attendantName, 'attendant');
              roleRestoredVia = 'ui';
            } catch {
              await sql.begin(async (tx) => {
                await tx.unsafe('RESET ROLE');
                await tx`
                  update profiles
                     set role = 'attendant', claims_version = claims_version + 1, updated_at = now()
                   where id = ${attendantId!}::uuid
                     and clinic_id = ${clinicId!}::uuid
                     and role = 'doctor'
                `;
              });
              roleRestoredVia = 'database-recovery';
            }
          }

          const finalCleanup = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            const cleanupAppointmentIds = [scheduledAppointmentId, walkInAppointmentId].filter(
              (id): id is string => Boolean(id),
            );
            const removedRoleAudit = attendantId
              ? await tx<{ id: string }[]>`
                  delete from audit_events
                   where clinic_id = ${clinicId!}::uuid
                     and resource_id = ${attendantId}
                     and action = 'internal.user.role_changed'
                     and created_at >= ${startedAt}::timestamptz
                     and before ->> 'role' in ('attendant', 'doctor')
                     and after ->> 'role' in ('attendant', 'doctor')
                  returning id::text
                `
              : [];
            const [remaining] = await tx<
              {
                patients: number;
                procedures: number;
                appointments: number;
                prontuarios: number;
                outbox: number;
                ledger: number;
                availability: number;
                role_audit: number;
                attendant_role: string;
              }[]
            >`
              select
                (select count(*)::int from patients where clinic_id = ${clinicId!}::uuid and email = ${patientEmail}) patients,
                (select count(*)::int from procedures where clinic_id = ${clinicId!}::uuid and codigo = ${procedureCode}) procedures,
                (select count(*)::int from appointments where clinic_id = ${clinicId!}::uuid
                  and (patient_id = ${patientId ?? null}::uuid or procedure_id = ${procedureId ?? null}::uuid)) appointments,
                (select count(*)::int from prontuarios where clinic_id = ${clinicId!}::uuid
                  and patient_id = ${patientId ?? null}::uuid) prontuarios,
                (select count(*)::int from outbox where clinic_id = ${clinicId!}::uuid and payload::text like ${`%${marker}%`}) outbox,
                (select count(*)::int from usage_counter_ledger where clinic_id = ${clinicId!}::uuid
                  and dedup_key::text = any(${cleanupAppointmentIds}::text[])) ledger,
                (select count(*)::int from doctor_availability where clinic_id = ${clinicId!}::uuid
                  and id::text = any(${temporaryAvailabilityId ? [temporaryAvailabilityId] : []}::text[])) availability,
                (select count(*)::int from audit_events where clinic_id = ${clinicId!}::uuid
                  and resource_id = ${attendantId ?? ''} and action = 'internal.user.role_changed'
                  and created_at >= ${startedAt}::timestamptz) role_audit,
                coalesce((select role::text from profiles where id = ${attendantId ?? null}::uuid), 'missing') attendant_role
            `;
            return { removedRoleAudit: removedRoleAudit.length, remaining };
          });
          expect(finalCleanup.remaining).toEqual({
            patients: 0,
            procedures: 0,
            appointments: 0,
            prontuarios: 0,
            outbox: 0,
            ledger: 0,
            availability: 0,
            role_audit: 0,
            attendant_role: 'attendant',
          });
          console.log(
            `[appointment-recovery-a-cleanup] ${JSON.stringify({
              ...cleanup,
              roleChanged,
              roleRestoredVia,
              ...finalCleanup,
            })}`,
          );
        }
      } finally {
        await sql.end();
      }
    }
  });
});
