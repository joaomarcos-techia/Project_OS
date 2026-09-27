-- ADR-062 O-3a aprovado em 15/09/2026. Execução autorizada só em scratch local.
-- Staging pessoal mínimo; nenhum recurso Auth, tenant ou billing é criado.
ALTER TABLE "signup_sessions"
  ADD COLUMN "owner_name" text,
  ADD COLUMN "clinic_name" text,
  ADD COLUMN "email_hash" text,
  ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "signup_sessions"
  ADD CONSTRAINT "signup_sessions_identity_all_or_none_check" CHECK (
    num_nonnulls("owner_name", "clinic_name", "email_hash", "accepted_at") IN (0, 4)
  ),
  ADD CONSTRAINT "signup_sessions_identity_values_check" CHECK (
    ("owner_name" IS NULL OR (char_length("owner_name") BETWEEN 1 AND 120
      AND "owner_name" = btrim("owner_name") AND "owner_name" !~ '[[:cntrl:]]'))
    AND ("clinic_name" IS NULL OR (char_length("clinic_name") BETWEEN 1 AND 120
      AND "clinic_name" = btrim("clinic_name") AND "clinic_name" !~ '[[:cntrl:]]'))
    AND ("email_hash" IS NULL OR "email_hash" ~ '^[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT "signup_sessions_identity_pending_check" CHECK (
    "status" <> 'identity_pending' OR (
      "owner_name" IS NOT NULL AND "clinic_name" IS NOT NULL AND "email_hash" IS NOT NULL
      AND "accepted_at" IS NOT NULL AND "answered_at" IS NOT NULL
      AND "professionals_band" IS NOT NULL AND "weekly_appointments_band" IS NOT NULL
      AND "current_tooling" IS NOT NULL AND "discovery_source" IS NOT NULL
      AND "consumed_at" IS NULL
    )
  );--> statement-breakpoint

ALTER TABLE "signup_sessions" DROP CONSTRAINT "signup_sessions_status_check";--> statement-breakpoint
ALTER TABLE "signup_sessions" ADD CONSTRAINT "signup_sessions_status_check"
  CHECK ("status" IN ('initiated', 'details_complete', 'identity_pending', 'expired', 'blocked'));--> statement-breakpoint

-- Grants/RLS permanecem os da 0096/0097: só service_role DML, sem políticas.
INSERT INTO _schema_version (version) VALUES ('signup-session-identity')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
