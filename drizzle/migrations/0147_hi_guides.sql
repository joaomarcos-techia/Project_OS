-- =====================================================================
-- 0147 — Convênios (ADR-072): guias TISS. P1.8 do plano mestre.
--
-- hi_guides           guia de Consulta ou SP/SADT: número do prestador, operadora,
--                     paciente, carteirinha, autorização, profissionais, valores,
--                     estado, revisão, substituição e cancelamento
-- hi_guide_items      procedimentos executados (uma linha por sessão na SP/SADT
--                     agrupada); cada linha nasce de um valor de contrato vigente
-- hi_guide_snapshots  conteúdo emitido de cada revisão, CIFRADO por clínica, com
--                     SHA-256 (append-only)
-- hi_guide_events     histórico gravado pelo próprio banco (append-only; o runtime
--                     só lê): transição, revisão e NOMES dos campos alterados
-- hi_files            arquivos gerados (PDF da guia, XML/PDF da solicitação): só
--                     referência opaca, SHA-256 e versão TISS; bytes cifrados no
--                     armazenamento privado (D20 aprovada, seção N.7)
--
-- Regras do banco (provadas em scripts/security/health-insurance-guides-db.ts):
--  - tudo da mesma clínica por FK composta; carteirinha, plano e autorização da
--    MESMA operadora da guia (FK composta com insurer_id); autorização do mesmo
--    tipo de guia; carteirinha, autorização, guia principal e substituída do
--    MESMO paciente; atendimento da mesma clínica e do mesmo paciente (gatilho);
--  - item só a partir de valor de contrato desta operadora, deste tipo de guia,
--    deste procedimento, vigente na data e não substituído; valor unitário igual
--    ao do contrato; total = quantidade × unitário × fator (arredondado como
--    `sadtItemTotalCents`); item de autorização só da autorização da guia;
--  - sem cobrança dupla: um procedimento por atendimento entre guias vivas e uma
--    Guia de Consulta viva por atendimento. A SP/SADT agrupada (várias sessões,
--    vários atendimentos) continua permitida;
--  - número do prestador único por operadora (nunca repetido, nem em substituição)
--    e idempotência por chave de origem;
--  - estado controlado: o runtime só faz as transições editoriais (pendências,
--    conferência, aprovação, reabertura, cancelamento antes do lote); as de lote,
--    envio, retorno e substituição só por código do banco com dono (SECURITY
--    DEFINER), que chega na 0148 (P1.9). Conteúdo congela na conferência; depois,
--    só reabertura (nova revisão) ou substituição;
--  - aprovação exige snapshot da revisão atual e soma dos itens = total;
--  - substituição: a substituta em rascunho não "segura" o atendimento; ao ser
--    aprovada, a original passa a `replaced` na mesma transação;
--  - excluir paciente ou carteirinha com guia é recusado (retenção, B6); excluir a
--    clínica remove tudo em cascata.
--
-- Sem BEGIN/COMMIT. Só aditiva (os ALTER TABLE só acrescentam UNIQUE em tabelas
-- da 0144–0146, que ainda não estão aplicadas em nenhum banco persistente).
--
-- Rollback (sem dado de produção ainda):
--   DROP TABLE IF EXISTS public.hi_files, public.hi_guide_events, public.hi_guide_items,
--     public.hi_guide_snapshots, public.hi_guides CASCADE;
--   DROP FUNCTION IF EXISTS public.hi_guide_transition(), public.hi_guide_refs(),
--     public.hi_guide_apply_replacement(), public.hi_guide_record_event(),
--     public.hi_guard_guide_item(), public.hi_guard_guide_snapshot(), public.hi_guard_file();
--   ALTER TABLE public.hi_memberships DROP CONSTRAINT IF EXISTS hi_memberships_insurer_key;
--   ALTER TABLE public.hi_plans DROP CONSTRAINT IF EXISTS hi_plans_insurer_key;
--   ALTER TABLE public.hi_authorizations DROP CONSTRAINT IF EXISTS hi_authorizations_scope_key;
--   DELETE FROM public._schema_version WHERE version = '0147-hi-guides';
-- =====================================================================

-- Chaves para as FKs compostas "mesma operadora" e "mesmo tipo de guia".
ALTER TABLE public.hi_memberships ADD CONSTRAINT hi_memberships_insurer_key UNIQUE (clinic_id, id, insurer_id);
--> statement-breakpoint
ALTER TABLE public.hi_plans ADD CONSTRAINT hi_plans_insurer_key UNIQUE (clinic_id, id, insurer_id);
--> statement-breakpoint
ALTER TABLE public.hi_authorizations ADD CONSTRAINT hi_authorizations_scope_key UNIQUE (clinic_id, id, insurer_id, guide_type);
--> statement-breakpoint

