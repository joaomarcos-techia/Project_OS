-- 0056 — Confirmação server-side de ações da IA
-- Agendar, cancelar e reagendar geram uma intenção pendente cifrada. A ação só
-- é executada após uma nova mensagem explicitamente afirmativa do paciente.

DO $$ BEGIN
  CREATE TYPE ai_pending_action_status AS ENUM ('pending', 'executed', 'expired', 'superseded');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS ai_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  action_name text NOT NULL,
  payload_encrypted text NOT NULL,
  summary text NOT NULL,
  source_event_id uuid NOT NULL,
  confirmation_event_id uuid,
  status ai_pending_action_status DEFAULT 'pending' NOT NULL,
  expires_at timestamptz NOT NULL,
  executed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT ai_pending_actions_action_name_chk CHECK (
    action_name IN (
      'schedule_appointment',
      'confirm_appointment',
      'cancel_appointment',
      'reschedule_appointment'
    )
  )
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE ai_pending_actions
    ADD CONSTRAINT ai_pending_actions_clinic_id_clinics_id_fk
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE ai_pending_actions
    ADD CONSTRAINT ai_pending_actions_conversation_id_ai_conversations_id_fk
    FOREIGN KEY (conversation_id) REFERENCES public.ai_conversations(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS ai_pending_actions_clinic_id_idx
  ON ai_pending_actions (clinic_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ai_pending_actions_conversation_pending_uniq
  ON ai_pending_actions (conversation_id) WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_pending_actions_expiry_idx
  ON ai_pending_actions (status, expires_at);
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_ai_pending_actions_updated_at ON ai_pending_actions;
--> statement-breakpoint
CREATE TRIGGER trg_ai_pending_actions_updated_at
  BEFORE UPDATE ON ai_pending_actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

ALTER TABLE ai_pending_actions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_pending_actions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS ai_pending_actions_tenant_access ON ai_pending_actions;
--> statement-breakpoint
CREATE POLICY ai_pending_actions_tenant_access ON ai_pending_actions FOR ALL
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  )
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );
--> statement-breakpoint

REVOKE ALL ON ai_pending_actions FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON ai_pending_actions FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ai_pending_actions TO authenticated;
--> statement-breakpoint
GRANT ALL ON ai_pending_actions TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0056-ai-pending-actions')
ON CONFLICT (version) DO NOTHING;
