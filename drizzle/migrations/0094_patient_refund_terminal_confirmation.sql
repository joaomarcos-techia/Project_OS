-- 0094 — D77: estorno comum do sinal só fecha após confirmação terminal.
--
-- Amplia a intenção criada na 0092 para o closeout do sinal. Os contadores de
-- baseline são necessários porque o Asaas pode devolver refund sem `id`; nesse
-- caso, comparar somente o total DONE não distingue uma solicitação PENDING de
-- uma solicitação nova que terminou CANCELLED.
ALTER TABLE public.patient_refund_intents
  ADD COLUMN IF NOT EXISTS baseline_refund_count integer,
  ADD COLUMN IF NOT EXISTS baseline_rejected_refund_count integer;
--> statement-breakpoint

ALTER TABLE public.patient_refund_intents
  DROP CONSTRAINT IF EXISTS patient_refund_intents_purpose_chk;
--> statement-breakpoint
ALTER TABLE public.patient_refund_intents
  ADD CONSTRAINT patient_refund_intents_purpose_chk
  CHECK (purpose IN ('excess', 'deposit_closeout')) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.patient_refund_intents
  VALIDATE CONSTRAINT patient_refund_intents_purpose_chk;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE public.patient_refund_intents
    ADD CONSTRAINT patient_refund_intents_baseline_counts_chk CHECK (
      (baseline_refund_count IS NULL OR baseline_refund_count >= 0)
      AND (
        baseline_rejected_refund_count IS NULL
        OR baseline_rejected_refund_count >= 0
      )
      AND (
        baseline_refund_count IS NULL
        OR baseline_rejected_refund_count IS NULL
        OR baseline_rejected_refund_count <= baseline_refund_count
      )
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE public.patient_refund_intents
  VALIDATE CONSTRAINT patient_refund_intents_baseline_counts_chk;
--> statement-breakpoint

INSERT INTO _schema_version (version)
VALUES ('0094-patient-refund-terminal-confirmation')
ON CONFLICT (version) DO NOTHING;
