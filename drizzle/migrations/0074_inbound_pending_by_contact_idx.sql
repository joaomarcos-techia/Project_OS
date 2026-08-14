-- =====================================================================
-- 0074_inbound_pending_by_contact_idx.sql
-- Índice de apoio ao COALESCING de mensagens do agente (auditoria 2026-08-14, F-08).
--
-- O paciente escreve pelo WhatsApp como fala: "amanhã" / "de manhã" / "9" em
-- três mensagens seguidas. Cada uma virava um turno independente, processado em
-- paralelo (OUTBOX_PARALLELISM=5), sem ordem garantida — três respostas, contexto
-- pela metade em cada uma. A FASE A da saga passa a absorver os inbounds do mesmo
-- contato que ainda não foram consumidos, tratando a rajada como UMA mensagem.
--
-- A consulta que isso exige é "pendentes deste contato, em ordem de chegada":
--   WHERE clinic_id = ? AND from_number_hash = ? AND processed_at IS NULL
--   ORDER BY received_at
--
-- Índice PARCIAL de propósito: a fila pendente tem alguns registros; o histórico
-- de inbound cresce para sempre. Indexar só `processed_at IS NULL` mantém o
-- índice pequeno e quente, e não pesa na escrita do webhook (a linha sai do
-- índice assim que é consumida).
--
-- Aditivo e não destrutivo: nenhuma coluna, tabela ou policy é alterada.
-- =====================================================================

CREATE INDEX IF NOT EXISTS "inbound_messages_raw_pending_contact_idx"
  ON "inbound_messages_raw" USING btree ("clinic_id", "from_number_hash", "received_at")
  WHERE processed_at IS NULL;--> statement-breakpoint

INSERT INTO _schema_version (version) VALUES ('0074-inbound-pending-by-contact-idx')
ON CONFLICT (version) DO NOTHING;--> statement-breakpoint
