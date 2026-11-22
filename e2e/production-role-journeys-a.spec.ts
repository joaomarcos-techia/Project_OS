import { expect, test, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_ROLE_JOURNEYS === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const attendantEmail = process.env.E2E_ATTENDANT_EMAIL;
const doctorEmail = process.env.E2E_DOCTOR_EMAIL;
const financialEmail = process.env.E2E_FINANCIAL_EMAIL;
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
  const digits = Array.from(seed.replace(/\D/gu, '').padStart(9, '5').slice(-9), Number);
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

function isoToBrDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) throw new Error('Data ISO inválida.');
  return `${day}/${month}/${year}`;
}

test.describe.serial('produção: jornadas humanas por role na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  const runId = String(Date.now()).slice(-10);
  const marker = `[E2E-ROLE-A-${runId}]`;
  const patientName = `${marker} Paciente`;
  const patientEmail = `e2e-role-a-${runId}@example.test`;
  const financialDescription = `${marker} Recebimento`;
  const clinicalContent = `${marker} evolução clínica sintética sem dado real.`;
  const today = todayInClinicTimezone();
  const currentWeekday = new Date(`${today}T12:00:00.000Z`).getUTCDay();

  const databaseUrl = process.env.DATABASE_URL_PROD;
  const sql = databaseUrl
    ? postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false })
    : undefined;

  let clinicId: string | undefined;
  let doctorId: string | undefined;
  let procedureId: string | undefined;
  let patientId: string | undefined;
  let appointmentId: string | undefined;
  let temporaryAvailabilityId: string | undefined;

  test.beforeAll(async () => {
    test.skip(!authorized, 'Exige E2E_PRODUCTION_ROLE_JOURNEYS=ALLOW_SYNTHETIC_CLINIC_A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('As jornadas mutáveis só podem apontar para app.qoro.dev.');
    }
    if (!attendantEmail || !doctorEmail || !financialEmail || !sharedPassword) {
      throw new Error('Credenciais das roles da Clínica A ausentes.');
    }
    if (!sql) throw new Error('DATABASE_URL_PROD ausente.');

    const rows = await sql.begin(async (tx) => {
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
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map(({ clinic_id: id }) => id)).size).toBe(1);

    const byRole = new Map(rows.map((row) => [row.role, row]));
    const attendant = byRole.get('attendant');
    const doctor = byRole.get('doctor');
    const financial = byRole.get('financial');
    if (!attendant || !doctor || !financial) throw new Error('Matriz de roles inesperada.');
    expect(attendant.permissions).toEqual(
      expect.arrayContaining(['create:patient', 'edit:agenda', 'view:consultorio']),
    );
    expect(attendant.permissions).not.toContain('manage:employees');
    expect(doctor.permissions).toEqual(
      expect.arrayContaining([
        'view:patient',
        'view:agenda',
        'view:consultorio',
        'create:prontuario',
        'sign:prontuario',
      ]),
    );
    expect(doctor.permissions).not.toContain('manage:settings');
    expect(financial.permissions).toEqual(
      expect.arrayContaining(['view:financial', 'manage:financial', 'operate:caixa']),
    );
    expect(financial.permissions).not.toContain('view:consultorio');

    clinicId = attendant.clinic_id;
    doctorId = doctor.user_id;
    const [procedure] = await sql.begin(async (tx) => {
      await tx.unsafe('RESET ROLE');
      return tx<{ id: string }[]>`
        select id::text
          from procedures
         where clinic_id = ${clinicId!}::uuid
           and ativo = true
         order by created_at, id
         limit 1
      `;
    });
    if (!procedure) throw new Error('Clínica A não possui procedimento ativo para a jornada.');
    procedureId = procedure.id;
  });

  test.afterAll(async () => {
    if (!sql) return;
    try {
      if (!clinicId) return;
      const cleanup = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const patients = await tx<{ id: string }[]>`
          select id::text
            from patients
           where clinic_id = ${clinicId!}::uuid
             and email = ${patientEmail}
             and nome = ${patientName}
        `;
        const patientIds = patients.map(({ id }) => id);
        const appointments = await tx<{ id: string }[]>`
          select id::text
            from appointments
           where clinic_id = ${clinicId!}::uuid
             and patient_id::text = any(${patientIds}::text[])
        `;
        const appointmentIds = appointments.map(({ id }) => id);
        const prontuarios = await tx<{ id: string }[]>`
          select id::text
            from prontuarios
           where clinic_id = ${clinicId!}::uuid
             and (patient_id::text = any(${patientIds}::text[])
                  or appointment_id::text = any(${appointmentIds}::text[]))
        `;
        const prontuarioIds = prontuarios.map(({ id }) => id);
        const lancamentos = await tx<{ id: string }[]>`
          select id::text
            from lancamentos
           where clinic_id = ${clinicId!}::uuid
             and (appointment_id::text = any(${appointmentIds}::text[])
                  or descricao = ${financialDescription})
        `;
        const lancamentoIds = lancamentos.map(({ id }) => id);
        const transactions = await tx<{ id: string }[]>`
          select id::text
            from payment_transactions
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
             and (
               payload::text like ${`%${marker}%`}
               or payload ->> 'patientId' = any(${patientIds}::text[])
               or payload ->> 'appointmentId' = any(${appointmentIds}::text[])
               or payload ->> 'prontuarioId' = any(${prontuarioIds}::text[])
               or payload ->> 'lancamentoId' = any(${lancamentoIds}::text[])
               or payload ->> 'transactionId' = any(${transactionIds}::text[])
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
             and (
               resource_id = any(${allResourceIds}::text[])
               or coalesce(before::text, '') like ${`%${marker}%`}
               or coalesce(after::text, '') like ${`%${marker}%`}
             )
          returning id::text
        `;
        const removedIdempotency = await tx<{ key: string }[]>`
          delete from idempotency_keys
           where clinic_id = ${clinicId!}::uuid
             and (
               response ->> 'id' = any(${allResourceIds}::text[])
               or response ->> 'appointmentId' = any(${appointmentIds}::text[])
               or response ->> 'prontuarioId' = any(${prontuarioIds}::text[])
               or response ->> 'lancamentoId' = any(${lancamentoIds}::text[])
             )
          returning key
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
             and doctor_id = ${doctorId!}::uuid
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
            transactions: number;
            outbox: number;
            ledger: number;
            availability: number;
          }[]
        >`
          select
            (select count(*)::int from patients
              where clinic_id = ${clinicId!}::uuid and email = ${patientEmail}) patients,
            (select count(*)::int from appointments
              where clinic_id = ${clinicId!}::uuid
                and patient_id::text = any(${patientIds}::text[])) appointments,
            (select count(*)::int from prontuarios
              where clinic_id = ${clinicId!}::uuid
                and patient_id::text = any(${patientIds}::text[])) prontuarios,
            (select count(*)::int from lancamentos
              where clinic_id = ${clinicId!}::uuid
                and (appointment_id::text = any(${appointmentIds}::text[])
                     or descricao = ${financialDescription})) lancamentos,
            (select count(*)::int from payment_transactions
              where clinic_id = ${clinicId!}::uuid
                and lancamento_id::text = any(${lancamentoIds}::text[])) transactions,
            (select count(*)::int from outbox
              where clinic_id = ${clinicId!}::uuid
                and payload::text like ${`%${marker}%`}) outbox,
            (select count(*)::int from usage_counter_ledger
              where clinic_id = ${clinicId!}::uuid
                and dedup_key = any(${appointmentIds}::text[])) ledger,
            (select count(*)::int from doctor_availability
              where clinic_id = ${clinicId!}::uuid
                and id::text = any(${temporaryAvailabilityId ? [temporaryAvailabilityId] : []}::text[])) availability
        `;
        return {
          outbox: removedOutbox.length,
          ledger: removedLedger.length,
          audit: removedAudit.length,
          idempotency: removedIdempotency.length,
          transactions: removedTransactions.length,
          lancamentos: removedLancamentos.length,
          prontuarios: removedProntuarios.length,
          appointments: removedAppointments.length,
          availability: removedAvailability.length,
          patients: removedPatients.length,
          remaining,
        };
      });
      expect(cleanup.remaining).toEqual({
        patients: 0,
        appointments: 0,
        prontuarios: 0,
        lancamentos: 0,
        transactions: 0,
        outbox: 0,
        ledger: 0,
        availability: 0,
      });
      console.log(`[role-journeys-a-cleanup] ${JSON.stringify(cleanup)}`);
    } finally {
      await sql.end();
    }
  });

  test('fixture autorizada — médico configura disponibilidade temporária para o encaixe', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    if (!doctorEmail || !doctorId || !clinicId || !sql) throw new Error('Pré-condição ausente.');
    await signIn(page, doctorEmail);
    await page.goto('/configuracoes/horarios');

    const professionalSelect = page.getByLabel('Profissional', { exact: true });
    if ((await professionalSelect.count()) > 0) await professionalSelect.selectOption(doctorId);
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
       order by created_at desc
       limit 1
    `;
    if (!availability) throw new Error('Disponibilidade temporária não persistiu.');
    temporaryAvailabilityId = availability.id;
    console.log(
      `[role-journeys-a-availability] ${JSON.stringify({
        configuredByDoctor: true,
        currentWeekday,
        window: 'full-day-test-fixture',
        result: 'pass',
      })}`,
    );
  });

  test('Jornada 2 — atendente cria paciente e encaixe, consulta a fila e é bloqueado na equipe', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    if (!attendantEmail || !procedureId || !doctorId) throw new Error('Pré-condição ausente.');
    await signIn(page, attendantEmail);

    await page.goto('/pacientes?novo=1');
    const patientDrawer = page.getByRole('dialog', { name: 'Novo paciente' });
    await expect(patientDrawer).toBeVisible();
    await patientDrawer.locator('input[name="nome"]').fill(patientName);
    await patientDrawer.locator('input[name="cpf"]').fill(validCpf(`${runId}2`));
    await patientDrawer.locator('input[name="email"]').fill(patientEmail);
    await patientDrawer.locator('input[name="telefone"]').fill('11955550002');
    await patientDrawer.getByRole('button', { name: 'Criar paciente' }).click();
    await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/u, { timeout: 90_000 });
    patientId = new URL(page.url()).pathname.split('/').at(-1);
    if (!patientId || !/^[0-9a-f-]{36}$/iu.test(patientId)) {
      throw new Error('Paciente sintético sem ID válido.');
    }
    await expect(page.getByRole('heading', { name: patientName, exact: true })).toBeVisible();

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

    if (!sql || !clinicId) throw new Error('Banco da jornada indisponível.');
    await expect
      .poll(async () => {
        const [row] = await sql<{ id: string }[]>`
          select id::text
            from appointments
           where clinic_id = ${clinicId!}::uuid
             and patient_id = ${patientId!}::uuid
           order by created_at desc
           limit 1
        `;
        appointmentId = row?.id;
        return appointmentId;
      })
      .toMatch(/^[0-9a-f-]{36}$/iu);

    await page.goto('/consultorio');
    // O board nunca mistura medicos: para quem nao e practitioner ele default
    // ao primeiro medico do dia em ordem alfabetica. Com mais de um medico com
    // agenda hoje, a fila do encaixe so aparece ao selecionar o profissional.
    const boardDoctorSelect = page.getByLabel('Selecionar médico');
    if ((await boardDoctorSelect.count()) > 0) {
      await boardDoctorSelect.selectOption(doctorId);
    }
    await expect(page.getByText(patientName, { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.goto('/equipe');
    await expect(page.getByText('Sem acesso', { exact: true })).toBeVisible();

    console.log(
      `[journey-attendant-a] ${JSON.stringify({
        login: true,
        patientCreated: true,
        walkInCreated: true,
        consultorioQueueVisible: true,
        teamAdministrationDenied: true,
        result: 'pass',
      })}`,
    );
  });

  test('Jornada 3 — médico acessa paciente/agenda, atende e assina, mas não administra', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    if (!doctorEmail || !patientId || !appointmentId) throw new Error('Pré-condição ausente.');
    await signIn(page, doctorEmail);

    await page.goto(`/pacientes/${patientId}`);
    await expect(page.getByRole('heading', { name: patientName, exact: true })).toBeVisible();
    await page.goto(`/agenda?view=day&date=${today}`);
    await expect(page.getByText(patientName, { exact: true })).toBeVisible({ timeout: 30_000 });

    await page.goto('/consultorio');
    const waitingCard = page
      .getByText(patientName, { exact: true })
      .locator('xpath=ancestor::div[.//button[normalize-space()="Chamar"]][1]');
    await expect(waitingCard).toBeVisible({ timeout: 30_000 });
    await waitingCard.getByRole('button', { name: 'Chamar' }).click();
    await expect(page.getByRole('heading', { name: patientName, exact: true })).toBeVisible({
      timeout: 30_000,
    });

    const prontuarioField = page.locator('textarea').first();
    await prontuarioField.fill(clinicalContent);
    await page.getByRole('button', { name: 'Salvar agora', exact: true }).click();
    await expect(page.getByText(/Salvo/u)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Assinar consulta', exact: true }).click();
    const signDialog = page.getByRole('dialog', { name: 'Assinar prontuário' });
    await signDialog.getByRole('button', { name: 'Assinar consulta', exact: true }).click();
    await expect(page.getByText('Prontuário assinado', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Encerrar consulta', exact: true }).click();
    await expect(page.getByText(patientName, { exact: true })).toBeVisible({ timeout: 30_000 });

    await page.goto('/configuracoes/perfil');
    await expect(page.getByText('Sem acesso', { exact: true })).toBeVisible();
    await page.goto('/equipe');
    await expect(page.getByText('Sem acesso', { exact: true })).toBeVisible();

    console.log(
      `[journey-doctor-a] ${JSON.stringify({
        login: true,
        patientVisible: true,
        agendaVisible: true,
        consultorioStarted: true,
        prontuarioSavedAndSigned: true,
        appointmentCompleted: true,
        settingsDenied: true,
        teamAdministrationDenied: true,
        result: 'pass',
      })}`,
    );
  });

  test('Jornada 4 — financeiro cria e recebe lançamento, abre relatório e é bloqueado no clínico', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    if (!financialEmail) throw new Error('Pré-condição ausente.');
    await signIn(page, financialEmail);

    await page.goto('/financeiro?novo=1');
    const financialDrawer = page.getByRole('dialog', { name: 'Novo lançamento' });
    await financialDrawer.getByLabel('Descrição').fill(financialDescription);
    await financialDrawer.getByLabel('Valor (R$)').fill('10,01');
    await financialDrawer.getByLabel('Vencimento').fill(isoToBrDate(today));
    await financialDrawer.getByRole('button', { name: 'Criar lançamento' }).click();
    await expect(page).toHaveURL(/\/financeiro$/u, { timeout: 30_000 });
    await expect(
      page.getByText(financialDescription, { exact: true }).locator('xpath=ancestor::tr[1]'),
    ).toBeVisible({ timeout: 30_000 });

    await page.goto('/caixa');
    const financialCard = page
      .getByText(financialDescription, { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded-(--card-radius)")][1]');
    await expect(financialCard).toBeVisible({ timeout: 30_000 });
    await financialCard.getByRole('button', { name: 'Registrar recebimento' }).click();
    await financialCard.getByRole('button', { name: /Registrar R\$/u }).click();
    await expect(financialCard.getByText('Pago', { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await page.goto('/relatorios?periodo=30d');
    await expect(page.getByText('Faturamento (recebido)', { exact: true })).toBeVisible();
    await page.goto('/consultorio');
    await expect(page.getByText('Sem acesso', { exact: true })).toBeVisible();

    console.log(
      `[journey-financial-a] ${JSON.stringify({
        login: true,
        manualReceivableCreated: true,
        paymentConfirmed: true,
        financialReportVisible: true,
        consultorioDenied: true,
        result: 'pass',
      })}`,
    );
  });
});
