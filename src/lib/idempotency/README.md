# lib/idempotency

Exactly-once mutations for Server Actions (C4).

## API pública

- [mutation.ts](./mutation.ts) — `idempotentMutation(opts, fn)` é o **único** wrapper de Server Actions mutativas a partir de C5. Reserve + business + audit + finalize numa única TX atômica.
- [errors.ts](./errors.ts) — `IdempotencyConflictError` (409), `IdempotencyInFlightError` (425).
- [hash.ts](./hash.ts) — `payloadHash(payload)` retorna SHA-256 hex do canonicalize.
- [canonicalize.ts](./canonicalize.ts) — wrapper sobre `safe-stable-stringify` + NFC normalize + assertJsonSafe.
- [json-safe.ts](./json-safe.ts) — `assertJsonSafe(value)` rejeita Date / BigInt / NaN / Infinity / undefined / non-plain objects.

## Por que reserve-first dentro da mesma TX

A revisão arquitetural identificou: reservar em TX separada da mutação cria um buraco temporal. Se o processo morrer entre commit da mutação e finalize da idempotency, retry futuro pode executar de novo (semantic: exactly-once perdido).

Solução implementada: TODA a sequência (reserve + business + audit + outbox + finalize response) corre numa única TX via `withTenant`. Rollback unifica os 4 passos. Crash → tudo desaparece → retry reentra como se nada tivesse acontecido.

## SET LOCAL lock_timeout = '3s'

Sem timeout, uma mutação lenta segurando o unique lock vira contenção global por aquela key. Um endpoint travado bloqueia todas as retentativas. Aplicamos `SET LOCAL lock_timeout = '3s'` no início da TX; PG levanta `55P03` quando o lock excede; traduzimos em `IdempotencyInFlightError` (caller faz backoff).

## Cap de response 64KB

`capJsonSize(result)` antes do UPDATE final. Se a response excede 64KB, gravamos envelope `{ truncated: true, originalBytes, originalHash, note }`. Cliente deve re-fetch por ID. Defesa em profundidade: CHECK constraint `pg_column_size(response) <= 98304` na tabela.

## Race (2 requests simultâneas, mesma key)

Sob READ COMMITTED + `ON CONFLICT DO NOTHING`:
- Segunda TX espera o unique lock da primeira.
- Se primeira commita → segunda lê response cacheada (hit).
- Se primeira rolla back → segunda INSERT sucede.
- Se ambas em-flight por mais de 3s → segunda recebe `IdempotencyInFlightError`; cliente backoff + retry.

## Cleanup

`expires_at` default `now() + interval '24 hours'`. Cleanup manual no MVP: `DELETE FROM idempotency_keys WHERE expires_at < now()`. Automation em C16 (pg_cron ou Vercel cron dedicado).
