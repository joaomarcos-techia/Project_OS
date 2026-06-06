CREATE TYPE "public"."lancamento_created_via" AS ENUM('auto', 'manual', 'estorno');--> statement-breakpoint
CREATE TYPE "public"."lancamento_status" AS ENUM('pendente', 'parcial', 'pago', 'cancelado', 'estornado');--> statement-breakpoint
CREATE TYPE "public"."lancamento_tipo" AS ENUM('receber', 'pagar');--> statement-breakpoint
CREATE TYPE "public"."payment_proof_type" AS ENUM('comprovante', 'nota_fiscal', 'outro');--> statement-breakpoint
CREATE TYPE "public"."pendencia_status" AS ENUM('aberta', 'resolvida');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cash_flow_daily" (
	"clinic_id" uuid NOT NULL,
	"date" date NOT NULL,
	"total_recebido" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_pago" numeric(14, 2) DEFAULT '0' NOT NULL,
	"saldo" numeric(14, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_flow_daily_clinic_id_date_pk" PRIMARY KEY("clinic_id","date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "faturamento_pendencias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"motivo" text NOT NULL,
	"valor" numeric(12, 2),
	"status" "pendencia_status" DEFAULT 'aberta' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lancamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"unit_id" uuid,
	"tipo" "lancamento_tipo" NOT NULL,
	"descricao" text NOT NULL,
	"valor" numeric(12, 2) NOT NULL,
	"valor_pago" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" "lancamento_status" DEFAULT 'pendente' NOT NULL,
	"due_date" date,
	"paid_at" timestamp with time zone,
	"patient_id" uuid,
	"supplier_id" uuid,
	"appointment_id" uuid,
	"payment_method" text,
	"created_via" "lancamento_created_via" NOT NULL,
	"reverses_lancamento_id" uuid,
	"snapshot_procedure_name" text,
	"snapshot_doctor_nome" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lancamentos_valor_chk" CHECK ("lancamentos"."valor" >= 0),
	CONSTRAINT "lancamentos_valor_pago_chk" CHECK ("lancamentos"."valor_pago" >= 0 AND "lancamentos"."valor_pago" <= "lancamentos"."valor"),
	CONSTRAINT "lancamentos_auto_origin_chk" CHECK ("lancamentos"."created_via" <> 'auto' OR "lancamentos"."appointment_id" IS NOT NULL),
	CONSTRAINT "lancamentos_estorno_origin_chk" CHECK ("lancamentos"."created_via" <> 'estorno' OR "lancamentos"."reverses_lancamento_id" IS NOT NULL),
	CONSTRAINT "lancamentos_paid_coerencia_chk" CHECK ("lancamentos"."status" <> 'pago' OR "lancamentos"."paid_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_methods" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"lancamento_id" uuid NOT NULL,
	"type" "payment_proof_type" NOT NULL,
	"file_storage_path" text NOT NULL,
	"ocr_data" jsonb,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"razao_social" text NOT NULL,
	"cnpj" text,
	"contato" text,
	"condicao_pagamento" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_flow_daily" ADD CONSTRAINT "cash_flow_daily_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "faturamento_pendencias" ADD CONSTRAINT "faturamento_pendencias_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_payment_method_payment_methods_code_fk" FOREIGN KEY ("payment_method") REFERENCES "public"."payment_methods"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_reverses_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("reverses_lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "faturamento_pendencias_appointment_uniq" ON "faturamento_pendencias" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "faturamento_pendencias_clinic_status_idx" ON "faturamento_pendencias" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lancamentos_clinic_status_idx" ON "lancamentos" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lancamentos_clinic_tipo_status_idx" ON "lancamentos" USING btree ("clinic_id","tipo","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lancamentos_clinic_due_idx" ON "lancamentos" USING btree ("clinic_id","due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lancamentos_clinic_patient_idx" ON "lancamentos" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lancamentos_reverses_idx" ON "lancamentos" USING btree ("reverses_lancamento_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lancamentos_appointment_uniq" ON "lancamentos" USING btree ("appointment_id") WHERE appointment_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_proofs_clinic_lancamento_idx" ON "payment_proofs" USING btree ("clinic_id","lancamento_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suppliers_clinic_id_idx" ON "suppliers" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suppliers_clinic_ativo_idx" ON "suppliers" USING btree ("clinic_id","ativo");--> statement-breakpoint

-- =====================================================================
-- C9 hand-edit (append) — FKs cross-context + RLS + triggers + append-only
-- + GRANTs + seed. drizzle-kit gera só tabelas/colunas/índices/FK intra-context;
-- o resto é mantido à mão (padrão de 0017_clinical_core.sql / CONVENTIONS).
-- =====================================================================

-- 1. Cross-context FKs (patients / appointments / clinic_units — fora do Drizzle
--    por boundaries). *_by → auth.users ficam SEM FK (mesma convenção de 0017).
--    lancamentos.appointment_id ON DELETE CASCADE: appointment só é removido no
--    teardown da clínica (CASCADE de clinic_id) — evita conflito com o CHECK
--    auto⇒appointment_id NOT NULL (SET NULL violaria) e com RESTRICT no teardown.
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_unit_id_clinic_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."clinic_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faturamento_pendencias" ADD CONSTRAINT "faturamento_pendencias_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- 2. RLS — defaultTenantPolicy(v1) nas 5 tabelas tenant-scoped (ENABLE + FORCE).
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppliers" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "suppliers_tenant_access" ON "suppliers" FOR ALL
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  )
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "lancamentos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lancamentos" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "lancamentos_tenant_access" ON "lancamentos" FOR ALL
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  )
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "payment_proofs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_proofs" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payment_proofs_tenant_access" ON "payment_proofs" FOR ALL
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  )
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "faturamento_pendencias" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "faturamento_pendencias" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "faturamento_pendencias_tenant_access" ON "faturamento_pendencias" FOR ALL
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  )
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "cash_flow_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_flow_daily" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "cash_flow_daily_tenant_access" ON "cash_flow_daily" FOR ALL
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  )
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = current_clinic_id()
    OR is_super_admin()
  );--> statement-breakpoint

