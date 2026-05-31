-- =====================================================================
-- 0012_patient_grants.sql
-- Remediação pré-C6 — F-05 (GRANT explícito nas tabelas de paciente) +
-- F-15 (índice de ordenação da listagem).
--
-- Forward-compatible / aditivo: só adiciona GRANTs e um índice. Código antigo
-- não nota o índice nem privilégios extras → seguro aplicar antes do deploy.
--
-- F-05: as 7 tabelas de paciente (0011) dependiam do default-privilege do
-- Supabase. A migration 0010 (HIGH-11) fixou o padrão "GRANT explícito, não
-- depender de default — necessário para self-host/migração". Espelhamos aqui:
-- SELECT/INSERT/UPDATE/DELETE a `authenticated` (RLS filtra) e a `service_role`.
--
-- F-15: índice parcial (clinic_id, updated_at) WHERE deleted_at IS NULL serve a
-- listagem default (escopo de clínica + ORDER BY updated_at DESC via scan reverso).
-- =====================================================================

-- 1. F-15 — índice de ordenação da listagem ativa.
CREATE INDEX IF NOT EXISTS "patients_clinic_updated_idx"
  ON "patients" USING btree ("clinic_id","updated_at")
  WHERE deleted_at IS NULL;--> statement-breakpoint

-- 2. F-05 — GRANTs explícitos (pattern de 0010).
GRANT SELECT, INSERT, UPDATE, DELETE ON patients TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON patients TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON patient_consents TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON patient_consents TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON patient_clinical_data TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON patient_clinical_data TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON patient_addresses TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON patient_addresses TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON patient_emergency_contacts TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON patient_emergency_contacts TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON suppression_list TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON suppression_list TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON lgpd_requests TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON lgpd_requests TO service_role;--> statement-breakpoint

-- 3. Schema version snapshot.
INSERT INTO _schema_version (version) VALUES ('remediation-0012-patient-grants')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
