/**
 * O-6 — provisionamento contra o SCHEMA REAL, em Postgres descartável.
 *
 * O harness de cadastro (`signup-regression`) recria à mão um `clinics(id, nome)`
 * mínimo, o que basta para provar a sessão e não basta para provar o tenant.
 * Aqui todas as migrations de verdade são aplicadas em ordem: as mesmas
 * constraints, os mesmos grants, o mesmo RLS, as mesmas funções, o mesmo
 * catálogo de eventos de outbox.
 *
 * O que se prova:
 *   1. execução normal → uma clínica, um owner, uma config, um customer, uma
 *      assinatura e os eventos de outbox, com os vínculos corretos;
 *   2. concorrência → duas abas, um tenant; a perdedora não chega a inserir;
 *   3. repetição depois do sucesso → nenhum segundo tenant;
 *   4. sessão sem assinatura confirmada → nada criado;
 *   5. plano sem preço ativo → nada criado;
 *   6. RLS + least privilege → o runtime de um tenant não alcança o outro;
 *   7. falha SQL e crash em etapas observadas → rollback integral e retomada;
 *   8. compensação → estado SQL real e chamadas a provider STUB explícito.
 *      Não prova cancelamento ou exclusão no Asaas externo.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PaymentProvider } from '../../src/lib/payments/asaas';

import { readMigrations, startScratchSchema } from './scratch-schema';

const PORT = 55462;
const root = process.cwd();
const results: { name: string; status: 'PASS' | 'FAIL'; detail?: string }[] = [];

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    results.push({ name, status: 'PASS' });
    console.log(`PASS ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    results.push({ name, status: 'FAIL', detail });
    console.log(`FAIL ${name}: ${detail.split('\n')[0]}`);
  }
}

/**
 * Modo filho do teste de crash.
 *
 * Roda ANTES de qualquer cluster ser criado: ele não sobe banco nenhum, usa o
 * do pai por `DATABASE_URL` herdada. Provisiona de verdade e fica à mercê do
 * pai, que só o mata depois de observar no Postgres o bloqueio deliberado de
 * um trigger, em uma etapa conhecida da transação.
 */
const childFlag = process.argv.find((a) => a.startsWith('--provision-child='));
if (childFlag) {
  const { provisionTenantFromSignup: provision } =
    await import('../../src/contexts/onboarding/internal/signup-provision');
  const outcome = await provision({
    userId: childFlag.slice('--provision-child='.length),
    verifiedEmail: 'crash@example.invalid',
    cpfCnpj: '24971563792',
  });
  process.exit(outcome.ok ? 0 : 4);
}

const cluster = await startScratchSchema({ port: PORT });
const sql = cluster.sql;

// O Supabase concede SELECT nessas tabelas a `authenticated` por default ACL
// antes das migrations. O Postgres descartável não reproduz esse default;
// o readback no DEV confirma os três grants (probe-offer-seat-access-dev).
// Sem eles, o teste do gate mede um erro da fixture, não o trial do produto.
await sql`GRANT SELECT ON public.clinics, public.subscriptions, public.profiles TO authenticated`;

// A aplicação lê a conexão de `DATABASE_URL` no momento do import.
// Neutraliza aliases herdados: `env.ts` promove DATABASE_URL_DEV fora de
// production, e o runtime pool prefere DATABASE_URL_RUNTIME. Todos os pools
// desta prova precisam apontar para o mesmo Postgres descartável.
process.env.DATABASE_URL = cluster.url;
process.env.DATABASE_URL_DEV = cluster.url;
process.env.DATABASE_URL_RUNTIME = cluster.url;
process.env.SUPABASE_PROJECT_ENV = 'dev';
process.env.SIGNUP_IDENTITY_ENABLED = 'true';
process.env.SIGNUP_AUTH_ENABLED = 'true';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'sb_publishable_test';
process.env.MAGIC_TOKEN_SECRET ??= 'synthetic-local-provision-only-magic-token';
process.env.LOGIN_HASH_PEPPER ??= 'synthetic-local-provision-only-hash-pepper';
// Chaves sintéticas, deste processo e deste cluster efêmero. O ponto é
// exercitar o caminho REAL de cifra, não pular por cima dele.
process.env.CRYPTO_SECRET_BACKEND ??= 'env';
process.env.CRYPTO_MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT ??= Buffer.alloc(32, 9).toString('base64');
process.env.LOG_LEVEL ??= 'error';

const { provisionTenantFromSignup } =
  await import('../../src/contexts/onboarding/internal/signup-provision');
