# lib/messaging

Transporte WhatsApp **puro** (Meta Cloud API, fallback ZApi). Sem DB de domínio, sem IA, sem
import de bounded context. Abstração legítima desde dia 1 (PlanoAção 1.4 — 2 implementações reais).

**Status:** preenchido em C10.

## Conteúdo

- `provider.ts` — interface **CONGELADA** `MessagingProvider { sendText, sendTemplate, parseWebhook, validateSignature }` (4 métodos, ADR-020) + tipos de wire.
- `meta-cloud.ts` — `MetaCloudProvider` (Graph API v18+, `AbortController` 10s, erros tipados `ProviderSendError`/`ProviderUnreachableError`).
- `zapi.ts` — `ZApiProvider` esqueleto (lança `ProviderNotImplementedError`).
- `index.ts` — `getMessagingProvider('meta'|'zapi')` (switch de 2 impls, **não** um Factory).
- `number-store.ts` — **seam privilegiado ÚNICO** (superfície congelada): `resolveClinicByPhoneId`, `loadActiveNumberForSend`, `quarantineOrphan` + `PLATFORM_ORPHAN_SCOPE`. Usa `dbAdmin` + SQL cru (leitura cross-tenant/credencial que o contexto não pode fazer). Qualquer nova operação vai para `src/contexts/messaging/`.

Domínio (tabelas, eventos, persistência, Server Actions) vive em `src/contexts/messaging/`.
Nenhuma lógica de IA aqui (vive em `src/contexts/ai-agent/`, C11+).
