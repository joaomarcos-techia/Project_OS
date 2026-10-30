-- Um upgrade da oferta 2026 só libera a vaga após pagamento do Checkout
-- correlacionado. O estado `creation_unknown` impede POST duplicado quando a
-- resposta do Asaas se perde depois da criação remota.
ALTER TABLE public.subscription_change_requests
  ADD COLUMN provider_checkout_id text,
  ADD COLUMN provider_checkout_expires_at timestamptz,
  ADD COLUMN checkout_creation_state text,
  ADD COLUMN checkout_lease_until timestamptz;
--> statement-breakpoint
ALTER TABLE public.subscription_change_requests
  ADD CONSTRAINT subscription_change_requests_checkout_state_chk
  CHECK (checkout_creation_state IS NULL OR checkout_creation_state IN ('creating', 'ready', 'creation_unknown'));
--> statement-breakpoint
CREATE UNIQUE INDEX subscription_change_requests_provider_checkout_uniq
  ON public.subscription_change_requests(provider_checkout_id)
  WHERE provider_checkout_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO public._schema_version (version) VALUES ('0131-subscription-upgrade-checkout')
ON CONFLICT (version) DO NOTHING;
