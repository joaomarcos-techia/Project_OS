-- 0109 - protege o snapshot comercial e distribui a releitura do provedor

ALTER TABLE public.patient_charges
  ADD COLUMN IF NOT EXISTS provider_reconcile_checked_at timestamptz;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patient_charges_pending_economics_scan_idx
  ON public.patient_charges (
    provider_reconcile_checked_at ASC NULLS FIRST,
    paid_at ASC NULLS FIRST,
    id ASC
  )
  WHERE status = 'paid'
    AND provider_payment_id IS NOT NULL
    AND economics_reconciled_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patient_charges_pending_mismatch_scan_idx
  ON public.patient_charges (
    provider_reconcile_checked_at ASC NULLS FIRST,
    updated_at ASC,
    id ASC
  )
  WHERE status = 'pending'
    AND provider_payment_id IS NOT NULL
    AND failure_code IN (
      'payment_method_mismatch',
      'payment_installment_mismatch',
      'payment_amount_mismatch'
    );
--> statement-breakpoint

-- 0108 permite herdar uma condicao historica em uma remarcacao exata. O mesmo
-- criterio precisa valer para absorb_fees; uma criacao nova usa a politica atual.
CREATE OR REPLACE FUNCTION public.validate_appointment_commercial_price_snapshot() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  exact_reschedule boolean := false;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.rescheduled_from_appointment_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.appointments previous
      WHERE previous.id = NEW.rescheduled_from_appointment_id
        AND previous.clinic_id = NEW.clinic_id
        AND previous.patient_id IS NOT DISTINCT FROM NEW.patient_id
        AND previous.doctor_id = NEW.doctor_id
        AND previous.procedure_id = NEW.procedure_id
        AND previous.status = 'cancelado'
        AND previous.valor = NEW.valor
        AND previous.pricing_policy_mode = NEW.pricing_policy_mode
        AND previous.commercial_payment_method IS NOT DISTINCT FROM NEW.commercial_payment_method
        AND previous.commercial_installment_count IS NOT DISTINCT FROM NEW.commercial_installment_count
        AND previous.commercial_price_id IS NOT DISTINCT FROM NEW.commercial_price_id
    ) INTO exact_reschedule;
  END IF;

  IF TG_OP = 'INSERT'
    AND NEW.pricing_policy_mode = 'absorb_fees'
    AND NOT exact_reschedule
    AND EXISTS (
      SELECT 1 FROM public.clinic_payment_pricing_policies policy
      JOIN public.subscriptions subscription ON subscription.clinic_id = policy.clinic_id
      JOIN public.plans plan ON plan.id = subscription.plan_id
      WHERE policy.clinic_id = NEW.clinic_id
        AND policy.mode = 'payment_method_pricing'
        AND plan.code IN ('clinica', 'pro')
    ) THEN
    RAISE EXCEPTION 'Politica comercial ativa exige preco por meio de pagamento.';
  END IF;

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
        OR exact_reschedule
      )
  ) THEN
    RAISE EXCEPTION 'Preco comercial do atendimento nao corresponde a versao configurada.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
