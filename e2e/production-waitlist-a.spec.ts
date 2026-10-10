import { expect, test, type BrowserContext, type Page, type Response } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

import {
  createSupabaseSessionGeneration,
  supabaseAuthCookieName,
  SUPABASE_SESSION_COOKIE_OPTIONS,
  SUPABASE_SESSION_SELECTOR_COOKIE,
} from '../src/lib/auth/supabase-session-cookie';

import { assertPreviewRuntimeIsDev, DEV_PROJECT_REF } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

loadDotenv({ path: process.env.QORO_DEV_ENV_FILE ?? '.env.local' });

const previewMode = process.env.E2E_PREVIEW_WAITLIST === 'ALLOW_SYNTHETIC_CLINIC_A_DEV';
const authorized =
  previewMode || process.env.E2E_PRODUCTION_WAITLIST === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const attendantEmail = previewMode
  ? process.env.E2E_WHATSAPP_EMAIL_TEST
  : process.env.E2E_ATTENDANT_EMAIL;
const sharedPassword = previewMode
  ? process.env.E2E_WHATSAPP_PASSWORD_TEST
  : process.env.E2E_TENANT_PASSWORD;

test.use({
  storageState: { cookies: [], origins: [] },
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

function productionConfig(): { databaseUrl: string; url: string; secretKey: string } {
  if (previewMode) {
    const databaseUrl = process.env.DATABASE_URL_DEV ?? process.env.DATABASE_URL;
    const secretKey = process.env.SECRET_KEY_DEV;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!databaseUrl || !secretKey || !url) throw new Error('Credenciais DEV ausentes.');
    const databaseRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
    const authRef = new URL(url).hostname.split('.')[0];
    if (databaseRef !== DEV_PROJECT_REF || authRef !== DEV_PROJECT_REF) {
      throw new Error('Preview waitlist exige Auth e banco DEV fixados.');
    }
    return { databaseUrl, url, secretKey };
  }
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
  const generation = createSupabaseSessionGeneration();
  const cookieName = supabaseAuthCookieName(url, generation);
  if (!cookieName) throw new Error('Nome do cookie de sessão inválido.');
  let nextCookies: Array<{ name: string; value: string }> = [];
  const client = createSsrClient(url, secretKey, {
    cookies: {
      getAll: () => [],
      setAll: (items) => {
        nextCookies = items.map(({ name, value }) => ({ name, value }));
      },
    },
    auth: { autoRefreshToken: false, persistSession: true },
    cookieOptions: { name: cookieName, ...SUPABASE_SESSION_COOKIE_OPTIONS },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || nextCookies.length === 0) {
    throw new Error(error?.message ?? 'Login não produziu sessão.');
  }
  await context.addCookies(
    [
      ...nextCookies.filter(
        ({ name, value }) =>
          value !== '' && (name === cookieName || name.startsWith(`${cookieName}.`)),
      ),
      { name: SUPABASE_SESSION_SELECTOR_COOKIE, value: generation },
    ].map(({ name, value }) => ({
      name,
      value,
      url: baseUrl,
      httpOnly: true,
      secure: new URL(baseUrl).protocol === 'https:',
      sameSite: 'Lax' as const,
    })),
  );
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

function addDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isServerAction(response: Response): boolean {
  const request = response.request();
  return request.method() === 'POST' && Boolean(request.headers()['next-action']);
}

function safeActionFailure(body: string | null, fixtureMarker: string): string {
  if (!body) return 'unavailable';
  const decoded = body.replaceAll('\\"', '"');
  if (/failed query:/iu.test(decoded)) {
    const target =
      /\b(insert into|update|delete from|from)\s+(?:"[a-z_]+"\.)?"?([a-z_][a-z0-9_]*)"?/iu.exec(
        decoded,
      );
    return target ? `database_query_failed:${target[1]}:${target[2]}` : 'database_query_failed';
  }
  const message = /"message":"((?:\\.|[^"\\])*)"/u.exec(decoded)?.[1];
  if (!message) return 'message_not_found';
  return message
    .replaceAll(fixtureMarker, '[fixture]')
    .replace(/https?:\/\/\S+/giu, '[url]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[email]')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/giu, '[id]')
    .replace(/\b(?:token|secret|password|key)\s*[:=]\s*\S+/giu, '[secret]')
    .replace(/[A-Za-z0-9_-]{32,}/gu, '[opaque]')
    .slice(0, 120);
}

