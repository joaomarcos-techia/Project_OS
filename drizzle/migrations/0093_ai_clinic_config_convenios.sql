-- 0093 — lista única de convênios informada pelo agente por clínica.
--
-- A forma de pagamento global `convenio` (0079) não diz quais operadoras cada
-- clínica aceita. Este campo é somente o catálogo operacional que a clínica
-- configura para o agente responder; não cria TISS, carteirinha, autorização,
-- glosa, repasse ou regra financeira.
--
-- Lista vazia significa "informação não cadastrada". O runtime nunca interpreta
-- vazio como "a clínica não aceita convênios".
ALTER TABLE ai_clinic_config
  ADD COLUMN IF NOT EXISTS convenios text[] NOT NULL DEFAULT ARRAY[]::text[];
