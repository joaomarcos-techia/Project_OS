/**
 * Smoke C14 — Proactive Jobs, nível DB/worker (contra qoro-dev, NUNCA prod).
 *
 * Prova o que o vitest (I/O mockado) NÃO cobre: o SQL cru + RLS reais.
 *   1  getProactiveContact: decifra telefone + agrega consent (cobrança)
 *   2  suppression_list reflete em getProactiveContact (canal whatsapp)
 *   3  reminder enqueue (listReminderCandidates) + scheduled_for + DEDUP
 *   4  dunning enqueue: D+3 (4 dias) e D+3/D+7 (8 dias) por due_date
 *   5  guard "pagou → não envia": lançamento pago sai de listDunningCandidates
 *   6  claimDue: CTE FOR UPDATE SKIP LOCKED + janela 8-20h local (AT TIME ZONE)
 *   7  followup via worker: prontuario.signed (needs_return) → job followup
 *   8  no-show via worker: evento repetido → um job no próximo dia útil às 10h
 *      + guarda tenant-scoped de remarcação equivalente
 *   9  evento de clínica removida termina skipped sem queimar retries
 *  10  RLS: clínica B não vê os jobs da A
 *
 * NÃO envia ao Meta (precisa de número conectado + templates aprovados — ver
 * docs/runbooks/c14-validation.md §4). Cobre toda a pipeline até o send.
 *
 * Env exigido: DATABASE_URL, SUPABASE_SECRET_KEY (cria o médico), CRYPTO_MASTER_KEY_V1
 * + CRYPTO_LOOKUP_SALT (cifra o telefone do paciente). Uso: `pnpm smoke:c14`.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { encryptForTenant, hashForLookup, normalizePhone } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';
import { outbox } from '@/lib/db/schema/infra/outbox';
import { payloadHash } from '@/lib/idempotency/hash';
import { withTenant } from '@/lib/db/tenant';
import { publishEvent } from '@/lib/outbox/publish';

import {
  patientApiV1,
  patientConsentDecisions,
  patientConsents,
  patients,
  suppressionList,
} from '@/contexts/patient';
import { collectionCases, financialApiV1, lancamentos } from '@/contexts/financial';
import {
  SCHEDULING_EVENTS,
  appointments,
  procedures,
  schedulingApiV1,
} from '@/contexts/scheduling';
import { CLINICAL_EVENTS } from '@/contexts/clinical';

import { aiProactiveJobs } from '@/contexts/ai-agent/proactive-jobs/schema';
import {
  enqueueDunningDue,
  enqueueRemindersDue,
} from '@/contexts/ai-agent/proactive-jobs/application/enqueue';
import { claimDue } from '@/contexts/ai-agent/proactive-jobs/infra/repository';
import {
  addCalendarDays,
  clinicLocalHour,
  clinicLocalToUtc,
  localDateYMD,
} from '@/contexts/ai-agent/proactive-jobs/infra/tz';

// Catálogo (event schemas) + registry de handlers (boot file do cron).
import '@/lib/db/schema';
import '@/app/api/cron/outbox/handlers';
import { runOutboxOnce } from '@/lib/outbox/worker';

assertDevContext();

// --- harness ---------------------------------------------------------------
let pass = 0;
let fail = 0;
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    pass++;
    console.log(`[OK]   ${name}`);
  } catch (e) {
    fail++;
    console.error(`[FAIL] ${name}\n       ${e instanceof Error ? e.message : String(e)}`);
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const TZ = 'America/Sao_Paulo';
const CLINIC_A = randomUUID();
const CLINIC_B = randomUUID();
const stamp = Date.now().toString(36);
const phone = '+5511988887777';
const supabase = createAdminClient();
let doctorId = '';
let procedureId = '';
let patientId = '';
const orphanEventId = randomUUID();
const orphanClinicId = randomUUID();

/** Instante UTC cuja DATA LOCAL (SP) é hoje + `addDays`, ao meio-dia local. */
function localDatePlusUtc(addDays: number): Date {
  const localDate = addCalendarDays(localDateYMD(TZ, new Date()), addDays);
  return clinicLocalToUtc(TZ, localDate, 12);
}

