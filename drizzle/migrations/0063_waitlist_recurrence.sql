-- 0063 - Lista de espera e series semanais de atendimentos

DO $$ BEGIN
  CREATE TYPE recurrence_series_status AS ENUM ('active', 'cancelled', 'completed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE waitlist_status AS ENUM ('waiting', 'offered', 'booked', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS recurrence_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL,
  unit_id uuid,
  doctor_id uuid NOT NULL,
  patient_id uuid,
  procedure_id uuid NOT NULL,
  interval_weeks integer NOT NULL,
  occurrences integer NOT NULL,
  status recurrence_series_status DEFAULT 'active' NOT NULL,
  created_by uuid,
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT recurrence_series_interval_chk CHECK (interval_weeks > 0),
  CONSTRAINT recurrence_series_occurrences_chk CHECK (occurrences > 1)
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE recurrence_series ADD CONSTRAINT recurrence_series_clinic_id_fk
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE recurrence_series ADD CONSTRAINT recurrence_series_unit_id_fk
    FOREIGN KEY (unit_id) REFERENCES public.clinic_units(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE recurrence_series ADD CONSTRAINT recurrence_series_doctor_id_fk
    FOREIGN KEY (doctor_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE recurrence_series ADD CONSTRAINT recurrence_series_patient_id_fk
    FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE recurrence_series ADD CONSTRAINT recurrence_series_procedure_id_fk
    FOREIGN KEY (procedure_id) REFERENCES public.procedures(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE recurrence_series ADD CONSTRAINT recurrence_series_created_by_fk
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE recurrence_series ADD CONSTRAINT recurrence_series_cancelled_by_fk
    FOREIGN KEY (cancelled_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS recurrence_series_clinic_status_idx
  ON recurrence_series (clinic_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS recurrence_series_patient_id_idx ON recurrence_series (patient_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS recurrence_series_doctor_id_idx ON recurrence_series (doctor_id);
--> statement-breakpoint

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recurrence_series_id uuid;
--> statement-breakpoint
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recurrence_occurrence integer;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE appointments ADD CONSTRAINT appointments_recurrence_series_id_fk
    FOREIGN KEY (recurrence_series_id) REFERENCES public.recurrence_series(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE appointments ADD CONSTRAINT appointments_recurrence_pair_chk CHECK (
    (recurrence_series_id IS NULL AND recurrence_occurrence IS NULL)
    OR (recurrence_series_id IS NOT NULL AND recurrence_occurrence > 0)
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS appointments_recurrence_occurrence_uniq
  ON appointments (recurrence_series_id, recurrence_occurrence)
  WHERE recurrence_series_id IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  doctor_id uuid,
  procedure_id uuid NOT NULL,
  priority waiting_queue_priority DEFAULT 'normal' NOT NULL,
  status waitlist_status DEFAULT 'waiting' NOT NULL,
  preferred_from timestamptz,
  preferred_until timestamptz,
  offered_appointment_id uuid,
  offered_at timestamptz,
  booked_appointment_id uuid,
  notes text,
  created_by uuid,
  cancelled_by uuid,
  cancelled_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT waitlist_entries_preferred_period_chk CHECK (
    preferred_until IS NULL OR preferred_from IS NULL OR preferred_until >= preferred_from
  )
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_entries_clinic_id_fk
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_entries_patient_id_fk
    FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_entries_doctor_id_fk
    FOREIGN KEY (doctor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_entries_procedure_id_fk
    FOREIGN KEY (procedure_id) REFERENCES public.procedures(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_entries_offered_appointment_id_fk
    FOREIGN KEY (offered_appointment_id) REFERENCES public.appointments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_entries_booked_appointment_id_fk
    FOREIGN KEY (booked_appointment_id) REFERENCES public.appointments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_entries_created_by_fk
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_entries_cancelled_by_fk
    FOREIGN KEY (cancelled_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS waitlist_entries_clinic_status_priority_idx
  ON waitlist_entries (clinic_id, status, priority, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS waitlist_entries_patient_id_idx ON waitlist_entries (patient_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS waitlist_entries_doctor_id_idx ON waitlist_entries (doctor_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS waitlist_entries_offered_appointment_idx
  ON waitlist_entries (offered_appointment_id);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.validate_recurrence_series_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = NEW.doctor_id AND clinic_id = NEW.clinic_id)
     OR (NEW.patient_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM patients WHERE id = NEW.patient_id AND clinic_id = NEW.clinic_id
     ))
     OR NOT EXISTS (
       SELECT 1 FROM procedures WHERE id = NEW.procedure_id AND clinic_id = NEW.clinic_id
     )
     OR (NEW.unit_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM clinic_units WHERE id = NEW.unit_id AND clinic_id = NEW.clinic_id
     ))
  THEN
    RAISE EXCEPTION 'recurrence series tenant mismatch';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.validate_recurrence_series_tenant() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER trg_recurrence_series_validate
  BEFORE INSERT OR UPDATE OF clinic_id, unit_id, doctor_id, patient_id, procedure_id
  ON recurrence_series FOR EACH ROW EXECUTE FUNCTION public.validate_recurrence_series_tenant();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.validate_waitlist_entry_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM patients WHERE id = NEW.patient_id AND clinic_id = NEW.clinic_id)
     OR (NEW.doctor_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM profiles WHERE id = NEW.doctor_id AND clinic_id = NEW.clinic_id
     ))
     OR NOT EXISTS (
       SELECT 1 FROM procedures WHERE id = NEW.procedure_id AND clinic_id = NEW.clinic_id
     )
     OR (NEW.offered_appointment_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM appointments WHERE id = NEW.offered_appointment_id AND clinic_id = NEW.clinic_id
     ))
     OR (NEW.booked_appointment_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM appointments WHERE id = NEW.booked_appointment_id AND clinic_id = NEW.clinic_id
     ))
  THEN
    RAISE EXCEPTION 'waitlist entry tenant mismatch';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.validate_waitlist_entry_tenant() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER trg_waitlist_entries_validate
  BEFORE INSERT OR UPDATE OF clinic_id, patient_id, doctor_id, procedure_id,
    offered_appointment_id, booked_appointment_id
  ON waitlist_entries FOR EACH ROW EXECUTE FUNCTION public.validate_waitlist_entry_tenant();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.validate_appointment_recurrence()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.recurrence_series_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM recurrence_series s
     WHERE s.id = NEW.recurrence_series_id
       AND s.clinic_id = NEW.clinic_id
       AND s.doctor_id = NEW.doctor_id
       AND s.procedure_id = NEW.procedure_id
       AND s.patient_id IS NOT DISTINCT FROM NEW.patient_id
  ) THEN
    RAISE EXCEPTION 'appointment recurrence mismatch';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.validate_appointment_recurrence() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER trg_appointment_recurrence_validate
  BEFORE INSERT OR UPDATE OF recurrence_series_id, recurrence_occurrence, clinic_id,
    doctor_id, patient_id, procedure_id
  ON appointments FOR EACH ROW EXECUTE FUNCTION public.validate_appointment_recurrence();
--> statement-breakpoint

CREATE TRIGGER trg_recurrence_series_updated_at BEFORE UPDATE ON recurrence_series
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_waitlist_entries_updated_at BEFORE UPDATE ON waitlist_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

ALTER TABLE recurrence_series ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recurrence_series FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recurrence_series_tenant_access ON recurrence_series FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id()) OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id()) OR (select is_super_admin())
  );
--> statement-breakpoint
ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE waitlist_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY waitlist_entries_tenant_access ON waitlist_entries FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id()) OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id()) OR (select is_super_admin())
  );
--> statement-breakpoint

REVOKE ALL ON recurrence_series, waitlist_entries FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON recurrence_series, waitlist_entries TO authenticated;
--> statement-breakpoint
GRANT ALL ON recurrence_series, waitlist_entries TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0063-waitlist-recurrence')
ON CONFLICT (version) DO NOTHING;
