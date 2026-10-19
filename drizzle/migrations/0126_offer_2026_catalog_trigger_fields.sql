-- Corrige a funcao da 0125: um trigger em prices nao possui NEW.code/NEW.ativo.
-- Separar os ramos por tabela evita acessar campos inexistentes em PL/pgSQL.
CREATE OR REPLACE FUNCTION public.guard_offer_2026_pending_catalog_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  affected_plan_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'prices' THEN
    affected_plan_id := OLD.plan_id;
    IF TG_OP = 'UPDATE' AND
       (NEW.plan_id, NEW.amount, NEW.currency, NEW.billing_cycle,
        NEW.active_from, NEW.active_until, NEW.campaign_code) IS NOT DISTINCT FROM
       (OLD.plan_id, OLD.amount, OLD.currency, OLD.billing_cycle,
        OLD.active_from, OLD.active_until, OLD.campaign_code) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'plans' THEN
    affected_plan_id := OLD.id;
    IF TG_OP = 'UPDATE' AND
       (NEW.code, NEW.ativo) IS NOT DISTINCT FROM (OLD.code, OLD.ativo) THEN
      RETURN NEW;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unexpected catalog trigger table';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.plan_seat_limits WHERE plan_id = affected_plan_id
  ) AND EXISTS (
    SELECT 1 FROM public.signup_sessions s
    WHERE s.selected_plan_id = affected_plan_id
      AND s.billing_attempt_state IN ('reserved', 'checkout_pending', 'creation_unknown', 'active')
  ) THEN
    RAISE EXCEPTION 'Oferta com Checkout pendente: conclua ou reconcilie antes de alterar o catalogo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'offer_2026_pending_checkout_catalog';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0126-offer-2026-catalog-trigger-fields')
ON CONFLICT (version) DO NOTHING;
