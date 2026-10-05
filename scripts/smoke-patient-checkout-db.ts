/**
 * Prova DEV sem Asaas/Meta: RLS, lease, dedup, ativação, quarentena, rotação e cleanup.
 * Usa somente fixtures sintéticas e remove as duas clínicas no `finally`.
 */
// MUST be first: loads `.env.local` before any `@/lib/*` module validates env.
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { getEventSchema } from '@/lib/outbox/catalog';
import { getHandler } from '@/lib/outbox/registry';
import { schedulingApiV1 } from '@/contexts/scheduling';
import { paymentsApiV1 } from '@/contexts/payments';
import { publishCreated } from '@/contexts/scheduling/internal/appointment-core';
import { appointments } from '@/contexts/scheduling/schema';
import { scanPendingPaymentEconomics } from '@/app/api/cron/financial-reconcile/payment-economics-reconcile';
import '@/contexts/financial/internal/handlers/patient-credit-granted';
import '@/contexts/financial/internal/handlers/patient-payment-economics-reconciled';
import {
  activateCheckoutGeneration,
  claimInitialCheckoutCharge,
  findPayableCharge,
  markDepositPaid,
} from '@/contexts/payments/internal/charge-store';

assertDevContext();

const clinicA = randomUUID();
const clinicB = randomUUID();
const patientId = randomUUID();
const procedureId = randomUUID();
const appointmentId = randomUUID();
const aiAppointmentId = randomUUID();
const run = randomUUID().replaceAll('-', '');

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fixtureDoctorId(): Promise<string> {
  const rows = await dbAdmin.execute<{ id: string }>(sql`
    SELECT id::text AS id
      FROM profiles
     WHERE ativo = true
     ORDER BY id
     LIMIT 1
  `);
  const id = rows[0]?.id;
  if (!id) throw new Error('[checkout-db] DEV precisa de ao menos um profile ativo');
  return id;
}

async function createFixtures(): Promise<void> {
  const doctorId = await fixtureDoctorId();
  await dbAdmin.execute(sql`
    INSERT INTO clinics (id, slug, nome, endereco, status, timezone)
    VALUES
      (${clinicA}, ${`checkout-a-${run.slice(0, 12)}`}, 'Checkout DB A', 'Sintética', 'active', 'America/Sao_Paulo'),
      (${clinicB}, ${`checkout-b-${run.slice(0, 12)}`}, 'Checkout DB B', 'Sintética', 'active', 'America/Sao_Paulo')
  `);
  await dbAdmin.execute(sql`
    INSERT INTO patients (id, clinic_id, nome, cpf_encrypted, cpf_hash)
    VALUES (${patientId}, ${clinicA}, 'Paciente Checkout Sintético', 'fixture', ${run.padEnd(64, '0').slice(0, 64)})
  `);
  await dbAdmin.execute(sql`
    INSERT INTO procedures (
      id, clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min
    ) VALUES (
      ${procedureId}, ${clinicA}, ${`CHK-${run.slice(0, 8)}`},
      'Procedimento sintético Checkout', 100.00, 30
    )
  `);
  await dbAdmin.execute(sql`
    INSERT INTO appointments (
      id, clinic_id, doctor_id, patient_id, procedure_id, scheduled_at,
      duration_min, status, valor, snapshot_procedure_name,
      snapshot_procedure_valor, snapshot_procedure_duracao_min,
      snapshot_doctor_nome, created_via
    ) VALUES (
      ${appointmentId}, ${clinicA}, ${doctorId}, ${patientId}, ${procedureId}, now(),
      30, 'faltou', 100.00, 'Procedimento sintético', 100.00, 30,
      'Profissional sintético', 'attendant'
    )
  `);
  await dbAdmin.execute(sql`
    INSERT INTO appointments (
      id, clinic_id, doctor_id, patient_id, procedure_id, scheduled_at,
      duration_min, status, valor, snapshot_procedure_name,
      snapshot_procedure_valor, snapshot_procedure_duracao_min,
      snapshot_doctor_nome, created_via
    ) VALUES (
      ${aiAppointmentId}, ${clinicA}, ${doctorId}, ${patientId}, ${procedureId},
      now() + interval '7 days', 30, 'agendado', 100,
      'Procedimento sintético', 100, 30, 'Profissional sintético', 'ai_agent'
    )
  `);
}

