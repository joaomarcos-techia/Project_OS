-- =====================================================================
-- 0043 — REVOKE EXECUTE em bump_overrides_claims_version (higiene da 0040).
--
-- DEFEITO INTRODUZIDO POR MIM NA 0040, pego pelo advisor do Supabase
-- (`anon_security_definer_function_executable`) ao verificar prod pós-deploy.
--
-- A 0040 tornou `bump_overrides_claims_version()` SECURITY DEFINER — correto: o
-- bump é invariante de segurança e antes falhava ABERTO e em silêncio (era
-- INVOKER, e o UPDATE em profiles morria na RLS sem erro). Mas eu escrevi o
-- CREATE OR REPLACE e **esqueci o REVOKE**, enquanto as duas irmãs da mesma
-- migration (`touch_claims_version`, `bump_role_permissions_claims_version`)
-- receberam REVOKE corretamente. O Supabase re-concede EXECUTE a anon/authenticated
-- por DEFAULT PRIVILEGES (lição da 0007), então a função ficou exposta em
-- `/rest/v1/rpc/bump_overrides_claims_version`.
--
-- ALCANCE REAL: **ZERO**. Medido em dev, não presumido — o Postgres recusa a
-- chamada direta de uma trigger function:
--     "trigger functions can only be called as triggers" [SQLSTATE 0A000]
-- Não era vulnerabilidade. Mas é violação da regra #2/#3 do ADR-010 (REVOKE FROM
-- PUBLIC + GRANT explícito na MESMA migration), é incoerente com as irmãs, e
-- deixa um WARN permanente no advisor de segurança. Advisor barulhento treina a
-- gente a ignorar o lint que importa da próxima vez — esse é o custo real.
--
-- Idempotente e não-destrutiva: só REVOKEs.
-- =====================================================================

REVOKE EXECUTE ON FUNCTION public.bump_overrides_claims_version() FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.bump_overrides_claims_version() FROM anon, authenticated;--> statement-breakpoint

-- Schema version snapshot
INSERT INTO _schema_version (version) VALUES ('identity-revoke-bump-overrides-fn')
ON CONFLICT (version) DO NOTHING;
