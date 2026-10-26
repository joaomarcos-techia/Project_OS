/** Readback and guarded cleanup of an interactive E2E fixture retained after a timeout. */
import assert from 'node:assert/strict';

import postgres from 'postgres';
import { z } from 'zod';

import { assertDevContext } from '../scripts/_env';
import { DEV_PROJECT_REF } from './preview-dev-runtime';

const slug = process.env.E2E_EXTRA_DOCTOR_RECOVERY_SLUG ?? '';
const webhookId = process.env.E2E_EXTRA_DOCTOR_RECOVERY_WEBHOOK_ID ?? '';
const cleanup = process.argv.includes('--cleanup');
const label = slug.replace('e2e-extra-doctor-', '');
const asaasBase = process.env.ASAAS_BASE_URL_DEV;
const asaasKey = process.env.ASAAS_API_KEY_DEV;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

function guard(): string {
  assert.equal(process.env.E2E_EXTRA_DOCTOR_RECOVERY, 'DEV_SANDBOX_ONLY');
  assert.match(slug, /^e2e-extra-doctor-[0-9a-f]{8}$/u);
  assert.ok(webhookId && !webhookId.includes('/'), 'ID do webhook da fixture ausente');
  const databaseUrl = assertDevContext().databaseUrl;
  assert.equal(
    decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1),
    DEV_PROJECT_REF,
  );
  assert.ok(supabaseUrl && supabaseKey, 'Auth DEV indisponível');
  assert.equal(new URL(supabaseUrl).hostname.split('.')[0], DEV_PROJECT_REF);
  assert.ok(asaasBase && asaasKey, 'Asaas Sandbox indisponível');
  const provider = new URL(asaasBase);
  assert.ok(
    provider.protocol === 'https:' &&
      ((provider.hostname === 'api-sandbox.asaas.com' && provider.pathname === '/v3') ||
        (provider.hostname === 'sandbox.asaas.com' && provider.pathname === '/api/v3')),
    'Endpoint Asaas não é Sandbox',
  );
  return databaseUrl;
}

