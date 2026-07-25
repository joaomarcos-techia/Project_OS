-- 0067 - Importacao historica separada e proveniencia autoritativa

ALTER TYPE appointment_created_via ADD VALUE IF NOT EXISTS 'import' AFTER 'super_admin';
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE appointment_import_status AS ENUM ('processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS appointment_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  source text NOT NULL,
  justification text NOT NULL,
  status appointment_import_status DEFAULT 'processing' NOT NULL,
  total_items integer NOT NULL,
  imported_items integer DEFAULT 0 NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT appointment_import_batches_source_chk CHECK (length(trim(source)) >= 2),
  CONSTRAINT appointment_import_batches_justification_chk CHECK (length(trim(justification)) >= 5),
  CONSTRAINT appointment_import_batches_total_chk CHECK (
    total_items > 0 AND imported_items >= 0 AND imported_items <= total_items
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS appointment_import_batches_clinic_created_idx
  ON appointment_import_batches (clinic_id, created_at);
--> statement-breakpoint
CREATE TRIGGER trg_appointment_import_batches_updated_at
  BEFORE UPDATE ON appointment_import_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS import_batch_id uuid;
--> statement-breakpoint
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS import_source_reference text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE appointments
    ADD CONSTRAINT appointments_import_batch_id_fk
    FOREIGN KEY (import_batch_id) REFERENCES public.appointment_import_batches(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS appointments_import_batch_id_idx ON appointments (import_batch_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS appointments_import_reference_uniq
  ON appointments (import_batch_id, import_source_reference)
  WHERE import_source_reference IS NOT NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.validate_appointment_import_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch_clinic uuid;
BEGIN
  IF NEW.created_via = 'import' THEN
    IF NEW.import_batch_id IS NULL THEN
      RAISE EXCEPTION 'imported appointment requires an import batch';
    END IF;
    SELECT clinic_id INTO v_batch_clinic
      FROM public.appointment_import_batches
     WHERE id = NEW.import_batch_id;
    IF NOT FOUND OR v_batch_clinic <> NEW.clinic_id THEN
      RAISE EXCEPTION 'appointment import batch tenant mismatch';
    END IF;
  ELSIF NEW.import_batch_id IS NOT NULL OR NEW.import_source_reference IS NOT NULL THEN
    RAISE EXCEPTION 'non-imported appointment cannot declare import provenance';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.validate_appointment_import_provenance()
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER trg_appointments_validate_import_provenance
  BEFORE INSERT OR UPDATE OF created_via, import_batch_id, import_source_reference, clinic_id
  ON appointments FOR EACH ROW EXECUTE FUNCTION public.validate_appointment_import_provenance();
--> statement-breakpoint

ALTER TABLE appointment_import_batches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE appointment_import_batches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY appointment_import_batches_tenant_access
  ON appointment_import_batches FOR ALL
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
REVOKE ALL ON appointment_import_batches FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON appointment_import_batches TO authenticated;
--> statement-breakpoint
GRANT ALL ON appointment_import_batches TO service_role;
--> statement-breakpoint

INSERT INTO permissions (code, description) VALUES
  ('import:agenda', 'Importar historico da agenda com proveniencia auditavel')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role, permission_code) VALUES
  ('owner', 'import:agenda'),
  ('gestor', 'import:agenda')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0067-appointment-import-provenance')
ON CONFLICT (version) DO NOTHING;
