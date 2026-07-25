# ADR-020 — Messaging Provider Patterns (C10)

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

**Status:** accepted
**Date:** 2026-06-07

## Context

C10 constrói a fundação de mensagens WhatsApp — receber webhooks da Meta com segurança, persistir
inbound/outbound criptografados, deduplicar, identificar o tenant pelo número e publicar o evento
de inbound no Outbox. **Sem IA, sem mídia, sem retry engine/cron novo.** A IA conversacional (C11+)
reage a `messaging.inbound.received`.

Esta ADR congela os contratos da camada após 4 rodadas de revisão arquitetural.

## Decision

### Bounded context + transporte

- **Messaging é um bounded context** (`src/contexts/messaging/`): schema, eventos, persistência,
  Server Actions. Toca apenas Identity, Patient (API pública — `suppressionList`), Outbox, Audit.
- **Transporte puro** em `src/lib/messaging/`: providers (HTTP Meta, parse, assinatura) sem DB e sem
  import de contexto.

### Interface CONGELADA (4 métodos)

```typescript
interface MessagingProvider {
  sendText(args): Promise<MessageRef>;
  sendTemplate(args): Promise<MessageRef>;
  parseWebhook(rawBody: string): ParsedWebhookEvent;       // opera no raw já lido (HMAC)
  validateSignature(rawBody, signatureHeader, appSecret): boolean;
}
```

Supera o esboço de 3 métodos do ADR-004 e absorve o `webhook-validator.ts` previsto no README
(validação de assinatura é método do provider — cada provider assina diferente). **Nenhum método
adicional.** Meta e ZApi implementam DIRETO (sem BaseProvider/AbstractProvider). Seleção =
`getMessagingProvider('meta'|'zapi')` (switch de 2 impls — NÃO um Factory). ZApi é esqueleto.

### Tabelas (5) + dedup

| Tabela | Escopo | Dedup |
|---|---|---|
| `clinic_whatsapp_numbers` | tenant | partial UNIQUE `(clinic_id)`/`(phone_number)`/`(meta_phone_id)` `WHERE active=true` |
| `inbound_messages_raw` | tenant | `UNIQUE(provider, provider_message_id)` + `payload_hash` canônico p/ duplicate vs conflict |
| `outbound_messages` | tenant | `UNIQUE(clinic_id, idempotency_key)` |
| `provider_status_events_raw` | tenant | `UNIQUE(provider, payload_hash)` |
| `inbound_messages_orphaned` | **global** (super_admin-only) | `UNIQUE(provider, payload_hash)` |

- `clinic_whatsapp_numbers` = **estado atual, NÃO histórico**. Histórico de rotação vive em
  `super_admin_actions`. Partial unique `WHERE active=true` permite reconexão após `active=false`.
- Chaves de dedup são **NOT NULL** (`provider_message_id` no inbound; `idempotency_key` no outbound;
  `payload_hash` nos raw). NULL derrota unique no Postgres (NULL != NULL) → dedup silenciosamente
  quebrado. `idempotency_key` validado `z.string().uuid()` na borda.
- `payload_hash` é **canônico** via `@/lib/idempotency/hash` (safe-stable-stringify + sha256 + NFC),
  não byte-for-byte — dedup semântico. Fallback sha256(raw) só para corpo não-parseável.

### Encryption

- Conteúdo inbound/outbound + token usam `encryptForTenant` (reuso C5; `info='patient-data-encryption'`
  é separação de domínio cosmética). `*_hash` via `hashForLookup` (HMAC).
- **Platform Encryption Scope** (`PLATFORM_ORPHAN_SCOPE = '__orphan__'`, exportado de
  `@/lib/messaging/number-store`): pseudo-tenant para cifrar payloads órfãos quando NÃO há clínica
  resolvida. **Quem alterar `encryptForTenant` assumindo `tenantId` = UUID DEVE preservar este
  contrato** (a derivação HKDF aceita qualquer string como salt; órfãos dependem disso).

### Grants (RLS FORCE + column-level)

- Token = **service_role-only**: `clinic_whatsapp_numbers` concede a `authenticated` SELECT em
  todas as colunas EXCETO `token_encrypted`; escrita só `service_role`. O sender lê o token pelo seam
  privilegiado, nunca por `authenticated`.
- `inbound_messages_raw`/`provider_status_events_raw`: SELECT+INSERT (append-only); UPDATE/DELETE
  revogados de `authenticated`. `outbound_messages`: SELECT+INSERT+UPDATE; DELETE revogado.
- `inbound_messages_orphaned`: sem grant a `authenticated`/`anon` (service_role-only).

### Seam privilegiado `number-store` — superfície CONGELADA

`src/lib/messaging/number-store.ts` é o ÚNICO lugar que toca número/token/órfão via `dbAdmin` (o
webhook não tem tenant; leitura cross-tenant/credencial é proibida em `src/contexts/**`). Expõe
**EXATAMENTE 3 funções**: `resolveClinicByPhoneId`, `loadActiveNumberForSend`, `quarantineOrphan`.
Qualquer nova operação vai para o contexto (`withTenant`) — não cresce aqui (anti God-Repository).

### Eventos + Outbox

