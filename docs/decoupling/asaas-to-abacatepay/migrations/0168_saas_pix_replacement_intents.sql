-- Commercial release composition only. A request never charges, cancels, or changes entitlements.
CREATE TABLE billing_gateway.pix_replacement_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  prior_external_subscription_id text NOT NULL CHECK (prior_external_subscription_id ~ '^subs_[A-Za-z0-9_-]+$'),
  prior_period_end timestamptz NOT NULL,
  from_price_id uuid NOT NULL REFERENCES public.prices(id) ON DELETE RESTRICT,
  to_price_id uuid NOT NULL REFERENCES public.prices(id) ON DELETE RESTRICT,
  to_plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  target_amount_minor bigint NOT NULL CHECK (target_amount_minor > 0 AND target_amount_minor <= 999999999999),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','cancelled','requires_review')),
  state_changed_at timestamptz,
  CHECK (from_price_id <> to_price_id),
  CHECK ((state = 'requested' AND state_changed_at IS NULL) OR
    (state <> 'requested' AND state_changed_at IS NOT NULL)),
  FOREIGN KEY(subscription_id,clinic_id,account_id)
    REFERENCES billing_gateway.bindings(subscription_id,clinic_id,account_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX gateway_one_open_pix_replacement_intent
  ON billing_gateway.pix_replacement_intents(account_id,prior_external_subscription_id)
  WHERE state = 'requested';
--> statement-breakpoint
CREATE INDEX gateway_pix_replacement_intent_clinic
  ON billing_gateway.pix_replacement_intents(clinic_id,requested_at DESC);
--> statement-breakpoint
CREATE FUNCTION billing_gateway.preserve_pix_replacement_intent() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,billing_gateway AS $$
BEGIN
  IF ROW(NEW.id,NEW.account_id,NEW.subscription_id,NEW.clinic_id,NEW.generation_id,
      NEW.prior_external_subscription_id,NEW.prior_period_end,NEW.from_price_id,
      NEW.to_price_id,NEW.to_plan_id,NEW.target_amount_minor,NEW.requested_by,NEW.requested_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.account_id,OLD.subscription_id,OLD.clinic_id,OLD.generation_id,
      OLD.prior_external_subscription_id,OLD.prior_period_end,OLD.from_price_id,
      OLD.to_price_id,OLD.to_plan_id,OLD.target_amount_minor,OLD.requested_by,OLD.requested_at)
    OR (OLD.state <> 'requested' AND NEW IS DISTINCT FROM OLD)
    OR (OLD.state = 'requested' AND NEW.state NOT IN ('requested','cancelled','requires_review')) THEN
    RAISE EXCEPTION 'Pix replacement intent snapshot is immutable'
      USING ERRCODE='23514',CONSTRAINT='gateway_pix_replacement_intent_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pix_replacement_intents_preserve_snapshot
  BEFORE UPDATE ON billing_gateway.pix_replacement_intents
  FOR EACH ROW EXECUTE FUNCTION billing_gateway.preserve_pix_replacement_intent();
--> statement-breakpoint
ALTER TABLE billing_gateway.pix_replacement_intents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE billing_gateway.pix_replacement_intents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON billing_gateway.pix_replacement_intents FROM PUBLIC,anon,authenticated,service_role;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE ON billing_gateway.pix_replacement_intents TO service_role;
--> statement-breakpoint
REVOKE ALL ON FUNCTION billing_gateway.preserve_pix_replacement_intent()
  FROM PUBLIC,anon,authenticated,service_role;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION billing_gateway.preserve_pix_replacement_intent() TO service_role;
