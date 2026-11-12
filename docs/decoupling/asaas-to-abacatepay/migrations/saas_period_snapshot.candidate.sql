-- Candidate only: NOT in the Drizzle journal, NOT applied remotely.
-- Choose the next free version only after freezing/reconciling the TISS tail.
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

-- Shared, resumable statement scans. Purpose separates approved-card receipts
-- from adjustment observations; neither stream can prove the other.
-- Monthly partitions avoid a
-- repeated store-wide scan for each tenant. No invoice or access is granted here.
CREATE TABLE billing_gateway.statement_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES billing_gateway.accounts(id) ON DELETE RESTRICT,
  month_start date NOT NULL CHECK (extract(day FROM month_start)=1),
  purpose text NOT NULL DEFAULT 'card_approved' CHECK (purpose IN ('card_approved','adjustments')),
  generation uuid NOT NULL DEFAULT gen_random_uuid(),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','complete')),
  refresh_kind text NOT NULL DEFAULT 'full' CHECK (refresh_kind IN ('full','head')),
  full_completed_at timestamptz,
  after_cursor text,
  seen_cursor_hashes text[] NOT NULL DEFAULT '{}',
  pages_scanned integer NOT NULL DEFAULT 0 CHECK (pages_scanned>=0),
  rows_scanned bigint NOT NULL DEFAULT 0 CHECK (rows_scanned>=0),
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  failures integer NOT NULL DEFAULT 0 CHECK (failures>=0),
  completed_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_error text CHECK (last_error IN ('unavailable','pagination_invalid','invalid_response','binding_mismatch')),
  UNIQUE(account_id,month_start,purpose),
  UNIQUE(id,account_id,purpose),
  CHECK ((lease_token IS NULL)=(lease_until IS NULL)),
  CHECK ((state='complete')=(completed_at IS NOT NULL))
);
CREATE INDEX statement_scans_due_idx ON billing_gateway.statement_scans(account_id,next_attempt_at,updated_at,id)
  WHERE state='pending';
CREATE TABLE billing_gateway.statement_scan_items (
  account_id uuid NOT NULL,
  purpose text NOT NULL DEFAULT 'card_approved' CHECK (purpose IN ('card_approved','adjustments')),
  statement_id text NOT NULL CHECK (statement_id ~ '^tran_[A-Za-z0-9_-]+$'),
  scan_id uuid NOT NULL,
  seen_generation uuid NOT NULL,
  checkout_id text,
  statement_created_at timestamptz NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  conflict boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  PRIMARY KEY(account_id,purpose,statement_id),
  FOREIGN KEY(scan_id,account_id,purpose) REFERENCES billing_gateway.statement_scans(id,account_id,purpose) ON DELETE RESTRICT,
  CHECK (payload->>'id'=statement_id),
  CHECK ((payload->>'checkoutId') IS NOT DISTINCT FROM checkout_id)
);
CREATE INDEX statement_scan_items_receipt_idx ON billing_gateway.statement_scan_items(scan_id,seen_generation,checkout_id,statement_created_at);
ALTER TABLE billing_gateway.statement_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.statement_scans FORCE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.statement_scan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.statement_scan_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON billing_gateway.statement_scans,billing_gateway.statement_scan_items FROM PUBLIC,anon,authenticated,service_role,qoro_runtime;
GRANT SELECT,INSERT,UPDATE ON billing_gateway.statement_scans,billing_gateway.statement_scan_items TO service_role;
