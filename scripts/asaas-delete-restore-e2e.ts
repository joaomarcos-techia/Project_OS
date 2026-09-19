/**
 * E2E sandbox: cobrança recorrente real -> webhook global -> delete -> restore.
 *
 * Reutiliza exclusivamente fixtures criadas por `billing:live-roundtrip`. Um
 * POST autenticado materializa a invoice inicial (eventos antigos não são
 * retroativos); delete/restore seguintes precisam chegar pelo próprio Asaas.
 * IDs do Asaas, tokens e URLs com bypass não são impressos pelo runner. As
 * métricas existentes do provisionamento podem emitir UUIDs sintéticos internos.
 *
 * Guardas:
 *   BILLING_DELETE_RESTORE_E2E=ALLOW_SANDBOX_DELETE_RESTORE
 *   APP_BASE_URL=<alias Preview HTTPS>
 *   VERCEL_AUTOMATION_BYPASS_SECRET=<secret Preview>
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { sql } from 'drizzle-orm';

import { provisionTenant } from '@/contexts/billing/internal/provisioning';
import { checkoutSessions } from '@/contexts/billing/schema';
import { asaasProvider } from '@/lib/payments/asaas';
import { dbAdmin } from '@/lib/db';
import { assertAsaasFixtureAccount } from '@/lib/test/asaas-account-provenance';

assertDevContext();

const OPT_IN = 'ALLOW_SANDBOX_DELETE_RESTORE';
const ALLOWED_ASAAS_HOSTS = new Set(['api-sandbox.asaas.com', 'sandbox.asaas.com']);
const POLL_INTERVAL_MS = 2_000;
const WEBHOOK_TIMEOUT_MS = 90_000;
const D50_MANIFEST_PATH = resolve('.playwright', 'asaas-patient-excess-refund-fixture.json');
const GLOBAL_WEBHOOK_NAME = 'qoro dev';
const GLOBAL_WEBHOOK_EVENTS = [
  'PAYMENT_CREATED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE',
  'PAYMENT_REFUNDED',
  'PAYMENT_DELETED',
  'PAYMENT_RESTORED',
] as const;

type Fixture = {
  clinic_id: string;
  checkout_session_id: string;
  asaas_subscription_id: string;
  asaas_customer_id: string;
  clinic_status: string;
  subscription_status: string;
  profile_count: number;
  patient_count: number;
  appointment_count: number;
};

type EventRow = { asaas_event_id: string };
type D50Manifest = {
  purpose: string;
  version: number;
  accountFingerprint?: string;
  providerPaymentId: string;
};
type AsaasWebhook = {
  id?: unknown;
  name?: unknown;
  url?: unknown;
  enabled?: unknown;
  interrupted?: unknown;
  apiVersion?: unknown;
  hasAuthToken?: unknown;
  sendType?: unknown;
  events?: unknown;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[billing-delete-restore-e2e] ${message}`);
}

function apiConfiguration(): { baseUrl: URL; apiKey: string } {
  assert(process.env.BILLING_DELETE_RESTORE_E2E === OPT_IN, `opt-in deve ser ${OPT_IN}`);
  const rawBaseUrl = process.env.ASAAS_BASE_URL;
  const apiKey = process.env.ASAAS_API_KEY;
  assert(rawBaseUrl && apiKey, 'ASAAS_BASE_URL e ASAAS_API_KEY são obrigatórias');

  const baseUrl = new URL(rawBaseUrl);
  assert(
    baseUrl.protocol === 'https:' &&
      ALLOWED_ASAAS_HOSTS.has(baseUrl.hostname) &&
      baseUrl.port === '' &&
      baseUrl.username === '' &&
      baseUrl.password === '' &&
      baseUrl.search === '' &&
      baseUrl.hash === '',
    'somente host HTTPS oficial do Asaas Sandbox é permitido',
  );
  const expectedPath = baseUrl.hostname === 'api-sandbox.asaas.com' ? '/v3' : '/api/v3';
  assert(baseUrl.pathname.replace(/\/$/, '') === expectedPath, `path deve ser ${expectedPath}`);
  return { baseUrl, apiKey };
}

function webhookConfiguration(): { url: URL; token: string } {
  const appBaseUrl = process.env.APP_BASE_URL;
  const token = process.env.ASAAS_WEBHOOK_TOKEN;
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  assert(appBaseUrl && token && bypass, 'APP_BASE_URL, token e bypass do Preview são obrigatórios');

  const base = new URL(appBaseUrl);
  assert(
    base.protocol === 'https:' && base.hostname.endsWith('.vercel.app'),
    'APP_BASE_URL deve apontar para Preview Vercel, nunca produção',
  );
  const url = new URL('/api/webhooks/asaas', base);
  url.searchParams.set('x-vercel-protection-bypass', bypass);
  return { url, token };
}

function endpoint(baseUrl: URL, path: string): URL {
  return new URL(`${baseUrl.toString().replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
}

async function providerRequest<T = void>(
  config: { baseUrl: URL; apiKey: string },
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const response = await fetch(endpoint(config.baseUrl, path), {
    method,
    headers: {
      accept: 'application/json',
      access_token: config.apiKey,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  assert(response.ok, `Asaas recusou ${method} (HTTP ${response.status})`);
  return (await response.json().catch(() => undefined)) as T;
}

async function assertTargetSandboxAccount(): Promise<string> {
  const manifest = JSON.parse(await readFile(D50_MANIFEST_PATH, 'utf8')) as D50Manifest;
  assert(
    manifest.purpose === 'asaas-sandbox-patient-excess-refund' &&
      manifest.version === 2 &&
      manifest.accountFingerprint &&
      manifest.providerPaymentId,
    'manifesto D50 não prova a conta Sandbox alvo',
  );
  const account = await asaasProvider.getMyAccount({ attempts: 1 });
  assertAsaasFixtureAccount(manifest.accountFingerprint, account);
  await asaasProvider.getPayment(manifest.providerPaymentId, { attempts: 1 });
  assert(account.email, 'conta Asaas alvo não possui e-mail para configurar webhook');
  return account.email;
}

function webhookTarget(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

async function listWebhooks(api: { baseUrl: URL; apiKey: string }): Promise<AsaasWebhook[]> {
  const response = await providerRequest<{ data?: unknown }>(
    api,
    '/webhooks?offset=0&limit=100',
    'GET',
  );
  return Array.isArray(response.data) ? (response.data as AsaasWebhook[]) : [];
}

async function ensureGlobalWebhook(
  api: { baseUrl: URL; apiKey: string },
  webhook: { url: URL; token: string },
  accountEmail: string,
): Promise<void> {
  const desiredTarget = webhookTarget(webhook.url.toString());
  assert(desiredTarget, 'URL global do webhook é inválida');
  const existing = (await listWebhooks(api)).filter(
    (candidate) =>
      candidate.name === GLOBAL_WEBHOOK_NAME || webhookTarget(candidate.url) === desiredTarget,
  );
  assert(existing.length <= 1, 'mais de um webhook global candidato foi encontrado');

  const body = {
    name: GLOBAL_WEBHOOK_NAME,
    url: webhook.url.toString(),
    email: accountEmail,
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    authToken: webhook.token,
    sendType: 'NON_SEQUENTIALLY',
    events: [...GLOBAL_WEBHOOK_EVENTS],
  };
  let webhookId: string;
  if (existing.length === 1) {
    webhookId = typeof existing[0]!.id === 'string' ? existing[0]!.id : '';
    assert(webhookId, 'webhook global existente não possui id');
    await providerRequest(api, `/webhooks/${encodeURIComponent(webhookId)}`, 'PUT', body);
  } else {
    const created = await providerRequest<{ id?: unknown }>(api, '/webhooks', 'POST', body);
    webhookId = typeof created.id === 'string' ? created.id : '';
    assert(webhookId, 'Asaas não devolveu id do webhook global');
  }

  const configured = (await listWebhooks(api)).find((candidate) => candidate.id === webhookId);
  assert(configured, 'webhook global não apareceu no readback');
  const configuredEvents = Array.isArray(configured.events)
    ? configured.events.filter((event): event is string => typeof event === 'string').sort()
    : [];
  assert(configured.name === GLOBAL_WEBHOOK_NAME, 'nome do webhook global diverge');
  assert(configured.url === webhook.url.toString(), 'URL/bypass do webhook global diverge');
  assert(configured.enabled === true, 'webhook global não está habilitado');
  assert(configured.interrupted === false, 'fila do webhook global está interrompida');
  assert(configured.apiVersion === 3, 'webhook global não usa apiVersion 3');
  assert(configured.hasAuthToken === true, 'webhook global não confirmou authToken');
  assert(configured.sendType === 'NON_SEQUENTIALLY', 'webhook global não é non-sequential');
  assert(
    JSON.stringify(configuredEvents) === JSON.stringify([...GLOBAL_WEBHOOK_EVENTS].sort()),
    'eventos do webhook global divergem dos sete canônicos',
  );
  console.log(
    JSON.stringify({
      result: 'PASS',
      operation: existing.length === 1 ? 'global-webhook-updated' : 'global-webhook-created',
      name: GLOBAL_WEBHOOK_NAME,
      route: '/api/webhooks/asaas',
      enabled: true,
      interrupted: false,
      sendType: 'NON_SEQUENTIALLY',
      eventCount: configuredEvents.length,
      authTokenConfigured: true,
      identifiersDisclosed: false,
    }),
  );
}

async function postWebhook(input: {
  config: { url: URL; token: string };
  eventId: string;
  event: 'PAYMENT_CREATED' | 'PAYMENT_RESTORED';
  paymentId: string;
}): Promise<void> {
  const response = await fetch(input.config.url, {
    method: 'POST',
    headers: {
      'asaas-access-token': input.config.token,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      id: input.eventId,
      event: input.event,
      payment: { id: input.paymentId },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const responseBody = await response.text();
  const failureStage =
    responseBody === 'verification failed'
      ? 'verification'
      : responseBody === 'internal error'
        ? 'persistence'
        : 'unknown';
  assert(
    response.status === 200,
    `webhook respondeu HTTP ${response.status}; estágio=${failureStage}`,
  );
}

async function listFixtures(): Promise<Fixture[]> {
  return dbAdmin.execute<Fixture>(sql`
    SELECT c.id::text AS clinic_id,
           cs.id::text AS checkout_session_id,
           s.asaas_subscription_id,
           bc.asaas_customer_id,
           c.status AS clinic_status,
           s.billing_status AS subscription_status,
           (SELECT count(*)::int FROM profiles p WHERE p.clinic_id = c.id) AS profile_count,
           (SELECT count(*)::int FROM patients p WHERE p.clinic_id = c.id) AS patient_count,
           (SELECT count(*)::int FROM appointments a WHERE a.clinic_id = c.id) AS appointment_count
      FROM clinics c
      JOIN subscriptions s ON s.clinic_id = c.id
      JOIN billing_customers bc ON bc.clinic_id = c.id
      JOIN checkout_sessions cs ON cs.clinic_id = c.id
     WHERE c.slug LIKE 'live-%'
       AND c.nome LIKE 'Round-trip %'
       AND cs.email LIKE 'roundtrip+%@qoro.dev'
       AND cs.idempotency_key LIKE 'roundtrip:%'
     ORDER BY cs.created_at DESC
  `);
}

async function createFixture(api: { baseUrl: URL; apiKey: string }): Promise<void> {
  const stamp = Date.now();
  const externalReference = `qoro-delete-restore:${randomUUID()}`;
  let customerId: string | null = null;
  let subscriptionId: string | null = null;

  try {
    const customer = await providerRequest<{ id: string }>(api, '/customers', 'POST', {
      name: `Round-trip ${stamp}`,
      email: `roundtrip+${stamp}@qoro.dev`,
      cpfCnpj: '24971563792',
      mobilePhone: '11999990000',
    });
    assert(customer.id, 'Asaas não devolveu customer da fixture');
    customerId = customer.id;

    const subscription = await providerRequest<{ id: string }>(api, '/subscriptions', 'POST', {
      customer: customerId,
      billingType: 'BOLETO',
      value: 149,
      cycle: 'MONTHLY',
      nextDueDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      description: 'ClinicaOS — Solo (delete/restore E2E)',
      externalReference,
    });
    assert(subscription.id, 'Asaas não devolveu subscription da fixture');
    subscriptionId = subscription.id;

    const rows = await dbAdmin.execute<{ plan_id: string; price_id: string }>(sql`
      SELECT p.id::text AS plan_id, pr.id::text AS price_id
        FROM plans p
        JOIN prices pr ON pr.plan_id = p.id
       WHERE p.code = 'solo'
         AND pr.billing_cycle = 'monthly'
         AND pr.active_until IS NULL
       ORDER BY (pr.campaign_code IS NULL) DESC, pr.active_from DESC
       LIMIT 1
    `);
    const catalog = rows[0];
    assert(catalog, 'plano/preço solo não encontrado');

    await dbAdmin.transaction(async (tx) => {
      const sessions = await tx
        .insert(checkoutSessions)
        .values({
          email: `roundtrip+${stamp}@qoro.dev`,
          clinicName: `Round-trip ${stamp}`,
          planId: catalog.plan_id,
          idempotencyKey: `roundtrip:${stamp}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning({ id: checkoutSessions.id });
      const session = sessions[0];
      assert(session, 'checkout_session da fixture não foi criada');
      await provisionTenant(tx as never, {
        checkoutSessionId: session.id,
        slug: `live-${stamp}`,
        clinicName: `Round-trip ${stamp}`,
        planId: catalog.plan_id,
        planCode: 'solo',
        priceId: catalog.price_id,
        billingCycle: 'monthly',
        customerName: `Round-trip ${stamp}`,
        email: `roundtrip+${stamp}@qoro.dev`,
        asaasCustomerId: customerId!,
        asaasSubscriptionId: subscriptionId!,
        trialDays: 14,
      });
    });
  } catch (error) {
    if (subscriptionId) {
      await providerRequest(
        api,
        `/subscriptions/${encodeURIComponent(subscriptionId)}`,
        'DELETE',
      ).catch(() => undefined);
    }
    if (customerId) {
      await providerRequest(api, `/customers/${encodeURIComponent(customerId)}`, 'DELETE').catch(
        () => undefined,
      );
    }
    throw error;
  }
}

function assertFixturesSafe(fixtures: Fixture[]): void {
  assert(
    fixtures.length > 0 && fixtures.length <= 5,
    'quantidade inesperada de fixtures sintéticas',
  );
  for (const fixture of fixtures) {
    assert(fixture.clinic_status === 'pending_payment', 'fixture não está pending_payment');
    assert(fixture.subscription_status === 'trial', 'subscription da fixture não está trial');
    assert(fixture.asaas_subscription_id, 'fixture sem subscription Asaas');
    assert(fixture.asaas_customer_id, 'fixture sem customer Asaas');
    assert(Number(fixture.profile_count) === 0, 'fixture possui profile e não pode ser removida');
    assert(Number(fixture.patient_count) === 0, 'fixture possui paciente e não pode ser removida');
    assert(
      Number(fixture.appointment_count) === 0,
      'fixture possui agendamento e não pode ser removida',
    );
  }
}

async function invoiceStatus(clinicId: string, paymentId: string): Promise<string | null> {
  const rows = await dbAdmin.execute<{ status: string }>(sql`
    SELECT status FROM invoices
     WHERE clinic_id = ${clinicId}::uuid AND asaas_payment_id = ${paymentId}
     LIMIT 1
  `);
  return rows[0]?.status ?? null;
}

async function eventCount(clinicId: string, type: string): Promise<number> {
  const rows = await dbAdmin.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM processed_webhooks
     WHERE clinic_id = ${clinicId}::uuid AND event_type = ${type}
  `);
  return Number(rows[0]?.count ?? 0);
}

async function latestEvent(clinicId: string, type: string): Promise<EventRow | null> {
  const rows = await dbAdmin.execute<EventRow>(sql`
    SELECT asaas_event_id FROM processed_webhooks
     WHERE clinic_id = ${clinicId}::uuid
       AND event_type = ${type}
     ORDER BY processed_at DESC
     LIMIT 1
  `);
  return rows[0] ?? null;
}

async function waitFor(label: string, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + WEBHOOK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`[billing-delete-restore-e2e] timeout aguardando ${label}`);
}

async function runJourney(
  fixture: Fixture,
  api: { baseUrl: URL; apiKey: string },
  webhook: { url: URL; token: string },
): Promise<void> {
  let payment = (
    await asaasProvider.listSubscriptionPayments(fixture.asaas_subscription_id, { attempts: 1 })
  ).find((candidate) => !candidate.deleted && ['PENDING', 'OVERDUE'].includes(candidate.status));
  if (!payment) {
    await waitFor('cobrança pendente da fixture', async () => {
      payment = (
        await asaasProvider.listSubscriptionPayments(fixture.asaas_subscription_id, {
          attempts: 1,
        })
      ).find(
        (candidate) => !candidate.deleted && ['PENDING', 'OVERDUE'].includes(candidate.status),
      );
      return payment !== undefined;
    });
  }
  const restorablePayment = payment;
  assert(restorablePayment, 'fixture não possui cobrança restaurável pendente');

  const bootstrapEventId = `evt_qoro_bootstrap_${randomUUID()}`;
  await postWebhook({
    config: webhook,
    eventId: bootstrapEventId,
    event: 'PAYMENT_CREATED',
    paymentId: restorablePayment.paymentId,
  });
  await waitFor('invoice open do bootstrap', async () => {
    return (await invoiceStatus(fixture.clinic_id, restorablePayment.paymentId)) === 'open';
  });

  const deleteEventBaseline = await eventCount(fixture.clinic_id, 'PAYMENT_DELETED');
  await providerRequest(
    api,
    `/payments/${encodeURIComponent(restorablePayment.paymentId)}`,
    'DELETE',
  );
  await waitFor('PAYMENT_DELETED real e invoice cancelled', async () => {
    const [status, count] = await Promise.all([
      invoiceStatus(fixture.clinic_id, restorablePayment.paymentId),
      eventCount(fixture.clinic_id, 'PAYMENT_DELETED'),
    ]);
    return status === 'cancelled' && count > deleteEventBaseline;
  });

  const restoreEventBaseline = await eventCount(fixture.clinic_id, 'PAYMENT_RESTORED');
  await providerRequest(
    api,
    `/payments/${encodeURIComponent(restorablePayment.paymentId)}/restore`,
    'POST',
  );
  await waitFor('PAYMENT_RESTORED real e invoice open', async () => {
    const [status, count] = await Promise.all([
      invoiceStatus(fixture.clinic_id, restorablePayment.paymentId),
      eventCount(fixture.clinic_id, 'PAYMENT_RESTORED'),
    ]);
    return status === 'open' && count > restoreEventBaseline;
  });

  const restored = await latestEvent(fixture.clinic_id, 'PAYMENT_RESTORED');
  assert(restored, 'evento restaurado desapareceu antes do replay');
  await postWebhook({
    config: webhook,
    eventId: restored.asaas_event_id,
    event: 'PAYMENT_RESTORED',
    paymentId: restorablePayment.paymentId,
  });
  assert(
    (await invoiceStatus(fixture.clinic_id, restorablePayment.paymentId)) === 'open',
    'replay alterou o estado final da invoice',
  );
}

async function cleanupProviderFixtures(
  fixtures: Fixture[],
  api: { baseUrl: URL; apiKey: string },
): Promise<void> {
  for (const fixture of fixtures) {
    const payments = await asaasProvider.listSubscriptionPayments(fixture.asaas_subscription_id, {
      attempts: 1,
    });
    for (const payment of payments) {
      if (!payment.deleted) {
        await providerRequest(api, `/payments/${encodeURIComponent(payment.paymentId)}`, 'DELETE');
      }
    }
    await providerRequest(
      api,
      `/subscriptions/${encodeURIComponent(fixture.asaas_subscription_id)}`,
      'DELETE',
    );
    await providerRequest(
      api,
      `/customers/${encodeURIComponent(fixture.asaas_customer_id)}`,
      'DELETE',
    );
  }
}

async function cleanupDatabaseFixtures(fixtures: Fixture[]): Promise<void> {
  await dbAdmin.transaction(async (tx) => {
    for (const fixture of fixtures) {
      await tx.execute(
        sql`DELETE FROM processed_webhooks WHERE clinic_id = ${fixture.clinic_id}::uuid`,
      );
      await tx.execute(sql`DELETE FROM outbox WHERE clinic_id = ${fixture.clinic_id}::uuid`);
      await tx.execute(sql`
        DELETE FROM tenant_provisioning
         WHERE checkout_session_id = ${fixture.checkout_session_id}::uuid
            OR clinic_id = ${fixture.clinic_id}::uuid
      `);
      await tx.execute(sql`DELETE FROM clinics WHERE id = ${fixture.clinic_id}::uuid`);
      await tx.execute(
        sql`DELETE FROM checkout_sessions WHERE id = ${fixture.checkout_session_id}::uuid`,
      );
    }
  });

  for (const fixture of fixtures) {
    const rows = await dbAdmin.execute<{ residue: number }>(sql`
      SELECT (
        (SELECT count(*) FROM clinics WHERE id = ${fixture.clinic_id}::uuid) +
        (SELECT count(*) FROM checkout_sessions WHERE id = ${fixture.checkout_session_id}::uuid) +
        (SELECT count(*) FROM tenant_provisioning
          WHERE checkout_session_id = ${fixture.checkout_session_id}::uuid
             OR clinic_id = ${fixture.clinic_id}::uuid) +
        (SELECT count(*) FROM outbox WHERE clinic_id = ${fixture.clinic_id}::uuid) +
        (SELECT count(*) FROM processed_webhooks WHERE clinic_id = ${fixture.clinic_id}::uuid)
      )::int AS residue
    `);
    assert(Number(rows[0]?.residue ?? -1) === 0, 'cleanup local deixou resíduo');
  }
}

async function main(): Promise<void> {
  const api = apiConfiguration();
  const webhook = webhookConfiguration();
  const accountEmail = await assertTargetSandboxAccount();
  await ensureGlobalWebhook(api, webhook, accountEmail);
  let fixtures = await listFixtures();
  if (fixtures.length === 0) {
    await createFixture(api);
    fixtures = await listFixtures();
  }
  assertFixturesSafe(fixtures);
  console.log(
    `[billing-delete-restore-e2e] preflight PASS; fixtures sintéticas: ${fixtures.length}.`,
  );

  let journeyPassed = false;
  try {
    await runJourney(fixtures[0]!, api, webhook);
    journeyPassed = true;
    console.log(
      '[billing-delete-restore-e2e] PASS: delete→cancelled→restore→open e replay idempotente.',
    );
  } finally {
    await cleanupProviderFixtures(fixtures, api);
    // Entregas são assíncronas; dá tempo para eventos de remoção terminarem antes do cleanup local.
    await sleep(10_000);
    await cleanupDatabaseFixtures(fixtures);
    console.log(
      `[billing-delete-restore-e2e] cleanup PASS; fixtures removidas: ${fixtures.length}.`,
    );
  }

  assert(journeyPassed, 'jornada não concluiu');
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
