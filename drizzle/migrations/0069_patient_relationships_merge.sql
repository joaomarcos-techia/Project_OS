CREATE TYPE patient_relationship_type AS ENUM (
  'mae', 'pai', 'tutor_legal', 'responsavel', 'outro'
);
--> statement-breakpoint

ALTER TABLE patients ADD COLUMN IF NOT EXISTS merged_into_patient_id uuid;
--> statement-breakpoint
ALTER TABLE patients ADD COLUMN IF NOT EXISTS merged_at timestamptz;
--> statement-breakpoint
ALTER TABLE patients ADD COLUMN IF NOT EXISTS merged_by uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE patients ADD CONSTRAINT patients_merged_into_patient_id_fk
    FOREIGN KEY (merged_into_patient_id) REFERENCES public.patients(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE patients ADD CONSTRAINT patients_merge_state_chk CHECK (
    (merged_into_patient_id IS NULL AND merged_at IS NULL AND merged_by IS NULL)
    OR (merged_into_patient_id IS NOT NULL AND merged_at IS NOT NULL AND merged_by IS NOT NULL
        AND deleted_at IS NOT NULL AND merged_into_patient_id <> id)
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patients_merged_into_idx ON patients (merged_into_patient_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS patient_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  responsible_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  dependent_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  relationship_type patient_relationship_type NOT NULL,
  legal_guardian boolean DEFAULT false NOT NULL,
  financial_responsible boolean DEFAULT false NOT NULL,
  can_manage_appointments boolean DEFAULT false NOT NULL,
  created_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT patient_relationships_pair_uniq UNIQUE (responsible_patient_id, dependent_patient_id),
  CONSTRAINT patient_relationships_no_self_chk CHECK (responsible_patient_id <> dependent_patient_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_relationships_responsible_idx
  ON patient_relationships (responsible_patient_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_relationships_dependent_idx
  ON patient_relationships (dependent_patient_id);
--> statement-breakpoint
CREATE TRIGGER trg_patient_relationships_updated_at BEFORE UPDATE ON patient_relationships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS patient_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  source_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  target_patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  merged_by uuid NOT NULL,
  transfer_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT patient_merges_source_uniq UNIQUE (source_patient_id),
  CONSTRAINT patient_merges_no_self_chk CHECK (source_patient_id <> target_patient_id),
  CONSTRAINT patient_merges_reason_chk CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_merges_clinic_id_idx ON patient_merges (clinic_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_merges_target_idx ON patient_merges (target_patient_id);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.validate_patient_relationship_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patients
     WHERE id = NEW.responsible_patient_id AND clinic_id = NEW.clinic_id AND deleted_at IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.patients
     WHERE id = NEW.dependent_patient_id AND clinic_id = NEW.clinic_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'patient relationship references inactive or cross-tenant patient'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.validate_patient_relationship_tenant()
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER trg_patient_relationships_validate_tenant
  BEFORE INSERT OR UPDATE OF clinic_id, responsible_patient_id, dependent_patient_id
  ON patient_relationships FOR EACH ROW
  EXECUTE FUNCTION public.validate_patient_relationship_tenant();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.assert_minor_patient_has_guardian(patient_ref uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  patient_row record;
  local_today date;
BEGIN
  SELECT p.id, p.clinic_id, p.data_nascimento, p.deleted_at, c.timezone
    INTO patient_row
    FROM public.patients p
    JOIN public.clinics c ON c.id = p.clinic_id
   WHERE p.id = patient_ref;
  IF NOT FOUND OR patient_row.deleted_at IS NOT NULL OR patient_row.data_nascimento IS NULL THEN
    RETURN;
  END IF;
  local_today := (now() AT TIME ZONE coalesce(patient_row.timezone, 'America/Sao_Paulo'))::date;
  IF patient_row.data_nascimento > (local_today - interval '18 years')::date
     AND NOT EXISTS (
       SELECT 1 FROM public.patient_relationships r
        WHERE r.dependent_patient_id = patient_ref
          AND r.clinic_id = patient_row.clinic_id
          AND r.legal_guardian = true
     ) THEN
    RAISE EXCEPTION 'minor patient requires a legal guardian relationship'
      USING ERRCODE = '23514';
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.assert_minor_patient_has_guardian(uuid)
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.validate_minor_patient_guardian()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.assert_minor_patient_has_guardian(NEW.id);
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.validate_minor_patient_guardian()
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_patients_require_minor_guardian
  AFTER INSERT OR UPDATE OF data_nascimento ON patients
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.validate_minor_patient_guardian();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.validate_relationship_minor_guardian()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM public.assert_minor_patient_has_guardian(OLD.dependent_patient_id);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM public.assert_minor_patient_has_guardian(NEW.dependent_patient_id);
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.validate_relationship_minor_guardian()
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_relationships_require_minor_guardian
  AFTER INSERT OR UPDATE OR DELETE ON patient_relationships
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.validate_relationship_minor_guardian();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.block_patient_merge_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'patient merge history is append-only' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.block_patient_merge_mutation()
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER trg_patient_merges_append_only
  BEFORE UPDATE OR DELETE ON patient_merges FOR EACH ROW
  EXECUTE FUNCTION public.block_patient_merge_mutation();
--> statement-breakpoint

-- Exceção estreita: o merge pode corrigir somente patient_id em prontuário
-- assinado. Conteúdo, assinatura, profissional, consulta e estado seguem imutáveis.
CREATE OR REPLACE FUNCTION public.block_signed_prontuario_update() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('app.allow_patient_merge', true) = 'on' THEN
    IF NEW.patient_id IS DISTINCT FROM OLD.patient_id
       AND NEW.signed_at IS NOT DISTINCT FROM OLD.signed_at
       AND NEW.signed_by IS NOT DISTINCT FROM OLD.signed_by
       AND NEW.signed_doctor_nome IS NOT DISTINCT FROM OLD.signed_doctor_nome
       AND NEW.signed_doctor_crm IS NOT DISTINCT FROM OLD.signed_doctor_crm
       AND NEW.signed_doctor_crm_uf IS NOT DISTINCT FROM OLD.signed_doctor_crm_uf
       AND NEW.signed_doctor_especialidade IS NOT DISTINCT FROM OLD.signed_doctor_especialidade
       AND NEW.doctor_id IS NOT DISTINCT FROM OLD.doctor_id
       AND NEW.clinic_id IS NOT DISTINCT FROM OLD.clinic_id
       AND NEW.appointment_id IS NOT DISTINCT FROM OLD.appointment_id
       AND NEW.needs_return IS NOT DISTINCT FROM OLD.needs_return
       AND NEW.return_days IS NOT DISTINCT FROM OLD.return_days
       AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.content_encrypted IS NOT DISTINCT FROM OLD.content_encrypted
       AND NEW.version IS NOT DISTINCT FROM OLD.version
       AND NEW.row_version IS NOT DISTINCT FROM OLD.row_version THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'patient merge may only change patient_id on signed record';
  END IF;
  IF current_setting('app.allow_signed_edit', true) = 'on' THEN
    IF NEW.signed_at IS DISTINCT FROM OLD.signed_at
    OR NEW.signed_by IS DISTINCT FROM OLD.signed_by
    OR NEW.signed_doctor_nome IS DISTINCT FROM OLD.signed_doctor_nome
    OR NEW.signed_doctor_crm IS DISTINCT FROM OLD.signed_doctor_crm
    OR NEW.signed_doctor_crm_uf IS DISTINCT FROM OLD.signed_doctor_crm_uf
    OR NEW.signed_doctor_especialidade IS DISTINCT FROM OLD.signed_doctor_especialidade
    OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
    OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
    OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
    OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
    OR NEW.needs_return IS DISTINCT FROM OLD.needs_return
    OR NEW.return_days IS DISTINCT FROM OLD.return_days
    OR NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Prontuário assinado: apenas o conteúdo pode ser corrigido (com motivo).';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Prontuário assinado é imutável.';
END;
$$;
--> statement-breakpoint

ALTER TABLE patient_relationships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE patient_relationships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY patient_relationships_tenant_access ON patient_relationships FOR ALL
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
ALTER TABLE patient_merges ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE patient_merges FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY patient_merges_tenant_access ON patient_merges FOR ALL
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

REVOKE ALL ON patient_relationships, patient_merges FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON patient_relationships TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON patient_merges TO authenticated;
--> statement-breakpoint
GRANT ALL ON patient_relationships, patient_merges TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0069-patient-relationships-merge')
ON CONFLICT (version) DO NOTHING;
