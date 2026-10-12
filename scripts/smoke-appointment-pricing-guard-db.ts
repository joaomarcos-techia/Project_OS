/**
 * Prova DEV da politica comercial da 0109. Todas as fixtures sao sinteticas,
 * criadas em uma transacao que sempre sofre rollback.
 */
// MUST be first: loads `.env.local` before any `@/lib/*` module validates env.
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { dbAdmin, type Tx } from '@/lib/db';

assertDevContext();

const CLINIC_ID = randomUUID();
const PATIENT_ID = randomUUID();
const PROCEDURE_ID = randomUUID();
const HISTORICAL_APPOINTMENT_ID = randomUUID();
const DIRECT_APPOINTMENT_ID = randomUUID();
const INVALID_RESCHEDULE_ID = randomUUID();
const RESCHEDULED_APPOINTMENT_ID = randomUUID();
const METHOD_APPOINTMENT_ID = randomUUID();
const METHOD_PRICE_ID = randomUUID();
const RUN_ID = randomUUID().replaceAll('-', '');
const HISTORICAL_AMOUNT = 100;
const METHOD_AMOUNT = 110;
const INVALID_RESCHEDULE_AMOUNT = 101;
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPECTED_POLICY_ERROR = 'Politica comercial ativa exige preco por meio de pagamento.';
const EXPECTED_POLICY_SQLSTATE = 'P0001';

class ProofError extends Error {}

type PlanPrice = {
  planId: string;
  priceId: string;
  planCode: string;
};

interface AppointmentInput {
  id: string;
  doctorId: string;
  amount: number;
  scheduledAt: string;
  rescheduledFromAppointmentId?: string;
  pricingPolicyMode?: 'absorb_fees' | 'payment_method_pricing';
  commercialPaymentMethod?: 'pix';
  commercialPriceId?: string;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ProofError(message);
}

function errorCauses(error: unknown): unknown[] {
  const causes: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current != null && !seen.has(current) && causes.length < 8) {
    causes.push(current);
    seen.add(current);
    if (typeof current !== 'object' || !('cause' in current)) break;
    current = current.cause;
  }
  return causes;
}

function sqlState(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'string' && /^[A-Z0-9]{5}$/u.test(error.code) ? error.code : null;
}

function isExpectedPolicyError(error: unknown): boolean {
  return errorCauses(error).some(
    (cause) =>
      cause instanceof Error &&
      cause.message === EXPECTED_POLICY_ERROR &&
      sqlState(cause) === EXPECTED_POLICY_SQLSTATE,
  );
}

function safeErrorSummary(error: unknown): string {
  const causes = errorCauses(error);
  const proofError = causes.find((cause): cause is ProofError => cause instanceof ProofError);
  if (proofError) return proofError.message;
  const code = causes.map(sqlState).find((value) => value !== null);
  const innerMessage = causes
    .filter((cause): cause is Error => cause instanceof Error)
    .map((cause) => cause.message)
    .find((message) => !message.startsWith('Failed query:'));
  const safeDetail = innerMessage?.match(
    /^(?:duplicate key value|new row for relation|violates |invalid input syntax|value too long|appointment tenant mismatch|No active price)[^\n]{0,160}/u,
  )?.[0];
  return `[pricing-guard-db] falha inesperada (SQLSTATE ${code ?? 'indisponivel'}${safeDetail ? `; ${safeDetail}` : ''})`;
}

async function selectFixtureDependencies(): Promise<{ plan: PlanPrice; doctorId: string }> {
  const [plan] = await dbAdmin.execute<PlanPrice>(sql`
    SELECT plan.id::text AS "planId", price.id::text AS "priceId", plan.code AS "planCode"
    FROM plans plan
    JOIN prices price ON price.plan_id = plan.id
    WHERE plan.code IN ('pro', 'clinica')
      AND plan.ativo = true
      AND price.active_from <= now()
      AND (price.active_until IS NULL OR price.active_until > now())
    ORDER BY CASE WHEN plan.code = 'pro' THEN 0 ELSE 1 END, price.active_from DESC
    LIMIT 1
  `);
  if (!plan) {
    throw new ProofError('[pricing-guard-db] DEV precisa de plano Pro/Clinica com preco vigente');
  }
  const [doctor] = await dbAdmin.execute<{ id: string }>(sql`
    SELECT id::text AS id FROM profiles WHERE ativo = true ORDER BY id LIMIT 1
  `);
  if (!doctor) {
    throw new ProofError('[pricing-guard-db] DEV precisa de ao menos um profile ativo');
  }
  return { plan, doctorId: doctor.id };
}

