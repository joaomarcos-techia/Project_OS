-- 0072 - Trocas de plano e central de feedback.
--
-- A migration é exclusivamente aditiva: o plano efetivo continua em
-- subscriptions, enquanto subscription_change_requests preserva a intenção e
-- evita que downgrade/cancelamento apague qualquer dado de clínica.

DO $$ BEGIN
  CREATE TYPE subscription_change_kind AS ENUM ('upgrade', 'downgrade', 'cancellation');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE subscription_change_status AS ENUM ('pending_payment', 'scheduled', 'applied', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS subscription_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  kind subscription_change_kind NOT NULL,
  status subscription_change_status NOT NULL,
  from_plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  from_price_id uuid NOT NULL REFERENCES public.prices(id) ON DELETE RESTRICT,
  to_plan_id uuid REFERENCES public.plans(id) ON DELETE RESTRICT,
  to_price_id uuid REFERENCES public.prices(id) ON DELETE RESTRICT,
  proration_amount numeric(12,2),
  effective_at timestamptz NOT NULL,
  provider_payment_id text,
  provider_payment_url text,
  idempotency_key text NOT NULL,
  requested_by uuid,
  requested_ip text,
  requested_origin text,
  request_id text,
  failure_reason text,
  applied_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_change_requests_kind_target_chk CHECK (
    (kind = 'cancellation' AND to_plan_id IS NULL AND to_price_id IS NULL)
    OR (kind IN ('upgrade', 'downgrade') AND to_plan_id IS NOT NULL AND to_price_id IS NOT NULL)
  ),
  CONSTRAINT subscription_change_requests_clinic_idempotency_uniq UNIQUE (clinic_id, idempotency_key)
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE public.subscription_change_requests
    ADD CONSTRAINT subscription_change_requests_requested_by_fkey
    FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS subscription_change_requests_clinic_created_idx
  ON public.subscription_change_requests (clinic_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS subscription_change_requests_subscription_status_idx
  ON public.subscription_change_requests (subscription_id, status);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS subscription_change_requests_provider_payment_uniq
  ON public.subscription_change_requests (provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS subscription_change_requests_active_subscription_uniq
  ON public.subscription_change_requests (subscription_id)
  WHERE status IN ('pending_payment', 'scheduled');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_subscription_change_requests_updated_at ON public.subscription_change_requests;
CREATE TRIGGER trg_subscription_change_requests_updated_at
  BEFORE UPDATE ON public.subscription_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE public.subscription_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_change_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_change_requests_read ON public.subscription_change_requests FOR SELECT
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY subscription_change_requests_write ON public.subscription_change_requests FOR INSERT
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY subscription_change_requests_update ON public.subscription_change_requests FOR UPDATE
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.subscription_change_requests TO authenticated;
GRANT ALL ON public.subscription_change_requests TO service_role;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE feedback_category AS ENUM ('feature', 'improvement', 'bug', 'other');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE feedback_priority AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE feedback_status AS ENUM ('received', 'under_review', 'planned', 'in_development', 'completed', 'rejected', 'archived');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE feedback_history_action AS ENUM ('created', 'status_changed', 'note_added', 'archived', 'deleted');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS feedback_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  user_id uuid,
  title text NOT NULL,
  description text NOT NULL,
  category feedback_category NOT NULL,
  priority feedback_priority NOT NULL,
  status feedback_status NOT NULL DEFAULT 'received',
  admin_notes text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  browser text,
  platform text,
  app_version text,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE public.feedback_suggestions
    ADD CONSTRAINT feedback_suggestions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS feedback_suggestions_clinic_created_idx
  ON public.feedback_suggestions (clinic_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS feedback_suggestions_clinic_status_idx
  ON public.feedback_suggestions (clinic_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS feedback_suggestions_user_created_idx
  ON public.feedback_suggestions (user_id, created_at DESC);
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_feedback_suggestions_updated_at ON public.feedback_suggestions;
CREATE TRIGGER trg_feedback_suggestions_updated_at
  BEFORE UPDATE ON public.feedback_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS feedback_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  feedback_id uuid NOT NULL REFERENCES public.feedback_suggestions(id) ON DELETE CASCADE,
  action feedback_history_action NOT NULL,
  from_status feedback_status,
  to_status feedback_status,
  note text,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE public.feedback_history
    ADD CONSTRAINT feedback_history_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS feedback_history_feedback_created_idx
  ON public.feedback_history (feedback_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS feedback_history_clinic_created_idx
  ON public.feedback_history (clinic_id, created_at DESC);
--> statement-breakpoint

ALTER TABLE public.feedback_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_suggestions FORCE ROW LEVEL SECURITY;
CREATE POLICY feedback_suggestions_read ON public.feedback_suggestions FOR SELECT
  USING (
    (
      clinic_id::text = (select current_setting('app.current_clinic', true))
      AND user_id::text = (select current_setting('app.current_user', true))
    )
    OR (
      clinic_id::text = (select current_clinic_id())
      AND user_id = (select auth.uid())
    )
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY feedback_suggestions_write ON public.feedback_suggestions FOR INSERT
  WITH CHECK (
    (
      clinic_id::text = (select current_setting('app.current_clinic', true))
      AND user_id::text = (select current_setting('app.current_user', true))
    )
    OR (
      clinic_id::text = (select current_clinic_id())
      AND user_id = (select auth.uid())
    )
    OR (select is_super_admin())
  );
--> statement-breakpoint
ALTER TABLE public.feedback_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_history FORCE ROW LEVEL SECURITY;
CREATE POLICY feedback_history_read ON public.feedback_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.feedback_suggestions suggestion
      WHERE suggestion.id = feedback_id
        AND suggestion.clinic_id = feedback_history.clinic_id
        AND (
          (
            suggestion.clinic_id::text = (select current_setting('app.current_clinic', true))
            AND suggestion.user_id::text = (select current_setting('app.current_user', true))
          )
          OR (
            suggestion.clinic_id::text = (select current_clinic_id())
            AND suggestion.user_id = (select auth.uid())
          )
        )
    )
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY feedback_history_write ON public.feedback_history FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.feedback_suggestions suggestion
      WHERE suggestion.id = feedback_id
        AND suggestion.clinic_id = feedback_history.clinic_id
        AND (
          (
            suggestion.clinic_id::text = (select current_setting('app.current_clinic', true))
            AND suggestion.user_id::text = (select current_setting('app.current_user', true))
            AND changed_by::text = (select current_setting('app.current_user', true))
          )
          OR (
            suggestion.clinic_id::text = (select current_clinic_id())
            AND suggestion.user_id = (select auth.uid())
            AND changed_by = (select auth.uid())
          )
        )
    )
    OR (select is_super_admin())
  );
--> statement-breakpoint
GRANT SELECT, INSERT ON public.feedback_suggestions TO authenticated;
GRANT SELECT, INSERT ON public.feedback_history TO authenticated;
GRANT ALL ON public.feedback_suggestions, public.feedback_history TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0072-plan-changes-and-feedback')
ON CONFLICT (version) DO NOTHING;
