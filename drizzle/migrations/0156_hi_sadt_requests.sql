-- =====================================================================
-- 0156 — Convênios: solicitação SP/SADT persistida (P6.2) e regra de agrupamento
-- das sessões por operadora (P2.5/P8.7). CANDIDATA: provada em Postgres descartável;
-- NÃO aplicada no DEV compartilhado nem em produção.
--
-- hi_sadt_requests        a solicitação do profissional: paciente, carteirinha,
--                         operadora/plano, solicitante (da clínica ou externo),
--                         data, caráter (tabela 23), indicação clínica DIGITADA PELO
--                         PROFISSIONAL (cifrada por clínica; nunca copiada do
--                         prontuário, D17), número da solicitação no prestador,
--                         exigência de autorização pelo contrato e o vínculo com a
--                         autorização da operadora (0146), quando exigida.
-- hi_sadt_request_items   procedimento TUSS pedido, quantidade, linha de contrato
--                         conferida e o item da autorização correspondente.
-- hi_sadt_request_events  histórico de estados (só inclusão).
-- hi_appointment_coverages.sadt_request_item_id
--                         o atendimento EXECUTA um item da solicitação: é o que liga
--                         a sessão realizada ao pedido (solicitação ≠ execução; nada
--                         é faturado só por ter sido pedido).
-- hi_insurers.sadt_grouping
--                         'per_session' (uma guia por sessão, padrão) ou
--                         'per_request' (sessões da mesma solicitação na mesma guia
--                         aberta até a conferência). Configuração da operadora, nunca
--                         presumida.
--
-- Regras no banco:
--  - estados que dependem da operadora só com a autorização ligada (0146 já exige a
--    evidência da operadora para "autorizada"); "pronta" só quando o contrato diz
--    que não exige autorização;
--  - conferida exige quem conferiu, quando e o número da solicitação;
--  - indicação clínica: tudo ou nada (texto cifrado, quem informou, quando);
--  - operação nova (solicitação) só com assinatura paga e ativa (D24, hi_premium_guard);
--  - clínica, paciente, operadora, carteirinha e solicitante não mudam depois de criada.
--
-- Sem BEGIN/COMMIT (o migrador envolve). Só aditiva; não toca tabela compartilhada.
--
-- Reversão (sem solicitação existente):
--   ALTER TABLE public.hi_appointment_coverages DROP CONSTRAINT hi_appointment_coverages_sadt_item_chk,
--     DROP CONSTRAINT hi_appointment_coverages_sadt_item_fk, DROP COLUMN sadt_request_item_id;
--   DROP TABLE public.hi_sadt_request_events, public.hi_sadt_request_items, public.hi_sadt_requests;
--   DROP FUNCTION public.hi_sadt_request_guard();
--   ALTER TABLE public.hi_insurers DROP CONSTRAINT hi_insurers_sadt_grouping_chk, DROP COLUMN sadt_grouping;
--   DELETE FROM public._schema_version WHERE version = '0156-hi-sadt-requests';
-- =====================================================================

ALTER TABLE public.hi_insurers ADD COLUMN sadt_grouping text NOT NULL DEFAULT 'per_session';
--> statement-breakpoint
ALTER TABLE public.hi_insurers ADD CONSTRAINT hi_insurers_sadt_grouping_chk
  CHECK (sadt_grouping IN ('per_session', 'per_request')) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.hi_insurers VALIDATE CONSTRAINT hi_insurers_sadt_grouping_chk;
--> statement-breakpoint

