# ADR-011 — Outbox / Audit / Idempotency implementation patterns

**Status:** accepted
**Date:** 2026-05-28

## Context

[ADR-003](003-outbox-pattern.md) decidiu **USAR** a outbox transacional para comunicação cross-context. ADR-011 fixa **COMO** essa decisão se materializa em C4, e congela os contratos que C5–C15 vão herdar.

A C4 nasce sob duas revisões arquiteturais (12 + 7 itens) que mapearam riscos sutis: bug temporal entre reserva idempotente e commit da mutação, privilege escalation latente via `RESET ROLE` em mesma TX, vazamento de PII em structured logs, lock contention global por idempotency key, cascading failure de handlers tóxicos, dead-letter sem metadata. Sem este ADR, cada bounded context em C5–C15 redescobriria parte desses riscos e escreveria mitigations não-uniformes.

C4 também é o primeiro lugar onde infra cross-cutting (não tenancy, não identity) ganha pasta própria sob `src/lib/db/schema/infra/`. A escolha pelo barrel `lib/db/schema/**` em vez de mover para `contexts/platform-admin` mantém ADR-001 (contexto não importa de contexto) intacto.

## Decision

### Contratos sistêmicos (declaração explícita)

| Aspecto | Garantia |
|---|---|
| Outbox enqueue | **exactly-once** atômico com business TX |
| Outbox delivery | **at-least-once** (Vercel Cron + retry com backoff) |
| Handler execution | **MUST be idempotent** — não negociável |
| Audit log | **exactly-once** atômico (mesma TX da mutação) |
| Idempotency | **exactly-once** via única TX (reserve+business+audit+finalize) + lock_timeout 3s |
| super_admin_actions | **exactly-once** atômico |
| Cron schedule | **best-effort** (≤60s típico, sem SLA) |
| withTenant connection | **fresh TX-bound connection** do pool postgres-js (prepare=false) |

### Invariantes congelados

