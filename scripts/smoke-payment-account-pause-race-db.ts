/**
 * Prova DEV de concorrência entre DOIS PROCESSOS Node independentes: a pausa da
 * conta Asaas (`deactivatePaymentAccount`) disputa o advisory lock da conta com
 * a reserva de Checkout (`createInitialHostedCheckout`). Cada processo abre seus
 * próprios pools e sessões; o coordenador segura uma barreira no MESMO lock,
 * confirma em `pg_locks` que os dois esperam na ordem desejada e só então solta.
 *
 * Não chama o Asaas. A reserva recebe um cliente-contador local que registra se
 * um POST de Checkout teria saído; a conta tem histórico, então a pausa não tenta
 * desativar webhook remoto. Fixture isolada (clínica + usuário Auth DEV), removida
 * e relida no finally. Exige `NODE_OPTIONS=--conditions=react-server`.
 */
// MUST be first: loads `.env.local` before any `@/lib/*` module validates env.
import { assertDevContext } from './_env';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { createInitialHostedCheckout } from '@/contexts/payments/internal/hosted-checkout';
import { dbAdmin } from '@/lib/db';
import type { Tx } from '@/lib/db';
import { PAYMENT_ACCOUNT_LOCK_NAMESPACE } from '@/lib/payments/account-lock';
import { deactivatePaymentAccount } from '@/lib/payments/account-store';
import type { AsaasClient, ProviderCheckout } from '@/lib/payments/asaas';

const DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';
const RESULT_PREFIX = 'SMOKE_RESULT ';
const PLACEHOLDER_SECRET = 'fixture-sem-provider';
const CHILD_TIMEOUT_MS = 100_000;

type Role = 'pause' | 'claim';
type Order = 'pause-first' | 'claim-first';

interface PauseResult {
  role: 'pause';
  changed: boolean;
  state: 'paused' | 'disconnected';
  finishedAt: number;
}

interface ClaimResult {
  role: 'claim';
  outcome: string;
  createCheckoutCalls: number;
  cancelCheckoutCalls: number;
  pausedBeforeProviderReturned: boolean | null;
  finishedAt: number;
}

type ChildResult = PauseResult | ClaimResult;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function argValue(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`argumento ausente: ${name}`);
  return value;
}

/** Nunca reproduz URL, chave ou stack: só a primeira linha, sem endereços. */
function sanitize(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? '';
  return firstLine.replace(/\b[a-z]+:\/\/\S+/gi, '<url>').slice(0, 240);
}

