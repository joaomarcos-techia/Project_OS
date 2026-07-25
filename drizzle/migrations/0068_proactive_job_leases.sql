-- 0068 - Lease recuperavel e claim justo para jobs proativos

-- O Drizzle 0.36 executa todas as migrations pendentes numa transacao unica.
-- O PostgreSQL permite adicionar o valor aqui, mas ele so pode ser convertido
-- para o enum depois do commit. As DDLs abaixo nao fazem essa conversao: a
-- constraint compara texto e o indice nao possui predicado com o novo literal.
ALTER TYPE proactive_job_status ADD VALUE IF NOT EXISTS 'processing' AFTER 'pending';
--> statement-breakpoint

ALTER TABLE ai_proactive_jobs ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;
--> statement-breakpoint
ALTER TABLE ai_proactive_jobs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
--> statement-breakpoint
ALTER TABLE ai_proactive_jobs ADD COLUMN IF NOT EXISTS lease_token text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE ai_proactive_jobs
    ADD CONSTRAINT ai_proactive_jobs_lease_chk CHECK (
      (status::text = 'processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
      OR (status::text <> 'processing' AND lease_token IS NULL AND lease_expires_at IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_proactive_jobs_claim_idx
  ON ai_proactive_jobs (status, type, scheduled_for, clinic_id);
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0068-proactive-job-leases')
ON CONFLICT (version) DO NOTHING;
