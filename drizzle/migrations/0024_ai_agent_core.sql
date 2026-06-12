-- =====================================================================
-- 0024_ai_agent_core.sql
-- C11 — AI Agent Base (Gemini + Tools + Validação). Refs: ADR-022 (+ADR-007,
-- ADR-011, ADR-012, ADR-020).
--
-- 5 tabelas tenant-scoped: ai_conversations, ai_messages (PARTICIONADA por
-- mês, padrão audit_events/0009), ai_clinic_config, ai_handoff_queue,
-- ai_agent_failures (dead letter de IA — review G7).
-- + coluna aditiva em inbound_messages_raw (from_number_encrypted — sem ela o
--   agente não tem como responder; emenda aditiva ao ADR-020, precedente
--   ADR-021) e GRANT UPDATE column-level (processed_at) para o consumidor C11.
--
-- Idempotente (IF NOT EXISTS / DO-guards / DROP POLICY IF EXISTS) — aplicável
-- via `pnpm db:migrate:dev` OU manualmente no Supabase SQL Editor.
-- ai_messages: SQL gerado pelo drizzle-kit foi REESCRITO à mão como
-- PARTITION BY RANGE (created_at) — Drizzle não modela partitions (mesma
-- prática de audit_events). PK composta (id, created_at).
-- =====================================================================

-- --- enums -------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "public"."ai_conversation_status" AS ENUM('active', 'handoff', 'closed', 'abandoned');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."ai_failure_stage" AS ENUM('provider', 'tool_invalid', 'tool_unknown', 'tool_output_invalid', 'guard', 'send');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."ai_message_direction" AS ENUM('in', 'out');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- --- tables --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ai_agent_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"conversation_id" uuid,
	"event_id" uuid NOT NULL,
	"ai_request_id" uuid,
	"stage" "ai_failure_stage" NOT NULL,
	"error_code" text,
	"error_message" text,
	"model" text,
	"tool_name" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_clinic_config" (
	"clinic_id" uuid PRIMARY KEY NOT NULL,
	"working_hours" jsonb,
	"especialidades" text[],
	"can_schedule_anonymous" boolean DEFAULT false NOT NULL,
	"max_days_ahead" integer DEFAULT 30 NOT NULL,
	"message_template_overrides" jsonb,
	"monthly_budget_usd" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid,
	"patient_phone_hash" text NOT NULL,
	"patient_phone_encrypted" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "ai_conversation_status" DEFAULT 'active' NOT NULL,
	"intent_atual" text,
	"fallback_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_handoff_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"assigned_to" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- --- ai_messages: PARENT particionada por mês (REESCRITA à mão — ADR-022) ----
-- PK composta (id, created_at): partition key OBRIGA participar da PK em PG
-- range partitioning. UNIQUE adicional não é possível sem a partition key —
-- dedup de turno (event_id) é SELECT-before-INSERT sob single-execution do
-- worker (TX1 reserve + advisory lock + janitor 5min).
CREATE TABLE IF NOT EXISTS "ai_messages" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "ai_message_direction" NOT NULL,
	"content_encrypted" text NOT NULL,
	"intent" text,
	"tool_calls" jsonb,
	"tokens_input" integer,
	"tokens_output" integer,
	"cost_usd" numeric(10, 6),
	"model" text,
	"latency_ms" integer,
	"event_id" uuid,
	"prompt_version" text,
	"prompt_hash" text,
	"prompt_snapshot_encrypted" text,
	"ai_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL,
	CONSTRAINT "ai_messages_id_created_at_pk" PRIMARY KEY("id","created_at")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint

-- --- coluna aditiva C10 (telefone de resposta cifrado per-tenant) -------------
ALTER TABLE "inbound_messages_raw" ADD COLUMN IF NOT EXISTS "from_number_encrypted" text;--> statement-breakpoint

