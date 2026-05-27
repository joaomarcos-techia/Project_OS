-- =====================================================================
-- 0002_tenancy_hardening.sql
-- C2 hardening — least-privilege grants on SQL helper functions.
-- Addresses adversarial-audit finding M-1 (PUBLIC EXECUTE on helpers).
-- See ADR-007 invariant #11.
--
-- Rationale:
--   CREATE FUNCTION grants EXECUTE to PUBLIC by default (Postgres convention).
--   PUBLIC means "every role, present and future". A new role added in C3+
--   (e.g., `audit_reader`, `report_runner`) would inherit EXECUTE on these
--   helpers automatically. Least-privilege requires explicit grants.
--
-- Why anon retains EXECUTE:
--   Policies on clinics / clinic_units call is_super_admin() via SECURITY
--   INVOKER. When anon queries those tables, the policy fires and the function
--   is called as anon. If anon lacks EXECUTE, the query throws
--   "permission denied for function" instead of returning 0 rows.
--   That error is information disclosure: it confirms the function exists
--   and that the table is RLS-protected. Returning 0 rows leaks strictly
--   less. So anon KEEPS EXECUTE — the principle here is "least surface for
--   future roles", not "lock anon out of helpers".
--
-- Why trigger functions get the same set:
--   BEFORE INSERT triggers (check_clinic_slug) fire BEFORE WITH CHECK
--   evaluates. An anon INSERT attempt on clinics would call check_clinic_slug
--   first; without EXECUTE, the error would be "permission denied" instead of
--   the desired RLS violation. Consistent grants prevent that asymmetry.
--
-- Postgres `postgres` role retains EXECUTE by ownership — no explicit grant.
-- =====================================================================

-- SQL helpers (read-only, STABLE)
REVOKE EXECUTE ON FUNCTION public.current_clinic_id()     FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.current_platform_role() FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.is_super_admin()        FROM PUBLIC;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.current_clinic_id()     TO anon, authenticated, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_platform_role() TO anon, authenticated, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_super_admin()        TO anon, authenticated, service_role;--> statement-breakpoint

-- Trigger functions (VOLATILE, called by trigger machinery)
REVOKE EXECUTE ON FUNCTION public.set_updated_at()    FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.check_clinic_slug() FROM PUBLIC;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.set_updated_at()    TO anon, authenticated, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.check_clinic_slug() TO anon, authenticated, service_role;--> statement-breakpoint

-- Schema version snapshot
INSERT INTO _schema_version (version) VALUES ('c2-tenancy-hardening')
ON CONFLICT (version) DO NOTHING;