async function waitUntilPaused(clinicId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await dbAdmin.execute<{ accept_new_charges: boolean }>(sql`
      SELECT accept_new_charges FROM clinic_payment_accounts WHERE clinic_id = ${clinicId}
    `);
    if (row?.accept_new_charges === false) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

// --- processos filhos ---------------------------------------------------------

async function runPauseChild(): Promise<PauseResult> {
  const result = await deactivatePaymentAccount({
    clinicId: argValue('clinic'),
    userId: argValue('user'),
    requestContext: {
      ip: null,
      userAgent: 'smoke-payment-account-pause-race',
      requestId: randomUUID(),
    },
  });
  return { role: 'pause', ...result, finishedAt: Date.now() };
}

async function runClaimChild(): Promise<ClaimResult> {
  const clinicId = argValue('clinic');
  const waitForPause = argValue('wait-for-pause') === '1';
  let createCheckoutCalls = 0;
  let cancelCheckoutCalls = 0;
  let pausedBeforeProviderReturned: boolean | null = null;
  // Instrumento, não substituto do provedor: conta tentativas de POST /checkouts
  // e nunca sai da máquina. No cenário em que a reserva vence, segura a resposta
  // até observar a pausa, provando que uma intenção persistida antes dela ainda
  // conclui o Checkout depois.
  const counter: Partial<AsaasClient> = {
    async createCheckout(input): Promise<ProviderCheckout> {
      createCheckoutCalls += 1;
      if (waitForPause) pausedBeforeProviderReturned = await waitUntilPaused(clinicId, 30_000);
      return {
        checkoutId: `chk_smoke_${randomUUID().slice(0, 8)}`,
        status: 'ACTIVE',
        link: 'https://example.invalid/checkout-smoke',
        externalReference: input.externalReference,
      };
    },
    async cancelCheckout(): Promise<void> {
      cancelCheckoutCalls += 1;
    },
  };
  const now = new Date();
  const holdExpiresAt = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const outcome = await createInitialHostedCheckout({
    client: counter as AsaasClient,
    clinicId,
    appointmentId: argValue('appointment'),
    patientId: argValue('patient'),
    kind: 'deposit',
    amount: 50,
    description: 'Sinal do agendamento',
    holdExpiresAt,
    collectionExpiresAt: holdExpiresAt,
    now,
    paymentMethod: 'pix',
    installmentCount: null,
  });
  return {
    role: 'claim',
    outcome,
    createCheckoutCalls,
    cancelCheckoutCalls,
    pausedBeforeProviderReturned,
    finishedAt: Date.now(),
  };
}

async function runChild(role: Role): Promise<void> {
  const watchdog = setTimeout(() => process.exit(3), CHILD_TIMEOUT_MS);
  watchdog.unref();
  try {
    const result = role === 'pause' ? await runPauseChild() : await runClaimChild();
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`, () => process.exit(0));
  } catch (error) {
    process.stderr.write(`${sanitize(error instanceof Error ? error.message : String(error))}\n`);
    process.exit(1);
  }
}

// --- coordenador --------------------------------------------------------------

const runId = randomUUID();
const clinicId = randomUUID();
const patientId = randomUUID();
const procedureId = randomUUID();
const historyAppointmentId = randomUUID();
const pauseFirstAppointmentId = randomUUID();
const claimFirstAppointmentId = randomUUID();
const historyChargeId = randomUUID();
const email = `e2e-pause-race-${runId}@example.invalid`;
const password = `Qoro${runId.replaceAll('-', '')}Aa1!`;

function devAuthConfig(): { url: string; key: string } {
  const { databaseUrl } = assertDevContext();
  const parsed = new URL(databaseUrl);
  const dbRef = parsed.hostname.startsWith('db.')
    ? parsed.hostname.split('.')[1]
    : decodeURIComponent(parsed.username).split('.').at(-1);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  assert(dbRef === DEV_PROJECT_REF, 'Banco não é o projeto DEV autorizado.');
  assert(url && new URL(url).hostname.split('.')[0] === DEV_PROJECT_REF, 'Auth não é DEV.');
  assert(key, 'Chave administrativa DEV ausente.');
  return { url, key };
}

async function authRequest(
  config: { url: string; key: string },
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${config.url}/auth/v1/admin/users${path}`, {
    method,
    headers: {
      apikey: config.key,
      authorization: `Bearer ${config.key}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function createFixture(userId: string): Promise<void> {
  await dbAdmin.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO clinics (id, slug, nome, status, timezone)
      VALUES (${clinicId}, ${`e2e-pause-race-${runId.slice(0, 8)}`},
              'Clínica sintética de pausa concorrente', 'active', 'America/Sao_Paulo')
    `);
    await tx.execute(sql`
      INSERT INTO profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
      VALUES (${userId}, ${clinicId}, 'Owner sintético de pausa', 'owner'::role_enum, true, now())
    `);
    await tx.execute(sql`
      INSERT INTO patients (id, clinic_id, nome, cpf_encrypted, cpf_hash)
      VALUES (${patientId}, ${clinicId}, 'Paciente sintético de pausa', 'fixture',
              ${runId.replaceAll('-', '').padEnd(64, '0')})
    `);
    await tx.execute(sql`
      INSERT INTO procedures (id, clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min)
      VALUES (${procedureId}, ${clinicId}, ${`PAUSE-${runId.slice(0, 8)}`},
              'Procedimento sintético de pausa', 100.00, 30)
    `);
    for (const [appointmentId, days] of [
      [historyAppointmentId, -3],
      [pauseFirstAppointmentId, 5],
      [claimFirstAppointmentId, 6],
    ] as const) {
      await tx.execute(sql`
        INSERT INTO appointments (
          id, clinic_id, doctor_id, patient_id, procedure_id, scheduled_at,
          duration_min, status, valor, snapshot_procedure_name,
          snapshot_procedure_valor, snapshot_procedure_duracao_min,
          snapshot_doctor_nome, created_via
        ) VALUES (
          ${appointmentId}, ${clinicId}, ${userId}, ${patientId}, ${procedureId},
          now() + make_interval(days => ${days}::int), 30,
          ${days < 0 ? 'atendido' : 'agendado'}, 100.00, 'Procedimento sintético', 100.00, 30,
          'Profissional sintético', 'attendant'
        )
      `);
    }
    // Histórico pago: a conta não pode perder credencial/webhook ao ser pausada.
    await tx.execute(sql`
      INSERT INTO patient_charges (
        id, clinic_id, appointment_id, patient_id, kind, status, amount, provider,
        external_reference, paid_at, provider_gross_amount, provider_fee_amount,
        provider_net_amount, economics_reconciled_at, provider_economics_revision
      ) VALUES (
        ${historyChargeId}, ${clinicId}, ${historyAppointmentId}, ${patientId}, 'deposit',
        'paid', 50.00, 'asaas', ${`deposit:${historyAppointmentId}`}, now(), 50.00,
        NULL, NULL, NULL, 0
      )
    `);
    await tx.execute(sql`
      INSERT INTO clinic_payment_accounts
        (clinic_id, provider, api_key_encrypted, api_key_hash, active, accept_new_charges,
         connected_at, connected_by, webhook_token_encrypted, webhook_configured_at)
      VALUES (${clinicId}, 'asaas', ${PLACEHOLDER_SECRET}, ${`hash-${runId}`}, true, true,
              now(), ${userId}, ${PLACEHOLDER_SECRET}, now())
    `);
  });
}

async function lockWaiters(tx: Tx): Promise<number> {
  const [row] = await tx.execute<{ waiting: number }>(sql`
    SELECT count(*)::int AS waiting
      FROM pg_locks
     WHERE locktype = 'advisory'
       AND NOT granted
       AND classid::bigint = ${PAYMENT_ACCOUNT_LOCK_NAMESPACE}
       AND objid::bigint = (hashtext(${clinicId}::text)::bigint & 4294967295)
       AND objsubid = 2
  `);
  return row?.waiting ?? 0;
}

async function waitForWaiters(tx: Tx, expected: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await lockWaiters(tx)) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`barreira: esperava ${expected} processo(s) no lock da conta`);
}

