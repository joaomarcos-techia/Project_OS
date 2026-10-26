import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { z } from 'zod';

import { assertDevContext } from '../scripts/_env';
import { assertPreviewRuntimeIsDev, DEV_PROJECT_REF } from './preview-dev-runtime';
import { vercelBypassHeaders } from './vercel-bypass';

/**
 * Compra de uma vaga médica no Preview, com pagamento simulado pelo mecanismo
 * oficial do Asaas Sandbox. Cria somente Auth, clínica, customer, assinatura e
 * webhook identificados desta execução. Nunca aceita produção.
 */
const runId = randomUUID();
const label = runId.slice(0, 8);
const slug = `e2e-extra-doctor-${label}`;
const email = `${slug}@example.invalid`;
const password = `Qoro${runId.replaceAll('-', '')}Aa1!`;
const preview = new URL(process.env.E2E_BASE_URL ?? 'https://invalid.example');
const asaasBase = process.env.ASAAS_BASE_URL_DEV;
const asaasKey = process.env.ASAAS_API_KEY_DEV;
const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN_DEV;
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const webhookUrl = new URL('/api/webhooks/asaas', preview);
if (bypass) webhookUrl.searchParams.set('x-vercel-protection-bypass', bypass);

let db: ReturnType<typeof postgres> | null = null;
let userId: string | null = null;
let clinicId: string | null = null;
let customerId: string | null = null;
let subscriptionId: string | null = null;
let webhookId: string | null = null;
let paymentId: string | null = null;
let checkoutId: string | null = null;
let checkoutUrl: string | null = null;
let paidFlowValidated = false;
let currentPlanId = '';
let targetPlanId = '';

function sql(): ReturnType<typeof postgres> {
  if (!db) throw new Error('Conexão DEV indisponível');
  return db;
}

function requireTargets(): { supabaseUrl: string; secretKey: string } {
  if (process.env.E2E_EXTRA_DOCTOR_PAYMENT !== 'DEV_SANDBOX_ONLY') {
    throw new Error('Exige E2E_EXTRA_DOCTOR_PAYMENT=DEV_SANDBOX_ONLY');
  }
  if (
    preview.protocol !== 'https:' ||
    !preview.hostname.startsWith('project-os-git-') ||
    !preview.hostname.endsWith('-clinic-os-v2-s-projects.vercel.app') ||
    preview.pathname !== '/' ||
    preview.search ||
    preview.hash
  ) {
    throw new Error('E2E_BASE_URL precisa ser Preview HTTPS do Qoro sem path/query');
  }
  const databaseUrl = assertDevContext().databaseUrl;
  const databaseRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (
    !supabaseUrl ||
    !secretKey ||
    databaseRef !== DEV_PROJECT_REF ||
    new URL(supabaseUrl).hostname.split('.')[0] !== DEV_PROJECT_REF
  ) {
    throw new Error('Database e Auth precisam apontar ao mesmo projeto DEV fixado');
  }
  if (!asaasBase || !asaasKey || !webhookToken || !bypass) {
    throw new Error('Asaas Sandbox, token de webhook ou bypass ausente');
  }
  const provider = new URL(asaasBase);
  if (
    provider.protocol !== 'https:' ||
    !(
      (provider.hostname === 'api-sandbox.asaas.com' && provider.pathname === '/v3') ||
      (provider.hostname === 'sandbox.asaas.com' && provider.pathname === '/api/v3')
    )
  ) {
    throw new Error('ASAAS_BASE_URL_DEV não aponta para o Sandbox oficial');
  }
  return { supabaseUrl, secretKey };
}

