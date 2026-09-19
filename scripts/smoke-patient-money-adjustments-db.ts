/**
 * Prova DEV da 0092 sem Asaas/Meta: RLS, D50, D27, replay e isolamento.
 * Usa fixtures sintéticas e remove as clínicas no `finally`.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { listAvailableCredits } from '@/contexts/financial/internal/credit-store';
import {
  applyPatientPaymentRisk,
  recordExcessRefund,
} from '@/contexts/financial/internal/patient-credit-adjustment';
import { confirmRefundIntentFromReadback } from '@/contexts/payments/internal/excess-refund';

assertDevContext();

const clinicA = randomUUID();
const clinicB = randomUUID();
const patientId = randomUUID();
const procedureId = randomUUID();
const excessAppointmentId = randomUUID();
const disputeAppointmentId = randomUUID();
const lossAppointmentId = randomUUID();
const terminalAppointmentId = randomUUID();
const excessChargeId = randomUUID();
const disputeChargeId = randomUUID();
const lossChargeId = randomUUID();
const terminalChargeId = randomUUID();
const excessCreditId = randomUUID();
const disputeCreditId = randomUUID();
const lossCreditId = randomUUID();
const excessLancamentoId = randomUUID();
const lossLancamentoId = randomUUID();
const excessPaymentId = randomUUID();
const lossPaymentId = randomUUID();
const refundIntentId = randomUUID();
const depositRefundIntentId = randomUUID();
const terminalRefundIntentId = randomUUID();
const run = randomUUID().replaceAll('-', '');

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fixtureDoctorId(): Promise<string> {
  const rows = await dbAdmin.execute<{ id: string }>(sql`
    SELECT id::text AS id FROM profiles WHERE ativo = true ORDER BY id LIMIT 1
  `);
  const id = rows[0]?.id;
  if (!id) throw new Error('[money-adjustments-db] DEV precisa de um profile ativo');
  return id;
}

async function createFixtures(): Promise<void> {
  const doctorId = await fixtureDoctorId();
  await dbAdmin.execute(sql`
    INSERT INTO clinics (id, slug, nome, endereco, status, timezone)
    VALUES
      (${clinicA}, ${`money-a-${run.slice(0, 12)}`}, 'Money DB A', 'Sintética', 'active', 'America/Sao_Paulo'),
      (${clinicB}, ${`money-b-${run.slice(0, 12)}`}, 'Money DB B', 'Sintética', 'active', 'America/Sao_Paulo')
  `);
  await dbAdmin.execute(sql`
    INSERT INTO patients (id, clinic_id, nome, cpf_encrypted, cpf_hash)
    VALUES (${patientId}, ${clinicA}, 'Paciente Financeiro Sintético', 'fixture',
            ${run.padEnd(64, '0').slice(0, 64)})
  `);
  await dbAdmin.execute(sql`
    INSERT INTO procedures (id, clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min)
    VALUES (${procedureId}, ${clinicA}, ${`MNY-${run.slice(0, 8)}`},
            'Procedimento sintético financeiro', 200, 30)
  `);
  for (const appointmentId of [
    excessAppointmentId,
    disputeAppointmentId,
    lossAppointmentId,
    terminalAppointmentId,
  ]) {
    await dbAdmin.execute(sql`
      INSERT INTO appointments (
        id, clinic_id, doctor_id, patient_id, procedure_id, scheduled_at,
        duration_min, status, valor, snapshot_procedure_name,
        snapshot_procedure_valor, snapshot_procedure_duracao_min,
        snapshot_doctor_nome, created_via
      ) VALUES (
        ${appointmentId}, ${clinicA}, ${doctorId}, ${patientId}, ${procedureId}, now(),
        30, 'faltou', 200, 'Procedimento sintético', 200, 30,
        'Profissional sintético', 'attendant'
      )
    `);
  }
  await dbAdmin.execute(sql`
    INSERT INTO patient_charges (
      id, clinic_id, appointment_id, patient_id, kind, status, amount,
      provider, provider_payment_id, external_reference, paid_at
    ) VALUES
      (
        ${excessChargeId}, ${clinicA}, ${excessAppointmentId}, ${patientId},
        'remainder', 'paid', 130, 'asaas', ${`pay_${run.slice(0, 12)}`},
        ${`remainder:${excessAppointmentId}`}, now()
      ),
      (
        ${disputeChargeId}, ${clinicA}, ${disputeAppointmentId}, ${patientId},
        'deposit', 'paid', 40, 'asaas', ${`pay_${run.slice(12, 24)}`},
        ${`deposit:${disputeAppointmentId}`}, now()
      ),
      (
        ${terminalChargeId}, ${clinicA}, ${terminalAppointmentId}, ${patientId},
        'deposit', 'paid', 50, 'asaas', ${`pay_${run.slice(20, 32)}`},
        ${`deposit:${terminalAppointmentId}`}, now()
      )
  `);
  await dbAdmin.execute(sql`
    INSERT INTO lancamentos (
      id, clinic_id, tipo, descricao, valor, valor_pago, status, paid_at,
      appointment_id, patient_id, created_via
    ) VALUES
      (${excessLancamentoId}, ${clinicA}, 'receber', 'Excedente sintético', 100, 100,
       'pago', now(), ${excessAppointmentId}, ${patientId}, 'auto'),
      (${lossLancamentoId}, ${clinicA}, 'receber', 'Chargeback sintético', 200, 100,
       'parcial', NULL, ${lossAppointmentId}, ${patientId}, 'auto')
  `);
  await dbAdmin.execute(sql`
    INSERT INTO payment_transactions (
      id, clinic_id, lancamento_id, kind, amount, payment_method, occurred_at
    ) VALUES
      (${excessPaymentId}, ${clinicA}, ${excessLancamentoId}, 'payment', 100, 'pix', now()),
      (${lossPaymentId}, ${clinicA}, ${lossLancamentoId}, 'payment', 100, 'cartao_credito', now())
  `);
  await dbAdmin.execute(sql`
    INSERT INTO patient_credits (
      id, clinic_id, patient_id, appointment_id, patient_charge_id, amount,
      allocated_amount, allocated_lancamento_id, allocated_payment_transaction_id,
      kind, status, payment_method
    ) VALUES
      (${excessCreditId}, ${clinicA}, ${patientId}, ${excessAppointmentId}, ${excessChargeId},
       130, 100, ${excessLancamentoId}, ${excessPaymentId}, 'remaining_payment', 'allocated', 'pix'),
      (${disputeCreditId}, ${clinicA}, ${patientId}, ${disputeAppointmentId}, ${disputeChargeId},
       40, 0, NULL, NULL, 'deposit', 'available', 'pix'),
      (${lossCreditId}, ${clinicA}, ${patientId}, ${lossAppointmentId}, ${lossChargeId},
       100, 100, ${lossLancamentoId}, ${lossPaymentId}, 'deposit', 'allocated', 'cartao_credito')
  `);
}

async function cleanup(): Promise<void> {
  await dbAdmin.execute(
    sql`DELETE FROM patient_credit_adjustments WHERE clinic_id IN (${clinicA}, ${clinicB})`,
  );
  await dbAdmin.execute(
    sql`DELETE FROM patient_refund_intents WHERE clinic_id IN (${clinicA}, ${clinicB})`,
  );
  await dbAdmin.execute(sql`DELETE FROM clinics WHERE id IN (${clinicA}, ${clinicB})`);
  const rows = await dbAdmin.execute<{ clinics: number; adjustments: number; intents: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM clinics WHERE id IN (${clinicA}, ${clinicB})) AS clinics,
      (SELECT count(*)::int FROM patient_credit_adjustments WHERE clinic_id = ${clinicA}) AS adjustments,
      (SELECT count(*)::int FROM patient_refund_intents WHERE clinic_id = ${clinicA}) AS intents
  `);
  assert(
    rows[0]?.clinics === 0 && rows[0]?.adjustments === 0 && rows[0]?.intents === 0,
    '[money-adjustments-db] cleanup incompleto',
  );
}

async function main(): Promise<void> {
  try {
    await createFixtures();

    const structure = await dbAdmin.execute<{
      intentForced: boolean;
      adjustmentForced: boolean;
      intentDelete: boolean;
      adjustmentDelete: boolean;
    }>(sql`
      SELECT
        (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'patient_refund_intents'::regclass)
          AS "intentForced",
        (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'patient_credit_adjustments'::regclass)
          AS "adjustmentForced",
        has_table_privilege('authenticated', 'patient_refund_intents', 'DELETE') AS "intentDelete",
        has_table_privilege('authenticated', 'patient_credit_adjustments', 'DELETE') AS "adjustmentDelete"
    `);
    assert(structure[0]?.intentForced === true, 'RLS da intenção não está forçada');
    assert(structure[0]?.adjustmentForced === true, 'RLS do ajuste não está forçada');
    assert(structure[0]?.intentDelete === false, 'authenticated pode apagar intenção');
    assert(structure[0]?.adjustmentDelete === false, 'authenticated pode apagar ajuste');
    console.log('[OK] 1/7 estrutura, RLS e grants');

    const intentWinners = await Promise.all(
      Array.from({ length: 2 }, () =>
        withTenant(clinicA, (tx) =>
          tx.execute<{ id: string }>(sql`
            INSERT INTO patient_refund_intents (
              id, clinic_id, patient_charge_id, amount, provider_payment_id, source_event_id
            ) VALUES (
              ${refundIntentId}, ${clinicA}, ${excessChargeId}, 30,
              ${`pay_${run.slice(0, 12)}`}, ${randomUUID()}
            )
            ON CONFLICT DO NOTHING RETURNING id
          `),
        ),
      ),
    );
    assert(intentWinners.filter((rows) => rows.length === 1).length === 1, 'intenção duplicou');
    console.log('[OK] 2/7 intenção idempotente sob concorrência');

    await withTenant(clinicA, (tx) =>
      tx.execute(sql`
        INSERT INTO patient_refund_intents (
          id, clinic_id, patient_charge_id, purpose, amount, status,
          provider_payment_id, baseline_refunded_amount, baseline_refund_count,
          baseline_rejected_refund_count, source_event_id
        ) VALUES (
          ${depositRefundIntentId}, ${clinicA}, ${disputeChargeId}, 'deposit_closeout', 40,
          'confirmation_pending', ${`pay_${run.slice(12, 24)}`}, 0, 0, 0, ${randomUUID()}
        )
      `),
    );
    const cancelled = await confirmRefundIntentFromReadback({
      clinicId: clinicA,
      intentId: depositRefundIntentId,
      refunds: [{ refundId: null, status: 'CANCELLED', value: 40 }],
    });
    const cancelledState = await dbAdmin.execute<{
      chargeStatus: string;
      intentStatus: string;
      failureCode: string | null;
    }>(sql`
      SELECT pc.status::text AS "chargeStatus",
             pri.status::text AS "intentStatus",
             pri.failure_code AS "failureCode"
        FROM patient_charges pc
        JOIN patient_refund_intents pri ON pri.patient_charge_id = pc.id
       WHERE pri.id = ${depositRefundIntentId}
    `);
    assert(cancelled === 'failed', 'CANCELLED não encerrou a intenção como falha');
    assert(
      cancelledState[0]?.chargeStatus === 'paid' &&
        cancelledState[0]?.intentStatus === 'failed' &&
        cancelledState[0]?.failureCode === 'refund_cancelled',
      'CANCELLED projetou devolução inexistente',
    );
    const crossTenantIntent = await withTenant(clinicB, (tx) =>
      tx.execute(sql`SELECT id FROM patient_refund_intents WHERE id = ${depositRefundIntentId}`),
    );
    assert(crossTenantIntent.length === 0, 'RLS expôs intenção a outro tenant');
    console.log('[OK] 3/7 D77 mantém cobrança paga quando refund termina CANCELLED');

    await withTenant(clinicA, (tx) =>
      tx.execute(sql`
        INSERT INTO patient_refund_intents (
          id, clinic_id, patient_charge_id, purpose, amount, status,
          provider_payment_id, provider_refund_id, baseline_refunded_amount,
          baseline_refund_count, baseline_rejected_refund_count, source_event_id
        ) VALUES (
          ${terminalRefundIntentId}, ${clinicA}, ${terminalChargeId}, 'deposit_closeout', 50,
          'confirmation_pending', ${`pay_${run.slice(20, 32)}`}, 'refund-terminal',
          0, 0, 0, ${randomUUID()}
        )
      `),
    );
    const terminalFirst = await confirmRefundIntentFromReadback({
      clinicId: clinicA,
      intentId: terminalRefundIntentId,
      refunds: [{ refundId: 'refund-terminal', status: 'DONE', value: 50 }],
    });
    const terminalReplay = await confirmRefundIntentFromReadback({
      clinicId: clinicA,
      intentId: terminalRefundIntentId,
      refunds: [{ refundId: 'refund-terminal', status: 'DONE', value: 50 }],
    });
    const terminalState = await dbAdmin.execute<{
      chargeStatus: string;
      intentStatus: string;
      refundEvents: number;
    }>(sql`
      SELECT pc.status::text AS "chargeStatus",
             pri.status::text AS "intentStatus",
             (
               SELECT count(*)::int FROM outbox oe
                WHERE oe.clinic_id = ${clinicA}
                  AND oe.idempotency_key IN (
                    ${`charge-closed:${terminalChargeId}`},
                    ${`credit-released:${terminalChargeId}`}
                  )
             ) AS "refundEvents"
        FROM patient_charges pc
        JOIN patient_refund_intents pri ON pri.patient_charge_id = pc.id
       WHERE pri.id = ${terminalRefundIntentId}
    `);
    assert(terminalFirst === 'confirmed' && terminalReplay === 'confirmed', 'DONE não confirmou');
    assert(
      terminalState[0]?.chargeStatus === 'refunded' &&
        terminalState[0]?.intentStatus === 'confirmed' &&
        terminalState[0]?.refundEvents === 2,
      'DONE não fechou cobrança + crédito exatamente uma vez',
    );
    console.log('[OK] 4/7 DONE fecha cobrança e eventos atomicamente; replay é idempotente');

    const excessEvent = randomUUID();
    await withTenant(clinicA, (tx) =>
      recordExcessRefund(tx, {
        clinicId: clinicA,
        appointmentId: excessAppointmentId,
        patientChargeId: excessChargeId,
        amount: 30,
        sourceEventId: excessEvent,
        occurredAt: new Date(),
      }),
    );
    const replay = await withTenant(clinicA, (tx) =>
      recordExcessRefund(tx, {
        clinicId: clinicA,
        appointmentId: excessAppointmentId,
        patientChargeId: excessChargeId,
        amount: 30,
        sourceEventId: excessEvent,
        occurredAt: new Date(),
      }),
    );
    const excess = await dbAdmin.execute<{ reversed: string; adjustments: number }>(sql`
      SELECT pc.unallocated_reversed_amount::text AS reversed,
             count(pca.id)::int AS adjustments
        FROM patient_credits pc
        LEFT JOIN patient_credit_adjustments pca ON pca.patient_credit_id = pc.id
       WHERE pc.id = ${excessCreditId}
       GROUP BY pc.id
    `);
    assert(replay === 'duplicate', 'replay D50 não foi deduplicado');
    assert(excess[0]?.reversed === '30.00', 'D50 não compensou exatamente 30');
    assert(excess[0]?.adjustments === 1, 'D50 criou mais de um ajuste');
    console.log('[OK] 5/7 D50 exato e idempotente');

    await withTenant(clinicA, (tx) =>
      applyPatientPaymentRisk(tx, {
        clinicId: clinicA,
        payload: {
          clinicId: clinicA,
          appointmentId: disputeAppointmentId,
          chargeId: disputeChargeId,
          amount: 40,
          state: 'in_dispute',
          reason: 'COMMERCIAL_DISAGREEMENT',
          changedAt: new Date().toISOString(),
        },
        sourceEventId: randomUUID(),
      }),
    );
    const blocked = await withTenant(clinicA, (tx) =>
      listAvailableCredits(tx, clinicA, disputeAppointmentId),
    );
    assert(blocked.length === 0, 'crédito em disputa continuou alocável');
    await withTenant(clinicA, (tx) =>
      applyPatientPaymentRisk(tx, {
        clinicId: clinicA,
        payload: {
          clinicId: clinicA,
          appointmentId: disputeAppointmentId,
          chargeId: disputeChargeId,
          amount: 40,
          state: 'reversed',
          reason: null,
          changedAt: new Date().toISOString(),
        },
        sourceEventId: randomUUID(),
      }),
    );
    const released = await withTenant(clinicA, (tx) =>
      listAvailableCredits(tx, clinicA, disputeAppointmentId),
    );
    assert(released.length === 1, 'disputa ganha não liberou o crédito');
    console.log('[OK] 6/7 disputa bloqueia e reversão libera');

    const lossEvent = randomUUID();
    const lossPayload = {
      clinicId: clinicA,
      appointmentId: lossAppointmentId,
      chargeId: lossChargeId,
      amount: 100,
      state: 'lost' as const,
      reason: 'COMMERCIAL_DISAGREEMENT',
      changedAt: new Date().toISOString(),
    };
    await withTenant(clinicA, (tx) =>
      applyPatientPaymentRisk(tx, {
        clinicId: clinicA,
        payload: lossPayload,
        sourceEventId: lossEvent,
      }),
    );
    await withTenant(clinicA, (tx) =>
      applyPatientPaymentRisk(tx, {
        clinicId: clinicA,
        payload: lossPayload,
        sourceEventId: lossEvent,
      }),
    );
    const loss = await dbAdmin.execute<{
      paid: string;
      status: string;
      refunds: number;
      adjustments: number;
      linked: boolean;
    }>(sql`
      SELECT l.valor_pago::text AS paid, l.status,
             count(DISTINCT pt.id)::int AS refunds,
             count(DISTINCT pca.id)::int AS adjustments,
             bool_and(pt.original_payment_id = ${lossPaymentId}) AS linked
        FROM lancamentos l
        JOIN payment_transactions pt ON pt.lancamento_id = l.id AND pt.kind = 'refund'
        JOIN patient_credit_adjustments pca ON pca.patient_credit_id = ${lossCreditId}
       WHERE l.id = ${lossLancamentoId}
       GROUP BY l.id
    `);
    assert(loss[0]?.paid === '0.00' && loss[0]?.status === 'pendente', 'saldo não reabriu');
    assert(loss[0]?.refunds === 1 && loss[0]?.adjustments === 1, 'perda duplicou ledger');
    assert(loss[0]?.linked === true, 'refund não aponta para a baixa original');

    const crossTenant = await withTenant(clinicB, (tx) =>
      tx.execute(sql`SELECT id FROM patient_credit_adjustments WHERE clinic_id = ${clinicA}`),
    );
    assert(crossTenant.length === 0, 'RLS expôs ajuste a outro tenant');
    console.log('[OK] 7/7 perda recompõe ledger, replay e cross-tenant');
  } finally {
    await cleanup();
    console.log('[OK] cleanup sem resíduos');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
