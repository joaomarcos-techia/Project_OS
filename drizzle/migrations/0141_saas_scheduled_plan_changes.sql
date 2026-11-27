-- One immutable intent per paid AbacatePay generation; no legacy backfill.
CREATE TABLE billing_gateway.plan_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  external_subscription_id text NOT NULL CHECK (external_subscription_id ~ '^subs_[A-Za-z0-9_-]+$'),
  generation_id uuid NOT NULL,
  from_price_id uuid NOT NULL REFERENCES public.prices(id) ON DELETE RESTRICT,
  to_price_id uuid NOT NULL REFERENCES public.prices(id) ON DELETE RESTRICT,
  to_plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  product_id text NOT NULL CHECK (product_id ~ '^prod_[A-Za-z0-9_-]+$'),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 999999999999),
  effective_not_before timestamptz NOT NULL,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  external_change_id text CHECK (external_change_id ~ '^subu_[A-Za-z0-9_-]+$'),
  invoice_id uuid UNIQUE,
  applied_at timestamptz,
  CHECK (from_price_id <> to_price_id),
  CHECK ((invoice_id IS NULL AND applied_at IS NULL) OR (invoice_id IS NOT NULL AND applied_at >= requested_at)),
  FOREIGN KEY(subscription_id,clinic_id,account_id)
    REFERENCES billing_gateway.bindings(subscription_id,clinic_id,account_id) ON DELETE RESTRICT,
  FOREIGN KEY(invoice_id,clinic_id,subscription_id)
    REFERENCES public.invoices(id,clinic_id,subscription_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX gateway_one_pending_plan_change ON billing_gateway.plan_changes(account_id,external_subscription_id)
  WHERE invoice_id IS NULL;
CREATE UNIQUE INDEX gateway_plan_change_remote_id ON billing_gateway.plan_changes(account_id,external_change_id)
  WHERE external_change_id IS NOT NULL;

CREATE FUNCTION billing_gateway.preserve_plan_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,billing_gateway AS $$
BEGIN
  IF ROW(NEW.id,NEW.account_id,NEW.subscription_id,NEW.clinic_id,NEW.external_subscription_id,
      NEW.generation_id,NEW.from_price_id,NEW.to_price_id,NEW.to_plan_id,NEW.product_id,NEW.amount_minor,
      NEW.effective_not_before,NEW.requested_by,NEW.requested_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.account_id,OLD.subscription_id,OLD.clinic_id,OLD.external_subscription_id,
      OLD.generation_id,OLD.from_price_id,OLD.to_price_id,OLD.to_plan_id,OLD.product_id,OLD.amount_minor,
      OLD.effective_not_before,OLD.requested_by,OLD.requested_at)
    OR (OLD.external_change_id IS NOT NULL AND NEW.external_change_id IS DISTINCT FROM OLD.external_change_id)
    OR (OLD.invoice_id IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Plan change snapshot is immutable' USING ERRCODE='23514',CONSTRAINT='gateway_plan_change_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER plan_changes_preserve_snapshot BEFORE UPDATE ON billing_gateway.plan_changes
  FOR EACH ROW EXECUTE FUNCTION billing_gateway.preserve_plan_change();

-- Additional guard, preserving the existing legacy/current-plan seat trigger.
CREATE FUNCTION public.enforce_abacatepay_pending_seats() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cap record; used_doctors integer; used_staff integer;
BEGIN
  IF NEW.clinic_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.clinic_id::text));
  SELECT min(l.doctors)::integer doctors,min(l.staff)::integer staff INTO cap
    FROM billing_gateway.plan_changes c JOIN public.subscriptions s ON s.id=c.subscription_id AND s.clinic_id=c.clinic_id
    JOIN public.plan_seat_limits l ON l.plan_id=c.to_plan_id
    WHERE c.clinic_id=NEW.clinic_id AND c.invoice_id IS NULL AND s.billing_provider='abacatepay'
      AND s.asaas_subscription_id IS NULL AND NOT s.cancel_at_period_end
      AND c.external_subscription_id=coalesce((SELECT r.external_subscription_id FROM billing_gateway.recontracts r
        WHERE r.subscription_id=s.id AND r.invoice_id IS NOT NULL ORDER BY r.created_at DESC,r.id DESC LIMIT 1),
        (SELECT b.external_subscription_id FROM billing_gateway.bindings b WHERE b.subscription_id=s.id));
  IF cap.doctors IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) FILTER (WHERE role='doctor' OR (role IN ('owner','gestor') AND nullif(btrim(crm),'') IS NOT NULL))::integer,
    count(*) FILTER (WHERE role<>'doctor' AND NOT (role IN ('owner','gestor') AND nullif(btrim(crm),'') IS NOT NULL))::integer
    INTO used_doctors,used_staff FROM public.profiles WHERE clinic_id=NEW.clinic_id AND id<>NEW.id
      AND ativo IS TRUE AND deleted_at IS NULL AND role<>'super_admin';
  IF NEW.ativo IS TRUE AND NEW.deleted_at IS NULL AND NEW.role<>'super_admin' THEN
    IF NEW.role='doctor' OR (NEW.role IN ('owner','gestor') AND nullif(btrim(NEW.crm),'') IS NOT NULL) THEN
      used_doctors:=used_doctors+1;
    ELSE used_staff:=used_staff+1; END IF;
  END IF;
  IF used_doctors>cap.doctors OR used_staff>cap.staff THEN
    RAISE EXCEPTION 'Pending plan capacity exceeded' USING ERRCODE='23514',CONSTRAINT='gateway_pending_seat_limit';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER abacatepay_pending_seats BEFORE INSERT OR UPDATE OF clinic_id,role,crm,ativo,deleted_at
  ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_abacatepay_pending_seats();

ALTER TABLE billing_gateway.plan_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.plan_changes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON billing_gateway.plan_changes FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON billing_gateway.plan_changes TO service_role;
REVOKE ALL ON FUNCTION billing_gateway.preserve_plan_change(),public.enforce_abacatepay_pending_seats()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION billing_gateway.preserve_plan_change() TO service_role;
