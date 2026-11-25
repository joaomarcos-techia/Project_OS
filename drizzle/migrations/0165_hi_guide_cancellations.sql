-- =====================================================================
-- 0165 — Convênios: cancelamento da guia na operadora e substituição só com recibo (P7.5).
--
-- Política do fundador (16/11/2026): "A GUIA SUBSTITUTA NÃO DEVE SER APROVADA COMO SUBSTITUIÇÃO
-- EFETIVADA SEM A COMPROVAÇÃO NECESSÁRIA DO CANCELAMENTO DA GUIA ORIGINAL PERANTE A OPERADORA."
-- Estudo: docs/convenios/substituicao-guia.md (XSD 4.03.00 `cancelaGuia`/`reciboCancelaGuia`,
-- `dm_statusCancelamento` = Tabela 46 da TUSS: 1 cancelado com sucesso; 2 não cancelado; 3 guia
-- inexistente; 4 em processamento; 5 lote inexistente; 6 protocolo inexistente).
-- Autorizada para o DEV; NÃO autorizada em produção. Prova em Postgres descartável:
-- scripts/security/health-insurance-guide-cancellation-db.ts (job convenios-synthetic-db.yml).
--
-- O QUE FAZ (só tabelas hi_* do TISS):
--   1. hi_guide_cancellations: o PEDIDO de cancelamento à operadora, só para guia exportada,
--      enviada ou em análise (a de antes reabre; a de depois do resultado usa recurso de glosa).
--      Canal, data, motivo, o número da guia no prestador (copiado da guia pelo banco), o número na
--      operadora e o protocolo do lote quando informados, e, se gerado, o XML
--      `cancelaGuia` validado no XSD com o SHA-256. Um pedido ativo por guia. O autor é a pessoa
--      da sessão, nunca o chamador. Pedir é PRESERVAÇÃO (classe C): fato sobre trabalho já enviado;
--   2. hi_guide_cancellation_receipts: o RECIBO da operadora (Tabela 46), só inclusão, com
--      evidência (protocolo ou SHA-256 do comprovante) e data entre o pedido e hoje. O banco
--      atualiza a situação do pedido: 1 → confirmado; 2 → recusado; 3, 5 e 6 → divergência;
--      4 → continua aguardando (em processamento). Depois de resposta final, nada mais entra;
--   3. a aprovação da SUBSTITUTA (reviewed → approved com replaces_guide_id) só passa com o
--      cancelamento da original CONFIRMADO (código 1); senão, recusa com a mensagem do estado.
--      O gatilho dispara antes do hi_guides_c_replacement (ordem por nome), então a original não
--      vira "substituída" sem o recibo. A original nunca é apagada; nada no recebível ou no livro
--      muda aqui (a 0153 continua decidindo o recebível na substituição).
--
-- O QUE NÃO FAZ: não transmite nada à operadora (o envio eletrônico é a P6.5, sem operadora
-- homologada); não simula recibo; não cria guia nem recebível; não toca hi_files, lancamentos ou
-- Caixa. Recibo sintético nos testes é homologação INTERNA, não da operadora.
--
-- Sem BEGIN/COMMIT. Reversão (com o código que conhece o fluxo fora do ar):
--   DROP TRIGGER IF EXISTS hi_guides_bz_replacement_receipt ON public.hi_guides;
--   DROP FUNCTION IF EXISTS public.hi_guide_replacement_receipt_guard();
--   DROP TABLE IF EXISTS public.hi_guide_cancellation_receipts;
--   DROP TABLE IF EXISTS public.hi_guide_cancellations;
--   DROP FUNCTION IF EXISTS public.hi_guide_cancellation_receipt_apply();
--   DROP FUNCTION IF EXISTS public.hi_guide_cancellation_receipt_guard();
--   DROP FUNCTION IF EXISTS public.hi_guide_cancellation_update_guard();
--   DROP FUNCTION IF EXISTS public.hi_guide_cancellation_request_guard();
--   DELETE FROM public._schema_version WHERE version = '0165-hi-guide-cancellations';
-- =====================================================================

