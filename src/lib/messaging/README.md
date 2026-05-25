# lib/messaging

Providers de mensagens (WhatsApp via Meta Cloud API, fallback ZAPI). Abstração legítima desde dia 1 (PlanoAção 1.4 — 2 implementações reais).

**Status:** vazio. **Camada:** C10 preenche.

C10 vai criar:
- `provider.ts` com interface `MessagingProvider { sendTemplate, sendText, parseWebhook }`
- `meta-cloud.ts` implementação Meta
- `zapi.ts` implementação fallback
- `webhook-validator.ts` validação de assinatura
- Sem lógica de IA aqui (vive em `src/contexts/ai-agent/`)
