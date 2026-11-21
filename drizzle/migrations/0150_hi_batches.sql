-- =====================================================================
-- 0150 — Convênios (ADR-072): lotes TISS e o ciclo de faturamento (P1.9).
--
-- hi_batches         lote: operadora, tipo de guia, versão TISS, número, estado,
--                    contagens e total, hash do conteúdo e do epílogo, arquivo,
--                    envio (canal, quando, quem, evidência), protocolo e retorno.
-- hi_batch_guides    a guia no lote, presa ao SNAPSHOT aprovado que entrou nele
--                    (o XML sai dessa versão, não do dado atual); uma guia em um
--                    lote ativo só (índice único parcial).
-- hi_batch_events    histórico (sem dado pessoal), gravado pelas funções.
-- hi_batch_returns   protocolo, demonstrativos e conferência administrativa,
--                    idempotentes por SHA-256 (retorno repetido não aplica 2x).
-- hi_files           passa a guardar o XML do lote e documentos de retorno.
--
-- Estados (cada um é uma operação diferente, com prova própria):
--   prepared → validated → exported → sent → received → under_review → processed
--   cancelled: só antes do envio (as guias voltam a "aprovada").
--   reprocessamento antes do envio: exported/validated → prepared (arquivo novo
--   substitui o anterior na cadeia de versões; nada é sobrescrito).
--
-- O runtime só LÊ estas tabelas: toda escrita passa pelas funções SECURITY
-- DEFINER abaixo (o "código do banco com dono" que a 0147 exige para as
-- transições de lote da guia). Cada função confere a clínica da sessão.
-- Nenhuma escrita financeira aqui: o recebível da operadora é da P10.2.
-- Não toca tabela compartilhada (appointments, lancamentos).
-- =====================================================================

CREATE TABLE public.hi_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  insurer_id uuid NOT NULL,
  guide_type text NOT NULL,
  tiss_version text NOT NULL DEFAULT '4.03.00',
  number text NOT NULL,
  status text NOT NULL DEFAULT 'prepared',
  guide_count integer NOT NULL,
  item_count integer NOT NULL,
  total_value_cents bigint NOT NULL,
  transaction_number text,
  content_sha256 text,
  epilogue_hash text,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  file_id uuid,
  export_count integer NOT NULL DEFAULT 0,
  send_channel text,
  sent_on date,
  sent_at timestamptz,
  sent_by uuid,
  send_evidence text,
  send_count integer NOT NULL DEFAULT 0,
  protocol_number text,
  received_on date,
  received_at timestamptz,
  under_review_at timestamptz,
  processed_at timestamptz,
  processed_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  replaces_batch_id uuid,
  idempotency_key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_batches_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_batches_insurer_key UNIQUE (clinic_id, id, insurer_id),
  CONSTRAINT hi_batches_scope_key UNIQUE (clinic_id, id, insurer_id, guide_type),
  CONSTRAINT hi_batches_number_uniq UNIQUE (clinic_id, insurer_id, number),
  CONSTRAINT hi_batches_idem_uniq UNIQUE (clinic_id, idempotency_key),
  CONSTRAINT hi_batches_insurer_fk FOREIGN KEY (clinic_id, insurer_id)
    REFERENCES public.hi_insurers (clinic_id, id),
  CONSTRAINT hi_batches_replaces_fk FOREIGN KEY (clinic_id, replaces_batch_id, insurer_id, guide_type)
    REFERENCES public.hi_batches (clinic_id, id, insurer_id, guide_type),
  CONSTRAINT hi_batches_type_chk CHECK (guide_type IN ('consulta', 'sp_sadt')),
  CONSTRAINT hi_batches_tiss_chk CHECK (tiss_version IN ('4.03.00')),
  CONSTRAINT hi_batches_status_chk CHECK (status IN (
    'prepared', 'validated', 'exported', 'sent', 'received', 'under_review', 'processed', 'cancelled'
  )),
  -- numeroLote e sequencialTransacao: st_texto12.
  CONSTRAINT hi_batches_number_chk CHECK (number ~ '^[0-9]{1,12}$'),
  CONSTRAINT hi_batches_transaction_chk CHECK (transaction_number IS NULL OR transaction_number ~ '^[0-9]{1,12}$'),
  CONSTRAINT hi_batches_counts_chk CHECK (
    guide_count BETWEEN 1 AND 100 AND item_count >= guide_count
    AND total_value_cents BETWEEN 0 AND 999999999999 AND export_count >= 0 AND send_count >= 0 AND version >= 1
  ),
  CONSTRAINT hi_batches_idem_chk CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  CONSTRAINT hi_batches_hash_chk CHECK (
    (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$')
    AND (epilogue_hash IS NULL OR epilogue_hash ~ '^[0-9a-f]{32}$')
  ),
  CONSTRAINT hi_batches_validated_chk CHECK (
    status IN ('prepared', 'cancelled')
    OR (content_sha256 IS NOT NULL AND epilogue_hash IS NOT NULL AND transaction_number IS NOT NULL)
  ),
  CONSTRAINT hi_batches_exported_chk CHECK (
    status NOT IN ('exported', 'sent', 'received', 'under_review', 'processed')
    OR (file_id IS NOT NULL AND export_count >= 1)
  ),
  -- "Enviado" só com registro: canal, data, autor (manual) e evidência.
  CONSTRAINT hi_batches_sent_chk CHECK (
    status NOT IN ('sent', 'received', 'under_review', 'processed')
    OR (send_channel IN ('manual', 'connector') AND sent_on IS NOT NULL AND sent_at IS NOT NULL
        AND send_count >= 1 AND send_evidence IS NOT NULL AND char_length(btrim(send_evidence)) BETWEEN 10 AND 500
        AND (send_channel <> 'manual' OR sent_by IS NOT NULL))
  ),
  -- "Recebido" só com protocolo da operadora.
  CONSTRAINT hi_batches_received_chk CHECK (
    status NOT IN ('received', 'under_review', 'processed')
    OR (protocol_number IS NOT NULL AND protocol_number ~ '^[0-9A-Za-z./-]{1,30}$'
        AND received_on IS NOT NULL AND received_at IS NOT NULL)
  ),
  CONSTRAINT hi_batches_review_chk CHECK (status NOT IN ('under_review', 'processed') OR under_review_at IS NOT NULL),
  CONSTRAINT hi_batches_processed_chk CHECK (status <> 'processed' OR processed_at IS NOT NULL),
  CONSTRAINT hi_batches_cancelled_chk CHECK (
    status <> 'cancelled'
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL
        AND char_length(btrim(cancel_reason)) BETWEEN 10 AND 500)
  ),
  CONSTRAINT hi_batches_validation_chk CHECK (jsonb_typeof(validation) = 'object')
);
--> statement-breakpoint
-- Protocolo é da operadora: o mesmo número não serve a dois lotes dela.
CREATE UNIQUE INDEX hi_batches_protocol_uniq ON public.hi_batches (clinic_id, insurer_id, protocol_number)
  WHERE protocol_number IS NOT NULL;
