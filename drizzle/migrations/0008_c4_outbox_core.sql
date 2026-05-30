-- =====================================================================
-- 0008_c4_outbox_core.sql
-- C4 — Outbox + Idempotency + Super Admin Actions
-- Refs: ADR-003 (outbox decision), ADR-007 (RLS patterns), ADR-011 (this impl).
--
-- Categorias (ADR-007 §10):
--   - tenant-scoped     : outbox, idempotency_keys (clinic_id FK)
--   - global protected  : super_admin_actions     (sem clinic_id; is_super_admin() only)
--
-- Contratos congelados (ADR-011):
--   - Append-only por tenant: INSERT+SELECT policies; sem UPDATE/DELETE policy.
--     Worker faz UPDATE via dbAdmin (BYPASSRLS) — pattern de _reserved_slugs/login_attempts.
--   - DLQ metadata (first_failed_at, last_failed_at, error_code) povoada pelo worker.
--   - last_error CAP em 4000 chars (TS serializeError truncate) + CHECK defensivo 8192.
--   - CHECK regex em event_type, error_code, idempotency key format.
--   - response em idempotency_keys com CHECK pg_column_size <= 98304 (cap TS 64KB).
-- =====================================================================

-- 1. ENUM outbox_status -----------------------------------------------
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'processed', 'failed');--> statement-breakpoint

-- 2. CREATE TABLE outbox ----------------------------------------------
CREATE TABLE IF NOT EXISTS "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"error_code" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_started_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"first_failed_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_event_type_format_chk" CHECK ("outbox"."event_type" ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$'),
	CONSTRAINT "outbox_last_error_size_chk"   CHECK ("outbox"."last_error" IS NULL OR octet_length("outbox"."last_error") <= 8192),
	CONSTRAINT "outbox_error_code_format_chk" CHECK ("outbox"."error_code" IS NULL OR "outbox"."error_code" ~ '^[a-z_][a-z0-9_]{0,63}$')
);
--> statement-breakpoint

-- 3. CREATE TABLE idempotency_keys ------------------------------------
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"clinic_id" uuid NOT NULL,
	"user_id" uuid,
	"payload_hash" text NOT NULL,
	"response" jsonb,
	"status_code" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT (now() + interval '24 hours') NOT NULL,
	CONSTRAINT "idempotency_keys_key_format_chk"     CHECK ("idempotency_keys"."key" ~ '^[a-z_][a-z0-9_]*:[a-z_][a-z0-9_]*:[a-f0-9]{8,}$'),
	CONSTRAINT "idempotency_keys_response_size_chk" CHECK ("idempotency_keys"."response" IS NULL OR pg_column_size("idempotency_keys"."response") <= 98304)
);
--> statement-breakpoint

-- 4. CREATE TABLE super_admin_actions ---------------------------------
CREATE TABLE IF NOT EXISTS "super_admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"super_admin_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_clinic_id" uuid,
	"payload" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 5. ALTER super_admin_actions.ip_address text -> inet ----------------
-- Pattern idêntico a login_attempts.ip em 0003: Drizzle não expõe primitivo inet,
-- então declaramos text + ALTER aqui. INET normaliza IPv4/IPv6 nativo.
ALTER TABLE "super_admin_actions"
  ALTER COLUMN "ip_address" TYPE inet
  USING NULLIF("ip_address", '')::inet;
--> statement-breakpoint

-- 6. INDEXES ---------------------------------------------------------
-- outbox
CREATE UNIQUE INDEX IF NOT EXISTS "outbox_event_type_idempotency_key_uniq"
  ON "outbox" USING btree ("event_type", "idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_dispatch_idx"
  ON "outbox" USING btree ("next_attempt_at", "created_at")
  WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_processing_age_idx"
  ON "outbox" USING btree ("processing_started_at")
  WHERE status = 'processing';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_circuit_idx"
  ON "outbox" USING btree ("event_type", "last_failed_at")
  WHERE status = 'failed';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_clinic_created_idx"
  ON "outbox" USING btree ("clinic_id", "created_at");--> statement-breakpoint
-- idempotency_keys
CREATE INDEX IF NOT EXISTS "idempotency_keys_clinic_id_idx"
  ON "idempotency_keys" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_keys_expires_at_idx"
  ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
-- super_admin_actions
CREATE INDEX IF NOT EXISTS "super_admin_actions_super_admin_id_idx"
  ON "super_admin_actions" USING btree ("super_admin_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "super_admin_actions_created_idx"
  ON "super_admin_actions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "super_admin_actions_target_clinic_idx"
  ON "super_admin_actions" USING btree ("target_clinic_id");--> statement-breakpoint

-- 7. RLS outbox -------------------------------------------------------
-- INSERT/SELECT pelo tenant (dual-context: GUC + JWT). UPDATE/DELETE: sem policy,
-- FORCE RLS bloqueia. Worker usa dbAdmin (service_role / BYPASSRLS).
ALTER TABLE "outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outbox" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "outbox_tenant_insert" ON "outbox" FOR INSERT
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint
CREATE POLICY "outbox_tenant_select" ON "outbox" FOR SELECT
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint

-- 8. RLS idempotency_keys --------------------------------------------
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "idempotency_keys" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "idempotency_keys_tenant_access" ON "idempotency_keys" FOR ALL
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

-- 9. RLS super_admin_actions -----------------------------------------
-- Sem clinic_id próprio (D27/D29): pattern de exceção do super_admin.
-- USING + WITH CHECK = is_super_admin() para SELECT/INSERT. UPDATE/DELETE: sem
-- policy + FORCE = bloqueado (append-only).
ALTER TABLE "super_admin_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "super_admin_actions" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "super_admin_actions_super_select" ON "super_admin_actions" FOR SELECT
  USING (is_super_admin());--> statement-breakpoint
CREATE POLICY "super_admin_actions_super_insert" ON "super_admin_actions" FOR INSERT
  WITH CHECK (is_super_admin());--> statement-breakpoint

-- 10. SCHEMA VERSION SNAPSHOT ----------------------------------------
INSERT INTO _schema_version (version) VALUES ('c4-outbox-core')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
