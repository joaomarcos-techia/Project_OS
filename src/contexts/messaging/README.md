# contexts/messaging

Fundação de mensagens WhatsApp (C10). **Sem IA, sem mídia, sem retry engine.** A IA conversacional
vive em `ai-agent` (C11+) e reage a `messaging.inbound.received`.

## Responsabilidade

- Persistir inbound/outbound criptografados, deduplicados, tenant-scoped.
- Identificar o tenant pelo número (`meta_phone_id`) — via seam `@/lib/messaging/number-store`.
- Publicar `messaging.inbound.received` no Outbox (única integração cross-context de saída).
- Conectar/desconectar/rotacionar número (Server Actions super_admin + audit).

## Bounded context (contrato C10)

Permitido: Identity, Patient (**API pública** — `suppressionList`), Outbox, Audit.
Proibido: Scheduling, Financial, Clinical, JOIN cross-context, acesso direto a tabela de outro contexto.

## Estrutura

- `schema.ts` — 5 tabelas (4 tenant-scoped + `inbound_messages_orphaned` global) + 2 enums.
- `events.ts` — `messaging.inbound.received` (único evento; payload sem plaintext).
- `actions.ts` — connect/disconnect/rotate (super_admin via `superAdminAction`).
- `internal/inbound.ts` — `persistInbound` (mesma tx do publishEvent) + `persistStatusEvents`.
- `internal/sender.ts` — `sendOutbound` (reserve→send→finalize; status accepted/failed/unknown).

Transporte (HTTP Meta, parse, assinatura) e o seam privilegiado de número vivem em `@/lib/messaging`.

Contratos congelados em [ADR-020](../../../docs/adr/020-messaging-provider-patterns.md).
