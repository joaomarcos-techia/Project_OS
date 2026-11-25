-- PROPOSAL ONLY. Not in the migration journal; never auto-applied.
-- Requires a separately approved migration number/composition and Production GO.
-- A single unpaid initial checkout correction, with immutable old/new journals.
ALTER TABLE billing_gateway.operations DROP CONSTRAINT operations_kind_check;
ALTER TABLE billing_gateway.operations ADD CONSTRAINT operations_kind_check CHECK (kind IN
  ('create_checkout','change_plan','cancel_subscription','proration_checkout','recontract_checkout',
   'close_paid_checkout','close_unpaid_checkout','replace_checkout'));

CREATE TABLE billing_gateway.initial_checkout_replacements (
  id uuid PRIMARY KEY,
  subscription_id uuid NOT NULL UNIQUE,
  clinic_id uuid NOT NULL,
  account_id uuid NOT NULL,
  old_checkout_id text NOT NULL CHECK (old_checkout_id ~ '^bill_[A-Za-z0-9_-]+$'),
  old_operation_id uuid NOT NULL,
  close_operation_id uuid NOT NULL UNIQUE,
  create_operation_id uuid NOT NULL UNIQUE,
  close_proof_operation_id uuid,
  create_proof_operation_id uuid,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  no_payment_initiated boolean NOT NULL CHECK (no_payment_initiated),
  phase text NOT NULL DEFAULT 'prepared' CHECK (phase IN ('prepared','closed','bound')),
  new_checkout_id text CHECK (new_checkout_id ~ '^bill_[A-Za-z0-9_-]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  bound_at timestamptz,
  FOREIGN KEY(subscription_id,clinic_id,account_id)
    REFERENCES billing_gateway.bindings(subscription_id,clinic_id,account_id) ON DELETE RESTRICT,
  FOREIGN KEY(account_id,old_operation_id)
    REFERENCES billing_gateway.operations(account_id,operation_id) ON DELETE RESTRICT,
  FOREIGN KEY(account_id,close_proof_operation_id)
    REFERENCES billing_gateway.operations(account_id,operation_id) ON DELETE RESTRICT,
  FOREIGN KEY(account_id,create_proof_operation_id)
    REFERENCES billing_gateway.operations(account_id,operation_id) ON DELETE RESTRICT,
  UNIQUE(account_id,old_checkout_id),
  UNIQUE(account_id,new_checkout_id),
  CHECK (new_checkout_id IS NULL OR new_checkout_id <> old_checkout_id),
  CHECK ((phase='prepared' AND close_proof_operation_id IS NULL AND create_proof_operation_id IS NULL)
    OR (phase='closed' AND close_proof_operation_id IS NOT NULL AND close_proof_operation_id=close_operation_id AND create_proof_operation_id IS NULL)
    OR (phase='bound' AND close_proof_operation_id IS NOT NULL AND create_proof_operation_id IS NOT NULL
      AND close_proof_operation_id=close_operation_id AND create_proof_operation_id=create_operation_id)),
  CHECK ((phase='prepared' AND closed_at IS NULL AND bound_at IS NULL AND new_checkout_id IS NULL)
    OR (phase='closed' AND closed_at IS NOT NULL AND bound_at IS NULL AND new_checkout_id IS NULL)
    OR (phase='bound' AND closed_at IS NOT NULL AND bound_at IS NOT NULL AND new_checkout_id IS NOT NULL))
);
ALTER TABLE billing_gateway.initial_checkout_replacements ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.initial_checkout_replacements FORCE ROW LEVEL SECURITY;
REVOKE ALL ON billing_gateway.initial_checkout_replacements FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON billing_gateway.initial_checkout_replacements TO service_role;

CREATE FUNCTION billing_gateway.guard_initial_checkout_replacement() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,billing_gateway AS $$
DECLARE v_old text; v_price uuid; v_product text; v_amount bigint; v_result jsonb;
BEGIN
  -- Same lock order as initial activation: subscription, then binding.
  SELECT s.price_id INTO v_price FROM public.subscriptions s
    WHERE s.id=NEW.subscription_id AND s.clinic_id=NEW.clinic_id
      AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
      AND s.billing_status='trial' AND NOT s.cancel_at_period_end FOR UPDATE;
  SELECT b.external_checkout_id INTO v_old FROM billing_gateway.bindings b
    JOIN billing_gateway.accounts a ON a.id=b.account_id AND a.provider='abacatepay'
    WHERE b.subscription_id=NEW.subscription_id AND b.clinic_id=NEW.clinic_id
      AND b.account_id=NEW.account_id AND b.external_customer_id IS NULL
      AND b.external_subscription_id IS NULL FOR UPDATE OF b;
  SELECT i.product_id,i.amount_minor INTO v_product,v_amount FROM billing_gateway.checkout_intents i
    JOIN public.prices p ON p.id=i.price_id AND p.amount*100=i.amount_minor AND p.currency='BRL' AND p.billing_cycle='monthly'
    WHERE i.subscription_id=NEW.subscription_id AND i.clinic_id=NEW.clinic_id
      AND i.account_id=NEW.account_id AND i.price_id=v_price;
  IF v_price IS NULL OR v_old IS DISTINCT FROM NEW.old_checkout_id OR v_product IS NULL
    OR EXISTS(SELECT 1 FROM public.invoices WHERE subscription_id=NEW.subscription_id)
    OR EXISTS(SELECT 1 FROM billing_gateway.paid_checkouts WHERE subscription_id=NEW.subscription_id)
    OR NOT EXISTS(SELECT 1 FROM public.trial_access_policies WHERE subscription_id=NEW.subscription_id AND clinic_id=NEW.clinic_id AND released_at IS NULL)
    OR EXISTS(SELECT 1 FROM billing_gateway.recontracts WHERE subscription_id=NEW.subscription_id)
    OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=NEW.requested_by AND clinic_id=NEW.clinic_id AND role='owner' AND ativo)
    OR NOT EXISTS(SELECT 1 FROM billing_gateway.operations o WHERE o.account_id=NEW.account_id
      AND o.operation_id=NEW.old_operation_id AND o.subscription_id=NEW.subscription_id
      AND o.clinic_id=NEW.clinic_id AND o.kind='create_checkout' AND o.state='confirmed'
      AND o.business_key='initial:'||v_price::text AND o.result->>'checkoutId'=NEW.old_checkout_id
      AND o.result->>'amountMinor'=v_amount::text)
  THEN RAISE EXCEPTION 'Initial checkout replacement is not eligible' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.phase <> 'prepared' THEN RAISE EXCEPTION 'Replacement must start prepared' USING ERRCODE='23514'; END IF;
  ELSE
    IF ROW(NEW.id,NEW.subscription_id,NEW.clinic_id,NEW.account_id,NEW.old_checkout_id,NEW.old_operation_id,
      NEW.close_operation_id,NEW.create_operation_id,NEW.requested_by,NEW.no_payment_initiated,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.subscription_id,OLD.clinic_id,OLD.account_id,OLD.old_checkout_id,OLD.old_operation_id,
      OLD.close_operation_id,OLD.create_operation_id,OLD.requested_by,OLD.no_payment_initiated,OLD.created_at)
      OR NOT ((OLD.phase='prepared' AND NEW.phase='closed') OR (OLD.phase='closed' AND NEW.phase='bound'))
    THEN RAISE EXCEPTION 'Replacement history is immutable' USING ERRCODE='23514'; END IF;
    SELECT o.result INTO v_result FROM billing_gateway.operations o
      WHERE o.account_id=NEW.account_id AND o.operation_id=NEW.close_operation_id
        AND o.subscription_id=NEW.subscription_id AND o.clinic_id=NEW.clinic_id
        AND o.kind='close_unpaid_checkout' AND o.business_key=NEW.old_checkout_id AND o.state='confirmed';
    IF v_result->>'checkoutId' IS DISTINCT FROM NEW.old_checkout_id
      OR v_result->>'closed' IS DISTINCT FROM 'true'
      OR v_result->>'amountMinor' IS DISTINCT FROM v_amount::text
      OR v_result->>'productId' IS DISTINCT FROM v_product
    THEN RAISE EXCEPTION 'Unpaid closure proof missing' USING ERRCODE='23514'; END IF;
    NEW.close_proof_operation_id:=NEW.close_operation_id;
    IF NEW.phase='closed' THEN NEW.closed_at:=now();
    ELSE
      SELECT o.result INTO v_result FROM billing_gateway.operations o
        WHERE o.account_id=NEW.account_id AND o.operation_id=NEW.create_operation_id
          AND o.subscription_id=NEW.subscription_id AND o.clinic_id=NEW.clinic_id
          AND o.kind='replace_checkout' AND o.business_key='replace:'||NEW.id::text AND o.state='confirmed';
      IF v_result->>'checkoutId' IS DISTINCT FROM NEW.new_checkout_id
        OR v_result->>'externalId' IS DISTINCT FROM 'qoro-initial-replacement-'||NEW.id::text
        OR v_result->>'amountMinor' IS DISTINCT FROM v_amount::text
        OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
      THEN RAISE EXCEPTION 'Replacement creation proof missing' USING ERRCODE='23514'; END IF;
      NEW.bound_at:=now();
      NEW.create_proof_operation_id:=NEW.create_operation_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER initial_checkout_replacement_guard BEFORE INSERT OR UPDATE
