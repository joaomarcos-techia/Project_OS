import { expect, test, type BrowserContext } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_SUBSCRIPTION_TRIAL === 'ALLOW_CONTROLLED_NEGATIVE';
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

function productionConfig(): { databaseUrl: string; url: string; key: string } {
  const databaseUrl = process.env.DATABASE_URL_PROD;
  const key = process.env.SUPABASE_SECRET_KEY_PROD;
  if (!databaseUrl || !key) throw new Error('Credenciais operacionais PROD ausentes.');
  const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  if (!projectRef || !/^[a-z]{20}$/u.test(projectRef)) {
    throw new Error('Project ref de produção inválido.');
  }
  return { databaseUrl, url: `https://${projectRef}.supabase.co`, key };
}

async function signInContext(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<void> {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  const { url, key } = productionConfig();
  let nextCookies: Array<{ name: string; value: string }> = [];
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


test.describe('produção: negativa de cancelamento durante trial', () => {
  test.describe.configure({ retries: 0 });

  test('UI nao oferece a acao durante o trial e nada persiste', async ({ browser }) => {
    test.setTimeout(180_000);
    test.skip(!authorized, 'Exige autorização explícita para a negativa controlada de assinatura.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de assinatura só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !doctorEmail || !sharedPassword) {
      throw new Error('Credenciais da Clínica A ausentes.');
    }

    const { databaseUrl } = productionConfig();
    const sql = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
    const ownerContext = await browser.newContext({ baseURL: baseUrl });
    const doctorContext = await browser.newContext({ baseURL: baseUrl });
    const ownerPage = await ownerContext.newPage();
    const doctorPage = await doctorContext.newPage();
    let clinicId: string | undefined;
    let subscriptionId: string | undefined;
    let cancellationKey: string | undefined;

    try {
      const [baseline] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<
          {
            clinic_id: string;
            subscription_id: string;
            status: string;
            period_end_present: boolean;
            cancel_at_period_end: boolean;
            pending: number;
          }[]
        >`
          select p.clinic_id::text, s.id::text subscription_id,
                 s.billing_status::text status,
                 s.current_period_end is not null period_end_present,
                 s.cancel_at_period_end,
                 (select count(*)::int from subscription_change_requests r
                   where r.subscription_id=s.id and r.status in ('pending_payment','scheduled')) pending
            from auth.users u join profiles p on p.id=u.id
            join subscriptions s on s.clinic_id=p.clinic_id
           where lower(u.email)=${ownerEmail.toLowerCase()}
             and p.role='owner' and p.ativo=true and p.deleted_at is null
        `;
      });
      if (!baseline) throw new Error('Assinatura da Clínica A não encontrada.');
      expect(baseline).toMatchObject({
        status: 'trial',
        period_end_present: true,
        cancel_at_period_end: false,
        pending: 0,
      });
      clinicId = baseline.clinic_id;
      subscriptionId = baseline.subscription_id;
      const testClinicId = baseline.clinic_id;
      const testSubscriptionId = baseline.subscription_id;

      await Promise.all([
        signInContext(ownerContext, ownerEmail, sharedPassword),
        signInContext(doctorContext, doctorEmail, sharedPassword),
      ]);
      await Promise.all([
        ownerPage.goto('/configuracoes/assinatura'),
        doctorPage.goto('/configuracoes/assinatura'),
      ]);
      await expect(doctorPage.getByText('Sem acesso', { exact: true })).toBeVisible();
      await expect(
        doctorPage.getByRole('button', { name: 'Cancelar assinatura ao fim do ciclo' }),
      ).toHaveCount(0);

      // UX-002 — o achado: a assinatura em `trial` OFERECIA o botao de
      // cancelamento, o owner clicava, recebia 200 controlado com "O
      // cancelamento exige uma assinatura ativa." e nada acontecia. O backend
      // sempre esteve fail-closed; o defeito era a UI prometer uma acao
      // impossivel. Agora o botao so aparece com `billingStatus === 'active'`.
      const cancelButton = ownerPage.getByRole('button', {
        name: 'Cancelar assinatura ao fim do ciclo',
      });
      await expect(cancelButton).toHaveCount(0);
      const cancellationButtonVisible = false;

      // A verificacao que continua importando: nada mudou no estado da
      // assinatura. O gate de backend (`billingStatus === 'active'`) segue
      // coberto por teste unitario.
      const idempotencyKey = 'billing:cancellation:nao-houve-tentativa';
      const [after] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const rows = await tx<
          {
            status: string;
            cancel_at_period_end: boolean;
            pending_changes: number;
            cancellation_events: number;
            audits: number;
            idempotency: number;
          }[]
        >`
          select s.billing_status::text status, s.cancel_at_period_end,
                 (select count(*)::int from subscription_change_requests r
                   where r.subscription_id=s.id and r.status in ('pending_payment','scheduled')) pending_changes,
                 (select count(*)::int from billing_events e where e.clinic_id=s.clinic_id
                   and e.type='subscription.cancellation.requested'
                   and e.payload->>'changeId' in (
                     select r.id::text from subscription_change_requests r
                      where r.subscription_id=s.id
                   )) cancellation_events,
                 (select count(*)::int from audit_events a where a.clinic_id=s.clinic_id
                   and a.action='subscription.cancellation.requested'
                   and a.created_at >= now() - interval '5 minutes') audits,
                 (select count(*)::int from idempotency_keys i where i.key=${idempotencyKey}) idempotency
            from subscriptions s where s.id=${testSubscriptionId}::uuid
              and s.clinic_id=${testClinicId}::uuid
        `;
        return rows;
      });
      expect(after).toEqual({
        status: 'trial',
        cancel_at_period_end: false,
        pending_changes: 0,
        cancellation_events: 0,
        audits: 0,
        idempotency: 0,
      });

      console.log(
        `[subscription-trial-negative-a] ${JSON.stringify({
          billingStatus: baseline.status,
          periodEndPresent: baseline.period_end_present,
          cancellationButtonVisible,
          uiOffersImpossibleAction: cancellationButtonVisible,
          cancelAtPeriodEndAfter: after?.cancel_at_period_end,
          pendingChangesAfter: after?.pending_changes,
          billingEventsAfter: after?.cancellation_events,
          auditsAfter: after?.audits,
          idempotencyAfter: after?.idempotency,
          asaasMutation: false,
        })}`,
      );
    } finally {
      try {
        if (clinicId && subscriptionId) {
          const testClinicId = clinicId;
          const testSubscriptionId = subscriptionId;
          const [remaining] = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            const rows = await tx<
              {
                status: string;
                cancel_at_period_end: boolean;
                pending_changes: number;
                markers: number;
              }[]
            >`
              select s.billing_status::text status, s.cancel_at_period_end,
                     (select count(*)::int from subscription_change_requests r
                       where r.subscription_id=s.id and r.status in ('pending_payment','scheduled')) pending_changes,
                     (select count(*)::int from idempotency_keys i
                       where i.key=${
                         cancellationKey
                           ? `billing:cancellation:${cancellationKey.replaceAll('-', '')}`
                           : 'billing:cancellation:absent'
                       }) markers
                from subscriptions s where s.id=${testSubscriptionId}::uuid
                  and s.clinic_id=${testClinicId}::uuid
            `;
            return rows;
          });
          expect(remaining).toEqual({
            status: 'trial',
            cancel_at_period_end: false,
            pending_changes: 0,
            markers: 0,
          });
          console.log(`[subscription-trial-negative-a-cleanup] ${JSON.stringify(remaining)}`);
        }
      } finally {
        await Promise.all([
          ownerContext.close().catch(() => undefined),
          doctorContext.close().catch(() => undefined),
        ]);
        await sql.end();
      }
    }
  });
});
