ALTER TABLE "profiles" ADD COLUMN "invite_accepted_at" timestamp with time zone;--> statement-breakpoint
-- Backfill: profiles existentes já estão ativos → marca como ACEITOS (não "convite pendente").
-- Só novos convites (Fase 2) nascem com invite_accepted_at NULL. Owner novo é setado na saga.
UPDATE "profiles" SET "invite_accepted_at" = "created_at" WHERE "invite_accepted_at" IS NULL;--> statement-breakpoint
-- ADR-032 §5: unicidade de CRM por clínica (CRM normalizado na app). Se houver CRM
-- duplicado legado, este CREATE falha e exige limpeza antes de aplicar (esperado).
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_clinic_crm_unique" ON "profiles" USING btree ("clinic_id","crm") WHERE "profiles"."crm" IS NOT NULL;