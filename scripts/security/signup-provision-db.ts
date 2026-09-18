/**
 * O-6 — provisionamento contra o SCHEMA REAL, em Postgres descartável.
 *
 * O harness de cadastro (`signup-regression`) recria à mão um `clinics(id, nome)`
 * mínimo, o que basta para provar a sessão e não basta para provar o tenant.
 * Aqui as 104 migrations de verdade são aplicadas em ordem: as mesmas
 * constraints, os mesmos grants, o mesmo RLS, as mesmas funções, o mesmo
 * catálogo de eventos de outbox.
 *
 * O que se prova:
 *   1. execução normal → uma clínica, um owner, uma config, um customer, uma
 *      assinatura e os eventos de outbox, com os vínculos corretos;
 *   2. concorrência → duas abas, um tenant. É também a prova de ROLLBACK: a
 *      perdedora chega a inserir a clínica e a transação inteira volta atrás;
 *   3. repetição depois do sucesso → nenhum segundo tenant;
 *   4. sessão sem assinatura confirmada → nada criado;
 *   5. plano sem preço ativo → nada criado;
 *   6. RLS + least privilege → o runtime de um tenant não alcança o outro.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { startScratchSchema } from './scratch-schema';

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
 * pai, que o mata em instantes diferentes — cada morte cai num ponto distinto
 * da transação.
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

// A aplicação lê a conexão de `DATABASE_URL` no momento do import.
process.env.DATABASE_URL = cluster.url;
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

const CPF = '24971563792';
/** Resolvidos do catálogo que a própria migration 0026 semeia. */
let PLAN_ID = '';
let PLAN_NO_PRICE_ID = '';

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

  await check('duas abas: um tenant, e a perdedora nao deixa residuo (rollback)', async () => {
    const userId = await seedSession('race');
    const before = await clinicCount();

    const [a, b] = await Promise.all([
      provisionTenantFromSignup({ userId, verifiedEmail: 'dona@example.invalid', cpfCnpj: CPF }),
      provisionTenantFromSignup({ userId, verifiedEmail: 'dona@example.invalid', cpfCnpj: CPF }),
    ]);
    assert.equal([a, b].filter((r) => r.ok).length, 1, 'exatamente uma execucao pode vencer');

    // A perdedora INSERE a clínica antes de o claim falhar. Sem rollback, a
    // diferença seria 2 — e existiria um tenant órfão, sem dono e sem cobrança.
    assert.equal((await clinicCount()) - before, 1, 'a perdedora deixou clinica orfa');
  });

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
    'crash em qualquer ponto nao deixa tenant parcial, e a retomada converge',
    async () => {
      // O que garante cada transição aqui é UMA transação: não existe "meio do
      // caminho" durável. Matar o processo derruba a conexão, o Postgres aborta a
      // transação aberta e nada sobra. As mortes acontecem em instantes
      // diferentes para cair depois do claim, da clínica, do owner, da config, do
      // billing e do outbox — e provar que em nenhum deles fica estado preso.
      const interrupted: number[] = [];
      for (const delayMs of [40, 90, 160, 260, 420, 700]) {
        const userId = await seedSession(`crash-${delayMs}`);
        const before = await clinicCount();

        const child = spawn(
          process.execPath,
          [
            path.join(root, 'node_modules/tsx/dist/cli.mjs'),
            path.join(root, 'scripts/security/signup-provision-db.ts'),
            `--provision-child=${userId}`,
          ],
          { windowsHide: true, stdio: 'ignore', env: { ...process.env } },
        );
        const killed = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve(true);
          }, delayMs);
          child.on('exit', () => {
            clearTimeout(timer);
            resolve(false);
          });
        });

        // Dá tempo de o Postgres perceber a conexão morta e abortar.
        await new Promise((r) => setTimeout(r, 500));

        if (killed) {
          interrupted.push(delayMs);
          assert.equal(await clinicCount(), before, `crash em ${delayMs}ms deixou clinica parcial`);

          const [session] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM signup_sessions WHERE auth_user_id = ${userId}::uuid`;
          assert.equal(session?.n, 1, `crash em ${delayMs}ms consumiu a sessao sem criar tenant`);

          // Retomada: a mesma sessão provisiona normalmente depois do crash.
          const resumed = await provisionTenantFromSignup({
            userId,
            verifiedEmail: 'crash@example.invalid',
            cpfCnpj: CPF,
          });
          assert.ok(resumed.ok, `retomada apos crash em ${delayMs}ms falhou`);

          const [counts] = await sql<{ profiles: number; subs: number }[]>`
          SELECT
            (SELECT count(*)::int FROM profiles WHERE clinic_id = ${resumed.clinicId}::uuid) AS profiles,
            (SELECT count(*)::int FROM subscriptions WHERE clinic_id = ${resumed.clinicId}::uuid) AS subs`;
          assert.deepEqual({ ...counts }, { profiles: 1, subs: 1 }, 'retomada gerou duplicata');
        } else {
          // O filho terminou antes da faca: o provisionamento vale, e o estado
          // precisa ser exatamente um tenant novo.
          assert.equal(
            (await clinicCount()) - before,
            1,
            `execucao completa em ${delayMs}ms nao criou tenant`,
          );
        }
      }

      assert.ok(interrupted.length > 0, 'nenhuma execucao foi interrompida — nao provou crash');
      console.log(`  [crash] interrompido em ${interrupted.join('ms, ')}ms`);
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

      for (const table of ['subscriptions', 'billing_customers', 'ai_clinic_config'] as const) {
        const countRows = async (clinicId: string): Promise<number> => {
          const rows: { n: number }[] = await tx.unsafe(
            `SELECT count(*)::int AS n FROM ${table} WHERE clinic_id = $1`,
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

    // clinics e profiles nem chegam a depender de RLS: o runtime não tem grant
    // sobre elas (ADR-041/042). Provar a NEGATIVA importa — se um dia alguém
    // conceder SELECT "para facilitar", este teste quebra.
    for (const table of ['clinics', 'profiles'] as const) {
      await assert.rejects(
        sql.begin(async (tx) => {
          await tx`SET LOCAL ROLE qoro_runtime`;
          await tx.unsafe(`SELECT count(*) FROM ${table}`);
        }),
        /permission denied/u,
        `${table} deveria ser negada por grant ao runtime`,
      );
    }

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

  await mkdir(path.join(root, 'dist/track-o-provision'), { recursive: true });
  await writeFile(
    path.join(root, 'dist/track-o-provision/results.json'),
    JSON.stringify(
      {
        environment: 'Postgres 17 descartavel com as 104 migrations reais + scaffolding Supabase',
        migrations: 'drizzle/migrations/0000..0103 aplicadas em ordem',
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
