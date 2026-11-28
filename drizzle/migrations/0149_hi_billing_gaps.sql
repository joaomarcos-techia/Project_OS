-- =====================================================================
-- 0149 — Convênios (ADR-072): pendência de faturamento "convênio sem guia"
-- (P7.4) e correção administrativa da cobertura depois do atendimento.
--
-- hi_billing_gaps         1 por atendimento de convênio concluído que ainda não tem
--                         guia pronta para conferência. Diz por que, quem resolve,
--                         se a recuperação é automática ou humana, o estado do
--                         evento de conclusão e as tentativas. Só fecha com prova:
--                         guia viva pronta (ou além), retorno não faturável,
--                         atendimento que deixou de estar concluído, ou decisão
--                         humana com motivo.
-- hi_billing_gap_events   histórico gravado SÓ pelo banco (sem dado pessoal).
-- hi_appointment_coverages  ganha a correção administrativa: depois do atendimento,
--                         a cobertura só muda com pendência aberta, nota e autor.
--
-- Não toca tabela compartilhada (appointments, lancamentos): só cria tabelas do
-- convênio e troca a função de gatilho `hi_guard_coverage` (0148). Sem dado
-- pessoal: a pendência guarda ids, códigos e mensagens genéricas.
-- =====================================================================

ALTER TABLE public.hi_appointment_coverages
  ADD COLUMN correction_note text,
  ADD COLUMN corrected_by uuid,
  ADD COLUMN corrected_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.hi_appointment_coverages ADD CONSTRAINT hi_appointment_coverages_correction_chk CHECK (
  (correction_note IS NULL AND corrected_by IS NULL AND corrected_at IS NULL)
  OR (correction_note IS NOT NULL AND char_length(btrim(correction_note)) BETWEEN 10 AND 500
      AND corrected_by IS NOT NULL AND corrected_at IS NOT NULL)
);
--> statement-breakpoint

CREATE TABLE public.hi_billing_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  -- Sem cascata para o paciente: a pendência não guarda dado pessoal e não segura a
  -- exclusão (LGPD). Coerência de clínica e de atendimento: gatilho abaixo.
  coverage_id uuid REFERENCES public.hi_appointment_coverages(id) ON DELETE SET NULL,
  guide_id uuid REFERENCES public.hi_guides(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open',
  reason text NOT NULL,
  owner text NOT NULL,
  recovery text NOT NULL,
  event_state text NOT NULL DEFAULT 'not_checked',
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  last_error_code text,
  detected_by text NOT NULL,
  resolution text,
  resolution_note text,
  resolved_at timestamptz,
  resolved_by uuid,
  reopened_count integer NOT NULL DEFAULT 0,
  opened_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_billing_gaps_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_billing_gaps_appointment_uniq UNIQUE (clinic_id, appointment_id),
  CONSTRAINT hi_billing_gaps_status_chk CHECK (status IN ('open', 'resolved', 'dismissed')),
  CONSTRAINT hi_billing_gaps_reason_chk CHECK (reason IN (
    'coverage_missing', 'coverage_cancelled', 'coverage_incomplete', 'authorization_pending',
    'authorization_denied', 'contract_missing', 'membership_invalid', 'guide_pending_data',
    'guide_inconsistent', 'guide_cancelled', 'sp_sadt_manual', 'module_disabled', 'return_within_window',
    'event_not_processed', 'processing_failed'
  )),
  CONSTRAINT hi_billing_gaps_owner_chk CHECK (owner IN ('recepcao', 'gestor', 'financeiro', 'medico', 'suporte')),
  CONSTRAINT hi_billing_gaps_recovery_chk CHECK (recovery IN ('automatic', 'human')),
  CONSTRAINT hi_billing_gaps_event_chk CHECK (
    event_state IN ('processed', 'pending', 'processing', 'failed', 'missing', 'not_checked')
  ),
  CONSTRAINT hi_billing_gaps_detected_chk CHECK (detected_by IN ('event', 'reconcile', 'correction')),
  CONSTRAINT hi_billing_gaps_issues_chk CHECK (
    jsonb_typeof(issues) = 'array' AND jsonb_array_length(issues) <= 100
  ),
  CONSTRAINT hi_billing_gaps_counters_chk CHECK (attempts >= 0 AND reopened_count >= 0 AND version >= 1),
  CONSTRAINT hi_billing_gaps_error_chk CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,64}$'),
  -- Fechamento só com a prova correspondente (o gatilho confere a prova no banco).
  CONSTRAINT hi_billing_gaps_resolution_chk CHECK (
    (status = 'open' AND resolution IS NULL AND resolution_note IS NULL AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL AND (
          (resolution = 'guide_ready' AND guide_id IS NOT NULL)
          OR (resolution = 'return_not_billable' AND resolution_note IS NOT NULL
              AND char_length(btrim(resolution_note)) BETWEEN 10 AND 500)
          OR resolution = 'not_applicable'))
    OR (status = 'dismissed' AND resolution = 'dismissed' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL
        AND resolution_note IS NOT NULL AND char_length(btrim(resolution_note)) BETWEEN 10 AND 500)
  )
);
--> statement-breakpoint
CREATE INDEX hi_billing_gaps_open_idx ON public.hi_billing_gaps (clinic_id, next_attempt_at) WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX hi_billing_gaps_owner_idx ON public.hi_billing_gaps (clinic_id, owner, opened_at) WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX hi_billing_gaps_coverage_idx ON public.hi_billing_gaps (coverage_id) WHERE coverage_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX hi_billing_gaps_guide_idx ON public.hi_billing_gaps (guide_id) WHERE guide_id IS NOT NULL;
--> statement-breakpoint

