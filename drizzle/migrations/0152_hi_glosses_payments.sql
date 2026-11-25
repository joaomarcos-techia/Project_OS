-- =====================================================================
-- 0152 — Convênios (ADR-072): glosas, recursos de glosa, pagamentos da operadora
-- e a conta de cada guia (P1.9, P9.6, P9.7, P9.8). Também alinha a decisão
-- comercial (D24) ao período pago e à carência do PR #53 (sem carência ilimitada).
--
-- hi_glosses              glosa por guia ou item: código da tabela 38, valor, origem
--                         (manual ou demonstrativo, idempotente) e os 6 estados:
--                           informed → under_analysis → contested → appeal_filed
--                           → reversed | definitive
--                         (informed/under_analysis/contested também vão direto a
--                         definitive — a clínica aceita — ou a reversed — a operadora
--                         reverte). Só `definitive` reduz o que a operadora deve;
--                         nenhum outro estado é perda.
-- hi_gloss_appeals        recurso: guia, lote, glosas recorridas e valores, justificativa
--                         de uma PESSOA (nunca gerada), XML oficial (hi_files), protocolo
--                         ou evidência do envio, resposta da operadora (aceito, parcial,
--                         negado) que decide cada glosa.
-- hi_gloss_appeal_items   glosa no recurso (uma glosa em um recurso ativo só).
-- hi_payments             pagamento da operadora (demonstrativo ou registro manual):
--                         data, valor, identificador do demonstrativo, idempotente.
-- hi_payment_allocations  quanto do pagamento vai para cada guia ou item; estorno por
--                         lançamento compensatório (nunca UPDATE/DELETE).
-- hi_account_events       histórico do ciclo financeiro da guia (sem dado pessoal).
-- hi_guide_accounts       visão: faturado, pago, glosa em aberto, glosa definitiva,
--                         revertida e pendente (= faturado − pago − definitiva).
-- hi_payment_balances     visão: valor do pagamento, alocado e não conciliado.
--
-- Regras do banco (cada uma com prova no harness de glosas e pagamentos):
--  - Sem dupla contagem: pago + glosa em aberto + glosa definitiva ≤ faturado, por
--    guia e por item, conferido com a guia travada (FOR UPDATE).
--  - Pagamento parcial nunca quita: a guia só fica "paga" com pago = faturado, e só é
--    ENCERRADA (conciliada) por uma pessoa, com pendente = 0 e nada em aberto.
--  - Retorno repetido não aplica 2x: chave de idempotência e demonstrativo único por
--    operadora.
--  - Nada se apaga: estorno de pagamento é lançamento compensatório; glosa decidida
--    não volta; histórico só de inclusão.
--  - Glosa, pagamento e recurso são PRESERVAÇÃO de obrigação já faturada (D24, seção 7
--    da orientação): seguem disponíveis com a assinatura suspensa. O XML do recurso
--    deixa de ser "operação nova" no gatilho comercial.
--  - A ponte com o livro financeiro da clínica (`lancamentos`/`write_off`, P1.10, P10.2,
--    P10.3) NÃO está aqui: muda um CHECK de tabela compartilhada e exige validação com
--    dados do DEV (D23). A conta da guia é a fonte para essa ponte.
--
-- O runtime só LÊ: toda escrita é por função SECURITY DEFINER presa à clínica da sessão.
-- Não toca tabela compartilhada.
--
-- Reversão (DEV, só com autorização; nada aqui é aplicado ao DEV por este PR):
--   DROP VIEW public.hi_payment_balances, public.hi_guide_accounts;
--   DROP FUNCTION public.hi_gloss_*, public.hi_payment_*, public.hi_account_*, public.hi_guide_reconcile;
--   DROP TABLE public.hi_account_events, public.hi_payment_allocations, public.hi_payments,
--     public.hi_gloss_appeal_items, public.hi_gloss_appeals, public.hi_glosses;
--   restaurar hi_files_*_chk da 0150, hi_premium_guard e qoro_premium_denial_for da 0151
--   e hi_guide_transition da 0147.
-- =====================================================================

