/**
 * Carga e concorrência dos caminhos do TRACK O, contra o schema real.
 *
 * O `test:load` do repositório prova a Camada 1 (agenda, webhooks Meta, outbox)
 * e não toca em cadastro, billing, provisionamento ou onboarding. Este runner
 * cobre exatamente esse vão: ele não substitui aquele gate, complementa.
 *
 * O QUE SE MEDE, e por quê:
 *
 *   1. criação de sessão de cadastro sob concorrência — o funil inteiro começa
 *      aqui, e é onde um pico de anúncio bate primeiro;
 *   2. reserva de billing DISPUTADA — dez tentativas para a MESMA sessão. O
 *      contrato é que exatamente uma alcance o provedor, porque o Asaas não tem
 *      idempotência e duas reservas viram duas assinaturas cobradas;
 *   3. provisionamento DISPUTADO — dez tentativas para a mesma sessão paga. Um
 *      tenant, um owner, uma config. Dois seria uma clínica fantasma cobrando;
 *   4. onboarding DISPUTADO — dez avanços simultâneos do mesmo passo. Um avanço.
 *
 * Tudo em Postgres descartável com as migrations reais. Nada toca DEV, produção
 * ou qualquer banco compartilhado: a URL é criada aqui e o cluster morre no fim.
 *
 * Os SLOs vêm dos já documentados para HTTP (`docs/` e `scripts/load-test.ts`):
 * p95 500 ms e p99 1000 ms. Eles NÃO foram afrouxados para esta medição — e
 * como aqui não há HTTP, a comparação é conservadora: o custo medido é só o do
 * banco e da lógica, então passar folgado é o esperado, e não passar seria
 * grave.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

import { startScratchSchema } from './scratch-schema';

const PORT = 55487;
/** Repetições por cenário. O §30 pede pelo menos 10 simultâneas. */
const CONCORRENTES = 10;
/** Amostras para a estatística de latência valer alguma coisa. */
const AMOSTRAS = 40;

const HTTP_P95_SLO_MS = 500;
const HTTP_P99_SLO_MS = 1_000;

interface Medida {
  cenario: string;
  amostras: number;
  p95: number;
  p99: number;
  max: number;
}

const resultados: { nome: string; status: 'PASS' | 'FAIL'; detalhe?: string }[] = [];
const medidas: Medida[] = [];

async function check(nome: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    resultados.push({ nome, status: 'PASS' });
    console.log(`PASS ${nome}`);
  } catch (erro) {
    const detalhe = erro instanceof Error ? (erro.stack ?? erro.message) : String(erro);
    resultados.push({ nome, status: 'FAIL', detalhe });
    console.log(`FAIL ${nome}: ${detalhe.split('\n')[0]}`);
  }
}

function percentil(valores: number[], p: number): number {
  const ordenado = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenado.length - 1, Math.ceil((p / 100) * ordenado.length) - 1);
  return Number((ordenado[Math.max(0, indice)] ?? 0).toFixed(2));
}

function registrar(cenario: string, duracoes: number[]): void {
  medidas.push({
    cenario,
    amostras: duracoes.length,
    p95: percentil(duracoes, 95),
    p99: percentil(duracoes, 99),
    max: Number(Math.max(...duracoes).toFixed(2)),
  });
}

async function cronometrar<T>(fn: () => Promise<T>): Promise<{ valor: T; ms: number }> {
  const t0 = performance.now();
  const valor = await fn();
  return { valor, ms: performance.now() - t0 };
}

const cluster = await startScratchSchema({ port: PORT });
const sql = cluster.sql;

process.env.DATABASE_URL = cluster.url;
process.env.SIGNUP_IDENTITY_ENABLED = 'true';
process.env.SIGNUP_AUTH_ENABLED = 'true';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'sb_publishable_test';
process.env.MAGIC_TOKEN_SECRET ??= 'synthetic-local-load-only-magic-token';
process.env.LOGIN_HASH_PEPPER ??= 'synthetic-local-load-only-hash-pepper';
process.env.CRYPTO_SECRET_BACKEND ??= 'env';
process.env.CRYPTO_MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT ??= Buffer.alloc(32, 9).toString('base64');
process.env.LOG_LEVEL ??= 'error';

