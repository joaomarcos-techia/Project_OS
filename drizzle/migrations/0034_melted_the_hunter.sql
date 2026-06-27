CREATE TYPE "public"."prescription_kind" AS ENUM('simples', 'controle_especial');--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "telefone" text;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "kind" "prescription_kind" DEFAULT 'simples' NOT NULL;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "snapshot_patient_endereco" text;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "snapshot_emitente_nome" text;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "snapshot_emitente_endereco" text;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "snapshot_emitente_telefone" text;