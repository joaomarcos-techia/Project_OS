-- 0108 - fatos econômicos reais de pagamentos de pacientes
--
-- Bruto clínico/cobrado, taxa do provedor e líquido são conceitos distintos.
-- Dados históricos permanecem NULL: esta migration não fabrica taxas antigas.

ALTER TABLE public.patient_charges
  ADD COLUMN IF NOT EXISTS provider_gross_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS provider_fee_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS provider_net_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS early_settlement_fee_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS provider_billing_type text,
  ADD COLUMN IF NOT EXISTS provider_installment_id text,
  ADD COLUMN IF NOT EXISTS provider_installment_number integer,
  ADD COLUMN IF NOT EXISTS requested_payment_method text,
  ADD COLUMN IF NOT EXISTS requested_installment_count integer,
  ADD COLUMN IF NOT EXISTS economics_reconciled_at timestamptz;
--> statement-breakpoint

ALTER TABLE public.patient_charges
  ADD CONSTRAINT patient_charges_economics_nonnegative_chk CHECK (
    (provider_gross_amount IS NULL OR (provider_gross_amount >= 0 AND provider_gross_amount = amount))
    AND (provider_fee_amount IS NULL OR (
      provider_gross_amount IS NOT NULL
      AND provider_fee_amount >= 0
      AND provider_fee_amount <= provider_gross_amount
    ))
    AND (provider_net_amount IS NULL OR (
      provider_gross_amount IS NOT NULL
      AND provider_net_amount >= 0
      AND provider_net_amount <= provider_gross_amount
    ))
    AND (early_settlement_fee_amount IS NULL OR early_settlement_fee_amount >= 0)
    AND (provider_installment_number IS NULL OR provider_installment_number > 0)
    AND (economics_reconciled_at IS NULL OR (
      provider_gross_amount IS NOT NULL
      AND provider_fee_amount IS NOT NULL
      AND provider_net_amount IS NOT NULL
    ))
  );
--> statement-breakpoint
ALTER TABLE public.patient_charges
  ADD CONSTRAINT patient_charges_requested_payment_chk CHECK (
    (requested_payment_method IS NULL AND requested_installment_count IS NULL)
    OR (requested_payment_method IS NOT NULL AND (
      (requested_payment_method = 'pix' AND requested_installment_count IS NULL)
      OR (requested_payment_method = 'credit_card' AND requested_installment_count IS NOT NULL
        AND requested_installment_count BETWEEN 1 AND 12)
    ))
  );
--> statement-breakpoint

-- O atendimento preserva a condição comercial que determinou o bruto.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS pricing_policy_mode text NOT NULL DEFAULT 'absorb_fees',
  ADD COLUMN IF NOT EXISTS commercial_payment_method text,
  ADD COLUMN IF NOT EXISTS commercial_installment_count integer,
  ADD COLUMN IF NOT EXISTS commercial_price_id uuid;
--> statement-breakpoint
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_commercial_price_snapshot_chk CHECK (
    (pricing_policy_mode = 'absorb_fees'
      AND commercial_payment_method IS NULL
      AND commercial_installment_count IS NULL
      AND commercial_price_id IS NULL)
    OR
    (pricing_policy_mode = 'payment_method_pricing'
      AND commercial_price_id IS NOT NULL
      AND commercial_payment_method IS NOT NULL
      AND (
        (commercial_payment_method IN ('pix', 'cash') AND commercial_installment_count IS NULL)
        OR (commercial_payment_method = 'credit_card' AND commercial_installment_count IS NOT NULL
          AND commercial_installment_count BETWEEN 1 AND 12)
      ))
  );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.block_appointment_commercial_snapshot_rewrite() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.pricing_policy_mode IS DISTINCT FROM OLD.pricing_policy_mode
  OR NEW.commercial_payment_method IS DISTINCT FROM OLD.commercial_payment_method
  OR NEW.commercial_installment_count IS DISTINCT FROM OLD.commercial_installment_count
  OR NEW.commercial_price_id IS DISTINCT FROM OLD.commercial_price_id THEN
    RAISE EXCEPTION 'Condição comercial do atendimento é imutável.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.block_appointment_commercial_snapshot_rewrite() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER appointments_commercial_snapshot_immutable
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.block_appointment_commercial_snapshot_rewrite();
--> statement-breakpoint

