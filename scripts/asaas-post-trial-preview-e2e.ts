/**
 * Mensalidade SaaS pós-trial: Asaas Sandbox → webhook REAL → Preview → DEV.
 * Requer fixture isolada e opt-in explícito. Nunca aceita banco ou Asaas PROD.
 *
 * QORO_ENV_FILE=<arquivo local> APP_BASE_URL=<Preview HTTPS> \
 * SAAS_POST_TRIAL_E2E=ALLOW_DEV_SANDBOX \
 * SAAS_POST_TRIAL_OFFER=2026 (opcional; default legacy) \
 * npx tsx --conditions=react-server scripts/asaas-post-trial-preview-e2e.ts
 */
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { assertPreviewRuntimeIsDev } from '../e2e/preview-dev-runtime';

config({ path: process.env.QORO_ENV_FILE ?? '.env.local' });

const databaseUrl = process.env.DATABASE_URL_DEV;
const apiKey = process.env.ASAAS_API_KEY_DEV;
const baseUrl = process.env.ASAAS_BASE_URL_DEV;
const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN_DEV;
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const offerMode = process.env.SAAS_POST_TRIAL_OFFER ?? 'legacy';
if (offerMode !== 'legacy' && offerMode !== '2026') {
  throw new Error('SAAS_POST_TRIAL_OFFER deve ser legacy ou 2026');
}
const offer2026 = offerMode === '2026';
const expectedPlanCode = offer2026 ? 'consultorio_2026' : 'solo';
const expectedAmount = offer2026 ? 197 : 149;
const trialDays = offer2026 ? 14 : 7;
const preview = new URL(process.env.APP_BASE_URL ?? 'https://invalid.example');
if (process.env.SAAS_POST_TRIAL_E2E !== 'ALLOW_DEV_SANDBOX') {
  throw new Error('SAAS_POST_TRIAL_E2E=ALLOW_DEV_SANDBOX é obrigatório');
}
if (
  !databaseUrl?.includes('pqhkirrszzpwezdaqrai') ||
  !apiKey ||
  !baseUrl ||
  !webhookToken ||
  !bypass
) {
  throw new Error('Precondições de DEV/Sandbox ausentes');
}
if (process.env.SUPABASE_PROJECT_ENV === 'prod') throw new Error('Contexto PROD recusado');
if (
  preview.protocol !== 'https:' ||
  !preview.hostname.startsWith('project-os-git-') ||
  !preview.hostname.endsWith('-clinic-os-v2-s-projects.vercel.app') ||
  preview.pathname !== '/' ||
  preview.search ||
  preview.hash
) {
  throw new Error('APP_BASE_URL precisa ser o Preview da branch, sem path/query');
}
const api = new URL(baseUrl);
if (
  !(
    (api.hostname === 'api-sandbox.asaas.com' && api.pathname === '/v3') ||
    (api.hostname === 'sandbox.asaas.com' && api.pathname === '/api/v3')
  )
) {
  throw new Error('Asaas não é Sandbox oficial');
}
const webhookUrl = new URL('/api/webhooks/asaas', preview);
webhookUrl.searchParams.set('x-vercel-protection-bypass', bypass);

process.env.DATABASE_URL = databaseUrl;
process.env.DATABASE_URL_RUNTIME = databaseUrl;
process.env.SUPABASE_PROJECT_ENV = 'dev';
const { dbAdmin } = await import('@/lib/db');
const tag = randomUUID();
const clinicSlug = `e2e-saas-${tag.slice(0, 16)}`;
const customerSchema = z.object({ id: z.string().min(1) });
const paymentSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  value: z.number(),
  subscription: z.string().nullable().optional(),
});
const webhookSchema = z.object({ id: z.string().min(1) });
let customerId: string | null = null;
let subscriptionId: string | null = null;
let clinicId: string | null = null;
let webhookId: string | null = null;
let paymentId: string | null = null;
const cleanup: string[] = [];

