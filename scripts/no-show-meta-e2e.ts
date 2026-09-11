/**
 * E2E real 2.4B — falta → outbox → C14 → Meta, com envio de verdade.
 *
 * Prova o que `smoke:c14` declaradamente NÃO cobre: o envio ao provider. O job
 * PRECISA nascer de uma falta controlada e atravessar outbox, C14 e Messaging
 * (docs/runbooks/c14-validation.md §4). Exige autorização explícita e
 * destinatário consentido.
 *
 * Roda contra a clínica DEV que tem número conectado. NUNCA prod: `assertDevContext`.
 *
 * Uso: pnpm exec tsx --conditions=react-server scripts/no-show-meta-e2e.ts
 */
import { assertDevContext } from './_env';

// Registra os handlers do outbox (mesmo import do cron real). SEM isto o worker
// marca o evento como `skipped_no_handler` — e `skipped` é TERMINAL.
import '@/app/api/cron/outbox/handlers';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { encryptForTenant, hashForLookup, normalizePhone } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { outbox } from '@/lib/db/schema/infra/outbox';
import { publishEvent } from '@/lib/outbox/publish';
import { runOutboxOnce } from '@/lib/outbox/worker';

import { patients, patientConsents } from '@/contexts/patient';
import { appointments, SCHEDULING_EVENTS } from '@/contexts/scheduling';
import { processProactiveBatch } from '@/contexts/ai-agent/proactive-jobs/application/process';
import { aiProactiveJobs } from '@/contexts/ai-agent/proactive-jobs/schema';
import { outboundMessages } from '@/contexts/messaging/schema';

const CLINIC = 'f71713ed-6bd4-4656-b634-071811268d39';
const DOCTOR = '788ace8c-2cab-4a69-b54a-24c7025dfe17';
const PROCEDURE = 'cf431ddf-036d-457b-81ba-e1d6972573ca';
const TZ = 'America/Sao_Paulo';

const recipient = process.env.META_E2E_RECIPIENT_E164 ?? '';
const stamp = Date.now().toString(36);

let patientId = '';
let appointmentId = '';
let jobId = '';
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function mask(e164: string): string {
  return `${e164.slice(0, -4)}****`;
}

/** Partes locais do instante, sem depender dos helpers que estão sob teste. */
function localParts(d: Date): {
  y: number;
  m: number;
  day: number;
  hour: number;
  min: number;
  dow: string;
} {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(d);
  const g = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  return {
    y: Number(g('year')),
    m: Number(g('month')),
    day: Number(g('day')),
    hour: Number(g('hour')),
    min: Number(g('minute')),
    dow: g('weekday'),
  };
}

async function jobsForAppointment() {
  return withTenant(CLINIC, (tx) =>
    tx
      .select({
        id: aiProactiveJobs.id,
        type: aiProactiveJobs.type,
        status: aiProactiveJobs.status,
        dedupKey: aiProactiveJobs.dedupKey,
        scheduledFor: aiProactiveJobs.scheduledFor,
      })
      .from(aiProactiveJobs)
      .where(
        and(
          eq(aiProactiveJobs.clinicId, CLINIC),
          eq(aiProactiveJobs.dedupKey, `no_show_followup:${appointmentId}`),
        ),
      ),
  );
}

/**
 * Cleanup pelo pool admin, não por `withTenant`: a RLS de `authenticated` recusa
 * DELETE sem contexto de usuário, e a primeira versão deste script engoliu esse
 * erro — deixou paciente e consulta para trás enquanto anunciava cleanup.
 */
