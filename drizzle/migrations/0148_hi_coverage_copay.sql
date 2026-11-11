-- =====================================================================
-- 0148 — Convênios (ADR-072): modalidade do atendimento, cobertura e
-- coparticipação (P1.6), com a rede de segurança financeira.
--
-- appointments.billing_mode     'particular' (padrão; todo atendimento existente)
--                               ou 'convenio'. Só vira 'convenio' em clínica com o
--                               módulo LIGADO (hi_clinic_settings.enabled) e só até
--                               a chegada do paciente; depois, fluxo de correção.
-- hi_appointment_coverages      1 por atendimento: operadora, plano, carteirinha,
--                               contrato estimado, exigência e situação da
--                               autorização, pendências. Congela no fim do atendimento.
-- hi_copayments                 coparticipação com os seis valores separados:
--                               previsto, calculado, conferido, confirmado,
--                               cobrável e recebido. Nada é cobrado sem confirmação.
-- lancamentos (gatilho)         REDE DE SEGURANÇA: recebível ligado a atendimento
--                               de convênio só existe com coparticipação
--                               confirmada, e só até o valor cobrável. Vale para
--                               qualquer caminho (handler, Caixa, script).
--
-- Comportamento particular: inalterado. A coluna nasce 'particular' para todos os
-- atendimentos existentes (ADD COLUMN com DEFAULT constante: sem reescrever a
-- tabela); o CHECK entra NOT VALID e é validado depois (sem travar escrita); os
-- gatilhos saem cedo para 'particular'.
--
-- Sem BEGIN/COMMIT. Só aditiva.
--
-- Rollback (sem dado de produção ainda):
--   DROP TRIGGER IF EXISTS lancamentos_convenio_patient_guard ON public.lancamentos;
--   DROP TRIGGER IF EXISTS appointments_billing_mode_guard ON public.appointments;
--   DROP TABLE IF EXISTS public.hi_copayments, public.hi_appointment_coverages CASCADE;
--   DROP FUNCTION IF EXISTS public.hi_guard_convenio_patient_receivable(),
--     public.hi_guard_appointment_billing_mode(), public.hi_guard_coverage(),
--     public.hi_copay_transition();
--   ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_billing_mode_chk,
--     DROP COLUMN IF EXISTS billing_mode;
--   DELETE FROM public._schema_version WHERE version = '0148-hi-coverage-copay';
-- =====================================================================

ALTER TABLE public.appointments ADD COLUMN billing_mode text NOT NULL DEFAULT 'particular';
--> statement-breakpoint
ALTER TABLE public.appointments ADD CONSTRAINT appointments_billing_mode_chk
  CHECK (billing_mode IN ('particular', 'convenio')) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.appointments VALIDATE CONSTRAINT appointments_billing_mode_chk;
--> statement-breakpoint

-- Modalidade 'convenio' só com o módulo ligado na clínica e só até a chegada.
CREATE OR REPLACE FUNCTION public.hi_guard_appointment_billing_mode() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.billing_mode = 'particular' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.billing_mode IS NOT DISTINCT FROM OLD.billing_mode THEN
    RETURN NEW;
  END IF;
  IF NEW.billing_mode = 'convenio' AND NOT EXISTS (
    SELECT 1 FROM public.hi_clinic_settings s WHERE s.clinic_id = NEW.clinic_id AND s.enabled
  ) THEN
    RAISE EXCEPTION 'Convênio não está habilitado para esta clínica.' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text NOT IN ('agendado', 'confirmado', 'chegou') THEN
    RAISE EXCEPTION 'A forma de atendimento só muda até a chegada do paciente; depois, use a correção do atendimento.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guard_appointment_billing_mode() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER appointments_billing_mode_guard BEFORE INSERT OR UPDATE OF billing_mode ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.hi_guard_appointment_billing_mode();
--> statement-breakpoint