-- ── Glosas ──────────────────────────────────────────────────────────────
CREATE TABLE public.hi_glosses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  insurer_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  guide_id uuid NOT NULL,
  guide_item_id uuid,
  gloss_code text NOT NULL,
  amount_cents bigint NOT NULL,
  status text NOT NULL DEFAULT 'informed',
  source text NOT NULL,
  return_id uuid,
  idempotency_key text NOT NULL,
  operator_note text,
  reversed_cents bigint NOT NULL DEFAULT 0,
  definitive_cents bigint NOT NULL DEFAULT 0,
  decided_reason text,
  decided_by uuid,
  decided_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_glosses_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_glosses_idem_uniq UNIQUE (clinic_id, idempotency_key),
  CONSTRAINT hi_glosses_batch_fk FOREIGN KEY (clinic_id, batch_id, insurer_id)
    REFERENCES public.hi_batches (clinic_id, id, insurer_id),
  CONSTRAINT hi_glosses_guide_fk FOREIGN KEY (clinic_id, guide_id) REFERENCES public.hi_guides (clinic_id, id),
  CONSTRAINT hi_glosses_item_fk FOREIGN KEY (clinic_id, guide_item_id) REFERENCES public.hi_guide_items (clinic_id, id),
  CONSTRAINT hi_glosses_return_fk FOREIGN KEY (clinic_id, return_id) REFERENCES public.hi_batch_returns (clinic_id, id),
  -- Tabela 38 da TUSS (motivos de glosa): 4 dígitos. Códigos fora do XSD (B.10.13) entram com aviso no importador.
  CONSTRAINT hi_glosses_code_chk CHECK (gloss_code ~ '^[0-9]{4}$'),
  CONSTRAINT hi_glosses_amount_chk CHECK (amount_cents > 0 AND amount_cents <= 9999999999),
  CONSTRAINT hi_glosses_status_chk CHECK (status IN (
    'informed', 'under_analysis', 'contested', 'appeal_filed', 'reversed', 'definitive'
  )),
  CONSTRAINT hi_glosses_source_chk CHECK (source IN ('manual', 'statement')),
  CONSTRAINT hi_glosses_statement_chk CHECK (source <> 'statement' OR return_id IS NOT NULL),
  CONSTRAINT hi_glosses_idem_chk CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  CONSTRAINT hi_glosses_note_chk CHECK (operator_note IS NULL OR char_length(operator_note) <= 500),
  CONSTRAINT hi_glosses_reason_chk CHECK (decided_reason IS NULL OR char_length(btrim(decided_reason)) BETWEEN 10 AND 500),
  -- Só os estados finais têm valor decidido; definitiva pode ser parcial (o resto revertido).
  CONSTRAINT hi_glosses_decision_chk CHECK (
    (status IN ('informed', 'under_analysis', 'contested', 'appeal_filed')
      AND reversed_cents = 0 AND definitive_cents = 0 AND decided_at IS NULL)
    OR (status = 'reversed' AND reversed_cents = amount_cents AND definitive_cents = 0 AND decided_at IS NOT NULL)
    OR (status = 'definitive' AND definitive_cents > 0 AND reversed_cents >= 0
      AND reversed_cents + definitive_cents = amount_cents AND decided_at IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX hi_glosses_guide_idx ON public.hi_glosses (clinic_id, guide_id, status);
--> statement-breakpoint
CREATE INDEX hi_glosses_open_idx ON public.hi_glosses (clinic_id, status, created_at)
  WHERE status IN ('informed', 'under_analysis', 'contested', 'appeal_filed');
--> statement-breakpoint

-- ── Recursos de glosa ───────────────────────────────────────────────────
CREATE TABLE public.hi_gloss_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  insurer_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  guide_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  justification text NOT NULL,
  justified_by uuid NOT NULL,
  requested_cents bigint NOT NULL,
  file_id uuid,
  channel text,
  filed_on date,
  filed_by uuid,
  protocol_number text,
  evidence text,
  answer text,
  answered_on date,
  accepted_cents bigint,
  answer_note text,
  answered_by uuid,
  cancel_reason text,
  idempotency_key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_gloss_appeals_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_gloss_appeals_idem_uniq UNIQUE (clinic_id, idempotency_key),
  CONSTRAINT hi_gloss_appeals_batch_fk FOREIGN KEY (clinic_id, batch_id, insurer_id)
    REFERENCES public.hi_batches (clinic_id, id, insurer_id),
  CONSTRAINT hi_gloss_appeals_guide_fk FOREIGN KEY (clinic_id, guide_id) REFERENCES public.hi_guides (clinic_id, id),
  CONSTRAINT hi_gloss_appeals_status_chk CHECK (status IN ('draft', 'filed', 'answered', 'cancelled')),
  -- A justificativa é de uma pessoa: texto próprio, com autor.
  CONSTRAINT hi_gloss_appeals_justification_chk CHECK (char_length(btrim(justification)) BETWEEN 20 AND 2000),
  CONSTRAINT hi_gloss_appeals_requested_chk CHECK (requested_cents > 0 AND requested_cents <= 9999999999),
  CONSTRAINT hi_gloss_appeals_channel_chk CHECK (channel IS NULL OR channel IN ('manual', 'connector')),
  -- Apresentado só com data, autor e prova: protocolo da operadora ou evidência do envio.
  CONSTRAINT hi_gloss_appeals_filed_chk CHECK (
    status IN ('draft', 'cancelled')
    OR (channel IS NOT NULL AND filed_on IS NOT NULL AND filed_by IS NOT NULL
        AND (protocol_number IS NOT NULL OR (evidence IS NOT NULL AND char_length(btrim(evidence)) >= 10)))
  ),
  CONSTRAINT hi_gloss_appeals_protocol_chk CHECK (protocol_number IS NULL OR protocol_number ~ '^[0-9A-Za-z./-]{1,30}$'),
  CONSTRAINT hi_gloss_appeals_evidence_chk CHECK (evidence IS NULL OR char_length(evidence) <= 500),
  CONSTRAINT hi_gloss_appeals_answer_chk CHECK (
    (status <> 'answered' AND answer IS NULL AND answered_on IS NULL AND accepted_cents IS NULL)
    OR (status = 'answered' AND answer IN ('accepted', 'partially_accepted', 'denied') AND answered_on IS NOT NULL
        AND accepted_cents IS NOT NULL AND accepted_cents BETWEEN 0 AND requested_cents
        AND (answer <> 'accepted' OR accepted_cents = requested_cents)
        AND (answer <> 'denied' OR accepted_cents = 0)
        AND (answer <> 'partially_accepted' OR accepted_cents BETWEEN 1 AND requested_cents - 1))
  ),
  CONSTRAINT hi_gloss_appeals_answer_note_chk CHECK (answer_note IS NULL OR char_length(answer_note) <= 500),
  CONSTRAINT hi_gloss_appeals_cancel_chk CHECK (
    (status <> 'cancelled' AND cancel_reason IS NULL)
    OR (status = 'cancelled' AND char_length(btrim(cancel_reason)) BETWEEN 10 AND 500)
  ),
  CONSTRAINT hi_gloss_appeals_idem_chk CHECK (char_length(idempotency_key) BETWEEN 8 AND 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX hi_gloss_appeals_protocol_uniq ON public.hi_gloss_appeals (clinic_id, insurer_id, protocol_number)
  WHERE protocol_number IS NOT NULL;
--> statement-breakpoint
CREATE INDEX hi_gloss_appeals_guide_idx ON public.hi_gloss_appeals (clinic_id, guide_id, status);
--> statement-breakpoint

CREATE TABLE public.hi_gloss_appeal_items (
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appeal_id uuid NOT NULL,
  gloss_id uuid NOT NULL,
  requested_cents bigint NOT NULL,
  accepted_cents bigint,
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT hi_gloss_appeal_items_pk PRIMARY KEY (clinic_id, appeal_id, gloss_id),
  CONSTRAINT hi_gloss_appeal_items_appeal_fk FOREIGN KEY (clinic_id, appeal_id)
    REFERENCES public.hi_gloss_appeals (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_gloss_appeal_items_gloss_fk FOREIGN KEY (clinic_id, gloss_id) REFERENCES public.hi_glosses (clinic_id, id),
  CONSTRAINT hi_gloss_appeal_items_requested_chk CHECK (requested_cents > 0),
  CONSTRAINT hi_gloss_appeal_items_accepted_chk CHECK (accepted_cents IS NULL OR accepted_cents BETWEEN 0 AND requested_cents)
);
--> statement-breakpoint
-- Uma glosa em um recurso ativo (rascunho ou apresentado) só.
CREATE UNIQUE INDEX hi_gloss_appeal_items_active_uniq ON public.hi_gloss_appeal_items (clinic_id, gloss_id) WHERE active;
--> statement-breakpoint

-- ── Pagamentos da operadora ─────────────────────────────────────────────
CREATE TABLE public.hi_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  insurer_id uuid NOT NULL,
  batch_id uuid,
  statement_ref text,
  paid_on date NOT NULL,
  amount_cents bigint NOT NULL,
  source text NOT NULL,
  return_id uuid,
  idempotency_key text NOT NULL,
  note text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_payments_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_payments_insurer_key UNIQUE (clinic_id, id, insurer_id),
  CONSTRAINT hi_payments_idem_uniq UNIQUE (clinic_id, idempotency_key),
  CONSTRAINT hi_payments_insurer_fk FOREIGN KEY (clinic_id, insurer_id) REFERENCES public.hi_insurers (clinic_id, id),
  CONSTRAINT hi_payments_batch_fk FOREIGN KEY (clinic_id, batch_id, insurer_id)
    REFERENCES public.hi_batches (clinic_id, id, insurer_id),
  CONSTRAINT hi_payments_return_fk FOREIGN KEY (clinic_id, return_id) REFERENCES public.hi_batch_returns (clinic_id, id),
  CONSTRAINT hi_payments_amount_chk CHECK (amount_cents > 0 AND amount_cents <= 99999999999),
  CONSTRAINT hi_payments_source_chk CHECK (source IN ('manual', 'statement')),
  CONSTRAINT hi_payments_statement_chk CHECK (source <> 'statement' OR (return_id IS NOT NULL AND statement_ref IS NOT NULL)),
  CONSTRAINT hi_payments_ref_chk CHECK (statement_ref IS NULL OR char_length(btrim(statement_ref)) BETWEEN 1 AND 60),
  CONSTRAINT hi_payments_note_chk CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT hi_payments_idem_chk CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  -- Registro manual é de uma pessoa.
  CONSTRAINT hi_payments_manual_chk CHECK (source <> 'manual' OR recorded_by IS NOT NULL)
);
--> statement-breakpoint
-- O mesmo demonstrativo de pagamento da operadora entra uma vez só.
CREATE UNIQUE INDEX hi_payments_statement_uniq ON public.hi_payments (clinic_id, insurer_id, statement_ref)
  WHERE statement_ref IS NOT NULL;
--> statement-breakpoint

CREATE TABLE public.hi_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL,
  insurer_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  guide_id uuid NOT NULL,
  guide_item_id uuid,
  kind text NOT NULL,
  amount_cents bigint NOT NULL,
  allocation_key text NOT NULL,
  reverses_id uuid,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_payment_allocations_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_payment_allocations_payment_fk FOREIGN KEY (clinic_id, payment_id, insurer_id)
    REFERENCES public.hi_payments (clinic_id, id, insurer_id),
  CONSTRAINT hi_payment_allocations_batch_fk FOREIGN KEY (clinic_id, batch_id, insurer_id)
    REFERENCES public.hi_batches (clinic_id, id, insurer_id),
  CONSTRAINT hi_payment_allocations_guide_fk FOREIGN KEY (clinic_id, guide_id) REFERENCES public.hi_guides (clinic_id, id),
  CONSTRAINT hi_payment_allocations_item_fk FOREIGN KEY (clinic_id, guide_item_id) REFERENCES public.hi_guide_items (clinic_id, id),
  CONSTRAINT hi_payment_allocations_reverses_fk FOREIGN KEY (clinic_id, reverses_id)
    REFERENCES public.hi_payment_allocations (clinic_id, id),
  CONSTRAINT hi_payment_allocations_kind_chk CHECK (
    (kind = 'allocation' AND reverses_id IS NULL AND reason IS NULL)
    OR (kind = 'reversal' AND reverses_id IS NOT NULL AND char_length(btrim(reason)) BETWEEN 10 AND 500)
  ),
  CONSTRAINT hi_payment_allocations_amount_chk CHECK (amount_cents > 0 AND amount_cents <= 9999999999),
  CONSTRAINT hi_payment_allocations_key_chk CHECK (char_length(allocation_key) BETWEEN 8 AND 200)
);
--> statement-breakpoint
-- Um estorno por alocação (o segundo pedido devolve o primeiro).
CREATE UNIQUE INDEX hi_payment_allocations_reversal_uniq ON public.hi_payment_allocations (clinic_id, reverses_id)
  WHERE reverses_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX hi_payment_allocations_guide_idx ON public.hi_payment_allocations (clinic_id, guide_id);
--> statement-breakpoint
CREATE INDEX hi_payment_allocations_payment_idx ON public.hi_payment_allocations (clinic_id, payment_id, allocation_key);
--> statement-breakpoint

-- ── Histórico do ciclo financeiro da guia ──────────────────────────────
CREATE TABLE public.hi_account_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  guide_id uuid,
  gloss_id uuid,
  appeal_id uuid,
  payment_id uuid,
  action text NOT NULL,
  from_status text,
  to_status text,
  amount_cents bigint,
  actor_id uuid,
  actor_kind text NOT NULL,
  note text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_account_events_ref_chk CHECK (num_nonnulls(guide_id, gloss_id, appeal_id, payment_id) >= 1),
  CONSTRAINT hi_account_events_actor_chk CHECK (actor_kind IN ('user', 'system')),
  CONSTRAINT hi_account_events_note_chk CHECK (note IS NULL OR char_length(note) <= 2000),
  CONSTRAINT hi_account_events_details_chk CHECK (jsonb_typeof(details) = 'object')
);
--> statement-breakpoint
CREATE INDEX hi_account_events_guide_idx ON public.hi_account_events (clinic_id, guide_id, created_at);
--> statement-breakpoint
CREATE INDEX hi_account_events_payment_idx ON public.hi_account_events (clinic_id, payment_id) WHERE payment_id IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER hi_account_events_immutable BEFORE UPDATE ON public.hi_account_events
  FOR EACH ROW EXECUTE FUNCTION public.hi_block_mutation();
--> statement-breakpoint
CREATE TRIGGER hi_payments_immutable BEFORE UPDATE ON public.hi_payments
  FOR EACH ROW EXECUTE FUNCTION public.hi_block_mutation();
--> statement-breakpoint
CREATE TRIGGER hi_payment_allocations_immutable BEFORE UPDATE ON public.hi_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.hi_block_mutation();
--> statement-breakpoint

-- ── hi_files: XML do recurso de glosa ───────────────────────────────────
ALTER TABLE public.hi_files ADD COLUMN appeal_id uuid;
--> statement-breakpoint
ALTER TABLE public.hi_files ADD CONSTRAINT hi_files_appeal_fk FOREIGN KEY (clinic_id, appeal_id)
  REFERENCES public.hi_gloss_appeals (clinic_id, id);
--> statement-breakpoint
ALTER TABLE public.hi_files DROP CONSTRAINT hi_files_kind_chk;
--> statement-breakpoint
ALTER TABLE public.hi_files ADD CONSTRAINT hi_files_kind_chk CHECK (kind IN (
  'guide_pdf', 'authorization_request_xml', 'authorization_request_pdf', 'batch_xml', 'batch_return', 'gloss_appeal_xml'
));
--> statement-breakpoint
ALTER TABLE public.hi_files DROP CONSTRAINT hi_files_link_chk;
--> statement-breakpoint
ALTER TABLE public.hi_files ADD CONSTRAINT hi_files_link_chk CHECK (
  (kind = 'guide_pdf' AND guide_id IS NOT NULL AND snapshot_id IS NOT NULL AND authorization_id IS NULL
    AND batch_id IS NULL AND appeal_id IS NULL)
  OR (kind IN ('authorization_request_xml', 'authorization_request_pdf')
      AND authorization_id IS NOT NULL AND guide_id IS NULL AND snapshot_id IS NULL AND batch_id IS NULL AND appeal_id IS NULL)
  OR (kind IN ('batch_xml', 'batch_return')
      AND batch_id IS NOT NULL AND guide_id IS NULL AND snapshot_id IS NULL AND authorization_id IS NULL AND appeal_id IS NULL)
  OR (kind = 'gloss_appeal_xml'
      AND appeal_id IS NOT NULL AND guide_id IS NULL AND snapshot_id IS NULL AND authorization_id IS NULL AND batch_id IS NULL)
);
--> statement-breakpoint
ALTER TABLE public.hi_files DROP CONSTRAINT hi_files_media_chk;
--> statement-breakpoint
ALTER TABLE public.hi_files ADD CONSTRAINT hi_files_media_chk CHECK (
  (kind IN ('guide_pdf', 'authorization_request_pdf') AND media_type = 'application/pdf')
  OR (kind IN ('authorization_request_xml', 'batch_xml', 'gloss_appeal_xml') AND media_type = 'application/xml')
  OR (kind = 'batch_return' AND media_type IN ('application/xml', 'application/pdf'))
);
--> statement-breakpoint
CREATE INDEX hi_files_appeal_idx ON public.hi_files (clinic_id, appeal_id) WHERE appeal_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.hi_gloss_appeals ADD CONSTRAINT hi_gloss_appeals_file_fk FOREIGN KEY (clinic_id, file_id)
  REFERENCES public.hi_files (clinic_id, id);
--> statement-breakpoint

-- ── Guia: o desfecho pode voltar a "em análise" quando a glosa é revertida e nada foi pago ──
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
      -- 0152: glosa revertida sem nada pago devolve a guia a "em análise" (a conta decide, hi_account_settle).
      OR (OLD.status IN ('paid', 'partially_paid', 'partially_glossed', 'fully_glossed') AND NEW.status = 'under_review')
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

-- ── D24: decisão comercial com período pago e carência (alinhada ao PR #53) ──
CREATE OR REPLACE FUNCTION public.qoro_premium_denial_for(p_clinic_id uuid, p_feature text) RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_clinic_status text;
  v_billing text;
  v_trial_ends timestamptz;
  v_plan text;
  v_restricted boolean := false;
  v_period_end timestamptz;
  v_grace timestamptz;
  v_cancel_at_end boolean;
BEGIN
  IF p_feature IS NULL OR p_feature NOT IN ('health_insurance', 'patient_charges', 'ai_agents') THEN
    RAISE EXCEPTION 'Recurso premium desconhecido.' USING ERRCODE = '22023';
  END IF;
  SELECT c.status::text INTO v_clinic_status FROM public.clinics c WHERE c.id = p_clinic_id;
  IF NOT FOUND THEN
    RETURN 'clinic_unknown';
  END IF;
  SELECT s.billing_status::text, s.trial_ends_at, pl.code, s.current_period_end, s.grace_period_until,
         coalesce(s.cancel_at_period_end, false)
    INTO v_billing, v_trial_ends, v_plan, v_period_end, v_grace, v_cancel_at_end
    FROM public.subscriptions s
    JOIN public.plans pl ON pl.id = s.plan_id
   WHERE s.clinic_id = p_clinic_id;
  IF NOT FOUND THEN
    RETURN 'no_subscription';
  END IF;
  -- Política de trial do PR #53 (0136): existe e não foi liberada por fatura paga.
  IF to_regclass('public.trial_access_policies') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.trial_access_policies WHERE clinic_id = $1 AND released_at IS NULL)'
      INTO v_restricted USING p_clinic_id;
  END IF;
  IF v_billing = 'trial' THEN
    IF v_trial_ends IS NOT NULL AND v_trial_ends <= statement_timestamp() THEN
      RETURN 'trial_expired';
    END IF;
    RETURN 'trial';
  END IF;
  IF v_restricted OR v_clinic_status = 'pending_payment' THEN
    RETURN 'payment_pending';
  END IF;
  IF v_clinic_status IN ('suspended_readonly', 'suspended') THEN
    RETURN 'clinic_suspended';
  END IF;
  IF v_clinic_status = 'cancelled' OR v_billing = 'cancelled' THEN
    RETURN 'subscription_cancelled';
  END IF;
  -- `past_due` com a clínica ainda ativa é a graça do dunning (ADR-016): quem
  -- reduz o acesso de uma clínica paga é o status que o dunning escreve.
  IF v_billing NOT IN ('active', 'past_due') THEN
    RETURN 'subscription_inactive';
  END IF;
  -- 0152: período pago vencido e fora da carência → negado. A carência é a que o billing
  -- grava (`grace_period_until`, PR #53: fim do período + dias de dunning); cancelamento no
  -- fim do período não tem carência. Mesma regra da `evaluateModuleAccess` do #53: nenhuma
  -- carência ilimitada, e `past_due` nunca vira pagamento confirmado. Sem período registrado
  -- (assinatura antiga), vale o status que o dunning escreve na clínica.
  IF v_period_end IS NOT NULL AND v_period_end <= statement_timestamp()
     AND (v_cancel_at_end OR v_grace IS NULL OR v_grace <= statement_timestamp()) THEN
    RETURN 'period_expired';
  END IF;
  IF NOT public.qoro_plan_includes(v_plan, p_feature) THEN
    RETURN 'plan_excludes';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- O XML do recurso de glosa é preservação de obrigação já faturada, não operação nova.
CREATE OR REPLACE FUNCTION public.hi_premium_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_denial text;
  v_new_operation boolean := true;
BEGIN
  IF TG_TABLE_NAME = 'hi_clinic_settings' THEN
    -- Só LIGAR o módulo é operação nova; desligar e editar cadastro, não.
    v_new_operation := NEW.enabled AND (TG_OP = 'INSERT' OR NOT OLD.enabled);
  ELSIF TG_TABLE_NAME = 'hi_files' THEN
    -- O retorno da operadora é fato sobre trabalho já entregue; o XML do recurso de glosa
    -- (0152) contesta obrigação já faturada: preservação, não operação nova.
    v_new_operation := NEW.kind NOT IN ('batch_return', 'gloss_appeal_xml');
  ELSIF TG_TABLE_NAME = 'hi_batches' THEN
    v_new_operation := TG_OP = 'INSERT'
      OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('validated', 'exported', 'sent'));
  ELSIF TG_TABLE_NAME = 'hi_copayments' THEN
    v_new_operation := TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
      AND NEW.status IN ('confirmed', 'charged');
  END IF;
  IF NOT v_new_operation THEN
    RETURN NEW;
  END IF;
  v_denial := public.qoro_premium_denial_for(NEW.clinic_id, 'health_insurance');
  IF v_denial IS NOT NULL THEN
    RAISE EXCEPTION 'Convênios exige assinatura ativa da clínica.'
      USING ERRCODE = '23514', CONSTRAINT = 'qoro_premium_health_insurance', DETAIL = v_denial;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- ── Núcleo da conta da guia ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hi_account_log(
  p_clinic_id uuid, p_guide_id uuid, p_gloss_id uuid, p_appeal_id uuid, p_payment_id uuid,
  p_action text, p_from text, p_to text, p_amount bigint, p_note text, p_details jsonb
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := public.hi_session_actor();
BEGIN
  INSERT INTO public.hi_account_events (clinic_id, guide_id, gloss_id, appeal_id, payment_id, action, from_status,
    to_status, amount_cents, actor_id, actor_kind, note, details)
  VALUES (p_clinic_id, p_guide_id, p_gloss_id, p_appeal_id, p_payment_id, p_action, p_from, p_to, p_amount, v_actor,
    CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END, p_note, coalesce(p_details, '{}'::jsonb));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_account_log(uuid, uuid, uuid, uuid, uuid, text, text, text, bigint, text, jsonb)
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- Totais de uma guia (ou de um item dela): pago líquido, glosa em aberto, definitiva, revertida.
CREATE OR REPLACE FUNCTION public.hi_account_totals(
  p_clinic_id uuid, p_guide_id uuid, p_item_id uuid,
  OUT paid_cents bigint, OUT open_cents bigint, OUT definitive_cents bigint, OUT reversed_cents bigint
)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    coalesce((SELECT sum(CASE a.kind WHEN 'allocation' THEN a.amount_cents ELSE -a.amount_cents END)
                FROM public.hi_payment_allocations a
               WHERE a.clinic_id = p_clinic_id AND a.guide_id = p_guide_id
                 AND (p_item_id IS NULL OR a.guide_item_id = p_item_id)), 0)::bigint,
    coalesce((SELECT sum(g.amount_cents) FROM public.hi_glosses g
               WHERE g.clinic_id = p_clinic_id AND g.guide_id = p_guide_id
                 AND (p_item_id IS NULL OR g.guide_item_id = p_item_id)
                 AND g.status IN ('informed', 'under_analysis', 'contested', 'appeal_filed')), 0)::bigint,
    coalesce((SELECT sum(g.definitive_cents) FROM public.hi_glosses g
               WHERE g.clinic_id = p_clinic_id AND g.guide_id = p_guide_id
                 AND (p_item_id IS NULL OR g.guide_item_id = p_item_id)), 0)::bigint,
    coalesce((SELECT sum(g.reversed_cents) FROM public.hi_glosses g
               WHERE g.clinic_id = p_clinic_id AND g.guide_id = p_guide_id
                 AND (p_item_id IS NULL OR g.guide_item_id = p_item_id)), 0)::bigint;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_account_totals(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- Guia da sessão, TRAVADA, enviada à operadora num lote enviado (e não encerrada).
CREATE OR REPLACE FUNCTION public.hi_account_lock_guide(p_clinic_id uuid, p_guide_id uuid, p_batch_id uuid)
  RETURNS public.hi_guides
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_guide public.hi_guides%ROWTYPE;
  v_batch_status text;
BEGIN
  PERFORM public.hi_session_clinic(p_clinic_id);
  SELECT * INTO v_guide FROM public.hi_guides WHERE id = p_guide_id AND clinic_id = p_clinic_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guia inexistente nesta clínica.' USING ERRCODE = '23503';
  END IF;
  IF v_guide.status NOT IN ('sent', 'under_review', 'paid', 'partially_paid', 'partially_glossed', 'fully_glossed') THEN
    RAISE EXCEPTION 'Glosa e pagamento só de guia enviada à operadora e não encerrada (estado: %).', v_guide.status
      USING ERRCODE = '55000';
  END IF;
  SELECT b.status INTO v_batch_status
    FROM public.hi_batch_guides bg
    JOIN public.hi_batches b ON b.clinic_id = bg.clinic_id AND b.id = bg.batch_id
   WHERE bg.clinic_id = p_clinic_id AND bg.guide_id = p_guide_id AND bg.batch_id = p_batch_id AND bg.active;
  IF v_batch_status IS NULL OR v_batch_status NOT IN ('sent', 'received', 'under_review', 'processed') THEN
    RAISE EXCEPTION 'A guia não faz parte deste lote enviado à operadora.' USING ERRCODE = '23514';
  END IF;
  RETURN v_guide;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_account_lock_guide(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- Sem dupla contagem: pago + glosa em aberto + definitiva + o novo valor ≤ faturado (guia e item).
CREATE OR REPLACE FUNCTION public.hi_account_assert_capacity(
  p_clinic_id uuid, p_guide public.hi_guides, p_item_id uuid, p_extra bigint
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_item_total bigint;
  t record;
BEGIN
  IF p_item_id IS NOT NULL THEN
    SELECT total_value_cents INTO v_item_total FROM public.hi_guide_items
     WHERE clinic_id = p_clinic_id AND id = p_item_id AND guide_id = p_guide.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'O item informado não é desta guia.' USING ERRCODE = '23514';
    END IF;
    t := public.hi_account_totals(p_clinic_id, p_guide.id, p_item_id);
    IF t.paid_cents + t.open_cents + t.definitive_cents + p_extra > v_item_total THEN
      RAISE EXCEPTION 'Valor acima do saldo do item: faturado %, pago %, glosado %, novo %.',
        v_item_total, t.paid_cents, t.open_cents + t.definitive_cents, p_extra USING ERRCODE = '23514';
    END IF;
  END IF;
  t := public.hi_account_totals(p_clinic_id, p_guide.id, NULL);
  IF t.paid_cents + t.open_cents + t.definitive_cents + p_extra > p_guide.total_value_cents THEN
    RAISE EXCEPTION 'Valor acima do saldo da guia: faturado %, pago %, glosado %, novo %.',
      p_guide.total_value_cents, t.paid_cents, t.open_cents + t.definitive_cents, p_extra USING ERRCODE = '23514';
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_account_assert_capacity(uuid, public.hi_guides, uuid, bigint) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- Estado da guia a partir da conta. Pagamento parcial NUNCA vira "paga"; encerrar é outra função.
CREATE OR REPLACE FUNCTION public.hi_account_settle(p_clinic_id uuid, p_guide_id uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_guide public.hi_guides%ROWTYPE;
  t record;
  v_to text;
BEGIN
  SELECT * INTO v_guide FROM public.hi_guides WHERE id = p_guide_id AND clinic_id = p_clinic_id FOR UPDATE;
  t := public.hi_account_totals(p_clinic_id, p_guide_id, NULL);
  IF t.paid_cents = v_guide.total_value_cents THEN
    v_to := 'paid';
  ELSIF t.open_cents + t.definitive_cents > 0 THEN
    v_to := CASE WHEN t.paid_cents = 0 AND t.open_cents + t.definitive_cents >= v_guide.total_value_cents
                 THEN 'fully_glossed' ELSE 'partially_glossed' END;
  ELSIF t.paid_cents > 0 THEN
    v_to := 'partially_paid';
  ELSE
    -- Nada pago e nenhuma glosa de pé (todas revertidas): volta a aguardar a operadora.
    v_to := CASE WHEN v_guide.status = 'sent' THEN 'sent' ELSE 'under_review' END;
  END IF;
  IF v_to IS DISTINCT FROM v_guide.status THEN
    UPDATE public.hi_guides SET status = v_to WHERE id = p_guide_id AND clinic_id = p_clinic_id;
    PERFORM public.hi_account_log(p_clinic_id, p_guide_id, NULL, NULL, NULL, 'guide_status', v_guide.status, v_to, NULL, NULL,
      jsonb_build_object('paid', t.paid_cents, 'glossOpen', t.open_cents, 'glossDefinitive', t.definitive_cents,
        'billed', v_guide.total_value_cents));
  END IF;
  RETURN v_to;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_account_settle(uuid, uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- ── Glosa: registrar (manual ou do demonstrativo, idempotente) ─────────
CREATE OR REPLACE FUNCTION public.hi_gloss_record(
  p_clinic_id uuid, p_batch_id uuid, p_guide_id uuid, p_item_id uuid, p_code text, p_amount_cents bigint,
  p_source text, p_return_id uuid, p_idempotency_key text, p_note text
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_existing public.hi_glosses%ROWTYPE;
  v_guide public.hi_guides%ROWTYPE;
  v_batch public.hi_batches%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM public.hi_session_clinic(p_clinic_id);
  SELECT * INTO v_existing FROM public.hi_glosses WHERE clinic_id = p_clinic_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    -- O mesmo retorno de novo entra uma vez; a mesma chave com outro conteúdo é conflito.
    IF v_existing.guide_id IS DISTINCT FROM p_guide_id OR v_existing.guide_item_id IS DISTINCT FROM p_item_id
       OR v_existing.gloss_code IS DISTINCT FROM p_code OR v_existing.amount_cents IS DISTINCT FROM p_amount_cents THEN
      RAISE EXCEPTION 'A chave da glosa já foi usada com outro conteúdo.' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;
  IF p_source = 'manual' AND public.hi_session_actor() IS NULL THEN
    RAISE EXCEPTION 'Glosa registrada à mão exige o usuário responsável.' USING ERRCODE = '42501';
  END IF;
  v_guide := public.hi_account_lock_guide(p_clinic_id, p_guide_id, p_batch_id);
  -- Com a guia travada, outra importação simultânea do mesmo retorno já terminou: confere de novo.
  SELECT * INTO v_existing FROM public.hi_glosses WHERE clinic_id = p_clinic_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN v_existing.id;
  END IF;
  SELECT * INTO v_batch FROM public.hi_batches WHERE id = p_batch_id AND clinic_id = p_clinic_id;
  IF p_return_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.hi_batch_returns r WHERE r.clinic_id = p_clinic_id AND r.id = p_return_id
       AND r.batch_id = p_batch_id AND r.kind IN ('analysis_statement', 'payment_statement')
  ) THEN
    RAISE EXCEPTION 'O demonstrativo da glosa deve ser um retorno deste lote.' USING ERRCODE = '23514';
  END IF;
  PERFORM public.hi_account_assert_capacity(p_clinic_id, v_guide, p_item_id, p_amount_cents);
  INSERT INTO public.hi_glosses (clinic_id, insurer_id, batch_id, guide_id, guide_item_id, gloss_code, amount_cents,
    source, return_id, idempotency_key, operator_note, created_by)
  VALUES (p_clinic_id, v_batch.insurer_id, p_batch_id, p_guide_id, p_item_id, p_code, p_amount_cents,
    p_source, p_return_id, p_idempotency_key, p_note, public.hi_session_actor())
  RETURNING id INTO v_id;
  PERFORM public.hi_account_log(p_clinic_id, p_guide_id, v_id, NULL, NULL, 'gloss_recorded', NULL, 'informed',
    p_amount_cents, NULL, jsonb_build_object('code', p_code, 'source', p_source, 'item', p_item_id));
  PERFORM public.hi_account_settle(p_clinic_id, p_guide_id);
  RETURN v_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_gloss_record(uuid, uuid, uuid, uuid, text, bigint, text, uuid, text, text) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── Glosa: análise, contestação, aceite (definitiva) e reversão pela operadora ──
CREATE OR REPLACE FUNCTION public.hi_gloss_transition(
  p_clinic_id uuid, p_gloss_id uuid, p_version integer, p_to text, p_reason text
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_gloss public.hi_glosses%ROWTYPE;
  v_actor uuid := public.hi_session_actor();
  v_pair text;
BEGIN
  PERFORM public.hi_session_clinic(p_clinic_id);
  SELECT * INTO v_gloss FROM public.hi_glosses WHERE id = p_gloss_id AND clinic_id = p_clinic_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Glosa inexistente nesta clínica.' USING ERRCODE = '23503';
  END IF;
  IF p_version IS NOT NULL AND v_gloss.version <> p_version THEN
    RAISE EXCEPTION 'A glosa mudou (versão % ≠ %); recarregue.', v_gloss.version, p_version USING ERRCODE = '40001';
  END IF;
  -- A guia trava junto: a conta muda com a glosa.
  PERFORM 1 FROM public.hi_guides WHERE id = v_gloss.guide_id AND clinic_id = p_clinic_id FOR UPDATE;
  v_pair := v_gloss.status || '>' || p_to;
  IF v_pair NOT IN (
    'informed>under_analysis', 'informed>contested', 'under_analysis>contested', 'contested>under_analysis',
    'informed>definitive', 'under_analysis>definitive', 'contested>definitive',
    'informed>reversed', 'under_analysis>reversed', 'contested>reversed'
  ) THEN
    RAISE EXCEPTION 'Transição de glosa não permitida: % → %.', v_gloss.status, p_to USING ERRCODE = '55000';
  END IF;
  IF p_to IN ('definitive', 'reversed') THEN
    -- Decisão sobre dinheiro: de uma pessoa, com motivo.
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'Aceitar ou registrar a reversão de glosa exige o usuário responsável.' USING ERRCODE = '42501';
    END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) < 10 THEN
      RAISE EXCEPTION 'Informe o motivo (10 a 500 caracteres).' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.hi_gloss_appeal_items i WHERE i.clinic_id = p_clinic_id AND i.gloss_id = p_gloss_id AND i.active) THEN
      RAISE EXCEPTION 'A glosa está num recurso em preparo: cancele o recurso antes.' USING ERRCODE = '55000';
    END IF;
  END IF;
  UPDATE public.hi_glosses SET
    status = p_to,
    definitive_cents = CASE WHEN p_to = 'definitive' THEN amount_cents ELSE 0 END,
    reversed_cents = CASE WHEN p_to = 'reversed' THEN amount_cents ELSE 0 END,
    decided_reason = CASE WHEN p_to IN ('definitive', 'reversed') THEN btrim(p_reason) ELSE NULL END,
    decided_by = CASE WHEN p_to IN ('definitive', 'reversed') THEN v_actor ELSE NULL END,
    decided_at = CASE WHEN p_to IN ('definitive', 'reversed') THEN now() ELSE NULL END,
    version = version + 1, updated_at = now()
  WHERE id = p_gloss_id
  RETURNING * INTO v_gloss;
  PERFORM public.hi_account_log(p_clinic_id, v_gloss.guide_id, p_gloss_id, NULL, NULL, 'gloss_' || p_to,
    split_part(v_pair, '>', 1), p_to, v_gloss.amount_cents, p_reason, '{}'::jsonb);
  PERFORM public.hi_account_settle(p_clinic_id, v_gloss.guide_id);
  RETURN v_gloss.version;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_gloss_transition(uuid, uuid, integer, text, text) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── Recurso: preparar (rascunho), com justificativa de uma pessoa ──────
CREATE OR REPLACE FUNCTION public.hi_gloss_appeal_create(
  p_clinic_id uuid, p_guide_id uuid, p_items jsonb, p_justification text, p_idempotency_key text
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := public.hi_session_actor();
  v_existing uuid;
  v_item jsonb;
  v_gloss public.hi_glosses%ROWTYPE;
  v_batch uuid;
  v_insurer uuid;
  v_requested bigint;
  v_total bigint := 0;
  v_id uuid;
BEGIN
  PERFORM public.hi_session_clinic(p_clinic_id);
  SELECT id INTO v_existing FROM public.hi_gloss_appeals WHERE clinic_id = p_clinic_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN v_existing;
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'O recurso de glosa é preparado e justificado por uma pessoa.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma glosa para recorrer.' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM public.hi_guides WHERE id = p_guide_id AND clinic_id = p_clinic_id FOR UPDATE;
  SELECT id INTO v_existing FROM public.hi_gloss_appeals WHERE clinic_id = p_clinic_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN v_existing;
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_gloss FROM public.hi_glosses
     WHERE clinic_id = p_clinic_id AND id = (v_item->>'glossId')::uuid FOR UPDATE;
    IF NOT FOUND OR v_gloss.guide_id <> p_guide_id THEN
      RAISE EXCEPTION 'Glosa do recurso não é desta guia.' USING ERRCODE = '23514';
    END IF;
    IF v_gloss.status NOT IN ('informed', 'under_analysis', 'contested') THEN
      RAISE EXCEPTION 'Só se recorre de glosa em aberto (estado: %).', v_gloss.status USING ERRCODE = '55000';
    END IF;
    v_requested := coalesce((v_item->>'requestedCents')::bigint, v_gloss.amount_cents);
    IF v_requested <= 0 OR v_requested > v_gloss.amount_cents THEN
      RAISE EXCEPTION 'O valor recorrido deve ser de 1 centavo até o valor glosado.' USING ERRCODE = '23514';
    END IF;
    IF v_batch IS NULL THEN
      v_batch := v_gloss.batch_id; v_insurer := v_gloss.insurer_id;
    ELSIF v_batch <> v_gloss.batch_id THEN
      RAISE EXCEPTION 'Um recurso reúne glosas de um lote só.' USING ERRCODE = '23514';
    END IF;
    v_total := v_total + v_requested;
  END LOOP;
  INSERT INTO public.hi_gloss_appeals (clinic_id, insurer_id, batch_id, guide_id, justification, justified_by,
    requested_cents, idempotency_key)
  VALUES (p_clinic_id, v_insurer, v_batch, p_guide_id, btrim(p_justification), v_actor, v_total, p_idempotency_key)
  RETURNING id INTO v_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_gloss FROM public.hi_glosses WHERE clinic_id = p_clinic_id AND id = (v_item->>'glossId')::uuid;
    INSERT INTO public.hi_gloss_appeal_items (clinic_id, appeal_id, gloss_id, requested_cents)
    VALUES (p_clinic_id, v_id, v_gloss.id, coalesce((v_item->>'requestedCents')::bigint, v_gloss.amount_cents));
    IF v_gloss.status <> 'contested' THEN
      UPDATE public.hi_glosses SET status = 'contested', version = version + 1, updated_at = now() WHERE id = v_gloss.id;
      PERFORM public.hi_account_log(p_clinic_id, p_guide_id, v_gloss.id, v_id, NULL, 'gloss_contested', v_gloss.status,
        'contested', v_gloss.amount_cents, NULL, '{}'::jsonb);
    END IF;
  END LOOP;
  PERFORM public.hi_account_log(p_clinic_id, p_guide_id, NULL, v_id, NULL, 'appeal_drafted', NULL, 'draft', v_total, NULL,
    jsonb_build_object('glosses', jsonb_array_length(p_items)));
  RETURN v_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_gloss_appeal_create(uuid, uuid, jsonb, text, text) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── Recurso: apresentado (protocolo real ou evidência do envio, nunca fictício) ──
CREATE OR REPLACE FUNCTION public.hi_gloss_appeal_file(
  p_clinic_id uuid, p_appeal_id uuid, p_version integer, p_channel text, p_filed_on date,
  p_protocol text, p_evidence text, p_file_id uuid
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_appeal public.hi_gloss_appeals%ROWTYPE;
  v_actor uuid := public.hi_session_actor();
BEGIN
  PERFORM public.hi_session_clinic(p_clinic_id);
  SELECT * INTO v_appeal FROM public.hi_gloss_appeals WHERE id = p_appeal_id AND clinic_id = p_clinic_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recurso inexistente nesta clínica.' USING ERRCODE = '23503';
  END IF;
  IF v_appeal.version <> p_version THEN
    RAISE EXCEPTION 'O recurso mudou (versão % ≠ %); recarregue.', v_appeal.version, p_version USING ERRCODE = '40001';
  END IF;
  IF v_appeal.status <> 'draft' THEN
    RAISE EXCEPTION 'Só um recurso em preparo é apresentado (estado: %).', v_appeal.status USING ERRCODE = '55000';
  END IF;
  IF v_actor IS NULL AND p_channel = 'manual' THEN
    RAISE EXCEPTION 'Envio manual do recurso é registrado por uma pessoa.' USING ERRCODE = '42501';
  END IF;
  IF p_filed_on > current_date THEN
    RAISE EXCEPTION 'A data de apresentação não pode estar no futuro.' USING ERRCODE = '23514';
  END IF;
  IF p_file_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.hi_files f WHERE f.clinic_id = p_clinic_id AND f.id = p_file_id
       AND f.kind = 'gloss_appeal_xml' AND f.appeal_id = p_appeal_id
  ) THEN
    RAISE EXCEPTION 'O XML deve ser o recurso desta apresentação.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.hi_gloss_appeals SET status = 'filed', channel = p_channel, filed_on = p_filed_on,
    filed_by = coalesce(v_actor, justified_by), protocol_number = nullif(btrim(p_protocol), ''),
    evidence = nullif(btrim(p_evidence), ''), file_id = coalesce(p_file_id, file_id),
    version = version + 1, updated_at = now()
   WHERE id = p_appeal_id
  RETURNING * INTO v_appeal;
  UPDATE public.hi_glosses g SET status = 'appeal_filed', version = g.version + 1, updated_at = now()
    FROM public.hi_gloss_appeal_items i
   WHERE i.clinic_id = p_clinic_id AND i.appeal_id = p_appeal_id AND i.active
     AND g.clinic_id = p_clinic_id AND g.id = i.gloss_id;
  PERFORM public.hi_account_log(p_clinic_id, v_appeal.guide_id, NULL, p_appeal_id, NULL, 'appeal_filed', 'draft', 'filed',
    v_appeal.requested_cents, NULL, jsonb_build_object('channel', p_channel, 'protocol', v_appeal.protocol_number IS NOT NULL));
  RETURN v_appeal.version;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_gloss_appeal_file(uuid, uuid, integer, text, date, text, text, uuid) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── Recurso: resposta da operadora decide cada glosa ───────────────────
-- p_items: [{glossId, acceptedCents}] — o aceito é revertido; o resto da glosa vira definitivo.
CREATE OR REPLACE FUNCTION public.hi_gloss_appeal_answer(
  p_clinic_id uuid, p_appeal_id uuid, p_version integer, p_answered_on date, p_items jsonb, p_note text
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_appeal public.hi_gloss_appeals%ROWTYPE;
  v_item record;
  v_gloss public.hi_glosses%ROWTYPE;
  v_accepted bigint;
  v_total bigint := 0;
  v_answer text;
BEGIN
  PERFORM public.hi_session_clinic(p_clinic_id);
  SELECT * INTO v_appeal FROM public.hi_gloss_appeals WHERE id = p_appeal_id AND clinic_id = p_clinic_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recurso inexistente nesta clínica.' USING ERRCODE = '23503';
  END IF;
  IF v_appeal.version <> p_version THEN
    RAISE EXCEPTION 'O recurso mudou (versão % ≠ %); recarregue.', v_appeal.version, p_version USING ERRCODE = '40001';
  END IF;
  IF v_appeal.status <> 'filed' THEN
    RAISE EXCEPTION 'Resposta só de recurso apresentado (estado: %).', v_appeal.status USING ERRCODE = '55000';
  END IF;
  IF p_answered_on < v_appeal.filed_on THEN
    RAISE EXCEPTION 'A resposta não pode ser anterior à apresentação.' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM public.hi_guides WHERE id = v_appeal.guide_id AND clinic_id = p_clinic_id FOR UPDATE;
  FOR v_item IN
    SELECT i.gloss_id, i.requested_cents FROM public.hi_gloss_appeal_items i
     WHERE i.clinic_id = p_clinic_id AND i.appeal_id = p_appeal_id AND i.active
  LOOP
    SELECT (e->>'acceptedCents')::bigint INTO v_accepted
      FROM jsonb_array_elements(p_items) e WHERE (e->>'glossId')::uuid = v_item.gloss_id;
    IF v_accepted IS NULL OR v_accepted < 0 OR v_accepted > v_item.requested_cents THEN
      RAISE EXCEPTION 'Informe o valor aceito (0 até o recorrido) de cada glosa do recurso.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO v_gloss FROM public.hi_glosses WHERE clinic_id = p_clinic_id AND id = v_item.gloss_id FOR UPDATE;
    UPDATE public.hi_gloss_appeal_items SET accepted_cents = v_accepted, active = false
     WHERE clinic_id = p_clinic_id AND appeal_id = p_appeal_id AND gloss_id = v_item.gloss_id;
    UPDATE public.hi_glosses SET
      status = CASE WHEN v_accepted = amount_cents THEN 'reversed' ELSE 'definitive' END,
      reversed_cents = v_accepted,
      definitive_cents = amount_cents - v_accepted,
      decided_reason = left('Resposta da operadora ao recurso' || coalesce(': ' || btrim(p_note), '.'), 500),
      decided_by = public.hi_session_actor(), decided_at = now(),
      version = version + 1, updated_at = now()
     WHERE id = v_item.gloss_id
    RETURNING * INTO v_gloss;
    PERFORM public.hi_account_log(p_clinic_id, v_appeal.guide_id, v_gloss.id, p_appeal_id, NULL, 'gloss_' || v_gloss.status,
      'appeal_filed', v_gloss.status, v_gloss.amount_cents, NULL,
      jsonb_build_object('reversed', v_gloss.reversed_cents, 'definitive', v_gloss.definitive_cents));
    v_total := v_total + v_accepted;
  END LOOP;
  v_answer := CASE WHEN v_total = v_appeal.requested_cents THEN 'accepted' WHEN v_total = 0 THEN 'denied'
                   ELSE 'partially_accepted' END;
  UPDATE public.hi_gloss_appeals SET status = 'answered', answer = v_answer, answered_on = p_answered_on,
    accepted_cents = v_total, answer_note = nullif(btrim(p_note), ''), answered_by = public.hi_session_actor(),
    version = version + 1, updated_at = now()
   WHERE id = p_appeal_id
  RETURNING * INTO v_appeal;
  PERFORM public.hi_account_log(p_clinic_id, v_appeal.guide_id, NULL, p_appeal_id, NULL, 'appeal_answered', 'filed',
    'answered', v_total, p_note, jsonb_build_object('answer', v_answer));
  PERFORM public.hi_account_settle(p_clinic_id, v_appeal.guide_id);
  RETURN v_appeal.version;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_gloss_appeal_answer(uuid, uuid, integer, date, jsonb, text) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── Recurso: descartar o rascunho (as glosas seguem contestadas) ───────
CREATE OR REPLACE FUNCTION public.hi_gloss_appeal_cancel(
  p_clinic_id uuid, p_appeal_id uuid, p_version integer, p_reason text
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_appeal public.hi_gloss_appeals%ROWTYPE;
BEGIN
  PERFORM public.hi_session_clinic(p_clinic_id);
  SELECT * INTO v_appeal FROM public.hi_gloss_appeals WHERE id = p_appeal_id AND clinic_id = p_clinic_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recurso inexistente nesta clínica.' USING ERRCODE = '23503';
  END IF;
  IF v_appeal.version <> p_version THEN
    RAISE EXCEPTION 'O recurso mudou (versão % ≠ %); recarregue.', v_appeal.version, p_version USING ERRCODE = '40001';
  END IF;
  IF v_appeal.status <> 'draft' THEN
    RAISE EXCEPTION 'Só o recurso em preparo é descartado; o apresentado aguarda a resposta.' USING ERRCODE = '55000';
  END IF;
  IF public.hi_session_actor() IS NULL THEN
    RAISE EXCEPTION 'Descartar recurso exige o usuário responsável.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.hi_gloss_appeal_items SET active = false WHERE clinic_id = p_clinic_id AND appeal_id = p_appeal_id;
  UPDATE public.hi_gloss_appeals SET status = 'cancelled', cancel_reason = btrim(p_reason), version = version + 1,
    updated_at = now() WHERE id = p_appeal_id RETURNING * INTO v_appeal;
  PERFORM public.hi_account_log(p_clinic_id, v_appeal.guide_id, NULL, p_appeal_id, NULL, 'appeal_cancelled', 'draft',
    'cancelled', NULL, p_reason, '{}'::jsonb);
  RETURN v_appeal.version;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_gloss_appeal_cancel(uuid, uuid, integer, text) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── Pagamento: alocar a guias/itens (idempotente por chave) ────────────
CREATE OR REPLACE FUNCTION public.hi_payment_allocate(
  p_clinic_id uuid, p_payment_id uuid, p_allocation_key text, p_allocations jsonb
) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_payment public.hi_payments%ROWTYPE;
  v_alloc jsonb;
  v_guide public.hi_guides%ROWTYPE;
  v_batch uuid;
  v_item uuid;
  v_amount bigint;
  v_net bigint;
  v_sum bigint := 0;
  v_guides uuid[] := '{}';
  v_g uuid;
BEGIN
  PERFORM public.hi_session_clinic(p_clinic_id);
  SELECT * INTO v_payment FROM public.hi_payments WHERE id = p_payment_id AND clinic_id = p_clinic_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pagamento inexistente nesta clínica.' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hi_payment_allocations a WHERE a.clinic_id = p_clinic_id AND a.payment_id = p_payment_id
               AND a.allocation_key = p_allocation_key) THEN
    -- A mesma conciliação de novo: aplicada uma vez só.
    RETURN (SELECT coalesce(sum(amount_cents), 0) FROM public.hi_payment_allocations
             WHERE clinic_id = p_clinic_id AND payment_id = p_payment_id AND allocation_key = p_allocation_key);
  END IF;
  IF jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'Informe as guias do pagamento.' USING ERRCODE = '23514';
  END IF;
  -- Guias travadas sempre na mesma ordem (por id): pagamentos concorrentes não se cruzam em deadlock.
  FOR v_g IN SELECT DISTINCT (e->>'guideId')::uuid FROM jsonb_array_elements(p_allocations) e ORDER BY 1 LOOP
    PERFORM 1 FROM public.hi_guides WHERE id = v_g AND clinic_id = p_clinic_id FOR UPDATE;
  END LOOP;
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    v_batch := (v_alloc->>'batchId')::uuid;
    v_item := nullif(v_alloc->>'itemId', '')::uuid;
    v_amount := (v_alloc->>'amountCents')::bigint;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Valor alocado deve ser positivo.' USING ERRCODE = '23514';
    END IF;
    v_guide := public.hi_account_lock_guide(p_clinic_id, (v_alloc->>'guideId')::uuid, v_batch);
    IF v_guide.insurer_id <> v_payment.insurer_id THEN
      RAISE EXCEPTION 'A guia é de outra operadora.' USING ERRCODE = '23514';
    END IF;
    IF v_payment.batch_id IS NOT NULL AND v_payment.batch_id <> v_batch THEN
      RAISE EXCEPTION 'O pagamento é de outro lote.' USING ERRCODE = '23514';
    END IF;
    PERFORM public.hi_account_assert_capacity(p_clinic_id, v_guide, v_item, v_amount);
    INSERT INTO public.hi_payment_allocations (clinic_id, payment_id, insurer_id, batch_id, guide_id, guide_item_id,
      kind, amount_cents, allocation_key, created_by)
    VALUES (p_clinic_id, p_payment_id, v_payment.insurer_id, v_batch, v_guide.id, v_item, 'allocation', v_amount,
      p_allocation_key, public.hi_session_actor());
    v_sum := v_sum + v_amount;
    v_guides := array_append(v_guides, v_guide.id);
  END LOOP;
  SELECT coalesce(sum(CASE kind WHEN 'allocation' THEN amount_cents ELSE -amount_cents END), 0) INTO v_net
    FROM public.hi_payment_allocations WHERE clinic_id = p_clinic_id AND payment_id = p_payment_id;
  IF v_net > v_payment.amount_cents THEN
    RAISE EXCEPTION 'Alocado (%) acima do valor pago (%).', v_net, v_payment.amount_cents USING ERRCODE = '23514';
  END IF;
  FOR v_g IN SELECT DISTINCT unnest(v_guides) LOOP
    PERFORM public.hi_account_log(p_clinic_id, v_g, NULL, NULL, p_payment_id, 'payment_allocated', NULL, NULL,
      (SELECT sum(amount_cents) FROM public.hi_payment_allocations WHERE clinic_id = p_clinic_id AND payment_id = p_payment_id
         AND allocation_key = p_allocation_key AND guide_id = v_g)::bigint, NULL, '{}'::jsonb);
    PERFORM public.hi_account_settle(p_clinic_id, v_g);
  END LOOP;
  RETURN v_sum;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_payment_allocate(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── Pagamento: registrar (manual ou demonstrativo), idempotente ────────
-- Sem alocação informada e com lote: só aloca sozinho se o valor for EXATAMENTE o saldo
-- das guias do lote (sem glosa em aberto); senão o valor fica "não conciliado" (divergência).
CREATE OR REPLACE FUNCTION public.hi_payment_record(
  p_clinic_id uuid, p_insurer_id uuid, p_batch_id uuid, p_statement_ref text, p_paid_on date,
  p_amount_cents bigint, p_source text, p_return_id uuid, p_idempotency_key text, p_note text, p_allocations jsonb
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_existing public.hi_payments%ROWTYPE;
  v_id uuid;
  v_capacity bigint := 0;
  v_auto jsonb := '[]'::jsonb;
  v_row record;
  t record;
BEGIN
  PERFORM public.hi_session_clinic(p_clinic_id);
  SELECT * INTO v_existing FROM public.hi_payments WHERE clinic_id = p_clinic_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.amount_cents IS DISTINCT FROM p_amount_cents OR v_existing.insurer_id IS DISTINCT FROM p_insurer_id
       OR v_existing.statement_ref IS DISTINCT FROM p_statement_ref THEN
      RAISE EXCEPTION 'A chave do pagamento já foi usada com outro conteúdo.' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id; -- o mesmo retorno de novo: o recebimento entra uma vez
  END IF;
  IF p_statement_ref IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.hi_payments WHERE clinic_id = p_clinic_id AND insurer_id = p_insurer_id AND statement_ref = btrim(p_statement_ref)
  ) THEN
    RAISE EXCEPTION 'Este demonstrativo de pagamento já foi registrado.' USING ERRCODE = '23505';
  END IF;
  IF p_source = 'manual' AND public.hi_session_actor() IS NULL THEN
    RAISE EXCEPTION 'Pagamento registrado à mão exige o usuário responsável.' USING ERRCODE = '42501';
  END IF;
  IF p_paid_on > current_date THEN
    RAISE EXCEPTION 'A data do recebimento não pode estar no futuro.' USING ERRCODE = '23514';
  END IF;
  IF p_batch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.hi_batches b WHERE b.clinic_id = p_clinic_id AND b.id = p_batch_id AND b.insurer_id = p_insurer_id
       AND b.status IN ('sent', 'received', 'under_review', 'processed')
  ) THEN
    RAISE EXCEPTION 'Pagamento por lote só de lote enviado desta operadora.' USING ERRCODE = '23514';
  END IF;
  IF p_return_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.hi_batch_returns r WHERE r.clinic_id = p_clinic_id AND r.id = p_return_id
       AND r.kind = 'payment_statement' AND (p_batch_id IS NULL OR r.batch_id = p_batch_id)
  ) THEN
    RAISE EXCEPTION 'O demonstrativo deve ser um retorno de pagamento do lote.' USING ERRCODE = '23514';
  END IF;
  -- Dois registros simultâneos com a mesma chave: o segundo espera o primeiro e devolve o dele.
  INSERT INTO public.hi_payments (clinic_id, insurer_id, batch_id, statement_ref, paid_on, amount_cents, source, return_id,
    idempotency_key, note, recorded_by)
  VALUES (p_clinic_id, p_insurer_id, p_batch_id, nullif(btrim(p_statement_ref), ''), p_paid_on, p_amount_cents, p_source,
    p_return_id, p_idempotency_key, p_note, public.hi_session_actor())
  ON CONFLICT ON CONSTRAINT hi_payments_idem_uniq DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT * INTO v_existing FROM public.hi_payments WHERE clinic_id = p_clinic_id AND idempotency_key = p_idempotency_key;
    IF v_existing.amount_cents IS DISTINCT FROM p_amount_cents OR v_existing.insurer_id IS DISTINCT FROM p_insurer_id THEN
      RAISE EXCEPTION 'A chave do pagamento já foi usada com outro conteúdo.' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;
  PERFORM public.hi_account_log(p_clinic_id, NULL, NULL, NULL, v_id, 'payment_recorded', NULL, NULL, p_amount_cents, p_note,
    jsonb_build_object('source', p_source, 'batch', p_batch_id));
  IF p_allocations IS NOT NULL AND jsonb_array_length(p_allocations) > 0 THEN
    PERFORM public.hi_payment_allocate(p_clinic_id, v_id, p_idempotency_key, p_allocations);
  ELSIF p_batch_id IS NOT NULL THEN
    FOR v_row IN
      SELECT g.id, g.total_value_cents FROM public.hi_batch_guides bg
        JOIN public.hi_guides g ON g.clinic_id = bg.clinic_id AND g.id = bg.guide_id
       WHERE bg.clinic_id = p_clinic_id AND bg.batch_id = p_batch_id AND bg.active
         AND g.status IN ('sent', 'under_review', 'paid', 'partially_paid', 'partially_glossed', 'fully_glossed')
       ORDER BY g.id
    LOOP
      t := public.hi_account_totals(p_clinic_id, v_row.id, NULL);
      IF t.open_cents > 0 THEN
        v_capacity := -1; -- glosa em aberto: o rateio não é inequívoco
        EXIT;
      END IF;
      IF v_row.total_value_cents - t.paid_cents - t.definitive_cents > 0 THEN
        v_capacity := v_capacity + v_row.total_value_cents - t.paid_cents - t.definitive_cents;
        v_auto := v_auto || jsonb_build_array(jsonb_build_object('guideId', v_row.id, 'batchId', p_batch_id,
          'amountCents', v_row.total_value_cents - t.paid_cents - t.definitive_cents));
      END IF;
    END LOOP;
    IF v_capacity = p_amount_cents THEN
      PERFORM public.hi_payment_allocate(p_clinic_id, v_id, p_idempotency_key, v_auto);
    ELSE
      PERFORM public.hi_account_log(p_clinic_id, NULL, NULL, NULL, v_id, 'payment_unreconciled', NULL, NULL, p_amount_cents,
        NULL, jsonb_build_object('batchPending', v_capacity));
    END IF;
  END IF;
  RETURN v_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_payment_record(uuid, uuid, uuid, text, date, bigint, text, uuid, text, text, jsonb)
  FROM PUBLIC, anon;
--> statement-breakpoint

-- ── Pagamento: estorno de uma alocação (lançamento compensatório) ──────
CREATE OR REPLACE FUNCTION public.hi_payment_reverse(p_clinic_id uuid, p_allocation_id uuid, p_reason text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_alloc public.hi_payment_allocations%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM public.hi_session_clinic(p_clinic_id);
  SELECT * INTO v_alloc FROM public.hi_payment_allocations WHERE id = p_allocation_id AND clinic_id = p_clinic_id;
  IF NOT FOUND OR v_alloc.kind <> 'allocation' THEN
    RAISE EXCEPTION 'Só uma alocação de pagamento pode ser estornada.' USING ERRCODE = '23503';
  END IF;
  SELECT id INTO v_id FROM public.hi_payment_allocations WHERE clinic_id = p_clinic_id AND reverses_id = p_allocation_id;
  IF FOUND THEN
    RETURN v_id; -- já estornada
  END IF;
  IF public.hi_session_actor() IS NULL THEN
    RAISE EXCEPTION 'Estorno de pagamento exige o usuário responsável.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.hi_guides WHERE id = v_alloc.guide_id AND clinic_id = p_clinic_id FOR UPDATE;
  IF (SELECT status FROM public.hi_guides WHERE id = v_alloc.guide_id AND clinic_id = p_clinic_id) = 'closed' THEN
    RAISE EXCEPTION 'Guia encerrada (conciliada) não tem pagamento estornado.' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.hi_payment_allocations (clinic_id, payment_id, insurer_id, batch_id, guide_id, guide_item_id, kind,
    amount_cents, allocation_key, reverses_id, reason, created_by)
  VALUES (p_clinic_id, v_alloc.payment_id, v_alloc.insurer_id, v_alloc.batch_id, v_alloc.guide_id, v_alloc.guide_item_id,
    'reversal', v_alloc.amount_cents, 'reversal:' || p_allocation_id::text, p_allocation_id, btrim(p_reason),
    public.hi_session_actor())
  RETURNING id INTO v_id;
  PERFORM public.hi_account_log(p_clinic_id, v_alloc.guide_id, NULL, NULL, v_alloc.payment_id, 'payment_reversed', NULL, NULL,
    v_alloc.amount_cents, p_reason, jsonb_build_object('allocation', p_allocation_id));
  PERFORM public.hi_account_settle(p_clinic_id, v_alloc.guide_id);
  RETURN v_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_payment_reverse(uuid, uuid, text) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── Conciliação: encerrar a guia (pessoa; pendente 0 e nada em aberto) ──
CREATE OR REPLACE FUNCTION public.hi_guide_reconcile(
  p_clinic_id uuid, p_guide_id uuid, p_version integer, p_note text
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_guide public.hi_guides%ROWTYPE;
  t record;
BEGIN
  PERFORM public.hi_session_clinic(p_clinic_id);
  SELECT * INTO v_guide FROM public.hi_guides WHERE id = p_guide_id AND clinic_id = p_clinic_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guia inexistente nesta clínica.' USING ERRCODE = '23503';
  END IF;
  IF v_guide.version <> p_version THEN
    RAISE EXCEPTION 'A guia mudou (versão % ≠ %); recarregue.', v_guide.version, p_version USING ERRCODE = '40001';
  END IF;
  IF public.hi_session_actor() IS NULL THEN
    RAISE EXCEPTION 'Conciliar a guia exige o usuário responsável.' USING ERRCODE = '42501';
  END IF;
  IF v_guide.status NOT IN ('paid', 'partially_paid', 'partially_glossed', 'fully_glossed') THEN
    RAISE EXCEPTION 'Só guia com desfecho da operadora é conciliada (estado: %).', v_guide.status USING ERRCODE = '55000';
  END IF;
  t := public.hi_account_totals(p_clinic_id, p_guide_id, NULL);
  IF t.open_cents > 0 OR EXISTS (
    SELECT 1 FROM public.hi_gloss_appeals a WHERE a.clinic_id = p_clinic_id AND a.guide_id = p_guide_id AND a.status IN ('draft', 'filed')
  ) THEN
    RAISE EXCEPTION 'Há glosa ou recurso em aberto nesta guia.' USING ERRCODE = '55000';
  END IF;
  IF t.paid_cents + t.definitive_cents <> v_guide.total_value_cents THEN
    RAISE EXCEPTION 'A guia não fecha: faturado %, pago %, glosa definitiva %, pendente %.', v_guide.total_value_cents,
      t.paid_cents, t.definitive_cents, v_guide.total_value_cents - t.paid_cents - t.definitive_cents USING ERRCODE = '23514';
  END IF;
  UPDATE public.hi_guides SET status = 'closed', transition_note = left(nullif(btrim(p_note), ''), 500)
   WHERE id = p_guide_id AND clinic_id = p_clinic_id RETURNING * INTO v_guide;
  PERFORM public.hi_account_log(p_clinic_id, p_guide_id, NULL, NULL, NULL, 'guide_reconciled', NULL, 'closed',
    v_guide.total_value_cents, p_note, jsonb_build_object('paid', t.paid_cents, 'glossDefinitive', t.definitive_cents));
  RETURN v_guide.version;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guide_reconcile(uuid, uuid, integer, text) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── Visões da conta (RLS de quem consulta) ─────────────────────────────
CREATE VIEW public.hi_guide_accounts WITH (security_invoker = true) AS
SELECT g.clinic_id, g.id AS guide_id, g.insurer_id, g.guide_type, g.number, g.status, g.version,
       g.total_value_cents AS billed_cents,
       coalesce(p.paid, 0)::bigint AS paid_cents,
       coalesce(gl.open_cents, 0)::bigint AS gloss_open_cents,
       coalesce(gl.definitive_cents, 0)::bigint AS gloss_definitive_cents,
       coalesce(gl.reversed_cents, 0)::bigint AS gloss_reversed_cents,
       (g.total_value_cents - coalesce(p.paid, 0) - coalesce(gl.definitive_cents, 0))::bigint AS pending_cents
  FROM public.hi_guides g
  LEFT JOIN LATERAL (
    SELECT sum(CASE a.kind WHEN 'allocation' THEN a.amount_cents ELSE -a.amount_cents END) AS paid
      FROM public.hi_payment_allocations a WHERE a.clinic_id = g.clinic_id AND a.guide_id = g.id
  ) p ON true
  LEFT JOIN LATERAL (
    SELECT sum(x.amount_cents) FILTER (WHERE x.status IN ('informed', 'under_analysis', 'contested', 'appeal_filed')) AS open_cents,
           sum(x.definitive_cents) AS definitive_cents,
           sum(x.reversed_cents) AS reversed_cents
      FROM public.hi_glosses x WHERE x.clinic_id = g.clinic_id AND x.guide_id = g.id
  ) gl ON true
 WHERE g.status IN ('sent', 'under_review', 'paid', 'partially_paid', 'partially_glossed', 'fully_glossed', 'closed');
--> statement-breakpoint
CREATE VIEW public.hi_payment_balances WITH (security_invoker = true) AS
SELECT p.clinic_id, p.id AS payment_id, p.insurer_id, p.batch_id, p.statement_ref, p.paid_on, p.source,
       p.amount_cents,
       coalesce(sum(CASE a.kind WHEN 'allocation' THEN a.amount_cents ELSE -a.amount_cents END), 0)::bigint AS allocated_cents,
       (p.amount_cents - coalesce(sum(CASE a.kind WHEN 'allocation' THEN a.amount_cents ELSE -a.amount_cents END), 0))::bigint
         AS unreconciled_cents
  FROM public.hi_payments p
  LEFT JOIN public.hi_payment_allocations a ON a.clinic_id = p.clinic_id AND a.payment_id = p.id
 GROUP BY p.clinic_id, p.id;
--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_glosses ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_glosses FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_glosses_tenant_access ON public.hi_glosses FOR ALL
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
ALTER TABLE public.hi_gloss_appeals ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_gloss_appeals FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_gloss_appeals_tenant_access ON public.hi_gloss_appeals FOR ALL
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
ALTER TABLE public.hi_gloss_appeal_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_gloss_appeal_items FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_gloss_appeal_items_tenant_access ON public.hi_gloss_appeal_items FOR ALL
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
ALTER TABLE public.hi_payments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_payments FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_payments_tenant_access ON public.hi_payments FOR ALL
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
ALTER TABLE public.hi_payment_allocations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_payment_allocations FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_payment_allocations_tenant_access ON public.hi_payment_allocations FOR ALL
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
ALTER TABLE public.hi_account_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_account_events FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_account_events_tenant_access ON public.hi_account_events FOR ALL
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

-- Runtime: só leitura; toda escrita pelas funções (EXECUTE).
REVOKE ALL ON public.hi_glosses, public.hi_gloss_appeals, public.hi_gloss_appeal_items, public.hi_payments,
  public.hi_payment_allocations, public.hi_account_events FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
GRANT SELECT ON public.hi_glosses, public.hi_gloss_appeals, public.hi_gloss_appeal_items, public.hi_payments,
  public.hi_payment_allocations, public.hi_account_events TO authenticated, service_role;--> statement-breakpoint
REVOKE ALL ON public.hi_guide_accounts, public.hi_payment_balances FROM PUBLIC, anon;--> statement-breakpoint
GRANT SELECT ON public.hi_guide_accounts, public.hi_payment_balances TO authenticated, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  public.hi_gloss_record(uuid, uuid, uuid, uuid, text, bigint, text, uuid, text, text),
  public.hi_gloss_transition(uuid, uuid, integer, text, text),
  public.hi_gloss_appeal_create(uuid, uuid, jsonb, text, text),
  public.hi_gloss_appeal_file(uuid, uuid, integer, text, date, text, text, uuid),
  public.hi_gloss_appeal_answer(uuid, uuid, integer, date, jsonb, text),
  public.hi_gloss_appeal_cancel(uuid, uuid, integer, text),
  public.hi_payment_record(uuid, uuid, uuid, text, date, bigint, text, uuid, text, text, jsonb),
  public.hi_payment_allocate(uuid, uuid, text, jsonb),
  public.hi_payment_reverse(uuid, uuid, text),
  public.hi_guide_reconcile(uuid, uuid, integer, text)
  TO authenticated, service_role;--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0152-hi-glosses-payments')
  ON CONFLICT DO NOTHING;
