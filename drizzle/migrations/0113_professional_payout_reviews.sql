-- 0113 - revisão humana do repasse suspenso após estorno ou perda.
-- Decisão de produto de 07/10/2026: valor livre entre zero e o cálculo original,
-- motivo obrigatório, registrado por MANAGE_FINANCIAL em versões imutáveis.
-- O repasse guarda apenas o estado vigente; o histórico vive nas versões.

ALTER TABLE public.professional_payouts
  DROP CONSTRAINT professional_payouts_status_chk;
--> statement-breakpoint
ALTER TABLE public.professional_payouts
  ADD CONSTRAINT professional_payouts_status_chk CHECK (
    (status = 'pending_economics' AND calculation_basis = 'net'
      AND basis_amount IS NULL AND payout_amount IS NULL AND calculated_at IS NULL)
    OR (status = 'calculated' AND basis_amount IS NOT NULL
      AND payout_amount IS NOT NULL AND calculated_at IS NOT NULL)
    OR status = 'cancelled'
    OR (status = 'reviewed' AND basis_amount IS NOT NULL
      AND payout_amount IS NOT NULL AND calculated_at IS NOT NULL)
  );
--> statement-breakpoint

-- IDs de ator são snapshots opacos, sem FK para auth.users: excluir uma conta
-- não pode apagar nem reescrever uma decisão histórica.
CREATE TABLE IF NOT EXISTS public.professional_payout_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  payout_id uuid NOT NULL REFERENCES public.professional_payouts(id) ON DELETE CASCADE,
  version integer NOT NULL,
  ceiling_amount numeric(12,2) NOT NULL,
  reference_amount numeric(12,2),
  decided_amount numeric(12,2) NOT NULL,
  reason text NOT NULL,
  reversal_refunded_amount numeric(12,2) NOT NULL,
  reversal_loss boolean NOT NULL,
  decided_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT professional_payout_reviews_version_uniq UNIQUE (payout_id, version),
  CONSTRAINT professional_payout_reviews_version_chk CHECK (version >= 1),
  CONSTRAINT professional_payout_reviews_amount_chk CHECK (
    ceiling_amount >= 0
    AND decided_amount >= 0 AND decided_amount <= ceiling_amount
    AND (reference_amount IS NULL OR (reference_amount >= 0 AND reference_amount <= ceiling_amount))
    AND reversal_refunded_amount >= 0
  ),
  CONSTRAINT professional_payout_reviews_reason_chk CHECK (
    char_length(btrim(reason)) BETWEEN 3 AND 500
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS professional_payout_reviews_clinic_payout_idx
  ON public.professional_payout_reviews (clinic_id, payout_id, version);
--> statement-breakpoint

-- A FK não impede apontar para o repasse de outra clínica.
CREATE OR REPLACE FUNCTION public.validate_professional_payout_review() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.professional_payouts p
    WHERE p.id = NEW.payout_id AND p.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'Revisão de repasse inválida para a clínica.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.validate_professional_payout_review() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER professional_payout_reviews_validate
  BEFORE INSERT ON public.professional_payout_reviews
  FOR EACH ROW EXECUTE FUNCTION public.validate_professional_payout_review();
--> statement-breakpoint

-- Imutável inclusive para papéis com UPDATE: corrigir é inserir nova versão.
CREATE OR REPLACE FUNCTION public.block_professional_payout_review_update() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Revisão de repasse é imutável; registre uma nova versão.';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.block_professional_payout_review_update() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER professional_payout_reviews_immutable
  BEFORE UPDATE ON public.professional_payout_reviews
  FOR EACH ROW EXECUTE FUNCTION public.block_professional_payout_review_update();
--> statement-breakpoint

ALTER TABLE public.professional_payout_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_payout_reviews FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY professional_payout_reviews_read ON public.professional_payout_reviews
  FOR SELECT USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY professional_payout_reviews_write ON public.professional_payout_reviews
  FOR INSERT WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint
REVOKE ALL ON public.professional_payout_reviews FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.professional_payout_reviews TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.professional_payout_reviews TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0113-professional-payout-reviews')
ON CONFLICT (version) DO NOTHING;