const { reserveSignupBillingAttempt } =
  await import('../../src/contexts/onboarding/internal/signup-billing');
const { startSignupSubscription } =
  await import('../../src/contexts/onboarding/internal/signup-checkout');
const { asaasProvider, BillingProviderError } = await import('../../src/lib/payments/asaas');
const { requestPlanChange } = await import('../../src/contexts/billing/internal/plan-changes');
const { withTenant } = await import('../../src/lib/db/tenant');
const { assertClinicCanWriteTx, ClinicAccessError } = await import('../../src/lib/tenant-access');

const CPF = '24971563792';
/** Resolvidos do catálogo que a própria migration 0026 semeia. */
let PLAN_ID = '';
let PLAN_NO_PRICE_ID = '';
let provisionedClinicId = '';

/**
 * Usa o catálogo REAL (`solo`/`clinica`/`pro`).
 *
 * Inserir planos próprios não é opção: `plans_code_uniq` recusa, e os códigos
 * são um enum fechado do contrato de eventos de billing
 * (`SubscriptionCreatedSchema.planCode`). Um plano fora do enum quebraria o
 * provisionamento DEPOIS da cobrança — o pior momento possível.
 */
async function seedCatalog(): Promise<void> {
  const [solo] = await sql<{ id: string }[]>`SELECT id FROM plans WHERE code = 'solo'`;
  const [pro] = await sql<{ id: string }[]>`SELECT id FROM plans WHERE code = 'pro'`;
  assert.ok(solo && pro, 'a migration deveria ter semeado solo e pro');
  PLAN_ID = solo.id;
  PLAN_NO_PRICE_ID = pro.id;

  await sql`INSERT INTO prices (plan_id, amount, currency, billing_cycle, active_from)
    SELECT ${PLAN_ID}::uuid, 149.00, 'BRL', 'monthly', now() - interval '1 day'
    WHERE NOT EXISTS (
      SELECT 1 FROM prices WHERE plan_id = ${PLAN_ID}::uuid AND billing_cycle = 'monthly'
        AND currency = 'BRL' AND active_until IS NULL AND campaign_code IS NULL
    )`;

  // "Plano sem preço" precisa ser um estado real, não uma suposição.
  await sql`UPDATE prices SET active_until = now() - interval '1 hour'
    WHERE plan_id = ${PLAN_NO_PRICE_ID}::uuid AND active_until IS NULL`;
}

interface SeedOptions {
  billingState?: 'active' | 'reserved' | 'creation_unknown' | null;
  planId?: string | null;
}

/** Cria um draft verificado no MESMO formato que o funil produz. */
async function seedSession(tag: string, options: SeedOptions = {}): Promise<string> {
  const userId = randomUUID();
  // `profiles.id` tem FK para `auth.users(id)` (migration 0003). Na realidade o
  // usuário nasce no GoTrue ANTES do provisionamento — o e-mail já foi
  // confirmado. O seed reproduz essa ordem em vez de contorná-la.
  await sql`INSERT INTO auth.users (id, email, email_confirmed_at)
    VALUES (${userId}::uuid, ${`provision-${tag}@example.invalid`}, now())`;

  const tokenHash = createHash('sha256').update(`provision-${tag}`).digest('hex');
  const emailHash = createHash('sha256').update(`provision-${tag}@example.invalid`).digest('hex');
  const billingState = options.billingState === undefined ? 'active' : options.billingState;
  const planId = options.planId === undefined ? PLAN_ID : options.planId;

  await sql`INSERT INTO signup_sessions (
      token_hash, status, idle_expires_at, absolute_expires_at, consumed_at, auth_user_id,
      owner_name, clinic_name, email_hash, accepted_at, answered_at, professionals_band,
      weekly_appointments_band, current_tooling, discovery_source, selected_plan_id,
      billing_attempt_state, billing_attempted_at, asaas_customer_id, asaas_subscription_id)
    VALUES (
      ${tokenHash}, 'email_verified', now() + interval '30 minutes',
      now() + interval '45 minutes', now(), ${userId}::uuid,
      'Ana Prado', ${`Clinica ${tag}`}, ${emailHash}, now(), now(),
      '2_5', '21_50', 'outro_sistema', 'indicacao_colega', ${planId}::uuid,
      ${billingState}, ${billingState ? sql`now()` : null},
      ${billingState === 'active' ? `cus_${tag}` : null},
      ${billingState === 'active' ? `sub_${tag}` : null})`;
  return userId;
}

