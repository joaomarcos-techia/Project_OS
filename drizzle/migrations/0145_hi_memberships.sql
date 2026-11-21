-- =====================================================================
-- 0145 — Convênios (ADR-072): carteirinhas do paciente por operadora.
-- P1.5 do QORO_TISS_MASTER_PLAN.md.
--
-- O número da carteirinha nunca fica em claro no banco:
--   - `card_number_encrypted`: ciphertext de encryptForTenant (AES-GCM por clínica);
--   - `card_number_hash`: HMAC-SHA256 hex, calculado na aplicação sobre
--     "<clinic_id>:<registro ANS>:<número normalizado>" (D21), para busca e
--     unicidade SEM correlacionar a mesma carteirinha entre clínicas;
--   - `card_last4`: só os 4 últimos caracteres, para a tela.
--
-- Histórico: trocar o número é criar outra carteirinha e marcar a anterior como
-- `replaced` (`replaced_by_id`). Número, operadora e paciente são imutáveis por
-- gatilho. As mudanças vão para `audit_events` pela aplicação (logAudit), como
-- em todo o Qoro; a leitura do número decifrado é auditada com finalidade (R85,
-- seção N do plano), também na aplicação.
--
-- O paciente precisa ser da mesma clínica (gatilho). FK para patients com
-- CASCADE: se o paciente for excluído de fato (LGPD), o número sai junto. Quando
-- a exclusão é bloqueada por registro clínico, o fluxo de anonimização (P12.3)
-- precisa inativar e limpar as carteirinhas.
--
-- Sem BEGIN/COMMIT (o migrator já roda numa transação). Só aditiva.
--
-- Rollback (sem dado de produção ainda):
--   DROP TABLE IF EXISTS public.hi_memberships CASCADE;
--   DROP FUNCTION IF EXISTS public.hi_assert_patient_in_clinic();
--   DROP FUNCTION IF EXISTS public.hi_guard_membership_identity();
--   DELETE FROM public._schema_version WHERE version = '0145-hi-memberships';
-- =====================================================================

CREATE TABLE public.hi_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  insurer_id uuid NOT NULL,
  plan_id uuid,
  card_number_encrypted text NOT NULL,
  card_number_hash text NOT NULL,
  card_last4 text NOT NULL,
  holder_kind text NOT NULL DEFAULT 'titular',
  valid_until date,
  is_preferred boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  replaced_by_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_memberships_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_memberships_insurer_fk FOREIGN KEY (clinic_id, insurer_id)
    REFERENCES public.hi_insurers (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_memberships_plan_fk FOREIGN KEY (clinic_id, plan_id)
    REFERENCES public.hi_plans (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_memberships_replaced_by_fk FOREIGN KEY (clinic_id, replaced_by_id)
    REFERENCES public.hi_memberships (clinic_id, id) ON DELETE SET NULL (replaced_by_id),
  CONSTRAINT hi_memberships_hash_chk CHECK (card_number_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT hi_memberships_ciphertext_chk CHECK (char_length(card_number_encrypted) >= 24),
  CONSTRAINT hi_memberships_last4_chk CHECK (card_last4 ~ '^[0-9A-Za-z]{1,4}$'),
  CONSTRAINT hi_memberships_holder_chk CHECK (holder_kind IN ('titular', 'dependente')),
  CONSTRAINT hi_memberships_status_chk CHECK (status IN ('active', 'inactive', 'replaced')),
  -- `replaced_by_id` só em carteirinha substituída (pode ficar nulo se a nova for apagada).
  CONSTRAINT hi_memberships_replaced_chk CHECK (replaced_by_id IS NULL OR status = 'replaced'),
  CONSTRAINT hi_memberships_not_self_chk CHECK (replaced_by_id IS NULL OR replaced_by_id <> id),
  CONSTRAINT hi_memberships_preferred_active_chk CHECK (NOT is_preferred OR status = 'active')
);
--> statement-breakpoint
-- Uma carteirinha ativa por número e operadora na clínica (não pertence a dois pacientes).
CREATE UNIQUE INDEX hi_memberships_active_card_uniq
  ON public.hi_memberships (clinic_id, insurer_id, card_number_hash) WHERE status = 'active';
--> statement-breakpoint
-- Uma carteirinha preferencial por paciente.
CREATE UNIQUE INDEX hi_memberships_preferred_uniq
  ON public.hi_memberships (clinic_id, patient_id) WHERE is_preferred;
--> statement-breakpoint
CREATE INDEX hi_memberships_patient_idx ON public.hi_memberships (clinic_id, patient_id, status);
--> statement-breakpoint

-- O paciente precisa ser da mesma clínica (a FK simples não garante).
CREATE OR REPLACE FUNCTION public.hi_assert_patient_in_clinic() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patients p
    WHERE p.id = NEW.patient_id AND p.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Paciente não pertence à clínica.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_assert_patient_in_clinic() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_memberships_same_clinic
  BEFORE INSERT ON public.hi_memberships
  FOR EACH ROW EXECUTE FUNCTION public.hi_assert_patient_in_clinic();
--> statement-breakpoint
-- Número, operadora, paciente e clínica não mudam: trocar o número é nova carteirinha.
-- Também impede "desfazer" uma substituição.
CREATE OR REPLACE FUNCTION public.hi_guard_membership_identity() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
     OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.insurer_id IS DISTINCT FROM OLD.insurer_id
     OR NEW.card_number_encrypted IS DISTINCT FROM OLD.card_number_encrypted
     OR NEW.card_number_hash IS DISTINCT FROM OLD.card_number_hash
     OR NEW.card_last4 IS DISTINCT FROM OLD.card_last4
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Dados de identificação da carteirinha são imutáveis; cadastre uma nova.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'replaced' AND NEW.status <> 'replaced' THEN
    RAISE EXCEPTION 'Carteirinha substituída não volta a ficar ativa.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_guard_membership_identity() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_memberships_identity_guard
  BEFORE UPDATE ON public.hi_memberships
  FOR EACH ROW EXECUTE FUNCTION public.hi_guard_membership_identity();
--> statement-breakpoint
CREATE TRIGGER trg_hi_memberships_updated_at BEFORE UPDATE ON public.hi_memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_memberships ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_memberships FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_memberships_tenant_access ON public.hi_memberships FOR ALL
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

-- Runtime: lê, cria e atualiza estado; nunca apaga (inativar em vez de excluir).
REVOKE ALL ON public.hi_memberships FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.hi_memberships TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hi_memberships TO service_role;--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0145-hi-memberships')
  ON CONFLICT DO NOTHING;
