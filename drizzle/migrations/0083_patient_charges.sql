-- 0083 — patient_charges: a cobranca do PACIENTE (ADR-049, sub-fase 1.3).
--
-- Uma linha por cobranca gerada na conta Asaas DA CLINICA. Nao confundir com
-- `invoices` (billing): aquilo e a assinatura da clinica na conta do Qoro.
--
-- IDEMPOTENCIA E O CONTRATO CENTRAL DESTA TABELA. O Asaas nao tem idempotency-key
-- nativa e o worker do outbox entrega at-least-once: sem trava, uma reentrega
-- geraria DUAS cobrancas para o mesmo paciente. Duas defesas:
--   1. UNIQUE (appointment_id, kind) — um sinal por agendamento, ponto;
--   2. `external_reference` deterministico ('deposit:<appointment_id>') + UNIQUE
--      (clinic_id, external_reference): mesmo depois de um POST que deu timeout,
--      o caller recupera a cobranca ja criada no Asaas em vez de criar outra.
--
-- `amount > 0`: cobranca de R$ 0,00 nao existe — a regra em `payments/policy.ts`
-- devolve `null` nesse caso e nada e gravado aqui.
--
-- Sem segredo nesta tabela: `authenticated` le e escreve (o handler do outbox roda
-- como authenticated, com RLS). O `provider_payment_id` e o `invoice_url` sao
-- identificadores publicos do Asaas, nao credenciais.
--
-- ON DELETE: espelha `lancamentos` (0020) de proposito — CASCADE no agendamento,
-- SET NULL no paciente. Divergir criaria surpresa entre duas tabelas de dinheiro
-- ligadas ao mesmo agendamento.

DO $$ BEGIN
  CREATE TYPE patient_charge_status AS ENUM (
    'pending',    -- link gerado, aguardando pagamento
    'paid',       -- conciliado via webhook/getPayment
    'expired',    -- hold venceu sem pagamento
    'cancelled',  -- agendamento cancelado antes do pagamento
    'refunded',   -- estornado (cancelamento dentro da janela)
    'failed'      -- o gateway recusou a criacao
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE patient_charge_kind AS ENUM ('deposit', 'remainder');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS patient_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL,
  patient_id uuid,
  kind patient_charge_kind NOT NULL DEFAULT 'deposit',
  status patient_charge_status NOT NULL DEFAULT 'pending',
  amount numeric(12,2) NOT NULL,
  provider text NOT NULL DEFAULT 'asaas',
  -- Identificadores devolvidos pelo Asaas. Publicos: o `invoice_url` e o link que
  -- o proprio paciente abre.
  provider_payment_id text,
  invoice_url text,
  -- Deterministico: 'deposit:<appointment_id>'. E o que torna o POST recuperavel.
  external_reference text NOT NULL,
  -- Ate quando a vaga fica segurada aguardando o pagamento.
  hold_expires_at timestamptz,
  paid_at timestamptz,
  expired_at timestamptz,
  refunded_at timestamptz,
  -- Motivo estavel da falha (codigo do Asaas ja sanitizado), nunca o corpo bruto.
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_charges_provider_chk CHECK (provider IN ('asaas')),
  CONSTRAINT patient_charges_amount_chk CHECK (amount > 0),
  CONSTRAINT patient_charges_appointment_kind_uniq UNIQUE (appointment_id, kind),
  CONSTRAINT patient_charges_external_reference_uniq UNIQUE (clinic_id, external_reference)
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE public.patient_charges
    ADD CONSTRAINT patient_charges_appointment_id_fkey
    FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE public.patient_charges
    ADD CONSTRAINT patient_charges_patient_id_fkey
    FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patient_charges_clinic_id_idx
  ON public.patient_charges (clinic_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_charges_appointment_idx
  ON public.patient_charges (appointment_id);
--> statement-breakpoint
-- Cron de expiracao: varre `pending` com hold vencido. Parcial para o indice nao
-- carregar o historico inteiro de cobrancas ja resolvidas.
CREATE INDEX IF NOT EXISTS patient_charges_pending_hold_idx
  ON public.patient_charges (hold_expires_at)
  WHERE status = 'pending';
--> statement-breakpoint
-- Conciliacao pelo webhook: resolve a cobranca pelo id do Asaas.
CREATE INDEX IF NOT EXISTS patient_charges_provider_payment_idx
  ON public.patient_charges (provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
--> statement-breakpoint

ALTER TABLE public.patient_charges ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.patient_charges FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY patient_charges_read ON public.patient_charges FOR SELECT
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY patient_charges_write ON public.patient_charges FOR INSERT
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY patient_charges_update ON public.patient_charges FOR UPDATE
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint

-- Sem DELETE para `authenticated`: cobranca e registro financeiro. Cancelar e
-- mudar `status`, nao apagar linha.
REVOKE ALL ON public.patient_charges FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.patient_charges TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.patient_charges TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0083-patient-charges')
ON CONFLICT (version) DO NOTHING;
