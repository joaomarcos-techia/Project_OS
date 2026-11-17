-- =====================================================================
-- 0166 — Convênios: avisos de autorização entregues à clínica (P6.6).
--
-- Determinação do fundador (17/11/2026): o aviso de senha vencendo, vencida, sessões acabando e
-- operadora demorando tem de CHEGAR à clínica sem depender de alguém abrir a tela de autorizações.
-- Até aqui o cálculo só rodava na leitura da tela (authorization-alerts.ts).
-- Autorizada para o DEV; NÃO autorizada em produção. Prova em Postgres descartável:
-- scripts/security/health-insurance-authorization-alerts-db.ts (job convenios-synthetic-db.yml).
--
-- O QUE FAZ (só uma tabela hi_* nova; nada em tabela existente):
--   hi_authorization_alerts: UM registro por FATO (chave estável `alert_key`, única por clínica:
--   a mesma senha vencendo nunca vira dois avisos). Criado pela manutenção do fim do
--   `financial-reconcile` (ator de sistema), com:
--     - estado: `open` → `read` (quem leu é a pessoa da sessão, gravada pelo banco) ou
--       `open` → `cancelled` (o fato deixou de valer: a operadora respondeu, a senha mudou, a
--       autorização foi usada ou venceu). Aviso lido ou encerrado não volta;
--     - entrega: lote (`delivery_batch`), pedido, tentativas, erro (só o tipo) e `delivered_at`,
--       que não muda depois de gravado;
--     - `detail`: só datas e contagens (validade, dias, saldo). NUNCA nome de paciente, número de
--       carteirinha, senha ou dado clínico.
--   Gatilhos (SECURITY DEFINER, como os da 0165: leem a pessoa da sessão por `hi_session_actor()`,
--   que o papel authenticated não executa; sem EXECUTE para ninguém além do dono): na inclusão, o aviso nasce `open`, sem entrega nem leitura, e só com o módulo de
--   Convênios LIGADO na clínica (55000 `hi_module_enabled`, o mesmo da 0164); na alteração, os
--   campos do fato são imutáveis e só as transições acima passam.
--
-- O QUE NÃO FAZ: não envia nada (a entrega é do código, pelo outbox); não muda autorização, guia,
-- recebível, livro ou Caixa; não apaga nada (o runtime não tem DELETE).
--
-- Sem BEGIN/COMMIT. Reversão (com o código que conhece os avisos fora do ar):
--   DROP TABLE IF EXISTS public.hi_authorization_alerts;
--   DROP FUNCTION IF EXISTS public.hi_authorization_alert_update_guard();
--   DROP FUNCTION IF EXISTS public.hi_authorization_alert_insert_guard();
--   DELETE FROM public._schema_version WHERE version = '0166-hi-authorization-alerts';
-- =====================================================================

CREATE TABLE public.hi_authorization_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  authorization_id uuid NOT NULL,
  kind text NOT NULL,
  alert_key text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  delivery_batch text,
  delivery_requested_at timestamptz,
  delivered_at timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0,
  delivery_error text,
  read_at timestamptz,
  read_by uuid,
  cancelled_at timestamptz,
  cancel_reason text,
  CONSTRAINT hi_authorization_alerts_clinic_id_uniq UNIQUE (clinic_id, id),
  CONSTRAINT hi_authorization_alerts_key_uniq UNIQUE (clinic_id, alert_key),
  CONSTRAINT hi_authorization_alerts_authorization_fk FOREIGN KEY (clinic_id, authorization_id)
    REFERENCES public.hi_authorizations (clinic_id, id),
  CONSTRAINT hi_authorization_alerts_kind_chk CHECK (
    kind IN ('password_expiring', 'password_expired', 'sessions_ending', 'operator_overdue')
  ),
  CONSTRAINT hi_authorization_alerts_status_chk CHECK (
    (status = 'open' AND read_at IS NULL AND read_by IS NULL AND cancelled_at IS NULL AND cancel_reason IS NULL)
    OR (status = 'read' AND read_at IS NOT NULL AND read_by IS NOT NULL AND cancelled_at IS NULL AND cancel_reason IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL
        AND cancel_reason IN ('obsolete') AND read_at IS NULL AND read_by IS NULL)
  ),
  CONSTRAINT hi_authorization_alerts_text_chk CHECK (
    alert_key IS NOT NULL AND char_length(alert_key) BETWEEN 8 AND 200
    AND (delivery_batch IS NULL OR delivery_batch ~ '^[0-9a-f]{32}$')
    AND (delivery_error IS NULL OR char_length(delivery_error) BETWEEN 1 AND 64)
    AND delivery_attempts >= 0
  ),
  CONSTRAINT hi_authorization_alerts_delivery_chk CHECK (
    (delivery_batch IS NULL AND delivery_requested_at IS NULL AND delivered_at IS NULL)
    OR (delivery_batch IS NOT NULL AND delivery_requested_at IS NOT NULL)
  ),
  CONSTRAINT hi_authorization_alerts_detail_chk CHECK (
    jsonb_typeof(detail) = 'object' AND pg_column_size(detail) <= 1024
  )
);
--> statement-breakpoint
CREATE INDEX hi_authorization_alerts_open_idx ON public.hi_authorization_alerts (clinic_id, created_at)
  WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX hi_authorization_alerts_authorization_idx ON public.hi_authorization_alerts (clinic_id, authorization_id);
