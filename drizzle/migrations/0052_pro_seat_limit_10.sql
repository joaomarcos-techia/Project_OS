-- =====================================================================
-- 0052_pro_seat_limit_10.sql
-- Plano Pro = 10 usuários (não 15).
--
-- Decisão de produto antiga que nunca chegou ao dado: o seed (0026 /
-- scripts/seed-plans.ts) gravou `users=15` para o Pro, e `plan_limits` é
-- semeado com ON CONFLICT (plan_id, metric) DO NOTHING — logo re-rodar o seed
-- NÃO corrige. A regra de negócio precisa ser versionada como migração de dados,
-- não UPDATE manual em produção (reprodutível + auditável).
--
-- Idempotente: rodar 2× dá o mesmo resultado. Reversível: trocar 10 por 15.
-- =====================================================================

UPDATE plan_limits
   SET limit_value = 10
 WHERE metric = 'users'
   AND plan_id = (SELECT id FROM plans WHERE code = 'pro');--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0052-pro-seat-limit-10')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
