-- 0039 — Corrige o limite de usuários do plano `pro`: 15 → 10.
--
-- Divergência encontrada na remediação da auditoria de APIs (2026-07-15): a migration
-- 0026 semeou `pro` com 15 seats, e a tabela de preços da VisãoGeral (§7) dizia o mesmo,
-- mas o posicionamento do produto (VisãoGeral §1.1 "clínicas pequenas até 10
-- funcionários" e §2) sempre disse 10 — e 10 é o número correto, confirmado pelo founder.
--
-- Efeito prático de deixar como estava: `assertUserQuota` (ADR-024 — usuários são a
-- ÚNICA trava dura) lê `plan_limits`, então toda clínica `pro` recebia 5 seats a mais do
-- que o plano vende. Vazamento de receita, não bug de segurança.
--
-- Segurança da mudança: o produto é PRÉ-PRODUÇÃO e não há clínica `pro` paga. O ADR-024
-- §"downgrade" alerta que baixar o limite de um plano existente é mudança de contrato —
-- o custo é ZERO agora e passa a existir depois do 1º cliente pagante. É o momento certo.
--
-- Não-destrutiva: UPDATE de uma linha de configuração. Idempotente (WHERE limit_value=15
-- + o valor-alvo). Sem DROP/TRUNCATE.
UPDATE plan_limits pl
   SET limit_value = 10
  FROM plans p
 WHERE pl.plan_id = p.id
   AND p.code = 'pro'
   AND pl.metric = 'users'
   AND pl.limit_value = 15;