CREATE TABLE public.hi_guides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  guide_type text NOT NULL,
  number text NOT NULL,
  insurer_id uuid NOT NULL,
  plan_id uuid,
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  membership_id uuid,
  authorization_id uuid,
  executant_professional_id uuid,
  requester_professional_id uuid,
  main_guide_id uuid,
  replaces_guide_id uuid,
  status text NOT NULL DEFAULT 'pending_data',
  live boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1,
  version integer NOT NULL DEFAULT 1,
  tiss_version text NOT NULL DEFAULT '4.03.00',
  terminology_version text REFERENCES public.tiss_terminology_versions (version),
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_value_cents bigint,
  total_value_cents bigint NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL,
  reviewed_at timestamptz,
  reviewed_by uuid,
  approved_snapshot_id uuid,
  approved_at timestamptz,
  approved_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  transition_note text,
  created_via text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_guides_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_guides_item_key UNIQUE (clinic_id, id, guide_type, live),
  CONSTRAINT hi_guides_scope_key UNIQUE (clinic_id, id, insurer_id, guide_type),
  CONSTRAINT hi_guides_number_uniq UNIQUE (clinic_id, insurer_id, number),
  CONSTRAINT hi_guides_idem_uniq UNIQUE (clinic_id, idempotency_key),
  CONSTRAINT hi_guides_insurer_fk FOREIGN KEY (clinic_id, insurer_id)
    REFERENCES public.hi_insurers (clinic_id, id),
  CONSTRAINT hi_guides_plan_fk FOREIGN KEY (clinic_id, plan_id, insurer_id)
    REFERENCES public.hi_plans (clinic_id, id, insurer_id),
  CONSTRAINT hi_guides_membership_fk FOREIGN KEY (clinic_id, membership_id, insurer_id)
    REFERENCES public.hi_memberships (clinic_id, id, insurer_id),
  CONSTRAINT hi_guides_authorization_fk FOREIGN KEY (clinic_id, authorization_id, insurer_id, guide_type)
    REFERENCES public.hi_authorizations (clinic_id, id, insurer_id, guide_type),
  CONSTRAINT hi_guides_main_fk FOREIGN KEY (clinic_id, main_guide_id)
    REFERENCES public.hi_guides (clinic_id, id),
  CONSTRAINT hi_guides_replaces_fk FOREIGN KEY (clinic_id, replaces_guide_id, insurer_id, guide_type)
    REFERENCES public.hi_guides (clinic_id, id, insurer_id, guide_type),
  CONSTRAINT hi_guides_type_chk CHECK (guide_type IN ('consulta', 'sp_sadt')),
  CONSTRAINT hi_guides_status_chk CHECK (status IN (
    'pending_data', 'ready_for_review', 'reviewed', 'approved', 'in_batch', 'exported', 'sent',
    'under_review', 'paid', 'partially_paid', 'partially_glossed', 'fully_glossed', 'closed',
    'cancelled', 'replaced'
  )),
  -- numeroGuiaPrestador: st_texto20 (P7.1 nunca trunca).
  CONSTRAINT hi_guides_number_chk CHECK (number ~ '^[0-9A-Z]{1,20}$'),
  CONSTRAINT hi_guides_idem_chk CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  CONSTRAINT hi_guides_tiss_version_chk CHECK (tiss_version IN ('4.03.00')),
  CONSTRAINT hi_guides_counters_chk CHECK (revision >= 1 AND version >= 1),
  -- "Viva" = segura o atendimento contra outra cobrança. A substituta só passa a
  -- segurar quando é aprovada (aí a original deixa de segurar).
  CONSTRAINT hi_guides_live_chk CHECK (live = (
    status NOT IN ('cancelled', 'replaced')
    AND NOT (replaces_guide_id IS NOT NULL AND status IN ('pending_data', 'ready_for_review', 'reviewed'))
  )),
  CONSTRAINT hi_guides_values_chk CHECK (
    total_value_cents BETWEEN 0 AND 9999999999
    AND (expected_value_cents IS NULL OR expected_value_cents BETWEEN 0 AND 9999999999)
  ),
  CONSTRAINT hi_guides_issues_chk CHECK (
    jsonb_typeof(issues) = 'array' AND jsonb_array_length(issues) <= 100
    AND (status IN ('pending_data', 'cancelled') OR issues = '[]'::jsonb)
  ),
  CONSTRAINT hi_guides_reviewed_chk CHECK (
    status NOT IN ('reviewed', 'approved', 'in_batch', 'exported', 'sent', 'under_review', 'paid',
      'partially_paid', 'partially_glossed', 'fully_glossed', 'closed', 'replaced')
    OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND membership_id IS NOT NULL
        AND executant_professional_id IS NOT NULL)
  ),
  CONSTRAINT hi_guides_approved_chk CHECK (
    status NOT IN ('approved', 'in_batch', 'exported', 'sent', 'under_review', 'paid',
      'partially_paid', 'partially_glossed', 'fully_glossed', 'closed', 'replaced')
    OR (approved_at IS NOT NULL AND approved_by IS NOT NULL AND approved_snapshot_id IS NOT NULL
        AND terminology_version IS NOT NULL)
  ),
  CONSTRAINT hi_guides_cancelled_chk CHECK (
    status <> 'cancelled'
    -- `cancel_reason IS NOT NULL` explícito: char_length(NULL) daria NULL e o CHECK passaria.
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL
        AND char_length(btrim(cancel_reason)) BETWEEN 10 AND 500)
  ),
  CONSTRAINT hi_guides_note_chk CHECK (transition_note IS NULL OR char_length(transition_note) <= 500),
  CONSTRAINT hi_guides_main_chk CHECK (
    main_guide_id IS NULL OR (guide_type = 'sp_sadt' AND main_guide_id <> id)
  ),
  CONSTRAINT hi_guides_replaces_chk CHECK (replaces_guide_id IS NULL OR replaces_guide_id <> id),
  CONSTRAINT hi_guides_created_chk CHECK (
    created_via IN ('user', 'automation') AND (created_via <> 'user' OR created_by IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX hi_guides_status_idx ON public.hi_guides (clinic_id, status);
--> statement-breakpoint
CREATE INDEX hi_guides_patient_idx ON public.hi_guides (clinic_id, patient_id);
--> statement-breakpoint
CREATE INDEX hi_guides_insurer_idx ON public.hi_guides (clinic_id, insurer_id, status);
--> statement-breakpoint
CREATE INDEX hi_guides_authorization_idx ON public.hi_guides (clinic_id, authorization_id) WHERE authorization_id IS NOT NULL;
--> statement-breakpoint
-- Uma substituição em andamento (ou concluída) por guia.
CREATE UNIQUE INDEX hi_guides_replaces_uniq ON public.hi_guides (replaces_guide_id)
  WHERE replaces_guide_id IS NOT NULL AND status <> 'cancelled';
--> statement-breakpoint

CREATE TABLE public.hi_guide_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  guide_id uuid NOT NULL,
  revision integer NOT NULL,
  content_encrypted text NOT NULL,
  content_sha256 text NOT NULL,
  tiss_version text NOT NULL,
  terminology_version text NOT NULL REFERENCES public.tiss_terminology_versions (version),
  created_via text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_guide_snapshots_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_guide_snapshots_guide_key UNIQUE (clinic_id, guide_id, id),
  CONSTRAINT hi_guide_snapshots_revision_uniq UNIQUE (guide_id, revision),
  CONSTRAINT hi_guide_snapshots_guide_fk FOREIGN KEY (clinic_id, guide_id)
    REFERENCES public.hi_guides (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_guide_snapshots_revision_chk CHECK (revision >= 1),
  CONSTRAINT hi_guide_snapshots_cipher_chk CHECK (char_length(content_encrypted) >= 24),
  CONSTRAINT hi_guide_snapshots_sha_chk CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT hi_guide_snapshots_tiss_chk CHECK (tiss_version IN ('4.03.00')),
  CONSTRAINT hi_guide_snapshots_created_chk CHECK (
    created_via IN ('user', 'automation') AND (created_via <> 'user' OR created_by IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE public.hi_guides ADD CONSTRAINT hi_guides_snapshot_fk FOREIGN KEY (clinic_id, id, approved_snapshot_id)
  REFERENCES public.hi_guide_snapshots (clinic_id, guide_id, id);
--> statement-breakpoint

CREATE TABLE public.hi_guide_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  guide_id uuid NOT NULL,
  -- Espelhos da guia (mantidos pela FK com ON UPDATE CASCADE e pelo gatilho):
  -- deixam os UNIQUE "sem cobrança dupla" declarativos.
  guide_type text NOT NULL,
  live boolean NOT NULL,
  sequence integer NOT NULL,
  appointment_id uuid REFERENCES public.appointments(id),
  contract_line_id uuid NOT NULL,
  authorization_item_id uuid,
  executed_on date NOT NULL,
  start_time time,
  end_time time,
  table_code text NOT NULL,
  procedure_code text NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL,
  access_route text,
  technique text,
  factor_hundredths integer NOT NULL DEFAULT 100,
  unit_value_cents bigint NOT NULL,
  total_value_cents bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_guide_items_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_guide_items_guide_fk FOREIGN KEY (clinic_id, guide_id, guide_type, live)
    REFERENCES public.hi_guides (clinic_id, id, guide_type, live) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT hi_guide_items_contract_fk FOREIGN KEY (clinic_id, contract_line_id)
    REFERENCES public.hi_procedure_contracts (clinic_id, id),
  CONSTRAINT hi_guide_items_authorization_item_fk FOREIGN KEY (clinic_id, authorization_item_id)
    REFERENCES public.hi_authorization_items (clinic_id, id),
  CONSTRAINT hi_guide_items_sequence_uniq UNIQUE (guide_id, sequence),
  -- sequencialItem: st_numerico4. A Guia de Consulta tem um procedimento só.
  CONSTRAINT hi_guide_items_sequence_chk CHECK (
    sequence BETWEEN 1 AND 9999 AND (guide_type <> 'consulta' OR sequence = 1)
  ),
  CONSTRAINT hi_guide_items_codes_chk CHECK (
    table_code ~ '^[0-9]{2}$' AND char_length(btrim(procedure_code)) BETWEEN 1 AND 10
    AND char_length(btrim(description)) BETWEEN 1 AND 150
    AND (access_route IS NULL OR access_route ~ '^[0-9]{1,2}$')
    AND (technique IS NULL OR technique ~ '^[0-9]{1,2}$')
  ),
  CONSTRAINT hi_guide_items_times_chk CHECK (
    start_time IS NULL OR end_time IS NULL OR end_time >= start_time
  ),
  CONSTRAINT hi_guide_items_values_chk CHECK (
    quantity BETWEEN 1 AND 999
    AND factor_hundredths BETWEEN 0 AND 999
    AND unit_value_cents BETWEEN 0 AND 9999999999
    -- mesma conta de sadtItemTotalCents: piso((q × unitário × fator + 50) / 100)
    AND total_value_cents = (quantity::bigint * unit_value_cents * factor_hundredths + 50) / 100
  )
);
--> statement-breakpoint
CREATE INDEX hi_guide_items_guide_idx ON public.hi_guide_items (clinic_id, guide_id);
--> statement-breakpoint
CREATE INDEX hi_guide_items_appointment_idx ON public.hi_guide_items (clinic_id, appointment_id) WHERE appointment_id IS NOT NULL;
--> statement-breakpoint
-- Sem cobrança dupla: o mesmo procedimento do mesmo atendimento em uma guia viva só.
CREATE UNIQUE INDEX hi_guide_items_live_billing_uniq
  ON public.hi_guide_items (clinic_id, appointment_id, table_code, procedure_code)
  WHERE live AND appointment_id IS NOT NULL;
--> statement-breakpoint
-- Uma Guia de Consulta viva por atendimento (a SP/SADT agrupada não entra aqui).
CREATE UNIQUE INDEX hi_guide_items_live_consulta_uniq
  ON public.hi_guide_items (clinic_id, appointment_id)
  WHERE live AND guide_type = 'consulta' AND appointment_id IS NOT NULL;
--> statement-breakpoint

CREATE TABLE public.hi_guide_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  guide_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  revision integer NOT NULL,
  changed_fields text[] NOT NULL DEFAULT '{}',
  actor_id uuid,
  actor_kind text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_guide_events_guide_fk FOREIGN KEY (clinic_id, guide_id)
    REFERENCES public.hi_guides (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_guide_events_actor_chk CHECK (actor_kind IN ('user', 'system')),
  CONSTRAINT hi_guide_events_note_chk CHECK (note IS NULL OR char_length(note) <= 500)
);
--> statement-breakpoint
CREATE INDEX hi_guide_events_idx ON public.hi_guide_events (clinic_id, guide_id, created_at);
--> statement-breakpoint

CREATE TABLE public.hi_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  kind text NOT NULL,
  guide_id uuid,
  snapshot_id uuid,
  authorization_id uuid,
  supersedes_file_id uuid,
  storage_ref text NOT NULL,
  content_sha256 text NOT NULL,
  ciphertext_sha256 text NOT NULL,
  size_bytes integer NOT NULL,
  media_type text NOT NULL,
  tiss_version text NOT NULL,
  created_via text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_files_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_files_guide_fk FOREIGN KEY (clinic_id, guide_id)
    REFERENCES public.hi_guides (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_files_snapshot_fk FOREIGN KEY (clinic_id, guide_id, snapshot_id)
    REFERENCES public.hi_guide_snapshots (clinic_id, guide_id, id),
  CONSTRAINT hi_files_authorization_fk FOREIGN KEY (clinic_id, authorization_id)
    REFERENCES public.hi_authorizations (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_files_supersedes_fk FOREIGN KEY (clinic_id, supersedes_file_id)
    REFERENCES public.hi_files (clinic_id, id),
  CONSTRAINT hi_files_ref_uniq UNIQUE (storage_ref),
  -- Versão nova de um arquivo substitui UMA anterior (cadeia linear, sem sobrescrita).
  CONSTRAINT hi_files_supersedes_uniq UNIQUE (supersedes_file_id),
  -- Lote, recurso e demonstrativo entram na 0148 (P1.9), com as FKs deles.
  CONSTRAINT hi_files_kind_chk CHECK (kind IN ('guide_pdf', 'authorization_request_xml', 'authorization_request_pdf')),
  CONSTRAINT hi_files_link_chk CHECK (
    (kind = 'guide_pdf' AND guide_id IS NOT NULL AND snapshot_id IS NOT NULL AND authorization_id IS NULL)
    OR (kind IN ('authorization_request_xml', 'authorization_request_pdf')
        AND authorization_id IS NOT NULL AND guide_id IS NULL AND snapshot_id IS NULL)
  ),
  CONSTRAINT hi_files_ref_chk CHECK (storage_ref ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  CONSTRAINT hi_files_sha_chk CHECK (content_sha256 ~ '^[0-9a-f]{64}$' AND ciphertext_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT hi_files_size_chk CHECK (size_bytes BETWEEN 1 AND 20971520),
  CONSTRAINT hi_files_media_chk CHECK (
    (kind IN ('guide_pdf', 'authorization_request_pdf') AND media_type = 'application/pdf')
    OR (kind = 'authorization_request_xml' AND media_type = 'application/xml')
  ),
  CONSTRAINT hi_files_tiss_chk CHECK (tiss_version IN ('4.03.00')),
  CONSTRAINT hi_files_not_self_chk CHECK (supersedes_file_id IS NULL OR supersedes_file_id <> id),
  CONSTRAINT hi_files_created_chk CHECK (
    created_via IN ('user', 'automation') AND (created_via <> 'user' OR created_by IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX hi_files_guide_idx ON public.hi_files (clinic_id, guide_id) WHERE guide_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX hi_files_authorization_idx ON public.hi_files (clinic_id, authorization_id) WHERE authorization_id IS NOT NULL;
--> statement-breakpoint

-- ── Estado da guia ─────────────────────────────────────────────────────
-- SECURITY INVOKER de propósito: `current_user` distingue o runtime
-- (`authenticated`) do código do banco com dono (funções SECURITY DEFINER do
-- lote, do retorno e da substituição), que é o único que faz as transições
-- que não são editoriais.
CREATE OR REPLACE FUNCTION public.hi_guide_transition() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_owner boolean;
  v_pair text;
  v_items integer;
  v_sum bigint;
  v_snapshot_revision integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('pending_data', 'ready_for_review') THEN
      RAISE EXCEPTION 'Guia nasce em edição (pendências ou pronta para conferência).' USING ERRCODE = '23514';
    END IF;
    IF NEW.approved_snapshot_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.approved_at IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Guia nova não traz conferência, aprovação nem cancelamento.' USING ERRCODE = '23514';
    END IF;
    NEW.revision := 1;
    NEW.version := 1;
    NEW.live := NEW.status NOT IN ('cancelled', 'replaced')
      AND NOT (NEW.replaces_guide_id IS NOT NULL AND NEW.status IN ('pending_data', 'ready_for_review', 'reviewed'));
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
     OR NEW.guide_type IS DISTINCT FROM OLD.guide_type OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.insurer_id IS DISTINCT FROM OLD.insurer_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.replaces_guide_id IS DISTINCT FROM OLD.replaces_guide_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.tiss_version IS DISTINCT FROM OLD.tiss_version
     OR NEW.created_via IS DISTINCT FROM OLD.created_via OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Tipo, número, operadora, paciente, origem e substituída da guia não mudam.' USING ERRCODE = '55000';
  END IF;

  -- Conteúdo só muda em edição; depois da conferência, só reabertura ou substituição.
  IF OLD.status NOT IN ('pending_data', 'ready_for_review') AND (
       NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
       OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id
       OR NEW.executant_professional_id IS DISTINCT FROM OLD.executant_professional_id
       OR NEW.requester_professional_id IS DISTINCT FROM OLD.requester_professional_id
       OR NEW.main_guide_id IS DISTINCT FROM OLD.main_guide_id
       OR NEW.terminology_version IS DISTINCT FROM OLD.terminology_version
       OR NEW.issues IS DISTINCT FROM OLD.issues
       OR NEW.expected_value_cents IS DISTINCT FROM OLD.expected_value_cents
       OR NEW.total_value_cents IS DISTINCT FROM OLD.total_value_cents) THEN
    RAISE EXCEPTION 'Guia conferida não se edita: reabra (nova revisão) ou substitua.' USING ERRCODE = '55000';
  END IF;

  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  IF NEW.transition_note IS NOT DISTINCT FROM OLD.transition_note THEN
    NEW.transition_note := NULL; -- a nota vale para uma transição só
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT current_user = pg_get_userbyid(c.relowner) INTO v_owner FROM pg_class c WHERE c.oid = TG_RELID;
    v_pair := OLD.status || '>' || NEW.status;

    IF v_pair IN (
      'pending_data>ready_for_review', 'ready_for_review>pending_data', 'ready_for_review>reviewed',
      'reviewed>ready_for_review', 'reviewed>pending_data', 'reviewed>approved', 'approved>ready_for_review',
      'pending_data>cancelled', 'ready_for_review>cancelled', 'reviewed>cancelled', 'approved>cancelled'
    ) THEN
      NULL; -- transição editorial: runtime e dono
    ELSIF v_owner AND (
      v_pair IN ('approved>in_batch', 'in_batch>approved', 'in_batch>exported', 'exported>approved',
                 'exported>sent', 'sent>under_review')
      OR (OLD.status IN ('sent', 'under_review', 'paid', 'partially_paid', 'partially_glossed', 'fully_glossed')
          AND NEW.status IN ('paid', 'partially_paid', 'partially_glossed', 'fully_glossed'))
      OR (OLD.status IN ('paid', 'partially_paid', 'partially_glossed', 'fully_glossed') AND NEW.status = 'closed')
      OR (OLD.status IN ('exported', 'sent', 'under_review') AND NEW.status = 'replaced')
    ) THEN
      NULL; -- transição do lote, do retorno ou da substituição: só código do banco com dono
    ELSE
      RAISE EXCEPTION 'Transição de guia não permitida: % → %.', OLD.status, NEW.status USING ERRCODE = '55000';
    END IF;

    IF NEW.status = 'replaced' AND NOT EXISTS (
      SELECT 1 FROM public.hi_guides s
       WHERE s.clinic_id = NEW.clinic_id AND s.replaces_guide_id = NEW.id AND s.status <> 'cancelled'
    ) THEN
      RAISE EXCEPTION 'Guia só fica "substituída" com uma substituta.' USING ERRCODE = '55000';
    END IF;

    -- Os horários são do banco, não do cliente.
    IF NEW.status = 'cancelled' THEN
      NEW.cancelled_at := now();
    ELSIF NEW.status = 'reviewed' THEN
      NEW.reviewed_at := now();
    ELSIF NEW.status = 'approved' AND OLD.status = 'reviewed' THEN
      NEW.approved_at := now();
    END IF;

    -- Reabertura: nova revisão; a conferência e a aprovação anteriores ficam nos snapshots e no histórico.
    IF v_pair = 'approved>ready_for_review' THEN
      IF NEW.transition_note IS NULL OR char_length(btrim(NEW.transition_note)) < 10 THEN
        RAISE EXCEPTION 'Reabrir a guia exige o motivo (10 a 500 caracteres).' USING ERRCODE = '23514';
      END IF;
      NEW.revision := OLD.revision + 1;
      NEW.reviewed_at := NULL; NEW.reviewed_by := NULL;
      NEW.approved_snapshot_id := NULL; NEW.approved_at := NULL; NEW.approved_by := NULL;
    ELSIF v_pair IN ('reviewed>ready_for_review', 'reviewed>pending_data') THEN
      NEW.reviewed_at := NULL; NEW.reviewed_by := NULL;
    END IF;

    IF NEW.status IN ('reviewed', 'approved') AND OLD.status IN ('ready_for_review', 'reviewed') THEN
      SELECT count(*), coalesce(sum(total_value_cents), 0) INTO v_items, v_sum
        FROM public.hi_guide_items WHERE clinic_id = NEW.clinic_id AND guide_id = NEW.id;
      IF v_items = 0 OR v_sum <> NEW.total_value_cents THEN
        RAISE EXCEPTION 'Guia sem itens ou com total (%) diferente da soma dos itens (%).', NEW.total_value_cents, v_sum
          USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW.status = 'approved' AND OLD.status = 'reviewed' THEN
      SELECT revision INTO v_snapshot_revision FROM public.hi_guide_snapshots
       WHERE clinic_id = NEW.clinic_id AND guide_id = NEW.id AND id = NEW.approved_snapshot_id;
      IF v_snapshot_revision IS DISTINCT FROM NEW.revision THEN
        RAISE EXCEPTION 'A aprovação exige o snapshot da revisão atual (%).', NEW.revision USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF NEW.approved_snapshot_id IS DISTINCT FROM OLD.approved_snapshot_id
        OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
        OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
        OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
        OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason THEN
    RAISE EXCEPTION 'Conferência, aprovação e cancelamento só mudam junto com o estado.' USING ERRCODE = '55000';
  END IF;

  NEW.live := NEW.status NOT IN ('cancelled', 'replaced')
    AND NOT (NEW.replaces_guide_id IS NOT NULL AND NEW.status IN ('pending_data', 'ready_for_review', 'reviewed'));
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guide_transition() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_guides_a_transition BEFORE INSERT OR UPDATE ON public.hi_guides
  FOR EACH ROW EXECUTE FUNCTION public.hi_guide_transition();
--> statement-breakpoint

-- ── Referências da guia (paciente, carteirinha, autorização, profissionais) ──
CREATE OR REPLACE FUNCTION public.hi_guide_refs() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_other public.hi_guides%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM public.patients p WHERE p.id = NEW.patient_id AND p.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Paciente não pertence à clínica.' USING ERRCODE = '23503';
  END IF;
  IF NEW.membership_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.membership_id IS DISTINCT FROM OLD.membership_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.hi_memberships m
        WHERE m.id = NEW.membership_id AND m.clinic_id = NEW.clinic_id AND m.patient_id = NEW.patient_id
     ) THEN
    RAISE EXCEPTION 'A carteirinha deve ser do paciente da guia.' USING ERRCODE = '23514';
  END IF;
  IF NEW.authorization_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.hi_authorizations a
        JOIN public.hi_memberships m ON m.id = a.membership_id AND m.clinic_id = a.clinic_id
       WHERE a.id = NEW.authorization_id AND a.clinic_id = NEW.clinic_id AND m.patient_id = NEW.patient_id
    ) THEN
      RAISE EXCEPTION 'A autorização deve ser do paciente da guia.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.authorization_id IS DISTINCT FROM OLD.authorization_id AND EXISTS (
    SELECT 1 FROM public.hi_guide_items i
      JOIN public.hi_authorization_items ai ON ai.id = i.authorization_item_id AND ai.clinic_id = i.clinic_id
     WHERE i.clinic_id = NEW.clinic_id AND i.guide_id = NEW.id
       AND ai.authorization_id IS DISTINCT FROM NEW.authorization_id
  ) THEN
    RAISE EXCEPTION 'Há itens ligados à autorização anterior; ajuste os itens antes.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.plan_id IS DISTINCT FROM OLD.plan_id AND EXISTS (
    SELECT 1 FROM public.hi_guide_items i
      JOIN public.hi_procedure_contracts c ON c.id = i.contract_line_id AND c.clinic_id = i.clinic_id
     WHERE i.clinic_id = NEW.clinic_id AND i.guide_id = NEW.id
       AND c.plan_id IS NOT NULL AND c.plan_id IS DISTINCT FROM NEW.plan_id
  ) THEN
    RAISE EXCEPTION 'Há itens com valor de contrato de outro plano; ajuste os itens antes.' USING ERRCODE = '23514';
  END IF;
  IF NEW.executant_professional_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.executant_professional_id IS DISTINCT FROM OLD.executant_professional_id)
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.executant_professional_id AND p.clinic_id = NEW.clinic_id) THEN
    RAISE EXCEPTION 'Profissional executante não pertence à clínica.' USING ERRCODE = '23503';
  END IF;
  IF NEW.requester_professional_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.requester_professional_id IS DISTINCT FROM OLD.requester_professional_id)
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.requester_professional_id AND p.clinic_id = NEW.clinic_id) THEN
    RAISE EXCEPTION 'Profissional solicitante não pertence à clínica.' USING ERRCODE = '23503';
  END IF;
  IF NEW.main_guide_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.main_guide_id IS DISTINCT FROM OLD.main_guide_id) THEN
    SELECT * INTO v_other FROM public.hi_guides WHERE id = NEW.main_guide_id AND clinic_id = NEW.clinic_id;
    IF v_other.patient_id IS DISTINCT FROM NEW.patient_id OR v_other.insurer_id IS DISTINCT FROM NEW.insurer_id THEN
      RAISE EXCEPTION 'A guia principal deve ser do mesmo paciente e da mesma operadora.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.replaces_guide_id IS NOT NULL THEN
    SELECT * INTO v_other FROM public.hi_guides WHERE id = NEW.replaces_guide_id AND clinic_id = NEW.clinic_id;
    IF v_other.patient_id IS DISTINCT FROM NEW.patient_id THEN
      RAISE EXCEPTION 'A substituta deve ser do mesmo paciente.' USING ERRCODE = '23514';
    END IF;
    IF v_other.status NOT IN ('exported', 'sent', 'under_review') THEN
      RAISE EXCEPTION 'Só se substitui guia exportada, enviada ou em análise (estado atual: %); antes disso, reabra; depois do resultado, use recurso de glosa.',
        v_other.status USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guide_refs() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_guides_b_refs BEFORE INSERT OR UPDATE ON public.hi_guides
  FOR EACH ROW EXECUTE FUNCTION public.hi_guide_refs();
--> statement-breakpoint

-- ── Substituição: aprovar a substituta encerra a original na mesma transação ──
CREATE OR REPLACE FUNCTION public.hi_guide_apply_replacement() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.replaces_guide_id IS NOT NULL AND OLD.status = 'reviewed' AND NEW.status = 'approved' THEN
    SELECT status INTO v_status FROM public.hi_guides
     WHERE id = NEW.replaces_guide_id AND clinic_id = NEW.clinic_id FOR UPDATE;
    IF v_status IS NULL OR v_status NOT IN ('exported', 'sent', 'under_review') THEN
      RAISE EXCEPTION 'A guia original não pode mais ser substituída (estado atual: %).', v_status USING ERRCODE = '55000';
    END IF;
    UPDATE public.hi_guides SET status = 'replaced'
     WHERE id = NEW.replaces_guide_id AND clinic_id = NEW.clinic_id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guide_apply_replacement() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_guides_c_replacement BEFORE UPDATE ON public.hi_guides
  FOR EACH ROW EXECUTE FUNCTION public.hi_guide_apply_replacement();
--> statement-breakpoint

-- ── Histórico gravado pelo banco (o runtime não escreve nem altera) ──────
CREATE OR REPLACE FUNCTION public.hi_guide_record_event() RETURNS trigger
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
     WHERE n.key NOT IN ('version', 'updated_at', 'live', 'transition_note')
       AND n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);
    IF NEW.status IS NOT DISTINCT FROM OLD.status AND cardinality(v_changed) = 0 THEN
      RETURN NULL;
    END IF;
  END IF;
  INSERT INTO public.hi_guide_events
    (clinic_id, guide_id, from_status, to_status, revision, changed_fields, actor_id, actor_kind, note)
  VALUES (NEW.clinic_id, NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status, NEW.revision,
          v_changed, v_actor, CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END, NEW.transition_note);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guide_record_event() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_guides_z_event AFTER INSERT OR UPDATE ON public.hi_guides
  FOR EACH ROW EXECUTE FUNCTION public.hi_guide_record_event();
