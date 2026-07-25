CREATE TYPE ai_handoff_priority AS ENUM ('normal', 'urgent');
--> statement-breakpoint
ALTER TABLE ai_handoff_queue
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
--> statement-breakpoint
ALTER TABLE ai_handoff_queue
  ADD COLUMN IF NOT EXISTS priority ai_handoff_priority DEFAULT 'normal' NOT NULL;
--> statement-breakpoint
ALTER TABLE ai_handoff_queue
  ADD COLUMN IF NOT EXISTS due_at timestamptz;
--> statement-breakpoint
UPDATE ai_handoff_queue
   SET due_at = created_at + interval '30 minutes'
 WHERE due_at IS NULL;
--> statement-breakpoint
ALTER TABLE ai_handoff_queue ALTER COLUMN due_at SET DEFAULT (now() + interval '30 minutes');
--> statement-breakpoint
ALTER TABLE ai_handoff_queue ALTER COLUMN due_at SET NOT NULL;
--> statement-breakpoint
UPDATE ai_handoff_queue
   SET assigned_at = coalesce(assigned_at, updated_at, created_at)
 WHERE assigned_to IS NOT NULL AND assigned_at IS NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE ai_handoff_queue ADD CONSTRAINT ai_handoff_queue_assignment_chk CHECK (
    (assigned_to IS NULL AND assigned_at IS NULL)
    OR (assigned_to IS NOT NULL AND assigned_at IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_handoff_queue_open_due_idx
  ON ai_handoff_queue (clinic_id, due_at) WHERE resolved_at IS NULL;
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0070-handoff-sla-assignment')
ON CONFLICT (version) DO NOTHING;
