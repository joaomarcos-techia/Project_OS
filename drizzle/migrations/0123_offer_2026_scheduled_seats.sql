-- Um downgrade agendado reserva a capacidade do destino desde a solicitação.
-- Sem isso, um convite aceito entre o pedido e o cron pode deixar a recorrência
-- já reduzida no Asaas enquanto a assinatura local ainda excede as vagas.
CREATE OR REPLACE FUNCTION public.enforce_offer_2026_seats() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  cap record;
  scheduled_cap record;
  used_doctors integer;
  used_staff integer;
BEGIN
  IF NEW.clinic_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.clinic_id::text));
  SELECT l.doctors, l.staff INTO cap
  FROM public.subscriptions s
  JOIN public.plan_seat_limits l ON l.plan_id = s.plan_id
  WHERE s.clinic_id = NEW.clinic_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT l.doctors, l.staff INTO scheduled_cap
  FROM public.subscription_change_requests change
  JOIN public.subscriptions s ON s.id = change.subscription_id
  JOIN public.plan_seat_limits l ON l.plan_id = change.to_plan_id
  WHERE change.clinic_id = NEW.clinic_id AND s.clinic_id = NEW.clinic_id
    AND change.kind = 'downgrade' AND change.status = 'scheduled'
  LIMIT 1;
  IF FOUND THEN
    cap.doctors := least(cap.doctors, scheduled_cap.doctors);
    cap.staff := least(cap.staff, scheduled_cap.staff);
  END IF;

  SELECT count(*) FILTER (WHERE role = 'doctor'
      OR (role IN ('owner', 'gestor') AND nullif(btrim(crm), '') IS NOT NULL))::integer,
    count(*) FILTER (WHERE role <> 'doctor'
      AND NOT (role IN ('owner', 'gestor') AND nullif(btrim(crm), '') IS NOT NULL))::integer
    INTO used_doctors, used_staff
  FROM public.profiles
  WHERE clinic_id = NEW.clinic_id AND id <> NEW.id
    AND ativo IS TRUE AND deleted_at IS NULL AND role <> 'super_admin';

  IF NEW.ativo IS TRUE AND NEW.deleted_at IS NULL AND NEW.role <> 'super_admin' THEN
    IF NEW.role = 'doctor'
      OR (NEW.role IN ('owner', 'gestor') AND nullif(btrim(NEW.crm), '') IS NOT NULL) THEN
      used_doctors := used_doctors + 1;
    ELSE
      used_staff := used_staff + 1;
    END IF;
  END IF;
  IF used_doctors > cap.doctors OR used_staff > cap.staff THEN
    RAISE EXCEPTION 'Capacidade de médicos/equipe do plano excedida'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'offer_2026_seat_limit';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_offer_2026_seats() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0123-offer-2026-scheduled-seats')
ON CONFLICT (version) DO NOTHING;