--> statement-breakpoint

-- ── Itens: só com a guia em edição, do contrato vigente e do mesmo paciente ──
CREATE OR REPLACE FUNCTION public.hi_guard_guide_item() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public.hi_guide_items%ROWTYPE;
  v_guide public.hi_guides%ROWTYPE;
  v_contract public.hi_procedure_contracts%ROWTYPE;
  v_auth_item public.hi_authorization_items%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  -- Exclusão em cascata (FK da clínica ou da guia roda dentro de um gatilho): aceita.
  -- O runtime chama DELETE direto (profundidade 1) e cai na regra de edição abaixo.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  -- Espelho de `live` propagado pela FK (ON UPDATE CASCADE): sempre aceito.
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'live' - 'updated_at') = (to_jsonb(OLD) - 'live' - 'updated_at') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_guide FROM public.hi_guides WHERE id = v_row.guide_id AND clinic_id = v_row.clinic_id;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; -- guia sendo removida em cascata (exclusão da clínica)
    RAISE EXCEPTION 'Guia inexistente nesta clínica.' USING ERRCODE = '23503';
  END IF;
  IF v_guide.status NOT IN ('pending_data', 'ready_for_review') THEN
    RAISE EXCEPTION 'Itens só mudam com a guia em edição (estado atual: %).', v_guide.status USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND NEW.guide_id IS DISTINCT FROM OLD.guide_id THEN
    RAISE EXCEPTION 'Item não muda de guia.' USING ERRCODE = '55000';
  END IF;
  NEW.guide_type := v_guide.guide_type;
  NEW.live := v_guide.live;
  NEW.updated_at := now();

  SELECT * INTO v_contract FROM public.hi_procedure_contracts
   WHERE id = NEW.contract_line_id AND clinic_id = NEW.clinic_id;
  IF NOT FOUND OR v_contract.insurer_id <> v_guide.insurer_id OR v_contract.guide_type <> v_guide.guide_type
     OR (v_contract.plan_id IS NOT NULL AND v_contract.plan_id IS DISTINCT FROM v_guide.plan_id)
     OR v_contract.table_code <> NEW.table_code OR v_contract.procedure_code <> NEW.procedure_code THEN
    RAISE EXCEPTION 'O item deve usar um valor de contrato desta operadora, deste tipo de guia, deste plano e do mesmo procedimento.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.executed_on < v_contract.valid_from OR (v_contract.valid_until IS NOT NULL AND NEW.executed_on > v_contract.valid_until) THEN
    RAISE EXCEPTION 'O valor de contrato não está vigente na data do item.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hi_procedure_contracts s
              WHERE s.clinic_id = NEW.clinic_id AND s.supersedes_id = v_contract.id) THEN
    RAISE EXCEPTION 'O valor de contrato foi substituído; use a versão nova.' USING ERRCODE = '23514';
  END IF;
  IF NEW.unit_value_cents <> v_contract.unit_value_cents THEN
    RAISE EXCEPTION 'O valor unitário do item difere do contrato.' USING ERRCODE = '23514';
  END IF;

  IF NEW.authorization_item_id IS NOT NULL THEN
    SELECT * INTO v_auth_item FROM public.hi_authorization_items
     WHERE id = NEW.authorization_item_id AND clinic_id = NEW.clinic_id;
    IF NOT FOUND OR v_guide.authorization_id IS NULL OR v_auth_item.authorization_id <> v_guide.authorization_id
       OR v_auth_item.table_code <> NEW.table_code OR v_auth_item.procedure_code <> NEW.procedure_code THEN
      RAISE EXCEPTION 'O item de autorização deve ser da autorização da guia e do mesmo procedimento.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.appointments ap
     WHERE ap.id = NEW.appointment_id AND ap.clinic_id = NEW.clinic_id AND ap.patient_id = v_guide.patient_id
  ) THEN
    RAISE EXCEPTION 'O atendimento deve ser da mesma clínica e do mesmo paciente da guia.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guard_guide_item() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_guide_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hi_guide_items
  FOR EACH ROW EXECUTE FUNCTION public.hi_guard_guide_item();
