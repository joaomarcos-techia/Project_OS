-- Segundo passo: a constraint anterior não aceita a nova finalidade.
ALTER TABLE public.patient_consent_decisions
  DROP CONSTRAINT patient_consent_decisions_channel_chk;
--> statement-breakpoint
ALTER TABLE public.patient_consent_decisions
  ADD CONSTRAINT patient_consent_decisions_channel_chk CHECK (
    (purpose::text IN ('agendamento_whatsapp', 'cobranca_whatsapp', 'marketing') AND channel = 'whatsapp')
    OR (purpose::text IN ('dados_saude', 'compartilhamento', 'pesquisa') AND channel IS NULL)
  );
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0120-patient-whatsapp-scheduling-consent-check')
ON CONFLICT (version) DO NOTHING;
