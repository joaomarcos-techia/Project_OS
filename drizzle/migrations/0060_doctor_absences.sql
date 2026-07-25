-- 0060 - Ausencias de profissionais com reorganizacao atomica da agenda

DO $$ BEGIN
  CREATE TYPE doctor_absence_strategy AS ENUM ('cancel', 'transfer');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS doctor_absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL,
  doctor_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL,
  strategy doctor_absence_strategy NOT NULL,
  replacement_doctor_id uuid,
  affected_appointments integer DEFAULT 0 NOT NULL,
  created_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT doctor_absences_period_chk CHECK (ends_at > starts_at),
  CONSTRAINT doctor_absences_strategy_chk CHECK (
    (strategy = 'cancel' AND replacement_doctor_id IS NULL)
    OR
    (strategy = 'transfer' AND replacement_doctor_id IS NOT NULL AND replacement_doctor_id <> doctor_id)
  )
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE doctor_absences
    ADD CONSTRAINT doctor_absences_clinic_id_clinics_id_fk
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE doctor_absences
    ADD CONSTRAINT doctor_absences_doctor_id_profiles_id_fk
    FOREIGN KEY (doctor_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE doctor_absences
    ADD CONSTRAINT doctor_absences_replacement_doctor_id_profiles_id_fk
    FOREIGN KEY (replacement_doctor_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE doctor_absences
    ADD CONSTRAINT doctor_absences_created_by_users_id_fk
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS doctor_absences_clinic_doctor_period_idx
  ON doctor_absences (clinic_id, doctor_id, starts_at);
--> statement-breakpoint
ALTER TABLE doctor_absences ADD CONSTRAINT doctor_absences_no_overlap
  EXCLUDE USING gist (doctor_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&);
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_doctor_absences_updated_at ON doctor_absences;
--> statement-breakpoint
CREATE TRIGGER trg_doctor_absences_updated_at
  BEFORE UPDATE ON doctor_absences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

ALTER TABLE appointment_corrections ADD COLUMN IF NOT EXISTS doctor_absence_id uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE appointment_corrections
    ADD CONSTRAINT appointment_corrections_doctor_absence_id_fk
    FOREIGN KEY (doctor_absence_id) REFERENCES public.doctor_absences(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS appointment_corrections_doctor_absence_idx
  ON appointment_corrections (doctor_absence_id);
--> statement-breakpoint

ALTER TABLE doctor_absences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE doctor_absences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS doctor_absences_tenant_access ON doctor_absences;
--> statement-breakpoint
CREATE POLICY doctor_absences_tenant_access ON doctor_absences FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );
--> statement-breakpoint

REVOKE ALL ON doctor_absences FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON doctor_absences TO authenticated;
--> statement-breakpoint
GRANT ALL ON doctor_absences TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0060-doctor-absences')
ON CONFLICT (version) DO NOTHING;