async function insertAppointment(tx: Tx, input: AppointmentInput): Promise<void> {
  await tx.execute(sql`
    INSERT INTO appointments (
      id, clinic_id, doctor_id, patient_id, procedure_id, scheduled_at,
      duration_min, status, valor, snapshot_procedure_name,
      snapshot_procedure_valor, snapshot_procedure_duracao_min,
      snapshot_doctor_nome, created_via, rescheduled_from_appointment_id,
      pricing_policy_mode, commercial_payment_method, commercial_price_id
    ) VALUES (
      ${input.id}, ${CLINIC_ID}, ${input.doctorId}, ${PATIENT_ID}, ${PROCEDURE_ID},
      ${input.scheduledAt}, 30, 'agendado', ${input.amount},
      'Procedimento sintetico', ${HISTORICAL_AMOUNT}, 30,
      'Profissional sintetico', 'attendant',
      ${input.rescheduledFromAppointmentId ?? null},
      ${input.pricingPolicyMode ?? 'absorb_fees'},
      ${input.commercialPaymentMethod ?? null},
      ${input.commercialPriceId ?? null}
    )
  `);
}

async function expectPolicyRejection(tx: Tx, input: AppointmentInput): Promise<void> {
  let rejected = false;
  try {
    await tx.transaction((savepoint) => insertAppointment(savepoint, input));
  } catch (error) {
    if (!isExpectedPolicyError(error)) throw error;
    rejected = true;
  }
  assert(rejected, '[pricing-guard-db] insercao absorb_fees indevida foi aceita');
}

