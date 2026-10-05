/**
 * Prova DEV da regra temporal do repasse. A fixture SQL sofre rollback integral;
 * o único usuário Auth sintético é removido e conferido no finally.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import {
  createProfessionalPayoutSnapshot,
  refreshProfessionalPayout,
} from '@/contexts/financial/internal/professional-payout';
import { dbAdmin } from '@/lib/db';

const DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';
const DAY_MS = 86_400_000;
const runId = randomUUID();
const clinicId = randomUUID();
const patientId = randomUUID();
const procedureId = randomUUID();
const lateAppointmentId = randomUUID();
const originalAppointmentId = randomUUID();
const rescheduledAppointmentId = randomUUID();
const oldRuleId = randomUUID();
const newRuleId = randomUUID();
const oldPolicyId = randomUUID();
const newPolicyId = randomUUID();
const reversedChargeId = randomUUID();
const netReversedChargeId = randomUUID();
const email = `e2e-payout-${runId}@example.invalid`;
const password = `Qoro${runId.replaceAll('-', '')}Aa1!`;
const rollbackMarker = new Error('rollback da fixture de repasse');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function safeFailureDetail(error: unknown): string {
  let current = error;
  const errorNames: string[] = [];
  for (let depth = 0; depth < 6; depth++) {
    if (typeof current !== 'object' || current === null) break;
    if (current instanceof Error) errorNames.push(current.name);
    if (
      'code' in current &&
      typeof current.code === 'string' &&
      /^[A-Z0-9_]{2,40}$/.test(current.code)
    ) {
      const constraint =
        'constraint_name' in current &&
        typeof current.constraint_name === 'string' &&
        /^[a-z0-9_]+$/.test(current.constraint_name)
          ? `, constraint ${current.constraint_name}`
          : '';
      return `SQLSTATE ${current.code}${constraint}`;
    }
    if (
      current instanceof Error &&
      /^(?:invalid input|column |null value|duplicate key|new row|insert or update|operator |function |cannot cast|current transaction)/i.test(
        current.message,
      )
    ) {
      return current.message.slice(0, 180);
    }
    current = 'cause' in current ? current.cause : null;
  }
  if (error instanceof Error && !error.message.startsWith('Failed query:')) return error.message;
  return `falha SQL sem detalhe sanitizado (${errorNames.join(' > ') || 'sem Error'})`;
}

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

async function main(): Promise<void> {
  const config = devAuthConfig();
  const [plan] = await dbAdmin.execute<{ plan_id: string; price_id: string }>(sql`
    SELECT p.id::text AS plan_id, pr.id::text AS price_id
      FROM plans p JOIN prices pr ON pr.plan_id = p.id
     WHERE p.code = 'pro' AND p.ativo = true AND pr.billing_cycle = 'monthly'
       AND pr.active_until IS NULL AND pr.campaign_code IS NULL
     ORDER BY pr.active_from DESC LIMIT 1
  `);
  assert(plan, 'Plano Pro mensal ausente no DEV.');

  let doctorId: string | null = null;
  let stage = 'criar usuário Auth';
  let failure: unknown;
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
    const createdDoctorId = body.id;
    doctorId = createdDoctorId;

    const start = new Date(Date.now() - 4 * DAY_MS);
    const boundary = new Date(Date.now() - 2 * DAY_MS);
    const oldScheduledAt = new Date(Date.now() - 3 * DAY_MS);
    const newScheduledAt = new Date(Date.now() - DAY_MS);

    stage = 'transação temporal';
    try {
      await dbAdmin.transaction(async (tx) => {
        stage = 'inserir clínica';
        await tx.execute(sql`
          INSERT INTO clinics (id, slug, nome, status)
          VALUES (${clinicId}, ${`e2e-payout-${runId.slice(0, 8)}`},
                  'Clínica sintética de repasse', 'active')
        `);
        stage = 'inserir perfil';
        await tx.execute(sql`
          INSERT INTO profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
          VALUES (${createdDoctorId}, ${clinicId}, 'Médico sintético de repasse',
                  'doctor'::role_enum, true, now())
        `);
        stage = 'inserir assinatura';
        await tx.execute(sql`
          INSERT INTO subscriptions (clinic_id, plan_id, price_id, billing_status)
          VALUES (${clinicId}, ${plan.plan_id}, ${plan.price_id}, 'active')
        `);
        stage = 'inserir paciente';
        await tx.execute(sql`
          INSERT INTO patients (id, clinic_id, nome, cpf_encrypted, cpf_hash)
          VALUES (${patientId}, ${clinicId}, 'Paciente sintético de repasse',
                  'fixture', ${runId.replaceAll('-', '').padEnd(64, '0')})
        `);
        stage = 'inserir procedimento';
        await tx.execute(sql`
          INSERT INTO procedures (id, clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min)
          VALUES (${procedureId}, ${clinicId}, ${`PAYOUT-${runId.slice(0, 8)}`},
                  'Consulta sintética', 150, 30)
        `);
        stage = 'inserir agendamentos';
        for (const [index, appointment] of [
          { id: lateAppointmentId, at: oldScheduledAt, status: 'atendido', previous: null },
          { id: originalAppointmentId, at: oldScheduledAt, status: 'cancelado', previous: null },
          {
            id: rescheduledAppointmentId,
            at: newScheduledAt,
            status: 'atendido',
            previous: originalAppointmentId,
          },
        ].entries()) {
          stage = `inserir agendamento ${index + 1}`;
          await tx.execute(sql`
            INSERT INTO appointments
              (id, clinic_id, doctor_id, patient_id, procedure_id, scheduled_at,
               duration_min, status, valor, snapshot_procedure_name,
               snapshot_procedure_valor, snapshot_procedure_duracao_min,
               snapshot_doctor_nome, created_via, rescheduled_from_appointment_id)
            VALUES (${appointment.id}, ${clinicId}, ${createdDoctorId}, ${patientId},
                    ${procedureId}, ${appointment.at.toISOString()}, 30, ${appointment.status}::appointment_status,
                    150, 'Consulta sintética', 150, 30, 'Médico sintético',
                    'attendant', ${appointment.previous}::uuid)
          `);
        }
        stage = 'inserir versões da política';
        await tx.execute(sql`
          INSERT INTO clinic_financial_policy_versions
            (id, clinic_id, professional_payout_basis, effective_from)
          VALUES (${oldPolicyId}, ${clinicId}, 'gross', ${start.toISOString()}),
                 (${newPolicyId}, ${clinicId}, 'net', ${boundary.toISOString()})
        `);
        stage = 'inserir regras de repasse';
        await tx.execute(sql`
          INSERT INTO professional_payout_rules
            (id, clinic_id, professional_id, procedure_id, kind, percentage,
             effective_from, effective_to)
          VALUES (${oldRuleId}, ${clinicId}, ${createdDoctorId}, ${procedureId},
                  'percentage', 50, ${start.toISOString()}, ${boundary.toISOString()}),
                 (${newRuleId}, ${clinicId}, ${createdDoctorId}, ${procedureId},
                  'percentage', 30, ${boundary.toISOString()}, NULL)
        `);

        stage = 'snapshot tardio';
        const lateId = await createProfessionalPayoutSnapshot(tx, {
          clinicId,
          appointmentId: lateAppointmentId,
          professionalId: createdDoctorId,
          procedureId,
          grossAmount: 150,
          occurredAt: oldScheduledAt,
        });
        assert(lateId, 'Atendimento tardio não criou snapshot.');
        stage = 'snapshot remarcado';
        const rescheduledId = await createProfessionalPayoutSnapshot(tx, {
          clinicId,
          appointmentId: rescheduledAppointmentId,
          professionalId: createdDoctorId,
          procedureId,
          grossAmount: 150,
          occurredAt: newScheduledAt,
        });
        assert(rescheduledId, 'Atendimento remarcado não criou snapshot.');
        const duplicateId = await createProfessionalPayoutSnapshot(tx, {
          clinicId,
          appointmentId: rescheduledAppointmentId,
          professionalId: createdDoctorId,
          procedureId,
          grossAmount: 150,
          occurredAt: newScheduledAt,
        });
        assert(duplicateId === null, 'Replay duplicou snapshot.');

        const rows = await tx.execute<{
          appointment_id: string;
          rule_id: string;
          policy_version_id: string;
          calculation_basis: string;
          rule_percentage: string;
          gross_amount: string;
          payout_amount: string | null;
          status: string;
        }>(sql`
          SELECT appointment_id::text, rule_id::text, policy_version_id::text,
                 calculation_basis, rule_percentage::text, gross_amount::text,
                 payout_amount::text, status
            FROM professional_payouts
           WHERE clinic_id = ${clinicId}
           ORDER BY appointment_id
        `);
        assert(rows.length === 2, 'Quantidade de snapshots divergente.');
        const late = rows.find((row) => row.appointment_id === lateAppointmentId);
        const rescheduled = rows.find((row) => row.appointment_id === rescheduledAppointmentId);
        assert(
          late?.rule_id === oldRuleId &&
            late.policy_version_id === oldPolicyId &&
            late.calculation_basis === 'gross' &&
            Number(late.rule_percentage) === 50 &&
            Number(late.gross_amount) === 150 &&
            Number(late.payout_amount) === 75 &&
            late.status === 'calculated',
          'Atendimento tardio não preservou regra/base da data agendada.',
        );
        assert(
          rescheduled?.rule_id === newRuleId &&
            rescheduled.policy_version_id === newPolicyId &&
            rescheduled.calculation_basis === 'net' &&
            Number(rescheduled.rule_percentage) === 30 &&
            Number(rescheduled.gross_amount) === 150 &&
            rescheduled.payout_amount === null &&
            rescheduled.status === 'pending_economics',
          'Remarcação não usou regra/base da nova data, ou calculou NET sem líquido.',
        );

        stage = 'auditoria da suspensão por perda';
        await tx.execute(sql`
          INSERT INTO patient_credits
            (clinic_id, patient_id, appointment_id, patient_charge_id, amount,
             kind, status, dispute_status)
          VALUES (${clinicId}, ${patientId}, ${lateAppointmentId}, ${reversedChargeId},
                  150, 'deposit', 'available', 'lost')
        `);
        const firstSuspension = await refreshProfessionalPayout(tx, {
          clinicId,
          appointmentId: lateAppointmentId,
        });
        await tx.execute(sql`
          UPDATE patient_credits SET dispute_status = 'reversed'
           WHERE clinic_id = ${clinicId} AND patient_charge_id = ${reversedChargeId}
        `);
        const replaySuspension = await refreshProfessionalPayout(tx, {
          clinicId,
          appointmentId: lateAppointmentId,
        });
        assert(
          firstSuspension === 'cancelled' && replaySuspension === 'cancelled',
          'Perda não suspendeu o repasse GROSS de modo idempotente.',
        );
        const [audit] = await tx.execute<{
          count: number;
          original_amount: string | null;
          new_status: string | null;
        }>(sql`
          SELECT count(*)::int AS count,
                 max(before->>'payoutAmount') AS original_amount,
                 max(after->>'status') AS new_status
            FROM audit_events
           WHERE clinic_id = ${clinicId}
             AND resource_id = ${lateId}
             AND action = 'financial.professional_payout.suspended'
        `);
        assert(
          audit?.count === 1 &&
            Number(audit.original_amount) === 75 &&
            audit.new_status === 'cancelled',
          'Auditoria não preservou o cálculo original uma única vez.',
        );

        stage = 'suspensão NET sem recálculo automático';
        await tx.execute(sql`
          INSERT INTO patient_credits
            (clinic_id, patient_id, appointment_id, patient_charge_id, amount,
             kind, status, dispute_status)
          VALUES (${clinicId}, ${patientId}, ${rescheduledAppointmentId},
                  ${netReversedChargeId}, 150, 'deposit', 'available', 'lost')
        `);
        const netSuspension = await refreshProfessionalPayout(tx, {
          clinicId,
          appointmentId: rescheduledAppointmentId,
        });
        await tx.execute(sql`
          UPDATE patient_credits SET dispute_status = 'reversed'
           WHERE clinic_id = ${clinicId} AND patient_charge_id = ${netReversedChargeId}
        `);
        const netReplay = await refreshProfessionalPayout(tx, {
          clinicId,
          appointmentId: rescheduledAppointmentId,
        });
        const payoutStates = await tx.execute<{
          appointment_id: string;
          status: string;
          payout_amount: string | null;
        }>(sql`
          SELECT appointment_id::text, status, payout_amount::text
            FROM professional_payouts WHERE clinic_id = ${clinicId}
        `);
        assert(
          netSuspension === 'cancelled' &&
            netReplay === 'cancelled' &&
            payoutStates.length === 2 &&
            payoutStates.every((row) => row.status === 'cancelled' && row.payout_amount === null),
          'Suspensão GROSS/NET foi reaberta automaticamente após a perda desaparecer.',
        );
        throw rollbackMarker;
      });
    } catch (error) {
      if (error !== rollbackMarker) throw error;
    }

    stage = 'readback do rollback';
    const [residue] = await dbAdmin.execute<{
      clinics: number;
      payouts: number;
      rules: number;
      appointments: number;
      audits: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM clinics WHERE id = ${clinicId}) AS clinics,
        (SELECT count(*)::int FROM professional_payouts WHERE clinic_id = ${clinicId}) AS payouts,
        (SELECT count(*)::int FROM professional_payout_rules WHERE clinic_id = ${clinicId}) AS rules,
        (SELECT count(*)::int FROM appointments WHERE clinic_id = ${clinicId}) AS appointments,
        (SELECT count(*)::int FROM audit_events WHERE clinic_id = ${clinicId}) AS audits
    `);
    assert(
      residue && Object.values(residue).every((count) => count === 0),
      'Rollback deixou resíduos no PostgreSQL DEV.',
    );
  } catch (error) {
    failure = error;
  } finally {
    if (doctorId) {
      const deleted = await authRequest(config, `/${doctorId}`, 'DELETE');
      const readback = await authRequest(config, `/${doctorId}`, 'GET');
      if ((!deleted.ok && deleted.status !== 404) || readback.status !== 404) {
        failure = new Error(
          `Cleanup Auth DEV incompleto (DELETE ${deleted.status}, GET ${readback.status}).`,
        );
      }
    }
  }
  if (failure) {
    const detail = safeFailureDetail(failure);
    throw new Error(`[payout-date-db] ${stage}: ${detail}`);
  }
  console.log(
    '[payout-date-db] PASS: regra temporal, suspensão GROSS/NET persistente, auditoria, rollback e cleanup.',
  );
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : 'erro desconhecido';
  console.error(
    detail.startsWith('[payout-date-db]') ? detail : '[payout-date-db] falha inesperada',
  );
  process.exitCode = 1;
});
