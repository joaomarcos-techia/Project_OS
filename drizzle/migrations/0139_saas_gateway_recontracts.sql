-- Additive cancellation/recontract history. No legacy backfill or repricing.
-- Requires explicit authorization before any remote application.
ALTER TABLE billing_gateway.operations DROP CONSTRAINT operations_kind_check;
ALTER TABLE billing_gateway.operations ADD CONSTRAINT operations_kind_check
  CHECK (kind IN ('create_checkout','change_plan','cancel_subscription','proration_checkout','recontract_checkout'));

CREATE TABLE billing_gateway.cancellations (
  account_id uuid NOT NULL,
  external_subscription_id text NOT NULL CHECK (external_subscription_id ~ '^subs_[A-Za-z0-9_-]+$'),
  subscription_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  external_customer_id text NOT NULL CHECK (external_customer_id ~ '^cust_[A-Za-z0-9_-]+$'),
  external_checkout_id text NOT NULL CHECK (external_checkout_id ~ '^bill_[A-Za-z0-9_-]+$'),
  paid_period_start timestamptz NOT NULL,
  paid_period_end timestamptz NOT NULL CHECK (paid_period_end > paid_period_start),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  PRIMARY KEY(account_id,external_subscription_id),
  FOREIGN KEY(subscription_id,clinic_id,account_id)
    REFERENCES billing_gateway.bindings(subscription_id,clinic_id,account_id) ON DELETE RESTRICT,
  UNIQUE(account_id,external_subscription_id,subscription_id,clinic_id,external_customer_id,paid_period_end),
  CHECK (confirmed_at IS NULL OR confirmed_at >= requested_at)
);

CREATE TABLE billing_gateway.recontracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  account_id uuid NOT NULL,
  prior_external_subscription_id text NOT NULL,
  prior_period_end timestamptz NOT NULL,
  prior_external_customer_id text NOT NULL CHECK (prior_external_customer_id ~ '^cust_[A-Za-z0-9_-]+$'),
  external_customer_id text CHECK (external_customer_id ~ '^cust_[A-Za-z0-9_-]+$'),
  price_id uuid NOT NULL REFERENCES public.prices(id) ON DELETE RESTRICT,
  product_id text NOT NULL CHECK (product_id ~ '^prod_[A-Za-z0-9_-]+$'),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 999999999999),
  external_checkout_id text CHECK (external_checkout_id ~ '^bill_[A-Za-z0-9_-]+$'),
  external_subscription_id text CHECK (external_subscription_id ~ '^subs_[A-Za-z0-9_-]+$'),
  invoice_id uuid UNIQUE,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id,prior_external_subscription_id),
  UNIQUE(account_id,external_checkout_id),
  UNIQUE(account_id,external_subscription_id),
  FOREIGN KEY(account_id,prior_external_subscription_id,subscription_id,clinic_id,prior_external_customer_id,prior_period_end)
    REFERENCES billing_gateway.cancellations(account_id,external_subscription_id,subscription_id,clinic_id,external_customer_id,paid_period_end) ON DELETE RESTRICT,
  FOREIGN KEY(invoice_id,clinic_id,subscription_id)
    REFERENCES public.invoices(id,clinic_id,subscription_id) ON DELETE RESTRICT,
  CHECK ((invoice_id IS NULL AND period_start IS NULL AND period_end IS NULL)
    OR (invoice_id IS NOT NULL AND external_checkout_id IS NOT NULL AND external_subscription_id IS NOT NULL AND external_customer_id IS NOT NULL
      AND period_start IS NOT NULL AND period_end IS NOT NULL
      AND period_start >= prior_period_end AND period_end > period_start))
);