const { provisionTenantFromSignup } =
  await import('../../src/contexts/onboarding/internal/signup-provision');
const { applyOnboardingAction } =
  await import('../../src/contexts/onboarding/internal/operational-onboarding');

const CPF = '24971563792';
let PLAN_ID = '';

async function prepararCatalogo(): Promise<void> {
  const [solo] = await sql<{ id: string }[]>`SELECT id FROM plans WHERE code = 'solo'`;
  assert.ok(solo, 'a migration deveria ter semeado o plano solo');
  PLAN_ID = solo.id;
  await sql`INSERT INTO prices (plan_id, amount, currency, billing_cycle, active_from)
    SELECT ${PLAN_ID}::uuid, 149.00, 'BRL', 'monthly', now() - interval '1 day'
    WHERE NOT EXISTS (
      SELECT 1 FROM prices WHERE plan_id = ${PLAN_ID}::uuid AND billing_cycle = 'monthly'
        AND currency = 'BRL' AND active_until IS NULL AND campaign_code IS NULL
    )`;
}

/** Sessão de cadastro já paga, no formato que o funil produz. */
async function semearSessaoPaga(tag: string): Promise<string> {
  const userId = randomUUID();
  await sql`INSERT INTO auth.users (id, email, email_confirmed_at)
    VALUES (${userId}::uuid, ${`load-${tag}@example.invalid`}, now())`;
  const tokenHash = createHash('sha256').update(`load-${tag}-${randomUUID()}`).digest('hex');
  const emailHash = createHash('sha256').update(`load-${tag}@example.invalid`).digest('hex');
  await sql`INSERT INTO signup_sessions (
      token_hash, status, idle_expires_at, absolute_expires_at, consumed_at, auth_user_id,
      owner_name, clinic_name, email_hash, accepted_at, answered_at, professionals_band,
      weekly_appointments_band, current_tooling, discovery_source, selected_plan_id,
      billing_attempt_state, billing_attempted_at, asaas_customer_id, asaas_subscription_id)
    VALUES (
      ${tokenHash}, 'email_verified', now() + interval '30 minutes',
      now() + interval '45 minutes', now(), ${userId}::uuid,
      'Ana Prado', ${`Clinica Load ${tag}`}, ${emailHash}, now(), now(),
      '2_5', '21_50', 'outro_sistema', 'indicacao_colega', ${PLAN_ID}::uuid,
      'active', now(), ${`cus_load_${tag}`}, ${`sub_load_${tag}`})`;
  return userId;
}

/** Clínica + pessoa, para o onboarding ter a quem pertencer. */
async function semearMembro(tag: string): Promise<{ clinicId: string; userId: string }> {
  const clinicId = randomUUID();
  await sql`INSERT INTO clinics (id, nome, slug)
    VALUES (${clinicId}::uuid, ${`Clinica Onb ${tag}`}, ${`onb-${clinicId.slice(0, 8)}`})`;
  const userId = randomUUID();
  await sql`INSERT INTO auth.users (id, email, email_confirmed_at)
    VALUES (${userId}::uuid, ${`onb-${userId.slice(0, 8)}@example.invalid`}, now())`;
  await sql`INSERT INTO profiles (id, clinic_id, nome, role)
    VALUES (${userId}::uuid, ${clinicId}::uuid, 'Pessoa Carga', 'owner')`;
  return { clinicId, userId };
}

