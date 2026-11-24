-- =====================================================================
-- 0167 (CANDIDATA, fora do journal) — Convênios: itens executados adicionais da sessão SP/SADT
-- (P8.4), com a política P8.4-r APROVADA pelo fundador em 24/11/2026.
--
-- Critério da P8.4 (plano mestre): "itens executados adicionais: registro opcional no consultório
-- (só itens de contrato, sem campo clínico) e na conferência; o médico não é obrigado; a recepção
-- completa". Política P8.4-r (docs/convenios/decisao-p84r.md, "Decisão de 24/11"): registrar
-- sempre; nunca faturar automaticamente; incluir na guia só com autorização concedida e saldo,
-- quando o contrato exige, ou pela ação explícita do faturamento, quando não exige; a guia com item
-- pendente só é aprovada depois de incluir o item ou de aprová-la sem ele, com motivo.
--
-- GO condicional do DEV (24/11) para esta versão, depois dos gates de go-0167-dev.md. Prova em
-- Postgres descartável: scripts/security/health-insurance-extra-items-db.ts e
-- scripts/security/hi-0167-apply-rehearsal.ts (job convenios-synthetic-db.yml).
--
-- O QUE FAZ (só uma tabela hi_* nova e as funções dela; nenhum objeto existente muda):
--   hi_appointment_extra_items: o REGISTRO do item executado além do procedimento agendado, por
--   atendimento de convênio SP/SADT, e a DECISÃO de faturamento dele. Só item de contrato: código,
--   descrição e "exige autorização" vêm da linha do contrato (o banco copia). Nenhum campo
--   clínico, nenhum valor digitado (o valor só sai do contrato, na linha da guia).
--
--   Estados (`status`) e transições, todas pela pessoa da sessão (`hi_session_actor()`), que o
--   banco grava como autor de cada etapa:
--     recorded    registrado; a decisão de faturamento está pendente (nasce assim)
--     regularized a autorização concedida da solicitação da sessão foi ligada ao item (só quando o
--                 contrato exige); ainda fora da guia
--     included    está na guia: `guide_item_id` aponta a linha da guia, com a mesma quantidade, a
--                 mesma linha de contrato e, quando exige autorização, o consumo do saldo
--                 (`hi_authorization_consumptions`, chave `extra:<id>`) já lançado
--     excluded    não faturado por decisão, com motivo (10 a 300), quem e quando; o registro fica
--     cancelled   o registro estava errado, com motivo (3 a 300); o registro fica
--
--     recorded    → regularized  contrato exige; autorização da solicitação da sessão, concedida,
--                                do mesmo procedimento, senha válida na data da sessão, saldo ≥
--                                quantidade; guia da sessão não aprovada
--     recorded    → included     contrato NÃO exige; guia da sessão em edição
--     regularized → included     com o consumo do saldo lançado; guia da sessão em edição
--     included    → included     só se a linha da guia anterior morreu (guia cancelada) e nenhuma
--                                guia viva cobra o procedimento da sessão: o item entra na guia
--                                nova; o consumo não se repete
--     recorded | regularized → excluded   guia da sessão não aprovada (pode estar conferida:
--                                         "aprovar sem o item")
--     included → excluded        na mesma condição da reinclusão (guia anterior cancelada)
--     recorded | regularized → cancelled  guia da sessão em edição
--     excluded e cancelled são finais; nada é apagado (o runtime não tem DELETE).
--
--   Regras do registro (iguais às da versão de 23/11): atendimento com cobertura de convênio
--   SP/SADT viva na mesma clínica; linha de contrato SP/SADT da MESMA operadora (e do plano, quando
--   a linha tem plano); um item não cancelado por procedimento e atendimento (mais de um =
--   quantidade, 1 a 999); guia da sessão já fechada → nada entra.
--   Sem assinatura ativa → 23514 `qoro_premium_health_insurance` (`hi_premium_guard`, 0151);
--   módulo desligado → 55000 `hi_module_enabled` (`hi_module_guard`, 0164): as funções
--   existentes, na mesma ordem das tabelas da classe A (comercial primeiro).
--
-- O QUE NÃO FAZ: não decide permissão (a matriz I.2 e a exceção do médico ficam nas actions, como
-- no resto do módulo); não toca em `hi_guides`, `hi_guide_items`, autorização, livro ou Caixa —
-- a linha da guia e o consumo são gravados pelo serviço, pelas tabelas e gatilhos que já existem
-- (0146, 0147), e esta tabela só aceita apontar para eles depois de conferir que estão certos.
--
-- Sem BEGIN/COMMIT. Reversão executável: `0167_hi_appointment_extra_items.rollback.sql` (recusa se
-- houver item registrado; remove a tabela e as quatro funções) + a linha do ledger. Ensaio:
-- hi-0167-apply-rehearsal.ts.
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
  status text NOT NULL DEFAULT 'recorded',
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  authorization_item_id uuid,
  regularized_by uuid,
  regularized_at timestamptz,
  guide_item_id uuid,
  included_by uuid,
  included_at timestamptz,
  excluded_by uuid,
  excluded_at timestamptz,
  exclusion_reason text,
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text,
  CONSTRAINT hi_extra_items_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_extra_items_coverage_fk FOREIGN KEY (clinic_id, appointment_id)
    REFERENCES public.hi_appointment_coverages (clinic_id, appointment_id),
  CONSTRAINT hi_extra_items_contract_fk FOREIGN KEY (clinic_id, contract_line_id)
    REFERENCES public.hi_procedure_contracts (clinic_id, id),
  CONSTRAINT hi_extra_items_authorization_item_fk FOREIGN KEY (clinic_id, authorization_item_id)
    REFERENCES public.hi_authorization_items (clinic_id, id),
  CONSTRAINT hi_extra_items_guide_item_fk FOREIGN KEY (clinic_id, guide_item_id)
    REFERENCES public.hi_guide_items (clinic_id, id),
  CONSTRAINT hi_extra_items_codes_chk CHECK (
    table_code ~ '^[0-9]{2}$' AND char_length(btrim(procedure_code)) BETWEEN 1 AND 10
    AND char_length(btrim(description)) BETWEEN 1 AND 150
  ),
  CONSTRAINT hi_extra_items_quantity_chk CHECK (quantity BETWEEN 1 AND 999),
  CONSTRAINT hi_extra_items_source_chk CHECK (source IN ('consultorio', 'conferencia')),
  CONSTRAINT hi_extra_items_status_chk CHECK (status IN ('recorded', 'regularized', 'included', 'excluded', 'cancelled')),
  -- Cada etapa grava o que é dela, junto (vínculo + quem + quando), e só a etapa certa tem o seu.
  CONSTRAINT hi_extra_items_lifecycle_chk CHECK (
    (authorization_item_id IS NULL) = (regularized_by IS NULL) AND (regularized_by IS NULL) = (regularized_at IS NULL)
    AND (authorization_item_id IS NULL OR requires_authorization)
    AND (guide_item_id IS NULL) = (included_by IS NULL) AND (included_by IS NULL) = (included_at IS NULL)
    AND (excluded_by IS NULL) = (excluded_at IS NULL) AND (excluded_by IS NULL) = (exclusion_reason IS NULL)
    AND (cancelled_by IS NULL) = (cancelled_at IS NULL) AND (cancelled_by IS NULL) = (cancel_reason IS NULL)
    AND CASE status
      WHEN 'recorded' THEN authorization_item_id IS NULL AND guide_item_id IS NULL AND excluded_by IS NULL AND cancelled_by IS NULL
      WHEN 'regularized' THEN authorization_item_id IS NOT NULL AND guide_item_id IS NULL AND excluded_by IS NULL AND cancelled_by IS NULL
      WHEN 'included' THEN guide_item_id IS NOT NULL AND requires_authorization = (authorization_item_id IS NOT NULL)
                           AND excluded_by IS NULL AND cancelled_by IS NULL
      WHEN 'excluded' THEN excluded_by IS NOT NULL AND guide_item_id IS NULL AND cancelled_by IS NULL
      WHEN 'cancelled' THEN cancelled_by IS NOT NULL AND guide_item_id IS NULL AND excluded_by IS NULL
      ELSE false
    END
  ),
  CONSTRAINT hi_extra_items_reasons_chk CHECK (
    (exclusion_reason IS NULL OR char_length(btrim(exclusion_reason)) BETWEEN 10 AND 300)
    AND (cancel_reason IS NULL OR char_length(btrim(cancel_reason)) BETWEEN 3 AND 300)
  )
);
--> statement-breakpoint
-- O mesmo procedimento não é registrado duas vezes na sessão (o cancelado libera; o não faturado não).
CREATE UNIQUE INDEX hi_extra_items_active_uniq ON public.hi_appointment_extra_items
  (clinic_id, appointment_id, table_code, procedure_code) WHERE status <> 'cancelled';
