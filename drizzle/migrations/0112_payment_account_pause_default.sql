-- Uma linha criada inativa tambem deve nascer sem permissao para cobrar.
-- O upsert de conexao ativa explicitamente accept_new_charges=true.
ALTER TABLE public.clinic_payment_accounts
  ALTER COLUMN accept_new_charges SET DEFAULT false;
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0112-payment-account-pause-default')
ON CONFLICT (version) DO NOTHING;
