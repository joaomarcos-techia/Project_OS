-- 0169 (CANDIDATA, fora do journal) — P4.7-b: referência HISTÓRICA de convênio para atendimentos importados.
--
-- Número: 0168 é a `saas_pix_replacement_intents` do #64, já aplicada no DEV (ledger de 25/11: 169 linhas, a
-- última com hash 844cf2f2…). Esta candidata entra depois dela, só na integração final #53 → #56 → #55.
--
-- O que é: a importação histórica (agenda › importar) passa a aceitar, por linha, que o atendimento antigo foi de
-- convênio, com a operadora (registro ANS) e o plano. Isso fica numa tabela PRÓPRIA, que o faturamento NUNCA lê:
--   - não usa hi_appointment_coverages (exige registro antes do atendimento e alimenta o faturamento);
--   - nenhuma guia, pendência, recebível ou coparticipação nasce daqui (a guarda `created_via = 'import'` do
--     faturamento continua valendo, 0005813e);
--   - aditiva: só cria tabela, funções e gatilhos; não altera dado existente.
--
-- Regras no banco (além da validação linha a linha no app):
--   - comercial (0151) e módulo (0164): só com Convênios contratado e ligado (mesmos gatilhos do módulo);
--   - o atendimento é da mesma clínica, importado (`created_via = 'import'`), do MESMO lote e com
--     `billing_mode = 'convenio'`;
--   - a operadora é da clínica e está ativa; o plano, se houver, é dessa operadora;
--   - uma referência por atendimento (PK) — reimportar o mesmo atendimento não duplica;
--   - imutável: não há UPDATE pelo app; o histórico não se reescreve;
--   - RLS forçada por clínica (defaultTenantPolicy v2).

CREATE TABLE public.hi_historical_coverages (
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  insurer_id uuid NOT NULL,
  plan_id uuid,
  import_batch_id uuid NOT NULL REFERENCES public.appointment_import_batches(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hi_historical_coverages_pk PRIMARY KEY (clinic_id, appointment_id),
  CONSTRAINT hi_historical_coverages_insurer_fk FOREIGN KEY (clinic_id, insurer_id)
    REFERENCES public.hi_insurers (clinic_id, id),
  CONSTRAINT hi_historical_coverages_plan_fk FOREIGN KEY (clinic_id, plan_id)
    REFERENCES public.hi_plans (clinic_id, id)
);
--> statement-breakpoint
CREATE INDEX hi_historical_coverages_batch_idx ON public.hi_historical_coverages (clinic_id, import_batch_id);
--> statement-breakpoint
CREATE INDEX hi_historical_coverages_insurer_idx ON public.hi_historical_coverages (clinic_id, insurer_id);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hi_historical_coverage_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appt record;
  v_insurer record;
  v_plan_insurer uuid;
BEGIN
  SELECT clinic_id, created_via::text AS created_via, billing_mode::text AS billing_mode, import_batch_id
    INTO v_appt
    FROM public.appointments WHERE id = NEW.appointment_id;
  IF v_appt IS NULL OR v_appt.clinic_id IS DISTINCT FROM NEW.clinic_id THEN
    RAISE EXCEPTION 'hi_historical_coverage: atendimento fora da clínica' USING ERRCODE = '23514';
  END IF;
  IF v_appt.created_via IS DISTINCT FROM 'import' OR v_appt.import_batch_id IS DISTINCT FROM NEW.import_batch_id THEN
    RAISE EXCEPTION 'hi_historical_coverage: só atendimento importado, do mesmo lote' USING ERRCODE = '23514';
  END IF;
  IF v_appt.billing_mode IS DISTINCT FROM 'convenio' THEN
    RAISE EXCEPTION 'hi_historical_coverage: o atendimento importado não está como convênio' USING ERRCODE = '23514';
  END IF;
  SELECT clinic_id, status INTO v_insurer FROM public.hi_insurers WHERE id = NEW.insurer_id;
  IF v_insurer IS NULL OR v_insurer.clinic_id IS DISTINCT FROM NEW.clinic_id OR v_insurer.status <> 'active' THEN
    RAISE EXCEPTION 'hi_historical_coverage: operadora inexistente, de outra clínica ou inativa' USING ERRCODE = '23514';
  END IF;
  IF NEW.plan_id IS NOT NULL THEN
    SELECT insurer_id INTO v_plan_insurer FROM public.hi_plans WHERE id = NEW.plan_id AND clinic_id = NEW.clinic_id;
    IF v_plan_insurer IS DISTINCT FROM NEW.insurer_id THEN
      RAISE EXCEPTION 'hi_historical_coverage: o plano não é dessa operadora' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_historical_coverage_insert_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hi_historical_coverage_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'hi_historical_coverage: a referência histórica não se altera' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_historical_coverage_immutable() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- Ordem alfabética dos gatilhos: hi_aa_premium (comercial, 0151) → hi_ab_module (0164) → hi_b_* (regras).
CREATE TRIGGER hi_aa_premium_historical_coverages BEFORE INSERT ON public.hi_historical_coverages
  FOR EACH ROW EXECUTE FUNCTION public.hi_premium_guard();
--> statement-breakpoint
CREATE TRIGGER hi_ab_module_historical_coverages BEFORE INSERT ON public.hi_historical_coverages
  FOR EACH ROW EXECUTE FUNCTION public.hi_module_guard();
--> statement-breakpoint
CREATE TRIGGER hi_b_historical_coverages_insert_guard BEFORE INSERT ON public.hi_historical_coverages
  FOR EACH ROW EXECUTE FUNCTION public.hi_historical_coverage_insert_guard();
--> statement-breakpoint
CREATE TRIGGER hi_b_historical_coverages_immutable BEFORE UPDATE ON public.hi_historical_coverages
  FOR EACH ROW EXECUTE FUNCTION public.hi_historical_coverage_immutable();
--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_historical_coverages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_historical_coverages FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_historical_coverages_tenant_access ON public.hi_historical_coverages FOR ALL
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

REVOKE ALL ON public.hi_historical_coverages FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON public.hi_historical_coverages TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.hi_historical_coverages TO service_role;
--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0169-hi-historical-coverages')
  ON CONFLICT DO NOTHING;
