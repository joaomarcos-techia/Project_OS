-- 0117 - tipo da mensagem recebida do WhatsApp.
--
-- Decisão de 08/10/2026. Até aqui só o texto era guardado: áudio, imagem e
-- documento chegavam sem texto e o agente não respondia nada. Agora o agente
-- responde ao áudio pedindo a mensagem escrita e passa arquivo para a equipe, e
-- para isso precisa do `type` que a Meta manda (`text`, `audio`, `image`,
-- `document`, `video`, `sticker`...).
--
-- A coluna também fecha o coalescing: o agente junta numa resposta só as
-- mensagens de TEXTO que chegam em sequência. Sem o tipo, um áudio enviado logo
-- depois de um texto era absorvido por ele e ficava sem resposta.
--
-- Não é dado pessoal (é o tipo, não o conteúdo). Anulável e sem default: ADD
-- COLUMN só altera metadado, e linhas anteriores ficam NULL, tratadas como antes.
-- Os GRANTs de tabela (0022 e 0024) já cobrem a coluna.

ALTER TABLE public.inbound_messages_raw
  ADD COLUMN IF NOT EXISTS message_type text;
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0117-inbound-message-type')
ON CONFLICT (version) DO NOTHING;
