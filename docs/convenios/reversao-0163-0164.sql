-- =====================================================================
-- Reversão da 0164 e da 0163 no DEV (NÃO é migration; rodar só com autorização, numa transação,
-- e com o código que conhece a revisão e a tradução do interruptor FORA do ar antes — reverter o
-- código primeiro). Ordem: 0164 depois 0163. Não apaga dado de guia, repasse ou movimento.
--
-- Efeito: as revisões abertas deixam de existir (DROP TABLE) e o pagamento volta a ser aceito sem
-- revisão (a lacuna medida em 16/11 volta). Por isso, antes de reverter: exportar
-- hi_payout_reviews (pg_dump -t public.hi_payout_reviews --data-only) e anotar as abertas.
-- =====================================================================

BEGIN;

-- ── 0164 ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS hi_ab_module_guides ON public.hi_guides;
DROP TRIGGER IF EXISTS hi_ab_module_snapshots ON public.hi_guide_snapshots;
DROP TRIGGER IF EXISTS hi_ab_module_batches ON public.hi_batches;
DROP TRIGGER IF EXISTS hi_ab_module_files ON public.hi_files;
DROP TRIGGER IF EXISTS hi_ab_module_authorizations ON public.hi_authorizations;
DROP TRIGGER IF EXISTS hi_ab_module_sadt_requests ON public.hi_sadt_requests;
DROP TRIGGER IF EXISTS hi_ab_module_coverages ON public.hi_appointment_coverages;
DROP TRIGGER IF EXISTS hi_ab_module_copayments ON public.hi_copayments;
DROP FUNCTION IF EXISTS public.hi_module_guard();
DELETE FROM public._schema_version WHERE version = '0164-hi-module-switch-guard';

-- ── 0163 ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS hi_guides_zz_payout_review ON public.hi_guides;
DROP FUNCTION IF EXISTS public.hi_guide_payout_review_trigger();
DROP FUNCTION IF EXISTS public.hi_payout_review_decide(uuid, uuid, text, text, bigint);

-- A visão volta à definição da 0157 (coluna não sai por CREATE OR REPLACE).
DROP VIEW IF EXISTS public.hi_payout_positions;
CREATE VIEW public.hi_payout_positions WITH (security_invoker = true) AS
SELECT p.id AS payout_id, p.clinic_id, p.appointment_id, p.professional_id, p.procedure_id, p.rule_kind,
       p.rule_percentage, p.rule_fixed_cents, p.eligibility, p.status, p.created_at,
       pos.guide_id, pos.guide_status, pos.item_value_cents, pos.net_due_cents, pos.received_cents,
       pos.gloss_definitive_cents, pos.gloss_open_cents, pos.base_cents, pos.forecast_cents,
       pos.eligible_cents, pos.decision, pos.authorized_cents, pos.adjustments_cents, pos.settled_cents,
       (pos.authorized_cents + pos.adjustments_cents - pos.settled_cents) AS due_cents,
       (coalesce(pos.eligible_cents, 0) - pos.authorized_cents - pos.adjustments_cents) AS pending_authorization_cents
  FROM public.hi_payouts p
 CROSS JOIN LATERAL public.hi_payout_position(p.clinic_id, p.id) pos;
REVOKE ALL ON public.hi_payout_positions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hi_payout_positions TO authenticated;
GRANT SELECT ON public.hi_payout_positions TO service_role;

-- O guarda dos movimentos volta ao corpo da 0157 (sem a checagem da revisão).
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

DROP FUNCTION IF EXISTS public.hi_payout_review_guard() CASCADE;
DROP FUNCTION IF EXISTS public.hi_payout_reviews_open_for_guide(uuid, uuid, text, text);
DROP TABLE IF EXISTS public.hi_payout_reviews;
ALTER TABLE public.hi_clinic_settings
  DROP CONSTRAINT IF EXISTS hi_clinic_settings_payout_review_chk,
  DROP COLUMN IF EXISTS payout_review_independent_above_cents,
  DROP COLUMN IF EXISTS payout_review_segregation;
DELETE FROM public._schema_version WHERE version = '0163-hi-payout-reviews';

-- As duas linhas do ledger do Drizzle, para o migrador reaplicar depois (when da 0163 e da 0164).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at IN (1795382573857, 1795468973857);

COMMIT;
