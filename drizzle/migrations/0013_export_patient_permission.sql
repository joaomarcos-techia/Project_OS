-- =====================================================================
-- 0013_export_patient_permission.sql
-- Remediação pré-C6 — F-07 (export LGPD com permissão dedicada).
--
-- Forward-compatible / aditivo: adiciona a permission `export:patient` ao
-- catálogo e aos bundles de `owner` e `gestor`. Código antigo (que ainda exige
-- `view:patient` para o export) simplesmente não consulta esta permission →
-- seguro aplicar ANTES do deploy do código do Lote D que passa a exigi-la.
--
-- Cardinalidade (F-07): role_permissions tem PK composta (role, permission_code),
-- então ON CONFLICT DO NOTHING garante idempotência (sem duplicatas / sem erro
-- em re-run). Após esta migration: catálogo = 21 permissions; role_permissions
-- total = 66 (owner 21, gestor 21, doctor 11, attendant 7, financial 6).
-- =====================================================================

INSERT INTO permissions (code, description) VALUES
  ('export:patient', 'Exportar dados completos do paciente (LGPD)')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint

INSERT INTO role_permissions (role, permission_code) VALUES
  ('owner',  'export:patient'),
  ('gestor', 'export:patient')
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('remediation-0013-export-patient-permission')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
