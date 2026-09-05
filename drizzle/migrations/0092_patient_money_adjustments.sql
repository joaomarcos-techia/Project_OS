-- 0092 - D50/D27: intenção de estorno no Payments e razão financeira append-only.
--
-- O excedente de uma cobrança não pertence ao recebível: `payment_transactions`
-- só pode registrar o valor efetivamente aplicado ao lançamento. Esta migration
-- preserva essa fronteira com duas peças pequenas:
--   * Payments persiste a intenção ANTES do POST de estorno;
--   * Financial registra a saída em um ledger próprio do crédito do paciente.

DO $$ BEGIN
  CREATE TYPE patient_refund_intent_status AS ENUM (
    'pending',
    'submitting',
    'confirmation_pending',
    'confirmed',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE patient_charge_dispute_status AS ENUM (
    'requested',
    'in_dispute',
    'awaiting_reversal',
    'reversed',
    'lost',
    'cash_undone'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE patient_credit_dispute_status AS ENUM (
    'requested',
    'in_dispute',
    'awaiting_reversal',
    'reversed',
    'lost',
    'cash_undone'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE patient_credit_adjustment_kind AS ENUM (
    'excess_refund',
    'chargeback_loss',
    'cash_undone'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE public.patient_charges
  ADD COLUMN IF NOT EXISTS dispute_status patient_charge_dispute_status;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.patient_refund_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_charge_id uuid NOT NULL REFERENCES public.patient_charges(id) ON DELETE RESTRICT,
  purpose text NOT NULL DEFAULT 'excess',
  amount numeric(12,2) NOT NULL,
  status patient_refund_intent_status NOT NULL DEFAULT 'pending',
  provider_payment_id text NOT NULL,
  provider_refund_id text,
  baseline_refunded_amount numeric(12,2),
  attempted_at timestamptz,
  confirmed_at timestamptz,
  failure_code text,
  source_event_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_refund_intents_purpose_chk CHECK (purpose = 'excess'),
  CONSTRAINT patient_refund_intents_amount_chk CHECK (amount > 0),
  CONSTRAINT patient_refund_intents_baseline_chk CHECK (
    baseline_refunded_amount IS NULL OR baseline_refunded_amount >= 0
  ),
  CONSTRAINT patient_refund_intents_confirmed_chk CHECK (
    (status = 'confirmed') = (confirmed_at IS NOT NULL)
  ),
  CONSTRAINT patient_refund_intents_charge_purpose_uniq
    UNIQUE (clinic_id, patient_charge_id, purpose),
  CONSTRAINT patient_refund_intents_source_event_uniq
    UNIQUE (clinic_id, source_event_id)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS patient_refund_intents_provider_refund_uniq
  ON public.patient_refund_intents (clinic_id, provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patient_refund_intents_reconcile_idx
  ON public.patient_refund_intents (updated_at)
  WHERE status IN ('submitting', 'confirmation_pending');
--> statement-breakpoint

ALTER TABLE public.patient_refund_intents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.patient_refund_intents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY patient_refund_intents_read ON public.patient_refund_intents FOR SELECT
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY patient_refund_intents_write ON public.patient_refund_intents FOR INSERT
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY patient_refund_intents_update ON public.patient_refund_intents FOR UPDATE
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint

REVOKE ALL ON public.patient_refund_intents FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.patient_refund_intents TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.patient_refund_intents TO service_role;
--> statement-breakpoint

ALTER TABLE public.patient_credits
  ADD COLUMN IF NOT EXISTS allocated_payment_transaction_id uuid,
  ADD COLUMN IF NOT EXISTS unallocated_reversed_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allocated_reversed_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispute_status patient_credit_dispute_status;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE public.patient_credits
    ADD CONSTRAINT patient_credits_allocated_payment_transaction_fkey
    FOREIGN KEY (allocated_payment_transaction_id)
    REFERENCES public.payment_transactions(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE public.patient_credits
    ADD CONSTRAINT patient_credits_reversed_amounts_chk CHECK (
      unallocated_reversed_amount >= 0
      AND allocated_reversed_amount >= 0
      AND unallocated_reversed_amount <= amount - allocated_amount
      AND allocated_reversed_amount <= allocated_amount
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE public.patient_credits VALIDATE CONSTRAINT patient_credits_reversed_amounts_chk;
--> statement-breakpoint

-- Créditos novos gravam a baixa no momento da alocação. Para linhas anteriores
-- à 0092, preencher somente quando o vínculo é inequivocamente 1:1. Casos
-- ambíguos permanecem NULL e vão para conciliação humana em eventual reversão;
-- escolher uma baixa por aproximação corromperia o ledger.
WITH candidates AS (
  SELECT
    pc.id AS credit_id,
    pt.id AS payment_id,
    count(*) OVER (PARTITION BY pc.id) AS credit_matches,
    count(*) OVER (PARTITION BY pt.id) AS payment_matches
  FROM public.patient_credits pc
  JOIN public.payment_transactions pt
    ON pt.clinic_id = pc.clinic_id
   AND pt.lancamento_id = pc.allocated_lancamento_id
   AND pt.kind = 'payment'
   AND pt.amount = pc.allocated_amount
   AND pt.payment_method IS NOT DISTINCT FROM pc.payment_method
  WHERE pc.allocated_payment_transaction_id IS NULL
    AND pc.allocated_lancamento_id IS NOT NULL
    AND pc.allocated_amount > 0
)
UPDATE public.patient_credits pc
SET allocated_payment_transaction_id = candidates.payment_id,
    updated_at = now()
FROM candidates
WHERE pc.id = candidates.credit_id
  AND candidates.credit_matches = 1
  AND candidates.payment_matches = 1;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS patient_credits_allocated_payment_transaction_idx
  ON public.patient_credits (allocated_payment_transaction_id)
  WHERE allocated_payment_transaction_id IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.patient_credit_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_credit_id uuid NOT NULL REFERENCES public.patient_credits(id) ON DELETE RESTRICT,
  patient_charge_id uuid NOT NULL,
  kind patient_credit_adjustment_kind NOT NULL,
  amount numeric(12,2) NOT NULL,
  source_event_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_credit_adjustments_amount_chk CHECK (amount > 0),
  CONSTRAINT patient_credit_adjustments_source_event_uniq UNIQUE (clinic_id, source_event_id)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patient_credit_adjustments_credit_idx
  ON public.patient_credit_adjustments (patient_credit_id, occurred_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_credit_adjustments_charge_idx
  ON public.patient_credit_adjustments (clinic_id, patient_charge_id);
--> statement-breakpoint

ALTER TABLE public.patient_credit_adjustments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.patient_credit_adjustments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY patient_credit_adjustments_read ON public.patient_credit_adjustments FOR SELECT
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY patient_credit_adjustments_write ON public.patient_credit_adjustments FOR INSERT
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint

REVOKE ALL ON public.patient_credit_adjustments FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.patient_credit_adjustments TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.patient_credit_adjustments TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0092-patient-money-adjustments')
ON CONFLICT (version) DO NOTHING;
