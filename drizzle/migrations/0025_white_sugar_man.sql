DROP INDEX IF EXISTS "patients_clinic_email_uniq";--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_clinic_config" ADD COLUMN "can_disclose_payments_via_agent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "collected_data_encrypted" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "patients_clinic_email_uniq" ON "patients" USING btree ("clinic_id","email") WHERE email IS NOT NULL;