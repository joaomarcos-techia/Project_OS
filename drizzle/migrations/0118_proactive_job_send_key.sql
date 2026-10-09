-- 0118 - chave de envio por geração na fila C14 (ADR-064).
--
-- A C14 enviava com `idempotencyKey = job.id`. A chave estável garantia no
-- máximo um envio por job e, por isso mesmo, nenhum reenvio: toda nova
-- tentativa caía no dedup do sender e reencontrava o envio que já tinha falhado.
--
-- `send_key` é a chave da geração ATUAL do envio. NULL = geração 0, cuja chave
-- é o próprio `id`: nenhum job existente muda, nem o primeiro envio de um job
-- novo. A chave só troca depois que a Meta recusou a atual com um código
-- retentável, no mesmo UPDATE que devolve o job a `pending`.
--
-- O índice único parcial deixa o handler do EC-32 achar o job pela chave do
-- envio recusado, e só pela chave ATUAL: o callback de uma geração já
-- substituída não acha nada e não provoca outro reenvio.
--
-- Coluna anulável e sem default: o ADD COLUMN só altera metadado. A tabela é
-- pequena e o índice segue o padrão da 0068, sem CONCURRENTLY, porque o
-- migrator roda numa transação. Os GRANTs de tabela já cobrem a coluna.

ALTER TABLE public.ai_proactive_jobs
  ADD COLUMN IF NOT EXISTS send_key uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ai_proactive_jobs_clinic_send_key_uniq
  ON public.ai_proactive_jobs (clinic_id, send_key)
  WHERE send_key IS NOT NULL;
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0118-proactive-job-send-key')
ON CONFLICT (version) DO NOTHING;