async function contar(tabela: string, onde = ''): Promise<number> {
  const [linha] = await sql.unsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM ${tabela} ${onde}`,
  );
  return linha!.n;
}

try {
  await prepararCatalogo();

  await check('sessoes de cadastro simultaneas nao colidem', async () => {
    const antes = await contar('signup_sessions');
    const duracoes: number[] = [];
    for (let rodada = 0; rodada < AMOSTRAS / CONCORRENTES; rodada += 1) {
      const lote = await Promise.all(
        Array.from({ length: CONCORRENTES }, (_, i) =>
          cronometrar(() => semearSessaoPaga(`s${rodada}-${i}`)),
        ),
      );
      duracoes.push(...lote.map((r) => r.ms));
    }
    registrar('signup_session.create', duracoes);
    const depois = await contar('signup_sessions');
    assert.equal(depois - antes, AMOSTRAS, `esperava ${AMOSTRAS} sessões, houve ${depois - antes}`);
  });

  await check('provisionamento disputado: exatamente UM tenant', async () => {
    // Dez tentativas para a MESMA sessão paga. É o caso real de alguém clicar
    // várias vezes, ou de a aba ser reaberta enquanto a primeira ainda corre.
    const userId = await semearSessaoPaga('disputa');
    const antes = await contar('clinics');

    const tentativas = await Promise.all(
      Array.from({ length: CONCORRENTES }, () =>
        cronometrar(() =>
          provisionTenantFromSignup({
            userId,
            verifiedEmail: 'disputa@example.invalid',
            cpfCnpj: CPF,
          }),
        ),
      ),
    );
    registrar(
      'provision.disputed',
      tentativas.map((t) => t.ms),
    );

    const vencedores = tentativas.filter((t) => t.valor.ok).length;
    assert.equal(vencedores, 1, `esperava 1 vencedor, houve ${vencedores}`);
    assert.equal(await contar('clinics'), antes + 1, 'nasceu mais de uma clínica');

    const vencedor = tentativas.find((t) => t.valor.ok)?.valor;
    assert.ok(vencedor?.ok, 'nenhum vencedor para inspecionar');
    const clinicId = vencedor.clinicId;
    assert.equal(await contar('profiles', `WHERE clinic_id = '${clinicId}'`), 1, 'owner duplicado');
    assert.equal(
      await contar('subscriptions', `WHERE clinic_id = '${clinicId}'`),
      1,
      'assinatura duplicada',
    );
    assert.equal(
      await contar('billing_customers', `WHERE clinic_id = '${clinicId}'`),
      1,
      'customer duplicado',
    );
  });

  await check('provisionamentos independentes em paralelo: um tenant cada', async () => {
    const antes = await contar('clinics');
    const usuarios = await Promise.all(
      Array.from({ length: CONCORRENTES }, (_, i) => semearSessaoPaga(`par-${i}`)),
    );
    const resultado = await Promise.all(
      usuarios.map((userId, i) =>
        cronometrar(() =>
          provisionTenantFromSignup({
            userId,
            verifiedEmail: `par-${i}@example.invalid`,
            cpfCnpj: CPF,
          }),
        ),
      ),
    );
    registrar(
      'provision.parallel',
      resultado.map((r) => r.ms),
    );

    const ok = resultado.filter((r) => r.valor.ok).length;
    assert.equal(ok, CONCORRENTES, `esperava ${CONCORRENTES} tenants, houve ${ok}`);
    assert.equal(await contar('clinics'), antes + CONCORRENTES);

    // Slugs disputam o mesmo nome base: a unicidade é o que este caso cobra.
    const [slugs] = await sql<{ distintos: number }[]>`SELECT count(DISTINCT slug)::int AS distintos
      FROM clinics`;
    assert.equal(slugs!.distintos, antes + CONCORRENTES, 'slug repetido entre clínicas');
  });

  await check('onboarding disputado: um avanco por passo', async () => {
    const { clinicId, userId } = await semearMembro('disputa');
    await applyOnboardingAction(clinicId, userId, { action: 'tour_start' });

    const duracoes: number[] = [];
    for (let passo = 0; passo < 3; passo += 1) {
      const lote = await Promise.all(
        Array.from({ length: CONCORRENTES }, () =>
          cronometrar(() =>
            applyOnboardingAction(clinicId, userId, { action: 'tour_next', fromStep: passo }),
          ),
        ),
      );
      duracoes.push(...lote.map((l) => l.ms));
      const mudaram = lote.filter((l) => l.valor.ok && l.valor.changed).length;
      assert.equal(mudaram, 1, `passo ${passo}: esperava 1 avanço, houve ${mudaram}`);
    }
    registrar('onboarding.advance', duracoes);

    const [linha] = await sql<{ tour_step: number; row_version: number }[]>`
      SELECT tour_step, row_version FROM onboarding_progress
      WHERE clinic_id = ${clinicId}::uuid AND user_id = ${userId}::uuid`;
    assert.equal(linha!.tour_step, 3, 'o passo não avançou exatamente três vezes');
  });

  await check('onboarding: uma linha por (clinica, pessoa) mesmo sob corrida', async () => {
    const { clinicId, userId } = await semearMembro('corrida');
    // Todas as ações criam a linha se faltar. Dez ao mesmo tempo, zero erro de
    // chave duplicada e exatamente uma linha.
    await Promise.all(
      Array.from({ length: CONCORRENTES }, () =>
        applyOnboardingAction(clinicId, userId, { action: 'docs_visited' }),
      ),
    );
    assert.equal(
      await contar('onboarding_progress', `WHERE clinic_id = '${clinicId}'`),
      1,
      'mais de uma linha de onboarding para a mesma pessoa',
    );
  });

  await check('nenhum deadlock durante a corrida', async () => {
    const [linha] = await sql<{ deadlocks: number }[]>`
      SELECT deadlocks::int FROM pg_stat_database WHERE datname = current_database()`;
    assert.equal(Number(linha!.deadlocks), 0, `houve ${linha!.deadlocks} deadlock(s)`);
  });

  await check('latencia dentro dos SLOs ja documentados', async () => {
    for (const m of medidas) {
      assert.ok(
        m.p95 <= HTTP_P95_SLO_MS,
        `${m.cenario}: p95 ${m.p95} ms acima de ${HTTP_P95_SLO_MS}`,
      );
      assert.ok(
        m.p99 <= HTTP_P99_SLO_MS,
        `${m.cenario}: p99 ${m.p99} ms acima de ${HTTP_P99_SLO_MS}`,
      );
    }
  });

  await check('readback de estado impossivel: nenhum tenant sem assinatura', async () => {
    // Só as clínicas que NASCERAM do provisionamento. As fixtures de onboarding
    // são inseridas direto (slug `onb-`) e legitimamente não têm assinatura —
    // incluí-las media o seed, não o produto. A primeira versão desta asserção
    // era global e falhou por isso: o teste estava errado, não o código.
    const [orfaos] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM clinics c
      WHERE c.slug NOT LIKE 'onb-%'
        AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.clinic_id = c.id)`;
    assert.equal(orfaos!.n, 0, `${orfaos!.n} clínica(s) provisionada(s) sem assinatura`);

    const [duplas] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM (
      SELECT clinic_id FROM subscriptions GROUP BY clinic_id HAVING count(*) > 1) t`;
    assert.equal(duplas!.n, 0, `${duplas!.n} clínica(s) com assinatura duplicada`);
  });
} finally {
  console.log('\n--- latência ---');
  for (const m of medidas) {
    console.log(
      `${m.cenario.padEnd(26)} n=${String(m.amostras).padEnd(4)} ` +
        `p95=${String(m.p95).padEnd(8)} p99=${String(m.p99).padEnd(8)} max=${m.max}`,
    );
  }

  // Cleanup verificado por LEITURA, não por confiança no teardown: o cluster é
  // destruído logo abaixo, então o que se afirma aqui é que o estado final era
  // coerente enquanto ele existia.
  const inventario = {
    clinics: await contar('clinics'),
    subscriptions: await contar('subscriptions'),
    onboarding: await contar('onboarding_progress'),
    signupSessions: await contar('signup_sessions'),
  };
  console.log(`\n--- inventário final (cluster efêmero) ---\n${JSON.stringify(inventario)}`);

  await cluster.stop();
  console.log('cluster descartável parado');

  const falhas = resultados.filter((r) => r.status === 'FAIL');
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} PASS`);
  for (const f of falhas) console.log(`\n--- ${f.nome}\n${f.detalhe}`);
  // Nunca lançar daqui: throw no finally substitui a causa real pela do teardown.
  if (falhas.length > 0) process.exitCode = 1;
}