interface SpawnedChild {
  role: Role;
  done: Promise<ChildResult>;
  kill: () => void;
}

function spawnChild(role: Role, args: string[]): SpawnedChild {
  const scriptPath = process.argv[1];
  assert(scriptPath, 'caminho do script indisponível para o processo filho');
  const child = spawn(
    process.execPath,
    [...process.execArgv, scriptPath, `--child=${role}`, ...args],
    { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
  const done = new Promise<ChildResult>((resolve, reject) => {
    child.on('error', (error) => reject(new Error(`processo ${role}: ${sanitize(error.message)}`)));
    child.on('exit', (code) => {
      const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(RESULT_PREFIX));
      if (code !== 0 || !line) {
        reject(new Error(`processo ${role} saiu com ${code}: ${sanitize(stderr)}`));
        return;
      }
      resolve(JSON.parse(line.slice(RESULT_PREFIX.length)) as ChildResult);
    });
  });
  return { role, done, kill: () => child.kill() };
}

async function readAccount(): Promise<{
  active: boolean;
  accept_new_charges: boolean;
  api_key_encrypted: string | null;
  webhook_token_encrypted: string | null;
}> {
  const [row] = await dbAdmin.execute<{
    active: boolean;
    accept_new_charges: boolean;
    api_key_encrypted: string | null;
    webhook_token_encrypted: string | null;
  }>(sql`
    SELECT active, accept_new_charges, api_key_encrypted, webhook_token_encrypted
      FROM clinic_payment_accounts WHERE clinic_id = ${clinicId}
  `);
  assert(row, 'conta da fixture desapareceu');
  return row;
}

async function runScenario(
  order: Order,
  userId: string,
  appointmentId: string,
): Promise<{ pause: PauseResult; claim: ClaimResult; waitedMs: number }> {
  const claimArgs = [
    `--clinic=${clinicId}`,
    `--appointment=${appointmentId}`,
    `--patient=${patientId}`,
    `--wait-for-pause=${order === 'claim-first' ? '1' : '0'}`,
  ];
  const pauseArgs = [`--clinic=${clinicId}`, `--user=${userId}`];
  const spawned: SpawnedChild[] = [];
  const started = Date.now();
  try {
    await dbAdmin.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${PAYMENT_ACCOUNT_LOCK_NAMESPACE}, hashtext(${clinicId}::text))`,
      );
      assert((await lockWaiters(tx)) === 0, 'lock da conta já tinha espera antes da barreira');
      const [firstRole, secondRole]: [Role, Role] =
        order === 'pause-first' ? ['pause', 'claim'] : ['claim', 'pause'];
      spawned.push(spawnChild(firstRole, firstRole === 'pause' ? pauseArgs : claimArgs));
      await waitForWaiters(tx, 1, 60_000);
      spawned.push(spawnChild(secondRole, secondRole === 'pause' ? pauseArgs : claimArgs));
      await waitForWaiters(tx, 2, 60_000);
      // COMMIT solta a barreira; a fila do Postgres entrega o lock na ordem de chegada.
    });
    const results = await Promise.all(spawned.map((child) => child.done));
    const pause = results.find((result): result is PauseResult => result.role === 'pause');
    const claim = results.find((result): result is ClaimResult => result.role === 'claim');
    assert(pause && claim, 'resultado de processo ausente');
    return { pause, claim, waitedMs: Date.now() - started };
  } catch (error) {
    for (const child of spawned) child.kill();
    throw error;
  }
}

async function cleanup(config: { url: string; key: string }, userId: string | null): Promise<void> {
  const errors: string[] = [];
  try {
    await dbAdmin.execute(sql`DELETE FROM outbox WHERE clinic_id = ${clinicId}`);
    await dbAdmin.execute(sql`DELETE FROM audit_events WHERE clinic_id = ${clinicId}`);
    await dbAdmin.execute(sql`DELETE FROM clinics WHERE id = ${clinicId}`);
  } catch (error) {
    errors.push(`banco: ${sanitize(error instanceof Error ? error.message : String(error))}`);
  }
  if (userId) {
    const removed = await authRequest(config, `/${encodeURIComponent(userId)}`, 'DELETE');
    const readback = await authRequest(config, `/${encodeURIComponent(userId)}`, 'GET');
    if ((!removed.ok && removed.status !== 404) || readback.status !== 404) {
      errors.push(`Auth (DELETE ${removed.status}, GET ${readback.status})`);
    }
  }
  const [residue] = await dbAdmin.execute<Record<string, number>>(sql`
    SELECT
      (SELECT count(*)::int FROM clinics WHERE id = ${clinicId}) AS clinics,
      (SELECT count(*)::int FROM profiles WHERE clinic_id = ${clinicId}) AS profiles,
      (SELECT count(*)::int FROM clinic_payment_accounts WHERE clinic_id = ${clinicId}) AS accounts,
      (SELECT count(*)::int FROM patient_charges WHERE clinic_id = ${clinicId}) AS charges,
      (SELECT count(*)::int FROM patient_checkout_generations WHERE clinic_id = ${clinicId}) AS generations,
      (SELECT count(*)::int FROM outbox WHERE clinic_id = ${clinicId}) AS outbox,
      (SELECT count(*)::int FROM audit_events WHERE clinic_id = ${clinicId}) AS audit
  `);
  const leftovers = Object.entries(residue ?? {}).filter(([, count]) => count !== 0);
  if (!residue || leftovers.length > 0) {
    errors.push(`resíduo ${leftovers.map(([name, count]) => `${name}=${count}`).join(', ')}`);
  }
  if (errors.length > 0) throw new Error(`cleanup incompleto: ${errors.join('; ')}`);
  console.log('[OK] cleanup: clínica, conta, cobranças, outbox, auditoria e usuário Auth = 0');
}

async function main(): Promise<void> {
  const config = devAuthConfig();
  let userId: string | null = null;
  try {
    const created = await authRequest(config, '', 'POST', {
      email,
      password,
      email_confirm: true,
    });
    const body = (await created.json().catch(() => null)) as { id?: unknown } | null;
    assert(
      created.ok && typeof body?.id === 'string',
      `Auth DEV recusou fixture (HTTP ${created.status}).`,
    );
    userId = body.id;
    await createFixture(userId);
    console.log('[OK] fixture DEV isolada: conta ativa com uma cobrança histórica paga');

    // 1. A pausa chega primeiro ao lock: a reserva não pode persistir nem fazer POST.
    const pauseFirst = await runScenario('pause-first', userId, pauseFirstAppointmentId);
    const afterPauseFirst = await readAccount();
    const [pauseFirstRows] = await dbAdmin.execute<{ charges: number; generations: number }>(sql`
      SELECT
        (SELECT count(*)::int FROM patient_charges WHERE clinic_id = ${clinicId}
           AND appointment_id = ${pauseFirstAppointmentId}) AS charges,
        (SELECT count(*)::int FROM patient_checkout_generations g
           JOIN patient_charges c ON c.id = g.patient_charge_id
          WHERE g.clinic_id = ${clinicId} AND c.appointment_id = ${pauseFirstAppointmentId}) AS generations
    `);
    assert(
      pauseFirst.pause.state === 'paused' && pauseFirst.pause.changed,
      'pausa vencedora não pausou',
    );
    assert(
      pauseFirst.claim.outcome === 'account_paused',
      `reserva perdedora: ${pauseFirst.claim.outcome}`,
    );
    assert(pauseFirst.claim.createCheckoutCalls === 0, 'POST de Checkout saiu após a pausa');
    assert(
      pauseFirstRows?.charges === 0 && pauseFirstRows.generations === 0,
      'reserva persistiu dívida/geração depois da pausa',
    );
    assert(
      afterPauseFirst.active &&
        !afterPauseFirst.accept_new_charges &&
        afterPauseFirst.api_key_encrypted === PLACEHOLDER_SECRET &&
        afterPauseFirst.webhook_token_encrypted === PLACEHOLDER_SECRET,
      'pausa com histórico alterou credencial/token ou desativou a conta',
    );
    console.log(
      `[OK] pausa primeiro: reserva=${pauseFirst.claim.outcome}, POST=${pauseFirst.claim.createCheckoutCalls}, ` +
        `cobranças novas=0, conta pausada com credencial preservada (${pauseFirst.waitedMs} ms)`,
    );

    // 2. A reserva chega primeiro: a pausa espera a intenção persistida; o POST
    // dessa intenção sai depois da pausa e a conta continua conciliável.
    await dbAdmin.execute(sql`
      UPDATE clinic_payment_accounts SET accept_new_charges = true, updated_at = now()
       WHERE clinic_id = ${clinicId} AND active = true
    `);
    const claimFirst = await runScenario('claim-first', userId, claimFirstAppointmentId);
    const afterClaimFirst = await readAccount();
    const [claimFirstRows] = await dbAdmin.execute<{
      charge_status: string | null;
      charge_created_at: string | null;
      generation_status: string | null;
      provider_checkout: boolean;
      paused_at: string | null;
      link_ready: number;
      charge_created: number;
      pause_audits: number;
    }>(sql`
      SELECT
        c.status::text AS charge_status,
        c.created_at::text AS charge_created_at,
        g.status::text AS generation_status,
        g.provider_checkout_id IS NOT NULL AS provider_checkout,
        (SELECT max(created_at)::text FROM audit_events
          WHERE clinic_id = ${clinicId} AND action = 'payments.account.paused') AS paused_at,
        (SELECT count(*)::int FROM outbox WHERE clinic_id = ${clinicId}
           AND event_type = 'payments.patient_charge.link_ready') AS link_ready,
        (SELECT count(*)::int FROM outbox WHERE clinic_id = ${clinicId}
           AND event_type = 'payments.patient_charge.created') AS charge_created,
        (SELECT count(*)::int FROM audit_events
          WHERE clinic_id = ${clinicId} AND action = 'payments.account.paused') AS pause_audits
        FROM patient_charges c
        LEFT JOIN patient_checkout_generations g ON g.patient_charge_id = c.id
       WHERE c.clinic_id = ${clinicId} AND c.appointment_id = ${claimFirstAppointmentId}
    `);
    assert(
      claimFirst.pause.state === 'paused' && claimFirst.pause.changed,
      'pausa tardia não pausou',
    );
    assert(
      claimFirst.claim.outcome === 'created',
      `reserva vencedora: ${claimFirst.claim.outcome}`,
    );
    assert(claimFirst.claim.createCheckoutCalls === 1, 'reserva vencedora não fez um único POST');
    assert(
      claimFirst.claim.pausedBeforeProviderReturned === true,
      'a pausa não ocorreu enquanto a intenção persistida aguardava o provedor',
    );
    assert(
      claimFirstRows?.charge_status === 'pending' &&
        claimFirstRows.generation_status === 'active' &&
        claimFirstRows.provider_checkout &&
        claimFirstRows.link_ready === 1 &&
        claimFirstRows.charge_created === 1 &&
        claimFirstRows.pause_audits === 2,
      'intenção persistida antes da pausa não terminou de forma única',
    );
    assert(
      claimFirstRows.charge_created_at &&
        claimFirstRows.paused_at &&
        Date.parse(claimFirstRows.charge_created_at) < Date.parse(claimFirstRows.paused_at),
      'a dívida não foi persistida antes da pausa',
    );
    assert(
      afterClaimFirst.active &&
        !afterClaimFirst.accept_new_charges &&
        afterClaimFirst.api_key_encrypted === PLACEHOLDER_SECRET &&
        afterClaimFirst.webhook_token_encrypted === PLACEHOLDER_SECRET,
      'pausa após reserva alterou credencial/token ou desativou a conta',
    );
    console.log(
      `[OK] reserva primeiro: reserva=${claimFirst.claim.outcome}, POST=${claimFirst.claim.createCheckoutCalls} ` +
        'concluído após a pausa, dívida persistida antes da pausa, link_ready=1, ' +
        `conta pausada com credencial preservada (${claimFirst.waitedMs} ms)`,
    );
  } finally {
    await cleanup(config, userId);
  }
}

const childRole = process.argv.find((arg) => arg.startsWith('--child='))?.slice('--child='.length);

if (childRole === 'pause' || childRole === 'claim') {
  void runChild(childRole);
} else {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(sanitize(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    });
}
