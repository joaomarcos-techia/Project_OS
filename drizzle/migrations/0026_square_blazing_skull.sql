CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."checkout_status" AS ENUM('pending', 'completed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."invoice_item_type" AS ENUM('plan', 'setup', 'discount', 'credit');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('open', 'partial', 'paid', 'overdue', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_attempt_status" AS ENUM('pending', 'confirmed', 'declined', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."plan_limit_metric" AS ENUM('users', 'agendamentos', 'ai_messages');--> statement-breakpoint
CREATE TYPE "public"."provisioning_status" AS ENUM('pending', 'provisioning', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."setup_fee_status" AS ENUM('pending', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."subscription_billing_status" AS ENUM('trial', 'active', 'past_due', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."clinic_status" ADD VALUE IF NOT EXISTS 'pending_payment';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "annual_prepayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"valor_total" numeric(12, 2) NOT NULL,
	"valor_economizado" numeric(12, 2) DEFAULT '0' NOT NULL,
	"valid_until" date NOT NULL,
	"refund_eligible_until" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annual_prepayments_valor_chk" CHECK ("annual_prepayments"."valor_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"document" text,
	"email" text NOT NULL,
	"phone" text,
	"asaas_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_customers_clinic_uniq" UNIQUE("clinic_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"found_divergences" integer DEFAULT 0 NOT NULL,
	"fixed_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "checkout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"document" text,
	"clinic_name" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"billing_cycle" "billing_cycle" DEFAULT 'monthly' NOT NULL,
	"status" "checkout_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"clinic_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "checkout_sessions_idem_uniq" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"type" "invoice_item_type" NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"subscription_id" uuid,
	"period_start" date,
	"period_end" date,
	"total_amount" numeric(12, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'open' NOT NULL,
	"due_date" date NOT NULL,
	"paid_at" timestamp with time zone,
	"asaas_payment_id" text,
	"nfe_url" text,
	"payment_method" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_total_chk" CHECK ("invoices"."total_amount" >= 0),
	CONSTRAINT "invoices_paid_coerencia_chk" CHECK ("invoices"."status" <> 'paid' OR "invoices"."paid_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"provider" text DEFAULT 'asaas' NOT NULL,
	"provider_payment_id" text,
	"status" "payment_attempt_status" NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"metric" "plan_limit_metric" NOT NULL,
	"limit_value" integer NOT NULL,
	CONSTRAINT "plan_limits_plan_metric_uniq" UNIQUE("plan_id","metric"),
	CONSTRAINT "plan_limits_value_chk" CHECK ("plan_limits"."limit_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_uniq" UNIQUE("code"),
	CONSTRAINT "plans_code_chk" CHECK ("plans"."code" ~ '^[a-z][a-z0-9_]{1,30}$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"billing_cycle" "billing_cycle" NOT NULL,
	"active_from" timestamp with time zone DEFAULT now() NOT NULL,
	"active_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prices_amount_chk" CHECK ("prices"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_webhooks" (
	"asaas_event_id" text PRIMARY KEY NOT NULL,
	"clinic_id" uuid,
	"event_type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "setup_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"valor" numeric(12, 2) NOT NULL,
	"status" "setup_fee_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"asaas_payment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_fees_valor_chk" CHECK ("setup_fees"."valor" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"old_plan_id" uuid,
	"new_plan_id" uuid,
	"old_status" text,
	"new_status" text,
	"changed_by" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"price_id" uuid NOT NULL,
	"billing_status" "subscription_billing_status" DEFAULT 'trial' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"grace_period_until" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"asaas_subscription_id" text,
	"dunning_stage" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_clinic_uniq" UNIQUE("clinic_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_provisioning" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkout_session_id" uuid,
	"clinic_id" uuid,
	"status" "provisioning_status" DEFAULT 'pending' NOT NULL,
	"step" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_counter_ledger" (
	"clinic_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"subject_id" text NOT NULL,
	"dedup_key" text NOT NULL,
	"period_yyyymm" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_counter_ledger_clinic_id_metric_dedup_key_pk" PRIMARY KEY("clinic_id","metric","dedup_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"period_yyyymm" text NOT NULL,
	"agendamentos_count" integer DEFAULT 0 NOT NULL,
	"conversas_ia_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_metrics_clinic_period_uniq" UNIQUE("clinic_id","period_yyyymm"),
	CONSTRAINT "usage_metrics_period_chk" CHECK ("usage_metrics"."period_yyyymm" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "annual_prepayments" ADD CONSTRAINT "annual_prepayments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_limits" ADD CONSTRAINT "plan_limits_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prices" ADD CONSTRAINT "prices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "setup_fees" ADD CONSTRAINT "setup_fees_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_history" ADD CONSTRAINT "subscription_history_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_history" ADD CONSTRAINT "subscription_history_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_price_id_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."prices"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_provisioning" ADD CONSTRAINT "tenant_provisioning_checkout_session_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_session_id") REFERENCES "public"."checkout_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_counter_ledger" ADD CONSTRAINT "usage_counter_ledger_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_metrics" ADD CONSTRAINT "usage_metrics_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "annual_prepayments_clinic_id_idx" ON "annual_prepayments" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_customers_clinic_id_idx" ON "billing_customers" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_events_clinic_created_idx" ON "billing_events" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkout_sessions_status_idx" ON "checkout_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_items_clinic_invoice_idx" ON "invoice_items" USING btree ("clinic_id","invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_clinic_status_idx" ON "invoices" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_due_idx" ON "invoices" USING btree ("status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_asaas_payment_uniq" ON "invoices" USING btree ("asaas_payment_id") WHERE asaas_payment_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_attempts_clinic_invoice_idx" ON "payment_attempts" USING btree ("clinic_id","invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prices_plan_id_idx" ON "prices" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prices_active_uniq" ON "prices" USING btree ("plan_id","billing_cycle") WHERE active_until IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "setup_fees_clinic_id_idx" ON "setup_fees" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_history_clinic_sub_idx" ON "subscription_history" USING btree ("clinic_id","subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_clinic_id_idx" ON "subscriptions" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_billing_status_idx" ON "subscriptions" USING btree ("billing_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_provisioning_status_idx" ON "tenant_provisioning" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_provisioning_session_idx" ON "tenant_provisioning" USING btree ("checkout_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_metrics_clinic_id_idx" ON "usage_metrics" USING btree ("clinic_id");--> statement-breakpoint

-- =====================================================================
-- C13 hand-edit (append) — FK nullable cross-context + RLS + triggers + GRANTs
-- + seed canônico de planos/preços/limites. Padrão de 0020_financial_core.sql.
-- drizzle-kit gera só tabelas/colunas/índices/FK; o resto é mantido à mão.
-- =====================================================================

-- 1. FKs nullable cross-context (clinic_id em tabelas plataforma; SET NULL).
DO $$ BEGIN
 ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_provisioning" ADD CONSTRAINT "tenant_provisioning_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "processed_webhooks" ADD CONSTRAINT "processed_webhooks_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- *_by → auth.users ficam SEM FK (convenção de 0017/0020).

-- 2. RLS defaultTenantPolicy(v1) nas 11 tabelas tenant-scoped (ENABLE + FORCE).
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "billing_customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_customers" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "billing_customers_tenant_access" ON "billing_customers" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscriptions" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "subscriptions_tenant_access" ON "subscriptions" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "subscription_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscription_history" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "subscription_history_tenant_access" ON "subscription_history" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "invoices_tenant_access" ON "invoices" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "invoice_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_items" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "invoice_items_tenant_access" ON "invoice_items" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "payment_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_attempts" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payment_attempts_tenant_access" ON "payment_attempts" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "setup_fees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "setup_fees" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "setup_fees_tenant_access" ON "setup_fees" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "annual_prepayments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "annual_prepayments" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "annual_prepayments_tenant_access" ON "annual_prepayments" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "usage_metrics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage_metrics" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "usage_metrics_tenant_access" ON "usage_metrics" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "usage_counter_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage_counter_ledger" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "usage_counter_ledger_tenant_access" ON "usage_counter_ledger" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE "billing_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_events" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "billing_events_tenant_access" ON "billing_events" FOR ALL
  USING (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin())
  WITH CHECK (clinic_id::text = current_setting('app.current_clinic', true) OR clinic_id::text = current_clinic_id() OR is_super_admin());--> statement-breakpoint

-- 3. Catálogo global (plans/prices/plan_limits): leitura authenticated; escrita
--    via migration/service_role (padrão `payment_methods`/`permissions`).
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plans" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "plans_read_authenticated" ON "plans" FOR SELECT TO authenticated USING (true);--> statement-breakpoint
ALTER TABLE "prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prices" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "prices_read_authenticated" ON "prices" FOR SELECT TO authenticated USING (true);--> statement-breakpoint
ALTER TABLE "plan_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_limits" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "plan_limits_read_authenticated" ON "plan_limits" FOR SELECT TO authenticated USING (true);--> statement-breakpoint

-- 4. Tabelas plataforma (pré/cross-tenant): ENABLE+FORCE sem policy authenticated
--    → acessadas só via dbAdmin (service_role bypassa). Defesa: nenhum tenant lê.
ALTER TABLE "checkout_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkout_sessions" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_provisioning" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_provisioning" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "processed_webhooks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "processed_webhooks" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_reconciliation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_reconciliation_runs" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint

-- 5. updated_at triggers (tabelas com updated_at).
CREATE TRIGGER trg_plans_updated_at BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_prices_updated_at BEFORE UPDATE ON prices FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_billing_customers_updated_at BEFORE UPDATE ON billing_customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_setup_fees_updated_at BEFORE UPDATE ON setup_fees FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_tenant_provisioning_updated_at BEFORE UPDATE ON tenant_provisioning FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- 6. GRANTs explícitos (padrão 0020). Billing é orientado a histórico → SEM DELETE.
GRANT SELECT, INSERT, UPDATE ON billing_customers TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON subscriptions TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT ON subscription_history TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON invoices TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT ON invoice_items TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT ON payment_attempts TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON setup_fees TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON annual_prepayments TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON usage_metrics TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT ON usage_counter_ledger TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT ON billing_events TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT ON plans TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT ON prices TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT ON plan_limits TO authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON checkout_sessions TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tenant_provisioning TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT ON processed_webhooks TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON billing_reconciliation_runs TO service_role;--> statement-breakpoint

-- 7. Seed canônico (idempotente). Planos → preços (monthly + annual 15% off) →
--    limites (capacidade numérica — ADR-024). Re-executável (ON CONFLICT).
INSERT INTO plans (code, name) VALUES
  ('solo',    'Solo'),
  ('clinica', 'Clínica'),
  ('pro',     'Pro')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint
-- Preços mensais
INSERT INTO prices (plan_id, amount, currency, billing_cycle)
  SELECT id, 149.00, 'BRL', 'monthly' FROM plans WHERE code='solo'
  ON CONFLICT (plan_id, billing_cycle) WHERE active_until IS NULL DO NOTHING;--> statement-breakpoint
INSERT INTO prices (plan_id, amount, currency, billing_cycle)
  SELECT id, 349.00, 'BRL', 'monthly' FROM plans WHERE code='clinica'
  ON CONFLICT (plan_id, billing_cycle) WHERE active_until IS NULL DO NOTHING;--> statement-breakpoint
INSERT INTO prices (plan_id, amount, currency, billing_cycle)
  SELECT id, 699.00, 'BRL', 'monthly' FROM plans WHERE code='pro'
  ON CONFLICT (plan_id, billing_cycle) WHERE active_until IS NULL DO NOTHING;--> statement-breakpoint
-- Preços anuais (12 × mensal × 0.85)
INSERT INTO prices (plan_id, amount, currency, billing_cycle)
  SELECT id, 1519.80, 'BRL', 'annual' FROM plans WHERE code='solo'
  ON CONFLICT (plan_id, billing_cycle) WHERE active_until IS NULL DO NOTHING;--> statement-breakpoint
INSERT INTO prices (plan_id, amount, currency, billing_cycle)
  SELECT id, 3559.80, 'BRL', 'annual' FROM plans WHERE code='clinica'
  ON CONFLICT (plan_id, billing_cycle) WHERE active_until IS NULL DO NOTHING;--> statement-breakpoint
INSERT INTO prices (plan_id, amount, currency, billing_cycle)
  SELECT id, 7129.80, 'BRL', 'annual' FROM plans WHERE code='pro'
  ON CONFLICT (plan_id, billing_cycle) WHERE active_until IS NULL DO NOTHING;--> statement-breakpoint
-- Limites por plano (users / agendamentos / ai_messages)
INSERT INTO plan_limits (plan_id, metric, limit_value)
  SELECT id, m.metric::plan_limit_metric, m.val FROM plans p
  CROSS JOIN (VALUES ('users',2),('agendamentos',200),('ai_messages',200)) AS m(metric,val)
  WHERE p.code='solo'
  ON CONFLICT (plan_id, metric) DO NOTHING;--> statement-breakpoint
INSERT INTO plan_limits (plan_id, metric, limit_value)
  SELECT id, m.metric::plan_limit_metric, m.val FROM plans p
  CROSS JOIN (VALUES ('users',5),('agendamentos',800),('ai_messages',800)) AS m(metric,val)
  WHERE p.code='clinica'
  ON CONFLICT (plan_id, metric) DO NOTHING;--> statement-breakpoint
INSERT INTO plan_limits (plan_id, metric, limit_value)
  SELECT id, m.metric::plan_limit_metric, m.val FROM plans p
  CROSS JOIN (VALUES ('users',15),('agendamentos',2500),('ai_messages',2500)) AS m(metric,val)
  WHERE p.code='pro'
  ON CONFLICT (plan_id, metric) DO NOTHING;--> statement-breakpoint

-- 8. Schema version snapshot.
INSERT INTO _schema_version (version) VALUES ('c13-billing-core') ON CONFLICT (version) DO NOTHING;