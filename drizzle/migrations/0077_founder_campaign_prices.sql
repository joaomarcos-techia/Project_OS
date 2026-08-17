-- 0077 — preço de fundador para quem entra pelo link de onboarding.
--
-- Por que uma LINHA DE PREÇO e não um motor de desconto: `subscriptions` já
-- fixa `price_id`, e a renovação usa o preço fixado. Isso torna o desconto
-- vitalício uma consequência do modelo que já existe, em vez de um cálculo em
-- runtime que um bug futuro poderia repreçar em cliente existente.
--
-- `campaign_code` NULL = preço de tabela. A resolução de preço vigente hoje
-- assume UM preço ativo por plano/ciclo (`active_until IS NULL`); sem este
-- discriminador as linhas novas tornariam essas consultas ambíguas.

ALTER TABLE prices ADD COLUMN IF NOT EXISTS campaign_code text;

-- Um preço vigente por plano/ciclo/campanha. Índice parcial porque só vale
-- para o preço vigente — o histórico (com `active_until`) pode repetir.
CREATE UNIQUE INDEX IF NOT EXISTS prices_active_standard_uniq
  ON prices (plan_id, billing_cycle)
  WHERE active_until IS NULL AND campaign_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS prices_active_campaign_uniq
  ON prices (plan_id, billing_cycle, campaign_code)
  WHERE active_until IS NULL AND campaign_code IS NOT NULL;

-- 15% sobre o preço de tabela vigente, para todos os planos e ciclos.
-- `round(...,2)` mantém a escala de `numeric(12,2)`; os valores conferem:
-- 149,00→126,65  349,00→296,65  699,00→594,15
-- 1519,80→1291,83  3559,80→3025,83  7129,80→6060,33
INSERT INTO prices (plan_id, amount, currency, billing_cycle, campaign_code)
SELECT p.plan_id, round(p.amount * 0.85, 2), p.currency, p.billing_cycle, 'fundador'
  FROM prices p
 WHERE p.active_until IS NULL
   AND p.campaign_code IS NULL
ON CONFLICT DO NOTHING;
