/**
 * Proactive Jobs repository (C14) — ÚNICO ponto que toca ai_proactive_jobs
 * (ADR review C14 — C4: "o cron nunca toca a tabela"). Encapsula:
 *   - scan cross-tenant via dbAdmin (BYPASSRLS) — read-only, bound por LIMIT;
 *   - writes por clínica via withTenant (RLS aplicada);
 *   - helpers tx-aware (insertJobTx / getClinicTimezoneTx) p/ o handler de
 *     followup, que já roda dentro da withTenant do worker (nested é proibido).
 *
 * Idempotência de criação: UNIQUE(clinic_id, dedup_key) + ON CONFLICT DO NOTHING.
 */
import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { dbAdmin, type Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

import {
  aiProactiveJobs,
  type ProactiveJobInsert,
  type ProactiveJobRow,
  type ProactiveJobType,
} from '../schema';

const DEFAULT_TZ = 'America/Sao_Paulo';

/** Janela de envio permitida (hora local da clínica): [8, 20). */
export const SEND_WINDOW_START_HOUR = 8;
export const SEND_WINDOW_END_HOUR = 20;
export const PROACTIVE_LEASE_SECONDS = 5 * 60;

/** Forma enxuta usada pelo processor (só o necessário p/ enviar + finalizar). */
export interface ClaimedJob {
  id: string;
  clinicId: string;
  type: ProactiveJobType;
  payload: unknown;
  /** attempts JÁ incrementado (= tentativa em curso). */
  attempts: number;
  leaseToken: string;
}

/** Timezone da clínica via tx já aberta (handler). Single-table read da fundação. */
export async function getClinicTimezoneTx(tx: Tx, clinicId: string): Promise<string> {
  const rows = await tx.execute<{ timezone: string | null }>(
    sql`SELECT timezone FROM clinics WHERE id = ${clinicId} LIMIT 1`,
  );
  return rows[0]?.timezone ?? DEFAULT_TZ;
}

/** Timezone da clínica (processor, sem tx aberta). */
export async function getClinicTimezone(clinicId: string): Promise<string> {
  return withTenant(clinicId, (tx) => getClinicTimezoneTx(tx, clinicId));
}

/**
 * Insere um job dentro de uma tx existente (handler do worker). Retorna o id se
 * inseriu, ou null se já existia (dedup por clinic_id+dedup_key). Idempotente.
 */
export async function insertJobTx(tx: Tx, values: ProactiveJobInsert): Promise<string | null> {
  const ins = await tx
    .insert(aiProactiveJobs)
    .values(values)
    .onConflictDoNothing({ target: [aiProactiveJobs.clinicId, aiProactiveJobs.dedupKey] })
    .returning({ id: aiProactiveJobs.id });
  return ins[0]?.id ?? null;
}

/** Enqueue por clínica (cron de reminders/dunning), em withTenant. */
export async function enqueue(
  clinicId: string,
  values: ProactiveJobInsert,
): Promise<string | null> {
  return withTenant(clinicId, (tx) => insertJobTx(tx, values));
}

/**
 * RESERVA atômica + filtro de janela (cross-tenant; processor). Num único
 * statement: trava jobs pendentes vencidos do tipo com `FOR UPDATE SKIP LOCKED`
 * (mesmo padrão do outbox worker TX1), aplica a janela 8-20h LOCAL da clínica
 * (`AT TIME ZONE` — ADR-2/Kill-Criteria §14.15) e incrementa `attempts`. Jobs
 * fora da janela NÃO são reservados (não queimam tentativa). SKIP LOCKED impede
 * duas instâncias do cron pegarem a MESMA linha — granularidade por job (supera
 * o advisory lock por (type) do ADR-3). A chave de envio estável (job.id) é o
 * backstop contra duplicata no Meta. Retorna `attempts` já incrementado.
 */
export async function claimDue(type: ProactiveJobType, limit: number): Promise<ClaimedJob[]> {
  const rows = (await dbAdmin.execute(
    sql`WITH ranked AS MATERIALIZED (
          SELECT j.id,
                 j.clinic_id,
                 j.scheduled_for,
                 row_number() OVER (
                   PARTITION BY j.clinic_id ORDER BY j.scheduled_for, j.created_at, j.id
                 ) AS clinic_rank
            FROM ai_proactive_jobs j
            JOIN clinics c ON c.id = j.clinic_id
           WHERE j.type = ${type}
             AND j.scheduled_for <= now()
             AND (
               j.status = 'pending'
               OR (j.status = 'processing' AND j.lease_expires_at <= now())
             )
             AND extract(hour FROM (now() AT TIME ZONE c.timezone)) >= ${SEND_WINDOW_START_HOUR}
             AND extract(hour FROM (now() AT TIME ZONE c.timezone)) <  ${SEND_WINDOW_END_HOUR}
        ), due AS (
          SELECT j.id
            FROM ranked r
            JOIN ai_proactive_jobs j ON j.id = r.id
           WHERE j.status = 'pending'
              OR (j.status = 'processing' AND j.lease_expires_at <= now())
           ORDER BY r.clinic_rank, r.scheduled_for, r.clinic_id, j.id
           LIMIT ${limit}
           FOR UPDATE OF j SKIP LOCKED
        )
        UPDATE ai_proactive_jobs j
           SET attempts = j.attempts + 1,
               last_attempt_at = now(),
               status = 'processing',
               processing_started_at = now(),
               lease_expires_at = now() + make_interval(secs => ${PROACTIVE_LEASE_SECONDS}),
               lease_token = gen_random_uuid()::text
          FROM due
         WHERE j.id = due.id
        RETURNING j.id::text AS id, j.clinic_id::text AS clinic_id, j.type AS type,
                  j.payload AS payload, j.attempts AS attempts, j.lease_token AS lease_token`,
  )) as unknown as Array<{
    id: string;
    clinic_id: string;
    type: ProactiveJobType;
    payload: unknown;
    attempts: number;
    lease_token: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    clinicId: r.clinic_id,
    type: r.type,
    payload: r.payload,
    attempts: r.attempts,
    leaseToken: r.lease_token,
  }));
}

