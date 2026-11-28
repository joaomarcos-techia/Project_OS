-- =====================================================================
-- 0154 — Convênios: decisão comercial alinhada ao billing central (D24-b) e assinatura
-- antiga sem período verificável (D24-c). CANDIDATA: provada em Postgres descartável; NÃO
-- aplicada no DEV nem em produção. Nenhum dado é alterado (sem backfill).
--
-- D24-b (decisão do fundador, 12/11): o TISS usa a política comercial CENTRAL do billing
-- (#53, `evaluateModuleAccess`), sem prazo próprio. A 0152 já reproduzia a carência; aqui
-- entram as duas regras do #53 que faltavam no banco:
--   - período que ainda não começou (`current_period_start` no futuro) → 'period_expired';
--   - assinatura da coorte nova do #53 (com linha em `trial_access_policies`, mesmo já
--     liberada por fatura paga) SEM período registrado → 'period_expired'.
--   Ambas são negativas que o #53 já faz: o banco não fica mais permissivo que o app.
--
-- D24-c (decisão do fundador, 12/11): assinatura ANTIGA (fora da coorte do #53) sem período
-- pago verificável não tem acesso premium indefinido só pelo status do dunning.
--   - Convênios (recurso ainda não liberado a nenhuma clínica): sem período registrado, só
--     com EVIDÊNCIA verificável — fatura PAGA da assinatura cujo período cobre hoje. Sem
--     ela: 'period_unverified' (operação NOVA negada, com motivo explícito; preservação de
--     obrigações anteriores segue liberada, D24-a).
--   - Cobrança de pacientes e Agentes de IA: mantêm a compatibilidade TRANSITÓRIA do #53
--     (status do dunning) para não bloquear em silêncio clínicas pagantes por falha de
--     migração de dados; ficam listadas no alerta administrativo abaixo até a regularização,
--     que é do billing (#53) e só roda com autorização.
--
-- Alerta administrativo: `qoro_subscription_period_audit` classifica toda assinatura ativa ou
-- em atraso (período verificado, inconsistente, pago sem atualização do período, antiga com
-- evidência de fatura, antiga sem evidência). Só `service_role` lê (console administrativo).
--
-- Sem BEGIN/COMMIT. Nada é apagado nem alterado; só funções e uma visão.
--
-- Reversão: restaurar `qoro_premium_denial_for` da 0152; DROP VIEW public.qoro_subscription_period_audit;
--   DELETE FROM public._schema_version WHERE version = '0154-hi-premium-period-evidence'.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.qoro_premium_denial_for(p_clinic_id uuid, p_feature text) RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_clinic_status text;
  v_billing text;
  v_trial_ends timestamptz;
  v_plan text;
  v_restricted boolean := false;
  v_enrolled boolean := false;
  v_sub_id uuid;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_grace timestamptz;
  v_cancel_at_end boolean;
  v_today date;
BEGIN
  IF p_feature IS NULL OR p_feature NOT IN ('health_insurance', 'patient_charges', 'ai_agents') THEN
    RAISE EXCEPTION 'Recurso premium desconhecido.' USING ERRCODE = '22023';
  END IF;
  SELECT c.status::text, (statement_timestamp() AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date
    INTO v_clinic_status, v_today FROM public.clinics c WHERE c.id = p_clinic_id;
  IF NOT FOUND THEN
    RETURN 'clinic_unknown';
  END IF;
  SELECT s.id, s.billing_status::text, s.trial_ends_at, pl.code, s.current_period_start, s.current_period_end,
         s.grace_period_until, coalesce(s.cancel_at_period_end, false)
    INTO v_sub_id, v_billing, v_trial_ends, v_plan, v_period_start, v_period_end, v_grace, v_cancel_at_end
    FROM public.subscriptions s
    JOIN public.plans pl ON pl.id = s.plan_id
   WHERE s.clinic_id = p_clinic_id;
  IF NOT FOUND THEN
    RETURN 'no_subscription';
  END IF;
  -- Política de trial do PR #53 (0136): existe (coorte nova) e se ainda não foi liberada.
  IF to_regclass('public.trial_access_policies') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.trial_access_policies WHERE clinic_id = $1 AND released_at IS NULL),
                    EXISTS (SELECT 1 FROM public.trial_access_policies WHERE clinic_id = $1)'
      INTO v_restricted, v_enrolled USING p_clinic_id;
  END IF;
  IF v_billing = 'trial' THEN
    IF v_trial_ends IS NOT NULL AND v_trial_ends <= statement_timestamp() THEN
      RETURN 'trial_expired';
    END IF;
    RETURN 'trial';
  END IF;
  IF v_restricted OR v_clinic_status = 'pending_payment' THEN
    RETURN 'payment_pending';
  END IF;
  IF v_clinic_status IN ('suspended_readonly', 'suspended') THEN
    RETURN 'clinic_suspended';
  END IF;
  IF v_clinic_status = 'cancelled' OR v_billing = 'cancelled' THEN
    RETURN 'subscription_cancelled';
  END IF;
  -- `past_due` com a clínica ainda ativa é a graça do dunning (ADR-016): quem
  -- reduz o acesso de uma clínica paga é o status que o dunning escreve.
  IF v_billing NOT IN ('active', 'past_due') THEN
    RETURN 'subscription_inactive';
  END IF;
  -- 0154 (D24-b): as duas regras de período do #53 que faltavam.
  IF v_period_start IS NOT NULL AND v_period_start > statement_timestamp() THEN
    RETURN 'period_expired';
  END IF;
  IF v_enrolled AND (v_period_start IS NULL OR v_period_end IS NULL) THEN
    RETURN 'period_expired';
  END IF;
  -- 0152: período pago vencido e fora da carência → negado. A carência é a que o billing
  -- grava (`grace_period_until`, PR #53: fim do período + dias de dunning); cancelamento no
  -- fim do período não tem carência. Mesma regra da `evaluateModuleAccess` do #53: nenhuma
  -- carência ilimitada, e `past_due` nunca vira pagamento confirmado.
  IF v_period_end IS NOT NULL AND v_period_end <= statement_timestamp()
     AND (v_cancel_at_end OR v_grace IS NULL OR v_grace <= statement_timestamp()) THEN
    RETURN 'period_expired';
  END IF;
  -- 0154 (D24-c): assinatura antiga sem período registrado. Convênios exige evidência
  -- verificável (fatura paga cujo período cobre hoje); cobrança e IA seguem a compatibilidade
  -- transitória do #53 e aparecem no alerta administrativo.
  IF p_feature = 'health_insurance' AND (v_period_start IS NULL OR v_period_end IS NULL) AND NOT EXISTS (
    SELECT 1 FROM public.invoices i
     WHERE i.subscription_id = v_sub_id AND i.status = 'paid'
       AND i.period_start IS NOT NULL AND i.period_end IS NOT NULL
       AND i.period_start <= v_today AND i.period_end >= v_today
  ) THEN
    RETURN 'period_unverified';
  END IF;
  IF NOT public.qoro_plan_includes(v_plan, p_feature) THEN
    RETURN 'plan_excludes';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.qoro_premium_denial_for(uuid, text) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.qoro_premium_denial_for(uuid, text) TO service_role;
--> statement-breakpoint

-- ── Alerta administrativo: assinaturas sem período pago verificável ────
CREATE VIEW public.qoro_subscription_period_audit AS
SELECT s.clinic_id, s.id AS subscription_id, s.billing_status::text AS billing_status,
       s.current_period_start, s.current_period_end, s.grace_period_until,
       ev.last_paid_period_end, ev.covering_paid_invoices,
       CASE
         WHEN (s.current_period_start IS NULL) <> (s.current_period_end IS NULL)
              OR s.current_period_start > s.current_period_end
              OR s.current_period_start > now() THEN 'inconsistent_period'
         WHEN s.current_period_end IS NOT NULL AND s.current_period_end <= now()
              AND ev.last_paid_period_end IS NOT NULL AND ev.last_paid_period_end >= now()::date THEN 'paid_without_period_update'
         WHEN s.current_period_end IS NOT NULL THEN 'verified_period'
         WHEN ev.covering_paid_invoices > 0 THEN 'legacy_paid_invoice_evidence'
         ELSE 'legacy_unverified'
       END AS classification
  FROM public.subscriptions s
  LEFT JOIN LATERAL (
    SELECT max(i.period_end) FILTER (WHERE i.status = 'paid') AS last_paid_period_end,
           count(*) FILTER (WHERE i.status = 'paid' AND i.period_start <= now()::date AND i.period_end >= now()::date)::int
             AS covering_paid_invoices
      FROM public.invoices i WHERE i.subscription_id = s.id
  ) ev ON true
 WHERE s.billing_status::text IN ('active', 'past_due');
--> statement-breakpoint
REVOKE ALL ON public.qoro_subscription_period_audit FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.qoro_subscription_period_audit TO service_role;
--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0154-hi-premium-period-evidence')
  ON CONFLICT DO NOTHING;
