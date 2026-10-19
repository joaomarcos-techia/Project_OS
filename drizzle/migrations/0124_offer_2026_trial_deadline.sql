-- A nova oferta encerra o acesso de escrita ao completar 14 dias desde o Auth.
-- Contratos legados não recebem essa regra; o padrão FALSE preserva seu comportamento.
ALTER TABLE public.subscriptions
  ADD COLUMN enforce_trial_deadline boolean NOT NULL DEFAULT false;
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0124-offer-2026-trial-deadline')
ON CONFLICT (version) DO NOTHING;