CREATE TABLE public.hi_guide_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  guide_id uuid NOT NULL,
  purpose text NOT NULL,
  channel text NOT NULL,
  requested_on date NOT NULL,
  reason text NOT NULL,
  guide_number text NOT NULL,
  operator_guide_number text,
  batch_protocol text,
  request_xml text,
  request_xml_sha256 text,
  status text NOT NULL DEFAULT 'awaiting_receipt',
  status_code text,
  version integer NOT NULL DEFAULT 1,
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_guide_cancellations_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_guide_cancellations_idem_uniq UNIQUE (clinic_id, idempotency_key),
  CONSTRAINT hi_guide_cancellations_guide_fk FOREIGN KEY (clinic_id, guide_id)
    REFERENCES public.hi_guides (clinic_id, id),
  CONSTRAINT hi_guide_cancellations_purpose_chk CHECK (purpose IN ('substitution', 'cancellation')),
  CONSTRAINT hi_guide_cancellations_channel_chk CHECK (channel IN ('portal', 'webservice', 'email', 'phone', 'other')),
  CONSTRAINT hi_guide_cancellations_status_chk CHECK (
    (status = 'awaiting_receipt' AND (status_code IS NULL OR status_code = '4'))
    OR (status = 'confirmed' AND status_code = '1')
    OR (status = 'refused' AND status_code = '2')
    OR (status = 'divergent' AND status_code IN ('3', '5', '6'))
  ),
  CONSTRAINT hi_guide_cancellations_text_chk CHECK (
    reason IS NOT NULL AND char_length(btrim(reason)) BETWEEN 10 AND 500
    AND guide_number IS NOT NULL AND char_length(guide_number) BETWEEN 1 AND 20
    AND (operator_guide_number IS NULL OR char_length(operator_guide_number) BETWEEN 1 AND 20)
    AND (batch_protocol IS NULL OR char_length(batch_protocol) BETWEEN 1 AND 12)
    AND idempotency_key IS NOT NULL AND char_length(idempotency_key) BETWEEN 8 AND 200
  ),
  CONSTRAINT hi_guide_cancellations_xml_chk CHECK (
    (request_xml IS NULL AND request_xml_sha256 IS NULL)
    OR (request_xml IS NOT NULL AND char_length(request_xml) <= 65536
        AND request_xml_sha256 IS NOT NULL AND request_xml_sha256 ~ '^[0-9a-f]{64}$')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX hi_guide_cancellations_active_uniq ON public.hi_guide_cancellations (clinic_id, guide_id)
  WHERE status IN ('awaiting_receipt', 'confirmed');
--> statement-breakpoint

CREATE TABLE public.hi_guide_cancellation_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  cancellation_id uuid NOT NULL,
  status_code text NOT NULL,
  received_on date NOT NULL,
  operator_protocol text,
  operator_message text,
  evidence_sha256 text,
  source text NOT NULL DEFAULT 'manual',
  idempotency_key text NOT NULL,
  recorded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_guide_cancellation_receipts_idem_uniq UNIQUE (clinic_id, idempotency_key),
  CONSTRAINT hi_guide_cancellation_receipts_cancellation_fk FOREIGN KEY (clinic_id, cancellation_id)
    REFERENCES public.hi_guide_cancellations (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_guide_cancellation_receipts_code_chk CHECK (status_code IN ('1', '2', '3', '4', '5', '6')),
  CONSTRAINT hi_guide_cancellation_receipts_source_chk CHECK (source IN ('manual', 'webservice')),
  CONSTRAINT hi_guide_cancellation_receipts_text_chk CHECK (
    (operator_protocol IS NULL OR char_length(operator_protocol) BETWEEN 1 AND 12)
    AND (operator_message IS NULL OR char_length(operator_message) <= 500)
    AND (evidence_sha256 IS NULL OR evidence_sha256 ~ '^[0-9a-f]{64}$')
    AND idempotency_key IS NOT NULL AND char_length(idempotency_key) BETWEEN 8 AND 200
  ),
  -- Recibo é fato da operadora: sem protocolo nem comprovante, não há recibo.
  CONSTRAINT hi_guide_cancellation_receipts_evidence_chk CHECK (operator_protocol IS NOT NULL OR evidence_sha256 IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX hi_guide_cancellation_receipts_request_idx ON public.hi_guide_cancellation_receipts (clinic_id, cancellation_id);
--> statement-breakpoint

-- Pedido: só de guia já enviada à operadora; números copiados da guia; autor = pessoa da sessão.
CREATE OR REPLACE FUNCTION public.hi_guide_cancellation_request_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := public.hi_session_actor();
  v_g record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Pedido de cancelamento exige a pessoa da sessão.' USING ERRCODE = '42501';
  END IF;
  SELECT g.status, g.number INTO v_g
    FROM public.hi_guides g WHERE g.clinic_id = NEW.clinic_id AND g.id = NEW.guide_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guia inexistente nesta clínica.' USING ERRCODE = '23503';
  END IF;
  IF v_g.status NOT IN ('exported', 'sent', 'under_review') THEN
    RAISE EXCEPTION 'Pedido de cancelamento à operadora só para guia exportada, enviada ou em análise (etapa atual: %). Antes do envio, reabra ou cancele no Qoro; depois do resultado, use o recurso de glosa.', v_g.status
      USING ERRCODE = '55000', CONSTRAINT = 'hi_guide_cancellation_state';
  END IF;
  IF NEW.requested_on > current_date THEN
    RAISE EXCEPTION 'A data do pedido está no futuro.' USING ERRCODE = '22023';
  END IF;
  NEW.guide_number := v_g.number;
  NEW.status := 'awaiting_receipt';
  NEW.status_code := NULL;
  NEW.version := 1;
  NEW.created_by := v_actor;
  NEW.created_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guide_cancellation_request_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_guide_cancellations_guard BEFORE INSERT ON public.hi_guide_cancellations
  FOR EACH ROW EXECUTE FUNCTION public.hi_guide_cancellation_request_guard();
--> statement-breakpoint

-- O pedido só muda pela resposta da operadora (a situação), uma vez, enquanto aguarda.
CREATE OR REPLACE FUNCTION public.hi_guide_cancellation_update_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status <> 'awaiting_receipt' THEN
    RAISE EXCEPTION 'Pedido de cancelamento com resposta final da operadora: não muda.' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'status_code' - 'version' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'status_code' - 'version' - 'updated_at')
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Pedido de cancelamento: só a resposta da operadora muda a situação.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guide_cancellation_update_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_guide_cancellations_update_guard BEFORE UPDATE ON public.hi_guide_cancellations
  FOR EACH ROW EXECUTE FUNCTION public.hi_guide_cancellation_update_guard();
--> statement-breakpoint

-- Recibo: o pedido travado precisa estar aguardando; data entre o pedido e hoje; autor da sessão.
CREATE OR REPLACE FUNCTION public.hi_guide_cancellation_receipt_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := public.hi_session_actor();
  v_c record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Recibo de cancelamento exige a pessoa da sessão.' USING ERRCODE = '42501';
  END IF;
  SELECT c.status, c.requested_on INTO v_c FROM public.hi_guide_cancellations c
   WHERE c.clinic_id = NEW.clinic_id AND c.id = NEW.cancellation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de cancelamento inexistente nesta clínica.' USING ERRCODE = '23503';
  END IF;
  IF v_c.status <> 'awaiting_receipt' THEN
    RAISE EXCEPTION 'O cancelamento já tem resposta final da operadora; registre um pedido novo se for o caso.'
      USING ERRCODE = '55000', CONSTRAINT = 'hi_guide_cancellation_final';
  END IF;
  IF NEW.received_on > current_date OR NEW.received_on < v_c.requested_on THEN
    RAISE EXCEPTION 'A data do recibo precisa estar entre a data do pedido e hoje.' USING ERRCODE = '22023';
  END IF;
  NEW.recorded_by := v_actor;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guide_cancellation_receipt_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_guide_cancellation_receipts_guard BEFORE INSERT ON public.hi_guide_cancellation_receipts
  FOR EACH ROW EXECUTE FUNCTION public.hi_guide_cancellation_receipt_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hi_guide_cancellation_receipt_apply() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.hi_guide_cancellations c
     SET status = CASE NEW.status_code WHEN '1' THEN 'confirmed' WHEN '2' THEN 'refused'
                                      WHEN '4' THEN 'awaiting_receipt' ELSE 'divergent' END,
         status_code = NEW.status_code,
         version = c.version + 1,
         updated_at = now()
   WHERE c.clinic_id = NEW.clinic_id AND c.id = NEW.cancellation_id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guide_cancellation_receipt_apply() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_guide_cancellation_receipts_apply AFTER INSERT ON public.hi_guide_cancellation_receipts
  FOR EACH ROW EXECUTE FUNCTION public.hi_guide_cancellation_receipt_apply();
--> statement-breakpoint
CREATE TRIGGER hi_guide_cancellation_receipts_immutable BEFORE UPDATE ON public.hi_guide_cancellation_receipts
  FOR EACH ROW EXECUTE FUNCTION public.hi_block_mutation();
--> statement-breakpoint

-- Aprovar a substituta exige o cancelamento da original CONFIRMADO pela operadora (Tabela 46 = 1).
-- Nome ordenado antes de hi_guides_c_replacement: sem recibo, a original não vira "substituída".
CREATE OR REPLACE FUNCTION public.hi_guide_replacement_receipt_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.replaces_guide_id IS NOT NULL AND OLD.status = 'reviewed' AND NEW.status = 'approved' THEN
    SELECT c.status INTO v_status FROM public.hi_guide_cancellations c
     WHERE c.clinic_id = NEW.clinic_id AND c.guide_id = NEW.replaces_guide_id
     ORDER BY (c.status = 'confirmed') DESC, c.created_at DESC
     LIMIT 1;
    IF v_status IS NULL THEN
      RAISE EXCEPTION 'A substituta só é aprovada com o cancelamento da guia original confirmado pela operadora: registre o pedido de cancelamento e o recibo (Tabela 46 = 1).'
        USING ERRCODE = '55000', CONSTRAINT = 'hi_guide_replacement_receipt';
    ELSIF v_status = 'awaiting_receipt' THEN
      RAISE EXCEPTION 'O cancelamento da guia original ainda não foi confirmado pela operadora (aguardando o recibo ou em processamento).'
        USING ERRCODE = '55000', CONSTRAINT = 'hi_guide_replacement_receipt';
    ELSIF v_status = 'refused' THEN
      RAISE EXCEPTION 'A operadora não cancelou a guia original (Tabela 46 = 2): não há substituição; depois do resultado, use o recurso de glosa.'
        USING ERRCODE = '55000', CONSTRAINT = 'hi_guide_replacement_receipt';
    ELSIF v_status = 'divergent' THEN
      RAISE EXCEPTION 'Divergência com a operadora (guia, lote ou protocolo inexistente): investigue antes de qualquer reenvio.'
        USING ERRCODE = '55000', CONSTRAINT = 'hi_guide_replacement_receipt';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guide_replacement_receipt_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_guides_bz_replacement_receipt BEFORE UPDATE ON public.hi_guides
  FOR EACH ROW EXECUTE FUNCTION public.hi_guide_replacement_receipt_guard();
--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_guide_cancellations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_guide_cancellations FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_guide_cancellations_tenant_access ON public.hi_guide_cancellations FOR ALL
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
ALTER TABLE public.hi_guide_cancellation_receipts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_guide_cancellation_receipts FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_guide_cancellation_receipts_tenant_access ON public.hi_guide_cancellation_receipts FOR ALL
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

REVOKE ALL ON public.hi_guide_cancellations, public.hi_guide_cancellation_receipts FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON public.hi_guide_cancellations, public.hi_guide_cancellation_receipts TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hi_guide_cancellations, public.hi_guide_cancellation_receipts TO service_role;
--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0165-hi-guide-cancellations')
  ON CONFLICT DO NOTHING;
