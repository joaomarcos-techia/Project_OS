# C16 — Inventário & Gap Analysis (FASE 0)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice mestre](../README.md).


> **Pré-requisito de auditoria da C16.** Este documento é a fonte da verdade do que
> **já existe** vs. o que **falta** para a camada de Observabilidade, Hardening e
> Production Readiness. Cada onda posterior (1–4) referencia o mapa Gap → Fase → Onda
> no fim deste arquivo.
>
> Data do levantamento: 2026-06-28. Stack: Next.js 15.5 (App Router, typedRoutes),
> Drizzle 0.36 + postgres-js, Supabase (Auth + Storage + Postgres), Vercel (deploy + cron).

---

## 1. Serviços / infraestrutura existentes (não refazer)

### 1.1 Camada de banco — `src/lib/db/index.ts`
Três instâncias Drizzle fisicamente distintas:

| Instância | Role | RLS | Uso |
|---|---|---|---|
| `db` (`runtimeClient`) | `authenticated` | **enforced** | APIs/Server Actions/read-models do usuário |
| `dbAdmin` (`adminClient`) | `service_role` | bypass | admin, cron, webhooks, scans cross-tenant |
| `dbWorker` (`workerClient`) | `service_role` | bypass | hot-loop do outbox (pool dedicado) |

- Conexão: SSL, `prepare=false` (Transaction Pooler), `statement_timeout=30s`, `lock_timeout=15s`.
- Guard de boot: `NODE_ENV=dev` + `DATABASE_URL` prod-like → erro fatal.
- `withTenant(clinicId, fn)` ([rls.ts](../../src/lib/db/rls.ts)) é a única forma de escopar de jobs/scripts (`SET LOCAL` GUC + role `authenticated`). Allowlist de `dbAdmin` por `eslint-plugin-boundaries`.

### 1.2 Outbox (event-driven) — `src/lib/outbox/`
- Tabela `outbox` (`src/lib/db/schema/infra/outbox.ts`), status `pending|processing|processed|failed|skipped`.
- Worker `runOutboxOnce()` ([worker.ts](../../src/lib/outbox/worker.ts)): advisory lock + padrão 3-TX (reserva `SKIP LOCKED` → handler sob RLS → finalize com guard token), backoff (ADR-011), `PoisonPillError` (fail imediato), circuit breaker por event_type, janitor de stuck > 5min.
- `UNIQUE(event_type, idempotency_key)` previne duplicação de enqueue.

### 1.3 Idempotência — `src/lib/idempotency/mutation.ts`
- Tabela `idempotency_keys` (global, PK = `key`, `expires_at` default 24h, CHECK de formato e tamanho ≤96KB).
- `idempotentMutation(key, fn)`: `lock_timeout=3s`, `INSERT ... ON CONFLICT DO NOTHING`, conflito → 409/425/cache; mutação + audit na mesma TX; grava `response`.

### 1.4 Audit forense — `src/lib/audit/`
- Tabela `audit_events` particionada por mês (RANGE em `created_at`); partição `default` é sentinela de falha de provisioning.
- `logAudit(tx, args)` ([log.ts](../../src/lib/audit/log.ts)): INSERT atômico com a mutação; `sanitizePayload` redige `before`/`after`; CHECK ≤64KB.
- Anonimização de PII no hard-delete (`anonymizePatientAuditTrail`, ADR-021).

### 1.5 Observabilidade atual — `src/lib/observability/metrics.ts`
- `metrics.emit(event, fields)`: linha JSON em `stdout` (`kind:'metric'`), todos os campos via `sanitizeFields` → `sanitizePayload` (redige Bearer/JWT/sk_/DSN). Síncrono e barato (hot loops).
- Comentário no código: *"Replaced with a real metrics SDK in C16 without changing the call sites."* → ponto de extensão da Onda 1.
- Catálogo de eventos em [README.md](../../src/lib/observability/README.md): `outbox.*`, `worker.tick`, `idempotency.*`, `audit.written`, `super_admin.action`, `cron.*`, `billing.*`, `retention.*`.

### 1.6 Correlation / request id — `src/lib/audit/request-context.ts`
- `buildRequestContext(headers)`: `ip` (x-real-ip → XFF), `requestId` (`x-request-id` → `x-vercel-id` → UUID v4), `correlationId` (`x-correlation-id` → requestId).
- `buildAgentRequestContext(...)`: contexto sintético do AI agent (sem HTTP), userAgent `clinicaos-ai-agent`.
- **`src/middleware.ts` NÃO carimba `x-request-id`** — só faz claims-drift (ADR-009). Stamping é gap (Onda 1.1).

