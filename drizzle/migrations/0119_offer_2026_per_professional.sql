-- 0119 — oferta de outubro/2026 cobrada por profissional de saúde (ADR-067).
--
-- Consultório R$ 197 (1 profissional + até 3 usuários de equipe) e Clínica
-- R$ 397 com 2 profissionais + R$ 147 por profissional adicional, até 10, com
-- equipe administrativa ilimitada. Só mensal.
--
-- Cada quantidade de profissionais vira um plano (`clinica_2026_<n>`). A
-- assinatura fixa `price_id`, e é esse valor que renovação, rateio, reativação
-- e sincronização com o Asaas leem: incluir profissional é uma troca de plano,
-- não um cálculo em runtime espalhado. A mensalidade é CALCULADA aqui pela
-- mesma fórmula de `src/contexts/billing/offer-2026.ts`, e o bloco final falha
-- alto se o catálogo não bater com ela.
--
-- NADA de reprecificação: Solo, Clínica e Pro antigos não são tocados. Seus
-- clientes seguem com o mesmo plano, o mesmo preço (inclusive o de fundador) e
-- o mesmo limite de usuários de `plan_limits`. Os planos novos não recebem linha
-- `users` em `plan_limits` — o limite deles é por categoria, abaixo.
--
-- Limite aplicado NO WRITE de `profiles` (trigger), e não só na action do
-- convite: cobre convite, reconvite, reativação, troca de papel e CRM do
-- próprio perfil, inclusive caminhos que ainda não existem. O predicado de
-- "profissional" é o mesmo da agenda (`practitionerSql`, ADR-032 §2).

CREATE TABLE public.plan_seat_limits (
  plan_id uuid PRIMARY KEY REFERENCES public.plans(id) ON DELETE CASCADE,
  professionals integer NOT NULL,
  -- NULL = equipe administrativa ilimitada.
  staff integer,
  CONSTRAINT plan_seat_limits_professionals_chk CHECK (professionals BETWEEN 1 AND 10),
  CONSTRAINT plan_seat_limits_staff_chk CHECK (staff IS NULL OR staff >= 0)
);
--> statement-breakpoint
-- Catálogo global, como plans/prices/plan_limits (0026): leitura authenticated,
-- escrita só por migration/service_role.
ALTER TABLE public.plan_seat_limits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.plan_seat_limits FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "plan_seat_limits_read_authenticated" ON public.plan_seat_limits
  FOR SELECT TO authenticated USING (true);
--> statement-breakpoint
REVOKE ALL ON public.plan_seat_limits FROM anon;
--> statement-breakpoint
GRANT SELECT ON public.plan_seat_limits TO authenticated, service_role;
--> statement-breakpoint
INSERT INTO public.plans (code, name, ativo) VALUES
  ('consultorio_2026', 'Consultório', true),
  ('clinica_2026_2', 'Clínica · 2 profissionais', true),
  ('clinica_2026_3', 'Clínica · 3 profissionais', true),
  ('clinica_2026_4', 'Clínica · 4 profissionais', true),
  ('clinica_2026_5', 'Clínica · 5 profissionais', true),
  ('clinica_2026_6', 'Clínica · 6 profissionais', true),
  ('clinica_2026_7', 'Clínica · 7 profissionais', true),
  ('clinica_2026_8', 'Clínica · 8 profissionais', true),
  ('clinica_2026_9', 'Clínica · 9 profissionais', true),
  ('clinica_2026_10', 'Clínica · 10 profissionais', true)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO public.plan_seat_limits (plan_id, professionals, staff)
SELECT p.id, v.professionals, v.staff
  FROM public.plans p
  JOIN (VALUES
    ('consultorio_2026', 1, 3),
    ('clinica_2026_2', 2, NULL::integer),
    ('clinica_2026_3', 3, NULL::integer),
    ('clinica_2026_4', 4, NULL::integer),
    ('clinica_2026_5', 5, NULL::integer),
    ('clinica_2026_6', 6, NULL::integer),
    ('clinica_2026_7', 7, NULL::integer),
    ('clinica_2026_8', 8, NULL::integer),
    ('clinica_2026_9', 9, NULL::integer),
    ('clinica_2026_10', 10, NULL::integer)
  ) AS v(code, professionals, staff) ON v.code = p.code
ON CONFLICT (plan_id) DO NOTHING;
--> statement-breakpoint
-- R$ 197 para 1 profissional; R$ 397 + R$ 147 × (n − 2) para a Clínica.
INSERT INTO public.prices (plan_id, amount, currency, billing_cycle)
SELECT l.plan_id,
       CASE WHEN l.professionals = 1 THEN 197.00
            ELSE 397.00 + 147.00 * (l.professionals - 2) END,
       'BRL',
       'monthly'
  FROM public.plan_seat_limits l
ON CONFLICT (plan_id, billing_cycle)
  WHERE active_until IS NULL AND campaign_code IS NULL DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_plan_seat_limits() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  cap_professionals integer;
  cap_staff integer;
  scheduled record;
  new_is_professional boolean;
  old_is_professional boolean;
  used integer;
