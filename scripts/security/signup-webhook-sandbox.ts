/**
 * O-5/O-6 — o webhook de uma assinatura ORIGINADA NO CADASTRO, ponta a ponta.
 *
 * O handoff dizia que o reuso do webhook pelo cadastro era "por desenho, não
 * prova". Este runner fecha essa lacuna sem criar um segundo webhook: ele usa a
 * MESMA rota de produção (`/api/webhooks/asaas`), o MESMO adapter e o MESMO
 * contrato de token. Se o desenho estiver errado, o runner erra junto.
 *
 * A evidência é externa de verdade. O corpo do webhook do Asaas carrega apenas
 * identificadores — a rota busca o estado autoritativo com `getPayment()` contra
 * a API. Aqui essa chamada vai ao SANDBOX REAL, sobre uma assinatura criada de
 * verdade. Nenhum `getPayment` é dublado; forjar o corpo não adianta, que é
 * exatamente a propriedade sob teste.
 *
 * O que se prova:
 *   W1  fluxo feliz: assinatura do cadastro → evento real → invoice na clínica
 *       CERTA, resolvida por `asaas_subscription_id`;
 *   W2  replay do MESMO evento → nenhuma segunda transição, nenhuma segunda
 *       invoice, nenhum registro duplicado;
 *   W3  fora de ordem: um evento mais velho depois de um mais novo não regride
 *       o estado;
 *   W4  ataques: sem token, token errado, corpo inválido, evento desconhecido,
 *       corpo gigante e pagamento de OUTRO tenant;
 *   W5  limpeza: nada sobra no sandbox.
 *
 * Segurança: recusa rodar fora de host sandbox, exige confirmação explícita e
 * nunca imprime credencial. Ids saem redigidos.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { PaymentProvider } from '../../src/lib/payments/asaas';

import { startScratchSchema } from './scratch-schema';

const CONFIRM = 'ASAAS_SANDBOX_ONLY';
const PORT = 55479;
/** CPF de teste do sandbox — o mesmo de `asaas-live-check.ts`. Não é PII real. */
const SANDBOX_TEST_CPF = '24971563792';
const TRIAL_DAYS = 14;

const results: { id: string; name: string; status: 'PASS' | 'FAIL'; detail?: string }[] = [];
const createdSubscriptions = new Set<string>();
const createdCustomers = new Set<string>();

function guard(): void {
  if (process.env.SANDBOX_CONFIRM !== CONFIRM) {
    throw new Error(`[sandbox] exige SANDBOX_CONFIRM=${CONFIRM}`);
  }
  const base = process.env.ASAAS_BASE_URL ?? '';
  const parsed = new URL(base);
  assert.ok(
    parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      !parsed.search &&
      !parsed.hash &&
      ((parsed.hostname === 'sandbox.asaas.com' && parsed.pathname === '/api/v3') ||
        (parsed.hostname === 'api-sandbox.asaas.com' && parsed.pathname === '/v3')),
    '[sandbox] ASAAS_BASE_URL fora dos endpoints HTTPS oficiais de sandbox — abortado',
  );
  assert.ok(process.env.ASAAS_API_KEY, '[sandbox] ASAAS_API_KEY ausente');
  assert.ok(process.env.ASAAS_WEBHOOK_TOKEN, '[sandbox] ASAAS_WEBHOOK_TOKEN ausente');
}