1. **`publishEvent(tx, ...)` é único emissor.** ESLint barra `emitEvent`/`eventBus` (identifier-level) e `auditableAction` (import + identifier).
2. **`logAudit(tx, ...)` é único inseridor de `audit_events`.** Aceita o `tx` do caller. Sanitiza `before`/`after` via `sanitizePayload`.
3. **`auditedMutation(opts, fn)`** — wrapper de mutação + audit (sem idempotency). **Raro**.
4. **`idempotentMutation(opts, fn)`** — wrapper padrão de Server Actions mutativas a partir de C5. Reserve + business + audit + finalize numa única TX.
5. **`SET LOCAL lock_timeout = '3s'`** no início do `withTenant` do idempotentMutation. PG `55P03` → `IdempotencyInFlightError`. Endpoint lento não congela concorrência.
6. **Worker em 3 TXs separadas** — TX1 (dbAdmin reserve), TX2 (withTenant authenticated handler), TX3 (dbAdmin finalize). **NUNCA** role-switching dentro da mesma TX.
7. **Janitor `reclaimStuckProcessing()`** no início de cada tick: rows em `processing` há mais de 5 min → `pending`. Mitigação contra worker matado entre TX1 e TX3.
8. **Circuit breaker stateless via SQL** — event_type com ≥10 failures em 5 min → todos os pending desse tipo recebem `next_attempt_at = now() + 5min` (cooldown). Mitigação contra handler bugado floodando o worker.
9. **`ORDER BY (next_attempt_at, created_at)`** — evita starvation de eventos novos sob backlog tóxico.
10. **Parallelism bounded via `p-limit(env.OUTBOX_PARALLELISM ?? 5)`**. Batch size via `env.OUTBOX_BATCH_SIZE ?? 50`.
11. **Catálogo (`registerEventSchema`) separado de handler registry (`registerHandler`)** — desacopla producer/consumer no tempo de deploy. Producer importa só schema do contexto (catalog), consumer importa só handler (registry). Boot file `src/app/api/cron/outbox/handlers.ts` é o ÚNICO lugar que importa `<context>/internal/handlers/*`.
12. **canonicalize** = `safe-stable-stringify` (pinned 2.5.0) + `assertJsonSafe` (rejeita Date / BigInt / NaN / Infinity / undefined) + NFC unicode normalize.
13. **Idempotency response cap 64 KB** via `capJsonSize` envelope `{ truncated, originalBytes, originalHash, note }`. CHECK constraint defensivo `pg_column_size(response) <= 98304`.
14. **`sanitizePayload`** key-level (SENSITIVE_KEYS: `password|token|secret|jwt|cookie|api_key|...`) + value-level (Bearer/JWT/sk_/DSN regex). Aplicado em `audit_events`, `super_admin_actions`, e `metrics.emit`.
15. **audit_events** particionada por mês — `PARTITION BY RANGE (created_at)`. 12 partitions mensais (2026-05 → 2027-04) + `audit_events_default` catch-all. RLS na parent propaga para children (PG 11+).
16. **super_admin_actions** — sem `clinic_id`; policy única `USING (is_super_admin())`. INSERT+SELECT only; append-only.
17. **Cron auth** `Authorization: Bearer $CRON_SECRET` (≥32 chars). 401 antes de qualquer SQL. `assertCronRuntimeReady()` enforce em runtime do route.
18. **Observability** via `metrics.emit()` (structured JSON em stdout, sanitizado) + endpoint `GET /api/health/outbox` com counts + ages + failures_by_type.
19. **`serializeError`** retorna `{ message: truncate(4000), code }`. Stack stripped em produção. CHECK constraint `octet_length(last_error) <= 8192`.
20. **DLQ metadata** — colunas `first_failed_at`, `last_failed_at`, `error_code` em `outbox`. Handlers podem throw `HandlerError(msg, code)` para categorizar; default `unknown`.
21. **withTenant connection isolation** — cada chamada acquire fresh TX-bound connection do pool postgres-js. `SET LOCAL` é bound à TX; `COMMIT`/`ROLLBACK` libera. `prepare: false` no driver (Transaction Pooler compat) garante zero state leak entre TXs reusando a mesma conexão. Validado em c2-validation round 5; reconfirmado em smoke-c4 teste 4.6.16.
22. **Contratos de delivery** declarados no topo deste ADR. Handlers escritos sob essas suposições, não outras.
23. **Retention de audit_events** — 90d hot / 1y warm / archive-or-delete. DETACH PARTITION + pg_dump + DROP manual no MVP (runbook c4-validation), automation em C16.

24. **publishEvent usa PG-native `INSERT ... ON CONFLICT DO NOTHING`**, não `try { INSERT } catch { isUniqueViolation }`. Razão: erros de constraint em Postgres podem aflorar no INSERT, no COMMIT, ou em momentos intermediários conforme o driver e o pipelining. `try/catch` em volta do INSERT é frágil — em alguns paths (notavelmente quando o INSERT está dentro de uma TX externa do withTenant, como em C4), o erro escapa do escopo do catch e propaga só no COMMIT. `ON CONFLICT DO NOTHING` é a forma canônica do Postgres: atômica, race-safe, sem depender de comportamento de driver. `.returning({ id })` distingue INSERT real de skip-por-conflito para emissão de métrica correta. Smoke 4.6.4 forçou esta correção durante a validação de C4 em 2026-05-29 — ficou registrado como anti-pattern proibido para mutações cross-context.