### 1.7 Health checks
- [/api/health/outbox](../../src/app/api/health/outbox/route.ts): dois níveis (Bearer `CRON_SECRET` = mínimo; super_admin AAL2 = `failures_by_type`). Alarms: `outbox.failed>0`, `pending_age>300s`, `processing_age>600s`, `idem_orphans>0`, `audit_default_rows>1000`. `?strict=1`/`?alert=1` → 503.
- [/api/health/auth-hook](../../src/app/api/health/auth-hook/route.ts): self-test do custom access token hook. Mesma auth das irmãs (Bearer `CRON_SECRET` ou super_admin AAL2) desde o A1 da auditoria de APIs — era a única rota de health anônima. Auth das três em [health-auth.ts](../../src/lib/http/health-auth.ts).

### 1.8 Cron / heartbeats — `vercel.json` (15 jobs)

| Rota | Schedule | Função |
|---|---|---|
| `/api/cron/outbox` | `* * * * *` | dispatcher de eventos (worker) |
| `/api/cron/patient-hard-delete` | `0 3 * * *` | hard-delete LGPD pós 30d + anonimização |
| `/api/cron/audit-partitions` | `0 4 1 * *` | provisiona partições (3 meses à frente) |
| `/api/cron/cash-flow-rollup` | `30 3 * * *` | agregados diários de caixa |
| `/api/cron/metrics-rollup` | `0 5 * * *` | SLIs diários em `system_metrics_daily` (incl. `ia_error_rate`) |
| `/api/cron/financial-reconcile` | `*/15 * * * *` | fecha gaps de faturamento (R4) |
| `/api/cron/data-retention` | `0 5 1 * *` | purga outbox terminal >30d + login_attempts >90d |
| `/api/cron/invites-cleanup` | `0 6 * * *` | anonimiza convites >30d |
| `/api/cron/billing-dunning` | `0 8 * * *` | dunning D+3/D+7/D+15(readonly)/D+30(blocked) |
| `/api/cron/billing-reconcile` | `0 9 * * *` | corrige divergências com Asaas (safety-net webhook) |
| `/api/cron/proactive-reminders` | `*/15 11-23 * * *` | lembretes D-1 |
| `/api/cron/proactive-dunning` | `*/15 11-23 * * *` | cobranças proativas D+3/D+7 |
| `/api/cron/proactive-followup` | `*/15 11-23 * * *` | follow-up clínico |
| `/api/cron/proactive-waitlist` | `*/15 11-23 * * *` | oferta de vaga da lista de espera (WAIT-001) |
| `/api/cron/whatsapp-health` | `0 */6 * * *` | sonda read-only do canal Meta (META-001) |

- Auth + erro + correlação centralizados em [`withCron`](../../src/lib/http/cron.ts) (ADR-045): as 13 rotas repetiam o mesmo esqueleto à mão e todas esqueciam a mesma coisa — a exceção nunca chegava ao Sentry.
- `recordHeartbeat(job, status, detail)` → `cron_heartbeats` (best-effort, mas a falha de escrita agora emite `cron.heartbeat.write_failed` — antes era engolida, cegando o próprio SLO de liveness).
- ⚠️ Esta tabela omitia `metrics-rollup` até 2026-07-18 (achado M5). O gate `pnpm check:observability` agora reprova o merge se ela divergir do `vercel.json`.

### 1.9 Segurança / multi-tenant
- RLS FORCE + dual-context (`current_setting` / `auth.jwt`) — ADR-002/007; `defaultTenantPolicy` em [rls.ts](../../src/lib/db/rls.ts).
- Rate limit Upstash dual-window (IP + email_hash) com fallback in-memory fail-open.
- Cripto AES-256-GCM per-tenant (HKDF) + lookup HMAC (ADR-012).
- Auth Supabase SSR; JWT TTL 900s; MFA (AAL2) p/ super_admin; impersonation HMAC cookie.
- Webhook signatures: Meta HMAC-SHA256 (`x-hub-signature-256`); Asaas token const-time.

