CREATE TYPE "public"."chamada_tipo" AS ENUM('chamada', 'rechamada');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chamadas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid,
	"snapshot_patient_nome" text NOT NULL,
	"doctor_id" uuid NOT NULL,
	"snapshot_doctor_nome" text NOT NULL,
	"tipo" "chamada_tipo" DEFAULT 'chamada' NOT NULL,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL,
	"called_by" uuid,
	"correlation_id" uuid
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chamadas" ADD CONSTRAINT "chamadas_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chamadas_clinic_id_idx" ON "chamadas" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chamadas_clinic_called_at_idx" ON "chamadas" USING btree ("clinic_id","called_at");--> statement-breakpoint

-- =====================================================================
-- C8 hand-edit (append) — cross-context FKs + RLS + GRANTs + Realtime.
-- drizzle-kit gera só tabela/enum/índices/FK intra-context (clinics); o resto é
-- mantido à mão (padrão de 0017_clinical_core.sql / CONVENTIONS).
-- chamadas é APPEND-ONLY: sem updated_at, sem trigger set_updated_at.
-- =====================================================================

-- 1. Cross-context FKs (appointments / patients / profiles — fora do Drizzle por
--    boundaries; vivem aqui). appointment CASCADE: chamada é display de uma
--    consulta, some com ela. patient SET NULL: walk-in/anonimização preserva o
--    snapshot do nome. doctor RESTRICT: integridade do médico que chamou.
--    `called_by` segue o padrão de created_by (sem FK enforced).
ALTER TABLE "chamadas" ADD CONSTRAINT "chamadas_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chamadas" ADD CONSTRAINT "chamadas_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chamadas" ADD CONSTRAINT "chamadas_doctor_id_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- 2. RLS — defaultTenantPolicy(v1) (ENABLE + FORCE). Mesmo gate da clínica vale
--    para o Realtime: o subscriber autenticado só recebe linhas do seu tenant
--    (current_clinic_id() = claim JWT).
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "chamadas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chamadas" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "chamadas_tenant_access" ON "chamadas" FOR ALL
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

-- 3. GRANTs explícitos (padrão 0017 — não depender de default-privilege do
--    Supabase). chamadas é append-only: authenticated só SELECT/INSERT. SELECT é
--    necessário para a RLS do Realtime postgres_changes avaliar a policy.
GRANT SELECT, INSERT ON chamadas TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON chamadas TO service_role;--> statement-breakpoint

-- 4. Realtime — REPLICA IDENTITY FULL para o filtro por clinic_id em UPDATE/DELETE
--    receber o old-row, e inclusão na publication supabase_realtime. Guardado:
--    só roda se a publication existir (Supabase a cria por padrão); ADD TABLE é
--    idempotente via EXCEPTION (segunda aplicação não falha).
ALTER TABLE "chamadas" REPLICA IDENTITY FULL;--> statement-breakpoint
ALTER TABLE "appointments" REPLICA IDENTITY FULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE chamadas;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE appointments;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;--> statement-breakpoint

-- 5. Schema version snapshot.
INSERT INTO _schema_version (version) VALUES ('c8-consultorio-chamadas') ON CONFLICT (version) DO NOTHING;