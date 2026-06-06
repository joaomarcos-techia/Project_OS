-- =====================================================================
-- 0021_financial_grants_hardening.sql
-- C9 — append-only no nível de privilégio (corretiva sobre 0020).
--
-- O Supabase concede ALL às roles `authenticated`/`anon` em tabelas novas via
-- DEFAULT PRIVILEGES — então o GRANT explícito de 0020 (SELECT/INSERT/UPDATE) NÃO
-- removeu o DELETE herdado. Aqui REVOGAMOS o que o app (role authenticated) não
-- pode fazer, materializando "lançamento nunca é deletado / comprovante é
-- imutável". `service_role` (admin/break-glass/offboarding) mantém DELETE; o
-- teardown de clínica continua via FK CASCADE.
-- =====================================================================

-- Histórico financeiro não é deletável pelo app.
REVOKE DELETE ON lancamentos            FROM authenticated;--> statement-breakpoint
REVOKE DELETE ON faturamento_pendencias FROM authenticated;--> statement-breakpoint
REVOKE DELETE ON cash_flow_daily        FROM authenticated;--> statement-breakpoint
REVOKE DELETE ON suppliers              FROM authenticated;--> statement-breakpoint

-- Comprovantes são append-only (sem UPDATE/DELETE pelo app).
REVOKE UPDATE, DELETE ON payment_proofs FROM authenticated;--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('c9-financial-grants-hardening')
ON CONFLICT (version) DO NOTHING;
