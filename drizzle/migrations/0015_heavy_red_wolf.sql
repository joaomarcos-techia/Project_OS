CREATE TYPE "public"."appointment_actor_type" AS ENUM('user', 'ai_agent', 'worker', 'system');--> statement-breakpoint
CREATE TYPE "public"."appointment_created_via" AS ENUM('attendant', 'ai_agent', 'walkin', 'super_admin');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('agendado', 'confirmado', 'chegou', 'em_atendimento', 'atendido', 'cancelado', 'faltou');--> statement-breakpoint
CREATE TYPE "public"."procedure_changed_field" AS ENUM('valor_padrao', 'duracao_padrao_min', 'descricao', 'ativo', 'categoria', 'codigo');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "appointment_state_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"from_status" "appointment_status",
	"to_status" "appointment_status" NOT NULL,
	"transitioned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"transitioned_by" uuid,
	"reason" text,
	"actor_type" "appointment_actor_type" DEFAULT 'user' NOT NULL,
	"source_event_id" uuid,
	"source_idempotency_key" text,
	"correlation_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"unit_id" uuid,
	"doctor_id" uuid NOT NULL,
	"patient_id" uuid,
	"procedure_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_min" integer NOT NULL,
	"status" "appointment_status" DEFAULT 'agendado' NOT NULL,
	"valor" numeric(12, 2) NOT NULL,
	"valor_ajustado" boolean DEFAULT false NOT NULL,
	"valor_ajuste_motivo" text,
	"snapshot_procedure_name" text NOT NULL,
	"snapshot_procedure_codigo" text,
	"snapshot_procedure_categoria" text,
	"snapshot_procedure_valor" numeric(12, 2) NOT NULL,
	"snapshot_procedure_duracao_min" integer NOT NULL,
	"snapshot_doctor_nome" text NOT NULL,
	"snapshot_doctor_crm" text,
	"snapshot_doctor_especialidade" text,
	"created_via" "appointment_created_via" DEFAULT 'attendant' NOT NULL,
	"urgencia" boolean DEFAULT false NOT NULL,
	"faturamento_pendente" boolean DEFAULT false NOT NULL,
	"observacoes" text,
	"created_by" uuid,
	"rescheduled_from_appointment_id" uuid,
	"slot_occupies_instant" boolean GENERATED ALWAYS AS (status <> 'cancelado' AND status <> 'faltou') STORED,
	"slot_blocks_overlap" boolean GENERATED ALWAYS AS (status <> 'cancelado' AND status <> 'faltou' AND created_via <> 'walkin') STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_duration_chk" CHECK ("appointments"."duration_min" > 0 AND "appointments"."duration_min" <= 480),
	CONSTRAINT "appointments_valor_chk" CHECK ("appointments"."valor" >= 0),
	CONSTRAINT "appointments_valor_ajuste_chk" CHECK ("appointments"."valor_ajustado" = false OR "appointments"."valor_ajuste_motivo" IS NOT NULL),
	CONSTRAINT "appointments_reschedule_self_chk" CHECK ("appointments"."rescheduled_from_appointment_id" IS NULL OR "appointments"."rescheduled_from_appointment_id" <> "appointments"."id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clinic_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text,
	"unit_id" uuid,
	"start_time" time,
	"end_time" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinic_holidays_clinic_date_unit_uniq" UNIQUE NULLS NOT DISTINCT("clinic_id","date","unit_id"),
	CONSTRAINT "clinic_holidays_window_chk" CHECK (("clinic_holidays"."start_time" IS NULL) = ("clinic_holidays"."end_time" IS NULL) AND ("clinic_holidays"."end_time" IS NULL OR "clinic_holidays"."end_time" > "clinic_holidays"."start_time"))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doctor_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"unit_id" uuid,
	"weekday" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_availability_slot_uniq" UNIQUE NULLS NOT DISTINCT("clinic_id","doctor_id","unit_id","weekday","start_time"),
	CONSTRAINT "doctor_availability_weekday_chk" CHECK ("doctor_availability"."weekday" >= 0 AND "doctor_availability"."weekday" <= 6),
	CONSTRAINT "doctor_availability_time_chk" CHECK ("doctor_availability"."end_time" > "doctor_availability"."start_time")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "procedure_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"procedure_id" uuid NOT NULL,
	"changed_field" "procedure_changed_field" NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "procedures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"descricao" text NOT NULL,
	"categoria" text,
	"valor_padrao" numeric(12, 2) DEFAULT '0' NOT NULL,
	"duracao_padrao_min" integer NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procedures_duracao_chk" CHECK ("procedures"."duracao_padrao_min" > 0 AND "procedures"."duracao_padrao_min" <= 480),
	CONSTRAINT "procedures_valor_chk" CHECK ("procedures"."valor_padrao" >= 0)
);
--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "correlation_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "correlation_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_state_log" ADD CONSTRAINT "appointment_state_log_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_state_log" ADD CONSTRAINT "appointment_state_log_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_rescheduled_from_appointment_id_appointments_id_fk" FOREIGN KEY ("rescheduled_from_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clinic_holidays" ADD CONSTRAINT "clinic_holidays_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "procedure_history" ADD CONSTRAINT "procedure_history_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "procedure_history" ADD CONSTRAINT "procedure_history_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "procedures" ADD CONSTRAINT "procedures_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_state_log_appt_transitioned_idx" ON "appointment_state_log" USING btree ("appointment_id","transitioned_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_doctor_slot_uniq" ON "appointments" USING btree ("doctor_id","scheduled_at") WHERE slot_occupies_instant;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_clinic_scheduled_idx" ON "appointments" USING btree ("clinic_id","scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_clinic_doctor_sched_idx" ON "appointments" USING btree ("clinic_id","doctor_id","scheduled_at") WHERE slot_occupies_instant;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_clinic_patient_idx" ON "appointments" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_clinic_status_idx" ON "appointments" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clinic_holidays_clinic_date_idx" ON "clinic_holidays" USING btree ("clinic_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doctor_availability_clinic_doctor_weekday_idx" ON "doctor_availability" USING btree ("clinic_id","doctor_id","weekday");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procedure_history_procedure_changed_idx" ON "procedure_history" USING btree ("procedure_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "procedures_clinic_codigo_uniq" ON "procedures" USING btree ("clinic_id","codigo");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procedures_clinic_ativo_idx" ON "procedures" USING btree ("clinic_id","ativo");--> statement-breakpoint

-- =====================================================================
-- C6 hand-augment (drizzle não modela EXCLUDE / RLS / triggers / FK
-- cross-context). Refs: ADR-007 (RLS), ADR-014 (scheduling), PlanoAção §6.
-- =====================================================================

-- A. btree_gist (necessário p/ EXCLUDE com igualdade de uuid/int + range).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

-- B. EXCLUDE anti-overlap (R2/M1 + R12/M15). Omite unit_id de propósito:
--    um médico é uma pessoa só (não sobrepõe nem entre unidades).
-- `timestamptz + interval` é STABLE → não pode ir direto numa expressão de índice.
-- Wrapper IMMUTABLE: somar um intervalo de MINUTOS a um instante absoluto (UTC) é
-- determinístico (sem ambiguidade de DST), então marcar IMMUTABLE é correto/seguro.
CREATE OR REPLACE FUNCTION appt_tstzrange(s timestamptz, dur_min integer)
  RETURNS tstzrange LANGUAGE sql IMMUTABLE AS
  $$ SELECT tstzrange(s, s + make_interval(mins => dur_min)) $$;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    doctor_id WITH =,
    appt_tstzrange(scheduled_at, duration_min) WITH &&
  ) WHERE (slot_blocks_overlap);--> statement-breakpoint
-- doctor_availability: `date + time` = timestamp (IMMUTABLE); tsrange(timestamp,…) IMMUTABLE.
ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_no_overlap"
  EXCLUDE USING gist (
    doctor_id WITH =,
    weekday WITH =,
    tsrange(('2000-01-01'::date + start_time), ('2000-01-01'::date + end_time)) WITH &&
  );--> statement-breakpoint

-- C. FKs cross-context (declarados como uuid puro no Drizzle p/ boundaries).
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_unit_id_clinic_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."clinic_units"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_doctor_id_profiles_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_unit_id_clinic_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."clinic_units"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clinic_holidays" ADD CONSTRAINT "clinic_holidays_unit_id_clinic_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."clinic_units"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- D. Snapshot/lineage imutável (R8/M4 + M8). crm/especialidade: backfill único
--    NULL→valor permitido (flexibilização controlada da 3ª revisão).
CREATE OR REPLACE FUNCTION enforce_appointment_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.snapshot_procedure_name        IS DISTINCT FROM OLD.snapshot_procedure_name
  OR NEW.snapshot_procedure_codigo      IS DISTINCT FROM OLD.snapshot_procedure_codigo
  OR NEW.snapshot_procedure_categoria   IS DISTINCT FROM OLD.snapshot_procedure_categoria
  OR NEW.snapshot_procedure_valor       IS DISTINCT FROM OLD.snapshot_procedure_valor
  OR NEW.snapshot_procedure_duracao_min IS DISTINCT FROM OLD.snapshot_procedure_duracao_min
  OR NEW.snapshot_doctor_nome           IS DISTINCT FROM OLD.snapshot_doctor_nome
  OR NEW.rescheduled_from_appointment_id IS DISTINCT FROM OLD.rescheduled_from_appointment_id
  OR (OLD.snapshot_doctor_crm IS NOT NULL AND NEW.snapshot_doctor_crm IS DISTINCT FROM OLD.snapshot_doctor_crm)
  OR (OLD.snapshot_doctor_especialidade IS NOT NULL AND NEW.snapshot_doctor_especialidade IS DISTINCT FROM OLD.snapshot_doctor_especialidade) THEN
    RAISE EXCEPTION 'appointment snapshot/lineage is immutable (id=%)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_appointments_snapshot_immutable BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION enforce_appointment_snapshot_immutable();--> statement-breakpoint

-- E. updated_at triggers (tabelas com updated_at).
CREATE TRIGGER trg_procedures_updated_at BEFORE UPDATE ON procedures FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_doctor_availability_updated_at BEFORE UPDATE ON doctor_availability FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- F. RLS — defaultTenantPolicy(v1) nas 6 tabelas (ENABLE + FORCE).
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "procedures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "procedures" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "procedures_tenant_access" ON "procedures" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "procedure_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "procedure_history" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "procedure_history_tenant_access" ON "procedure_history" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "doctor_availability" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "doctor_availability" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "doctor_availability_tenant_access" ON "doctor_availability" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "clinic_holidays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clinic_holidays" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "clinic_holidays_tenant_access" ON "clinic_holidays" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointments" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "appointments_tenant_access" ON "appointments" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "appointment_state_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointment_state_log" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "appointment_state_log_tenant_access" ON "appointment_state_log" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint

-- G. GRANTs explícitos (pattern 0012).
GRANT SELECT, INSERT, UPDATE, DELETE ON "procedures" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "procedures" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "procedure_history" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "procedure_history" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "doctor_availability" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "doctor_availability" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "clinic_holidays" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "clinic_holidays" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "appointments" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "appointments" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "appointment_state_log" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "appointment_state_log" TO service_role;--> statement-breakpoint

-- H. Schema version snapshot.
INSERT INTO _schema_version (version) VALUES ('c6-scheduling-core')
ON CONFLICT (version) DO NOTHING;