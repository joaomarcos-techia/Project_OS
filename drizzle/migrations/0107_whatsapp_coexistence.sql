-- 0107 - coexistencia do WhatsApp Business app com a Cloud API.
--
-- A clinica pode conectar o numero que ja usa no aplicativo WhatsApp Business
-- (Embedded Signup com `featureType: whatsapp_business_app_onboarding`). O
-- numero continua no celular da recepcao e passa a operar tambem pela Cloud API.
-- Tres coisas passam a existir que nao existiam:
--
-- 1. clinic_whatsapp_numbers.coexistence
--    A conexao nasceu por coexistencia. Nao muda o roteamento (`active` continua
--    sendo a fonte). Muda o que a tela diz ao desconectar: um numero em
--    coexistencia so sai da Cloud API quando a clinica o desconecta tambem no
--    aplicativo, e a Meta nao aceita deregister nele.
--
--    authenticated le clinic_whatsapp_numbers por GRANT DE COLUNA (0022/0033:
--    o token nunca e legivel). Coluna nova sem GRANT seria invisivel para a
--    tela de configuracoes, entao o GRANT vem junto.
--
-- 2. ai_messages.sent_via_business_app
--    A recepcao respondeu o paciente pelo aplicativo do celular (webhook
--    `smb_message_echoes`). A mensagem entra na conversa para o painel mostrar e
--    para o agente ter o contexto quando a conversa voltar para ele. Autoria:
--    `sent_by_user_id` NULL significava "agente" (ADR-047); com esta coluna,
--    agente passa a ser `sent_by_user_id IS NULL AND NOT sent_via_business_app`.
--    Sem ela, a resposta da recepcao apareceria assinada pela IA.
--
--    ai_messages e PARTICIONADA (0024). ADD COLUMN no pai propaga para as
--    particoes; com DEFAULT constante e so metadado, sem reescrever linhas.
--
-- 3. whatsapp_business_app_echoes
--    O raw do eco, do lado de mensageria — o mesmo papel de
--    inbound_messages_raw. Existe porque o evento do outbox precisa carregar so
--    IDs: texto cifrado no payload muda a cada cifragem (IV aleatorio), e o
--    outbox trata mesma chave + hash diferente como colisao. O reenvio normal
--    da Meta viraria 500 em loop. Aqui a dedup e pelo wamid, como no inbound.
--    Retencao de 90 dias, igual ao inbound raw (retention-policy.ts).
--
-- ORDEM: as branches fix/signup-hosted-checkout-input-limits e
-- integration/estado-completo-atual-2026-09-27 trazem 0105 e 0106, com `when`
-- anterior ao desta. O drizzle-kit aplica pelo `when` da ultima migration ja
-- aplicada: num banco onde esta rodar ANTES delas, 0105/0106 seriam puladas.
-- Aplique 0105/0106 primeiro ou reajuste o `when` ao integrar.

ALTER TABLE public.clinic_whatsapp_numbers
  ADD COLUMN IF NOT EXISTS coexistence boolean NOT NULL DEFAULT false;
--> statement-breakpoint
GRANT SELECT ("coexistence") ON public.clinic_whatsapp_numbers TO authenticated;
--> statement-breakpoint
ALTER TABLE public.ai_messages
  ADD COLUMN IF NOT EXISTS sent_via_business_app boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Mensagem da recepcao pelo celular nao tem autor do painel: as duas marcas de
-- autoria humana sao mutuamente exclusivas.
DO $$ BEGIN
  ALTER TABLE public.ai_messages
    ADD CONSTRAINT ai_messages_business_app_author_chk
    CHECK (NOT sent_via_business_app OR (sent_by_user_id IS NULL AND direction = 'out'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS whatsapp_business_app_echoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  provider messaging_provider NOT NULL,
  -- wamid da mensagem enviada pelo app do celular.
  provider_message_id text NOT NULL,
  -- Destinatario (o paciente): hash para achar a conversa, cifrado para
  -- criar uma quando nao houver. Nunca em claro.
  to_number_hash text NOT NULL,
  to_number_encrypted text NOT NULL,
  -- '' quando o eco nao era texto (midia, figurinha...).
  content_encrypted text NOT NULL,
  has_text boolean NOT NULL,
  -- Distingue reenvio (igual) de conflito (mesmo wamid, conteudo outro).
  payload_hash text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_business_app_echoes_provider_msg_uniq
    UNIQUE (provider, provider_message_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS whatsapp_business_app_echoes_clinic_id_idx
  ON public.whatsapp_business_app_echoes (clinic_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS whatsapp_business_app_echoes_created_at_idx
  ON public.whatsapp_business_app_echoes (created_at);
--> statement-breakpoint

ALTER TABLE public.whatsapp_business_app_echoes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.whatsapp_business_app_echoes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY whatsapp_business_app_echoes_read
  ON public.whatsapp_business_app_echoes FOR SELECT
  USING (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR clinic_id::text = (select current_clinic_id())
    OR (select is_super_admin())
  );
--> statement-breakpoint

CREATE POLICY whatsapp_business_app_echoes_write
  ON public.whatsapp_business_app_echoes FOR INSERT
  WITH CHECK (
    clinic_id::text = (select current_setting('app.current_clinic', true))
    OR (select is_super_admin())
  );
--> statement-breakpoint

-- Append-only, como o inbound raw: sem UPDATE nem DELETE para authenticated.
-- O purge de retencao roda como service_role.
REVOKE ALL ON public.whatsapp_business_app_echoes FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.whatsapp_business_app_echoes TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.whatsapp_business_app_echoes TO service_role;
--> statement-breakpoint
INSERT INTO _schema_version (version) VALUES ('0107-whatsapp-coexistence')
ON CONFLICT (version) DO NOTHING;
