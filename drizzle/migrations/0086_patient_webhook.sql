-- 0086 — webhook de paciente (ADR-049 1.4).
--
-- O webhook de ASSINATURA (`/api/webhooks/asaas`) e da conta do Qoro e valida um
-- token do env. Este e outro: cada CLINICA tem a propria conta Asaas, entao cada
-- uma precisa da propria URL e do proprio token.
--
-- `webhook_ref` E O ENDERECO, NAO O SEGREDO. Ele vai na URL
-- (`/api/webhooks/asaas/patient/<ref>`) so para resolver QUAL clinica sem exigir
-- consulta cega. Deliberadamente NAO e o `clinic_id`: um id de tenant numa URL
-- publica vira oraculo de enumeracao ("essa clinica existe?"). Random por linha,
-- unico, e sem grant para `authenticated` — quem precisa dele e o auto-config, no
-- servidor.
--
-- `webhook_token_encrypted` E O SEGREDO. Nos GERAMOS o token, configuramos na
-- conta Asaas da clinica e guardamos cifrado (mesmo padrao da API key). A
-- validacao no request e constant-time. Fora do grant de `authenticated`, igual
-- a chave: um `SELECT *` na sessao do app da erro de permissao, nao o token.
--
-- `patient_webhook_events` e o dedup. Tabela PROPRIA (e nao a `processed_webhooks`
-- do billing) por uma razao concreta: la a chave e so o id do evento, o que
-- assume um unico emissor. Aqui os emissores sao N contas Asaas diferentes, e
-- nada garante que dois provedores nunca repitam um id. A chave e
-- (clinic_id, asaas_event_id).

ALTER TABLE public.clinic_payment_accounts
  ADD COLUMN IF NOT EXISTS webhook_ref uuid NOT NULL DEFAULT gen_random_uuid();
--> statement-breakpoint
ALTER TABLE public.clinic_payment_accounts
  ADD COLUMN IF NOT EXISTS webhook_token_encrypted text;
--> statement-breakpoint
ALTER TABLE public.clinic_payment_accounts
  ADD COLUMN IF NOT EXISTS webhook_configured_at timestamptz;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS clinic_payment_accounts_webhook_ref_uniq
  ON public.clinic_payment_accounts (webhook_ref);
--> statement-breakpoint

-- Coerencia: conta configurada tem token. Sem isto, uma linha com
-- `webhook_configured_at` e sem token faria a rota recusar todo webhook daquela
-- clinica em silencio — o pagamento entraria no Asaas e nunca chegaria aqui.
DO $$ BEGIN
  ALTER TABLE public.clinic_payment_accounts
    ADD CONSTRAINT clinic_payment_accounts_webhook_chk CHECK (
      webhook_configured_at IS NULL OR webhook_token_encrypted IS NOT NULL
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- `webhook_configured_at` entra no grant de leitura (a tela mostra "webhook
-- configurado"); `webhook_ref` e `webhook_token_encrypted` NAO — endereco e
-- segredo ficam no servidor.
GRANT SELECT ("webhook_configured_at") ON public.clinic_payment_accounts TO authenticated;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS patient_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  asaas_event_id text NOT NULL,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_webhook_events_uniq UNIQUE (clinic_id, asaas_event_id)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patient_webhook_events_clinic_idx
  ON public.patient_webhook_events (clinic_id, processed_at DESC);
--> statement-breakpoint

ALTER TABLE public.patient_webhook_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.patient_webhook_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY patient_webhook_events_read ON public.patient_webhook_events FOR SELECT
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );
--> statement-breakpoint

-- Escrita e service_role-only: quem grava e a rota de webhook (nao ha sessao de
-- usuario num webhook). `authenticated` so le, para a tela de diagnostico.
REVOKE ALL ON public.patient_webhook_events FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.patient_webhook_events TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.patient_webhook_events TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0086-patient-webhook')
ON CONFLICT (version) DO NOTHING;
