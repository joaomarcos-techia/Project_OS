-- =====================================================================
-- 0007_identity_mark_mfa_revoke_anon.sql
-- C3 lint cleanup — REVOKE EXECUTE de mark_mfa_enrolled FROM anon.
--
-- Supabase aplica DEFAULT PRIVILEGES que GRANT EXECUTE TO anon, authenticated
-- automaticamente em novas funções no schema public. O 0005 só revogou
-- FROM PUBLIC (não cobre anon herdado do default). mark_mfa_enrolled usa
-- auth.uid() internamente — sempre falharia para anon — mas o lint Supabase
-- detecta a exposição. Revoke explícito remove o warning.
-- =====================================================================

REVOKE EXECUTE ON FUNCTION public.mark_mfa_enrolled(boolean) FROM anon;--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('c3-identity-mark-mfa-revoke-anon')
ON CONFLICT (version) DO NOTHING;
