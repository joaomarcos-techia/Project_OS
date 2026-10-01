-- O-5b: o cadastro passa pelo Checkout recorrente hospedado antes de criar o tenant.
-- O documento continua fora da tabela pre-tenant; ficam somente ids do provider
-- e a URL publica do Checkout, que nao contem credencial.
ALTER TABLE "signup_sessions"
  ADD COLUMN "asaas_checkout_id" text,
  ADD COLUMN "asaas_checkout_url" text;--> statement-breakpoint

ALTER TABLE "signup_sessions"
  DROP CONSTRAINT "signup_sessions_billing_attempt_check",
  DROP CONSTRAINT "signup_sessions_billing_active_check";--> statement-breakpoint

ALTER TABLE "signup_sessions"
  ADD CONSTRAINT "signup_sessions_billing_attempt_check" CHECK (
    num_nonnulls("billing_attempt_state", "billing_attempted_at") IN (0, 2)
    AND ("billing_attempt_state" IS NULL OR (
      "billing_attempt_state" IN ('reserved', 'checkout_pending', 'active', 'creation_unknown', 'failed')
      AND "selected_plan_id" IS NOT NULL
      AND "status" IN ('email_verified', 'expired', 'blocked')
    ))
  ),
  ADD CONSTRAINT "signup_sessions_billing_provider_state_check" CHECK (
    ("billing_attempt_state" = 'active'
      AND "asaas_subscription_id" IS NOT NULL
      AND "asaas_customer_id" IS NOT NULL)
    OR ("billing_attempt_state" = 'checkout_pending'
      AND "asaas_subscription_id" IS NULL
      AND "asaas_customer_id" IS NOT NULL
      AND "asaas_checkout_id" IS NOT NULL
      AND "asaas_checkout_url" IS NOT NULL)
    OR ("billing_attempt_state" IS DISTINCT FROM 'active'
      AND "billing_attempt_state" IS DISTINCT FROM 'checkout_pending'
      AND "asaas_subscription_id" IS NULL
      AND "asaas_checkout_id" IS NULL
      AND "asaas_checkout_url" IS NULL)
  ),
  ADD CONSTRAINT "signup_sessions_asaas_checkout_id_unique"
    UNIQUE ("asaas_checkout_id");--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('signup-hosted-checkout')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
