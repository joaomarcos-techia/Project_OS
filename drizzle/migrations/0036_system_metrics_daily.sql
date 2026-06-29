CREATE TABLE IF NOT EXISTS "system_metrics_daily" (
	"clinic_id" uuid NOT NULL,
	"date" date NOT NULL,
	"metric_name" text NOT NULL,
	"value" numeric(20, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_metrics_daily_clinic_id_date_metric_name_pk" PRIMARY KEY("clinic_id","date","metric_name")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "system_metrics_daily_metric_date_idx" ON "system_metrics_daily" USING btree ("metric_name","date");--> statement-breakpoint

-- C16 (FASE 7): FK clinic_id + RLS (defaultTenantPolicy v1) + GRANTs + trigger
-- updated_at. Mesmo padrão de cash_flow_daily (0020). Escrita real vem do cron
-- /api/cron/metrics-rollup via dbAdmin (BYPASSRLS); a clínica só LÊ o seu.
DO $$ BEGIN
 ALTER TABLE "system_metrics_daily" ADD CONSTRAINT "system_metrics_daily_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE system_metrics_daily ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE system_metrics_daily FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY system_metrics_daily_tenant_access ON system_metrics_daily FOR ALL
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
GRANT SELECT, INSERT, UPDATE ON system_metrics_daily TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON system_metrics_daily TO service_role;--> statement-breakpoint
CREATE TRIGGER trg_system_metrics_daily_updated_at BEFORE UPDATE ON system_metrics_daily FOR EACH ROW EXECUTE FUNCTION set_updated_at();