CREATE FUNCTION billing_gateway.preserve_cancellation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,billing_gateway AS $$
BEGIN
  IF ROW(NEW.account_id,NEW.external_subscription_id,NEW.subscription_id,NEW.clinic_id,
      NEW.external_customer_id,NEW.external_checkout_id,NEW.paid_period_start,NEW.paid_period_end,NEW.requested_by,NEW.requested_at)
    IS DISTINCT FROM ROW(OLD.account_id,OLD.external_subscription_id,OLD.subscription_id,OLD.clinic_id,
      OLD.external_customer_id,OLD.external_checkout_id,OLD.paid_period_start,OLD.paid_period_end,OLD.requested_by,OLD.requested_at)
    OR (OLD.confirmed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Cancellation snapshot is immutable' USING ERRCODE='23514',CONSTRAINT='gateway_cancellation_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cancellations_preserve_snapshot BEFORE UPDATE ON billing_gateway.cancellations
FOR EACH ROW EXECUTE FUNCTION billing_gateway.preserve_cancellation();

CREATE FUNCTION billing_gateway.preserve_recontract() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,billing_gateway AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM billing_gateway.cancellations c JOIN public.subscriptions s ON s.id=c.subscription_id AND s.clinic_id=c.clinic_id
      WHERE c.account_id=NEW.account_id AND c.external_subscription_id=NEW.prior_external_subscription_id
        AND c.subscription_id=NEW.subscription_id AND c.clinic_id=NEW.clinic_id
        AND c.confirmed_at IS NOT NULL AND c.paid_period_end <= now()
        AND s.current_period_end=c.paid_period_end AND s.cancel_at_period_end
        AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
    ) THEN
      RAISE EXCEPTION 'Recontract requires an ended confirmed cancellation' USING ERRCODE='23514',CONSTRAINT='gateway_recontract_not_eligible';
    END IF;
  ELSE
    IF ROW(NEW.id,NEW.subscription_id,NEW.clinic_id,NEW.account_id,NEW.prior_external_subscription_id,
        NEW.prior_period_end,NEW.prior_external_customer_id,NEW.price_id,NEW.product_id,NEW.amount_minor,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.subscription_id,OLD.clinic_id,OLD.account_id,OLD.prior_external_subscription_id,
        OLD.prior_period_end,OLD.prior_external_customer_id,OLD.price_id,OLD.product_id,OLD.amount_minor,OLD.created_at)
      OR (OLD.external_checkout_id IS NOT NULL AND NEW.external_checkout_id IS DISTINCT FROM OLD.external_checkout_id)
      OR (OLD.external_subscription_id IS NOT NULL AND NEW.external_subscription_id IS DISTINCT FROM OLD.external_subscription_id)
      OR (OLD.external_customer_id IS NOT NULL AND NEW.external_customer_id IS DISTINCT FROM OLD.external_customer_id)
      OR (OLD.invoice_id IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
      RAISE EXCEPTION 'Recontract snapshot is immutable' USING ERRCODE='23514',CONSTRAINT='gateway_recontract_immutable';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM billing_gateway.bindings b WHERE b.account_id=NEW.account_id
      AND ((NEW.external_checkout_id IS NOT NULL AND b.external_checkout_id=NEW.external_checkout_id)
        OR (NEW.external_subscription_id IS NOT NULL AND b.external_subscription_id=NEW.external_subscription_id))) THEN
    RAISE EXCEPTION 'Recontract cannot reuse initial resources' USING ERRCODE='23514',CONSTRAINT='gateway_recontract_resource_conflict';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER recontracts_preserve_snapshot BEFORE INSERT OR UPDATE ON billing_gateway.recontracts
FOR EACH ROW EXECUTE FUNCTION billing_gateway.preserve_recontract();

ALTER TABLE billing_gateway.cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.cancellations FORCE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.recontracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.recontracts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON billing_gateway.cancellations,billing_gateway.recontracts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON billing_gateway.cancellations,billing_gateway.recontracts TO service_role;
REVOKE ALL ON FUNCTION billing_gateway.preserve_cancellation(),billing_gateway.preserve_recontract() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION billing_gateway.preserve_cancellation(),billing_gateway.preserve_recontract() TO service_role;
