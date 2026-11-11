-- =====================================================================
-- 0146 — Convênios (ADR-072): autorizações da operadora. P1.7 do plano mestre.
--
-- hi_authorizations        pedido e resposta da operadora, por carteirinha
-- hi_authorization_items   procedimento: quantidade pedida, autorizada e consumida
-- hi_authorization_consumptions  consumo/estorno append-only (idempotente, com trava)
-- hi_authorization_attachments   comprovante: só metadados e SHA-256; os bytes
--                                ficam no armazenamento privado (D20 revisada, seção N.7)
-- hi_authorization_events  histórico de estados (append-only)
--
-- Regras:
--  - NENHUMA autorização fictícia: estado autorizado exige data, quem registrou
--    e evidência da operadora (número da guia na operadora, senha ou protocolo;
--    pelo conector, o recibo). Ver o CHECK `hi_authorizations_evidence_chk`.
--  - senha só cifrada por clínica (encryptForTenant), nunca em claro;
--  - consumo nunca passa do autorizado, salvo exceção explícita (quem aprovou e
--    por quê); a quantidade consumida é mantida por gatilho com a linha do item
--    travada (concorrência) e a chave de idempotência impede consumo dobrado;
--  - estorno é um lançamento reverso que aponta o original (uma vez só);
--  - `version` incrementa a cada UPDATE da autorização (concorrência otimista);
--  - tudo da mesma clínica por FK composta (clinic_id, id).
--
-- Sem BEGIN/COMMIT. Só aditiva.
--
-- Rollback (sem dado de produção ainda):
--   DROP TABLE IF EXISTS public.hi_authorization_events, public.hi_authorization_attachments,
--     public.hi_authorization_consumptions, public.hi_authorization_items,
--     public.hi_authorizations CASCADE;
--   DROP FUNCTION IF EXISTS public.hi_apply_authorization_consumption();
--   DROP FUNCTION IF EXISTS public.hi_bump_authorization_version();
--   DROP FUNCTION IF EXISTS public.hi_block_mutation();
--   DELETE FROM public._schema_version WHERE version = '0146-hi-authorizations';
-- =====================================================================

