-- 0091 — gerações idempotentes do Checkout hospedado de paciente (D24/D57/D58).
--
-- Uma `patient_charge` continua sendo a dívida única do atendimento. Cada linha
-- abaixo é somente uma tentativa/link hospedado de até 24h. A separação é
-- obrigatória porque `POST /checkouts` não oferece idempotency-key e repetir um
-- POST cuja resposta se perdeu pode criar dois recursos pagáveis.

DO $$ BEGIN
  CREATE TYPE patient_checkout_generation_status AS ENUM (
    'creating',          -- lease exclusivo adquirido; POST ainda em andamento
    'active',            -- id + link + expiração confirmados pelo Asaas
    'creation_unknown',  -- timeout/crash: não repetir POST às cegas
    'paid',
    'cancelled',
    'expired',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE public.patient_charges
  ADD COLUMN IF NOT EXISTS provider_checkout_id text,
  ADD COLUMN IF NOT EXISTS checkout_generation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checkout_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS collection_expires_at timestamptz;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE public.patient_charges
    ADD CONSTRAINT patient_charges_checkout_generation_chk
    CHECK (checkout_generation >= 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE public.patient_charges
    ADD CONSTRAINT patient_charges_checkout_pointer_chk
    CHECK (
      provider_checkout_id IS NULL
      OR (
        checkout_generation > 0
        AND invoice_url IS NOT NULL
        AND checkout_expires_at IS NOT NULL
      )
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS patient_charges_provider_checkout_uniq
  ON public.patient_charges (clinic_id, provider_checkout_id)
  WHERE provider_checkout_id IS NOT NULL;
--> statement-breakpoint

-- Uma cobrança do provedor não pode quitar duas dívidas locais da mesma clínica.
CREATE UNIQUE INDEX IF NOT EXISTS patient_charges_provider_payment_uniq
  ON public.patient_charges (clinic_id, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patient_charges_checkout_renewal_idx
  ON public.patient_charges (checkout_expires_at, collection_expires_at)
  WHERE status = 'pending' AND provider_checkout_id IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS patient_checkout_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_charge_id uuid NOT NULL REFERENCES public.patient_charges(id) ON DELETE CASCADE,
  generation integer NOT NULL,
  external_reference text NOT NULL,
  status patient_checkout_generation_status NOT NULL DEFAULT 'creating',
  provider_checkout_id text,
  checkout_url text,
  expires_at timestamptz,
  lease_until timestamptz,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_checkout_generations_number_chk CHECK (generation > 0),
  CONSTRAINT patient_checkout_generations_active_chk CHECK (
    status <> 'active'
    OR (
      provider_checkout_id IS NOT NULL
      AND checkout_url IS NOT NULL
      AND expires_at IS NOT NULL
      AND resolved_at IS NOT NULL
    )
  ),
  CONSTRAINT patient_checkout_generations_charge_generation_uniq
    UNIQUE (patient_charge_id, generation),
  CONSTRAINT patient_checkout_generations_external_reference_uniq
    UNIQUE (clinic_id, external_reference)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS patient_checkout_generations_provider_checkout_uniq
  ON public.patient_checkout_generations (clinic_id, provider_checkout_id)
  WHERE provider_checkout_id IS NOT NULL;
--> statement-breakpoint

-- Uma dívida nunca pode ter duas gerações simultaneamente criáveis/pagáveis.
CREATE UNIQUE INDEX IF NOT EXISTS patient_checkout_generations_one_open_uniq
  ON public.patient_checkout_generations (patient_charge_id)
  WHERE status IN ('creating', 'active', 'creation_unknown');
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patient_checkout_generations_renewal_idx
  ON public.patient_checkout_generations (expires_at)
  WHERE status = 'active';
--> statement-breakpoint

ALTER TABLE public.patient_checkout_generations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.patient_checkout_generations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY patient_checkout_generations_read
  ON public.patient_checkout_generations FOR SELECT
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );
--> statement-breakpoint

CREATE POLICY patient_checkout_generations_write
  ON public.patient_checkout_generations FOR INSERT
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint

CREATE POLICY patient_checkout_generations_update
  ON public.patient_checkout_generations FOR UPDATE
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  )
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint

REVOKE ALL ON public.patient_checkout_generations FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.patient_checkout_generations TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.patient_checkout_generations TO service_role;
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0091-patient-checkout-generations')
ON CONFLICT (version) DO NOTHING;
