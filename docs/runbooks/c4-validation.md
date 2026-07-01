# C4 — Runbook de Validação

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).


> Re-executável após qualquer mudança em `src/lib/outbox/**`, `src/lib/audit/**`,
> `src/lib/idempotency/**`, `src/lib/sanitize/**`, `src/lib/observability/**`,
> `src/app/api/cron/outbox/**`, `src/app/api/health/outbox/**`, ou
> `drizzle/migrations/0008_*` / `0009_*`.

## Pré-requisitos

- [x] C3 fechada (`docs/PROGRESS.md` mostra ✅).
- [x] `qoro-dev` Supabase project acessível via `DATABASE_URL`.
- [x] Env vars C4 setados em `.env.local`:
  - `CRON_SECRET` (min 32 chars, gere com `openssl rand -hex 32`)
  - `OUTBOX_BATCH_SIZE` (opcional; default 50)
  - `OUTBOX_PARALLELISM` (opcional; default 5)

## Passo 0 — Bootstrap

```bash
# 1. Migrations
pnpm db:migrate:dev
# Esperado: ✅ 0008, 0009 applied

# 2. Smoke (estrutural + 17 testes funcionais 4.6.x)
pnpm smoke:c4
# Esperado: ✅ smoke-c4: N/N passed; 0 failed
```

Se algum check do smoke falhar, NÃO marque C4 como fechada — fixe e re-rode.

## Passo 1 — Conferir partitions de audit_events

```bash
psql "$DATABASE_URL" --no-psqlrc -X -c "
  SELECT inhrelid::regclass AS partition
  FROM pg_inherits
  WHERE inhparent='public.audit_events'::regclass
  ORDER BY 1;
"
```

Esperado: 13 linhas (12 mensais 2026-05 → 2027-04 + `audit_events_default`).

## Passo 2 — Conferir RLS state das 4 tabelas

```bash
psql "$DATABASE_URL" --no-psqlrc -X -c "
  SELECT relname, relrowsecurity AS rls, relforcerowsecurity AS forced
    FROM pg_class
   WHERE relname IN ('outbox','audit_events','super_admin_actions','idempotency_keys')
   ORDER BY 1;
"
```

Esperado: `t,t` para todas as quatro.

## Passo 3 — Conferir policies (catálogo)

```bash
psql "$DATABASE_URL" --no-psqlrc -X -c "
  SELECT polrelid::regclass AS tbl, polname, polcmd
    FROM pg_policy
   WHERE polrelid::regclass::text IN ('outbox','audit_events','super_admin_actions','idempotency_keys')
   ORDER BY 1, 3, 2;
"
```

Esperado:
- `outbox`: 2 policies → `outbox_tenant_insert` (cmd=a), `outbox_tenant_select` (cmd=r)
- `audit_events`: 2 policies → `audit_events_tenant_insert` (a), `audit_events_tenant_select` (r)
- `super_admin_actions`: 2 policies → `super_admin_actions_super_insert` (a), `super_admin_actions_super_select` (r)
- `idempotency_keys`: 1 policy → `idempotency_keys_tenant_access` (*)

Sem policy de UPDATE/DELETE em outbox/audit_events/super_admin_actions = FORCE RLS bloqueia. Worker mexe via dbAdmin (BYPASSRLS).

## Passo 4 — Conferir CHECK constraints

```bash
psql "$DATABASE_URL" --no-psqlrc -X -c "
  SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
   WHERE conrelid::regclass::text IN ('outbox','idempotency_keys')
     AND contype='c'
   ORDER BY 1, 2;
"
```

Esperado: 5 constraints — `outbox_event_type_format_chk`, `outbox_last_error_size_chk`, `outbox_error_code_format_chk`, `idempotency_keys_key_format_chk`, `idempotency_keys_response_size_chk`.

## Passo 5 — Smoke E2E (re-executável)

```bash
pnpm smoke:c4
```

Esperado: todos os 17 testes 4.6.x + pre-flight passam.

## Validação registry completeness (pré-deploy obrigatório)

```bash
pnpm check:registry              # warning em DEV, fatal em PROD
pnpm check:registry:strict       # fatal sempre
```

