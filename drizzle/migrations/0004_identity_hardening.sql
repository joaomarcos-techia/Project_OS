-- =====================================================================
-- 0004_identity_hardening.sql
-- C3 hardening — least-privilege grants em todas funções SECURITY DEFINER
-- criadas em 0003, GRANT SELECT em tabelas que o Hook precisa ler, e
-- GRANT na VIEW effective_permissions_v.
-- ADR-007 invariante #11 + ADR-010 itens 2/3/7.
--
-- Funções SECURITY DEFINER e suas roles:
--   - custom_access_token_hook  → supabase_auth_admin (chamada pelo GoTrue)
--   - auth_hook_selftest        → supabase_auth_admin + service_role (chamada pelo healthcheck)
--   - record_login_attempt      → anon, authenticated, service_role (login flow é pre/post-auth)
--   - bump_*_claims_version     → trigger functions, EXECUTE para anon/authenticated/service_role
--   - propagate_profile_clinic_to_overrides → idem
--
-- Por que `supabase_auth_admin` em vez de `service_role`:
--   GoTrue invoca Custom Access Token Hook com a role `supabase_auth_admin`
--   (não service_role). Sem GRANT explícito, o hook é silently desabilitado
--   ou retorna permission_denied.
--
-- D34/D37 (ADR-008): exceção ao invariante #11 (que diz GRANT TO anon/authenticated/service_role)
--   permitida explicitamente para funções invocadas por managed Supabase roles.
-- =====================================================================

-- custom_access_token_hook ---------------------------------------------
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;--> statement-breakpoint

-- auth_hook_selftest ---------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.auth_hook_selftest() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.auth_hook_selftest() TO supabase_auth_admin, service_role;--> statement-breakpoint

-- record_login_attempt -------------------------------------------------
-- anon precisa (login com email errado é anon); authenticated cobre o caso
-- raro de re-login dentro de sessão; service_role para scripts/admin.
REVOKE EXECUTE ON FUNCTION public.record_login_attempt(text, inet, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.record_login_attempt(text, inet, boolean) TO anon, authenticated, service_role;--> statement-breakpoint

-- Trigger functions (VOLATILE) -----------------------------------------
REVOKE EXECUTE ON FUNCTION public.bump_profile_claims_version() FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.bump_overrides_claims_version() FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.propagate_profile_clinic_to_overrides() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.bump_profile_claims_version() TO anon, authenticated, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.bump_overrides_claims_version() TO anon, authenticated, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.propagate_profile_clinic_to_overrides() TO anon, authenticated, service_role;--> statement-breakpoint

-- GRANTs base que Hook precisa via SECURITY DEFINER --------------------
-- Apesar de SECURITY DEFINER rodar como owner (postgres) que tem BYPASSRLS,
-- ainda precisa GRANT base para a role chamadora acessar a função e suas
-- dependências quando o planner precisar resolver.
GRANT SELECT ON public.profiles TO supabase_auth_admin;--> statement-breakpoint
GRANT SELECT ON public.permissions TO supabase_auth_admin;--> statement-breakpoint
GRANT SELECT ON public.role_permissions TO supabase_auth_admin;--> statement-breakpoint
GRANT SELECT ON public.user_permission_overrides TO supabase_auth_admin;--> statement-breakpoint
GRANT SELECT ON public.effective_permissions_v TO supabase_auth_admin, service_role;--> statement-breakpoint

-- Schema version snapshot
INSERT INTO _schema_version (version) VALUES ('c3-identity-hardening')
ON CONFLICT (version) DO NOTHING;
