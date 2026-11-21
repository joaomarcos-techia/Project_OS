-- =====================================================================
-- 0153 — Convênios: ponte da conta da guia com o livro financeiro da clínica
-- (P1.10, P10.2, P10.3; resolve o R37). CANDIDATA: preparada e provada em Postgres
-- descartável; NÃO aplicada no DEV compartilhado nem em produção (aplicação só com
-- aprovação específica, pelo procedimento de docs/convenios/aplicacao-0153.md).
--
-- A fonte de verdade continua sendo a conta da guia (0152: hi_payment_allocations,
-- hi_glosses). Esta migration PROJETA essa conta no livro da clínica, de forma
-- determinística e idempotente, por um diário próprio (hi_ledger_entries) com chave
-- única por origem:
--
--   guia enviada à operadora      → 1 recebível em `lancamentos` (receber, 'auto',
--                                   forma 'convenio', SEM paciente e SEM atendimento:
--                                   fica fora do dunning, dos casos de cobrança e da
--                                   cobrança Asaas, que exigem paciente/atendimento)
--   alocação de pagamento         → 1 `payment_transactions` 'payment' (o Caixa vê o
--                                   dinheiro na data do pagamento da operadora)
--   estorno da alocação           → 1 'refund' ligado ao pagamento original (compensação)
--   glosa DEFINITIVA              → `lancamentos.valor_glosado` (baixa SEM caixa; glosa
--                                   em aberto, contestada ou em recurso não baixa nada)
--   guia substituída sem valores  → recebível 'cancelado'
--
-- O livro de caixa continua só com dinheiro: glosa nunca vira movimento em
-- payment_transactions (o rollup do Caixa trata qualquer outro tipo como saída).
-- Dinheiro recebido e ainda não alocado a guias fica na conciliação do Convênios
-- (hi_payment_balances.unreconciled_cents), não no livro, até alguém alocar.
--
-- Recebível de convênio é mantido SÓ por esta ponte: o Caixa e qualquer outro caminho
-- não registram pagamento, estorno nem cancelamento nele (gatilhos), e um pagamento
-- de operadora nunca é registrado como pagamento de paciente.
--
-- Comportamento particular: inalterado. Colunas novas nascem NULL/0 em todas as linhas
-- (ADD COLUMN com DEFAULT constante, sem reescrever a tabela); os CHECKs novos entram
-- NOT VALID e são validados depois (sem travar escrita); o CHECK de origem é o da
-- 0108 com uma alternativa a mais; a função de validação do livro é a da 0073 com um
-- ramo a mais, só para recebível de convênio.
--
-- Locks esperados (medidos em docs/convenios/aplicacao-0153.md): ACCESS EXCLUSIVE breve
-- em lancamentos (ADD COLUMN, troca de CHECK, gatilho) e SHARE no índice parcial novo
-- (zero linhas indexáveis). Rodar com lock_timeout e statement_timeout de sessão.
--
-- Sem BEGIN/COMMIT (o migrador envolve). Nada é apagado.
--
-- Reversão (só antes de existir recebível de convênio; procedimento completo no runbook):
--   DROP VIEW public.hi_ledger_drift, public.hi_insurer_receivables;
--   DROP TRIGGER hi_guides_ledger_sync ON public.hi_guides;
--   DROP TRIGGER hi_payment_allocations_ledger_sync ON public.hi_payment_allocations;
--   DROP TRIGGER hi_glosses_ledger_sync ON public.hi_glosses;
--   DROP TRIGGER lancamentos_insurer_receivable_guard ON public.lancamentos;
--   DROP TRIGGER payment_transactions_insurer_guard ON public.payment_transactions;
--   restaurar validate_payment_transaction_insert() da 0073 e lancamentos_auto_origin_chk da 0108;
--   DROP FUNCTION public.hi_ledger_*; DROP TABLE public.hi_ledger_entries;
--   ALTER TABLE public.lancamentos DROP CONSTRAINT lancamentos_valor_glosado_chk,
--     DROP CONSTRAINT lancamentos_insurer_receivable_chk, DROP COLUMN valor_glosado,
--     DROP COLUMN source_hi_guide_id;
--   DELETE FROM public._schema_version WHERE version = '0153-hi-ledger-bridge';
-- =====================================================================

