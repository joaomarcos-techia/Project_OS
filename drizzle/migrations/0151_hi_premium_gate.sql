-- =====================================================================
-- 0151 — Bloqueio comercial dos recursos premium (D24, decisão definitiva do
-- fundador em 11/11/2026). QORO_TISS_MASTER_PLAN.md, R33.
--
-- Regra: o trial de 14 dias é para conhecer o Qoro. Convênios TISS, cobrança
-- de pacientes pelo Asaas e Agentes de IA só funcionam para clínica com
-- assinatura paga e ativa, no plano que inclui o recurso. Mostrar o recurso não
-- é liberar o uso.
--
-- O que esta migration faz:
--   1. `qoro_premium_denial_for(clinic, feature)`: a ÚNICA decisão comercial, no
--      banco. Devolve NULL (liberado) ou o motivo (texto fixo). Lê o estado de
--      billing que o backend já mantém: `subscriptions.billing_status`,
--      `clinics.status` (o dunning, ADR-016/046, é quem reduz o acesso) e, quando
--      a tabela existir, a política de trial do PR #53 (`trial_access_policies`,
--      liberada só por fatura paga verificada). Sem dependência de DDL do #53:
--      a consulta é dinâmica e só roda se a tabela existir.
--   2. `qoro_premium_denial(clinic, feature)`: a mesma decisão para o app, presa à
--      clínica da sessão (a função ignora RLS e não pode falar de outra clínica).
--   3. Gatilhos que barram as OPERAÇÕES NOVAS de Convênios quando a decisão nega:
--      ligar o módulo, marcar atendimento como convênio, registrar carteirinha,
--      cobertura e autorização, criar guia, emitir (snapshot), gravar arquivo
--      emitido, criar/validar/exportar/enviar lote e confirmar coparticipação.
--      Continuam permitidos: ler, baixar arquivo já emitido (auditado), cancelar,
--      registrar protocolo, retorno, análise e processamento de lote já enviado
--      (são fatos da operadora sobre trabalho já entregue; recusá-los perderia
--      dado financeiro), desligar o módulo e tudo que é pendência (gaps).
--   4. Motivo novo em `hi_billing_gaps`: `subscription_inactive` (atendimento de
--      convênio concluído enquanto a assinatura não está ativa: nenhuma guia é
--      gerada; o reconcile recupera depois da regularização).
--
-- Nada é apagado nem escondido quando a assinatura cai: guias, snapshots, XMLs,
-- PDFs e lançamentos continuam onde estão (retenção, ADR-017 e
-- docs/convenios/retencao-lgpd.md). Só operação nova é barrada.
--
-- Erro: SQLSTATE 23514 com CONSTRAINT = 'qoro_premium_<feature>' e DETAIL = motivo
-- (texto fixo, nunca dado de paciente). `premiumAccessErrorFrom` traduz para a
-- mensagem do usuário, no mesmo padrão do `qoro_trial_limit_*` do #53.
--
-- Plano x recurso: hoje todo plano pago inclui os três recursos (nenhum plano
-- exclui IA, cobrança ou convênio). Código de plano desconhecido = excluído
-- (falha fechada). Mudar a inclusão por plano é decisão comercial do fundador:
-- altera só `qoro_plan_includes`.
--
-- Sem BEGIN/COMMIT: o migrator do drizzle já roda tudo numa transação (0045).
--
-- Rollback (reverso; nada aplicado no DEV nem em produção):
--   DROP TRIGGER IF EXISTS hi_aa_premium_settings ON public.hi_clinic_settings;
--   DROP TRIGGER IF EXISTS a0_hi_premium_appointment ON public.appointments;
--   DROP TRIGGER IF EXISTS hi_aa_premium_memberships ON public.hi_memberships;
--   DROP TRIGGER IF EXISTS hi_aa_premium_coverages ON public.hi_appointment_coverages;
--   DROP TRIGGER IF EXISTS hi_aa_premium_authorizations ON public.hi_authorizations;
--   DROP TRIGGER IF EXISTS hi_aa_premium_guides ON public.hi_guides;
--   DROP TRIGGER IF EXISTS hi_aa_premium_snapshots ON public.hi_guide_snapshots;
--   DROP TRIGGER IF EXISTS hi_aa_premium_files ON public.hi_files;
--   DROP TRIGGER IF EXISTS hi_aa_premium_batches ON public.hi_batches;
--   DROP TRIGGER IF EXISTS hi_aa_premium_copayments ON public.hi_copayments;
--   DROP FUNCTION IF EXISTS public.hi_premium_guard(), public.hi_premium_guard_appointment(),
--     public.qoro_premium_denial(uuid, text), public.qoro_premium_denial_for(uuid, text),
--     public.qoro_plan_includes(text, text);
--   (e restaurar o CHECK de motivo de hi_billing_gaps da 0149)
--   DELETE FROM public._schema_version WHERE version = '0151-hi-premium-gate';
-- =====================================================================