CREATE TABLE public.hi_billing_gap_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  gap_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  reason text NOT NULL,
  owner text NOT NULL,
  attempts integer NOT NULL,
  error_code text,
  changed_fields text[] NOT NULL DEFAULT '{}',
  actor_id uuid,
  actor_kind text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_billing_gap_events_gap_fk FOREIGN KEY (clinic_id, gap_id)
    REFERENCES public.hi_billing_gaps (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_billing_gap_events_actor_chk CHECK (actor_kind IN ('user', 'system')),
  CONSTRAINT hi_billing_gap_events_note_chk CHECK (note IS NULL OR char_length(note) <= 500)
);
--> statement-breakpoint
CREATE INDEX hi_billing_gap_events_idx ON public.hi_billing_gap_events (clinic_id, gap_id, created_at);
--> statement-breakpoint

-- ── Pendência: atendimento de convênio da clínica, prova no fechamento ─────
CREATE OR REPLACE FUNCTION public.hi_guard_billing_gap() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_text text := current_setting('app.current_user', true);
  v_actor uuid;
  v_appt_status text;
  v_appt_mode text;
  v_guide public.hi_guides%ROWTYPE;
BEGIN
  IF v_actor_text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_actor := v_actor_text::uuid;
  END IF;

  SELECT a.status::text, a.billing_mode INTO v_appt_status, v_appt_mode
    FROM public.appointments a WHERE a.id = NEW.appointment_id AND a.clinic_id = NEW.clinic_id;
  IF v_appt_status IS NULL THEN
    RAISE EXCEPTION 'Atendimento não pertence à clínica.' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Particular nunca tem pendência de convênio; pendência nasce aberta.
    IF v_appt_mode IS DISTINCT FROM 'convenio' THEN
      RAISE EXCEPTION 'Pendência de faturamento só para atendimento de convênio.' USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'Pendência nasce aberta.' USING ERRCODE = '23514';
    END IF;
    IF NEW.attempts NOT IN (0, 1) THEN
      RAISE EXCEPTION 'Pendência nasce com no máximo uma tentativa.' USING ERRCODE = '23514';
    END IF;
    IF NEW.attempts = 1 THEN
      NEW.last_attempt_at := now();
    END IF;
    NEW.version := 1;
    NEW.reopened_count := 0;
    NEW.opened_at := now();
    NEW.updated_at := now();
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
       OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id OR NEW.detected_by IS DISTINCT FROM OLD.detected_by
       OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
      RAISE EXCEPTION 'Atendimento, clínica e origem da pendência não mudam.' USING ERRCODE = '55000';
    END IF;
    IF NEW.attempts < OLD.attempts OR NEW.reopened_count IS DISTINCT FROM OLD.reopened_count THEN
      RAISE EXCEPTION 'Contadores da pendência só avançam pelo banco.' USING ERRCODE = '55000';
    END IF;
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  END IF;

  IF NEW.coverage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.hi_appointment_coverages c
     WHERE c.id = NEW.coverage_id AND c.clinic_id = NEW.clinic_id AND c.appointment_id = NEW.appointment_id
  ) THEN
    RAISE EXCEPTION 'A cobertura da pendência deve ser deste atendimento.' USING ERRCODE = '23514';
  END IF;
  IF NEW.guide_id IS NOT NULL THEN
    SELECT * INTO v_guide FROM public.hi_guides g WHERE g.id = NEW.guide_id AND g.clinic_id = NEW.clinic_id;
    IF NOT FOUND OR NOT (
      v_guide.idempotency_key = 'appointment:' || NEW.appointment_id::text || ':consulta'
      OR EXISTS (SELECT 1 FROM public.hi_guide_items i
                  WHERE i.clinic_id = NEW.clinic_id AND i.guide_id = NEW.guide_id
                    AND i.appointment_id = NEW.appointment_id)
    ) THEN
      RAISE EXCEPTION 'A guia da pendência deve ser deste atendimento.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'open' THEN
      -- Reabertura: a decisão humana só é desfeita por um humano.
      IF OLD.status = 'dismissed' AND v_actor IS NULL THEN
        RAISE EXCEPTION 'Pendência encerrada por decisão humana só reabre por um usuário.' USING ERRCODE = '42501';
      END IF;
      NEW.reopened_count := OLD.reopened_count + 1;
      NEW.resolution := NULL; NEW.resolution_note := NULL; NEW.resolved_at := NULL; NEW.resolved_by := NULL;
    ELSIF NEW.status = 'resolved' THEN
      IF OLD.status <> 'open' THEN
        RAISE EXCEPTION 'Só pendência aberta se resolve.' USING ERRCODE = '55000';
      END IF;
      NEW.resolved_at := now();
      NEW.resolved_by := v_actor;
      NEW.next_attempt_at := NULL;
      IF NEW.resolution = 'guide_ready' THEN
        -- Recuperação comprovada: guia viva, fora da edição com pendências.
        IF v_guide.id IS NULL OR NOT v_guide.live OR v_guide.status IN ('pending_data', 'cancelled', 'replaced') THEN
          RAISE EXCEPTION 'Pendência só se resolve com guia viva pronta para conferência (estado: %).',
            coalesce(v_guide.status, 'sem guia') USING ERRCODE = '23514';
        END IF;
      ELSIF NEW.resolution = 'not_applicable' THEN
        IF v_appt_status = 'atendido' THEN
          RAISE EXCEPTION 'Atendimento ainda concluído: a pendência continua válida.' USING ERRCODE = '23514';
        END IF;
      END IF;
    ELSIF NEW.status = 'dismissed' THEN
      IF OLD.status <> 'open' THEN
        RAISE EXCEPTION 'Só pendência aberta se encerra.' USING ERRCODE = '55000';
      END IF;
      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Encerrar sem faturar é decisão de um usuário, com motivo.' USING ERRCODE = '42501';
      END IF;
      NEW.resolution := 'dismissed';
      NEW.resolved_by := v_actor;
      NEW.resolved_at := now();
      NEW.next_attempt_at := NULL;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status <> 'open' AND (
       NEW.resolution IS DISTINCT FROM OLD.resolution OR NEW.resolution_note IS DISTINCT FROM OLD.resolution_note
       OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by) THEN
    RAISE EXCEPTION 'O fechamento da pendência não se edita; reabra.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guard_billing_gap() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_billing_gaps_guard BEFORE INSERT OR UPDATE ON public.hi_billing_gaps
  FOR EACH ROW EXECUTE FUNCTION public.hi_guard_billing_gap();