async function cleanup(): Promise<void> {
  const attempt = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (appointmentId) {
    await attempt('jobs', () =>
      dbAdmin
        .delete(aiProactiveJobs)
        .where(eq(aiProactiveJobs.dedupKey, `no_show_followup:${appointmentId}`)),
    );
    await attempt('appointment', () =>
      dbAdmin.delete(appointments).where(eq(appointments.id, appointmentId)),
    );
    await attempt('outbox', () =>
      dbAdmin
        .delete(outbox)
        .where(inArray(outbox.idempotencyKey, [`no-show-e2e:${appointmentId}`])),
    );
  }
  if (patientId) {
    await attempt('consents', () =>
      dbAdmin.delete(patientConsents).where(eq(patientConsents.patientId, patientId)),
    );
    await attempt('patient', () => dbAdmin.delete(patients).where(eq(patients.id, patientId)));
  }
}

async function readbackZero(): Promise<void> {
  const rows = await dbAdmin.execute<{ n: number }>(sql`
    SELECT
      (SELECT count(*) FROM patients WHERE id = ${patientId || null}::uuid)
    + (SELECT count(*) FROM appointments WHERE id = ${appointmentId || null}::uuid)
    + (SELECT count(*) FROM ai_proactive_jobs WHERE dedup_key = ${`no_show_followup:${appointmentId}`})
    + (SELECT count(*) FROM outbox WHERE idempotency_key = ${`no-show-e2e:${appointmentId}`})
      AS n
  `);
  const n = Number(rows[0]?.n ?? -1);
  if (n !== 0) failures.push(`readback não zerou: ${n} linha(s) remanescente(s)`);
  else console.log('readback: 0 linhas remanescentes (paciente, consulta, job, outbox)');
}

