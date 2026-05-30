-- =====================================================================
-- 0006_identity_postrest_compat.sql
-- C3 hotfix — compatibilidade com PostgREST + Supabase lint cleanup.
--
-- PROBLEMA RAIZ:
--   O claim 'role' do JWT é RESERVADO pelo PostgREST para definir o role
--   Postgres usado nas requests (authenticated / anon / service_role).
--   Nosso Hook injetava 'role' = 'super_admin' (app role), quebrando
--   PostgREST com "role super_admin does not exist" em toda query
--   subsequente via supabase-js client.
--
-- FIX:
--   Renomear nosso claim aplicacional 'role' → 'app_role'. O claim 'role'
--   fica intocado (Supabase mantém 'authenticated'). Helpers SQL atualizados
--   para ler 'app_role'. ADR-008 D13/P2 não muda — só nome do claim.
--
-- Adicional cleanup (Supabase Database Linter):
--   1. SET search_path = public, pg_temp em TODAS funções (C2 + C3 trigger fns)
--   2. effective_permissions_v com WITH (security_invoker=on) — PG 15+
--   3. REVOKE EXECUTE FROM anon, authenticated em auth_hook_selftest
--      (Supabase tem DEFAULT PRIVILEGES que regrante automaticamente; precisa
--      revoke EXPLÍCITO por role).
-- =====================================================================

-- 1. Helpers SQL: lê 'app_role' + adiciona search_path -------------
CREATE OR REPLACE FUNCTION public.current_platform_role() RETURNS text
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(auth.jwt() ->> 'app_role', '')
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.current_platform_role() = 'super_admin'
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.current_clinic_id() RETURNS text
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(auth.jwt() ->> 'clinic_id', '')
$$;--> statement-breakpoint

-- 2. C2 trigger functions: adicionar search_path -------------------
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.check_clinic_slug() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public._reserved_slugs WHERE slug = NEW.slug) THEN
    RAISE EXCEPTION 'Slug reservado: %', NEW.slug
      USING ERRCODE = '23514', HINT = 'Choose a different subdomain.';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

-- 3. C3 trigger functions: adicionar search_path -------------------
CREATE OR REPLACE FUNCTION public.bump_profile_claims_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role
     OR OLD.clinic_id IS DISTINCT FROM NEW.clinic_id
     OR OLD.ativo IS DISTINCT FROM NEW.ativo THEN
    NEW.claims_version := OLD.claims_version + 1;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.bump_overrides_claims_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := COALESCE(NEW.user_id, OLD.user_id);
  UPDATE public.profiles SET claims_version = claims_version + 1 WHERE id = v_user_id;
  RETURN COALESCE(NEW, OLD);
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.propagate_profile_clinic_to_overrides() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.clinic_id IS DISTINCT FROM NEW.clinic_id AND NEW.clinic_id IS NOT NULL THEN
    UPDATE public.user_permission_overrides SET clinic_id = NEW.clinic_id WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

-- 4. effective_permissions_v com security_invoker (PG 15+) ---------
-- Sem isso, Supabase Linter reporta a view como SECURITY DEFINER (executa
-- com privilégios do owner). security_invoker=on respeita o role do caller.
-- Hook (SECURITY DEFINER = postgres = BYPASSRLS) continua bypassando RLS;
-- callers diretos via REST veem RLS de profiles (0 rows sem self/tenant context).
CREATE OR REPLACE VIEW public.effective_permissions_v
WITH (security_invoker=on)
AS
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

-- 5. Hook: usa 'app_role' em vez de 'role' (FIX PRINCIPAL) ---------
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

  IF array_length(v_permissions, 1) > 128 THEN
    RAISE EXCEPTION 'custom_access_token_hook: user % has % permissions, exceeds cap of 128',
      v_user_id, array_length(v_permissions, 1);
  END IF;

  -- 'app_role' (não 'role' — PostgREST reserva 'role' para Postgres role)
  v_claims := COALESCE(event -> 'claims', '{}'::jsonb)
    || jsonb_build_object(
         'clinic_id', CASE WHEN v_clinic_id IS NULL THEN to_jsonb(NULL::text) ELSE to_jsonb(v_clinic_id::text) END,
         'app_role', to_jsonb(v_role),
         'permissions', to_jsonb(v_permissions),
         'claims_version', to_jsonb(v_claims_version),
         'super_admin', to_jsonb(v_role = 'super_admin')
       );

  RETURN jsonb_set(event, '{claims}', v_claims);
END $$;--> statement-breakpoint

-- 6. REVOKE EXECUTE de anon/authenticated em auth_hook_selftest ----
-- Supabase aplica DEFAULT PRIVILEGES que automaticamente GRANT EXECUTE
-- TO anon/authenticated em novas funções no schema public. REVOKE FROM PUBLIC
-- (no 0004) não cobre. Precisa REVOKE explícito por role.
REVOKE EXECUTE ON FUNCTION public.auth_hook_selftest() FROM anon, authenticated;--> statement-breakpoint

-- Schema version snapshot
INSERT INTO _schema_version (version) VALUES ('c3-identity-postrest-compat')
ON CONFLICT (version) DO NOTHING;
