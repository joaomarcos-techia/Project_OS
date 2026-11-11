-- Candidate only: NOT in the Drizzle journal, NOT applied remotely.
-- Choose the next free version after reconciling TISS, including its local 0147.
-- Existing prices, invoices, access periods and provider bindings are preserved.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
ALTER TABLE billing_gateway.operations DROP CONSTRAINT operations_kind_check;
ALTER TABLE billing_gateway.operations ADD CONSTRAINT operations_kind_check
  CHECK (kind IN ('create_checkout','change_plan','cancel_subscription','proration_checkout','recontract_checkout','close_paid_checkout'));
ALTER TABLE billing_gateway.recurring_payment_observations
  ADD COLUMN provider_period_start date,
  ADD COLUMN provider_period_end date;
ALTER TABLE billing_gateway.recurring_payment_observations
  DROP CONSTRAINT recurring_payment_observations_account_id_checkout_id_key,
  DROP CONSTRAINT recurring_payment_observations_check;
ALTER TABLE billing_gateway.recurring_payment_observations
  ADD CONSTRAINT recurring_period_snapshot_required CHECK (
    checkout_id <> origin_checkout_id OR
    (provider_period_start IS NOT NULL AND provider_period_end IS NOT NULL
      AND provider_period_end > provider_period_start
      AND (charge_created_at AT TIME ZONE 'UTC')::date >= provider_period_start
      AND (charge_created_at AT TIME ZONE 'UTC')::date < provider_period_end)
  );
-- payment_id and statement_id remain unique per account; the access ledger
-- still permits only one payment per original monthly cycle.

-- Independent authenticated GET provenance. Never insert a synthetic webhook.
CREATE TABLE billing_gateway.renewal_api_readbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  external_subscription_id text NOT NULL CHECK (external_subscription_id ~ '^subs_[A-Za-z0-9_-]+$'),
  external_customer_id text NOT NULL CHECK (external_customer_id ~ '^cust_[A-Za-z0-9_-]+$'),
  checkout_id text NOT NULL CHECK (checkout_id ~ '^bill_[A-Za-z0-9_-]+$'),
  payment_id text NOT NULL CHECK (payment_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'),
  statement_id text NOT NULL CHECK (statement_id ~ '^tran_[A-Za-z0-9_-]+$'),
  price_id uuid NOT NULL REFERENCES public.prices(id) ON DELETE RESTRICT,
  product_id text NOT NULL CHECK (product_id ~ '^prod_[A-Za-z0-9_-]+$'),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 999999999999),
  currency text NOT NULL CHECK (currency='BRL'),
  charge_created_at timestamptz NOT NULL,
  confirmed_at timestamptz NOT NULL,
  observed_recurrence text NOT NULL CHECK (observed_recurrence IN ('running','stopped')),
  provider_period_start date NOT NULL,
  provider_period_end date NOT NULL CHECK (provider_period_end > provider_period_start),
  proof_hash text NOT NULL CHECK (proof_hash ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id,payment_id),
  UNIQUE(account_id,statement_id),
  UNIQUE(account_id,id,subscription_id,clinic_id,payment_id,statement_id),
  CHECK ((charge_created_at AT TIME ZONE 'UTC')::date >= provider_period_start
    AND (charge_created_at AT TIME ZONE 'UTC')::date < provider_period_end),
  FOREIGN KEY(subscription_id,clinic_id,account_id)
    REFERENCES billing_gateway.bindings(subscription_id,clinic_id,account_id) ON DELETE RESTRICT
);
CREATE INDEX renewal_api_readbacks_contract_idx ON billing_gateway.renewal_api_readbacks(subscription_id,observed_at);
CREATE TRIGGER renewal_api_readbacks_preserve_snapshot BEFORE UPDATE ON billing_gateway.renewal_api_readbacks
  FOR EACH ROW EXECUTE FUNCTION billing_gateway.preserve_financial_snapshot();
ALTER TABLE billing_gateway.renewal_api_readbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.renewal_api_readbacks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON billing_gateway.renewal_api_readbacks FROM PUBLIC,anon,authenticated,service_role,qoro_runtime;
GRANT SELECT,INSERT ON billing_gateway.renewal_api_readbacks TO service_role;

ALTER TABLE billing_gateway.recurring_payment_observations
  ALTER COLUMN source_event_id DROP NOT NULL,
  ADD COLUMN source_readback_id uuid,
  ADD CONSTRAINT recurring_payment_source_exactly_one CHECK (
    (source_event_id IS NULL) <> (source_readback_id IS NULL)
  ),
  ADD CONSTRAINT recurring_payment_api_provenance FOREIGN KEY
    (account_id,source_readback_id,subscription_id,clinic_id,payment_id,statement_id)
    REFERENCES billing_gateway.renewal_api_readbacks(account_id,id,subscription_id,clinic_id,payment_id,statement_id)
    ON DELETE RESTRICT;
