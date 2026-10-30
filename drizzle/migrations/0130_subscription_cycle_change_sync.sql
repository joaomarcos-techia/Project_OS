-- A intenção é persistida antes do PUT no Asaas. O cron só pode aplicar a
-- troca local depois da confirmação autoritativa deste campo.
ALTER TABLE public.subscription_change_requests
  ADD COLUMN provider_synced_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.subscription_change_requests
  DROP CONSTRAINT subscription_change_requests_kind_target_chk;
--> statement-breakpoint
ALTER TABLE public.subscription_change_requests
  ADD CONSTRAINT subscription_change_requests_kind_target_chk CHECK (
    (kind::text = 'cancellation' AND to_plan_id IS NULL AND to_price_id IS NULL)
    OR (kind::text IN ('upgrade', 'downgrade', 'cycle_change')
      AND to_plan_id IS NOT NULL AND to_price_id IS NOT NULL)
  );
--> statement-breakpoint
INSERT INTO public._schema_version (version) VALUES ('0130-subscription-cycle-change-sync')
ON CONFLICT (version) DO NOTHING;
