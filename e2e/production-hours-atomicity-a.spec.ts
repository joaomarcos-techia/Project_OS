import { randomBytes } from 'node:crypto';

import { expect, test, type BrowserContext, type Page, type Response } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_HOURS_ATOMICITY === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_TENANT_PASSWORD;

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

function statelessClient(url: string, key: string) {
  return createSsrClient(url, key, {
    cookies: { getAll: () => [], setAll: () => undefined },
    auth: { autoRefreshToken: false, persistSession: false },
  });
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

function isServerAction(response: Response): boolean {
  const request = response.request();
  return request.method() === 'POST' && Boolean(request.headers()['next-action']);
}

async function clickAction(page: Page, buttonName: string | RegExp): Promise<number> {
  const responsePromise = page.waitForResponse(isServerAction);
  await page.getByRole('button', { name: buttonName }).click();
  return (await responsePromise).status();
}

test.describe('produção: atomicidade de horários na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('expediente com pausa, conflito parcial, feriado e remoções', async ({ browser }) => {
    test.setTimeout(300_000);
    test.skip(!authorized, 'Exige autorização explícita para horários sintéticos na Clínica A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de horários só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !ownerPassword) throw new Error('Credencial do owner A ausente.');

    const { databaseUrl, url, secretKey } = productionConfig();
    const sql = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
    const admin = statelessClient(url, secretKey);
    const context = await browser.newContext({ baseURL: baseUrl });
    const page = await context.newPage();
    const runId = String(Date.now()).slice(-10);
    const syntheticEmail = `e2e-hours-a-${runId}@example.test`;
    const syntheticName = `[E2E-HOURS-A-${runId}]`;
    const syntheticPassword = `Aa1!${randomBytes(18).toString('base64url')}`;
    const holidayReason = `[E2E-HOURS-${runId}] <b>feriado</b>`;
    const holidayCandidates = ['2099-12-31', '2099-12-30', '2099-12-29'];
    const observedResourceIds = new Set<string>();
    let clinicId: string | undefined;
    let doctorId: string | undefined;
    let holidayDate: string | undefined;
    let userDeleted = false;
    let baselineActive: number | undefined;

    try {
      const [baseline] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            clinic_id: string;
            owner_id: string;
            active: number;
            preexisting: number;
          }[]
        >`
          select p.clinic_id::text, p.id::text owner_id,
                 (select count(*)::int from profiles x where x.clinic_id=p.clinic_id
                   and x.ativo=true and x.deleted_at is null) active,
                 (select count(*)::int from auth.users u
                   where lower(u.email)=${syntheticEmail}) preexisting
            from profiles p join auth.users u on u.id=p.id
           where lower(u.email)=${ownerEmail.toLowerCase()} and p.role='owner'
             and p.ativo=true and p.deleted_at is null
        `;
      });
      if (!baseline) throw new Error('Owner A não encontrado.');
      expect(baseline).toMatchObject({ active: 4, preexisting: 0 });
      clinicId = baseline.clinic_id;
      baselineActive = baseline.active;
      const testClinicId = baseline.clinic_id;

      const [availableHoliday] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ date: string }[]>`
          select candidate::text date
            from unnest(${holidayCandidates}::date[]) candidate
           where not exists (
             select 1 from clinic_holidays h
              where h.clinic_id=${testClinicId}::uuid and h.date=candidate
           )
           limit 1
        `;
      });
      if (!availableHoliday) throw new Error('Sem data sintética livre para feriado.');
      holidayDate = availableHoliday.date;
      const testHolidayDate = availableHoliday.date;

      const created = await admin.auth.admin.createUser({
        email: syntheticEmail,
        password: syntheticPassword,
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        throw created.error ?? new Error('Auth user sintético não foi criado.');
      }
      doctorId = created.data.user.id;
      const testDoctorId = created.data.user.id;
      await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        await tx`
          insert into profiles (id, clinic_id, nome, role, crm, crm_uf, ativo, invite_accepted_at)
          values (${testDoctorId}::uuid, ${testClinicId}::uuid, ${syntheticName}, 'doctor',
                  ${`E2E${runId}`}, 'SP', true, now())
        `;
      });

      await signInContext(context, ownerEmail, ownerPassword);
      await page.goto('/configuracoes/horarios');
      await page.getByLabel('Profissional').selectOption(testDoctorId);

      const lunchCheckbox = page.getByRole('checkbox', {
        name: 'Com pausa de almoço (cria manhã + tarde)',
      });
      await lunchCheckbox.uncheck();
      await page.getByLabel('Dia').selectOption('6');
      await page.locator('#availability-start').fill('14:00');
      await page.locator('#availability-end').fill('15:00');
      const collisionSeedHttpStatus = await clickAction(page, 'Adicionar janela');
      expect(collisionSeedHttpStatus).toBe(200);

      const seedRows = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; start_time: string; end_time: string }[]>`
          select id::text, start_time::text, end_time::text
            from doctor_availability
           where clinic_id=${testClinicId}::uuid and doctor_id=${testDoctorId}::uuid
           order by start_time
        `;
      });
      expect(seedRows.map(({ start_time, end_time }) => [start_time, end_time])).toEqual([
        ['14:00:00', '15:00:00'],
      ]);
      seedRows.forEach(({ id }) => observedResourceIds.add(id));

      await lunchCheckbox.check();
      await page.getByLabel('Manhã — início').fill('08:00');
      await page.getByLabel('Manhã — fim').fill('09:00');
      await page.getByLabel('Tarde — início').fill('14:30');
      await page.getByLabel('Tarde — fim').fill('15:30');
      const partialStatuses: number[] = [];
      const responseListener = (response: Response) => {
        if (isServerAction(response)) partialStatuses.push(response.status());
      };
      page.on('response', responseListener);
      await page.getByRole('button', { name: 'Adicionar expediente' }).click();
      await expect
        .poll(() => partialStatuses.length, { timeout: 30_000 })
        .toBeGreaterThanOrEqual(1);
      // DATA-006 — o expediente virou UMA unidade. Este spec foi escrito para
      // reproduzir o achado e afirmava duas Server Actions com `[200, 500]`; a
      // assercao agora e mais ESTRITA: uma unica chamada, e ela nao pode ser 500.
      await page.waitForTimeout(1_500);
      page.off('response', responseListener);
      expect(partialStatuses).toHaveLength(1);
      expect(partialStatuses[0]).toBe(200);
      const partialErrorAlertText =
        (
          await page
            .getByRole('alert')
            .last()
            .textContent()
            .catch(() => null)
        )?.trim() ?? '';

      const partialRows = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; start_time: string; end_time: string }[]>`
          select id::text, start_time::text, end_time::text
            from doctor_availability
           where clinic_id=${testClinicId}::uuid and doctor_id=${testDoctorId}::uuid
           order by start_time
        `;
      });
      partialRows.forEach(({ id }) => observedResourceIds.add(id));
      // O conflito da tarde derruba o CONJUNTO: so a janela-semente permanece.
      expect(partialRows.map(({ start_time, end_time }) => [start_time, end_time])).toEqual([
        ['14:00:00', '15:00:00'],
      ]);
      const morningPersistedAfterAfternoonConflict = false;

      await page.reload();
      await page.getByLabel('Profissional').selectOption(testDoctorId);
      await expect(page.getByText('08:00–09:00', { exact: true })).toHaveCount(0);
      await expect(page.getByText('14:00–15:00', { exact: true })).toBeVisible();

      // A11Y-001 — os dois campos ganharam id/htmlFor no ciclo anterior.
      expect(await page.getByLabel('Data', { exact: true }).count()).toBe(1);
      expect(await page.getByLabel('Motivo (opcional)', { exact: true }).count()).toBe(1);
      const holidayInputsUnlabeled = false;
      const holidayDateInput = page.getByLabel('Data', { exact: true });
      const holidayReasonInput = page.getByLabel('Motivo (opcional)', { exact: true });
      await holidayDateInput.fill(testHolidayDate);
      await holidayReasonInput.fill(holidayReason);
      const holidayCreateHttpStatus = await clickAction(page, 'Adicionar feriado');
      expect(holidayCreateHttpStatus).toBe(200);
      await expect(page.getByText(holidayReason, { exact: true })).toBeVisible();

      const [holidayRow] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; count: number }[]>`
          select min(id::text) id, count(*)::int count
            from clinic_holidays
           where clinic_id=${testClinicId}::uuid and date=${testHolidayDate}::date
             and reason=${holidayReason}
        `;
      });
      expect(holidayRow?.count).toBe(1);
      if (!holidayRow?.id) throw new Error('Feriado sintético não encontrado.');
      observedResourceIds.add(holidayRow.id);

      // OBS-002 — conflito de negocio esperado volta como resultado controlado.
      const duplicateHolidayHttpStatus = await clickAction(page, 'Adicionar feriado');
      expect(duplicateHolidayHttpStatus).toBe(200);
      const duplicateHolidayErrorAlertText =
        (
          await page
            .getByRole('alert')
            .last()
            .textContent()
            .catch(() => null)
        )?.trim() ?? '';

      const holidayItem = page.locator('li').filter({ hasText: holidayReason });
      const holidayRemoveResponse = page.waitForResponse(isServerAction);
      await holidayItem.getByRole('button', { name: 'Remover' }).click();
      expect((await holidayRemoveResponse).status()).toBe(200);

      for (const start of ['14:00']) {
        const removeResponse = page.waitForResponse(isServerAction);
        await page.getByRole('button', { name: `Remover Sábado ${start}` }).click();
        expect((await removeResponse).status()).toBe(200);
      }

      const [state] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            availability: number;
            holidays: number;
            audits: number;
            idempotency: number;
          }[]
        >`
          select
            (select count(*)::int from doctor_availability
              where clinic_id=${testClinicId}::uuid and doctor_id=${testDoctorId}::uuid) availability,
            (select count(*)::int from clinic_holidays
              where clinic_id=${testClinicId}::uuid and date=${testHolidayDate}::date
                and reason=${holidayReason}) holidays,
            (select count(*)::int from audit_events a where a.clinic_id=${testClinicId}::uuid
              and (a.resource_id=any(${[...observedResourceIds]}::text[])
                or a.after->>'id'=any(${[...observedResourceIds]}::text[]))) audits,
            (select count(*)::int from idempotency_keys i where i.clinic_id=${testClinicId}::uuid
              and i.response->>'id'=any(${[...observedResourceIds]}::text[])) idempotency
        `;
      });
      // Menos trilhas do que antes porque o expediente rejeitado nao deixa
      // auditoria de sucesso nenhuma — antes o meio-expediente deixava.
      expect(state).toMatchObject({ availability: 0, holidays: 0 });
      expect(state?.audits ?? 0).toBeGreaterThan(0);
      expect(state?.idempotency ?? 0).toBeGreaterThan(0);

      console.log(
        `[hours-atomicity-a] ${JSON.stringify({
          collisionSeedHttpStatus,
          partialExpedientHttpStatuses: partialStatuses.slice(0, 2),
          partialErrorAlertWasBlank: partialErrorAlertText.length === 0,
          morningPersistedAfterAfternoonConflict,
          persistedWindowsAfterConflict: partialRows.length,
          holidayCreateHttpStatus,
          holidayInputsUnlabeled,
          duplicateHolidayHttpStatus,
          duplicateHolidayErrorAlertWasBlank: duplicateHolidayErrorAlertText.length === 0,
          finalAvailability: state?.availability,
          finalHolidays: state?.holidays,
          audits: state?.audits,
          idempotency: state?.idempotency,
          emailSent: false,
          asaasOrMetaMutation: false,
        })}`,
      );
    } finally {
      try {
        if (clinicId && doctorId) {
          const testClinicId = clinicId;
          const testDoctorId = doctorId;
          const currentIds = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            return tx<{ id: string }[]>`
              select id::text from doctor_availability
               where clinic_id=${testClinicId}::uuid and doctor_id=${testDoctorId}::uuid
              union all
              select id::text from clinic_holidays
               where clinic_id=${testClinicId}::uuid and date=${holidayDate ?? null}::date
                 and reason=${holidayReason}
            `;
          });
          currentIds.forEach(({ id }) => observedResourceIds.add(id));
          const ids = [...observedResourceIds];
          const cleanup = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            const removedAvailability = await tx<{ id: string }[]>`
              delete from doctor_availability where clinic_id=${testClinicId}::uuid
                and doctor_id=${testDoctorId}::uuid returning id::text
            `;
            const removedHolidays = await tx<{ id: string }[]>`
              delete from clinic_holidays where clinic_id=${testClinicId}::uuid
                and date=${holidayDate ?? null}::date and reason=${holidayReason} returning id::text
            `;
            const removedAudit = await tx<{ id: string }[]>`
              delete from audit_events where clinic_id=${testClinicId}::uuid
                and (resource_id=any(${ids}::text[]) or after->>'id'=any(${ids}::text[]))
              returning id::text
            `;
            const removedIdempotency = await tx<{ key: string }[]>`
              delete from idempotency_keys where clinic_id=${testClinicId}::uuid
                and response->>'id'=any(${ids}::text[]) returning key
            `;
            return {
              removed: {
                availability: removedAvailability.length,
                holidays: removedHolidays.length,
                audit: removedAudit.length,
                idempotency: removedIdempotency.length,
              },
            };
          });
          if (!userDeleted) {
            const deleted = await admin.auth.admin.deleteUser(testDoctorId);
            if (deleted.error) throw deleted.error;
            userDeleted = true;
          }
          const [remaining] = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            return tx<
              {
                profiles: number;
                auth_users: number;
                active: number;
                availability: number;
                holidays: number;
                audits: number;
                idempotency: number;
              }[]
            >`
              select
                (select count(*)::int from profiles where id=${testDoctorId}::uuid) profiles,
                (select count(*)::int from auth.users where id=${testDoctorId}::uuid) auth_users,
                (select count(*)::int from profiles where clinic_id=${testClinicId}::uuid
                  and ativo=true and deleted_at is null) active,
                (select count(*)::int from doctor_availability
                  where doctor_id=${testDoctorId}::uuid) availability,
                (select count(*)::int from clinic_holidays where clinic_id=${testClinicId}::uuid
                  and date=${holidayDate ?? null}::date and reason=${holidayReason}) holidays,
                (select count(*)::int from audit_events where clinic_id=${testClinicId}::uuid
                  and (resource_id=any(${ids}::text[]) or after->>'id'=any(${ids}::text[]))) audits,
                (select count(*)::int from idempotency_keys where clinic_id=${testClinicId}::uuid
                  and response->>'id'=any(${ids}::text[])) idempotency
            `;
          });
          expect(remaining).toEqual({
            profiles: 0,
            auth_users: 0,
            active: baselineActive,
            availability: 0,
            holidays: 0,
            audits: 0,
            idempotency: 0,
          });
          console.log(`[hours-atomicity-a-cleanup] ${JSON.stringify({ ...cleanup, remaining })}`);
        }
      } finally {
        if (doctorId && !userDeleted) {
          await admin.auth.admin.deleteUser(doctorId).catch(() => undefined);
        }
        await context.close().catch(() => undefined);
        await sql.end();
      }
    }
  });
});
