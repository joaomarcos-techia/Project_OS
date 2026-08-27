/**
 * Camada 1 / 1.H — E2E controlado dos três ramos com banco + outbox worker.
 *
 * Usa fixtures sintéticas no banco DEV e os seams autoritativos do Payments.
 * Não chama Asaas nem Meta:
 *   A) falta com sinal pago -> crédito retained, sem restante;
 *   B) restante pago -> webhook concorrente, crédito alocado e recebível pago;
 *   C) refund já confirmado no seam -> cobrança, agenda e crédito refunded;
 *   D) pagamento concorrente com expiração -> vaga não ressuscita e dinheiro fecha uma vez.
 *
 * O que fica fora por definição: transporte real Asaas e entrega real Meta.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { publishEvent } from '@/lib/outbox/publish';
import { runOutboxOnce } from '@/lib/outbox/worker';

import { lancamentos, patientCredits, paymentTransactions } from '@/contexts/financial/schema';
import { patients } from '@/contexts/patient';
import { SCHEDULING_EVENTS, appointments, procedures } from '@/contexts/scheduling';
import { patientCharges } from '@/contexts/payments/schema';
import {
  closeCharge,
  insertRemainderCharge,
  markDepositPaid,
} from '@/contexts/payments/internal/charge-store';
import { applyTransition } from '@/contexts/scheduling/internal/appointment-core';

// Catálogo + registry de handlers do worker real.
import '@/lib/db/schema';
import '@/app/api/cron/outbox/handlers';

assertDevContext();

type Result = { name: string; ok: boolean; detail?: string };

const results: Result[] = [];
const runId = randomUUID();
const stamp = runId.replaceAll('-', '').slice(0, 12);
const clinicId = randomUUID();
const otherClinicId = randomUUID();
const patientId = randomUUID();
const otherPatientId = randomUUID();
const procedureId = randomUUID();
const otherProcedureId = randomUUID();
const appointmentA = randomUUID();
const appointmentB = randomUUID();
const appointmentC = randomUUID();
const appointmentD = randomUUID();
const appointmentE = randomUUID();
const otherAppointment = randomUUID();

const chargeA = randomUUID();
const chargeBDeposit = randomUUID();
const chargeBRemainder = randomUUID();
const chargeC = randomUUID();
const chargeD = randomUUID();
const otherCharge = randomUUID();
const creditA = randomUUID();
const creditBDeposit = randomUUID();
const creditC = randomUUID();
const lancamentoB = randomUUID();

const providerPaymentB = `pay_hardening_${stamp}`;
const providerPaymentD = `pay_hold_race_${stamp}`;
const otherProviderPayment = `pay_other_tenant_${stamp}`;
const supabase = createAdminClient();
let doctorId: string | null = null;
let otherDoctorId: string | null = null;

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

function scheduledIn(daysAhead: number, hour: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

async function createFixtures(): Promise<void> {
  await dbAdmin.execute(sql`
    INSERT INTO clinics (id, slug, nome, endereco, status, timezone)
    VALUES
      (
        ${clinicId}, ${`h1-journey-${stamp}`}, '1.H Jornada Sintética',
        'Fixture sintética', 'active', 'America/Sao_Paulo'
      ),
      (
        ${otherClinicId}, ${`h1-other-${stamp}`}, '1.H Tenant Sintético B',
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

  const otherCreated = await supabase.auth.admin.createUser({
    email: `h1-other-${stamp}@smoke.local`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (otherCreated.error || !otherCreated.data.user) {
    throw otherCreated.error ?? new Error('não foi possível criar médico sintético B');
  }
  otherDoctorId = otherCreated.data.user.id;

  await dbAdmin.execute(sql`
    INSERT INTO profiles (id, clinic_id, nome, role, ativo)
    VALUES
      (${doctorId}, ${clinicId}, 'Dra. Hardening', 'doctor'::role_enum, true),
      (${otherDoctorId}, ${otherClinicId}, 'Dr. Tenant B', 'doctor'::role_enum, true)
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
      {
        ...base,
        id: appointmentD,
        scheduledAt: scheduledIn(10, 15),
        status: 'agendado',
        depositStatus: 'pending',
        holdExpiresAt: scheduledAt(1, 12),
      },
      {
        ...base,
        id: appointmentE,
        scheduledAt: scheduledAt(1, 16),
        status: 'atendido',
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
      {
        id: chargeD,
        clinicId,
        appointmentId: appointmentD,
        patientId,
        kind: 'deposit',
        status: 'pending',
        amount: '100.00',
        providerPaymentId: providerPaymentD,
        invoiceUrl: 'https://example.invalid/hold-race',
        externalReference: `deposit:${appointmentD}`,
        holdExpiresAt: scheduledAt(1, 12),
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

  await withTenant(otherClinicId, async (tx) => {
    await tx.insert(procedures).values({
      id: otherProcedureId,
      clinicId: otherClinicId,
      codigo: `H1B-${stamp.slice(0, 6)}`,
      descricao: 'Consulta sintética do tenant B',
      valorPadrao: '150.00',
      duracaoPadraoMin: 30,
    });
    await tx.insert(patients).values({
      id: otherPatientId,
      clinicId: otherClinicId,
      nome: 'Paciente Sintético Tenant B',
      cpfEncrypted: 'fixture-sem-pii',
      cpfHash: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
    });
    await tx.insert(appointments).values({
      id: otherAppointment,
      clinicId: otherClinicId,
      doctorId: otherDoctorId!,
      patientId: otherPatientId,
      procedureId: otherProcedureId,
      scheduledAt: scheduledIn(8, 14),
      durationMin: 30,
      status: 'agendado',
      valor: '150.00',
      depositStatus: 'pending',
      holdExpiresAt: scheduledIn(1, 14),
      snapshotProcedureName: 'Consulta sintética do tenant B',
      snapshotProcedureValor: '150.00',
      snapshotProcedureDuracaoMin: 30,
      snapshotDoctorNome: 'Dr. Tenant B',
    });
    await tx.insert(patientCharges).values({
      id: otherCharge,
      clinicId: otherClinicId,
      appointmentId: otherAppointment,
      patientId: otherPatientId,
      kind: 'deposit',
      status: 'pending',
      amount: '75.00',
      providerPaymentId: otherProviderPayment,
      invoiceUrl: 'https://example.invalid/other-tenant',
      externalReference: `deposit:${otherAppointment}`,
      holdExpiresAt: scheduledIn(1, 14),
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
  for (const fixtureClinicId of [clinicId, otherClinicId]) {
    for (const table of ['outbox', 'idempotency_keys', 'audit_events'] as const) {
      await dbAdmin.execute(
        sql`DELETE FROM ${sql.raw(table)} WHERE clinic_id = ${fixtureClinicId}`,
      );
    }
    await dbAdmin.execute(
      sql`DELETE FROM patient_webhook_events WHERE clinic_id = ${fixtureClinicId}`,
    );
    await dbAdmin.execute(sql`DELETE FROM patient_credits WHERE clinic_id = ${fixtureClinicId}`);
    await dbAdmin.execute(
      sql`DELETE FROM payment_transactions WHERE clinic_id = ${fixtureClinicId}`,
    );
    await dbAdmin.execute(sql`DELETE FROM patient_charges WHERE clinic_id = ${fixtureClinicId}`);
    await dbAdmin.execute(sql`DELETE FROM lancamentos WHERE clinic_id = ${fixtureClinicId}`);
    await dbAdmin.execute(sql`DELETE FROM appointments WHERE clinic_id = ${fixtureClinicId}`);
    await dbAdmin.execute(sql`DELETE FROM patients WHERE clinic_id = ${fixtureClinicId}`);
    await dbAdmin.execute(sql`DELETE FROM procedures WHERE clinic_id = ${fixtureClinicId}`);
    await dbAdmin.execute(sql`DELETE FROM profiles WHERE clinic_id = ${fixtureClinicId}`);
    await dbAdmin.execute(sql`DELETE FROM clinics WHERE id = ${fixtureClinicId}`);
  }

  for (const fixtureDoctorId of [doctorId, otherDoctorId]) {
    if (!fixtureDoctorId) continue;
    const removed = await supabase.auth.admin.deleteUser(fixtureDoctorId);
    if (removed.error) throw removed.error;
  }

  const residue = await dbAdmin.execute<{
    clinics: number;
    domainRows: number;
    infraRows: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM clinics
        WHERE id IN (${clinicId}, ${otherClinicId})) AS clinics,
      (
        (SELECT count(*) FROM patient_credits
          WHERE clinic_id IN (${clinicId}, ${otherClinicId})) +
        (SELECT count(*) FROM payment_transactions
          WHERE clinic_id IN (${clinicId}, ${otherClinicId})) +
        (SELECT count(*) FROM patient_charges
          WHERE clinic_id IN (${clinicId}, ${otherClinicId})) +
        (SELECT count(*) FROM lancamentos
          WHERE clinic_id IN (${clinicId}, ${otherClinicId})) +
        (SELECT count(*) FROM appointments
          WHERE clinic_id IN (${clinicId}, ${otherClinicId})) +
        (SELECT count(*) FROM patients
          WHERE clinic_id IN (${clinicId}, ${otherClinicId}))
      )::int AS "domainRows",
      (
        (SELECT count(*) FROM outbox
          WHERE clinic_id IN (${clinicId}, ${otherClinicId})) +
        (SELECT count(*) FROM patient_webhook_events
          WHERE clinic_id IN (${clinicId}, ${otherClinicId}))
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

    await step('6 corrida hold×pagamento: ambos os fatos fecham uma vez', async () => {
      const [, paymentOutcome] = await Promise.all([
        withTenant(clinicId, async (tx) => {
          await applyTransition(tx, {
            clinicId,
            appointmentId: appointmentD,
            target: 'cancelado',
            transitionedBy: null,
            actorType: 'system',
            reason: 'sinal não pago dentro do prazo',
            cancelReason: 'deposit_expired',
            clientKey: `deposit-expired:${appointmentD}`,
            correlationId: null,
          });
          await tx
            .update(appointments)
            .set({ depositStatus: 'expired', holdExpiresAt: null, updatedAt: sql`now()` })
            .where(and(eq(appointments.id, appointmentD), eq(appointments.clinicId, clinicId)));
        }),
        markDepositPaid({
          clinicId,
          providerPaymentId: providerPaymentD,
          asaasEventId: `evt-hold-race-${stamp}`,
          eventType: 'PAYMENT_RECEIVED',
          paidAt: new Date(),
          billingType: 'PIX',
        }),
      ]);
      assert(paymentOutcome === 'paid', `pagamento concorrente devolveu ${paymentOutcome}`);

      // Seam posterior ao gateway: no caso real, o handler confirma o PIX no Asaas
      // antes de fechar. Aqui a devolução já confirmada evita qualquer chamada externa.
      const closed = await closeCharge({
        clinicId,
        chargeId: chargeD,
        from: 'paid',
        outcome: 'refunded',
        kind: 'deposit',
        appointmentId: appointmentD,
        amount: 100,
        closedAt: new Date(),
      });
      assert(closed, 'pagamento tardio não foi fechado como refunded');
    });

    await step(
      '7 corrida hold×pagamento: worker não ressuscita a vaga nem duplica crédito',
      async () => {
        await runWorkersUntil('corrida hold×pagamento', async () => {
          const rows = await dbAdmin.execute<{ credit: string; deposit: string }>(sql`
          SELECT
            (SELECT status::text FROM patient_credits
              WHERE patient_charge_id = ${chargeD}) AS credit,
            (SELECT deposit_status::text FROM appointments
              WHERE id = ${appointmentD}) AS deposit
        `);
          return rows[0]?.credit === 'refunded' && rows[0]?.deposit === 'refunded';
        });

        const state = await dbAdmin.execute<{
          appointmentStatus: string;
          depositStatus: string;
          chargeStatus: string;
          creditCount: number;
          creditStatus: string;
          cancellationEvents: number;
          paidEvents: number;
          closedEvents: number;
        }>(sql`
        SELECT
          (SELECT status::text FROM appointments WHERE id = ${appointmentD}) AS "appointmentStatus",
          (SELECT deposit_status::text FROM appointments WHERE id = ${appointmentD}) AS "depositStatus",
          (SELECT status::text FROM patient_charges WHERE id = ${chargeD}) AS "chargeStatus",
          (SELECT count(*)::int FROM patient_credits
            WHERE patient_charge_id = ${chargeD}) AS "creditCount",
          (SELECT status::text FROM patient_credits
            WHERE patient_charge_id = ${chargeD}) AS "creditStatus",
          (SELECT count(*)::int FROM outbox
            WHERE clinic_id = ${clinicId}
              AND event_type = 'scheduling.appointment.cancelled'
              AND payload->>'appointmentId' = ${appointmentD}) AS "cancellationEvents",
          (SELECT count(*)::int FROM outbox
            WHERE clinic_id = ${clinicId}
              AND event_type = 'payments.patient_charge.paid'
              AND payload->>'chargeId' = ${chargeD}) AS "paidEvents",
          (SELECT count(*)::int FROM outbox
            WHERE clinic_id = ${clinicId}
              AND event_type = 'payments.patient_charge.closed'
              AND payload->>'chargeId' = ${chargeD}) AS "closedEvents"
      `);
        assert(state[0]?.appointmentStatus === 'cancelado', 'pagamento tardio ressuscitou a vaga');
        assert(state[0]?.depositStatus === 'refunded', 'agenda não projetou o estorno tardio');
        assert(state[0]?.chargeStatus === 'refunded', 'cobrança tardia não terminou refunded');
        assert(state[0]?.creditCount === 1, `houve ${state[0]?.creditCount} créditos tardios`);
        assert(state[0]?.creditStatus === 'refunded', 'crédito tardio não foi liberado');
        assert(state[0]?.cancellationEvents === 1, 'corrida duplicou o cancelamento');
        assert(state[0]?.paidEvents === 1, 'corrida duplicou o pagamento');
        assert(state[0]?.closedEvents === 1, 'corrida duplicou o fechamento');
      },
    );

    await step('8 outbox: eventos da fixture terminaram sem falha/retry pendente', async () => {
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

    await step('9 restante concorrente: uma cobrança e um link_ready no banco real', async () => {
      const outcomes = await Promise.all([
        insertRemainderCharge({
          clinicId,
          appointmentId: appointmentE,
          patientId,
          amount: 80,
          providerPaymentId: `pay-remainder-a-${stamp}`,
          invoiceUrl: 'https://example.invalid/remainder-a',
        }),
        insertRemainderCharge({
          clinicId,
          appointmentId: appointmentE,
          patientId,
          amount: 80,
          providerPaymentId: `pay-remainder-b-${stamp}`,
          invoiceUrl: 'https://example.invalid/remainder-b',
        }),
      ]);
      assert(outcomes.filter(Boolean).length === 1, `inserts vencedores: ${outcomes}`);

      const rows = await dbAdmin.execute<{ charges: number; events: number }>(sql`
        SELECT
          (SELECT count(*)::int FROM patient_charges
            WHERE clinic_id = ${clinicId}
              AND appointment_id = ${appointmentE}
              AND kind = 'remainder') AS charges,
          (SELECT count(*)::int FROM outbox
            WHERE clinic_id = ${clinicId}
              AND event_type = 'payments.patient_charge.link_ready'
              AND payload->>'appointmentId' = ${appointmentE}) AS events
      `);
      assert(rows[0]?.charges === 1, `foram criadas ${rows[0]?.charges} cobranças`);
      assert(rows[0]?.events === 1, `foram publicados ${rows[0]?.events} link_ready`);
    });

    await step('10 multi-tenant: clínica A não concilia cobrança da B', async () => {
      const outcome = await markDepositPaid({
        clinicId,
        providerPaymentId: otherProviderPayment,
        asaasEventId: `evt-cross-tenant-${stamp}`,
        eventType: 'PAYMENT_RECEIVED',
        paidAt: new Date(),
        billingType: 'PIX',
      });
      assert(outcome === 'unknown_charge', `conciliação cross-tenant devolveu ${outcome}`);

      const rows = await dbAdmin.execute<{
        status: string;
        paidEvents: number;
        credits: number;
      }>(sql`
        SELECT
          (SELECT status::text FROM patient_charges WHERE id = ${otherCharge}) AS status,
          (SELECT count(*)::int FROM outbox
            WHERE clinic_id = ${otherClinicId}
              AND event_type = 'payments.patient_charge.paid'
              AND payload->>'chargeId' = ${otherCharge}) AS "paidEvents",
          (SELECT count(*)::int FROM patient_credits
            WHERE clinic_id = ${otherClinicId}
              AND patient_charge_id = ${otherCharge}) AS credits
      `);
      assert(rows[0]?.status === 'pending', 'A alterou a cobrança da clínica B');
      assert(rows[0]?.paidEvents === 0, 'A publicou pagamento para a clínica B');
      assert(rows[0]?.credits === 0, 'A criou crédito para a clínica B');
    });
  } finally {
    await cleanup();
    console.log('[OK]   11 cleanup: zero fixtures da jornada e usuários sintéticos removidos');
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
