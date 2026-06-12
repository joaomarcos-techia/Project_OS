/**
 * AI Agent context schema (C11) — fundação do agente conversacional.
 *
 * Categoria (ADR-007 §10): 5 tabelas tenant-scoped (clinic_id FK CASCADE):
 *   - ai_conversations  — 1 conversa ATIVA por (clinic, telefone-hash)
 *   - ai_messages       — PARTICIONADA por mês (padrão audit_events/0009);
 *                         particionamento + children vivem na migration 0024
 *   - ai_clinic_config  — parâmetros operacionais por clínica (PK = clinic_id)
 *   - ai_handoff_queue  — fila de atendimento humano
 *   - ai_agent_failures — dead letter de IA (G7): visibilidade de falhas de
 *                         provider/tool/guard sem garimpar log
 * RLS policies, triggers e grants vivem na migration 0024_ai_agent_core.sql.
 *
 * Encryption (ADR-012 reuso): `*_encrypted` = base64(version‖nonce‖ct‖tag) de
 * src/lib/crypto (encryptForTenant). `patient_phone_hash` = HMAC-SHA-256
 * (hashForLookup) — o MESMO hash de patients.telefone_hash e
 * inbound_messages_raw.from_number_hash, permitindo correlação sem plaintext.
 *
 * Colunas além do PlanoAção §11.2 — todas autorizadas nas reviews do founder
 * (ADR-022): clinic_id em ai_messages (multi-tenant inegociável),
 * patient_phone_encrypted (VisãoGeral §6 — sem ela não há como responder),
 * event_id/prompt_version/prompt_hash/prompt_snapshot_encrypted/ai_request_id
 * (saga R2, G8, R6, G10, R7), monthly_budget_usd (R4), ai_agent_failures (G7).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// eslint-disable-next-line boundaries/element-types -- D35: tenantIdRef ref vive no schema tenancy por design (mesma exceção de patient/scheduling/financial/messaging schema).
import { tenantIdRef } from '@/contexts/tenancy';
import { timestampsPattern, uuidPk } from '@/lib/db/types';

// Side-effect: registra ai_agent.* no catálogo do outbox no module load.
import './events';

// --- enums -------------------------------------------------------------------

export const aiConversationStatus = pgEnum('ai_conversation_status', [
  'active',
  'handoff',
  'closed',
  'abandoned',
]);

export const aiMessageDirection = pgEnum('ai_message_direction', ['in', 'out']);

// Estágio onde a falha ocorreu no turno (dead letter G7).
export const aiFailureStage = pgEnum('ai_failure_stage', [
  'provider',
  'tool_invalid',
  'tool_unknown',
  'tool_output_invalid',
  'guard',
  'send',
]);

// --- ai_conversations ---------------------------------------------------------

export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    // Identificado por hash de telefone — pode ser null (contato não cadastrado).
    // SEM FK cross-context para patients (padrão lancamentos.patient_id).
    patientId: uuid('patient_id'),
    patientPhoneHash: text('patient_phone_hash').notNull(),
    // Telefone de RESPOSTA cifrado per-tenant (VisãoGeral §6) — único lugar de
    // onde o agente recupera o número para sendText.
    patientPhoneEncrypted: text('patient_phone_encrypted').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().default(sql`now()`),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    status: aiConversationStatus('status').notNull().default('active'),
    // Intent corrente — texto livre em C11 (intents reais nascem em C12).
    intentAtual: text('intent_atual'),
    // R3: MAX_FALLBACKS consecutivos → handoff automático.
    fallbackCount: integer('fallback_count').notNull().default(0),
    // Memória 30d hot (§11.12) — purge por retention job (C16).
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdx: index('ai_conversations_clinic_id_idx').on(t.clinicId),
    // 1 conversa ATIVA por contato por clínica — o upsert do handler é
    // idempotente por esta unique parcial.
    oneActivePerContact: uniqueIndex('ai_conversations_clinic_phone_active_uniq')
      .on(t.clinicId, t.patientPhoneHash)
      .where(sql`status = 'active'`),
    // Lookup geral por contato (VisãoGeral §8.2).
    clinicPhoneIdx: index('ai_conversations_clinic_phone_idx').on(
      t.clinicId,
      t.patientPhoneHash,
    ),
  }),
);

// --- ai_messages (PARTICIONADA por mês — DDL real na migration 0024) ----------

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: uuid('id').notNull().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    direction: aiMessageDirection('direction').notNull(),
    contentEncrypted: text('content_encrypted').notNull(),
    intent: text('intent'),
    // Tool calls emitidas pelo LLM neste turno (nomes + args já validados/sanitizados).
    toolCalls: jsonb('tool_calls'),
    tokensInput: integer('tokens_input'),
    tokensOutput: integer('tokens_output'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    model: text('model'),
    latencyMs: integer('latency_ms'),
    // Checkpoint da saga (R2): eventId do outbox que gerou este turno. Dedup de
    // re-entrada é SELECT-before-INSERT (unique em particionada exigiria a
    // partition key — coberto pelo single-execution do worker).
    eventId: uuid('event_id'),
    // G8/R6: qual prompt gerou a resposta (versão manual + hash do template).
    promptVersion: text('prompt_version'),
    promptHash: text('prompt_hash'),
    // G10/R1: replay determinístico — gzip(JSON do prompt final) cifrado
    // per-tenant. Gravado conforme AI_SNAPSHOT_MODE (full/sample/off).
    promptSnapshotEncrypted: text('prompt_snapshot_encrypted'),
    // R7: trace de IA — correlaciona métricas/failures/out-row do mesmo turno.
    aiRequestId: uuid('ai_request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
  },
  (t) => ({
    // Partition key OBRIGA participar da PK (PG range partitioning).
    pk: primaryKey({ columns: [t.id, t.createdAt] }),
    clinicConvIdx: index('ai_messages_clinic_conv_created_idx').on(
      t.clinicId,
      t.conversationId,
      t.createdAt,
    ),
    eventDirIdx: index('ai_messages_event_dir_idx').on(t.eventId, t.direction),
  }),
);

// --- ai_clinic_config ----------------------------------------------------------

export const aiClinicConfig = pgTable(
  'ai_clinic_config',
  {
    // PK = clinic_id (1:1 com clinics). tenantIdRef() já aplica FK CASCADE.
    clinicId: tenantIdRef().primaryKey(),
    // Horários de atendimento (estrutura livre p/ a tool provide_clinic_info).
    workingHours: jsonb('working_hours'),
    especialidades: text('especialidades').array(),
    canScheduleAnonymous: boolean('can_schedule_anonymous').notNull().default(false),
    maxDaysAhead: integer('max_days_ahead').notNull().default(30),
    messageTemplateOverrides: jsonb('message_template_overrides'),
    // R4: orçamento mensal de IA por clínica (USD). NULL → env.AI_MONTHLY_COST_LIMIT_USD.
    monthlyBudgetUsd: numeric('monthly_budget_usd', { precision: 10, scale: 2 }),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdx: index('ai_clinic_config_clinic_id_idx').on(t.clinicId),
  }),
);

// --- ai_handoff_queue -----------------------------------------------------------

export const aiHandoffQueue = pgTable(
  'ai_handoff_queue',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    // Atendente (profiles.user_id) — SEM FK cross-context (identity).
    assignedTo: uuid('assigned_to'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdx: index('ai_handoff_queue_clinic_id_idx').on(t.clinicId),
    // Fila aberta por clínica (UI C15) + dedup de handoff aberto por conversa.
    openByConversation: uniqueIndex('ai_handoff_queue_conv_open_uniq')
      .on(t.conversationId)
      .where(sql`resolved_at IS NULL`),
    openIdx: index('ai_handoff_queue_clinic_open_idx')
      .on(t.clinicId)
      .where(sql`resolved_at IS NULL`),
  }),
);

// --- ai_agent_failures (G7 — dead letter de IA) ----------------------------------

export const aiAgentFailures = pgTable(
  'ai_agent_failures',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    conversationId: uuid('conversation_id'),
    eventId: uuid('event_id').notNull(),
    aiRequestId: uuid('ai_request_id'),
    stage: aiFailureStage('stage').notNull(),
    errorCode: text('error_code'),
    // Cap 4000 aplicado em TS via serializeError (mesmo contrato do outbox).
    errorMessage: text('error_message'),
    model: text('model'),
    toolName: text('tool_name'),
    // SÓ escrito via sanitizeAiFailurePayload (R8 — whitelist; nunca PII/conteúdo).
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    clinicIdx: index('ai_agent_failures_clinic_id_idx').on(t.clinicId),
    clinicCreatedIdx: index('ai_agent_failures_clinic_created_idx').on(t.clinicId, t.createdAt),
  }),
);

// --- inferred row types -----------------------------------------------------------

export type AiConversationRow = typeof aiConversations.$inferSelect;
export type AiMessageRow = typeof aiMessages.$inferSelect;
export type AiClinicConfigRow = typeof aiClinicConfig.$inferSelect;
export type AiHandoffQueueRow = typeof aiHandoffQueue.$inferSelect;
export type AiAgentFailureRow = typeof aiAgentFailures.$inferSelect;