Cenário que isto previne: dev adiciona `registerEventSchema('clinical.prescription.signed', ...)` mas esquece de importar o handler em `src/app/api/cron/outbox/handlers.ts` → eventos publicados ficam failed silenciosamente. Script falha o deploy.

## Bateria 4.6.x — Mapeamento de testes

| # | Teste | O que prova |
|---|---|---|
| 4.6.1 | publishEvent atômico | TX rollback rola outbox; commit grava row pending |
| 4.6.1b | publishEvent commita | Row aparece como pending |
| 4.6.2 | Worker SKIP LOCKED + parallelism | 5 events processados exatamente 1x cada sob 2 workers concorrentes |
| 4.6.3 | Backoff schedule | `[0, 30s, 5m, 30m, 6h, FAIL]` retornado por backoffDelayMs |
| 4.6.3b | DLQ metadata | `first_failed_at`/`last_failed_at`/`error_code` populados pelo worker |
| 4.6.4 | publishEvent dedup | Unique violation engolida silenciosamente |
| 4.6.5 | publishEvent invalid payload | OutboxError |
| 4.6.6 | publishEvent unknown eventType | OutboxError |
| 4.6.7 | capJsonSize | Pequeno passa; >64KB vira envelope |
| 4.6.8 | payloadHash | Determinístico em ordem de keys + NFC normalize |
| 4.6.9 | assertJsonSafe | Rejeita Date / BigInt / NaN |
| 4.6.10 | sanitizePayload key-level | SENSITIVE_KEYS → [REDACTED] |
| 4.6.11 | sanitizePayload value-level | Bearer/JWT/sk_/DSN → [REDACTED_*] |
| 4.6.12 | redactStringValue | Mesma defesa em strings que metrics.emit usa |
| 4.6.13 | serializeError | Cap 4000 + marker `[truncated]` |
| 4.6.14 | Circuit breaker | 10 failures em 5min → pending pushed +5min |
| 4.6.15 | Janitor | processing > 5min → pending |
| 4.6.16 | withTenant cross-tenant | 10 TXs paralelas; zero bleed |
| 4.6.17 | Cron 401 sem Bearer | Auth obrigatório |
| 4.6.17b | Cron 200 com Bearer | Tick saudável |
| 4.6.18 | TX3 guard janitor reclaim | CRITICAL-01 — UPDATE conditional rejeita quando processing_started_at mudou |
| 4.6.19 | Cleanup respects in-flight | CRITICAL-02 — DELETE filtra response IS NOT NULL |
| 4.6.19b | diagnoseInFlightOrphans idempotent | Diagnóstico não muta estado |
| 4.6.20 | HandlerCtx eventId + attempt | CRITICAL-03 — handler recebe eventId+attempt |
| 4.6.21 | PoisonPillError | HIGH-14 — vai direto para failed, sem queimar attempts |
| 4.6.22 | Payload size cap | HIGH-07 — > 64KB rejeitado em publishEvent |
| 4.6.23 | Key collision detection | HIGH-16 — mesma key + payload diferente → OutboxError |
| 4.6.24 | Advisory lock anti-overlap | HIGH-15 — ticks paralelos coordenados |
| 4.6.25 | Cron dual-factor | HIGH-08 — x-vercel-cron header + Bearer |
| 4.6.26 | makeProviderIdempotencyKey | CRITICAL-04 — deterministic dedup key para APIs externas |
| 4.6.27 | lock_timeout env config | HIGH-05 — env override aplicado |
| 4.6.28 | validateTtlSeconds (idempotency TTL configurável) | ADR-011 §41 — ttlSeconds entre 60s e 30d |
| 4.6.29 | withProviderStatusCheck (4 estados) | ADR-011 §42 — provider sem idempotency-key support |

## Operações manuais (MVP)