CREATE TABLE public.hi_appointment_coverages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  -- Cobertura é dado administrativo pré-faturamento: sai com o paciente (LGPD). Quem
  -- retém o paciente por obrigação é a GUIA (0147, FK sem cascata), não a cobertura.
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  guide_type text NOT NULL DEFAULT 'consulta',
  insurer_id uuid NOT NULL,
  plan_id uuid,
  membership_id uuid,
  contract_line_id uuid,
  authorization_requirement text NOT NULL DEFAULT 'unknown',
  authorization_id uuid,
  status text NOT NULL DEFAULT 'incomplete',
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_value_cents bigint,
  version integer NOT NULL DEFAULT 1,
  created_via text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_appointment_coverages_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_appointment_coverages_copay_key UNIQUE (clinic_id, id, appointment_id, patient_id),
  CONSTRAINT hi_appointment_coverages_appointment_uniq UNIQUE (clinic_id, appointment_id),
  CONSTRAINT hi_appointment_coverages_insurer_fk FOREIGN KEY (clinic_id, insurer_id)
    REFERENCES public.hi_insurers (clinic_id, id),
  CONSTRAINT hi_appointment_coverages_plan_fk FOREIGN KEY (clinic_id, plan_id, insurer_id)
    REFERENCES public.hi_plans (clinic_id, id, insurer_id),
  CONSTRAINT hi_appointment_coverages_membership_fk FOREIGN KEY (clinic_id, membership_id, insurer_id)
    REFERENCES public.hi_memberships (clinic_id, id, insurer_id),
  CONSTRAINT hi_appointment_coverages_contract_fk FOREIGN KEY (clinic_id, contract_line_id)
    REFERENCES public.hi_procedure_contracts (clinic_id, id),
  CONSTRAINT hi_appointment_coverages_authorization_fk FOREIGN KEY (clinic_id, authorization_id, insurer_id, guide_type)
    REFERENCES public.hi_authorizations (clinic_id, id, insurer_id, guide_type),
  CONSTRAINT hi_appointment_coverages_type_chk CHECK (guide_type IN ('consulta', 'sp_sadt')),
  CONSTRAINT hi_appointment_coverages_requirement_chk CHECK (
    authorization_requirement IN ('unknown', 'not_required', 'required')
  ),
  CONSTRAINT hi_appointment_coverages_status_chk CHECK (status IN (
    'incomplete', 'pending_authorization', 'authorization_recorded', 'authorization_denied', 'ready', 'cancelled'
  )),
  CONSTRAINT hi_appointment_coverages_issues_chk CHECK (
    jsonb_typeof(issues) = 'array' AND jsonb_array_length(issues) <= 100
  ),
  -- "Pronta" só com tudo o que a guia precisa e sem pendência; autorização exigida só com autorização.
  CONSTRAINT hi_appointment_coverages_ready_chk CHECK (
    status <> 'ready'
    OR (membership_id IS NOT NULL AND contract_line_id IS NOT NULL AND issues = '[]'::jsonb
        AND authorization_requirement <> 'unknown'
        AND (authorization_requirement = 'not_required' OR authorization_id IS NOT NULL))
  ),
  CONSTRAINT hi_appointment_coverages_authorization_chk CHECK (
    status NOT IN ('authorization_recorded', 'authorization_denied') OR authorization_id IS NOT NULL
  ),
  CONSTRAINT hi_appointment_coverages_pending_auth_chk CHECK (
    status <> 'pending_authorization' OR authorization_requirement = 'required'
  ),
  CONSTRAINT hi_appointment_coverages_value_chk CHECK (
    expected_value_cents IS NULL OR expected_value_cents BETWEEN 0 AND 9999999999
  ),
  CONSTRAINT hi_appointment_coverages_version_chk CHECK (version >= 1),
  CONSTRAINT hi_appointment_coverages_created_chk CHECK (
    created_via IN ('user', 'automation') AND (created_via <> 'user' OR created_by IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX hi_appointment_coverages_patient_idx ON public.hi_appointment_coverages (clinic_id, patient_id);
--> statement-breakpoint
CREATE INDEX hi_appointment_coverages_status_idx ON public.hi_appointment_coverages (clinic_id, status);
--> statement-breakpoint

-- Cobertura coerente com o atendimento, a carteirinha, o contrato e a autorização;
-- congelada quando o atendimento termina (só pode ser cancelada).
CREATE OR REPLACE FUNCTION public.hi_guard_coverage() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_appt_status text;
  v_appt_patient uuid;
  v_contract public.hi_procedure_contracts%ROWTYPE;
  v_auth_status text;
  v_auth_patient uuid;
BEGIN
  SELECT a.status::text, a.patient_id INTO v_appt_status, v_appt_patient
    FROM public.appointments a WHERE a.id = NEW.appointment_id AND a.clinic_id = NEW.clinic_id;
  IF v_appt_status IS NULL THEN
    RAISE EXCEPTION 'Atendimento não pertence à clínica.' USING ERRCODE = '23503';
  END IF;
  IF v_appt_patient IS DISTINCT FROM NEW.patient_id THEN
    RAISE EXCEPTION 'A cobertura deve ser do paciente do atendimento.' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.appointment_id IS DISTINCT FROM OLD.appointment_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
       OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id OR NEW.created_via IS DISTINCT FROM OLD.created_via
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Atendimento, paciente e origem da cobertura não mudam.' USING ERRCODE = '55000';
    END IF;
    IF v_appt_status IN ('em_atendimento', 'atendido', 'cancelado', 'faltou')
       AND NOT (NEW.status = 'cancelled' AND v_appt_status IN ('cancelado', 'faltou')
                AND (to_jsonb(NEW) - 'status' - 'version' - 'updated_at')
                    = (to_jsonb(OLD) - 'status' - 'version' - 'updated_at')) THEN
      RAISE EXCEPTION 'A cobertura congela quando o atendimento começa (estado: %); use a correção do atendimento.',
        v_appt_status USING ERRCODE = '55000';
    END IF;
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  ELSIF v_appt_status IN ('em_atendimento', 'atendido', 'cancelado', 'faltou') THEN
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
CREATE TRIGGER hi_appointment_coverages_guard BEFORE INSERT OR UPDATE ON public.hi_appointment_coverages
  FOR EACH ROW EXECUTE FUNCTION public.hi_guard_coverage();
--> statement-breakpoint

CREATE TABLE public.hi_copayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  coverage_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  kind text NOT NULL,
  percentage numeric(5,2),
  expected_cents bigint NOT NULL,
  calculated_cents bigint,
  checked_cents bigint,
  confirmed_cents bigint,
  chargeable_cents bigint,
  received_cents bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'estimated',
  checked_by uuid,
  checked_at timestamptz,
  confirmed_by uuid,
  confirmed_at timestamptz,
  waive_reason text,
  charge_ref uuid,
  transition_note text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_copayments_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_copayments_coverage_uniq UNIQUE (coverage_id),
  CONSTRAINT hi_copayments_appointment_uniq UNIQUE (clinic_id, appointment_id),
  -- Mesmo atendimento e mesmo paciente da cobertura (FK composta, não só o id).
  CONSTRAINT hi_copayments_coverage_fk FOREIGN KEY (clinic_id, coverage_id, appointment_id, patient_id)
    REFERENCES public.hi_appointment_coverages (clinic_id, id, appointment_id, patient_id) ON DELETE CASCADE,
  CONSTRAINT hi_copayments_kind_chk CHECK (
    (kind = 'fixed' AND percentage IS NULL)
    OR (kind = 'percentage' AND percentage IS NOT NULL AND percentage > 0 AND percentage <= 100)
  ),
  CONSTRAINT hi_copayments_status_chk CHECK (status IN (
    'estimated', 'calculated', 'checked', 'confirmed', 'charged', 'paid', 'refunded', 'waived', 'cancelled'
  )),
  CONSTRAINT hi_copayments_amounts_chk CHECK (
    expected_cents BETWEEN 0 AND 9999999999
    AND (calculated_cents IS NULL OR calculated_cents BETWEEN 0 AND 9999999999)
    AND (checked_cents IS NULL OR checked_cents BETWEEN 0 AND 9999999999)
    AND (confirmed_cents IS NULL OR confirmed_cents BETWEEN 0 AND 9999999999)
    AND (chargeable_cents IS NULL OR chargeable_cents BETWEEN 0 AND 9999999999)
    AND received_cents BETWEEN 0 AND 9999999999
  ),
  -- Cada etapa exige o valor e o responsável dela (IS NOT NULL explícito: NULL passaria no CHECK).
  CONSTRAINT hi_copayments_calculated_chk CHECK (
    status IN ('estimated', 'waived', 'cancelled') OR calculated_cents IS NOT NULL
  ),
  CONSTRAINT hi_copayments_checked_chk CHECK (
    status NOT IN ('checked', 'confirmed', 'charged', 'paid', 'refunded')
    OR (checked_cents IS NOT NULL AND checked_by IS NOT NULL AND checked_at IS NOT NULL)
  ),
  CONSTRAINT hi_copayments_confirmed_chk CHECK (
    status NOT IN ('confirmed', 'charged', 'paid', 'refunded')
    OR (confirmed_cents IS NOT NULL AND chargeable_cents IS NOT NULL AND confirmed_by IS NOT NULL
        AND confirmed_at IS NOT NULL AND chargeable_cents <= confirmed_cents)
  ),
  -- Antes da confirmação não existe valor cobrável.
  CONSTRAINT hi_copayments_chargeable_chk CHECK (
    status IN ('confirmed', 'charged', 'paid', 'refunded') OR chargeable_cents IS NULL OR chargeable_cents = 0
  ),
  CONSTRAINT hi_copayments_received_chk CHECK (received_cents <= coalesce(chargeable_cents, 0)),
  CONSTRAINT hi_copayments_waived_chk CHECK (
    status <> 'waived'
    OR (waive_reason IS NOT NULL AND char_length(btrim(waive_reason)) BETWEEN 10 AND 500
        AND coalesce(chargeable_cents, 0) = 0)
  ),
  CONSTRAINT hi_copayments_charge_ref_chk CHECK (
    status NOT IN ('charged', 'paid', 'refunded') OR charge_ref IS NOT NULL
  ),
  CONSTRAINT hi_copayments_note_chk CHECK (transition_note IS NULL OR char_length(transition_note) <= 500),
  CONSTRAINT hi_copayments_version_chk CHECK (version >= 1)
);
--> statement-breakpoint

-- Transições: o runtime estima, calcula, confere, confirma, dispensa e cancela;
-- cobrar, receber e estornar são do financeiro (código do banco com dono, P10.5).
-- SECURITY INVOKER de propósito (mesma regra do estado da guia na 0147).
CREATE OR REPLACE FUNCTION public.hi_copay_transition() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_owner boolean;
  v_pair text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('estimated', 'calculated') OR NEW.confirmed_cents IS NOT NULL
       OR NEW.chargeable_cents IS NOT NULL OR NEW.received_cents <> 0 OR NEW.charge_ref IS NOT NULL THEN
      RAISE EXCEPTION 'Coparticipação nasce estimada ou calculada, nunca confirmada nem cobrada.' USING ERRCODE = '23514';
    END IF;
    NEW.version := 1;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
     OR NEW.coverage_id IS DISTINCT FROM OLD.coverage_id OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
     OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Atendimento, paciente e cobertura da coparticipação não mudam.' USING ERRCODE = '55000';
  END IF;
  -- Confirmada: valores congelados (só o financeiro avança cobrança e recebimento).
  IF OLD.status IN ('confirmed', 'charged', 'paid', 'refunded', 'waived', 'cancelled') AND (
       NEW.kind IS DISTINCT FROM OLD.kind OR NEW.percentage IS DISTINCT FROM OLD.percentage
       OR NEW.expected_cents IS DISTINCT FROM OLD.expected_cents OR NEW.calculated_cents IS DISTINCT FROM OLD.calculated_cents
       OR NEW.checked_cents IS DISTINCT FROM OLD.checked_cents OR NEW.confirmed_cents IS DISTINCT FROM OLD.confirmed_cents
       OR NEW.chargeable_cents IS DISTINCT FROM OLD.chargeable_cents) THEN
    RAISE EXCEPTION 'Coparticipação confirmada ou encerrada não muda de valor.' USING ERRCODE = '55000';
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  IF NEW.transition_note IS NOT DISTINCT FROM OLD.transition_note THEN
    NEW.transition_note := NULL;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    IF NEW.received_cents IS DISTINCT FROM OLD.received_cents OR NEW.charge_ref IS DISTINCT FROM OLD.charge_ref THEN
      RAISE EXCEPTION 'Cobrança e recebimento só mudam pelo financeiro.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  SELECT current_user = pg_get_userbyid(c.relowner) INTO v_owner FROM pg_class c WHERE c.oid = TG_RELID;
  v_pair := OLD.status || '>' || NEW.status;
  IF v_pair IN (
    'estimated>calculated', 'calculated>checked', 'checked>calculated', 'checked>confirmed',
    'estimated>waived', 'calculated>waived', 'checked>waived', 'confirmed>waived',
    'estimated>cancelled', 'calculated>cancelled', 'checked>cancelled', 'confirmed>cancelled'
  ) THEN
    NULL;
  ELSIF v_owner AND v_pair IN ('confirmed>charged', 'charged>paid', 'charged>cancelled', 'paid>refunded') THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Transição de coparticipação não permitida: % → %.', OLD.status, NEW.status USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'checked' THEN
    NEW.checked_at := now();
  ELSIF NEW.status = 'confirmed' THEN
    NEW.confirmed_at := now();
  END IF;
  IF v_pair = 'checked>calculated' THEN
    NEW.checked_cents := NULL; NEW.checked_by := NULL; NEW.checked_at := NULL;
  END IF;
  IF v_pair IN ('confirmed>waived', 'confirmed>cancelled') THEN
    -- Desfazer uma confirmação ainda não cobrada exige o motivo.
    IF NEW.transition_note IS NULL OR char_length(btrim(NEW.transition_note)) < 10 THEN
      RAISE EXCEPTION 'Desfazer uma coparticipação confirmada exige o motivo (10 a 500 caracteres).' USING ERRCODE = '23514';
    END IF;
    -- Se o financeiro já criou o recebível, desfazer aqui o deixaria órfão: resolve-se lá primeiro.
    IF EXISTS (
      SELECT 1 FROM public.lancamentos l
       WHERE l.clinic_id = NEW.clinic_id AND l.appointment_id = NEW.appointment_id AND l.tipo::text = 'receber'
    ) THEN
      RAISE EXCEPTION 'Já existe recebível desta coparticipação; cancele ou estorne no financeiro antes.' USING ERRCODE = '55000';
    END IF;
    NEW.chargeable_cents := 0;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_copay_transition() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_copayments_transition BEFORE INSERT OR UPDATE ON public.hi_copayments
  FOR EACH ROW EXECUTE FUNCTION public.hi_copay_transition();
--> statement-breakpoint

-- REDE DE SEGURANÇA FINANCEIRA: recebível de atendimento de convênio só pela
-- coparticipação confirmada. Qualquer caminho (handler, Caixa, script) cai aqui.
CREATE OR REPLACE FUNCTION public.hi_guard_convenio_patient_receivable() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_mode text;
  v_allowed bigint;
BEGIN
  IF NEW.tipo::text <> 'receber' OR NEW.appointment_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT a.billing_mode INTO v_mode FROM public.appointments a WHERE a.id = NEW.appointment_id;
  IF v_mode IS DISTINCT FROM 'convenio' THEN
    RETURN NEW;
  END IF;
  SELECT c.chargeable_cents INTO v_allowed FROM public.hi_copayments c
   WHERE c.clinic_id = NEW.clinic_id AND c.appointment_id = NEW.appointment_id
     AND c.status IN ('confirmed', 'charged', 'paid');
  IF v_allowed IS NULL OR v_allowed <= 0 OR round(NEW.valor * 100) > v_allowed THEN
    RAISE EXCEPTION 'Atendimento por convênio: o paciente só é cobrado pela coparticipação confirmada (limite: % centavos).',
      coalesce(v_allowed, 0) USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guard_convenio_patient_receivable() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER lancamentos_convenio_patient_guard
  BEFORE INSERT OR UPDATE OF valor, appointment_id, tipo ON public.lancamentos
  FOR EACH ROW EXECUTE FUNCTION public.hi_guard_convenio_patient_receivable();
--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_appointment_coverages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_appointment_coverages FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_appointment_coverages_tenant_access ON public.hi_appointment_coverages FOR ALL
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
ALTER TABLE public.hi_copayments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_copayments FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_copayments_tenant_access ON public.hi_copayments FOR ALL
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

-- Runtime: SELECT/INSERT e UPDATE só nas colunas de negócio; DELETE nunca.
-- `received_cents` e `charge_ref` da coparticipação ficam fora do GRANT: só o financeiro (P10.5).
REVOKE ALL ON public.hi_appointment_coverages, public.hi_copayments FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT ON public.hi_appointment_coverages, public.hi_copayments TO authenticated, service_role;--> statement-breakpoint
GRANT UPDATE (guide_type, insurer_id, plan_id, membership_id, contract_line_id, authorization_requirement,
  authorization_id, status, issues, expected_value_cents) ON public.hi_appointment_coverages TO authenticated, service_role;--> statement-breakpoint
GRANT UPDATE (kind, percentage, expected_cents, calculated_cents, checked_cents, confirmed_cents, chargeable_cents,
  status, checked_by, confirmed_by, waive_reason, transition_note) ON public.hi_copayments TO authenticated, service_role;--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0148-hi-coverage-copay')
  ON CONFLICT DO NOTHING;
