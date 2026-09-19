-- FASE 2: executar somente no banco local preparado pelo time. Somente leitura.
-- psql "$SECURITY_LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/security/access-inventory.sql
-- Não lista hash/senha/JWT/chave de serviço. ID é suficiente para cruzar com o cadastro interno.
BEGIN READ ONLY;
SELECT id, clinic_id, role, ativo, deleted_at, invite_accepted_at, claims_version, mfa_enrolled_at
FROM public.profiles
ORDER BY clinic_id NULLS FIRST, role, id;
SELECT rolname, rolcanlogin, rolbypassrls, rolvaliduntil
FROM pg_roles
WHERE rolcanlogin OR rolbypassrls
ORDER BY rolname;
ROLLBACK;