async function callApi(
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
): Promise<{ status: number; value: unknown }> {
  const url = new URL(`${baseUrl!.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
  const response = await fetch(url, {
    method,
    headers: {
      access_token: apiKey!,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, value: await response.json().catch(() => null) };
}

async function apiOk(
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
): Promise<unknown> {
  const result = await callApi(path, method, body);
  if (result.status < 200 || result.status >= 300)
    throw new Error(`Asaas ${method} ${path.split('/')[0]} HTTP ${result.status}`);
  return result.value;
}

async function postWebhook(event: string, eventId: string): Promise<number> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'asaas-access-token': webhookToken! },
    body: JSON.stringify({ id: eventId, event, payment: { id: paymentId } }),
    signal: AbortSignal.timeout(30_000),
  });
  return response.status;
}

async function state() {
  if (!clinicId || !paymentId) throw new Error('Fixture incompleta');
  const rows = await dbAdmin.execute<{
    clinic_status: string;
    billing_status: string;
    trial_ends_at: Date;
    current_period_start: Date;
    current_period_end: Date;
    enforce_trial_deadline: boolean;
    invoice_status: string | null;
    amount: string | null;
    period_start: Date | null;
    period_end: Date | null;
    invoice_count: number;
    real_event_count: number;
  }>(sql`
    SELECT c.status::text AS clinic_status, s.billing_status::text AS billing_status,
           s.trial_ends_at, s.current_period_start, s.current_period_end,
           s.enforce_trial_deadline, i.status::text AS invoice_status,
           i.total_amount::text AS amount, i.period_start, i.period_end,
           (SELECT count(*)::int FROM invoices WHERE clinic_id = ${clinicId}::uuid AND asaas_payment_id = ${paymentId}) AS invoice_count,
           (SELECT count(*)::int FROM processed_webhooks WHERE clinic_id = ${clinicId}::uuid AND event_type IN ('PAYMENT_RECEIVED','PAYMENT_CONFIRMED')) AS real_event_count
      FROM clinics c
      JOIN subscriptions s ON s.clinic_id = c.id
      LEFT JOIN invoices i ON i.clinic_id = c.id AND i.asaas_payment_id = ${paymentId}
      WHERE c.id = ${clinicId}::uuid
  `);
  return rows[0];
}

async function run() {
  await assertPreviewRuntimeIsDev(preview.origin, { requireSandboxAsaas: true });
  const preflight = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'asaas-access-token': webhookToken!, 'content-type': 'application/json' },
    body: '{not-json',
    signal: AbortSignal.timeout(20_000),
  });
  if (preflight.status !== 400)
    throw new Error(`Preview webhook token/preflight HTTP ${preflight.status}`);
  console.log('PASS Preview webhook: token aceito, corpo inválido recusado com 400');

  const myAccount = await apiOk('myAccount', 'GET');
  const accountEmail = z.object({ email: z.string().email() }).parse(myAccount).email;
  const catalog = await dbAdmin.execute<{ plan_id: string; price_id: string; amount: string }>(sql`
    SELECT p.id::text AS plan_id, pr.id::text AS price_id, pr.amount::text AS amount
      FROM plans p JOIN prices pr ON pr.plan_id = p.id
     WHERE p.code = ${expectedPlanCode} AND p.ativo = true
       AND pr.billing_cycle = 'monthly' AND pr.active_until IS NULL
       AND pr.campaign_code IS NULL
     ORDER BY pr.active_from DESC LIMIT 1
  `);
  if (catalog.length !== 1 || Number(catalog[0]!.amount) !== expectedAmount)
    throw new Error('Catálogo DEV da oferta selecionada inesperado');

  customerId = customerSchema.parse(
    await apiOk('customers', 'POST', {
      name: `Qoro E2E SaaS ${tag.slice(0, 8)}`,
      cpfCnpj: '24971563792',
    }),
  ).id;
  const dueDate = new Date().toISOString().slice(0, 10);
  subscriptionId = customerSchema.parse(
    await apiOk('subscriptions', 'POST', {
      customer: customerId,
      billingType: 'PIX',
      value: expectedAmount,
      cycle: 'MONTHLY',
      nextDueDate: dueDate,
      externalReference: `qoro-e2e-saas:${tag}`,
      description: `Qoro E2E mensalidade pós-trial ${offerMode}`,
    }),
  ).id;

  const listed = z
    .object({ data: z.array(paymentSchema) })
    .parse(await apiOk(`subscriptions/${encodeURIComponent(subscriptionId)}/payments`, 'GET'));
  const pending = listed.data.find(
    (payment) => payment.status === 'PENDING' && payment.subscription === subscriptionId,
  );
  if (!pending) throw new Error('Assinatura Sandbox não gerou cobrança PENDING correlacionada');
  paymentId = pending.id;
  console.log(
    'PASS Asaas Sandbox: customer, assinatura mensal PIX e cobrança PENDING correlacionados',
  );

  const trialEndedAt = new Date(Date.now() - 86_400_000).toISOString();
  clinicId = await dbAdmin.transaction(async (tx) => {
    const [clinic] = await tx.execute<{ id: string }>(sql`
      INSERT INTO clinics (slug, nome, status)
      VALUES (${clinicSlug}, 'Qoro E2E SaaS pós-trial',
              ${offer2026 ? 'active' : 'pending_payment'}::clinic_status)
      RETURNING id::text AS id
    `);
    const id = clinic?.id;
    if (typeof id !== 'string') throw new Error('Clínica fixture sem ID');
    await tx.execute(sql`
      INSERT INTO billing_customers (clinic_id, name, email, asaas_customer_id)
      VALUES (${id}::uuid, 'Qoro E2E SaaS', ${`e2e-${tag}@example.invalid`}, ${customerId})
    `);
    await tx.execute(sql`
      INSERT INTO subscriptions (clinic_id, plan_id, price_id, billing_status,
          trial_ends_at, current_period_start, current_period_end, asaas_subscription_id,
          enforce_trial_deadline)
      VALUES (${id}::uuid, ${catalog[0]!.plan_id}::uuid, ${catalog[0]!.price_id}::uuid,
          'trial'::subscription_billing_status, ${trialEndedAt}::timestamptz,
          (${trialEndedAt}::timestamptz - ${trialDays} * interval '1 day'),
          ${trialEndedAt}::timestamptz, ${subscriptionId}, ${offer2026})
    `);
    return id;
  });
  const before = await state();
  if (before?.billing_status !== 'trial' || before.invoice_status !== null)
    throw new Error('Estado inicial local inesperado');
  if (offer2026) {
    const { assertClinicCanWriteTx, ClinicAccessError } = await import('@/lib/tenant-access');
    const trialLength =
      (new Date(before.trial_ends_at).getTime() - new Date(before.current_period_start).getTime()) /
      86_400_000;
    if (
      trialLength !== trialDays ||
      !before.enforce_trial_deadline ||
      new Date(before.trial_ends_at).getTime() >= Date.now()
    ) {
      throw new Error('Fixture não reproduziu o prazo absoluto de 14 dias');
    }
    let blocked = false;
    await dbAdmin.transaction(async (tx) => {
      try {
        await assertClinicCanWriteTx(tx, clinicId!);
      } catch (error) {
        if (!(error instanceof ClinicAccessError) || error.status !== 'pending_payment')
          throw error;
        blocked = true;
      }
    });
    if (!blocked || before.clinic_status !== 'active') {
      throw new Error('Trial 2026 expirado não bloqueou escrita antes do pagamento');
    }
    console.log('PASS DEV: trial 2026 de 14 dias expirado bloqueia escrita sem pagamento');
  }
  console.log('PASS DEV: fixture isolada em trial encerrado, sem invoice, sem profile/paciente');

  const created = webhookSchema.parse(
    await apiOk('webhooks', 'POST', {
      name: `Qoro E2E SaaS ${tag.slice(0, 8)}`,
      url: webhookUrl.toString(),
      email: accountEmail,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: webhookToken,
      sendType: 'NON_SEQUENTIALLY',
      events: ['PAYMENT_CREATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'],
    }),
  );
  webhookId = created.id;
  const webhook = await apiOk(`webhooks/${encodeURIComponent(webhookId)}`, 'GET');
  const checked = z
    .object({
      enabled: z.boolean(),
      interrupted: z.boolean(),
      hasAuthToken: z.boolean(),
      url: z.string(),
    })
    .parse(webhook);
  if (
    !checked.enabled ||
    checked.interrupted ||
    !checked.hasAuthToken ||
    checked.url !== webhookUrl.toString()
  )
    throw new Error('Readback do webhook temporário divergiu');
  console.log(
    'PASS Asaas Sandbox: webhook temporário habilitado, token e URL do Preview conferidos',
  );

  const bootstrapEvent = `evt_qoro_e2e_${tag}`;
  const bootstrapStatus = await postWebhook('PAYMENT_CREATED', bootstrapEvent);
  if (bootstrapStatus !== 200) throw new Error(`Bootstrap no Preview HTTP ${bootstrapStatus}`);
  const open = await state();
  if (
    open?.invoice_status !== 'open' ||
    open.invoice_count !== 1 ||
    Number(open.amount) !== expectedAmount
  )
    throw new Error('Invoice inicial incorreta');
  console.log(`PASS Preview: PAYMENT_CREATED materializou invoice open R$${expectedAmount}`);

  const confirm = await callApi(
    `sandbox/payment/${encodeURIComponent(paymentId)}/confirm`,
    'POST',
    { id: paymentId },
  );
  if (confirm.status !== 200) throw new Error(`Sandbox confirm HTTP ${confirm.status}`);
  const confirmed = paymentSchema.parse(
    await apiOk(`payments/${encodeURIComponent(paymentId)}`, 'GET'),
  );
  if (!['RECEIVED', 'CONFIRMED'].includes(confirmed.status))
    throw new Error(`Pagamento não confirmado: ${confirmed.status}`);
  console.log(`PASS Asaas Sandbox: pagamento simulado e GET autoritativo ${confirmed.status}`);

  const deadline = Date.now() + 120_000;
  let paid = await state();
  while (
    Date.now() < deadline &&
    !(paid?.invoice_status === 'paid' && Number(paid.real_event_count) > 0)
  ) {
    await sleep(3_000);
    paid = await state();
  }
  const realDelivery = paid?.invoice_status === 'paid' && Number(paid.real_event_count) > 0;
  console.log(`Entrega provider→Preview: ${realDelivery ? 'PASS real' : 'NOT OBSERVED após 120s'}`);
  if (!realDelivery) {
    const manualStatus = await postWebhook('PAYMENT_RECEIVED', `evt_qoro_e2e_paid_${tag}`);
    console.log(`Callback autenticado manual ao Preview: HTTP ${manualStatus}`);
    if (manualStatus !== 200) throw new Error('Callback manual não processou pagamento');
    paid = await state();
  }
  if (
    paid?.invoice_status !== 'paid' ||
    paid.billing_status !== 'active' ||
    paid.clinic_status !== 'active' ||
    paid.invoice_count !== 1 ||
    Number(paid.amount) !== expectedAmount ||
    !(new Date(paid.current_period_end).getTime() > new Date(paid.trial_ends_at).getTime())
  ) {
    throw new Error('Estado pós-trial não foi ativado corretamente');
  }
  if (offer2026) {
    const { assertClinicCanWriteTx } = await import('@/lib/tenant-access');
    await dbAdmin.transaction((tx) => assertClinicCanWriteTx(tx, clinicId!));
    console.log('PASS DEV: pagamento da oferta 2026 libera escrita após trial expirado');
  }
  console.log('PASS DEV: invoice paid única, assinatura/clinica active, ciclo avançado após trial');

  const replayStatus = await postWebhook('PAYMENT_RECEIVED', bootstrapEvent);
  const replay = await state();
  if (
    replayStatus !== 200 ||
    replay?.invoice_count !== 1 ||
    replay.invoice_status !== 'paid' ||
    String(replay.current_period_end) !== String(paid.current_period_end)
  )
    throw new Error('Replay regrediu ou duplicou estado');
  console.log('PASS replay: invoice única e ciclo estável');
  if (!realDelivery) process.exitCode = 2;
}

async function cleanupAll() {
  let cleanupFailed = false;
  if (webhookId) {
    const result = await callApi(`webhooks/${encodeURIComponent(webhookId)}`, 'DELETE').catch(
      () => ({ status: 0 }),
    );
    const after = await callApi(`webhooks/${encodeURIComponent(webhookId)}`, 'GET').catch(() => ({
      status: 0,
    }));
    cleanup.push(`webhook delete=${result.status} readback=${after.status}`);
    if (result.status !== 200 || after.status !== 404) cleanupFailed = true;
  }
  if (subscriptionId) {
    const result = await callApi(
      `subscriptions/${encodeURIComponent(subscriptionId)}`,
      'DELETE',
    ).catch(() => ({ status: 0 }));
    const after = await callApi(`subscriptions/${encodeURIComponent(subscriptionId)}`, 'GET').catch(
      () => ({ status: 0, value: null }),
    );
    const deleted =
      after.status === 404 ||
      (after.value !== null &&
        typeof after.value === 'object' &&
        'deleted' in after.value &&
        after.value.deleted === true);
    cleanup.push(`subscription delete=${result.status} deletedReadback=${deleted}`);
    if (result.status !== 200 || !deleted) cleanupFailed = true;
  }
  if (customerId) {
    const result = await callApi(`customers/${encodeURIComponent(customerId)}`, 'DELETE').catch(
      () => ({ status: 0 }),
    );
    const after = await callApi(`customers/${encodeURIComponent(customerId)}`, 'GET').catch(() => ({
      status: 0,
      value: null,
    }));
    const deleted =
      after.status === 404 ||
      (after.value !== null &&
        typeof after.value === 'object' &&
        'deleted' in after.value &&
        after.value.deleted === true);
    cleanup.push(`customer delete=${result.status} deletedReadback=${deleted}`);
    if (result.status !== 200 || !deleted) cleanupFailed = true;
  }
  if (clinicId) {
    const guard = await dbAdmin.execute<{
      slug: string;
      profiles: number;
      patients: number;
      appointments: number;
      matching_subscription: number;
    }>(sql`
      SELECT c.slug,
        (SELECT count(*)::int FROM profiles WHERE clinic_id = c.id) AS profiles,
        (SELECT count(*)::int FROM patients WHERE clinic_id = c.id) AS patients,
        (SELECT count(*)::int FROM appointments WHERE clinic_id = c.id) AS appointments,
        (SELECT count(*)::int FROM subscriptions WHERE clinic_id = c.id AND asaas_subscription_id = ${subscriptionId}) AS matching_subscription
      FROM clinics c WHERE c.id = ${clinicId}::uuid
    `);
    const row = guard[0];
    if (
      row?.slug === clinicSlug &&
      row.profiles === 0 &&
      row.patients === 0 &&
      row.appointments === 0 &&
      row.matching_subscription === 1
    ) {
      await dbAdmin.transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM processed_webhooks WHERE clinic_id = ${clinicId}::uuid`);
        await tx.execute(sql`DELETE FROM outbox WHERE clinic_id = ${clinicId}::uuid`);
        await tx.execute(
          sql`DELETE FROM clinics WHERE id = ${clinicId}::uuid AND slug = ${clinicSlug}`,
        );
      });
      const residue = await dbAdmin.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM clinics WHERE id = ${clinicId}::uuid`,
      );
      cleanup.push(`DEV fixture removed=${residue[0]?.n === 0}`);
      if (residue[0]?.n !== 0) cleanupFailed = true;
    } else {
      cleanup.push('DEV fixture guard blocked cleanup');
      cleanupFailed = true;
    }
  }
  console.log(`Cleanup: ${cleanup.join('; ')}`);
  if (cleanupFailed) throw new Error('Readback de cleanup incompleto');
}

try {
  await run();
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
  process.exitCode = 1;
} finally {
  try {
    await cleanupAll();
  } catch (error) {
    console.error(`CLEANUP FAIL: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
