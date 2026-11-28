-- Readback history only. Does not change access, invoices, prices or legacy contracts.
-- Remote application requires separate explicit authorization.
CREATE TABLE billing_gateway.recurring_payment_observations (
  account_id uuid NOT NULL,
  payment_id text NOT NULL CHECK (payment_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'),
  statement_id text NOT NULL CHECK (statement_id ~ '^tran_[A-Za-z0-9_-]+$'),
  checkout_id text NOT NULL CHECK (checkout_id ~ '^bill_[A-Za-z0-9_-]+$'),
  origin_checkout_id text NOT NULL CHECK (origin_checkout_id ~ '^bill_[A-Za-z0-9_-]+$'),
  external_subscription_id text NOT NULL CHECK (external_subscription_id ~ '^subs_[A-Za-z0-9_-]+$'),
  external_customer_id text NOT NULL CHECK (external_customer_id ~ '^cust_[A-Za-z0-9_-]+$'),
  subscription_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  source_event_id text NOT NULL,
  price_id uuid NOT NULL REFERENCES public.prices(id) ON DELETE RESTRICT,
  product_id text NOT NULL CHECK (product_id ~ '^prod_[A-Za-z0-9_-]+$'),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 999999999999),
  currency text NOT NULL CHECK (currency='BRL'),
  charge_created_at timestamptz NOT NULL,
  confirmed_at timestamptz NOT NULL,
  observed_recurrence text NOT NULL CHECK (observed_recurrence IN ('running','stopped')),
  settlement text NOT NULL CHECK (settlement='unknown'),
  entitlement_effect text NOT NULL DEFAULT 'none' CHECK (entitlement_effect='none'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,payment_id),
  UNIQUE(account_id,statement_id),
  UNIQUE(account_id,checkout_id),
  UNIQUE(account_id,payment_id,subscription_id,clinic_id,external_subscription_id),
  CHECK (checkout_id <> origin_checkout_id),
  FOREIGN KEY(subscription_id,clinic_id,account_id)
    REFERENCES billing_gateway.bindings(subscription_id,clinic_id,account_id) ON DELETE RESTRICT,
  FOREIGN KEY(account_id,source_event_id)
    REFERENCES billing_gateway.event_inbox(account_id,event_id) ON DELETE RESTRICT
);
CREATE INDEX recurring_payment_observations_contract_idx
  ON billing_gateway.recurring_payment_observations(subscription_id,confirmed_at);
CREATE TRIGGER recurring_payment_observations_preserve_snapshot
  BEFORE UPDATE ON billing_gateway.recurring_payment_observations
  FOR EACH ROW EXECUTE FUNCTION billing_gateway.preserve_financial_snapshot();
ALTER TABLE billing_gateway.recurring_payment_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.recurring_payment_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON billing_gateway.recurring_payment_observations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON billing_gateway.recurring_payment_observations TO service_role;

-- Qoro access calendar, not a statement of the provider's next due date.
CREATE TABLE billing_gateway.recurring_access_periods (
  account_id uuid NOT NULL,
  payment_id text NOT NULL,
  external_subscription_id text NOT NULL CHECK (external_subscription_id ~ '^subs_[A-Za-z0-9_-]+$'),
  subscription_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  invoice_id uuid NOT NULL UNIQUE,
  cycle_index integer NOT NULL CHECK (cycle_index BETWEEN 1 AND 1200),
  anchor_start timestamptz NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL CHECK (period_end > period_start),
  access_effect text NOT NULL CHECK (access_effect IN ('advanced','historical','review')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,payment_id),
  UNIQUE(account_id,external_subscription_id,cycle_index),
  CHECK (period_start > anchor_start),
  CONSTRAINT recurring_access_calendar_start CHECK (period_start = ((anchor_start AT TIME ZONE 'UTC') + make_interval(months => cycle_index)) AT TIME ZONE 'UTC'),
  CONSTRAINT recurring_access_calendar_end CHECK (period_end = ((anchor_start AT TIME ZONE 'UTC') + make_interval(months => cycle_index + 1)) AT TIME ZONE 'UTC'),
  FOREIGN KEY(account_id,payment_id,subscription_id,clinic_id,external_subscription_id)
    REFERENCES billing_gateway.recurring_payment_observations(account_id,payment_id,subscription_id,clinic_id,external_subscription_id) ON DELETE RESTRICT,
  FOREIGN KEY(subscription_id,clinic_id,account_id)
    REFERENCES billing_gateway.bindings(subscription_id,clinic_id,account_id) ON DELETE RESTRICT,
  FOREIGN KEY(invoice_id,clinic_id,subscription_id)
    REFERENCES public.invoices(id,clinic_id,subscription_id) ON DELETE RESTRICT
);
CREATE TRIGGER recurring_access_periods_preserve_snapshot BEFORE UPDATE ON billing_gateway.recurring_access_periods
  FOR EACH ROW EXECUTE FUNCTION billing_gateway.preserve_financial_snapshot();
ALTER TABLE billing_gateway.recurring_access_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.recurring_access_periods FORCE ROW LEVEL SECURITY;
REVOKE ALL ON billing_gateway.recurring_access_periods FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON billing_gateway.recurring_access_periods TO service_role;