-- ── Plano x recurso ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qoro_plan_includes(p_plan_code text, p_feature text) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_feature
    WHEN 'health_insurance' THEN p_plan_code IN (
      'solo', 'clinica', 'pro', 'consultorio_2026', 'clinica_2026_2', 'clinica_2026_3', 'clinica_2026_4', 'clinica_2026_5')
    WHEN 'patient_charges' THEN p_plan_code IN (
      'solo', 'clinica', 'pro', 'consultorio_2026', 'clinica_2026_2', 'clinica_2026_3', 'clinica_2026_4', 'clinica_2026_5')
    WHEN 'ai_agents' THEN p_plan_code IN (
      'solo', 'clinica', 'pro', 'consultorio_2026', 'clinica_2026_2', 'clinica_2026_3', 'clinica_2026_4', 'clinica_2026_5')
    ELSE false
  END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.qoro_plan_includes(text, text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.qoro_plan_includes(text, text) TO authenticated, service_role;
--> statement-breakpoint

-- ── A decisão (núcleo, sem vínculo de sessão: só gatilhos e o dono chamam) ──
CREATE OR REPLACE FUNCTION public.qoro_premium_denial_for(p_clinic_id uuid, p_feature text) RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_clinic_status text;
  v_billing text;
  v_trial_ends timestamptz;
  v_plan text;
  v_restricted boolean := false;
BEGIN
  IF p_feature IS NULL OR p_feature NOT IN ('health_insurance', 'patient_charges', 'ai_agents') THEN
    RAISE EXCEPTION 'Recurso premium desconhecido.' USING ERRCODE = '22023';
  END IF;
  SELECT c.status::text INTO v_clinic_status FROM public.clinics c WHERE c.id = p_clinic_id;
  IF NOT FOUND THEN
    RETURN 'clinic_unknown';
  END IF;
  SELECT s.billing_status::text, s.trial_ends_at, pl.code
    INTO v_billing, v_trial_ends, v_plan
    FROM public.subscriptions s
    JOIN public.plans pl ON pl.id = s.plan_id
   WHERE s.clinic_id = p_clinic_id;
  IF NOT FOUND THEN
    RETURN 'no_subscription';
  END IF;
  -- Política de trial do PR #53 (0136): existe e não foi liberada por fatura paga.
  IF to_regclass('public.trial_access_policies') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.trial_access_policies WHERE clinic_id = $1 AND released_at IS NULL)'
      INTO v_restricted USING p_clinic_id;
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

-- ── A decisão para o app: presa à clínica da sessão ─────────────────────
CREATE OR REPLACE FUNCTION public.qoro_premium_denial(p_clinic_id uuid, p_feature text) RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_clinic_id IS NULL OR current_setting('app.current_clinic', true) IS DISTINCT FROM p_clinic_id::text THEN
    RAISE EXCEPTION 'Consulta comercial fora da clínica da sessão.' USING ERRCODE = '42501';
  END IF;
  RETURN public.qoro_premium_denial_for(p_clinic_id, p_feature);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.qoro_premium_denial(uuid, text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.qoro_premium_denial(uuid, text) TO authenticated, service_role;
--> statement-breakpoint

-- ── Gatilho genérico das operações novas de Convênios ───────────────────
-- Os nomes (`hi_aa_premium_*`, `a0_hi_premium_*`) fazem estes gatilhos dispararem
-- ANTES dos de validação de cada tabela (o Postgres ordena por nome): no trial, a
-- resposta é a restrição comercial, não um erro de dado incompleto.
CREATE OR REPLACE FUNCTION public.hi_premium_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_denial text;
  v_new_operation boolean := true;
BEGIN
  IF TG_TABLE_NAME = 'hi_clinic_settings' THEN
    -- Só LIGAR o módulo é operação nova; desligar e editar cadastro, não.
    v_new_operation := NEW.enabled AND (TG_OP = 'INSERT' OR NOT OLD.enabled);
  ELSIF TG_TABLE_NAME = 'hi_files' THEN
    -- O retorno da operadora é fato sobre trabalho já entregue.
    v_new_operation := NEW.kind <> 'batch_return';
  ELSIF TG_TABLE_NAME = 'hi_batches' THEN
    v_new_operation := TG_OP = 'INSERT'
      OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('validated', 'exported', 'sent'));
  ELSIF TG_TABLE_NAME = 'hi_copayments' THEN
    v_new_operation := TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
      AND NEW.status IN ('confirmed', 'charged');
  END IF;
  IF NOT v_new_operation THEN
    RETURN NEW;
  END IF;
  v_denial := public.qoro_premium_denial_for(NEW.clinic_id, 'health_insurance');
  IF v_denial IS NOT NULL THEN
    RAISE EXCEPTION 'Convênios exige assinatura ativa da clínica.'
      USING ERRCODE = '23514', CONSTRAINT = 'qoro_premium_health_insurance', DETAIL = v_denial;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_premium_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- Marcar atendimento como convênio é operação nova (a 0148 já exige o módulo ligado).
