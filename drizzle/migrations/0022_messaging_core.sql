-- =====================================================================
-- 0022_messaging_core.sql
-- C10 — MessagingProvider Abstraction + Webhook Meta.
--
-- 5 tabelas: 4 tenant-scoped (clinic_whatsapp_numbers, inbound_messages_raw,
-- outbound_messages, provider_status_events_raw) + 1 global-protected
-- (inbound_messages_orphaned, super_admin-only). RLS ENABLE+FORCE +
-- defaultTenantPolicy(v1); grants column-level (token_encrypted = service_role-only).
--
-- Idempotente (IF NOT EXISTS / DO-guards / DROP POLICY IF EXISTS) — aplicável
-- via `drizzle-kit migrate` (entry no journal) OU manualmente no Supabase SQL
-- Editor (mesma prática das migrations 0018-0021). Apenas CRIA objetos novos de
-- messaging; não toca tabelas existentes.
-- =====================================================================

-- --- enums -----------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "public"."messaging_provider" AS ENUM ('meta', 'zapi');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."outbound_status" AS ENUM ('pending', 'accepted', 'failed', 'unknown');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- --- tables ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "clinic_whatsapp_numbers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "provider" "messaging_provider" DEFAULT 'meta' NOT NULL,
  "phone_number" text NOT NULL,
  "meta_phone_id" text NOT NULL,
  "meta_business_id" text,
  "token_encrypted" text NOT NULL,
  "token_version" integer DEFAULT 1 NOT NULL,
  "verified_at" timestamp with time zone,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "inbound_messages_raw" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "provider_message_id" text NOT NULL,
  "provider" "messaging_provider" NOT NULL,
  "from_number_hash" text NOT NULL,
  "to_number" text,
  "content_encrypted" text NOT NULL,
  "payload_hash" text NOT NULL,
  "media_url" text,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "outbound_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "idempotency_key" text NOT NULL,
  "to_number_hash" text NOT NULL,
  "content_encrypted" text NOT NULL,
  "template_id" text,
  "provider_message_id" text,
  "provider_response" jsonb,
  "status" "outbound_status" DEFAULT 'pending' NOT NULL,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "provider_status_events_raw" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "provider" "messaging_provider" NOT NULL,
  "provider_message_id" text,
  "status_text" text NOT NULL,
  "recipient_hash" text,
  "payload_hash" text NOT NULL,
  "raw" jsonb NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "inbound_messages_orphaned" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" "messaging_provider" NOT NULL,
  "provider_message_id" text,
  "to_phone_id" text,
  "from_number_hash" text,
  "payload_hash" text NOT NULL,
  "payload_encrypted" text NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- --- foreign keys (clinic_id -> clinics, ON DELETE CASCADE) -----------------
DO $$ BEGIN
  ALTER TABLE "clinic_whatsapp_numbers" ADD CONSTRAINT "clinic_whatsapp_numbers_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inbound_messages_raw" ADD CONSTRAINT "inbound_messages_raw_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "provider_status_events_raw" ADD CONSTRAINT "provider_status_events_raw_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- --- indexes ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "clinic_whatsapp_numbers_clinic_id_idx" ON "clinic_whatsapp_numbers" ("clinic_id");--> statement-breakpoint