async function createPatient(
  page: Page,
  input: { name: string; cpf: string; email: string },
): Promise<string> {
  const response = await page.goto('/pacientes?novo=1');
  const drawer = page.getByRole('dialog', { name: 'Novo paciente' });
  if ((await drawer.count()) === 0) {
    throw new Error(
      `Formulário de paciente indisponível: path=${new URL(page.url()).pathname}, HTTP=${response?.status() ?? 'sem resposta'}, login=${(await page.locator('#email').count()) > 0}, newButton=${(await page.getByRole('button', { name: 'Novo paciente' }).count()) > 0}`,
    );
  }
  await drawer.locator('input[name="nome"]').fill(input.name);
  await drawer.locator('input[name="cpf"]').fill(input.cpf);
  await drawer.locator('input[name="email"]').fill(input.email);
  await drawer.getByRole('button', { name: 'Criar paciente' }).click();
  await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/u, { timeout: 90_000 });
  const id = new URL(page.url()).pathname.split('/').at(-1);
  if (!id || !/^[0-9a-f-]{36}$/iu.test(id)) throw new Error('Paciente sintético sem ID.');
  return id;
}

async function prepareWaitlist(
  page: Page,
  input: {
    patientName: string;
    procedureId: string;
    doctorId: string;
    priority: 'normal' | 'urgent';
    preferredFrom: string;
    preferredUntil: string;
    notes: string;
  },
) {
  await page.goto('/agenda/lista-espera');
  await page.getByPlaceholder('Buscar paciente').fill(input.patientName);
  await page.getByRole('option', { name: input.patientName, exact: true }).click();
  const selects = page.locator('select');
  await expect(selects).toHaveCount(3);
  await selects.nth(0).selectOption(input.procedureId);
  await selects.nth(1).selectOption(input.doctorId);
  await selects.nth(2).selectOption(input.priority);
  const dates = page.locator('input[type="date"]');
  await expect(dates).toHaveCount(2);
  await dates.nth(0).fill(input.preferredFrom);
  await dates.nth(1).fill(input.preferredUntil);
  await page.locator('textarea').fill(input.notes);
}

async function submitWaitlist(page: Page): Promise<number> {
  const responsePromise = page.waitForResponse(isServerAction);
  await page.getByRole('button', { name: 'Adicionar à lista' }).click();
  return (await responsePromise).status();
}

function waitlistRow(page: Page, patientName: string) {
  return page
    .getByText(patientName, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"listrow")][1]');
}

async function retryFixtureCleanup<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
      if ((code !== '40P01' && code !== '55P03') || attempt >= 4) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
}

const suiteName = previewMode
  ? 'Preview DEV: lista de espera na Clínica A'
  : 'produção: lista de espera na Clínica A';

