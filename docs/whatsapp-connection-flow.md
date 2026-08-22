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
