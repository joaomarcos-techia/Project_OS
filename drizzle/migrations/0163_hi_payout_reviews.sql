-- =====================================================================
-- 0163 — Convênios: revisão humana do repasse quando a guia sai do atendimento (D-6).
--
-- Contrato aprovado pelo fundador em 16/11/2026: docs/convenios/cancelamento-repasse-contrato.md
-- (14 pontos), com as decisões: quatro olhos NÃO obrigatório por padrão, mas a clínica pode exigir
-- revisor independente (segregação) e o risco financeiro também exige (limite em centavos);
-- backfill só no DEV, por script próprio, só em clínica sintética (NÃO nesta migration).
-- Autorizada para o DEV; NÃO autorizada em produção. Prova em Postgres descartável:
-- scripts/security/health-insurance-payout-db.ts (seções 14 e 15).
--
-- O problema medido (seção 14 do harness): com a guia cancelada e o repasse autorizado e não pago,
-- uma chave de idempotência NOVA ainda registrava o pagamento do saldo.
--
-- O QUE FAZ (tudo nas tabelas hi_* do TISS; nenhum livro, recebível, lancamentos ou Caixa):
--   1. hi_payout_reviews: uma revisão por repasse quando o atendimento fica SEM guia viva (guia
--      cancelada, ou substituída sem substituta viva) e o repasse tem saldo autorizado não pago
--      (revisão "blocking") ou já foi pago (revisão de ciência, "acknowledgement");
--   2. abertura no COMMIT da mesma transação da guia (gatilho de constraint DEFERRABLE INITIALLY
--      DEFERRED): na substituição aprovada, a substituta já está viva quando a checagem roda, e
--      nenhuma revisão nasce (contrato, ponto 1). Qualquer caminho (tela, script, função) passa;
--   3. idempotência: uma revisão ABERTA por repasse (índice único parcial; ON CONFLICT DO NOTHING);
--   4. o guarda dos movimentos (nova versão de hi_payout_movement_guard, só acrescenta a checagem)
--      recusa AUTORIZAÇÃO e PAGAMENTO enquanto houver revisão aberta (55000); o ajuste continua;
--   5. decisão humana por hi_payout_review_decide(): manter (libera o pagamento até o autorizado),
--      reduzir (grava o ajuste negativo no mesmo ato) ou ciência (repasse já pago; nada é
--      compensado). Motivo obrigatório; valores guardados na abertura e na decisão; depois de
--      decidida, a revisão não muda (gatilho de imutabilidade);
--   6. segregação: hi_clinic_settings.payout_review_segregation (padrão: desligada) e
--      payout_review_independent_above_cents (padrão: sem limite). Ligada, ou com o saldo em
--      jogo no limite ou acima (manter/reduzir), quem cancelou a guia não decide a revisão;
--   7. hi_payout_positions ganha open_review_id NO FIM (as colunas de antes não mudam).
--
-- O QUE NÃO FAZ: não apaga nem estorna pagamento; não compensa nem cobra o profissional; não muda
-- hi_payouts.status; não toca o repasse particular (professional_payouts) nem o domínio financeiro
-- compartilhado; não abre revisão para os casos já existentes (backfill é script do DEV).
--
-- Sem BEGIN/COMMIT: o migrator do Drizzle roda tudo numa transação.
--
-- REVERSÃO (com o código que conhece a revisão fora do ar):
--   DROP TRIGGER IF EXISTS hi_guides_zz_payout_review ON public.hi_guides;
--   DROP FUNCTION IF EXISTS public.hi_guide_payout_review_trigger();
--   DROP FUNCTION IF EXISTS public.hi_payout_review_decide(uuid, uuid, text, text, bigint);
--   CREATE OR REPLACE VIEW public.hi_payout_positions ... (definição da 0157, sem open_review_id:
--     exige DROP VIEW + CREATE, porque coluna não sai por REPLACE);
--   CREATE OR REPLACE FUNCTION public.hi_payout_movement_guard() ... (corpo da 0157);
--   DROP FUNCTION IF EXISTS public.hi_payout_reviews_open_for_guide(uuid, uuid, text, text);
--   DROP TABLE IF EXISTS public.hi_payout_reviews;
--   ALTER TABLE public.hi_clinic_settings DROP CONSTRAINT IF EXISTS hi_clinic_settings_payout_review_chk,
--     DROP COLUMN IF EXISTS payout_review_independent_above_cents, DROP COLUMN IF EXISTS payout_review_segregation;
--   DELETE FROM public._schema_version WHERE version = '0163-hi-payout-reviews';
--   (texto completo em docs/convenios/reversao-0163-0164.sql)
-- =====================================================================

