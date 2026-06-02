CREATE TYPE "public"."medical_document_type" AS ENUM('atestado', 'exame', 'declaracao', 'encaminhamento');--> statement-breakpoint
CREATE TYPE "public"."prontuario_status" AS ENUM('rascunho', 'assinado');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "medical_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"type" "medical_document_type" NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pdf_storage_path" text,
	"snapshot_patient_nome" text NOT NULL,
	"snapshot_doctor_nome" text NOT NULL,
	"snapshot_doctor_crm" text NOT NULL,
	"snapshot_doctor_crm_uf" text,
	"snapshot_doctor_especialidade" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"prontuario_id" uuid,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"medicamentos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observacoes" text,
	"pdf_storage_path" text,
	"snapshot_patient_nome" text NOT NULL,
	"snapshot_doctor_nome" text NOT NULL,
	"snapshot_doctor_crm" text NOT NULL,
	"snapshot_doctor_crm_uf" text,
	"snapshot_doctor_especialidade" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prontuario_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"prontuario_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"edited_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prontuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"appointment_id" uuid,
	"status" "prontuario_status" DEFAULT 'rascunho' NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"signed_at" timestamp with time zone,
	"signed_by" uuid,
	"signed_doctor_nome" text,
	"signed_doctor_crm" text,
	"signed_doctor_crm_uf" text,
	"signed_doctor_especialidade" text,
	"needs_return" boolean DEFAULT false NOT NULL,
	"return_days" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prontuarios_return_days_chk" CHECK ("prontuarios"."needs_return" = false OR "prontuarios"."return_days" > 0)
);
--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "endereco" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "primary_color" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "crm" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "crm_uf" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "especialidade" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medical_documents" ADD CONSTRAINT "medical_documents_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_prontuario_id_prontuarios_id_fk" FOREIGN KEY ("prontuario_id") REFERENCES "public"."prontuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prontuario_versions" ADD CONSTRAINT "prontuario_versions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prontuario_versions" ADD CONSTRAINT "prontuario_versions_prontuario_id_prontuarios_id_fk" FOREIGN KEY ("prontuario_id") REFERENCES "public"."prontuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prontuarios" ADD CONSTRAINT "prontuarios_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medical_documents_clinic_id_idx" ON "medical_documents" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medical_documents_clinic_patient_idx" ON "medical_documents" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescriptions_clinic_id_idx" ON "prescriptions" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescriptions_clinic_patient_idx" ON "prescriptions" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescriptions_prontuario_id_idx" ON "prescriptions" USING btree ("prontuario_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prontuario_versions_clinic_id_idx" ON "prontuario_versions" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prontuario_versions_prontuario_id_idx" ON "prontuario_versions" USING btree ("prontuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prontuario_versions_prontuario_version_uniq" ON "prontuario_versions" USING btree ("prontuario_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prontuarios_clinic_id_idx" ON "prontuarios" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prontuarios_clinic_patient_idx" ON "prontuarios" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prontuarios_appointment_uniq" ON "prontuarios" USING btree ("appointment_id") WHERE appointment_id IS NOT NULL;--> statement-breakpoint

-- =====================================================================
-- C7 hand-edit (append) — cross-context FKs + RLS + triggers + imutabilidade
-- + GRANTs. drizzle-kit gera só tabelas/colunas/índices/FK intra-context; o
-- resto é mantido à mão (padrão de 0011_patient_core.sql / CONVENTIONS).
-- =====================================================================

-- 1. Cross-context FKs (patients / appointments / profiles — fora do Drizzle
--    por boundaries; vivem aqui). patient_id ON DELETE RESTRICT: prontuário e
--    documentos são registro legal (CFM ~20 anos). O conflito com o hard-delete
--    LGPD da C5 está documentado em ADR-017 (anonimização = camada futura).
ALTER TABLE "prontuarios" ADD CONSTRAINT "prontuarios_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prontuarios" ADD CONSTRAINT "prontuarios_doctor_id_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prontuarios" ADD CONSTRAINT "prontuarios_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prontuarios" ADD CONSTRAINT "prontuarios_signed_by_profiles_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_doctor_id_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_documents" ADD CONSTRAINT "medical_documents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_documents" ADD CONSTRAINT "medical_documents_doctor_id_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- 2. RLS — defaultTenantPolicy(v1) nas 4 tabelas tenant-scoped (ENABLE + FORCE).
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "prontuarios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prontuarios" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "prontuarios_tenant_access" ON "prontuarios" FOR ALL
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
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "prontuario_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prontuario_versions" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "prontuario_versions_tenant_access" ON "prontuario_versions" FOR ALL
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
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "prescriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prescriptions" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "prescriptions_tenant_access" ON "prescriptions" FOR ALL
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
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "medical_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "medical_documents" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "medical_documents_tenant_access" ON "medical_documents" FOR ALL
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

-- 3. updated_at triggers (tabelas mutáveis; NÃO em prontuario_versions append-only).
CREATE TRIGGER trg_prontuarios_updated_at BEFORE UPDATE ON prontuarios FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_prescriptions_updated_at BEFORE UPDATE ON prescriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_medical_documents_updated_at BEFORE UPDATE ON medical_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- 4. Imutabilidade pós-assinatura (Regra 4 / R2) — núcleo jurídico no banco.
--    Bloqueia QUALQUER UPDATE de prontuário assinado, salvo o bypass transação-local
--    `app.allow_signed_edit='on'` (editSignedProntuario) — e, mesmo com bypass, só
--    `content` (+ version/row_version/updated_at) pode mudar; assinatura/identidade
--    são imutáveis. SECURITY DEFINER + search_path fixo (ADR-010).
CREATE OR REPLACE FUNCTION public.block_signed_prontuario_update() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('app.allow_signed_edit', true) = 'on' THEN
    IF NEW.signed_at               IS DISTINCT FROM OLD.signed_at
    OR NEW.signed_by               IS DISTINCT FROM OLD.signed_by
    OR NEW.signed_doctor_nome      IS DISTINCT FROM OLD.signed_doctor_nome
    OR NEW.signed_doctor_crm       IS DISTINCT FROM OLD.signed_doctor_crm
    OR NEW.signed_doctor_crm_uf    IS DISTINCT FROM OLD.signed_doctor_crm_uf
    OR NEW.signed_doctor_especialidade IS DISTINCT FROM OLD.signed_doctor_especialidade
    OR NEW.doctor_id               IS DISTINCT FROM OLD.doctor_id
    OR NEW.patient_id              IS DISTINCT FROM OLD.patient_id
    OR NEW.clinic_id               IS DISTINCT FROM OLD.clinic_id
    OR NEW.appointment_id          IS DISTINCT FROM OLD.appointment_id
    OR NEW.needs_return            IS DISTINCT FROM OLD.needs_return
    OR NEW.return_days             IS DISTINCT FROM OLD.return_days
    OR NEW.status                  IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Prontuário assinado: apenas o conteúdo pode ser corrigido (com motivo).';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Prontuário assinado é imutável.';
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.block_signed_prontuario_update() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.block_signed_prontuario_update() TO authenticated, service_role;--> statement-breakpoint
CREATE TRIGGER trg_prontuarios_block_signed_update
  BEFORE UPDATE ON prontuarios FOR EACH ROW
  WHEN (OLD.signed_at IS NOT NULL)
  EXECUTE FUNCTION public.block_signed_prontuario_update();--> statement-breakpoint

-- 5. GRANTs explícitos (padrão 0012 — não depender de default-privilege do Supabase).
GRANT SELECT, INSERT, UPDATE, DELETE ON prontuarios TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON prontuarios TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON prontuario_versions TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON prontuario_versions TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON prescriptions TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON prescriptions TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON medical_documents TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON medical_documents TO service_role;--> statement-breakpoint

-- 6. Schema version snapshot.
INSERT INTO _schema_version (version) VALUES ('c7-clinical-core') ON CONFLICT (version) DO NOTHING;