--> statement-breakpoint

-- ── Snapshot: só da revisão atual, com a guia conferida ──────────────────
CREATE OR REPLACE FUNCTION public.hi_guard_guide_snapshot() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_guide public.hi_guides%ROWTYPE;
BEGIN
  SELECT * INTO v_guide FROM public.hi_guides WHERE id = NEW.guide_id AND clinic_id = NEW.clinic_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guia inexistente nesta clínica.' USING ERRCODE = '23503';
  END IF;
  IF v_guide.status <> 'reviewed' OR NEW.revision <> v_guide.revision OR NEW.tiss_version <> v_guide.tiss_version THEN
    RAISE EXCEPTION 'Snapshot só da guia conferida, na revisão atual (%) e na versão TISS dela.', v_guide.revision
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guard_guide_snapshot() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_guide_snapshots_guard BEFORE INSERT ON public.hi_guide_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.hi_guard_guide_snapshot();
--> statement-breakpoint

-- ── Arquivo: PDF só de guia aprovada; versão nova da mesma origem e do mesmo tipo ──
CREATE OR REPLACE FUNCTION public.hi_guard_file() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_status text;
  v_prev public.hi_files%ROWTYPE;
BEGIN
  IF NEW.kind = 'guide_pdf' THEN
    SELECT status INTO v_status FROM public.hi_guides WHERE id = NEW.guide_id AND clinic_id = NEW.clinic_id;
    IF v_status IS NULL OR v_status IN ('pending_data', 'ready_for_review', 'reviewed', 'cancelled') THEN
      RAISE EXCEPTION 'PDF oficial só de guia aprovada (estado atual: %).', v_status USING ERRCODE = '55000';
    END IF;
  END IF;
  IF NEW.supersedes_file_id IS NOT NULL THEN
    SELECT * INTO v_prev FROM public.hi_files WHERE id = NEW.supersedes_file_id AND clinic_id = NEW.clinic_id;
    IF v_prev.kind IS DISTINCT FROM NEW.kind OR v_prev.guide_id IS DISTINCT FROM NEW.guide_id
       OR v_prev.authorization_id IS DISTINCT FROM NEW.authorization_id THEN
      RAISE EXCEPTION 'A versão nova deve ser do mesmo tipo e da mesma origem do arquivo anterior.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guard_file() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_files_guard BEFORE INSERT ON public.hi_files
  FOR EACH ROW EXECUTE FUNCTION public.hi_guard_file();
