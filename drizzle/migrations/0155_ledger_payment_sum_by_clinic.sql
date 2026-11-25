-- =====================================================================
-- 0155 — Livro financeiro: soma de pagamentos do gatilho pela clínica (R38).
-- CANDIDATA: preparada e provada em Postgres descartável; NÃO aplicada no DEV
-- compartilhado nem em produção.
--
-- Problema (código da main, 0057/0073, mantido igual na 0153): a cada pagamento
-- particular, validate_payment_transaction_insert() soma os pagamentos do lançamento
-- com `WHERE lancamento_id = ? AND kind = 'payment'`. Não há índice que comece por
-- lancamento_id (o índice é (clinic_id, lancamento_id)), e a política RLS compara
-- `clinic_id::text`, então nem o runtime nem o service_role usam índice: a soma
-- varre payment_transactions inteira, de TODAS as clínicas, a cada pagamento.
--
-- Correção: a mesma soma com `clinic_id = NEW.clinic_id` (igual ao que o ramo de
-- convênio da 0153 e o estorno da aplicação, createEstorno, já fazem). Nada mais muda.
--
-- Equivalência: o próprio gatilho exige, antes da soma, que o lançamento seja da
-- clínica do pagamento (v_lancamento_clinic = NEW.clinic_id), e toda linha inserida
-- passou por essa mesma conferência. Então todo pagamento com esse lancamento_id já
-- tem essa clinic_id, e as duas somas dão o mesmo valor. A única diferença possível
-- seria uma linha gravada com o gatilho desligado ou alterada depois por quem tem
-- UPDATE (o runtime não tem): o pré-voo de aplicação conta essas linhas (esperado 0).
--
-- Lock: CREATE OR REPLACE FUNCTION não trava lancamentos nem payment_transactions.
-- Sem BEGIN/COMMIT (o migrador envolve). Nada é apagado.
--
-- Reversão: recriar a função com o corpo da 0153 (o mesmo texto, sem a linha
-- `WHERE clinic_id = NEW.clinic_id` no caminho particular) e
--   DELETE FROM public._schema_version WHERE version = '0155-ledger-payment-sum-by-clinic';
-- =====================================================================

CREATE OR REPLACE FUNCTION public.validate_payment_transaction_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lancamento_clinic uuid;
  v_lancamento_value numeric(12, 2);
  v_payment_clinic uuid;
  v_payment_lancamento uuid;
  v_payment_kind payment_transaction_kind;
  v_payment_amount numeric(12, 2);
  v_total numeric(12, 2);
  v_insurer_guide uuid;
  v_glossed numeric(12, 2);
BEGIN
  -- Este lock no lancamento e o serializador de pagamentos/refunds do mesmo
  -- titulo. O papel authenticated tem UPDATE em lancamentos, mas continua sem
  -- UPDATE em payment_transactions (ledger append-only).
  SELECT clinic_id, valor, source_hi_guide_id, valor_glosado
    INTO v_lancamento_clinic, v_lancamento_value, v_insurer_guide, v_glossed
    FROM public.lancamentos
   WHERE id = NEW.lancamento_id
   FOR UPDATE;

  IF NOT FOUND OR v_lancamento_clinic <> NEW.clinic_id THEN
    RAISE EXCEPTION 'payment transaction must reference a lancamento from the same clinic';
  END IF;

  IF NEW.kind = 'payment' AND v_insurer_guide IS NOT NULL THEN
    -- clinic_id no filtro: usa o índice (clinic_id, lancamento_id) em vez de varrer a tabela.
    SELECT COALESCE(sum(CASE kind WHEN 'payment' THEN amount ELSE -amount END), 0)
      INTO v_total
      FROM public.payment_transactions
     WHERE clinic_id = NEW.clinic_id AND lancamento_id = NEW.lancamento_id;
    IF v_total + NEW.amount + v_glossed > v_lancamento_value THEN
      RAISE EXCEPTION 'payment exceeds lancamento value';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.kind = 'payment' THEN
    -- R38: clinic_id no filtro usa o índice (clinic_id, lancamento_id) em vez de varrer
    -- a tabela inteira. Mesmo resultado: o lançamento já foi conferido como da mesma
    -- clínica acima e toda linha deste livro nasce com a clínica do seu lançamento.
    SELECT COALESCE(sum(amount), 0)
      INTO v_total
      FROM public.payment_transactions
     WHERE clinic_id = NEW.clinic_id
       AND lancamento_id = NEW.lancamento_id
       AND kind = 'payment';
    IF v_total + NEW.amount > v_lancamento_value THEN
      RAISE EXCEPTION 'payment exceeds lancamento value';
    END IF;
    RETURN NEW;
  END IF;

  -- NAO usar FOR UPDATE aqui: ele pede UPDATE em payment_transactions e quebra
  -- o contrato append-only. O lancamento ja esta bloqueado acima na mesma TX.
  SELECT clinic_id, lancamento_id, kind, amount
    INTO v_payment_clinic, v_payment_lancamento, v_payment_kind, v_payment_amount
    FROM public.payment_transactions
   WHERE id = NEW.original_payment_id;

  IF NOT FOUND
     OR v_payment_kind <> 'payment'
     OR v_payment_clinic <> NEW.clinic_id
     OR v_payment_lancamento <> NEW.lancamento_id
  THEN
    RAISE EXCEPTION 'refund must reference a payment from the same clinic and lancamento';
  END IF;

  SELECT COALESCE(sum(amount), 0)
    INTO v_total
    FROM public.payment_transactions
   WHERE original_payment_id = NEW.original_payment_id
     AND kind = 'refund';
  IF v_total + NEW.amount > v_payment_amount THEN
    RAISE EXCEPTION 'refund exceeds original payment available amount';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.validate_payment_transaction_insert() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0155-ledger-payment-sum-by-clinic')
  ON CONFLICT DO NOTHING;