async function asaas(path: string, method: 'GET' | 'DELETE' = 'GET') {
  assert.ok(asaasKey, 'Asaas Sandbox indisponível');
  const response = await fetch(`${asaasBase}/${path}`, {
    method,
    headers: { access_token: asaasKey, accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  const data: unknown = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function auth(path: string, method: 'GET' | 'DELETE') {
  assert.ok(supabaseKey, 'Auth DEV indisponível');
  return fetch(`${supabaseUrl}/auth/v1/admin${path}`, {
    method,
    headers: { apikey: supabaseKey, authorization: `Bearer ${supabaseKey}` },
    signal: AbortSignal.timeout(30_000),
  });
}

async function main() {
  const databaseUrl = guard();
  const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });
  try {
    const [fixture] = await sql<
      {
        clinic_id: string;
        user_id: string;
        subscription_id: string;
        customer_id: string;
        checkout_id: string;
        users: number;
        subscriptions: number;
        customers: number;
        patients: number;
      }[]
    >`
      select c.id::text clinic_id,
             (select id::text from profiles where clinic_id = c.id limit 1) user_id,
             (select asaas_subscription_id from subscriptions where clinic_id = c.id limit 1) subscription_id,
             (select asaas_customer_id from billing_customers where clinic_id = c.id limit 1) customer_id,
             (select provider_checkout_id from subscription_change_requests
               where clinic_id = c.id order by created_at desc limit 1) checkout_id,
             (select count(*)::int from profiles where clinic_id = c.id) users,
             (select count(*)::int from subscriptions where clinic_id = c.id) subscriptions,
             (select count(*)::int from billing_customers where clinic_id = c.id) customers,
             (select count(*)::int from patients where clinic_id = c.id) patients
        from clinics c where c.slug = ${slug}
    `;
    assert.ok(fixture, 'Clínica de teste retida não encontrada');
    assert.deepEqual(
      [fixture.users, fixture.subscriptions, fixture.customers, fixture.patients],
      [1, 1, 1, 0],
      'Fixture contém recursos inesperados; cleanup recusado',
    );
    assert.ok(
      fixture.user_id && fixture.subscription_id && fixture.customer_id && fixture.checkout_id,
      'Fixture incompleta; cleanup recusado',
    );

    const [subscription, customer, webhook, paymentsResponse] = await Promise.all([
      asaas(`subscriptions/${encodeURIComponent(fixture.subscription_id)}`),
      asaas(`customers/${encodeURIComponent(fixture.customer_id)}`),
      asaas(`webhooks/${encodeURIComponent(webhookId)}`),
      asaas(`payments?checkoutSession=${encodeURIComponent(fixture.checkout_id)}`),
    ]);
    assert.equal(subscription.status, 200, 'Assinatura Sandbox da fixture ausente');
    assert.equal(customer.status, 200, 'Customer Sandbox da fixture ausente');
    assert.equal(webhook.status, 200, 'Webhook Sandbox da fixture ausente');
    const expectedEmail = `${slug}@example.invalid`;
    const subscriptionData = z
      .object({ customer: z.string(), externalReference: z.string() })
      .parse(subscription.data);
    assert.equal(subscriptionData.customer, fixture.customer_id);
    assert.ok(subscriptionData.externalReference.startsWith(`qoro-e2e-extra-doctor:${label}`));
    assert.equal(z.object({ email: z.string() }).parse(customer.data).email, expectedEmail);
    assert.equal(
      z.object({ name: z.string() }).parse(webhook.data).name,
      `Qoro E2E médico extra ${label}`,
    );
    assert.equal(paymentsResponse.status, 200);
    const payments = z
      .object({
        data: z.array(
          z.object({ id: z.string(), status: z.string(), checkoutSession: z.string() }),
        ),
      })
      .parse(paymentsResponse.data).data;
    assert.ok(payments.every((payment) => payment.checkoutSession === fixture.checkout_id));
    console.log(
      JSON.stringify({
        slug,
        checkout: fixture.checkout_id,
        paymentStates: payments.map((payment) => payment.status),
        mode: cleanup ? 'cleanup' : 'readback',
      }),
    );
    if (!cleanup) return;
    assert.ok(
      payments.every((payment) =>
        ['CONFIRMED', 'RECEIVED', 'REFUNDED', 'DELETED'].includes(payment.status),
      ),
      'Cobrança não terminal: aguarde conciliação antes de remover a fixture',
    );
    if (payments.length === 0) {
      assert.ok(
        process.argv.includes('--cancel-unpaid'),
        'Checkout ainda não pago: exija --cancel-unpaid somente após confirmar que ninguém está pagando',
      );
      const removed = await asaas(`checkouts/${encodeURIComponent(fixture.checkout_id)}`, 'DELETE');
      assert.ok([200, 404].includes(removed.status), 'Checkout não foi cancelado');
      assert.equal(
        (await asaas(`checkouts/${encodeURIComponent(fixture.checkout_id)}`)).status,
        404,
        'Checkout ainda pode ser pago; cleanup recusado',
      );
    }
    assert.equal((await asaas(`webhooks/${encodeURIComponent(webhookId)}`, 'DELETE')).status, 200);
    assert.equal((await asaas(`webhooks/${encodeURIComponent(webhookId)}`)).status, 404);
    assert.equal(
      (await asaas(`subscriptions/${encodeURIComponent(fixture.subscription_id)}`, 'DELETE'))
        .status,
      200,
    );
    const afterSubscription = await asaas(
      `subscriptions/${encodeURIComponent(fixture.subscription_id)}`,
    );
    assert.ok(
      afterSubscription.status === 404 ||
        (afterSubscription.data &&
          typeof afterSubscription.data === 'object' &&
          'deleted' in afterSubscription.data &&
          afterSubscription.data.deleted === true),
      'Assinatura Sandbox não confirmou exclusão',
    );
    assert.equal(
      (await asaas(`customers/${encodeURIComponent(fixture.customer_id)}`, 'DELETE')).status,
      200,
    );
    const afterCustomer = await asaas(`customers/${encodeURIComponent(fixture.customer_id)}`);
    assert.ok(
      afterCustomer.status === 404 ||
        (afterCustomer.data &&
          typeof afterCustomer.data === 'object' &&
          'deleted' in afterCustomer.data &&
          afterCustomer.data.deleted === true),
      'Customer Sandbox não confirmou exclusão',
    );
    await sql.begin(async (tx) => {
      await tx`delete from processed_webhooks where clinic_id = ${fixture.clinic_id}::uuid`;
      await tx`delete from outbox where clinic_id = ${fixture.clinic_id}::uuid`;
      await tx`delete from audit_events where clinic_id = ${fixture.clinic_id}::uuid`;
      await tx`delete from clinics where id = ${fixture.clinic_id}::uuid and slug = ${slug}`;
    });
    const [left] = await sql<{ n: number }[]>`
      select count(*)::int n from clinics where id = ${fixture.clinic_id}::uuid
    `;
    assert.equal(left?.n, 0, 'Clínica DEV não foi removida');
    const removedUser = await auth(`/users/${encodeURIComponent(fixture.user_id)}`, 'DELETE');
    assert.ok(removedUser.ok || removedUser.status === 404, 'Auth DEV não removeu usuário');
    assert.equal(
      (await auth(`/users/${encodeURIComponent(fixture.user_id)}`, 'GET')).status,
      404,
      'Usuário Auth DEV ainda existe',
    );
    console.log('PASS cleanup: fixture DEV/Auth/assinatura/customer/webhook removida');
    if (payments.length > 0) console.log('Cobrança paga Sandbox preservada para auditoria');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(
    '[extra-doctor recovery] FAIL:',
    error instanceof assert.AssertionError
      ? error.message
      : error instanceof Error
        ? error.name
        : 'unknown',
  );
  process.exitCode = 1;
});
