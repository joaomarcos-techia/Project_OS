# Entradas externas: evidência local e correção

Escopo: checkout local em 2026-09-10; nenhuma chamada a Meta/Asaas, migration ou deploy.

## Fase 0.5 — saída crua antes da alteração

Comando: `rg -n 'content-length|req\.text|readBodyCapped' src/app/api/webhooks`

```text
src/app/api/webhooks/asaas/route.ts:98:  const contentLength = Number(req.headers.get('content-length') ?? '0');
src/app/api/webhooks/asaas/route.ts:103:  const raw = await req.text();
src/app/api/webhooks/asaas/patient/[ref]/route.ts:80:  const contentLength = Number(req.headers.get('content-length') ?? '0');
src/app/api/webhooks/asaas/patient/[ref]/route.ts:93:  const raw = await req.text();
src/app/api/webhooks/meta/route.ts:40:async function readBodyCapped(req: Request, cap: number): Promise<string | null> {
src/app/api/webhooks/meta/route.ts:143:  const contentLength = Number(req.headers.get('content-length') ?? '0');
src/app/api/webhooks/meta/route.ts:148:  const raw = await readBodyCapped(req, MAX_WEBHOOK_BYTES);
```

Comando: `rg -n 'validateSignature|timingSafeEqual' src/lib/messaging/meta-cloud.ts`

```text
184:  validateSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
190:    return a.length === b.length && timingSafeEqual(a, b);
```

Comando: `rg -n 'validateWebhookToken|safeEqual' src/lib/payments/asaas/index.ts`

```text
18:import { safeEqual } from '@/lib/auth/secret-compare';
1039:    validateWebhookToken(token) {
1041:      return safeEqual(token, resolveValue(credential.webhookToken));
```

Comando: `rg -n 'asaasEventId:|providerMsgUniq:|patient_webhook_events_uniq' src/contexts/billing/schema.ts src/contexts/messaging/schema.ts src/contexts/payments/schema.ts`

```text
src/contexts/billing/schema.ts:247:    asaasEventId: text('asaas_event_id').primaryKey(),
src/contexts/messaging/schema.ts:138:    providerMsgUniq: uniqueIndex('inbound_messages_raw_provider_msg_uniq').on(
src/contexts/payments/schema.ts:369:    asaasEventId: text('asaas_event_id').notNull(),
src/contexts/payments/schema.ts:375:    uniq: unique('patient_webhook_events_uniq').on(t.clinicId, t.asaasEventId),
```

## Interpretação do código observado

| Entrada | Guard próprio, sem depender da sessão | Idempotência / falha | Corpo antes da correção |
| --- | --- | --- | --- |
| `GET /api/webhooks/meta` | verify token via `safeEqual` | Handshake sem escrita | Sem body |
| `POST /api/webhooks/meta` | HMAC-SHA256 do raw via `timingSafeEqual` | UNIQUE por provider/message ID; inbound e outbox na mesma transação; falha persiste como HTTP 500; número desconhecido em quarentena | Teto real de 1.000.000 bytes no stream |
| `POST /api/webhooks/asaas` | Token via `safeEqual`; estado consultado com `getPayment` | PK por ID do evento; dedup e escrita na mesma transação | `req.text()` aloca o corpo inteiro antes de medir |
| `POST /api/webhooks/asaas/patient/[ref]` | Token da conta resolvida por ref via `safeEqual`; `getPayment` usa a conta da clínica | UNIQUE por clínica/evento; dedup na transação de conciliação | `req.text()` aloca o corpo inteiro antes de medir |
| 18 rotas `GET /api/cron/*` | `withCron` chama `assertCronAuth`; Bearer comparado por `safeEqual`, falta de segredo fecha acesso | Falhas capturadas e heartbeat de erro; idempotência depende do job | Sem body consumido |

O checkout contradiz a premissa de webhook não autenticado/não idempotente. O item corrigível demonstrado é a leitura sem teto **durante** o recebimento nos dois handlers Asaas. O teto já rejeitava 413 ao final, mas não impedia consumo de memória antes da rejeição.

