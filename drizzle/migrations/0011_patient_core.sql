-- =====================================================================
-- 0011_patient_core.sql
-- C5 — Patient context (per-tenant encryption + LGPD)
-- Refs: ADR-007 (RLS patterns), ADR-012 (encryption strategy),
--       ADR-013 (clinical-data ownership), PlanoAção §5.
--
-- Categoria (ADR-007 §10): todas tenant-scoped (clinic_id FK CASCADE).
-- RLS: defaultTenantPolicy(v1) em TODAS as 7 tabelas (ENABLE + FORCE).
--
-- Encryption (ADR-012):
--   *_encrypted = base64(version||nonce||ciphertext||tag) — OPACO ao SQL,
--   nunca indexado/LIKE. *_hash = HMAC-SHA256 hex — único campo pesquisável.
--
-- Desvios mandatados pelo arquiteto (ADR-012/013):
--   - suppression_list DESACOPLADA de patients (sem patient_id/FK) → sobrevive
--     ao hard-delete cascade (teste 5.6.5). Chaveada por contact_hash.
--   - email normalizado (lower+trim); UNIQUE (clinic_id, email).
--   - patient_addresses.principal NOT NULL DEFAULT false; UNIQUE parcial.
-- =====================================================================

-- 1. EXTENSIONS -------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- 2. ENUMS ------------------------------------------------------------
CREATE TYPE "public"."patient_sexo" AS ENUM('M', 'F', 'O', 'N');--> statement-breakpoint
CREATE TYPE "public"."patient_address_tipo" AS ENUM('residencial', 'comercial', 'alternativo');--> statement-breakpoint
CREATE TYPE "public"."suppression_channel" AS ENUM('whatsapp', 'email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."lgpd_request_type" AS ENUM('export', 'delete');--> statement-breakpoint
CREATE TYPE "public"."lgpd_request_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint

-- 3. CREATE TABLE patients -------------------------------------------
CREATE TABLE IF NOT EXISTS "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"cpf_encrypted" text NOT NULL,
	"cpf_hash" text NOT NULL,
	"telefone_encrypted" text,
	"telefone_hash" text,
	"email" text NOT NULL,
	"data_nascimento" date,
	"sexo" "patient_sexo",
	"obito_em" date,
	"last_appointment_at" timestamp with time zone,
	"last_visit_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "patients_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint

-- 4. CREATE TABLE patient_consents -----------------------------------
CREATE TABLE IF NOT EXISTS "patient_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"dados_saude" boolean DEFAULT false NOT NULL,
	"compartilhamento" boolean DEFAULT false NOT NULL,
	"cobranca_whatsapp" boolean DEFAULT false NOT NULL,
	"marketing" boolean DEFAULT false NOT NULL,
	"pesquisa" boolean DEFAULT false NOT NULL,
	"versao" integer NOT NULL,
	"data_aceite" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_consents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "patient_consents_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "patient_consents_versao_chk" CHECK ("patient_consents"."versao" > 0)
);
--> statement-breakpoint

-- 5. CREATE TABLE patient_clinical_data (ADR-013) --------------------
CREATE TABLE IF NOT EXISTS "patient_clinical_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"alergias" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"medicamentos_em_uso" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"doencas_cronicas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tipo_sanguineo" text,
	"observacoes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_clinical_data_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "patient_clinical_data_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint

-- 6. CREATE TABLE patient_addresses ----------------------------------
CREATE TABLE IF NOT EXISTS "patient_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"tipo" "patient_address_tipo" DEFAULT 'residencial' NOT NULL,
	"logradouro_encrypted" text NOT NULL,
	"cidade" text NOT NULL,
	"estado" text NOT NULL,
	"cep_encrypted" text NOT NULL,
	"complemento" text,
	"principal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_addresses_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "patient_addresses_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint

-- 7. CREATE TABLE patient_emergency_contacts -------------------------
CREATE TABLE IF NOT EXISTS "patient_emergency_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"telefone_encrypted" text NOT NULL,
	"relacao" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_emergency_contacts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "patient_emergency_contacts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint

-- 8. CREATE TABLE suppression_list (sem patient_id / FK — ADR-012) ---
CREATE TABLE IF NOT EXISTS "suppression_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"contact_hash" text NOT NULL,
	"channel" "suppression_channel" NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppression_list_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "suppression_list_contact_channel_uniq" UNIQUE ("clinic_id", "contact_hash", "channel")
);
--> statement-breakpoint

