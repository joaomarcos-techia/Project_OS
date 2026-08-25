-- 0088 - patient_credits: dinheiro recebido ANTES de existir a obrigacao
-- (ADR-051, sub-fase 1.5b.1).
--
-- POR QUE UMA TABELA NOVA, e nao `payment_transactions`: aquela e a baixa de um
-- lancamento e tem `lancamento_id NOT NULL` com ON DELETE restrict. Baixa nao
-- existe sem lancamento — e o sinal e pago ANTES de o atendimento acontecer,
-- portanto antes de o lancamento existir. Nao e preferencia de modelagem: e a
-- unica forma de representar dinheiro que chegou antes da obrigacao.
--
-- POR QUE NO FINANCIAL, e nao no PAYMENTS: `financial` e a fonte da verdade
-- financeira (ADR-051 D1). `patient_charges` e instrumento de COBRANCA — ele
-- descreve tentativas num gateway, nao obrigacoes. Dois ledgers nao tem fonte da
-- verdade: tem duas versoes da mesma historia e nenhum arbitro.
--
-- SEM FK para `patient_charges`, DE PROPOSITO. O `patient_charge_id` e uma chave
-- de IDEMPOTENCIA opaca vinda de outro context, nao uma dependencia relacional.
-- FK aqui amarraria a tabela financeira ao modelo fisico interno do Payments, que
-- e exatamente o acoplamento que o ADR-051 D1 recusa. Quem garante "um credito
-- por cobranca" e o UNIQUE abaixo.
--
-- ON DELETE espelha `lancamentos` (0020) e `patient_charges` (0083): CASCADE no
-- agendamento, SET NULL no paciente. Divergir criaria surpresa entre tabelas de
-- dinheiro ligadas ao mesmo atendimento.

DO $$ BEGIN
  CREATE TYPE patient_credit_kind AS ENUM (
    'deposit',           -- sinal pago antes do atendimento
    'remaining_payment'  -- restante, pago depois (1.5b.3)
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE patient_credit_status AS ENUM (
    'available',  -- dinheiro entrou e ainda nao foi aplicado a um lancamento
    'allocated',  -- aplicado (total ou parcialmente) a um lancamento
    'refunded',   -- devolvido ao paciente (cancelamento na janela)
    'retained'    -- ficou com a clinica sem atendimento (falta, ou cancelamento tardio)
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS patient_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid,
  appointment_id uuid,
  -- Id da cobranca no Payments. Opaco: usado como chave de idempotencia, nunca
  -- para navegar ate a tabela do outro context.
  patient_charge_id uuid NOT NULL,
  amount numeric(12,2) NOT NULL,
  -- Separado de `amount` para permitir alocacao PARCIAL sem inventar linha nova.
  -- A 1.5b sempre aloca integralmente; a coluna existe para o dia em que houver
  -- parcelamento ou pagamento misto — cenarios que o ADR-051 ja previu.
  allocated_amount numeric(12,2) NOT NULL DEFAULT 0,
  -- Lancamento que consumiu o credito. Nulo enquanto `available`.
  allocated_lancamento_id uuid REFERENCES public.lancamentos(id) ON DELETE SET NULL,
  kind patient_credit_kind NOT NULL DEFAULT 'deposit',
  status patient_credit_status NOT NULL DEFAULT 'available',
  -- Forma de pagamento do catalogo (`payment_methods.code`). Vem do gateway no
  -- momento do pagamento: sem ela o Caixa mostraria uma baixa sem origem.
  payment_method text REFERENCES public.payment_methods(code),
  granted_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_credits_amount_chk CHECK (amount > 0),
  -- Invariante 4 do ADR-051 no nivel do banco: credito nunca aloca mais do que
  -- recebeu. E o que impede `valorPago` crescer sem dinheiro por tras.
  CONSTRAINT patient_credits_allocated_chk
    CHECK (allocated_amount >= 0 AND allocated_amount <= amount),
  -- Terminal <=> tem data de liberacao. Impede "estornado sem quando".
  CONSTRAINT patient_credits_released_chk
    CHECK ((status IN ('refunded','retained')) = (released_at IS NOT NULL)),
  -- Disponivel nao tem alocacao, nem lancamento apontado.
  CONSTRAINT patient_credits_available_chk
    CHECK (status <> 'available' OR (allocated_amount = 0 AND allocated_lancamento_id IS NULL)),
  -- UM credito por cobranca. E a idempotencia do handler sob reentrega do worker:
  -- sem isto, uma reentrega criaria um segundo credito e a clinica receberia
  -- baixa em dobro por um pagamento so.
  CONSTRAINT patient_credits_charge_uniq UNIQUE (clinic_id, patient_charge_id)
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE public.patient_credits
    ADD CONSTRAINT patient_credits_appointment_id_fkey
    FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE public.patient_credits
    ADD CONSTRAINT patient_credits_patient_id_fkey
    FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patient_credits_clinic_idx
  ON public.patient_credits (clinic_id);
--> statement-breakpoint
-- Alocacao no faturamento: busca os creditos DISPONIVEIS de um agendamento.
-- Parcial para o indice nao carregar o historico ja resolvido.
CREATE INDEX IF NOT EXISTS patient_credits_available_appointment_idx
  ON public.patient_credits (appointment_id)
  WHERE status = 'available';
--> statement-breakpoint

ALTER TABLE public.patient_credits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.patient_credits FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY patient_credits_read ON public.patient_credits FOR SELECT
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY patient_credits_write ON public.patient_credits FOR INSERT
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY patient_credits_update ON public.patient_credits FOR UPDATE
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint

-- Sem DELETE para `authenticated`: credito e registro financeiro. Liberar e
-- mudar `status`, nao apagar linha.
REVOKE ALL ON public.patient_credits FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.patient_credits TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.patient_credits TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0088-patient-credits')
ON CONFLICT (version) DO NOTHING;
