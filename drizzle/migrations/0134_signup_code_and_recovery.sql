-- Additive preparation only: no historical record, contract or credential is rewritten.
-- Session authority stays short; recovery retention never resurrects anonymous authority.
ALTER TABLE public.signup_sessions
  ADD COLUMN pending_auth_user_id uuid,
  ADD COLUMN recovery_expires_at timestamptz,
  ADD COLUMN verification_flow_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN email_code_state text NOT NULL DEFAULT 'none',
  ADD COLUMN email_code_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN email_code_expires_at timestamptz,
  ADD COLUMN email_code_reserved_at timestamptz,
  ADD COLUMN email_code_verified_at timestamptz,
  ADD COLUMN confirmation_message_id uuid,
  ADD COLUMN confirmation_delivery_status text,
  ADD COLUMN confirmation_delivery_at timestamptz;--> statement-breakpoint

ALTER TABLE public.signup_sessions
  ADD CONSTRAINT signup_sessions_recovery_retention_check CHECK (
    recovery_expires_at IS NULL OR (
      recovery_expires_at > created_at
      AND recovery_expires_at <= created_at + interval '14 days'
      AND accepted_at IS NOT NULL AND email_hash IS NOT NULL
    )
  ),
  ADD CONSTRAINT signup_sessions_verification_flow_check CHECK (verification_flow_version IN (1, 2)),
  ADD CONSTRAINT signup_sessions_email_code_state_check CHECK (
    email_code_state IN ('none', 'issued', 'reserved', 'verified', 'uncertain', 'locked')
  ),
  ADD CONSTRAINT signup_sessions_email_code_attempts_check CHECK (email_code_attempts BETWEEN 0 AND 5),
  ADD CONSTRAINT signup_sessions_confirmation_status_check CHECK (
    confirmation_delivery_status IS NULL OR confirmation_delivery_status IN (
      'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed'
    )
  );--> statement-breakpoint

CREATE INDEX signup_sessions_recovery_expiry_idx ON public.signup_sessions(recovery_expires_at)
  WHERE recovery_expires_at IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX signup_sessions_confirmation_message_idx ON public.signup_sessions(confirmation_message_id)
  WHERE confirmation_message_id IS NOT NULL;--> statement-breakpoint

CREATE TABLE public.signup_email_delivery_events (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 255),
  message_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN (
    'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed'
  )),
  occurred_at timestamptz NOT NULL,
  bounce_type text CHECK (bounce_type IS NULL OR bounce_type IN ('Permanent', 'Transient', 'Undetermined')),
  received_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX signup_email_delivery_message_idx ON public.signup_email_delivery_events(message_id, occurred_at);--> statement-breakpoint
ALTER TABLE public.signup_email_delivery_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.signup_email_delivery_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.signup_email_delivery_events FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signup_email_delivery_events TO service_role;--> statement-breakpoint

CREATE TABLE public.signup_recovery_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  operation_key text NOT NULL UNIQUE CHECK (char_length(operation_key) BETWEEN 1 AND 200),
  auth_user_id uuid NOT NULL,
  email_hash text NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  signup_ref text NOT NULL CHECK (signup_ref ~ '^[0-9a-f]{64}$'),
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'resume_signup')),
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'prepared' CHECK (
    state IN ('prepared', 'sending', 'sent', 'uncertain', 'reserved', 'consumed', 'revoked')
  ),
  password_state text NOT NULL DEFAULT 'none' CHECK (password_state IN ('none', 'reserved', 'uncertain', 'set')),
  consumed_at timestamptz,
  provider_message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signup_recovery_grants_expiry_check CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '24 hours'
  ),
  CONSTRAINT signup_recovery_grants_consumed_check CHECK (
    (state = 'consumed') = (consumed_at IS NOT NULL)
  )
);--> statement-breakpoint
CREATE INDEX signup_recovery_grants_expiry_idx ON public.signup_recovery_grants(expires_at);--> statement-breakpoint
CREATE UNIQUE INDEX signup_recovery_grants_credential_writer_idx ON public.signup_recovery_grants(auth_user_id)
  WHERE password_state IN ('reserved', 'uncertain');--> statement-breakpoint
ALTER TABLE public.signup_recovery_grants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.signup_recovery_grants FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.signup_recovery_grants FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signup_recovery_grants TO service_role;--> statement-breakpoint

INSERT INTO public._schema_version(version) VALUES ('signup-code-and-recovery')
ON CONFLICT(version) DO NOTHING;--> statement-breakpoint
