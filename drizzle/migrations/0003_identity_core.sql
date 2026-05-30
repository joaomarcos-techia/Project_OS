-- =====================================================================
-- 0003_identity_core.sql
-- C3 — Identity + Auth + Custom Claims + RBAC
-- Atomic migration: tables + FK auth.users + RLS + triggers + functions + view + seeds.
-- See docs/adr/008-identity-patterns.md, 009-claims-drift-mitigation.md,
-- 010-security-definer-patterns.md para padrões e justificativas.
--
-- Categorias (ADR-007 §10):
--   - tenant-scoped     : profiles, user_permission_overrides
--   - global protected  : permissions, role_permissions, login_attempts
-- =====================================================================

-- 1. ENUM + TABELAS (drizzle-kit generated; preserved verbatim) -------
CREATE TYPE "public"."role_enum" AS ENUM('gestor', 'doctor', 'attendant', 'financial', 'owner', 'super_admin');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hash" text NOT NULL,
	"ip" text,
	"success" boolean NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permissions" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid,
	"nome" text NOT NULL,
	"telefone" text,
	"role" "role_enum" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"mfa_enrolled_at" timestamp with time zone,
	"claims_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "profiles_role_clinic_check" CHECK (("profiles"."role" = 'super_admin' AND "profiles"."clinic_id" IS NULL) OR ("profiles"."role" <> 'super_admin' AND "profiles"."clinic_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_permissions" (
	"role" "role_enum" NOT NULL,
	"permission_code" text NOT NULL,
	CONSTRAINT "role_permissions_role_permission_code_pk" PRIMARY KEY("role","permission_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_permission_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"permission_code" text NOT NULL,
	"granted" boolean NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_permission_overrides_user_perm_unique" UNIQUE("user_id","permission_code")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profiles" ADD CONSTRAINT "profiles_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permissions"("code") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permissions"("code") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_granted_by_profiles_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_attempts_email_hash_attempted_at_idx" ON "login_attempts" USING btree ("email_hash","attempted_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_attempts_ip_attempted_at_idx" ON "login_attempts" USING btree ("ip","attempted_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profiles_clinic_id_idx" ON "profiles" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profiles_role_idx" ON "profiles" USING btree ("role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_permission_overrides_clinic_id_idx" ON "user_permission_overrides" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_permission_overrides_user_id_idx" ON "user_permission_overrides" USING btree ("user_id");--> statement-breakpoint

-- 2. PROFILES.ID FK PARA auth.users(id) -------------------------------
-- Drizzle não conhece o schema `auth` (managed pelo Supabase). FK declarada aqui.
-- ON DELETE CASCADE: se o user é hard-deleted do auth.users, o profile vai junto.
DO $$ BEGIN
 ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_auth_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- 3. login_attempts.ip TEXT → INET (D35) ------------------------------
-- Drizzle não tem primitivo `inet` exposto; declaramos text no schema TS e
-- convertemos aqui. Migração de tipo é idempotente via USING.
ALTER TABLE "login_attempts" ALTER COLUMN "ip" TYPE inet USING ("ip"::inet);--> statement-breakpoint

-- 4. TRIGGERS updated_at ----------------------------------------------
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_user_permission_overrides_updated_at
  BEFORE UPDATE ON user_permission_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- 5. TRIGGERS de claims_version (D5 — drift detection no Hook+middleware) ---
-- Trigger A: BEFORE UPDATE em profiles, bumpa claims_version quando role,
-- clinic_id, ou ativo mudam. NÃO dispara em mudanças de nome/telefone/etc.
CREATE OR REPLACE FUNCTION bump_profile_claims_version() RETURNS trigger AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role
     OR OLD.clinic_id IS DISTINCT FROM NEW.clinic_id
     OR OLD.ativo IS DISTINCT FROM NEW.ativo THEN
    NEW.claims_version := OLD.claims_version + 1;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER trg_profiles_bump_claims_version
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION bump_profile_claims_version();--> statement-breakpoint

-- Trigger B: AFTER INS/UPD/DEL em user_permission_overrides bumpa
-- claims_version do user_id afetado. Não loopa: trigger A só dispara em
-- role/clinic_id/ativo.
CREATE OR REPLACE FUNCTION bump_overrides_claims_version() RETURNS trigger AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := COALESCE(NEW.user_id, OLD.user_id);
  UPDATE profiles SET claims_version = claims_version + 1 WHERE id = v_user_id;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER trg_overrides_bump_claims_version
  AFTER INSERT OR UPDATE OR DELETE ON user_permission_overrides
  FOR EACH ROW EXECUTE FUNCTION bump_overrides_claims_version();--> statement-breakpoint

-- Trigger C: AFTER UPDATE em profiles.clinic_id propaga novo clinic_id
-- para overrides do user (evita drift na coluna desnormalizada).
CREATE OR REPLACE FUNCTION propagate_profile_clinic_to_overrides() RETURNS trigger AS $$
BEGIN
  IF OLD.clinic_id IS DISTINCT FROM NEW.clinic_id AND NEW.clinic_id IS NOT NULL THEN
    UPDATE user_permission_overrides SET clinic_id = NEW.clinic_id WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER trg_overrides_propagate_clinic
  AFTER UPDATE OF clinic_id ON profiles
  FOR EACH ROW EXECUTE FUNCTION propagate_profile_clinic_to_overrides();--> statement-breakpoint

-- 6. RLS POLICIES -----------------------------------------------------

-- profiles: 3 policies MANUAIS (D31 — sem broad UPDATE self-service desde C3).
-- GENERATED_BY: manual (D32 — profiles multi-context; D31 — no broad self-update)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE profiles FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
-- 6.1 Self read — necessário para login flow inicial (pré-JWT populado).
--     NÃO é FOR ALL: UPDATE/DELETE self-service bloqueado (D31).
CREATE POLICY profiles_self_select ON profiles FOR SELECT
  USING (auth.uid() = id);--> statement-breakpoint
-- 6.2 Tenant read — gestor/atendente vê profiles da sua clínica.
CREATE POLICY profiles_tenant_select ON profiles FOR SELECT
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint
-- 6.3 Super_admin pode mutar amplamente (canal admin).
CREATE POLICY profiles_superadmin_all ON profiles FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());--> statement-breakpoint

-- permissions: catálogo canônico read-only authenticated.
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE permissions FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY permissions_read_authenticated ON permissions FOR SELECT TO authenticated USING (true);--> statement-breakpoint

-- role_permissions: bundles padrão read-only authenticated.
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE role_permissions FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY role_permissions_read_authenticated ON role_permissions FOR SELECT TO authenticated USING (true);--> statement-breakpoint

-- user_permission_overrides: tenant-scoped via defaultTenantPolicy.
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE user_permission_overrides ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE user_permission_overrides FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY user_permission_overrides_tenant_access ON user_permission_overrides FOR ALL
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

-- login_attempts: super_admin SELECT only. INSERT exclusivo via SECURITY DEFINER.
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE login_attempts FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY login_attempts_superadmin_select ON login_attempts FOR SELECT
  USING (is_super_admin());--> statement-breakpoint

-- 7. record_login_attempt — SECURITY DEFINER (D9, D30 VOLATILE, ADR-010) ----
-- VOLATILE: realiza INSERT (mutação). search_path fixo: ADR-010 #1.
-- Schema-qualified refs: ADR-010 #6.
CREATE OR REPLACE FUNCTION public.record_login_attempt(
  p_email_hash text,
  p_ip inet,
  p_success boolean
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.login_attempts (email_hash, ip, success)
  VALUES (p_email_hash, p_ip, p_success);
END $$;--> statement-breakpoint

-- 8. VIEW effective_permissions_v (D26 — single-query aggregation) ----
-- Hook chama apenas SELECT desta view: zero loops PL/pgSQL, zero
-- processamento procedural. Permissions efetivas =
--   (role_permissions UNION granted overrides) EXCEPT denied overrides.
-- super_admin não tem entries em role_permissions; Hook injeta lista vazia
-- e marca super_admin=true (shortcut).
CREATE OR REPLACE VIEW public.effective_permissions_v AS
SELECT
  p.id AS user_id,
  p.role,
  p.clinic_id,
  p.ativo,
  p.deleted_at,
  p.claims_version,
  COALESCE(
    (
      SELECT array_agg(DISTINCT perm)
      FROM (
        SELECT permission_code AS perm
        FROM public.role_permissions
        WHERE role = p.role
        UNION
        SELECT permission_code
        FROM public.user_permission_overrides
        WHERE user_id = p.id AND granted = true
        EXCEPT
        SELECT permission_code
        FROM public.user_permission_overrides
        WHERE user_id = p.id AND granted = false
      ) AS eff
    ),
    ARRAY[]::text[]
  ) AS permissions
FROM public.profiles p;--> statement-breakpoint

-- 9. custom_access_token_hook — SECURITY DEFINER VOLATILE (D32, D34, D36) ----
-- VOLATILE: lê estado mutável (D32). search_path fixo (ADR-010 #1).
-- Schema-qualified refs (ADR-010 #6). Single query via view (D26).
-- Deny-by-default defensivo (D36) + cap 128 permissions (D34).
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_clinic_id uuid;
  v_ativo boolean;
  v_deleted_at timestamptz;
  v_claims_version integer;
  v_permissions text[];
  v_claims jsonb;
BEGIN
  v_user_id := (event ->> 'user_id')::uuid;

  SELECT role, clinic_id, ativo, deleted_at, claims_version, permissions
    INTO v_role, v_clinic_id, v_ativo, v_deleted_at, v_claims_version, v_permissions
    FROM public.effective_permissions_v
   WHERE user_id = v_user_id;

  -- Deny defensivo (D36): qualquer corrupção/inconsistência → token sem claims.
  IF NOT FOUND
     OR v_ativo IS NOT TRUE
     OR v_deleted_at IS NOT NULL
     OR v_role IS NULL
     OR v_permissions IS NULL
     OR (v_role <> 'super_admin' AND v_clinic_id IS NULL)
     OR (v_role = 'super_admin' AND v_clinic_id IS NOT NULL)
  THEN
    RETURN event;
  END IF;

  -- D34: cap 128 permissions. JWT oversized quebra proxies/headers/edge.
  IF array_length(v_permissions, 1) > 128 THEN
    RAISE EXCEPTION 'custom_access_token_hook: user % has % permissions, exceeds cap of 128',
      v_user_id, array_length(v_permissions, 1);
  END IF;

  v_claims := COALESCE(event -> 'claims', '{}'::jsonb)
    || jsonb_build_object(
         'clinic_id', CASE WHEN v_clinic_id IS NULL THEN to_jsonb(NULL::text) ELSE to_jsonb(v_clinic_id::text) END,
         'role', to_jsonb(v_role),
         'permissions', to_jsonb(v_permissions),
         'claims_version', to_jsonb(v_claims_version),
         'super_admin', to_jsonb(v_role = 'super_admin')
       );

  RETURN jsonb_set(event, '{claims}', v_claims);
END $$;--> statement-breakpoint

-- 10. auth_hook_selftest — SECURITY DEFINER VOLATILE (D11) -------------
-- Healthcheck consumido por /api/health/auth-hook. MANTÉM-SE simples
-- (D17 — não vira integration test). Valida: função viva, grants vivos,
-- search_path correto, lógica SQL básica.
CREATE OR REPLACE FUNCTION public.auth_hook_selftest()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_started_at timestamptz;
  v_result jsonb;
  v_synthetic_event jsonb;
BEGIN
  v_started_at := clock_timestamp();
  -- user_id 0...0 nunca existe em auth.users → Hook deve retornar event original (sem claims).
  v_synthetic_event := jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000000000',
    'claims', '{}'::jsonb
  );
  v_result := public.custom_access_token_hook(v_synthetic_event);

  RETURN jsonb_build_object(
    'ok', true,
    'claims_keys', ARRAY(SELECT jsonb_object_keys(v_result -> 'claims')),
    'elapsed_ms', extract(milliseconds from (clock_timestamp() - v_started_at))::int
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false,
    'error', SQLERRM,
    'sqlstate', SQLSTATE
  );
END $$;--> statement-breakpoint

-- 11. SEEDS canônicos (F3) ---------------------------------------------
-- Idempotentes via ON CONFLICT.
INSERT INTO permissions (code, description) VALUES
  ('view:agenda',         'Visualizar agenda'),
  ('edit:agenda',         'Editar agenda (criar/mover/cancelar)'),
  ('view:patient',        'Visualizar pacientes'),
  ('create:patient',      'Cadastrar pacientes'),
  ('edit:patient',        'Editar dados de pacientes'),
  ('delete:patient',      'Excluir pacientes (soft-delete)'),
  ('view:prontuario',     'Visualizar prontuários'),
  ('create:prontuario',   'Criar prontuários'),
  ('sign:prontuario',     'Assinar prontuários (médico)'),
  ('view:prescription',   'Visualizar prescrições'),
  ('create:prescription', 'Criar prescrições'),
  ('view:financial',      'Visualizar dados financeiros'),
  ('manage:financial',    'Gerenciar receber/pagar/fornecedores'),
  ('view:audit',          'Visualizar log de auditoria'),
  ('export:audit',        'Exportar log de auditoria'),
  ('manage:employees',    'Cadastrar/editar funcionários'),
  ('manage:permissions',  'Editar permissões de funcionários'),
  ('manage:settings',     'Gerenciar configurações da clínica'),
  ('manage:agent',        'Gerenciar agente IA da clínica'),
  ('view:consultorio',    'Acesso à tela de consultório')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint

-- role_permissions bundles. owner e gestor: tudo (idênticos no MVP, Visão Geral §4.1).
-- super_admin: NÃO populado (Hook usa shortcut via is_super_admin()).
INSERT INTO role_permissions (role, permission_code)
SELECT r.role::role_enum, p.code
FROM (VALUES ('owner'), ('gestor')) AS r(role)
CROSS JOIN permissions p
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO role_permissions (role, permission_code) VALUES
  ('doctor',     'view:agenda'),
  ('doctor',     'edit:agenda'),
  ('doctor',     'view:patient'),
  ('doctor',     'create:patient'),
  ('doctor',     'edit:patient'),
  ('doctor',     'view:prontuario'),
  ('doctor',     'create:prontuario'),
  ('doctor',     'sign:prontuario'),
  ('doctor',     'view:prescription'),
  ('doctor',     'create:prescription'),
  ('doctor',     'view:consultorio'),
  ('attendant',  'view:agenda'),
  ('attendant',  'edit:agenda'),
  ('attendant',  'view:patient'),
  ('attendant',  'create:patient'),
  ('attendant',  'edit:patient'),
  ('attendant',  'view:consultorio'),
  ('attendant',  'view:financial'),
  ('financial',  'view:financial'),
  ('financial',  'manage:financial'),
  ('financial',  'view:agenda'),
  ('financial',  'view:patient'),
  ('financial',  'view:audit'),
  ('financial',  'export:audit')
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 12. SCHEMA VERSION SNAPSHOT -----------------------------------------
INSERT INTO _schema_version (version) VALUES ('c3-identity-core')
ON CONFLICT (version) DO NOTHING;