25. **Worker TX3 é CONDITIONAL em `(status='processing' AND attempts=N)`** (CRITICAL-01). TX1 incrementa attempts (N-1 → N) e seta status='processing'. TX3 faz `UPDATE ... WHERE id=$1 AND status='processing' AND attempts=N RETURNING id`. Se 0 rows updated, alguém mexeu desde a reserva — janitor reclamou (status volta a 'pending') ou outro worker já fez TX1 incrementando attempts a N+1. Emitimos `outbox.lost_race` e NÃO sobrescrevemos estado. Vale para TX3 de processed, failure e retry. Por que `attempts` e não `processing_started_at`: PG timestamptz tem precisão de microssegundo; JS Date tem só milissegundo. Drizzle's `eq(col, jsDate)` formata via `toISOString()` (perde μs); comparação `=` falha mesmo sem race. `attempts` é integer, compara exato. Smoke 4.6.18 confirma. Sem este guard, double-execution silenciosa quando handler é lento + janitor reclama.

26. **`HandlerCtx` carrega `eventId` e `attempt`**. Handlers DEVEM usar `eventId` (o outbox.id, UUID globally unique) como dedup key em INSERTs (`ON CONFLICT (event_id) DO NOTHING`) e como idempotency-key em chamadas a APIs externas. `attempt` (1-indexed) permite branching defensivo (ex.: fallback na 5ª tentativa). Without these, at-least-once delivery causes duplicate writes / duplicate side-effects. ESLint barra `db`/`dbAdmin`/`dbWorker` em `src/contexts/*/internal/handlers/**` — handler SÓ usa `ctx.tx`.

27. **Event schemas em `events.ts` DEVEM ser JSON-safe**: ESLint barra `z.date()`, `z.bigint()`, `z.nan()`, `new Date()`. Use `z.string().datetime()` para timestamps, `z.string()` para BigInt. Mismatch entre Zod (aceita Date) e assertJsonSafe (rejeita Date) causava runtime explosion silencioso; agora é error de build.

28. **Cron route auth é SINGLE-FACTOR**: `Authorization: Bearer ${CRON_SECRET}` é o único gate, em [cron-auth.ts](../../src/lib/http/cron-auth.ts). A presença do header `x-vercel-cron` é **anomalia observável** (`cron.origin_header_missing`), não controle de acesso. Rotas destrutivas preferem `CRON_SECRET_DESTRUCTIVE` quando definido (V5), reduzindo o blast radius. *(Revisado em 2026-07-15 — ver addendum M2 abaixo.)*

29. **Healthcheck tem DOIS níveis**: `level=monitoring` (Bearer-only, counts agregados sem breakdown por type) e `level=super_admin` (super_admin AAL2, com `failures_by_type` completo). Defense in depth contra information disclosure quando secret vaza. Em dev, ambos os paths são acessíveis.

30. **Worker usa pool dedicado `dbWorker` (max:5 default, env.OUTBOX_DB_POOL_SIZE)**, separado de `dbAdmin` (max:1, sparse path para healthcheck/dashboard). `dbAdmin` saturava completamente o worker em rede AWS Oregon (smoke 4.6.2 mostrou ~70s para batch=50). Trade-off aceito: +1 pool, mas worker independente do healthcheck.

31. **`cleanupExpiredIdempotencyKeys` SÓ deleta rows COMPLETADAS** (`response IS NOT NULL`). In-flight (response NULL) é NUNCA deletado por cleanup, mesmo expirado — defense in depth contra CRITICAL-02 (race entre retry tardio e cleanup). Diagnostic separado via `diagnoseInFlightOrphans()` retorna in-flight com created_at > 1h para investigação. **Trigger BEFORE DELETE no banco** raises exception se tentar DELETE de row in-flight com created_at < 1h — segunda camada contra erro humano operacional. Migration 0010.

32. **PoisonPillError pula backoff**: handler throws `PoisonPillError('semantic failure', 'code')` → worker marca `failed` imediatamente, sem queimar attempts. Use quando a falha é permanente por regra de negócio (paciente deletado, payload semanticamente impossível). Evita 5×30min de retries de erro determinístico.

33. **Advisory lock `pg_try_advisory_xact_lock(hashtext('outbox-worker'))`** no início de `runOutboxOnce`. Se outro tick já tem o lock, retorna `worker.tick.skipped_overlap`. SKIP LOCKED garante que dupla reserva da MESMA row não ocorre; o advisory adiciona proteção contra dupla execução de janitor + circuit + métrica inflada em cron overlap.

