-- =====================================================================
-- 0157 — Convênios: repasse profissional dos atendimentos de convênio (P10.4, D16).
-- CANDIDATA: provada em Postgres descartável; NÃO aplicada no DEV compartilhado nem
-- em produção. Não altera tabela compartilhada (só LÊ `professional_payout_rules`).
--
-- O repasse particular (professional_payouts, 0108/0113) continua igual. O de convênio
-- não pode usar o mesmo caminho: o valor só existe de verdade quando a OPERADORA paga
-- (glosa, pagamento parcial, recurso), e não há recebível do paciente.
--
--   hi_clinic_settings.payout_eligibility  política da clínica (D16): 'on_receipt'
--                       (padrão: só sobre o que a operadora pagou, sem antecipação),
--                       'on_approval' (faturado menos glosa definitiva, depois da guia
--                       aprovada) ou 'on_completion' (antecipa sobre o contratado).
--   hi_payouts          um por atendimento de convênio: profissional e a regra REAL de
--                       professional_payout_rules vigente na data (percentual ou fixo),
--                       congelada, com a política vigente na criação.
--   hi_payout_movements só inclusão: autorização (revisão humana, até o elegível),
--                       repasse realizado (registro do pagamento ao profissional, até o
--                       autorizado, idempotente) e ajuste (decisão humana com motivo,
--                       nunca acima do previsto da sessão). Nada é apagado.
--   hi_payout_position()/hi_payout_positions
--                       previsto, elegível, autorizado, devido, repassado e pendente,
--                       calculados AO VIVO da conta da guia (alocações e glosas da 0152):
--                       uma fonte de verdade só.
--
-- Regras:
--  - pagamento parcial nunca vira repasse integral: no recebimento, a base é o que a
--    operadora pagou pela sessão (direto no item mais a parte proporcional do que veio
--    sem item); glosa em aberto, contestada ou em recurso não entra nem sai;
--  - regra de valor FIXO com glosa definitiva parcial ou total: não há regra para
--    dividir, então é decisão humana (ajuste com motivo), nunca estimativa;
--  - repassado acima do novo elegível (estorno, glosa definitiva depois): aparece como
--    devido negativo (a compensar); a compensação é humana, com motivo.
--
-- Sem BEGIN/COMMIT. Só aditiva.
--
-- Reversão (sem repasse registrado):
--   DROP VIEW public.hi_payout_positions; DROP FUNCTION public.hi_payout_position(uuid, uuid);
--   DROP TABLE public.hi_payout_movements, public.hi_payouts;
--   DROP FUNCTION public.hi_payout_movement_guard();
--   ALTER TABLE public.hi_clinic_settings DROP CONSTRAINT hi_clinic_settings_payout_eligibility_chk,
--     DROP COLUMN payout_eligibility;
--   DELETE FROM public._schema_version WHERE version = '0157-hi-professional-payouts';
-- =====================================================================

ALTER TABLE public.hi_clinic_settings ADD COLUMN payout_eligibility text NOT NULL DEFAULT 'on_receipt';
--> statement-breakpoint
ALTER TABLE public.hi_clinic_settings ADD CONSTRAINT hi_clinic_settings_payout_eligibility_chk
  CHECK (payout_eligibility IN ('on_receipt', 'on_approval', 'on_completion')) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.hi_clinic_settings VALIDATE CONSTRAINT hi_clinic_settings_payout_eligibility_chk;
--> statement-breakpoint

