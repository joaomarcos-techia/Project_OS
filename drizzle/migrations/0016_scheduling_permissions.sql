-- =====================================================================
-- 0016_scheduling_permissions.sql
-- C6 — permissões granulares de Scheduling (decisão founder).
--
-- Aditivo (template 0013): adiciona `manage:procedures` e `manage:availability`
-- ao catálogo e aos bundles. Código antigo não consulta estas permissions →
-- seguro aplicar ANTES do deploy do código C6.
--
-- Cardinalidade: role_permissions tem PK (role, permission_code) →
-- ON CONFLICT DO NOTHING garante idempotência. Após: catálogo = 23 permissions.
--   manage:procedures   → owner, gestor
--   manage:availability → owner, gestor, doctor (médico gere a própria agenda)
-- =====================================================================

INSERT INTO permissions (code, description) VALUES
  ('manage:procedures', 'Gerenciar catálogo de procedimentos (preço/duração)'),
  ('manage:availability', 'Gerenciar disponibilidade de médicos e feriados')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint

INSERT INTO role_permissions (role, permission_code) VALUES
  ('owner',  'manage:procedures'),
  ('gestor', 'manage:procedures'),
  ('owner',  'manage:availability'),
  ('gestor', 'manage:availability'),
  ('doctor', 'manage:availability')
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('c6-scheduling-permissions')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