--> statement-breakpoint
-- Uma linha da guia vale para um item só.
CREATE UNIQUE INDEX hi_extra_items_guide_item_uniq ON public.hi_appointment_extra_items
  (clinic_id, guide_item_id) WHERE guide_item_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX hi_extra_items_appointment_idx ON public.hi_appointment_extra_items (clinic_id, appointment_id);
--> statement-breakpoint

-- Etapa das guias vivas da sessão: 'none' (ainda sem guia), 'open' (dados pendentes ou para
-- conferir), 'reviewed' (conferida, ainda não aprovada) ou 'closed' (aprovada em diante).
-- Trava as guias (FOR SHARE, mesmo padrão da 0165) ANTES de ler a etapa: uma conferência ou
-- aprovação concorrente espera esta mudança terminar, ou esta espera a guia mudar e lê a etapa
-- nova (prova 16 de health-insurance-extra-items-db.ts).
CREATE FUNCTION public.hi_extra_item_guide_state(p_clinic uuid, p_appointment uuid) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_state text := 'none';
  v_status text;
BEGIN
  FOR v_status IN
    SELECT g.status::text FROM public.hi_guides g
     WHERE g.clinic_id = p_clinic AND g.live
       AND EXISTS (SELECT 1 FROM public.hi_guide_items i
                    WHERE i.clinic_id = g.clinic_id AND i.guide_id = g.id
                      AND i.appointment_id = p_appointment AND i.live)
     ORDER BY g.id
       FOR SHARE OF g
  LOOP
    IF v_status IN ('pending_data', 'ready_for_review') THEN
      IF v_state = 'none' THEN v_state := 'open'; END IF;
    ELSIF v_status = 'reviewed' THEN
      IF v_state IN ('none', 'open') THEN v_state := 'reviewed'; END IF;
    ELSE
      v_state := 'closed';
    END IF;
  END LOOP;
  RETURN v_state;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_extra_item_guide_state(uuid, uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- A autorização que regulariza o item: a da SOLICITAÇÃO da sessão (é a autorização que a guia
-- leva), do mesmo procedimento, concedida, com a senha válida na data da sessão e saldo para a
-- quantidade. Devolve o motivo da recusa, ou NULL quando serve.
CREATE FUNCTION public.hi_extra_item_authorization_problem(
  p_clinic uuid, p_appointment uuid, p_authorization_item uuid, p_table text, p_procedure text, p_quantity integer
) RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_request_auth uuid;
  v_day date;
  v_item record;
BEGIN
  SELECT r.authorization_id INTO v_request_auth
    FROM public.hi_appointment_coverages c
    JOIN public.hi_sadt_request_items ri ON ri.clinic_id = c.clinic_id AND ri.id = c.sadt_request_item_id
    JOIN public.hi_sadt_requests r ON r.clinic_id = ri.clinic_id AND r.id = ri.request_id
   WHERE c.clinic_id = p_clinic AND c.appointment_id = p_appointment;
  IF v_request_auth IS NULL THEN
    RETURN 'a solicitação desta sessão não tem autorização registrada';
  END IF;
  SELECT i.authorization_id, i.table_code, i.procedure_code, i.quantity_authorized, i.quantity_consumed,
         a.status::text AS auth_status, a.password_valid_until
    INTO v_item
    FROM public.hi_authorization_items i
    JOIN public.hi_authorizations a ON a.clinic_id = i.clinic_id AND a.id = i.authorization_id
   WHERE i.clinic_id = p_clinic AND i.id = p_authorization_item;
  IF NOT FOUND OR v_item.authorization_id <> v_request_auth THEN
    RETURN 'a autorização precisa ser a da solicitação desta sessão';
  END IF;
  IF v_item.table_code <> p_table OR v_item.procedure_code <> p_procedure THEN
    RETURN 'a autorização é de outro procedimento';
  END IF;
  IF v_item.auth_status NOT IN ('authorized', 'partially_authorized') THEN
    RETURN 'a autorização não está concedida pela operadora';
  END IF;
  SELECT (a.scheduled_at AT TIME ZONE coalesce(cl.timezone, 'America/Sao_Paulo'))::date INTO v_day
    FROM public.appointments a JOIN public.clinics cl ON cl.id = a.clinic_id
   WHERE a.clinic_id = p_clinic AND a.id = p_appointment;
  IF v_item.password_valid_until IS NOT NULL AND v_day > v_item.password_valid_until THEN
    RETURN 'a senha da autorização venceu antes da data da sessão';
  END IF;
  IF v_item.quantity_authorized - v_item.quantity_consumed < p_quantity THEN
    RETURN 'o saldo autorizado é menor que a quantidade executada';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_extra_item_authorization_problem(uuid, uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
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
  IF public.hi_extra_item_guide_state(NEW.clinic_id, NEW.appointment_id) NOT IN ('none', 'open') THEN
    RAISE EXCEPTION 'A guia desta sessão já foi fechada; reabra ou substitua a guia.'
      USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_guide_closed';
  END IF;
  -- Só item de contrato: o que vem da linha é copiado pelo banco; a decisão começa vazia.
  NEW.table_code := v_line.table_code;
  NEW.procedure_code := v_line.procedure_code;
  NEW.description := left(v_line.description, 150);
  NEW.requires_authorization := v_line.requires_authorization;
  NEW.status := 'recorded';
  NEW.recorded_by := v_actor;
  NEW.recorded_at := now();
  NEW.authorization_item_id := NULL;
  NEW.regularized_by := NULL;
  NEW.regularized_at := NULL;
  NEW.guide_item_id := NULL;
  NEW.included_by := NULL;
  NEW.included_at := NULL;
  NEW.excluded_by := NULL;
  NEW.excluded_at := NULL;
  NEW.exclusion_reason := NULL;
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

-- Alteração: o fato não muda; só as transições da política, pela pessoa da sessão.
CREATE FUNCTION public.hi_extra_item_update_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := public.hi_session_actor();
  v_state text;
  v_problem text;
  v_gi record;
  v_old_live boolean;
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
  IF OLD.status IN ('excluded', 'cancelled') THEN
    RAISE EXCEPTION 'Este item já foi decidido e não muda.' USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_closed';
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Mudar item executado exige a pessoa da sessão.' USING ERRCODE = '42501';
  END IF;
  -- Item já na guia só muda quando ela morreu (guia cancelada) e nenhuma guia viva cobra o mesmo
  -- procedimento da sessão (a substituta da P7.5 leva a cópia da linha e continua cobrando).
  IF OLD.status = 'included' THEN
    SELECT i.live INTO v_old_live FROM public.hi_guide_items i
     WHERE i.clinic_id = OLD.clinic_id AND i.id = OLD.guide_item_id;
    -- (a linha nova da reinclusão, gravada pelo serviço antes desta mudança, não conta)
    IF coalesce(v_old_live, false) OR EXISTS (
      SELECT 1 FROM public.hi_guide_items i
       WHERE i.clinic_id = OLD.clinic_id AND i.appointment_id = OLD.appointment_id AND i.live
         AND i.table_code = OLD.table_code AND i.procedure_code = OLD.procedure_code
         AND i.id IS DISTINCT FROM NEW.guide_item_id
    ) THEN
      RAISE EXCEPTION 'Este item já está na guia.' USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_closed';
    END IF;
  END IF;
  -- O vínculo com a autorização, uma vez feito, não muda (só a regularização o cria).
  IF NOT (OLD.status = 'recorded' AND NEW.status = 'regularized') THEN
    NEW.authorization_item_id := OLD.authorization_item_id;
    NEW.regularized_by := OLD.regularized_by;
    NEW.regularized_at := OLD.regularized_at;
  END IF;
  v_state := public.hi_extra_item_guide_state(OLD.clinic_id, OLD.appointment_id);

  IF OLD.status = 'recorded' AND NEW.status = 'regularized' THEN
    IF NOT OLD.requires_authorization OR NEW.authorization_item_id IS NULL THEN
      RAISE EXCEPTION 'Só se liga autorização a item cujo contrato exige autorização.'
        USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_transition';
    END IF;
    IF v_state = 'closed' THEN
      RAISE EXCEPTION 'A guia desta sessão já foi aprovada; reabra ou substitua a guia.'
        USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_guide_closed';
    END IF;
    v_problem := public.hi_extra_item_authorization_problem(OLD.clinic_id, OLD.appointment_id,
      NEW.authorization_item_id, OLD.table_code, OLD.procedure_code, OLD.quantity);
    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION 'Autorização não serve para este item: %.', v_problem
        USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_authorization';
    END IF;
    NEW.regularized_by := v_actor;
    NEW.regularized_at := now();
  ELSIF NEW.status = 'included' AND (OLD.status IN ('recorded', 'regularized') OR OLD.status = 'included') THEN
    IF OLD.status = 'included' THEN
      -- Reinclusão na guia nova da sessão (a anterior morreu; conferido acima).
      IF NEW.guide_item_id IS NOT DISTINCT FROM OLD.guide_item_id THEN
        RAISE EXCEPTION 'Este item já está na guia.' USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_closed';
      END IF;
    ELSIF OLD.requires_authorization AND OLD.status <> 'regularized' THEN
      RAISE EXCEPTION 'O contrato exige autorização: ligue a autorização concedida antes de incluir.'
        USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_authorization';
    END IF;
    IF v_state <> 'open' THEN
      RAISE EXCEPTION 'Itens só entram na guia em edição (dados pendentes ou para conferir).'
        USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_guide_closed';
    END IF;
    SELECT i.live, i.appointment_id, i.contract_line_id, i.table_code, i.procedure_code, i.quantity,
           i.authorization_item_id INTO v_gi
      FROM public.hi_guide_items i
     WHERE i.clinic_id = OLD.clinic_id AND i.id = NEW.guide_item_id;
    IF NOT FOUND OR NOT v_gi.live OR v_gi.appointment_id IS DISTINCT FROM OLD.appointment_id
       OR v_gi.contract_line_id <> OLD.contract_line_id OR v_gi.table_code <> OLD.table_code
       OR v_gi.procedure_code <> OLD.procedure_code OR v_gi.quantity <> OLD.quantity
       OR v_gi.authorization_item_id IS DISTINCT FROM OLD.authorization_item_id THEN
      RAISE EXCEPTION 'A linha da guia não corresponde ao item (sessão, contrato, procedimento, quantidade e autorização).'
        USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_guide_item';
    END IF;
    IF OLD.requires_authorization AND NOT EXISTS (
      SELECT 1 FROM public.hi_authorization_consumptions k
       WHERE k.clinic_id = OLD.clinic_id AND k.idempotency_key = 'extra:' || OLD.id::text
         AND k.item_id = OLD.authorization_item_id AND k.quantity = OLD.quantity AND k.reverses_id IS NULL
    ) THEN
      RAISE EXCEPTION 'O saldo da autorização não foi consumido para este item.'
        USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_consumption';
    END IF;
    NEW.included_by := v_actor;
    NEW.included_at := now();
  ELSIF OLD.status IN ('recorded', 'regularized', 'included') AND NEW.status = 'excluded' THEN
    IF v_state = 'closed' THEN
      RAISE EXCEPTION 'A guia desta sessão já foi aprovada; reabra ou substitua a guia.'
        USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_guide_closed';
    END IF;
    NEW.excluded_by := v_actor;
    NEW.excluded_at := now();
  ELSIF OLD.status IN ('recorded', 'regularized') AND NEW.status = 'cancelled' THEN
    IF v_state NOT IN ('none', 'open') THEN
      RAISE EXCEPTION 'A guia desta sessão já foi fechada; reabra ou substitua a guia.'
        USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_guide_closed';
    END IF;
    NEW.cancelled_by := v_actor;
    NEW.cancelled_at := now();
  ELSIF OLD.status = 'included' THEN
    RAISE EXCEPTION 'Este item já está na guia.' USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_closed';
  ELSE
    RAISE EXCEPTION 'Transição do item não permitida (% → %).', OLD.status, NEW.status
      USING ERRCODE = '23514', CONSTRAINT = 'hi_extra_item_transition';
  END IF;
  -- O que não é da etapa nova não é gravado por esta mudança.
  IF NEW.status <> 'included' THEN
    NEW.guide_item_id := NULL;
    NEW.included_by := NULL;
    NEW.included_at := NULL;
  END IF;
  IF NEW.status <> 'excluded' THEN
    NEW.excluded_by := NULL;
    NEW.excluded_at := NULL;
    NEW.exclusion_reason := NULL;
  END IF;
  IF NEW.status <> 'cancelled' THEN
    NEW.cancelled_by := NULL;
    NEW.cancelled_at := NULL;
    NEW.cancel_reason := NULL;
  END IF;
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