34. **`outbox.payload_hash` é NOT NULL**, sha256-hex do payload canonicalizado. publishEvent detecta collision (mesmas `(event_type, idempotency_key)` com payloads diferentes = caller bug, NÃO retry idempotente) e throw `OutboxError` com code `idempotency_key_collision`. Métrica `outbox.key_collision`. Sem este check, segunda publicação era silently dropped → evento perdido.

35. **`OUTBOX_IDEMPOTENCY_LOCK_TIMEOUT_MS` configurável via env (default 10s)**. Era hardcoded 3s; quebrava Server Actions com fn() de 4-5s em rede lenta. Caller que ultrapassa o timeout recebe `IdempotencyInFlightError 425` e deve usar two-step pattern: Server Action síncrona apenas enfileira evento; handler processa async.

36. **Size caps em `outbox.payload`, `audit_events.before/after`, `super_admin_actions.payload`** via CHECK constraint `pg_column_size(...) <= 65536` (64KB). Runtime check em publishEvent throws OutboxError com mensagem de tamanho ANTES do INSERT (UX explícita). Sem caps, dev distraído podia foddar storage com 10 MB JSON. Caller deve passar IDs no payload; handler busca detalhes via DB.

37. **GRANTs explícitos para `authenticated` e `service_role`** em todas tabelas C4 (migration 0010). Antes dependíamos de schema-default GRANT do Supabase — quebraria em migration para nova instância OU self-host. Pattern: SELECT+INSERT a authenticated (RLS filtra); ALL a service_role (BYPASSRLS path).

38. **Temporal coherence CHECK em outbox** (migration 0010): `processing_started_at >= created_at`, `processed_at >= created_at`, `last_failed_at >= first_failed_at`. Worker bugado / replay manual / janitor bug não pode produzir timestamps inconsistentes. Defense in depth.

39. **External side-effects (CRITICAL-04)**: handler que chama API externa USA `makeProviderIdempotencyKey(ctx, sideEffectKey)` para gerar idempotency-key determinística a partir do `eventId`. Provider externo (Meta, Stripe, Twilio) dedupa baseado nela. Sem esta disciplina, at-least-once delivery → at-least-many side-effects. Helper `fetchWithIdempotency` wrap `fetch` setando header `Idempotency-Key` automaticamente. Se provider NÃO suporta idempotency-key, handler precisa de pattern customizado (query-status-then-call) — proibido usar este helper naively.

40. **CI gate `check:registry`** (`scripts/check-handler-registry.ts`): compara `listEventTypes()` (catalog) vs `listRegisteredHandlers()` (registry). Em prod, qualquer event_type com schema mas sem handler é fatal. Em dev é warning (allow WIP). Previne CRITICAL: dev adiciona handler novo mas esquece de importar no boot file `src/app/api/cron/outbox/handlers.ts` → eventos ficam failed silenciosamente.

41. **`idempotentMutation` aceita `ttlSeconds` por chamada** (range 60s ↔ 30 dias; default 86400 = 24h). Permite Server Actions críticas (financial.invoice.created, clinical.prescription.signed) usarem TTL 7d para tolerar retry tardio de cliente mobile offline; Server Actions triviais ficam no default. `validateTtlSeconds(value)` é exportada como helper público — chama em chamadas dinâmicas (vindas de UI). Limites foram escolhidos para: (a) min=60s evita TTL inútil; (b) max=30d evita storage explosion (1000 clínicas × 100 mutations/dia × 30d × ~1KB ≈ 3 GB só de idempotency_keys). SQL bind: `expires_at = now() + (${ttlSeconds}::int * interval '1 second')`.