### 1.10 LGPD
- Consent versionado (`patient_consents.version_at`); export ZIP (bucket `lgpd-exports`); soft→hard-delete com cascade + anonimização sob `ON DELETE RESTRICT` (CFM 20 anos, ADR-017/021); `suppression_list` pós-delete.

### 1.11 Docs existentes
- **28 ADRs** (`docs/adr/000`–`028`). **16 runbooks** (`docs/runbooks/`): inclui `production-readiness`, `restore-test`, `secret-rotation`, `audit-retention`, `migrations` + `c0`–`c14` validation.
- Auditorias: `docs/audits/C11_IMPLEMENTATION_AUDIT.md`, `docs/audits/C11_ADVERSARIAL_50.md`.

---

## 2. Pontos críticos onde erros podem ocorrer

| Superfície | Local | Estado de rastreio |
|---|---|---|
| Server Actions (mutações) | `src/contexts/*/actions.ts` | erros tipados + `asConflict`; **sem envelope padrão** |
| Rotas API | `src/app/api/**` | retorno ad-hoc (`{ok:false,error:'internal'}`); **sem envelope** |
| Webhook Meta | [/api/webhooks/meta](../../src/app/api/webhooks/meta/route.ts) | HMAC + size guard; `metrics.emit` parcial |
| Webhook Asaas | [/api/webhooks/asaas](../../src/app/api/webhooks/asaas/route.ts) | token + `processed_webhooks` dedup |
| Crons (15) | `src/app/api/cron/**` | `withCron`: auth + correlação + `recordHeartbeat` + `metrics.emit` + **Sentry na exceção** (ADR-045) |
| Outbox worker | `src/lib/outbox/worker.ts` | rico em `metrics.emit`; sem Sentry/trace |
| Chamadas externas | Gemini / Meta / Asaas / Storage | timeout + classificação de erro; sem captura central |
| Render React / rotas | `src/app/**` | **sem `error.tsx`/`global-error.tsx`** |

---

## 3. Integrações externas e wrappers

| Provedor | Wrapper | Notas |
|---|---|---|
| Google Gemini | [gemini.ts](../../src/lib/ai/gemini.ts) | REST v1beta, `AbortSignal.timeout(AI_HTTP_TIMEOUT_MS)`, classifica 4xx (definitivo) vs timeout (retryable), retorna tokens |
| WhatsApp / Meta | [meta-cloud.ts](../../src/lib/messaging/meta-cloud.ts) + connection-store | HMAC, parse webhook; sender at-most-once (`idempotencyKey=jobId`) |
| Asaas (pagamentos) | [asaas.ts](../../src/contexts/billing/internal/providers/asaas.ts) | REST v3, circuit breaker in-memory, sem retry em POST |
| Supabase Storage | [clinical.ts](../../src/lib/storage/clinical.ts) | buckets `clinical-pdfs`/`admin-exports`/`lgpd-exports`, signed URLs |

---

## 4. Operações: com rastreabilidade vs. sem

**Com rastreio hoje** (`metrics.emit` e/ou `logAudit` e/ou `recordHeartbeat`): outbox (enqueue/processed/retry/failed/circuit), worker tick, idempotência, audit de mutações, ações super_admin, execução de crons, dunning/retention, webhooks billing.

**Sem rastreio adequado (gaps):**
- Exceções não tratadas (frontend/backend) → nenhum destino central (sem Sentry).
- Logs de nível (`debug/info/warn/error`) — `LOG_LEVEL` reservado, sem logger.
- Latência/percentis (API P95, webhook), taxa de erro IA — não medidos como SLI.
- Profundidade/idade de fila como **métrica nomeada** (dados existem só no health endpoint).
- Métricas de negócio diárias (pacientes/consultas/faturamento) — sem `system_metrics_daily`.

---

## 5. Riscos conhecidos
- Catálogo F-/HIGH-/MEDIUM- já documentado nas ADRs (ex.: F-03 skipped terminal, HIGH-11 circuit, HIGH-15 advisory lock, MEDIUM-19 health dual-auth).
- **Falha silenciosa de fila**: tudo responde 200, mas outbox parado → WhatsApp/IA não enviam (mitigado parcialmente pelo health, falta SLI+alerta nomeado).
- Sem captura central de exceções → incidentes descobertos manualmente.
- Sem CSP/HSTS → superfície de clickjacking/XSS maior.
- DR sem RTO/RPO formal → recuperação sem meta mensurável.

---

## 6. Gaps da C16 — estado real

