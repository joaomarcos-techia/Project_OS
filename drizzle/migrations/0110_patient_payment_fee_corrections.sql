-- 0110 - Revisoes economicas monotônicas e ajustes imutáveis da tarifa Asaas.
ALTER TABLE public.patient_charges
  ADD COLUMN IF NOT EXISTS provider_economics_revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE public.patient_charges
   SET provider_economics_revision = 1
 WHERE economics_reconciled_at IS NOT NULL AND provider_economics_revision = 0;
--> statement-breakpoint
ALTER TABLE public.patient_charges
  ADD CONSTRAINT patient_charges_economics_revision_chk CHECK (
    provider_economics_revision >= 0
    AND ((provider_economics_revision = 0 AND economics_reconciled_at IS NULL)
      OR (provider_economics_revision >= 1 AND economics_reconciled_at IS NOT NULL))
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_charges_fee_correction_scan_idx
  ON public.patient_charges (provider_reconcile_checked_at ASC NULLS FIRST, paid_at ASC NULLS FIRST, id ASC)
  WHERE status = 'paid' AND provider_payment_id IS NOT NULL
    AND economics_reconciled_at IS NOT NULL;
--> statement-breakpoint

ALTER TABLE public.patient_credits
  ADD COLUMN IF NOT EXISTS provider_economics_revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE public.patient_credits
   SET provider_economics_revision = 1
 WHERE provider_economics_reconciled_at IS NOT NULL AND provider_economics_revision = 0;
--> statement-breakpoint
ALTER TABLE public.patient_credits
  ADD CONSTRAINT patient_credits_economics_revision_chk CHECK (
    provider_economics_revision >= 0
    AND ((provider_economics_revision = 0 AND provider_economics_reconciled_at IS NULL)
      OR (provider_economics_revision >= 1 AND provider_economics_reconciled_at IS NOT NULL))
  );
--> statement-breakpoint

ALTER TABLE public.lancamentos
  ADD COLUMN IF NOT EXISTS provider_economics_revision integer,
  ADD COLUMN IF NOT EXISTS source_event_id uuid,
  ADD COLUMN IF NOT EXISTS provider_payment_id text;
--> statement-breakpoint
DROP INDEX IF EXISTS public.lancamentos_provider_expense_uniq;
--> statement-breakpoint
CREATE UNIQUE INDEX lancamentos_provider_expense_uniq
  ON public.lancamentos (clinic_id, source_patient_charge_id, financial_expense_kind)
  WHERE source_patient_charge_id IS NOT NULL AND provider_economics_revision IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX lancamentos_provider_expense_adjustment_uniq
  ON public.lancamentos (clinic_id, source_patient_charge_id, provider_economics_revision)
  WHERE provider_economics_revision IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.lancamentos DROP CONSTRAINT lancamentos_provider_expense_coherence_chk;
--> statement-breakpoint
ALTER TABLE public.lancamentos
  ADD CONSTRAINT lancamentos_provider_expense_coherence_chk CHECK (
    (source_patient_charge_id IS NULL AND financial_expense_kind IS NULL
      AND provider_economics_revision IS NULL AND source_event_id IS NULL
      AND provider_payment_id IS NULL)
    OR (source_patient_charge_id IS NOT NULL
      AND financial_expense_kind IN ('payment_processing_fee', 'early_settlement_fee')
      AND tipo = 'pagar' AND provider_economics_revision IS NULL
      AND source_event_id IS NULL AND provider_payment_id IS NULL)
    OR (source_patient_charge_id IS NOT NULL
      AND financial_expense_kind = 'payment_processing_fee_adjustment'
      AND provider_economics_revision >= 2 AND source_event_id IS NOT NULL
      AND provider_payment_id IS NOT NULL)
  );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.block_lancamento_immutable_cols() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.clinic_id                  IS DISTINCT FROM OLD.clinic_id
  OR NEW.tipo                       IS DISTINCT FROM OLD.tipo
  OR NEW.valor                      IS DISTINCT FROM OLD.valor
  OR NEW.created_via                IS DISTINCT FROM OLD.created_via
  OR NEW.appointment_id             IS DISTINCT FROM OLD.appointment_id
  OR NEW.reverses_lancamento_id     IS DISTINCT FROM OLD.reverses_lancamento_id
  OR NEW.source_patient_charge_id   IS DISTINCT FROM OLD.source_patient_charge_id
  OR NEW.financial_expense_kind     IS DISTINCT FROM OLD.financial_expense_kind
  OR NEW.provider_economics_revision IS DISTINCT FROM OLD.provider_economics_revision
  OR NEW.source_event_id            IS DISTINCT FROM OLD.source_event_id
  OR NEW.provider_payment_id        IS DISTINCT FROM OLD.provider_payment_id THEN
    RAISE EXCEPTION 'Lançamento é append-only: origem e valores são imutáveis.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0110-patient-payment-fee-corrections')
ON CONFLICT (version) DO NOTHING;
--> statement-breakpoint
