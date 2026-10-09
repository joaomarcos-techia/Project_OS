/**
 * Proactive Jobs repository (C14) — ÚNICO ponto que toca ai_proactive_jobs
 * (ADR review C14 — C4: "o cron nunca toca a tabela"). Encapsula:
 *   - scan cross-tenant via dbAdmin (BYPASSRLS) — read-only, bound por LIMIT;
 *   - writes por clínica via withTenant (RLS aplicada);
 *   - leituras do painel por clínica via withTenant (jobs `failed`: a mensagem
 *     que não chegou ao paciente);
 *   - helpers tx-aware (insertJobTx / getClinicTimezoneTx) p/ o handler de
 *     followup, que já roda dentro da withTenant do worker (nested é proibido).
 *
 * Idempotência de criação: UNIQUE(clinic_id, dedup_key) + ON CONFLICT DO NOTHING.
 */
import 'server-only';

import { and, count, desc, eq, gte, isNull, or, sql } from 'drizzle-orm';

import { dbAdmin, type Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

import {
  aiProactiveJobs,
  type ProactiveJobInsert,
  type ProactiveJobRow,
  type ProactiveJobStatus,
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
  /** ADR-064 — chave de envio desta geração: `send_key`, ou o próprio id na geração 0. */
  sendKey: string;
  /** Geração 1 em diante: a Meta recusou uma geração anterior e isto é um reenvio. */
  resend: boolean;
  /** Último motivo gravado; num reenvio, a recusa que o motivou (`meta_131000`). */
  failedReason: string | null;
  /**
   * ADR-065 — base da validade de quem não tem prazo no payload. Não é o
   * `scheduled_for`: esse o backoff reescreve a cada tentativa.
   */
  createdAt: Date;
}

/**
 * `execute()` cru não carrega o tipo da coluna: conforme o cache de tipos do
 * postgres-js, timestamptz chega como `Date` ou como texto do Postgres
 * (`2026-10-08 12:00:00+00`). Mesmo cuidado do `reminder-candidates.ts`.
 */
function rawTimestamp(value: Date | string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('[c14] claimDue devolveu created_at inválido');
  }
  return parsed;
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
 * o advisory lock por (type) do ADR-3). A chave de envio da geração (ADR-064:
 * `send_key`, ou o job.id) é o backstop contra duplicata no Meta. Retorna
 * `attempts` já incrementado.
 *
 * Não corta por idade de propósito (ADR-065): o job vencido precisa ser
 * reservado para o guard de send-time fechá-lo com `expired_<tipo>`. Filtrado
 * aqui, ele ficaria `pending` para sempre, sem motivo.
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
                  j.payload AS payload, j.attempts AS attempts, j.lease_token AS lease_token,
                  coalesce(j.send_key, j.id)::text AS send_key,
                  (j.send_key IS NOT NULL) AS resend, j.failed_reason AS failed_reason,
                  j.created_at AS created_at`,
  )) as unknown as Array<{
    id: string;
    clinic_id: string;
    type: ProactiveJobType;
    payload: unknown;
    attempts: number;
    lease_token: string;
    send_key: string;
    resend: boolean;
    failed_reason: string | null;
    created_at: Date | string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    clinicId: r.clinic_id,
    type: r.type,
    payload: r.payload,
    attempts: r.attempts,
    leaseToken: r.lease_token,
    sendKey: r.send_key,
    resend: r.resend,
    failedReason: r.failed_reason,
    createdAt: rawTimestamp(r.created_at),
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

/**
 * Sem resposta definitiva (dedup `pending`, exceção) → volta a pending com
 * backoff e a MESMA chave: a próxima tentativa reencontra este envio no dedup
 * do sender em vez de arriscar um segundo (attempts já incrementado).
 */
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

/**
 * ADR-064 — a Meta RECUSOU esta geração com código retentável: volta a pending
 * com backoff e uma chave nova, no mesmo UPDATE guardado pelo lease. A chave fica
 * gravada antes de qualquer envio que a use, então um crash só repete esta
 * geração, que o dedup do sender segura.
 */
export function finalizeResend(
  clinicId: string,
  jobId: string,
  leaseToken: string,
  nextAt: Date,
  reason: string,
  sendKey: string,
): Promise<void> {
  return finalizeClaim(clinicId, jobId, leaseToken, {
    status: 'pending',
    scheduledFor: nextAt,
    failedReason: reason,
    sendKey,
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

/** O job cuja geração atual a Meta recusou depois do aceite, travado para a decisão. */
export interface RefusedJob {
  id: string;
  type: ProactiveJobType;
  status: ProactiveJobStatus;
  payload: unknown;
  attempts: number;
  leaseToken: string | null;
  /**
   * `processing` com lease vencido: a tentativa que segurava o job morreu (mesmo
   * critério do `claimDue`). Lease vivo = o processor ainda está entre o aceite
   * da Cloud API e o finalize.
   */
  leaseExpired: boolean;
  /** ADR-065 — base do prazo de quem não tem prazo no payload (`remainder_link`). */
  createdAt: Date;
}

/**
 * EC-32 + ADR-064 — a Meta recusou o envio DEPOIS de aceitá-lo (callback
 * `failed`). Acha, na TX do worker, o job cuja geração ATUAL usou `sendKey`:
 *   - geração 0: chave = id, com `send_key` NULL;
 *   - geração 1 em diante: `send_key` = chave.
 * A chave de uma geração já substituída não acha nada, e é isso que impede o
 * callback atrasado ou reentregue de um envio antigo de provocar outro reenvio.
 * Envio que não é da C14 (resposta da IA, resposta manual) também não acha.
 *
 * `FOR UPDATE` serializa com o `claimDue` (SKIP LOCKED pula a linha travada) e
 * com o finalize do processor.
 */
export async function lockJobBySendKeyTx(
  tx: Tx,
  clinicId: string,
  sendKey: string,
): Promise<RefusedJob | null> {
  const [job] = await tx
    .select({
      id: aiProactiveJobs.id,
      type: aiProactiveJobs.type,
      status: aiProactiveJobs.status,
      payload: aiProactiveJobs.payload,
      attempts: aiProactiveJobs.attempts,
      leaseToken: aiProactiveJobs.leaseToken,
      leaseExpired: sql<boolean>`coalesce(${aiProactiveJobs.leaseExpiresAt} <= now(), false)`,
      createdAt: aiProactiveJobs.createdAt,
    })
    .from(aiProactiveJobs)
    .where(
      and(
        eq(aiProactiveJobs.clinicId, clinicId),
        or(
          and(eq(aiProactiveJobs.id, sendKey), isNull(aiProactiveJobs.sendKey)),
          eq(aiProactiveJobs.sendKey, sendKey),
        ),
      ),
    )
    .limit(1)
    .for('update');
  return job ?? null;
}

export type RefusalSettlement =
  | { status: 'failed'; reason: string }
  /** ADR-064 — recusa retentável: reenvia em `nextAt`, com a chave nova. */
  | { status: 'pending'; reason: string; nextAt: Date; sendKey: string };

/**
 * Fecha (`failed`) ou reagenda com chave nova (`pending`) o job travado por
 * `lockJobBySendKeyTx`. Um `processing` de lease vencido é assumido aqui e o
 * lease morre junto: se a tentativa morta acordar, o finalize dela não acha mais
 * o token. O UPDATE ainda confere o status e o token lidos.
 */
export async function settleRefusedJobTx(
  tx: Tx,
  clinicId: string,
  job: RefusedJob,
  settlement: RefusalSettlement,
): Promise<void> {
  await tx
    .update(aiProactiveJobs)
    .set({
      status: settlement.status,
      failedReason: settlement.reason,
      ...(settlement.status === 'pending'
        ? { scheduledFor: settlement.nextAt, sendKey: settlement.sendKey }
        : {}),
      processingStartedAt: null,
      leaseExpiresAt: null,
      leaseToken: null,
    })
    .where(
      and(
        eq(aiProactiveJobs.id, job.id),
        eq(aiProactiveJobs.clinicId, clinicId),
        eq(aiProactiveJobs.status, job.status),
        job.leaseToken === null
          ? isNull(aiProactiveJobs.leaseToken)
          : eq(aiProactiveJobs.leaseToken, job.leaseToken),
      ),
    );
}

// --- leitura do painel: mensagens que não chegaram ao paciente ----------------

/** Job terminado em `failed`, na forma que o painel da clínica lê. */
export interface FailedJob {
  id: string;
  type: ProactiveJobType;
  payload: unknown;
  failedReason: string | null;
  /** Última tentativa de envio: quando a mensagem saiu, ou tentou sair. */
  lastAttemptAt: Date | null;
}

const FAILED_JOB_COLUMNS = {
  id: aiProactiveJobs.id,
  type: aiProactiveJobs.type,
  payload: aiProactiveJobs.payload,
  failedReason: aiProactiveJobs.failedReason,
  lastAttemptAt: aiProactiveJobs.lastAttemptAt,
};

/**
 * Só `failed`, que é terminal: a mensagem não chegou e não será reenviada.
 * `pending` com `meta_<código>` é reenvio agendado, e `cancelled` é decisão
 * deliberada (opt-out, sem consentimento, cobrança já paga). Nenhum dos dois é
 * falha a mostrar. O tempo é o da última tentativa, que todo job `failed` tem:
 * só passa a `failed` quem o `claimDue` já reservou.
 */
function failedSince(clinicId: string, since: Date) {
  return and(
    eq(aiProactiveJobs.clinicId, clinicId),
    eq(aiProactiveJobs.status, 'failed'),
    gte(aiProactiveJobs.lastAttemptAt, since),
  );
}

/**
 * Jobs que falharam desde `since`, do mais recente ao mais antigo. Roda em
 * `withTenant` (fluxo iniciado por usuário) e ainda filtra a clínica no
 * predicado, a mesma defesa dupla do resto do repositório.
 */
export async function listFailedSince(
  clinicId: string,
  since: Date,
  limit: number,
): Promise<FailedJob[]> {
  return withTenant(clinicId, (tx) =>
    tx
      .select(FAILED_JOB_COLUMNS)
      .from(aiProactiveJobs)
      .where(failedSince(clinicId, since))
      .orderBy(desc(aiProactiveJobs.lastAttemptAt), desc(aiProactiveJobs.id))
      .limit(limit),
  );
}

/** Quantos jobs falharam desde `since` (o mesmo predicado da lista). */
export async function countFailedSince(clinicId: string, since: Date): Promise<number> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select({ total: count() })
      .from(aiProactiveJobs)
      .where(failedSince(clinicId, since));
    return Number(row?.total ?? 0);
  });
}

/**
 * Um job `failed` da clínica, por id. Base do "Copiar link": a action só
 * resolve o link de cobrança de um envio que de fato falhou, nunca o de um id
 * qualquer vindo do browser.
 */
export async function findFailedJob(clinicId: string, jobId: string): Promise<FailedJob | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select(FAILED_JOB_COLUMNS)
      .from(aiProactiveJobs)
      .where(
        and(
          eq(aiProactiveJobs.id, jobId),
          eq(aiProactiveJobs.clinicId, clinicId),
          eq(aiProactiveJobs.status, 'failed'),
        ),
      )
      .limit(1);
    return row ?? null;
  });
}