> ⚠️ **Reconciliado em 2026-07-18 (achado N4).** Esta seção era um retrato
> congelado do levantamento de **2026-06-28** e nunca foi atualizada: listava
> como "gaps a construir" 15 itens que já estavam **em produção**. Quem lesse
> concluiria que a C16 não existe — e o `PROGRESS.md` afirmava o oposto na mesma
> semana. Inventário que não envelhece junto com o código é pior que ausência de
> inventário: ele mente com autoridade.

| # | Item | Estado |
|---|---|---|
| 1 | Sentry | ✅ em produção (`instrumentation.ts` + `sentry.*.config.ts`) |
| 2 | Logger cabeado por `LOG_LEVEL` | ✅ [logger.ts](../../src/lib/observability/logger.ts) |
| 3 | Error envelope `{error,code,message,trace_id,timestamp}` | ✅ [error-response.ts](../../src/lib/http/error-response.ts) |
| 4 | Error boundaries | ✅ `global-error.tsx` + `route-error.tsx` |
| 5 | `/api/health` unificado | ✅ — e desde 2026-07-18 com **alcançabilidade real** (`?deep=1`), não só presença de env (C2) |
| 6 | `system_metrics_daily` + rollup | ✅ — e agora escreve os **SLIs** que o `slo.md` cita, não só métricas de negócio (N2) |
| 7 | Cleanup de `idempotency_keys` | ✅ via `RETENTION_POLICIES` (ADR-043) |
| 8 | Security headers (CSP/HSTS) | ✅ `next.config.ts` (ADR-030; CSP em Report-Only por ora) |
| 9 | Runbooks de incidente | ✅ 30+ runbooks, incl. `redis-down.md` (M3) |
| 10 | Log drain + uptime | ⚠️ drain **ativo** (2026-07-16); **alerta/canal ainda aberto** — go-live #2 |
| 11 | `archive-old-messages` | ✅ resolvido por retenção, não arquivamento (ADR-043) |
| 12 | SLO/SLI formais | ✅ [slo.md](./slo.md) — 8 SLOs + MTTD/MTTR |
| 13 | Anti alert-fatigue | ✅ [alert-tuning.md](../runbooks/alert-tuning.md) |
| 14 | SLIs de fila | ✅ `/api/health/outbox` + `outbox_failed` no rollup |
| 15 | DR com RTO/RPO | ✅ RPO ≤ 24h / RTO ≤ 4h; PITR decidido como **não adotar** |
| 16 | Production rehearsal | ⏳ pendente (go-live #6) |

**O que resta de verdade:** o item 10 (canal de alerta — go-live #2) e o 16
(rehearsal). Tudo mais está no código.

---

## 7. Mapa Gap → Fase → Onda

| Gap | Fase C16 | Onda | Tipo |
|---|---|---|---|
| Error envelope + request_id stamping | 1 | 1 | BUILD |
| Logger fino in-house | 3 | 1 | BUILD |
| Sentry (client/server/edge) + alertas | 2 | 1 | BUILD + EXTERNAL |
| `/api/health` unificado + SLIs de fila (GAP 3) | 5 | 1 | BUILD |
| **SLO/SLI `slo.md` (GAP 1)** | — (nova) | 1 | BUILD |
| Better Stack (log drain + saved searches) | 4 | 2 | EXTERNAL |
| Uptime monitors | 6 | 2 | EXTERNAL |
| `system_metrics_daily` + rollup (inclui SLIs GAP 3) | 7 | 2 | BUILD |
| cleanup-idempotency-keys / archive-old-messages | 8 | 2 | BUILD |
| Runbooks (incl. `alert-tuning.md` GAP 2, DR RTO/RPO GAP 5) | 9 | 3 | BUILD |
| Security headers + **CSP faseada (GAP 4)** + testes multi-tenant | 10 | 3 | BUILD |
| LGPD gate (validar) | 11 | 3 | VALIDATE |
| ADRs da C16 | 12 | 3 | BUILD |
| Failure drills + **production rehearsal (GAP 6)** | 13 | 4 | VALIDATE |

**Já existentes (não refazer):** correlation id, `metrics.emit`, erros tipados, `audit-partitions`, `auto-suspend-overdue` (billing-dunning), `cron_heartbeats`, rate limit, webhook signatures, JWT 900s, LGPD (consent/export/delete), 28 ADRs, 16 runbooks.
