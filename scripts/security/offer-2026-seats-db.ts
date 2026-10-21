/**
 * ADR-067 — oferta por profissional contra o SCHEMA REAL, em Postgres
 * descartável. As migrations reais (até a 0119) são aplicadas em ordem; o
 * código de produção é exercitado como a aplicação o exercita (`withTenant`,
 * `dbAdmin`, postgres.js + Drizzle).
 *
 * O que se prova:
 *   1. catálogo: 10 planos com a fórmula 197 / 397 + 147 × (n − 2), só mensal,
 *      e a tabela antiga (preços, fundador, `plan_limits`) intacta;
 *   2. Consultório: 1 profissional e até 3 de equipe, no write de `profiles`;
 *   3. CRM do próprio perfil e reativação ocupam vaga;
 *   4. só a escrita que faz a categoria crescer é barrada;
 *   5. Clínica: equipe ilimitada, teto de profissionais;
 *   6. downgrade agendado reserva a capacidade do destino;
 *   7. a tabela antiga não é tocada pela trigger;
 *   8. duas escritas concorrentes na última vaga: uma passa;
 *   9. API de billing: tetos, uso e checagem barata, sob RLS;
 *  10. visão da assinatura: só a tabela da clínica, direção e encaixe;
 *  11. identity traduz a recusa da trigger para o erro de domínio;
 *  12. cadastro: só a oferta, plano antigo recusado, preço e nome no servidor;
 *  13. provisionamento do cadastro nasce no plano escolhido, com o teto valendo.
 *
 * Uso: `npx tsx --conditions=react-server scripts/security/offer-2026-seats-db.ts`
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

import { sql as drizzleSql } from 'drizzle-orm';

import { startScratchSchema } from './scratch-schema';

const PORT = 55493;
const results: { name: string; status: 'PASS' | 'FAIL'; detail?: string }[] = [];

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    results.push({ name, status: 'PASS' });
    console.log(`PASS ${name}`);
  } catch (error) {
    const cause = error instanceof Error && error.cause ? `
cause: ${String(error.cause)}` : '';
    const detail = `${error instanceof Error ? (error.stack ?? error.message) : String(error)}${cause}`;
    results.push({ name, status: 'FAIL', detail });
    console.log(`FAIL ${name}: ${detail.split('\n')[0]}`);
  }
}

const cluster = await startScratchSchema({ port: PORT });
const sql = cluster.sql;

// `profiles` nasceu antes das migrations de grants e, no Supabase, recebe o ACL
// padrão do schema `public` (SELECT para `authenticated`). É por ele que
// `listEmployees` e a contagem de usuários de `plan-changes` já leem `profiles`
// via `withTenant`. O cluster descartável não tem esse ACL; sem reproduzi-lo, a
// prova mediria um papel diferente do de produção.
await sql`GRANT SELECT ON public.profiles TO authenticated`;

// A aplicação lê a conexão no import. Todos os pools apontam para este cluster.
process.env.DATABASE_URL = cluster.url;
process.env.DATABASE_URL_DEV = cluster.url;
process.env.DATABASE_URL_RUNTIME = cluster.url;
process.env.SUPABASE_PROJECT_ENV = 'dev';
process.env.SIGNUP_IDENTITY_ENABLED = 'true';
process.env.SIGNUP_AUTH_ENABLED = 'true';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'sb_publishable_test';
process.env.MAGIC_TOKEN_SECRET ??= 'synthetic-local-offer-2026-magic-token';
process.env.LOGIN_HASH_PEPPER ??= 'synthetic-local-offer-2026-hash-pepper';
process.env.CRYPTO_SECRET_BACKEND ??= 'env';
process.env.CRYPTO_MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT ??= Buffer.alloc(32, 9).toString('base64');
process.env.LOG_LEVEL ??= 'error';

const { billingApiV1 } = await import('../../src/contexts/billing/api');
const { getPlanChangeOverview, targetPlanCapacityFits } =
  await import('../../src/contexts/billing/internal/plan-changes');
const { setMemberRole } = await import('../../src/contexts/identity/internal/lifecycle');
const { UserQuotaExceededError } = await import('../../src/contexts/identity/errors');
const { readSignupPlan, writeSignupPlan } =
  await import('../../src/contexts/onboarding/internal/signup-draft');
const { reserveSignupBillingAttempt } =
  await import('../../src/contexts/onboarding/internal/signup-billing');
const { provisionTenantFromSignup } =
  await import('../../src/contexts/onboarding/internal/signup-provision');
const { withTenant } = await import('../../src/lib/db/tenant');

const REQUEST = { ip: null, userAgent: 'offer-2026-seats-db', requestId: 'offer-2026-seats-db' };

async function planIds(): Promise<Map<string, { planId: string; priceId: string }>> {
  const rows = await sql<{ code: string; plan_id: string; price_id: string }[]>`
    SELECT p.code, p.id AS plan_id, pr.id AS price_id FROM plans p
      JOIN prices pr ON pr.plan_id = p.id AND pr.billing_cycle = 'monthly'
       AND pr.active_until IS NULL AND pr.campaign_code IS NULL`;
  return new Map(rows.map((r) => [r.code, { planId: r.plan_id, priceId: r.price_id }]));
}

let catalog = new Map<string, { planId: string; priceId: string }>();

async function seedClinic(planCode: string): Promise<{ clinicId: string; subscriptionId: string }> {
  const plan = catalog.get(planCode);
  assert.ok(plan, `plano ${planCode} não está no catálogo`);
  const clinicId = randomUUID();
  await sql`INSERT INTO clinics (id, nome, slug)
    VALUES (${clinicId}::uuid, ${`Clínica ${planCode}`}, ${`offer-${clinicId.slice(0, 8)}`})`;
  const [sub] = await sql<{ id: string }[]>`INSERT INTO subscriptions (
      clinic_id, plan_id, price_id, billing_status, current_period_start, current_period_end,
      asaas_subscription_id
    ) VALUES (
      ${clinicId}::uuid, ${plan.planId}::uuid, ${plan.priceId}::uuid, 'active',
      now() - interval '10 days', now() + interval '20 days', ${`sub_${clinicId.slice(0, 8)}`}
    ) RETURNING id`;
  return { clinicId, subscriptionId: sub!.id };
}

let crmSeq = 1000;
async function addProfile(
  clinicId: string,
  role: string,
  options: { crm?: boolean; ativo?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO auth.users (id, email, email_confirmed_at)
    VALUES (${id}::uuid, ${`p-${id.slice(0, 8)}@example.invalid`}, now())`;
  const crm = options.crm ? String((crmSeq += 1)) : null;
  await sql`INSERT INTO profiles (id, clinic_id, nome, role, ativo, crm, crm_uf)
    VALUES (${id}::uuid, ${clinicId}::uuid, ${`Pessoa ${role}`}, ${role}, ${options.ativo ?? true},
            ${crm}, ${crm ? 'SP' : null})`;
  return id;
}

function isSeatViolation(constraint: string) {
  return (error: unknown) => {
    const e = error as { code?: string; constraint_name?: string };
    assert.equal(e.code, '23514', `esperava check_violation, veio ${String(e.code)}`);
    assert.equal(e.constraint_name, constraint);
    return true;
  };
}

try {
  catalog = await planIds();

  await check('1. catálogo da oferta pela fórmula; tabela antiga intacta', async () => {
    const offer = await sql<
      {
        code: string;
        professionals: number;
        staff: number | null;
        amount: string;
        cycles: string;
      }[]
    >`SELECT p.code, l.professionals, l.staff, pr.amount::text AS amount,
             (SELECT string_agg(DISTINCT billing_cycle::text, ',') FROM prices
               WHERE plan_id = p.id) AS cycles
        FROM plans p JOIN plan_seat_limits l ON l.plan_id = p.id
        JOIN prices pr ON pr.plan_id = p.id AND pr.active_until IS NULL AND pr.campaign_code IS NULL
       WHERE p.ativo ORDER BY l.professionals`;
    assert.equal(offer.length, 10);
    for (const row of offer) {
      const expected = row.professionals === 1 ? 197 : 397 + 147 * (row.professionals - 2);
      assert.equal(Number(row.amount), expected, row.code);
      assert.equal(row.staff, row.professionals === 1 ? 3 : null, row.code);
      assert.equal(row.cycles, 'monthly', `${row.code} só mensal`);
    }
    const legacy = await sql<{ code: string; amount: string; users: number }[]>`
      SELECT p.code, pr.amount::text AS amount, l.limit_value AS users FROM plans p
        JOIN prices pr ON pr.plan_id = p.id AND pr.billing_cycle = 'monthly'
         AND pr.active_until IS NULL AND pr.campaign_code IS NULL
        JOIN plan_limits l ON l.plan_id = p.id AND l.metric = 'users'
       WHERE p.code IN ('solo', 'clinica', 'pro') AND p.ativo ORDER BY p.code`;
    assert.deepEqual(
      legacy.map((r) => [r.code, Number(r.amount), r.users]),
      [
        ['clinica', 349, 5],
        ['pro', 699, 10],
        ['solo', 149, 1],
      ],
    );
    const [founder] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM prices
      WHERE campaign_code = 'fundador' AND active_until IS NULL`;
    assert.equal(founder?.n, 6, 'preços de fundador da tabela antiga preservados');
    const [offerLimits] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM plan_limits l
      JOIN plan_seat_limits s ON s.plan_id = l.plan_id`;
    assert.equal(offerLimits?.n, 0, 'oferta nova não usa plan_limits');
  });

  await check('2. Consultório: 1 profissional e até 3 de equipe no write de profiles', async () => {
    const { clinicId } = await seedClinic('consultorio_2026');
    await addProfile(clinicId, 'owner');
    await addProfile(clinicId, 'doctor');
    await assert.rejects(
      addProfile(clinicId, 'doctor'),
      isSeatViolation('plan_professional_seat_limit'),
    );
    await addProfile(clinicId, 'attendant');
    await addProfile(clinicId, 'financial');
    await assert.rejects(
      addProfile(clinicId, 'attendant'),
      isSeatViolation('plan_staff_seat_limit'),
    );
    // Convite pendente conta (ativo = true desde o convite) e inativo não.
    await addProfile(clinicId, 'attendant', { ativo: false });
  });

  await check('3. CRM do próprio perfil e reativação ocupam vaga', async () => {
    const { clinicId } = await seedClinic('consultorio_2026');
    const owner = await addProfile(clinicId, 'owner');
    const doctor = await addProfile(clinicId, 'doctor');
    await assert.rejects(
      sql`UPDATE profiles SET crm = '99001', crm_uf = 'SP' WHERE id = ${owner}::uuid`,
      isSeatViolation('plan_professional_seat_limit'),
    );
    await sql`UPDATE profiles SET ativo = false WHERE id = ${doctor}::uuid`;
    await sql`UPDATE profiles SET crm = '99001', crm_uf = 'SP' WHERE id = ${owner}::uuid`;
    await assert.rejects(
      sql`UPDATE profiles SET ativo = true WHERE id = ${doctor}::uuid`,
      isSeatViolation('plan_professional_seat_limit'),
    );
  });

  await check('4. só a escrita que faz a categoria crescer é barrada', async () => {
    const { clinicId } = await seedClinic('consultorio_2026');
    await addProfile(clinicId, 'owner');
    const doctor = await addProfile(clinicId, 'doctor', { crm: true });
    const attendant = await addProfile(clinicId, 'attendant');
    await addProfile(clinicId, 'financial');
    // Cheio nas duas categorias. Trocar papel dentro da mesma categoria passa.
    await sql`UPDATE profiles SET role = 'gestor' WHERE id = ${attendant}::uuid`;
    await sql`UPDATE profiles SET nome = 'Outro nome', crm = '88001' WHERE id = ${doctor}::uuid`;
    // Estado acima do teto (ex.: dado anterior): reduzir sempre é possível.
    await sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      const extra = randomUUID();
      await tx`INSERT INTO auth.users (id, email) VALUES (${extra}::uuid, 'extra@example.invalid')`;
      await tx`INSERT INTO profiles (id, clinic_id, nome, role, ativo)
        VALUES (${extra}::uuid, ${clinicId}::uuid, 'Extra', 'doctor', true)`;
    });
    await sql`UPDATE profiles SET ativo = false WHERE id = ${doctor}::uuid`;
    await assert.rejects(
      addProfile(clinicId, 'doctor'),
      isSeatViolation('plan_professional_seat_limit'),
    );
  });

  await check('5. Clínica: equipe ilimitada, profissionais no teto contratado', async () => {
    const { clinicId } = await seedClinic('clinica_2026_3');
    await addProfile(clinicId, 'owner');
    for (let i = 0; i < 25; i += 1) await addProfile(clinicId, i % 2 ? 'attendant' : 'financial');
    for (let i = 0; i < 3; i += 1) await addProfile(clinicId, 'doctor');
    await assert.rejects(
      addProfile(clinicId, 'doctor'),
      isSeatViolation('plan_professional_seat_limit'),
    );
  });

  await check('6. downgrade agendado reserva a capacidade do destino', async () => {
    const { clinicId, subscriptionId } = await seedClinic('clinica_2026_3');
    const owner = await addProfile(clinicId, 'owner');
    await addProfile(clinicId, 'doctor');
    await addProfile(clinicId, 'doctor');
    const from = catalog.get('clinica_2026_3')!;
    const to = catalog.get('clinica_2026_2')!;
    const [change] = await sql<{ id: string }[]>`INSERT INTO subscription_change_requests (
        clinic_id, subscription_id, kind, status, from_plan_id, from_price_id, to_plan_id,
        to_price_id, effective_at, idempotency_key, requested_by
      ) VALUES (
        ${clinicId}::uuid, ${subscriptionId}::uuid, 'downgrade', 'scheduled', ${from.planId}::uuid,
        ${from.priceId}::uuid, ${to.planId}::uuid, ${to.priceId}::uuid, now() + interval '20 days',
        ${randomUUID()}, ${owner}::uuid
      ) RETURNING id`;
    await assert.rejects(
      addProfile(clinicId, 'doctor'),
      isSeatViolation('plan_professional_seat_limit'),
    );
    const limits = await billingApiV1.getSeatLimits(clinicId);
    assert.deepEqual(limits, { users: null, professionals: 2, staff: null });
    await sql`UPDATE subscription_change_requests SET status = 'cancelled', cancelled_at = now()
      WHERE id = ${change!.id}::uuid`;
    await addProfile(clinicId, 'doctor');
  });

  await check('7. tabela antiga: a trigger não interfere', async () => {
    const { clinicId } = await seedClinic('solo');
    await addProfile(clinicId, 'owner');
    for (let i = 0; i < 3; i += 1) await addProfile(clinicId, 'doctor');
    assert.deepEqual(await billingApiV1.getSeatLimits(clinicId), {
      users: 1,
      professionals: null,
      staff: null,
    });
  });

  await check('8. duas escritas concorrentes na última vaga: uma passa', async () => {
    const { clinicId } = await seedClinic('clinica_2026_2');
    await addProfile(clinicId, 'owner');
    await addProfile(clinicId, 'doctor');
    const outcomes = await Promise.allSettled([
      addProfile(clinicId, 'doctor'),
      addProfile(clinicId, 'doctor'),
    ]);
    assert.deepEqual(outcomes.map((o) => o.status).sort(), ['fulfilled', 'rejected']);
    const rejected = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    isSeatViolation('plan_professional_seat_limit')(rejected.reason);
  });

  await check('9. API de billing sob RLS: tetos, uso e checagem barata', async () => {
    const { clinicId } = await seedClinic('consultorio_2026');
    await addProfile(clinicId, 'owner', { crm: true });
    await addProfile(clinicId, 'attendant');
    const professional = await billingApiV1.checkSeatQuota(clinicId, 'professionals');
    assert.equal(professional.allowed, false);
    assert.equal(professional.dimension, 'professionals');
    assert.equal(professional.limit, 1);
    assert.deepEqual(professional.usage, { users: 2, professionals: 1, staff: 1 });
    const staff = await billingApiV1.checkSeatQuota(clinicId, 'staff');
    assert.equal(staff.allowed, true);
    assert.equal(await billingApiV1.hasGranularPermissions(clinicId), false);
    const { clinicId: clinica } = await seedClinic('clinica_2026_4');
    assert.equal(await billingApiV1.hasGranularPermissions(clinica), true);
    assert.equal(await billingApiV1.hasAdvancedFinancialPolicies(clinica), true);
  });

  await check(
    '10. visão da assinatura: só a tabela da clínica, com direção e encaixe',
    async () => {
      const { clinicId } = await seedClinic('clinica_2026_3');
      await addProfile(clinicId, 'owner');
      for (let i = 0; i < 3; i += 1) await addProfile(clinicId, 'doctor');
      const overview = await getPlanChangeOverview(clinicId);
      assert.deepEqual(
        overview.plans.map((p) => p.code),
        ['consultorio_2026', ...Array.from({ length: 9 }, (_, i) => `clinica_2026_${i + 2}`)],
      );
      const byCode = new Map(overview.plans.map((p) => [p.code, p]));
      assert.equal(byCode.get('clinica_2026_3')?.direction, 0);
      assert.equal(byCode.get('clinica_2026_4')?.direction, 1);
      assert.equal(byCode.get('clinica_2026_2')?.direction, -1);
      assert.equal(byCode.get('clinica_2026_2')?.teamFits, false);
      assert.equal(byCode.get('clinica_2026_10')?.priceAmount, '1573.00');
      assert.deepEqual(overview.seatUsage, { users: 4, professionals: 3, staff: 1 });
      const fits = await withTenant(clinicId, (tx) =>
        targetPlanCapacityFits(tx, clinicId, catalog.get('clinica_2026_2')!.planId),
      );
      assert.equal(fits, false);

      const { clinicId: legacy } = await seedClinic('clinica');
      await addProfile(legacy, 'owner');
      const legacyOverview = await getPlanChangeOverview(legacy);
      assert.deepEqual(
        legacyOverview.plans.map((p) => p.code),
        ['solo', 'clinica', 'pro'],
      );
    },
  );

  await check('11. identity traduz a recusa da trigger (Drizzle + postgres.js)', async () => {
    const { clinicId } = await seedClinic('clinica_2026_2');
    const owner = await addProfile(clinicId, 'owner');
    await addProfile(clinicId, 'doctor');
    await addProfile(clinicId, 'doctor');
    const attendant = await addProfile(clinicId, 'attendant');
    await assert.rejects(
      setMemberRole({
        clinicId,
        actorUserId: owner,
        actorRole: 'owner',
        targetUserId: attendant,
        newRole: 'doctor',
        requestContext: REQUEST,
      }),
      (error: unknown) => {
        assert.ok(error instanceof UserQuotaExceededError, String(error));
        assert.equal(error.dimension, 'professionals');
        return true;
      },
    );
    const [row] = await sql<{ role: string }[]>`SELECT role FROM profiles
      WHERE id = ${attendant}::uuid`;
    assert.equal(row?.role, 'attendant', 'a troca recusada não pode ter sido gravada');
  });

  const seedDraft = async (tag: string, planId: string | null) => {
    const userId = randomUUID();
    await sql`INSERT INTO auth.users (id, email, email_confirmed_at)
      VALUES (${userId}::uuid, ${`offer-${tag}@example.invalid`}, now())`;
    const tokenHash = createHash('sha256').update(`offer-${tag}`).digest('hex');
    const emailHash = createHash('sha256').update(`offer-${tag}@example.invalid`).digest('hex');
    await sql`INSERT INTO signup_sessions (
        token_hash, status, idle_expires_at, absolute_expires_at, consumed_at, auth_user_id,
        owner_name, clinic_name, email_hash, accepted_at, answered_at, professionals_band,
        weekly_appointments_band, current_tooling, discovery_source, selected_plan_id)
      VALUES (
        ${tokenHash}, 'email_verified', now() + interval '30 minutes',
        now() + interval '45 minutes', now(), ${userId}::uuid,
        'Ana Prado', ${`Clinica ${tag}`}, ${emailHash}, now(), now(),
        '2_5', '21_50', 'outro_sistema', 'indicacao_colega', ${planId}::uuid)`;
    return userId;
  };

  await check(
    '12. cadastro: só a oferta, plano antigo recusado, preço resolvido no servidor',
    async () => {
      const userId = await seedDraft('signup', null);
      const read = await readSignupPlan(userId);
      assert.ok(read.ok);
      assert.deepEqual(
        read.state.plans.map((p) => [p.code, p.priceCents, p.professionals, p.staffLimit]),
        [
          ['consultorio_2026', 19_700, 1, 3],
          ...Array.from({ length: 9 }, (_, i) => [
            `clinica_2026_${i + 2}`,
            (397 + 147 * i) * 100,
            i + 2,
            null,
          ]),
        ],
      );
      assert.equal(read.state.trialDays, 7);
      const legacy = await writeSignupPlan(userId, {
        rowVersion: read.state.rowVersion,
        planId: catalog.get('clinica')!.planId,
      });
      assert.deepEqual(legacy, { ok: false, reason: 'invalid_plan' });
      const saved = await writeSignupPlan(userId, {
        rowVersion: read.state.rowVersion,
        planId: catalog.get('clinica_2026_4')!.planId,
      });
      assert.ok(saved.ok);
      const reserved = await reserveSignupBillingAttempt(userId);
      assert.ok(reserved.ok, JSON.stringify(reserved));
      assert.equal(reserved.intent.priceCents, 69_100);
      assert.equal(reserved.intent.planCode, 'clinica_2026_4');
      assert.equal(reserved.intent.planName, 'Clínica · 4 profissionais');
      assert.equal(reserved.intent.trialDays, 7);

      const stale = await seedDraft('stale', catalog.get('solo')!.planId);
      assert.deepEqual(await reserveSignupBillingAttempt(stale), {
        ok: false,
        reason: 'invalid_plan',
      });
    },
  );

  await check('13. provisionamento nasce no plano escolhido, com o teto valendo', async () => {
    const userId = await seedDraft('provision', catalog.get('clinica_2026_2')!.planId);
    const reserved = await reserveSignupBillingAttempt(userId);
    assert.ok(reserved.ok);
    // O Checkout confirmado no Asaas é simulado aqui: só o estado que ele deixa.
    await sql`UPDATE signup_sessions SET billing_attempt_state = 'active',
        asaas_customer_id = 'cus_offer', asaas_subscription_id = 'sub_offer'
      WHERE auth_user_id = ${userId}::uuid`;
    const provisioned = await provisionTenantFromSignup({
      userId,
      verifiedEmail: 'offer-provision@example.invalid',
      cpfCnpj: '24971563792',
    });
    assert.ok(provisioned.ok, JSON.stringify(provisioned));
    const [sub] = await sql<{ code: string; amount: string }[]>`
      SELECT p.code, pr.amount::text AS amount FROM subscriptions s
        JOIN plans p ON p.id = s.plan_id JOIN prices pr ON pr.id = s.price_id
       WHERE s.clinic_id = ${provisioned.clinicId}::uuid`;
    assert.deepEqual(sub, { code: 'clinica_2026_2', amount: '397.00' });
    await addProfile(provisioned.clinicId, 'doctor');
    await addProfile(provisioned.clinicId, 'doctor');
    await assert.rejects(
      addProfile(provisioned.clinicId, 'doctor'),
      isSeatViolation('plan_professional_seat_limit'),
    );
    // RLS: o tenant lê o próprio teto por `withTenant` (papel authenticated).
    const seats = await withTenant(provisioned.clinicId, (tx) =>
      tx.execute<{ n: number }>(drizzleSql`SELECT count(*)::int AS n FROM plan_seat_limits`),
    );
    assert.equal(Number(seats[0]?.n), 10);
  });
} finally {
  await cluster.stop();
  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  for (const f of failed) console.log(`\n--- ${f.name}\n${f.detail}`);
  // Nunca lançar daqui: um throw no finally substituiria a causa real.
  if (failed.length > 0) process.exitCode = 1;
}