ALTER TABLE public.patient_credits
  ADD COLUMN IF NOT EXISTS provider_gross_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS provider_fee_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS provider_net_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS early_settlement_fee_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS provider_economics_reconciled_at timestamptz;
--> statement-breakpoint

ALTER TABLE public.patient_credits
  ADD CONSTRAINT patient_credits_economics_nonnegative_chk CHECK (
    (provider_gross_amount IS NULL OR (provider_gross_amount >= 0 AND provider_gross_amount = amount))
    AND (provider_fee_amount IS NULL OR (
      provider_gross_amount IS NOT NULL
      AND provider_fee_amount >= 0
      AND provider_fee_amount <= provider_gross_amount
    ))
    AND (provider_net_amount IS NULL OR (
      provider_gross_amount IS NOT NULL
      AND provider_net_amount >= 0
      AND provider_net_amount <= provider_gross_amount
    ))
    AND (early_settlement_fee_amount IS NULL OR early_settlement_fee_amount >= 0)
    AND (provider_economics_reconciled_at IS NULL OR (
      provider_gross_amount IS NOT NULL
      AND provider_fee_amount IS NOT NULL
      AND provider_net_amount IS NOT NULL
    ))
  );
--> statement-breakpoint

ALTER TABLE public.lancamentos
  ADD COLUMN IF NOT EXISTS source_patient_charge_id uuid,
  ADD COLUMN IF NOT EXISTS financial_expense_kind text;
--> statement-breakpoint

ALTER TABLE public.lancamentos DROP CONSTRAINT IF EXISTS lancamentos_auto_origin_chk;
--> statement-breakpoint
ALTER TABLE public.lancamentos
  ADD CONSTRAINT lancamentos_auto_origin_chk CHECK (
    created_via <> 'auto'
    OR appointment_id IS NOT NULL
    OR (source_patient_charge_id IS NOT NULL AND financial_expense_kind IS NOT NULL)
  ),
  ADD CONSTRAINT lancamentos_provider_expense_coherence_chk CHECK (
    (source_patient_charge_id IS NULL AND financial_expense_kind IS NULL)
    OR (
      source_patient_charge_id IS NOT NULL
      AND financial_expense_kind IS NOT NULL
      AND financial_expense_kind IN ('payment_processing_fee', 'early_settlement_fee')
      AND tipo = 'pagar'
    )
  );
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_provider_expense_uniq
  ON public.lancamentos (clinic_id, source_patient_charge_id, financial_expense_kind)
  WHERE source_patient_charge_id IS NOT NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.block_lancamento_immutable_cols() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.clinic_id                 IS DISTINCT FROM OLD.clinic_id
  OR NEW.tipo                      IS DISTINCT FROM OLD.tipo
  OR NEW.valor                     IS DISTINCT FROM OLD.valor
  OR NEW.created_via               IS DISTINCT FROM OLD.created_via
  OR NEW.appointment_id            IS DISTINCT FROM OLD.appointment_id
  OR NEW.reverses_lancamento_id    IS DISTINCT FROM OLD.reverses_lancamento_id
  OR NEW.source_patient_charge_id  IS DISTINCT FROM OLD.source_patient_charge_id
  OR NEW.financial_expense_kind    IS DISTINCT FROM OLD.financial_expense_kind THEN
    RAISE EXCEPTION 'Lançamento é append-only: origem e valores são imutáveis.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Política de repasse atual + histórico append-only. Sem linha = GROSS.
