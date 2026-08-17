-- 0079 — convênio como forma de pagamento.
--
-- `payment_methods` é catálogo GLOBAL e `lancamentos.payment_method` é FK por
-- `code`, então a opção nasce de uma LINHA, não de um enum ou deploy: a tela lê
-- `where ativo order by ordem` e a validação é `z.string().max(40)` — quem
-- garante o código válido é a própria FK.
--
-- Escopo deliberado: só a forma de pagamento. Nada de operadora, carteirinha,
-- glosa ou repasse — isso é modelo próprio e vem depois. Aqui um atendimento
-- pago por convênio fica registrado como tal em vez de virar "outro".

INSERT INTO payment_methods (code, label, ativo, ordem)
VALUES ('convenio', 'Convênio', true, 6)
ON CONFLICT (code) DO NOTHING;

-- A 0078 ensinou que `ON CONFLICT DO NOTHING` esconde falha: falha alto se a
-- linha não existir ao fim.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payment_methods WHERE code = 'convenio' AND ativo) THEN
    RAISE EXCEPTION 'forma de pagamento convenio ausente ou inativa';
  END IF;
END $$;