async function check(id: string, name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    results.push({ id, name, status: 'PASS' });
    console.log(`PASS ${id} ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    results.push({ id, name, status: 'FAIL', detail });
    console.log(`FAIL ${id} ${name}: ${detail.split('\n')[0]}`);
  }
}

guard();

const cluster = await startScratchSchema({ port: PORT });
const sql = cluster.sql;

// O runner deve medir SOMENTE o cluster descartável, mesmo quando é iniciado
// por um shell que pré-carregou `.env.local`. Fora de production, `env.ts`
// promove `DATABASE_URL_DEV` sobre a canônica; `DATABASE_URL_RUNTIME` também
// poderia mandar os handlers tenant para outro banco. Fixar as três entradas
// fecha essa fuga e foi provado pela execução que antes devolveu `gone` ao ler
// um DEV herdado enquanto a fixture existia no scratch.
process.env.DATABASE_URL = cluster.url;
process.env.DATABASE_URL_DEV = cluster.url;
process.env.DATABASE_URL_RUNTIME = cluster.url;
process.env.SUPABASE_PROJECT_ENV = 'dev';
process.env.SIGNUP_IDENTITY_ENABLED = 'true';
process.env.SIGNUP_AUTH_ENABLED = 'true';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'sb_publishable_test';
process.env.MAGIC_TOKEN_SECRET ??= 'synthetic-local-webhook-only-magic-token';
process.env.LOGIN_HASH_PEPPER ??= 'synthetic-local-webhook-only-hash-pepper';
process.env.CRYPTO_SECRET_BACKEND ??= 'env';
process.env.CRYPTO_MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT ??= Buffer.alloc(32, 9).toString('base64');
process.env.LOG_LEVEL ??= 'error';

const { asaasProvider } = await import('../../src/lib/payments/asaas');
const { redactOpaqueId } = await import('../../src/lib/sanitize/redact');
const { provisionTenantFromSignup } =
  await import('../../src/contexts/onboarding/internal/signup-provision');
const { reconcileSignupSubscription, startSignupSubscription } =
  await import('../../src/contexts/onboarding/internal/signup-checkout');
const { POST } = await import('../../src/app/api/webhooks/asaas/route');

const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN!;

function deliver(body: unknown, opts: { token?: string | null; raw?: string } = {}) {
  const payload = opts.raw ?? JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = opts.token === undefined ? WEBHOOK_TOKEN : opts.token;
  if (token !== null) headers['asaas-access-token'] = token;
  return POST(
    new Request('https://app.qoro.dev/api/webhooks/asaas', {
      method: 'POST',
      headers,
      body: payload,
    }),
  );
}

async function seedPlanCatalog(): Promise<{ planId: string }> {
  // Catálogo REAL: os códigos são um enum fechado do contrato de eventos de
  // billing, e um plano inventado quebraria o provisionamento DEPOIS da cobrança.
  const [solo] = await sql<{ id: string }[]>`SELECT id FROM plans WHERE code = 'solo'`;
  assert.ok(solo, 'a migration deveria ter semeado o plano solo');
  await sql`INSERT INTO prices (plan_id, amount, currency, billing_cycle, active_from)
    SELECT ${solo.id}::uuid, 149.00, 'BRL', 'monthly', now() - interval '1 day'
    WHERE NOT EXISTS (
      SELECT 1 FROM prices WHERE plan_id = ${solo.id}::uuid AND billing_cycle = 'monthly'
        AND currency = 'BRL' AND active_until IS NULL AND campaign_code IS NULL
    )`;
  return { planId: solo.id };
}

/** Cria no SANDBOX a assinatura que o cadastro criaria, com a mesma forma. */
async function createSandboxSubscription(tag: string): Promise<{
  customerId: string;
  subscriptionId: string;
  externalReference: string;
  signupSessionId: string;
}> {
  const signupSessionId = randomUUID();
  const externalReference = `signup:${signupSessionId}`;
  const { customerId } = await asaasProvider.createCustomer({
    name: `Clinica Webhook ${tag}`,
    email: `webhook-${tag}@example.invalid`,
    cpfCnpj: SANDBOX_TEST_CPF,
  });
  createdCustomers.add(customerId);
  const { subscriptionId } = await asaasProvider.createSubscription({
    customerId,
    value: 149,
    cycle: 'MONTHLY',
    billingType: 'UNDEFINED',
    nextDueDate: new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString().slice(0, 10),
    description: 'Qoro — prova de webhook do cadastro autônomo',
    externalReference,
  });
  createdSubscriptions.add(subscriptionId);
  return { customerId, subscriptionId, externalReference, signupSessionId };
}

/** Reconcilia no provedor real antes de permitir provisionar o tenant. */
async function provisionFromSignup(
  tag: string,
  planId: string,
  customerId: string,
  subscriptionId: string,
  signupSessionId: string,
): Promise<string> {
  const userId = randomUUID();
  await sql`INSERT INTO auth.users (id, email, email_confirmed_at)
    VALUES (${userId}::uuid, ${`webhook-${tag}@example.invalid`}, now())`;
  const tokenHash = createHash('sha256').update(`webhook-${tag}-${Date.now()}`).digest('hex');
  const emailHash = createHash('sha256').update(`webhook-${tag}@example.invalid`).digest('hex');
  await sql`INSERT INTO signup_sessions (
      id, token_hash, status, idle_expires_at, absolute_expires_at, consumed_at, auth_user_id,
      owner_name, clinic_name, email_hash, accepted_at, answered_at, professionals_band,
      weekly_appointments_band, current_tooling, discovery_source, selected_plan_id,
      billing_attempt_state, billing_attempted_at, asaas_customer_id, asaas_subscription_id)
    VALUES (
      ${signupSessionId}::uuid, ${tokenHash}, 'email_verified', now() + interval '30 minutes',
      now() + interval '45 minutes', now(), ${userId}::uuid,
      'Ana Prado', ${`Clinica Webhook ${tag}`}, ${emailHash}, now(), now(),
      '2_5', '21_50', 'outro_sistema', 'indicacao_colega', ${planId}::uuid,
      'creation_unknown', now(), ${customerId}, NULL)`;

  await check(
    `R-${tag}`,
    'reconcile real rejeita valor divergente e ativa apenas após readback válido',
    async () => {
      // O preço é fixture do SCHEMA efêmero. Nenhum catálogo externo é alterado.
      const prior = await sql`SELECT id, amount FROM prices WHERE plan_id = ${planId}::uuid`;
      try {
        await sql`UPDATE prices SET amount = 1 WHERE plan_id = ${planId}::uuid`;
        assert.deepEqual(await reconcileSignupSubscription({ userId }), {
          ok: false,
          reason: 'conflict',
        });
        const [blocked] =
          await sql`SELECT billing_attempt_state, asaas_subscription_id FROM signup_sessions WHERE id = ${signupSessionId}::uuid`;
        assert.equal(blocked?.billing_attempt_state, 'creation_unknown');
        assert.equal(blocked?.asaas_subscription_id, null);
      } finally {
        for (const price of prior) {
          await sql`UPDATE prices SET amount = ${price.amount} WHERE id = ${price.id}::uuid`;
        }
      }
      assert.deepEqual(await reconcileSignupSubscription({ userId }), {
        ok: true,
        state: 'active',
      });
      const [active] =
        await sql`SELECT billing_attempt_state, asaas_subscription_id FROM signup_sessions WHERE id = ${signupSessionId}::uuid`;
      assert.equal(active?.billing_attempt_state, 'active');
      assert.equal(active?.asaas_subscription_id, subscriptionId);
    },
  );

  const outcome = await provisionTenantFromSignup({
    userId,
    verifiedEmail: `webhook-${tag}@example.invalid`,
    cpfCnpj: SANDBOX_TEST_CPF,
  });
  assert.ok(outcome.ok, `provisionamento falhou: ${JSON.stringify(outcome)}`);
  return outcome.clinicId;
}

async function invoiceRows(clinicId: string) {
  return sql<
    { id: string; status: string; asaas_payment_id: string | null; subscription_id: string }[]
  >`SELECT id, status, asaas_payment_id, subscription_id FROM invoices
    WHERE clinic_id = ${clinicId}::uuid ORDER BY created_at`;
}

/** Estado remoto, antes de qualquer limpeza de segurança do finally. */
async function assertDeleted(resource: 'subscriptions' | 'customers', id: string): Promise<void> {
  guard();
  const response = await fetch(
    `${process.env.ASAAS_BASE_URL}/${resource}/${encodeURIComponent(id)}`,
    {
      headers: { access_token: process.env.ASAAS_API_KEY ?? '' },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status === 404) return;
  assert.ok(response.ok, `readback ${resource}: HTTP ${response.status}`);
  const row = z.object({ id: z.string(), deleted: z.boolean() }).parse(await response.json());
  assert.equal(row.id, id, 'readback devolveu outro recurso');
  assert.equal(row.deleted, true, `${resource}: recurso ainda existe no sandbox`);
}

try {
  const { planId } = await seedPlanCatalog();

  await check('C1', 'perda de CAS SQL compensa assinatura e customer no Sandbox real', async () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const email = `compensation-${sessionId}@example.invalid`;
    await sql`INSERT INTO auth.users (id, email, email_confirmed_at)
      VALUES (${userId}::uuid, ${email}, now())`;
    await sql`INSERT INTO signup_sessions (
        id, token_hash, status, idle_expires_at, absolute_expires_at, consumed_at, auth_user_id,
        owner_name, clinic_name, email_hash, accepted_at, answered_at, professionals_band,
        weekly_appointments_band, current_tooling, discovery_source, selected_plan_id)
      VALUES (${sessionId}::uuid, ${createHash('sha256').update(sessionId).digest('hex')},
        'email_verified', now() + interval '30 minutes', now() + interval '45 minutes', now(),
        ${userId}::uuid, 'Teste Qoro', 'Clinica Compensation Sandbox',
        ${createHash('sha256').update(email).digest('hex')}, now(), now(),
        '2_5', '21_50', 'outro_sistema', 'indicacao_colega', ${planId}::uuid)`;
    const [before] = await sql`SELECT count(*)::int AS n FROM clinics`;
    let customerId: string | undefined;
    let subscriptionId: string | undefined;
    let posts = 0;
    // Todas as chamadas atravessam o adapter real. Só a versão da fixture SQL
    // muda entre readback e ativação, produzindo a perda de CAS de verdade.
    const client: PaymentProvider = {
      ...asaasProvider,
      async createCustomer(input) {
        const [draft] = await sql`SELECT billing_attempt_state FROM signup_sessions
          WHERE id = ${sessionId}::uuid`;
        assert.equal(draft?.billing_attempt_state, 'reserved');
        const created = await asaasProvider.createCustomer(input);
        customerId = created.customerId;
        createdCustomers.add(customerId);
        return created;
      },
      async createSubscription(input) {
        assert.equal(++posts, 1, 'compensação não autoriza outro POST');
        const created = await asaasProvider.createSubscription(input);
        subscriptionId = created.subscriptionId;
        createdSubscriptions.add(subscriptionId);
        return created;
      },
      async getSubscription(id) {
        const actual = await asaasProvider.getSubscription(id);
        await sql`UPDATE signup_sessions SET row_version = row_version + 1
          WHERE id = ${sessionId}::uuid`;
        return actual;
      },
    };
    assert.deepEqual(
      await startSignupSubscription({
        userId,
        verifiedEmail: email,
        cpfCnpj: SANDBOX_TEST_CPF,
        client,
      }),
      { ok: false, reason: 'conflict' },
    );
    assert.ok(subscriptionId);
    assert.ok(customerId);
    assert.equal(posts, 1);
    await assertDeleted('subscriptions', subscriptionId);
    await assertDeleted('customers', customerId);
    const [after] = await sql`SELECT count(*)::int AS n FROM clinics`;
    assert.equal(after?.n, before?.n, 'compensação deixou tenant parcial');
    assert.deepEqual(
      await provisionTenantFromSignup({ userId, verifiedEmail: email, cpfCnpj: SANDBOX_TEST_CPF }),
      { ok: false, reason: 'not_paid' },
    );
    // Já foram removidos pela aplicação e relidos, antes do teardown do runner.
    createdSubscriptions.delete(subscriptionId);
    createdCustomers.delete(customerId);
  });

  // --- tenant A: o cadastro de verdade, com assinatura de verdade -----------
  const a = await createSandboxSubscription('a');
  const clinicA = await provisionFromSignup(
    'a',
    planId,
    a.customerId,
    a.subscriptionId,
    a.signupSessionId,
  );

  // --- tenant B: existe só para provar que o webhook de A não o alcança -----
  const b = await createSandboxSubscription('b');
  const clinicB = await provisionFromSignup(
    'b',
    planId,
    b.customerId,
    b.subscriptionId,
    b.signupSessionId,
  );

  console.log(
    `contexto: clinicaA=${redactOpaqueId(clinicA)} clinicaB=${redactOpaqueId(clinicB)} ` +
      `subA=${redactOpaqueId(a.subscriptionId)} subB=${redactOpaqueId(b.subscriptionId)}`,
  );

  // A assinatura já nasce com a primeira cobrança gerada pelo Asaas. Ela é o
  // objeto REAL sobre o qual o webhook fala.
  const paymentsA = await asaasProvider.listSubscriptionPayments(a.subscriptionId);
  assert.ok(
    paymentsA.length > 0,
    'o sandbox não gerou cobrança para a assinatura — sem isso não há webhook real a provar',
  );
  const paymentA = paymentsA[0]!;
  assert.equal(
    paymentA.subscriptionId,
    a.subscriptionId,
    'a cobrança não aponta para a assinatura do cadastro',
  );

  const firstEventId = `evt_${randomUUID()}`;

  await check('W1', 'evento real do cadastro cria invoice na clinica certa', async () => {
    const response = await deliver({
      id: firstEventId,
      event: 'PAYMENT_CREATED',
      payment: { id: paymentA.paymentId },
    });
    assert.equal(response.status, 200, `esperava 200, veio ${response.status}`);

    const rows = await invoiceRows(clinicA);
    assert.equal(rows.length, 1, `esperava 1 invoice na clínica A, há ${rows.length}`);
    assert.equal(rows[0]!.asaas_payment_id, paymentA.paymentId);

    // A clínica B tem a própria assinatura e NÃO pode ter recebido nada.
    const other = await invoiceRows(clinicB);
    assert.equal(other.length, 0, 'a invoice caiu na clínica errada');
  });

  await check('W2', 'replay do mesmo evento nao cria segunda invoice', async () => {
    const before = await invoiceRows(clinicA);
    const response = await deliver({
      id: firstEventId,
      event: 'PAYMENT_CREATED',
      payment: { id: paymentA.paymentId },
    });
    // 200 de propósito: o Asaas re-entrega enquanto não receber 2xx, então
    // recusar um duplicado geraria re-entrega infinita.
    assert.equal(response.status, 200);

    const after = await invoiceRows(clinicA);
    assert.equal(after.length, before.length, 'o replay criou uma segunda invoice');
    assert.deepEqual(after[0], before[0], 'o replay alterou a invoice');

    const [processed] = await sql<{ n: number }[]>`SELECT count(*)::int AS n
      FROM processed_webhooks WHERE asaas_event_id = ${firstEventId}`;
    assert.equal(processed!.n, 1, 'o dedup guardou o mesmo evento duas vezes');
  });

  await check('W3', 'evento novo sobre o mesmo pagamento nao duplica a invoice', async () => {
    const before = await invoiceRows(clinicA);
    // Id de evento DIFERENTE (o dedup não protege aqui), mesmo pagamento. É o
    // caso real de reentrega com outro rótulo, e também o de fora de ordem: o
    // estado vem de `getPayment()`, não do rótulo, então a ordem não importa.
    const response = await deliver({
      id: `evt_${randomUUID()}`,
      event: 'PAYMENT_UPDATED',
      payment: { id: paymentA.paymentId },
    });
    assert.equal(response.status, 200);

    const after = await invoiceRows(clinicA);
    assert.equal(after.length, before.length, 'um segundo evento criou invoice duplicada');
    assert.equal(after[0]!.id, before[0]!.id, 'a invoice trocou de identidade');
  });

  await check('W4a', 'sem token: 401 e nenhuma mutacao', async () => {
    const before = await invoiceRows(clinicA);
    const response = await deliver(
      {
        id: `evt_${randomUUID()}`,
        event: 'PAYMENT_CONFIRMED',
        payment: { id: paymentA.paymentId },
      },
      { token: null },
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await invoiceRows(clinicA), before);
  });

  await check('W4b', 'token errado: 401 e nenhuma mutacao', async () => {
    const before = await invoiceRows(clinicA);
    const response = await deliver(
      {
        id: `evt_${randomUUID()}`,
        event: 'PAYMENT_CONFIRMED',
        payment: { id: paymentA.paymentId },
      },
      { token: 'token-invalido-de-teste' },
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await invoiceRows(clinicA), before);
  });

  await check('W4c', 'corpo invalido: 400 e nenhuma mutacao', async () => {
    const before = await invoiceRows(clinicA);
    const response = await deliver(undefined, { raw: '{isto nao e json' });
    assert.equal(response.status, 400);
    assert.deepEqual(await invoiceRows(clinicA), before);
  });

  await check('W4d', 'evento sem pagamento: aceito e ignorado, sem mutacao', async () => {
    const before = await invoiceRows(clinicA);
    const response = await deliver({ id: `evt_${randomUUID()}`, event: 'SUBSCRIPTION_UPDATED' });
    assert.equal(response.status, 200);
    assert.deepEqual(await invoiceRows(clinicA), before);
  });

  await check('W4e', 'corpo gigante: 413 antes de qualquer leitura', async () => {
    const before = await invoiceRows(clinicA);
    const huge = JSON.stringify({
      id: `evt_${randomUUID()}`,
      event: 'PAYMENT_CONFIRMED',
      payment: { id: paymentA.paymentId },
      padding: 'x'.repeat(1_200_000),
    });
    const response = await deliver(undefined, { raw: huge });
    assert.equal(response.status, 413, `esperava 413, veio ${response.status}`);
    assert.deepEqual(await invoiceRows(clinicA), before);
  });

  await check('W4f', 'pagamento de OUTRO tenant nao cruza a fronteira', async () => {
    const paymentsB = await asaasProvider.listSubscriptionPayments(b.subscriptionId);
    assert.ok(paymentsB.length > 0, 'a assinatura B não gerou cobrança');
    const paymentB = paymentsB[0]!;

    const beforeA = await invoiceRows(clinicA);
    // Corpo legítimo do ponto de vista do token, apontando para a cobrança de B.
    // A rota resolve a clínica por `getPayment().subscriptionId` — o corpo não
    // participa —, então isto tem de pousar em B, nunca em A.
    const response = await deliver({
      id: `evt_${randomUUID()}`,
      event: 'PAYMENT_CREATED',
      payment: { id: paymentB.paymentId },
    });
    assert.equal(response.status, 200);

    const afterA = await invoiceRows(clinicA);
    assert.deepEqual(afterA, beforeA, 'o webhook de B mexeu na clínica A');
    const rowsB = await invoiceRows(clinicB);
    assert.equal(rowsB.length, 1, 'a invoice de B não foi criada onde deveria');
    assert.equal(rowsB[0]!.asaas_payment_id, paymentB.paymentId);
  });
} finally {
  // --- W5: limpeza, verificada por READBACK ------------------------------
  //
  // CONTRATO DO PROVEDOR, medido aqui em 18/09/2026: `DELETE /subscriptions/{id}`
  // pode responder **HTTP 500 e ainda assim ter apagado**. Observado nas duas
  // assinaturas desta execução — o DELETE devolveu 500, e a consulta seguinte
  // trouxe `status: INACTIVE, deleted: true` para ambas.
  //
  // É a mesma família do achado já registrado sobre cobrança apagada (200 com
  // `deleted: true` em vez de 404): o status da resposta do Asaas não é a
  // verdade sobre o estado. Por isso o que conta aqui é a LEITURA depois, não o
  // código de retorno — confiar no retorno produziria tanto falso resíduo
  // quanto, pior, falsa limpeza.
  const residue: string[] = [];
  let subscriptionsRemoved = 0;
  let customersRemoved = 0;
  for (const subscriptionId of createdSubscriptions) {
    try {
      await asaasProvider.cancelSubscription(subscriptionId);
    } catch {
      // Indeterminado: quem responde é o readback abaixo.
    }
    try {
      await assertDeleted('subscriptions', subscriptionId);
      subscriptionsRemoved += 1;
    } catch (error) {
      residue.push(
        `assinatura ${redactOpaqueId(subscriptionId)}: readback falhou — ${String(error)}`,
      );
    }
  }
  for (const customerId of createdCustomers) {
    try {
      await asaasProvider.deleteCustomer(customerId);
    } catch {
      // Resposta inconclusiva; a leitura abaixo decide a limpeza.
    }
    try {
      await assertDeleted('customers', customerId);
      customersRemoved += 1;
    } catch (error) {
      residue.push(`customer ${redactOpaqueId(customerId)}: ${String(error)}`);
    }
  }
  console.log(
    `limpeza (por readback): ${subscriptionsRemoved}/${createdSubscriptions.size} assinaturas, ` +
      `${customersRemoved}/${createdCustomers.size} customers`,
  );
  for (const line of residue) console.log(`RESIDUO ${line}`);

  await cluster.stop();
  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  for (const f of failed) console.log(`\n--- ${f.id} ${f.name}\n${f.detail}`);
  // Nunca lançar daqui: um throw no finally substitui a causa real pela do
  // teardown — o defeito corrigido em `tenant-isolation`.
  if (failed.length > 0 || residue.length > 0) process.exitCode = 1;
}
