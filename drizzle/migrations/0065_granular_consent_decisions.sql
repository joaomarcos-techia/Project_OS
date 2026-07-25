-- 0065 - Consentimentos append-only e supressao por finalidade

DO $$ BEGIN
  CREATE TYPE consent_purpose AS ENUM (
    'dados_saude',
    'compartilhamento',
    'cobranca_whatsapp',
    'marketing',
    'pesquisa'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE suppression_purpose AS ENUM (
    'all',
    'billing',
    'reminder',
    'followup',
    'marketing'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS patient_consent_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  purpose consent_purpose NOT NULL,
  channel suppression_channel,
  granted boolean NOT NULL,
  version integer NOT NULL,
  recorded_by uuid,
  recorded_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT patient_consent_decisions_version_chk CHECK (version > 0),
  CONSTRAINT patient_consent_decisions_channel_chk CHECK (
    (purpose IN ('cobranca_whatsapp', 'marketing') AND channel = 'whatsapp')
    OR (purpose IN ('dados_saude', 'compartilhamento', 'pesquisa') AND channel IS NULL)
  ),
  CONSTRAINT patient_consent_decisions_version_uniq
    UNIQUE NULLS NOT DISTINCT (patient_id, purpose, channel, version)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_consent_decisions_clinic_id_idx
  ON patient_consent_decisions (clinic_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_consent_decisions_patient_purpose_idx
  ON patient_consent_decisions (patient_id, purpose, channel, version);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.validate_patient_consent_decision_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_patient_clinic uuid;
BEGIN
  SELECT clinic_id INTO v_patient_clinic
    FROM public.patients
   WHERE id = NEW.patient_id;
  IF NOT FOUND OR v_patient_clinic <> NEW.clinic_id THEN
    RAISE EXCEPTION 'patient consent decision tenant mismatch';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.validate_patient_consent_decision_tenant()
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER trg_patient_consent_decisions_validate_tenant
  BEFORE INSERT OR UPDATE OF patient_id, clinic_id
  ON patient_consent_decisions
  FOR EACH ROW EXECUTE FUNCTION public.validate_patient_consent_decision_tenant();
--> statement-breakpoint

-- Reconstrui a linha do tempo legada: snapshots de aceite e revogacoes tipadas
-- publicadas no outbox. Assim uma revogacao antiga nao apaga outros propositos.
WITH timeline AS (
  SELECT pc.patient_id,
         pc.clinic_id,
         v.purpose,
         v.channel,
         v.granted,
         NULL::uuid AS recorded_by,
         pc.data_aceite AS recorded_at,
         0 AS source_rank,
         pc.versao AS source_version,
         pc.id AS source_id
    FROM patient_consents pc
    CROSS JOIN LATERAL (
      VALUES
        ('dados_saude'::consent_purpose, NULL::suppression_channel, pc.dados_saude),
        ('compartilhamento'::consent_purpose, NULL::suppression_channel, pc.compartilhamento),
        ('cobranca_whatsapp'::consent_purpose, 'whatsapp'::suppression_channel, pc.cobranca_whatsapp),
        ('marketing'::consent_purpose, 'whatsapp'::suppression_channel, pc.marketing),
        ('pesquisa'::consent_purpose, NULL::suppression_channel, pc.pesquisa)
    ) AS v(purpose, channel, granted)
  UNION ALL
  SELECT (o.payload->>'patientId')::uuid,
         o.clinic_id,
         (o.payload->>'consentType')::consent_purpose,
         CASE
           WHEN o.payload->>'consentType' IN ('cobranca_whatsapp', 'marketing')
             THEN 'whatsapp'::suppression_channel
           ELSE NULL::suppression_channel
         END,
         false,
         NULL::uuid,
         o.created_at,
         1,
         0,
         o.id
    FROM outbox o
   WHERE o.event_type = 'patient.consent.revoked'
), versioned AS (
  SELECT timeline.*,
         row_number() OVER (
           PARTITION BY patient_id, purpose, channel
           ORDER BY recorded_at, source_rank, source_version, source_id
         ) AS decision_version
    FROM timeline
)
INSERT INTO patient_consent_decisions (
  patient_id,
  clinic_id,
  purpose,
  channel,
  granted,
  version,
  recorded_by,
  recorded_at
)
SELECT patient_id,
       clinic_id,
       purpose,
       channel,
       granted,
       decision_version,
       recorded_by,
       recorded_at
  FROM versioned
ON CONFLICT DO NOTHING;
--> statement-breakpoint

ALTER TABLE suppression_list
  ADD COLUMN IF NOT EXISTS purpose suppression_purpose DEFAULT 'all' NOT NULL;
--> statement-breakpoint
ALTER TABLE suppression_list
  DROP CONSTRAINT IF EXISTS suppression_list_contact_channel_uniq;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE suppression_list
    ADD CONSTRAINT suppression_list_contact_channel_purpose_uniq
    UNIQUE (clinic_id, contact_hash, channel, purpose);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE patient_consent_decisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE patient_consent_decisions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY patient_consent_decisions_tenant_access
  ON patient_consent_decisions FOR ALL
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

REVOKE ALL ON patient_consent_decisions FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON patient_consent_decisions TO authenticated;
--> statement-breakpoint
GRANT ALL ON patient_consent_decisions TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0065-granular-consent-decisions')
ON CONFLICT (version) DO NOTHING;