async function assertRollbackResidue(): Promise<void> {
  const [residue] = await dbAdmin.execute<{
    clinics: number;
    patients: number;
    procedures: number;
    subscriptions: number;
    policies: number;
    methodPrices: number;
    appointments: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM clinics WHERE id = ${CLINIC_ID}) AS clinics,
      (SELECT count(*)::int FROM patients WHERE id = ${PATIENT_ID}) AS patients,
      (SELECT count(*)::int FROM procedures WHERE id = ${PROCEDURE_ID}) AS procedures,
      (SELECT count(*)::int FROM subscriptions WHERE clinic_id = ${CLINIC_ID}) AS subscriptions,
      (SELECT count(*)::int FROM clinic_payment_pricing_policies WHERE clinic_id = ${CLINIC_ID}) AS policies,
      (SELECT count(*)::int FROM procedure_payment_prices WHERE clinic_id = ${CLINIC_ID}) AS "methodPrices",
      (SELECT count(*)::int FROM appointments WHERE clinic_id = ${CLINIC_ID}) AS appointments
  `);
  assert(
    residue !== undefined && Object.values(residue).every((count) => count === 0),
    '[pricing-guard-db] rollback deixou residuos sinteticos',
  );
}

async function main(): Promise<void> {
  const { plan, doctorId } = await selectFixtureDependencies();
  const scheduledAt = (daysFromNow: number): string =>
    new Date(Date.now() + daysFromNow * DAY_MS).toISOString();
  const rollbackMarker = new Error('rollback intencional da fixture');
  let unexpectedError: unknown;
  let stage = 'inserir clinica';

  try {
    await dbAdmin.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO clinics (id, slug, nome, endereco, status, timezone)
        VALUES (
          ${CLINIC_ID}, ${`pricing-guard-${RUN_ID.slice(0, 12)}`},
          'Pricing Guard DB', 'Sintetica', 'active', 'America/Sao_Paulo'
        )
      `);
      stage = 'inserir paciente';
      await tx.execute(sql`
        INSERT INTO patients (id, clinic_id, nome, cpf_encrypted, cpf_hash)
        VALUES (
          ${PATIENT_ID}, ${CLINIC_ID}, 'Paciente Pricing Guard Sintetico',
          'fixture', ${RUN_ID.padEnd(64, '0')}
        )
      `);
      stage = 'inserir procedimento';
      await tx.execute(sql`
        INSERT INTO procedures (id, clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min)
        VALUES (
          ${PROCEDURE_ID}, ${CLINIC_ID}, ${`PG-${RUN_ID.slice(0, 8)}`},
          'Procedimento sintetico Pricing Guard', ${HISTORICAL_AMOUNT}, 30
        )
      `);
      stage = 'inserir assinatura';
      await tx.execute(sql`
        INSERT INTO subscriptions (clinic_id, plan_id, price_id, billing_status)
        VALUES (${CLINIC_ID}, ${plan.planId}, ${plan.priceId}, 'trial')
      `);

      stage = 'inserir agendamento historico';
      await insertAppointment(tx, {
        id: HISTORICAL_APPOINTMENT_ID,
        doctorId,
        amount: HISTORICAL_AMOUNT,
        scheduledAt: scheduledAt(1),
      });
      stage = 'cancelar agendamento historico';
      await tx.execute(sql`
        UPDATE appointments SET status = 'cancelado'
        WHERE id = ${HISTORICAL_APPOINTMENT_ID} AND clinic_id = ${CLINIC_ID}
      `);
      stage = 'inserir preco PIX';
      await tx.execute(sql`
        INSERT INTO procedure_payment_prices (
          id, clinic_id, procedure_id, payment_method, gross_amount
        ) VALUES (
          ${METHOD_PRICE_ID}, ${CLINIC_ID}, ${PROCEDURE_ID}, 'pix', ${METHOD_AMOUNT}
        )
      `);
      stage = 'ativar politica explicita';
      await tx.execute(sql`
        INSERT INTO clinic_payment_pricing_policies (clinic_id, mode)
        VALUES (${CLINIC_ID}, 'payment_method_pricing')
      `);

      stage = 'recusar insert direto absorb_fees';
      await expectPolicyRejection(tx, {
        id: DIRECT_APPOINTMENT_ID,
        doctorId,
        amount: HISTORICAL_AMOUNT,
        scheduledAt: scheduledAt(2),
      });
      stage = 'recusar remarcacao alterada';
      await expectPolicyRejection(tx, {
        id: INVALID_RESCHEDULE_ID,
        doctorId,
        amount: INVALID_RESCHEDULE_AMOUNT,
        scheduledAt: scheduledAt(3),
        rescheduledFromAppointmentId: HISTORICAL_APPOINTMENT_ID,
      });
      stage = 'aceitar remarcacao exata';
      await insertAppointment(tx, {
        id: RESCHEDULED_APPOINTMENT_ID,
        doctorId,
        amount: HISTORICAL_AMOUNT,
        scheduledAt: scheduledAt(4),
        rescheduledFromAppointmentId: HISTORICAL_APPOINTMENT_ID,
      });
      stage = 'aceitar preco PIX vigente';
      await insertAppointment(tx, {
        id: METHOD_APPOINTMENT_ID,
        doctorId,
        amount: METHOD_AMOUNT,
        scheduledAt: scheduledAt(5),
        pricingPolicyMode: 'payment_method_pricing',
        commercialPaymentMethod: 'pix',
        commercialPriceId: METHOD_PRICE_ID,
      });

      stage = 'conferir snapshots';
      const [proof] = await tx.execute<{
        historicalMode: string;
        rescheduledMode: string;
        rescheduledFrom: string;
        methodPriceId: string;
        rejectedCount: number;
      }>(sql`
        SELECT
          old.pricing_policy_mode AS "historicalMode",
          remapped.pricing_policy_mode AS "rescheduledMode",
          remapped.rescheduled_from_appointment_id::text AS "rescheduledFrom",
          priced.commercial_price_id::text AS "methodPriceId",
          (SELECT count(*)::int FROM appointments
            WHERE id IN (${DIRECT_APPOINTMENT_ID}, ${INVALID_RESCHEDULE_ID})) AS "rejectedCount"
        FROM appointments old
        JOIN appointments remapped ON remapped.id = ${RESCHEDULED_APPOINTMENT_ID}
        JOIN appointments priced ON priced.id = ${METHOD_APPOINTMENT_ID}
        WHERE old.id = ${HISTORICAL_APPOINTMENT_ID}
      `);
      assert(
        proof?.historicalMode === 'absorb_fees' &&
          proof.rescheduledMode === 'absorb_fees' &&
          proof.rescheduledFrom === HISTORICAL_APPOINTMENT_ID &&
          proof.methodPriceId === METHOD_PRICE_ID &&
          proof.rejectedCount === 0,
        '[pricing-guard-db] readback comercial divergente',
      );
      throw rollbackMarker;
    });
  } catch (error) {
    if (error !== rollbackMarker) unexpectedError = error;
  }

  await assertRollbackResidue();
  if (unexpectedError) {
    throw new ProofError(`[pricing-guard-db] etapa ${stage}: ${safeErrorSummary(unexpectedError)}`);
  }
  console.log(
    `[OK] guard 0109 no DEV (${plan.planCode}): insert direto recusado, remarcacao exata e preco por metodo aceitos; rollback sem residuos`,
  );
}

main().catch((error) => {
  console.error(safeErrorSummary(error));
  process.exitCode = 1;
});