-- 9. CREATE TABLE lgpd_requests (patient_id sem FK — sobrevive delete) -
CREATE TABLE IF NOT EXISTS "lgpd_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"type" "lgpd_request_type" NOT NULL,
	"status" "lgpd_request_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fulfilled_at" timestamp with time zone,
	"fulfilled_by_user_id" uuid,
	"export_signed_url" text,
	"export_signed_url_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lgpd_requests_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint

-- 10. INDEXES --------------------------------------------------------
-- patients
CREATE INDEX IF NOT EXISTS "patients_clinic_id_idx" ON "patients" USING btree ("clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "patients_clinic_cpf_uniq" ON "patients" USING btree ("clinic_id", "cpf_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patients_clinic_phone_idx" ON "patients" USING btree ("clinic_id", "telefone_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "patients_clinic_email_uniq" ON "patients" USING btree ("clinic_id", "email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patients_clinic_nome_idx" ON "patients" USING btree ("clinic_id", "nome");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patients_nome_trgm_idx" ON "patients" USING gin ("nome" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patients_active_idx" ON "patients" USING btree ("clinic_id") WHERE deleted_at IS NULL;--> statement-breakpoint
-- patient_consents
CREATE INDEX IF NOT EXISTS "patient_consents_clinic_id_idx" ON "patient_consents" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patient_consents_patient_id_idx" ON "patient_consents" USING btree ("patient_id");--> statement-breakpoint
-- patient_clinical_data
CREATE INDEX IF NOT EXISTS "patient_clinical_data_clinic_id_idx" ON "patient_clinical_data" USING btree ("clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "patient_clinical_data_patient_uniq" ON "patient_clinical_data" USING btree ("patient_id");--> statement-breakpoint
-- patient_addresses
CREATE INDEX IF NOT EXISTS "patient_addresses_clinic_id_idx" ON "patient_addresses" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patient_addresses_patient_id_idx" ON "patient_addresses" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "patient_addresses_one_principal_uniq" ON "patient_addresses" USING btree ("patient_id") WHERE principal = true;--> statement-breakpoint
-- patient_emergency_contacts
CREATE INDEX IF NOT EXISTS "patient_emergency_contacts_clinic_id_idx" ON "patient_emergency_contacts" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patient_emergency_contacts_patient_id_idx" ON "patient_emergency_contacts" USING btree ("patient_id");--> statement-breakpoint
-- suppression_list
CREATE INDEX IF NOT EXISTS "suppression_list_clinic_id_idx" ON "suppression_list" USING btree ("clinic_id");--> statement-breakpoint
-- lgpd_requests
CREATE INDEX IF NOT EXISTS "lgpd_requests_clinic_id_idx" ON "lgpd_requests" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lgpd_requests_patient_id_idx" ON "lgpd_requests" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lgpd_requests_status_idx" ON "lgpd_requests" USING btree ("status");--> statement-breakpoint

-- 11. RLS — defaultTenantPolicy(v1) em todas as 7 tabelas ------------
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patients" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "patients_tenant_access" ON "patients" FOR ALL
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
ALTER TABLE "patient_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patient_consents" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "patient_consents_tenant_access" ON "patient_consents" FOR ALL
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
ALTER TABLE "patient_clinical_data" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patient_clinical_data" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "patient_clinical_data_tenant_access" ON "patient_clinical_data" FOR ALL
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
ALTER TABLE "patient_addresses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patient_addresses" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "patient_addresses_tenant_access" ON "patient_addresses" FOR ALL
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
ALTER TABLE "patient_emergency_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patient_emergency_contacts" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "patient_emergency_contacts_tenant_access" ON "patient_emergency_contacts" FOR ALL
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
ALTER TABLE "suppression_list" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppression_list" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "suppression_list_tenant_access" ON "suppression_list" FOR ALL
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
ALTER TABLE "lgpd_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lgpd_requests" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "lgpd_requests_tenant_access" ON "lgpd_requests" FOR ALL
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

-- 12. updated_at TRIGGERS (mutable tables) --------------------------
CREATE TRIGGER trg_patients_updated_at BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_patient_clinical_data_updated_at BEFORE UPDATE ON patient_clinical_data FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_patient_addresses_updated_at BEFORE UPDATE ON patient_addresses FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_lgpd_requests_updated_at BEFORE UPDATE ON lgpd_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- 13. SCHEMA VERSION SNAPSHOT ---------------------------------------
INSERT INTO _schema_version (version) VALUES ('c5-patient-core')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