BEGIN
  -- A linha nova não ocupa vaga: inativa, apagada, fora de clínica ou super admin.
  IF NEW.clinic_id IS NULL OR NEW.ativo IS NOT TRUE OR NEW.deleted_at IS NOT NULL
     OR NEW.role = 'super_admin' THEN
    RETURN NEW;
  END IF;
  -- Mesmo predicado de `practitionerSql` (src/lib/auth/practitioner.ts).
  new_is_professional := (NEW.role = 'doctor' OR (NEW.crm IS NOT NULL AND btrim(NEW.crm) <> ''));

  -- Só a escrita que FAZ CRESCER uma categoria é barrada. Quem já ocupava a
  -- mesma vaga (renomear, reconvidar, trocar papel sem mudar de categoria)
  -- passa, e uma clínica acima do teto nunca fica impedida de reduzir.
  IF TG_OP = 'UPDATE' AND OLD.clinic_id IS NOT DISTINCT FROM NEW.clinic_id
     AND OLD.ativo IS TRUE AND OLD.deleted_at IS NULL AND OLD.role <> 'super_admin' THEN
    old_is_professional := (OLD.role = 'doctor' OR (OLD.crm IS NOT NULL AND btrim(OLD.crm) <> ''));
    IF old_is_professional = new_is_professional THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT l.professionals, l.staff INTO cap_professionals, cap_staff
    FROM public.subscriptions s
    JOIN public.plan_seat_limits l ON l.plan_id = s.plan_id
   WHERE s.clinic_id = NEW.clinic_id;
  -- Sem assinatura (provisionamento em curso) ou plano da tabela antiga, cujo
  -- teto é o total de usuários de `plan_limits`, conferido no convite.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Um downgrade agendado reserva a capacidade do destino desde o pedido. Sem
  -- isso, uma vaga ocupada entre o pedido e o fim do ciclo deixaria o Asaas
  -- cobrando o plano menor de uma equipe que não cabe nele.
  SELECT l.professionals, l.staff INTO scheduled
    FROM public.subscription_change_requests c
    JOIN public.subscriptions s ON s.id = c.subscription_id
    JOIN public.plan_seat_limits l ON l.plan_id = c.to_plan_id
   WHERE s.clinic_id = NEW.clinic_id
     AND c.kind = 'downgrade'
     AND c.status = 'scheduled'
   LIMIT 1;
  IF FOUND THEN
    cap_professionals := least(cap_professionals, scheduled.professionals);
    cap_staff := CASE
      WHEN cap_staff IS NULL THEN scheduled.staff
      WHEN scheduled.staff IS NULL THEN cap_staff
      ELSE least(cap_staff, scheduled.staff)
    END;
  END IF;

  IF NOT new_is_professional AND cap_staff IS NULL THEN
    RETURN NEW;
  END IF;

  -- Mesma chave do advisory lock do convite (members.ts): duas escritas
  -- concorrentes na clínica contam uma depois da outra.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.clinic_id::text));
  SELECT count(*)::integer INTO used
    FROM public.profiles
   WHERE clinic_id = NEW.clinic_id
     AND id <> NEW.id
     AND ativo IS TRUE
     AND deleted_at IS NULL
     AND role <> 'super_admin'
     AND (role = 'doctor' OR (crm IS NOT NULL AND btrim(crm) <> '')) = new_is_professional;

  IF new_is_professional AND used + 1 > cap_professionals THEN
    RAISE EXCEPTION 'Limite de profissionais do plano atingido'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'plan_professional_seat_limit';
  END IF;
  IF NOT new_is_professional AND used + 1 > cap_staff THEN
    RAISE EXCEPTION 'Limite de usuários de equipe do plano atingido'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'plan_staff_seat_limit';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_plan_seat_limits() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER profiles_plan_seat_limits
  BEFORE INSERT OR UPDATE OF clinic_id, role, crm, ativo, deleted_at
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_seat_limits();
--> statement-breakpoint
-- Falha ALTO se o catálogo não saiu exatamente como a fórmula manda. O
-- `ON CONFLICT DO NOTHING` acima já engoliu uma violação em silêncio uma vez
-- (0077 → 0078); aqui um conflito inesperado vira erro de migration.
DO $$
DECLARE
  esperado int;
  conferido int;
BEGIN
  SELECT count(*) INTO esperado FROM public.plan_seat_limits;
  SELECT count(*) INTO conferido
    FROM public.plan_seat_limits l
    JOIN public.plans p ON p.id = l.plan_id AND p.ativo
    JOIN public.prices pr ON pr.plan_id = l.plan_id
     AND pr.billing_cycle = 'monthly'
     AND pr.currency = 'BRL'
     AND pr.active_until IS NULL
     AND pr.campaign_code IS NULL
   WHERE pr.amount = CASE WHEN l.professionals = 1 THEN 197.00
                          ELSE 397.00 + 147.00 * (l.professionals - 2) END
     AND l.staff IS NOT DISTINCT FROM CASE WHEN l.professionals = 1 THEN 3 END;
  IF esperado <> 10 OR conferido <> 10 THEN
    RAISE EXCEPTION 'catalogo da oferta 2026 incompleto: % planos, % conferidos', esperado, conferido;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0119-offer-2026-per-professional')
ON CONFLICT (version) DO NOTHING;
