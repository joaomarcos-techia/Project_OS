# ADR-020 — Messaging providers

## Status

Accepted parcialmente — Reference.

## Decision

`MessagingProvider` define `sendText`, `sendTemplate`, `parseWebhook` e `validateSignature`. `MetaCloudProvider` é a implementação funcional. `ZApiProvider` mantém compatibilidade/skeleton, mas todos os métodos falham explicitamente: `NOT_IMPLEMENTED`.

Seleção usa switch simples por provider. Não há factory/base class adicional, failover automático, mídia compartilhada nem “swap em 30 minutos”.

## Operational rule

Meta deve ser reconectada/configurada explicitamente; falha de health não autoriza mudar para Z-API.
