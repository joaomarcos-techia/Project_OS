-- 0082 — clinic_deposit_policy: a regra do sinal (ADR-049, sub-fase 1.2).
--
-- Uma linha por clinica (clinic_id e a PK): a politica e do tenant, nao um
-- historico. Alteracao e UPDATE auditado, nao versao nova.
--
-- ESTA TABELA E O GATE POR CLINICA (decisao D1 do discovery log). Nao existe flag
-- generica por tenant no sistema; `enabled` DEFAULT false e o mecanismo. Clinica
-- sem linha = sinal desligado, que e exatamente o comportamento de hoje. Por isso
-- a 1.2 nao pode causar regressao: sem linha e com `enabled=false` o caminho novo
-- nunca e alcancado.
--
-- CHECKs que impedem estados MORTOS (ligado mas incapaz de cobrar):
--   - percent 1..100: 0 seria "ligado e cobra nada";
--   - ao menos um entre primeira consulta / retorno quando `enabled`;
--   - janela 0..720h: teto de sanidade contra digitacao (2400 em vez de 24), nao
--     regra de negocio. `cancellation_window_hours` e a ANTECEDENCIA MINIMA para
--     ter estorno: 24 = precisa cancelar com 24h; 0 = qualquer cancelamento antes
--     do horario estorna.
--
-- Escrita por `authenticated` (diferente de clinic_payment_accounts): aqui nao ha
-- segredo, entao o caminho tenant + RLS resolve, e a Server Action grava por
-- withTenant com auditoria. O seam privilegiado fica reservado ao que guarda chave.

ALTER TYPE "public"."consent_purpose" ADD VALUE IF NOT EXISTS 'politica_cancelamento';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS clinic_deposit_policy (
  clinic_id uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  percent integer NOT NULL DEFAULT 50,
  cancellation_window_hours integer NOT NULL DEFAULT 24,
  applies_to_first_visit boolean NOT NULL DEFAULT true,
  applies_to_return boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_deposit_policy_percent_chk CHECK (percent BETWEEN 1 AND 100),
  CONSTRAINT clinic_deposit_policy_window_chk CHECK (cancellation_window_hours BETWEEN 0 AND 720),
  CONSTRAINT clinic_deposit_policy_scope_chk CHECK (
    enabled = false OR applies_to_first_visit OR applies_to_return
  )
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE public.clinic_deposit_policy
    ADD CONSTRAINT clinic_deposit_policy_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE public.clinic_deposit_policy ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.clinic_deposit_policy FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY clinic_deposit_policy_read ON public.clinic_deposit_policy FOR SELECT
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY clinic_deposit_policy_write ON public.clinic_deposit_policy FOR INSERT
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY clinic_deposit_policy_update ON public.clinic_deposit_policy FOR UPDATE
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint

REVOKE ALL ON public.clinic_deposit_policy FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.clinic_deposit_policy TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.clinic_deposit_policy TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0082-clinic-deposit-policy')
ON CONFLICT (version) DO NOTHING;
