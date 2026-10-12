-- 0114 - nome do perfil do contato do WhatsApp.
--
-- A Meta manda, junto de cada mensagem recebida, o nome que o contato usa no
-- perfil do WhatsApp (`value.contacts[].profile.name`). Até aqui ele era
-- descartado: a inbox mostrava só o telefone e, na conversa, "Paciente".
--
-- O nome é dado pessoal. Fica CIFRADO por clínica, como o telefone, e vive o
-- mesmo tempo que a linha que o carrega: 90 dias no bruto do inbound e a
-- política de retenção da conversa. Não entra em payload de outbox.
--
-- 1. inbound_messages_raw.from_name_encrypted
--    O nome como chegou naquela mensagem. NULL quando a Meta não mandou.
--
-- 2. ai_conversations.contact_name_encrypted
--    O nome mais recente do contato, regravado a cada mensagem que o traz.
--    NULL em conversas anteriores a esta migration até a próxima mensagem.
--
-- Colunas anuláveis e sem default: ADD COLUMN só altera metadado, sem
-- reescrever linhas. Os GRANTs de tabela (0022 e 0024) já cobrem as colunas.

ALTER TABLE public.inbound_messages_raw
  ADD COLUMN IF NOT EXISTS from_name_encrypted text;
--> statement-breakpoint
ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS contact_name_encrypted text;
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0114-whatsapp-contact-name')
ON CONFLICT (version) DO NOTHING;
