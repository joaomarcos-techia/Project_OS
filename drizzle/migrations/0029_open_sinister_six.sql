CREATE TABLE IF NOT EXISTS "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cron_heartbeats" (
	"job" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"detail" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_announcements_active_idx" ON "platform_announcements" USING btree ("created_at") WHERE "platform_announcements"."active";--> statement-breakpoint

-- =====================================================================
-- hand-edit (append) — Platform globals: RLS + GRANTs + triggers.
-- Categoria (ADR-007 §10): global protected (sem clinic_id). drizzle-kit gera só
-- as tabelas/índices; RLS/grants/triggers são mantidos à mão (padrão 0026/0028).
--
--   platform_settings / platform_announcements : SELECT liberado a authenticated
--     (workers/app/shell leem); escrita SOMENTE service_role (sem write policy →
--     FORCE RLS bloqueia qualquer role não-BYPASSRLS).
--   cron_heartbeats : ops-only — sem policy de SELECT (painel lê via dbAdmin).
-- =====================================================================

-- 1. Triggers updated_at (set_updated_at() instalada em 0001) ----------
CREATE TRIGGER trg_platform_settings_updated_at
  BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_cron_heartbeats_updated_at
  BEFORE UPDATE ON cron_heartbeats
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- 2. platform_settings: read-authenticated, write service_role ---------
ALTER TABLE "platform_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_settings" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "platform_settings_read" ON "platform_settings" FOR SELECT
  TO authenticated USING (true);--> statement-breakpoint
GRANT SELECT ON platform_settings TO authenticated, service_role;--> statement-breakpoint
GRANT INSERT, UPDATE ON platform_settings TO service_role;--> statement-breakpoint

-- 3. cron_heartbeats: ops-only (sem SELECT policy; só service_role) -----
ALTER TABLE "cron_heartbeats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cron_heartbeats" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON cron_heartbeats TO service_role;--> statement-breakpoint

-- 4. platform_announcements: read-authenticated, write service_role -----
ALTER TABLE "platform_announcements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_announcements" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "platform_announcements_read" ON "platform_announcements" FOR SELECT
  TO authenticated USING (true);--> statement-breakpoint
GRANT SELECT ON platform_announcements TO authenticated, service_role;--> statement-breakpoint
GRANT INSERT, UPDATE ON platform_announcements TO service_role;--> statement-breakpoint

-- 5. SCHEMA VERSION SNAPSHOT -------------------------------------------
INSERT INTO _schema_version (version) VALUES ('platform-globals-core')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint