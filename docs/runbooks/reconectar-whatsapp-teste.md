# Runbook — Reconectar número de teste do WhatsApp

> Status: manual pendente. Este procedimento reconecta apenas o número de teste que foi removido na limpeza de dados de produção. Não execute com número, WABA ou token de produção.

## Meta Cloud API — reconexão de teste

### Objetivo

Restabelecer o número de teste na clínica de desenvolvimento e comprovar o caminho completo: Meta → webhook → outbox → IA → envio → status de entrega.

### Pré-requisitos

- Acesso de administrador à conta Meta de testes e papel de desenvolvedor no app Meta correto.
- Um usuário `owner` da clínica de desenvolvimento, com permissão recente para gerenciar configurações.
- Número de teste, WABA e PIN de registro de seis dígitos exclusivos do ambiente de desenvolvimento.
- URL pública HTTPS do ambiente de desenvolvimento disponível para `POST /api/webhooks/meta`; `localhost` não serve para o callback da Meta.
- Variáveis de ambiente de desenvolvimento já configuradas, sem usar ou copiar segredo de produção: `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_ID`, `META_CONFIG_ID` e credenciais de IA necessárias ao teste.
- Embedded Signup e permissões `whatsapp_business_management` e `whatsapp_business_messaging` aprovados/configurados para o app de teste.

### Passos

1. Confirme no Meta Developers que o callback aponta para `https://<host-dev>/api/webhooks/meta`, com o verify token de desenvolvimento, e assine o campo `messages`.
2. Entre no ClinicaOS dev como owner da clínica-alvo e abra `/configuracoes/whatsapp`.
3. Inicie a conexão pelo Embedded Signup. Escolha somente a WABA e o número de teste.
4. Informe o PIN de registro de seis dígitos quando solicitado. Nunca cole access token em formulário, terminal, chat, ticket ou log.
5. Conclua o popup Meta e confirme na tela que o número aparece mascarado e com status `connected`.
6. No WhatsApp de teste, envie uma mensagem inbound simples para o número conectado.
7. Aguarde o worker do outbox processar a resposta. Se for necessário dispará-lo manualmente em dev, use o procedimento operacional aprovado para o worker; não altere a mensagem no banco.
8. Verifique no painel Meta o status de entrega da resposta e, no ClinicaOS, confirme que não houve duplicação ao reenviar o mesmo webhook.
9. Repita uma vez com uma mensagem fora da janela de 24 h para confirmar o uso de template aprovado, e uma vez com handoff humano se esse fluxo estiver habilitado na clínica.

### Resultado esperado

- Existe exatamente um `clinic_whatsapp_numbers` ativo para a clínica e nenhum token fica legível por `authenticated`.
- O webhook é validado, o inbound é persistido e apenas um evento de outbox é criado por mensagem da Meta.
- O worker executa a IA, persiste o contexto, envia uma única resposta e registra o status de entrega.
- Falhas de Meta/IA aparecem como erro classificável, com retry/backoff quando aplicável, sem expor token, conteúdo sensível ou dados de outro tenant.

### Rollback

1. Na mesma tela, desconecte o número da clínica de desenvolvimento.
2. Confirme que o registro anterior ficou inativo, preservando histórico, e que nenhum número de produção foi tocado.
3. Remova o callback/subscription da WABA de teste somente se o número não for mais usado; se a Meta estiver indisponível, a desconexão local permanece válida e a limpeza remota deve ser repetida depois.

### Logs que devem ser observados

- `messaging.whatsapp.connection_failed` apenas em caso de erro, com `stage` e sem token.
- Requisições de `POST /api/webhooks/meta`, criação/execução do outbox, correlação da conversa IA e status de entrega Meta.
- Eventos de idempotência para reentrega do mesmo webhook; não pode haver dois envios outbound para o mesmo identificador Meta.

### Métricas esperadas

- Contador de inbound recebido, outbox criado/processado e outbound entregue incrementados uma vez por mensagem de teste.
- Sem aumento persistente de retries, dead letters, erros de autenticação Meta ou circuit breaker aberto.
- Latência ponta a ponta dentro do SLO configurado para o worker; investigar qualquer timeout antes de habilitar o número para uso real.

## Alternativa operacional DEV (somente se o Embedded Signup estiver indisponível)

Use `scripts/whatsapp-connect.ts` apenas em desenvolvimento e somente com credenciais do número de teste. Ele cifra o token antes de persistir e substitui a conexão ativa da clínica. Não inclua o token no histórico do shell, logs ou captura de tela. Em produção, a conexão deve ocorrer pelo fluxo autenticado de super-admin/owner, nunca por esse script.
