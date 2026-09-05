-- A rota de webhook de paciente grava deduplicacao dentro de `withTenant`, que
-- executa como a role `authenticated`. A migration 0086 declarou a escrita como
-- service_role-only, mas o caminho real nunca usa service_role: por isso todo
-- pagamento confirmado falhava antes da conciliacao com `permission denied`.
--
-- Libera somente o INSERT append-only exigido pelo dedup. A policy restringe a
-- linha ao tenant fixado por `withTenant`; UPDATE e DELETE continuam proibidos.
CREATE POLICY patient_webhook_events_write ON public.patient_webhook_events FOR INSERT
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint

GRANT INSERT ON public.patient_webhook_events TO authenticated;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.patient_webhook_events FROM authenticated, anon;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0089-patient-webhook-authenticated-insert')
ON CONFLICT (version) DO NOTHING;