CREATE TABLE public.hi_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id),
  professional_id uuid NOT NULL,
  procedure_id uuid,
  rule_id uuid NOT NULL,
  rule_kind text NOT NULL,
  rule_percentage numeric(7, 4),
  rule_fixed_cents bigint,
  eligibility text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  cancel_reason text,
  cancelled_by uuid,
  cancelled_at timestamptz,
  created_via text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_payouts_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_payouts_appointment_uniq UNIQUE (clinic_id, appointment_id),
  CONSTRAINT hi_payouts_rule_chk CHECK (
    (rule_kind = 'percentage' AND rule_percentage > 0 AND rule_percentage <= 100 AND rule_fixed_cents IS NULL)
    OR (rule_kind = 'fixed' AND rule_fixed_cents >= 0 AND rule_percentage IS NULL)
  ),
  CONSTRAINT hi_payouts_eligibility_chk CHECK (eligibility IN ('on_receipt', 'on_approval', 'on_completion')),
  CONSTRAINT hi_payouts_status_chk CHECK (
    (status = 'active' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
        AND char_length(btrim(cancel_reason)) BETWEEN 10 AND 500)
  ),
  CONSTRAINT hi_payouts_created_chk CHECK (
    created_via IN ('user', 'automation') AND (created_via <> 'user' OR created_by IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX hi_payouts_professional_idx ON public.hi_payouts (clinic_id, professional_id);
--> statement-breakpoint

CREATE TABLE public.hi_payout_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  payout_id uuid NOT NULL,
  kind text NOT NULL,
  amount_cents bigint NOT NULL,
  paid_on date,
  reference text,
  reason text,
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_payout_movements_payout_fk FOREIGN KEY (clinic_id, payout_id)
    REFERENCES public.hi_payouts (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_payout_movements_idem_uniq UNIQUE (clinic_id, idempotency_key),
  CONSTRAINT hi_payout_movements_kind_chk CHECK (
    (kind IN ('authorization', 'settlement') AND amount_cents BETWEEN 1 AND 9999999999)
    OR (kind = 'adjustment' AND amount_cents <> 0 AND amount_cents BETWEEN -9999999999 AND 9999999999)
  ),
  CONSTRAINT hi_payout_movements_settlement_chk CHECK (kind <> 'settlement' OR paid_on IS NOT NULL),
  CONSTRAINT hi_payout_movements_text_chk CHECK (
    (kind <> 'adjustment' OR char_length(btrim(reason)) BETWEEN 10 AND 500)
    AND (reason IS NULL OR char_length(reason) <= 500)
    AND (reference IS NULL OR char_length(reference) <= 100)
    AND char_length(idempotency_key) BETWEEN 8 AND 200
  )
);
--> statement-breakpoint
CREATE INDEX hi_payout_movements_payout_idx ON public.hi_payout_movements (clinic_id, payout_id);
--> statement-breakpoint

-- Posição do repasse de UM atendimento, da conta da guia (invoker: a RLS da sessão vale).
CREATE OR REPLACE FUNCTION public.hi_payout_position(p_clinic uuid, p_payout uuid)
RETURNS TABLE (
  guide_id uuid, guide_status text, item_value_cents bigint, net_due_cents bigint, received_cents bigint,
  gloss_definitive_cents bigint, gloss_open_cents bigint, base_cents bigint, forecast_cents bigint,
  eligible_cents bigint, decision text, authorized_cents bigint, adjustments_cents bigint, settled_cents bigint
)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_p public.hi_payouts%ROWTYPE;
  v_item uuid;
  v_guide uuid;
  v_value bigint;
  v_status text;
  v_total bigint;
  v_share numeric;
  v_paid_item bigint;
  v_paid_guide bigint;
  v_def_item bigint;
  v_def_guide bigint;
  v_open_item bigint;
  v_open_guide bigint;
  v_due bigint;
  v_recv bigint;
  v_base bigint;
  v_auth bigint;
  v_adj bigint;
  v_set bigint;
BEGIN
  SELECT * INTO v_p FROM public.hi_payouts p WHERE p.clinic_id = p_clinic AND p.id = p_payout;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT coalesce(sum(m.amount_cents) FILTER (WHERE m.kind = 'authorization'), 0),
         coalesce(sum(m.amount_cents) FILTER (WHERE m.kind = 'adjustment'), 0),
         coalesce(sum(m.amount_cents) FILTER (WHERE m.kind = 'settlement'), 0)
    INTO v_auth, v_adj, v_set
    FROM public.hi_payout_movements m WHERE m.clinic_id = p_clinic AND m.payout_id = p_payout;
  authorized_cents := v_auth;
  adjustments_cents := v_adj;
  settled_cents := v_set;

  SELECT gi.id, gi.guide_id, gi.total_value_cents, g.status
    INTO v_item, v_guide, v_value, v_status
    FROM public.hi_guide_items gi
    JOIN public.hi_guides g ON g.clinic_id = gi.clinic_id AND g.id = gi.guide_id
   WHERE gi.clinic_id = p_clinic AND gi.appointment_id = v_p.appointment_id AND gi.live
   ORDER BY gi.created_at
   LIMIT 1;
  IF v_item IS NULL THEN
    -- Guia cancelada ou substituída sem outra viva: nada a repassar até haver guia.
    eligible_cents := 0;
    decision := 'NO_LIVE_GUIDE';
    RETURN NEXT;
    RETURN;
  END IF;
  guide_id := v_guide;
  guide_status := v_status;
  item_value_cents := v_value;

  SELECT coalesce(sum(i.total_value_cents), 0) INTO v_total
    FROM public.hi_guide_items i WHERE i.clinic_id = p_clinic AND i.guide_id = v_guide AND i.live;
  v_share := CASE WHEN v_total > 0 THEN v_value::numeric / v_total ELSE 0 END;

  SELECT coalesce(sum(CASE a.kind WHEN 'allocation' THEN a.amount_cents ELSE -a.amount_cents END)
                    FILTER (WHERE a.guide_item_id = v_item), 0),
         coalesce(sum(CASE a.kind WHEN 'allocation' THEN a.amount_cents ELSE -a.amount_cents END)
                    FILTER (WHERE a.guide_item_id IS NULL), 0)
    INTO v_paid_item, v_paid_guide
    FROM public.hi_payment_allocations a WHERE a.clinic_id = p_clinic AND a.guide_id = v_guide;
  SELECT coalesce(sum(x.definitive_cents) FILTER (WHERE x.guide_item_id = v_item), 0),
         coalesce(sum(x.definitive_cents) FILTER (WHERE x.guide_item_id IS NULL), 0),
         coalesce(sum(x.amount_cents) FILTER (WHERE x.guide_item_id = v_item
                    AND x.status IN ('informed', 'under_analysis', 'contested', 'appeal_filed')), 0),
         coalesce(sum(x.amount_cents) FILTER (WHERE x.guide_item_id IS NULL
                    AND x.status IN ('informed', 'under_analysis', 'contested', 'appeal_filed')), 0)
    INTO v_def_item, v_def_guide, v_open_item, v_open_guide
    FROM public.hi_glosses x WHERE x.clinic_id = p_clinic AND x.guide_id = v_guide;

  gloss_definitive_cents := v_def_item + round(v_def_guide * v_share)::bigint;
  gloss_open_cents := v_open_item + round(v_open_guide * v_share)::bigint;
  v_due := greatest(v_value - gloss_definitive_cents, 0);
  v_recv := least(greatest(v_paid_item + round(v_paid_guide * v_share)::bigint, 0), v_value);
  net_due_cents := v_due;
  received_cents := v_recv;

  v_base := CASE v_p.eligibility
    WHEN 'on_completion' THEN v_value
    WHEN 'on_approval' THEN CASE WHEN v_status IN ('approved', 'in_batch', 'exported', 'sent', 'under_review',
      'paid', 'partially_paid', 'partially_glossed', 'fully_glossed', 'closed') THEN v_due ELSE 0 END
    ELSE v_recv
  END;
  base_cents := v_base;

  IF v_p.rule_kind = 'percentage' THEN
    forecast_cents := round(v_value * v_p.rule_percentage / 100)::bigint;
    eligible_cents := round(v_base * v_p.rule_percentage / 100)::bigint;
  ELSE
    forecast_cents := v_p.rule_fixed_cents;
    IF v_base = v_value AND v_value > 0 THEN
      eligible_cents := v_p.rule_fixed_cents;
    ELSIF v_due = 0 AND v_value > 0 THEN
      eligible_cents := NULL;
      decision := 'FIXED_RULE_FULL_GLOSS';
    ELSIF v_due < v_value AND v_base >= v_due THEN
      eligible_cents := NULL;
      decision := 'FIXED_RULE_PARTIAL_GLOSS';
    ELSE
      -- Ainda falta dinheiro (ou a aprovação): espera, não é pendência.
      eligible_cents := 0;
    END IF;
  END IF;
  IF v_p.status = 'cancelled' THEN
    eligible_cents := 0;
    decision := 'CANCELLED';
  END IF;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_payout_position(uuid, uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hi_payout_position(uuid, uuid) TO authenticated, service_role;
--> statement-breakpoint

-- Tetos dos movimentos, com a linha do repasse travada (concorrência).
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
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_payout_movement_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_payout_movements_guard BEFORE INSERT ON public.hi_payout_movements
  FOR EACH ROW EXECUTE FUNCTION public.hi_payout_movement_guard();
--> statement-breakpoint
CREATE TRIGGER hi_payout_movements_immutable BEFORE UPDATE ON public.hi_payout_movements
  FOR EACH ROW EXECUTE FUNCTION public.hi_block_mutation();
--> statement-breakpoint

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
--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_payouts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_payouts FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_payouts_tenant_access ON public.hi_payouts FOR ALL
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
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_payout_movements ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_payout_movements FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_payout_movements_tenant_access ON public.hi_payout_movements FOR ALL
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

REVOKE ALL ON public.hi_payouts, public.hi_payout_movements, public.hi_payout_positions FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON public.hi_payouts TO authenticated;--> statement-breakpoint
GRANT UPDATE (status, cancel_reason, cancelled_by, cancelled_at) ON public.hi_payouts TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON public.hi_payout_movements TO authenticated;--> statement-breakpoint
GRANT SELECT ON public.hi_payout_positions TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hi_payouts, public.hi_payout_movements TO service_role;--> statement-breakpoint
GRANT SELECT ON public.hi_payout_positions TO service_role;--> statement-breakpoint
GRANT UPDATE (payout_eligibility) ON public.hi_clinic_settings TO authenticated;
--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0157-hi-professional-payouts')
  ON CONFLICT DO NOTHING;