CREATE TABLE public.hi_sadt_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  guide_type text NOT NULL DEFAULT 'sp_sadt',
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  insurer_id uuid NOT NULL,
  plan_id uuid,
  membership_id uuid NOT NULL,
  requester_kind text NOT NULL,
  requester_professional_id uuid,
  requester_external jsonb,
  source_appointment_id uuid REFERENCES public.appointments(id),
  requested_on date NOT NULL,
  care_character text NOT NULL DEFAULT '1',
  care_type text,
  consultation_type text,
  clinical_indication_encrypted text,
  clinical_indication_by uuid,
  clinical_indication_at timestamptz,
  request_number text,
  authorization_requirement text NOT NULL DEFAULT 'unknown',
  authorization_id uuid,
  status text NOT NULL DEFAULT 'draft',
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  version integer NOT NULL DEFAULT 1,
  checked_at timestamptz,
  checked_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_sadt_requests_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_sadt_requests_number_uniq UNIQUE (clinic_id, insurer_id, request_number),
  CONSTRAINT hi_sadt_requests_insurer_fk FOREIGN KEY (clinic_id, insurer_id)
    REFERENCES public.hi_insurers (clinic_id, id),
  CONSTRAINT hi_sadt_requests_plan_fk FOREIGN KEY (clinic_id, plan_id, insurer_id)
    REFERENCES public.hi_plans (clinic_id, id, insurer_id),
  CONSTRAINT hi_sadt_requests_membership_fk FOREIGN KEY (clinic_id, membership_id, insurer_id)
    REFERENCES public.hi_memberships (clinic_id, id, insurer_id),
  CONSTRAINT hi_sadt_requests_requester_fk FOREIGN KEY (clinic_id, requester_professional_id)
    REFERENCES public.hi_professional_profiles (clinic_id, professional_id),
  CONSTRAINT hi_sadt_requests_authorization_fk FOREIGN KEY (clinic_id, authorization_id, insurer_id, guide_type)
    REFERENCES public.hi_authorizations (clinic_id, id, insurer_id, guide_type),
  CONSTRAINT hi_sadt_requests_type_chk CHECK (guide_type = 'sp_sadt'),
  CONSTRAINT hi_sadt_requests_requester_chk CHECK (
    (requester_kind = 'internal' AND requester_professional_id IS NOT NULL AND requester_external IS NULL)
    OR (requester_kind = 'external' AND requester_professional_id IS NULL
        AND jsonb_typeof(requester_external) = 'object')
  ),
  CONSTRAINT hi_sadt_requests_care_chk CHECK (
    care_character IN ('1', '2')
    AND (care_type IS NULL OR care_type ~ '^[0-9]{2}$')
    AND (consultation_type IS NULL OR (care_type = '04' AND consultation_type ~ '^[1-4]$'))
  ),
  CONSTRAINT hi_sadt_requests_requirement_chk CHECK (
    authorization_requirement IN ('unknown', 'required', 'not_required')
  ),
  CONSTRAINT hi_sadt_requests_status_chk CHECK (status IN (
    'draft', 'checked', 'awaiting_authorization', 'authorized', 'partially_authorized', 'denied',
    'ready', 'completed', 'cancelled', 'expired'
  )),
  CONSTRAINT hi_sadt_requests_indication_chk CHECK (
    (clinical_indication_encrypted IS NULL AND clinical_indication_by IS NULL AND clinical_indication_at IS NULL)
    OR (clinical_indication_encrypted IS NOT NULL AND char_length(clinical_indication_encrypted) >= 24
        AND clinical_indication_by IS NOT NULL AND clinical_indication_at IS NOT NULL)
  ),
  CONSTRAINT hi_sadt_requests_checked_chk CHECK (
    status IN ('draft', 'cancelled')
    OR (checked_at IS NOT NULL AND checked_by IS NOT NULL AND request_number IS NOT NULL AND care_type IS NOT NULL)
  ),
  CONSTRAINT hi_sadt_requests_operator_chk CHECK (
    status NOT IN ('awaiting_authorization', 'authorized', 'partially_authorized', 'denied')
    OR (authorization_requirement = 'required' AND authorization_id IS NOT NULL)
  ),
  CONSTRAINT hi_sadt_requests_ready_chk CHECK (status <> 'ready' OR authorization_requirement = 'not_required'),
  CONSTRAINT hi_sadt_requests_cancelled_chk CHECK (
    status <> 'cancelled'
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL
        AND char_length(btrim(cancel_reason)) BETWEEN 10 AND 500)
  ),
  CONSTRAINT hi_sadt_requests_number_chk CHECK (request_number IS NULL OR request_number ~ '^[0-9A-Z]{1,20}$'),
  CONSTRAINT hi_sadt_requests_issues_chk CHECK (
    jsonb_typeof(issues) = 'array' AND jsonb_array_length(issues) <= 100
  ),
  CONSTRAINT hi_sadt_requests_note_chk CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT hi_sadt_requests_version_chk CHECK (version >= 1)
);
--> statement-breakpoint
CREATE INDEX hi_sadt_requests_clinic_status_idx ON public.hi_sadt_requests (clinic_id, status);
--> statement-breakpoint
CREATE INDEX hi_sadt_requests_patient_idx ON public.hi_sadt_requests (clinic_id, patient_id);
--> statement-breakpoint

CREATE TABLE public.hi_sadt_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  sequence integer NOT NULL,
  table_code text NOT NULL,
  procedure_code text NOT NULL,
  description text NOT NULL,
  quantity_requested integer NOT NULL,
  contract_line_id uuid,
  authorization_item_id uuid,
  status text NOT NULL DEFAULT 'active',
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_sadt_request_items_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_sadt_request_items_sequence_uniq UNIQUE (request_id, sequence),
  CONSTRAINT hi_sadt_request_items_code_uniq UNIQUE (request_id, table_code, procedure_code),
  CONSTRAINT hi_sadt_request_items_request_fk FOREIGN KEY (clinic_id, request_id)
    REFERENCES public.hi_sadt_requests (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_sadt_request_items_contract_fk FOREIGN KEY (clinic_id, contract_line_id)
    REFERENCES public.hi_procedure_contracts (clinic_id, id),
  CONSTRAINT hi_sadt_request_items_authorization_item_fk FOREIGN KEY (clinic_id, authorization_item_id)
    REFERENCES public.hi_authorization_items (clinic_id, id),
  CONSTRAINT hi_sadt_request_items_codes_chk CHECK (
    table_code ~ '^[0-9]{2}$' AND char_length(btrim(procedure_code)) BETWEEN 1 AND 10
    AND char_length(btrim(description)) BETWEEN 1 AND 150
  ),
  CONSTRAINT hi_sadt_request_items_quantity_chk CHECK (
    quantity_requested BETWEEN 1 AND 999 AND sequence BETWEEN 1 AND 99
  ),
  CONSTRAINT hi_sadt_request_items_status_chk CHECK (
    (status = 'active' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
        AND char_length(btrim(cancel_reason)) BETWEEN 10 AND 500)
  )
);
--> statement-breakpoint
CREATE INDEX hi_sadt_request_items_request_idx ON public.hi_sadt_request_items (clinic_id, request_id);
--> statement-breakpoint

