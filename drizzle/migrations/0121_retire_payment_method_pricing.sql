-- A precificação por meio de pagamento foi retirada da oferta. Preserva
-- appointments/charges e as versões históricas para auditoria e remarcação.
UPDATE public.clinic_payment_pricing_policies
SET mode = 'absorb_fees', updated_at = now()
WHERE mode <> 'absorb_fees';
--> statement-breakpoint
UPDATE public.procedure_payment_prices
SET active = false,
    effective_to = greatest(now(), effective_from),
    updated_at = now()
WHERE active = true;
--> statement-breakpoint
ALTER TABLE public.procedure_payment_prices
  ALTER COLUMN active SET DEFAULT false;
--> statement-breakpoint
ALTER TABLE public.procedure_payment_prices
  ADD CONSTRAINT procedure_payment_prices_retired_chk
  CHECK (active = false);
--> statement-breakpoint
ALTER TABLE public.clinic_payment_pricing_policies
  DROP CONSTRAINT clinic_payment_pricing_policies_mode_chk;
--> statement-breakpoint
ALTER TABLE public.clinic_payment_pricing_policies
  ADD CONSTRAINT clinic_payment_pricing_policies_mode_chk
  CHECK (mode = 'absorb_fees');
