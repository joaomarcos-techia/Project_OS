CREATE TYPE "public"."proactive_job_status" AS ENUM('pending', 'sent', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."proactive_job_type" AS ENUM('reminder', 'dunning', 'followup');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_proactive_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"type" "proactive_job_type" NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "proactive_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failed_reason" text,
	"last_attempt_at" timestamp with time zone,
	"dedup_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "ai_proactive_jobs_payload_size_chk" CHECK (pg_column_size("ai_proactive_jobs"."payload") <= 65536)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_proactive_jobs" ADD CONSTRAINT "ai_proactive_jobs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_proactive_jobs_clinic_dedup_uniq" ON "ai_proactive_jobs" USING btree ("clinic_id","dedup_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_proactive_jobs_due_idx" ON "ai_proactive_jobs" USING btree ("type","scheduled_for") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_proactive_jobs_clinic_status_sched_idx" ON "ai_proactive_jobs" USING btree ("clinic_id","status","scheduled_for");--> statement-breakpoint

-- =====================================================================
-- C14 — RLS + GRANT hardening (não modelados pelo drizzle-kit).
-- Refs: ADR-007 (RLS), padrão 0008_c4_outbox_core (dual-context) + 0021 (revoke).
--
-- Acessos: o handler de followup (worker withTenant) INSERE; o cron enqueue/
-- processor (withTenant por clínica) INSERE/SELECIONA/ATUALIZA — todos sob role
-- `authenticated`, então precisam de policy INSERT/SELECT/UPDATE (dual-context:
-- GUC app.current_clinic OU JWT). O scan cross-tenant do processor roda em
-- dbAdmin (BYPASSRLS), sem policy. Jobs NUNCA são deletados pelo app (trim em
-- C16 via service_role) → REVOKE DELETE de authenticated.
-- =====================================================================
ALTER TABLE "ai_proactive_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_proactive_jobs" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ai_proactive_jobs_tenant_insert" ON "ai_proactive_jobs" FOR INSERT
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint
CREATE POLICY "ai_proactive_jobs_tenant_select" ON "ai_proactive_jobs" FOR SELECT
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint
CREATE POLICY "ai_proactive_jobs_tenant_update" ON "ai_proactive_jobs" FOR UPDATE
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

-- Supabase concede ALL a authenticated/anon em tabelas novas via DEFAULT
-- PRIVILEGES; jobs são não-deletáveis pelo app (mesma postura de lancamentos/0021).
REVOKE DELETE ON "ai_proactive_jobs" FROM authenticated;--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('c14-proactive-jobs')
ON CONFLICT (version) DO NOTHING;