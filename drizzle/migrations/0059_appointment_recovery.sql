-- 0059 - Trilha auditavel para recuperacao excepcional da agenda

DO $$ BEGIN
  CREATE TYPE appointment_recovery_kind AS ENUM (
    'interrupt',
    'exceptional_cancel',
    'reopen',
    'transfer'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS appointment_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  kind appointment_recovery_kind NOT NULL,
  from_status appointment_status NOT NULL,
  to_status appointment_status NOT NULL,
  old_doctor_id uuid NOT NULL,
  new_doctor_id uuid,
  reason text NOT NULL,
  corrected_by uuid,
  corrected_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT appointment_corrections_reason_chk CHECK (length(trim(reason)) > 0)
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE appointment_corrections
    ADD CONSTRAINT appointment_corrections_clinic_id_clinics_id_fk
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE appointment_corrections
    ADD CONSTRAINT appointment_corrections_appointment_id_appointments_id_fk
    FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE appointment_corrections
    ADD CONSTRAINT appointment_corrections_old_doctor_id_profiles_id_fk
    FOREIGN KEY (old_doctor_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE appointment_corrections
    ADD CONSTRAINT appointment_corrections_new_doctor_id_profiles_id_fk
    FOREIGN KEY (new_doctor_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE appointment_corrections
    ADD CONSTRAINT appointment_corrections_corrected_by_users_id_fk
    FOREIGN KEY (corrected_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS appointment_corrections_clinic_id_idx
  ON appointment_corrections (clinic_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS appointment_corrections_appointment_idx
  ON appointment_corrections (appointment_id, corrected_at);
--> statement-breakpoint

ALTER TABLE appointment_corrections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE appointment_corrections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS appointment_corrections_tenant_access ON appointment_corrections;
--> statement-breakpoint
CREATE POLICY appointment_corrections_tenant_access ON appointment_corrections FOR ALL
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

REVOKE ALL ON appointment_corrections FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON appointment_corrections TO authenticated;
--> statement-breakpoint
GRANT ALL ON appointment_corrections TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0059-appointment-recovery')
ON CONFLICT (version) DO NOTHING;