-- ── lancamentos: linhagem da guia e baixa por glosa definitiva ─────────
ALTER TABLE public.lancamentos
  ADD COLUMN source_hi_guide_id uuid,
  ADD COLUMN valor_glosado numeric(12, 2) NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Glosa definitiva só em recebível de convênio, e pago + glosado nunca passa do valor.
ALTER TABLE public.lancamentos ADD CONSTRAINT lancamentos_valor_glosado_chk CHECK (
  valor_glosado >= 0
  AND valor_pago + valor_glosado <= valor
  AND (valor_glosado = 0 OR source_hi_guide_id IS NOT NULL)
) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.lancamentos VALIDATE CONSTRAINT lancamentos_valor_glosado_chk;
--> statement-breakpoint
-- Recebível de convênio: a receber, automático, sem paciente, sem atendimento, sem estorno.
ALTER TABLE public.lancamentos ADD CONSTRAINT lancamentos_insurer_receivable_chk CHECK (
  source_hi_guide_id IS NULL OR (
    tipo = 'receber' AND created_via = 'auto' AND appointment_id IS NULL AND patient_id IS NULL
    AND source_patient_charge_id IS NULL AND reverses_lancamento_id IS NULL AND payment_method = 'convenio'
  )
) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.lancamentos VALIDATE CONSTRAINT lancamentos_insurer_receivable_chk;
--> statement-breakpoint
-- Origem obrigatória do automático (0108) + a guia de convênio.
ALTER TABLE public.lancamentos DROP CONSTRAINT IF EXISTS lancamentos_auto_origin_chk;
--> statement-breakpoint
ALTER TABLE public.lancamentos ADD CONSTRAINT lancamentos_auto_origin_chk CHECK (
  created_via <> 'auto'
  OR appointment_id IS NOT NULL
  OR (source_patient_charge_id IS NOT NULL AND financial_expense_kind IS NOT NULL)
  OR source_hi_guide_id IS NOT NULL
) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.lancamentos VALIDATE CONSTRAINT lancamentos_auto_origin_chk;
--> statement-breakpoint
-- Uma guia = um recebível (trava de idempotência; zero linhas hoje).
CREATE UNIQUE INDEX lancamentos_hi_guide_uniq ON public.lancamentos (clinic_id, source_hi_guide_id)
  WHERE source_hi_guide_id IS NOT NULL;
--> statement-breakpoint

