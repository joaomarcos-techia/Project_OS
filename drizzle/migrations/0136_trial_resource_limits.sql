-- Founder-approved evaluation only. No backfill, contract changes or provider calls.
-- Existing subscriptions, including existing trials, are deliberately not enrolled.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Trial enforcement requires a privileged migration/function owner';
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE public.trial_access_policies (
  clinic_id uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL UNIQUE REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  released_at timestamptz,
  released_by_invoice_id uuid REFERENCES public.invoices(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trial_access_release_pair CHECK (
    (released_at IS NULL) = (released_by_invoice_id IS NULL)
  )
);
--> statement-breakpoint
CREATE TABLE public.trial_resource_usage (
  clinic_id uuid NOT NULL REFERENCES public.trial_access_policies(clinic_id) ON DELETE CASCADE,
  metric text NOT NULL,
  consumed integer NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, metric),
  CONSTRAINT trial_resource_metric_chk CHECK (metric IN (
    'patients', 'appointments', 'documents', 'payments', 'receivables', 'expenses',
    'procedures', 'resources', 'document_templates'
  ))
);
--> statement-breakpoint
ALTER TABLE public.trial_access_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_access_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trial_resource_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_resource_usage FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.trial_access_policies, public.trial_resource_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.trial_access_policies, public.trial_resource_usage TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.trial_access_policies, public.trial_resource_usage TO service_role;
CREATE POLICY trial_access_read ON public.trial_access_policies FOR SELECT TO authenticated
  USING (clinic_id::text = current_setting('app.current_clinic', true));
CREATE POLICY trial_usage_read ON public.trial_resource_usage FOR SELECT TO authenticated
  USING (clinic_id::text = current_setting('app.current_clinic', true));
--> statement-breakpoint
CREATE FUNCTION public.enroll_new_subscription_trial_limits() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE owner_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Invalid trial function owner';
  END IF;
  IF NEW.billing_status <> 'trial' OR NOT NEW.enforce_trial_deadline THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.plans WHERE id = NEW.plan_id AND code IN (
    'consultorio_2026', 'clinica_2026_2', 'clinica_2026_3', 'clinica_2026_4', 'clinica_2026_5'
  )) THEN RETURN NEW; END IF;
  SELECT id INTO owner_id FROM public.profiles
    WHERE clinic_id = NEW.clinic_id AND role = 'owner' AND ativo ORDER BY created_at, id LIMIT 1;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'trial owner missing'; END IF;
  INSERT INTO public.trial_access_policies(clinic_id, subscription_id, owner_user_id)
    VALUES (NEW.clinic_id, NEW.id, owner_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enroll_new_subscription_trial_limits() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enroll_new_subscription_trial_limits AFTER INSERT ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.enroll_new_subscription_trial_limits();
--> statement-breakpoint
CREATE FUNCTION public.enforce_trial_resource_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE policy public.trial_access_policies%ROWTYPE;
        resource text := TG_ARGV[0]; cap integer; consumed_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Invalid trial function owner';
  END IF;
  -- The same row serializes all creators and payment release for this clinic.
  SELECT * INTO policy FROM public.trial_access_policies WHERE clinic_id = NEW.clinic_id AND released_at IS NULL FOR UPDATE;
  IF NOT FOUND OR policy.released_at IS NOT NULL THEN RETURN NEW; END IF;
  -- Corrections of existing money must remain possible, including after expiry.
  IF resource = 'financial' THEN
    IF NEW.created_via = 'estorno' THEN RETURN NEW; END IF;
    resource := CASE WHEN NEW.tipo = 'receber' THEN 'receivables' ELSE 'expenses' END;
  ELSIF resource = 'payments' THEN
    IF NEW.kind = 'refund' THEN RETURN NEW; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE id = policy.subscription_id
    AND (trial_ends_at IS NULL OR trial_ends_at <= statement_timestamp())) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'qoro_trial_limit_expired', MESSAGE = 'Evaluation expired';
  END IF;
  cap := CASE WHEN resource = 'patients' THEN 10 ELSE 15 END;
  IF resource NOT IN ('patients','appointments','documents','payments','receivables','expenses',
                     'procedures','resources','document_templates') THEN
    RAISE EXCEPTION 'Unknown trial resource';
  END IF;
  INSERT INTO public.trial_resource_usage(clinic_id, metric, consumed)
    VALUES (NEW.clinic_id, resource, 1)
    ON CONFLICT (clinic_id, metric) DO UPDATE
      SET consumed = trial_resource_usage.consumed + 1, updated_at = now()
      WHERE trial_resource_usage.consumed < cap
    RETURNING consumed INTO consumed_count;
  IF consumed_count IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'qoro_trial_limit_' || resource,
      MESSAGE = 'Evaluation resource limit reached';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_trial_resource_limit() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER trial_patients AFTER INSERT ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trial_resource_limit('patients');
CREATE TRIGGER trial_appointments AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trial_resource_limit('appointments');
CREATE TRIGGER trial_prescriptions AFTER INSERT ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trial_resource_limit('documents');
CREATE TRIGGER trial_medical_documents AFTER INSERT ON public.medical_documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trial_resource_limit('documents');
CREATE TRIGGER trial_financial_entries AFTER INSERT ON public.lancamentos
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trial_resource_limit('financial');
CREATE TRIGGER trial_payment_records AFTER INSERT ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trial_resource_limit('payments');
CREATE TRIGGER trial_procedures AFTER INSERT ON public.procedures
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trial_resource_limit('procedures');
CREATE TRIGGER trial_resources AFTER INSERT ON public.schedulable_resources
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trial_resource_limit('resources');
CREATE TRIGGER trial_document_templates AFTER INSERT ON public.prescription_templates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trial_resource_limit('document_templates');
--> statement-breakpoint
CREATE FUNCTION public.enforce_trial_paid_feature() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE policy public.trial_access_policies%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Invalid trial function owner';
  END IF;
  SELECT * INTO policy FROM public.trial_access_policies WHERE clinic_id = NEW.clinic_id AND released_at IS NULL FOR UPDATE;
  IF NOT FOUND OR policy.released_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_ARGV[0] = 'team_invites' THEN
    IF NEW.id = policy.owner_user_id THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' THEN
      IF NEW.clinic_id = OLD.clinic_id AND (NOT NEW.ativo OR OLD.ativo) THEN RETURN NEW; END IF;
    END IF;
  ELSIF TG_ARGV[0] = 'whatsapp' THEN
    IF NOT NEW.active THEN RETURN NEW; END IF;
  ELSIF TG_ARGV[0] = 'asaas' THEN
    IF NOT NEW.active AND NEW.api_key_encrypted IS NULL THEN RETURN NEW; END IF;
  ELSE
    RAISE EXCEPTION 'Unknown trial paid feature';
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'qoro_trial_limit_' || TG_ARGV[0],
    MESSAGE = 'Evaluation feature requires verified subscription payment';
END $$;
REVOKE ALL ON FUNCTION public.enforce_trial_paid_feature() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trial_whatsapp BEFORE INSERT OR UPDATE ON public.clinic_whatsapp_numbers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trial_paid_feature('whatsapp');
CREATE TRIGGER trial_asaas BEFORE INSERT OR UPDATE ON public.clinic_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trial_paid_feature('asaas');
CREATE TRIGGER trial_team_invites BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trial_paid_feature('team_invites');
