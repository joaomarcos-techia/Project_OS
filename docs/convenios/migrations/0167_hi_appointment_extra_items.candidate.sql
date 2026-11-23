-- =====================================================================
-- 0167 (CANDIDATA, fora do journal) — Convênios: itens executados adicionais da sessão SP/SADT (P8.4).
--
-- Critério da P8.4 (plano mestre): "itens executados adicionais: registro opcional no consultório
-- (só itens de contrato, sem campo clínico) e na conferência; o médico não é obrigado; a recepção
-- completa". Contexto (B.9, item 7): a SP/SADT com vários itens precisa de itens executados
-- adicionais ligados ao atendimento, porque o agendamento tem um procedimento só.
--
-- NÃO autorizada no DEV nem em produção. Prova em Postgres descartável:
-- scripts/security/health-insurance-extra-items-db.ts (job convenios-synthetic-db.yml).
--
-- O QUE FAZ (só uma tabela hi_* nova; nada em tabela existente):
--   hi_appointment_extra_items: o REGISTRO do item executado além do procedimento agendado, por
--   atendimento de convênio SP/SADT. Só item de contrato: código, descrição e "exige autorização"
--   vêm da linha do contrato (o banco copia; o que o cliente mandar nesses campos é ignorado).
--   Nenhum campo clínico, nenhum valor digitado (o valor só sai do contrato, na guia).
--   - nasce `active`, com quem registrou = a pessoa da sessão (`hi_session_actor()`);
--   - só passa a `cancelled`, com motivo, por uma pessoa da sessão; cancelado não volta;
--   - um item ativo por procedimento e atendimento (mais de um = quantidade);
--   - o atendimento precisa ter cobertura de convênio SP/SADT viva na mesma clínica, e a linha
--     de contrato tem de ser SP/SADT da MESMA operadora (e do plano, quando a linha tem plano);
--   - com a guia da sessão já fechada (aprovada em diante), nem inclusão nem cancelamento: a
--     mudança passa pela reabertura/substituição da guia, que tem fluxo próprio;
--   - sem assinatura ativa → 23514 `qoro_premium_health_insurance` (`hi_premium_guard`, 0151);
--     módulo desligado → 55000 `hi_module_enabled` (`hi_module_guard`, 0164): as funções
--     existentes, na mesma ordem das tabelas da classe A (comercial primeiro).
--
-- O QUE NÃO FAZ: não fatura nada. Se e como o item entra na guia é a decisão P8.4-r do fundador
-- (item executado sem solicitação prévia); até ela, o código não muda a guia. Não toca em
-- autorização, consumo, recebível, livro ou Caixa. O runtime não tem DELETE.
--
-- Sem BEGIN/COMMIT. Reversão executável: `0167_hi_appointment_extra_items.rollback.sql` (recusa se
-- houver item registrado; remove a tabela e as TRÊS funções, inclusive `hi_extra_item_guide_closed`,
-- que a nota anterior deixava para trás) + a linha do ledger. Ensaio: hi-0167-apply-rehearsal.ts.
-- =====================================================================