--> statement-breakpoint

-- Append-only: snapshot, histórico e arquivo (hi_block_mutation é da 0146).
CREATE TRIGGER hi_guide_snapshots_immutable BEFORE UPDATE ON public.hi_guide_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.hi_block_mutation();
--> statement-breakpoint
CREATE TRIGGER hi_guide_events_immutable BEFORE UPDATE ON public.hi_guide_events
  FOR EACH ROW EXECUTE FUNCTION public.hi_block_mutation();
--> statement-breakpoint
CREATE TRIGGER hi_files_immutable BEFORE UPDATE ON public.hi_files
  FOR EACH ROW EXECUTE FUNCTION public.hi_block_mutation();
--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_guides ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_guides FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_guides_tenant_access ON public.hi_guides FOR ALL
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
ALTER TABLE public.hi_guide_snapshots ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_guide_snapshots FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_guide_snapshots_tenant_access ON public.hi_guide_snapshots FOR ALL
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
ALTER TABLE public.hi_guide_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_guide_items FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_guide_items_tenant_access ON public.hi_guide_items FOR ALL
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
ALTER TABLE public.hi_guide_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_guide_events FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_guide_events_tenant_access ON public.hi_guide_events FOR ALL
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
ALTER TABLE public.hi_files ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_files FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_files_tenant_access ON public.hi_files FOR ALL
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