--> statement-breakpoint

-- Inclusão: o aviso nasce aberto, sem entrega e sem leitura, e só com o módulo ligado.
CREATE FUNCTION public.hi_authorization_alert_insert_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.hi_clinic_settings s WHERE s.clinic_id = NEW.clinic_id AND s.enabled
  ) THEN
    RAISE EXCEPTION 'O módulo de Convênios está desligado nesta clínica.'
      USING ERRCODE = '55000', CONSTRAINT = 'hi_module_enabled';
  END IF;
  IF NEW.status <> 'open' OR NEW.delivery_batch IS NOT NULL OR NEW.delivered_at IS NOT NULL
     OR NEW.delivery_attempts <> 0 OR NEW.delivery_error IS NOT NULL THEN
    RAISE EXCEPTION 'O aviso da autorização nasce aberto e sem entrega.'
      USING ERRCODE = '23514', CONSTRAINT = 'hi_authorization_alert_new';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_authorization_alert_insert_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_authorization_alerts_a_insert_guard BEFORE INSERT ON public.hi_authorization_alerts
  FOR EACH ROW EXECUTE FUNCTION public.hi_authorization_alert_insert_guard();
--> statement-breakpoint

-- Alteração: o fato não muda; só leitura (pela pessoa da sessão), encerramento e entrega.
CREATE FUNCTION public.hi_authorization_alert_update_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := public.hi_session_actor();
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
     OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.alert_key IS DISTINCT FROM OLD.alert_key OR NEW.detail IS DISTINCT FROM OLD.detail
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'O aviso da autorização não pode ser alterado.'
      USING ERRCODE = '23514', CONSTRAINT = 'hi_authorization_alert_immutable';
  END IF;
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Aviso encerrado não muda.'
      USING ERRCODE = '23514', CONSTRAINT = 'hi_authorization_alert_closed';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'open' AND NEW.status = 'read' THEN
      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Marcar o aviso como visto exige a pessoa da sessão.' USING ERRCODE = '42501';
      END IF;
      NEW.read_by := v_actor;
      NEW.read_at := now();
    ELSIF OLD.status = 'open' AND NEW.status = 'cancelled' THEN
      NEW.cancelled_at := now();
      NEW.cancel_reason := coalesce(NEW.cancel_reason, 'obsolete');
    ELSE
      RAISE EXCEPTION 'Transição do aviso não permitida.'
        USING ERRCODE = '23514', CONSTRAINT = 'hi_authorization_alert_transition';
    END IF;
  ELSIF NEW.read_at IS DISTINCT FROM OLD.read_at OR NEW.read_by IS DISTINCT FROM OLD.read_by
     OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason THEN
    RAISE EXCEPTION 'O aviso da autorização não pode ser alterado.'
      USING ERRCODE = '23514', CONSTRAINT = 'hi_authorization_alert_immutable';
  END IF;
  -- Entrega: o que foi entregue fica; as tentativas só crescem; o lote não troca depois de entregue.
  IF OLD.delivered_at IS NOT NULL AND (
       NEW.delivered_at IS DISTINCT FROM OLD.delivered_at OR NEW.delivery_batch IS DISTINCT FROM OLD.delivery_batch
     ) THEN
    RAISE EXCEPTION 'A entrega do aviso já foi registrada.'
      USING ERRCODE = '23514', CONSTRAINT = 'hi_authorization_alert_delivered';
  END IF;
  IF NEW.delivery_attempts < OLD.delivery_attempts THEN
    RAISE EXCEPTION 'As tentativas de entrega do aviso não diminuem.'
      USING ERRCODE = '23514', CONSTRAINT = 'hi_authorization_alert_delivered';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_authorization_alert_update_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER hi_authorization_alerts_a_update_guard BEFORE UPDATE ON public.hi_authorization_alerts
  FOR EACH ROW EXECUTE FUNCTION public.hi_authorization_alert_update_guard();
--> statement-breakpoint

-- GENERATED_BY: defaultTenantPolicy(v2)
ALTER TABLE public.hi_authorization_alerts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.hi_authorization_alerts FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hi_authorization_alerts_tenant_access ON public.hi_authorization_alerts FOR ALL
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

REVOKE ALL ON public.hi_authorization_alerts FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.hi_authorization_alerts TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hi_authorization_alerts TO service_role;
--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0166-hi-authorization-alerts')
  ON CONFLICT DO NOTHING;
