-- Additive SaaS coexistence. No credentials, legacy backfill or repricing.
-- Apply only in an explicitly authorized environment after the preflight.
CREATE SCHEMA billing_gateway;
REVOKE ALL ON SCHEMA billing_gateway FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA billing_gateway TO service_role;
-- Constant defaults are metadata-only on the supported PostgreSQL version.
ALTER TABLE public.subscriptions ADD COLUMN billing_provider text NOT NULL DEFAULT 'asaas'
  CHECK (billing_provider IN ('asaas','abacatepay'));

CREATE TABLE billing_gateway.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('asaas', 'abacatepay')),
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  external_account_id text NOT NULL CHECK (external_account_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, environment, external_account_id)
);

-- No row change/rewrite. The extra unique index supports a real composite FK.
-- Future migration review must budget its DDL lock on public.subscriptions.
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_id_clinic_gateway_unique UNIQUE (id, clinic_id);
CREATE TABLE billing_gateway.bindings (
  subscription_id uuid PRIMARY KEY,
  clinic_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES billing_gateway.accounts(id) ON DELETE RESTRICT,
  external_customer_id text CHECK (external_customer_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'),
  external_checkout_id text CHECK (external_checkout_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'),
  external_subscription_id text CHECK (external_subscription_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (subscription_id, clinic_id) REFERENCES public.subscriptions(id, clinic_id) ON DELETE RESTRICT,
  UNIQUE(subscription_id, clinic_id, account_id),
  UNIQUE(account_id, external_subscription_id),
  UNIQUE(account_id, external_checkout_id),
  CHECK (external_subscription_id IS NULL OR external_customer_id IS NOT NULL)
);

CREATE FUNCTION billing_gateway.preserve_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, billing_gateway AS $$
BEGIN
  IF TG_TABLE_NAME = 'accounts' THEN
    IF ROW(NEW.id,NEW.provider,NEW.environment,NEW.external_account_id)
       IS DISTINCT FROM ROW(OLD.id,OLD.provider,OLD.environment,OLD.external_account_id) THEN
      RAISE EXCEPTION 'Gateway account identity is immutable' USING ERRCODE='23514', CONSTRAINT='gateway_origin_immutable';
    END IF;
  ELSE
    IF ROW(NEW.subscription_id,NEW.clinic_id,NEW.account_id)
       IS DISTINCT FROM ROW(OLD.subscription_id,OLD.clinic_id,OLD.account_id)
      OR (OLD.external_customer_id IS NOT NULL AND NEW.external_customer_id IS DISTINCT FROM OLD.external_customer_id)
      OR (OLD.external_checkout_id IS NOT NULL AND NEW.external_checkout_id IS DISTINCT FROM OLD.external_checkout_id)
      OR (OLD.external_subscription_id IS NOT NULL AND NEW.external_subscription_id IS DISTINCT FROM OLD.external_subscription_id) THEN
      RAISE EXCEPTION 'Subscription gateway origin is immutable' USING ERRCODE='23514', CONSTRAINT='gateway_origin_immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER accounts_preserve_origin BEFORE UPDATE ON billing_gateway.accounts
FOR EACH ROW EXECUTE FUNCTION billing_gateway.preserve_origin();
CREATE TRIGGER bindings_preserve_origin BEFORE UPDATE ON billing_gateway.bindings
FOR EACH ROW EXECUTE FUNCTION billing_gateway.preserve_origin();

-- Serialize the binding against concurrent edits of the legacy origin field.
CREATE FUNCTION billing_gateway.assert_subscription_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, billing_gateway AS $$
DECLARE v_asaas_id text; v_provider text; v_contract_provider text;
BEGIN
  IF TG_TABLE_NAME='bindings' THEN
    SELECT asaas_subscription_id,billing_provider INTO v_asaas_id,v_contract_provider FROM public.subscriptions
      WHERE id=NEW.subscription_id AND clinic_id=NEW.clinic_id FOR UPDATE;
    SELECT provider INTO v_provider FROM billing_gateway.accounts WHERE id=NEW.account_id;
  ELSE
    v_asaas_id := NEW.asaas_subscription_id;
    v_contract_provider := NEW.billing_provider;
    IF TG_OP='UPDATE' AND NEW.billing_provider IS DISTINCT FROM OLD.billing_provider THEN
      RAISE EXCEPTION 'Subscription provider is immutable'
        USING ERRCODE='23514',CONSTRAINT='gateway_subscription_origin_conflict';
    END IF;
    SELECT a.provider INTO v_provider FROM billing_gateway.bindings b
      JOIN billing_gateway.accounts a ON a.id=b.account_id WHERE b.subscription_id=NEW.id;
  END IF;
  IF (v_provider IS NOT NULL AND v_provider <> v_contract_provider)
    OR (v_contract_provider='abacatepay' AND v_asaas_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Subscription already belongs to another gateway'
      USING ERRCODE='23514',CONSTRAINT='gateway_subscription_origin_conflict';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER binding_check_subscription_origin BEFORE INSERT OR UPDATE ON billing_gateway.bindings
FOR EACH ROW EXECUTE FUNCTION billing_gateway.assert_subscription_origin();
CREATE TRIGGER subscription_check_gateway_origin BEFORE INSERT OR UPDATE OF asaas_subscription_id,billing_provider ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION billing_gateway.assert_subscription_origin();

CREATE TABLE billing_gateway.operations (
  account_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('create_checkout','change_plan','cancel_subscription','proration_checkout')),
  business_key text NOT NULL CHECK (length(business_key) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('running','confirmed','unknown')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, operation_id),
  FOREIGN KEY(subscription_id,clinic_id,account_id)
    REFERENCES billing_gateway.bindings(subscription_id,clinic_id,account_id) ON DELETE RESTRICT,
  UNIQUE(subscription_id,kind,business_key),
  CHECK ((state='confirmed' AND result IS NOT NULL) OR (state<>'confirmed' AND result IS NULL))
);
CREATE FUNCTION billing_gateway.preserve_operation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, billing_gateway AS $$
BEGIN
  IF ROW(NEW.account_id,NEW.operation_id,NEW.subscription_id,NEW.clinic_id,NEW.kind,NEW.business_key,NEW.request_hash)
     IS DISTINCT FROM ROW(OLD.account_id,OLD.operation_id,OLD.subscription_id,OLD.clinic_id,OLD.kind,OLD.business_key,OLD.request_hash)
    OR OLD.state='confirmed'
    OR NEW.state='running'
    OR (OLD.state='unknown' AND NEW.state<>'confirmed') THEN
    RAISE EXCEPTION 'Operation identity/result cannot be overwritten or retried'
      USING ERRCODE='23514', CONSTRAINT='gateway_operation_immutable';
  END IF;
  -- unknown -> confirmed is reserved for explicit authoritative reconciliation;
  -- this is not a lease or permission to resend the external command.
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER operations_preserve_identity BEFORE UPDATE ON billing_gateway.operations
FOR EACH ROW EXECUTE FUNCTION billing_gateway.preserve_operation();
CREATE UNIQUE INDEX gateway_initial_checkout_subscription_unique
  ON billing_gateway.operations(subscription_id) WHERE kind='create_checkout';

CREATE TABLE billing_gateway.event_inbox (
  account_id uuid NOT NULL REFERENCES billing_gateway.accounts(id) ON DELETE RESTRICT,
  event_id text NOT NULL CHECK (event_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.]{0,127}$'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  subscription_id uuid,
  clinic_id uuid,
  external_subscription_id text CHECK (external_subscription_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'),
  external_checkout_id text CHECK (external_checkout_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'),
  external_payment_id text CHECK (external_payment_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'),
  external_customer_id text CHECK (external_customer_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'),
  state text NOT NULL DEFAULT 'received' CHECK (state IN ('received','processing','applied','ignored','review')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_until timestamptz,
  lease_token uuid,
  outcome_code text CHECK (outcome_code IS NULL OR outcome_code ~ '^[a-z_]{1,80}$'),
  processed_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,event_id),
  CHECK ((subscription_id IS NULL) = (clinic_id IS NULL)),
  CHECK ((state='processing' AND lease_until IS NOT NULL AND lease_token IS NOT NULL)
    OR (state<>'processing' AND lease_until IS NULL AND lease_token IS NULL)),
  FOREIGN KEY(subscription_id,clinic_id,account_id)
    REFERENCES billing_gateway.bindings(subscription_id,clinic_id,account_id) ON DELETE RESTRICT
);
CREATE INDEX event_inbox_recovery_idx ON billing_gateway.event_inbox(state,lease_until,received_at);
CREATE FUNCTION billing_gateway.preserve_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, billing_gateway AS $$
BEGIN
  IF ROW(NEW.account_id,NEW.event_id,NEW.event_type,NEW.payload_hash,NEW.external_subscription_id,NEW.external_checkout_id,NEW.external_payment_id,NEW.external_customer_id)
     IS DISTINCT FROM ROW(OLD.account_id,OLD.event_id,OLD.event_type,OLD.payload_hash,OLD.external_subscription_id,OLD.external_checkout_id,OLD.external_payment_id,OLD.external_customer_id)
    OR (OLD.subscription_id IS NOT NULL AND ROW(NEW.subscription_id,NEW.clinic_id) IS DISTINCT FROM ROW(OLD.subscription_id,OLD.clinic_id))
    OR (OLD.state IN ('applied','ignored') AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Event identity/content is immutable' USING ERRCODE='23514', CONSTRAINT='gateway_event_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inbox_preserve_identity BEFORE UPDATE ON billing_gateway.event_inbox
FOR EACH ROW EXECUTE FUNCTION billing_gateway.preserve_event();

ALTER TABLE billing_gateway.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.operations FORCE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.event_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.event_inbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA billing_gateway FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA billing_gateway FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA billing_gateway TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA billing_gateway TO service_role;

-- A durable, pseudonymous eligibility claim survives removal of the clinic.
-- It does not link different accounts or confer access by matching an email.
CREATE TABLE billing_gateway.trial_claims (
  auth_user_id uuid PRIMARY KEY,
  email_hash text NOT NULL UNIQUE CHECK (email_hash ~ '^[a-f0-9]{64}$'),
  clinic_id uuid REFERENCES public.clinics(id) ON DELETE SET NULL,
  auth_created_at timestamptz NOT NULL,
  trial_ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (trial_ends_at = auth_created_at + interval '336 hours')
);
CREATE FUNCTION billing_gateway.preserve_trial_claim() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, billing_gateway AS $$
BEGIN
  IF ROW(NEW.auth_user_id,NEW.email_hash,NEW.auth_created_at,NEW.trial_ends_at,NEW.created_at)
       IS DISTINCT FROM ROW(OLD.auth_user_id,OLD.email_hash,OLD.auth_created_at,OLD.trial_ends_at,OLD.created_at)
     OR (OLD.clinic_id IS NULL AND NEW.clinic_id IS NOT NULL)
     OR (OLD.clinic_id IS NOT NULL AND NEW.clinic_id IS NOT NULL AND NEW.clinic_id <> OLD.clinic_id) THEN
    RAISE EXCEPTION 'Trial eligibility cannot be restarted'
      USING ERRCODE='23514', CONSTRAINT='gateway_trial_claim_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trial_claim_preserve_identity BEFORE UPDATE ON billing_gateway.trial_claims
FOR EACH ROW EXECUTE FUNCTION billing_gateway.preserve_trial_claim();
ALTER TABLE billing_gateway.trial_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.trial_claims FORCE ROW LEVEL SECURITY;

CREATE TABLE billing_gateway.checkout_intents (
  subscription_id uuid PRIMARY KEY,
  clinic_id uuid NOT NULL,
  account_id uuid NOT NULL,
  price_id uuid NOT NULL REFERENCES public.prices(id) ON DELETE RESTRICT,
  product_id text NOT NULL CHECK (product_id ~ '^prod_[A-Za-z0-9_-]+$'),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 999999999999),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(subscription_id,clinic_id,account_id)
    REFERENCES billing_gateway.bindings(subscription_id,clinic_id,account_id) ON DELETE RESTRICT
);
ALTER TABLE public.invoices ADD CONSTRAINT invoices_id_clinic_subscription_gateway_unique
  UNIQUE(id,clinic_id,subscription_id);
CREATE TABLE billing_gateway.paid_checkouts (
  account_id uuid NOT NULL,
  checkout_id text NOT NULL,
  subscription_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  invoice_id uuid NOT NULL UNIQUE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL CHECK (period_end > period_start),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,checkout_id),
  FOREIGN KEY(subscription_id,clinic_id,account_id)
    REFERENCES billing_gateway.bindings(subscription_id,clinic_id,account_id) ON DELETE RESTRICT,
  FOREIGN KEY(invoice_id,clinic_id,subscription_id)
    REFERENCES public.invoices(id,clinic_id,subscription_id) ON DELETE RESTRICT
);
CREATE FUNCTION billing_gateway.preserve_financial_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, billing_gateway AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Gateway financial snapshot is immutable'
      USING ERRCODE='23514',CONSTRAINT='gateway_snapshot_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER checkout_intent_preserve_snapshot BEFORE UPDATE ON billing_gateway.checkout_intents
FOR EACH ROW EXECUTE FUNCTION billing_gateway.preserve_financial_snapshot();
CREATE TRIGGER paid_checkout_preserve_snapshot BEFORE UPDATE ON billing_gateway.paid_checkouts
FOR EACH ROW EXECUTE FUNCTION billing_gateway.preserve_financial_snapshot();
ALTER TABLE billing_gateway.checkout_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.checkout_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.paid_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.paid_checkouts FORCE ROW LEVEL SECURITY;

-- Restrict inherited Supabase default grants too (lesson from 0137).
REVOKE ALL ON ALL TABLES IN SCHEMA billing_gateway FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA billing_gateway FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA billing_gateway TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA billing_gateway TO service_role;
-- No automatic POST retries, failover, access grants or paid-period update.