async function jobsOfA(): Promise<
  Array<{ type: string; status: string; dedupKey: string; scheduledFor: Date }>
> {
  return withTenant(CLINIC_A, async (tx) => {
    const rows = await tx
      .select({
        type: aiProactiveJobs.type,
        status: aiProactiveJobs.status,
        dedupKey: aiProactiveJobs.dedupKey,
        scheduledFor: aiProactiveJobs.scheduledFor,
      })
      .from(aiProactiveJobs)
      .where(eq(aiProactiveJobs.clinicId, CLINIC_A));
    return rows;
  });
}

async function main(): Promise<void> {
  // --- fixtures -------------------------------------------------------------
  await dbAdmin.execute(sql`
    INSERT INTO clinics (id, slug, nome, status, timezone) VALUES
      (${CLINIC_A}::uuid, ${'c14a' + stamp}, 'Smoke C14 A', 'active', ${TZ}),
      (${CLINIC_B}::uuid, ${'c14b' + stamp}, 'Smoke C14 B', 'active', ${TZ})
  `);
  const { data: created, error } = await supabase.auth.admin.createUser({
    email: `c14-doctor-${stamp}@smoke.local`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (error || !created.user) throw error ?? new Error('createUser falhou');
  doctorId = created.user.id;
  await dbAdmin.execute(sql`
    INSERT INTO profiles (id, clinic_id, nome, role, ativo)
    VALUES (${doctorId}::uuid, ${CLINIC_A}::uuid, 'Dra. Smoke', 'doctor'::role_enum, true)
    ON CONFLICT (id) DO UPDATE SET clinic_id = ${CLINIC_A}::uuid
  `);

  const telHash = await hashForLookup(normalizePhone(phone));
  const telEnc = await encryptForTenant(CLINIC_A, normalizePhone(phone));
  await withTenant(CLINIC_A, async (tx) => {
    const [proc] = await tx
      .insert(procedures)
      .values({
        clinicId: CLINIC_A,
        codigo: 'C001',
        descricao: 'Consulta',
        valorPadrao: '200.00',
        duracaoPadraoMin: 30,
      })
      .returning({ id: procedures.id });
    procedureId = proc!.id;
    const [pat] = await tx
      .insert(patients)
      .values({
        clinicId: CLINIC_A,
        nome: 'Paciente Smoke',
        cpfEncrypted: 'enc',
        cpfHash: '0'.repeat(64),
        telefoneEncrypted: telEnc,
        telefoneHash: telHash,
      })
      .returning({ id: patients.id });
    patientId = pat!.id;
    await tx
      .insert(patientConsents)
      .values({ clinicId: CLINIC_A, patientId, cobrancaWhatsapp: true, versao: 1 });
    await tx.insert(patientConsentDecisions).values({
      clinicId: CLINIC_A,
      patientId,
      purpose: 'agendamento_whatsapp',
      channel: 'whatsapp',
      granted: true,
      version: 1,
    });
  });
  console.log(`[smoke:c14] A=${CLINIC_A} B=${CLINIC_B} patient=${patientId}`);

  try {
    // 1 — contato resolvido (telefone decifrado + consent) -------------------
    await step('1 — getProactiveContact decifra telefone + consent cobranca=true', async () => {
      const c = await patientApiV1.getProactiveContact(CLINIC_A, patientId);
      assert(c !== null, 'contato nulo');
      assert(c!.phone === normalizePhone(phone), `telefone inesperado: ${c!.phone}`);
      assert(c!.cobrancaWhatsapp === true, 'cobrancaWhatsapp deveria ser true');
      assert(c!.agendamentoWhatsapp === true, 'agendamentoWhatsapp deveria ser true');
      assert(c!.suppressedWhatsapp === false, 'não deveria estar suprimido ainda');
    });

    // 2 — suppression reflete no contato -------------------------------------
    await step(
      '2 — suppression_list (whatsapp) → suppressedWhatsapp=true; remover → false',
      async () => {
        await withTenant(CLINIC_A, (tx) =>
          tx.insert(suppressionList).values({
            clinicId: CLINIC_A,
            contactHash: telHash,
            channel: 'whatsapp',
            reason: 'smoke',
          }),
        );
        const sup = await patientApiV1.getProactiveContact(CLINIC_A, patientId);
        assert(sup!.suppressedWhatsapp === true, 'deveria estar suprimido');
        await withTenant(CLINIC_A, (tx) =>
          tx
            .delete(suppressionList)
            .where(
              and(eq(suppressionList.clinicId, CLINIC_A), eq(suppressionList.contactHash, telHash)),
            ),
        );
        const unsup = await patientApiV1.getProactiveContact(CLINIC_A, patientId);
        assert(unsup!.suppressedWhatsapp === false, 'suppression deveria ter sido removida');
      },
    );

    // 3 — reminder enqueue + dedup -------------------------------------------
    let apptId = '';
    await step('3 — appointment confirmado amanhã → 1 reminder; re-rodar NÃO duplica', async () => {
      apptId = await withTenant(CLINIC_A, async (tx) => {
        const [a] = await tx
          .insert(appointments)
          .values({
            clinicId: CLINIC_A,
            doctorId,
            procedureId,
            patientId,
            scheduledAt: localDatePlusUtc(1),
            durationMin: 30,
            status: 'confirmado',
            valor: '200.00',
            snapshotProcedureName: 'Consulta',
            snapshotProcedureValor: '200.00',
            snapshotProcedureDuracaoMin: 30,
            snapshotDoctorNome: 'Dra. Smoke',
          })
          .returning({ id: appointments.id });
        return a!.id;
      });
      await enqueueRemindersDue();
      await enqueueRemindersDue(); // 2ª vez → dedup
      const reminders = (await jobsOfA()).filter(
        (j) => j.type === 'reminder' && j.dedupKey === `reminder:${apptId}`,
      );
      assert(reminders.length === 1, `esperava 1 reminder, veio ${reminders.length}`);
      assert(reminders[0]!.status === 'pending', 'reminder deveria estar pending');
    });

    // 4 — dunning enqueue por due_date ---------------------------------------
    let lancD3 = '';
    let lancD7 = '';
    let lancManual = '';
    await step('4 — dunning: D+4 → d3; D+8 → d3+d7; D+45 → fila humana auditada', async () => {
      const mk = (daysAgo: number): Promise<string> =>
        withTenant(CLINIC_A, async (tx) => {
          const due = new Date();
          due.setUTCDate(due.getUTCDate() - daysAgo);
          const [l] = await tx
            .insert(lancamentos)
            .values({
              clinicId: CLINIC_A,
              tipo: 'receber',
              descricao: 'Consulta',
              valor: '200.00',
              status: 'pendente',
              dueDate: due.toISOString().slice(0, 10),
              patientId,
              createdVia: 'manual',
              snapshotProcedureName: 'Consulta',
            })
            .returning({ id: lancamentos.id });
          return l!.id;
        });
      lancD3 = await mk(4);
      lancD7 = await mk(8);
      lancManual = await mk(45);
      const manualCandidate = (await financialApiV1.listDunningCandidates(500)).find(
        (candidate) => candidate.lancamentoId === lancManual,
      );
      if (!manualCandidate) throw new Error('candidato D+45 não encontrado');

      let crossTenantRejected = false;
      try {
        await financialApiV1.upsertCollectionCase(
          { ...manualCandidate, clinicId: CLINIC_B },
          'd30_manual',
        );
      } catch (error) {
        crossTenantRejected =
          error instanceof Error &&
          error.message === 'collection case source does not belong to the candidate clinic';
        if (!crossTenantRejected) throw error;
      }
      assert(crossTenantRejected, 'seam privilegiada aceitou clinic_id divergente da origem');
      const beforeEnqueue = await dbAdmin.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n
          FROM collection_cases
         WHERE lancamento_id = ${lancManual}
      `);
      assert(beforeEnqueue[0]?.n === 0, 'tentativa cross-tenant criou collection_case');

      await enqueueDunningDue();
      await enqueueDunningDue(); // re-scan: jobs e audit do caso inalterado não duplicam
      const dun = (await jobsOfA()).filter((j) => j.type === 'dunning');
      assert(
        dun.some((j) => j.dedupKey === `dunning:${lancD3}:d3`),
        'faltou dunning d3 (4 dias)',
      );
      assert(
        dun.some((j) => j.dedupKey === `dunning:${lancD7}:d3`),
        'faltou dunning d3 (8 dias)',
      );
      assert(
        dun.some((j) => j.dedupKey === `dunning:${lancD7}:d7`),
        'faltou dunning d7 (8 dias)',
      );
      assert(
        !dun.some((j) => j.dedupKey.startsWith(`dunning:${lancManual}:`)),
        'D+45 não pode gerar WhatsApp automático',
      );
      const manual = await withTenant(CLINIC_A, (tx) =>
        tx
          .select({ id: collectionCases.id, stage: collectionCases.stage })
          .from(collectionCases)
          .where(eq(collectionCases.lancamentoId, lancManual)),
      );
      assert(manual.length === 1, `esperava 1 collection_case, veio ${manual.length}`);
      assert(manual[0]!.stage === 'd30_manual', 'D+45 deveria entrar em d30_manual');
      const audit = await withTenant(CLINIC_A, (tx) =>
        tx.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n
            FROM audit_events
           WHERE clinic_id = ${CLINIC_A}
             AND action = 'financial.collection_case.upserted'
             AND resource_id = ${manual[0]!.id}`),
      );
      assert(Number(audit[0]?.n) === 1, 'upsert idempotente deveria ter 1 audit event');
    });

    // 5 — guard "pagou → não envia" (nível candidato) ------------------------
    await step('5 — pago sai dos candidatos e resolve a fila manual com audit', async () => {
      await withTenant(CLINIC_A, (tx) =>
        tx
          .update(lancamentos)
          .set({ status: 'pago', valorPago: '200.00', paidAt: new Date() }) // coerência: pago exige paid_at
          .where(sql`${lancamentos.id} IN (${lancD3}::uuid, ${lancManual}::uuid)`),
      );
      await enqueueDunningDue();
      const cands = await financialApiV1.listDunningCandidates(500);
      assert(
        !cands.some((c) => c.lancamentoId === lancD3),
        'lançamento pago não deveria ser candidato a dunning',
      );
      const resolved = await withTenant(CLINIC_A, (tx) =>
        tx
          .select({ id: collectionCases.id, status: collectionCases.status })
          .from(collectionCases)
          .where(eq(collectionCases.lancamentoId, lancManual)),
      );
      assert(resolved[0]?.status === 'resolved', 'collection_case quitado deveria ser resolved');
      const audit = await withTenant(CLINIC_A, (tx) =>
        tx.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n
            FROM audit_events
           WHERE clinic_id = ${CLINIC_A}
             AND action = 'financial.collection_case.resolved'
             AND resource_id = ${resolved[0]!.id}`),
      );
      assert(Number(audit[0]?.n) === 1, 'resolução deveria ter 1 audit event');
    });

    // 6 — claimDue: CTE SQL + janela 8-20h local -----------------------------
    await step(
      '6 — claimDue executa (CTE/SKIP LOCKED) e respeita a janela 8-20h local',
      async () => {
        // job já-vencido p/ ser elegível independente do horário de criação.
        await withTenant(CLINIC_A, (tx) =>
          tx.insert(aiProactiveJobs).values({
            clinicId: CLINIC_A,
            type: 'reminder',
            scheduledFor: new Date(Date.now() - 3600_000),
            payload: {
              patientId,
              appointmentId: apptId,
              scheduledAt: new Date().toISOString(),
              doctorNome: 'Dra. Smoke',
            },
            dedupKey: `reminder-due:${apptId}`,
          }),
        );
        const inWindow =
          clinicLocalHour(TZ, new Date()) >= 8 && clinicLocalHour(TZ, new Date()) < 20;
        const claimed = (await claimDue('reminder', 50)).filter((j) => j.clinicId === CLINIC_A);
        if (inWindow)
          assert(claimed.length >= 1, 'dentro da janela deveria reservar ≥1 reminder vencido');
        else assert(claimed.length === 0, 'fora da janela 8-20h NÃO deveria reservar');
        console.log(
          `       (janela local ${inWindow ? 'ABERTA' : 'FECHADA'} — ${claimed.length} reservado(s))`,
        );
      },
    );

    // 7 — followup via worker -------------------------------------------------
    await step('7 — prontuario.signed (needs_return) → worker cria followup', async () => {
      const prontuarioId = randomUUID();
      await withTenant(CLINIC_A, (tx) =>
        publishEvent(tx, {
          clinicId: CLINIC_A,
          eventType: CLINICAL_EVENTS.PRONTUARIO_SIGNED,
          payload: {
            prontuarioId,
            clinicId: CLINIC_A,
            patientId,
            signedBy: doctorId,
            signedAt: new Date().toISOString(),
            needsReturn: true,
            returnDays: 30,
            signedDoctorNome: 'Dra. Smoke',
          },
          idempotencyKey: `smoke-followup:${prontuarioId}`,
        }),
      );
      let ok = false;
      for (let i = 0; i < 8 && !ok; i++) {
        await runOutboxOnce({ batchSize: 10, parallelism: 1 });
        ok = (await jobsOfA()).some(
          (j) => j.type === 'followup' && j.dedupKey === `followup:${prontuarioId}`,
        );
      }
      assert(ok, 'followup job não foi criado pelo handler do worker');
    });

    // 8 — no-show → C14 + dedup + guarda de remarcação -----------------------
    await step(
      '8 — no_show repetido → 1 job na segunda 10h; remarcação equivalente é detectada',
      async () => {
        const noShowAt = '2026-09-04T15:00:00.000Z'; // sexta, 12h BRT
        const noShowProcedureId = await withTenant(CLINIC_A, async (tx) => {
          const [procedure] = await tx
            .insert(procedures)
            .values({
              clinicId: CLINIC_A,
              codigo: 'C002',
              descricao: 'Retorno smoke',
              valorPadrao: '100.00',
              duracaoPadraoMin: 30,
            })
            .returning({ id: procedures.id });
          return procedure!.id;
        });
        const noShowAppointmentId = await withTenant(CLINIC_A, async (tx) => {
          const [appointment] = await tx
            .insert(appointments)
            .values({
              clinicId: CLINIC_A,
              doctorId,
              procedureId: noShowProcedureId,
              patientId,
              scheduledAt: new Date('2026-09-04T15:00:00.000Z'),
              durationMin: 30,
              status: 'faltou',
              valor: '200.00',
              snapshotProcedureName: 'Retorno smoke',
              snapshotProcedureValor: '100.00',
              snapshotProcedureDuracaoMin: 30,
              snapshotDoctorNome: 'Dra. Smoke',
            })
            .returning({ id: appointments.id });
          return appointment!.id;
        });

        for (const suffix of ['a', 'b']) {
          await withTenant(CLINIC_A, (tx) =>
            publishEvent(tx, {
              clinicId: CLINIC_A,
              eventType: SCHEDULING_EVENTS.NO_SHOW,
              payload: {
                clinicId: CLINIC_A,
                appointmentId: noShowAppointmentId,
                patientId,
                fromStatus: 'confirmado',
                toStatus: 'faltou',
                noShowAt,
              },
              idempotencyKey: `smoke-no-show:${noShowAppointmentId}:${suffix}`,
            }),
          );
        }

        for (let i = 0; i < 8; i++) {
          await runOutboxOnce({ batchSize: 10, parallelism: 1 });
          const rows = (await jobsOfA()).filter(
            (job) => job.dedupKey === `no_show_followup:${noShowAppointmentId}`,
          );
          if (rows.length === 1) break;
        }
        const recoveryJobs = (await jobsOfA()).filter(
          (job) => job.dedupKey === `no_show_followup:${noShowAppointmentId}`,
        );
        assert(
          recoveryJobs.length === 1,
          `esperava 1 no_show_followup, veio ${recoveryJobs.length}`,
        );
        assert(recoveryJobs[0]!.type === 'no_show_followup', 'tipo do job de falta incorreto');
        assert(
          recoveryJobs[0]!.scheduledFor.toISOString() === '2026-09-07T13:00:00.000Z',
          `horário inesperado: ${recoveryJobs[0]!.scheduledFor.toISOString()}`,
        );

        const guardAfter = new Date();
        const futureAppointmentId = await withTenant(CLINIC_A, async (tx) => {
          const [appointment] = await tx
            .insert(appointments)
            .values({
              clinicId: CLINIC_A,
              doctorId,
              procedureId: noShowProcedureId,
              patientId,
              scheduledAt: new Date(Date.now() + 7 * 86_400_000),
              durationMin: 30,
              status: 'agendado',
              valor: '200.00',
              snapshotProcedureName: 'Retorno smoke',
              snapshotProcedureValor: '100.00',
              snapshotProcedureDuracaoMin: 30,
              snapshotDoctorNome: 'Dra. Smoke',
            })
            .returning({ id: appointments.id });
          return appointment!.id;
        });
        const rescheduled = await schedulingApiV1.hasFutureEquivalentAppointment(CLINIC_A, {
          patientId,
          procedureId: noShowProcedureId,
          after: guardAfter,
          excludeAppointmentId: noShowAppointmentId,
        });
        assert(rescheduled, 'remarcação futura equivalente deveria ser detectada');

        await withTenant(CLINIC_A, (tx) =>
          tx
            .update(appointments)
            .set({ status: 'cancelado' })
            .where(eq(appointments.id, futureAppointmentId)),
        );
        const cancelledDoesNotCount = await schedulingApiV1.hasFutureEquivalentAppointment(
          CLINIC_A,
          {
            patientId,
            procedureId: noShowProcedureId,
            after: guardAfter,
            excludeAppointmentId: noShowAppointmentId,
          },
        );
        assert(!cancelledDoesNotCount, 'remarcação cancelada não pode bloquear a recuperação');
      },
    );

    // 9 — evento órfão --------------------------------------------------------
    await step('9 — clínica removida → evento preservado e terminalmente skipped', async () => {
      const payload = {
        chargeId: randomUUID(),
        patientId: randomUUID(),
        appointmentId: randomUUID(),
        kind: 'remainder',
        amount: 10,
      };
      const oldDate = new Date('2000-01-01T00:00:00.000Z');
      await dbAdmin.insert(outbox).values({
        id: orphanEventId,
        clinicId: orphanClinicId,
        eventType: 'payments.patient_charge.link_ready',
        payload,
        payloadHash: payloadHash(payload),
        idempotencyKey: `smoke:orphan:${orphanEventId.replaceAll('-', '')}`,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: oldDate,
        createdAt: oldDate,
      });

      await runOutboxOnce({ batchSize: 1, parallelism: 1 });
      const state = await dbAdmin.execute<{ status: string; attempts: number }>(sql`
        SELECT status::text, attempts
          FROM outbox
         WHERE id = ${orphanEventId}::uuid
      `);
      assert(state[0]?.status === 'skipped', `evento órfão terminou ${state[0]?.status}`);
      assert(state[0]?.attempts === 1, `evento órfão consumiu ${state[0]?.attempts} tentativas`);
    });

    // 10 — RLS ----------------------------------------------------------------
    await step('10 — RLS: clínica B não vê jobs da A', async () => {
      const seenByB = await withTenant(CLINIC_B, async (tx) => {
        const rows = await tx
          .select({ id: aiProactiveJobs.id })
          .from(aiProactiveJobs)
          .where(eq(aiProactiveJobs.clinicId, CLINIC_A));
        return rows.length;
      });
      assert(seenByB === 0, `RLS furada: B viu ${seenByB} jobs da A`);
    });
  } finally {
    await dbAdmin.execute(sql`DELETE FROM outbox WHERE id = ${orphanEventId}::uuid`);
    // outbox/idempotency/audit usam tenantId() sem FK; limpar por fixture antes
    // das clínicas para não deixar eventos órfãos no worker de desenvolvimento.
    for (const clinicId of [CLINIC_A, CLINIC_B]) {
      for (const table of ['outbox', 'idempotency_keys', 'audit_events'] as const) {
        await dbAdmin.execute(sql`DELETE FROM ${sql.raw(table)} WHERE clinic_id = ${clinicId}`);
      }
    }
    await dbAdmin.execute(
      sql`DELETE FROM clinics WHERE id IN (${CLINIC_A}::uuid, ${CLINIC_B}::uuid)`,
    );
    await supabase.auth.admin.deleteUser(doctorId).catch(() => {});
  }

  console.log(`\n[smoke:c14] ${pass} OK · ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
