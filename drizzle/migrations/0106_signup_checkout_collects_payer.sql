-- O Asaas Checkout coleta telefone, endereco, documento e cartao. O Qoro nao
-- inventa dados para criar um customer incompleto: o customer nasce no provider
-- quando o pagador conclui a jornada e so entao e gravado localmente.
ALTER TABLE "signup_sessions"
  DROP CONSTRAINT "signup_sessions_billing_provider_state_check";--> statement-breakpoint

ALTER TABLE "signup_sessions"
  ADD CONSTRAINT "signup_sessions_billing_provider_state_check" CHECK (
    ("billing_attempt_state" = 'active'
      AND "asaas_subscription_id" IS NOT NULL
      AND "asaas_customer_id" IS NOT NULL
      AND num_nonnulls("asaas_checkout_id", "asaas_checkout_url") IN (0, 2))
    OR ("billing_attempt_state" = 'checkout_pending'
      AND "asaas_subscription_id" IS NULL
      AND "asaas_customer_id" IS NULL
      AND "asaas_checkout_id" IS NOT NULL
      AND "asaas_checkout_url" IS NOT NULL)
    OR ("billing_attempt_state" IS DISTINCT FROM 'active'
      AND "billing_attempt_state" IS DISTINCT FROM 'checkout_pending'
      AND "asaas_subscription_id" IS NULL
      AND "asaas_checkout_id" IS NULL
      AND "asaas_checkout_url" IS NULL)
  );--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('signup-checkout-collects-payer')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
