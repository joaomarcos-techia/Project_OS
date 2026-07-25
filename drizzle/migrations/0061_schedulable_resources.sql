-- 0061 - Calendario de salas, equipamentos e outros recursos reservaveis

DO $$ BEGIN
  CREATE TYPE schedulable_resource_type AS ENUM ('room', 'equipment', 'other');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS schedulable_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL,
  unit_id uuid,
  name text NOT NULL,
  type schedulable_resource_type NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS schedulable_resources_clinic_name_uniq
  ON schedulable_resources (clinic_id, name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS schedulable_resources_clinic_active_idx
  ON schedulable_resources (clinic_id, active);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS appointment_resource_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT appointment_resource_reservations_period_chk CHECK (ends_at > starts_at)
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE schedulable_resources
    ADD CONSTRAINT schedulable_resources_clinic_id_clinics_id_fk
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE schedulable_resources
    ADD CONSTRAINT schedulable_resources_unit_id_clinic_units_id_fk
    FOREIGN KEY (unit_id) REFERENCES public.clinic_units(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE schedulable_resources
    ADD CONSTRAINT schedulable_resources_created_by_users_id_fk
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE appointment_resource_reservations
    ADD CONSTRAINT appointment_resource_reservations_clinic_id_clinics_id_fk
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE appointment_resource_reservations
    ADD CONSTRAINT appointment_resource_reservations_appointment_id_fk
    FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE appointment_resource_reservations
    ADD CONSTRAINT appointment_resource_reservations_resource_id_fk
    FOREIGN KEY (resource_id) REFERENCES public.schedulable_resources(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS appointment_resource_reservations_uniq
  ON appointment_resource_reservations (appointment_id, resource_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS appointment_resource_reservations_clinic_period_idx
  ON appointment_resource_reservations (clinic_id, starts_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS appointment_resource_reservations_resource_idx
  ON appointment_resource_reservations (resource_id);
--> statement-breakpoint
ALTER TABLE appointment_resource_reservations
  ADD CONSTRAINT appointment_resource_reservations_no_overlap
  EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (active);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.validate_appointment_resource_reservation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appointment_clinic uuid;
  v_resource_clinic uuid;
  v_resource_active boolean;
BEGIN
  SELECT clinic_id INTO v_appointment_clinic
    FROM appointments WHERE id = NEW.appointment_id;
  SELECT clinic_id, active INTO v_resource_clinic, v_resource_active
    FROM schedulable_resources WHERE id = NEW.resource_id;
  IF v_appointment_clinic IS NULL
     OR v_resource_clinic IS NULL
     OR v_appointment_clinic <> NEW.clinic_id
     OR v_resource_clinic <> NEW.clinic_id
     OR (NEW.active AND v_resource_active IS NOT TRUE)
  THEN
    RAISE EXCEPTION 'resource reservation tenant/resource mismatch';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.validate_appointment_resource_reservation()
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER trg_appointment_resource_reservation_validate
  BEFORE INSERT OR UPDATE OF appointment_id, resource_id, clinic_id, active
  ON appointment_resource_reservations
  FOR EACH ROW EXECUTE FUNCTION public.validate_appointment_resource_reservation();
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_schedulable_resources_updated_at ON schedulable_resources;
--> statement-breakpoint
CREATE TRIGGER trg_schedulable_resources_updated_at
  BEFORE UPDATE ON schedulable_resources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

ALTER TABLE schedulable_resources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE schedulable_resources FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY schedulable_resources_tenant_access ON schedulable_resources FOR ALL
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
ALTER TABLE appointment_resource_reservations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE appointment_resource_reservations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY appointment_resource_reservations_tenant_access
  ON appointment_resource_reservations FOR ALL
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

REVOKE ALL ON schedulable_resources, appointment_resource_reservations
  FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON schedulable_resources TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON appointment_resource_reservations TO authenticated;
--> statement-breakpoint
GRANT ALL ON schedulable_resources, appointment_resource_reservations TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0061-schedulable-resources')
ON CONFLICT (version) DO NOTHING;