Não há handler em `/api/auth/*` nem `/api/revalidate` no inventário local (`rg --files src/app` filtrado por `route.ts` e `auth|revalidat|cron`). O callback real é `GET /auth/confirm`: exige token e tipo admitido (`src/app/(app)/auth/confirm/route.ts:50`), troca o token via `verifyOtp` (`:61`) e restringe redirecionamento por `safeNext` (`:46`). `GET /api/health/auth-hook` executa `healthAuthLevel` antes de consultar o banco (`src/app/api/health/auth-hook/route.ts:40`). O `catch` de `signOut` em `/auth/confirm` (`:57`) descarta toda exceção como se fosse ausência de sessão; observação de revisão, sem correção ou teste nesta frente.

O contrato local Asaas contém token compartilhado, não assinatura do corpo. Não foi inventado HMAC incompatível nem uma janela de timestamp: o parser usa o ID obrigatório do evento e IDs de pagamento/checkout; o estado vem da consulta ao provider. Meta verifica HMAC e deduplica o ID; o timestamp da mensagem é data do evento, não um nonce de entrega. Rejeitar reentregas antigas sem contrato confirmado descartaria eventos legítimos.

O outbox existente conserva eventos com `status: 'failed'`, tentativas e erro (`src/lib/outbox/worker.ts:376`); a quarentena Meta recebe números não provisionados. Isso não prova uma dead-letter universal para todo erro de ingress: Asaas pede reentrega com 500 e tem reconciliação, e payload Meta não parseável não possui quarentena comprovada. Essas limitações não são apresentadas como corrigidas.

## Fase 1 — alteração e verificações

O helper `src/lib/http/webhook-body.ts` reaproveita a leitura limitada do Meta nos três handlers. Ao exceder 1.000.000 bytes, cancela o reader, devolve 413 e não chega ao lookup de clínica, HMAC/token, parse, provider ou banco. O `finally` libera o reader inclusive se o transporte falha; a falha de leitura é propagada. UTF-8 é decodificado depois de concatenar os chunks, preservando caracteres e o texto usado pelo HMAC.

Baseline executada antes do diff:

```text
pnpm exec vitest run src/app/api/webhooks/meta/route.test.ts src/app/api/webhooks/asaas/route.test.ts 'src/app/api/webhooks/asaas/patient/[ref]/route.test.ts' src/lib/auth/secret-compare.test.ts src/lib/http/cron-auth.test.ts src/lib/http/cron.test.ts src/lib/payments/asaas/index.test.ts
Test Files  7 passed (7)
Tests  140 passed (140)
Duration  7.28s
```

Após a correção:

```text
pnpm exec vitest run src/lib/http/webhook-body.test.ts src/app/api/webhooks/meta/route.test.ts src/app/api/webhooks/asaas/route.test.ts 'src/app/api/webhooks/asaas/patient/[ref]/route.test.ts' src/lib/auth/secret-compare.test.ts src/lib/http/cron-auth.test.ts src/lib/http/cron.test.ts src/lib/payments/asaas/index.test.ts
Test Files  8 passed (8)
Tests  154 passed (154)
Duration  43.48s
```

Lint dos oito arquivos TypeScript alterados: `pnpm exec eslint src/lib/http/webhook-body.ts src/lib/http/webhook-body.test.ts src/app/api/webhooks/meta/route.ts src/app/api/webhooks/meta/route.test.ts src/app/api/webhooks/asaas/route.ts src/app/api/webhooks/asaas/route.test.ts 'src/app/api/webhooks/asaas/patient/[ref]/route.ts' 'src/app/api/webhooks/asaas/patient/[ref]/route.test.ts'` → exit 0, sem diagnóstico.

Os testes de replay Asaas exercitam o handler com persistência simulada; não provam atomicidade/UNIQUE em Postgres. HMAC, streams e cancelamento são reais no processo Node. Não houve entrega externa, e nenhuma afirmação de comportamento em produção decorre destes testes.

O último rerun inclui streams que encerram após quatro chunks caso a proteção regrida, para que uma falha de teste seja limitada em memória. Todos os guards cancelaram após o segundo chunk. `pnpm exec prettier --check` sobre os mesmos oito arquivos retornou `All matched files use Prettier code style!`; `git diff --check -- src/app/api/webhooks` retornou exit 0. Typecheck/build/HTTP localhost pertencem à validação agregada do relatório principal.
