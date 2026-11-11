-- Candidate only: NOT in the Drizzle journal, NOT applied remotely.
-- Choose the next free version after reconciling the TISS 0143-0146 journal.
-- Existing prices, invoices, access periods and provider bindings are preserved.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
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
