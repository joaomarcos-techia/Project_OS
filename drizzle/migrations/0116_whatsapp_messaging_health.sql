-- 0116 - saude de envio da conta WhatsApp (health_status da Meta).
--
-- Em 08/10/2026 a WABA de teste do DEV estava sem forma de pagamento: a Cloud
-- API aceitava cada template e a Meta o recusava depois, no callback, com
-- 131042. As respostas dentro da janela de 24 h continuavam chegando, entao a
-- clinica via a IA funcionando enquanto nenhum lembrete, link de sinal,
-- cobranca ou oferta de vaga chegava ao paciente. O motivo so aparecia no
-- `health_status` da Meta: `can_send_message` BLOCKED, erro 141006.
--
-- A ultima leitura passa a ficar na conexao, para a tela de WhatsApp e o painel
-- avisarem antes da recusa:
--
-- 1. messaging_health
--    `can_send_message` para mensagens iniciadas pela clinica, ja sem o ruido
--    das chamadas (SIP), em minusculas: available, limited ou blocked. NULL ate
--    a primeira leitura bem-sucedida.
--
-- 2. messaging_health_codes
--    Os codigos da Meta que explicam o estado (ex.: 141006, 141010), sem os de
--    chamada. Codigo publico da Meta; nenhum id de WABA, numero ou token.
--
-- 3. messaging_health_checked_at
--    Quando a Meta respondeu pela ultima vez. Leitura que falha nao apaga a
--    anterior, e esta coluna nao anda.
--
-- Escrita so pelo seam privilegiado (lib/messaging/connection-store), como o
-- resto da linha. authenticated le clinic_whatsapp_numbers por GRANT DE COLUNA
-- (0022/0033/0107: o token nunca e legivel), entao as colunas novas precisam do
-- proprio GRANT para a tela e o painel. Sem UPDATE: so SELECT.
--
-- ADD COLUMN anulavel ou com DEFAULT constante so altera metadado, sem
-- reescrever linhas.

ALTER TABLE public.clinic_whatsapp_numbers
  ADD COLUMN IF NOT EXISTS messaging_health text;
--> statement-breakpoint
ALTER TABLE public.clinic_whatsapp_numbers
  ADD COLUMN IF NOT EXISTS messaging_health_codes integer[] NOT NULL DEFAULT '{}'::integer[];
--> statement-breakpoint
ALTER TABLE public.clinic_whatsapp_numbers
  ADD COLUMN IF NOT EXISTS messaging_health_checked_at timestamptz;
--> statement-breakpoint
-- Estado e data andam juntos: ou nunca houve leitura, ou houve e ela tem hora.
DO $$ BEGIN
  ALTER TABLE public.clinic_whatsapp_numbers
    ADD CONSTRAINT clinic_whatsapp_numbers_messaging_health_chk
    CHECK (
      (messaging_health IS NULL AND messaging_health_checked_at IS NULL)
      OR (
        messaging_health IN ('available', 'limited', 'blocked')
        AND messaging_health_checked_at IS NOT NULL
      )
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
GRANT SELECT ("messaging_health", "messaging_health_codes", "messaging_health_checked_at")
  ON public.clinic_whatsapp_numbers TO authenticated;
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0116-whatsapp-messaging-health')
ON CONFLICT (version) DO NOTHING;
