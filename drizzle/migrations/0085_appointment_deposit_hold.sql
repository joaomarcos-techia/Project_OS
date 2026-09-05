-- 0085 — hold do sinal no agendamento (ADR-049 1.3).
--
-- Duas colunas ADITIVAS em `appointments`. A maquina de estados do agendamento
-- CONTINUA CONGELADA: `deposit_status` e uma dimensao ORTOGONAL ao `status`, nao
-- um estado novo. Um agendamento pode estar `agendado` com sinal pendente, pago ou
-- vencido — e quem move `status` continua sendo `assertTransition`, so ele.
--
-- POR QUE ENUM (e nao text com CHECK, como `cancel_reason`): `deposit_status` e a
-- projecao do `patient_charges.status` no agendamento. As duas colunas descrevem o
-- mesmo fato de dois angulos; se uma e enum e a outra e texto livre, elas divergem
-- com o tempo.
--
-- Mapeamento proposital: `cancelled` e `failed` da cobranca viram `none` aqui —
-- do ponto de vista da AGENDA, nao ha hold segurando a vaga. So existe hold
-- enquanto ha dinheiro esperado ou recebido.
--
-- DEFAULT 'none' + NULL em `hold_expires_at`: toda linha existente ja nasce no
-- estado "sem sinal", que e exatamente o comportamento de hoje. Migration aditiva,
-- sem backfill, sem lock longo.

DO $$ BEGIN
  CREATE TYPE appointment_deposit_status AS ENUM (
    'none',      -- sem sinal (padrao, e o que toda clinica tem hoje)
    'pending',   -- cobranca gerada, vaga segurada ate hold_expires_at
    'paid',      -- sinal conciliado
    'expired',   -- hold venceu sem pagamento
    'refunded'   -- estornado (cancelamento dentro da janela)
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS deposit_status appointment_deposit_status NOT NULL DEFAULT 'none';
--> statement-breakpoint

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz;
--> statement-breakpoint

-- Coerencia: so existe prazo de hold quando o sinal esta pendente. Sem isto,
-- um `hold_expires_at` esquecido num agendamento ja pago faria a varredura de
-- expiracao cancelar consulta de paciente que PAGOU — o pior bug possivel aqui.
DO $$ BEGIN
  ALTER TABLE public.appointments
    ADD CONSTRAINT appointments_deposit_hold_chk CHECK (
      (deposit_status = 'pending') = (hold_expires_at IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Varredura de expiracao: pega so os holds pendentes vencidos. Parcial para o
-- indice nao carregar a agenda inteira.
CREATE INDEX IF NOT EXISTS appointments_deposit_hold_idx
  ON public.appointments (hold_expires_at)
  WHERE deposit_status = 'pending';
--> statement-breakpoint

-- As colunas novas entram no grant de leitura do tenant (a agenda mostra o estado
-- do sinal). A escrita de `appointments` ja e concedida a `authenticated` desde a
-- 0015; nao ha grant novo a dar.
GRANT SELECT ("deposit_status", "hold_expires_at") ON public.appointments TO authenticated;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0085-appointment-deposit-hold')
ON CONFLICT (version) DO NOTHING;
