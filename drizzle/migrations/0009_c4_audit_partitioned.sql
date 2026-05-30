-- =====================================================================
-- 0009_c4_audit_partitioned.sql
-- C4 — audit_events particionada por mês.
-- Refs: ADR-003, ADR-007, ADR-011.
--
-- Pattern (ADR-011):
--   - PARTITION BY RANGE (created_at). PK composta (id, created_at) — partition
--     key OBRIGA participar da PK em PG range partitioning.
--   - RLS ENABLE + FORCE na PARENT — propaga para todas as child partitions em PG 11+.
--   - Append-only por tenant: INSERT + SELECT policies; sem UPDATE/DELETE.
--   - 12 child partitions mensais inline (2026-05 → 2027-04). MVP cobre 1 ano.
--   - Default partition catch-all (audit_events_default) absorve INSERTs com
--     created_at fora dos ranges (clock skew / esquecimento operacional). Cron
--     mensal de C13/C16 vai criar próxima partição + alertar quando default
--     cresce.
--   - ip_address text -> inet (Drizzle não expõe primitivo inet).
--   - before/after jsonb sanitizado em TS via sanitizePayload antes do INSERT.
--
-- Retention (ADR-011 + runbook c4-validation):
--   90d hot   : queries diretas
--   1y warm   : queryable mas em partition antiga
--   archive   : DETACH PARTITION + pg_dump + DROP (manual MVP, automation C16)
-- =====================================================================

-- 1. PARENT TABLE (PARTITION BY RANGE) -------------------------------
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" uuid NOT NULL DEFAULT gen_random_uuid(),
	"clinic_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip_address" text,
	"user_agent" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
--> statement-breakpoint

-- 2. ALTER ip_address text -> inet -----------------------------------
-- ALTER ANTES de criar partitions; PG propaga schema mudanças para children
-- automaticamente. Pattern idêntico a login_attempts em 0003.
ALTER TABLE "audit_events"
  ALTER COLUMN "ip_address" TYPE inet
  USING NULLIF("ip_address", '')::inet;
--> statement-breakpoint

-- 3. RLS na PARENT (propaga para children, PG 11+) -------------------
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_events" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "audit_events_tenant_insert" ON "audit_events" FOR INSERT
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint

CREATE POLICY "audit_events_tenant_select" ON "audit_events" FOR SELECT
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint
-- Sem policy de UPDATE/DELETE: FORCE bloqueia. Audit é IMUTÁVEL.

-- 4. INDEXES na PARENT (propagam para children) ----------------------
CREATE INDEX IF NOT EXISTS "audit_events_clinic_created_idx"
  ON "audit_events" USING btree ("clinic_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_resource_idx"
  ON "audit_events" USING btree ("resource_type", "resource_id");--> statement-breakpoint

-- 5. MONTHLY CHILD PARTITIONS (2026-05 → 2027-04) --------------------
-- Cada CREATE TABLE PARTITION OF é um statement próprio (drizzle-kit requirement).
CREATE TABLE IF NOT EXISTS "audit_events_2026_05" PARTITION OF "audit_events" FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events_2026_06" PARTITION OF "audit_events" FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events_2026_07" PARTITION OF "audit_events" FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events_2026_08" PARTITION OF "audit_events" FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events_2026_09" PARTITION OF "audit_events" FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events_2026_10" PARTITION OF "audit_events" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events_2026_11" PARTITION OF "audit_events" FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events_2026_12" PARTITION OF "audit_events" FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events_2027_01" PARTITION OF "audit_events" FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events_2027_02" PARTITION OF "audit_events" FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events_2027_03" PARTITION OF "audit_events" FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events_2027_04" PARTITION OF "audit_events" FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');--> statement-breakpoint

-- 6. DEFAULT PARTITION (catch-all) -----------------------------------
-- Defensiva: INSERT com created_at fora dos ranges (clock skew, esquecimento de
-- criar partição) cai aqui em vez de levantar erro. Healthcheck alerta quando
-- count(*) > 0.
CREATE TABLE IF NOT EXISTS "audit_events_default" PARTITION OF "audit_events" DEFAULT;--> statement-breakpoint

-- 7. SCHEMA VERSION SNAPSHOT -----------------------------------------
INSERT INTO _schema_version (version) VALUES ('c4-audit-partitioned')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
