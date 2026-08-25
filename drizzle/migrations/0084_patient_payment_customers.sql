-- 0084 — patient_payment_customers: o mapa paciente → customer no Asaas DA CLINICA
-- (ADR-050, que destrava a sub-fase 1.3 do ADR-049).
--
-- POR QUE O MAPA E POR CLINICA: o customer existe DENTRO da conta Asaas da clinica.
-- O mesmo paciente atendido por duas clinicas tem dois customers, em duas contas
-- diferentes. Um mapa global de paciente→customer seria simplesmente errado.
--
-- O QUE ESTA TABELA GUARDA: so o id do customer no provedor. Nome e CPF NAO sao
-- copiados para ca — eles ja vivem em `patients`, cifrados. Duplicar PII para
-- "facilitar" seria criar um segundo lugar para vazar.
--
-- LGPD (ADR-050 D4): `patient_id ON DELETE CASCADE` — o hard-delete do paciente
-- apaga esta linha. O customer DENTRO da conta Asaas da clinica NAO e apagado pelo
-- Qoro: aquela base e da clinica (controladora), e apagar registro financeiro de
-- terceiro por conta propria seria pior que nao apagar. Isso esta no runbook.
--
-- IDEMPOTENCIA: UNIQUE (clinic_id, patient_id, provider). O worker do outbox
-- entrega at-least-once; sem essa trava, uma reentrega criaria um segundo customer
-- para o mesmo paciente e a conciliacao da clinica passaria a ter dois pagadores
-- para uma pessoa so.

CREATE TABLE IF NOT EXISTS patient_payment_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'asaas',
  -- Id do customer na conta do provedor. Publico dentro daquela conta; nao e credencial.
  provider_customer_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_payment_customers_provider_chk CHECK (provider IN ('asaas')),
  CONSTRAINT patient_payment_customers_uniq UNIQUE (clinic_id, patient_id, provider)
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE public.patient_payment_customers
    ADD CONSTRAINT patient_payment_customers_patient_id_fkey
    FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patient_payment_customers_clinic_id_idx
  ON public.patient_payment_customers (clinic_id);
--> statement-breakpoint

ALTER TABLE public.patient_payment_customers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.patient_payment_customers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY patient_payment_customers_read ON public.patient_payment_customers FOR SELECT
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );
--> statement-breakpoint
CREATE POLICY patient_payment_customers_write ON public.patient_payment_customers FOR INSERT
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint

-- Sem UPDATE e sem DELETE para `authenticated`: o vinculo nao muda. Se o customer
-- do provedor mudar, a linha certa e uma linha NOVA — e a UNIQUE forca a decisao a
-- ser consciente em vez de sobrescrever um vinculo financeiro em silencio.
REVOKE ALL ON public.patient_payment_customers FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.patient_payment_customers TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.patient_payment_customers TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0084-patient-payment-customers')
ON CONFLICT (version) DO NOTHING;
