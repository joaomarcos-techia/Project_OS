-- =====================================================================
-- ADR-060 (O-2a) — least privilege em `signup_sessions`, parte 2.
--
-- ACHADO ao verificar o que a 0096 realmente deixou no banco (não o que eu
-- supunha que deixaria): além de `authenticated`, a role `qoro_runtime` também
-- nasceu com DML na tabela. A origem é o default ACL de `postgres` no schema
-- public, que hoje é:
--
--   authenticated = arwdm   (INSERT, SELECT, UPDATE, DELETE, MAINTAIN)
--   qoro_runtime  = arwd    (INSERT, SELECT, UPDATE, DELETE)
--
-- Isso está CERTO para tabela de tenant — é como o runtime não-BYPASSRLS lê,
-- com a RLS escopando as linhas. Está errado aqui: `signup_sessions` é ops-only,
-- lida exclusivamente por dbAdmin/service_role pelos endpoints de onboarding.
--
-- A RLS já a protege (ENABLE+FORCE, nenhuma policy → nega por padrão). Mas é a
-- MESMA razão que motivou o REVOKE de `authenticated` na 0096: privilégio que
-- não deveria existir não deve depender de uma segunda camada para ser
-- inofensivo. A 0096 revogou de anon e authenticated e ESQUECEU esta.
--
-- Migration nova em vez de emenda: a 0096 já foi aplicada, e o drizzle rastreia
-- por hash — reescrevê-la faria o runner tentar aplicá-la de novo, e
-- `ADD CONSTRAINT`/`CREATE TRIGGER` não são idempotentes.
-- =====================================================================
REVOKE ALL ON signup_sessions FROM qoro_runtime;--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('signup-sessions-o2a-runtime-revoke')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
