-- 0087 — tipo de job proativo para o link do sinal (ADR-049 1.6a).
--
-- O envio do link do sinal entra na fila C14 (`ai_proactive_jobs`) em vez de
-- abrir um caminho paralelo: lease, backoff, janela 8-20h, supressao,
-- consentimento, dedup e at-most-once no Meta ja estao resolvidos la. Um segundo
-- caminho de envio significaria reimplementar tudo isso pior, e num caminho que
-- manda LINK DE PAGAMENTO para paciente.
--
-- Compatibilidade transacional (mesmo raciocinio da 0014): em PostgreSQL >= 12,
-- `ALTER TYPE ... ADD VALUE` PODE rodar dentro de transacao DESDE QUE o novo
-- valor NAO seja usado na MESMA transacao. Aqui `deposit_link` so e usado em
-- runtime, nunca nesta migration. O Supabase e PG15.
--
-- `IF NOT EXISTS` torna a reexecucao idempotente, alem da deduplicacao por
-- __drizzle_migrations.
--
-- Rollback: reverter o CODIGO (nada enfileira `deposit_link`); o valor fica
-- inerte no enum. Remove-lo exigiria recriar o tipo — janela de manutencao.

ALTER TYPE "public"."proactive_job_type" ADD VALUE IF NOT EXISTS 'deposit_link';
--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0087-proactive-deposit-link')
ON CONFLICT (version) DO NOTHING;