CREATE TABLE public.hi_sadt_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  note text,
  created_via text NOT NULL,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_sadt_request_events_request_fk FOREIGN KEY (clinic_id, request_id)
    REFERENCES public.hi_sadt_requests (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_sadt_request_events_via_chk CHECK (
    created_via IN ('user', 'automation') AND (created_via <> 'user' OR actor_user_id IS NOT NULL)
  ),
  CONSTRAINT hi_sadt_request_events_note_chk CHECK (note IS NULL OR char_length(note) <= 500)
);
--> statement-breakpoint
CREATE INDEX hi_sadt_request_events_request_idx ON public.hi_sadt_request_events (clinic_id, request_id, created_at);
--> statement-breakpoint

-- O atendimento executa UM item da solicitação (só em cobertura SP/SADT).
ALTER TABLE public.hi_appointment_coverages ADD COLUMN sadt_request_item_id uuid;
--> statement-breakpoint
ALTER TABLE public.hi_appointment_coverages ADD CONSTRAINT hi_appointment_coverages_sadt_item_fk
  FOREIGN KEY (clinic_id, sadt_request_item_id) REFERENCES public.hi_sadt_request_items (clinic_id, id) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.hi_appointment_coverages VALIDATE CONSTRAINT hi_appointment_coverages_sadt_item_fk;
--> statement-breakpoint
ALTER TABLE public.hi_appointment_coverages ADD CONSTRAINT hi_appointment_coverages_sadt_item_chk
  CHECK (sadt_request_item_id IS NULL OR guide_type = 'sp_sadt') NOT VALID;
--> statement-breakpoint
ALTER TABLE public.hi_appointment_coverages VALIDATE CONSTRAINT hi_appointment_coverages_sadt_item_chk;
--> statement-breakpoint
CREATE INDEX hi_appointment_coverages_sadt_item_idx ON public.hi_appointment_coverages (clinic_id, sadt_request_item_id)
  WHERE sadt_request_item_id IS NOT NULL;
--> statement-breakpoint

-- Versão (concorrência otimista) e dados que não mudam depois de criada.
CREATE OR REPLACE FUNCTION public.hi_sadt_request_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.insurer_id IS DISTINCT FROM OLD.insurer_id OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
     OR NEW.requester_kind IS DISTINCT FROM OLD.requester_kind
     OR NEW.requester_professional_id IS DISTINCT FROM OLD.requester_professional_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Paciente, operadora, carteirinha, solicitante e clínica da solicitação não mudam.'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('completed', 'cancelled', 'expired') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Solicitação encerrada (%) não muda de estado.', OLD.status USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_sadt_request_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_sadt_requests_guard BEFORE UPDATE ON public.hi_sadt_requests
  FOR EACH ROW EXECUTE FUNCTION public.hi_sadt_request_guard();
--> statement-breakpoint
CREATE TRIGGER hi_aa_premium_sadt_requests BEFORE INSERT ON public.hi_sadt_requests
  FOR EACH ROW EXECUTE FUNCTION public.hi_premium_guard();
--> statement-breakpoint
CREATE TRIGGER trg_hi_sadt_request_items_updated_at BEFORE UPDATE ON public.hi_sadt_request_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER hi_sadt_request_events_immutable BEFORE UPDATE ON public.hi_sadt_request_events
  FOR EACH ROW EXECUTE FUNCTION public.hi_block_mutation();
--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_sadt_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_sadt_requests FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_sadt_requests_tenant_access ON public.hi_sadt_requests FOR ALL
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
ALTER TABLE public.hi_sadt_request_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_sadt_request_items FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_sadt_request_items_tenant_access ON public.hi_sadt_request_items FOR ALL
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
ALTER TABLE public.hi_sadt_request_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_sadt_request_events FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_sadt_request_events_tenant_access ON public.hi_sadt_request_events FOR ALL
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

REVOKE ALL ON public.hi_sadt_requests, public.hi_sadt_request_items, public.hi_sadt_request_events
  FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.hi_sadt_requests TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON public.hi_sadt_request_items TO authenticated;--> statement-breakpoint
GRANT UPDATE (contract_line_id, authorization_item_id, status, cancelled_at, cancelled_by, cancel_reason)
  ON public.hi_sadt_request_items TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON public.hi_sadt_request_events TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hi_sadt_requests, public.hi_sadt_request_items,
  public.hi_sadt_request_events TO service_role;--> statement-breakpoint
GRANT UPDATE (sadt_request_item_id) ON public.hi_appointment_coverages TO authenticated, service_role;
--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0156-hi-sadt-requests')
  ON CONFLICT DO NOTHING;
