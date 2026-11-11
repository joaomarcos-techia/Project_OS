-- =====================================================================
-- 0144 — Convênios (ADR-072): configuração da clínica, operadoras, planos,
-- perfil TISS do profissional, credenciamento e tabela de contratos.
-- P1.4 do QORO_TISS_MASTER_PLAN.md.
--
-- Tudo é por clínica (RLS ENABLE + FORCE, predicado do defaultTenantPolicy v2).
-- Integridade entre tabelas da mesma clínica por FK COMPOSTA (clinic_id, id):
-- uma FK simples deixaria uma linha apontar para a operadora de outra clínica.
--
-- O profissional é uma linha de `profiles` (id = auth.users.id). Como no
-- financeiro (professional_payout_rules), o id é guardado sem FK, para a
-- exclusão de uma conta não depender deste módulo; um gatilho confere que o
-- profissional é da mesma clínica.
--
-- Nada é ligado por padrão: `hi_clinic_settings.enabled` nasce false e a
-- migration não insere linha nenhuma.
--
-- Tabela de contratos é append-only: UPDATE bloqueado por gatilho e DELETE sem
-- privilégio para o runtime; corrigir é inserir nova versão (`supersedes_id`).
-- A exclusão da clínica continua funcionando (o CASCADE roda com o dono).
--
-- Valores em centavos (bigint), como o modelo das guias. Limite = maior valor
-- de `st_decimal10-2` do Padrão TISS (9.999.999.999 centavos).
--
-- Sem BEGIN/COMMIT: o migrator do drizzle já roda tudo numa transação (0045).
--
-- Rollback (reverso, sem dado de produção ainda):
--   DROP TABLE IF EXISTS public.hi_procedure_contracts, public.hi_contract_imports,
--     public.hi_credentials, public.hi_professional_profiles, public.hi_plans,
--     public.hi_insurer_credentials, public.hi_insurers, public.hi_counters,
--     public.hi_clinic_settings CASCADE;
--   DROP FUNCTION IF EXISTS public.hi_assert_professional_in_clinic();
--   DROP FUNCTION IF EXISTS public.hi_block_contract_update();
--   DELETE FROM public._schema_version WHERE version = '0144-hi-clinic-setup';
-- =====================================================================

-- ── Configuração do módulo por clínica (feature flag) ──────────────────
CREATE TABLE public.hi_clinic_settings (
  clinic_id uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  enabled_by uuid,
  provider_kind text,
  contractor_name text,
  cnes text,
  cnes_status text NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_clinic_settings_provider_kind_chk CHECK (provider_kind IS NULL OR provider_kind IN ('PF', 'PJ')),
  CONSTRAINT hi_clinic_settings_contractor_name_chk CHECK (
    contractor_name IS NULL OR char_length(btrim(contractor_name)) BETWEEN 1 AND 70
  ),
  CONSTRAINT hi_clinic_settings_cnes_status_chk CHECK (cnes_status IN ('unknown', 'has', 'none_declared')),
  CONSTRAINT hi_clinic_settings_cnes_chk CHECK (
    (cnes_status = 'has' AND cnes ~ '^[0-9]{7}$' AND cnes <> '9999999')
    OR (cnes_status <> 'has' AND cnes IS NULL)
  ),
  CONSTRAINT hi_clinic_settings_enabled_chk CHECK (
    NOT enabled OR (enabled_at IS NOT NULL AND enabled_by IS NOT NULL)
  )
);
--> statement-breakpoint

-- ── Contadores (guia, lote, transação, recurso) ────────────────────────
-- `scope_key` permite numerar por operadora quando o contrato exigir ('' = da clínica).
CREATE TABLE public.hi_counters (
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  kind text NOT NULL,
  scope_key text NOT NULL DEFAULT '',
  last_value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_counters_pk PRIMARY KEY (clinic_id, kind, scope_key),
  CONSTRAINT hi_counters_kind_chk CHECK (kind IN ('guide', 'batch', 'transaction', 'appeal')),
  CONSTRAINT hi_counters_value_chk CHECK (last_value >= 0 AND last_value <= 999999999999),
  CONSTRAINT hi_counters_scope_chk CHECK (char_length(scope_key) <= 64)
);
--> statement-breakpoint