async function asaas(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`${asaasBase!.replace(/\/$/, '')}/${path}`, {
    method,
    headers: {
      access_token: asaasKey!,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

function bodyId(value: unknown): string {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') {
    throw new Error('Recurso de teste sem ID na resposta do provider');
  }
  return value.id;
}

async function asaasOk(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<unknown> {
  const result = await asaas(path, method, body);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Asaas Sandbox ${method} ${path.split('/')[0]} HTTP ${result.status}`);
  }
  return result.data;
}

async function authAdmin(path: string, method: 'POST' | 'DELETE' | 'GET', body?: unknown) {
  const { supabaseUrl, secretKey } = requireTargets();
  return fetch(`${supabaseUrl}/auth/v1/admin${path}`, {
    method,
    headers: {
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
}

async function state() {
  if (!clinicId) throw new Error('Clínica fixture ausente');
  const [row] = await sql()<
    {
      code: string;
      amount: string;
      doctors: number;
      change_status: string | null;
      change_id: string | null;
      change_count: number;
      payment_id: string | null;
      checkout_id: string | null;
      checkout_state: string | null;
      checkout_url: string | null;
      proration: string | null;
      invoice_count: number;
      invoice_status: string | null;
      paid_invoice_count: number;
      history_count: number;
      real_event_count: number;
      deleted_event_count: number;
      restored_event_count: number;
    }[]
  >`
    select p.code, pr.amount::text, seats.doctors,
           ch.status::text change_status, ch.id::text change_id,
           ch.provider_payment_id payment_id,
           ch.provider_checkout_id checkout_id,
           ch.checkout_creation_state checkout_state,
           ch.provider_payment_url checkout_url,
           ch.proration_amount::text proration,
           (select count(*)::int from subscription_change_requests where clinic_id = ${clinicId}::uuid) change_count,
           (select count(*)::int from invoices where clinic_id = ${clinicId}::uuid and asaas_payment_id = ${paymentId}) invoice_count,
           (select status::text from invoices where clinic_id = ${clinicId}::uuid and asaas_payment_id = ${paymentId} limit 1) invoice_status,
           (select count(*)::int from invoices where clinic_id = ${clinicId}::uuid and asaas_payment_id = ${paymentId} and status = 'paid') paid_invoice_count,
           (select count(*)::int from subscription_history where clinic_id = ${clinicId}::uuid and reason = 'upgrade_payment_confirmed') history_count,
           (select count(*)::int from processed_webhooks where clinic_id = ${clinicId}::uuid and event_type in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED')) real_event_count,
           (select count(*)::int from processed_webhooks where clinic_id = ${clinicId}::uuid and event_type = 'PAYMENT_DELETED') deleted_event_count,
           (select count(*)::int from processed_webhooks where clinic_id = ${clinicId}::uuid and event_type = 'PAYMENT_RESTORED') restored_event_count
      from subscriptions s
      join plans p on p.id = s.plan_id
      join prices pr on pr.id = s.price_id
      join plan_seat_limits seats on seats.plan_id = s.plan_id
      left join lateral (
        select id, status, provider_payment_id, provider_checkout_id,
               checkout_creation_state, provider_payment_url, proration_amount
          from subscription_change_requests where subscription_id = s.id
         order by created_at desc limit 1
      ) ch on true
     where s.clinic_id = ${clinicId}::uuid
  `;
  if (!row) throw new Error('Assinatura fixture ausente');
  return row;
}

async function cleanup(): Promise<void> {
  const problems: string[] = [];
  if (checkoutId && !paymentId) {
    const removed = await asaas(`checkouts/${encodeURIComponent(checkoutId)}`, 'DELETE').catch(
      () => ({ status: 0 }),
    );
    if (removed.status !== 200 && removed.status !== 404) problems.push('Checkout Sandbox');
  }
  if (webhookId) {
    const removed = await asaas(`webhooks/${encodeURIComponent(webhookId)}`, 'DELETE').catch(
      () => ({ status: 0 }),
    );
    const after = await asaas(`webhooks/${encodeURIComponent(webhookId)}`, 'GET').catch(() => ({
      status: 0,
    }));
    if (removed.status !== 200 || after.status !== 404) problems.push('webhook Sandbox');
  }
  if (subscriptionId) {
    const removed = await asaas(
      `subscriptions/${encodeURIComponent(subscriptionId)}`,
      'DELETE',
    ).catch(() => ({ status: 0 }));
    const after = await asaas(`subscriptions/${encodeURIComponent(subscriptionId)}`, 'GET').catch(
      () => ({ status: 0, data: null }),
    );
    const deleted =
      after.status === 404 ||
      (after.data !== null &&
        typeof after.data === 'object' &&
        'deleted' in after.data &&
        after.data.deleted === true);
    if (removed.status !== 200 || !deleted) problems.push('assinatura Sandbox');
  }
  if (customerId) {
    const removed = await asaas(`customers/${encodeURIComponent(customerId)}`, 'DELETE').catch(
      () => ({ status: 0 }),
    );
    const after = await asaas(`customers/${encodeURIComponent(customerId)}`, 'GET').catch(() => ({
      status: 0,
      data: null,
    }));
    const deleted =
      after.status === 404 ||
      (after.data !== null &&
        typeof after.data === 'object' &&
        'deleted' in after.data &&
        after.data.deleted === true);
    if (removed.status !== 200 || !deleted) problems.push('customer Sandbox');
  }
  if (db && clinicId) {
    const [guard] = await sql()<
      {
        slug: string;
        users: number;
        subscriptions: number;
        foreign_users: number;
        foreign_subscriptions: number;
        patients: number;
      }[]
    >`
      select slug,
             (select count(*)::int from profiles where clinic_id = c.id) users,
             (select count(*)::int from subscriptions where clinic_id = c.id) subscriptions,
             (select count(*)::int from profiles where clinic_id = c.id and id <> ${userId}::uuid) foreign_users,
             (select count(*)::int from subscriptions where clinic_id = c.id and asaas_subscription_id is distinct from ${subscriptionId}) foreign_subscriptions,
             (select count(*)::int from patients where clinic_id = c.id) patients
        from clinics c where id = ${clinicId}::uuid
    `;
    if (
      guard?.slug !== slug ||
      guard.users > 1 ||
      guard.subscriptions > 1 ||
      guard.foreign_users !== 0 ||
      guard.foreign_subscriptions !== 0 ||
      guard.patients !== 0
    ) {
      problems.push('guarda da clínica DEV');
    } else {
      await sql().begin(async (tx) => {
        await tx`delete from processed_webhooks where clinic_id = ${clinicId}::uuid`;
        await tx`delete from outbox where clinic_id = ${clinicId}::uuid`;
        await tx`delete from audit_events where clinic_id = ${clinicId}::uuid`;
        await tx`delete from clinics where id = ${clinicId}::uuid and slug = ${slug}`;
      });
      const [left] = await sql()<{ n: number }[]>`
        select count(*)::int n from clinics where id = ${clinicId}::uuid
      `;
      if (left?.n !== 0) problems.push('resíduo DEV');
    }
  }
  if (userId) {
    const removed = await authAdmin(`/users/${encodeURIComponent(userId)}`, 'DELETE').catch(
      () => null,
    );
    const after = await authAdmin(`/users/${encodeURIComponent(userId)}`, 'GET').catch(() => null);
    if (!removed || (!removed.ok && removed.status !== 404) || after?.status !== 404) {
      problems.push('usuário Auth DEV');
    }
  }
  if (db) {
    await db.end({ timeout: 5 });
    db = null;
  }
  const cleanupResult =
    problems.length > 0
      ? 'INCOMPLETO'
      : paymentId
        ? 'recursos ativos removidos; cobrança paga preservada no Sandbox para auditoria'
        : '0 resíduos';
  console.log(`Cleanup fixture extra-doctor: ${cleanupResult}`);
  if (problems.length > 0) throw new Error(`Cleanup incompleto: ${problems.join(', ')}`);
}

test.describe('médico extra pago no Preview/DEV/Asaas Sandbox', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(300_000);

  test.beforeAll(async () => {
    const { databaseUrl } = assertDevContext();
    requireTargets();
    await assertPreviewRuntimeIsDev(preview.origin, { requireSandboxAsaas: true });
    const preflight = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'asaas-access-token': webhookToken!, 'content-type': 'application/json' },
      body: '{not-json',
      signal: AbortSignal.timeout(30_000),
    });
    expect(preflight.status).toBe(400);

    db = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
    const catalog = await sql()<
      {
        code: string;
        plan_id: string;
        price_id: string;
        amount: string;
        doctors: number;
        staff: number;
      }[]
    >`
      select p.code, p.id::text plan_id, pr.id::text price_id, pr.amount::text amount,
             seats.doctors, seats.staff
        from plans p join prices pr on pr.plan_id = p.id
        join plan_seat_limits seats on seats.plan_id = p.id
       where p.code in ('clinica_2026_2', 'clinica_2026_3') and p.ativo = true
         and pr.billing_cycle = 'monthly' and pr.active_until is null and pr.campaign_code is null
       order by p.code
    `;
    if (
      catalog.length !== 2 ||
      catalog[0]?.code !== 'clinica_2026_2' ||
      catalog[0].amount !== '397.00' ||
      catalog[0].doctors !== 2 ||
      catalog[0].staff !== 3 ||
      catalog[1]?.code !== 'clinica_2026_3' ||
      catalog[1].amount !== '544.00' ||
      catalog[1].doctors !== 3 ||
      catalog[1].staff !== 3
    ) {
      throw new Error('Catálogo DEV não corresponde ao contrato 397→544');
    }
    currentPlanId = catalog[0].plan_id;
    targetPlanId = catalog[1].plan_id;

    const createdUser = await authAdmin('/users', 'POST', {
      email,
      password,
      email_confirm: true,
    });
    if (!createdUser.ok) throw new Error(`Auth DEV recusou fixture HTTP ${createdUser.status}`);
    userId = bodyId(await createdUser.json());

    customerId = bodyId(
      await asaasOk('customers', 'POST', {
        name: `Qoro E2E médico extra ${label}`,
        email,
        cpfCnpj: '24971563792',
      }),
    );
    const dueDate = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    subscriptionId = bodyId(
      await asaasOk('subscriptions', 'POST', {
        customer: customerId,
        billingType: 'PIX',
        value: 397,
        cycle: 'MONTHLY',
        nextDueDate: dueDate,
        externalReference: `qoro-e2e-extra-doctor:${runId}`,
        description: 'Qoro E2E médico extra',
      }),
    );

    const [clinic] = await sql()<
      {
        id: string;
      }[]
    >`
      insert into clinics (slug, nome, status)
      values (${slug}, ${`Qoro E2E médico extra ${label}`}, 'active')
      returning id::text
    `;
    clinicId = clinic?.id ?? null;
    if (!clinicId) throw new Error('Clínica fixture não foi criada');
    await sql().begin(async (tx) => {
      await tx`
        insert into billing_customers (clinic_id, name, email, asaas_customer_id)
        values (${clinicId}::uuid, ${`Qoro E2E médico extra ${label}`}, ${email}, ${customerId})
      `;
      await tx`
        insert into subscriptions (clinic_id, plan_id, price_id, billing_status,
          started_at, current_period_start, current_period_end, asaas_subscription_id)
        values (${clinicId}::uuid, ${currentPlanId}::uuid, ${catalog[0]!.price_id}::uuid,
          'active', now() - interval '10 days', now() - interval '10 days',
          ${dueDate}::date, ${subscriptionId})
      `;
      await tx`
        insert into profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
        values (${userId}::uuid, ${clinicId}::uuid, 'Dono E2E médico extra', 'owner', true, now())
      `;
    });

    const account = await asaasOk('myAccount', 'GET');
    if (
      !account ||
      typeof account !== 'object' ||
      !('email' in account) ||
      typeof account.email !== 'string'
    ) {
      throw new Error('Conta Sandbox sem e-mail de webhook');
    }
    webhookId = bodyId(
      await asaasOk('webhooks', 'POST', {
        name: `Qoro E2E médico extra ${label}`,
        url: webhookUrl.toString(),
        email: account.email,
        enabled: true,
        interrupted: false,
        apiVersion: 3,
        authToken: webhookToken,
        sendType: 'NON_SEQUENTIALLY',
        events: [
          'PAYMENT_CREATED',
          'PAYMENT_CONFIRMED',
          'PAYMENT_RECEIVED',
          'PAYMENT_DELETED',
          'PAYMENT_RESTORED',
        ],
      }),
    );
    const webhook = await asaasOk(`webhooks/${encodeURIComponent(webhookId)}`, 'GET');
    if (
      !webhook ||
      typeof webhook !== 'object' ||
      !('enabled' in webhook) ||
      webhook.enabled !== true ||
      !('url' in webhook) ||
      webhook.url !== webhookUrl.toString()
    ) {
      throw new Error('Webhook temporário não foi confirmado por readback');
    }
    console.log('PASS preflight: Preview=DEV, catálogo e fixture Sandbox identificados');
  });

  test.afterAll(async () => {
    if (
      process.env.E2E_EXTRA_DOCTOR_PAYMENT_INTERACTIVE === '1' &&
      checkoutId &&
      !paidFlowValidated
    ) {
      console.log(
        `Fixture preservada para conciliação de pagamento tardio: slug=${slug} clinic=${clinicId ?? 'absent'} checkout=${checkoutId} subscription=${subscriptionId ?? 'absent'} webhook=${webhookId ?? 'absent'} auth=${userId ?? 'absent'}`,
      );
      if (db) {
        await db.end({ timeout: 5 });
        db = null;
      }
      return;
    }
    await cleanup();
  });

  test('UI → Checkout único → cota preservada antes do pagamento', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: preview.origin,
      extraHTTPHeaders: vercelBypassHeaders(),
    });
    try {
      const page = await context.newPage();
      await page.goto('/login');
      await page.locator('#email').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole('button', { name: 'Entrar' }).click();
      await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 90_000 });
      const response = await page.goto('/configuracoes/assinatura');
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { name: 'Assinatura', exact: true })).toBeVisible();
      const before = await state();
      expect(before).toMatchObject({
        code: 'clinica_2026_2',
        amount: '397.00',
        doctors: 2,
        change_count: 0,
      });
      const target = page
        .locator('main [data-slot="card"]')
        .filter({ has: page.locator(`input[name="targetPlanId"][value="${targetPlanId}"]`) });
      await expect(target).toHaveCount(1);
      await target.getByRole('button', { name: 'Contratar +1 médico' }).click();
      const paymentLink = page.getByRole('link', { name: 'Abrir pagamento proporcional no Asaas' });
      await expect(paymentLink).toBeVisible({ timeout: 60_000 });
      await expect
        .poll(async () => (await state()).checkout_id, { timeout: 60_000 })
        .not.toBeNull();
      const reserved = await state();
      if (!reserved.checkout_id || !reserved.checkout_url || !reserved.proration)
        throw new Error('Rateio sem Checkout vinculado');
      checkoutId = reserved.checkout_id;
      checkoutUrl = reserved.checkout_url;
      expect(new URL(checkoutUrl).hostname).toBe('sandbox.asaas.com');
      expect(await paymentLink.getAttribute('href')).toBe(checkoutUrl);
      expect(reserved).toMatchObject({
        code: 'clinica_2026_2',
        change_status: 'pending_payment',
        change_count: 1,
        checkout_state: 'ready',
        payment_id: null,
        invoice_count: 0,
        paid_invoice_count: 0,
        history_count: 0,
      });
      await page.reload();
      await expect(page.getByRole('link', { name: 'Abrir pagamento no Asaas' })).toHaveAttribute(
        'href',
        checkoutUrl,
      );
      expect((await state()).checkout_id).toBe(checkoutId);
      console.log('PASS UI/DEV/Sandbox: Checkout único; médico adicional ainda bloqueado');
      if (process.env.E2E_EXTRA_DOCTOR_PAYMENT_INTERACTIVE === '1') {
        console.log(`CHECKOUT_SANDBOX_URL=${checkoutUrl}`);
        console.log(`CHECKOUT_TEST_PAYER_EMAIL=${email}`);
        console.log(`CHECKOUT_PRORATION_BRL=${reserved.proration}`);
      }
    } finally {
      await context.close();
    }
  });

  test('pagamento humano no Checkout → webhook → assinatura e cota', async ({ browser }) => {
    test.skip(
      process.env.E2E_EXTRA_DOCTOR_PAYMENT_RETENTION_PROBE === '1',
      'Probe isolado da retenção e recuperação da fixture, sem pagamento.',
    );
    test.skip(
      process.env.E2E_EXTRA_DOCTOR_PAYMENT_INTERACTIVE !== '1',
      'Checkout hospedado exige conclusão humana do reCAPTCHA no Asaas Sandbox.',
    );
    test.setTimeout(3_300_000);
    if (!checkoutId || !checkoutUrl) throw new Error('Checkout da fixture não preparado');
    const context = await browser.newContext({
      baseURL: preview.origin,
      extraHTTPHeaders: vercelBypassHeaders(),
    });
    try {
      const page = await context.newPage();
      await page.goto(checkoutUrl);
      console.log('AÇÃO HUMANA: conclua o Checkout com cartão de teste no Asaas Sandbox.');
      await expect
        .poll(
          async () => {
            const result = z
              .object({ data: z.array(z.object({ id: z.string() })) })
              .parse(
                await asaasOk(`payments?checkoutSession=${encodeURIComponent(checkoutId!)}`, 'GET'),
              );
            const id = result.data[0]?.id;
            if (!id) return null;
            const payment = await asaasOk(`payments/${encodeURIComponent(id)}`, 'GET');
            return payment &&
              typeof payment === 'object' &&
              'status' in payment &&
              ['RECEIVED', 'CONFIRMED'].includes(String(payment.status))
              ? id
              : null;
          },
          { timeout: 3_000_000, intervals: [3_000] },
        )
        .not.toBeNull();
      const result = z
        .object({ data: z.array(z.object({ id: z.string() })) })
        .parse(await asaasOk(`payments?checkoutSession=${encodeURIComponent(checkoutId)}`, 'GET'));
      paymentId = result.data[0]?.id ?? null;
      if (!paymentId) throw new Error('Checkout concluído sem cobrança correlacionada');
      const paid = await asaasOk(`payments/${encodeURIComponent(paymentId)}`, 'GET');
      if (
        !paid ||
        typeof paid !== 'object' ||
        !('status' in paid) ||
        !['RECEIVED', 'CONFIRMED'].includes(String(paid.status)) ||
        !('checkoutSession' in paid) ||
        paid.checkoutSession !== checkoutId
      ) {
        throw new Error('Asaas não confirmou o pagamento correlacionado ao Checkout');
      }
      if (!('value' in paid) || Number(paid.value) !== Number((await state()).proration)) {
        throw new Error('Valor recebido não corresponde ao rateio contratado');
      }
      await expect
        .poll(async () => (await state()).change_status, { timeout: 120_000, intervals: [2_000] })
        .toBe('applied');
      const applied = await state();
      expect(applied).toMatchObject({
        code: 'clinica_2026_3',
        amount: '544.00',
        doctors: 3,
        change_count: 1,
        invoice_count: 1,
        paid_invoice_count: 1,
        history_count: 1,
      });
      expect(applied.real_event_count).toBeGreaterThan(0);
      if (!subscriptionId) throw new Error('Assinatura Sandbox da fixture ausente');
      const subscription = await asaasOk(
        `subscriptions/${encodeURIComponent(subscriptionId)}`,
        'GET',
      );
      if (!subscription || typeof subscription !== 'object' || !('value' in subscription)) {
        throw new Error('Recorrência Asaas não encontrada');
      }
      expect(Number(subscription.value)).toBe(544);
      const pendingPayments = z
        .object({ data: z.array(z.object({ value: z.number(), dueDate: z.string() })) })
        .parse(
          await asaasOk(`subscriptions/${encodeURIComponent(subscriptionId)}/payments`, 'GET'),
        );
      expect(pendingPayments.data.length).toBeGreaterThan(0);
      expect(pendingPayments.data.every((payment) => payment.value === 544)).toBe(true);
      await page.goto('/login');
      await page.locator('#email').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole('button', { name: 'Entrar' }).click();
      await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 90_000 });
      await page.goto('/configuracoes/assinatura');
      await expect(page.getByText('R$ 544,00 por mês', { exact: true })).toBeVisible();
      console.log('PASS pagamento: webhook, plano de 3 médicos, parcela e UI convergiram');

      const replay = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'asaas-access-token': webhookToken!, 'content-type': 'application/json' },
        body: JSON.stringify({
          id: `evt_qoro_e2e_extra_${runId}`,
          event: 'PAYMENT_RECEIVED',
          payment: { id: paymentId },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      expect(replay.status).toBe(200);
      const stable = await state();
      expect(stable).toMatchObject({
        code: 'clinica_2026_3',
        change_count: 1,
        invoice_count: 1,
        paid_invoice_count: 1,
        history_count: 1,
      });
      console.log('PASS replay: sem cobrança, alteração ou histórico duplicado');

      const previousPlan = page
        .locator('main [data-slot="card"]')
        .filter({ has: page.locator(`input[name="targetPlanId"][value="${currentPlanId}"]`) });
      await expect(previousPlan).toHaveCount(1);
      await previousPlan.getByRole('button', { name: 'Agendar downgrade' }).click();
      await expect
        .poll(async () => (await state()).change_status, { timeout: 30_000 })
        .toBe('scheduled');
      expect(await state()).toMatchObject({
        code: 'clinica_2026_3',
        amount: '544.00',
        doctors: 3,
        change_count: 2,
        paid_invoice_count: 1,
        history_count: 1,
      });
      const beforeDue = await asaasOk(`subscriptions/${encodeURIComponent(subscriptionId)}`, 'GET');
      if (!beforeDue || typeof beforeDue !== 'object' || !('value' in beforeDue)) {
        throw new Error('Recorrência Sandbox indisponível após o agendamento');
      }
      expect(Number(beforeDue.value)).toBe(544);
      console.log('PASS downgrade agendado: cota e recorrência preservadas antes do vencimento');

      const scheduled = await state();
      if (!clinicId || !userId || !subscriptionId || !scheduled.change_id) {
        throw new Error('Fixture de downgrade sem identificadores completos');
      }
      const appliedAtDue = spawnSync(
        process.execPath,
        ['--conditions=react-server', '--import=tsx', 'scripts/test-scheduled-doctor-downgrade.ts'],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            E2E_DOWNGRADE_CLINIC_ID: clinicId,
            E2E_DOWNGRADE_USER_ID: userId,
            E2E_DOWNGRADE_CHANGE_ID: scheduled.change_id,
            E2E_DOWNGRADE_SUBSCRIPTION_ID: subscriptionId,
            E2E_DOWNGRADE_SLUG: slug,
          },
          encoding: 'utf8',
          timeout: 120_000,
        },
      );
      if (
        appliedAtDue.error ||
        appliedAtDue.status !== 0 ||
        !appliedAtDue.stdout.includes('PASS downgrade da fixture no vencimento simulado')
      ) {
        const diagnostic =
          appliedAtDue.stderr.match(
            /\[e2e-downgrade\] FAIL stage=[a-z_]+ name=[A-Za-z0-9_]+ code=[A-Za-z0-9_]+ http=\d{1,3}/u,
          )?.[0] ?? 'child_bootstrap';
        throw new Error(
          `Aplicação isolada do downgrade falhou (exit ${appliedAtDue.status}; ${diagnostic})`,
        );
      }
      expect(await state()).toMatchObject({
        code: 'clinica_2026_2',
        amount: '397.00',
        doctors: 2,
        change_status: 'applied',
        change_count: 2,
        paid_invoice_count: 1,
      });
      const afterDue = await asaasOk(`subscriptions/${encodeURIComponent(subscriptionId)}`, 'GET');
      if (!afterDue || typeof afterDue !== 'object' || !('value' in afterDue)) {
        throw new Error('Recorrência Sandbox indisponível após o downgrade');
      }
      expect(Number(afterDue.value)).toBe(397);
      await page.goto('/auth/session-refresh?next=%2Fconfiguracoes%2Fassinatura');
      await expect(page).toHaveURL(/\/configuracoes\/assinatura(?:\?|$)/u, { timeout: 60_000 });
      await expect(page.getByText('R$ 397,00 por mês', { exact: true })).toBeVisible();
      console.log('PASS vencimento simulado: Asaas, plano, cota e UI convergiram para 2 médicos');
      paidFlowValidated = true;
    } finally {
      await context.close();
    }
  });
});