> **Onde rodar os comandos abaixo:**
>
> - Blocos marcados `sql` → cole no **Supabase Dashboard → SQL Editor** (mais simples) OU em **`pnpm db:studio`** (Drizzle Studio local).
> - Blocos marcados `bash` → terminal Unix/macOS. **PowerShell precisa de adaptação**: use `$env:DATABASE_URL` em vez de `$DATABASE_URL`, e use `Select-String` em vez de `grep`.
>
> Errar isso é o que produz erros como `senha falhou para usuário "joaom"` (psql não recebeu URL) ou `'<' reservado para uso futuro` (SQL caiu no parser do PowerShell em vez do psql).


### Conferir partition sizes
```sql
SELECT relname, pg_size_pretty(pg_relation_size(relname::regclass)) AS size
  FROM pg_class
 WHERE relname LIKE 'audit_events_%'
 ORDER BY 1;
```

### Detach + archive de partição vencida (mensal manual)
```bash
# 1. DETACH (mantém os dados, mas remove a partition vinculation)
psql "$DATABASE_URL" -c "ALTER TABLE audit_events DETACH PARTITION audit_events_2026_05;"

# 2. Backup
pg_dump "$DATABASE_URL" --table=public.audit_events_2026_05 --data-only \
  | gzip > backups/audit_events_2026_05.sql.gz

# 3. DROP (libera storage)
psql "$DATABASE_URL" -c "DROP TABLE audit_events_2026_05;"
```

### Criar próxima partition mensal (manual MVP)
```sql
CREATE TABLE audit_events_2027_05 PARTITION OF audit_events
  FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
```

### Cleanup idempotency_keys expirados — CRITICAL-02 ⚠️

**NUNCA rodar `DELETE FROM idempotency_keys WHERE expires_at < now()` direto.**
O DELETE puro deletaria rows in-flight (response IS NULL) expiradas — quebra exactly-once em retry tardio. O trigger `trg_prevent_delete_in_flight_idempotency` no banco bloqueia rows com response IS NULL + created_at < 1h, mas a forma correta é usar o cleanup module que filtra por `response IS NOT NULL`.

**Preferido — via script TS (semanal):**
```bash
pnpm idempotency:cleanup            # roda + imprime resultado
pnpm idempotency:cleanup --dry-run  # só diagnóstico
```

**Em SQL Editor (ad-hoc):**
```sql
-- 1) Diagnostic: rows in-flight órfãs (response IS NULL + criadas > 1h)
SELECT key, clinic_id, created_at,
       extract(epoch FROM (now() - created_at)) / 60 AS age_minutes
  FROM idempotency_keys
 WHERE response IS NULL
   AND created_at < now() - interval '1 hour'
 ORDER BY created_at
 LIMIT 100;
-- Investigue antes de deletar manualmente.

-- 2) Cleanup seguro (filtra response IS NOT NULL):
DELETE FROM idempotency_keys
 WHERE expires_at < now()
   AND response IS NOT NULL;
```

### Replay manual de evento `failed`
```sql
-- Lista failures recentes para escolher candidatos:
SELECT id, event_type, error_code, attempts, last_error
  FROM outbox
 WHERE status='failed'
 ORDER BY last_failed_at DESC
 LIMIT 20;

-- Replay (reseta attempts e empurra next_attempt_at para agora):
UPDATE outbox
   SET status='pending',
       attempts=0,
       next_attempt_at=now(),
       last_error=null,
       error_code=null,
       first_failed_at=null,
       last_failed_at=null
 WHERE id='<uuid>';
```

### Reset manual de circuit breaker
```sql
-- Após corrigir o handler bugado: traz pending de volta para a fila.
UPDATE outbox
   SET next_attempt_at=now()
 WHERE event_type='<event_type>'
   AND status='pending'
   AND last_error LIKE '%circuit-paused%';
```

### Reclaim stuck manual
```sql
-- Mesma query do janitor — invocável via psql se cron estiver down.
UPDATE outbox
   SET status='pending', processing_started_at=null, next_attempt_at=now(),
       last_error = coalesce(last_error, '') || ' [reclaimed-manual]'
 WHERE status='processing'
   AND processing_started_at < now() - interval '5 minutes';
```

### Investigar failures por type (top 20 últimas 24h)
```sql
SELECT event_type, error_code, count(*) AS n
  FROM outbox
 WHERE status='failed'
   AND last_failed_at > now() - interval '24 hours'
 GROUP BY 1, 2
 ORDER BY n DESC
 LIMIT 20;
```

