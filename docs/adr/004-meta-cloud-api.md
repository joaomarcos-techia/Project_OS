# ADR-004 — Meta Cloud API (WhatsApp) com fallback ZAPI

**Status:** accepted
**Date:** 2026-05-25

## Context

O agente de IA do ClinicaOS atende pacientes via WhatsApp. Existem dois caminhos viáveis para integrar com WhatsApp em produção:

1. **Meta Cloud API** (oficial Meta) — gratuito até X conversas/mês, alto rate limit, suporte direto, exige aprovação de templates.
2. **APIs não-oficiais (ZAPI, Z-API, Evolution API)** — encapsulam WhatsApp Web/Business app, sem aprovação de templates, mas sujeitas a banimento a qualquer momento.

O MVP precisa de algo confiável (saúde, comunicação com paciente). Mas também precisa de plano B se a Meta suspender a conta ou se um cliente novo ainda não tiver template aprovado.

## Decision

**Meta Cloud API é o provider primário.** ZAPI fica plugada como fallback operacional (não comercial — usada quando Meta indisponível ou em onboarding de cliente novo aguardando aprovação de template).

Abstração `MessagingProvider` em `src/lib/messaging/provider.ts` desde dia 1 (C10). Esta é uma das poucas exceções legítimas a PlanoAção 1.4 (espere 2 casos de uso antes de abstrair) — temos 2 implementações reais previstas.

```typescript
interface MessagingProvider {
  sendTemplate(args: SendTemplateArgs): Promise<MessageRef>;
  sendText(args: SendTextArgs): Promise<MessageRef>;
  parseWebhook(req: Request): Promise<ParsedWebhookEvent>;
}
```

Configuração por clínica (em C10):
- `clinic.messaging_provider = 'meta' | 'zapi'` no banco
- Credenciais separadas por clínica (Meta Cloud é multi-tenant nativo, ZAPI é por instância)

## Consequences

- Toda lógica de IA conversa com `MessagingProvider`, nunca com SDK Meta direto. Troca de provider = mudar 1 linha de config.
- Onboarding novo cliente: até template ser aprovado pela Meta, opera em ZAPI (com banner avisando "modo limitado").
- Custo: webhook handler unifica formato (parseWebhook normaliza payload). Cada provider implementa seu próprio adapter.
- Risco: divergência entre features (Meta tem reações, ZAPI não — etc). Aceita-se: feature core (texto, template, mídia) funciona em ambos; features avançadas só Meta, gated por config.
- Risco operacional: ZAPI baniu? troca de provider via dashboard super_admin (não exige deploy).

## Alternatives

- **Só Meta Cloud API:** rejeitada — onboarding bloqueado por aprovação de template (~2-5 dias úteis); experiência ruim para teste rápido.
- **Só ZAPI:** rejeitada — risco de banimento em massa de contas Business. Não é compliance-friendly.
- **Twilio WhatsApp / Vonage:** rejeitada — custo ~3x maior que Meta direto, sem benefício relevante.
- **Construir adapter genérico para 5 providers:** rejeitada — premature; 2 é o suficiente até validarmos.

## References

- `Documentação/PlanoAção.md` seções 1.4 (exceções legítimas a abstração), C10 (MessagingProvider)
- ADR-001 (Bounded Contexts) — ai-agent não conhece provider, só interface
- Meta Cloud API docs: https://developers.facebook.com/docs/whatsapp/cloud-api
