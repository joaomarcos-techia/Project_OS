-- 0057 - Ledger imutavel de pagamentos e reembolsos
-- Mantem lancamentos como resumo do debito e registra cada movimentacao de
-- dinheiro com valor, data, metodo, operador, comprovante e vinculo de reversao.

DO $$ BEGIN
  CREATE TYPE payment_transaction_kind AS ENUM ('payment', 'refund');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL,
  lancamento_id uuid NOT NULL,
  kind payment_transaction_kind NOT NULL,
  amount numeric(12, 2) NOT NULL,
  payment_method text,
  occurred_at timestamptz DEFAULT now() NOT NULL,
  original_payment_id uuid,
  reason text,
  created_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT payment_transactions_amount_chk CHECK (amount > 0),
  CONSTRAINT payment_transactions_kind_coerencia_chk CHECK (
    (kind = 'payment' AND original_payment_id IS NULL AND reason IS NULL)
    OR
    (kind = 'refund' AND original_payment_id IS NOT NULL AND length(trim(reason)) > 0)
  )
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE payment_transactions
    ADD CONSTRAINT payment_transactions_clinic_id_clinics_id_fk
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE payment_transactions
    ADD CONSTRAINT payment_transactions_lancamento_id_lancamentos_id_fk
    FOREIGN KEY (lancamento_id) REFERENCES public.lancamentos(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE payment_transactions
    ADD CONSTRAINT payment_transactions_payment_method_payment_methods_code_fk
    FOREIGN KEY (payment_method) REFERENCES public.payment_methods(code);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE payment_transactions
    ADD CONSTRAINT payment_transactions_original_payment_id_fk
    FOREIGN KEY (original_payment_id) REFERENCES public.payment_transactions(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE payment_transactions
    ADD CONSTRAINT payment_transactions_created_by_users_id_fk
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS payment_transactions_clinic_lancamento_idx
  ON payment_transactions (clinic_id, lancamento_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payment_transactions_original_payment_idx
  ON payment_transactions (original_payment_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payment_transactions_clinic_occurred_idx
  ON payment_transactions (clinic_id, occurred_at);
--> statement-breakpoint

-- Valida tenant, origem e limites tambem para insercoes fora da Server Action.
CREATE OR REPLACE FUNCTION public.validate_payment_transaction_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lancamento_clinic uuid;
  v_lancamento_value numeric(12, 2);
  v_payment_clinic uuid;
  v_payment_lancamento uuid;
  v_payment_kind payment_transaction_kind;
  v_payment_amount numeric(12, 2);
  v_total numeric(12, 2);
BEGIN
  SELECT clinic_id, valor
    INTO v_lancamento_clinic, v_lancamento_value
    FROM public.lancamentos
   WHERE id = NEW.lancamento_id
   FOR UPDATE;

  IF NOT FOUND OR v_lancamento_clinic <> NEW.clinic_id THEN
    RAISE EXCEPTION 'payment transaction must reference a lancamento from the same clinic';
  END IF;

  IF NEW.kind = 'payment' THEN
    SELECT COALESCE(sum(amount), 0)
      INTO v_total
      FROM public.payment_transactions
     WHERE lancamento_id = NEW.lancamento_id
       AND kind = 'payment';
    IF v_total + NEW.amount > v_lancamento_value THEN
      RAISE EXCEPTION 'payment exceeds lancamento value';
    END IF;
    RETURN NEW;
  END IF;

  SELECT clinic_id, lancamento_id, kind, amount
    INTO v_payment_clinic, v_payment_lancamento, v_payment_kind, v_payment_amount
    FROM public.payment_transactions
   WHERE id = NEW.original_payment_id
   FOR UPDATE;

  IF NOT FOUND
     OR v_payment_kind <> 'payment'
     OR v_payment_clinic <> NEW.clinic_id
     OR v_payment_lancamento <> NEW.lancamento_id
  THEN
    RAISE EXCEPTION 'refund must reference a payment from the same clinic and lancamento';
  END IF;

  SELECT COALESCE(sum(amount), 0)
    INTO v_total
    FROM public.payment_transactions
   WHERE original_payment_id = NEW.original_payment_id
     AND kind = 'refund';
  IF v_total + NEW.amount > v_payment_amount THEN
    RAISE EXCEPTION 'refund exceeds original payment available amount';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.validate_payment_transaction_insert() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_payment_transactions_validate_insert ON payment_transactions;
--> statement-breakpoint
CREATE TRIGGER trg_payment_transactions_validate_insert
  BEFORE INSERT ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.validate_payment_transaction_insert();
--> statement-breakpoint

ALTER TABLE payment_proofs ADD COLUMN IF NOT EXISTS transaction_id uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE payment_proofs
    ADD CONSTRAINT payment_proofs_transaction_id_payment_transactions_id_fk
    FOREIGN KEY (transaction_id) REFERENCES public.payment_transactions(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payment_proofs_transaction_id_idx ON payment_proofs (transaction_id);
--> statement-breakpoint

-- O historico anterior nao distingue parcelas. Preservamos o valor conhecido
-- como uma unica transacao legada, sem inventar reembolsos para estornos antigos.
INSERT INTO payment_transactions (
  clinic_id,
  lancamento_id,
  kind,
  amount,
  payment_method,
  occurred_at,
  created_by
)
SELECT clinic_id,
       id,
       'payment'::payment_transaction_kind,
       valor_pago,
       payment_method,
       COALESCE(paid_at, updated_at, created_at),
       created_by
  FROM lancamentos
 WHERE status IN ('parcial', 'pago')
   AND valor_pago > 0
   AND NOT EXISTS (
     SELECT 1 FROM payment_transactions pt WHERE pt.lancamento_id = lancamentos.id
   );
--> statement-breakpoint

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payment_transactions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS payment_transactions_tenant_access ON payment_transactions;
--> statement-breakpoint
CREATE POLICY payment_transactions_tenant_access ON payment_transactions FOR ALL
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );
--> statement-breakpoint

REVOKE ALL ON payment_transactions FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON payment_transactions TO authenticated;
--> statement-breakpoint
GRANT ALL ON payment_transactions TO service_role;
--> statement-breakpoint

INSERT INTO permissions (code, description) VALUES
  ('refund:financial', 'Registrar reembolsos financeiros vinculados a pagamentos')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role, permission_code) VALUES
  ('owner', 'refund:financial')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0057-financial-payment-ledger')
ON CONFLICT (version) DO NOTHING;