async function finalizeClaim(
  clinicId: string,
  jobId: string,
  leaseToken: string,
  patch: Partial<ProactiveJobRow>,
): Promise<void> {
  await withTenant(clinicId, async (tx) => {
    await tx
      .update(aiProactiveJobs)
      .set({
        ...patch,
        processingStartedAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
      })
      .where(
        and(
          eq(aiProactiveJobs.id, jobId),
          eq(aiProactiveJobs.clinicId, clinicId),
          eq(aiProactiveJobs.status, 'processing'),
          eq(aiProactiveJobs.leaseToken, leaseToken),
        ),
      );
  });
}

/** Enviado com sucesso (attempts já contabilizado na claimDue). */
export function finalizeSent(clinicId: string, jobId: string, leaseToken: string): Promise<void> {
  return finalizeClaim(clinicId, jobId, leaseToken, { status: 'sent', sentAt: new Date() });
}

/** Falha transitória → volta a pending com backoff (attempts já incrementado). */
export function finalizeRetry(
  clinicId: string,
  jobId: string,
  leaseToken: string,
  nextAt: Date,
  reason: string,
): Promise<void> {
  return finalizeClaim(clinicId, jobId, leaseToken, {
    status: 'pending',
    scheduledFor: nextAt,
    failedReason: reason,
  });
}

/** Falha definitiva (estourou MAX_ATTEMPTS ou erro não-retryável). */
export function finalizeFailed(
  clinicId: string,
  jobId: string,
  leaseToken: string,
  reason: string,
): Promise<void> {
  return finalizeClaim(clinicId, jobId, leaseToken, { status: 'failed', failedReason: reason });
}

/** Bloqueado por política/guard (suppression, consent, já pago, cancelado). */
export function cancel(
  clinicId: string,
  jobId: string,
  leaseToken: string,
  reason: string,
): Promise<void> {
  return finalizeClaim(clinicId, jobId, leaseToken, {
    status: 'cancelled',
    lastAttemptAt: new Date(),
    failedReason: reason,
  });
}
