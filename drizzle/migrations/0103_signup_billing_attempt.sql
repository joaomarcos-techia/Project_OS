-- O-5: intenção de assinatura recorrente hospedada no draft pré-tenant.
--
-- Nada de cartão aqui, nem cifrado: o Asaas coleta o meio de pagamento na página
-- dele. O que guardamos são identificadores do provedor e o estado da tentativa,
-- no mesmo padrão de reserva+CAS que a 0100 estabeleceu para o envio de e-mail.
ALTER TABLE "signup_sessions"
  ADD COLUMN "billing_attempt_state" text,
  ADD COLUMN "billing_attempted_at" timestamptz,
  ADD COLUMN "asaas_customer_id" text,
  ADD COLUMN "asaas_subscription_id" text,
  ADD COLUMN "billing_failure_code" text;--> statement-breakpoint

ALTER TABLE "signup_sessions"
  -- A tentativa só existe inteira, e só sobre um draft que já provou identidade
  -- (`email_verified` exige auth_user_id, consumo, aceite, PII e as 4 respostas)
  -- e que já tem plano resolvido no servidor. Sem plano não há valor a cobrar.
  ADD CONSTRAINT "signup_sessions_billing_attempt_check" CHECK (
    num_nonnulls("billing_attempt_state", "billing_attempted_at") IN (0, 2)
    AND ("billing_attempt_state" IS NULL OR (
      "billing_attempt_state" IN ('reserved', 'active', 'creation_unknown', 'failed')
      AND "selected_plan_id" IS NOT NULL
      AND "status" IN ('email_verified', 'expired', 'blocked')
    ))
  ),
  -- Assinatura existe se, e somente se, a tentativa está `active`. É o que impede
  -- "id de assinatura sem estado" e "estado ativo sem assinatura" — os dois lados
  -- da mesma mentira. O customer acompanha o ativo; nos demais estados é opcional,
  -- porque o timeout pode ter acontecido antes mesmo de existir customer.
  ADD CONSTRAINT "signup_sessions_billing_active_check" CHECK (
    ("billing_attempt_state" = 'active'
      AND "asaas_subscription_id" IS NOT NULL AND "asaas_customer_id" IS NOT NULL)
    OR ("billing_attempt_state" IS DISTINCT FROM 'active' AND "asaas_subscription_id" IS NULL)
  ),
  -- Motivo só acompanha desfecho ruim, e é código sanitizado — nunca corpo do
  -- provedor, que pode refletir o request (PAN/CVV) num 4xx.
  ADD CONSTRAINT "signup_sessions_billing_failure_check" CHECK (
    "billing_failure_code" IS NULL
    OR "billing_attempt_state" IN ('creation_unknown', 'failed')
  ),
  -- Uma assinatura pertence a no máximo um cadastro. Esta é a garantia de banco
  -- contra assinatura duplicada; a reconciliação por externalReference é a
  -- garantia de aplicação. As duas juntas, porque o Asaas não aceita
  -- Idempotency-Key em POST e um timeout pode ter criado do outro lado.
  ADD CONSTRAINT "signup_sessions_asaas_subscription_id_unique"
    UNIQUE ("asaas_subscription_id");--> statement-breakpoint

-- A tabela continua GLOBAL PROTECTED: grants e RLS não mudam, nenhuma política.
INSERT INTO _schema_version (version) VALUES ('signup-billing-attempt')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