Ou via endpoint:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "$APP_URL/api/health/outbox" | jq '.failures_by_type'
```

## Pitfalls operacionais

| Sintoma | Causa | Ação |
|---|---|---|
| Cron 401 | `CRON_SECRET` em Vercel env ≠ `.env.local` | Conferir Vercel Project Settings → Environment Variables |
| Audit insert falha com "no partition" | Clock skew para fora dos ranges; partições vencidas | Conferir `audit_events_default` count (healthcheck); criar próxima partition |
| `IdempotencyInFlightError` no cliente | Outra request com mesma key em andamento | Cliente backoff + retry (exponencial, max 3) |
| Lock timeout em idempotency | fn() demora > 3s segurando o lock | Investigar — fn() deve ser breve (mutação local + outbox + audit, sem chamada externa) |
| Particionamento esgotando | Healthcheck `default_partition_rows > 0` é red flag | Criar próximas partições antes que 2027-04 esgote |
| `oldest_processing_age_s` alto no healthcheck | Worker matou no meio do processing; janitor deveria reclamar em ≤5min | Conferir se cron está rodando; trigger manual via `curl /api/cron/outbox` |
| Circuit breaker pausando event_type válido | Falso positivo (10 falhas legítimas + 1 pending) | Investigar handler; `UPDATE outbox SET next_attempt_at=now() WHERE event_type='<X>' AND last_error LIKE '%circuit-paused%'` |
| `_journal.json` divergente entre dev e prod | Migration aplicada em prod sem ser commitada em dev | `pnpm db:migrate:prod` exige journal commitado; conferir git status |

## Troubleshooting rápido (healthcheck primeiro)

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/health/outbox" | jq
```

Resposta saudável (sem backlog):
```json
{
  "ok": true,
  "outbox": { "pending": 0, "processing": 0, "failed": 0, "oldest_pending_age_s": 0, ... },
  "failures_by_type": [],
  "audit": { "default_partition_rows": 0 },
  "idempotency": { "in_flight": 0, "expired": 0 }
}
```

Sinais de alerta:
- `outbox.pending > 1000` → cron parou? worker quebrou?
- `outbox.oldest_pending_age_s > 600` → backlog tóxico
- `outbox.processing > 0` por mais de 1 tick → suspeita de stuck (janitor deveria pegar)
- `outbox.failed > 0` → investigar `failures_by_type`
- `audit.default_partition_rows > 0` → range partitions vencidas
- `idempotency.in_flight > 100` → lock contention; investigar fn() lenta
- `idempotency.expired > 10_000` → rodar cleanup manual

## Pré-merge checklist (anti-hidra)

- [ ] `pnpm smoke:c4` passa (todos 17 + pre-flight).
- [ ] `pnpm typecheck` limpo.
- [ ] `pnpm lint` limpo.
- [ ] `pnpm smoke:c3` ainda verde (não regredimos C3).
- [ ] Greps anti-hidra abaixo (ESLint deve barrar reintrodução; estes são confirmação manual):

**Em bash/macOS/Linux:**
```bash
grep -rn "\.insert(outbox)" src/      # → apenas src/lib/outbox/publish.ts
grep -rn "\.insert(auditEvents)" src/ # → apenas src/lib/audit/log.ts
grep -rn "auditableAction" src/       # → 0 hits
```

**Em PowerShell (Windows):**
```powershell
Get-ChildItem -Path src -Filter *.ts -Recurse | Select-String "\.insert\(outbox\)"
Get-ChildItem -Path src -Filter *.ts -Recurse | Select-String "\.insert\(auditEvents\)"
Get-ChildItem -Path src -Filter *.ts -Recurse | Select-String "auditableAction"
```

- [ ] Vercel env tem `CRON_SECRET`, `OUTBOX_BATCH_SIZE`, `OUTBOX_PARALLELISM`.
- [ ] ADR-011 escrito e linkado por ADR-003.
- [ ] PROGRESS.md atualizado.
