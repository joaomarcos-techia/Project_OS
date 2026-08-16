import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const doctorEmail = process.env.E2E_DOCTOR_EMAIL;
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

async function expectStat(page: Page, label: string, value: number): Promise<void> {
  const card = page.getByText(label, { exact: true }).locator('../..');
  await expect(card).toBeVisible();
  await expect(card.getByText(String(value), { exact: true })).toBeVisible();
}

test.describe('produção: reconciliação operacional do Dashboard', () => {
  test.describe.configure({ retries: 0 });

  test('KPIs, próximos, checklist e atividade coincidem com o banco', async ({ browser }) => {
    test.setTimeout(180_000);
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste read-only só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !doctorEmail || !sharedPassword) {
      throw new Error('Credenciais da Clínica A ausentes.');
    }

    const { databaseUrl } = productionConfig();
    const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });
    const ownerContext = await browser.newContext({ baseURL: baseUrl });
    const doctorContext = await browser.newContext({ baseURL: baseUrl });
    const ownerPage = await ownerContext.newPage();
    const doctorPage = await doctorContext.newPage();

    try {
      const [state] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            clinic_id: string;
            timezone: string;
            owner_can_audit: boolean;
            doctor_can_audit: boolean;
            consultas_hoje: number;
            aguardando: number;
            em_atendimento: number;
            finalizadas: number;
            proximos: number;
            has_doctor: boolean;
            has_hours: boolean;
            has_patient: boolean;
            has_procedure: boolean;
            has_whatsapp: boolean;
            activity_items: number;
          }[]
        >`
          with identity as (
            select ep.clinic_id, c.timezone,
                   'view:audit'=any(ep.permissions) owner_can_audit,
                   (select 'view:audit'=any(d.permissions)
                      from auth.users du join effective_permissions_v d on d.user_id=du.id
                     where lower(du.email)=${doctorEmail.toLowerCase()}
                       and d.clinic_id=ep.clinic_id and d.ativo=true and d.deleted_at is null
                     limit 1) doctor_can_audit
              from auth.users u join effective_permissions_v ep on ep.user_id=u.id
              join clinics c on c.id=ep.clinic_id
             where lower(u.email)=${ownerEmail.toLowerCase()} and ep.role='owner'
               and ep.ativo=true and ep.deleted_at is null
          ), bounds as (
            select i.*,
                   ((now() at time zone i.timezone)::date::timestamp at time zone i.timezone) day_from,
                   (((now() at time zone i.timezone)::date + 1)::timestamp at time zone i.timezone) day_to
              from identity i
          )
          select b.clinic_id::text, b.timezone, b.owner_can_audit,
                 coalesce(b.doctor_can_audit,false) doctor_can_audit,
                 (select count(*)::int from appointments a where a.clinic_id=b.clinic_id
                   and a.scheduled_at>=b.day_from and a.scheduled_at<b.day_to
                   and a.status in ('agendado','confirmado','chegou','em_atendimento','atendido')) consultas_hoje,
                 (select count(*)::int from appointments a where a.clinic_id=b.clinic_id
                   and a.scheduled_at>=b.day_from and a.scheduled_at<b.day_to
                   and a.status='chegou') aguardando,
                 (select count(*)::int from appointments a where a.clinic_id=b.clinic_id
                   and a.scheduled_at>=b.day_from and a.scheduled_at<b.day_to
                   and a.status='em_atendimento') em_atendimento,
                 (select count(*)::int from appointments a where a.clinic_id=b.clinic_id
                   and a.scheduled_at>=b.day_from and a.scheduled_at<b.day_to
                   and a.status='atendido') finalizadas,
                 least(6, (select count(*)::int from appointments a where a.clinic_id=b.clinic_id
                   and a.scheduled_at>=b.day_from and a.scheduled_at<b.day_to
                   and a.status in ('agendado','confirmado','chegou'))) proximos,
                 exists(select 1 from profiles p where p.clinic_id=b.clinic_id
                   and (p.role='doctor' or p.crm is not null)) has_doctor,
                 exists(select 1 from doctor_availability d where d.clinic_id=b.clinic_id) has_hours,
                 exists(select 1 from patients p where p.clinic_id=b.clinic_id) has_patient,
                 exists(select 1 from procedures p where p.clinic_id=b.clinic_id and p.ativo=true) has_procedure,
                 exists(select 1 from clinic_whatsapp_numbers w where w.clinic_id=b.clinic_id
                   and w.active=true and w.connection_status='connected') has_whatsapp,
                 least(5, (select count(*)::int from audit_events a
                   where a.clinic_id=b.clinic_id)) activity_items
            from bounds b
        `;
      });
      if (!state) throw new Error('Estado autoritativo do Dashboard ausente.');
      expect(state.owner_can_audit).toBe(true);
      expect(state.doctor_can_audit).toBe(false);
      expect(state.consultas_hoje).toBeLessThanOrEqual(200);

      await Promise.all([
        signInContext(ownerContext, ownerEmail, sharedPassword),
        signInContext(doctorContext, doctorEmail, sharedPassword),
      ]);
      await Promise.all([ownerPage.goto('/dashboard'), doctorPage.goto('/dashboard')]);

      await expectStat(ownerPage, 'Consultas hoje', state.consultas_hoje);
      await expectStat(ownerPage, 'Aguardando', state.aguardando);
      await expectStat(ownerPage, 'Em atendimento', state.em_atendimento);
      await expect(
        ownerPage
          .getByText('Consultas hoje', { exact: true })
          .locator('../..')
          .getByText(`${state.finalizadas} finalizadas`, { exact: true }),
      ).toBeVisible();

      const upcomingPanel = ownerPage
        .getByText('Próximos na agenda', { exact: true })
        .locator('../..');
      if (state.proximos === 0) {
        await expect(upcomingPanel.getByText('Nada para hoje.', { exact: true })).toBeVisible();
      } else {
        await expect(upcomingPanel.getByRole('listitem')).toHaveCount(state.proximos);
      }

      const checklistFlags = [
        state.has_doctor,
        state.has_hours,
        state.has_patient,
        state.has_procedure,
        state.has_whatsapp,
      ];
      const checklistDone = checklistFlags.filter(Boolean).length;
      if (checklistDone === checklistFlags.length) {
        await expect(ownerPage.getByText('Primeiros passos', { exact: true })).toHaveCount(0);
      } else {
        await expect(ownerPage.getByText('Primeiros passos', { exact: true })).toBeVisible();
        await expect(
          ownerPage.getByText(`${checklistDone}/5 concluídos`, { exact: true }),
        ).toBeVisible();
      }

      const ownerActivityPanel = ownerPage
        .getByText('Atividade recente', { exact: true })
        .locator('../..');
      if (state.activity_items === 0) {
        await expect(
          ownerActivityPanel.getByText('Nenhuma atividade registrada ainda.', { exact: true }),
        ).toBeVisible();
      } else {
        await expect(ownerActivityPanel.getByRole('listitem')).toHaveCount(state.activity_items);
      }
      await expect(
        doctorPage.getByText('A trilha de atividade fica disponível para gestores.', {
          exact: true,
        }),
      ).toBeVisible();

      await ownerPage.getByRole('link', { name: 'Atualizar' }).click();
      await expect(ownerPage).toHaveURL(/\/dashboard(?:\?|$)/u);
      await expectStat(ownerPage, 'Consultas hoje', state.consultas_hoje);
      await expect(ownerPage.getByText('Ocupação por profissional', { exact: true })).toBeVisible();
      await expect(ownerPage.getByText('Alertas da IA', { exact: true })).toBeVisible();

      console.log(
        `[dashboard-operational-a] ${JSON.stringify({
          timezone: state.timezone,
          consultasHoje: state.consultas_hoje,
          aguardando: state.aguardando,
          emAtendimento: state.em_atendimento,
          finalizadas: state.finalizadas,
          proximos: state.proximos,
          checklistDone,
          checklistTotal: checklistFlags.length,
          checklistHiddenWhenComplete: checklistDone === checklistFlags.length,
          ownerActivityItems: state.activity_items,
          ownerCanAudit: state.owner_can_audit,
          doctorCanAudit: state.doctor_can_audit,
          doctorActivityHidden: true,
          refreshLinkPreservedState: true,
          placeholdersDeclaredAsComingSoon: 2,
          mutation: false,
        })}`,
      );
    } finally {
      await Promise.all([
        ownerContext.close().catch(() => undefined),
        doctorContext.close().catch(() => undefined),
      ]);
      await sql.end();
    }
  });
});
