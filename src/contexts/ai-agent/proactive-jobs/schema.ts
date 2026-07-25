/**
 * Proactive Jobs schema (C14) — fila AGENDADA de mensagens proativas.
 *
 * Categoria (ADR-007 §10): tenant-scoped (clinic_id FK CASCADE). É a fila de
 * jobs PRÉ-DATADOS (lembrete D-1, dunning D+3/D+7, followup return-2); o outbox
 * NÃO vira a fila porque os jobs disparam no futuro. O job-row é a unidade de
 * retry e reaproveita o backoff schedule do outbox (src/lib/outbox/backoff.ts).
 *
 * Contratos congelados (PlanoAção §14.18):
 *   - 3 tipos canônicos (reminder|dunning|followup).
 *   - status pending|sent|cancelled|failed.
 *   - suppression/consent check obrigatório antes do send (camada application).
 *
 * Idempotência:
 *   - CRIAÇÃO: UNIQUE(clinic_id, dedup_key) — "um appointment → um reminder",
 *     "um lançamento → um dunning por estágio", "um prontuário → um followup".
 *   - ENVIO: a idempotencyKey passada ao messagingApiV1.sendText é o PRÓPRIO
 *     job.id (estável por job, NUNCA por tentativa) → at-most-once no Meta
 *     mesmo com retries (ADR C3 da review de C14).
 *
 * PII (ADR-011 #27): payload carrega APENAS ids + snapshot operacional NÃO-PII
 * (nome de médico, data, valor). Nome/telefone de paciente JAMAIS entram aqui —
 * são resolvidos no send-time pelo patientApiV1.getProactiveContact.
 *
 * RLS (ENABLE+FORCE) + policies INSERT/SELECT/UPDATE por tenant vivem na
 * migration 00NN_c14_proactive_jobs.sql. Writes do cron rodam em withTenant
 * (authenticated); o scan cross-tenant do processor roda em dbAdmin (BYPASSRLS).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// eslint-disable-next-line boundaries/element-types -- D35: tenantIdRef ref vive no schema tenancy por design (mesma exceção de ai-agent/scheduling/financial schema).
import { tenantIdRef } from '@/contexts/tenancy';
import { uuidPk } from '@/lib/db/types';

// --- enums -------------------------------------------------------------------

export const proactiveJobType = pgEnum('proactive_job_type', ['reminder', 'dunning', 'followup']);
export const proactiveJobStatus = pgEnum('proactive_job_status', [
  'pending',
  'processing',
  'sent',
  'cancelled',
  'failed',
]);

export type ProactiveJobType = (typeof proactiveJobType.enumValues)[number];
export type ProactiveJobStatus = (typeof proactiveJobStatus.enumValues)[number];

// --- ai_proactive_jobs -------------------------------------------------------

export const aiProactiveJobs = pgTable(
  'ai_proactive_jobs',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    type: proactiveJobType('type').notNull(),
    /** Instante UTC já convertido do alvo local da clínica (ADR-2: dias-calendário no tz). */
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    /** Snapshot operacional NÃO-PII + ids. Sem nome/telefone de paciente. */
    payload: jsonb('payload').notNull(),
    status: proactiveJobStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** Código de falha/cancelamento (ex.: no_consent, suppressed, meta_failed). */
    failedReason: text('failed_reason'),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    leaseToken: text('lease_token'),
    /** Idempotência de CRIAÇÃO: ex. 'reminder:{apptId}', 'dunning:{lancId}:d3', 'followup:{prontId}'. */
    dedupKey: text('dedup_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => ({
    // Idempotência de criação (um job lógico por origem).
    clinicDedupUniq: uniqueIndex('ai_proactive_jobs_clinic_dedup_uniq').on(t.clinicId, t.dedupKey),
    // Hot path do processor: jobs pendentes vencidos por tipo.
    dueIdx: index('ai_proactive_jobs_due_idx').on(t.status, t.type, t.scheduledFor, t.clinicId),
    // Operação/debug por clínica.
    clinicStatusSchedIdx: index('ai_proactive_jobs_clinic_status_sched_idx').on(
      t.clinicId,
      t.status,
      t.scheduledFor,
    ),
    payloadSizeChk: check(
      'ai_proactive_jobs_payload_size_chk',
      sql`pg_column_size(${t.payload}) <= 65536`,
    ),
    leaseChk: check(
      'ai_proactive_jobs_lease_chk',
      sql`(${t.status} = 'processing' AND ${t.leaseToken} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)
          OR (${t.status} <> 'processing' AND ${t.leaseToken} IS NULL AND ${t.leaseExpiresAt} IS NULL)`,
    ),
  }),
);

export type ProactiveJobRow = typeof aiProactiveJobs.$inferSelect;
export type ProactiveJobInsert = typeof aiProactiveJobs.$inferInsert;