CREATE TABLE public.hi_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  insurer_id uuid NOT NULL,
  plan_id uuid,
  membership_id uuid NOT NULL,
  guide_type text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  origin text NOT NULL,
  requested_on date,
  operator_guide_number text,
  operator_protocol text,
  password_encrypted text,
  authorized_on date,
  password_valid_until date,
  connector_receipt jsonb,
  denial_reason text,
  recorded_by uuid,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_authorizations_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_authorizations_insurer_fk FOREIGN KEY (clinic_id, insurer_id)
    REFERENCES public.hi_insurers (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_authorizations_plan_fk FOREIGN KEY (clinic_id, plan_id)
    REFERENCES public.hi_plans (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_authorizations_membership_fk FOREIGN KEY (clinic_id, membership_id)
    REFERENCES public.hi_memberships (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_authorizations_guide_type_chk CHECK (guide_type IN ('consulta', 'sp_sadt')),
  CONSTRAINT hi_authorizations_status_chk CHECK (status IN (
    'draft', 'requested', 'pending_operator', 'authorized', 'partially_authorized',
    'denied', 'expired', 'cancelled'
  )),
  CONSTRAINT hi_authorizations_origin_chk CHECK (origin IN ('manual', 'connector')),
  CONSTRAINT hi_authorizations_lengths_chk CHECK (
    (operator_guide_number IS NULL OR char_length(operator_guide_number) BETWEEN 1 AND 20)
    AND (operator_protocol IS NULL OR char_length(operator_protocol) BETWEEN 1 AND 40)
    AND (password_encrypted IS NULL OR char_length(password_encrypted) >= 24)
    AND (denial_reason IS NULL OR char_length(btrim(denial_reason)) BETWEEN 3 AND 500)
  ),
  -- Autorização só com evidência da operadora: nada de "autorizado" inventado.
  CONSTRAINT hi_authorizations_evidence_chk CHECK (
    status NOT IN ('authorized', 'partially_authorized')
    OR (
      authorized_on IS NOT NULL
      AND recorded_by IS NOT NULL
      AND (operator_guide_number IS NOT NULL OR password_encrypted IS NOT NULL OR operator_protocol IS NOT NULL)
      AND (origin <> 'connector' OR connector_receipt IS NOT NULL)
    )
  ),
  CONSTRAINT hi_authorizations_denied_chk CHECK (status <> 'denied' OR (denial_reason IS NOT NULL AND recorded_by IS NOT NULL)),
  CONSTRAINT hi_authorizations_dates_chk CHECK (
    (password_valid_until IS NULL OR authorized_on IS NULL OR password_valid_until >= authorized_on)
    AND (authorized_on IS NULL OR requested_on IS NULL OR authorized_on >= requested_on)
  ),
  CONSTRAINT hi_authorizations_receipt_chk CHECK (connector_receipt IS NULL OR jsonb_typeof(connector_receipt) = 'object'),
  CONSTRAINT hi_authorizations_version_chk CHECK (version >= 1)
);
--> statement-breakpoint
CREATE INDEX hi_authorizations_membership_idx ON public.hi_authorizations (clinic_id, membership_id, status);
--> statement-breakpoint
CREATE UNIQUE INDEX hi_authorizations_operator_number_uniq
  ON public.hi_authorizations (clinic_id, insurer_id, operator_guide_number)
  WHERE operator_guide_number IS NOT NULL AND status <> 'cancelled';
--> statement-breakpoint

CREATE TABLE public.hi_authorization_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  authorization_id uuid NOT NULL,
  table_code text NOT NULL,
  procedure_code text NOT NULL,
  quantity_requested integer NOT NULL,
  quantity_authorized integer NOT NULL DEFAULT 0,
  quantity_consumed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_authorization_items_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_authorization_items_authorization_fk FOREIGN KEY (clinic_id, authorization_id)
    REFERENCES public.hi_authorizations (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_authorization_items_code_uniq UNIQUE (authorization_id, table_code, procedure_code),
  CONSTRAINT hi_authorization_items_codes_chk CHECK (
    table_code ~ '^[0-9]{2}$' AND char_length(btrim(procedure_code)) BETWEEN 1 AND 10
  ),
  CONSTRAINT hi_authorization_items_quantities_chk CHECK (
    quantity_requested BETWEEN 1 AND 999
    AND quantity_authorized BETWEEN 0 AND 999
    AND quantity_consumed >= 0
  )
);
--> statement-breakpoint

CREATE TABLE public.hi_authorization_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  quantity integer NOT NULL,
  idempotency_key text NOT NULL,
  reverses_id uuid,
  overrun_reason text,
  overrun_approved_by uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_authorization_consumptions_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_authorization_consumptions_item_fk FOREIGN KEY (clinic_id, item_id)
    REFERENCES public.hi_authorization_items (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_authorization_consumptions_reverses_fk FOREIGN KEY (clinic_id, reverses_id)
    REFERENCES public.hi_authorization_consumptions (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_authorization_consumptions_idem_uniq UNIQUE (clinic_id, idempotency_key),
  CONSTRAINT hi_authorization_consumptions_reverse_once UNIQUE (reverses_id),
  CONSTRAINT hi_authorization_consumptions_idem_chk CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  CONSTRAINT hi_authorization_consumptions_quantity_chk CHECK (
    quantity <> 0
    AND ((reverses_id IS NULL AND quantity > 0) OR (reverses_id IS NOT NULL AND quantity < 0))
  ),
  CONSTRAINT hi_authorization_consumptions_overrun_chk CHECK (
    (overrun_reason IS NULL AND overrun_approved_by IS NULL)
    OR (char_length(btrim(overrun_reason)) BETWEEN 10 AND 500 AND overrun_approved_by IS NOT NULL)
  )
);
--> statement-breakpoint

CREATE TABLE public.hi_authorization_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  authorization_id uuid NOT NULL,
  storage_ref text NOT NULL,
  content_sha256 text NOT NULL,
  ciphertext_sha256 text NOT NULL,
  size_bytes integer NOT NULL,
  media_type text NOT NULL,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_authorization_attachments_authorization_fk FOREIGN KEY (clinic_id, authorization_id)
    REFERENCES public.hi_authorizations (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_authorization_attachments_ref_uniq UNIQUE (storage_ref),
  CONSTRAINT hi_authorization_attachments_ref_chk CHECK (storage_ref ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  CONSTRAINT hi_authorization_attachments_sha_chk CHECK (
    content_sha256 ~ '^[0-9a-f]{64}$' AND ciphertext_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT hi_authorization_attachments_size_chk CHECK (size_bytes BETWEEN 1 AND 10485760),
  CONSTRAINT hi_authorization_attachments_type_chk CHECK (
    media_type IN ('application/pdf', 'image/png', 'image/jpeg', 'application/xml', 'text/xml')
  )
);
--> statement-breakpoint

CREATE TABLE public.hi_authorization_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  authorization_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_authorization_events_authorization_fk FOREIGN KEY (clinic_id, authorization_id)
    REFERENCES public.hi_authorizations (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_authorization_events_note_chk CHECK (note IS NULL OR char_length(note) <= 500)
);
--> statement-breakpoint
CREATE INDEX hi_authorization_events_idx ON public.hi_authorization_events (clinic_id, authorization_id, created_at);
--> statement-breakpoint

-- Consumo: trava a linha do item, confere o saldo e atualiza a quantidade consumida.
CREATE OR REPLACE FUNCTION public.hi_apply_authorization_consumption() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_item public.hi_authorization_items%ROWTYPE;
  v_status text;
  v_original public.hi_authorization_consumptions%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM public.hi_authorization_items
   WHERE id = NEW.item_id AND clinic_id = NEW.clinic_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de autorização inexistente.' USING ERRCODE = '23503';
  END IF;
  -- Idempotência antes do saldo: retentativa com a mesma chave responde "já registrado"
  -- (23505), nunca "sem saldo". Conferido depois da trava, então concorrente vê o confirmado.
  IF EXISTS (
    SELECT 1 FROM public.hi_authorization_consumptions
     WHERE clinic_id = NEW.clinic_id AND idempotency_key = NEW.idempotency_key
  ) THEN
    RAISE EXCEPTION 'Consumo já registrado para esta chave de idempotência.'
      USING ERRCODE = '23505', CONSTRAINT = 'hi_authorization_consumptions_idem_uniq';
  END IF;
  IF NEW.reverses_id IS NOT NULL THEN
    SELECT * INTO v_original FROM public.hi_authorization_consumptions
     WHERE id = NEW.reverses_id AND clinic_id = NEW.clinic_id;
    IF v_original.item_id <> NEW.item_id OR NEW.quantity <> -v_original.quantity THEN
      RAISE EXCEPTION 'O estorno deve devolver exatamente o consumo original do mesmo item.' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT status INTO v_status FROM public.hi_authorizations
     WHERE id = v_item.authorization_id AND clinic_id = NEW.clinic_id;
    IF v_status NOT IN ('authorized', 'partially_authorized') THEN
      RAISE EXCEPTION 'Só se consome autorização concedida pela operadora (estado atual: %).', v_status USING ERRCODE = '55000';
    END IF;
    IF v_item.quantity_consumed + NEW.quantity > v_item.quantity_authorized AND NEW.overrun_approved_by IS NULL THEN
      RAISE EXCEPTION 'Consumo acima do autorizado (% de %), sem exceção aprovada.',
        v_item.quantity_consumed + NEW.quantity, v_item.quantity_authorized USING ERRCODE = '23514';
    END IF;
  END IF;
  UPDATE public.hi_authorization_items
     SET quantity_consumed = quantity_consumed + NEW.quantity, updated_at = now()
   WHERE id = NEW.item_id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_apply_authorization_consumption() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_authorization_consumptions_apply
  BEFORE INSERT ON public.hi_authorization_consumptions
  FOR EACH ROW EXECUTE FUNCTION public.hi_apply_authorization_consumption();
--> statement-breakpoint

-- Registros append-only (consumo, anexos, histórico): sem UPDATE.
CREATE OR REPLACE FUNCTION public.hi_block_mutation() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Registro de convênio só de inclusão (%).', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_block_mutation() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_authorization_consumptions_immutable BEFORE UPDATE ON public.hi_authorization_consumptions
  FOR EACH ROW EXECUTE FUNCTION public.hi_block_mutation();
--> statement-breakpoint
CREATE TRIGGER hi_authorization_attachments_immutable BEFORE UPDATE ON public.hi_authorization_attachments
  FOR EACH ROW EXECUTE FUNCTION public.hi_block_mutation();
--> statement-breakpoint
CREATE TRIGGER hi_authorization_events_immutable BEFORE UPDATE ON public.hi_authorization_events
  FOR EACH ROW EXECUTE FUNCTION public.hi_block_mutation();
--> statement-breakpoint

-- Versão da autorização (concorrência otimista na aplicação: UPDATE … WHERE version = $esperada).
CREATE OR REPLACE FUNCTION public.hi_bump_authorization_version() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
     OR NEW.insurer_id IS DISTINCT FROM OLD.insurer_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Operadora, carteirinha e clínica da autorização não mudam.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_bump_authorization_version() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_authorizations_version BEFORE UPDATE ON public.hi_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.hi_bump_authorization_version();
--> statement-breakpoint
CREATE TRIGGER trg_hi_authorization_items_updated_at BEFORE UPDATE ON public.hi_authorization_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_authorizations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_authorizations FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_authorizations_tenant_access ON public.hi_authorizations FOR ALL
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
ALTER TABLE public.hi_authorization_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_authorization_items FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_authorization_items_tenant_access ON public.hi_authorization_items FOR ALL
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
ALTER TABLE public.hi_authorization_consumptions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_authorization_consumptions FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_authorization_consumptions_tenant_access ON public.hi_authorization_consumptions FOR ALL
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
ALTER TABLE public.hi_authorization_attachments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_authorization_attachments FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_authorization_attachments_tenant_access ON public.hi_authorization_attachments FOR ALL
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
ALTER TABLE public.hi_authorization_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_authorization_events FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_authorization_events_tenant_access ON public.hi_authorization_events FOR ALL
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

-- Runtime: autorização e itens com SELECT/INSERT/UPDATE; consumo, anexos e histórico
-- só SELECT/INSERT (append-only). DELETE nunca para o runtime.
REVOKE ALL ON public.hi_authorizations, public.hi_authorization_items, public.hi_authorization_consumptions,
  public.hi_authorization_attachments, public.hi_authorization_events FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.hi_authorizations TO authenticated;--> statement-breakpoint
-- Itens: o runtime só muda as quantidades pedida e autorizada. `quantity_consumed`
-- muda SÓ pelo gatilho de consumo (SECURITY DEFINER), nunca por UPDATE direto.
GRANT SELECT, INSERT ON public.hi_authorization_items TO authenticated;--> statement-breakpoint
GRANT UPDATE (quantity_requested, quantity_authorized) ON public.hi_authorization_items TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON public.hi_authorization_consumptions, public.hi_authorization_attachments,
  public.hi_authorization_events TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hi_authorizations, public.hi_authorization_items,
  public.hi_authorization_consumptions, public.hi_authorization_attachments, public.hi_authorization_events
  TO service_role;--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0146-hi-authorizations')
  ON CONFLICT DO NOTHING;
