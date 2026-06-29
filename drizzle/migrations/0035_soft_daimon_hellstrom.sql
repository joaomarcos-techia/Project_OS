CREATE TABLE IF NOT EXISTS "prescription_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"categoria" text,
	"medicamentos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observacoes" text,
	"kind" "prescription_kind" DEFAULT 'simples' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription_templates" ADD CONSTRAINT "prescription_templates_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescription_templates_clinic_doctor_idx" ON "prescription_templates" USING btree ("clinic_id","doctor_id");--> statement-breakpoint

-- =====================================================================
-- Fase 2 hand-edit (append) — cross-context FK + RLS + trigger + GRANTs +
-- unique case-insensitive. drizzle-kit gera só tabela/colunas/índice/FK-intra;
-- o resto é mantido à mão (padrão 0017_clinical_core.sql / CONVENTIONS).
-- =====================================================================

-- 1. Cross-context FK (profiles — fora do Drizzle por boundaries). Modelo de
--    receita NÃO é registro legal (≠ prescriptions, que é RESTRICT): se o médico
--    é removido, seus modelos somem junto → ON DELETE CASCADE.
ALTER TABLE "prescription_templates" ADD CONSTRAINT "prescription_templates_doctor_id_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- 2. RLS — defaultTenantPolicy(v1) (ENABLE + FORCE). Isolamento por médico
--    (doctor_id) é feito na camada de aplicação (WHERE), não no RLS.
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "prescription_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prescription_templates" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "prescription_templates_tenant_access" ON "prescription_templates" FOR ALL
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  )
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint

-- 3. updated_at trigger (tabela mutável).
CREATE TRIGGER trg_prescription_templates_updated_at BEFORE UPDATE ON prescription_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- 4. GRANTs explícitos (padrão 0012/0017 — não depender de default-privilege).
GRANT SELECT, INSERT, UPDATE, DELETE ON prescription_templates TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON prescription_templates TO service_role;--> statement-breakpoint

-- 5. Unique case-insensitive por (clínica, médico, nome) — anti-duplicata (G6).
CREATE UNIQUE INDEX IF NOT EXISTS "prescription_templates_clinic_doctor_nome_uniq" ON "prescription_templates" (clinic_id, doctor_id, lower(nome));