ALTER TABLE public.hi_clinic_settings
  ADD COLUMN payout_review_segregation boolean NOT NULL DEFAULT false,
  ADD COLUMN payout_review_independent_above_cents bigint;
--> statement-breakpoint
ALTER TABLE public.hi_clinic_settings ADD CONSTRAINT hi_clinic_settings_payout_review_chk
  CHECK (payout_review_independent_above_cents IS NULL
         OR payout_review_independent_above_cents BETWEEN 0 AND 9999999999);
--> statement-breakpoint

CREATE TABLE public.hi_payout_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  payout_id uuid NOT NULL,
  guide_id uuid NOT NULL,
  guide_status text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  opened_via text NOT NULL,
  opened_by uuid,
  opened_at timestamptz NOT NULL DEFAULT now(),
  open_authorized_cents bigint NOT NULL,
  open_adjustments_cents bigint NOT NULL,
  open_settled_cents bigint NOT NULL,
  decision text,
  decision_reason text,
  reduce_cents bigint,
  decided_by uuid,
  decided_at timestamptz,
  decided_authorized_cents bigint,
  decided_adjustments_cents bigint,
  decided_settled_cents bigint,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT hi_payout_reviews_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_payout_reviews_payout_fk FOREIGN KEY (clinic_id, payout_id)
    REFERENCES public.hi_payouts (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_payout_reviews_guide_fk FOREIGN KEY (clinic_id, guide_id)
    REFERENCES public.hi_guides (clinic_id, id),
  CONSTRAINT hi_payout_reviews_guide_status_chk CHECK (guide_status IN ('cancelled', 'replaced')),
  CONSTRAINT hi_payout_reviews_kind_chk CHECK (kind IN ('blocking', 'acknowledgement')),
  CONSTRAINT hi_payout_reviews_via_chk CHECK (opened_via IN ('guide_transition', 'backfill')),
  CONSTRAINT hi_payout_reviews_state_chk CHECK (
    (status = 'open'
      AND decision IS NULL AND decision_reason IS NULL AND reduce_cents IS NULL
      AND decided_by IS NULL AND decided_at IS NULL
      AND decided_authorized_cents IS NULL AND decided_adjustments_cents IS NULL AND decided_settled_cents IS NULL)
    OR (status = 'decided'
      AND decision IN ('maintain', 'reduce', 'acknowledge')
      AND decision_reason IS NOT NULL AND char_length(btrim(decision_reason)) BETWEEN 10 AND 500
      AND decided_by IS NOT NULL AND decided_at IS NOT NULL
      AND decided_authorized_cents IS NOT NULL AND decided_adjustments_cents IS NOT NULL
      AND decided_settled_cents IS NOT NULL
      AND ((decision = 'reduce' AND reduce_cents IS NOT NULL AND reduce_cents BETWEEN 1 AND 9999999999)
           OR (decision <> 'reduce' AND reduce_cents IS NULL)))
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX hi_payout_reviews_open_uniq ON public.hi_payout_reviews (clinic_id, payout_id)
  WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX hi_payout_reviews_payout_idx ON public.hi_payout_reviews (clinic_id, payout_id);
--> statement-breakpoint

-- Abre as revisões dos repasses cujo atendimento ficou sem guia viva por causa desta guia.
-- Trava cada repasse (FOR UPDATE), a mesma linha que o guarda dos movimentos trava: o que
-- confirmar primeiro vence, e a revisão nasce com os valores do momento. Interna (sem EXECUTE para
-- authenticated): só o gatilho e o backfill do DEV a chamam.
CREATE OR REPLACE FUNCTION public.hi_payout_reviews_open_for_guide(
  p_clinic uuid, p_guide uuid, p_guide_status text, p_via text
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_payout record;
  v_auth bigint;
  v_adj bigint;
  v_set bigint;
  v_id uuid;
  v_n integer := 0;
BEGIN
  IF p_guide_status NOT IN ('cancelled', 'replaced') OR p_via NOT IN ('guide_transition', 'backfill') THEN
    RAISE EXCEPTION 'Abertura de revisão de repasse com parâmetros inválidos.' USING ERRCODE = '22023';
  END IF;
  FOR v_payout IN
    SELECT p.id
      FROM public.hi_payouts p
     WHERE p.clinic_id = p_clinic AND p.status = 'active'
       AND p.appointment_id IN (
         SELECT gi.appointment_id FROM public.hi_guide_items gi
          WHERE gi.clinic_id = p_clinic AND gi.guide_id = p_guide AND gi.appointment_id IS NOT NULL)
       AND NOT EXISTS (
         SELECT 1 FROM public.hi_guide_items o
          WHERE o.clinic_id = p_clinic AND o.appointment_id = p.appointment_id AND o.live AND o.guide_id <> p_guide)
     ORDER BY p.id
     FOR UPDATE OF p
  LOOP
    SELECT coalesce(sum(m.amount_cents) FILTER (WHERE m.kind = 'authorization'), 0),
           coalesce(sum(m.amount_cents) FILTER (WHERE m.kind = 'adjustment'), 0),
           coalesce(sum(m.amount_cents) FILTER (WHERE m.kind = 'settlement'), 0)
      INTO v_auth, v_adj, v_set
      FROM public.hi_payout_movements m WHERE m.clinic_id = p_clinic AND m.payout_id = v_payout.id;
    IF v_auth + v_adj - v_set > 0 OR v_set > 0 THEN
      v_id := NULL;
      INSERT INTO public.hi_payout_reviews (
        clinic_id, payout_id, guide_id, guide_status, kind, opened_via, opened_by,
        open_authorized_cents, open_adjustments_cents, open_settled_cents)
      VALUES (
        p_clinic, v_payout.id, p_guide, p_guide_status,
        CASE WHEN v_auth + v_adj - v_set > 0 THEN 'blocking' ELSE 'acknowledgement' END,
        p_via, public.hi_session_actor(), v_auth, v_adj, v_set)
      ON CONFLICT (clinic_id, payout_id) WHERE status = 'open' DO NOTHING
      RETURNING id INTO v_id;
      IF v_id IS NOT NULL THEN
        v_n := v_n + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_payout_reviews_open_for_guide(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hi_guide_payout_review_trigger() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'replaced') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.hi_payout_reviews_open_for_guide(NEW.clinic_id, NEW.id, NEW.status, 'guide_transition');
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guide_payout_review_trigger() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- Deferido para o COMMIT: vê o estado final da transação (substituta aprovada já viva).
CREATE CONSTRAINT TRIGGER hi_guides_zz_payout_review
  AFTER UPDATE OF status ON public.hi_guides
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status IN ('cancelled', 'replaced') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.hi_guide_payout_review_trigger();
--> statement-breakpoint

-- Imutável depois de decidida; aberta, só vira "decidida" (pela função de decisão).
CREATE OR REPLACE FUNCTION public.hi_payout_review_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'Revisão de repasse já decidida: não muda.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> 'decided'
     OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id OR NEW.payout_id IS DISTINCT FROM OLD.payout_id
     OR NEW.guide_id IS DISTINCT FROM OLD.guide_id OR NEW.guide_status IS DISTINCT FROM OLD.guide_status
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.opened_via IS DISTINCT FROM OLD.opened_via
     OR NEW.opened_by IS DISTINCT FROM OLD.opened_by OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
     OR NEW.open_authorized_cents IS DISTINCT FROM OLD.open_authorized_cents
     OR NEW.open_adjustments_cents IS DISTINCT FROM OLD.open_adjustments_cents
     OR NEW.open_settled_cents IS DISTINCT FROM OLD.open_settled_cents
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Revisão de repasse: só a decisão muda a revisão aberta.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_payout_review_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_payout_reviews_guard BEFORE UPDATE ON public.hi_payout_reviews
  FOR EACH ROW EXECUTE FUNCTION public.hi_payout_review_guard();
--> statement-breakpoint

-- Decisão humana. A clínica e a pessoa vêm da SESSÃO (withTenant), nunca do chamador.
-- Classe C (preservação de obrigação, D-6): sem portão comercial e sem exigir o módulo ligado.
CREATE OR REPLACE FUNCTION public.hi_payout_review_decide(
  p_clinic uuid, p_review uuid, p_decision text, p_reason text, p_reduce_cents bigint
) RETURNS TABLE (review_id uuid, payout_id uuid, decision text, reduce_cents bigint, due_cents bigint)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := public.hi_session_actor();
  v_r public.hi_payout_reviews%ROWTYPE;
  v_auth bigint;
  v_adj bigint;
  v_set bigint;
  v_due bigint;
  v_seg boolean;
  v_limit bigint;
BEGIN
  PERFORM public.hi_session_clinic(p_clinic);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Decisão de revisão exige a pessoa da sessão.' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('maintain', 'reduce', 'acknowledge') THEN
    RAISE EXCEPTION 'Decisão de revisão inválida.' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'Informe o motivo da decisão (10 a 500 caracteres).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_r FROM public.hi_payout_reviews r WHERE r.clinic_id = p_clinic AND r.id = p_review FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Revisão de repasse inexistente nesta clínica.' USING ERRCODE = 'P0002';
  END IF;
  IF v_r.status <> 'open' THEN
    RAISE EXCEPTION 'Esta revisão já foi decidida.' USING ERRCODE = '55000', CONSTRAINT = 'hi_payout_review_decided';
  END IF;
  -- Mesma trava do guarda dos movimentos: nenhuma autorização ou pagamento entra no meio.
  PERFORM 1 FROM public.hi_payouts p WHERE p.clinic_id = p_clinic AND p.id = v_r.payout_id FOR UPDATE;
  SELECT coalesce(sum(m.amount_cents) FILTER (WHERE m.kind = 'authorization'), 0),
         coalesce(sum(m.amount_cents) FILTER (WHERE m.kind = 'adjustment'), 0),
         coalesce(sum(m.amount_cents) FILTER (WHERE m.kind = 'settlement'), 0)
    INTO v_auth, v_adj, v_set
    FROM public.hi_payout_movements m WHERE m.clinic_id = p_clinic AND m.payout_id = v_r.payout_id;
  v_due := v_auth + v_adj - v_set;

  SELECT s.payout_review_segregation, s.payout_review_independent_above_cents INTO v_seg, v_limit
    FROM public.hi_clinic_settings s WHERE s.clinic_id = p_clinic;
  IF v_r.opened_by IS NOT NULL AND v_r.opened_by = v_actor
     AND (coalesce(v_seg, false)
          OR (v_limit IS NOT NULL AND p_decision IN ('maintain', 'reduce') AND greatest(v_due, 0) >= v_limit)) THEN
    RAISE EXCEPTION 'Esta revisão exige outra pessoa: quem tirou a guia do atendimento não decide (segregação da clínica ou valor em jogo).'
      USING ERRCODE = '42501', CONSTRAINT = 'hi_payout_review_segregation';
  END IF;

  IF p_decision IN ('maintain', 'reduce') AND v_due <= 0 THEN
    RAISE EXCEPTION 'Não há saldo autorizado a manter ou reduzir: registre ciência.' USING ERRCODE = '22023';
  END IF;
  -- Ciência não libera saldo: com saldo autorizado não pago, só manter ou reduzir (senão a
  -- ciência viraria um "manter" sem a regra de segregação).
  IF p_decision = 'acknowledge' AND v_due > 0 THEN
    RAISE EXCEPTION 'Há saldo autorizado não pago: decida manter ou reduzir.' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'reduce' THEN
    IF p_reduce_cents IS NULL OR p_reduce_cents < 1 OR p_reduce_cents > v_due THEN
      RAISE EXCEPTION 'Redução de 1 centavo até o saldo autorizado (% centavos).', v_due USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.hi_payout_movements (clinic_id, payout_id, kind, amount_cents, reason, idempotency_key, created_by)
    VALUES (p_clinic, v_r.payout_id, 'adjustment', -p_reduce_cents, btrim(p_reason), 'payout-review:' || v_r.id::text, v_actor);
    v_adj := v_adj - p_reduce_cents;
    v_due := v_due - p_reduce_cents;
  ELSIF p_reduce_cents IS NOT NULL THEN
    RAISE EXCEPTION 'Valor de redução só na decisão "reduzir".' USING ERRCODE = '22023';
  END IF;

  UPDATE public.hi_payout_reviews r
     SET status = 'decided', decision = p_decision, decision_reason = btrim(p_reason),
         reduce_cents = CASE WHEN p_decision = 'reduce' THEN p_reduce_cents END,
         decided_by = v_actor, decided_at = now(),
         decided_authorized_cents = v_auth, decided_adjustments_cents = v_adj, decided_settled_cents = v_set,
         version = r.version + 1
   WHERE r.clinic_id = p_clinic AND r.id = v_r.id;

  review_id := v_r.id;
  payout_id := v_r.payout_id;
  decision := p_decision;
  reduce_cents := CASE WHEN p_decision = 'reduce' THEN p_reduce_cents END;
  due_cents := v_due;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_payout_review_decide(uuid, uuid, text, text, bigint) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hi_payout_review_decide(uuid, uuid, text, text, bigint) TO authenticated, service_role;
--> statement-breakpoint

-- Guarda dos movimentos (0157) + a checagem da revisão aberta. Nada mais muda.
CREATE OR REPLACE FUNCTION public.hi_payout_movement_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_status text;
  v_pos record;
  v_authorized bigint;
BEGIN
  SELECT status INTO v_status FROM public.hi_payouts
   WHERE clinic_id = NEW.clinic_id AND id = NEW.payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repasse inexistente nesta clínica.' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hi_payout_movements
              WHERE clinic_id = NEW.clinic_id AND idempotency_key = NEW.idempotency_key) THEN
    RAISE EXCEPTION 'Movimento de repasse já registrado (mesma chave).'
      USING ERRCODE = '23505', CONSTRAINT = 'hi_payout_movements_idem_uniq';
  END IF;
  -- 0163: com revisão aberta (guia fora do atendimento), nenhum pagamento nem autorização entra.
  IF NEW.kind IN ('authorization', 'settlement') AND EXISTS (
       SELECT 1 FROM public.hi_payout_reviews r
        WHERE r.clinic_id = NEW.clinic_id AND r.payout_id = NEW.payout_id AND r.status = 'open') THEN
    RAISE EXCEPTION 'Repasse em revisão: a guia saiu do atendimento; decida a revisão antes de pagar ou autorizar.'
      USING ERRCODE = '55000', CONSTRAINT = 'hi_payout_review_open';
  END IF;
  SELECT * INTO v_pos FROM public.hi_payout_position(NEW.clinic_id, NEW.payout_id);
  v_authorized := v_pos.authorized_cents + v_pos.adjustments_cents;
  IF NEW.kind = 'authorization' THEN
    IF v_status <> 'active' THEN
      RAISE EXCEPTION 'Repasse cancelado não recebe autorização.' USING ERRCODE = '55000';
    END IF;
    IF v_pos.eligible_cents IS NULL THEN
      RAISE EXCEPTION 'Repasse com decisão pendente (%): defina o valor por ajuste, com motivo.', v_pos.decision
        USING ERRCODE = '55000';
    END IF;
    IF v_authorized + NEW.amount_cents > v_pos.eligible_cents THEN
      RAISE EXCEPTION 'Autorização acima do elegível (% de % centavos).', v_authorized + NEW.amount_cents, v_pos.eligible_cents
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.kind = 'settlement' THEN
    IF v_pos.settled_cents + NEW.amount_cents > v_authorized THEN
      RAISE EXCEPTION 'Repasse acima do autorizado (% de % centavos).', v_pos.settled_cents + NEW.amount_cents, v_authorized
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF v_authorized + NEW.amount_cents < 0 THEN
      RAISE EXCEPTION 'O ajuste deixaria o autorizado negativo.' USING ERRCODE = '23514';
    END IF;
    IF v_pos.forecast_cents IS NOT NULL AND v_authorized + NEW.amount_cents > v_pos.forecast_cents THEN
      RAISE EXCEPTION 'O ajuste passaria do previsto da sessão (% centavos).', v_pos.forecast_cents USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Posições: a coluna nova vai NO FIM (CREATE OR REPLACE VIEW só acrescenta).
CREATE OR REPLACE VIEW public.hi_payout_positions WITH (security_invoker = true) AS
SELECT p.id AS payout_id, p.clinic_id, p.appointment_id, p.professional_id, p.procedure_id, p.rule_kind,
       p.rule_percentage, p.rule_fixed_cents, p.eligibility, p.status, p.created_at,
       pos.guide_id, pos.guide_status, pos.item_value_cents, pos.net_due_cents, pos.received_cents,
       pos.gloss_definitive_cents, pos.gloss_open_cents, pos.base_cents, pos.forecast_cents,
       pos.eligible_cents, pos.decision, pos.authorized_cents, pos.adjustments_cents, pos.settled_cents,
       (pos.authorized_cents + pos.adjustments_cents - pos.settled_cents) AS due_cents,
       (coalesce(pos.eligible_cents, 0) - pos.authorized_cents - pos.adjustments_cents) AS pending_authorization_cents,
       (SELECT r.id FROM public.hi_payout_reviews r
         WHERE r.clinic_id = p.clinic_id AND r.payout_id = p.id AND r.status = 'open') AS open_review_id
  FROM public.hi_payouts p
 CROSS JOIN LATERAL public.hi_payout_position(p.clinic_id, p.id) pos;
--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_payout_reviews ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_payout_reviews FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_payout_reviews_tenant_access ON public.hi_payout_reviews FOR ALL
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

-- O runtime só LÊ a revisão; abrir é do banco, decidir é pela função.
REVOKE ALL ON public.hi_payout_reviews FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT ON public.hi_payout_reviews TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hi_payout_reviews TO service_role;--> statement-breakpoint
GRANT UPDATE (payout_review_segregation, payout_review_independent_above_cents) ON public.hi_clinic_settings TO authenticated;
--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0163-hi-payout-reviews')
  ON CONFLICT DO NOTHING;