async function cleanup(): Promise<void> {
  await dbAdmin.execute(sql`DELETE FROM outbox WHERE clinic_id IN (${clinicA}, ${clinicB})`);
  await dbAdmin.execute(sql`DELETE FROM clinics WHERE id IN (${clinicA}, ${clinicB})`);
  const residue = await dbAdmin.execute<{
    clinics: number;
    charges: number;
    generations: number;
    outbox: number;
    credits: number;
  }>(
    sql`
      SELECT
        (SELECT count(*)::int FROM clinics WHERE id IN (${clinicA}, ${clinicB})) AS clinics,
        (SELECT count(*)::int FROM patient_charges WHERE clinic_id = ${clinicA}) AS charges,
        (SELECT count(*)::int FROM patient_checkout_generations WHERE clinic_id = ${clinicA}) AS generations,
        (SELECT count(*)::int FROM outbox WHERE clinic_id IN (${clinicA}, ${clinicB})) AS outbox,
        (SELECT count(*)::int FROM patient_credits WHERE clinic_id = ${clinicA}) AS credits
    `,
  );
  assert(
    residue[0]?.clinics === 0 &&
      residue[0]?.charges === 0 &&
      residue[0]?.generations === 0 &&
      residue[0]?.outbox === 0 &&
      residue[0]?.credits === 0,
    '[checkout-db] cleanup incompleto',
  );
}

async function deliverSyntheticEvent(
  eventType: string,
  payload: Record<string, unknown>,
  eventId: string,
): Promise<void> {
  const schema = getEventSchema(eventType);
  const registered = getHandler(eventType);
  assert(schema !== undefined, `schema ausente: ${eventType}`);
  assert(registered?.execution === 'transactional', `handler transacional ausente: ${eventType}`);
  const parsed = schema.parse(payload);
  await withTenant(clinicA, (tx) =>
    registered.handler({ tx, clinicId: clinicA, payload: parsed, eventId, attempt: 1 }),
  );
}

