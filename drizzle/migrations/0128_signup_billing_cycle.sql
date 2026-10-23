ALTER TABLE public.signup_sessions
  ADD COLUMN selected_billing_cycle text NOT NULL DEFAULT 'monthly'
  CONSTRAINT signup_sessions_selected_billing_cycle_check
  CHECK (selected_billing_cycle IN ('monthly', 'annual'));
--> statement-breakpoint
INSERT INTO public._schema_version (version) VALUES ('0128-signup-billing-cycle')
ON CONFLICT (version) DO NOTHING;
