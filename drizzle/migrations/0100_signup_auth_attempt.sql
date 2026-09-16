-- ADR-062 O-3b.1: tentativa de envio, sem credencial/PII adicional.
ALTER TABLE "signup_sessions"
  ADD COLUMN "auth_attempt_kind" text,
  ADD COLUMN "auth_attempt_state" text,
  ADD COLUMN "auth_attempted_at" timestamptz;--> statement-breakpoint

ALTER TABLE "signup_sessions"
  ADD CONSTRAINT "signup_sessions_auth_attempt_check" CHECK (
    num_nonnulls("auth_attempt_kind", "auth_attempt_state", "auth_attempted_at") IN (0, 3)
    AND ("auth_attempt_kind" IS NULL OR (
      "auth_attempt_kind" IN ('initial', 'resend')
      AND "auth_attempt_state" IN ('reserved', 'completed', 'uncertain')
      AND "status" IN ('email_pending', 'blocked', 'expired')
    ))
  ),
  ADD CONSTRAINT "signup_sessions_email_pending_check" CHECK (
    "status" <> 'email_pending' OR (
      "auth_attempted_at" IS NOT NULL AND "auth_attempt_kind" IS NOT NULL
      AND "auth_attempt_state" IS NOT NULL AND "consumed_at" IS NULL
      AND "owner_name" IS NOT NULL AND "clinic_name" IS NOT NULL
      AND "email_hash" IS NOT NULL AND "accepted_at" IS NOT NULL
      AND "answered_at" IS NOT NULL AND "professionals_band" IS NOT NULL
      AND "weekly_appointments_band" IS NOT NULL AND "current_tooling" IS NOT NULL
      AND "discovery_source" IS NOT NULL
    )
  );--> statement-breakpoint

ALTER TABLE "signup_sessions" DROP CONSTRAINT "signup_sessions_status_check";--> statement-breakpoint
ALTER TABLE "signup_sessions" ADD CONSTRAINT "signup_sessions_status_check"
  CHECK ("status" IN ('initiated', 'details_complete', 'identity_pending', 'email_pending', 'expired', 'blocked'));--> statement-breakpoint

-- RLS/grants da 0096/0097 continuam intactos, sem políticas Auth/anon/runtime.
INSERT INTO _schema_version (version) VALUES ('signup-auth-attempt')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