--> statement-breakpoint

-- Tentativas: o runtime só PEDE a contagem (attempts = OLD + 1 é o único avanço aceito).
CREATE OR REPLACE FUNCTION public.hi_billing_gap_attempts() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.attempts NOT IN (OLD.attempts, OLD.attempts + 1) THEN
    RAISE EXCEPTION 'Tentativas avançam de uma em uma.' USING ERRCODE = '55000';
  END IF;
  IF NEW.attempts = OLD.attempts + 1 THEN
    NEW.last_attempt_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_billing_gap_attempts() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_billing_gaps_b_attempts BEFORE UPDATE OF attempts ON public.hi_billing_gaps
  FOR EACH ROW EXECUTE FUNCTION public.hi_billing_gap_attempts();
--> statement-breakpoint

-- ── Histórico: só o banco grava ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hi_billing_gap_record_event() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_text text := current_setting('app.current_user', true);
  v_actor uuid;
  v_changed text[] := '{}';
BEGIN
  IF v_actor_text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_actor := v_actor_text::uuid;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT coalesce(array_agg(n.key ORDER BY n.key), '{}') INTO v_changed
      FROM jsonb_each(to_jsonb(NEW)) n
     WHERE n.key IN ('status', 'reason', 'owner', 'recovery', 'attempts', 'guide_id', 'coverage_id',
                     'event_state', 'issues', 'resolution', 'last_error_code')
       AND n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);
    IF cardinality(v_changed) = 0 THEN
      RETURN NULL;
    END IF;
  END IF;
  INSERT INTO public.hi_billing_gap_events
    (clinic_id, gap_id, from_status, to_status, reason, owner, attempts, error_code, changed_fields,
     actor_id, actor_kind, note)
  VALUES (NEW.clinic_id, NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status, NEW.reason,
          NEW.owner, NEW.attempts, NEW.last_error_code, v_changed, v_actor,
          CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END,
          CASE WHEN TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN NEW.resolution_note END);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_billing_gap_record_event() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_billing_gaps_z_event AFTER INSERT OR UPDATE ON public.hi_billing_gaps
  FOR EACH ROW EXECUTE FUNCTION public.hi_billing_gap_record_event();