CREATE TABLE public.hi_appointment_extra_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL,
  contract_line_id uuid NOT NULL,
  table_code text NOT NULL,
  procedure_code text NOT NULL,
  description text NOT NULL,
  requires_authorization boolean NOT NULL,
  quantity integer NOT NULL,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text,
  CONSTRAINT hi_extra_items_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_extra_items_coverage_fk FOREIGN KEY (clinic_id, appointment_id)
    REFERENCES public.hi_appointment_coverages (clinic_id, appointment_id),
  CONSTRAINT hi_extra_items_contract_fk FOREIGN KEY (clinic_id, contract_line_id)
    REFERENCES public.hi_procedure_contracts (clinic_id, id),
  CONSTRAINT hi_extra_items_codes_chk CHECK (
    table_code ~ '^[0-9]{2}$' AND char_length(btrim(procedure_code)) BETWEEN 1 AND 10
    AND char_length(btrim(description)) BETWEEN 1 AND 150
  ),
  CONSTRAINT hi_extra_items_quantity_chk CHECK (quantity BETWEEN 1 AND 999),
  CONSTRAINT hi_extra_items_source_chk CHECK (source IN ('consultorio', 'conferencia')),
  CONSTRAINT hi_extra_items_status_chk CHECK (
    (status = 'active' AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancel_reason IS NULL)
    OR (status = 'cancelled' AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL
        AND cancel_reason IS NOT NULL AND char_length(btrim(cancel_reason)) BETWEEN 3 AND 300)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX hi_extra_items_active_uniq ON public.hi_appointment_extra_items
  (clinic_id, appointment_id, table_code, procedure_code) WHERE status = 'active';
--> statement-breakpoint
CREATE INDEX hi_extra_items_appointment_idx ON public.hi_appointment_extra_items (clinic_id, appointment_id);
--> statement-breakpoint

-- Guia da sessão já fechada? (aprovada em diante: o conteúdo emitido não muda por aqui)
CREATE FUNCTION public.hi_extra_item_guide_closed(p_clinic uuid, p_appointment uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.hi_guide_items i
      JOIN public.hi_guides g ON g.clinic_id = i.clinic_id AND g.id = i.guide_id
     WHERE i.clinic_id = p_clinic AND i.appointment_id = p_appointment AND i.live
       AND g.status NOT IN ('pending_data', 'ready_for_review')
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_extra_item_guide_closed(uuid, uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- Inclusão: comercial, depois o módulo (gatilhos hi_a_* e hi_ab_*), depois as regras do item.
CREATE FUNCTION public.hi_extra_item_insert_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := public.hi_session_actor();
  v_cov record;
  v_line record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Registrar item executado exige a pessoa da sessão.' USING ERRCODE = '42501';
  END IF;
  SELECT c.guide_type, c.insurer_id, c.plan_id, c.status INTO v_cov
    FROM public.hi_appointment_coverages c
   WHERE c.clinic_id = NEW.clinic_id AND c.appointment_id = NEW.appointment_id;
  IF NOT FOUND OR v_cov.guide_type <> 'sp_sadt' OR v_cov.status = 'cancelled' THEN
    RAISE EXCEPTION 'Item executado adicional só em atendimento de convênio SP/SADT.'
      USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_coverage';
  END IF;
  SELECT l.insurer_id, l.plan_id, l.guide_type, l.table_code, l.procedure_code, l.description,
         l.requires_authorization INTO v_line
    FROM public.hi_procedure_contracts l
   WHERE l.clinic_id = NEW.clinic_id AND l.id = NEW.contract_line_id;
  IF NOT FOUND OR v_line.guide_type <> 'sp_sadt' OR v_line.insurer_id <> v_cov.insurer_id
     OR (v_line.plan_id IS NOT NULL AND v_line.plan_id IS DISTINCT FROM v_cov.plan_id) THEN
    RAISE EXCEPTION 'O item precisa ser do contrato SP/SADT da operadora do atendimento.'
      USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_contract';
  END IF;
  IF public.hi_extra_item_guide_closed(NEW.clinic_id, NEW.appointment_id) THEN
    RAISE EXCEPTION 'A guia desta sessão já foi fechada; reabra ou substitua a guia.'
      USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_guide_closed';
  END IF;
  -- Só item de contrato: o que vem da linha é copiado pelo banco.
  NEW.table_code := v_line.table_code;
  NEW.procedure_code := v_line.procedure_code;
  NEW.description := left(v_line.description, 150);
  NEW.requires_authorization := v_line.requires_authorization;
  NEW.status := 'active';
  NEW.recorded_by := v_actor;
  NEW.recorded_at := now();
  NEW.cancelled_by := NULL;
  NEW.cancelled_at := NULL;
  NEW.cancel_reason := NULL;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_extra_item_insert_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- Ordem alfabética dos gatilhos: hi_aa_premium (comercial, 0151) → hi_ab_module (0164) → hi_b_* (regras).
CREATE TRIGGER hi_aa_premium_extra_items BEFORE INSERT ON public.hi_appointment_extra_items
  FOR EACH ROW EXECUTE FUNCTION public.hi_premium_guard();
--> statement-breakpoint
CREATE TRIGGER hi_ab_module_extra_items BEFORE INSERT ON public.hi_appointment_extra_items
  FOR EACH ROW EXECUTE FUNCTION public.hi_module_guard();
--> statement-breakpoint
CREATE TRIGGER hi_b_extra_items_insert_guard BEFORE INSERT ON public.hi_appointment_extra_items
  FOR EACH ROW EXECUTE FUNCTION public.hi_extra_item_insert_guard();
--> statement-breakpoint

-- Alteração: o fato não muda; só ativo → cancelado, com motivo, pela pessoa da sessão.
CREATE FUNCTION public.hi_extra_item_update_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := public.hi_session_actor();
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
     OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
     OR NEW.contract_line_id IS DISTINCT FROM OLD.contract_line_id
     OR NEW.table_code IS DISTINCT FROM OLD.table_code OR NEW.procedure_code IS DISTINCT FROM OLD.procedure_code
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.requires_authorization IS DISTINCT FROM OLD.requires_authorization
     OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at THEN
    RAISE EXCEPTION 'O item executado não pode ser alterado; cancele e registre de novo.'
      USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_immutable';
  END IF;
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Item cancelado não muda.' USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_closed';
  END IF;
  IF NEW.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'Transição do item não permitida.' USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_transition';
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Cancelar item executado exige a pessoa da sessão.' USING ERRCODE = '42501';
  END IF;
  IF public.hi_extra_item_guide_closed(OLD.clinic_id, OLD.appointment_id) THEN
    RAISE EXCEPTION 'A guia desta sessão já foi fechada; reabra ou substitua a guia.'
      USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_guide_closed';
  END IF;
  NEW.cancelled_by := v_actor;
  NEW.cancelled_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_extra_item_update_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_b_extra_items_update_guard BEFORE UPDATE ON public.hi_appointment_extra_items
  FOR EACH ROW EXECUTE FUNCTION public.hi_extra_item_update_guard();
--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_appointment_extra_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_appointment_extra_items FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_appointment_extra_items_tenant_access ON public.hi_appointment_extra_items FOR ALL
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

REVOKE ALL ON public.hi_appointment_extra_items FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.hi_appointment_extra_items TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hi_appointment_extra_items TO service_role;
--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0167-hi-appointment-extra-items')
  ON CONFLICT DO NOTHING;
