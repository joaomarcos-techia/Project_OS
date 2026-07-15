-- =====================================================================
-- 0038_security_definer_hardening.sql
-- Auditoria de segurança de código — V15 (least-privilege / ADR-010).
--
-- `get_advisors(security)` no qoro-dev sinalizou funções `SECURITY DEFINER` com
-- EXECUTE para anon/authenticated (via PostgREST `/rest/v1/rpc/`) e 2 funções com
-- `search_path` mutável. Esta migração aplica o padrão da 0002/0004 (REVOKE/GRANT
-- explícito + search_path fixo) às funções que ficaram de fora — SEM quebrar
-- caminhos legítimos.
--
-- ⚠️ NÃO mexemos em `record_login_attempt(text, inet, boolean)`: o fluxo de login
-- (`src/app/(app)/login/actions.ts`) chama-a via `supabase.rpc` no cliente SSR,
-- cujo papel é `anon` (auditoria PRÉ-auth) — anon PRECISA de EXECUTE (grant
-- deliberado da 0004). O risco (poluição de `login_attempts`) é limitado pelo
-- pepper secreto `LOGIN_HASH_PEPPER` e não é mirável por vítima. Mantido por
-- design (advisor `anon_security_definer_function_executable` é esperado aqui).
--
-- ⚠️ Extensões `btree_gist`/`pg_trgm` em `public` (advisor WARN) NÃO são movidas
-- aqui: `ALTER EXTENSION ... SET SCHEMA` tem risco sobre constraints/índices
-- dependentes (exclusão GiST de agendamentos, índices trigram) e fica como
-- recomendação separada. Ver docs/achados/auditoria-seguranca-codigo.md (V15).
--
-- Idempotente: REVOKE de grant inexistente e ALTER ... SET search_path repetido
-- são no-ops. Seguro reaplicar (inclusive quando `db:migrate:*` rodar este 0038).
-- =====================================================================

-- 1. Funções de TRIGGER: nunca devem ser chamáveis via RPC. O trigger dispara
--    com o privilégio do trigger, não do chamador — revogar EXECUTE não afeta o
--    disparo do trigger, só fecha a superfície `/rest/v1/rpc/`.
REVOKE EXECUTE ON FUNCTION public.block_lancamento_immutable_cols() FROM anon, authenticated;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.block_signed_prontuario_update()  FROM anon, authenticated;--> statement-breakpoint

-- 2. Função de manutenção (sem call-site no app): remove PUBLIC + anon +
--    authenticated. `postgres` (owner) e `service_role` (admin/scripts) mantêm.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- 3. `search_path` fixo (ADR-010) nas 2 funções sinalizadas. `pg_catalog` é
--    sempre pesquisado primeiro, então built-ins (`tstzrange`) continuam
--    resolvendo mesmo com o path restrito.
ALTER FUNCTION public.appt_tstzrange(timestamptz, integer) SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.enforce_appointment_snapshot_immutable() SET search_path = public, pg_temp;--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('sec-audit-v15-security-definer-hardening')
ON CONFLICT (version) DO NOTHING;
