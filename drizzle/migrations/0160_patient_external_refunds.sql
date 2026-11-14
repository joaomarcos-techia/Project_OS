-- =====================================================================
-- 0160 — Estorno feito direto no Asaas (R54). CANDIDATA: provada em Postgres
-- descartável; aplicação no DEV só depois de pré-voo, backup verificável e coordenação
-- com o #53 (que tem a 0159 aplicada no DEV, fora do journal dele). Independente da 0159.
--
-- Até aqui o webhook de estorno só confirmava devoluções que o PRÓPRIO Qoro tinha pedido
-- (intenção persistida antes, D50/D77). Uma devolução feita pela clínica no painel do Asaas,
-- sem intenção, não aparecia no livro: a baixa continuava inteira (R54).
--
-- O que esta migration dá ao runtime:
--   1. `patient_credit_adjustment_kind` ganha `external_refund` — o ajuste do crédito do
--      paciente que o Financeiro grava ao compensar a baixa (mesmo livro do chargeback);
--   2. `patient_external_refunds` — a EVIDÊNCIA de cada estorno externo reconhecido, só de
--      inclusão. Uma linha por patamar acumulado (`external_total`) da cobrança: o item de
--      estorno do Asaas pode vir sem id, então a chave idempotente é o total já devolvido
--      por fora do Qoro. Reentrega, varredura e duas instâncias concorrentes caem no mesmo
--      UNIQUE. Guarda só status/valor/data dos estornos lidos na API (sem dado pessoal);
--   3. `patient_charges.refund_checked_at` — cursor da varredura de recuperação (webhook
--      perdido), com índice parcial nas cobranças pagas com pagamento no Asaas.
--
-- Nada é apagado nem reescrito: a baixa original fica; o Financeiro inclui o estorno
-- vinculado a ela (payment_transactions kind 'refund', original_payment_id).
--
-- Reversão (sem uso do valor novo do enum ainda gravado):
--   DROP TABLE public.patient_external_refunds;
--   DROP INDEX public.patient_charges_refund_check_idx;
--   ALTER TABLE public.patient_charges DROP COLUMN refund_checked_at;
--   -- o valor `external_refund` do enum não sai sem recriar o tipo; inofensivo se ficar.
--   DELETE FROM public._schema_version WHERE version = '0160-patient-external-refunds';
-- =====================================================================

ALTER TYPE public.patient_credit_adjustment_kind ADD VALUE IF NOT EXISTS 'external_refund';
--> statement-breakpoint

ALTER TABLE public.patient_charges ADD COLUMN IF NOT EXISTS refund_checked_at timestamptz;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patient_charges_refund_check_idx
  ON public.patient_charges (refund_checked_at ASC NULLS FIRST, paid_at DESC)
  WHERE status = 'paid' AND provider_payment_id IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.patient_external_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_charge_id uuid NOT NULL REFERENCES public.patient_charges(id) ON DELETE RESTRICT,
  appointment_id uuid NOT NULL,
  provider_payment_id text NOT NULL,
  -- Patamar acumulado devolvido por fora do Qoro DEPOIS deste reconhecimento.
  external_total numeric(12,2) NOT NULL,
  -- O que este reconhecimento acrescentou (external_total - patamar anterior).
  amount numeric(12,2) NOT NULL,
  -- Total DONE lido em GET /payments/{id}/refunds e o que as intenções do Qoro já explicam.
  provider_refunded_total numeric(12,2) NOT NULL,
  intents_claimed numeric(12,2) NOT NULL,
  provider_status text NOT NULL,
  full_refund boolean NOT NULL,
  source text NOT NULL,
  asaas_event_id text,
  evidence jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_external_refunds_amount_chk CHECK (amount > 0 AND external_total >= amount),
  CONSTRAINT patient_external_refunds_totals_chk CHECK (
    provider_refunded_total >= external_total AND intents_claimed >= 0
  ),
  CONSTRAINT patient_external_refunds_source_chk CHECK (source IN ('webhook', 'reconcile')),
  CONSTRAINT patient_external_refunds_evidence_chk CHECK (jsonb_typeof(evidence) = 'array'),
  CONSTRAINT patient_external_refunds_level_uniq UNIQUE (clinic_id, patient_charge_id, external_total)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patient_external_refunds_charge_idx
  ON public.patient_external_refunds (clinic_id, patient_charge_id, external_total DESC);
--> statement-breakpoint

ALTER TABLE public.patient_external_refunds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.patient_external_refunds FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY patient_external_refunds_read ON public.patient_external_refunds FOR SELECT
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY patient_external_refunds_write ON public.patient_external_refunds FOR INSERT
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint

-- Só inclusão: o runtime não altera nem apaga evidência financeira.
REVOKE ALL ON public.patient_external_refunds FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.patient_external_refunds TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.patient_external_refunds TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0160-patient-external-refunds')
ON CONFLICT (version) DO NOTHING;