CREATE TABLE IF NOT EXISTS public.clinic_financial_policies (
  clinic_id uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  professional_payout_basis text NOT NULL DEFAULT 'gross',
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_financial_policies_basis_chk
    CHECK (professional_payout_basis IN ('gross', 'net'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.clinic_financial_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  professional_payout_basis text NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_financial_policy_versions_basis_chk
    CHECK (professional_payout_basis IN ('gross', 'net'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS clinic_financial_policy_versions_effective_idx
  ON public.clinic_financial_policy_versions (clinic_id, effective_from);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.block_financial_policy_version_update() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Versão de política financeira é append-only.';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.block_financial_policy_version_update() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS clinic_financial_policy_versions_append_only
  ON public.clinic_financial_policy_versions;
--> statement-breakpoint
CREATE TRIGGER clinic_financial_policy_versions_append_only
  BEFORE UPDATE ON public.clinic_financial_policy_versions
  FOR EACH ROW EXECUTE FUNCTION public.block_financial_policy_version_update();
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.professional_payout_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL,
  procedure_id uuid,
  kind text NOT NULL,
  percentage numeric(7,4),
  fixed_amount numeric(12,2),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT professional_payout_rules_shape_chk CHECK (
    (kind = 'percentage' AND percentage IS NOT NULL AND percentage > 0
      AND percentage <= 100 AND fixed_amount IS NULL)
    OR (kind = 'fixed' AND fixed_amount IS NOT NULL AND fixed_amount >= 0
      AND percentage IS NULL)
  ),
  CONSTRAINT professional_payout_rules_effective_window_chk
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS professional_payout_rules_clinic_professional_idx
  ON public.professional_payout_rules (clinic_id, professional_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS professional_payout_rules_active_uniq
  ON public.professional_payout_rules (
    clinic_id,
    professional_id,
    coalesce(procedure_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE effective_to IS NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.professional_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL,
  professional_id uuid NOT NULL,
  procedure_id uuid NOT NULL,
  policy_version_id uuid REFERENCES public.clinic_financial_policy_versions(id) ON DELETE RESTRICT,
  rule_id uuid REFERENCES public.professional_payout_rules(id) ON DELETE RESTRICT,
  calculation_basis text NOT NULL,
  rule_kind text NOT NULL,
  rule_percentage numeric(7,4),
  rule_fixed_amount numeric(12,2),
  gross_amount numeric(12,2) NOT NULL,
  provider_fee_amount numeric(12,2),
  early_settlement_fee_amount numeric(12,2),
  net_amount numeric(12,2),
  basis_amount numeric(12,2),
  payout_amount numeric(12,2),
  status text NOT NULL DEFAULT 'pending_economics',
  calculated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT professional_payouts_appointment_uniq UNIQUE (appointment_id),
  CONSTRAINT professional_payouts_basis_chk CHECK (calculation_basis IN ('gross', 'net')),
  CONSTRAINT professional_payouts_amount_chk CHECK (
    gross_amount >= 0
    AND (provider_fee_amount IS NULL OR (provider_fee_amount >= 0 AND provider_fee_amount <= gross_amount))
    AND (early_settlement_fee_amount IS NULL OR early_settlement_fee_amount >= 0)
    AND (net_amount IS NULL OR (net_amount >= 0 AND net_amount <= gross_amount))
    AND (basis_amount IS NULL OR basis_amount >= 0)
    AND (payout_amount IS NULL OR payout_amount >= 0)
  ),
  CONSTRAINT professional_payouts_basis_amount_chk CHECK (
    status <> 'calculated'
    OR (calculation_basis = 'gross' AND basis_amount = gross_amount)
    OR (calculation_basis = 'net' AND net_amount IS NOT NULL AND basis_amount = net_amount)
  ),
  CONSTRAINT professional_payouts_rule_shape_chk CHECK (
    (rule_kind = 'percentage' AND rule_percentage IS NOT NULL AND rule_percentage > 0
      AND rule_percentage <= 100 AND rule_fixed_amount IS NULL)
    OR (rule_kind = 'fixed' AND rule_fixed_amount IS NOT NULL AND rule_fixed_amount >= 0
      AND rule_percentage IS NULL)
  ),
  CONSTRAINT professional_payouts_status_chk CHECK (
    (status = 'pending_economics' AND calculation_basis = 'net'
      AND basis_amount IS NULL AND payout_amount IS NULL AND calculated_at IS NULL)
    OR (status = 'calculated' AND basis_amount IS NOT NULL
      AND payout_amount IS NOT NULL AND calculated_at IS NOT NULL)
    OR status = 'cancelled'
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS professional_payouts_clinic_professional_idx
  ON public.professional_payouts (clinic_id, professional_id);
--> statement-breakpoint

-- A configuração nunca aceita owner como profissional repassável e fecha o
-- mesmo limite para escrita direta que a UI/action fecha para o operador.
CREATE OR REPLACE FUNCTION public.validate_professional_payout_rule_target() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW.professional_id
      AND p.clinic_id = NEW.clinic_id
      AND p.deleted_at IS NULL
      AND p.ativo = true
      AND p.role <> 'owner'
      AND (p.role = 'doctor' OR (p.crm IS NOT NULL AND btrim(p.crm) <> ''))
  ) THEN
    RAISE EXCEPTION 'profissional de repasse inválido para a clínica';
  END IF;
  IF NEW.procedure_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.procedures pr
    WHERE pr.id = NEW.procedure_id AND pr.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'procedimento de repasse inválido para a clínica';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.validate_professional_payout_rule_target() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS professional_payout_rules_validate_target
  ON public.professional_payout_rules;
--> statement-breakpoint
CREATE TRIGGER professional_payout_rules_validate_target
  BEFORE INSERT OR UPDATE OF clinic_id, professional_id, procedure_id
  ON public.professional_payout_rules
  FOR EACH ROW EXECUTE FUNCTION public.validate_professional_payout_rule_target();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.block_professional_payout_rule_rewrite() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
  OR NEW.professional_id IS DISTINCT FROM OLD.professional_id
  OR NEW.procedure_id IS DISTINCT FROM OLD.procedure_id
  OR NEW.kind IS DISTINCT FROM OLD.kind
  OR NEW.percentage IS DISTINCT FROM OLD.percentage
  OR NEW.fixed_amount IS DISTINCT FROM OLD.fixed_amount
  OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
  OR NEW.created_by IS DISTINCT FROM OLD.created_by
  OR NEW.created_at IS DISTINCT FROM OLD.created_at
  OR OLD.effective_to IS NOT NULL
  OR NEW.effective_to IS NULL THEN
    RAISE EXCEPTION 'Regra histórica de repasse é imutável; apenas o encerramento é permitido.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.block_professional_payout_rule_rewrite() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS professional_payout_rules_close_only
  ON public.professional_payout_rules;
--> statement-breakpoint
CREATE TRIGGER professional_payout_rules_close_only
  BEFORE UPDATE ON public.professional_payout_rules
  FOR EACH ROW EXECUTE FUNCTION public.block_professional_payout_rule_rewrite();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.block_professional_payout_snapshot_mutation() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
  OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
  OR NEW.professional_id IS DISTINCT FROM OLD.professional_id
  OR NEW.procedure_id IS DISTINCT FROM OLD.procedure_id
  OR NEW.policy_version_id IS DISTINCT FROM OLD.policy_version_id
  OR NEW.rule_id IS DISTINCT FROM OLD.rule_id
  OR NEW.calculation_basis IS DISTINCT FROM OLD.calculation_basis
  OR NEW.rule_kind IS DISTINCT FROM OLD.rule_kind
  OR NEW.rule_percentage IS DISTINCT FROM OLD.rule_percentage
  OR NEW.rule_fixed_amount IS DISTINCT FROM OLD.rule_fixed_amount
  OR NEW.gross_amount IS DISTINCT FROM OLD.gross_amount THEN
    RAISE EXCEPTION 'Snapshot de repasse é imutável.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.block_professional_payout_snapshot_mutation() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS professional_payouts_immutable_snapshot
  ON public.professional_payouts;
--> statement-breakpoint
CREATE TRIGGER professional_payouts_immutable_snapshot
  BEFORE UPDATE ON public.professional_payouts
  FOR EACH ROW EXECUTE FUNCTION public.block_professional_payout_snapshot_mutation();
--> statement-breakpoint

-- Os IDs dos outros contextos não têm FK no schema Drizzle. Esta validação
-- impede que um repasse de uma clínica aponte para registros de outra.
CREATE OR REPLACE FUNCTION public.validate_professional_payout_references() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = NEW.appointment_id AND a.clinic_id = NEW.clinic_id
      AND a.doctor_id = NEW.professional_id AND a.procedure_id = NEW.procedure_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW.professional_id AND p.clinic_id = NEW.clinic_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.procedures pr
    WHERE pr.id = NEW.procedure_id AND pr.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Referências do repasse inválidas para a clínica.';
  END IF;
  IF NEW.policy_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clinic_financial_policy_versions v
    WHERE v.id = NEW.policy_version_id AND v.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Versão de política de repasse inválida para a clínica.';
  END IF;
  IF NEW.rule_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.professional_payout_rules r
    WHERE r.id = NEW.rule_id AND r.clinic_id = NEW.clinic_id
      AND r.professional_id = NEW.professional_id
      AND (r.procedure_id IS NULL OR r.procedure_id = NEW.procedure_id)
  ) THEN
    RAISE EXCEPTION 'Regra de repasse inválida para a clínica.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.validate_professional_payout_references() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER professional_payouts_validate_references
  BEFORE INSERT OR UPDATE OF clinic_id, appointment_id, professional_id, procedure_id,
    policy_version_id, rule_id ON public.professional_payouts
  FOR EACH ROW EXECUTE FUNCTION public.validate_professional_payout_references();
--> statement-breakpoint

-- Política comercial de preço. É independente da tarifa real do provedor.
CREATE TABLE IF NOT EXISTS public.clinic_payment_pricing_policies (
  clinic_id uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'absorb_fees',
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_payment_pricing_policies_mode_chk
    CHECK (mode IN ('absorb_fees', 'payment_method_pricing'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.procedure_payment_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  procedure_id uuid NOT NULL,
  payment_method text NOT NULL,
  installment_count integer,
  gross_amount numeric(12,2) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT procedure_payment_prices_method_chk
    CHECK (payment_method IN ('pix', 'cash', 'credit_card')),
  CONSTRAINT procedure_payment_prices_installment_chk CHECK (
    (payment_method = 'credit_card' AND installment_count IS NOT NULL
      AND installment_count BETWEEN 1 AND 12)
    OR (payment_method IN ('pix', 'cash') AND installment_count IS NULL)
  ),
  CONSTRAINT procedure_payment_prices_amount_chk CHECK (gross_amount > 0),
  CONSTRAINT procedure_payment_prices_effective_window_chk CHECK (
    (active = true AND effective_to IS NULL)
    OR (active = false AND effective_to IS NOT NULL AND effective_to >= effective_from)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS procedure_payment_prices_active_method_uniq
  ON public.procedure_payment_prices (
    clinic_id,
    procedure_id,
    payment_method,
    coalesce(installment_count, 0)
  ) WHERE active = true;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.validate_procedure_payment_price_target() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.procedures pr
    WHERE pr.id = NEW.procedure_id AND pr.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'procedimento de preço inválido para a clínica';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.validate_procedure_payment_price_target() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS procedure_payment_prices_validate_target
  ON public.procedure_payment_prices;
--> statement-breakpoint
CREATE TRIGGER procedure_payment_prices_validate_target
  BEFORE INSERT OR UPDATE OF clinic_id, procedure_id
  ON public.procedure_payment_prices
  FOR EACH ROW EXECUTE FUNCTION public.validate_procedure_payment_price_target();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.block_procedure_payment_price_rewrite() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
  OR NEW.procedure_id IS DISTINCT FROM OLD.procedure_id
  OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
  OR NEW.installment_count IS DISTINCT FROM OLD.installment_count
  OR NEW.gross_amount IS DISTINCT FROM OLD.gross_amount
  OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
  OR NEW.updated_by IS DISTINCT FROM OLD.updated_by
  OR NEW.created_at IS DISTINCT FROM OLD.created_at
  OR OLD.active = false
  OR NEW.active = true
  OR OLD.effective_to IS NOT NULL
  OR NEW.effective_to IS NULL THEN
    RAISE EXCEPTION 'Preço histórico é imutável; apenas o encerramento é permitido.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.block_procedure_payment_price_rewrite() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS procedure_payment_prices_close_only
  ON public.procedure_payment_prices;
--> statement-breakpoint
CREATE TRIGGER procedure_payment_prices_close_only
  BEFORE UPDATE ON public.procedure_payment_prices
  FOR EACH ROW EXECUTE FUNCTION public.block_procedure_payment_price_rewrite();
--> statement-breakpoint

-- Uma criação nova só pode usar preço ativo/vigente. Remarcação preserva o
-- snapshot histórico, mesmo quando a versão original já foi encerrada.
CREATE OR REPLACE FUNCTION public.validate_appointment_commercial_price_snapshot() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.pricing_policy_mode = 'payment_method_pricing' AND NOT EXISTS (
    SELECT 1 FROM public.procedure_payment_prices price
    WHERE price.id = NEW.commercial_price_id
      AND price.clinic_id = NEW.clinic_id
      AND price.procedure_id = NEW.procedure_id
      AND price.payment_method = NEW.commercial_payment_method
      AND price.installment_count IS NOT DISTINCT FROM NEW.commercial_installment_count
      AND price.gross_amount = NEW.valor
      AND (
        TG_OP = 'UPDATE'
        OR (
          price.active = true
          AND price.effective_from <= now()
          AND EXISTS (
            SELECT 1 FROM public.clinic_payment_pricing_policies policy
            JOIN public.subscriptions subscription ON subscription.clinic_id = policy.clinic_id
            JOIN public.plans plan ON plan.id = subscription.plan_id
            WHERE policy.clinic_id = NEW.clinic_id
              AND policy.mode = 'payment_method_pricing'
              AND plan.code IN ('clinica', 'pro')
          )
        )
        OR EXISTS (
          SELECT 1 FROM public.appointments previous
          WHERE previous.id = NEW.rescheduled_from_appointment_id
            AND previous.clinic_id = NEW.clinic_id
            AND previous.patient_id IS NOT DISTINCT FROM NEW.patient_id
            AND previous.doctor_id = NEW.doctor_id
            AND previous.procedure_id = NEW.procedure_id
            AND previous.status = 'cancelado'
            AND previous.valor = NEW.valor
            AND previous.pricing_policy_mode = NEW.pricing_policy_mode
            AND previous.commercial_payment_method = NEW.commercial_payment_method
            AND previous.commercial_installment_count IS NOT DISTINCT FROM NEW.commercial_installment_count
            AND previous.commercial_price_id = NEW.commercial_price_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Preço comercial do atendimento não corresponde à versão configurada.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.validate_appointment_commercial_price_snapshot() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER appointments_validate_commercial_price_snapshot
  BEFORE INSERT OR UPDATE OF clinic_id, procedure_id, valor, pricing_policy_mode,
    commercial_payment_method, commercial_installment_count, commercial_price_id
  ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.validate_appointment_commercial_price_snapshot();
--> statement-breakpoint

-- IDs de ator são snapshots opacos, sem FK para auth.users. Excluir uma conta
-- não pode apagar o autor histórico nem disparar um SET NULL que reescreva uma
-- versão append-only.

ALTER TABLE public.clinic_financial_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_financial_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_financial_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_financial_policy_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.professional_payout_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_payout_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.professional_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_payouts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_payment_pricing_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_payment_pricing_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.procedure_payment_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedure_payment_prices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'clinic_financial_policies',
    'clinic_financial_policy_versions',
    'professional_payout_rules',
    'professional_payouts',
    'clinic_payment_pricing_policies',
    'procedure_payment_prices'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (
         clinic_id::text = (select current_setting(''app.current_clinic'', true))
         OR (select is_super_admin())
       )', table_name || '_read', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (
         clinic_id::text = (select current_setting(''app.current_clinic'', true))
         OR (select is_super_admin())
       )', table_name || '_write', table_name
    );
    IF table_name <> 'clinic_financial_policy_versions' THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE USING (
           clinic_id::text = (select current_setting(''app.current_clinic'', true))
           OR (select is_super_admin())
         ) WITH CHECK (
           clinic_id::text = (select current_setting(''app.current_clinic'', true))
           OR (select is_super_admin())
         )', table_name || '_update', table_name
      );
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

REVOKE ALL ON public.clinic_financial_policies,
  public.clinic_financial_policy_versions,
  public.professional_payout_rules,
  public.professional_payouts,
  public.clinic_payment_pricing_policies,
  public.procedure_payment_prices FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.clinic_financial_policies,
  public.professional_payout_rules,
  public.professional_payouts,
  public.clinic_payment_pricing_policies,
  public.procedure_payment_prices TO authenticated;
GRANT SELECT, INSERT ON public.clinic_financial_policy_versions TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.clinic_financial_policies,
  public.clinic_financial_policy_versions,
  public.professional_payout_rules,
  public.professional_payouts,
  public.clinic_payment_pricing_policies,
  public.procedure_payment_prices TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0108-patient-payment-economics')
ON CONFLICT (version) DO NOTHING;
--> statement-breakpoint

-- A tabela já possuía grants/RLS. As colunas novas herdam os privilégios de
-- tabela e continuam tenant-scoped pelas policies existentes.
