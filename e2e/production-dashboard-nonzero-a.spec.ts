import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_DASHBOARD_NONZERO === 'ALLOW_SYNTHETIC_CLINIC_A';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_TENANT_PASSWORD;

const fixtureStatuses = ['agendado', 'confirmado', 'chegou', 'em_atendimento', 'atendido'] as const;

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

async function expectStat(page: Page, label: string, value: number): Promise<void> {
  const card = page.getByText(label, { exact: true }).locator('../..');
  await expect(card).toBeVisible();
  await expect(card.getByText(String(value), { exact: true })).toBeVisible();
}

type DashboardState = {
  consultas_hoje: number;
  aguardando: number;
  em_atendimento: number;
  finalizadas: number;
  proximos: number;
};

test.describe('produção: Dashboard não-zero sintético na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('KPIs e próximos refletem cinco status e o cleanup restaura o baseline', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    test.skip(!authorized, 'Exige autorização explícita para fixtures sintéticos na Clínica A.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste não-zero só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !ownerPassword) throw new Error('Credencial do owner A ausente.');

    const { databaseUrl } = productionConfig();
    const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });
    const context = await browser.newContext({ baseURL: baseUrl });
    const page = await context.newPage();
    const marker = `[E2E-DASHBOARD-A-${String(Date.now()).slice(-10)}]`;
    const appointmentIds: string[] = [];
    let clinicId: string | undefined;
    let timezone: string | undefined;
    let baseline: DashboardState | undefined;
    let cleanup: Record<string, number> | undefined;

    try {
      const fixture = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const [identity] = await tx<{ clinic_id: string; timezone: string }[]>`
          select p.clinic_id::text, c.timezone
            from profiles p
            join auth.users u on u.id=p.id
            join clinics c on c.id=p.clinic_id
           where lower(u.email)=${ownerEmail.toLowerCase()} and p.role='owner'
             and p.ativo=true and p.deleted_at is null
           limit 1
        `;
        if (!identity) throw new Error('Owner ativo da Clínica A não encontrado.');
        clinicId = identity.clinic_id;
        timezone = identity.timezone;

        const [doctor] = await tx<{ id: string }[]>`
          select id::text
            from profiles
           where clinic_id=${identity.clinic_id}::uuid and ativo=true and deleted_at is null
             and (role='doctor' or crm is not null)
           order by case when role='doctor' then 0 else 1 end, created_at, id
           limit 1
        `;
        const [procedure] = await tx<{ id: string }[]>`
          select id::text
            from procedures
           where clinic_id=${identity.clinic_id}::uuid and ativo=true
           order by created_at, id
           limit 1
        `;
        if (!doctor || !procedure) throw new Error('Clínica A sem médico ou procedimento ativo.');

        const [before] = await tx<DashboardState[]>`
          with bounds as (
            select ((now() at time zone ${identity.timezone})::date::timestamp
                      at time zone ${identity.timezone}) day_from,
                   (((now() at time zone ${identity.timezone})::date + 1)::timestamp
                      at time zone ${identity.timezone}) day_to
          ), relevant as (
            select a.* from appointments a cross join bounds b
             where a.clinic_id=${identity.clinic_id}::uuid
               and a.scheduled_at>=b.day_from and a.scheduled_at<b.day_to
               and a.status in ('agendado','confirmado','chegou','em_atendimento','atendido')
          )
          select count(*)::int consultas_hoje,
                 count(*) filter(where status='chegou')::int aguardando,
                 count(*) filter(where status='em_atendimento')::int em_atendimento,
                 count(*) filter(where status='atendido')::int finalizadas,
                 least(6, count(*) filter(where status in ('agendado','confirmado','chegou')))::int proximos
            from relevant
        `;
        if (!before) throw new Error('Baseline do Dashboard ausente.');
        if (before.consultas_hoje > 195) {
          throw new Error('Baseline excede o limite seguro de 195 agendamentos do Dashboard.');
        }
        baseline = before;

        const freeSlots = await tx<{ scheduled_at: Date }[]>`
          with bounds as (
            select ((now() at time zone ${identity.timezone})::date::timestamp
                      at time zone ${identity.timezone}) day_from
          )
          select b.day_from + (candidate.minute * interval '1 minute') scheduled_at
            from bounds b cross join generate_series(5, 300, 5) as candidate(minute)
           where b.day_from + (candidate.minute * interval '1 minute') < now() - interval '15 minutes'
             and not exists (
               select 1 from appointments a
                where a.doctor_id=${doctor.id}::uuid
                  and a.scheduled_at=b.day_from + (candidate.minute * interval '1 minute')
                  and a.status not in ('cancelado','faltou')
             )
           order by candidate.minute
           limit 5
        `;
        if (freeSlots.length !== fixtureStatuses.length) {
          throw new Error('Não há cinco horários retroativos livres e seguros hoje.');
        }

        const inserted: Array<{ id: string; status: string }> = [];
        for (const [index, status] of fixtureStatuses.entries()) {
          const slot = freeSlots[index];
          if (!slot) throw new Error(`Horário sintético ${index} ausente.`);
          const rows = await tx<{ id: string; status: string }[]>`
            insert into appointments (
              clinic_id, doctor_id, procedure_id, scheduled_at, duration_min, status, valor,
              snapshot_procedure_name, snapshot_procedure_valor,
              snapshot_procedure_duracao_min, snapshot_doctor_nome,
              created_via, observacoes
            ) values (
              ${identity.clinic_id}::uuid, ${doctor.id}::uuid, ${procedure.id}::uuid,
              ${slot.scheduled_at}, 15, ${status}::appointment_status, 0,
              ${marker}, 0, 15, ${marker}, 'walkin', ${marker}
            )
            returning id::text, status::text
          `;
          inserted.push(...rows);
        }
        appointmentIds.push(...inserted.map(({ id }) => id));
        expect(inserted.map(({ status }) => status)).toEqual([...fixtureStatuses]);

        const [after] = await tx<
          (DashboardState & {
            fixture_count: number;
            fixture_upcoming: number;
            upcoming_walkins: number;
            upcoming_statuses: string[];
          })[]
        >`
          with bounds as (
            select ((now() at time zone ${identity.timezone})::date::timestamp
                      at time zone ${identity.timezone}) day_from,
                   (((now() at time zone ${identity.timezone})::date + 1)::timestamp
                      at time zone ${identity.timezone}) day_to
          ), relevant as (
            select a.* from appointments a cross join bounds b
             where a.clinic_id=${identity.clinic_id}::uuid
               and a.scheduled_at>=b.day_from and a.scheduled_at<b.day_to
               and a.status in ('agendado','confirmado','chegou','em_atendimento','atendido')
             order by a.scheduled_at
             limit 200
          ), upcoming as (
            select * from relevant
             where status in ('agendado','confirmado','chegou')
             order by scheduled_at
             limit 6
          )
          select (select count(*)::int from relevant) consultas_hoje,
                 (select count(*)::int from relevant where status='chegou') aguardando,
                 (select count(*)::int from relevant where status='em_atendimento') em_atendimento,
                 (select count(*)::int from relevant where status='atendido') finalizadas,
                 (select count(*)::int from upcoming) proximos,
                 (select count(*)::int from relevant where id=any(${appointmentIds}::uuid[])) fixture_count,
                 (select count(*)::int from upcoming where id=any(${appointmentIds}::uuid[])) fixture_upcoming,
                 (select count(*)::int from upcoming where patient_id is null) upcoming_walkins,
                 coalesce((select array_agg(status::text order by scheduled_at) from upcoming), '{}') upcoming_statuses
        `;
        if (!after) throw new Error('Estado não-zero do Dashboard ausente.');
        return { before, after, timezone: identity.timezone };
      });

      expect(fixture.after).toMatchObject({
        consultas_hoje: fixture.before.consultas_hoje + 5,
        aguardando: fixture.before.aguardando + 1,
        em_atendimento: fixture.before.em_atendimento + 1,
        finalizadas: fixture.before.finalizadas + 1,
        fixture_count: 5,
        fixture_upcoming: 3,
      });

      await signInContext(context, ownerEmail, ownerPassword);
      await page.goto('/dashboard');

      await expectStat(page, 'Consultas hoje', fixture.after.consultas_hoje);
      await expectStat(page, 'Aguardando', fixture.after.aguardando);
      await expectStat(page, 'Em atendimento', fixture.after.em_atendimento);
      await expect(
        page
          .getByText('Consultas hoje', { exact: true })
          .locator('../..')
          .getByText(`${fixture.after.finalizadas} finalizadas`, { exact: true }),
      ).toBeVisible();

      const upcomingPanel = page.getByText('Próximos na agenda', { exact: true }).locator('../..');
      await expect(upcomingPanel.getByRole('listitem')).toHaveCount(fixture.after.proximos);
      await expect(upcomingPanel.getByText('Walk-in', { exact: true })).toHaveCount(
        fixture.after.upcoming_walkins,
      );
      const statusLabels: Record<string, string> = {
        agendado: 'Agendado',
        confirmado: 'Confirmado',
        chegou: 'Chegou',
      };
      for (const [status, label] of Object.entries(statusLabels)) {
        const expected = fixture.after.upcoming_statuses.filter((item) => item === status).length;
        await expect(upcomingPanel.getByText(label, { exact: true })).toHaveCount(expected);
      }

      console.log(
        `[dashboard-nonzero-a] ${JSON.stringify({
          timezone: fixture.timezone,
          baseline: fixture.before,
          observed: fixture.after,
          fixtures: fixtureStatuses.length,
          fixtureUpcoming: fixture.after.fixture_upcoming,
          externalEffects: false,
        })}`,
      );
    } finally {
      if (clinicId && timezone && baseline && appointmentIds.length > 0) {
        const cleanupClinicId = clinicId;
        const cleanupTimezone = timezone;
        const cleanupBaseline = baseline;
        const [restored] = await sql.begin(async (tx) => {
          await tx.unsafe('RESET ROLE');
          await tx`delete from appointments where id=any(${appointmentIds}::uuid[])`;
          const rows = await tx<
            {
              appointments: number;
              state_logs: number;
              queue_entries: number;
              resource_reservations: number;
              outbox: number;
              audits: number;
              idempotency: number;
              consultas_hoje: number;
              aguardando: number;
              em_atendimento: number;
              finalizadas: number;
              proximos: number;
            }[]
          >`
            with bounds as (
              select ((now() at time zone ${cleanupTimezone})::date::timestamp
                        at time zone ${cleanupTimezone}) day_from,
                     (((now() at time zone ${cleanupTimezone})::date + 1)::timestamp
                        at time zone ${cleanupTimezone}) day_to
            ), relevant as (
              select a.* from appointments a cross join bounds b
               where a.clinic_id=${cleanupClinicId}::uuid
                 and a.scheduled_at>=b.day_from and a.scheduled_at<b.day_to
                 and a.status in ('agendado','confirmado','chegou','em_atendimento','atendido')
               order by a.scheduled_at
               limit 200
            )
            select (select count(*)::int from appointments where id=any(${appointmentIds}::uuid[])) appointments,
                   (select count(*)::int from appointment_state_log where appointment_id=any(${appointmentIds}::uuid[])) state_logs,
                   (select count(*)::int from waiting_queue_entries where appointment_id=any(${appointmentIds}::uuid[])) queue_entries,
                   (select count(*)::int from appointment_resource_reservations where appointment_id=any(${appointmentIds}::uuid[])) resource_reservations,
                   (select count(*)::int from outbox where clinic_id=${cleanupClinicId}::uuid and payload::text like ${`%${marker}%`}) outbox,
                   (select count(*)::int from audit_events where clinic_id=${cleanupClinicId}::uuid and resource_id=any(${appointmentIds}::text[])) audits,
                   (select count(*)::int from idempotency_keys where clinic_id=${cleanupClinicId}::uuid and response::text like ${`%${marker}%`}) idempotency,
                   (select count(*)::int from relevant) consultas_hoje,
                   (select count(*)::int from relevant where status='chegou') aguardando,
                   (select count(*)::int from relevant where status='em_atendimento') em_atendimento,
                   (select count(*)::int from relevant where status='atendido') finalizadas,
                   (select least(6, count(*))::int from relevant where status in ('agendado','confirmado','chegou')) proximos
          `;
          return rows;
        });
        if (!restored) throw new Error('Verificação de cleanup ausente.');
        cleanup = restored;
        expect(restored).toMatchObject({
          appointments: 0,
          state_logs: 0,
          queue_entries: 0,
          resource_reservations: 0,
          outbox: 0,
          audits: 0,
          idempotency: 0,
          ...cleanupBaseline,
        });
        console.log(`[dashboard-nonzero-a-cleanup] ${JSON.stringify(restored)}`);
      }
      await context.close().catch(() => undefined);
      await sql.end();
      if (appointmentIds.length > 0 && !cleanup) {
        throw new Error('Cleanup do fixture não foi comprovado.');
      }
    }
  });
});