async function main(): Promise<void> {
  assertDevContext();
  assert(/^\+[1-9]\d{7,14}$/.test(recipient), 'META_E2E_RECIPIENT_E164 deve estar em E.164');
  console.log(`[no-show-e2e] clínica=${CLINIC} destinatário=${mask(recipient)}`);

  // --- 1. fixtures: paciente consentido + consulta com falta -----------------
  const telNorm = normalizePhone(recipient);
  const telHash = await hashForLookup(telNorm);
  const telEnc = await encryptForTenant(CLINIC, telNorm);
  const noShowAt = new Date();

  await withTenant(CLINIC, async (tx) => {
    const [pat] = await tx
      .insert(patients)
      .values({
        clinicId: CLINIC,
        nome: `E2E NoShow ${stamp}`,
        cpfEncrypted: 'enc',
        cpfHash: `e2e${stamp}`.padEnd(64, '0').slice(0, 64),
        telefoneEncrypted: telEnc,
        telefoneHash: telHash,
      })
      .returning({ id: patients.id });
    patientId = pat!.id;
    await tx
      .insert(patientConsents)
      .values({ clinicId: CLINIC, patientId, cobrancaWhatsapp: true, versao: 1 });

    const [appt] = await tx
      .insert(appointments)
      .values({
        clinicId: CLINIC,
        doctorId: DOCTOR,
        procedureId: PROCEDURE,
        patientId,
        scheduledAt: noShowAt,
        durationMin: 30,
        status: 'faltou',
        valor: '200.00',
        snapshotProcedureName: 'Consulta',
        snapshotProcedureValor: '200.00',
        snapshotProcedureDuracaoMin: 30,
        snapshotDoctorNome: 'Dra. Ana Souza',
      })
      .returning({ id: appointments.id });
    appointmentId = appt!.id;
  });
  console.log(`fixtures: paciente=${patientId} consulta=${appointmentId}`);

  // --- 2. o fato entra pelo outbox, não por chamada direta -------------------
  await withTenant(CLINIC, (tx) =>
    publishEvent(tx, {
      clinicId: CLINIC,
      eventType: SCHEDULING_EVENTS.NO_SHOW,
      payload: {
        clinicId: CLINIC,
        appointmentId,
        patientId,
        fromStatus: 'confirmado',
        toStatus: 'faltou',
        noShowAt: noShowAt.toISOString(),
      },
      idempotencyKey: `no-show-e2e:${appointmentId}`,
    }),
  );

  for (let i = 0; i < 8; i++) {
    await runOutboxOnce({ batchSize: 10, parallelism: 1 });
    if ((await jobsForAppointment()).length === 1) break;
  }
  const created = await jobsForAppointment();
  assert(created.length === 1, `esperava 1 job, veio ${created.length}`);
  assert(created[0]!.type === 'no_show_followup', `tipo inesperado: ${created[0]!.type}`);
  jobId = created[0]!.id;

  const p = localParts(created[0]!.scheduledFor);
  const noShowLocal = localParts(noShowAt);
  assert(p.hour === 10 && p.min === 0, `esperava 10:00 local, veio ${p.hour}:${p.min}`);
  assert(!['Sat', 'Sun'].includes(p.dow), `caiu em fim de semana: ${p.dow}`);
  assert(
    p.day !== noShowLocal.day || p.m !== noShowLocal.m,
    'agendou no mesmo dia da falta, não no próximo dia útil',
  );
  console.log(
    `job criado: ${jobId} · agendado ${p.dow} ${String(p.day).padStart(2, '0')}/${String(p.m).padStart(2, '0')} 10:00 ${TZ} (próximo dia útil)`,
  );

  // --- 3. antecipa o relógio do job, não a lógica ----------------------------
  // O envio real não pode esperar o próximo dia útil; o que se antecipa é só o
  // `scheduled_for`. A regra de agendamento já foi verificada acima.
  await withTenant(CLINIC, (tx) =>
    tx
      .update(aiProactiveJobs)
      .set({ scheduledFor: new Date(Date.now() - 3_600_000) })
      .where(eq(aiProactiveJobs.id, jobId)),
  );

  // --- 4. envio real ---------------------------------------------------------
  const batch = await processProactiveBatch('no_show_followup');
  console.log(`batch: ${JSON.stringify(batch)}`);
  assert(batch.sent === 1, `esperava sent=1, veio ${JSON.stringify(batch)}`);

  const [after] = await jobsForAppointment();
  assert(after?.status === 'sent', `status terminal inesperado: ${after?.status}`);

  const sentRows = await withTenant(CLINIC, (tx) =>
    tx
      .select({
        providerMessageId: outboundMessages.providerMessageId,
        status: outboundMessages.status,
        templateId: outboundMessages.templateId,
      })
      .from(outboundMessages)
      .where(eq(outboundMessages.clinicId, CLINIC))
      .orderBy(sql`created_at desc`)
      .limit(1),
  );
  const sent = sentRows[0];
  assert(Boolean(sent?.providerMessageId), 'sem providerMessageId na mensagem enviada');
  console.log(
    `enviado: providerMessageId=${sent!.providerMessageId} status=${sent!.status} template=${sent!.templateId}`,
  );

  // --- 5. replay: segunda passada não pode reenviar --------------------------
  const replay = await processProactiveBatch('no_show_followup');
  assert(replay.sent === 0, `replay reenviou: ${JSON.stringify(replay)}`);
  console.log(`replay: sent=0 (scanned=${replay.scanned}) — sem duplicata`);
}

main()
  .then(async () => {
    await cleanup();
    await readbackZero();
    if (failures.length > 0) {
      console.error(`[no-show-e2e] FALHAS: ${failures.join(' | ')}`);
      process.exitCode = 1;
      return;
    }
    console.log('\n[no-show-e2e] PASS — outbound cifrado preservado como evidência.');
  })
  .catch(async (err) => {
    console.error(`[no-show-e2e] ERRO: ${err instanceof Error ? err.message : String(err)}`);
    await cleanup();
    await readbackZero();
    // Falha de cleanup nunca pode passar em silêncio: ela deixa dado sintético
    // vivo num tenant real de DEV.
    if (failures.length > 0)
      console.error(`[no-show-e2e] CLEANUP INCOMPLETO: ${failures.join(' | ')}`);
    process.exitCode = 1;
  });
