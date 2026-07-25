-- 0062 - Fila operacional explicita para check-ins e encaixes

DO $$ BEGIN
  CREATE TYPE waiting_queue_priority AS ENUM ('urgent', 'normal');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE waiting_queue_status AS ENUM ('waiting', 'in_service', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS waiting_queue_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  doctor_id uuid NOT NULL,
  priority waiting_queue_priority DEFAULT 'normal' NOT NULL,
  status waiting_queue_status DEFAULT 'waiting' NOT NULL,
  estimated_wait_minutes_at_entry integer DEFAULT 0 NOT NULL,
  queued_at timestamptz DEFAULT now() NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  created_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT waiting_queue_entries_estimate_chk CHECK (estimated_wait_minutes_at_entry >= 0),
  CONSTRAINT waiting_queue_entries_dates_chk CHECK (
    (started_at IS NULL OR started_at >= queued_at)
    AND (ended_at IS NULL OR ended_at >= queued_at)
  )
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE waiting_queue_entries
    ADD CONSTRAINT waiting_queue_entries_clinic_id_fk
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE waiting_queue_entries
    ADD CONSTRAINT waiting_queue_entries_appointment_id_fk
    FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE waiting_queue_entries
    ADD CONSTRAINT waiting_queue_entries_doctor_id_fk
    FOREIGN KEY (doctor_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE waiting_queue_entries
    ADD CONSTRAINT waiting_queue_entries_created_by_fk
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS waiting_queue_entries_appointment_uniq
  ON waiting_queue_entries (appointment_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS waiting_queue_entries_clinic_doctor_queue_idx
  ON waiting_queue_entries (clinic_id, doctor_id, status, priority, queued_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS waiting_queue_entries_doctor_id_idx
  ON waiting_queue_entries (doctor_id);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.validate_waiting_queue_entry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clinic_id uuid;
  v_doctor_id uuid;
BEGIN
  SELECT clinic_id, doctor_id INTO v_clinic_id, v_doctor_id
    FROM appointments WHERE id = NEW.appointment_id;
  IF v_clinic_id IS NULL
     OR v_clinic_id <> NEW.clinic_id
     OR v_doctor_id <> NEW.doctor_id
  THEN
    RAISE EXCEPTION 'waiting queue tenant/doctor mismatch';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.validate_waiting_queue_entry()
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER trg_waiting_queue_validate
  BEFORE INSERT OR UPDATE OF clinic_id, appointment_id, doctor_id
  ON waiting_queue_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_waiting_queue_entry();
--> statement-breakpoint
CREATE TRIGGER trg_waiting_queue_updated_at
  BEFORE UPDATE ON waiting_queue_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

ALTER TABLE waiting_queue_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE waiting_queue_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY waiting_queue_entries_tenant_access ON waiting_queue_entries FOR ALL
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

REVOKE ALL ON waiting_queue_entries FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON waiting_queue_entries TO authenticated;
--> statement-breakpoint
GRANT ALL ON waiting_queue_entries TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0062-waiting-queue')
ON CONFLICT (version) DO NOTHING;
