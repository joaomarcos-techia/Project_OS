/**
 * Camada 1 / 1.H — simulação controlada de 30 dias da jornada financeira.
 *
 * Cria uma clínica inteiramente sintética no banco DEV, acumula 30 dias de
 * eventos em ordem mista e drena o worker real. Não chama Asaas nem Meta:
 * cobranças são conciliadas/fechadas pelos seams autoritativos antes do worker.
 * O cleanup é obrigatório e confirma resíduo zero.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { publishEvent } from '@/lib/outbox/publish';
import { runOutboxOnce } from '@/lib/outbox/worker';

import { patients } from '@/contexts/patient';
import { closeCharge, markDepositPaid } from '@/contexts/payments/internal/charge-store';
import { patientCharges } from '@/contexts/payments/schema';
import { SCHEDULING_EVENTS, appointments, procedures } from '@/contexts/scheduling';

import '@/lib/db/schema';
import '@/app/api/cron/outbox/handlers';

assertDevContext();

type ScenarioKind = 'completed' | 'no_show' | 'refunded' | 'expired';

interface Scenario {
  day: number;
  kind: ScenarioKind;
  appointmentId: string;
  depositChargeId: string;
  remainderChargeId: string | null;
  depositProviderId: string;
  remainderProviderId: string | null;
  scheduledAt: Date;
}

const DAYS = 30;
const FULL_AMOUNT = 100;
const DEPOSIT_AMOUNT = 40;
const REMAINDER_AMOUNT = FULL_AMOUNT - DEPOSIT_AMOUNT;
const EXPECTED = {
  completed: 8,
  noShow: 8,
  refunded: 7,
  expired: 7,
  charges: 38,
  credits: 31,
  webhookEvents: 62,
  lancamentos: 8,
  transactions: 16,
  transactionTotal: 800,
} as const;

const runId = randomUUID();
const stamp = runId.replaceAll('-', '').slice(0, 12);
const clinicId = randomUUID();
const patientId = randomUUID();
const procedureId = randomUUID();
const supabase = createAdminClient();
let doctorId: string | null = null;

const scenarioKinds: readonly ScenarioKind[] = ['completed', 'no_show', 'refunded', 'expired'];
const scenarios: Scenario[] = Array.from({ length: DAYS }, (_, index) => {
  const day = index + 1;
  const kind = scenarioKinds[index % scenarioKinds.length]!;
  const appointmentId = randomUUID();
  const scheduledAt = new Date();
  scheduledAt.setUTCDate(scheduledAt.getUTCDate() - day);
  scheduledAt.setUTCHours(14, 0, 0, 0);
  return {
    day,
    kind,
    appointmentId,
    depositChargeId: randomUUID(),
    remainderChargeId: kind === 'completed' ? randomUUID() : null,
    depositProviderId: `pay-sim-deposit-${stamp}-${day}`,
    remainderProviderId: kind === 'completed' ? `pay-sim-remainder-${stamp}-${day}` : null,
    scheduledAt,
  };
});

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const current = error.stack ?? error.message;
  return error.cause ? `${current}\nCaused by: ${errorDetail(error.cause)}` : current;
}

async function assertCleanQueue(): Promise<void> {
  const rows = await dbAdmin.execute<{ active: number }>(sql`
    SELECT count(*)::int AS active
      FROM outbox o
     WHERE o.status IN ('pending', 'processing')
       AND EXISTS (SELECT 1 FROM clinics c WHERE c.id = o.clinic_id)
  `);
  assert(
    rows[0]?.active === 0,
    `simulação exige fila DEV sem tenant ativo; existem ${rows[0]?.active} evento(s) concorrente(s)`,
  );
}

async function createFixtures(): Promise<void> {
  await dbAdmin.execute(sql`
    INSERT INTO clinics (id, slug, nome, endereco, status, timezone)
    VALUES (
      ${clinicId}, ${`h1-simulation-${stamp}`}, '1.H Simulação 30 dias',
      'Fixture sintética', 'active', 'America/Sao_Paulo'
    )
  `);

  const created = await supabase.auth.admin.createUser({
    email: `h1-simulation-${stamp}@smoke.local`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error('não foi possível criar médico sintético');
  }
  doctorId = created.data.user.id;

  await dbAdmin.execute(sql`
    INSERT INTO profiles (id, clinic_id, nome, role, ativo)
    VALUES (${doctorId}, ${clinicId}, 'Dra. Simulação', 'doctor'::role_enum, true)
  `);

  await withTenant(clinicId, async (tx) => {
    await tx.insert(procedures).values({
      id: procedureId,
      clinicId,
      codigo: `SIM-${stamp.slice(0, 6)}`,
      descricao: 'Consulta sintética de simulação',
      valorPadrao: FULL_AMOUNT.toFixed(2),
      duracaoPadraoMin: 30,
    });
    await tx.insert(patients).values({
      id: patientId,
      clinicId,
      nome: 'Paciente Sintético Simulação',
      cpfEncrypted: 'fixture-sem-pii',
      cpfHash: runId.replaceAll('-', '').padEnd(64, '0').slice(0, 64),
    });

    await tx.insert(appointments).values(
      scenarios.map((scenario) => ({
        id: scenario.appointmentId,
        clinicId,
        doctorId: doctorId!,
        patientId,
        procedureId,
        scheduledAt: scenario.scheduledAt,
        durationMin: 30,
        status:
          scenario.kind === 'completed'
            ? ('atendido' as const)
            : scenario.kind === 'no_show'
              ? ('faltou' as const)
              : ('cancelado' as const),
        valor: FULL_AMOUNT.toFixed(2),
        depositStatus: scenario.kind === 'expired' ? ('expired' as const) : ('pending' as const),
        holdExpiresAt:
          scenario.kind === 'expired'
            ? null
            : new Date(scenario.scheduledAt.getTime() - 24 * 60 * 60 * 1000),
        snapshotProcedureName: 'Consulta sintética de simulação',
        snapshotProcedureValor: FULL_AMOUNT.toFixed(2),
        snapshotProcedureDuracaoMin: 30,
        snapshotDoctorNome: 'Dra. Simulação',
      })),
    );

    await tx.insert(patientCharges).values(
      scenarios.flatMap((scenario) => {
        const deposit = {
          id: scenario.depositChargeId,
          clinicId,
          appointmentId: scenario.appointmentId,
          patientId,
          kind: 'deposit' as const,
          status: 'pending' as const,
          amount: DEPOSIT_AMOUNT.toFixed(2),
          providerPaymentId: scenario.depositProviderId,
          invoiceUrl: null,
          externalReference: `deposit:${scenario.appointmentId}`,
          holdExpiresAt: new Date(scenario.scheduledAt.getTime() - 24 * 60 * 60 * 1000),
        };
        if (!scenario.remainderChargeId || !scenario.remainderProviderId) return [deposit];
        return [
          deposit,
          {
            id: scenario.remainderChargeId,
            clinicId,
            appointmentId: scenario.appointmentId,
            patientId,
            kind: 'remainder' as const,
            status: 'pending' as const,
            amount: REMAINDER_AMOUNT.toFixed(2),
            providerPaymentId: scenario.remainderProviderId,
            invoiceUrl: null,
            externalReference: `remainder:${scenario.appointmentId}`,
            holdExpiresAt: null,
          },
        ];
      }),
    );
  });
}

async function reconcilePayment(args: {
  scenario: Scenario;
  chargeId: string;
  providerPaymentId: string;
  suffix: string;
  amount: number;
}): Promise<void> {
  const eventA = `evt-sim-${stamp}-${args.scenario.day}-${args.suffix}-a`;
  const eventB = `evt-sim-${stamp}-${args.scenario.day}-${args.suffix}-b`;
  const outcomes = await Promise.all([
    markDepositPaid({
      clinicId,
      providerPaymentId: args.providerPaymentId,
      asaasEventId: eventA,
      eventType: args.scenario.day % 2 === 0 ? 'PAYMENT_CONFIRMED' : 'PAYMENT_RECEIVED',
      paidAt: args.scenario.scheduledAt,
      providerGrossAmount: args.amount,
      providerNetAmount: args.amount,
      billingType: 'PIX',
    }),
    markDepositPaid({
      clinicId,
      providerPaymentId: args.providerPaymentId,
      asaasEventId: eventB,
      eventType: args.scenario.day % 2 === 0 ? 'PAYMENT_RECEIVED' : 'PAYMENT_CONFIRMED',
      paidAt: args.scenario.scheduledAt,
      providerGrossAmount: args.amount,
      providerNetAmount: args.amount,
      billingType: 'PIX',
    }),
  ]);
  assert(
    outcomes.filter((outcome) => outcome === 'paid').length === 1,
    `${args.chargeId}: ${outcomes}`,
  );
  assert(
    outcomes.filter((outcome) => outcome === 'already_paid').length === 1,
    `${args.chargeId}: ${outcomes}`,
  );

  const replay = await markDepositPaid({
    clinicId,
    providerPaymentId: args.providerPaymentId,
    asaasEventId: eventA,
    eventType: args.scenario.day % 2 === 0 ? 'PAYMENT_CONFIRMED' : 'PAYMENT_RECEIVED',
    paidAt: args.scenario.scheduledAt,
    providerGrossAmount: args.amount,
    providerNetAmount: args.amount,
    billingType: 'PIX',
  });
  assert(replay === 'ignored', `${args.chargeId}: replay devolveu ${replay}`);
}

async function accumulatePayments(): Promise<void> {
  for (const scenario of scenarios) {
    if (scenario.kind !== 'expired') {
      await reconcilePayment({
        scenario,
        chargeId: scenario.depositChargeId,
        providerPaymentId: scenario.depositProviderId,
        suffix: 'deposit',
        amount: DEPOSIT_AMOUNT,
      });
    }
    if (scenario.remainderChargeId && scenario.remainderProviderId) {
      await reconcilePayment({
        scenario,
        chargeId: scenario.remainderChargeId,
        providerPaymentId: scenario.remainderProviderId,
        suffix: 'remainder',
        amount: REMAINDER_AMOUNT,
      });
    }

    if (scenario.kind === 'refunded') {
      const closed = await closeCharge({
        clinicId,
        chargeId: scenario.depositChargeId,
        from: 'paid',
        outcome: 'refunded',
        kind: 'deposit',
        appointmentId: scenario.appointmentId,
        amount: DEPOSIT_AMOUNT,
        closedAt: scenario.scheduledAt,
      });
      assert(closed, `${scenario.appointmentId}: refund não fechou`);
    } else if (scenario.kind === 'expired') {
      const closed = await closeCharge({
        clinicId,
        chargeId: scenario.depositChargeId,
        from: 'pending',
        outcome: 'expired',
        kind: 'deposit',
        appointmentId: scenario.appointmentId,
        amount: DEPOSIT_AMOUNT,
        closedAt: scenario.scheduledAt,
      });
      assert(closed, `${scenario.appointmentId}: expiração não fechou`);
    }
  }
}

async function publishSchedulingHistory(): Promise<void> {
  for (const scenario of [...scenarios].reverse()) {
    const idempotencyKey = `simulation:${scenario.day}:${scenario.kind}:${scenario.appointmentId}`;
    await withTenant(clinicId, async (tx) => {
      const deliveries = scenario.day % 5 === 0 ? 2 : 1;
      for (let delivery = 0; delivery < deliveries; delivery++) {
        if (scenario.kind === 'completed') {
          await publishEvent(tx, {
            clinicId,
            eventType: SCHEDULING_EVENTS.COMPLETED,
            payload: {
              appointmentId: scenario.appointmentId,
              clinicId,
              doctorId: doctorId!,
              patientId,
              procedureId,
              unitId: null,
              valor: FULL_AMOUNT,
              snapshotProcedureName: 'Consulta sintética de simulação',
              snapshotDoctorNome: 'Dra. Simulação',
              scheduledAt: scenario.scheduledAt.toISOString(),
            },
            idempotencyKey,
          });
        } else if (scenario.kind === 'no_show') {
          await publishEvent(tx, {
            clinicId,
            eventType: SCHEDULING_EVENTS.NO_SHOW,
            payload: {
              appointmentId: scenario.appointmentId,
              clinicId,
              patientId,
              fromStatus: 'confirmado',
              toStatus: 'faltou',
            },
            idempotencyKey,
          });
        } else {
          await publishEvent(tx, {
            clinicId,
            eventType: SCHEDULING_EVENTS.CANCELLED,
            payload: {
              appointmentId: scenario.appointmentId,
              clinicId,
              fromStatus: 'agendado',
              toStatus: 'cancelado',
              cancelReason: scenario.kind === 'expired' ? 'deposit_expired' : 'user',
              reason:
                scenario.kind === 'expired'
                  ? 'sinal não pago dentro do prazo'
                  : 'cancelamento simulado',
              cancelledAt: scenario.scheduledAt.toISOString(),
            },
            idempotencyKey,
          });
        }
      }
    });
  }
}

async function drainWorker(): Promise<{ ticks: number; durationMs: number }> {
  const startedAt = Date.now();
  for (let tick = 1; tick <= 30; tick++) {
    await runOutboxOnce({ batchSize: 50, parallelism: 4 });
    const rows = await dbAdmin.execute<{
      active: number;
      retrying: number;
      sampleEvent: string | null;
      sampleError: string | null;
    }>(sql`
      SELECT
        count(*)::int AS active,
        count(*) FILTER (WHERE last_error IS NOT NULL)::int AS retrying,
        (array_agg(event_type ORDER BY created_at)
          FILTER (WHERE last_error IS NOT NULL))[1] AS "sampleEvent",
        (array_agg(last_error ORDER BY created_at)
          FILTER (WHERE last_error IS NOT NULL))[1] AS "sampleError"
        FROM outbox
       WHERE clinic_id = ${clinicId}
         AND status IN ('pending', 'processing')
    `);
    const state = rows[0];
    if (state?.retrying) {
      throw new Error(
        `worker deixou ${state.retrying} evento(s) em retry; ` +
          `amostra=${state.sampleEvent}: ${state.sampleError}`,
      );
    }
    if (state?.active === 0) return { ticks: tick, durationMs: Date.now() - startedAt };
  }
  throw new Error('worker não drenou a simulação após 30 ticks');
}

async function validateFinalState(): Promise<void> {
  const rows = await dbAdmin.execute<{
    charges: number;
    pendingCharges: number;
    duplicateCharges: number;
    credits: number;
    allocatedCredits: number;
    retainedCredits: number;
    refundedCredits: number;
    availableCredits: number;
    webhookEvents: number;
    lancamentos: number;
    paidLancamentos: number;
    transactions: number;
    transactionTotal: string;
    pendingHolds: number;
    orphanCharges: number;
    orphanCredits: number;
    failedOutbox: number;
    activeOutbox: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM patient_charges WHERE clinic_id = ${clinicId}) AS charges,
      (SELECT count(*)::int FROM patient_charges
        WHERE clinic_id = ${clinicId} AND status = 'pending') AS "pendingCharges",
      (SELECT count(*)::int FROM (
        SELECT appointment_id, kind FROM patient_charges
         WHERE clinic_id = ${clinicId}
         GROUP BY appointment_id, kind HAVING count(*) > 1
      ) duplicates) AS "duplicateCharges",
      (SELECT count(*)::int FROM patient_credits WHERE clinic_id = ${clinicId}) AS credits,
      (SELECT count(*)::int FROM patient_credits
        WHERE clinic_id = ${clinicId} AND status = 'allocated') AS "allocatedCredits",
      (SELECT count(*)::int FROM patient_credits
        WHERE clinic_id = ${clinicId} AND status = 'retained') AS "retainedCredits",
      (SELECT count(*)::int FROM patient_credits
        WHERE clinic_id = ${clinicId} AND status = 'refunded') AS "refundedCredits",
      (SELECT count(*)::int FROM patient_credits
        WHERE clinic_id = ${clinicId} AND status = 'available') AS "availableCredits",
      (SELECT count(*)::int FROM patient_webhook_events
        WHERE clinic_id = ${clinicId}) AS "webhookEvents",
      (SELECT count(*)::int FROM lancamentos WHERE clinic_id = ${clinicId}) AS lancamentos,
      (SELECT count(*)::int FROM lancamentos
        WHERE clinic_id = ${clinicId} AND status = 'pago' AND valor_pago = valor) AS "paidLancamentos",
      (SELECT count(*)::int FROM payment_transactions
        WHERE clinic_id = ${clinicId}) AS transactions,
      (SELECT coalesce(sum(amount), 0)::text FROM payment_transactions
        WHERE clinic_id = ${clinicId}) AS "transactionTotal",
      (SELECT count(*)::int FROM appointments
        WHERE clinic_id = ${clinicId}
          AND (deposit_status = 'pending' OR hold_expires_at IS NOT NULL)) AS "pendingHolds",
      (SELECT count(*)::int FROM patient_charges c
        LEFT JOIN appointments a ON a.id = c.appointment_id AND a.clinic_id = c.clinic_id
        LEFT JOIN patients p ON p.id = c.patient_id AND p.clinic_id = c.clinic_id
        WHERE c.clinic_id = ${clinicId} AND (a.id IS NULL OR p.id IS NULL)) AS "orphanCharges",
      (SELECT count(*)::int FROM patient_credits c
        LEFT JOIN patient_charges pc ON pc.id = c.patient_charge_id AND pc.clinic_id = c.clinic_id
        WHERE c.clinic_id = ${clinicId} AND pc.id IS NULL) AS "orphanCredits",
      (SELECT count(*)::int FROM outbox
        WHERE clinic_id = ${clinicId} AND status = 'failed') AS "failedOutbox",
      (SELECT count(*)::int FROM outbox
        WHERE clinic_id = ${clinicId} AND status IN ('pending', 'processing')) AS "activeOutbox"
  `);
  const state = rows[0];
  assert(Boolean(state), 'consulta final sem resultado');
  assert(state!.charges === EXPECTED.charges, `charges=${state!.charges}`);
  assert(state!.pendingCharges === 0, `pendingCharges=${state!.pendingCharges}`);
  assert(state!.duplicateCharges === 0, `duplicateCharges=${state!.duplicateCharges}`);
  assert(state!.credits === EXPECTED.credits, `credits=${state!.credits}`);
  assert(
    state!.allocatedCredits === EXPECTED.completed * 2,
    `allocated=${state!.allocatedCredits}`,
  );
  assert(state!.retainedCredits === EXPECTED.noShow, `retained=${state!.retainedCredits}`);
  assert(state!.refundedCredits === EXPECTED.refunded, `refunded=${state!.refundedCredits}`);
  assert(state!.availableCredits === 0, `available=${state!.availableCredits}`);
  assert(state!.webhookEvents === EXPECTED.webhookEvents, `webhooks=${state!.webhookEvents}`);
  assert(state!.lancamentos === EXPECTED.lancamentos, `lancamentos=${state!.lancamentos}`);
  assert(state!.paidLancamentos === EXPECTED.lancamentos, `paid=${state!.paidLancamentos}`);
  assert(state!.transactions === EXPECTED.transactions, `transactions=${state!.transactions}`);
  assert(
    Number(state!.transactionTotal) === EXPECTED.transactionTotal,
    `transactionTotal=${state!.transactionTotal}`,
  );
  assert(state!.pendingHolds === 0, `pendingHolds=${state!.pendingHolds}`);
  assert(state!.orphanCharges === 0, `orphanCharges=${state!.orphanCharges}`);
  assert(state!.orphanCredits === 0, `orphanCredits=${state!.orphanCredits}`);
  assert(state!.failedOutbox === 0, `failedOutbox=${state!.failedOutbox}`);
  assert(state!.activeOutbox === 0, `activeOutbox=${state!.activeOutbox}`);
}

async function cleanup(): Promise<void> {
  for (const table of ['outbox', 'idempotency_keys', 'audit_events'] as const) {
    await dbAdmin.execute(sql`DELETE FROM ${sql.raw(table)} WHERE clinic_id = ${clinicId}`);
  }
  await dbAdmin.execute(sql`DELETE FROM patient_webhook_events WHERE clinic_id = ${clinicId}`);
  await dbAdmin.execute(sql`DELETE FROM patient_credits WHERE clinic_id = ${clinicId}`);
  await dbAdmin.execute(sql`DELETE FROM payment_transactions WHERE clinic_id = ${clinicId}`);
  await dbAdmin.execute(sql`DELETE FROM patient_charges WHERE clinic_id = ${clinicId}`);
  await dbAdmin.execute(sql`DELETE FROM lancamentos WHERE clinic_id = ${clinicId}`);
  await dbAdmin.execute(sql`DELETE FROM faturamento_pendencias WHERE clinic_id = ${clinicId}`);
  await dbAdmin.execute(sql`DELETE FROM appointments WHERE clinic_id = ${clinicId}`);
  await dbAdmin.execute(sql`DELETE FROM patients WHERE clinic_id = ${clinicId}`);
  await dbAdmin.execute(sql`DELETE FROM procedures WHERE clinic_id = ${clinicId}`);
  await dbAdmin.execute(sql`DELETE FROM profiles WHERE clinic_id = ${clinicId}`);
  await dbAdmin.execute(sql`DELETE FROM clinics WHERE id = ${clinicId}`);

  if (doctorId) {
    const removed = await supabase.auth.admin.deleteUser(doctorId);
    if (removed.error) throw removed.error;
  }

  const residue = await dbAdmin.execute<{ total: number }>(sql`
    SELECT (
      (SELECT count(*) FROM clinics WHERE id = ${clinicId}) +
      (SELECT count(*) FROM appointments WHERE clinic_id = ${clinicId}) +
      (SELECT count(*) FROM patient_charges WHERE clinic_id = ${clinicId}) +
      (SELECT count(*) FROM patient_credits WHERE clinic_id = ${clinicId}) +
      (SELECT count(*) FROM lancamentos WHERE clinic_id = ${clinicId}) +
      (SELECT count(*) FROM outbox WHERE clinic_id = ${clinicId}) +
      (SELECT count(*) FROM patient_webhook_events WHERE clinic_id = ${clinicId})
    )::int AS total
  `);
  assert(residue[0]?.total === 0, `cleanup incompleto: ${residue[0]?.total}`);
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  try {
    await assertCleanQueue();
    await createFixtures();
    await accumulatePayments();
    await publishSchedulingHistory();
    const worker = await drainWorker();
    await validateFinalState();
    console.log(
      `[OK] 30 dias: ${DAYS} agendamentos · ${EXPECTED.charges} cobranças · ` +
        `${EXPECTED.webhookEvents} eventos webhook · ${worker.ticks} tick(s) · ${worker.durationMs}ms`,
    );
  } finally {
    await cleanup();
    console.log('[OK] cleanup: zero fixtures e usuário sintético removido');
  }
  console.log(`1.H SIMULATION PASS — ${Date.now() - startedAt}ms`);
}

main().catch((error) => {
  console.error(errorDetail(error));
  process.exitCode = 1;
});
