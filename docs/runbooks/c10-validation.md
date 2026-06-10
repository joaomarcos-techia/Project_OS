# Runbook — Validação C10 (Messaging + Webhook Meta)

Re-executável contra `qoro-dev`. Pré: `.env.local` com `DATABASE_URL`, `CRYPTO_MASTER_KEY_V1`,
`CRYPTO_LOOKUP_SALT` (**≥ 16 bytes** — ver nota), Supabase keys.

## 0. Migration

```bash
pnpm db:migrate:dev          # aplica 0022_messaging_core (idempotente; só cria objetos messaging)
```
Aplicação manual alternativa (prática das migrations 0018-0021): colar
`drizzle/migrations/0022_messaging_core.sql` no Supabase SQL Editor (é idempotente).

Verificar (Supabase SQL Editor):
```sql
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
WHERE relname IN ('clinic_whatsapp_numbers','inbound_messages_raw','outbound_messages',
                  'provider_status_events_raw','inbound_messages_orphaned');     -- todas force=t
SELECT has_column_privilege('authenticated','clinic_whatsapp_numbers','token_encrypted','SELECT'); -- false
SELECT has_column_privilege('authenticated','clinic_whatsapp_numbers','phone_number','SELECT');     -- true
```

## 1. Gates de código

```bash
pnpm typecheck && pnpm lint && pnpm arch:check && pnpm check:registry && pnpm build
```
`check:registry` lista `messaging.inbound.received` como schema-sem-handler (esperado — `skipped` até
C11). `build` mostra a rota `ƒ /api/webhooks/meta`.

## 2. Smoke (18 testes DB-level)

```bash
pnpm smoke:c10               # 18/18
```
Cobre: assinatura HMAC (válido/tamperado/ausente), verify endpoint, parseWebhook, resolução de tenant
+ quarentena cifrada, persistInbound (row + evento na mesma tx), dedup `(provider, provider_message_id)`,
conflict (mesmo id/payload diferente), status raw dedup, outbound accepted + dedup + suppression,
isolamento cross-tenant da idempotency_key, unknown vs failed, refresh de token (só com bump),
RLS A/B, concorrência 5× (1 inbound/1 evento), rollback do outbox, reconexão pós-disconnect,
pré-flight FORCE RLS + token grant negado.

O smoke stuba `globalThis.fetch` (sem rede Meta real) e injeta `CRYPTO_LOOKUP_SALT` válido via
`cross-env`.

## 3. In-app (super_admin session) — não coberto pelo smoke

Conectar um número real e exercitar as Server Actions:
```bash
pnpm wa:connect --clinic <uuid> --phone <e164> --meta-phone-id <id> --token <token>
```
Validar (precisa de sessão super_admin AAL2):
- `connectWhatsappNumber` / `disconnectWhatsappNumber` / `rotateWhatsappToken` gravam em
  `super_admin_actions` (action `messaging.number.connected|disconnected|token_rotated`).

## 4. Pós-deploy (Vercel + painel Meta) — fora do smoke

1. Setar `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_API_VERSION` nas Env Vars.
2. No painel Meta (WhatsApp → Configuration): Callback URL = `https://<app>/api/webhooks/meta`,
   Verify Token = `META_WEBHOOK_VERIFY_TOKEN`. Subscrever ao campo `messages`.
3. O GET de verificação deve retornar o `hub.challenge` (200).
4. Enviar 1 mensagem real ao número conectado → conferir 1 row em `inbound_messages_raw` + 1 evento
   `messaging.inbound.received` no `outbox` (status `skipped` até C11).

## Notas / pitfalls

- **`CRYPTO_LOOKUP_SALT` ≥ 16 bytes**: a env de dev atual decodifica para 15 bytes — quebra
  `hashForLookup` (afeta C5 também). Gerar com `openssl rand -base64 24` e atualizar `.env.local`.
  **Não** alterar em ambiente com dados reais sem migração (invalida `cpf_hash`/`telefone_hash`).
- **`db:generate` é inseguro** neste repo (snapshots param em 0017). Migrations recentes são
  hand-escritas + idempotentes. Ver ADR-020 §Operacional.
- Webhook sempre responde **200** para número desconhecido (após quarentena) — Meta re-tenta para
  sempre se não receber 200.