-- ── Operadoras ─────────────────────────────────────────────────────────
CREATE TABLE public.hi_insurers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  registro_ans text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  provider_id_kind text NOT NULL,
  provider_id_value text NOT NULL,
  tiss_version text NOT NULL DEFAULT '4.03.00',
  connector_kind text NOT NULL DEFAULT 'manual',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_insurers_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_insurers_ans_uniq UNIQUE (clinic_id, registro_ans),
  CONSTRAINT hi_insurers_name_chk CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  CONSTRAINT hi_insurers_ans_chk CHECK (registro_ans ~ '^[0-9]{6}$'),
  CONSTRAINT hi_insurers_status_chk CHECK (status IN ('draft', 'active', 'suspended', 'archived')),
  CONSTRAINT hi_insurers_provider_id_chk CHECK (
    (provider_id_kind = 'codigoPrestadorNaOperadora' AND char_length(provider_id_value) BETWEEN 1 AND 14)
    OR (provider_id_kind = 'cnpjContratado' AND provider_id_value ~ '^[A-Z0-9]{12}[0-9]{2}$')
    OR (provider_id_kind = 'cpfContratado' AND provider_id_value ~ '^[0-9]{11}$')
  ),
  CONSTRAINT hi_insurers_tiss_version_chk CHECK (tiss_version IN ('4.03.00')),
  CONSTRAINT hi_insurers_connector_chk CHECK (connector_kind IN ('manual', 'soap')),
  CONSTRAINT hi_insurers_settings_chk CHECK (jsonb_typeof(settings) = 'object')
);
--> statement-breakpoint
CREATE INDEX hi_insurers_clinic_status_idx ON public.hi_insurers (clinic_id, status);
--> statement-breakpoint

-- ── Credenciais de webservice da operadora (sempre cifradas) ───────────
-- Só ciphertext de encryptForTenant; o acesso em claro é do adapter (P12.5).
CREATE TABLE public.hi_insurer_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  insurer_id uuid NOT NULL,
  kind text NOT NULL,
  username_encrypted text,
  secret_encrypted text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  rotated_at timestamptz,
  last_used_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_insurer_credentials_insurer_fk FOREIGN KEY (clinic_id, insurer_id)
    REFERENCES public.hi_insurers (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_insurer_credentials_kind_chk CHECK (kind IN ('webservice_login', 'certificate')),
  CONSTRAINT hi_insurer_credentials_status_chk CHECK (status IN ('active', 'revoked')),
  CONSTRAINT hi_insurer_credentials_secret_chk CHECK (char_length(secret_encrypted) >= 16)
);
--> statement-breakpoint
CREATE UNIQUE INDEX hi_insurer_credentials_active_uniq
  ON public.hi_insurer_credentials (clinic_id, insurer_id, kind) WHERE status = 'active';
--> statement-breakpoint

-- ── Planos ─────────────────────────────────────────────────────────────
CREATE TABLE public.hi_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  insurer_id uuid NOT NULL,
  name text NOT NULL,
  operator_code text,
  category text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_plans_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_plans_insurer_fk FOREIGN KEY (clinic_id, insurer_id)
    REFERENCES public.hi_insurers (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_plans_name_uniq UNIQUE (clinic_id, insurer_id, name),
  CONSTRAINT hi_plans_name_chk CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT hi_plans_operator_code_chk CHECK (operator_code IS NULL OR char_length(operator_code) BETWEEN 1 AND 40),
  CONSTRAINT hi_plans_category_chk CHECK (
    category IS NULL OR category IN ('ambulatorial', 'hospitalar', 'referencia', 'outro')
  ),
  CONSTRAINT hi_plans_status_chk CHECK (status IN ('active', 'archived'))
);
--> statement-breakpoint

-- ── Profissional no Padrão TISS (conselho, número, UF, CBO) ─────────────
-- Códigos das tabelas 26 (conselho), 59 (UF) e 24 (CBO); o domínio exato é
-- conferido na aplicação contra a terminologia vigente.
CREATE TABLE public.hi_professional_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL,
  council text NOT NULL,
  council_number text NOT NULL,
  council_uf text NOT NULL,
  cbo text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_professional_profiles_uniq UNIQUE (clinic_id, professional_id),
  CONSTRAINT hi_professional_profiles_council_chk CHECK (council ~ '^[0-9]{2}$'),
  CONSTRAINT hi_professional_profiles_number_chk CHECK (char_length(btrim(council_number)) BETWEEN 1 AND 15),
  CONSTRAINT hi_professional_profiles_uf_chk CHECK (council_uf ~ '^[0-9]{2}$'),
  CONSTRAINT hi_professional_profiles_cbo_chk CHECK (cbo ~ '^[0-9]{6}$' AND cbo <> '999999')
);
--> statement-breakpoint