CREATE OR REPLACE FUNCTION public.hi_premium_guard_appointment() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_denial text;
BEGIN
  IF NEW.billing_mode IS DISTINCT FROM 'convenio' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.billing_mode IS NOT DISTINCT FROM NEW.billing_mode THEN
    RETURN NEW;
  END IF;
  v_denial := public.qoro_premium_denial_for(NEW.clinic_id, 'health_insurance');
  IF v_denial IS NOT NULL THEN
    RAISE EXCEPTION 'Convênios exige assinatura ativa da clínica.'
      USING ERRCODE = '23514', CONSTRAINT = 'qoro_premium_health_insurance', DETAIL = v_denial;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_premium_guard_appointment() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

CREATE TRIGGER hi_aa_premium_settings BEFORE INSERT OR UPDATE OF enabled ON public.hi_clinic_settings
  FOR EACH ROW EXECUTE FUNCTION public.hi_premium_guard();
--> statement-breakpoint
CREATE TRIGGER a0_hi_premium_appointment BEFORE INSERT OR UPDATE OF billing_mode ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.hi_premium_guard_appointment();
--> statement-breakpoint
CREATE TRIGGER hi_aa_premium_memberships BEFORE INSERT ON public.hi_memberships
  FOR EACH ROW EXECUTE FUNCTION public.hi_premium_guard();
--> statement-breakpoint
CREATE TRIGGER hi_aa_premium_coverages BEFORE INSERT ON public.hi_appointment_coverages
  FOR EACH ROW EXECUTE FUNCTION public.hi_premium_guard();
--> statement-breakpoint
CREATE TRIGGER hi_aa_premium_authorizations BEFORE INSERT ON public.hi_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.hi_premium_guard();
--> statement-breakpoint
CREATE TRIGGER hi_aa_premium_guides BEFORE INSERT ON public.hi_guides
  FOR EACH ROW EXECUTE FUNCTION public.hi_premium_guard();
--> statement-breakpoint
CREATE TRIGGER hi_aa_premium_snapshots BEFORE INSERT ON public.hi_guide_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.hi_premium_guard();
--> statement-breakpoint
CREATE TRIGGER hi_aa_premium_files BEFORE INSERT ON public.hi_files
  FOR EACH ROW EXECUTE FUNCTION public.hi_premium_guard();
--> statement-breakpoint
CREATE TRIGGER hi_aa_premium_batches BEFORE INSERT OR UPDATE OF status ON public.hi_batches
  FOR EACH ROW EXECUTE FUNCTION public.hi_premium_guard();
--> statement-breakpoint
CREATE TRIGGER hi_aa_premium_copayments BEFORE UPDATE OF status ON public.hi_copayments
  FOR EACH ROW EXECUTE FUNCTION public.hi_premium_guard();
--> statement-breakpoint

-- ── Pendência de faturamento: assinatura inativa ─────────────────────────
ALTER TABLE public.hi_billing_gaps DROP CONSTRAINT hi_billing_gaps_reason_chk;
--> statement-breakpoint
ALTER TABLE public.hi_billing_gaps ADD CONSTRAINT hi_billing_gaps_reason_chk CHECK (reason IN (
  'coverage_missing', 'coverage_cancelled', 'coverage_incomplete', 'authorization_pending',
  'authorization_denied', 'contract_missing', 'membership_invalid', 'guide_pending_data',
  'guide_inconsistent', 'guide_cancelled', 'sp_sadt_manual', 'module_disabled', 'return_within_window',
  'event_not_processed', 'processing_failed', 'subscription_inactive'
));
--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0151-hi-premium-gate')
  ON CONFLICT DO NOTHING;
