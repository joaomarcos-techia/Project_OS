-- O Checkout usa o preco que existia na reserva. Sem esta trava, uma edicao do
-- catalogo entre a reserva e o retorno pode deixar uma assinatura paga sem tenant.
-- A trava vale apenas para os planos versionados da oferta 2026 e dura ate a
-- tentativa falhar ou o draft ser consumido/apagado.
CREATE OR REPLACE FUNCTION public.guard_offer_2026_pending_catalog_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  affected_plan_id uuid;
BEGIN
  affected_plan_id := CASE WHEN TG_TABLE_NAME = 'prices' THEN OLD.plan_id ELSE OLD.id END;
  IF NOT EXISTS (
    SELECT 1 FROM public.plan_seat_limits WHERE plan_id = affected_plan_id
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'prices' AND
       (NEW.plan_id, NEW.amount, NEW.currency, NEW.billing_cycle,
        NEW.active_from, NEW.active_until, NEW.campaign_code) IS NOT DISTINCT FROM
       (OLD.plan_id, OLD.amount, OLD.currency, OLD.billing_cycle,
        OLD.active_from, OLD.active_until, OLD.campaign_code) THEN
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'plans' AND
       (NEW.code, NEW.ativo) IS NOT DISTINCT FROM (OLD.code, OLD.ativo) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.signup_sessions s
    WHERE s.selected_plan_id = affected_plan_id
      AND s.billing_attempt_state IN ('reserved', 'checkout_pending', 'creation_unknown', 'active')
  ) THEN
    RAISE EXCEPTION 'Oferta com Checkout pendente: conclua ou reconcilie antes de alterar o catalogo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'offer_2026_pending_checkout_catalog';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_offer_2026_pending_catalog_change()
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER prices_offer_2026_pending_catalog
  BEFORE UPDATE OR DELETE ON public.prices
  FOR EACH ROW EXECUTE FUNCTION public.guard_offer_2026_pending_catalog_change();
--> statement-breakpoint
CREATE TRIGGER plans_offer_2026_pending_catalog
  BEFORE UPDATE OR DELETE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.guard_offer_2026_pending_catalog_change();
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0125-offer-2026-pending-catalog')
ON CONFLICT (version) DO NOTHING;