42. **`withProviderStatusCheck(ctx, sideEffectKey, opts)`** em `src/lib/outbox/side-effects.ts`: pattern obrigatório para handlers que chamam providers SEM suporte nativo a idempotency-key. Em vez de confiar no provider para dedup, fazemos `statusCheck` antes do `call`. Provider retorna um dos 4 estados:
    - `completed` → chama `onAlreadyCompleted` (caller decide: re-fetch detalhes ou stub).
    - `failed` → throws `PoisonPillError` (worker marca failed sem retry).
    - `pending` → throws `SideEffectInFlightError` (worker retry com backoff).
    - `not_found` → chama `call` normalmente.
    Custo: 1 round trip extra (statusCheck) por handler bem-sucedido. Aceitável para handlers cuja correção depende criticamente de não-duplicar. Para providers COM idempotency-key (Stripe, Meta Cloud API, Twilio, SendGrid), use `fetchWithIdempotency` direto — mais simples e 1 round trip a menos.

### Topologia frozen

```
src/lib/db/schema/infra/         outbox.ts, audit.ts, super-admin.ts, idempotency.ts
src/lib/sanitize/                redact.ts, patterns.ts, keys.ts, cap.ts
src/lib/observability/           metrics.ts
src/lib/outbox/                  catalog.ts, registry.ts, publish.ts, backoff.ts,
                                 janitor.ts, circuit.ts, errors.ts, worker.ts, types.ts
src/lib/audit/                   log.ts, mutation.ts, super-admin.ts, request-context.ts, types.ts
src/lib/idempotency/             canonicalize.ts, json-safe.ts, hash.ts, errors.ts, mutation.ts
src/app/api/cron/outbox/         route.ts, handlers.ts
src/app/api/health/outbox/       route.ts
drizzle/migrations/              0008_c4_outbox_core.sql, 0009_c4_audit_partitioned.sql
```

ESLint allowlist de `dbAdmin` em C4 cobre `src/app/api/cron/**` e `src/app/api/health/**` (além do existente `src/app/api/admin/**`).

## Threat model

| Threat | Mitigation |
|---|---|
| Producer ↔ consumer deploy skew | Catalog separado de registry; producer publica antes do consumer; worker retry até consumer chegar |
| Crash entre TX1 e TX3 do worker | Janitor reclama em ≤5 min via `processing_started_at` |
| Secrets em audit/metrics/super_admin_actions | `sanitizePayload` key + value level, shared module |
| Storage explosion | response cap 64KB + TTL 24h em idempotency_keys + last_error 4KB + CHECK constraints |
| Cron miss/overlap | At-least-once + handler idempotente + SKIP LOCKED |
| Lock contention global em idempotency key | `lock_timeout = '3s'` → `IdempotencyInFlightError`; cliente backoff |
| Handler bugado causando cascading failure | Circuit breaker stateless via outbox query |
| Connection pooling agressivo (pgBouncer transaction mode) | `SET LOCAL` safe por TX; `prepare=false` validado em C2 audit round 5 |
| Audit loss | TX inteira rolla back — política "no audit, no op" |
| Cross-tenant leakage no worker | TX2 via withTenant (RLS aplica) + smoke 4.6.16 |
| At-least-once causar dupla execução | Handlers idempotentes via dedup em idempotency_keys do destino (handler responsibility) |
| PII em structured logs | metrics.emit usa `sanitizePayload` antes de stdout write |
| Stack trace explosion em last_error | `serializeError` strip stack em prod + cap 4000 + CHECK 8192 |
| Starvation de eventos novos | ORDER BY `(next_attempt_at, created_at)` |
| Particionamento esgotando | Default partition catch-all + healthcheck alerta quando `default_partition_rows > 0` |
| PII em sanitize bypass por value | Value-level regex (Bearer/JWT/sk_/DSN) além de key-level |

## Consequences

