-- =====================================================================
-- 0158 — Convênios: estado da cobrança da coparticipação (P10.5). CANDIDATA: provada em
-- Postgres descartável; NÃO aplicada no DEV compartilhado nem em produção.
--
-- A 0148 reserva ao dono da tabela as transições confirmada → cobrada → paga →
-- estornada (o runtime não muda `charge_ref` nem `received_cents`). Esta função é o
-- único caminho: lê a cobrança Asaas do atendimento (`patient_charges`, a do saldo,
-- que num atendimento de convênio só pode ser a coparticipação) e o recebível do
-- paciente no livro (`lancamentos`/`payment_transactions`), e anda o estado. Idempotente:
-- chamar de novo não muda nada; webhook repetido não paga duas vezes (o livro recusa).
--
-- Só para a clínica da sessão (hi_session_clinic, 0153). Nenhuma cobrança é criada aqui.
--
-- Reversão: DROP FUNCTION public.hi_copay_sync_charge(uuid, uuid);
--   DELETE FROM public._schema_version WHERE version = '0158-hi-copay-charge';
-- =====================================================================

CREATE OR REPLACE FUNCTION public.hi_copay_sync_charge(p_clinic_id uuid, p_copayment_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c public.hi_copayments%ROWTYPE;
  v_charge_id uuid;
  v_lanc_id uuid;
  v_lanc_status text;
  v_paid numeric;
  v_refunded numeric;
BEGIN
  PERFORM public.hi_session_clinic(p_clinic_id);
  SELECT * INTO v_c FROM public.hi_copayments
   WHERE clinic_id = p_clinic_id AND id = p_copayment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coparticipação inexistente nesta clínica.' USING ERRCODE = '23503';
  END IF;
  IF v_c.status NOT IN ('confirmed', 'charged', 'paid') THEN
    RETURN v_c.status;
  END IF;

  SELECT pc.id INTO v_charge_id FROM public.patient_charges pc
   WHERE pc.clinic_id = p_clinic_id AND pc.appointment_id = v_c.appointment_id AND pc.kind = 'remainder'
     AND pc.status::text IN ('pending', 'paid', 'refunded')
   LIMIT 1;
  SELECT l.id, l.status::text INTO v_lanc_id, v_lanc_status FROM public.lancamentos l
   WHERE l.clinic_id = p_clinic_id AND l.appointment_id = v_c.appointment_id AND l.tipo = 'receber'
   LIMIT 1;
  IF v_lanc_id IS NOT NULL THEN
    SELECT coalesce(sum(amount) FILTER (WHERE kind = 'payment'), 0),
           coalesce(sum(amount) FILTER (WHERE kind = 'refund'), 0)
      INTO v_paid, v_refunded
      FROM public.payment_transactions WHERE clinic_id = p_clinic_id AND lancamento_id = v_lanc_id;
  END IF;

  IF v_c.status = 'confirmed' AND v_charge_id IS NOT NULL THEN
    UPDATE public.hi_copayments SET status = 'charged', charge_ref = v_charge_id
     WHERE clinic_id = p_clinic_id AND id = v_c.id;
    v_c.status := 'charged';
  END IF;
  IF v_c.status = 'charged' AND v_lanc_status = 'pago' THEN
    UPDATE public.hi_copayments SET status = 'paid', received_cents = round(v_paid * 100)::bigint
     WHERE clinic_id = p_clinic_id AND id = v_c.id;
    v_c.status := 'paid';
  END IF;
  IF v_c.status = 'paid' AND coalesce(v_refunded, 0) > 0 AND v_refunded >= v_paid THEN
    UPDATE public.hi_copayments SET status = 'refunded', received_cents = 0
     WHERE clinic_id = p_clinic_id AND id = v_c.id;
    v_c.status := 'refunded';
  END IF;
  RETURN v_c.status;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hi_copay_sync_charge(uuid, uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hi_copay_sync_charge(uuid, uuid) TO authenticated, service_role;
--> statement-breakpoint

INSERT INTO public._schema_version (version) VALUES ('0158-hi-copay-charge')
  ON CONFLICT DO NOTHING;
