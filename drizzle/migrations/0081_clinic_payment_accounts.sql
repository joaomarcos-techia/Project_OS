-- 0081 — clinic_payment_accounts: a conta Asaas DA CLINICA (Modelo B do ADR-049).
--
-- O dinheiro do paciente vai direto para a conta da clinica; o Qoro nao custodia.
-- Para isso o sistema precisa guardar a API key da clinica, que e um segredo de
-- TERCEIRO -- mais sensivel que qualquer PII do proprio banco: com ela se emite
-- cobranca e se movimenta dinheiro na conta de outra empresa.
--
-- POR QUE O SEGREDO E PROTEGIDO PELO GRANT, E NAO POR DISCIPLINA DE CODIGO:
-- `api_key_encrypted` fica FORA do GRANT SELECT de `authenticated` (mesmo contrato
-- de `clinic_whatsapp_numbers.token_encrypted`, migration 0022). Um `SELECT *` na
-- sessao do app -- por bug, por refactor distraido ou por SQL injection que consiga
-- rodar como `authenticated` -- retorna erro de permissao em vez do segredo. A cifra
-- (per-tenant, HKDF com salt = id da clinica) e a SEGUNDA camada, nao a unica.
--
-- CHECK `active_requires_key`: nao existe conta "ativa sem chave". Desconectar
-- APAGA a chave (NULL), nao apenas marca inativo -- segredo que nao existe nao
-- vaza. O CHECK impede que uma escrita futura reintroduza o estado invalido.
--
-- `key_version`: bump a cada rotacao. Existe para o consumidor futuro (1.3+) saber
-- que precisa reconstruir o client Asaas em cache -- o circuit breaker vive na
-- instancia, entao um client com chave velha ficaria falhando em silencio.
--
-- UNIQUE (clinic_id, provider) e NAO unique no hash: duas clinicas do mesmo dono
-- podem legitimamente apontar para a mesma conta Asaas. Uma constraint global no
-- hash quebraria esse caso real; o hash existe para reconhecer rotacao no-op e
-- para diagnostico, sem nunca comparar plaintext.

CREATE TABLE IF NOT EXISTS clinic_payment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  -- Single-gateway por design (ADR-049 / §13.15). A coluna existe para o dado ser
  -- auto-descritivo e para a UNIQUE ter sentido, nao para abstrair multi-gateway.
  provider text NOT NULL DEFAULT 'asaas',
  -- base64(version||nonce||ct||tag) de src/lib/crypto. NUNCA no GRANT de authenticated.
  api_key_encrypted text,
  -- HMAC-SHA-256 (hashForLookup). Serve para detectar reenvio da MESMA chave sem
  -- comparar plaintext. Nao e unique -- ver cabecalho.
  api_key_hash text,
  key_version integer NOT NULL DEFAULT 0,
  -- Nome da conta como o proprio Asaas devolve, para o operador confirmar na tela
  -- que conectou a conta certa. Sem CPF/CNPJ, sem e-mail: PII de terceiro nao entra.
  account_name text,
  active boolean NOT NULL DEFAULT false,
  connected_at timestamptz,
  connected_by uuid,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_payment_accounts_provider_chk CHECK (provider IN ('asaas')),
  CONSTRAINT clinic_payment_accounts_active_requires_key CHECK (
    active = false OR api_key_encrypted IS NOT NULL
  ),
  CONSTRAINT clinic_payment_accounts_clinic_provider_uniq UNIQUE (clinic_id, provider)
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE public.clinic_payment_accounts
    ADD CONSTRAINT clinic_payment_accounts_connected_by_fkey
    FOREIGN KEY (connected_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- D9: FK sem indice forca seq scan em toda avaliacao de policy RLS.
CREATE INDEX IF NOT EXISTS clinic_payment_accounts_clinic_id_idx
  ON public.clinic_payment_accounts (clinic_id);
--> statement-breakpoint

ALTER TABLE public.clinic_payment_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.clinic_payment_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY clinic_payment_accounts_read ON public.clinic_payment_accounts FOR SELECT
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY clinic_payment_accounts_write ON public.clinic_payment_accounts FOR INSERT
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY clinic_payment_accounts_update ON public.clinic_payment_accounts FOR UPDATE
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint

-- --- GRANTS ----------------------------------------------------------------
-- `authenticated` le TUDO menos api_key_encrypted e api_key_hash. A escrita da
-- chave e service_role-only: a Server Action grava via dbAdmin/withTenant no
-- caminho servidor, nunca a partir de uma sessao de browser.
REVOKE ALL ON public.clinic_payment_accounts FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.clinic_payment_accounts FROM anon;
--> statement-breakpoint
GRANT SELECT ("id","clinic_id","provider","key_version","account_name","active","connected_at","connected_by","disconnected_at","created_at","updated_at")
  ON public.clinic_payment_accounts TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.clinic_payment_accounts TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0081-clinic-payment-accounts')
ON CONFLICT (version) DO NOTHING;
