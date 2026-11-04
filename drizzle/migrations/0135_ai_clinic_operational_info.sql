-- Informações operacionais aprovadas pela clínica. Não habilita modalidade,
-- sinal, cobrança, consentimento ou alteração de contrato automaticamente.
ALTER TABLE public.ai_clinic_config
  ADD COLUMN operational_info jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE public.ai_clinic_config
  ADD CONSTRAINT ai_clinic_config_operational_info_chk
  CHECK (jsonb_typeof(operational_info) = 'object' AND octet_length(operational_info::text) <= 16000);