-- 1 clínica = 1 número ATIVO; 1 número = 1 clínica. Partial WHERE active=true
-- libera reconexão após active=false (1ª#3).
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_whatsapp_numbers_clinic_active_uniq" ON "clinic_whatsapp_numbers" ("clinic_id") WHERE active = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_whatsapp_numbers_phone_active_uniq" ON "clinic_whatsapp_numbers" ("phone_number") WHERE active = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_whatsapp_numbers_meta_phone_active_uniq" ON "clinic_whatsapp_numbers" ("meta_phone_id") WHERE active = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_messages_raw_clinic_id_idx" ON "inbound_messages_raw" ("clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbound_messages_raw_provider_msg_uniq" ON "inbound_messages_raw" ("provider","provider_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_messages_clinic_id_idx" ON "outbound_messages" ("clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outbound_messages_clinic_idem_uniq" ON "outbound_messages" ("clinic_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_messages_provider_msg_idx" ON "outbound_messages" ("provider_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_status_events_raw_clinic_id_idx" ON "provider_status_events_raw" ("clinic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_status_events_raw_provider_msg_idx" ON "provider_status_events_raw" ("provider","provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_status_events_raw_payload_uniq" ON "provider_status_events_raw" ("provider","payload_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbound_messages_orphaned_payload_uniq" ON "inbound_messages_orphaned" ("provider","payload_hash");--> statement-breakpoint

-- --- updated_at trigger -----------------------------------------------------
DROP TRIGGER IF EXISTS trg_clinic_whatsapp_numbers_updated_at ON clinic_whatsapp_numbers;--> statement-breakpoint
CREATE TRIGGER trg_clinic_whatsapp_numbers_updated_at
  BEFORE UPDATE ON clinic_whatsapp_numbers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- --- RLS: 4 tenant-scoped (FORCE + defaultTenantPolicy) ---------------------
-- GENERATED_BY: defaultTenantPolicy(v1)
ALTER TABLE clinic_whatsapp_numbers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clinic_whatsapp_numbers FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS clinic_whatsapp_numbers_tenant_access ON clinic_whatsapp_numbers;--> statement-breakpoint
CREATE POLICY clinic_whatsapp_numbers_tenant_access ON clinic_whatsapp_numbers FOR ALL
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
ALTER TABLE inbound_messages_raw ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE inbound_messages_raw FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS inbound_messages_raw_tenant_access ON inbound_messages_raw;--> statement-breakpoint
CREATE POLICY inbound_messages_raw_tenant_access ON inbound_messages_raw FOR ALL
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
ALTER TABLE outbound_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE outbound_messages FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS outbound_messages_tenant_access ON outbound_messages;--> statement-breakpoint
CREATE POLICY outbound_messages_tenant_access ON outbound_messages FOR ALL
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
ALTER TABLE provider_status_events_raw ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE provider_status_events_raw FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS provider_status_events_raw_tenant_access ON provider_status_events_raw;--> statement-breakpoint
CREATE POLICY provider_status_events_raw_tenant_access ON provider_status_events_raw FOR ALL
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

-- --- RLS: inbound_messages_orphaned (global protected; super_admin-only) -----
-- Sem clinic_id (tenant não resolvido). Categoria ADR-007 §10 B: leitura/escrita
-- só super_admin; o webhook insere via dbAdmin (service_role, BYPASSRLS).
ALTER TABLE inbound_messages_orphaned ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE inbound_messages_orphaned FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS inbound_messages_orphaned_super_admin_only ON inbound_messages_orphaned;--> statement-breakpoint
CREATE POLICY inbound_messages_orphaned_super_admin_only ON inbound_messages_orphaned FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());--> statement-breakpoint

-- --- GRANTS (REVOKE ALL herdado do Supabase, depois GRANT mínimo) -----------
-- clinic_whatsapp_numbers: authenticated lê TUDO menos token_encrypted (2ª#9);
-- escrita e token = service_role-only (sender via number-store; connect via superAdminAction).
REVOKE ALL ON clinic_whatsapp_numbers FROM authenticated;--> statement-breakpoint
REVOKE ALL ON clinic_whatsapp_numbers FROM anon;--> statement-breakpoint
GRANT SELECT ("id","clinic_id","provider","phone_number","meta_phone_id","meta_business_id","token_version","verified_at","active","created_at","updated_at") ON clinic_whatsapp_numbers TO authenticated;--> statement-breakpoint
GRANT ALL ON clinic_whatsapp_numbers TO service_role;--> statement-breakpoint

-- inbound_messages_raw: append-only pelo app (SELECT + INSERT). UPDATE/DELETE revogados.
REVOKE ALL ON inbound_messages_raw FROM authenticated;--> statement-breakpoint
REVOKE ALL ON inbound_messages_raw FROM anon;--> statement-breakpoint
GRANT SELECT, INSERT ON inbound_messages_raw TO authenticated;--> statement-breakpoint
GRANT ALL ON inbound_messages_raw TO service_role;--> statement-breakpoint

-- outbound_messages: reserve(pending) -> finalize(update). DELETE revogado.
REVOKE ALL ON outbound_messages FROM authenticated;--> statement-breakpoint
REVOKE ALL ON outbound_messages FROM anon;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON outbound_messages TO authenticated;--> statement-breakpoint
GRANT ALL ON outbound_messages TO service_role;--> statement-breakpoint

-- provider_status_events_raw: append-only (SELECT + INSERT).
REVOKE ALL ON provider_status_events_raw FROM authenticated;--> statement-breakpoint
REVOKE ALL ON provider_status_events_raw FROM anon;--> statement-breakpoint
GRANT SELECT, INSERT ON provider_status_events_raw TO authenticated;--> statement-breakpoint
GRANT ALL ON provider_status_events_raw TO service_role;--> statement-breakpoint

-- inbound_messages_orphaned: sem grant a authenticated/anon (service_role-only).
REVOKE ALL ON inbound_messages_orphaned FROM authenticated;--> statement-breakpoint
REVOKE ALL ON inbound_messages_orphaned FROM anon;--> statement-breakpoint
GRANT ALL ON inbound_messages_orphaned TO service_role;--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('c10-messaging-core')
ON CONFLICT (version) DO NOTHING;
