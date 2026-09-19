-- 0095 — 2.4B: recuperação operacional após falta pela fila C14.
--
-- O valor é aditivo e não altera jobs existentes. O producer só passa a usar
-- `no_show_followup` depois que esta migration estiver aplicada.
--
-- Rollback seguro: recuar producer/processor e deixar o valor inerte. Remover um
-- valor de enum exigiria reconstrução destrutiva e não faz parte do down.

ALTER TYPE "public"."proactive_job_type" ADD VALUE IF NOT EXISTS 'no_show_followup';
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0095-proactive-no-show-followup')
ON CONFLICT (version) DO NOTHING;
