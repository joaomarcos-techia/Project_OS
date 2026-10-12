-- Desconexao em duas fases: bloquear novas cobrancas antes de tratar o webhook.
-- Uma conta pausada continua ativa para conciliar cobrancas e estornos antigos.
ALTER TABLE public.clinic_payment_accounts
  ADD COLUMN accept_new_charges boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE public.clinic_payment_accounts
  ADD CONSTRAINT clinic_payment_accounts_inactive_cannot_charge_chk
  CHECK (active = true OR accept_new_charges = false) NOT VALID;
--> statement-breakpoint
UPDATE public.clinic_payment_accounts
  SET accept_new_charges = false WHERE active = false;
--> statement-breakpoint
ALTER TABLE public.clinic_payment_accounts
  VALIDATE CONSTRAINT clinic_payment_accounts_inactive_cannot_charge_chk;
--> statement-breakpoint
GRANT SELECT (accept_new_charges) ON public.clinic_payment_accounts TO authenticated;
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0111-payment-account-pause')
ON CONFLICT (version) DO NOTHING;
