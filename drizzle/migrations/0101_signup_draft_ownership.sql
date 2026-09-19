-- ADR-062 O-3b.3: ownership Auth e consumo atômico do draft verificado.
ALTER TABLE "signup_sessions"
  ADD COLUMN "auth_user_id" uuid;--> statement-breakpoint

ALTER TABLE "signup_sessions" DROP CONSTRAINT "signup_sessions_auth_attempt_check";--> statement-breakpoint
ALTER TABLE "signup_sessions" ADD CONSTRAINT "signup_sessions_auth_attempt_check" CHECK (
  num_nonnulls("auth_attempt_kind", "auth_attempt_state", "auth_attempted_at") IN (0, 3)
  AND ("auth_attempt_kind" IS NULL OR (
    "auth_attempt_kind" IN ('initial', 'resend')
    AND "auth_attempt_state" IN ('reserved', 'completed', 'uncertain')
    AND "status" IN ('email_pending', 'email_verified', 'blocked', 'expired')
  ))
);--> statement-breakpoint

ALTER TABLE "signup_sessions" DROP CONSTRAINT "signup_sessions_status_check";--> statement-breakpoint
ALTER TABLE "signup_sessions" ADD CONSTRAINT "signup_sessions_status_check"
  CHECK ("status" IN ('initiated', 'details_complete', 'identity_pending', 'email_pending', 'email_verified', 'expired', 'blocked'));--> statement-breakpoint

ALTER TABLE "signup_sessions"
  ADD CONSTRAINT "signup_sessions_auth_user_id_unique" UNIQUE ("auth_user_id"),
  ADD CONSTRAINT "signup_sessions_email_verified_owner_check" CHECK (
    ("status" = 'email_verified'
      AND "auth_user_id" IS NOT NULL AND "consumed_at" IS NOT NULL
      AND "owner_name" IS NOT NULL AND "clinic_name" IS NOT NULL
      AND "email_hash" IS NOT NULL AND "accepted_at" IS NOT NULL
      AND "answered_at" IS NOT NULL AND "professionals_band" IS NOT NULL
      AND "weekly_appointments_band" IS NOT NULL AND "current_tooling" IS NOT NULL
      AND "discovery_source" IS NOT NULL)
    OR
    ("status" <> 'email_verified' AND "auth_user_id" IS NULL AND "consumed_at" IS NULL)
  );--> statement-breakpoint

-- Sem FK para profiles: o owner ainda é pré-tenant. Grants/RLS não mudam.
INSERT INTO _schema_version (version) VALUES ('signup-draft-ownership')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