- C5–C15 herdam infra completa. Adicionar um evento novo = (1) schema em `<context>/events.ts` chama `registerEventSchema`; (2) handler em `<context>/internal/handlers/<event>.ts` chama `registerHandler`; (3) import no `src/app/api/cron/outbox/handlers.ts`; (4) Server Action chama `publishEvent(tx, ...)` dentro de `idempotentMutation`.
- Adicionar um padrão de redação novo = adicionar regex em `src/lib/sanitize/patterns.ts`. Sem migration. Sem schema. Sem deploy de DB.
- Solo founder pode operar sistema com 6 queries SQL (documentadas em c4-validation): replay failed, reset circuit, list failures by type, cleanup expired idempotency, conferir partições, conferir stuck processing.
- Vercel Cron 1/min é best-effort. Latência típica de outbox = ≤60s; pico raro pode chegar a 2–3 min sob jitter Vercel. Aceito porque nada do produto exige <60s entre contextos. Para latência real-time futura, C16 pode adicionar worker dedicado (Vercel Functions ou ECS).
- Particionamento de audit_events exige criação manual de novas partições antes de 2027-04. Healthcheck alerta via `default_partition_rows > 0`. Automation com pg_cron ou Vercel Cron mensal entra em C13 ou C16.
- Idempotency cleanup é manual (`DELETE FROM idempotency_keys WHERE expires_at < now()` semanal). Volume <1k rows/dia/clínica em MVP — manual basta. Automation em C16.
- Não há dashboard de outbox. `GET /api/health/outbox` + `metrics.emit` → log pipeline são suficientes. C16 plugará Datadog/Honeycomb sem alterar call sites.

### Addendum — M2 (2026-07-15): cron auth é single-factor, e a doc passa a dizer isso

- Status: accepted · Origem: `docs/achados/auditoria-apis-seguranca.md` (M2, MÉDIA)

A invariante 28 afirmava dual-factor: *"Bearer + presença de `x-vercel-cron`; leak do
secret sem capacidade de forjar headers Vercel não dá acesso"*. **O código nunca fez
isso.** `isAuthorized()` verificava o Bearer, emitia uma métrica quando o header
faltava e **retornava `true` incondicionalmente** — o segundo fator não existia. Uma
doc que superestima o controle é pior que não ter a doc: planeja-se em cima de uma
defesa imaginária.

Decidido **assumir o single-factor** em vez de implementar o dual:

1. **A Vercel documenta hoje `x-vercel-cron-schedule`, não `x-vercel-cron`.** Fazer um
   401 depender de header não-documentado arrisca parar **todos** os crons em silêncio
   numa renomeação da plataforma — e outbox parado é falha de integridade de eventos.
   O modo de falha do "hardening" seria pior que o risco mitigado.
2. **O blast radius já foi tratado por onde importa:** `CRON_SECRET_DESTRUCTIVE` (V5)
   separa os 3 crons destrutivos dos read-only. Vazar o segredo de monitoring não dá
   acesso a apagar PII. Isso é segregação real, não presença de header.
3. **A ausência do header vira sinal, não gate:** `cron.origin_header_missing` em
   produção. Se um cron começar a ser chamado de fora da Vercel, aparece na métrica.
4. **401 de cron passa a alarmar:** `cron.unauthorized` (métrica) + `logger.warn`.
   **Sem `captureException`** — o ADR-029 mantém log fora do Sentry e um 401 é evento
   de autorização, não exceção; mesmo padrão de `auth.ratelimit.degraded`. A auditoria
   sugeria Sentry; seguimos a arquitetura da casa.
5. **Ponto único:** `assertCronAuth(req, { route, destructive })` substitui 13 cópias
   quase idênticas (−279 linhas). Recebe `Request` puro (nunca `NextRequest`) para
   permanecer testável sem runtime do Next. Fail-close embutido: `CRON_SECRET` é
   `optional()` no schema, e `Bearer ${undefined}` interpolava para a string literal
   "Bearer undefined" — as rotas só escapavam porque chamavam `assertCronRuntimeReady()`
   antes, o que fazia a segurança depender da memória de quem chama.
