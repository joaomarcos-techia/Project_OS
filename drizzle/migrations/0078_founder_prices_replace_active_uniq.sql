-- 0078 — completa a 0077: substitui o índice que impedia o preço de campanha.
--
-- A 0077 criou a coluna e os índices novos, mas as linhas de campanha NÃO
-- entraram: `prices_active_uniq` (unique em plan_id+billing_cycle onde
-- active_until IS NULL) é anterior ao conceito de campanha e proíbe um segundo
-- preço vigente para o mesmo plano/ciclo. O `ON CONFLICT DO NOTHING` da 0077
-- engoliu a violação em silêncio.
--
-- `prices_active_standard_uniq` já preserva exatamente a mesma garantia para o
-- preço de TABELA (mesmas colunas, mais `campaign_code IS NULL`), e
-- `prices_active_campaign_uniq` cobre as linhas de campanha. O índice antigo
-- vira redundante e restritivo demais.

DROP INDEX IF EXISTS prices_active_uniq;

INSERT INTO prices (plan_id, amount, currency, billing_cycle, campaign_code)
SELECT p.plan_id, round(p.amount * 0.85, 2), p.currency, p.billing_cycle, 'fundador'
  FROM prices p
 WHERE p.active_until IS NULL
   AND p.campaign_code IS NULL
ON CONFLICT DO NOTHING;

-- Falha ALTO se a inserção não produziu uma linha de campanha por preço de
-- tabela vigente. Sem isto uma nova restrição futura repetiria o silêncio da
-- 0077 e a promoção simplesmente não existiria em produção.
DO $$
DECLARE
  tabela int;
  campanha int;
BEGIN
  SELECT count(*) INTO tabela
    FROM prices WHERE active_until IS NULL AND campaign_code IS NULL;
  SELECT count(*) INTO campanha
    FROM prices WHERE active_until IS NULL AND campaign_code = 'fundador';
  IF campanha <> tabela THEN
    RAISE EXCEPTION
      'preco de fundador incompleto: % de tabela, % de campanha', tabela, campanha;
  END IF;
END $$;
