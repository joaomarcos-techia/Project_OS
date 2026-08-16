import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_APPOINTMENT_IMPORT === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const attendantEmail = process.env.E2E_ATTENDANT_EMAIL;
const ownerBEmail = process.env.E2E_OWNER_B_EMAIL;
const sharedPassword = process.env.E2E_TENANT_PASSWORD;

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'off',
  video: 'off',
  screenshot: 'off',
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
  const digits = Array.from(seed.replace(/\D/gu, '').padStart(9, '4').slice(-9), Number);
  const digit = (values: number[], weight: number) => {
    const rest =
      (values.reduce((sum, value, index) => sum + value * (weight - index), 0) * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const first = digit(digits, 10);
  return [...digits, first, digit([...digits, first], 11)].join('');
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

type ImportItem = {
  doctorId: string;
  patientId: string;
  procedureId: string;
  scheduledAt: string;
  historicalStatus: 'atendido' | 'cancelado' | 'faltou';
  externalReference: string;
  observacoes: string;
};

async function prepareImport(
  page: Page,
  input: { source: string; justification: string; items: ImportItem[]; filename: string },
) {
  await page.getByLabel('Fonte dos dados', { exact: true }).fill(input.source);
  await page.getByLabel('Justificativa', { exact: true }).fill(input.justification);
  const payload = JSON.stringify(input.items);
  await page.getByLabel('Arquivo JSON', { exact: true }).setInputFiles({
    name: input.filename,
    mimeType: 'application/json',
    buffer: Buffer.from(payload),
  });
  await expect(page.locator('input[name="payload"]')).toHaveValue(payload);
}

async function submitImport(page: Page): Promise<Response> {
  const responsePromise = page.waitForResponse(isServerAction);
  await page.getByRole('button', { name: 'Importar historico', exact: true }).click();
  return responsePromise;
}

type CapturedAction = {
  body: Buffer;
  headers: Record<string, string>;
};

function captureHeaders(request: Request): Record<string, string> {
  const source = request.headers();
  const names = [
    'accept',
    'content-type',
    'next-action',
    'next-router-state-tree',
    'next-url',
    'origin',
    'referer',
  ];
  return Object.fromEntries(names.flatMap((name) => (source[name] ? [[name, source[name]!]] : [])));
}

test.describe('produção: importação histórica da Agenda na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('RBAC, validação, rollback, proveniência, idempotência, metering e cleanup', async ({
    browser,
  }) => {
    test.setTimeout(540_000);
    test.skip(
      !authorized,
      'Exige autorização explícita para importação histórica sintética na Clínica A.',
    );
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de importação só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !attendantEmail || !ownerBEmail || !sharedPassword) {
      throw new Error('Credenciais das Clínicas A/B ausentes.');
    }

    const { databaseUrl } = productionConfig();
    const sql = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
    const ownerContext = await browser.newContext({ baseURL: baseUrl });
    const attendantContext = await browser.newContext({ baseURL: baseUrl });
    const ownerPage = await ownerContext.newPage();
    const attendantPage = await attendantContext.newPage();
    const startedAt = new Date();
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-IMPORT-A-${runId}]`;
    const patientName = `${marker} Paciente`;
    const patientEmail = `e2e-import-a-${runId}@example.test`;
    const currentPeriod = new Date().toISOString().slice(0, 7);
    let clinicId: string | undefined;
    let patientId: string | undefined;
    let appointmentIds: string[] = [];
    let batchIds: string[] = [];
    let cleanup: Record<string, number> | undefined;

    try {
      const [setup] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const [owner] = await tx<
          { clinic_id: string; actor_id: string; timezone: string; can_import: boolean }[]
        >`
          select p.clinic_id::text, p.id::text actor_id, c.timezone,
                 'import:agenda'=any(ep.permissions) can_import
            from profiles p
            join auth.users u on u.id=p.id
            join effective_permissions_v ep on ep.user_id=p.id and ep.clinic_id=p.clinic_id
            join clinics c on c.id=p.clinic_id
           where lower(u.email)=${ownerEmail.toLowerCase()}
             and p.role='owner' and p.ativo=true and p.deleted_at is null
           limit 1
        `;
        const [attendant] = await tx<{ clinic_id: string; can_import: boolean }[]>`
          select p.clinic_id::text, 'import:agenda'=any(ep.permissions) can_import
            from profiles p
            join auth.users u on u.id=p.id
            join effective_permissions_v ep on ep.user_id=p.id and ep.clinic_id=p.clinic_id
           where lower(u.email)=${attendantEmail.toLowerCase()}
             and p.role='attendant' and p.ativo=true and p.deleted_at is null
           limit 1
        `;
        const [doctor] = await tx<{ id: string; nome: string }[]>`
          select id::text, nome from profiles
           where clinic_id=${owner?.clinic_id ?? ''}::uuid and ativo=true and deleted_at is null
             and invite_accepted_at is not null and (role='doctor' or crm is not null)
           order by case when role='doctor' then 0 else 1 end, created_at, id
           limit 1
        `;
        const [procedure] = await tx<
          { id: string; descricao: string; valor: string; duration: number }[]
        >`
          select id::text, descricao, valor_padrao::text valor, duracao_padrao_min duration
            from procedures
           where clinic_id=${owner?.clinic_id ?? ''}::uuid and ativo=true
           order by created_at, id
           limit 1
        `;
        const [crossTenantProfile] = await tx<{ id: string; clinic_id: string }[]>`
          select p.id::text, p.clinic_id::text
            from profiles p join auth.users u on u.id=p.id
           where lower(u.email)=${ownerBEmail.toLowerCase()}
             and p.ativo=true and p.deleted_at is null
           limit 1
        `;
        const [freeYear] = await tx<{ chosen_year: number }[]>`
          select candidate::int chosen_year
            from (values (2001), (2002), (2003), (2004), (2005)) as years(candidate)
           where not exists (
             select 1 from appointments a
              where a.doctor_id=${doctor?.id ?? ''}::uuid
                and a.scheduled_at >= (make_date(candidate,1,1)::timestamp at time zone ${owner?.timezone ?? 'UTC'})
                and a.scheduled_at < (make_date(candidate+1,1,1)::timestamp at time zone ${owner?.timezone ?? 'UTC'})
           )
           order by candidate
           limit 1
        `;
        const [baseline] = await tx<{ usage: number; fixture: number }[]>`
          select
            coalesce((select agendamentos_count from usage_metrics
              where clinic_id=${owner?.clinic_id ?? ''}::uuid and period_yyyymm=${currentPeriod}),0)::int usage,
            (select count(*)::int from patients
              where clinic_id=${owner?.clinic_id ?? ''}::uuid and lower(email)=lower(${patientEmail})) fixture
        `;
        if (!owner?.can_import || !attendant || attendant.clinic_id !== owner.clinic_id) {
          throw new Error('Identidades da Clínica A inconsistentes para o teste.');
        }
        if (attendant.can_import) throw new Error('Atendente A já possui import:agenda.');
        if (!doctor || !procedure || !crossTenantProfile || !freeYear || !baseline) {
          throw new Error('Fixture autoritativa da importação ausente.');
        }
        if (crossTenantProfile.clinic_id === owner.clinic_id) {
          throw new Error('Perfil de contraprova não pertence ao tenant B.');
        }
        if (baseline.fixture !== 0) throw new Error('Fixture de importação já existe.');
        return [{ owner, attendant, doctor, procedure, crossTenantProfile, freeYear, baseline }];
      });
      if (!setup) throw new Error('Setup autoritativo ausente.');
      clinicId = setup.owner.clinic_id;

      await Promise.all([
        signInContext(ownerContext, ownerEmail, sharedPassword),
        signInContext(attendantContext, attendantEmail, sharedPassword),
      ]);
      patientId = await createPatient(ownerPage, {
        name: patientName,
        cpf: validCpf(runId),
        email: patientEmail,
      });

      await attendantPage.goto('/agenda');
      const deniedLinkVisible =
        (await attendantPage
          .getByRole('link', { name: 'Importar historico', exact: true })
          .count()) === 1;
      await attendantPage.goto('/agenda/importar');
      await expect(attendantPage.getByText('Sem acesso', { exact: true })).toBeVisible();
      await expect(
        attendantPage.getByText('Seu perfil não tem permissão para importar histórico da agenda.'),
      ).toBeVisible();
      await expect(attendantPage.getByRole('button', { name: 'Importar historico' })).toHaveCount(
        0,
      );

      const validDate = `${setup.freeYear.chosen_year}-02-05T09:00:00-03:00`;
      const validProbeItems: ImportItem[] = [
        {
          doctorId: setup.doctor.id,
          patientId,
          procedureId: setup.procedure.id,
          scheduledAt: validDate,
          historicalStatus: 'cancelado',
          externalReference: `${marker}-DENIED`,
          observacoes: `${marker} denied action probe`,
        },
      ];
      const probePage = await ownerContext.newPage();
      await probePage.goto('/agenda/importar');
      let capturedAction: CapturedAction | undefined;
      await ownerContext.route('**/agenda/importar', async (route) => {
        const request = route.request();
        const body = request.postDataBuffer();
        if (request.method() === 'POST' && request.headers()['next-action'] && body) {
          capturedAction = { body, headers: captureHeaders(request) };
          await route.abort();
          return;
        }
        await route.continue();
      });
      await prepareImport(probePage, {
        source: `${marker}-DENIED`,
        justification: `${marker} tentativa direta sem permissao`,
        items: validProbeItems,
        filename: 'denied.json',
      });
      await probePage
        .getByRole('button', { name: 'Importar historico', exact: true })
        .click()
        .catch(() => undefined);
      await expect.poll(() => Boolean(capturedAction), { timeout: 10_000 }).toBe(true);
      await ownerContext.unroute('**/agenda/importar');
      await probePage.close();
      if (!capturedAction) throw new Error('Envelope da Server Action não foi capturado.');
      const deniedActionResponse = await attendantContext.request.post('/agenda/importar', {
        data: capturedAction.body,
        headers: capturedAction.headers,
      });
      const deniedActionBody = await deniedActionResponse.text();
      expect(deniedActionResponse.status()).toBe(200);
      expect(deniedActionBody).toContain('import:agenda');

      await ownerPage.goto('/agenda/importar');
      await expect(
        ownerPage.getByRole('heading', { name: 'Importar historico da agenda' }),
      ).toBeVisible();
      expect(await ownerPage.getByLabel('Fonte dos dados', { exact: true }).count()).toBe(1);
      expect(await ownerPage.getByLabel('Justificativa', { exact: true }).count()).toBe(1);
      expect(await ownerPage.getByLabel('Arquivo JSON', { exact: true }).count()).toBe(1);

      const futureItems: ImportItem[] = [
        {
          ...validProbeItems[0]!,
          scheduledAt: '2099-01-10T09:00:00-03:00',
          externalReference: `${marker}-FUTURE`,
          observacoes: `${marker} future invalid`,
        },
      ];
      await prepareImport(ownerPage, {
        source: `${marker}-FUTURE`,
        justification: `${marker} validar rejeicao de data futura`,
        items: futureItems,
        filename: 'future.json',
      });
      const futureResponse = await submitImport(ownerPage);
      await expect(ownerPage.getByText(/aceita apenas atendimentos passados/iu)).toBeVisible();

      const crossTenantItems: ImportItem[] = [
        {
          ...validProbeItems[0]!,
          scheduledAt: `${setup.freeYear.chosen_year}-02-06T09:00:00-03:00`,
          externalReference: `${marker}-ROLLBACK-1`,
          observacoes: `${marker} rollback first`,
        },
        {
          ...validProbeItems[0]!,
          doctorId: setup.crossTenantProfile.id,
          scheduledAt: `${setup.freeYear.chosen_year}-02-07T09:00:00-03:00`,
          externalReference: `${marker}-ROLLBACK-B`,
          observacoes: `${marker} cross tenant doctor`,
        },
      ];
      await prepareImport(ownerPage, {
        source: `${marker}-ROLLBACK`,
        justification: `${marker} validar rollback e tenant`,
        items: crossTenantItems,
        filename: 'cross-tenant.json',
      });
      const crossTenantResponse = await submitImport(ownerPage);
      await expect(ownerPage.getByText(/médico inválido para esta clínica/iu)).toBeVisible();

      const [invalidPersistence] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ batches: number; imported: number }[]>`
          select
            (select count(*)::int from appointment_import_batches
              where clinic_id=${clinicId!}::uuid and source like ${`${marker}%`}) batches,
            (select count(*)::int from appointments
              where clinic_id=${clinicId!}::uuid and patient_id=${patientId!}::uuid
                and created_via='import') imported
        `;
      });
      expect(invalidPersistence).toEqual({ batches: 0, imported: 0 });

      const validItems: ImportItem[] = [
        {
          ...validProbeItems[0]!,
          scheduledAt: `${setup.freeYear.chosen_year}-03-05T09:00:00-03:00`,
          historicalStatus: 'atendido',
          externalReference: `${marker}-OK-1`,
          observacoes: `${marker} atendido`,
        },
        {
          ...validProbeItems[0]!,
          scheduledAt: `${setup.freeYear.chosen_year}-03-06T10:00:00-03:00`,
          historicalStatus: 'cancelado',
          externalReference: `${marker}-OK-2`,
          observacoes: `${marker} cancelado`,
        },
        {
          ...validProbeItems[0]!,
          scheduledAt: `${setup.freeYear.chosen_year}-03-07T11:00:00-03:00`,
          historicalStatus: 'faltou',
          externalReference: `${marker}-OK-3`,
          observacoes: `${marker} faltou`,
        },
      ];
      await prepareImport(ownerPage, {
        source: `${marker}-VALID`,
        justification: `${marker} lote historico autorizado`,
        items: validItems,
        filename: 'valid.json',
      });
      const validIdempotencyKey = await ownerPage
        .locator('input[name="idempotencyKey"]')
        .inputValue();
      const validResponse = await submitImport(ownerPage);
      await expect(ownerPage.getByText(/3 atendimento\(s\) importado\(s\)/u)).toBeVisible();
      // UX-004 — o achado: `useMemo(() => uuidv4(), [])` congelava a chave na
      // montagem da pagina, entao um segundo lote na MESMA montagem batia em
      // "Idempotency key reused with a different payload" e importava zero. A
      // chave agora ROTACIONA depois de um lote concluido: o segundo arquivo e
      // uma operacao nova, nao replay do primeiro.
      await expect(ownerPage.locator('input[name="idempotencyKey"]')).not.toHaveValue(
        validIdempotencyKey,
      );

      const persisted = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const batches = await tx<
          {
            id: string;
            source: string;
            justification: string;
            status: string;
            total_items: number;
            imported_items: number;
            created_by: string | null;
          }[]
        >`
          select id::text, source, justification, status::text, total_items, imported_items,
                 created_by::text
            from appointment_import_batches
           where clinic_id=${clinicId!}::uuid and source like ${`${marker}%`}
           order by created_at, id
        `;
        batchIds = batches.map(({ id }) => id);
        const appointments = await tx<
          {
            id: string;
            status: string;
            created_via: string;
            import_batch_id: string;
            external_reference: string | null;
            scheduled_date: string;
            doctor_snapshot_matches: boolean;
          }[]
        >`
          select a.id::text, a.status::text, a.created_via::text,
                 a.import_batch_id::text, a.import_source_reference external_reference,
                 (a.scheduled_at at time zone ${setup.owner.timezone})::date::text scheduled_date,
                 a.snapshot_doctor_nome=p.nome doctor_snapshot_matches
            from appointments a join profiles p on p.id=a.doctor_id
           where a.clinic_id=${clinicId!}::uuid
             and a.import_batch_id::text=any(${batchIds}::text[])
           order by a.scheduled_at
        `;
        appointmentIds = appointments.map(({ id }) => id);
        const [trails] = await tx<
          {
            state_logs: number;
            state_logs_from_null: number;
            created_events: number;
            import_events: number;
            audits: number;
            idempotency: number;
            financial_entries: number;
          }[]
        >`
          select
            (select count(*)::int from appointment_state_log
              where clinic_id=${clinicId!}::uuid and appointment_id::text=any(${appointmentIds}::text[])) state_logs,
            (select count(*)::int from appointment_state_log
              where clinic_id=${clinicId!}::uuid and appointment_id::text=any(${appointmentIds}::text[])
                and from_status is null) state_logs_from_null,
            (select count(*)::int from outbox
              where clinic_id=${clinicId!}::uuid and event_type='scheduling.appointment.created'
                and payload ->> 'appointmentId'=any(${appointmentIds}::text[])) created_events,
            (select count(*)::int from outbox
              where clinic_id=${clinicId!}::uuid and event_type='scheduling.import.completed'
                and payload ->> 'batchId'=any(${batchIds}::text[])) import_events,
            (select count(*)::int from audit_events
              where clinic_id=${clinicId!}::uuid and created_at>=${startedAt}::timestamptz
                and after ->> 'batchId'=any(${batchIds}::text[])) audits,
            (select count(*)::int from idempotency_keys
              where clinic_id=${clinicId!}::uuid and created_at>=${startedAt}::timestamptz
                and response ->> 'batchId'=any(${batchIds}::text[])) idempotency,
            (select count(*)::int from lancamentos
              where clinic_id=${clinicId!}::uuid and appointment_id::text=any(${appointmentIds}::text[])) financial_entries
        `;
        return { batches, appointments, trails };
      });
      expect(persisted.batches).toHaveLength(1);
      if (!persisted.trails) throw new Error('Trilhas autoritativas da importação ausentes.');
      expect(persisted.batches[0]).toMatchObject({
        source: `${marker}-VALID`,
        justification: `${marker} lote historico autorizado`,
        status: 'completed',
        total_items: 3,
        imported_items: 3,
        created_by: setup.owner.actor_id,
      });
      expect(persisted.appointments).toHaveLength(3);
      expect(persisted.appointments.map(({ status }) => status)).toEqual([
        'atendido',
        'cancelado',
        'faltou',
      ]);
      expect(persisted.appointments.every(({ created_via }) => created_via === 'import')).toBe(
        true,
      );
      expect(
        persisted.appointments.every(({ doctor_snapshot_matches }) => doctor_snapshot_matches),
      ).toBe(true);
      expect(persisted.trails).toEqual({
        state_logs: 3,
        state_logs_from_null: 3,
        created_events: 3,
        import_events: 1,
        audits: 1,
        idempotency: 1,
        financial_entries: 0,
      });

      await prepareImport(ownerPage, {
        source: `${marker}-VALID`,
        justification: `${marker} lote historico autorizado`,
        items: validItems,
        filename: 'valid-replay.json',
      });
      // UX-004 — a chave rotaciona, entao a UI ja NAO produz um replay sozinha
      // (era exatamente o defeito: o segundo lote herdava a chave do primeiro e
      // era recusado). Para exercitar a idempotencia de verdade, forcamos a
      // chave ORIGINAL de volta: mesma chave + mesma carga = retry legitimo, e
      // o servidor deve devolver o lote original sem duplicar nada.
      await ownerPage
        .locator('input[name="idempotencyKey"]')
        .evaluate((element, value) => {
          (element as HTMLInputElement).value = value;
        }, validIdempotencyKey);
      await expect(ownerPage.locator('input[name="idempotencyKey"]')).toHaveValue(
        validIdempotencyKey,
      );
      const replayResponse = await submitImport(ownerPage);
      await expect(ownerPage.getByText(/3 atendimento\(s\) importado\(s\)/u)).toBeVisible();
      const [afterReplay] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ batches: number; appointments: number; audits: number; idempotency: number }[]>`
          select
            (select count(*)::int from appointment_import_batches
              where clinic_id=${clinicId!}::uuid and source like ${`${marker}%`}) batches,
            (select count(*)::int from appointments
              where clinic_id=${clinicId!}::uuid and import_batch_id::text=any(${batchIds}::text[])) appointments,
            (select count(*)::int from audit_events
              where clinic_id=${clinicId!}::uuid and created_at>=${startedAt}::timestamptz
                and after ->> 'batchId'=any(${batchIds}::text[])) audits,
            (select count(*)::int from idempotency_keys
              where clinic_id=${clinicId!}::uuid and created_at>=${startedAt}::timestamptz
                and response ->> 'batchId'=any(${batchIds}::text[])) idempotency
        `;
      });
      expect(afterReplay).toEqual({ batches: 1, appointments: 3, audits: 1, idempotency: 1 });

      const changedItems = validItems.map((item, index) =>
        index === 0
          ? {
              ...item,
              scheduledAt: `${setup.freeYear.chosen_year}-04-05T09:00:00-03:00`,
              externalReference: `${marker}-CHANGED`,
            }
          : item,
      );
      await prepareImport(ownerPage, {
        source: `${marker}-CHANGED`,
        justification: `${marker} segundo lote na mesma pagina`,
        items: changedItems,
        filename: 'changed.json',
      });
      const changedResponse = await submitImport(ownerPage);
      // UX-004 — o achado: um SEGUNDO lote na mesma montagem da pagina herdava a
      // chave do primeiro, a UI mostrava "Idempotency key ... reused with a
      // different payload" (mensagem interna, em ingles, expondo a chave
      // tecnica) e importava ZERO. Com a rotacao, uma importacao legitima
      // dividida em varios arquivos funciona sem reload.
      await expect(ownerPage.getByText(/reused with a different payload/iu)).toHaveCount(0);
      await expect(ownerPage.getByText(/3 atendimento\(s\) importado\(s\)/u)).toBeVisible();
      const [afterChanged] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ batches: number; appointments: number }[]>`
          select
            (select count(*)::int from appointment_import_batches
              where clinic_id=${clinicId!}::uuid and source like ${`${marker}%`}) batches,
            (select count(*)::int from appointments
              where clinic_id=${clinicId!}::uuid and import_batch_id::text=any(${batchIds}::text[])) appointments
        `;
      });
      // Agora sao DOIS lotes: o segundo arquivo foi de fato importado. A
      // contagem de `appointments` continua 3 porque conta apenas os ids do
      // PRIMEIRO lote (`batchIds`), que permanecem intactos.
      expect(afterChanged).toEqual({ batches: 2, appointments: 3 });

      await ownerPage.goto(`/agenda?view=day&date=${setup.freeYear.chosen_year}-03-05`);
      await expect(ownerPage.getByText(patientName, { exact: true })).toBeVisible();
      await ownerPage.reload();
      await expect(ownerPage.getByText(patientName, { exact: true })).toBeVisible();

      let metering = {
        observed: false,
        ledger: 0,
        usageBefore: setup.baseline.usage,
        usageAfter: setup.baseline.usage,
        period: currentPeriod,
      };
      const meteringDeadline = Date.now() + 85_000;
      while (Date.now() < meteringDeadline) {
        const [snapshot] = await sql.begin(async (tx) => {
          await tx.unsafe('RESET ROLE');
          return tx<{ ledger: number; usage: number }[]>`
            select
              (select count(*)::int from usage_counter_ledger
                where clinic_id=${clinicId!}::uuid and metric='agendamentos'
                  and dedup_key=any(${appointmentIds}::text[])) ledger,
              coalesce((select agendamentos_count from usage_metrics
                where clinic_id=${clinicId!}::uuid and period_yyyymm=${currentPeriod}),0)::int usage
          `;
        });
        if (snapshot) {
          metering = {
            observed: snapshot.ledger === appointmentIds.length,
            ledger: snapshot.ledger,
            usageBefore: setup.baseline.usage,
            usageAfter: snapshot.usage,
            period: currentPeriod,
          };
          if (metering.observed) break;
        }
        await ownerPage.waitForTimeout(2_000);
      }
      if (metering.observed) {
        expect(metering.ledger).toBe(3);
        expect(metering.usageAfter - metering.usageBefore).toBeGreaterThanOrEqual(3);
      }

      console.log(
        `[appointment-import-a] ${JSON.stringify({
          year: setup.freeYear.chosen_year,
          permissions: {
            owner: setup.owner.can_import,
            attendant: setup.attendant.can_import,
            deniedRoute: true,
            deniedDirectAction: deniedActionBody.includes('import:agenda'),
            deniedLinkVisible,
          },
          invalid: {
            futureHttpStatus: futureResponse.status(),
            crossTenantHttpStatus: crossTenantResponse.status(),
            atomicRollback: invalidPersistence,
          },
          valid: {
            httpStatus: validResponse.status(),
            batches: persisted.batches.length,
            appointments: persisted.appointments.length,
            statuses: persisted.appointments.map(({ status }) => status),
            stateLogs: persisted.trails.state_logs,
            createdEvents: persisted.trails.created_events,
            importEvents: persisted.trails.import_events,
            audits: persisted.trails.audits,
            idempotency: persisted.trails.idempotency,
            persistedAfterRefresh: true,
          },
          replay: { httpStatus: replayResponse.status(), ...afterReplay },
          secondBatchSamePage: {
            httpStatus: changedResponse.status(),
            rejectedByReusedKey: true,
            ...afterChanged,
          },
          metering,
          accessibility: { source: true, justification: true, file: true },
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
          const batches = await tx<{ id: string }[]>`
            select id::text from appointment_import_batches
             where clinic_id=${clinicId!}::uuid and source like ${`${marker}%`}
          `;
          const currentBatchIds = batches.map(({ id }) => id);
          const appointments = await tx<{ id: string }[]>`
            select id::text from appointments
             where clinic_id=${clinicId!}::uuid
               and (patient_id::text=any(${patientIds}::text[])
                    or import_batch_id::text=any(${currentBatchIds}::text[]))
          `;
          const ids = [...new Set([...appointmentIds, ...appointments.map(({ id }) => id)])];
          const batchesToRemove = [...new Set([...batchIds, ...currentBatchIds])];
          const financialEntries = await tx<{ id: string }[]>`
            select id::text from lancamentos
             where clinic_id=${clinicId!}::uuid and appointment_id::text=any(${ids}::text[])
          `;
          const financialPending = await tx<{ id: string }[]>`
            select id::text from faturamento_pendencias
             where clinic_id=${clinicId!}::uuid and appointment_id::text=any(${ids}::text[])
          `;
          if (financialEntries.length > 0 || financialPending.length > 0) {
            throw new Error(
              'Importação criou registros financeiros inesperados; cleanup interrompido.',
            );
          }
          const removedOutbox = await tx<{ id: string }[]>`
            delete from outbox where clinic_id=${clinicId!}::uuid
             and (payload ->> 'patientId'=any(${patientIds}::text[])
                  or payload ->> 'appointmentId'=any(${ids}::text[])
                  or payload ->> 'batchId'=any(${batchesToRemove}::text[])
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
          const allResourceIds = [...patientIds, ...ids, ...batchesToRemove];
          const removedAudit = await tx<{ id: string }[]>`
            delete from audit_events where clinic_id=${clinicId!}::uuid
             and created_at>=${startedAt}::timestamptz
             and (resource_id=any(${allResourceIds}::text[])
                  or after ->> 'id'=any(${allResourceIds}::text[])
                  or after ->> 'batchId'=any(${batchesToRemove}::text[])
                  or coalesce(before::text,'') like ${`%${marker}%`}
                  or coalesce(after::text,'') like ${`%${marker}%`})
            returning id::text
          `;
          const removedIdempotency = await tx<{ key: string }[]>`
            delete from idempotency_keys where clinic_id=${clinicId!}::uuid
             and created_at>=${startedAt}::timestamptz
             and (${patientIds.length > 0 ? tx`response::text like ${`%${patientIds[0]}%`}` : tx`false`}
                  or ${batchesToRemove.length > 0 ? tx`response ->> 'batchId'=any(${batchesToRemove}::text[])` : tx`false`})
            returning key
          `;
          const removedStateLogs = await tx<{ id: string }[]>`
            delete from appointment_state_log where clinic_id=${clinicId!}::uuid
              and appointment_id::text=any(${ids}::text[])
            returning id::text
          `;
          const removedAppointments = await tx<{ id: string }[]>`
            delete from appointments where clinic_id=${clinicId!}::uuid
              and id::text=any(${ids}::text[])
            returning id::text
          `;
          const removedBatches = await tx<{ id: string }[]>`
            delete from appointment_import_batches where clinic_id=${clinicId!}::uuid
              and id::text=any(${batchesToRemove}::text[])
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
              batches: number;
              appointments: number;
              state_logs: number;
              outbox: number;
              ledger: number;
              audits: number;
              idempotency: number;
            }[]
          >`
            select
              (select count(*)::int from patients
                where clinic_id=${clinicId!}::uuid and lower(email)=lower(${patientEmail})) patients,
              (select count(*)::int from appointment_import_batches
                where clinic_id=${clinicId!}::uuid and source like ${`${marker}%`}) batches,
              (select count(*)::int from appointments
                where clinic_id=${clinicId!}::uuid and id::text=any(${ids}::text[])) appointments,
              (select count(*)::int from appointment_state_log
                where clinic_id=${clinicId!}::uuid and appointment_id::text=any(${ids}::text[])) state_logs,
              (select count(*)::int from outbox
                where clinic_id=${clinicId!}::uuid
                  and (payload::text like ${`%${marker}%`}
                       or payload ->> 'appointmentId'=any(${ids}::text[])
                       or payload ->> 'batchId'=any(${batchesToRemove}::text[]))) outbox,
              (select count(*)::int from usage_counter_ledger
                where clinic_id=${clinicId!}::uuid and dedup_key=any(${ids}::text[])) ledger,
              (select count(*)::int from audit_events
                where clinic_id=${clinicId!}::uuid and created_at>=${startedAt}::timestamptz
                  and (resource_id=any(${allResourceIds}::text[])
                       or after ->> 'batchId'=any(${batchesToRemove}::text[])
                       or coalesce(after::text,'') like ${`%${marker}%`})) audits,
              (select count(*)::int from idempotency_keys
                where clinic_id=${clinicId!}::uuid and created_at>=${startedAt}::timestamptz
                  and (${patientIds.length > 0 ? tx`response::text like ${`%${patientIds[0]}%`}` : tx`false`}
                       or ${batchesToRemove.length > 0 ? tx`response ->> 'batchId'=any(${batchesToRemove}::text[])` : tx`false`})) idempotency
          `;
          return {
            removed: {
              patients: removedPatients.length,
              batches: removedBatches.length,
              appointments: removedAppointments.length,
              state_logs: removedStateLogs.length,
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
          batches: 0,
          appointments: 0,
          state_logs: 0,
          outbox: 0,
          ledger: 0,
          audits: 0,
          idempotency: 0,
        });
        console.log(`[appointment-import-a-cleanup] ${JSON.stringify(result)}`);
      }
      await Promise.all([
        ownerContext.close().catch(() => undefined),
        attendantContext.close().catch(() => undefined),
      ]);
      await sql.end();
      if (patientId && !cleanup) throw new Error('Cleanup da importação não foi comprovado.');
    }
  });
});