-- --- foreign keys ---------------------------------------------------------------
DO $$ BEGIN
 ALTER TABLE "ai_agent_failures" ADD CONSTRAINT "ai_agent_failures_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_clinic_config" ADD CONSTRAINT "ai_clinic_config_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_handoff_queue" ADD CONSTRAINT "ai_handoff_queue_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_handoff_queue" ADD CONSTRAINT "ai_handoff_queue_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- FKs da particionada (PG 12+: FK FROM partitioned table propaga p/ children).
-- Manuais (Drizzle não viu a tabela como particionada).
DO $$ BEGIN
 ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- --- indexes ----------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "ai_agent_failures_clinic_id_idx" ON "ai_agent_failures" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_failures_clinic_created_idx" ON "ai_agent_failures" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_clinic_config_clinic_id_idx" ON "ai_clinic_config" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_conversations_clinic_id_idx" ON "ai_conversations" USING btree ("clinic_id");--> statement-breakpoint
-- 1 conversa ATIVA por (clinic, telefone) — upsert do handler é idempotente
-- por esta unique parcial.
CREATE UNIQUE INDEX IF NOT EXISTS "ai_conversations_clinic_phone_active_uniq" ON "ai_conversations" USING btree ("clinic_id","patient_phone_hash") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_conversations_clinic_phone_idx" ON "ai_conversations" USING btree ("clinic_id","patient_phone_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_handoff_queue_clinic_id_idx" ON "ai_handoff_queue" USING btree ("clinic_id");--> statement-breakpoint
-- Dedup de handoff ABERTO por conversa + fila aberta por clínica (UI C15).
CREATE UNIQUE INDEX IF NOT EXISTS "ai_handoff_queue_conv_open_uniq" ON "ai_handoff_queue" USING btree ("conversation_id") WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_handoff_queue_clinic_open_idx" ON "ai_handoff_queue" USING btree ("clinic_id") WHERE resolved_at IS NULL;--> statement-breakpoint
-- Indexes na PARENT particionada (propagam para children).
CREATE INDEX IF NOT EXISTS "ai_messages_clinic_conv_created_idx" ON "ai_messages" USING btree ("clinic_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_messages_event_dir_idx" ON "ai_messages" USING btree ("event_id","direction");--> statement-breakpoint

-- --- monthly child partitions de ai_messages (2026-06 → 2027-05) -------------
-- Cron /api/cron/audit-partitions provisiona os meses seguintes (generalizado
-- em C11 p/ ai_messages); a default absorve overflow (healthcheck alerta).
CREATE TABLE IF NOT EXISTS "ai_messages_2026_06" PARTITION OF "ai_messages" FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_messages_2026_07" PARTITION OF "ai_messages" FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_messages_2026_08" PARTITION OF "ai_messages" FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_messages_2026_09" PARTITION OF "ai_messages" FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_messages_2026_10" PARTITION OF "ai_messages" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_messages_2026_11" PARTITION OF "ai_messages" FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_messages_2026_12" PARTITION OF "ai_messages" FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_messages_2027_01" PARTITION OF "ai_messages" FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_messages_2027_02" PARTITION OF "ai_messages" FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_messages_2027_03" PARTITION OF "ai_messages" FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_messages_2027_04" PARTITION OF "ai_messages" FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_messages_2027_05" PARTITION OF "ai_messages" FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_messages_default" PARTITION OF "ai_messages" DEFAULT;--> statement-breakpoint

-- --- updated_at triggers -----------------------------------------------------------
DROP TRIGGER IF EXISTS trg_ai_conversations_updated_at ON ai_conversations;--> statement-breakpoint
CREATE TRIGGER trg_ai_conversations_updated_at
  BEFORE UPDATE ON ai_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_ai_clinic_config_updated_at ON ai_clinic_config;--> statement-breakpoint
CREATE TRIGGER trg_ai_clinic_config_updated_at
  BEFORE UPDATE ON ai_clinic_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_ai_handoff_queue_updated_at ON ai_handoff_queue;--> statement-breakpoint
CREATE TRIGGER trg_ai_handoff_queue_updated_at
  BEFORE UPDATE ON ai_handoff_queue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- --- RLS: 5 tenant-scoped (FORCE + defaultTenantPolicy) — ADR-007 inv. #1 ----
-- Na particionada (ai_messages), policy na PARENT propaga p/ children (PG 11+).
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_conversations FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS ai_conversations_tenant_access ON ai_conversations;--> statement-breakpoint
CREATE POLICY ai_conversations_tenant_access ON ai_conversations FOR ALL
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  )
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_messages FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS ai_messages_tenant_access ON ai_messages;--> statement-breakpoint
CREATE POLICY ai_messages_tenant_access ON ai_messages FOR ALL
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  )
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE ai_clinic_config ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_clinic_config FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS ai_clinic_config_tenant_access ON ai_clinic_config;--> statement-breakpoint
CREATE POLICY ai_clinic_config_tenant_access ON ai_clinic_config FOR ALL
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  )
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE ai_handoff_queue ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_handoff_queue FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS ai_handoff_queue_tenant_access ON ai_handoff_queue;--> statement-breakpoint
CREATE POLICY ai_handoff_queue_tenant_access ON ai_handoff_queue FOR ALL
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  )
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE ai_agent_failures ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_agent_failures FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS ai_agent_failures_tenant_access ON ai_agent_failures;--> statement-breakpoint
CREATE POLICY ai_agent_failures_tenant_access ON ai_agent_failures FOR ALL
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  )
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint

