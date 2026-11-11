/** DEV identity/draft prepared before this run; no real person or email delivery. */
import { mkdir, writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { z } from 'zod';

import { entryPlan, expectedAmount } from '../scripts/abacatepay-checkout-session';
import { assertPreviewRuntimeIsDev, DEV_PROJECT_REF } from './preview-dev-runtime';
import { installVercelBypassForOrigin, vercelBypassHeaders } from './vercel-bypass';

test.use({
  storageState: { cookies: [], origins: [] },
  extraHTTPHeaders: {},
  trace: 'off',
  video: 'off',
  screenshot: 'off',
  viewport: { width: 1440, height: 1000 },
});

test('confirmed identity -> free trial -> server quota gates -> optional hosted Sandbox checkout', async ({
  page,
  context,
}) => {
  test.setTimeout(360_000);
  const input = z
    .object({
      E2E_ABACATEPAY_FIXTURE: z.literal('ALLOW_DEV_ONLY'),
      E2E_BASE_URL: z.url(),
      DATABASE_URL_DEV: z.string().min(1),
      E2E_ABACATEPAY_RUN_ID: z.uuid(),
      E2E_ABACATEPAY_USER_ID: z.uuid(),
      E2E_ABACATEPAY_EMAIL: z.email().regex(/^abaca-[a-f0-9-]+@example\.invalid$/),
      E2E_ABACATEPAY_PASSWORD: z.string().min(20),
      E2E_ABACATEPAY_PLAN: entryPlan,
      E2E_ABACATEPAY_EXPIRED: z.enum(['true', 'false']),
      E2E_ABACATEPAY_EXPECT_PAID: z.enum(['true', 'false']).default('false'),
    })
    .parse(process.env);
  const origin = new URL(input.E2E_BASE_URL);
  expect(origin.protocol).toBe('https:');
  expect(origin.hostname).toMatch(/^project-[a-z0-9-]+-clinic-os-v2-s-projects\.vercel\.app$/);
  const database = new URL(input.DATABASE_URL_DEV);
  expect(decodeURIComponent(database.username)).toBe(`postgres.${DEV_PROJECT_REF}`);
  expect(database.hostname).toMatch(/^[a-z0-9-]+\.pooler\.supabase\.com$/);
  expect(input.DATABASE_URL_DEV).not.toBe(process.env.DATABASE_URL_PROD);
  if (database.port === '6543') database.port = '5432';
  await assertPreviewRuntimeIsDev(origin.origin);
  const sql = postgres(database.toString(), {
    max: 1,
    prepare: false,
    ssl: 'require',
    connect_timeout: 15,
  });
  await installVercelBypassForOrigin(context, origin.origin);
  const stages: string[] = [];
  const browserErrorClasses: string[] = [];
  page.on('pageerror', (error) => {
    const category = /hydration|React error #418/i.test(error.message)
      ? 'hydration_mismatch'
      : /parentNode/.test(error.message)
        ? 'stream_parent_missing'
        : 'other_unhandled_browser_error';
    if (!browserErrorClasses.includes(category)) browserErrorClasses.push(category);
  });
  const evidence: {
    runId: string;
    userId: string;
    status: string;
    stages: string[];
    retention: string;
    scope: string;
    browserErrorClasses: string[];
    clinicId?: string;
    subscriptionId?: string;
    checkoutId?: string;
  } = {
    runId: input.E2E_ABACATEPAY_RUN_ID,
    userId: input.E2E_ABACATEPAY_USER_ID,
    status: 'RUNNING',
    stages,
    retention: 'retained_until_financial_reconciliation; never delete on test timeout',
    scope: 'Auth confirmed administratively; no proof of signup email delivery or external payment',
    browserErrorClasses,
  };
  try {
    await sql`SET statement_timeout='20s'`;
    const [identity] = await sql<{ email: string; created_at: Date; marker: string }[]>`
      SELECT email,created_at,raw_user_meta_data->>'qoro_fixture_run' marker FROM auth.users
      WHERE id=${input.E2E_ABACATEPAY_USER_ID}::uuid AND email_confirmed_at IS NOT NULL`;
    expect(identity?.email).toBe(input.E2E_ABACATEPAY_EMAIL);
    expect(identity?.marker).toBe(input.E2E_ABACATEPAY_RUN_ID);
    await page.goto(new URL('/login', origin.origin).toString());
    try {
      await page.locator('#email').fill(input.E2E_ABACATEPAY_EMAIL);
      await page.locator('input[name="password"]').fill(input.E2E_ABACATEPAY_PASSWORD);
    } catch {
      throw new Error('Synthetic login fields unavailable; credential diagnostics suppressed');
    }
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 90_000 });
    stages.push('real_browser_login');
    const [existing] = await sql<{ clinic_id: string }[]>`
      SELECT clinic_id::text FROM public.profiles WHERE id=${input.E2E_ABACATEPAY_USER_ID}::uuid`;
    if (!existing) {
      await page.goto(new URL('/cadastro/plano', origin.origin).toString());
      await expect(
        page.getByText('sem cartão e sem cobrança inicial', { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Começar avaliação gratuita', exact: true }),
      ).toBeEnabled();
      const plansResponse = await page.request.get(
        new URL('/api/signup/plan', origin.origin).toString(),
        // APIRequestContext does not use the browser context's route handler.
        // Scope the header to this known Preview request, never the hosted checkout.
        { headers: vercelBypassHeaders() },
      );
      expect(plansResponse.status()).toBe(200);
      const initialPlans = z
        .object({
          plans: z.array(
            z.object({
              id: z.uuid(),
              code: entryPlan,
              priceCents: z.number().int().positive(),
              cycle: z.literal('monthly'),
            }),
          ),
        })
        .parse(await plansResponse.json());
      expect(initialPlans.plans.map((plan) => plan.code).sort()).toEqual(
        [...entryPlan.options].sort(),
      );
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const doctors of [2, 3, 4, 5]) {
          const code = entryPlan.parse(`clinica_2026_${doctors}`);
          const offered = initialPlans.plans.find((plan) => plan.code === code);
          expect(offered?.priceCents).toBe(expectedAmount(code));
          if (!offered) throw new Error('Expected initial doctor plan missing');
          await page
            .locator('label')
            .filter({ has: page.locator(`input[value="${offered.id}"]`) })
            .click();
          const summary = page.getByRole('complementary');
          await expect(summary.getByText('Mensalidade após a avaliação')).toBeVisible();
          await expect(summary).toContainText(
            new RegExp(`R\\$\\s*${(expectedAmount(code) / 100).toFixed(2).replace('.', ',')}`),
          );
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          ).toBe(true);
        }
        stages.push(`initial_catalog_summary_${width}`);
      }
      const chosen = initialPlans.plans.find((plan) => plan.code === input.E2E_ABACATEPAY_PLAN);
      if (!chosen) throw new Error('Chosen initial plan missing');
      await page
        .locator('label')
        .filter({ has: page.locator(`input[value="${chosen.id}"]`) })
        .click();
      await page.getByRole('button', { name: 'Começar avaliação gratuita', exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 90_000 });
      stages.push('one_click_plan_to_trial_without_hosted_checkout');
    }
    const [contract] = await sql<
      {
        clinic_id: string;
        subscription_id: string;
        billing_provider: string;
        code: string;
        trial_ends_at: Date;
        status: string;
        external_checkout_id: string | null;
        operations: number;
        released_at: Date | null;
        asaas_subscription_id: string | null;
      }[]
    >`SELECT s.clinic_id::text,s.id::text subscription_id,s.billing_provider,p.code,
      s.trial_ends_at,s.billing_status status,b.external_checkout_id,t.released_at,s.asaas_subscription_id,
      (SELECT count(*)::int FROM billing_gateway.operations o WHERE o.subscription_id=s.id) operations
      FROM public.subscriptions s JOIN public.profiles u ON u.clinic_id=s.clinic_id
      JOIN public.plans p ON p.id=s.plan_id JOIN billing_gateway.bindings b ON b.subscription_id=s.id
      JOIN public.trial_access_policies t ON t.subscription_id=s.id
      WHERE u.id=${input.E2E_ABACATEPAY_USER_ID}::uuid AND u.role='owner' AND u.ativo`;
    expect(contract).toBeTruthy();
    if (!contract || !identity) throw new Error('Synthetic trial did not persist');
    evidence.clinicId = contract.clinic_id;
    evidence.subscriptionId = contract.subscription_id;
    expect(contract.billing_provider).toBe('abacatepay');
    expect(contract.code).toBe(input.E2E_ABACATEPAY_PLAN);
    expect(contract.asaas_subscription_id).toBeNull();
    expect(contract.trial_ends_at.getTime()).toBe(identity.created_at.getTime() + 14 * 86_400_000);
    if (input.E2E_ABACATEPAY_EXPECT_PAID === 'true') {
      expect(contract.status).toBe('active');
      expect(contract.released_at).not.toBeNull();
      const [financial] = await sql<
        { invoices: number; payments: number; receipts: number; events: number }[]
      >`SELECT
        (SELECT count(*)::int FROM public.invoices WHERE subscription_id=${contract.subscription_id}::uuid AND status='paid' AND total_amount=${expectedAmount(input.E2E_ABACATEPAY_PLAN) / 100}) invoices,
        (SELECT count(*)::int FROM public.payment_attempts a JOIN public.invoices i ON i.id=a.invoice_id WHERE i.subscription_id=${contract.subscription_id}::uuid AND a.provider='abacatepay' AND a.status='confirmed') payments,
        (SELECT count(*)::int FROM billing_gateway.paid_checkouts WHERE subscription_id=${contract.subscription_id}::uuid) receipts,
        (SELECT count(*)::int FROM billing_gateway.event_inbox WHERE subscription_id=${contract.subscription_id}::uuid AND event_type='subscription.completed' AND state='applied') events`;
      expect(financial?.invoices).toBe(1);
      expect(financial?.payments).toBe(1);
      expect(financial?.receipts).toBe(1);
      expect(financial?.events).toBeGreaterThanOrEqual(1);
      stages.push('paid_domain_records_verified');
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(new URL('/configuracoes/assinatura', origin.origin).toString());
        await expect(
          page
            .getByRole('region', { name: 'Assinatura e avaliação' })
            .getByText('Pagamento confirmado', { exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: 'Contratar assinatura' })).toHaveCount(0);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        stages.push(`paid_ui_${width}`);
      }
      const repeated = await page.evaluate(async () => {
        const response = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        return { status: response.status, body: await response.json() };
      });
      expect(repeated).toEqual({ status: 409, body: { error: 'already_paid' } });
      stages.push('paid_checkout_repeat_denied');
      await page.goto(new URL('/configuracoes/whatsapp', origin.origin).toString());
      await expect(
        page.getByText('WhatsApp disponível após o pagamento', { exact: true }),
      ).toHaveCount(0);
      stages.push('paid_whatsapp_gate_released');
      await page.goto(new URL('/configuracoes/pagamentos', origin.origin).toString());
      await expect(
        page.getByText('Asaas disponível após o pagamento', { exact: true }),
      ).toHaveCount(0);
      stages.push('paid_asaas_gate_released');
      await page.goto(new URL('/equipe', origin.origin).toString());
      await expect(page.getByRole('button', { name: /Convidar/ }).first()).toBeVisible();
      stages.push('real_sandbox_webhook_invoice_receipt_and_paid_ui');
      stages.push('paid_checkout_repeat_denied_and_integration_invite_gates_released');
      evidence.scope =
        'Real Sandbox simulation, authenticated webhook, invoice and readbacks; no real charge';
      expect(browserErrorClasses).toEqual([]);
      evidence.status = 'PASS';
      return;
    }
    expect(contract.released_at).toBeNull();
    if (!existing) {
      expect(contract.external_checkout_id).toBeNull();
      expect(contract.operations).toBe(0);
    }
    stages.push('database_origin_absolute_deadline_and_no_initial_provider_operation');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(new URL('/configuracoes/assinatura', origin.origin).toString());
      await expect(page.getByRole('region', { name: 'Assinatura e avaliação' })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    stages.push('desktop_mobile_subscription');
    if (input.E2E_ABACATEPAY_EXPIRED === 'false') {
      await expect(page.getByRole('button', { name: 'Contratar assinatura' })).toHaveCount(0);
      const denied = await page.evaluate(async () => {
        const response = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        return { status: response.status, body: await response.json() };
      });
      expect(denied).toEqual({ status: 409, body: { error: 'trial_active' } });
      await page.goto(new URL('/configuracoes/whatsapp', origin.origin).toString());
      await expect(
        page.getByText('WhatsApp disponível após o pagamento', { exact: true }),
      ).toBeVisible();
      await page.goto(new URL('/configuracoes/pagamentos', origin.origin).toString());
      await expect(
        page.getByText('Asaas disponível após o pagamento', { exact: true }),
      ).toBeVisible();
      stages.push('active_trial_checkout_and_integrations_blocked');
    } else {
      await expect(page.getByText('Contratação pendente', { exact: true })).toBeVisible();
      const adulterated = await page.evaluate(async () => {
        const response = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ amount: 1, doctors: 6 }),
        });
        return { status: response.status, body: await response.json() };
      });
      expect(adulterated).toEqual({ status: 400, body: { error: 'invalid_body' } });
      stages.push('browser_amount_and_quantity_rejected_before_checkout');
      await page.getByRole('button', { name: 'Contratar assinatura', exact: true }).click();
      await expect(page).toHaveURL(/^https:\/\/(?:app|pay)\.abacatepay\.com\//, {
        timeout: 90_000,
      });
      const [binding] = await sql<{ id: string; n: number }[]>`
        SELECT b.external_checkout_id id,
        (SELECT count(*)::int FROM billing_gateway.operations o WHERE o.subscription_id=b.subscription_id AND o.kind='create_checkout') n
        FROM billing_gateway.bindings b WHERE b.subscription_id=${contract.subscription_id}::uuid`;
      expect(binding?.id).toMatch(/^bill_/);
      expect(binding?.n).toBe(1);
      if (!binding?.id) throw new Error('Synthetic checkout binding missing');
      evidence.checkoutId = binding.id;
      const hostedUrl = page.url();
      await page.goto(new URL('/configuracoes/assinatura', origin.origin).toString());
      await page.reload();
      await expect(page.getByText('Contratação pendente', { exact: true })).toBeVisible();
      const resumed = await page.evaluate(async () => {
        const response = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        return { status: response.status, body: await response.json() };
      });
      expect(resumed).toMatchObject({
        status: 200,
        body: { state: 'checkout_pending', checkoutUrl: hostedUrl },
      });
      const [pending] = await sql`
        SELECT s.billing_status,t.released_at,
        (SELECT count(*)::int FROM public.invoices i WHERE i.subscription_id=s.id) invoices,
        (SELECT count(*)::int FROM billing_gateway.operations o WHERE o.subscription_id=s.id AND o.kind='create_checkout') operations
        FROM public.subscriptions s JOIN public.trial_access_policies t ON t.subscription_id=s.id
        WHERE s.id=${contract.subscription_id}::uuid`;
      expect(pending).toMatchObject({
        billing_status: 'trial',
        released_at: null,
        invoices: 0,
        operations: 1,
      });
      stages.push('abandoned_checkout_reload_and_retry_reuse_one_intent_without_activation');
      await page.goto(hostedUrl);
      stages.push('real_qoro_route_to_hosted_sandbox_checkout_single_journal');
    }
    expect(browserErrorClasses).toEqual([]);
    evidence.status = 'PASS';
  } finally {
    if (evidence.status === 'RUNNING') evidence.status = 'FAIL';
    await mkdir('dist', { recursive: true });
    await writeFile(
      `dist/abacatepay-preview-${input.E2E_ABACATEPAY_RUN_ID}${input.E2E_ABACATEPAY_EXPECT_PAID === 'true' ? '-paid' : ''}.json`,
      JSON.stringify(evidence, null, 2),
    );
    await sql.end({ timeout: 5 });
  }
});