--> statement-breakpoint

-- ── Cobertura: depois do atendimento, só correção administrativa ─────────
-- Troca a função da 0148 mantendo todas as regras dela. A única exceção nova ao
-- congelamento: atendimento CONCLUÍDO com pendência de faturamento ABERTA, com nota
-- nova (10–500), autor = usuário autenticado; o banco carimba a hora.
CREATE OR REPLACE FUNCTION public.hi_guard_coverage() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_appt_status text;
  v_appt_patient uuid;
  v_contract public.hi_procedure_contracts%ROWTYPE;
  v_auth_status text;
  v_auth_patient uuid;
  v_actor_text text := current_setting('app.current_user', true);
  v_actor uuid;
  v_correction boolean := false;
BEGIN
  IF v_actor_text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_actor := v_actor_text::uuid;
  END IF;
  SELECT a.status::text, a.patient_id INTO v_appt_status, v_appt_patient
    FROM public.appointments a WHERE a.id = NEW.appointment_id AND a.clinic_id = NEW.clinic_id;
  IF v_appt_status IS NULL THEN
    RAISE EXCEPTION 'Atendimento não pertence à clínica.' USING ERRCODE = '23503';
  END IF;
  IF v_appt_patient IS DISTINCT FROM NEW.patient_id THEN
    RAISE EXCEPTION 'A cobertura deve ser do paciente do atendimento.' USING ERRCODE = '23514';
  END IF;

  IF v_appt_status = 'atendido'
     AND NEW.correction_note IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.correction_note IS DISTINCT FROM OLD.correction_note)
     AND EXISTS (SELECT 1 FROM public.hi_billing_gaps g
                  WHERE g.clinic_id = NEW.clinic_id AND g.appointment_id = NEW.appointment_id
                    AND g.status = 'open') THEN
    IF v_actor IS NULL OR NEW.corrected_by IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'A correção da cobertura é de um usuário autenticado, que fica como autor.'
        USING ERRCODE = '42501';
    END IF;
    NEW.corrected_at := now();
    v_correction := true;
  ELSIF TG_OP = 'UPDATE' AND (NEW.correction_note IS DISTINCT FROM OLD.correction_note
         OR NEW.corrected_by IS DISTINCT FROM OLD.corrected_by OR NEW.corrected_at IS DISTINCT FROM OLD.corrected_at) THEN
    RAISE EXCEPTION 'Correção só em atendimento concluído com pendência de faturamento aberta.' USING ERRCODE = '55000';
  ELSIF TG_OP = 'INSERT' AND (NEW.correction_note IS NOT NULL OR NEW.corrected_by IS NOT NULL OR NEW.corrected_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Correção só em atendimento concluído com pendência de faturamento aberta.' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.appointment_id IS DISTINCT FROM OLD.appointment_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
       OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id OR NEW.created_via IS DISTINCT FROM OLD.created_via
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Atendimento, paciente e origem da cobertura não mudam.' USING ERRCODE = '55000';
    END IF;
    IF NOT v_correction AND v_appt_status IN ('em_atendimento', 'atendido', 'cancelado', 'faltou')
       AND NOT (NEW.status = 'cancelled' AND v_appt_status IN ('cancelado', 'faltou')
                AND (to_jsonb(NEW) - 'status' - 'version' - 'updated_at')
                    = (to_jsonb(OLD) - 'status' - 'version' - 'updated_at')) THEN
      RAISE EXCEPTION 'A cobertura congela quando o atendimento começa (estado: %); use a correção do atendimento.',
        v_appt_status USING ERRCODE = '55000';
    END IF;
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  ELSIF NOT v_correction AND v_appt_status IN ('em_atendimento', 'atendido', 'cancelado', 'faltou') THEN
    RAISE EXCEPTION 'Cobertura só se registra antes do atendimento começar (estado: %).', v_appt_status
      USING ERRCODE = '55000';
  END IF;

  IF NEW.membership_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.hi_memberships m
     WHERE m.id = NEW.membership_id AND m.clinic_id = NEW.clinic_id AND m.patient_id = NEW.patient_id
  ) THEN
    RAISE EXCEPTION 'A carteirinha deve ser do paciente do atendimento.' USING ERRCODE = '23514';
  END IF;
  IF NEW.contract_line_id IS NOT NULL THEN
    SELECT * INTO v_contract FROM public.hi_procedure_contracts
     WHERE id = NEW.contract_line_id AND clinic_id = NEW.clinic_id;
    IF v_contract.insurer_id IS DISTINCT FROM NEW.insurer_id OR v_contract.guide_type IS DISTINCT FROM NEW.guide_type
       OR (v_contract.plan_id IS NOT NULL AND v_contract.plan_id IS DISTINCT FROM NEW.plan_id) THEN
      RAISE EXCEPTION 'O contrato da cobertura deve ser desta operadora, deste plano e deste tipo de guia.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.authorization_id IS NOT NULL THEN
    SELECT a.status, m.patient_id INTO v_auth_status, v_auth_patient
      FROM public.hi_authorizations a
      JOIN public.hi_memberships m ON m.id = a.membership_id AND m.clinic_id = a.clinic_id
     WHERE a.id = NEW.authorization_id AND a.clinic_id = NEW.clinic_id;
    IF v_auth_patient IS DISTINCT FROM NEW.patient_id THEN
      RAISE EXCEPTION 'A autorização deve ser do paciente do atendimento.' USING ERRCODE = '23514';
    END IF;
    -- Nenhuma autorização presumida: "registrada" só com a da operadora concedida; "negada" só com a negada.
    IF NEW.status = 'authorization_recorded' AND v_auth_status NOT IN ('authorized', 'partially_authorized') THEN
      RAISE EXCEPTION 'Só se registra autorização concedida pela operadora (estado: %).', v_auth_status
        USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'ready' AND NEW.authorization_requirement = 'required'
       AND v_auth_status NOT IN ('authorized', 'partially_authorized') THEN
      RAISE EXCEPTION 'Cobertura pronta exige autorização concedida (estado: %).', v_auth_status USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'authorization_denied' AND v_auth_status <> 'denied' THEN
      RAISE EXCEPTION 'Situação "negada" só com a autorização negada pela operadora.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guard_coverage() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_billing_gaps ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_billing_gaps FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_billing_gaps_tenant_access ON public.hi_billing_gaps FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_billing_gap_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_billing_gap_events FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_billing_gap_events_tenant_access ON public.hi_billing_gap_events FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );--> statement-breakpoint

-- Runtime: pendência com SELECT/INSERT e UPDATE só das colunas de trabalho; DELETE
-- nunca. Histórico: só leitura (o gatilho SECURITY DEFINER grava).
REVOKE ALL ON public.hi_billing_gaps, public.hi_billing_gap_events FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT ON public.hi_billing_gaps TO authenticated, service_role;--> statement-breakpoint
GRANT UPDATE (coverage_id, guide_id, status, reason, owner, recovery, event_state, issues, attempts,
  next_attempt_at, last_error_code, resolution, resolution_note) ON public.hi_billing_gaps TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT ON public.hi_billing_gap_events TO authenticated, service_role;--> statement-breakpoint
GRANT UPDATE (correction_note, corrected_by) ON public.hi_appointment_coverages TO authenticated, service_role;--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0149-hi-billing-gaps')
  ON CONFLICT DO NOTHING;
