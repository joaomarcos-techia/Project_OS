-- A constraint seguinte compara purpose::text, sem usar o novo literal de enum
-- antes do COMMIT do migrator (que agrupa todas as migrations pendentes).
ALTER TYPE public.consent_purpose ADD VALUE IF NOT EXISTS 'agendamento_whatsapp';
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0119-patient-whatsapp-scheduling-consent-enum')
ON CONFLICT (version) DO NOTHING;
