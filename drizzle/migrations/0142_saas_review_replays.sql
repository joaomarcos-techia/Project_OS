-- Authorizes one fresh readback of an already authenticated event, never a financial override.
CREATE TABLE billing_gateway.review_replays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  event_id text NOT NULL,
  subscription_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  expected_attempts integer NOT NULL CHECK (expected_attempts >= 0 AND expected_attempts < 2147483646),
  authorized_attempt integer GENERATED ALWAYS AS (expected_attempts+1) STORED,
  requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason IN ('provider_recovered','binding_reconciled','evidence_available')),
  evidence_reference text NOT NULL CHECK (evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id,event_id,expected_attempts),
  FOREIGN KEY(account_id,event_id) REFERENCES billing_gateway.event_inbox(account_id,event_id) ON DELETE RESTRICT,
  FOREIGN KEY(subscription_id,clinic_id,account_id)
    REFERENCES billing_gateway.bindings(subscription_id,clinic_id,account_id) ON DELETE RESTRICT
);
CREATE INDEX gateway_review_replays_latest ON billing_gateway.review_replays(account_id,event_id,authorized_attempt DESC);

CREATE FUNCTION billing_gateway.validate_review_replay() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,billing_gateway AS $$
DECLARE event_row billing_gateway.event_inbox; replay_count integer;
BEGIN
  SELECT * INTO event_row FROM billing_gateway.event_inbox
    WHERE account_id=NEW.account_id AND event_id=NEW.event_id FOR UPDATE;
  IF NOT FOUND OR event_row.state<>'review' OR event_row.attempts<>NEW.expected_attempts
    OR event_row.payload_hash<>NEW.payload_hash
    OR event_row.event_type NOT IN ('subscription.completed','subscription.renewed','subscription.cancelled',
      'subscription.payment_failed','checkout.refunded','checkout.disputed','checkout.lost')
    OR (event_row.subscription_id IS NOT NULL AND
      ROW(event_row.subscription_id,event_row.clinic_id) IS DISTINCT FROM ROW(NEW.subscription_id,NEW.clinic_id)) THEN
    RAISE EXCEPTION 'Review snapshot changed' USING ERRCODE='23514',CONSTRAINT='gateway_review_snapshot';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=NEW.requested_by
      AND p.role='super_admin' AND p.clinic_id IS NULL AND p.ativo AND p.deleted_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM billing_gateway.accounts a
      JOIN billing_gateway.bindings b ON b.account_id=a.id
      JOIN public.subscriptions s ON s.id=b.subscription_id AND s.clinic_id=b.clinic_id
      WHERE a.id=NEW.account_id AND a.provider='abacatepay' AND a.environment='sandbox'
        AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
        AND b.subscription_id=NEW.subscription_id AND b.clinic_id=NEW.clinic_id
        AND ((b.external_subscription_id=event_row.external_subscription_id
          AND b.external_customer_id=event_row.external_customer_id)
          OR EXISTS(SELECT 1 FROM billing_gateway.recontracts r WHERE r.account_id=a.id
            AND r.subscription_id=s.id AND r.clinic_id=s.clinic_id
            AND r.external_subscription_id=event_row.external_subscription_id
            AND r.external_customer_id=event_row.external_customer_id))) THEN
    RAISE EXCEPTION 'Review operator or binding invalid' USING ERRCODE='23514',CONSTRAINT='gateway_review_actor_binding';
  END IF;
  SELECT count(*) INTO replay_count FROM billing_gateway.review_replays
    WHERE account_id=NEW.account_id AND event_id=NEW.event_id AND created_at>now()-interval '24 hours';
  IF replay_count>=3 THEN
    RAISE EXCEPTION 'Review replay daily limit reached' USING ERRCODE='23514',CONSTRAINT='gateway_review_daily_limit';
  END IF;
  NEW.created_at:=clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER review_replay_validate BEFORE INSERT ON billing_gateway.review_replays
  FOR EACH ROW EXECUTE FUNCTION billing_gateway.validate_review_replay();
CREATE TRIGGER review_replay_immutable BEFORE UPDATE ON billing_gateway.review_replays
  FOR EACH ROW EXECUTE FUNCTION billing_gateway.preserve_financial_snapshot();
ALTER TABLE billing_gateway.review_replays ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_gateway.review_replays FORCE ROW LEVEL SECURITY;
REVOKE ALL ON billing_gateway.review_replays FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON billing_gateway.review_replays TO service_role;
REVOKE ALL ON FUNCTION billing_gateway.validate_review_replay() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION billing_gateway.validate_review_replay() TO service_role;