-- Runtime: guia com SELECT/INSERT e UPDATE só nas colunas editáveis; itens com
-- SELECT/INSERT/DELETE (o gatilho só deixa mexer com a guia em edição) e UPDATE
-- só no conteúdo; snapshot e arquivo só SELECT/INSERT; histórico SÓ SELECT (quem
-- grava é o gatilho). DELETE de guia, snapshot, histórico e arquivo: nunca.
REVOKE ALL ON public.hi_guides, public.hi_guide_snapshots, public.hi_guide_items, public.hi_guide_events,
  public.hi_files FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT ON public.hi_guides TO authenticated, service_role;--> statement-breakpoint
GRANT UPDATE (status, plan_id, membership_id, authorization_id, executant_professional_id,
  requester_professional_id, main_guide_id, terminology_version, issues, expected_value_cents,
  total_value_cents, reviewed_by, approved_snapshot_id, approved_by,
  cancelled_by, cancel_reason, transition_note) ON public.hi_guides TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.hi_guide_items TO authenticated, service_role;--> statement-breakpoint
GRANT UPDATE (appointment_id, contract_line_id, authorization_item_id, executed_on, start_time, end_time,
  table_code, procedure_code, description, quantity, access_route, technique, factor_hundredths,
  unit_value_cents, total_value_cents) ON public.hi_guide_items TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT ON public.hi_guide_snapshots, public.hi_files TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT ON public.hi_guide_events TO authenticated, service_role;--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0147-hi-guides')
  ON CONFLICT DO NOTHING;
