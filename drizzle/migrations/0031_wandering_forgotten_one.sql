CREATE TABLE IF NOT EXISTS "clinic_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"email" text,
	"created_by" uuid,
	"plan_snapshot" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"provisioned_clinic_id" uuid,
	"step_state" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinic_invites_token_hash_unique" UNIQUE("token_hash")
);--> statement-breakpoint

-- =====================================================================
-- hand-edit (append) — clinic_invites: GLOBAL PROTECTED (ADR-007 §10 bloco B).
-- Entidade PRÉ-clínica (sem clinic_id de tenant). Ops-only: super_admin lê via
-- dbAdmin no painel; a rota pública /join valida server-side por token_hash via
-- dbAdmin. SEM policy de SELECT a authenticated (igual cron_heartbeats); FORCE RLS
-- bloqueia qualquer role não-BYPASSRLS. Escrita/leitura só service_role.
-- =====================================================================
ALTER TABLE "clinic_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clinic_invites" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON clinic_invites TO service_role;--> statement-breakpoint

-- Índice p/ a lista do admin (order by created_at) e o cron de cleanup
-- (status não-completed + created_at > 30d). O lookup por token usa o unique.
CREATE INDEX IF NOT EXISTS "clinic_invites_status_created_idx"
  ON "clinic_invites" USING btree ("status", "created_at");--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('onboarding-clinic-invites')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