-- --- GRANTS (REVOKE ALL herdado, depois GRANT mínimo — padrão 0022) ----------
-- ai_conversations: handler cria/atualiza (status, fallback_count, last_message_at).
REVOKE ALL ON ai_conversations FROM authenticated;--> statement-breakpoint
REVOKE ALL ON ai_conversations FROM anon;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ai_conversations TO authenticated;--> statement-breakpoint
GRANT ALL ON ai_conversations TO service_role;--> statement-breakpoint

-- ai_messages: append-only pelo app (SELECT + INSERT). UPDATE/DELETE revogados.
-- GRANT na PARENT propaga para children (PG 11+).
REVOKE ALL ON ai_messages FROM authenticated;--> statement-breakpoint
REVOKE ALL ON ai_messages FROM anon;--> statement-breakpoint
GRANT SELECT, INSERT ON ai_messages TO authenticated;--> statement-breakpoint
GRANT ALL ON ai_messages TO service_role;--> statement-breakpoint

-- ai_clinic_config: handler só LÊ. Escrita = service_role (seed/onboarding;
-- UI de gestão entra em C15 com grant próprio).
REVOKE ALL ON ai_clinic_config FROM authenticated;--> statement-breakpoint
REVOKE ALL ON ai_clinic_config FROM anon;--> statement-breakpoint
GRANT SELECT ON ai_clinic_config TO authenticated;--> statement-breakpoint
GRANT ALL ON ai_clinic_config TO service_role;--> statement-breakpoint

-- ai_handoff_queue: tool insere; resolução/atribuição (C15) atualiza. Sem DELETE.
REVOKE ALL ON ai_handoff_queue FROM authenticated;--> statement-breakpoint
REVOKE ALL ON ai_handoff_queue FROM anon;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ai_handoff_queue TO authenticated;--> statement-breakpoint
GRANT ALL ON ai_handoff_queue TO service_role;--> statement-breakpoint

-- ai_agent_failures: append-only (SELECT + INSERT).
REVOKE ALL ON ai_agent_failures FROM authenticated;--> statement-breakpoint
REVOKE ALL ON ai_agent_failures FROM anon;--> statement-breakpoint
GRANT SELECT, INSERT ON ai_agent_failures TO authenticated;--> statement-breakpoint
GRANT ALL ON ai_agent_failures TO service_role;--> statement-breakpoint

-- inbound_messages_raw era append-only (0022). O consumidor C11 marca
-- processed_at — GRANT UPDATE column-level APENAS nessa coluna.
GRANT UPDATE ("processed_at") ON inbound_messages_raw TO authenticated;--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('c11-ai-agent-core')
ON CONFLICT (version) DO NOTHING;