--> statement-breakpoint
CREATE INDEX hi_batches_status_idx ON public.hi_batches (clinic_id, status, updated_at);
--> statement-breakpoint

CREATE TABLE public.hi_batch_guides (
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  guide_id uuid NOT NULL,
  insurer_id uuid NOT NULL,
  guide_type text NOT NULL,
  snapshot_id uuid NOT NULL,
  revision integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  CONSTRAINT hi_batch_guides_pk PRIMARY KEY (clinic_id, batch_id, guide_id),
  CONSTRAINT hi_batch_guides_batch_fk FOREIGN KEY (clinic_id, batch_id, insurer_id, guide_type)
    REFERENCES public.hi_batches (clinic_id, id, insurer_id, guide_type) ON DELETE CASCADE,
  CONSTRAINT hi_batch_guides_guide_fk FOREIGN KEY (clinic_id, guide_id, insurer_id, guide_type)
    REFERENCES public.hi_guides (clinic_id, id, insurer_id, guide_type),
  CONSTRAINT hi_batch_guides_snapshot_fk FOREIGN KEY (clinic_id, guide_id, snapshot_id)
    REFERENCES public.hi_guide_snapshots (clinic_id, guide_id, id),
  CONSTRAINT hi_batch_guides_active_chk CHECK (active = (removed_at IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX hi_batch_guides_active_uniq ON public.hi_batch_guides (clinic_id, guide_id) WHERE active;
--> statement-breakpoint

CREATE TABLE public.hi_batch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  action text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_id uuid,
  actor_kind text NOT NULL,
  note text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_batch_events_batch_fk FOREIGN KEY (clinic_id, batch_id)
    REFERENCES public.hi_batches (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_batch_events_action_chk CHECK (action IN (
    'created', 'validated', 'exported', 'sent', 'resent', 'protocol_recorded', 'under_review',
    'return_recorded', 'processed', 'reopened', 'cancelled'
  )),
  CONSTRAINT hi_batch_events_actor_chk CHECK (actor_kind IN ('user', 'system')),
  CONSTRAINT hi_batch_events_note_chk CHECK (note IS NULL OR char_length(note) <= 500)
);
--> statement-breakpoint
CREATE INDEX hi_batch_events_idx ON public.hi_batch_events (clinic_id, batch_id, created_at);
--> statement-breakpoint

-- ── hi_files: XML do lote e documentos de retorno ─────────────────────
ALTER TABLE public.hi_files ADD COLUMN batch_id uuid;
--> statement-breakpoint
ALTER TABLE public.hi_files ADD CONSTRAINT hi_files_batch_fk FOREIGN KEY (clinic_id, batch_id)
  REFERENCES public.hi_batches (clinic_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.hi_files DROP CONSTRAINT hi_files_kind_chk;
--> statement-breakpoint
ALTER TABLE public.hi_files ADD CONSTRAINT hi_files_kind_chk CHECK (kind IN (
  'guide_pdf', 'authorization_request_xml', 'authorization_request_pdf', 'batch_xml', 'batch_return'
));
--> statement-breakpoint
ALTER TABLE public.hi_files DROP CONSTRAINT hi_files_link_chk;
--> statement-breakpoint
ALTER TABLE public.hi_files ADD CONSTRAINT hi_files_link_chk CHECK (
  (kind = 'guide_pdf' AND guide_id IS NOT NULL AND snapshot_id IS NOT NULL AND authorization_id IS NULL AND batch_id IS NULL)
  OR (kind IN ('authorization_request_xml', 'authorization_request_pdf')
      AND authorization_id IS NOT NULL AND guide_id IS NULL AND snapshot_id IS NULL AND batch_id IS NULL)
  OR (kind IN ('batch_xml', 'batch_return')
      AND batch_id IS NOT NULL AND guide_id IS NULL AND snapshot_id IS NULL AND authorization_id IS NULL)
);
--> statement-breakpoint
ALTER TABLE public.hi_files DROP CONSTRAINT hi_files_media_chk;
--> statement-breakpoint
ALTER TABLE public.hi_files ADD CONSTRAINT hi_files_media_chk CHECK (
  (kind IN ('guide_pdf', 'authorization_request_pdf') AND media_type = 'application/pdf')
  OR (kind IN ('authorization_request_xml', 'batch_xml') AND media_type = 'application/xml')
  OR (kind = 'batch_return' AND media_type IN ('application/xml', 'application/pdf'))
);
--> statement-breakpoint
CREATE INDEX hi_files_batch_idx ON public.hi_files (clinic_id, batch_id) WHERE batch_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.hi_batches ADD CONSTRAINT hi_batches_file_fk FOREIGN KEY (clinic_id, file_id)
  REFERENCES public.hi_files (clinic_id, id);
--> statement-breakpoint

CREATE TABLE public.hi_batch_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  insurer_id uuid NOT NULL,
  kind text NOT NULL,
  content_sha256 text NOT NULL,
  file_id uuid,
  protocol_number text,
  received_on date NOT NULL,
  note text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_batch_returns_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_batch_returns_batch_fk FOREIGN KEY (clinic_id, batch_id, insurer_id)
    REFERENCES public.hi_batches (clinic_id, id, insurer_id) ON DELETE CASCADE,
  CONSTRAINT hi_batch_returns_file_fk FOREIGN KEY (clinic_id, file_id) REFERENCES public.hi_files (clinic_id, id),
  -- O mesmo documento de retorno só entra uma vez no lote.
  CONSTRAINT hi_batch_returns_once_uniq UNIQUE (clinic_id, batch_id, kind, content_sha256),
  CONSTRAINT hi_batch_returns_kind_chk CHECK (kind IN (
    'protocol_receipt', 'analysis_statement', 'payment_statement', 'administrative_conference'
  )),
  CONSTRAINT hi_batch_returns_sha_chk CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT hi_batch_returns_note_chk CHECK (note IS NULL OR char_length(note) <= 500),
  -- Conferência administrativa é de uma pessoa, com o que ela conferiu.
  CONSTRAINT hi_batch_returns_conference_chk CHECK (
    kind <> 'administrative_conference'
    OR (recorded_by IS NOT NULL AND note IS NOT NULL AND char_length(btrim(note)) >= 10)
  ),
  CONSTRAINT hi_batch_returns_protocol_chk CHECK (kind <> 'protocol_receipt' OR protocol_number IS NOT NULL)
);
--> statement-breakpoint

-- ── Arquivo: XML do lote só do conteúdo validado; versão nova da mesma origem ──
CREATE OR REPLACE FUNCTION public.hi_guard_file() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_status text;
  v_prev public.hi_files%ROWTYPE;
  v_batch public.hi_batches%ROWTYPE;
BEGIN
  IF NEW.kind = 'guide_pdf' THEN
    SELECT status INTO v_status FROM public.hi_guides WHERE id = NEW.guide_id AND clinic_id = NEW.clinic_id;
    IF v_status IS NULL OR v_status IN ('pending_data', 'ready_for_review', 'reviewed', 'cancelled') THEN
      RAISE EXCEPTION 'PDF oficial só de guia aprovada (estado atual: %).', v_status USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.kind = 'batch_xml' THEN
    SELECT * INTO v_batch FROM public.hi_batches WHERE id = NEW.batch_id AND clinic_id = NEW.clinic_id;
    IF NOT FOUND OR v_batch.status <> 'validated' THEN
      RAISE EXCEPTION 'XML de lote só de lote validado (estado atual: %).', coalesce(v_batch.status, 'inexistente')
        USING ERRCODE = '55000';
    END IF;
    IF NEW.content_sha256 IS DISTINCT FROM v_batch.content_sha256 OR NEW.tiss_version IS DISTINCT FROM v_batch.tiss_version THEN
      RAISE EXCEPTION 'O XML gravado difere do conteúdo validado do lote.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.supersedes_file_id IS NOT NULL THEN
    SELECT * INTO v_prev FROM public.hi_files WHERE id = NEW.supersedes_file_id AND clinic_id = NEW.clinic_id;
    IF v_prev.kind IS DISTINCT FROM NEW.kind OR v_prev.guide_id IS DISTINCT FROM NEW.guide_id
       OR v_prev.authorization_id IS DISTINCT FROM NEW.authorization_id
       OR v_prev.batch_id IS DISTINCT FROM NEW.batch_id THEN
      RAISE EXCEPTION 'A versão nova deve ser do mesmo tipo e da mesma origem do arquivo anterior.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guard_file() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- ── Defesa em profundidade: transições e campos imutáveis do lote ───────
-- Mesmo o código do banco com dono só faz as transições do ciclo; o runtime nem
-- tem UPDATE. (Não promete imutabilidade contra superusuário: S5.)
CREATE OR REPLACE FUNCTION public.hi_batch_transition() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_pair text;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
     OR NEW.insurer_id IS DISTINCT FROM OLD.insurer_id OR NEW.guide_type IS DISTINCT FROM OLD.guide_type
     OR NEW.tiss_version IS DISTINCT FROM OLD.tiss_version OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.replaces_batch_id IS DISTINCT FROM OLD.replaces_batch_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Operadora, tipo, versão, número e origem do lote não mudam.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_pair := OLD.status || '>' || NEW.status;
    IF v_pair NOT IN (
      'prepared>validated', 'validated>exported', 'exported>sent', 'sent>received', 'received>under_review',
      'under_review>processed', 'validated>prepared', 'exported>prepared',
      'prepared>cancelled', 'validated>cancelled', 'exported>cancelled'
    ) THEN
      RAISE EXCEPTION 'Transição de lote não permitida: % → %.', OLD.status, NEW.status USING ERRCODE = '55000';
    END IF;
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_batch_transition() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_batches_transition BEFORE UPDATE ON public.hi_batches
  FOR EACH ROW EXECUTE FUNCTION public.hi_batch_transition();
--> statement-breakpoint
CREATE TRIGGER hi_batch_events_immutable BEFORE UPDATE ON public.hi_batch_events
  FOR EACH ROW EXECUTE FUNCTION public.hi_block_mutation();
--> statement-breakpoint
CREATE TRIGGER hi_batch_returns_immutable BEFORE UPDATE ON public.hi_batch_returns
  FOR EACH ROW EXECUTE FUNCTION public.hi_block_mutation();
--> statement-breakpoint

-- ── Contexto da sessão: a função só age na clínica da sessão ────────────
CREATE OR REPLACE FUNCTION public.hi_session_clinic(p_clinic_id uuid) RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_clinic_id IS NULL OR current_setting('app.current_clinic', true) IS DISTINCT FROM p_clinic_id::text THEN
    RAISE EXCEPTION 'Operação de lote fora da clínica da sessão.' USING ERRCODE = '42501';
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_session_clinic(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hi_session_actor() RETURNS uuid
  LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v text := current_setting('app.current_user', true);
BEGIN
  IF v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v::uuid;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_session_actor() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- Lote da sessão, travado, na versão esperada.
CREATE OR REPLACE FUNCTION public.hi_batch_lock(p_clinic_id uuid, p_batch_id uuid, p_version integer)
  RETURNS public.hi_batches
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_batch public.hi_batches%ROWTYPE;
BEGIN
  PERFORM public.hi_session_clinic(p_clinic_id);
  SELECT * INTO v_batch FROM public.hi_batches WHERE id = p_batch_id AND clinic_id = p_clinic_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote inexistente nesta clínica.' USING ERRCODE = '23503';
  END IF;
  IF p_version IS NOT NULL AND v_batch.version <> p_version THEN
    RAISE EXCEPTION 'O lote mudou (versão % ≠ %); recarregue.', v_batch.version, p_version USING ERRCODE = '40001';
  END IF;
  RETURN v_batch;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_batch_lock(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hi_batch_log(
  p_batch public.hi_batches, p_action text, p_from text, p_note text, p_details jsonb
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := public.hi_session_actor();
BEGIN
  INSERT INTO public.hi_batch_events (clinic_id, batch_id, action, from_status, to_status, actor_id, actor_kind, note, details)
  VALUES (p_batch.clinic_id, p_batch.id, p_action, p_from, p_batch.status, v_actor,
          CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END, p_note, coalesce(p_details, '{}'::jsonb));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_batch_log(public.hi_batches, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- Move as guias ATIVAS do lote para o estado da etapa (transição de guia do dono, 0147).
CREATE OR REPLACE FUNCTION public.hi_batch_move_guides(p_batch public.hi_batches, p_to text)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.hi_guides g SET status = p_to
    FROM public.hi_batch_guides bg
   WHERE bg.clinic_id = p_batch.clinic_id AND bg.batch_id = p_batch.id AND bg.active
     AND g.clinic_id = bg.clinic_id AND g.id = bg.guide_id AND g.status IS DISTINCT FROM p_to;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_batch_move_guides(public.hi_batches, text) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- ── 1. Formar o lote ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hi_batch_create(
  p_clinic_id uuid, p_insurer_id uuid, p_guide_type text, p_guide_ids uuid[], p_idempotency_key text,
  p_replaces_batch_id uuid DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_existing public.hi_batches%ROWTYPE;
  v_ids uuid[];
  v_n integer;
  v_found integer;
  v_bad text;
  v_number bigint;
  v_batch public.hi_batches%ROWTYPE;
  v_items integer;
  v_total bigint;
  v_prev_status text;
BEGIN
  PERFORM public.hi_session_clinic(p_clinic_id);
  SELECT * INTO v_existing FROM public.hi_batches WHERE clinic_id = p_clinic_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN v_existing.id; -- mesma chave: o mesmo lote (repetição do pedido)
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_guide_ids) x WHERE x IS NOT NULL;
  v_n := coalesce(cardinality(v_ids), 0);
  IF v_n = 0 OR v_n > 100 THEN
    RAISE EXCEPTION 'Lote com % guias: o Padrão TISS aceita de 1 a 100 por lote.', v_n USING ERRCODE = '23514';
  END IF;
  IF v_n <> cardinality(p_guide_ids) THEN
    RAISE EXCEPTION 'A mesma guia apareceu mais de uma vez no pedido do lote.' USING ERRCODE = '23514';
  END IF;

  -- Trava as guias em ordem (sem deadlock entre dois lotes concorrentes).
  PERFORM 1 FROM public.hi_guides WHERE clinic_id = p_clinic_id AND id = ANY (v_ids) ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_found FROM public.hi_guides WHERE clinic_id = p_clinic_id AND id = ANY (v_ids);
  IF v_found <> v_n THEN
    RAISE EXCEPTION 'Guia inexistente nesta clínica no pedido do lote.' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hi_batch_guides WHERE clinic_id = p_clinic_id AND guide_id = ANY (v_ids) AND active) THEN
    RAISE EXCEPTION 'Guia já está em outro lote ativo.' USING ERRCODE = '23505';
  END IF;
  SELECT string_agg(DISTINCT CASE
           WHEN insurer_id <> p_insurer_id THEN 'operadora'
           WHEN guide_type <> p_guide_type THEN 'tipo'
           WHEN tiss_version <> '4.03.00' THEN 'versão'
           WHEN status <> 'approved' OR NOT live OR approved_snapshot_id IS NULL THEN 'estado'
         END, ',') INTO v_bad
    FROM public.hi_guides WHERE clinic_id = p_clinic_id AND id = ANY (v_ids);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Lote só com guias aprovadas da mesma operadora, do mesmo tipo e da mesma versão TISS (divergência: %).', v_bad
      USING ERRCODE = '23514';
  END IF;
  IF p_replaces_batch_id IS NOT NULL THEN
    SELECT status INTO v_prev_status FROM public.hi_batches
     WHERE clinic_id = p_clinic_id AND id = p_replaces_batch_id AND insurer_id = p_insurer_id AND guide_type = p_guide_type;
    IF v_prev_status IS DISTINCT FROM 'cancelled' THEN
      RAISE EXCEPTION 'Lote substituto só de lote cancelado da mesma operadora e tipo.' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT count(*), coalesce(sum(i.total_value_cents), 0) INTO v_items, v_total
    FROM public.hi_guide_items i WHERE i.clinic_id = p_clinic_id AND i.guide_id = ANY (v_ids);
  v_number := public.hi_next_counter(p_clinic_id, 'batch', '');
  INSERT INTO public.hi_batches
    (clinic_id, insurer_id, guide_type, number, status, guide_count, item_count, total_value_cents,
     replaces_batch_id, idempotency_key, created_by)
  VALUES (p_clinic_id, p_insurer_id, p_guide_type, v_number::text, 'prepared', v_n, v_items,
          (SELECT coalesce(sum(total_value_cents), 0) FROM public.hi_guides WHERE clinic_id = p_clinic_id AND id = ANY (v_ids)),
          p_replaces_batch_id, p_idempotency_key, public.hi_session_actor())
  RETURNING * INTO v_batch;
  IF v_batch.total_value_cents <> v_total THEN
    RAISE EXCEPTION 'Total das guias (%) difere da soma dos itens (%).', v_batch.total_value_cents, v_total
      USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.hi_batch_guides (clinic_id, batch_id, guide_id, insurer_id, guide_type, snapshot_id, revision)
  SELECT g.clinic_id, v_batch.id, g.id, g.insurer_id, g.guide_type, g.approved_snapshot_id, g.revision
    FROM public.hi_guides g WHERE g.clinic_id = p_clinic_id AND g.id = ANY (v_ids);
  PERFORM public.hi_batch_move_guides(v_batch, 'in_batch');
  PERFORM public.hi_batch_log(v_batch, 'created', NULL, NULL,
    jsonb_build_object('guides', v_n, 'items', v_items, 'totalCents', v_batch.total_value_cents));
  RETURN v_batch.id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_batch_create(uuid, uuid, text, uuid[], text, uuid) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── 2. Validado: o app gerou o XML a partir dos snapshots e TODAS as camadas passaram ──
CREATE OR REPLACE FUNCTION public.hi_batch_validate(
  p_clinic_id uuid, p_batch_id uuid, p_version integer, p_transaction_number text,
  p_content_sha256 text, p_epilogue_hash text, p_validation jsonb
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_batch public.hi_batches%ROWTYPE := public.hi_batch_lock(p_clinic_id, p_batch_id, p_version);
  v_drift integer;
BEGIN
  IF v_batch.status <> 'prepared' THEN
    RAISE EXCEPTION 'Só se valida lote preparado (estado: %).', v_batch.status USING ERRCODE = '55000';
  END IF;
  IF coalesce(p_validation->>'xsd', '') <> 'valid' OR coalesce(p_validation->>'internal', '') <> 'valid'
     OR coalesce(p_validation->>'hash', '') <> 'valid' OR coalesce(p_validation->>'encoding', '') <> 'valid' THEN
    RAISE EXCEPTION 'Lote só fica validado com XSD, regras internas, hash e codificação aprovados.' USING ERRCODE = '23514';
  END IF;
  -- A guia não pode ter mudado depois de entrar no lote (o XML sai do snapshot que entrou).
  SELECT count(*) INTO v_drift FROM public.hi_batch_guides bg
    JOIN public.hi_guides g ON g.clinic_id = bg.clinic_id AND g.id = bg.guide_id
   WHERE bg.clinic_id = p_clinic_id AND bg.batch_id = p_batch_id AND bg.active
     AND (g.status <> 'in_batch' OR g.approved_snapshot_id IS DISTINCT FROM bg.snapshot_id OR g.revision <> bg.revision);
  IF v_drift > 0 THEN
    RAISE EXCEPTION '% guia(s) do lote mudaram depois de entrar nele.', v_drift USING ERRCODE = '55000';
  END IF;
  IF (p_validation->>'guides')::integer IS DISTINCT FROM v_batch.guide_count
     OR (p_validation->>'items')::integer IS DISTINCT FROM v_batch.item_count THEN
    RAISE EXCEPTION 'Contagem do XML (% guias, % itens) difere do lote (% guias, % itens).',
      p_validation->>'guides', p_validation->>'items', v_batch.guide_count, v_batch.item_count USING ERRCODE = '23514';
  END IF;
  UPDATE public.hi_batches SET status = 'validated', transaction_number = p_transaction_number,
         content_sha256 = p_content_sha256, epilogue_hash = p_epilogue_hash, validation = p_validation
   WHERE id = p_batch_id RETURNING * INTO v_batch;
  PERFORM public.hi_batch_log(v_batch, 'validated', 'prepared', NULL,
    jsonb_build_object('contentSha256', p_content_sha256, 'epilogueHash', p_epilogue_hash));
  RETURN v_batch.version;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_batch_validate(uuid, uuid, integer, text, text, text, jsonb) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── 3. Exportado: arquivo gravado (privado, cifrado) e conferido pelo banco ──
CREATE OR REPLACE FUNCTION public.hi_batch_export(
  p_clinic_id uuid, p_batch_id uuid, p_version integer, p_file_id uuid
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_batch public.hi_batches%ROWTYPE := public.hi_batch_lock(p_clinic_id, p_batch_id, p_version);
  v_file public.hi_files%ROWTYPE;
BEGIN
  IF v_batch.status <> 'validated' THEN
    RAISE EXCEPTION 'Só se exporta lote validado (estado: %).', v_batch.status USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_file FROM public.hi_files WHERE id = p_file_id AND clinic_id = p_clinic_id;
  IF NOT FOUND OR v_file.kind <> 'batch_xml' OR v_file.batch_id IS DISTINCT FROM p_batch_id
     OR v_file.content_sha256 IS DISTINCT FROM v_batch.content_sha256 THEN
    RAISE EXCEPTION 'Arquivo do lote ausente ou diferente do conteúdo validado.' USING ERRCODE = '23514';
  END IF;
  IF v_batch.file_id IS NOT NULL AND v_file.supersedes_file_id IS DISTINCT FROM v_batch.file_id THEN
    RAISE EXCEPTION 'Reexportação: o arquivo novo deve substituir o anterior na cadeia de versões.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.hi_batches SET status = 'exported', file_id = p_file_id, export_count = export_count + 1
   WHERE id = p_batch_id RETURNING * INTO v_batch;
  PERFORM public.hi_batch_move_guides(v_batch, 'exported');
  PERFORM public.hi_batch_log(v_batch, 'exported', 'validated', NULL,
    jsonb_build_object('fileId', p_file_id, 'exportCount', v_batch.export_count));
  RETURN v_batch.version;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_batch_export(uuid, uuid, integer, uuid) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── Reprocessar antes do envio: volta a preparado (o arquivo anterior fica) ──
CREATE OR REPLACE FUNCTION public.hi_batch_reopen(
  p_clinic_id uuid, p_batch_id uuid, p_version integer, p_note text
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_batch public.hi_batches%ROWTYPE := public.hi_batch_lock(p_clinic_id, p_batch_id, p_version);
  v_from text := v_batch.status;
BEGIN
  IF v_batch.status NOT IN ('validated', 'exported') THEN
    RAISE EXCEPTION 'Só se reprocessa lote validado ou exportado e ainda não enviado (estado: %).', v_batch.status
      USING ERRCODE = '55000';
  END IF;
  IF public.hi_session_actor() IS NULL OR p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'Reprocessar exige um usuário e o motivo (10 a 500 caracteres).' USING ERRCODE = '23514';
  END IF;
  IF v_from = 'exported' THEN
    PERFORM public.hi_batch_move_guides(v_batch, 'approved');
  END IF;
  UPDATE public.hi_batches SET status = 'prepared', content_sha256 = NULL, epilogue_hash = NULL,
         transaction_number = NULL, validation = '{}'::jsonb
   WHERE id = p_batch_id RETURNING * INTO v_batch;
  PERFORM public.hi_batch_move_guides(v_batch, 'in_batch');
  PERFORM public.hi_batch_log(v_batch, 'reopened', v_from, p_note, jsonb_build_object('previousFileId', v_batch.file_id));
  RETURN v_batch.version;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_batch_reopen(uuid, uuid, integer, text) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── 4. Enviado (e reenvio rastreado): só com registro e evidência ───────
CREATE OR REPLACE FUNCTION public.hi_batch_mark_sent(
  p_clinic_id uuid, p_batch_id uuid, p_version integer, p_channel text, p_sent_on date, p_evidence text
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_batch public.hi_batches%ROWTYPE := public.hi_batch_lock(p_clinic_id, p_batch_id, p_version);
  v_actor uuid := public.hi_session_actor();
  v_from text := v_batch.status;
BEGIN
  IF v_batch.status NOT IN ('exported', 'sent') THEN
    RAISE EXCEPTION 'Só se registra envio de lote exportado (estado: %).', v_batch.status USING ERRCODE = '55000';
  END IF;
  IF p_channel NOT IN ('manual', 'connector') OR (p_channel = 'manual' AND v_actor IS NULL) THEN
    RAISE EXCEPTION 'Envio manual é registrado por um usuário; conector só com recibo.' USING ERRCODE = '42501';
  END IF;
  IF p_evidence IS NULL OR char_length(btrim(p_evidence)) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'Envio exige a evidência (portal, e-mail ou recibo do conector; 10 a 500 caracteres).' USING ERRCODE = '23514';
  END IF;
  IF p_sent_on IS NULL OR p_sent_on > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Data de envio ausente ou no futuro.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.hi_batches SET status = 'sent', send_channel = p_channel, sent_on = p_sent_on, sent_at = now(),
         sent_by = v_actor, send_evidence = btrim(p_evidence), send_count = send_count + 1
   WHERE id = p_batch_id RETURNING * INTO v_batch;
  IF v_from = 'exported' THEN
    PERFORM public.hi_batch_move_guides(v_batch, 'sent');
  END IF;
  PERFORM public.hi_batch_log(v_batch, CASE WHEN v_from = 'sent' THEN 'resent' ELSE 'sent' END, v_from,
    btrim(p_evidence), jsonb_build_object('channel', p_channel, 'sentOn', p_sent_on, 'sendCount', v_batch.send_count));
  RETURN v_batch.version;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_batch_mark_sent(uuid, uuid, integer, text, date, text) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── 5. Recebido pela operadora: só com protocolo (idempotente) ──────────
CREATE OR REPLACE FUNCTION public.hi_batch_record_protocol(
  p_clinic_id uuid, p_batch_id uuid, p_version integer, p_protocol text, p_received_on date,
  p_evidence_sha256 text, p_note text
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_batch public.hi_batches%ROWTYPE := public.hi_batch_lock(p_clinic_id, p_batch_id, NULL);
BEGIN
  IF v_batch.status IN ('received', 'under_review', 'processed') THEN
    IF v_batch.protocol_number = p_protocol THEN
      RETURN v_batch.version; -- o mesmo protocolo de novo: nada muda
    END IF;
    RAISE EXCEPTION 'O lote já tem o protocolo %; outro protocolo não substitui.', v_batch.protocol_number
      USING ERRCODE = '55000';
  END IF;
  IF p_version IS NOT NULL AND v_batch.version <> p_version THEN
    RAISE EXCEPTION 'O lote mudou (versão % ≠ %); recarregue.', v_batch.version, p_version USING ERRCODE = '40001';
  END IF;
  IF v_batch.status <> 'sent' THEN
    RAISE EXCEPTION 'Protocolo só de lote enviado (estado: %).', v_batch.status USING ERRCODE = '55000';
  END IF;
  IF p_received_on IS NULL OR p_received_on < v_batch.sent_on THEN
    RAISE EXCEPTION 'Data do protocolo ausente ou anterior ao envio.' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.hi_batch_returns (clinic_id, batch_id, insurer_id, kind, content_sha256, protocol_number,
    received_on, note, recorded_by)
  VALUES (p_clinic_id, p_batch_id, v_batch.insurer_id, 'protocol_receipt', p_evidence_sha256, p_protocol,
    p_received_on, p_note, public.hi_session_actor());
  UPDATE public.hi_batches SET status = 'received', protocol_number = p_protocol, received_on = p_received_on,
         received_at = now()
   WHERE id = p_batch_id RETURNING * INTO v_batch;
  PERFORM public.hi_batch_log(v_batch, 'protocol_recorded', 'sent', p_note,
    jsonb_build_object('protocol', p_protocol, 'receivedOn', p_received_on));
  RETURN v_batch.version;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_batch_record_protocol(uuid, uuid, integer, text, date, text, text) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── 6. Em análise na operadora ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hi_batch_mark_under_review(
  p_clinic_id uuid, p_batch_id uuid, p_version integer
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_batch public.hi_batches%ROWTYPE := public.hi_batch_lock(p_clinic_id, p_batch_id, p_version);
BEGIN
  IF v_batch.status <> 'received' THEN
    RAISE EXCEPTION 'Em análise só depois do protocolo (estado: %).', v_batch.status USING ERRCODE = '55000';
  END IF;
  UPDATE public.hi_batches SET status = 'under_review', under_review_at = now()
   WHERE id = p_batch_id RETURNING * INTO v_batch;
  PERFORM public.hi_batch_move_guides(v_batch, 'under_review');
  PERFORM public.hi_batch_log(v_batch, 'under_review', 'received', NULL, '{}'::jsonb);
  RETURN v_batch.version;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_batch_mark_under_review(uuid, uuid, integer) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── Retorno (demonstrativo ou conferência): idempotente por SHA ─────────
CREATE OR REPLACE FUNCTION public.hi_batch_record_return(
  p_clinic_id uuid, p_batch_id uuid, p_kind text, p_content_sha256 text, p_file_id uuid,
  p_received_on date, p_note text
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_batch public.hi_batches%ROWTYPE := public.hi_batch_lock(p_clinic_id, p_batch_id, NULL);
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.hi_batch_returns
   WHERE clinic_id = p_clinic_id AND batch_id = p_batch_id AND kind = p_kind AND content_sha256 = p_content_sha256;
  IF FOUND THEN
    RETURN v_id; -- o mesmo retorno de novo: aplicado uma vez só
  END IF;
  IF p_kind NOT IN ('analysis_statement', 'payment_statement', 'administrative_conference') THEN
    RAISE EXCEPTION 'Tipo de retorno inválido: %.', p_kind USING ERRCODE = '23514';
  END IF;
  IF v_batch.status NOT IN ('under_review', 'processed') THEN
    RAISE EXCEPTION 'Retorno só de lote em análise na operadora (estado: %).', v_batch.status USING ERRCODE = '55000';
  END IF;
  IF p_file_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.hi_files f WHERE f.id = p_file_id AND f.clinic_id = p_clinic_id
       AND f.kind = 'batch_return' AND f.batch_id = p_batch_id AND f.content_sha256 = p_content_sha256
  ) THEN
    RAISE EXCEPTION 'O arquivo do retorno deve ser deste lote e ter o mesmo SHA-256.' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.hi_batch_returns (clinic_id, batch_id, insurer_id, kind, content_sha256, file_id,
    received_on, note, recorded_by)
  VALUES (p_clinic_id, p_batch_id, v_batch.insurer_id, p_kind, p_content_sha256, p_file_id,
    p_received_on, p_note, public.hi_session_actor())
  RETURNING id INTO v_id;
  PERFORM public.hi_batch_log(v_batch, 'return_recorded', v_batch.status, p_note,
    jsonb_build_object('kind', p_kind, 'returnId', v_id));
  RETURN v_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_batch_record_return(uuid, uuid, text, text, uuid, date, text) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── 7. Processado: só com retorno ou conferência registrados ────────────
CREATE OR REPLACE FUNCTION public.hi_batch_mark_processed(
  p_clinic_id uuid, p_batch_id uuid, p_version integer
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_batch public.hi_batches%ROWTYPE := public.hi_batch_lock(p_clinic_id, p_batch_id, p_version);
BEGIN
  IF v_batch.status <> 'under_review' THEN
    RAISE EXCEPTION 'Processado só depois da análise (estado: %).', v_batch.status USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hi_batch_returns r WHERE r.clinic_id = p_clinic_id AND r.batch_id = p_batch_id
                   AND r.kind IN ('analysis_statement', 'payment_statement', 'administrative_conference')) THEN
    RAISE EXCEPTION 'Processado só com retorno da operadora ou conferência administrativa registrados.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.hi_batches SET status = 'processed', processed_at = now(), processed_by = public.hi_session_actor()
   WHERE id = p_batch_id RETURNING * INTO v_batch;
  -- O desfecho de cada guia (paga, glosada) vem do demonstrativo (P9.5/P9.6), não daqui.
  PERFORM public.hi_batch_log(v_batch, 'processed', 'under_review', NULL, '{}'::jsonb);
  RETURN v_batch.version;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_batch_mark_processed(uuid, uuid, integer) FROM PUBLIC, anon;
--> statement-breakpoint

-- ── Cancelar antes do envio: guias voltam a aprovadas ──────────────────
CREATE OR REPLACE FUNCTION public.hi_batch_cancel(
  p_clinic_id uuid, p_batch_id uuid, p_version integer, p_reason text
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_batch public.hi_batches%ROWTYPE := public.hi_batch_lock(p_clinic_id, p_batch_id, p_version);
  v_actor uuid := public.hi_session_actor();
  v_from text := v_batch.status;
BEGIN
  IF v_batch.status NOT IN ('prepared', 'validated', 'exported') THEN
    RAISE EXCEPTION 'Lote enviado não se cancela; trate pela operadora (estado: %).', v_batch.status USING ERRCODE = '55000';
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Cancelar lote é decisão de um usuário.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.hi_batch_move_guides(v_batch, 'approved');
  UPDATE public.hi_batch_guides SET active = false, removed_at = now()
   WHERE clinic_id = p_clinic_id AND batch_id = p_batch_id AND active;
  UPDATE public.hi_batches SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor,
         cancel_reason = btrim(p_reason)
   WHERE id = p_batch_id RETURNING * INTO v_batch;
  PERFORM public.hi_batch_log(v_batch, 'cancelled', v_from, btrim(p_reason), '{}'::jsonb);
  RETURN v_batch.version;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_batch_cancel(uuid, uuid, integer, text) FROM PUBLIC, anon;
--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_batches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_batches FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_batches_tenant_access ON public.hi_batches FOR ALL
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
ALTER TABLE public.hi_batch_guides ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_batch_guides FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_batch_guides_tenant_access ON public.hi_batch_guides FOR ALL
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
ALTER TABLE public.hi_batch_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_batch_events FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_batch_events_tenant_access ON public.hi_batch_events FOR ALL
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
ALTER TABLE public.hi_batch_returns ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_batch_returns FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_batch_returns_tenant_access ON public.hi_batch_returns FOR ALL
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

-- Runtime: só leitura das tabelas do lote; toda escrita pelas funções (EXECUTE).
REVOKE ALL ON public.hi_batches, public.hi_batch_guides, public.hi_batch_events, public.hi_batch_returns
  FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
GRANT SELECT ON public.hi_batches, public.hi_batch_guides, public.hi_batch_events, public.hi_batch_returns
  TO authenticated, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  public.hi_batch_create(uuid, uuid, text, uuid[], text, uuid),
  public.hi_batch_validate(uuid, uuid, integer, text, text, text, jsonb),
  public.hi_batch_export(uuid, uuid, integer, uuid),
  public.hi_batch_reopen(uuid, uuid, integer, text),
  public.hi_batch_mark_sent(uuid, uuid, integer, text, date, text),
  public.hi_batch_record_protocol(uuid, uuid, integer, text, date, text, text),
  public.hi_batch_mark_under_review(uuid, uuid, integer),
  public.hi_batch_record_return(uuid, uuid, text, text, uuid, date, text),
  public.hi_batch_mark_processed(uuid, uuid, integer),
  public.hi_batch_cancel(uuid, uuid, integer, text)
  TO authenticated, service_role;--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0150-hi-batches')
  ON CONFLICT DO NOTHING;
