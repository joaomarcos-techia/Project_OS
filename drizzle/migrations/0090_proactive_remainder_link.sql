-- 0090 — entrega automática do link do restante (D35 / 1.6c).
--
-- Reusa a fila C14. O valor é aditivo e não altera os jobs existentes. Como na
-- 0087, PostgreSQL >= 12 permite ADD VALUE em transação desde que o valor não
-- seja usado na mesma transação; esta migration apenas registra o enum.
--
-- Rollback seguro: reverter o código produtor/cron e deixar o valor inerte. A
-- remoção exigiria recriar o enum e não é oferecida como down destrutivo.

ALTER TYPE "public"."proactive_job_type" ADD VALUE IF NOT EXISTS 'remainder_link';
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0090-proactive-remainder-link')
ON CONFLICT (version) DO NOTHING;
