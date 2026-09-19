-- O-4: seleção autenticada do plano no mesmo draft pré-tenant.
ALTER TABLE "signup_sessions"
  ADD COLUMN "selected_plan_id" uuid;--> statement-breakpoint

ALTER TABLE "signup_sessions"
  ADD CONSTRAINT "signup_sessions_selected_plan_id_fk"
  FOREIGN KEY ("selected_plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT;--> statement-breakpoint

-- A tabela continua GLOBAL PROTECTED: grants e RLS não mudam.
INSERT INTO _schema_version (version) VALUES ('signup-plan-selection')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
