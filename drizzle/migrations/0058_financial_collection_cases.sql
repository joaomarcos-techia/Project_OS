-- 0058 - Fila humana para cobrancas vencidas apos os contatos automaticos

DO $$ BEGIN
  CREATE TYPE collection_case_stage AS ENUM ('d15_review', 'd30_manual');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE collection_case_status AS ENUM ('open', 'resolved');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS collection_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL,
  lancamento_id uuid NOT NULL,
  stage collection_case_stage NOT NULL,
  status collection_case_status DEFAULT 'open' NOT NULL,
  days_overdue integer NOT NULL,
  residual_amount numeric(12, 2) NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT collection_cases_days_overdue_chk CHECK (days_overdue >= 15),
  CONSTRAINT collection_cases_residual_amount_chk CHECK (residual_amount > 0)
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE collection_cases
    ADD CONSTRAINT collection_cases_clinic_id_clinics_id_fk
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE collection_cases
    ADD CONSTRAINT collection_cases_lancamento_id_lancamentos_id_fk
    FOREIGN KEY (lancamento_id) REFERENCES public.lancamentos(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS collection_cases_lancamento_uniq
  ON collection_cases (lancamento_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS collection_cases_clinic_status_idx
  ON collection_cases (clinic_id, status);
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_collection_cases_updated_at ON collection_cases;
--> statement-breakpoint
CREATE TRIGGER trg_collection_cases_updated_at
  BEFORE UPDATE ON collection_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

ALTER TABLE collection_cases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE collection_cases FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS collection_cases_tenant_access ON collection_cases;
--> statement-breakpoint
CREATE POLICY collection_cases_tenant_access ON collection_cases FOR ALL
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

REVOKE ALL ON collection_cases FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON collection_cases TO authenticated;
--> statement-breakpoint
GRANT ALL ON collection_cases TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0058-financial-collection-cases')
ON CONFLICT (version) DO NOTHING;

