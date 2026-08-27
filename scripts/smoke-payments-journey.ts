/**
 * Camada 1 / 1.H — E2E controlado dos três ramos com banco + outbox worker.
 *
 * Usa fixtures sintéticas no banco DEV e os seams autoritativos do Payments.
 * Não chama Asaas nem Meta:
 *   A) falta com sinal pago -> crédito retained, sem restante;
 *   B) restante pago -> webhook concorrente, crédito alocado e recebível pago;
 *   C) refund já confirmado no seam -> cobrança, agenda e crédito refunded.
 *
 * O que fica fora por definição: transporte real Asaas e entrega real Meta.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { publishEvent } from '@/lib/outbox/publish';
import { runOutboxOnce } from '@/lib/outbox/worker';

import { lancamentos, patientCredits, paymentTransactions } from '@/contexts/financial/schema';
import { patients } from '@/contexts/patient';
import { SCHEDULING_EVENTS, appointments, procedures } from '@/contexts/scheduling';
import { patientCharges } from '@/contexts/payments/schema';
import { closeCharge, markDepositPaid } from '@/contexts/payments/internal/charge-store';

// Catálogo + registry de handlers do worker real.
import '@/lib/db/schema';
import '@/app/api/cron/outbox/handlers';

assertDevContext();

type Result = { name: string; ok: boolean; detail?: string };

const results: Result[] = [];
const runId = randomUUID();
const stamp = runId.replaceAll('-', '').slice(0, 12);
const clinicId = randomUUID();
const patientId = randomUUID();
const procedureId = randomUUID();
const appointmentA = randomUUID();
const appointmentB = randomUUID();
const appointmentC = randomUUID();

const chargeA = randomUUID();
const chargeBDeposit = randomUUID();
const chargeBRemainder = randomUUID();
const chargeC = randomUUID();
const creditA = randomUUID();
const creditBDeposit = randomUUID();
const creditC = randomUUID();
const lancamentoB = randomUUID();

const providerPaymentB = `pay_hardening_${stamp}`;
const supabase = createAdminClient();
let doctorId: string | null = null;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const current = error.stack ?? error.message;
  return error.cause ? `${current}\nCaused by: ${errorDetail(error.cause)}` : current;
}

async function step(name: string, check: () => Promise<void>): Promise<void> {
  try {
    await check();
    results.push({ name, ok: true });
    console.log(`[OK]   ${name}`);
  } catch (error) {
    const detail = errorDetail(error);
    results.push({ name, ok: false, detail });
    console.error(`[FAIL] ${name}\n       ${detail}`);
  }
}

function scheduledAt(daysAgo: number, hour: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

async function createFixtures(): Promise<void> {
  await dbAdmin.execute(sql`
    INSERT INTO clinics (id, slug, nome, endereco, status, timezone)
    VALUES (
      ${clinicId}, ${`h1-journey-${stamp}`}, '1.H Jornada Sintética',
      'Fixture sintética', 'active', 'America/Sao_Paulo'
    )
  `);

  const created = await supabase.auth.admin.createUser({
    email: `h1-journey-${stamp}@smoke.local`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error('não foi possível criar médico sintético');
  }
  doctorId = created.data.user.id;

  await dbAdmin.execute(sql`
    INSERT INTO profiles (id, clinic_id, nome, role, ativo)
    VALUES (${doctorId}, ${clinicId}, 'Dra. Hardening', 'doctor'::role_enum, true)
  `);

  await withTenant(clinicId, async (tx) => {
    await tx.insert(procedures).values({
      id: procedureId,
      clinicId,
      codigo: `H1-${stamp.slice(0, 6)}`,
      descricao: 'Consulta sintética de hardening',
      valorPadrao: '200.00',
      duracaoPadraoMin: 30,
    });
    await tx.insert(patients).values({
      id: patientId,
      clinicId,
      nome: 'Paciente Sintético 1.H',
      cpfEncrypted: 'fixture-sem-pii',
      cpfHash: runId.replaceAll('-', '').padEnd(64, '0').slice(0, 64),
    });

    const base = {
      clinicId,
      doctorId: doctorId!,
      patientId,
      procedureId,
      durationMin: 30,
      valor: '200.00',
      snapshotProcedureName: 'Consulta sintética',
      snapshotProcedureValor: '200.00',
      snapshotProcedureDuracaoMin: 30,
      snapshotDoctorNome: 'Dra. Hardening',
    } as const;
    await tx.insert(appointments).values([
      {
        ...base,
        id: appointmentA,
        scheduledAt: scheduledAt(3, 12),
        status: 'faltou',
        depositStatus: 'paid',
      },
      {
        ...base,
        id: appointmentB,
        scheduledAt: scheduledAt(2, 13),
        status: 'atendido',
        depositStatus: 'paid',
      },
      {
        ...base,
        id: appointmentC,
        scheduledAt: scheduledAt(1, 14),
        status: 'cancelado',
        depositStatus: 'paid',
      },
    ]);

    await tx.insert(patientCharges).values([
      {
        id: chargeA,
        clinicId,
        appointmentId: appointmentA,
        patientId,
        kind: 'deposit',
        status: 'paid',
        amount: '100.00',
        externalReference: `deposit:${appointmentA}`,
        paidAt: scheduledAt(4, 12),
      },
      {
        id: chargeBDeposit,
        clinicId,
        appointmentId: appointmentB,
        patientId,
        kind: 'deposit',
        status: 'paid',
        amount: '100.00',
        externalReference: `deposit:${appointmentB}`,
        paidAt: scheduledAt(3, 12),
      },
      {
        id: chargeBRemainder,
        clinicId,
        appointmentId: appointmentB,
        patientId,
        kind: 'remainder',
        status: 'pending',
        amount: '100.00',
        providerPaymentId: providerPaymentB,
        invoiceUrl: 'https://example.invalid/remainder-hardening',
        externalReference: `remainder:${appointmentB}`,
      },
      {
        id: chargeC,
        clinicId,
        appointmentId: appointmentC,
        patientId,
        kind: 'deposit',
        status: 'paid',
        amount: '100.00',
        externalReference: `deposit:${appointmentC}`,
        paidAt: scheduledAt(2, 12),
      },
    ]);

    await tx.insert(lancamentos).values({
      id: lancamentoB,
      clinicId,
      tipo: 'receber',
      descricao: 'Consulta sintética',
      valor: '200.00',
      valorPago: '100.00',
      status: 'parcial',
      patientId,
      appointmentId: appointmentB,
      createdVia: 'auto',
      snapshotProcedureName: 'Consulta sintética',
      snapshotDoctorNome: 'Dra. Hardening',
    });

    await tx.insert(patientCredits).values([
      {
        id: creditA,
        clinicId,
        patientId,
        appointmentId: appointmentA,
        patientChargeId: chargeA,
        amount: '100.00',
        kind: 'deposit',
        status: 'available',
      },
      {
        id: creditBDeposit,
        clinicId,
        patientId,
        appointmentId: appointmentB,
        patientChargeId: chargeBDeposit,
        amount: '100.00',
        allocatedAmount: '100.00',
        allocatedLancamentoId: lancamentoB,
        kind: 'deposit',
        status: 'allocated',
      },
      {
        id: creditC,
        clinicId,
        patientId,
        appointmentId: appointmentC,
        patientChargeId: chargeC,
        amount: '100.00',
        kind: 'deposit',
        status: 'available',
      },
    ]);
    await tx.insert(paymentTransactions).values({
      clinicId,
      lancamentoId: lancamentoB,
      kind: 'payment',
      amount: '100.00',
    });
  });
}

async function runWorkersUntil(label: string, condition: () => Promise<boolean>): Promise<void> {
  // Dois ticks simultâneos exercitam o advisory lock global; depois continuamos
  // serialmente porque os eventos de um ramo publicam os eventos do passo seguinte.
  await Promise.all([
    runOutboxOnce({ batchSize: 10, parallelism: 2 }),
    runOutboxOnce({ batchSize: 10, parallelism: 2 }),
  ]);
  for (let attempt = 0; attempt < 12; attempt++) {
    if (await condition()) return;
    await runOutboxOnce({ batchSize: 10, parallelism: 2 });
  }
  throw new Error(`${label}: estado final não apareceu após 12 ticks do worker`);
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
  await dbAdmin.execute(sql`DELETE FROM appointments WHERE clinic_id = ${clinicId}`);
  await dbAdmin.execute(sql`DELETE FROM patients WHERE clinic_id = ${clinicId}`);
  await dbAdmin.execute(sql`DELETE FROM procedures WHERE clinic_id = ${clinicId}`);
  if (doctorId) await dbAdmin.execute(sql`DELETE FROM profiles WHERE id = ${doctorId}`);
  await dbAdmin.execute(sql`DELETE FROM clinics WHERE id = ${clinicId}`);

  if (doctorId) {
    const removed = await supabase.auth.admin.deleteUser(doctorId);
    if (removed.error) throw removed.error;
  }

  const residue = await dbAdmin.execute<{
    clinics: number;
    domainRows: number;
    infraRows: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM clinics WHERE id = ${clinicId}) AS clinics,
      (
        (SELECT count(*) FROM patient_credits WHERE clinic_id = ${clinicId}) +
        (SELECT count(*) FROM payment_transactions WHERE clinic_id = ${clinicId}) +
        (SELECT count(*) FROM patient_charges WHERE clinic_id = ${clinicId}) +
        (SELECT count(*) FROM lancamentos WHERE clinic_id = ${clinicId}) +
        (SELECT count(*) FROM appointments WHERE clinic_id = ${clinicId}) +
        (SELECT count(*) FROM patients WHERE clinic_id = ${clinicId})
      )::int AS "domainRows",
      (
        (SELECT count(*) FROM outbox WHERE clinic_id = ${clinicId}) +
        (SELECT count(*) FROM patient_webhook_events WHERE clinic_id = ${clinicId})
      )::int AS "infraRows"
  `);
  assert(
    residue[0]?.clinics === 0 && residue[0]?.domainRows === 0 && residue[0]?.infraRows === 0,
    `cleanup incompleto: ${JSON.stringify(residue[0])}`,
  );
}

async function main(): Promise<void> {
  try {
    await createFixtures();

    await step('1 ramo A: falta publica retenção pelo worker real', async () => {
      await withTenant(clinicId, (tx) =>
        publishEvent(tx, {
          clinicId,
          eventType: SCHEDULING_EVENTS.NO_SHOW,
          payload: {
            appointmentId: appointmentA,
            clinicId,
            patientId,
            fromStatus: 'confirmado',
            toStatus: 'faltou',
          },
          idempotencyKey: `h1-no-show:${appointmentA}`,
        }),
      );
      await runWorkersUntil('ramo A', async () => {
        const rows = await dbAdmin.execute<{ status: string }>(sql`
          SELECT status FROM patient_credits WHERE id = ${creditA}
        `);
        return rows[0]?.status === 'retained';
      });

      const state = await dbAdmin.execute<{
        chargeStatus: string;
        creditStatus: string;
        remainderCount: number;
      }>(sql`
        SELECT
          (SELECT status::text FROM patient_charges WHERE id = ${chargeA}) AS "chargeStatus",
          (SELECT status::text FROM patient_credits WHERE id = ${creditA}) AS "creditStatus",
          (SELECT count(*)::int FROM patient_charges
            WHERE appointment_id = ${appointmentA} AND kind = 'remainder') AS "remainderCount"
      `);
      assert(state[0]?.chargeStatus === 'paid', 'retenção não pode reescrever a cobrança paga');
      assert(state[0]?.creditStatus === 'retained', 'crédito do sinal não ficou retained');
      assert(state[0]?.remainderCount === 0, 'falta criou cobrança do restante');
    });

    await step('2 ramo B: webhooks concorrentes conciliam o restante uma vez', async () => {
      const outcomes = await Promise.all([
        markDepositPaid({
          clinicId,
          providerPaymentId: providerPaymentB,
          asaasEventId: `evt-h1-b-1-${stamp}`,
          eventType: 'PAYMENT_RECEIVED',
          paidAt: new Date(),
          billingType: 'PIX',
        }),
        markDepositPaid({
          clinicId,
          providerPaymentId: providerPaymentB,
          asaasEventId: `evt-h1-b-2-${stamp}`,
          eventType: 'PAYMENT_CONFIRMED',
          paidAt: new Date(),
          billingType: 'PIX',
        }),
      ]);
      assert(outcomes.filter((outcome) => outcome === 'paid').length === 1, `${outcomes}`);
      assert(outcomes.filter((outcome) => outcome === 'already_paid').length === 1, `${outcomes}`);

      const replay = await markDepositPaid({
        clinicId,
        providerPaymentId: providerPaymentB,
        asaasEventId: `evt-h1-b-1-${stamp}`,
        eventType: 'PAYMENT_RECEIVED',
        paidAt: new Date(),
        billingType: 'PIX',
      });
      assert(replay === 'ignored', `replay do mesmo eventId devolveu ${replay}`);
    });

    await step('3 ramo B: crédito do restante quita o recebível pelo worker', async () => {
      await runWorkersUntil('ramo B', async () => {
        const rows = await dbAdmin.execute<{ status: string }>(sql`
          SELECT status FROM lancamentos WHERE id = ${lancamentoB}
        `);
        return rows[0]?.status === 'pago';
      });

      const state = await dbAdmin.execute<{
        chargeStatus: string;
        creditCount: number;
        creditStatus: string;
        allocatedAmount: string;
        lancamentoStatus: string;
        valorPago: string;
        paidAt: string | null;
        transactionCount: number;
        transactionTotal: string;
      }>(sql`
        SELECT
          (SELECT status::text FROM patient_charges WHERE id = ${chargeBRemainder}) AS "chargeStatus",
          (SELECT count(*)::int FROM patient_credits
            WHERE clinic_id = ${clinicId} AND patient_charge_id = ${chargeBRemainder}) AS "creditCount",
          (SELECT status::text FROM patient_credits
            WHERE clinic_id = ${clinicId} AND patient_charge_id = ${chargeBRemainder}) AS "creditStatus",
          (SELECT allocated_amount::text FROM patient_credits
            WHERE clinic_id = ${clinicId} AND patient_charge_id = ${chargeBRemainder}) AS "allocatedAmount",
          (SELECT status::text FROM lancamentos WHERE id = ${lancamentoB}) AS "lancamentoStatus",
          (SELECT valor_pago::text FROM lancamentos WHERE id = ${lancamentoB}) AS "valorPago",
          (SELECT paid_at::text FROM lancamentos WHERE id = ${lancamentoB}) AS "paidAt",
          (SELECT count(*)::int FROM payment_transactions
            WHERE lancamento_id = ${lancamentoB}) AS "transactionCount",
          (SELECT coalesce(sum(amount), 0)::text FROM payment_transactions
            WHERE lancamento_id = ${lancamentoB}) AS "transactionTotal"
      `);
      assert(state[0]?.chargeStatus === 'paid', 'cobrança do restante não ficou paid');
      assert(state[0]?.creditCount === 1, `houve ${state[0]?.creditCount} créditos do restante`);
      assert(state[0]?.creditStatus === 'allocated', 'crédito do restante não foi alocado');
      assert(state[0]?.allocatedAmount === '100.00', 'alocação do restante não foi R$ 100');
      assert(state[0]?.lancamentoStatus === 'pago', 'recebível não ficou pago');
      assert(state[0]?.valorPago === '200.00', 'valorPago não fechou em R$ 200');
      assert(Boolean(state[0]?.paidAt), 'recebível pago ficou sem paid_at');
      assert(state[0]?.transactionCount === 2, 'ledger deveria ter sinal + restante');
      assert(state[0]?.transactionTotal === '200.00', 'ledger não fecha em R$ 200');
    });

    await step('4 ramo C: fechamento concorrente publica um único estorno', async () => {
      const closedAt = new Date();
      const outcomes = await Promise.all([
        closeCharge({
          clinicId,
          chargeId: chargeC,
          from: 'paid',
          outcome: 'refunded',
          kind: 'deposit',
          appointmentId: appointmentC,
          amount: 100,
          closedAt,
        }),
        closeCharge({
          clinicId,
          chargeId: chargeC,
          from: 'paid',
          outcome: 'refunded',
          kind: 'deposit',
          appointmentId: appointmentC,
          amount: 100,
          closedAt,
        }),
      ]);
      assert(outcomes.filter(Boolean).length === 1, `fechamentos vencedores: ${outcomes}`);
    });

    await step('5 ramo C: worker projeta agenda e libera crédito como refunded', async () => {
      await runWorkersUntil('ramo C', async () => {
        const rows = await dbAdmin.execute<{ credit: string; deposit: string }>(sql`
          SELECT
            (SELECT status::text FROM patient_credits WHERE id = ${creditC}) AS credit,
            (SELECT deposit_status::text FROM appointments WHERE id = ${appointmentC}) AS deposit
        `);
        return rows[0]?.credit === 'refunded' && rows[0]?.deposit === 'refunded';
      });

      const state = await dbAdmin.execute<{
        chargeStatus: string;
        refundedAt: string | null;
        creditStatus: string;
        creditReleasedAt: string | null;
        depositStatus: string;
        lancamentoCount: number;
      }>(sql`
        SELECT
          (SELECT status::text FROM patient_charges WHERE id = ${chargeC}) AS "chargeStatus",
          (SELECT refunded_at::text FROM patient_charges WHERE id = ${chargeC}) AS "refundedAt",
          (SELECT status::text FROM patient_credits WHERE id = ${creditC}) AS "creditStatus",
          (SELECT released_at::text FROM patient_credits WHERE id = ${creditC}) AS "creditReleasedAt",
          (SELECT deposit_status::text FROM appointments WHERE id = ${appointmentC}) AS "depositStatus",
          (SELECT count(*)::int FROM lancamentos WHERE appointment_id = ${appointmentC}) AS "lancamentoCount"
      `);
      assert(state[0]?.chargeStatus === 'refunded', 'cobrança C não ficou refunded');
      assert(Boolean(state[0]?.refundedAt), 'cobrança refunded ficou sem refunded_at');
      assert(state[0]?.creditStatus === 'refunded', 'crédito C não ficou refunded');
      assert(Boolean(state[0]?.creditReleasedAt), 'crédito refunded ficou sem released_at');
      assert(state[0]?.depositStatus === 'refunded', 'agenda não projetou depósito refunded');
      assert(state[0]?.lancamentoCount === 0, 'cancelamento criou recebível indevido');
    });

    await step('6 outbox: eventos da fixture terminaram sem falha/retry pendente', async () => {
      const rows = await dbAdmin.execute<{ failed: number; pending: number }>(sql`
        SELECT
          count(*) FILTER (WHERE status = 'failed')::int AS failed,
          count(*) FILTER (WHERE status IN ('pending', 'processing'))::int AS pending
          FROM outbox
         WHERE clinic_id = ${clinicId}
      `);
      assert(rows[0]?.failed === 0, `${rows[0]?.failed} evento(s) failed`);
      assert(rows[0]?.pending === 0, `${rows[0]?.pending} evento(s) ainda pendente(s)`);
    });
  } finally {
    await cleanup();
    console.log('[OK]   7 cleanup: zero fixtures da jornada e usuário sintético removido');
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    throw new Error(`jornada 1.H falhou em ${failed.length}/${results.length} checks`);
  }
  console.log(`\n1.H JOURNEY PASS — ${results.length + 1}/${results.length + 1} checks`);
}

main().catch((error) => {
  console.error(errorDetail(error));
  process.exitCode = 1;
});
