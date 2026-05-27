-- =====================================================================
-- 0001_tenancy_foundation.sql
-- C2 — Multi-Tenant Core + RLS Foundation
-- Atomic migration: extension + functions + tables + indexes + RLS + triggers + seed.
-- See docs/adr/007-rls-implementation-patterns.md for the design contract.
--
-- Categories (D29):
--   - tenant-scoped     : clinic_units                  (RLS FORCE + defaultTenantPolicy)
--   - global protected  : clinics, _reserved_slugs      (RLS FORCE + custom policies)
--   - operational meta  : _schema_version (NO RLS, D20) — pre-existing from C1
-- =====================================================================

-- 1. EXTENSION ----------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint

-- 2. SQL HELPER FUNCTIONS (D33) ----------------------------------------
-- Single source for JWT claim names. STABLE so the planner can inline these
-- safely. coalesce blindar contra auth.jwt() NULL (invariante #7 do ADR-007).
CREATE OR REPLACE FUNCTION current_clinic_id() RETURNS text AS $$
  SELECT coalesce(auth.jwt() ->> 'clinic_id', '')
$$ LANGUAGE sql STABLE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION current_platform_role() RETURNS text AS $$
  SELECT coalesce(auth.jwt() ->> 'role', '')
$$ LANGUAGE sql STABLE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean AS $$
  SELECT current_platform_role() = 'super_admin'
$$ LANGUAGE sql STABLE;--> statement-breakpoint

-- Generic trigger fn used by every table with updated_at.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint

-- check_clinic_slug references _reserved_slugs which is created below.
-- Function body executes at INSERT/UPDATE time, not at CREATE FUNCTION time,
-- so forward reference is fine. Trigger that calls this is attached below.
CREATE OR REPLACE FUNCTION check_clinic_slug() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM _reserved_slugs WHERE slug = NEW.slug) THEN
    RAISE EXCEPTION 'Slug reservado: %', NEW.slug
      USING ERRCODE = '23514', HINT = 'Choose a different subdomain.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint

-- 3. TYPES + TABLES + FK + INDEX (drizzle-kit generated, preserved verbatim)
CREATE TYPE "public"."clinic_status" AS ENUM('trial', 'active', 'suspended_readonly', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clinic_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"endereco" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clinics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"nome" text NOT NULL,
	"cnpj" text,
	"cnes" text,
	"status" "clinic_status" DEFAULT 'trial' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "clinics_slug_unique" UNIQUE("slug"),
	CONSTRAINT "clinics_slug_format" CHECK ("clinics"."slug" ~ '^[a-z0-9-]{3,30}$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "_reserved_slugs" (
	"slug" text PRIMARY KEY NOT NULL,
	"reason" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clinic_units" ADD CONSTRAINT "clinic_units_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clinic_units_clinic_id_idx" ON "clinic_units" USING btree ("clinic_id");--> statement-breakpoint

-- 4. TRIGGERS ----------------------------------------------------------
CREATE TRIGGER trg_clinics_updated_at      BEFORE UPDATE ON clinics      FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_clinic_units_updated_at BEFORE UPDATE ON clinic_units FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_check_clinic_slug
  BEFORE INSERT OR UPDATE OF slug ON clinics
  FOR EACH ROW EXECUTE FUNCTION check_clinic_slug();--> statement-breakpoint

-- 5. RLS POLICIES ------------------------------------------------------
-- clinics: id IS the tenant. D31: in C2, SELECT is tenant-aware (dual-context),
-- INSERT/UPDATE/DELETE are super_admin only. Tenant-facing edits arrive in C3
-- via Server Actions that route through dbAdmin + audit (C4). 4 policies, none
-- from helper (tenantColumn is `id`, not `clinic_id`, and mutations are admin-only).
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clinics FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY clinics_tenant_select ON clinics FOR SELECT
  USING (
    id::text = current_setting('app.current_clinic', true)
    OR id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint
CREATE POLICY clinics_superadmin_insert ON clinics FOR INSERT
  WITH CHECK (is_super_admin());--> statement-breakpoint
CREATE POLICY clinics_superadmin_update ON clinics FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());--> statement-breakpoint
CREATE POLICY clinics_superadmin_delete ON clinics FOR DELETE
  USING (is_super_admin());--> statement-breakpoint

-- clinic_units: defaultTenantPolicy (FOR ALL via clinic_id)
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE clinic_units ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clinic_units FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY clinic_units_tenant_access ON clinic_units FOR ALL
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

-- _reserved_slugs: global-protected (D29 category #2). D34: read-only for
-- authenticated (needed by signup validation); mutations EXCLUSIVELY via
-- dbAdmin (no write policy means FORCE RLS blocks INSERT/UPDATE/DELETE
-- by default for every non-bypass role). Less surface, fewer ways to misconfigure.
ALTER TABLE _reserved_slugs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE _reserved_slugs FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY reserved_slugs_read ON _reserved_slugs FOR SELECT TO authenticated USING (true);--> statement-breakpoint

-- _schema_version: PERMANECE SEM RLS (D20). Operational metadata, no
-- sensitive data, access already restricted by credential.

-- 6. SEED reserved slugs (D16) ----------------------------------------
INSERT INTO _reserved_slugs (slug, reason) VALUES
  ('app','platform reserved'),('admin','platform reserved'),('api','platform reserved'),
  ('www','platform reserved'),('mail','platform reserved'),('status','platform reserved'),
  ('qoro','brand reserved'),('support','platform reserved'),('help','platform reserved'),
  ('docs','platform reserved'),('blog','platform reserved'),('cdn','platform reserved'),
  ('static','platform reserved'),('media','platform reserved'),('public','platform reserved'),
  ('private','platform reserved'),('auth','auth route reserved'),('login','auth route reserved'),
  ('signup','auth route reserved'),('callback','auth route reserved'),('oauth','auth route reserved'),
  ('webhook','platform reserved')
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 7. SCHEMA VERSION SNAPSHOT ------------------------------------------
INSERT INTO _schema_version (version) VALUES ('c2-multi-tenant-rls')
ON CONFLICT (version) DO NOTHING;