ON billing_gateway.initial_checkout_replacements FOR EACH ROW
EXECUTE FUNCTION billing_gateway.guard_initial_checkout_replacement();

-- Keep account/customer/subscription identities immutable. The checkout pointer
-- may advance once, ONLY through the explicitly journaled unpaid correction.
CREATE OR REPLACE FUNCTION billing_gateway.preserve_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,billing_gateway AS $$
BEGIN
  IF TG_TABLE_NAME='accounts' THEN
    IF ROW(NEW.id,NEW.provider,NEW.environment,NEW.external_account_id)
      IS DISTINCT FROM ROW(OLD.id,OLD.provider,OLD.environment,OLD.external_account_id) THEN
      RAISE EXCEPTION 'Gateway account identity is immutable' USING ERRCODE='23514',CONSTRAINT='gateway_origin_immutable';
    END IF;
  ELSE
    IF ROW(NEW.subscription_id,NEW.clinic_id,NEW.account_id)
      IS DISTINCT FROM ROW(OLD.subscription_id,OLD.clinic_id,OLD.account_id)
      OR (OLD.external_customer_id IS NOT NULL AND NEW.external_customer_id IS DISTINCT FROM OLD.external_customer_id)
      OR (OLD.external_subscription_id IS NOT NULL AND NEW.external_subscription_id IS DISTINCT FROM OLD.external_subscription_id)
      OR (OLD.external_checkout_id IS NOT NULL AND NEW.external_checkout_id IS DISTINCT FROM OLD.external_checkout_id
        AND NOT (OLD.external_customer_id IS NULL AND OLD.external_subscription_id IS NULL
          AND NEW.external_customer_id IS NULL AND NEW.external_subscription_id IS NULL
          AND EXISTS(SELECT 1 FROM billing_gateway.initial_checkout_replacements r
            WHERE r.account_id=OLD.account_id AND r.subscription_id=OLD.subscription_id AND r.clinic_id=OLD.clinic_id
              AND r.phase='bound' AND r.old_checkout_id=OLD.external_checkout_id AND r.new_checkout_id=NEW.external_checkout_id))) THEN
      RAISE EXCEPTION 'Subscription gateway origin is immutable' USING ERRCODE='23514',CONSTRAINT='gateway_origin_immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION billing_gateway.attach_initial_checkout_replacement() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,billing_gateway AS $$
BEGIN
  IF NEW.phase='bound' THEN
    UPDATE billing_gateway.bindings SET external_checkout_id=NEW.new_checkout_id
      WHERE subscription_id=NEW.subscription_id AND clinic_id=NEW.clinic_id
        AND account_id=NEW.account_id AND external_checkout_id=NEW.old_checkout_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Replacement attachment failed' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER initial_checkout_replacement_attach AFTER UPDATE
ON billing_gateway.initial_checkout_replacements FOR EACH ROW
EXECUTE FUNCTION billing_gateway.attach_initial_checkout_replacement();
REVOKE ALL ON FUNCTION billing_gateway.guard_initial_checkout_replacement(),
  billing_gateway.attach_initial_checkout_replacement() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_gateway.guard_initial_checkout_replacement(),
  billing_gateway.attach_initial_checkout_replacement() TO service_role;