-- 3. payment_methods: catálogo GLOBAL read-only authenticated (padrão de
--    `permissions` em 0003). Sem clinic_id → sem tenant policy; só leitura.
ALTER TABLE "payment_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_methods" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payment_methods_read_authenticated" ON "payment_methods" FOR SELECT TO authenticated USING (true);--> statement-breakpoint

-- 4. updated_at triggers (tabelas mutáveis; payment_proofs/faturamento_pendencias
--    não têm updated_at → sem trigger).
CREATE TRIGGER trg_suppliers_updated_at BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_lancamentos_updated_at BEFORE UPDATE ON lancamentos FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_cash_flow_daily_updated_at BEFORE UPDATE ON cash_flow_daily FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- 5. Append-only ENXUTO (R1): bloqueia SÓ colunas imutáveis de lancamentos. A
--    transição de status (pendente/parcial/pago/cancelado/estornado) é state
--    machine no domínio (financial/logic.ts), NÃO no banco. SECURITY DEFINER +
--    search_path fixo (ADR-010), padrão de block_signed_prontuario_update (0017).
CREATE OR REPLACE FUNCTION public.block_lancamento_immutable_cols() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.clinic_id              IS DISTINCT FROM OLD.clinic_id
  OR NEW.tipo                   IS DISTINCT FROM OLD.tipo
  OR NEW.valor                  IS DISTINCT FROM OLD.valor
  OR NEW.created_via            IS DISTINCT FROM OLD.created_via
  OR NEW.appointment_id         IS DISTINCT FROM OLD.appointment_id
  OR NEW.reverses_lancamento_id IS DISTINCT FROM OLD.reverses_lancamento_id THEN
    RAISE EXCEPTION 'Lançamento é append-only: clinic_id/tipo/valor/created_via/appointment_id/reverses_lancamento_id são imutáveis.';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.block_lancamento_immutable_cols() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.block_lancamento_immutable_cols() TO authenticated, service_role;--> statement-breakpoint
CREATE TRIGGER trg_lancamentos_block_immutable
  BEFORE UPDATE ON lancamentos FOR EACH ROW
  EXECUTE FUNCTION public.block_lancamento_immutable_cols();--> statement-breakpoint

-- 6. GRANTs explícitos (padrão 0012 — não depender de default-privilege Supabase).
--    lancamentos / payment_proofs / cash_flow_daily SEM DELETE (histórico
--    financeiro nunca é deletado; estorno é append-only).
GRANT SELECT, INSERT, UPDATE ON lancamentos TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON lancamentos TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON suppliers TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON suppliers TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT ON payment_proofs TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON payment_proofs TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON faturamento_pendencias TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON faturamento_pendencias TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON cash_flow_daily TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON cash_flow_daily TO service_role;--> statement-breakpoint
GRANT SELECT ON payment_methods TO authenticated;--> statement-breakpoint
GRANT SELECT ON payment_methods TO service_role;--> statement-breakpoint

-- 7. Seed do catálogo global de formas de pagamento (todas ativas).
INSERT INTO payment_methods (code, label, ordem) VALUES
  ('pix',            'PIX',                1),
  ('dinheiro',       'Dinheiro',           2),
  ('cartao_credito', 'Cartão de Crédito',  3),
  ('cartao_debito',  'Cartão de Débito',   4),
  ('transferencia',  'Transferência',      5)
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint

-- 8. RBAC C9 — permissão granular operate:caixa (confirmar/cancelar pagamento).
--    Aditivo (template 0016): só o código C9 a consulta → seguro com o feature.
--    Atendente opera o caixa SEM ganhar manage:financial (lançamento/fornecedor/
--    estorno). owner/gestor/financial também recebem.
INSERT INTO permissions (code, description) VALUES
  ('operate:caixa', 'Operar o caixa: confirmar e cancelar pagamentos')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions (role, permission_code) VALUES
  ('owner',     'operate:caixa'),
  ('gestor',    'operate:caixa'),
  ('financial', 'operate:caixa'),
  ('attendant', 'operate:caixa')
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 9. Schema version snapshot.
INSERT INTO _schema_version (version) VALUES ('c9-financial-core') ON CONFLICT (version) DO NOTHING;