6. **`OUTBOX_CRON_ALLOW_NON_VERCEL` declarado no schema** (`env.ts` + `.env.example`).
   Era lido por `process.env` cru em 13 rotas, fora da validação — um typo era silencioso.

Consequência: nenhuma mudança de comportamento em runtime (o gate efetivo já era só o
Bearer). O que muda é a doc parar de mentir, o alarme existir, e o gate ter um dono.

## Alternatives rejected

- **`withIdempotency` standalone** (separado da mutation TX) — perde atomicidade. Bug temporal entre reserve e finalize. Rejected na 1ª revisão arquitetural.
- **`RESET ROLE` dentro da mesma TX do worker** — privilege escalation surface latente. Qualquer linha futura entre `RESET ROLE` e o UPDATE final roda BYPASSRLS. Rejected; substituído pelas 3 TXs.
- **Lookup-then-execute em idempotency** — race: ambas TXs paralelas veem 0 rows e executam fn(). Rejected; substituído por reserve-first com ON CONFLICT DO NOTHING.
- **Circuit breaker in-memory** — não persiste entre cron ticks (cada tick é serverless distinto). Rejected; stateless via outbox query.
- **DLQ separada (tabela própria)** — mais surface, mais operação. Rejected; metadata em colunas do outbox (`first_failed_at`/`last_failed_at`/`error_code`).
- **Redaction só key-based** — bypass trivial via valor (Bearer/JWT em strings sob key não-sensível). Rejected; value-level regex obrigatório.
- **Fila externa (Inngest, Trigger.dev, Redis Streams, Kafka, SQS)** — outro serviço pra cair às 3h; conta paga; sem ganho real até 1000+ clínicas. Rejected (ADR-003).
- **Event sourcing** — replay engine + schema registry + projeções. Overkill para SaaS clínico. Rejected.
- **Framework de eventos genérico (`eventBus.emit`)** — abstração prematura; esconde TX boundaries. Rejected via ESLint guard.
- **Schema registry SQL-side** — drift entre schema TS (Zod) e SQL (constraint). Rejected; constraint regex em outbox espelha catalog regex em TS, mantido em sincro por code review.
- **Cron pg_cron para cleanup de idempotency_keys** — adicionar extension exige super_admin DB privilege e Supabase support varies. Rejected MVP; manual + Vercel cron dedicado em C16.

## References

- [ADR-001](001-bounded-contexts.md) — bounded contexts isolated; outbox é o "como" do "contextos não se chamam direto"
- [ADR-003](003-outbox-pattern.md) — decisão original (USAR outbox); este ADR fixa a IMPLEMENTAÇÃO
- [ADR-007](007-rls-implementation-patterns.md) — RLS patterns; outbox/audit/idempotency seguem `ENABLE+FORCE` + dual-context policy
- [ADR-010](010-security-definer-patterns.md) — C4 NÃO introduz SECURITY DEFINER functions; se C13/C16 adicionar (e.g. para cleanup automatizado), segue o checklist
- [docs/PlanoAção.md §CAMADA 4](../PlanoAção.md)
- [docs/runbooks/c4-validation.md](../runbooks/c4-validation.md) — bateria reexecutável
- [src/lib/outbox/](../../src/lib/outbox/)
- [src/lib/audit/](../../src/lib/audit/)
- [src/lib/idempotency/](../../src/lib/idempotency/)
- [src/lib/sanitize/](../../src/lib/sanitize/)
- [src/lib/observability/metrics.ts](../../src/lib/observability/metrics.ts)
- [drizzle/migrations/0008_c4_outbox_core.sql](../../drizzle/migrations/0008_c4_outbox_core.sql)
- [drizzle/migrations/0009_c4_audit_partitioned.sql](../../drizzle/migrations/0009_c4_audit_partitioned.sql)
- [scripts/smoke-c4.ts](../../scripts/smoke-c4.ts)