test.describe(suiteName, () => {
  test.describe.configure({ retries: 0 });

  test('validação, cancelamento humano COM oferta, encerramento e cleanup', async ({ browser }) => {
    test.setTimeout(420_000);
    test.skip(
      !authorized,
      'Exige autorização explícita para lista de espera sintética na Clínica A.',
    );
    if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
    if (previewMode) {
      const target = new URL(baseUrl);
      if (target.protocol !== 'https:' || !target.hostname.endsWith('.vercel.app')) {
        throw new Error('Preview waitlist exige *.vercel.app com HTTPS.');
      }
      await assertPreviewRuntimeIsDev(baseUrl);
    } else if (new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de produção só pode apontar para app.qoro.dev.');
    }
    if (!attendantEmail || !sharedPassword) throw new Error('Credencial do atendente A ausente.');

    const { databaseUrl } = productionConfig();
    const sql = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
    const context = await browser.newContext({
      baseURL: baseUrl,
      extraHTTPHeaders: vercelBypassHeaders(),
    });
    const page = await context.newPage();
    const browserErrorKinds: string[] = [];
    page.on('pageerror', (error) => {
      browserErrorKinds.push(
        /Hydration failed|React error #418/iu.test(error.message) ? 'hydration' : error.name,
      );
    });
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        /Hydration failed|React error #418/iu.test(message.text())
      ) {
        browserErrorKinds.push('hydration-console');
      }
    });
    const startedAt = new Date().toISOString();
    const runId = String(Date.now()).slice(-10);
    const marker = `[E2E-WAITLIST-A-${runId}]`;
    const patientNames = [`${marker} Normal`, `${marker} Urgente`] as const;
    const patientEmails = [
      `e2e-waitlist-a-${runId}-normal@example.test`,
      `e2e-waitlist-a-${runId}-urgent@example.test`,
    ] as const;
    const patientIds: string[] = [];
    let clinicId: string | undefined;
    let actorId: string | undefined;
    let appointmentId: string | undefined;
    let waitlistIds: string[] = [];
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
             and p.role=${previewMode ? 'owner' : 'attendant'}
             and p.ativo=true and p.deleted_at is null
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
            from (values (2097), (2098), (2099)) as years(candidate)
           where not exists (
             select 1 from appointments a
              where a.doctor_id=${doctor.id}::uuid
                and a.scheduled_at >= (make_date(candidate,1,1)::timestamp at time zone ${identity.timezone})
                and a.scheduled_at < (make_date(candidate+1,1,1)::timestamp at time zone ${identity.timezone})
           ) order by candidate limit 1
        `;
        if (!freeYear) throw new Error('Sem ano futuro vazio para waitlist sintética.');
        const [preexisting] = await tx<{ patients: number }[]>`
          select count(*)::int patients from patients
           where clinic_id=${identity.clinic_id}::uuid and lower(email)=any(${patientEmails.map((email) => email.toLowerCase())}::text[])
        `;
        if (!preexisting || preexisting.patients !== 0) throw new Error('Fixture já existe.');
        return [{ identity, doctor, procedure, year: freeYear.chosen_year }];
      });
      if (!setup) throw new Error('Setup autoritativo ausente.');
      clinicId = setup.identity.clinic_id;
      actorId = setup.identity.actor_id;
      const appointmentDate = `${setup.year}-03-10`;
      const preferredFrom = addDays(appointmentDate, -1);
      const preferredUntil = addDays(appointmentDate, 1);

      await signInContext(context, attendantEmail, sharedPassword);
      if (previewMode) {
        const dashboardResponse = await page.goto('/dashboard');
        if (dashboardResponse?.status() !== 200 || new URL(page.url()).pathname !== '/dashboard') {
          throw new Error('Preview não reconheceu a sessão Supabase v2 do runner.');
        }
      }
      patientIds.push(
        await createPatient(page, {
          name: patientNames[0],
          cpf: validCpf(`${runId}1`),
          email: patientEmails[0],
        }),
      );
      patientIds.push(
        await createPatient(page, {
          name: patientNames[1],
          cpf: validCpf(`${runId}2`),
          email: patientEmails[1],
        }),
      );

      await prepareWaitlist(page, {
        patientName: patientNames[0],
        procedureId: setup.procedure.id,
        doctorId: setup.doctor.id,
        priority: 'normal',
        preferredFrom: preferredUntil,
        preferredUntil: preferredFrom,
        notes: `${marker} intervalo inválido`,
      });
      const invalidRangeHttpStatus = await submitWaitlist(page);
      await expect(
        page.getByText('Paciente adicionado à lista de espera.', { exact: true }),
      ).toHaveCount(0);
      const [invalidCount] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ total: number }[]>`
          select count(*)::int total from waitlist_entries
           where clinic_id=${clinicId!}::uuid and patient_id=any(${patientIds}::uuid[])
        `;
      });
      expect(invalidCount?.total).toBe(0);

      const accessibility = {
        patient: (await page.getByLabel('Paciente', { exact: true }).count()) > 0,
        procedure: (await page.getByLabel('Procedimento', { exact: true }).count()) > 0,
        doctor: (await page.getByLabel('Profissional (opcional)', { exact: true }).count()) > 0,
        from: (await page.getByLabel('Preferência a partir de', { exact: true }).count()) > 0,
        until: (await page.getByLabel('Preferência até', { exact: true }).count()) > 0,
        priority: (await page.getByLabel('Prioridade', { exact: true }).count()) > 0,
        notes: (await page.getByLabel('Observações', { exact: true }).count()) > 0,
      };
      // O teste anterior fixava como esperado o defeito de acessibilidade.
      // O comportamento correto exige rótulo em todos os sete controles.
      expect(Object.values(accessibility).every(Boolean)).toBe(true);

      await prepareWaitlist(page, {
        patientName: patientNames[0],
        procedureId: setup.procedure.id,
        doctorId: setup.doctor.id,
        priority: 'normal',
        preferredFrom,
        preferredUntil,
        notes: `${marker} normal`,
      });
      const normalHttpStatus = await submitWaitlist(page);
      await expect(
        page.getByText('Paciente adicionado à lista de espera.', { exact: true }),
      ).toBeVisible();

      await prepareWaitlist(page, {
        patientName: patientNames[1],
        procedureId: setup.procedure.id,
        doctorId: setup.doctor.id,
        priority: 'urgent',
        preferredFrom,
        preferredUntil,
        notes: `${marker} urgente`,
      });
      const urgentHttpStatus = await submitWaitlist(page);
      await expect(
        page.getByText('Paciente adicionado à lista de espera.', { exact: true }),
      ).toBeVisible();

      const entries = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; patient_id: string; priority: string; status: string }[]>`
          select id::text, patient_id::text, priority::text, status::text
            from waitlist_entries
           where clinic_id=${clinicId!}::uuid and patient_id=any(${patientIds}::uuid[])
           order by created_at
        `;
      });
      expect(entries).toHaveLength(2);
      waitlistIds = entries.map(({ id }) => id);

      const [appointment] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string }[]>`
          insert into appointments (
            clinic_id, doctor_id, procedure_id, scheduled_at, duration_min, status, valor,
            snapshot_procedure_name, snapshot_procedure_codigo, snapshot_procedure_categoria,
            snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome,
            created_via, observacoes, created_by
          ) values (
            ${clinicId!}::uuid, ${setup.doctor.id}::uuid, ${setup.procedure.id}::uuid,
            ((${appointmentDate}::date + '11:23'::time) at time zone ${setup.identity.timezone}),
            ${setup.procedure.duration}, 'em_atendimento', ${setup.procedure.valor}::numeric,
            ${setup.procedure.descricao}, ${setup.procedure.codigo}, ${setup.procedure.categoria},
            ${setup.procedure.valor}::numeric, ${setup.procedure.duration}, ${setup.doctor.nome},
            'attendant', ${marker}, ${actorId!}::uuid
          ) returning id::text
        `;
      });
      if (!appointment) throw new Error('Appointment liberador ausente.');
      appointmentId = appointment.id;

      await page.goto(`/agenda?view=day&date=${appointmentDate}`);
      const appointmentRow = page
        .getByText('Encaixe', { exact: true })
        .locator('xpath=ancestor::tr[1]');
      await appointmentRow.getByRole('button', { name: 'Corrigir' }).click();
      const correction = page.getByRole('dialog', { name: 'Corrigir atendimento' });
      await correction.getByLabel('Correção').selectOption('exceptional_cancel');
      await correction.getByLabel('Motivo').fill(`${marker} liberação controlada`);
      const formValid = await correction
        .locator('form')
        .evaluate((form) => (form as HTMLFormElement).checkValidity());
      if (!formValid) throw new Error('Formulário de correção inválido antes do submit.');
      const correctionNavigations: string[] = [];
      const correctionPosts: Array<{ path: string; markerSent: boolean; serverAction: boolean }> =
        [];
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) correctionNavigations.push(new URL(frame.url()).pathname);
      });
      const hasCorrectionMarker = (request: import('@playwright/test').Request): boolean =>
        Boolean(
          request.postData()?.includes(marker) ||
          request.postDataBuffer()?.includes(Buffer.from(marker)),
        );
      page.on('request', (request) => {
        if (request.method() !== 'POST') return;
        const path = new URL(request.url()).pathname;
        if (path !== '/agenda') return;
        correctionPosts.push({
          path,
          markerSent: hasCorrectionMarker(request),
          serverAction: Boolean(request.headers()['next-action']),
        });
      });
      const correctionResponse = page.waitForResponse(
        (response) => {
          const request = response.request();
          return (
            request.method() === 'POST' &&
            new URL(response.url()).pathname === '/agenda' &&
            hasCorrectionMarker(request)
          );
        },
        { timeout: 30_000 },
      );
      await correction.getByRole('button', { name: 'Registrar correção' }).click();
      const actionResponse = await correctionResponse.catch(() => {
        throw new Error(
          `Correção não enviou POST identificável: ${JSON.stringify({
            formValid,
            correctionPosts: correctionPosts.slice(0, 5),
            path: new URL(page.url()).pathname,
            correctionNavigations,
            browserErrorKinds,
          })}`,
        );
      });
      const cancellationHttpStatus = actionResponse.status();
      // Uma navegação completa pode descartar o body do POST antes da leitura.
      const actionBody = await actionResponse.text().catch(() => null);
      const actionSignals = {
        http: cancellationHttpStatus,
        contentType: actionResponse.headers()['content-type']?.split(';')[0] ?? 'none',
        responsePath: new URL(actionResponse.url()).pathname,
        bodyAvailable: actionBody !== null,
        bytes: actionBody?.length ?? null,
        returnedSuccess: actionBody ? /(?:\\?")ok(?:\\?")\s*:\s*true/u.test(actionBody) : null,
        returnedFailure: actionBody ? /(?:\\?")ok(?:\\?")\s*:\s*false/u.test(actionBody) : null,
        serverDigest: actionBody ? /digest/u.test(actionBody) : null,
        failureSummary: safeActionFailure(actionBody, marker),
      };
      if (!actionResponse.ok()) {
        throw new Error(
          `Correção devolveu resposta HTTP inválida: ${JSON.stringify(actionSignals)}`,
        );
      }
      // O POST pode terminar antes de o useActionState publicar o resultado.
      // Aguardar o feedback específico evita consultar o banco cedo demais.
      const correctionFeedback = page
        .getByRole('status')
        .filter({ hasText: /Agenda corrigida|Não foi possível corrigir/u });
      try {
        await correctionFeedback.first().waitFor({ state: 'visible', timeout: 45_000 });
      } catch {
        const submitButton = correction.getByRole('button', {
          name: /Registrar correção|Registrando/u,
        });
        const [appointmentState] = await sql.begin(async (tx) => {
          await tx.unsafe('SET TRANSACTION READ ONLY');
          await tx.unsafe('RESET ROLE');
          return tx<{ status: string }[]>`
              select status::text from appointments
               where clinic_id=${clinicId!}::uuid and id=${appointmentId!}::uuid
            `;
        });
        throw new Error(
          `Correção sem feedback: ${JSON.stringify({
            ...actionSignals,
            path: new URL(page.url()).pathname,
            correctionNavigations,
            correctionPosts: correctionPosts.slice(0, 5),
            appointmentStatus: appointmentState?.status ?? 'missing',
            dialogVisible: await correction.isVisible(),
            submitDisabled:
              (await submitButton.count()) > 0 ? await submitButton.isDisabled() : null,
            loginVisible: (await page.locator('#email').count()) > 0,
            toastCount: await page.getByRole('status').count(),
            browserErrorKinds,
          })}`,
        );
      }
      const correctionFeedbackText = (await correctionFeedback.first().innerText())
        .replace(/https?:\/\/\S+/gu, '[url]')
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/giu, '[id]')
        .slice(0, 180);
      if (correctionFeedbackText.includes('Não foi possível corrigir')) {
        throw new Error(
          `Correção recusada pela UI: ${JSON.stringify({
            ...actionSignals,
            authError: /permissão|autenticação|sessão/iu.test(correctionFeedbackText),
            databaseError: /constraint|relation|column|database|query/iu.test(
              correctionFeedbackText,
            ),
            timeoutError: /timeout|tempo limite/iu.test(correctionFeedbackText),
          })}`,
        );
      }

      const normalPatientId = patientIds[0];
      const urgentPatientId = patientIds[1];
      if (!normalPatientId || !urgentPatientId) throw new Error('Pacientes da waitlist ausentes.');
      const [offered] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const rows = await tx<
          {
            appointment_status: string;
            normal_status: string;
            urgent_status: string;
            urgent_offered_id: string | null;
            offered_events: number;
            offered_event_status: string | null;
            messages: number;
          }[]
        >`
          select
            (select status::text from appointments where id=${appointmentId!}::uuid) appointment_status,
            (select status::text from waitlist_entries where patient_id=${normalPatientId}::uuid and clinic_id=${clinicId!}::uuid) normal_status,
            (select status::text from waitlist_entries where patient_id=${urgentPatientId}::uuid and clinic_id=${clinicId!}::uuid) urgent_status,
            (select offered_appointment_id::text from waitlist_entries where patient_id=${urgentPatientId}::uuid and clinic_id=${clinicId!}::uuid) urgent_offered_id,
            (select count(*)::int from outbox where clinic_id=${clinicId!}::uuid and event_type='scheduling.waitlist.offered' and payload ->> 'waitlistEntryId'=any(${waitlistIds}::text[])) offered_events,
            (select status::text from outbox where clinic_id=${clinicId!}::uuid and event_type='scheduling.waitlist.offered' and payload ->> 'waitlistEntryId'=any(${waitlistIds}::text[]) limit 1) offered_event_status,
            (select count(*)::int from ai_messages m
              join ai_conversations c on c.id=m.conversation_id and c.clinic_id=m.clinic_id
             where m.clinic_id=${clinicId!}::uuid and c.patient_id=any(${patientIds}::uuid[])) messages
        `;
        return rows;
      });
      if (!offered) throw new Error('Estado da oferta ausente.');
      // WAIT-001 — este spec foi escrito para reproduzir o achado e afirmava
      // que o cancelamento humano da Agenda NAO ofertava nada. Agora a
      // assercao e a do comportamento correto e e mais ESTRITA: a vaga vai
      // para o candidato URGENTE (regra de prioridade), o normal continua na
      // fila, e sai EXATAMENTE UM evento de oferta — nao zero, nao dois.
      expect(offered).toMatchObject({
        appointment_status: 'cancelado',
        normal_status: 'waiting',
        urgent_status: 'offered',
        offered_events: 1,
        // A mensagem ao paciente depende de template aprovado na Meta
        // (BLOCKED): o pipeline interno vai ate o job, sem envio.
        messages: 0,
      });
      expect(offered.urgent_offered_id).toBe(appointmentId);

      await page.goto('/agenda/lista-espera');
      await expect(
        waitlistRow(page, patientNames[1]).getByText('Oferta enviada', { exact: true }),
      ).toBeVisible();
      await expect(
        waitlistRow(page, patientNames[0]).getByText('Aguardando', { exact: true }),
      ).toBeVisible();
      const offeredBookControl = await page
        .getByRole('button', { name: /agendar|confirmar|aceitar/iu })
        .count();
      // WAIT-001 — `markWaitlistEntryBooked()` nao tinha caller: a oferta era um
      // beco sem saida. Agora existe o controle para concluir.
      expect(offeredBookControl).toBeGreaterThan(0);

      const urgentEntryId = entries.find(({ priority }) => priority === 'urgent')?.id;
      if (!urgentEntryId) throw new Error('Entrada urgente ausente antes do cancelamento.');
      const offerCancelResponse = page.waitForResponse(
        (response) =>
          isServerAction(response) && new URL(response.url()).pathname === '/agenda/lista-espera',
      );
      await waitlistRow(page, patientNames[1]).getByRole('button', { name: 'Cancelar' }).click();
      const offerCancelAction = await offerCancelResponse;
      const offerCancelBody = await offerCancelAction.text().catch(() => null);
      try {
        await expect(waitlistRow(page, patientNames[1])).toHaveCount(0);
      } catch {
        const [entryState] = await sql.begin(async (tx) => {
          await tx.unsafe('SET TRANSACTION READ ONLY');
          await tx.unsafe('RESET ROLE');
          return tx<{ status: string }[]>`
            select status::text from waitlist_entries
             where clinic_id=${clinicId!}::uuid and id=${urgentEntryId}::uuid
          `;
        });
        throw new Error(
          `Cancelamento da oferta sem atualização visível: ${JSON.stringify({
            http: offerCancelAction.status(),
            returnedSuccess: offerCancelBody
              ? /(?:\\?")ok(?:\\?")\s*:\s*true/u.test(offerCancelBody)
              : null,
            returnedFailure: offerCancelBody
              ? /(?:\\?")ok(?:\\?")\s*:\s*false/u.test(offerCancelBody)
              : null,
            failureSummary: safeActionFailure(offerCancelBody, marker),
            persistedStatus: entryState?.status ?? 'missing',
            rowStatus: await waitlistRow(page, patientNames[1])
              .locator('.lr-main')
              .innerText()
              .then((text) =>
                text.includes('Oferta enviada')
                  ? 'offered'
                  : text.includes('Cancelado')
                    ? 'cancelled'
                    : 'other',
              ),
          })}`,
        );
      }
      await waitlistRow(page, patientNames[0]).getByRole('button', { name: 'Cancelar' }).click();
      await expect(waitlistRow(page, patientNames[0])).toHaveCount(0);
      await page.getByRole('checkbox', { name: 'Mostrar encerrados' }).check();
      await expect(
        waitlistRow(page, patientNames[0]).getByText('Cancelado', { exact: true }),
      ).toBeVisible();
      await expect(
        waitlistRow(page, patientNames[1]).getByText('Cancelado', { exact: true }),
      ).toBeVisible();

      console.log(
        `[waitlist-a] ${JSON.stringify({
          invalidRangeHttpStatus,
          invalidRangePersisted: invalidCount?.total ?? -1,
          normalHttpStatus,
          urgentHttpStatus,
          cancellationHttpStatus,
          humanCancellationCreatedOffer: offered.urgent_status === 'offered',
          offeredEventStatusAtObservation: offered.offered_event_status,
          offeredEventHasHandler: true,
          offeredBookControl: offeredBookControl > 0,
          bookingActionHasCaller: offeredBookControl > 0,
          messagesCreated: offered.messages,
          accessibility,
          externalEffects: false,
        })}`,
      );
    } finally {
      if (clinicId) {
        const result = await retryFixtureCleanup(() =>
          sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            const patients = await tx<{ id: string }[]>`
            select id::text from patients where clinic_id=${clinicId!}::uuid
              and lower(email)=any(${patientEmails.map((email) => email.toLowerCase())}::text[])
          `;
            const cleanupPatientIds = patients.map(({ id }) => id);
            const entries = await tx<{ id: string }[]>`
            select id::text from waitlist_entries where clinic_id=${clinicId!}::uuid
              and patient_id::text=any(${cleanupPatientIds}::text[])
          `;
            const cleanupWaitlistIds = [
              ...new Set([...waitlistIds, ...entries.map(({ id }) => id)]),
            ];
            const appointments = await tx<{ id: string }[]>`
            select id::text from appointments where clinic_id=${clinicId!}::uuid and observacoes=${marker}
          `;
            const cleanupAppointmentIds = [
              ...new Set(
                [appointmentId, ...appointments.map(({ id }) => id)].filter((id): id is string =>
                  Boolean(id),
                ),
              ),
            ];
            const allResourceIds = [
              ...cleanupPatientIds,
              ...cleanupWaitlistIds,
              ...cleanupAppointmentIds,
            ];
            const removedJobs = await tx<{ id: string }[]>`
            delete from ai_proactive_jobs where clinic_id=${clinicId!}::uuid
              and (payload ->> 'patientId'=any(${cleanupPatientIds}::text[])
                   or payload ->> 'appointmentId'=any(${cleanupAppointmentIds}::text[])
                   or payload ->> 'waitlistEntryId'=any(${cleanupWaitlistIds}::text[]))
            returning id::text
          `;
            const removedOutbox = await tx<{ id: string }[]>`
            delete from outbox where clinic_id=${clinicId!}::uuid
              and (payload ->> 'patientId'=any(${cleanupPatientIds}::text[])
                   or payload ->> 'appointmentId'=any(${cleanupAppointmentIds}::text[])
                   or payload ->> 'releasedAppointmentId'=any(${cleanupAppointmentIds}::text[])
                   or payload ->> 'waitlistEntryId'=any(${cleanupWaitlistIds}::text[])
                   or payload::text like ${`%${marker}%`})
            returning id::text
          `;
            const removedAudits = await tx<{ id: string }[]>`
            delete from audit_events where clinic_id=${clinicId!}::uuid
              and created_at>=${startedAt}::timestamptz
              and (resource_id=any(${allResourceIds}::text[])
                   or after ->> 'id'=any(${allResourceIds}::text[])
                   or coalesce(after::text,'') like ${`%${marker}%`})
            returning id::text
          `;
            const removedIdempotency = await tx<{ key: string }[]>`
            delete from idempotency_keys where clinic_id=${clinicId!}::uuid
              and created_at>=${startedAt}::timestamptz
              and response::text like any(${allResourceIds.map((id) => `%${id}%`)}::text[])
            returning key
          `;
            await tx`delete from waitlist_entries where clinic_id=${clinicId!}::uuid and id::text=any(${cleanupWaitlistIds}::text[])`;
            await tx`delete from appointments where clinic_id=${clinicId!}::uuid and id::text=any(${cleanupAppointmentIds}::text[])`;
            await tx`delete from patients where clinic_id=${clinicId!}::uuid and id::text=any(${cleanupPatientIds}::text[])`;
            const [remaining] = await tx<
              {
                patients: number;
                jobs: number;
                waitlist: number;
                appointments: number;
                outbox: number;
                audits: number;
                idempotency: number;
              }[]
            >`
            select
              (select count(*)::int from patients where clinic_id=${clinicId!}::uuid and lower(email)=any(${patientEmails.map((email) => email.toLowerCase())}::text[])) patients,
              (select count(*)::int from ai_proactive_jobs where clinic_id=${clinicId!}::uuid and (payload ->> 'patientId'=any(${cleanupPatientIds}::text[]) or payload ->> 'appointmentId'=any(${cleanupAppointmentIds}::text[]) or payload ->> 'waitlistEntryId'=any(${cleanupWaitlistIds}::text[]))) jobs,
              (select count(*)::int from waitlist_entries where clinic_id=${clinicId!}::uuid and id::text=any(${cleanupWaitlistIds}::text[])) waitlist,
              (select count(*)::int from appointments where clinic_id=${clinicId!}::uuid and id::text=any(${cleanupAppointmentIds}::text[])) appointments,
              (select count(*)::int from outbox where clinic_id=${clinicId!}::uuid and (payload::text like ${`%${marker}%`} or payload ->> 'waitlistEntryId'=any(${cleanupWaitlistIds}::text[]))) outbox,
              (select count(*)::int from audit_events where clinic_id=${clinicId!}::uuid and created_at>=${startedAt}::timestamptz and (resource_id=any(${allResourceIds}::text[]) or after ->> 'id'=any(${allResourceIds}::text[]))) audits,
              (select count(*)::int from idempotency_keys where clinic_id=${clinicId!}::uuid and created_at>=${startedAt}::timestamptz and response::text like any(${allResourceIds.map((id) => `%${id}%`)}::text[])) idempotency
          `;
            return {
              removed: {
                jobs: removedJobs.length,
                outbox: removedOutbox.length,
                audits: removedAudits.length,
                idempotency: removedIdempotency.length,
                waitlist: cleanupWaitlistIds.length,
                appointments: cleanupAppointmentIds.length,
                patients: cleanupPatientIds.length,
              },
              remaining,
            };
          }),
        );
        cleanup = result.remaining;
        expect(result.remaining).toEqual({
          patients: 0,
          jobs: 0,
          waitlist: 0,
          appointments: 0,
          outbox: 0,
          audits: 0,
          idempotency: 0,
        });
        console.log(`[waitlist-a-cleanup] ${JSON.stringify(result)}`);
      }
      await context.close().catch(() => undefined);
      await sql.end();
      if (clinicId && !cleanup) throw new Error('Cleanup da lista de espera não foi comprovado.');
    }
  });
});