async function main(): Promise<void> {
  try {
    await createFixtures();

    const aiCandidate = await schedulingApiV1.lookupDepositCandidate(clinicA, aiAppointmentId);
    assert(
      aiCandidate?.appointmentId === aiAppointmentId &&
        aiCandidate.clinicId === clinicA &&
        aiCandidate.patientId === patientId &&
        aiCandidate.valor === 100,
      'pedido de sinal da IA não leu o agendamento elegível',
    );
    assert(
      (await schedulingApiV1.lookupDepositCandidate(clinicB, aiAppointmentId)) === null,
      'pedido de sinal da IA atravessou tenant',
    );
    const [aiAppointment] = await dbAdmin
      .select()
      .from(appointments)
      .where(eq(appointments.id, aiAppointmentId))
      .limit(1);
    assert(aiAppointment !== undefined, 'fixture da IA não foi criada');
    const sourceKey = `ai-deposit:${run}`;
    const rollback = new Error('rollback da prova do evento');
    try {
      await dbAdmin.transaction(async (tx) => {
        await publishCreated(tx, aiAppointment, sourceKey, null);
        await publishCreated(tx, aiAppointment, sourceKey, null);
        const rows = await tx.execute<{ eventType: string; count: number }>(sql`
          SELECT event_type AS "eventType", count(*)::int AS count
          FROM outbox
          WHERE clinic_id = ${clinicA}
            AND idempotency_key IN (${`${sourceKey}:created`}, ${`${sourceKey}:deposit_requested`})
          GROUP BY event_type
          ORDER BY event_type
        `);
        assert(
          rows.length === 2 &&
            rows.every((row) => row.count === 1) &&
            rows.some((row) => row.eventType === 'scheduling.appointment.deposit_requested'),
          'pedido de sinal da IA não foi publicado exatamente uma vez',
        );
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    const [eventResidue] = await dbAdmin.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM outbox
      WHERE clinic_id = ${clinicA}
        AND idempotency_key IN (${`${sourceKey}:created`}, ${`${sourceKey}:deposit_requested`})
    `);
    assert(eventResidue?.count === 0, 'prova do evento deixou resíduo no outbox');
    await dbAdmin.execute(sql`
      UPDATE appointments SET status = 'cancelado'
      WHERE id = ${aiAppointmentId} AND clinic_id = ${clinicA}
    `);
    assert(
      (await schedulingApiV1.lookupDepositCandidate(clinicA, aiAppointmentId)) === null,
      'pedido de sinal da IA não bloqueou agendamento cancelado',
    );
    console.log('[OK] leitura do sinal da IA: elegível, cross-tenant negado e cancelado negado');

    const structure = await dbAdmin.execute<{
      enabled: boolean;
      forced: boolean;
      canDelete: boolean;
    }>(
      sql`
        SELECT
          c.relrowsecurity AS enabled,
          c.relforcerowsecurity AS forced,
          has_table_privilege('authenticated', 'patient_checkout_generations', 'DELETE') AS "canDelete"
        FROM pg_class c
        WHERE c.oid = 'public.patient_checkout_generations'::regclass
      `,
    );
    assert(structure[0]?.enabled === true, 'RLS não está habilitada');
    assert(structure[0]?.forced === true, 'RLS não está forçada');
    assert(structure[0]?.canDelete === false, 'authenticated recebeu DELETE indevido');
    console.log('[OK] 1/7 estrutura e grants');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const first = await claimInitialCheckoutCharge({
      clinicId: clinicA,
      appointmentId,
      patientId,
      kind: 'remainder',
      amount: 75,
      holdExpiresAt: null,
      collectionExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      checkoutExpiresAt: expiresAt,
      leaseUntil: new Date(now.getTime() + 2 * 60 * 1000),
      requestedPaymentMethod: 'pix',
    });
    assert(first.state === 'claimed', 'primeiro worker não adquiriu o lease');
    const replay = await claimInitialCheckoutCharge({
      clinicId: clinicA,
      appointmentId,
      patientId,
      kind: 'remainder',
      amount: 75,
      holdExpiresAt: null,
      collectionExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      checkoutExpiresAt: expiresAt,
      leaseUntil: new Date(now.getTime() + 2 * 60 * 1000),
    });
    assert(replay.state === 'existing', 'replay adquiriu um segundo lease');
    console.log('[OK] 2/7 claim idempotente');

    const counts = await withTenant(clinicA, (tx) =>
      tx.execute<{ charges: number; generations: number }>(sql`
        SELECT
          (SELECT count(*)::int FROM patient_charges WHERE appointment_id = ${appointmentId}) AS charges,
          (SELECT count(*)::int FROM patient_checkout_generations WHERE patient_charge_id = ${first.chargeId}) AS generations
      `),
    );
    assert(counts[0]?.charges === 1 && counts[0]?.generations === 1, 'UNIQUE não conteve replay');
    console.log('[OK] 3/7 uma dívida e uma geração');

    const crossTenant = await withTenant(clinicB, (tx) =>
      tx.execute(sql`
        SELECT id FROM patient_checkout_generations WHERE patient_charge_id = ${first.chargeId}
      `),
    );
    assert(crossTenant.length === 0, 'RLS expôs geração para outro tenant');
    console.log('[OK] 4/7 isolamento cross-tenant');

    const activated = await activateCheckoutGeneration({
      clinicId: clinicA,
      chargeId: first.chargeId,
      generationId: first.generationId,
      generation: first.generation,
      providerCheckoutId: `checkout_${run.slice(0, 16)}`,
      checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show?id=synthetic',
      expiresAt,
      activatedAt: now,
    });
    assert(activated, 'ativação CAS falhou');
    const payable = await findPayableCharge(clinicA, first.chargeId);
    assert(
      payable?.invoiceUrl.includes('checkoutSession') === true,
      'send-time não achou link ativo',
    );
    console.log('[OK] 5/7 ativação e lookup send-time');

    const paymentId = `pay_${run.slice(0, 16)}`;
    const eventId = `evt_${run.slice(0, 16)}`;
    const checkoutSessionId = `checkout_${run.slice(0, 16)}`;
    const mismatch = await markDepositPaid({
      clinicId: clinicA,
      providerPaymentId: paymentId,
      asaasEventId: eventId,
      eventType: 'PAYMENT_RECEIVED',
      paidAt: now,
      providerGrossAmount: 75,
      providerNetAmount: 72.5,
      billingType: 'CREDIT_CARD',
      checkoutSessionId,
    });
    assert(mismatch === 'method_mismatch', 'metodo divergente nao entrou em quarentena');
    const quarantined = await dbAdmin.execute<{
      status: string;
      failureCode: string;
      paymentId: string;
      dedup: number;
    }>(sql`
      SELECT c.status,
             c.failure_code AS "failureCode",
             c.provider_payment_id AS "paymentId",
             (SELECT count(*)::int FROM patient_webhook_events
               WHERE clinic_id = ${clinicA} AND asaas_event_id = ${eventId}) AS dedup
        FROM patient_charges c WHERE c.id = ${first.chargeId}
    `);
    assert(
      quarantined[0]?.status === 'pending' &&
        quarantined[0]?.failureCode === 'payment_method_mismatch' &&
        quarantined[0]?.paymentId === paymentId &&
        quarantined[0]?.dedup === 0,
      'quarentena nao preservou identidade ou consumiu dedup',
    );
    const recovered = await markDepositPaid({
      clinicId: clinicA,
      providerPaymentId: paymentId,
      asaasEventId: eventId,
      eventType: 'PAYMENT_RECEIVED',
      paidAt: now,
      providerGrossAmount: 75,
      providerNetAmount: 72.5,
      billingType: 'PIX',
      checkoutSessionId,
    });
    assert(recovered === 'paid', 'readback corrigido nao recuperou a cobranca');
    const chargeFacts = await paymentsApiV1.listPatientChargeEconomics(clinicA, [appointmentId]);
    assert(
      chargeFacts.length === 1 &&
        chargeFacts[0]?.chargeId === first.chargeId &&
        chargeFacts[0]?.requestedAmount === 75 &&
        chargeFacts[0]?.providerGrossAmount === 75 &&
        chargeFacts[0]?.providerFeeAmount === 2.5 &&
        chargeFacts[0]?.providerNetAmount === 72.5,
      'Caixa não leu os fatos da cobrança individual',
    );
    assert(
      (await paymentsApiV1.listPatientChargeEconomics(clinicB, [appointmentId])).length === 0,
      'Caixa expôs cobrança de outra clínica',
    );
    const settled = await dbAdmin.execute<{
      status: string;
      failureCode: string | null;
      dedup: number;
      creditEvents: number;
    }>(sql`
      SELECT c.status, c.failure_code AS "failureCode",
             (SELECT count(*)::int FROM patient_webhook_events
               WHERE clinic_id = ${clinicA} AND asaas_event_id = ${eventId}) AS dedup,
             (SELECT count(*)::int FROM outbox
               WHERE clinic_id = ${clinicA}
                 AND event_type = 'payments.patient_credit.granted') AS "creditEvents"
        FROM patient_charges c WHERE c.id = ${first.chargeId}
    `);
    assert(
      settled[0]?.status === 'paid' &&
        settled[0]?.failureCode === null &&
        settled[0]?.dedup === 1 &&
        settled[0]?.creditEvents === 1,
      'recuperacao nao fechou credito e dedup atomicamente',
    );
    console.log('[OK] 6/7 quarentena, readback corrigido e dedup');

    const legacyCredit = {
      chargeId: first.chargeId,
      clinicId: clinicA,
      appointmentId,
      patientId,
      kind: 'remaining_payment',
      amount: 75,
      paidAt: now.toISOString(),
      paymentMethod: 'pix',
    };
    const legacyEventId = randomUUID();
    await deliverSyntheticEvent('payments.patient_credit.granted', legacyCredit, legacyEventId);
    await deliverSyntheticEvent('payments.patient_credit.granted', legacyCredit, legacyEventId);
    const [beforeEconomics] = await dbAdmin.execute<{
      credits: number;
      gross: string | null;
      fee: string | null;
      net: string | null;
      expenses: number;
    }>(sql`
      SELECT count(*)::int AS credits,
             max(provider_gross_amount)::text AS gross,
             max(provider_fee_amount)::text AS fee,
             max(provider_net_amount)::text AS net,
             (SELECT count(*)::int FROM lancamentos
               WHERE clinic_id = ${clinicA}
                 AND source_patient_charge_id = ${first.chargeId}) AS expenses
        FROM patient_credits
       WHERE clinic_id = ${clinicA} AND patient_charge_id = ${first.chargeId}
    `);
    assert(
      beforeEconomics?.credits === 1 &&
        beforeEconomics.gross === null &&
        beforeEconomics.fee === null &&
        beforeEconomics.net === null &&
        beforeEconomics.expenses === 0,
      'payload legado duplicou credito ou inventou economia',
    );
    const reconciledEconomics = {
      chargeId: first.chargeId,
      clinicId: clinicA,
      appointmentId,
      providerGrossAmount: 75,
      providerFeeAmount: 2.5,
      providerNetAmount: 72.5,
      earlySettlementFeeAmount: null,
      installmentNumber: null,
      paidAt: now.toISOString(),
      paymentMethod: 'pix',
    };
    const economicsEventId = randomUUID();
    await deliverSyntheticEvent(
      'payments.patient_payment.economics_reconciled',
      reconciledEconomics,
      economicsEventId,
    );
    await deliverSyntheticEvent(
      'payments.patient_payment.economics_reconciled',
      reconciledEconomics,
      economicsEventId,
    );
    const [afterEconomics] = await dbAdmin.execute<{
      credits: number;
      gross: string | null;
      fee: string | null;
      net: string | null;
      expenses: number;
    }>(sql`
      SELECT count(*)::int AS credits,
             max(provider_gross_amount)::text AS gross,
             max(provider_fee_amount)::text AS fee,
             max(provider_net_amount)::text AS net,
             (SELECT count(*)::int FROM lancamentos
               WHERE clinic_id = ${clinicA}
                 AND source_patient_charge_id = ${first.chargeId}
                 AND financial_expense_kind = 'payment_processing_fee') AS expenses
        FROM patient_credits
       WHERE clinic_id = ${clinicA} AND patient_charge_id = ${first.chargeId}
    `);
    assert(
      afterEconomics?.credits === 1 &&
        Number(afterEconomics.gross) === 75 &&
        Number(afterEconomics.fee) === 2.5 &&
        Number(afterEconomics.net) === 72.5 &&
        afterEconomics.expenses === 1,
      'complemento economico nao atualizou credito e despesa de forma idempotente',
    );
    console.log('[OK] evento legado: credito unico, fatos ausentes e complemento economico unico');

    // Dois pagamentos com netValue pendente: uma leitura sem progresso não pode
    // monopolizar todos os ticks do cron e impedir que o outro seja consultado.
    const secondChargeId = randomUUID();
    await dbAdmin.execute(sql`
      UPDATE patient_charges SET economics_reconciled_at = NULL WHERE id = ${first.chargeId}
    `);
    await dbAdmin.execute(sql`
      INSERT INTO patient_charges (
        id, clinic_id, appointment_id, patient_id, kind, status, amount,
        provider_payment_id, external_reference, paid_at
      ) VALUES (
        ${secondChargeId}, ${clinicA}, ${appointmentId}, ${patientId}, 'deposit',
        'paid', 25.00, ${`pay_${run.slice(16, 32)}`},
        ${`rotation:${run}`}, now()
      )
    `);
    const firstBatch = await dbAdmin.transaction(async (tx) => {
      await tx.execute(sql`RESET ROLE`);
      return scanPendingPaymentEconomics(tx, 1, clinicA);
    });
    const secondBatch = await dbAdmin.transaction(async (tx) => {
      await tx.execute(sql`RESET ROLE`);
      return scanPendingPaymentEconomics(tx, 1, clinicA);
    });
    assert(
      firstBatch.length === 1 &&
        secondBatch.length === 1 &&
        firstBatch[0]?.chargeId !== secondBatch[0]?.chargeId &&
        new Set([firstBatch[0]?.chargeId, secondBatch[0]?.chargeId]).has(secondChargeId),
      'candidato antigo monopolizou a releitura do provedor',
    );
    console.log('[OK] 7/7 rotação persistente do backstop');
  } finally {
    await cleanup();
    console.log('[OK] cleanup sem resíduos');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
