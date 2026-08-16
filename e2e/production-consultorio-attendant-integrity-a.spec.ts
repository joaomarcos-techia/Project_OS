import { expect, test, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_CONSULTORIO_INTEGRITY === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const attendantEmail = process.env.E2E_ATTENDANT_EMAIL;
const doctorEmail = process.env.E2E_DOCTOR_EMAIL;
const financialEmail = process.env.E2E_FINANCIAL_EMAIL;
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
  await page.context().clearCookies();
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
  const digits = Array.from(seed.replace(/\D/gu, '').padStart(9, '6').slice(-9), Number);
  const digit = (values: number[], weight: number) => {
    const rest =
      (values.reduce((sum, value, index) => sum + value * (weight - index), 0) * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const first = digit(digits, 10);
  return [...digits, first, digit([...digits, first], 11)].join('');
}

function todayInClinicTimezone(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

test.describe('produção: integridade clínica do Consultório na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('atendente NAO encerra a consulta; o medico so encerra com prontuario assinado', async ({
    page,
  }, testInfo) => {
    test.setTimeout(420_000);
    test.skip(!authorized, 'Exige E2E_PRODUCTION_CONSULTORIO_INTEGRITY=ALLOW_SYNTHETIC_CLINIC_A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste mutável só pode apontar para app.qoro.dev.');
    }
    if (!attendantEmail || !doctorEmail || !financialEmail || !sharedPassword) {
      throw new Error('Credenciais das roles da Clínica A ausentes.');
    }
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const sql = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
    const startedAt = new Date().toISOString();
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-CONSULTORIO-A-${runId}]`;
    const patientName = `${marker} Paciente`;
    const patientEmail = `e2e-consultorio-a-${runId}@example.test`;
    const today = todayInClinicTimezone();
    const currentWeekday = new Date(`${today}T12:00:00.000Z`).getUTCDay();

    let clinicId: string | undefined;
    let attendantId: string | undefined;
    let doctorId: string | undefined;
    let procedureId: string | undefined;
    let patientId: string | undefined;
    let appointmentId: string | undefined;
    let temporaryAvailabilityId: string | undefined;

    try {
      const roles = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            email: string;
            user_id: string;
            clinic_id: string;
            role: string;
            permissions: string[];
          }[]
        >`
          select lower(u.email) as email,
                 ep.user_id::text,
                 ep.clinic_id::text,
                 ep.role::text,
                 ep.permissions
            from auth.users u
            join effective_permissions_v ep on ep.user_id = u.id
           where lower(u.email) = any(${[
             attendantEmail.toLowerCase(),
             doctorEmail.toLowerCase(),
             financialEmail.toLowerCase(),
           ]}::text[])
             and ep.ativo = true
             and ep.deleted_at is null
        `;
      });
      expect(roles).toHaveLength(3);
      expect(new Set(roles.map(({ clinic_id: id }) => id)).size).toBe(1);
      const byRole = new Map(roles.map((row) => [row.role, row]));
      const attendant = byRole.get('attendant');
      const doctor = byRole.get('doctor');
      const financial = byRole.get('financial');
      if (!attendant || !doctor || !financial) throw new Error('Matriz de roles inesperada.');

      expect(attendant.permissions).toEqual(
        expect.arrayContaining(['edit:agenda', 'view:consultorio']),
      );
      expect(attendant.permissions).not.toContain('create:prontuario');
      expect(attendant.permissions).not.toContain('sign:prontuario');
      expect(doctor.permissions).toEqual(
        expect.arrayContaining(['view:consultorio', 'create:prontuario', 'sign:prontuario']),
      );
      expect(financial.permissions).not.toContain('view:consultorio');

      clinicId = attendant.clinic_id;
      attendantId = attendant.user_id;
      doctorId = doctor.user_id;

      const [procedure] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; duration_min: number; valor: string }[]>`
          select id::text, duracao_padrao_min as duration_min, valor_padrao::text as valor
            from procedures
           where clinic_id = ${clinicId!}::uuid
             and ativo = true
             and valor_padrao > 0
           order by duracao_padrao_min, created_at, id
           limit 1
        `;
      });
      if (!procedure) throw new Error('Clínica A não possui procedimento ativo faturável.');
      procedureId = procedure.id;

      const [capacity] = await sql<
        { remaining_minutes: number; committed_minutes: number; windows: number }[]
      >`
        with clinic_clock as (
          select timezone(c.timezone, now()) as local_now
            from clinics c
           where c.id = ${clinicId}::uuid
        )
        select
          coalesce(sum(greatest(0, extract(epoch from (
            da.end_time - greatest(da.start_time, cc.local_now::time)
          )) / 60)), 0)::int as remaining_minutes,
          (select coalesce(sum(a.duration_min), 0)::int
             from appointments a
            where a.clinic_id = ${clinicId}::uuid
              and a.doctor_id = ${doctorId}::uuid
              and a.status in ('agendado', 'confirmado', 'chegou', 'em_atendimento')
              and timezone((select timezone from clinics where id = ${clinicId}::uuid), a.scheduled_at)::date = cc.local_now::date
              and (a.scheduled_at >= now() or a.status in ('chegou', 'em_atendimento'))) as committed_minutes,
          count(da.id)::int as windows
        from clinic_clock cc
        left join doctor_availability da
          on da.clinic_id = ${clinicId}::uuid
         and da.doctor_id = ${doctorId}::uuid
         and da.weekday = extract(dow from cc.local_now)::int
         and da.end_time > cc.local_now::time
         and da.unit_id is null
        group by cc.local_now
      `;
      if (!capacity) throw new Error('Não foi possível medir a capacidade do médico.');
      const hasCapacity =
        capacity.remaining_minutes - capacity.committed_minutes >= procedure.duration_min;

      if (!hasCapacity) {
        if (capacity.windows > 0) {
          throw new Error(
            'Há janela real do médico sem capacidade restante; o teste não alterará essa configuração.',
          );
        }
        await signIn(page, doctorEmail);
        await page.goto('/configuracoes/horarios');
        const professionalSelect = page.getByLabel('Profissional', { exact: true });
        if ((await professionalSelect.count()) > 0) {
          await professionalSelect.selectOption(doctorId);
        }
        await page.getByLabel('Dia', { exact: true }).selectOption(String(currentWeekday));
        const lunchBreak = page.getByRole('checkbox').first();
        if (await lunchBreak.isChecked()) await lunchBreak.uncheck();
        await page.getByLabel('Início', { exact: true }).fill('00:00');
        await page.getByLabel('Fim', { exact: true }).fill('23:59');
        await page.getByRole('button', { name: 'Adicionar janela', exact: true }).click();
        await expect(page.getByText('Janela adicionada.', { exact: true })).toBeVisible({
          timeout: 30_000,
        });
        const [availability] = await sql<{ id: string }[]>`
          select id::text
            from doctor_availability
           where clinic_id = ${clinicId}::uuid
             and doctor_id = ${doctorId}::uuid
             and weekday = ${currentWeekday}
             and start_time = '00:00'::time
             and end_time = '23:59'::time
             and created_at >= ${startedAt}::timestamptz
           order by created_at desc
           limit 1
        `;
        if (!availability) throw new Error('Disponibilidade temporária não persistiu.');
        temporaryAvailabilityId = availability.id;
      }

      await signIn(page, attendantEmail);
      await page.goto('/pacientes?novo=1');
      const patientDrawer = page.getByRole('dialog', { name: 'Novo paciente' });
      await expect(patientDrawer).toBeVisible();
      await patientDrawer.locator('input[name="nome"]').fill(patientName);
      await patientDrawer.locator('input[name="cpf"]').fill(validCpf(runId));
      await patientDrawer.locator('input[name="email"]').fill(patientEmail);
      await patientDrawer.locator('input[name="telefone"]').fill(`1196${runId.slice(-7)}`);
      await patientDrawer.getByRole('button', { name: 'Criar paciente' }).click();
      await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/u, { timeout: 90_000 });
      patientId = new URL(page.url()).pathname.split('/').at(-1);
      if (!patientId || !/^[0-9a-f-]{36}$/iu.test(patientId)) {
        throw new Error('Paciente sintético sem ID válido.');
      }

      await page.goto('/agenda');
      await page.getByRole('button', { name: 'Novo atendimento' }).click();
      const appointmentDrawer = page.getByRole('dialog', { name: 'Novo atendimento' });
      await appointmentDrawer.getByRole('radio', { name: 'Encaixe (agora)' }).click();
      await appointmentDrawer.getByPlaceholder('Buscar por nome (mín. 2 letras)').fill(patientName);
      await appointmentDrawer.getByRole('option', { name: patientName, exact: true }).click();
      await appointmentDrawer.getByLabel('Procedimento', { exact: true }).selectOption(procedureId);
      await appointmentDrawer.getByLabel('Profissional', { exact: true }).selectOption(doctorId);
      await appointmentDrawer.getByRole('button', { name: 'Criar encaixe', exact: true }).click();
      await expect(page.getByText('Encaixe criado', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await expect
        .poll(async () => {
          const [row] = await sql<{ id: string }[]>`
            select id::text
              from appointments
             where clinic_id = ${clinicId!}::uuid
               and patient_id = ${patientId!}::uuid
               and created_at >= ${startedAt}::timestamptz
             order by created_at desc
             limit 1
          `;
          appointmentId = row?.id;
          return appointmentId;
        })
        .toMatch(/^[0-9a-f-]{36}$/iu);

      await page.goto('/consultorio');
      const doctorSelect = page.getByLabel('Selecionar médico', { exact: true });
      await expect(doctorSelect).toBeVisible();
      await doctorSelect.selectOption(doctorId);
      const waitingCard = page
        .getByText(patientName, { exact: true })
        .locator('xpath=ancestor::div[.//button[normalize-space()="Chamar"]][1]');
      await expect(waitingCard).toBeVisible({ timeout: 30_000 });
      await waitingCard.getByRole('button', { name: 'Chamar', exact: true }).click();
      await expect(page.getByRole('heading', { name: patientName, exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.getByText('O prontuário será criado quando o paciente estiver em atendimento.', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator('textarea')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Assinar consulta', exact: true })).toHaveCount(
        0,
      );
      // AUTHZ-008 — o achado foi um ATENDENTE encerrando a consulta. Declarar
      // que houve atendimento e ato clinico: `edit:agenda` move a fila, mas nao
      // conclui. O controle sumiu para quem nao tem capacidade clinica, e o
      // core recusa mesmo por chamada direta.
      await expect(
        page.getByRole('button', { name: 'Encerrar consulta', exact: true }),
      ).toHaveCount(0);

      const [started] = await sql<
        { status: string; prontuarios: number; queue_status: string | null }[]
      >`
        select a.status::text,
               (select count(*)::int from prontuarios p
                 where p.clinic_id = a.clinic_id and p.appointment_id = a.id) prontuarios,
               (select q.status::text from waiting_queue_entries q
                 where q.clinic_id = a.clinic_id and q.appointment_id = a.id limit 1) queue_status
          from appointments a
         where a.clinic_id = ${clinicId}::uuid and a.id = ${appointmentId!}::uuid
      `;
      expect(started).toEqual({
        status: 'em_atendimento',
        prontuarios: 0,
        queue_status: 'in_service',
      });

      // AUTHZ-008 — o cenario original era o ATENDENTE encerrando: o worker
      // criava um prontuario RASCUNHO depois do fato e o Financeiro ganhava um
      // lancamento de uma consulta sem registro clinico. Esse encadeamento
      // deixou de existir. O caminho legitimo e o medico: rascunho -> conteudo
      // -> ASSINATURA -> encerramento.
      await signIn(page, doctorEmail);
      await page.goto('/consultorio');
      // O medico ve apenas o proprio painel: o seletor de profissional so existe
      // para quem administra a equipe.
      const doctorBoardSelect = page.getByLabel('Selecionar médico', { exact: true });
      if ((await doctorBoardSelect.count()) > 0) {
        await doctorBoardSelect.selectOption(doctorId);
      }
      await page.getByRole('button', { name: 'Encerrar consulta', exact: true }).waitFor({
        timeout: 60_000,
      });

      // O rascunho nasce do handler de `appointment.started` (assincrono).
      await expect
        .poll(
          async () => {
            const [row] = await sql<{ n: number }[]>`
              select count(*)::int n from prontuarios
               where clinic_id = ${clinicId!}::uuid and appointment_id = ${appointmentId!}::uuid
            `;
            return row?.n ?? 0;
          },
          { timeout: 90_000, intervals: [3_000] },
        )
        .toBe(1);
      await page.reload();
      if ((await doctorBoardSelect.count()) > 0) {
        await doctorBoardSelect.selectOption(doctorId);
      }

      const soapField = page.locator('textarea').first();
      await soapField.waitFor({ timeout: 30_000 });
      await soapField.fill(`${marker} evolucao clinica registrada pelo profissional`);

      // O autosave tem debounce de 10s: assinar antes do flush assinaria um
      // prontuario sem o conteudo. `Salvar agora` torna isso deterministico.
      const saveNow = page.getByRole('button', { name: 'Salvar agora', exact: true });
      if ((await saveNow.count()) > 0) {
        await saveNow.first().click();
      }
      await expect
        .poll(
          async () => {
            const [row] = await sql<{ v: number }[]>`
              select row_version v from prontuarios
               where clinic_id = ${clinicId!}::uuid and appointment_id = ${appointmentId!}::uuid
            `;
            return row?.v ?? 0;
          },
          { timeout: 40_000, intervals: [2_000] },
        )
        .toBeGreaterThan(1);

      await page.getByRole('button', { name: 'Assinar consulta', exact: true }).first().click();
      const signDialog = page.getByRole('dialog', { name: 'Assinar prontuário' });
      await signDialog.getByRole('button', { name: 'Assinar consulta', exact: true }).click();
      await expect
        .poll(
          async () => {
            const [row] = await sql<{ status: string }[]>`
              select status::text from prontuarios
               where clinic_id = ${clinicId!}::uuid and appointment_id = ${appointmentId!}::uuid
            `;
            return row?.status;
          },
          { timeout: 60_000, intervals: [2_000] },
        )
        .toBe('assinado');

      // So AGORA o encerramento e possivel — a invariante clinica do AUTHZ-008.
      await page.getByRole('button', { name: 'Encerrar consulta', exact: true }).click();
      await expect
        .poll(async () => {
          const [row] = await sql<{ status: string }[]>`
            select status::text from appointments
             where clinic_id = ${clinicId!}::uuid and id = ${appointmentId!}::uuid
          `;
          return row?.status;
        })
        .toBe('atendido');

      const [completed] = await sql<
        {
          status: string;
          prontuarios: number;
          queue_status: string | null;
          transitions: string[];
          completed_events: number;
        }[]
      >`
        select a.status::text,
               (select count(*)::int from prontuarios p
                 where p.clinic_id = a.clinic_id and p.appointment_id = a.id) prontuarios,
               (select q.status::text from waiting_queue_entries q
                 where q.clinic_id = a.clinic_id and q.appointment_id = a.id limit 1) queue_status,
               (select array_agg(l.to_status::text order by l.transitioned_at)
                  from appointment_state_log l
                 where l.clinic_id = a.clinic_id and l.appointment_id = a.id) transitions,
               (select count(*)::int from outbox o
                 where o.clinic_id = a.clinic_id
                   and o.event_type = 'scheduling.appointment.completed'
                   and o.payload ->> 'appointmentId' = a.id::text) completed_events
          from appointments a
         where a.clinic_id = ${clinicId}::uuid and a.id = ${appointmentId!}::uuid
      `;
      // `prontuarios: 1` — antes era 0, porque a consulta era encerrada SEM
      // registro clinico. E o que o AUTHZ-008 tornou impossivel.
      expect(completed).toEqual({
        status: 'atendido',
        prontuarios: 1,
        queue_status: 'completed',
        transitions: ['chegou', 'em_atendimento', 'atendido'],
        completed_events: 1,
      });

      await signIn(page, doctorEmail);
      await page.goto('/consultorio');
      const finalizedButton = page.locator('button').filter({ hasText: patientName }).last();
      await expect(finalizedButton).toBeVisible({ timeout: 30_000 });
      await finalizedButton.click();
      await expect(
        page.getByText('Consulta finalizada — somente leitura.', { exact: true }),
      ).toBeVisible();
      // A consulta finalizada agora TEM prontuario assinado, entao a tela nao
      // mostra mais "sera criado quando o paciente estiver em atendimento" —
      // essa mensagem era o sintoma de encerrar sem registro clinico.
      await expect(
        page.getByText('O prontuário será criado quando o paciente estiver em atendimento.', {
          exact: true,
        }),
      ).toHaveCount(0);
      // Assinado = imutavel. O conteudo agora APARECE (antes nao havia
      // prontuario nenhum), mas nenhum campo e editavel.
      await expect(page.locator('textarea:not([disabled]):not([readonly])')).toHaveCount(0);

      await signIn(page, financialEmail);
      await page.goto('/consultorio');
      await expect(page.getByText('Sem acesso', { exact: true })).toBeVisible();

      let financialEntry: { id: string; status: string; valor: string } | undefined;
      let completedEventProcessed = false;
      for (let attempt = 0; attempt < 18; attempt += 1) {
        const [entry] = await sql<{ id: string; status: string; valor: string }[]>`
          select id::text, status::text, valor::text
            from lancamentos
           where clinic_id = ${clinicId}::uuid and appointment_id = ${appointmentId!}::uuid
           limit 1
        `;
        const [event] = await sql<{ processed: boolean }[]>`
          select (processed_at is not null) processed
            from outbox
           where clinic_id = ${clinicId}::uuid
             and event_type = 'scheduling.appointment.completed'
             and payload ->> 'appointmentId' = ${appointmentId!}
           limit 1
        `;
        financialEntry = entry;
        completedEventProcessed = event?.processed ?? false;
        if (financialEntry || attempt === 17) break;
        await page.waitForTimeout(5_000);
      }

      const [lateProntuario] = await sql<
        {
          id: string;
          status: string;
          row_version: number;
          version: number;
          signed: boolean;
          created_by: string | null;
        }[]
      >`
        select id::text,
               status::text,
               row_version,
               version,
               (signed_at is not null) signed,
               created_by::text
          from prontuarios
         where clinic_id = ${clinicId}::uuid
           and appointment_id = ${appointmentId!}::uuid
         limit 1
      `;
      // O prontuario existe, foi preenchido e esta ASSINADO — nao mais um
      // rascunho vazio criado depois do encerramento.
      expect(lateProntuario).toMatchObject({
        status: 'assinado',
        signed: true,
        created_by: doctorId,
      });

      await signIn(page, doctorEmail);
      await page.goto('/consultorio');
      const lateFinalizedButton = page.locator('button').filter({ hasText: patientName }).last();
      await expect(lateFinalizedButton).toBeVisible({ timeout: 30_000 });
      await lateFinalizedButton.click();
      await expect(
        page.getByText('Consulta finalizada — somente leitura.', { exact: true }),
      ).toBeVisible();
      // Antes o rascunho tardio ficava EDITAVEL depois da consulta encerrada —
      // consequencia direta de encerrar sem registro clinico. Assinado, e
      // imutavel.
      await expect(page.locator('textarea').first()).toBeVisible();
      await expect(page.locator('textarea').first()).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Assinar consulta', exact: true })).toHaveCount(
        0,
      );

      const result = {
        clinic: 'A',
        permissions: {
          attendantCanEditAgendaAndViewConsultorio: true,
          attendantCanCreateProntuario: false,
          attendantCanSignProntuario: false,
          doctorCanCreateAndSignProntuario: true,
          financialConsultorioDenied: true,
        },
        fixture: {
          syntheticPatient: true,
          syntheticWalkIn: true,
          temporaryAvailabilityCreated: Boolean(temporaryAvailabilityId),
        },
        attendantCanCompleteConsult: false,
        completionRequiredSignedProntuario: completed?.prontuarios === 1,
        finalStatus: completed?.status,
        stateTransitions: completed?.transitions,
        clinicalRecord: {
          observed: Boolean(lateProntuario),
          status: lateProntuario?.status,
          signed: lateProntuario?.signed ?? null,
          attributedToDoctor: lateProntuario?.created_by === doctorId,
        },
        doctorAfterCompletionView: 'read-only-with-signed-immutable-record',
        completedEventPublished: completed?.completed_events === 1,
        completedEventProcessed,
        automaticFinancialEntryObserved: Boolean(financialEntry),
        automaticFinancialEntry: financialEntry
          ? { status: financialEntry.status, positiveValue: Number(financialEntry.valor) > 0 }
          : null,
        externalProviderCalls: false,
        result: 'clinical-integrity-enforced-completion-requires-signed-record',
      };
      console.log(`[consultorio-attendant-integrity-a] ${JSON.stringify(result)}`);
      await testInfo.attach('consultorio-attendant-integrity-a-result.json', {
        body: JSON.stringify(result, null, 2),
        contentType: 'application/json',
      });
    } finally {
      try {
        if (clinicId) {
          const cleanup = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            const patients = await tx<{ id: string }[]>`
              select id::text from patients
               where clinic_id = ${clinicId!}::uuid and email = ${patientEmail} and nome = ${patientName}
            `;
            const patientIds = patients.map(({ id }) => id);
            const appointments = await tx<{ id: string }[]>`
              select id::text from appointments
               where clinic_id = ${clinicId!}::uuid
                 and (id = ${appointmentId ?? null}::uuid
                      or patient_id::text = any(${patientIds}::text[]))
            `;
            const appointmentIds = appointments.map(({ id }) => id);
            const prontuarios = await tx<{ id: string }[]>`
              select id::text from prontuarios
               where clinic_id = ${clinicId!}::uuid
                 and (patient_id::text = any(${patientIds}::text[])
                      or appointment_id::text = any(${appointmentIds}::text[]))
            `;
            const prontuarioIds = prontuarios.map(({ id }) => id);
            const lancamentos = await tx<{ id: string }[]>`
              select id::text from lancamentos
               where clinic_id = ${clinicId!}::uuid
                 and appointment_id::text = any(${appointmentIds}::text[])
            `;
            const lancamentoIds = lancamentos.map(({ id }) => id);
            const transactions = await tx<{ id: string }[]>`
              select id::text from payment_transactions
               where clinic_id = ${clinicId!}::uuid
                 and lancamento_id::text = any(${lancamentoIds}::text[])
            `;
            const transactionIds = transactions.map(({ id }) => id);
            const allResourceIds = [
              ...patientIds,
              ...appointmentIds,
              ...prontuarioIds,
              ...lancamentoIds,
              ...transactionIds,
              ...(temporaryAvailabilityId ? [temporaryAvailabilityId] : []),
            ];

            const removedOutbox = await tx<{ id: string }[]>`
              delete from outbox
               where clinic_id = ${clinicId!}::uuid
                 and (payload::text like ${`%${marker}%`}
                      or payload ->> 'patientId' = any(${patientIds}::text[])
                      or payload ->> 'appointmentId' = any(${appointmentIds}::text[])
                      or payload ->> 'prontuarioId' = any(${prontuarioIds}::text[])
                      or payload ->> 'lancamentoId' = any(${lancamentoIds}::text[])
                      or payload ->> 'transactionId' = any(${transactionIds}::text[]))
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
                      or response ->> 'appointmentId' = any(${appointmentIds}::text[])
                      or response ->> 'prontuarioId' = any(${prontuarioIds}::text[])
                      or response ->> 'lancamentoId' = any(${lancamentoIds}::text[]))
              returning key
            `;
            const removedCollectionCases = await tx<{ id: string }[]>`
              delete from collection_cases
               where clinic_id = ${clinicId!}::uuid
                 and lancamento_id::text = any(${lancamentoIds}::text[])
              returning id::text
            `;
            await tx`
              delete from payment_proofs
               where clinic_id = ${clinicId!}::uuid
                 and (lancamento_id::text = any(${lancamentoIds}::text[])
                      or transaction_id::text = any(${transactionIds}::text[]))
            `;
            const removedTransactions = await tx<{ id: string }[]>`
              delete from payment_transactions
               where clinic_id = ${clinicId!}::uuid
                 and id::text = any(${transactionIds}::text[])
              returning id::text
            `;
            const removedPending = await tx<{ id: string }[]>`
              delete from faturamento_pendencias
               where clinic_id = ${clinicId!}::uuid
                 and appointment_id::text = any(${appointmentIds}::text[])
              returning id::text
            `;
            const removedLancamentos = await tx<{ id: string }[]>`
              delete from lancamentos
               where clinic_id = ${clinicId!}::uuid
                 and id::text = any(${lancamentoIds}::text[])
              returning id::text
            `;
            const removedProntuarios = await tx<{ id: string }[]>`
              delete from prontuarios
               where clinic_id = ${clinicId!}::uuid
                 and id::text = any(${prontuarioIds}::text[])
              returning id::text
            `;
            const removedAppointments = await tx<{ id: string }[]>`
              delete from appointments
               where clinic_id = ${clinicId!}::uuid
                 and id::text = any(${appointmentIds}::text[])
              returning id::text
            `;
            const removedAvailability = await tx<{ id: string }[]>`
              delete from doctor_availability
               where clinic_id = ${clinicId!}::uuid
                 and id::text = any(${temporaryAvailabilityId ? [temporaryAvailabilityId] : []}::text[])
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
                prontuarios: number;
                lancamentos: number;
                pending: number;
                collection_cases: number;
                outbox: number;
                ledger: number;
                availability: number;
                audit: number;
                idempotency: number;
              }[]
            >`
              select
                (select count(*)::int from patients
                  where clinic_id = ${clinicId!}::uuid and email = ${patientEmail}) patients,
                (select count(*)::int from appointments
                  where clinic_id = ${clinicId!}::uuid
                    and id::text = any(${appointmentIds}::text[])) appointments,
                (select count(*)::int from prontuarios
                  where clinic_id = ${clinicId!}::uuid
                    and (patient_id::text = any(${patientIds}::text[])
                         or appointment_id::text = any(${appointmentIds}::text[]))) prontuarios,
                (select count(*)::int from lancamentos
                  where clinic_id = ${clinicId!}::uuid
                    and appointment_id::text = any(${appointmentIds}::text[])) lancamentos,
                (select count(*)::int from faturamento_pendencias
                  where clinic_id = ${clinicId!}::uuid
                    and appointment_id::text = any(${appointmentIds}::text[])) pending,
                (select count(*)::int from collection_cases
                  where clinic_id = ${clinicId!}::uuid
                    and lancamento_id::text = any(${lancamentoIds}::text[])) collection_cases,
                (select count(*)::int from outbox
                  where clinic_id = ${clinicId!}::uuid
                    and (payload::text like ${`%${marker}%`}
                         or payload ->> 'appointmentId' = any(${appointmentIds}::text[]))) outbox,
                (select count(*)::int from usage_counter_ledger
                  where clinic_id = ${clinicId!}::uuid
                    and dedup_key = any(${appointmentIds}::text[])) ledger,
                (select count(*)::int from doctor_availability
                  where clinic_id = ${clinicId!}::uuid
                    and id::text = any(${temporaryAvailabilityId ? [temporaryAvailabilityId] : []}::text[])) availability,
                (select count(*)::int from audit_events
                  where clinic_id = ${clinicId!}::uuid
                    and created_at >= ${startedAt}::timestamptz
                    and (resource_id = any(${allResourceIds}::text[])
                         or coalesce(after::text, '') like ${`%${marker}%`})) audit,
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
                collectionCases: removedCollectionCases.length,
                transactions: removedTransactions.length,
                pending: removedPending.length,
                lancamentos: removedLancamentos.length,
                prontuarios: removedProntuarios.length,
                appointments: removedAppointments.length,
                availability: removedAvailability.length,
                patients: removedPatients.length,
              },
              remaining,
            };
          });
          expect(cleanup.remaining).toEqual({
            patients: 0,
            appointments: 0,
            prontuarios: 0,
            lancamentos: 0,
            pending: 0,
            collection_cases: 0,
            outbox: 0,
            ledger: 0,
            availability: 0,
            audit: 0,
            idempotency: 0,
          });
          console.log(
            `[consultorio-attendant-integrity-a-cleanup] ${JSON.stringify({
              ...cleanup,
              attendantRoleUnchanged: Boolean(attendantId),
            })}`,
          );
          await testInfo.attach('consultorio-attendant-integrity-a-cleanup.json', {
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