-- ── Diário da ponte: um movimento por origem, só inclusão ──────────────
CREATE TABLE public.hi_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  guide_id uuid NOT NULL,
  lancamento_id uuid NOT NULL REFERENCES public.lancamentos(id),
  kind text NOT NULL,
  source_id uuid NOT NULL,
  amount_cents bigint NOT NULL,
  payment_transaction_id uuid REFERENCES public.payment_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_ledger_entries_guide_fk FOREIGN KEY (clinic_id, guide_id) REFERENCES public.hi_guides (clinic_id, id),
  CONSTRAINT hi_ledger_entries_kind_chk CHECK (
    kind IN ('receivable_opened', 'payment', 'payment_reversal', 'gloss_final', 'receivable_cancelled')
  ),
  CONSTRAINT hi_ledger_entries_amount_chk CHECK (amount_cents >= 0 AND amount_cents <= 99999999999),
  CONSTRAINT hi_ledger_entries_tx_chk CHECK ((kind IN ('payment', 'payment_reversal')) = (payment_transaction_id IS NOT NULL)),
  -- A mesma alocação, glosa ou guia não gera dois movimentos do mesmo tipo.
  CONSTRAINT hi_ledger_entries_source_uniq UNIQUE (clinic_id, kind, source_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX hi_ledger_entries_tx_uniq ON public.hi_ledger_entries (payment_transaction_id)
  WHERE payment_transaction_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX hi_ledger_entries_lancamento_idx ON public.hi_ledger_entries (clinic_id, lancamento_id);
--> statement-breakpoint
CREATE INDEX hi_ledger_entries_guide_idx ON public.hi_ledger_entries (clinic_id, guide_id);
--> statement-breakpoint
CREATE TRIGGER hi_ledger_entries_immutable BEFORE UPDATE ON public.hi_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.hi_block_mutation();
--> statement-breakpoint

-- ── Quem pode mexer num recebível de convênio ─────────────────────────
-- Só o dono das funções da ponte (SECURITY DEFINER): dentro delas `current_user` é o
-- dono; no runtime (qoro_runtime/authenticated) não é.
-- plpgsql (não sql): o nome da função da ponte é resolvido na execução, não na criação.
CREATE OR REPLACE FUNCTION public.hi_ledger_is_bridge() RETURNS boolean
  LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN current_user::text = (
    SELECT p.proowner::regrole::text FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.hi_ledger_sync_guide(uuid, uuid)'::regprocedure
  );
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hi_guard_insurer_receivable() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.source_hi_guide_id IS NOT NULL AND NOT public.hi_ledger_is_bridge() THEN
      RAISE EXCEPTION 'Recebível de convênio nasce só do envio da guia à operadora (módulo Convênios).'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_hi_guide_id IS DISTINCT FROM OLD.source_hi_guide_id THEN
    RAISE EXCEPTION 'A guia de origem de um lançamento é imutável.' USING ERRCODE = '42501';
  END IF;
  IF OLD.source_hi_guide_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT public.hi_ledger_is_bridge() THEN
    RAISE EXCEPTION 'Recebível de convênio é mantido pelo módulo Convênios (pagamento, glosa e estorno na conta da guia).'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.valor_glosado < OLD.valor_glosado THEN
    RAISE EXCEPTION 'Glosa definitiva não volta.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guard_insurer_receivable() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER lancamentos_insurer_receivable_guard BEFORE INSERT OR UPDATE ON public.lancamentos
  FOR EACH ROW EXECUTE FUNCTION public.hi_guard_insurer_receivable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hi_guard_insurer_payment() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  -- Pagamento particular sai aqui, sem consultar o catálogo.
  IF NOT EXISTS (
    SELECT 1 FROM public.lancamentos l WHERE l.id = NEW.lancamento_id AND l.source_hi_guide_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT public.hi_ledger_is_bridge() THEN
    RAISE EXCEPTION 'Pagamento de operadora é registrado na conta da guia (Convênios), nunca como pagamento no Caixa.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guard_insurer_payment() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER payment_transactions_insurer_guard BEFORE INSERT ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.hi_guard_insurer_payment();
--> statement-breakpoint

-- Validação do livro: a da 0073 SEM MUDANÇA para todo lançamento que não é de convênio.
-- No recebível de convênio o limite é o pago LÍQUIDO (o estorno devolve capacidade:
-- alocação errada, estornada e refeita) mais a glosa definitiva.
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
    SELECT COALESCE(sum(amount), 0)
      INTO v_total
      FROM public.payment_transactions
     WHERE lancamento_id = NEW.lancamento_id
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

-- ── A projeção: conta da guia → livro da clínica (idempotente) ─────────
CREATE OR REPLACE FUNCTION public.hi_ledger_sync_guide(p_clinic_id uuid, p_guide_id uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_guide public.hi_guides%ROWTYPE;
  v_lanc public.lancamentos%ROWTYPE;
  v_insurer text;
  v_tz text;
  v_tx uuid;
  v_orig uuid;
  v_paid bigint;
  v_glossed bigint;
  v_status public.lancamento_status;
  r record;
BEGIN
  -- Interna: sem EXECUTE para nenhuma role do app. Os gatilhos a chamam com a clínica DA
  -- PRÓPRIA LINHA alterada; o reprocessamento exposto (hi_ledger_sync_clinic) confere a
  -- sessão antes. Não exige sessão aqui: uma mudança de estado feita pelo código do banco
  -- fora de sessão (manutenção) não pode falhar nem deixar o livro para trás.
  SELECT * INTO v_guide FROM public.hi_guides WHERE clinic_id = p_clinic_id AND id = p_guide_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'none';
  END IF;
  SELECT * INTO v_lanc FROM public.lancamentos
   WHERE clinic_id = p_clinic_id AND source_hi_guide_id = p_guide_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Faturado = enviado à operadora. Antes disso não há recebível.
    IF v_guide.status NOT IN ('sent', 'under_review', 'paid', 'partially_paid', 'partially_glossed', 'fully_glossed', 'closed') THEN
      RETURN 'not_billed';
    END IF;
    SELECT i.name INTO v_insurer FROM public.hi_insurers i WHERE i.clinic_id = p_clinic_id AND i.id = v_guide.insurer_id;
    INSERT INTO public.lancamentos (clinic_id, tipo, descricao, valor, valor_pago, valor_glosado, status, payment_method,
                                    created_via, source_hi_guide_id, created_by)
    VALUES (p_clinic_id, 'receber', left(format('Convênio %s — guia %s', coalesce(v_insurer, 'operadora'), v_guide.number), 200),
            round(v_guide.total_value_cents::numeric / 100, 2), 0, 0, 'pendente', 'convenio', 'auto', p_guide_id,
            public.hi_session_actor())
    RETURNING * INTO v_lanc;
    INSERT INTO public.hi_ledger_entries (clinic_id, guide_id, lancamento_id, kind, source_id, amount_cents)
    VALUES (p_clinic_id, p_guide_id, v_lanc.id, 'receivable_opened', p_guide_id, v_guide.total_value_cents);
  ELSIF round(v_lanc.valor * 100)::bigint <> v_guide.total_value_cents THEN
    RAISE EXCEPTION 'Recebível de convênio diverge do faturado da guia (% x % centavos).',
      round(v_lanc.valor * 100)::bigint, v_guide.total_value_cents USING ERRCODE = 'XX000';
  END IF;

  -- Dinheiro: cada alocação vira um pagamento; cada estorno, o reembolso do pagamento original.
  SELECT coalesce(c.timezone, 'America/Sao_Paulo') INTO v_tz FROM public.clinics c WHERE c.id = p_clinic_id;
  FOR r IN
    SELECT a.id, a.kind, a.amount_cents, a.reverses_id, a.reason, a.created_by, a.created_at, p.paid_on
      FROM public.hi_payment_allocations a
      JOIN public.hi_payments p ON p.clinic_id = a.clinic_id AND p.id = a.payment_id
     WHERE a.clinic_id = p_clinic_id AND a.guide_id = p_guide_id
       AND NOT EXISTS (
         SELECT 1 FROM public.hi_ledger_entries e
          WHERE e.clinic_id = p_clinic_id AND e.source_id = a.id AND e.kind IN ('payment', 'payment_reversal')
       )
     ORDER BY (a.kind = 'reversal'), a.created_at, a.id
  LOOP
    IF r.kind = 'allocation' THEN
      INSERT INTO public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method, occurred_at, created_by)
      VALUES (p_clinic_id, v_lanc.id, 'payment', round(r.amount_cents::numeric / 100, 2), 'convenio',
              (r.paid_on + time '12:00') AT TIME ZONE v_tz, r.created_by)
      RETURNING id INTO v_tx;
      INSERT INTO public.hi_ledger_entries (clinic_id, guide_id, lancamento_id, kind, source_id, amount_cents, payment_transaction_id)
      VALUES (p_clinic_id, p_guide_id, v_lanc.id, 'payment', r.id, r.amount_cents, v_tx);
    ELSE
      SELECT e.payment_transaction_id INTO v_orig FROM public.hi_ledger_entries e
       WHERE e.clinic_id = p_clinic_id AND e.kind = 'payment' AND e.source_id = r.reverses_id;
      IF v_orig IS NULL THEN
        RAISE EXCEPTION 'Estorno sem o pagamento original no livro financeiro.' USING ERRCODE = 'XX000';
      END IF;
      INSERT INTO public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method, occurred_at,
                                              original_payment_id, reason, created_by)
      VALUES (p_clinic_id, v_lanc.id, 'refund', round(r.amount_cents::numeric / 100, 2), 'convenio', r.created_at,
              v_orig, left('Estorno de pagamento da operadora: ' || r.reason, 500), r.created_by)
      RETURNING id INTO v_tx;
      INSERT INTO public.hi_ledger_entries (clinic_id, guide_id, lancamento_id, kind, source_id, amount_cents, payment_transaction_id)
      VALUES (p_clinic_id, p_guide_id, v_lanc.id, 'payment_reversal', r.id, r.amount_cents, v_tx);
    END IF;
  END LOOP;

  -- Glosa DEFINITIVA (decisão final, gravada uma vez): baixa sem caixa. Em aberto não baixa.
  INSERT INTO public.hi_ledger_entries (clinic_id, guide_id, lancamento_id, kind, source_id, amount_cents)
  SELECT p_clinic_id, p_guide_id, v_lanc.id, 'gloss_final', g.id, g.definitive_cents
    FROM public.hi_glosses g
   WHERE g.clinic_id = p_clinic_id AND g.guide_id = p_guide_id AND g.status = 'definitive' AND g.definitive_cents > 0
     AND NOT EXISTS (
       SELECT 1 FROM public.hi_ledger_entries e
        WHERE e.clinic_id = p_clinic_id AND e.kind = 'gloss_final' AND e.source_id = g.id
     );

  SELECT coalesce(sum(CASE e.kind WHEN 'payment' THEN e.amount_cents WHEN 'payment_reversal' THEN -e.amount_cents ELSE 0 END), 0),
         coalesce(sum(CASE e.kind WHEN 'gloss_final' THEN e.amount_cents ELSE 0 END), 0)
    INTO v_paid, v_glossed
    FROM public.hi_ledger_entries e
   WHERE e.clinic_id = p_clinic_id AND e.lancamento_id = v_lanc.id;

  -- Guia substituída (só possível antes de pagamento ou glosa): o recebível é cancelado.
  IF v_guide.status IN ('replaced', 'cancelled') THEN
    IF v_paid <> 0 OR v_glossed <> 0 THEN
      RAISE EXCEPTION 'Guia substituída com valores na conta: concilie antes.' USING ERRCODE = '55000';
    END IF;
    IF v_lanc.status <> 'cancelado' THEN
      UPDATE public.lancamentos SET status = 'cancelado', updated_at = now() WHERE id = v_lanc.id;
      INSERT INTO public.hi_ledger_entries (clinic_id, guide_id, lancamento_id, kind, source_id, amount_cents)
      VALUES (p_clinic_id, p_guide_id, v_lanc.id, 'receivable_cancelled', p_guide_id, v_guide.total_value_cents)
      ON CONFLICT ON CONSTRAINT hi_ledger_entries_source_uniq DO NOTHING;
    END IF;
    RETURN 'cancelled';
  END IF;

  -- Estado: pagamento parcial nunca quita. Quitado = nada mais a receber (pago + glosa definitiva).
  v_status := CASE
    WHEN v_paid = 0 AND v_glossed = 0 THEN 'pendente'
    WHEN v_paid + v_glossed >= v_guide.total_value_cents AND v_paid = 0 THEN 'cancelado'
    WHEN v_paid + v_glossed >= v_guide.total_value_cents THEN 'pago'
    ELSE 'parcial'
  END;
  IF v_lanc.valor_pago IS DISTINCT FROM round(v_paid::numeric / 100, 2)
     OR v_lanc.valor_glosado IS DISTINCT FROM round(v_glossed::numeric / 100, 2)
     OR v_lanc.status IS DISTINCT FROM v_status THEN
    UPDATE public.lancamentos
       SET valor_pago = round(v_paid::numeric / 100, 2),
           valor_glosado = round(v_glossed::numeric / 100, 2),
           status = v_status,
           paid_at = CASE WHEN v_status = 'pago' THEN coalesce(paid_at, now()) ELSE NULL END,
           updated_at = now()
     WHERE id = v_lanc.id;
  END IF;
  RETURN v_status::text;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_ledger_sync_guide(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint

-- Reprocessamento da clínica da sessão (idempotente): mesma projeção para cada guia faturada.
CREATE OR REPLACE FUNCTION public.hi_ledger_sync_clinic(p_clinic_id uuid) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  PERFORM public.hi_session_clinic(p_clinic_id);
  FOR r IN
    SELECT g.id FROM public.hi_guides g
     WHERE g.clinic_id = p_clinic_id
       AND (g.status IN ('sent', 'under_review', 'paid', 'partially_paid', 'partially_glossed', 'fully_glossed', 'closed')
            OR EXISTS (SELECT 1 FROM public.lancamentos l WHERE l.clinic_id = p_clinic_id AND l.source_hi_guide_id = g.id))
     ORDER BY g.id
  LOOP
    PERFORM public.hi_ledger_sync_guide(p_clinic_id, r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_ledger_sync_clinic(uuid) FROM PUBLIC, anon;
--> statement-breakpoint

-- Gatilhos: qualquer caminho que muda a conta da guia atualiza o livro na MESMA transação.
CREATE OR REPLACE FUNCTION public.hi_ledger_on_guide_status() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.hi_ledger_sync_guide(NEW.clinic_id, NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hi_ledger_on_account_change() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.hi_ledger_sync_guide(NEW.clinic_id, NEW.guide_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_ledger_on_guide_status(), public.hi_ledger_on_account_change() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_guides_ledger_sync AFTER UPDATE OF status ON public.hi_guides
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status) EXECUTE FUNCTION public.hi_ledger_on_guide_status();
--> statement-breakpoint
CREATE TRIGGER hi_payment_allocations_ledger_sync AFTER INSERT ON public.hi_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.hi_ledger_on_account_change();
--> statement-breakpoint
CREATE TRIGGER hi_glosses_ledger_sync AFTER INSERT OR UPDATE OF status ON public.hi_glosses
  FOR EACH ROW WHEN (NEW.status = 'definitive') EXECUTE FUNCTION public.hi_ledger_on_account_change();
--> statement-breakpoint

-- ── Conferência e visão do gestor ──────────────────────────────────────
-- Divergência entre a conta da guia (fonte) e o livro (projeção): deve ser sempre vazia.
CREATE VIEW public.hi_ledger_drift WITH (security_invoker = true) AS
SELECT a.clinic_id, a.guide_id, a.insurer_id, a.number, a.status AS guide_status,
       a.billed_cents, a.paid_cents, a.gloss_definitive_cents,
       l.id AS lancamento_id,
       round(l.valor * 100)::bigint AS ledger_billed_cents,
       round(l.valor_pago * 100)::bigint AS ledger_paid_cents,
       round(l.valor_glosado * 100)::bigint AS ledger_gloss_cents,
       CASE
         WHEN l.id IS NULL THEN 'missing_receivable'
         WHEN round(l.valor * 100)::bigint <> a.billed_cents THEN 'billed_mismatch'
         WHEN round(l.valor_pago * 100)::bigint <> a.paid_cents THEN 'paid_mismatch'
         WHEN round(l.valor_glosado * 100)::bigint <> a.gloss_definitive_cents THEN 'gloss_mismatch'
       END AS drift
  FROM public.hi_guide_accounts a
  LEFT JOIN public.lancamentos l ON l.clinic_id = a.clinic_id AND l.source_hi_guide_id = a.guide_id
 WHERE l.id IS NULL
    OR round(l.valor * 100)::bigint <> a.billed_cents
    OR round(l.valor_pago * 100)::bigint <> a.paid_cents
    OR round(l.valor_glosado * 100)::bigint <> a.gloss_definitive_cents
UNION ALL
-- Recebível vivo de guia que saiu do faturamento (substituída) e não foi cancelado.
SELECT l.clinic_id, g.id, g.insurer_id, g.number, g.status, g.total_value_cents, NULL, NULL, l.id,
       round(l.valor * 100)::bigint, round(l.valor_pago * 100)::bigint, round(l.valor_glosado * 100)::bigint,
       'stale_receivable'
  FROM public.lancamentos l
  JOIN public.hi_guides g ON g.clinic_id = l.clinic_id AND g.id = l.source_hi_guide_id
 WHERE l.source_hi_guide_id IS NOT NULL AND g.status IN ('replaced', 'cancelled') AND l.status <> 'cancelado';
--> statement-breakpoint
-- Por operadora: faturado, recebido, glosa (em aberto e definitiva), a receber e dinheiro não conciliado.
CREATE VIEW public.hi_insurer_receivables WITH (security_invoker = true) AS
SELECT a.clinic_id, a.insurer_id,
       count(*)::int AS guides,
       sum(a.billed_cents)::bigint AS billed_cents,
       sum(a.paid_cents)::bigint AS paid_cents,
       sum(a.gloss_open_cents)::bigint AS gloss_open_cents,
       sum(a.gloss_definitive_cents)::bigint AS gloss_definitive_cents,
       sum(a.pending_cents)::bigint AS pending_cents,
       coalesce((SELECT sum(b.unreconciled_cents) FROM public.hi_payment_balances b
                  WHERE b.clinic_id = a.clinic_id AND b.insurer_id = a.insurer_id), 0)::bigint AS unreconciled_cents
  FROM public.hi_guide_accounts a
 GROUP BY a.clinic_id, a.insurer_id;
--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_ledger_entries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_ledger_entries FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_ledger_entries_tenant_access ON public.hi_ledger_entries FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

-- Runtime: só leitura; toda escrita pela ponte (gatilhos e funções).
REVOKE ALL ON public.hi_ledger_entries FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
GRANT SELECT ON public.hi_ledger_entries TO authenticated, service_role;--> statement-breakpoint
REVOKE ALL ON public.hi_ledger_drift, public.hi_insurer_receivables FROM PUBLIC, anon;--> statement-breakpoint
GRANT SELECT ON public.hi_ledger_drift, public.hi_insurer_receivables TO authenticated, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hi_ledger_sync_clinic(uuid) TO authenticated, service_role;--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0153-hi-ledger-bridge')
  ON CONFLICT DO NOTHING;