- ÚNICO evento: **`messaging.inbound.received`** (payload sem plaintext). `insert inbound +
  publishEvent` na **MESMA** `withTenant` tx (garantia transacional: falha → rollback total → rota
  500 → Meta re-tenta; nunca há inbound salvo sem evento).
- Até C11 registrar o handler, o evento fica `skipped` (catálogo sem handler = F-03; dado salvo na
  tabela). Outbound e status callbacks NÃO emitem evento.

### Status semantics (honestidade)

- `outbound_status = pending | accepted | failed | unknown`. `accepted` = ack **síncrono** do
  provider (NÃO delivered/read). `unknown` = falha de rede indeterminada (timeout/reset) — NÃO marcar
  como `failed` (métricas mentirosas). A verdade async vem dos callbacks em `provider_status_events_raw`.
- Provider lança `ProviderSendError` (HTTP definitivo → `failed`) vs `ProviderUnreachableError`
  (indeterminado → `unknown`). Fetch com `AbortController` de 10s (`META_HTTP_TIMEOUT_MS`).
- **Status events são INDEPENDENTES** da existência da mensagem (ordenação Meta não garantida):
  **PROIBIDO** FK `provider_status_events_raw.provider_message_id → inbound/outbound`. Correlação em
  C14 é por match, não FK.

### Token rotation

- `token_version` é **mecanismo**, não metadado: em 401/403 o sender recarrega a credencial e só
  reenvia se `token_version` aumentou (rotação ocorreu); senão `failed` imediato (sem 2ª chamada
  Meta inútil). Refresh único — NÃO é retry engine.

### Webhook hardening

- `MAX_WEBHOOK_BYTES = 1_000_000`: rejeita 413 por `Content-Length` + leitura com cap **antes** do
  HMAC (DoS pré-validação).
- `META_APP_SECRET` é **app-level único** (1 app Meta valida todos os webhooks; isolamento por
  clínica é no token). Verify token = `META_WEBHOOK_VERIFY_TOKEN`.

## Contrato de métricas (para dashboards C14)

| Métrica | Labels | Fonte |
|---|---|---|
| `messaging.inbound.received` | clinicId, provider | persistInbound (nova) |
| `messaging.inbound.duplicate` | clinicId, provider, providerMessageId | conflito, mesmo payload |
| `messaging.inbound.conflict` | clinicId, provider, providerMessageId | **incidente** — mesmo id, payload diferente |
| `messaging.outbound.accepted\|failed\|unknown` | clinicId | sender finalize |
| `messaging.outbound.duplicate` | clinicId | reserve conflito |
| `messaging.webhook.orphaned` | provider, toPhoneId | número não-provisionado |
| `messaging.webhook.oversized` | contentLength? | body > 1MB |
| `messaging.webhook.invalid_signature` | — | HMAC falhou |
| `messaging.status.received` | clinicId, provider, count | persistStatusEvents |

## Consequences / débito (futuro)

- **Outbound órfão** (R1): crash entre envio Meta e finalize deixa `pending`/`unknown` (sem retry
  engine em C10). `UNIQUE(clinic_id, idempotency_key)` evita duplo envio; reconcile vem em C14 via
  `provider_status_events_raw`.
- **Órfão eterno**: `inbound_messages_orphaned` sem consumidor. **Recovery Strategy C11/C14**: ao
  conectar um número, reprocessar órfãos daquele `phone_id` (re-decifra com `PLATFORM_ORPHAN_SCOPE`,
  re-cifra com a chave do tenant, persiste como inbound).
- **Drift de `meta_phone_id`** (Meta troca o phone_id / migração de número): estratégia de
  recuperação = fallback `meta_phone_id → phone_number` no roteamento + health-check Meta confirmando
  associação. Não implementado em C10.
- **`MessagingCredential`**: `token_encrypted` mistura canal + credencial. Quando aparecerem
  `refresh_token`/`expires_at`/`scope`, extrair uma entidade de credencial separada.
- **Provider status seam**: enum honesto futuro pode precisar `queued | provider_accepted | failed`
  (ZApi responde `queued`, não `accepted`).
- **`media_url`** existe por contrato mas é SEMPRE NULL em C10 (proibição de mídia).

## Operacional (descobertas C10)

- **Migrations 0018-0021 não são journaladas** (aplicadas manualmente no Supabase SQL Editor);
  snapshots param em 0017. `db:generate` é **inseguro** (diff contra 0017 dropa tudo desde então).
  C10 **hand-escreve** `0022_messaging_core.sql` (idempotente) + adiciona entry no `_journal.json`
  para `drizzle-kit migrate` aplicar SÓ o 0022 (resolve por `tag`). Aplicação manual também é segura
  (idempotente).
- **`CRYPTO_LOOKUP_SALT` do `.env.local` dev decodifica para 15 bytes** (< 16 exigido) — quebra
  `hashForLookup` (afeta C5 também). O `smoke:c10` injeta um salt válido via `cross-env` (dados
  efêmeros); **a env de dev precisa de um salt ≥ 16 bytes**. Não alterado (mudar o salt invalida
  `cpf_hash` existentes em qoro-dev).

## References

- ADR-004 (Meta Cloud API), ADR-007 (RLS), ADR-011 (Outbox/Audit/Idempotency), ADR-012 (Encryption)
- `docs/runbooks/c10-validation.md`
