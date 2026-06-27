CREATE TYPE "public"."whatsapp_connection_status" AS ENUM('pending', 'connecting', 'connected', 'failed', 'disconnected', 'expired');--> statement-breakpoint
ALTER TABLE "clinic_whatsapp_numbers" ADD COLUMN "connection_status" "whatsapp_connection_status" DEFAULT 'connected' NOT NULL;--> statement-breakpoint

-- Backfill: linhas inativas refletem 'disconnected' (ativas mantêm o default 'connected').
UPDATE "clinic_whatsapp_numbers" SET "connection_status" = 'disconnected' WHERE active = false;--> statement-breakpoint

-- Grant column-level: `authenticated` (owner/gestor) precisa LER connection_status
-- (página /configuracoes/whatsapp + checklist do dashboard, ambos via withTenant).
-- Mantém token_encrypted fora do grant (service_role-only — contrato C10).
GRANT SELECT ("connection_status") ON clinic_whatsapp_numbers TO authenticated;