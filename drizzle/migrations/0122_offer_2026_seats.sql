-- Catálogo versionado: nenhum contrato legado é reprecificado. Os novos planos
-- nascem inativos; publicação comercial exige gates de checkout, trial e uso.
CREATE TABLE public.plan_seat_limits (
  plan_id uuid PRIMARY KEY REFERENCES public.plans(id) ON DELETE CASCADE,
  doctors integer NOT NULL CHECK (doctors BETWEEN 1 AND 5),
  staff integer NOT NULL CHECK (staff BETWEEN 0 AND 3)
);
--> statement-breakpoint
ALTER TABLE public.plan_seat_limits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.plan_seat_limits FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.plan_seat_limits FROM anon, authenticated;
--> statement-breakpoint
INSERT INTO public.plans (code, name, ativo) VALUES
  ('consultorio_2026', 'Consultório', false),
  ('clinica_2026_2', 'Clínica · 2 médicos', false),
  ('clinica_2026_3', 'Clínica · 3 médicos', false),
  ('clinica_2026_4', 'Clínica · 4 médicos', false),
  ('clinica_2026_5', 'Clínica · 5 médicos', false)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO public.plan_seat_limits (plan_id, doctors, staff)
SELECT p.id, v.doctors, 3
FROM public.plans p
JOIN (VALUES
  ('consultorio_2026', 1),
  ('clinica_2026_2', 2),
  ('clinica_2026_3', 3),
  ('clinica_2026_4', 4),
  ('clinica_2026_5', 5)
) AS v(code, doctors) ON p.code = v.code
ON CONFLICT (plan_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO public.prices (plan_id, amount, currency, billing_cycle)
SELECT p.id, v.amount, 'BRL', v.cycle::public.billing_cycle
FROM public.plans p
JOIN (VALUES
  ('consultorio_2026', 'monthly', 197.00), ('consultorio_2026', 'annual', 1970.00),
  ('clinica_2026_2', 'monthly', 397.00), ('clinica_2026_2', 'annual', 3970.00),
  ('clinica_2026_3', 'monthly', 544.00), ('clinica_2026_3', 'annual', 5440.00),
  ('clinica_2026_4', 'monthly', 691.00), ('clinica_2026_4', 'annual', 6910.00),
  ('clinica_2026_5', 'monthly', 838.00), ('clinica_2026_5', 'annual', 8380.00)
) AS v(code, cycle, amount) ON p.code = v.code
ON CONFLICT (plan_id, billing_cycle)
  WHERE active_until IS NULL AND campaign_code IS NULL DO NOTHING;
--> statement-breakpoint
INSERT INTO public.plan_limits (plan_id, metric, limit_value)
SELECT p.id, 'users'::public.plan_limit_metric, v.doctors + 3
FROM public.plans p
JOIN public.plan_seat_limits v ON v.plan_id = p.id
ON CONFLICT (plan_id, metric) DO NOTHING;
--> statement-breakpoint
-- A capacidade categórica é verificada no próprio write de profiles. Isso cobre
-- convite pendente, aceite, reativação, troca de role e CRM de owner/gestor,
-- inclusive comandos que não passam pela mesma action de convite.
CREATE OR REPLACE FUNCTION public.enforce_offer_2026_seats() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  cap record;
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
CREATE TRIGGER profiles_offer_2026_seats
  BEFORE INSERT OR UPDATE OF clinic_id, role, crm, ativo, deleted_at
  ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_offer_2026_seats();
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0122-offer-2026-seats')
ON CONFLICT (version) DO NOTHING;
