-- 0066 - Fila operacional LGPD: responsavel, SLA, notificacao e historico

DO $$ BEGIN
  CREATE TYPE lgpd_history_action AS ENUM (
    'created', 'assigned', 'status_changed', 'notified'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE lgpd_notification_channel AS ENUM (
    'email', 'whatsapp', 'phone', 'in_person'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE lgpd_requests ADD COLUMN IF NOT EXISTS due_at timestamptz;
--> statement-breakpoint
ALTER TABLE lgpd_requests ADD COLUMN IF NOT EXISTS assigned_to_user_id uuid;
--> statement-breakpoint
ALTER TABLE lgpd_requests ADD COLUMN IF NOT EXISTS started_at timestamptz;
--> statement-breakpoint
ALTER TABLE lgpd_requests ADD COLUMN IF NOT EXISTS status_reason text;
--> statement-breakpoint
ALTER TABLE lgpd_requests ADD COLUMN IF NOT EXISTS requester_notified_at timestamptz;
--> statement-breakpoint
ALTER TABLE lgpd_requests ADD COLUMN IF NOT EXISTS requester_notification_channel lgpd_notification_channel;
--> statement-breakpoint
ALTER TABLE lgpd_requests ADD COLUMN IF NOT EXISTS last_updated_by_user_id uuid;
--> statement-breakpoint

UPDATE lgpd_requests
   SET due_at = requested_at + interval '15 days'
 WHERE due_at IS NULL;
--> statement-breakpoint
UPDATE lgpd_requests r
   SET assigned_to_user_id = (
     SELECT p.id
       FROM profiles p
      WHERE p.clinic_id = r.clinic_id
        AND p.role = 'owner'
        AND p.ativo = true
        AND p.deleted_at IS NULL
      ORDER BY p.created_at
      LIMIT 1
   )
 WHERE r.assigned_to_user_id IS NULL;
--> statement-breakpoint
ALTER TABLE lgpd_requests ALTER COLUMN due_at SET NOT NULL;
--> statement-breakpoint
ALTER TABLE lgpd_requests ALTER COLUMN due_at SET DEFAULT (now() + interval '15 days');
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE lgpd_requests
    ADD CONSTRAINT lgpd_requests_assigned_to_profiles_fk
    FOREIGN KEY (assigned_to_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE lgpd_requests
    ADD CONSTRAINT lgpd_requests_last_updated_by_users_fk
    FOREIGN KEY (last_updated_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS lgpd_requests_due_idx ON lgpd_requests (clinic_id, due_at);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.prepare_lgpd_request_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.due_at IS NULL THEN
    NEW.due_at := COALESCE(NEW.requested_at, now()) + interval '15 days';
  END IF;
  IF NEW.assigned_to_user_id IS NULL THEN
    SELECT p.id INTO NEW.assigned_to_user_id
      FROM public.profiles p
     WHERE p.clinic_id = NEW.clinic_id
       AND p.role = 'owner'
       AND p.ativo = true
       AND p.deleted_at IS NULL
     ORDER BY p.created_at
     LIMIT 1;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = NEW.assigned_to_user_id
       AND p.clinic_id = NEW.clinic_id
       AND p.role IN ('owner', 'gestor')
       AND p.ativo = true
       AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'LGPD assignee must be an active owner or manager from the clinic';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prepare_lgpd_request_assignment()
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER trg_lgpd_requests_prepare_assignment
  BEFORE INSERT OR UPDATE OF assigned_to_user_id, clinic_id, due_at
  ON lgpd_requests FOR EACH ROW EXECUTE FUNCTION public.prepare_lgpd_request_assignment();
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS lgpd_request_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.lgpd_requests(id) ON DELETE CASCADE,
  action lgpd_history_action NOT NULL,
  from_status lgpd_request_status,
  to_status lgpd_request_status,
  assigned_to_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notification_channel lgpd_notification_channel,
  note text,
  changed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS lgpd_request_history_clinic_id_idx
  ON lgpd_request_history (clinic_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS lgpd_request_history_request_idx
  ON lgpd_request_history (request_id, changed_at);
--> statement-breakpoint

INSERT INTO lgpd_request_history (
  clinic_id, request_id, action, to_status, assigned_to_user_id, note, changed_at
)
SELECT clinic_id, id, 'created', status, assigned_to_user_id, 'legacy_backfill', requested_at
  FROM lgpd_requests
 WHERE NOT EXISTS (
   SELECT 1 FROM lgpd_request_history h WHERE h.request_id = lgpd_requests.id
 );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.log_lgpd_request_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.lgpd_request_history (
      clinic_id, request_id, action, to_status, assigned_to_user_id, changed_by_user_id
    ) VALUES (
      NEW.clinic_id, NEW.id, 'created', NEW.status, NEW.assigned_to_user_id,
      NEW.last_updated_by_user_id
    );
    RETURN NEW;
  END IF;
  IF OLD.assigned_to_user_id IS DISTINCT FROM NEW.assigned_to_user_id THEN
    INSERT INTO public.lgpd_request_history (
      clinic_id, request_id, action, to_status, assigned_to_user_id, note,
      changed_by_user_id
    ) VALUES (
      NEW.clinic_id, NEW.id, 'assigned', NEW.status, NEW.assigned_to_user_id,
      NEW.status_reason, NEW.last_updated_by_user_id
    );
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.lgpd_request_history (
      clinic_id, request_id, action, from_status, to_status, assigned_to_user_id,
      note, changed_by_user_id
    ) VALUES (
      NEW.clinic_id, NEW.id, 'status_changed', OLD.status, NEW.status,
      NEW.assigned_to_user_id, NEW.status_reason, NEW.last_updated_by_user_id
    );
  END IF;
  IF OLD.requester_notified_at IS DISTINCT FROM NEW.requester_notified_at
     AND NEW.requester_notified_at IS NOT NULL THEN
    INSERT INTO public.lgpd_request_history (
      clinic_id, request_id, action, to_status, assigned_to_user_id,
      notification_channel, note, changed_by_user_id, changed_at
    ) VALUES (
      NEW.clinic_id, NEW.id, 'notified', NEW.status, NEW.assigned_to_user_id,
      NEW.requester_notification_channel, NEW.status_reason,
      NEW.last_updated_by_user_id, NEW.requester_notified_at
    );
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.log_lgpd_request_history()
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER trg_lgpd_requests_history
  AFTER INSERT OR UPDATE ON lgpd_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_lgpd_request_history();
--> statement-breakpoint

ALTER TABLE lgpd_request_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE lgpd_request_history FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY lgpd_request_history_tenant_access ON lgpd_request_history FOR SELECT
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );
--> statement-breakpoint
REVOKE ALL ON lgpd_request_history FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON lgpd_request_history TO authenticated;
--> statement-breakpoint
GRANT ALL ON lgpd_request_history TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0066-lgpd-operational-workflow')
ON CONFLICT (version) DO NOTHING;
