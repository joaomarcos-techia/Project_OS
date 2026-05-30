-- =====================================================================
-- 0010_c4_hardening.sql
-- C4 — Hardening pós-revisão hostil (CRITICAL-01, CRITICAL-02, HIGH-07,
-- HIGH-11, HIGH-16, MEDIUM-23). Adiciona:
--   - payload_hash em outbox (detecção de collision em publishEvent)
--   - CHECK constraints de tamanho (outbox.payload, audit_events.before/after,
--     super_admin_actions.payload) — defesa em profundidade contra DOS/storage
--   - CHECK constraints temporais em outbox (coerência first/last_failed_at)
--   - GRANTs explícitos em tabelas C4 (não depender de default schema GRANT
--     do Supabase — necessário para migração para outras instâncias)
--   - Trigger preventivo contra DELETE de idempotency_keys in-flight
--     (defesa em profundidade contra CRITICAL-02)
-- =====================================================================

-- 1. payload_hash em outbox (HIGH-16) -------------------------------
-- Detecta collision: mesmas (event_type, idempotency_key) mas payloads diferentes
-- são bug do caller, não retry legítimo. Sem hash explícito, publishEvent perdia
-- a 2ª publicação silenciosamente.
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS payload_hash text;--> statement-breakpoint
-- NÃO marcamos NOT NULL imediatamente: rows pré-existentes não têm hash.
-- Migration vai preenchê-las via UPDATE; depois adiciona NOT NULL.
-- Para ambientes pós-migration, publishEvent SEMPRE preenche payload_hash.
UPDATE outbox SET payload_hash = encode(sha256(payload::text::bytea), 'hex')
 WHERE payload_hash IS NULL;--> statement-breakpoint
ALTER TABLE outbox ALTER COLUMN payload_hash SET NOT NULL;--> statement-breakpoint
-- Format check: sha256 hex = 64 chars de 0-9a-f.
ALTER TABLE outbox
  ADD CONSTRAINT outbox_payload_hash_format_chk
  CHECK (payload_hash ~ '^[a-f0-9]{64}$');--> statement-breakpoint

-- 2. Size caps (HIGH-07) -------------------------------------------
-- 64KB = limite acordado (idempotency_keys.response também tem 96KB com
-- folga TOAST). Acima disso o caller deve refatorar o evento — não há
-- payload de negócio legítimo > 64KB em healthtech multi-tenant.
ALTER TABLE outbox
  ADD CONSTRAINT outbox_payload_size_chk
  CHECK (pg_column_size(payload) <= 65536);--> statement-breakpoint

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_before_size_chk
  CHECK ("before" IS NULL OR pg_column_size("before") <= 65536);--> statement-breakpoint
ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_after_size_chk
  CHECK ("after" IS NULL OR pg_column_size("after") <= 65536);--> statement-breakpoint

ALTER TABLE super_admin_actions
  ADD CONSTRAINT super_admin_actions_payload_size_chk
  CHECK (payload IS NULL OR pg_column_size(payload) <= 65536);--> statement-breakpoint

-- 3. Temporal coherence (MEDIUM-23) -------------------------------
-- Worker bugado/manual replay/janitor bug não pode produzir invariantes
-- temporais quebradas. Defense in depth.
ALTER TABLE outbox
  ADD CONSTRAINT outbox_temporal_chk
  CHECK (
    (processing_started_at IS NULL OR processing_started_at >= created_at) AND
    (processed_at IS NULL OR processed_at >= created_at) AND
    (first_failed_at IS NULL OR first_failed_at >= created_at) AND
    (last_failed_at IS NULL OR last_failed_at >= created_at) AND
    (first_failed_at IS NULL OR last_failed_at IS NULL OR last_failed_at >= first_failed_at)
  );--> statement-breakpoint

-- 4. GRANTs explícitos (HIGH-11) -----------------------------------
-- ADR-007 §10 prescreve "explicit GRANT" em vez de depender de default schema
-- GRANT do Supabase. Necessário para qoro-prod, self-host, ou migration entre
-- Supabase projects. Pattern: SELECT/INSERT a 'authenticated' (RLS filtra),
-- ALL a 'service_role' (bypass para worker/dbAdmin paths).
GRANT SELECT, INSERT ON outbox TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON outbox TO service_role;--> statement-breakpoint

GRANT SELECT, INSERT ON audit_events TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_events TO service_role;--> statement-breakpoint
-- Children partitions herdam GRANTs do parent em PG 11+.

GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO service_role;--> statement-breakpoint

-- super_admin_actions: RLS já filtra para is_super_admin(); GRANT a authenticated
-- é safe porque policy bloqueia non-super_admin.
GRANT SELECT, INSERT ON super_admin_actions TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON super_admin_actions TO service_role;--> statement-breakpoint

-- 5. Trigger preventivo: in-flight idempotency_keys não podem ser deletadas
-- (CRITICAL-02) ----------------------------------------------------
-- Defense in depth: operador rodando `DELETE FROM idempotency_keys WHERE expires_at < now()`
-- não pode acidentalmente deletar rows in-flight (response IS NULL). Trigger
-- raises exception se tentar.
CREATE OR REPLACE FUNCTION prevent_delete_in_flight_idempotency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.response IS NULL AND OLD.created_at > now() - interval '1 hour' THEN
    RAISE EXCEPTION 'Cannot DELETE in-flight idempotency_keys row (key=%, created_at=%). Wait for completion or use diagnostic path.', OLD.key, OLD.created_at
      USING ERRCODE = '23514', HINT = 'See runbook §cleanup-in-flight';
  END IF;
  RETURN OLD;
END $$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION prevent_delete_in_flight_idempotency() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION prevent_delete_in_flight_idempotency() TO authenticated, service_role;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_prevent_delete_in_flight_idempotency ON idempotency_keys;--> statement-breakpoint
CREATE TRIGGER trg_prevent_delete_in_flight_idempotency
  BEFORE DELETE ON idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION prevent_delete_in_flight_idempotency();--> statement-breakpoint

-- 6. Schema version snapshot ----------------------------------------
INSERT INTO _schema_version (version) VALUES ('c4-hardening')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
