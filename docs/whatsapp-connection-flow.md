# Conexão do WhatsApp

## Status

Reference — complemento de [integrações](integrations/providers.md).

## Fluxo atual

1. usuário com `manage:settings` abre `/configuracoes/whatsapp`;
2. Embedded Signup Meta retorna autorização para app/WABA/número;
3. servidor valida ids e token no Graph API;
4. `clinic_whatsapp_numbers` guarda número/ids, token cifrado, status e timestamps;
5. app registra subscription/webhook quando necessário;
6. webhook associa `phone_number_id` à clínica;
7. cron `/api/cron/whatsapp-health` verifica conectividade.

O cadastro usa o **Embedded Signup v4**: `META_CONFIG_ID` é uma configuração do Facebook Login for
Business com a variação "Cadastro incorporado do WhatsApp" e o produto WhatsApp Cloud API, e o
`FB.login` vai só com `extras: { setup: {} }`. O v2/v3 é descontinuado pela Meta em 15/10/2026.

## Coexistência (app WhatsApp Business)

A clínica pode conectar o número que já usa no app WhatsApp Business do celular. O número continua
no app e passa a operar também pela Cloud API. Decisões de produto de 30/09/2026.

- **Tela.** Segundo botão, "Conectar meu WhatsApp Business", sem PIN. Abre o cadastro com
  `featureType: 'whatsapp_business_app_onboarding'`; o fim chega como
  `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`, só com `waba_id`. Desfecho de um caminho no botão do
  outro vira `SIGNUP_MODE_MISMATCH`, sem chamada ao servidor.
- **Servidor.** Não chama `/register` (o número já está registrado). Grava
  `clinic_whatsapp_numbers.coexistence = true` e, depois da resposta, pede
  `POST /{phone_number_id}/smb_app_data` com `smb_app_state_sync` e depois `history`. A Meta exige
  os dois em 24h ou desconecta a clínica. Recusa do histórico pela clínica (erro 2593109) não é
  falha. Falha vira `messaging.whatsapp.coexistence_sync_failed`, sem repetição automática: a
  saída é refazer o cadastro dentro do prazo.
- **Histórico e contatos não são guardados.** O webhook conta e descarta `history` e
  `smb_app_state_sync` (`messaging.webhook.coexistence_sync_discarded`); nada vai para quarentena.
- **Resposta da recepção pelo celular** (`smb_message_echoes`) é gravada em
  `whatsapp_business_app_echoes` (raw, 90 dias) e publicada como
  `messaging.business_app_echo.received`. O agente grava a mensagem na conversa com
  `ai_messages.sent_via_business_app` (o painel mostra "Recepção pelo celular") e põe a conversa em
  `handoff` com motivo `business_app_reply`. A IA só volta com "Devolver ao agente",
  que aparece já em "Aguardando responsável", sem precisar assumir antes.
- **`account_update` / `PARTNER_REMOVED`** desativa a conexão da WABA
  (`messaging.whatsapp.partner_removed` na auditoria), seja por desconexão no app, seja por
  inatividade do celular (~14 dias, `PRIMARY_INACTIVITY`).
- **Limites da Meta** para o número em coexistência: 20 mensagens/s; aparelhos vinculados são
  desvinculados; no app somem mensagens temporárias, visualização única, localização em tempo real
  e listas de transmissão; exige o app 2.24.17 ou mais recente.

Pré-requisitos externos (`REQUIRES_MANUAL_VALIDATION`):

1. migration `0107_whatsapp_coexistence` aplicada no banco do ambiente (atenção à ordem em relação a
   `0105`/`0106` — ver o cabeçalho da migration);
2. no App Dashboard → WhatsApp → Configuration, assinar os campos de webhook `history`,
   `smb_app_state_sync`, `smb_message_echoes` e `account_update`, além de `messages`.

## Estados e segurança

- número precisa estar ativo/verificado para envio;
- token nunca cruza para Client Component nem log;
- assinatura HMAC é verificada sobre o body bruto;
- inbound duplicado é deduplicado por identidade do provider;
- número desconhecido é armazenado em `inbound_messages_orphaned`, não atribuído por heurística;
- reconnect é ação explícita. Não existe failover automático para Z-API.

## Diagnóstico

1. separe acesso ao Meta Developer Dashboard de falha no fluxo da aplicação;
2. confirme registro local do número sem expor token;
3. execute health check/probe autorizado;
4. confirme subscription e chegada do webhook pelo request id;
5. inspecione inbound, outbox e outbound agregados;
6. só declare entrega provada após mensagem externa controlada.

Envio real ou mudança de subscription é operação externa; requer autorização.
