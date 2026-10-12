/**
 * Prova controlada em DEV: o tempo sozinho não conclui uma consulta; após o
 * encerramento clínico, o Financial aloca o crédito integral uma vez.
 *
 * Clona apenas as referências de uma fixture E2E existente. Toda escrita fica
 * numa transação deliberadamente revertida; não chama Asaas, Meta ou worker.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { prontuarios } from '@/contexts/clinical/schema';
import { encryptJson } from '@/contexts/clinical/internal/content-crypto';
import { applyTransition } from '@/contexts/scheduling/internal/appointment-core';
import { appointments } from '@/contexts/scheduling/schema';
import { patientCredits } from '@/contexts/financial/schema';
import { dbAdmin } from '@/lib/db';
import { getEventSchema } from '@/lib/outbox/catalog';
import { getHandler } from '@/lib/outbox/registry';

import '@/lib/db/schema';
import '@/contexts/financial/internal/handlers/appointment-completed';

const DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';
const dbUrl = assertDevContext().databaseUrl;
const dbProjectRef = decodeURIComponent(new URL(dbUrl).username).split('.').at(-1);
if (dbProjectRef !== DEV_PROJECT_REF) {
  throw new Error('A prova exige o projeto Supabase DEV fixado.');
}

const appointmentId = randomUUID();
const creditId = randomUUID();
const amount = '10.00';
const eventType = 'scheduling.appointment.completed';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class ExpectedRollback extends Error {}

type Source = {
  clinicId: string;
  doctorId: string;
  patientId: string;
  procedureId: string;
  snapshotDoctorNome: string;
};

type State = {
  appointmentStatus: string;
  scheduledInPast: boolean;
  queueStatus: string | null;
  transitionCount: number;
  creditStatus: string;
  allocatedAmount: string;
  receivableCount: number;
  receivableStatus: string | null;
  receivableValue: string | null;
  paidValue: string | null;
  ledgerCount: number;
  ledgerTotal: string;
};

async function main(): Promise<void> {
  const schema = getEventSchema(eventType);
  const registered = getHandler(eventType);
  assert(schema && registered?.execution === 'transactional', 'Handler de conclusão ausente');

  try {
    await dbAdmin.transaction(async (tx) => {
      const [source] = await tx.execute<Source>(sql`
        SELECT a.clinic_id::text AS "clinicId", a.doctor_id::text AS "doctorId",
               a.patient_id::text AS "patientId", a.procedure_id::text AS "procedureId",
               a.snapshot_doctor_nome AS "snapshotDoctorNome"
          FROM appointments a
          JOIN patients p ON p.id = a.patient_id AND p.clinic_id = a.clinic_id
          JOIN patient_credits pc ON pc.appointment_id = a.id AND pc.clinic_id = a.clinic_id
         WHERE p.nome = 'Paciente E2E Sinal'
           AND pc.amount = ${amount}::numeric AND pc.status = 'available'
           AND a.status = 'confirmado' AND a.scheduled_at > now()
           AND EXISTS (
             SELECT 1 FROM patient_charges ch
              WHERE ch.id = pc.patient_charge_id AND ch.clinic_id = a.clinic_id
                AND ch.status = 'paid'
           )
         ORDER BY a.created_at DESC LIMIT 1
      `);
      assert(source, 'Fixture E2E paga e ainda futura não encontrada em DEV');

      await tx.insert(appointments).values({
        id: appointmentId,
        clinicId: source.clinicId,
        doctorId: source.doctorId,
        patientId: source.patientId,
        procedureId: source.procedureId,
        scheduledAt: new Date(Date.now() + 365 * 86_400_000),
        durationMin: 30,
        status: 'confirmado',
        valor: amount,
        snapshotProcedureName: 'Consulta sintética — prova de crédito',
        snapshotProcedureValor: amount,
        snapshotProcedureDuracaoMin: 30,
        snapshotDoctorNome: source.snapshotDoctorNome,
        createdVia: 'walkin',
        depositStatus: 'paid',
      });
      await tx.insert(patientCredits).values({
        id: creditId,
        clinicId: source.clinicId,
        patientId: source.patientId,
        appointmentId,
        patientChargeId: randomUUID(),
        amount,
        kind: 'deposit',
        status: 'available',
        paymentMethod: 'cartao_credito',
      });

      const readState = async (): Promise<State> => {
        const [state] = await tx.execute<State>(sql`
          SELECT a.status::text AS "appointmentStatus",
                 a.scheduled_at < now() AS "scheduledInPast",
                 (SELECT q.status::text FROM waiting_queue_entries q
                   WHERE q.appointment_id = a.id LIMIT 1) AS "queueStatus",
                 (SELECT count(*)::int FROM appointment_state_log s
                   WHERE s.appointment_id = a.id) AS "transitionCount",
                 pc.status::text AS "creditStatus",
                 pc.allocated_amount::text AS "allocatedAmount",
                 (SELECT count(*)::int FROM lancamentos l
                   WHERE l.appointment_id = a.id) AS "receivableCount",
                 (SELECT l.status::text FROM lancamentos l
                   WHERE l.appointment_id = a.id LIMIT 1) AS "receivableStatus",
                 (SELECT l.valor::text FROM lancamentos l
                   WHERE l.appointment_id = a.id LIMIT 1) AS "receivableValue",
                 (SELECT l.valor_pago::text FROM lancamentos l
                   WHERE l.appointment_id = a.id LIMIT 1) AS "paidValue",
                 (SELECT count(*)::int FROM payment_transactions pt
                   JOIN lancamentos l ON l.id = pt.lancamento_id
                  WHERE l.appointment_id = a.id) AS "ledgerCount",
                 (SELECT coalesce(sum(pt.amount), 0)::text FROM payment_transactions pt
                   JOIN lancamentos l ON l.id = pt.lancamento_id
                  WHERE l.appointment_id = a.id) AS "ledgerTotal"
            FROM appointments a
            JOIN patient_credits pc ON pc.appointment_id = a.id AND pc.clinic_id = a.clinic_id
           WHERE a.id = ${appointmentId}::uuid AND pc.id = ${creditId}::uuid
        `);
        assert(state, 'Fixture não encontrada na transação');
        return state;
      };

      const before = await readState();
      assert(
        before.appointmentStatus === 'confirmado' &&
          !before.scheduledInPast &&
          before.creditStatus === 'available' &&
          before.receivableCount === 0,
        'Estado inicial divergente',
      );
      console.log('PASS: consulta futura com crédito disponível e sem recebível');

      const pastDate = new Date(Date.now() - 2 * 86_400_000);
      await tx
        .update(appointments)
        .set({ scheduledAt: pastDate })
        .where(eq(appointments.id, appointmentId));
      const afterTime = await readState();
      assert(
        afterTime.scheduledInPast &&
          afterTime.appointmentStatus === 'confirmado' &&
          afterTime.creditStatus === 'available' &&
          afterTime.receivableCount === 0,
        'A passagem do horário alterou indevidamente agenda ou financeiro',
      );
      console.log('PASS: após o horário, segue confirmado e o valor é crédito antecipado');

      const transition = (target: 'chegou' | 'em_atendimento' | 'atendido') =>
        applyTransition(tx, {
          clinicId: source.clinicId,
          appointmentId,
          target,
          transitionedBy: source.doctorId,
          actorType: 'user',
          clientKey: `smoke-advance-credit:${appointmentId}:${target}`,
          correlationId: null,
        });
      await transition('chegou');
      await transition('em_atendimento');
      assert((await readState()).appointmentStatus === 'em_atendimento', 'Atendimento não iniciou');

      let refusedWithoutRecord = false;
      try {
        await transition('atendido');
      } catch (error) {
        refusedWithoutRecord = error instanceof Error && /prontuário/u.test(error.message);
      }
      assert(refusedWithoutRecord, 'Consulta sem prontuário foi concluída indevidamente');
      assert(
        (await readState()).appointmentStatus === 'em_atendimento',
        'Recusa sem prontuário alterou o estado',
      );
      console.log('PASS: conclusão sem prontuário assinado foi recusada');

      await tx.insert(prontuarios).values({
        clinicId: source.clinicId,
        patientId: source.patientId,
        doctorId: source.doctorId,
        appointmentId,
        status: 'assinado',
        contentEncrypted: await encryptJson(source.clinicId, {}),
        signedAt: new Date(),
        signedBy: source.doctorId,
        signedDoctorNome: source.snapshotDoctorNome,
        createdBy: source.doctorId,
      });
      await transition('atendido');
      const [completionEvent] = await tx.execute<{ id: string; payload: unknown }>(sql`
        SELECT id::text AS id, payload FROM outbox
         WHERE clinic_id = ${source.clinicId}::uuid
           AND event_type = ${eventType}
           AND idempotency_key = ${`smoke-advance-credit:${appointmentId}:atendido:atendido`}
         LIMIT 1
      `);
      assert(completionEvent, 'Scheduling não publicou appointment.completed');
      const payload = schema.parse(completionEvent.payload);
      await registered.handler({
        tx,
        clinicId: source.clinicId,
        payload,
        eventId: completionEvent.id,
        attempt: 1,
      });
      const completed = await readState();
      assert(
        completed.appointmentStatus === 'atendido' &&
          completed.queueStatus === 'completed' &&
          completed.transitionCount === 3 &&
          completed.creditStatus === 'allocated' &&
          completed.allocatedAmount === amount &&
          completed.receivableCount === 1 &&
          completed.receivableStatus === 'pago' &&
          completed.receivableValue === amount &&
          completed.paidValue === amount &&
          completed.ledgerCount === 1 &&
          completed.ledgerTotal === amount,
        'Conclusão não quitou o recebível com o crédito integral',
      );
      console.log('PASS: conclusão alocou o crédito e criou recebível quitado');

      await registered.handler({
        tx,
        clinicId: source.clinicId,
        payload,
        eventId: completionEvent.id,
        attempt: 2,
      });
      const replay = await readState();
      assert(
        replay.receivableCount === 1 && replay.ledgerCount === 1 && replay.ledgerTotal === amount,
        'Reentrega duplicou recebível ou baixa',
      );
      console.log('PASS: reentrega não duplicou recebível nem baixa');

      throw new ExpectedRollback('rollback de fixture');
    });
  } catch (error) {
    if (!(error instanceof ExpectedRollback)) throw error;
  }

  const [residue] = await dbAdmin.execute<{
    appointments: number;
    credits: number;
    receivables: number;
    records: number;
    queue: number;
    transitions: number;
    events: number;
  }>(sql`
    SELECT (SELECT count(*)::int FROM appointments WHERE id = ${appointmentId}::uuid) AS appointments,
           (SELECT count(*)::int FROM patient_credits WHERE id = ${creditId}::uuid) AS credits,
           (SELECT count(*)::int FROM lancamentos WHERE appointment_id = ${appointmentId}::uuid) AS receivables,
           (SELECT count(*)::int FROM prontuarios WHERE appointment_id = ${appointmentId}::uuid) AS records,
           (SELECT count(*)::int FROM waiting_queue_entries WHERE appointment_id = ${appointmentId}::uuid) AS queue,
           (SELECT count(*)::int FROM appointment_state_log WHERE appointment_id = ${appointmentId}::uuid) AS transitions,
           (SELECT count(*)::int FROM outbox WHERE payload->>'appointmentId' = ${appointmentId}) AS events
  `);
  assert(
    residue?.appointments === 0 &&
      residue.credits === 0 &&
      residue.receivables === 0 &&
      residue.records === 0 &&
      residue.queue === 0 &&
      residue.transitions === 0 &&
      residue.events === 0,
    'Rollback não eliminou toda a fixture',
  );
  console.log('PASS: rollback confirmado, sem resíduos no DEV');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Falha desconhecida');
  process.exitCode = 1;
});
