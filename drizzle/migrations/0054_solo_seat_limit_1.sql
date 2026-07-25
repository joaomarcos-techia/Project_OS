-- =====================================================================
-- 0054_solo_seat_limit_1.sql
-- Plano Solo = 1 usuário (não 2). É literalmente SOLO.
--
-- Decisão de produto que nunca chegou ao dado: o seed (0026 /
-- scripts/seed-plans.ts) gravou `users=2` para o Solo, e `plan_limits` é
-- semeado com ON CONFLICT (plan_id, metric) DO NOTHING — logo re-rodar o seed
-- NÃO corrige. Mesmo modo de falha do 0052 (Pro=10): a regra de negócio precisa
-- ser versionada como migração de dados, não UPDATE manual em produção
-- (reprodutível + auditável).
--
-- Idempotente: rodar 2× dá o mesmo resultado. Reversível: trocar 1 por 2.
-- =====================================================================

UPDATE plan_limits
   SET limit_value = 1
 WHERE metric = 'users'
   AND plan_id = (SELECT id FROM plans WHERE code = 'solo');--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0054-solo-seat-limit-1')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
