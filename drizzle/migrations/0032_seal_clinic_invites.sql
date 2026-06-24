-- =====================================================================
-- Reforço (defense-in-depth) — clinic_invites: remove o GRANT residual que o
-- Supabase concede por default a anon/authenticated em tabelas novas.
--
-- A confidencialidade JÁ era garantida por FORCE ROW LEVEL SECURITY + ausência
-- de policy (a tabela devolve 0 linhas a qualquer role não-BYPASSRLS). Este
-- REVOKE remove o privilégio de tabela em si: um tenant logado passa a receber
-- "permission denied" (não apenas 0 linhas) e nenhuma policy permissiva
-- acidental no futuro consegue expor a tabela. O acesso da aplicação é 100% via
-- dbAdmin/service_role (resolveOpenInvite/guardedUpdateInvite/createInviteTx),
-- então remover anon/authenticated não afeta nenhum caminho real.
-- REVOKE é idempotente (não falha se o privilégio não existir).
-- =====================================================================
REVOKE ALL ON clinic_invites FROM anon;--> statement-breakpoint
REVOKE ALL ON clinic_invites FROM authenticated;--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('onboarding-clinic-invites-seal')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
