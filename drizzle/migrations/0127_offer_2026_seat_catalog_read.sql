-- Catálogo global: a troca de plano lê o teto sob SET LOCAL ROLE authenticated.
-- Escrita continua restrita à migration; anon não recebe SELECT.
CREATE POLICY plan_seat_limits_read_authenticated ON public.plan_seat_limits
  FOR SELECT TO authenticated USING (true);
--> statement-breakpoint
GRANT SELECT ON public.plan_seat_limits TO authenticated;
--> statement-breakpoint
INSERT INTO public._schema_version (version) VALUES ('0127-offer-2026-seat-catalog-read')
ON CONFLICT (version) DO NOTHING;