-- ── Credenciamento (clínica ou profissional) por operadora e plano ─────
CREATE TABLE public.hi_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  insurer_id uuid NOT NULL,
  plan_id uuid,
  professional_id uuid,
  provider_code text,
  valid_from date NOT NULL,
  valid_until date,
  status text NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_credentials_insurer_fk FOREIGN KEY (clinic_id, insurer_id)
    REFERENCES public.hi_insurers (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_credentials_plan_fk FOREIGN KEY (clinic_id, plan_id)
    REFERENCES public.hi_plans (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_credentials_period_chk CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT hi_credentials_status_chk CHECK (status IN ('active', 'suspended', 'ended')),
  CONSTRAINT hi_credentials_provider_code_chk CHECK (
    provider_code IS NULL OR char_length(provider_code) BETWEEN 1 AND 14
  ),
  -- Dois credenciamentos ativos do mesmo alvo não podem ter vigências sobrepostas.
  CONSTRAINT hi_credentials_no_overlap EXCLUDE USING gist (
    clinic_id WITH =,
    insurer_id WITH =,
    (COALESCE(plan_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    (COALESCE(professional_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange(valid_from, valid_until, '[]') WITH &&
  ) WHERE (status = 'active')
);
--> statement-breakpoint
CREATE INDEX hi_credentials_clinic_insurer_idx ON public.hi_credentials (clinic_id, insurer_id, status);
--> statement-breakpoint

-- ── Importações de tabela de contrato (auditoria) ──────────────────────
CREATE TABLE public.hi_contract_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  insurer_id uuid NOT NULL,
  file_name text NOT NULL,
  file_sha256 text NOT NULL,
  row_count integer NOT NULL,
  accepted_count integer NOT NULL,
  rejected_count integer NOT NULL,
  status text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  CONSTRAINT hi_contract_imports_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_contract_imports_insurer_fk FOREIGN KEY (clinic_id, insurer_id)
    REFERENCES public.hi_insurers (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_contract_imports_file_chk CHECK (
    char_length(btrim(file_name)) BETWEEN 1 AND 255 AND file_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT hi_contract_imports_counts_chk CHECK (
    row_count >= 0 AND accepted_count >= 0 AND rejected_count >= 0
    AND accepted_count + rejected_count = row_count
  ),
  CONSTRAINT hi_contract_imports_status_chk CHECK (status IN ('validated', 'applied', 'rejected')),
  CONSTRAINT hi_contract_imports_applied_chk CHECK ((status = 'applied') = (applied_at IS NOT NULL)),
  CONSTRAINT hi_contract_imports_summary_chk CHECK (jsonb_typeof(summary) = 'object')
);
--> statement-breakpoint

-- ── Tabela de contratos: valor por procedimento, append-only ───────────
CREATE TABLE public.hi_procedure_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  insurer_id uuid NOT NULL,
  plan_id uuid,
  guide_type text NOT NULL,
  table_code text NOT NULL,
  procedure_code text NOT NULL,
  description text NOT NULL,
  procedure_id uuid,
  unit_value_cents bigint NOT NULL,
  valid_from date NOT NULL,
  valid_until date,
  requires_authorization boolean NOT NULL DEFAULT false,
  copay_kind text NOT NULL DEFAULT 'none',
  copay_fixed_cents bigint,
  copay_percentage numeric(5,2),
  return_days integer,
  return_billable boolean NOT NULL DEFAULT false,
  supersedes_id uuid,
  import_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_procedure_contracts_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_procedure_contracts_insurer_fk FOREIGN KEY (clinic_id, insurer_id)
    REFERENCES public.hi_insurers (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_procedure_contracts_plan_fk FOREIGN KEY (clinic_id, plan_id)
    REFERENCES public.hi_plans (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_procedure_contracts_supersedes_fk FOREIGN KEY (clinic_id, supersedes_id)
    REFERENCES public.hi_procedure_contracts (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_procedure_contracts_import_fk FOREIGN KEY (clinic_id, import_id)
    REFERENCES public.hi_contract_imports (clinic_id, id) ON DELETE CASCADE,
  CONSTRAINT hi_procedure_contracts_supersedes_once UNIQUE (supersedes_id),
  CONSTRAINT hi_procedure_contracts_guide_type_chk CHECK (guide_type IN ('consulta', 'sp_sadt')),
  CONSTRAINT hi_procedure_contracts_table_chk CHECK (table_code ~ '^[0-9]{2}$'),
  CONSTRAINT hi_procedure_contracts_code_chk CHECK (char_length(btrim(procedure_code)) BETWEEN 1 AND 10),
  CONSTRAINT hi_procedure_contracts_description_chk CHECK (char_length(btrim(description)) BETWEEN 1 AND 150),
  CONSTRAINT hi_procedure_contracts_value_chk CHECK (unit_value_cents >= 0 AND unit_value_cents <= 9999999999),
  CONSTRAINT hi_procedure_contracts_period_chk CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT hi_procedure_contracts_copay_chk CHECK (
    (copay_kind = 'none' AND copay_fixed_cents IS NULL AND copay_percentage IS NULL)
    OR (copay_kind = 'fixed' AND copay_percentage IS NULL
        AND copay_fixed_cents >= 0 AND copay_fixed_cents <= unit_value_cents)
    OR (copay_kind = 'percentage' AND copay_fixed_cents IS NULL
        AND copay_percentage > 0 AND copay_percentage <= 100)
  ),
  CONSTRAINT hi_procedure_contracts_return_chk CHECK (
    (return_days IS NULL AND NOT return_billable) OR (return_days BETWEEN 1 AND 365)
  ),
  CONSTRAINT hi_procedure_contracts_not_self_chk CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);
--> statement-breakpoint
CREATE INDEX hi_procedure_contracts_lookup_idx
  ON public.hi_procedure_contracts (clinic_id, insurer_id, table_code, procedure_code, valid_from);
--> statement-breakpoint

-- ── Gatilhos ───────────────────────────────────────────────────────────
-- O profissional (profiles) precisa ser da mesma clínica da linha.
CREATE OR REPLACE FUNCTION public.hi_assert_professional_in_clinic() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.professional_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW.professional_id AND p.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Profissional não pertence à clínica.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_assert_professional_in_clinic() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_professional_profiles_same_clinic
  BEFORE INSERT OR UPDATE OF clinic_id, professional_id ON public.hi_professional_profiles
  FOR EACH ROW EXECUTE FUNCTION public.hi_assert_professional_in_clinic();
--> statement-breakpoint
CREATE TRIGGER hi_credentials_same_clinic
  BEFORE INSERT OR UPDATE OF clinic_id, professional_id ON public.hi_credentials
  FOR EACH ROW EXECUTE FUNCTION public.hi_assert_professional_in_clinic();
--> statement-breakpoint
-- Contrato é imutável inclusive para papéis com UPDATE: corrigir é nova versão.
CREATE OR REPLACE FUNCTION public.hi_block_contract_update() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Contrato de convênio é imutável; registre uma nova versão.' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_block_contract_update() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_procedure_contracts_immutable
  BEFORE UPDATE ON public.hi_procedure_contracts
  FOR EACH ROW EXECUTE FUNCTION public.hi_block_contract_update();
--> statement-breakpoint
CREATE TRIGGER trg_hi_clinic_settings_updated_at BEFORE UPDATE ON public.hi_clinic_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_hi_counters_updated_at BEFORE UPDATE ON public.hi_counters FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_hi_insurers_updated_at BEFORE UPDATE ON public.hi_insurers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_hi_insurer_credentials_updated_at BEFORE UPDATE ON public.hi_insurer_credentials FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_hi_plans_updated_at BEFORE UPDATE ON public.hi_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_hi_professional_profiles_updated_at BEFORE UPDATE ON public.hi_professional_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_hi_credentials_updated_at BEFORE UPDATE ON public.hi_credentials FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- ── RLS (saída literal do defaultTenantPolicy v2) ──────────────────────
-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_clinic_settings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_clinic_settings FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_clinic_settings_tenant_access ON public.hi_clinic_settings FOR ALL
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
ALTER TABLE public.hi_counters ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_counters FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_counters_tenant_access ON public.hi_counters FOR ALL
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
ALTER TABLE public.hi_insurers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_insurers FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_insurers_tenant_access ON public.hi_insurers FOR ALL
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
ALTER TABLE public.hi_insurer_credentials ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_insurer_credentials FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_insurer_credentials_tenant_access ON public.hi_insurer_credentials FOR ALL
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
ALTER TABLE public.hi_plans ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_plans FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_plans_tenant_access ON public.hi_plans FOR ALL
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
ALTER TABLE public.hi_professional_profiles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_professional_profiles FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_professional_profiles_tenant_access ON public.hi_professional_profiles FOR ALL
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
ALTER TABLE public.hi_credentials ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_credentials FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_credentials_tenant_access ON public.hi_credentials FOR ALL
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
ALTER TABLE public.hi_contract_imports ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_contract_imports FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_contract_imports_tenant_access ON public.hi_contract_imports FOR ALL
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
ALTER TABLE public.hi_procedure_contracts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_procedure_contracts FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_procedure_contracts_tenant_access ON public.hi_procedure_contracts FOR ALL
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

-- ── Privilégios ────────────────────────────────────────────────────────
-- anon nunca; authenticated com DML (o withTenant faz SET LOCAL ROLE
-- authenticated); contratos só SELECT/INSERT (append-only).
REVOKE ALL ON public.hi_clinic_settings, public.hi_counters, public.hi_insurers,
  public.hi_insurer_credentials, public.hi_plans, public.hi_professional_profiles,
  public.hi_credentials, public.hi_contract_imports, public.hi_procedure_contracts
  FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hi_clinic_settings, public.hi_counters,
  public.hi_insurers, public.hi_insurer_credentials, public.hi_plans,
  public.hi_professional_profiles, public.hi_credentials, public.hi_contract_imports
  TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT ON public.hi_procedure_contracts TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.hi_procedure_contracts TO service_role;--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0144-hi-clinic-setup')
  ON CONFLICT DO NOTHING;
