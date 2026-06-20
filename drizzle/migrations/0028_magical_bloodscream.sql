-- =====================================================================
-- 0028_magical_bloodscream.sql
-- C15 — Platform Admin: impersonate sessions (fonte autoritativa) +
--       GRANT INSERT em super_admin_actions p/ a auditoria extra atômica.
-- Refs: ADR-007 (RLS), ADR-011 (super_admin_actions append-only), plano C15 §2.
--
-- Categorias (ADR-007 §10):
--   - global protected : impersonation_sessions (is_super_admin() SELECT; escrita
--     via dbAdmin/service_role; sem clinic_id como tenant — clinic_id é alvo).
--
-- Contratos (plano C15):
--   - TTL 1h (expires_at), kill switch (revoked_at), 1 ativa por super_admin.
--   - Cookie carrega só o id assinado; ESTA tabela manda (OR-I6).
--   - Auditoria extra do impersonate entra em super_admin_actions na MESMA tx
--     do withTenant (role authenticated) — precisa de GRANT INSERT explícito;
--     a policy super_admin_actions_super_insert (0008) já gateia por is_super_admin().
-- =====================================================================

-- 1. CREATE TABLE impersonation_sessions (gerado por drizzle-kit) -----
CREATE TABLE IF NOT EXISTS "impersonation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"super_admin_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint

-- 2. FK clinic_id -> clinics (cascade; super_admin_id segue pattern *_by sem FK).
ALTER TABLE "impersonation_sessions"
  ADD CONSTRAINT "impersonation_sessions_clinic_id_clinics_id_fk"
  FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade;--> statement-breakpoint

-- 3. ALTER ip_address text -> inet (mesmo pattern de super_admin_actions / login_attempts).
ALTER TABLE "impersonation_sessions"
  ALTER COLUMN "ip_address" TYPE inet
  USING NULLIF("ip_address", '')::inet;--> statement-breakpoint

-- 4. INDEXES (gerados por drizzle-kit) -------------------------------
CREATE INDEX IF NOT EXISTS "impersonation_sessions_super_admin_idx"
  ON "impersonation_sessions" USING btree ("super_admin_id")
  WHERE "impersonation_sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "impersonation_sessions_clinic_idx"
  ON "impersonation_sessions" USING btree ("clinic_id");--> statement-breakpoint

-- 5. GRANTs (pattern 0010/0012: explícito, não depender de default) ---
-- Só service_role: toda leitura/escrita é via dbAdmin. authenticated nunca toca.
GRANT SELECT, INSERT, UPDATE ON impersonation_sessions TO service_role;--> statement-breakpoint

-- 6. RLS impersonation_sessions --------------------------------------
-- Sem clinic_id próprio (exceção super_admin, D27/D29). SELECT só is_super_admin();
-- escrita via dbAdmin (BYPASSRLS). Sem INSERT/UPDATE/DELETE policy → FORCE bloqueia
-- qualquer role não-BYPASSRLS (defense in depth).
ALTER TABLE "impersonation_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "impersonation_sessions_super_select" ON "impersonation_sessions" FOR SELECT
  USING (is_super_admin());--> statement-breakpoint

-- 7. super_admin_actions: GRANT INSERT p/ authenticated (auditoria extra) ----
-- A linha extra de impersonate_mutation é inserida na MESMA tx do withTenant
-- (role authenticated). A policy super_admin_actions_super_insert (0008) já
-- gateia por is_super_admin() (durante impersonate o JWT segue super_admin);
-- faltava o privilégio de TABELA. SELECT permanece via dbAdmin (sem GRANT
-- SELECT a authenticated). Append-only mantido (sem UPDATE/DELETE).
GRANT INSERT ON super_admin_actions TO authenticated;--> statement-breakpoint

-- 8. SCHEMA VERSION SNAPSHOT -----------------------------------------
INSERT INTO _schema_version (version) VALUES ('c15-platform-admin')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