async function clinicCount(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM clinics`;
  return row!.n;
}

/** Compara todas as entidades escritas pela transação, não só a clínica. */
async function tenantCounts(): Promise<Record<string, number>> {
  const [counts] = await sql<Record<string, number>[]>`SELECT
    (SELECT count(*)::int FROM clinics) AS clinics,
    (SELECT count(*)::int FROM profiles) AS profiles,
    (SELECT count(*)::int FROM ai_clinic_config) AS config,
    (SELECT count(*)::int FROM billing_customers) AS customers,
    (SELECT count(*)::int FROM subscriptions) AS subscriptions,
    (SELECT count(*)::int FROM outbox) AS events`;
  assert.ok(counts);
  return { ...counts };
}

/**
 * Provider deliberadamente em memória: só testa a orquestração + SQL real.
 * Qualquer método fora dos seis previstos explode, sem alcançar a rede.
 */
function compensationStub(userId: string, mode: 'declined' | 'mismatch' | 'cas') {
  const calls: string[] = [];
  const customerId = `stub_customer_${mode}`;
  const subscriptionId = `stub_subscription_${mode}`;
  let value = 0;
  let externalReference = '';
  const methods: Pick<
    PaymentProvider,
    | 'findSubscriptionByExternalReference'
    | 'createCustomer'
    | 'createSubscription'
    | 'getSubscription'
    | 'cancelSubscription'
    | 'deleteCustomer'
  > = {
    async findSubscriptionByExternalReference(reference) {
      // Consulta em outra conexão: a reserva já precisa estar COMMITADA antes
      // da primeira chamada ao provider, não apenas pendente na mesma tx.
      const [draft] = await sql<{ state: string; id: string }[]>`
        SELECT billing_attempt_state AS state, id FROM signup_sessions
        WHERE auth_user_id = ${userId}::uuid`;
      assert.equal(draft?.state, 'reserved');
      assert.equal(reference, `signup:${draft?.id}`);
      calls.push('find');
      return null;
    },
    async createCustomer() {
      calls.push('createCustomer');
      return { customerId };
    },
    async createSubscription(input) {
      calls.push('createSubscription');
      if (mode === 'declined') {
        throw new BillingProviderError('synthetic refusal', 'billing_provider_error', 400, [
          'invalid_object',
        ]);
      }
      value = input.value;
      externalReference = input.externalReference ?? '';
      assert.equal(input.customerId, customerId);
      return { subscriptionId };
    },
    async getSubscription(id) {
      assert.equal(id, subscriptionId);
      calls.push('getSubscription');
      if (mode === 'cas') {
        // Perda de CAS produzida no banco, não mock da função de ativação.
        await sql`UPDATE signup_sessions SET row_version = row_version + 1
          WHERE auth_user_id = ${userId}::uuid`;
      }
      return {
        subscriptionId,
        status: 'ACTIVE',
        value: mode === 'mismatch' ? value + 1 : value,
        customerId,
        externalReference,
        cycle: 'MONTHLY',
        nextDueDate: '2026-10-03',
        billingType: 'UNDEFINED',
      };
    },
    async cancelSubscription(id) {
      assert.equal(id, subscriptionId);
      calls.push('cancelSubscription');
    },
    async deleteCustomer(id) {
      assert.equal(id, customerId);
      calls.push('deleteCustomer');
    },
  };
  const client = new Proxy(asaasProvider, {
    get(_target, method) {
      if (Object.hasOwn(methods, method)) return Reflect.get(methods, method);
      throw new Error(`provider stub: metodo inesperado ${String(method)}`);
    },
  });
  return { client, calls };
}

try {
  await seedCatalog();

  await check('execucao normal: tenant, owner, config, customer, assinatura e outbox', async () => {
    const userId = await seedSession('normal');
    const result = await provisionTenantFromSignup({
      userId,
      verifiedEmail: 'dona@example.invalid',
      cpfCnpj: CPF,
    });
    assert.ok(result.ok, `provisionamento falhou: ${JSON.stringify(result)}`);
    const clinicId = result.clinicId;
    provisionedClinicId = clinicId;

    const [counts] = await sql<
      { profiles: number; config: number; customers: number; subs: number; events: number }[]
    >`SELECT
        (SELECT count(*)::int FROM profiles WHERE clinic_id = ${clinicId}::uuid) AS profiles,
        (SELECT count(*)::int FROM ai_clinic_config WHERE clinic_id = ${clinicId}::uuid) AS config,
        (SELECT count(*)::int FROM billing_customers WHERE clinic_id = ${clinicId}::uuid) AS customers,
        (SELECT count(*)::int FROM subscriptions WHERE clinic_id = ${clinicId}::uuid) AS subs,
        (SELECT count(*)::int FROM outbox WHERE clinic_id = ${clinicId}::uuid) AS events`;
    assert.deepEqual(
      {
        profiles: counts!.profiles,
        config: counts!.config,
        customers: counts!.customers,
        subs: counts!.subs,
      },
      { profiles: 1, config: 1, customers: 1, subs: 1 },
      'cardinalidade das entidades do tenant',
    );
    assert.ok(counts!.events >= 2, `esperado >= 2 eventos de outbox, veio ${counts!.events}`);

    const [owner] = await sql<{ role: string; ativo: boolean }[]>`
      SELECT role, ativo FROM profiles WHERE clinic_id = ${clinicId}::uuid`;
    assert.equal(owner?.role, 'owner', 'o papel e fixado no servidor');
    assert.equal(owner?.ativo, true);

    const [clinic] = await sql<{ status: string; slug: string }[]>`
      SELECT status, slug FROM clinics WHERE id = ${clinicId}::uuid`;
    assert.equal(clinic?.status, 'trial');
    assert.match(clinic!.slug, /^[a-z0-9-]{3,30}$/u, 'slug respeita o CHECK do banco');

    // O documento descansa CIFRADO, nunca em claro.
    const [customer] = await sql<{ document_encrypted: string | null }[]>`
      SELECT document_encrypted FROM billing_customers WHERE clinic_id = ${clinicId}::uuid`;
    assert.ok(customer?.document_encrypted, 'documento deveria estar persistido');
    assert.ok(!customer.document_encrypted.includes(CPF), 'documento NAO pode estar em claro');

    const [sub] = await sql<{ asaas_subscription_id: string; billing_status: string }[]>`
      SELECT asaas_subscription_id, billing_status FROM subscriptions
      WHERE clinic_id = ${clinicId}::uuid`;
    assert.equal(sub?.asaas_subscription_id, 'sub_normal', 'vinculo com a assinatura do provedor');
    assert.equal(sub?.billing_status, 'trial');

    // A sessão sumiu, e com ela a PII do funil.
    const [left] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM signup_sessions WHERE auth_user_id = ${userId}::uuid`;
    assert.equal(left?.n, 0, 'a sessao deveria ter sido consumida pelo DELETE');
  });

  await check(
    'médico adicional: upgrade 397 → 544 reserva uma alteração no banco real',
    async () => {
      assert.ok(provisionedClinicId, 'provisionamento de controle ausente');
      await sql`UPDATE plans SET ativo = true
      WHERE code IN ('clinica_2026_2', 'clinica_2026_3')`;
      const [target] = await sql<{ id: string }[]>`
      SELECT id FROM plans WHERE code = 'clinica_2026_3'`;
      assert.ok(target);
      await sql`UPDATE subscriptions SET
      plan_id = (SELECT id FROM plans WHERE code = 'clinica_2026_2'),
      price_id = (SELECT pr.id FROM prices pr JOIN plans p ON p.id = pr.plan_id
        WHERE p.code = 'clinica_2026_2' AND pr.billing_cycle = 'monthly'
          AND pr.active_until IS NULL AND pr.campaign_code IS NULL),
      billing_status = 'active',
      current_period_start = now() - interval '7 days',
      current_period_end = now() + interval '23 days'
      WHERE clinic_id = ${provisionedClinicId}::uuid`;
      const [owner] = await sql<{ id: string }[]>`
      SELECT id FROM profiles WHERE clinic_id = ${provisionedClinicId}::uuid AND role = 'owner'`;
      assert.ok(owner);
      const change = await withTenant(provisionedClinicId, (tx) =>
        requestPlanChange(tx, {
          clinicId: provisionedClinicId,
          targetPlanId: target.id,
          requestedBy: owner.id,
          idempotencyKey: randomUUID(),
          request: { ip: null, origin: null, requestId: 'scratch-extra-doctor' },
        }),
      );
      assert.equal(change.kind, 'upgrade');
      assert.equal(change.status, 'pending_payment');
      assert.ok(Number(change.prorationAmount) > 0 && Number(change.prorationAmount) < 147);
      const [stored] = await sql<{ status: string; amount: string; subscription_count: number }[]>`
      SELECT c.status, c.proration_amount::text AS amount,
        (SELECT count(*)::int FROM subscriptions WHERE clinic_id = ${provisionedClinicId}::uuid)
          AS subscription_count
      FROM subscription_change_requests c WHERE c.id = ${change.id}::uuid`;
      assert.equal(stored?.status, 'pending_payment');
      assert.equal(stored?.amount, change.prorationAmount);
      assert.equal(stored?.subscription_count, 1, 'upgrade criou outra assinatura');
    },
  );

  await check('trial de 14 dias: escrita fecha ao vencer e reabre após pagamento', async () => {
    assert.ok(provisionedClinicId, 'provisionamento de controle ausente');
    await sql`UPDATE subscriptions SET billing_status = 'trial',
      enforce_trial_deadline = true, trial_ends_at = now() - interval '1 second'
      WHERE clinic_id = ${provisionedClinicId}::uuid`;
    await assert.rejects(
      withTenant(provisionedClinicId, (tx) => assertClinicCanWriteTx(tx, provisionedClinicId)),
      (error: unknown) => {
        const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
        assert.ok(
          error instanceof ClinicAccessError,
          `erro inesperado: ${String(cause ?? error).split('\n')[0]}`,
        );
        assert.equal(error.status, 'pending_payment');
        return true;
      },
    );
    await sql`UPDATE subscriptions SET trial_ends_at = now() + interval '14 days'
      WHERE clinic_id = ${provisionedClinicId}::uuid`;
    await withTenant(provisionedClinicId, (tx) => assertClinicCanWriteTx(tx, provisionedClinicId));
    await sql`UPDATE subscriptions SET trial_ends_at = now() - interval '1 second'
      WHERE clinic_id = ${provisionedClinicId}::uuid`;
    await sql`UPDATE subscriptions SET billing_status = 'active'
      WHERE clinic_id = ${provisionedClinicId}::uuid`;
    await withTenant(provisionedClinicId, (tx) => assertClinicCanWriteTx(tx, provisionedClinicId));
  });

  await check('duas abas: um tenant, e a perdedora nao deixa residuo', async () => {
    const userId = await seedSession('race');
    const before = await clinicCount();

    const [a, b] = await Promise.all([
      provisionTenantFromSignup({ userId, verifiedEmail: 'dona@example.invalid', cpfCnpj: CPF }),
      provisionTenantFromSignup({ userId, verifiedEmail: 'dona@example.invalid', cpfCnpj: CPF }),
    ]);
    assert.equal([a, b].filter((r) => r.ok).length, 1, 'exatamente uma execucao pode vencer');

    // O FOR UPDATE serializa: a perdedora encontra a sessão já removida e não
    // chega a inserir. Rollback de escrita é provado separadamente abaixo.
    assert.equal((await clinicCount()) - before, 1, 'a perdedora deixou clinica orfa');
  });

  await check(
    'falha SQL apos o DELETE da sessao faz rollback integral e permite retomada',
    async () => {
      const userId = await seedSession('sql-failure');
      const before = await tenantCounts();
      // O outbox é escrito depois das cinco entidades e do DELETE da sessão.
      // Um erro aqui precisa desfazer tudo, inclusive restaurar o draft ativo.
      await sql.unsafe(`CREATE FUNCTION qoro_test_reject_outbox() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'synthetic_signup_outbox_failure' USING ERRCODE = '23514';
      END $$;
      CREATE TRIGGER qoro_test_reject_outbox BEFORE INSERT ON outbox
      FOR EACH ROW EXECUTE FUNCTION qoro_test_reject_outbox()`);
      try {
        await assert.rejects(
          provisionTenantFromSignup({
            userId,
            verifiedEmail: 'failure@example.invalid',
            cpfCnpj: CPF,
          }),
          (error: unknown) => {
            // Drizzle preserva o erro SQL em cause, sem expor valores de query.
            assert.ok(error instanceof Error);
            const cause = error.cause;
            assert.ok(cause instanceof Error);
            assert.match(cause.message, /synthetic_signup_outbox_failure/u);
            return true;
          },
        );
        assert.deepEqual(await tenantCounts(), before, 'erro SQL deixou entidade parcial');
        const [draft] = await sql<{ state: string; subscription_id: string }[]>`
        SELECT billing_attempt_state AS state, asaas_subscription_id AS subscription_id
        FROM signup_sessions WHERE auth_user_id = ${userId}::uuid`;
        assert.equal(draft?.state, 'active', 'rollback nao restaurou o draft');
        assert.equal(draft?.subscription_id, 'sub_sql-failure');
      } finally {
        await sql.unsafe(
          'DROP TRIGGER qoro_test_reject_outbox ON outbox; DROP FUNCTION qoro_test_reject_outbox()',
        );
      }
      const resumed = await provisionTenantFromSignup({
        userId,
        verifiedEmail: 'failure@example.invalid',
        cpfCnpj: CPF,
      });
      assert.ok(resumed.ok, 'retomada depois de remover a falha SQL nao convergiu');
      assert.equal((await clinicCount()) - before.clinics!, 1);
    },
  );

  for (const mode of ['declined', 'mismatch', 'cas'] as const) {
    await check(`compensacao ${mode}: SQL real + provider STUB (sem prova externa)`, async () => {
      const userId = await seedSession(`compensation-${mode}`, { billingState: null });
      const before = await tenantCounts();
      const { client, calls } = compensationStub(userId, mode);
      const result = await startSignupSubscription({
        userId,
        verifiedEmail: 'compensation@example.invalid',
        cpfCnpj: CPF,
        client,
      });
      assert.deepEqual(result, { ok: false, reason: mode === 'cas' ? 'conflict' : 'declined' });
      assert.deepEqual(
        calls,
        mode === 'declined'
          ? ['find', 'createCustomer', 'createSubscription', 'deleteCustomer']
          : [
              'find',
              'createCustomer',
              'createSubscription',
              'getSubscription',
              'cancelSubscription',
              'deleteCustomer',
            ],
      );
      const [draft] = await sql<
        {
          state: string;
          failure: string | null;
          customer_id: string | null;
          subscription_id: string | null;
        }[]
      >`SELECT billing_attempt_state AS state, billing_failure_code AS failure,
          asaas_customer_id AS customer_id, asaas_subscription_id AS subscription_id
        FROM signup_sessions WHERE auth_user_id = ${userId}::uuid`;
      assert.equal(draft?.state, mode === 'cas' ? 'reserved' : 'failed');
      assert.equal(
        draft?.failure,
        mode === 'declined'
          ? 'invalid_object'
          : mode === 'mismatch'
            ? 'subscription_readback_mismatch'
            : null,
      );
      assert.equal(draft?.customer_id, null);
      assert.equal(draft?.subscription_id, null);
      assert.deepEqual(await tenantCounts(), before, 'compensacao criou entidade de tenant');
      assert.deepEqual(
        await provisionTenantFromSignup({
          userId,
          verifiedEmail: 'compensation@example.invalid',
          cpfCnpj: CPF,
        }),
        { ok: false, reason: 'not_paid' },
      );
    });
  }

  await check('repetir depois do sucesso nao cria segundo tenant', async () => {
    const userId = await seedSession('repeat');
    const first = await provisionTenantFromSignup({
      userId,
      verifiedEmail: 'dona@example.invalid',
      cpfCnpj: CPF,
    });
    assert.ok(first.ok);
    const before = await clinicCount();

    const second = await provisionTenantFromSignup({
      userId,
      verifiedEmail: 'dona@example.invalid',
      cpfCnpj: CPF,
    });
    assert.deepEqual(second, { ok: false, reason: 'gone' }, 'a sessao ja foi consumida');
    assert.equal(await clinicCount(), before);
  });

  await check('sem assinatura confirmada nao nasce tenant', async () => {
    for (const state of ['reserved', 'creation_unknown', null] as const) {
      const userId = await seedSession(`nopay-${state ?? 'none'}`, { billingState: state });
      const before = await clinicCount();
      const result = await provisionTenantFromSignup({
        userId,
        verifiedEmail: 'dona@example.invalid',
        cpfCnpj: CPF,
      });
      assert.deepEqual(result, { ok: false, reason: 'not_paid' }, `estado ${state}`);
      assert.equal(await clinicCount(), before, `estado ${state} criou clinica`);
    }
  });

  await check('plano sem preco ativo nao nasce tenant', async () => {
    const userId = await seedSession('noprice', { planId: PLAN_NO_PRICE_ID });
    const before = await clinicCount();
    const result = await provisionTenantFromSignup({
      userId,
      verifiedEmail: 'dona@example.invalid',
      cpfCnpj: CPF,
    });
    assert.deepEqual(result, { ok: false, reason: 'invalid_plan' });
    assert.equal(await clinicCount(), before);
  });

  await check('plano fora do enum de eventos e recusado ANTES do provedor', async () => {
    // A coluna `plans.code` e texto livre; o enum fechado vive no contrato de
    // eventos (`SubscriptionCreatedSchema.planCode`). Sem o guard, este plano
    // viraria assinatura no Asaas e so explodiria no `publishEvent`, dentro da
    // transacao de provisionamento — pessoa pagando, sem clinica, e o retry
    // repetindo o mesmo erro. Foi assim que o defeito apareceu aqui.
    const [rogue] = await sql<{ id: string }[]>`
      INSERT INTO plans (code, name, ativo) VALUES ('essencial', 'Essencial', true)
      ON CONFLICT (code) DO UPDATE SET ativo = true RETURNING id`;
    await sql`INSERT INTO prices (plan_id, amount, currency, billing_cycle, active_from)
      SELECT ${rogue!.id}::uuid, 149.00, 'BRL', 'monthly', now() - interval '1 day'
      WHERE NOT EXISTS (
        SELECT 1 FROM prices WHERE plan_id = ${rogue!.id}::uuid AND active_until IS NULL
      )`;

    const userId = await seedSession('rogue-plan', { planId: rogue!.id, billingState: null });
    const reserved = await reserveSignupBillingAttempt(userId);

    assert.deepEqual(reserved, { ok: false, reason: 'invalid_plan' }, 'a reserva deveria recusar');

    // E nada foi reservado: a tentativa nem existe.
    const [row] = await sql<{ state: string | null }[]>`
      SELECT billing_attempt_state AS state FROM signup_sessions
      WHERE auth_user_id = ${userId}::uuid`;
    assert.equal(row?.state, null, 'nao pode haver tentativa reservada');
  });

  await check(
    'crash em sete etapas SQL observadas nao deixa tenant parcial, e a retomada converge',
    async () => {
      const lockKey = 860_006;
      const checkpoints = [
        'clinics',
        'profiles',
        'ai_clinic_config',
        'billing_customers',
        'subscriptions',
        'signup_sessions',
        'outbox',
      ] as const;
      // AFTER garante que a escrita da etapa já ocorreu dentro da transação.
      await sql.unsafe(`CREATE FUNCTION qoro_test_pause_provision() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          PERFORM pg_advisory_xact_lock(${lockKey});
          RETURN NULL;
        END $$`);
      try {
        for (const table of checkpoints) {
          const userId = await seedSession(`crash-${table}`);
          const before = await tenantCounts();
          const event = table === 'signup_sessions' ? 'DELETE' : 'INSERT';
          await sql.unsafe(`CREATE TRIGGER qoro_test_pause_provision AFTER ${event} ON ${table}
            FOR EACH ROW EXECUTE FUNCTION qoro_test_pause_provision()`);
          let backendPid: number | undefined;
          try {
            await sql.begin(async (lockTx) => {
              await lockTx`SELECT pg_advisory_xact_lock(${lockKey})`;
              // Processo que executa TypeScript diretamente. Matar o launcher
              // tsx não prova que o worker iniciou nem que a transação morreu.
              const child = spawn(
                process.execPath,
                [
                  '--conditions=react-server',
                  '--import',
                  'tsx',
                  path.join(root, 'scripts/security/signup-provision-db.ts'),
                  `--provision-child=${userId}`,
                ],
                { windowsHide: true, stdio: 'ignore', env: { ...process.env } },
              );
              const exited = new Promise<void>((resolve, reject) => {
                child.once('exit', () => resolve());
                child.once('error', reject);
              });
              try {
                const deadline = Date.now() + 30_000;
                while (Date.now() < deadline && child.exitCode === null) {
                  const [blocked] = await sql<{ pid: number }[]>`SELECT pid FROM pg_locks
                    WHERE locktype = 'advisory' AND objid = ${lockKey}::oid AND NOT granted`;
                  if (blocked) {
                    backendPid = blocked.pid;
                    break;
                  }
                  await new Promise((resolve) => setTimeout(resolve, 100));
                }
                assert.ok(backendPid, `filho nao alcancou trigger AFTER ${event} em ${table}`);
                assert.ok(child.kill('SIGKILL'), 'nao foi possivel matar o processo real');
                await exited;
              } finally {
                if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
                await exited;
              }
            });
            // O lock só foi liberado DEPOIS da morte confirmada do processo.
            // O backend volta da espera, percebe a conexão fechada e aborta.
            let stillConnected = true;
            const disconnectedBy = Date.now() + 10_000;
            while (Date.now() < disconnectedBy) {
              const [connection] = await sql<{ n: number }[]>`SELECT count(*)::int AS n
                FROM pg_stat_activity WHERE pid = ${backendPid!}`;
              stillConnected = connection?.n !== 0;
              if (!stillConnected) break;
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            assert.equal(stillConnected, false, `backend sobreviveu ao crash em ${table}`);
          } finally {
            await sql.unsafe(`DROP TRIGGER qoro_test_pause_provision ON ${table}`);
          }
          assert.deepEqual(
            await tenantCounts(),
            before,
            `crash em ${table} deixou entidade parcial`,
          );
          const [session] = await sql<{ n: number }[]>`SELECT count(*)::int AS n
            FROM signup_sessions WHERE auth_user_id = ${userId}::uuid`;
          assert.equal(session?.n, 1, `crash em ${table} consumiu a sessao`);
          const resumed = await provisionTenantFromSignup({
            userId,
            verifiedEmail: 'crash@example.invalid',
            cpfCnpj: CPF,
          });
          assert.ok(resumed.ok, `retomada apos crash em ${table} falhou`);
          assert.equal((await clinicCount()) - before.clinics!, 1, 'retomada gerou duplicata');
          console.log(`  [crash] AFTER ${event} ${table}: observado, interrompido e retomado`);
        }
      } finally {
        await sql.unsafe('DROP FUNCTION qoro_test_pause_provision()');
      }
    },
  );

  await check('RLS + least privilege: o runtime de um tenant nao alcanca o outro', async () => {
    const userA = await seedSession('rls-a');
    const userB = await seedSession('rls-b');
    const a = await provisionTenantFromSignup({
      userId: userA,
      verifiedEmail: 'a@example.invalid',
      cpfCnpj: CPF,
    });
    const b = await provisionTenantFromSignup({
      userId: userB,
      verifiedEmail: 'b@example.invalid',
      cpfCnpj: CPF,
    });
    assert.ok(a.ok && b.ok);

    // Papel REAL de runtime (NOBYPASSRLS, membro de authenticated) com o GUC
    // REAL que withTenant seta. Nada de superusuário aqui.
    await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE qoro_runtime`;
      await tx`SELECT set_config('app.current_clinic', ${a.clinicId}, true)`;

      for (const table of [
        'subscriptions',
        'billing_customers',
        'ai_clinic_config',
        'profiles',
        'clinics',
      ] as const) {
        const countRows = async (clinicId: string): Promise<number> => {
          const rows: { n: number }[] = await tx.unsafe(
            `SELECT count(*)::int AS n FROM ${table} WHERE ${table === 'clinics' ? 'id' : 'clinic_id'} = $1`,
            [clinicId],
          );
          return rows[0]!.n;
        };
        assert.equal(await countRows(a.clinicId), 1, `A deveria ver o proprio ${table}`);
        assert.equal(await countRows(b.clinicId), 0, `A enxergou ${table} de B`);
      }

      const invaded: { id: string }[] = await tx.unsafe(
        `UPDATE subscriptions SET billing_status = 'active' WHERE clinic_id = $1 RETURNING id`,
        [b.clinicId],
      );
      assert.equal(invaded.length, 0, 'A alterou a assinatura de B');
    });

    const [bSub] = await sql<{ billing_status: string }[]>`
      SELECT billing_status FROM subscriptions WHERE clinic_id = ${b.clinicId}::uuid`;
    assert.equal(bSub?.billing_status, 'trial', 'o estado de B mudou');
  });
} catch (error) {
  // Sem este catch, um erro ANTES do primeiro `check` desaparecia dentro do
  // `finally` que chama `process.exit` — o relatório dizia 0/0 PASS e não dizia
  // por quê. É o mesmo defeito que o runner de cadastro já teve.
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  results.push({ name: 'setup do harness', status: 'FAIL', detail });
  console.log(`FAIL setup do harness: ${detail.split('\n')[0]}`);
} finally {
  const [residual] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM signup_sessions`;
  console.log(`[provision-db] signup_sessions remanescentes: ${residual?.n}`);
  const migrations = await readMigrations();

  await mkdir(path.join(root, 'dist/track-o-provision'), { recursive: true });
  await writeFile(
    path.join(root, 'dist/track-o-provision/results.json'),
    JSON.stringify(
      {
        environment: 'Postgres 17 descartavel com todas as migrations reais + scaffolding Supabase',
        migrations: {
          count: migrations.length,
          first: migrations[0]?.file,
          last: migrations.at(-1)?.file,
        },
        compensationProvider: 'STUB em memoria; cancelamento/exclusao externa NAO TESTADOS aqui',
        residualSignupSessions: residual?.n ?? null,
        finishedAt: new Date().toISOString(),
        results: results.map((r) => ({ name: r.name, status: r.status })),
      },
      null,
      2,
    ),
  );
  await cluster.stop();
  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`[provision-db] ${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length === 0 ? 0 : 1);
}
