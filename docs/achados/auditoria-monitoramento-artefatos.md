# Artefatos de Correção — Monitoramento em Produção

> **Companheiro de** [`auditoria-monitoramento-producao.md`](./auditoria-monitoramento-producao.md). Onde a auditoria diz *o que* está faltando, este documento entrega os **artefatos prontos para aplicar**: configs de dashboard (copy-paste) e patches de código (diffs fiéis ao código real).
> **Data:** 2026-07-13 · **Natureza:** artefatos de remediação. Nada foi aplicado ao sistema — este é o material para você (ou uma sessão de implementação) aplicar via branch/PR normal.

## Como usar

- **Parte A** (C1 — alerting) é **config de dashboard** (Sentry / Better Stack / UptimeRobot / Vercel). **Não vai no repositório** — é a lacuna que o `go-live-checklist.md` #2 deixou aberta. É a de maior urgência (P0).
- **Partes B, C, D** são **patches de código**, com o caminho exato do arquivo e o diff. B e C foram escritos lendo os arquivos-alvo por completo (exatos). D é mais um *template guiado* (os arquivos de auth não foram diffados linha-a-linha).
- **Parte E** é a verificação (Definition of Done) e o mapeamento para o go-live #2.

**Placeholders** (substituir ao aplicar): `<PROD_URL>` = domínio de produção (ex.: `https://app.qoro.com.br`); `<CRON_SECRET>` = valor real de `CRON_SECRET`; `<OPERADOR_*>` = canal de notificação (e-mail / telefone / push / Telegram). O projeto Sentry já está identificado pelo DSN em `sentry.server.config.ts` (`.../4511646341726208`).

**Mapa achado → artefato:**

| Achado | Artefato | Tipo | Prioridade |
|---|---|---|---|
| C1 — alerting não wired | Parte A (uptime + Sentry + Better Stack) | dashboard | P0 |
| C2 — health cego a outage externo | Parte B (patch `/api/health`) | código | P0 |
| C3 — background não vai ao Sentry | Parte C (helper + apply-list) | código | P0/P1 |
| A1 — auth sem telemetria | Parte D.2 | código | P1 |
| A2 — correlação incompleta | Parte D.1/D.3 | código | P1 |

---

## Parte A — C1: Ligar o alerting (P0, dashboard-side)

> A instrumentação já existe; falta **a notificação**. Os endpoints já retornam 503 quando fora do SLO — basta um monitor externo apontando para eles, com um canal que te acorde.

### A.1 — Uptime monitors (Better Stack Uptime **ou** UptimeRobot)

Ambos os health endpoints exigem `Authorization: Bearer <CRON_SECRET>` (ver [`health/route.ts:46`](../../src/app/api/health/route.ts#L46)) e retornam **503** quando não-`ok` com `?strict=1` ([`health/route.ts:116`](../../src/app/api/health/route.ts#L116)).

**Monitor 1 — Saúde geral da aplicação (CRÍTICO):**

| Campo | Valor |
|---|---|
| Nome | `Qoro · app health` |
| URL | `<PROD_URL>/api/health?strict=1` |
| Método | `GET` |
| Header | `Authorization: Bearer <CRON_SECRET>` |
| Intervalo | 3 min |
| Sucesso | HTTP `200` |
| Alerta quando | HTTP `503` **ou** timeout **ou** 2 falhas consecutivas |
| Severidade | **CRÍTICO** → `<OPERADOR_TELEFONE/push>` (acorda) |
| Cobre | app no ar + `db` up + `outbox` dentro do SLO + (após Parte B) dependências externas alcançáveis |

**Monitor 2 — Saúde da fila / anti-falha-silenciosa (CRÍTICO):**

| Campo | Valor |
|---|---|
| Nome | `Qoro · outbox queue` |
| URL | `<PROD_URL>/api/health/outbox?strict=1` |
| Método | `GET` |
| Header | `Authorization: Bearer <CRON_SECRET>` |
| Intervalo | 3 min |
| Alerta quando | HTTP `503` (alarms `pending_age>300s` / `processing_age>600s` / `failed>0`) |
| Severidade | **CRÍTICO** → `<OPERADOR_TELEFONE/push>` |
| Cobre | SLO #5 de `slo.md` — lembretes/IA parados enquanto tudo responde 200 |

> **Por que dois monitores separados:** o Monitor 2 é a rede contra a falha silenciosa mais perigosa de um SaaS de WhatsApp (fila parada). Ele merece disparo próprio mesmo com o Monitor 1 verde.

**Escalonamento (ambos):** notificação imediata em canal que interrompe (ligação/SMS/push do Better Stack app ou Telegram), com repetição a cada 5 min até ack. E-mail sozinho **não** cumpre "acordar o operador".

### A.2 — Sentry Alert Rules (fecha o item literal do go-live #2)

> O checklist pede *"salvar a Alert Rule com env=production + garantir o canal"*. O tag de ambiente vem de `environment: process.env.NODE_ENV` ([`sentry.server.config.ts:17`](../../sentry.server.config.ts#L17)) → em produção na Vercel é `production`.

**Regra 1 — Nova issue de erro em produção (Issue Alert):**

```
WHEN   a new issue is created
IF     the event's environment  equals  production
THEN   send a notification to   <OPERADOR_channel>
       (rate limit: no more than 1 notification per 30 min per issue)
```
Torna-se acionável assim que a **Parte C** for aplicada (background → Sentry). Antes disso, captura os erros já lançados (RSC/Server Actions/boundaries).

**Regra 2 — Surto de erros (Metric Alert):**

```
Dataset: errors
WHEN   count() of events
       filtered by  environment:production
       is  above  20
       in a 5-minute window
THEN   critical  → <OPERADOR_channel>
       warning (above 5 / 5 min) → e-mail
```
Thresholds conservadores para evitar *alert fatigue* — recalibrar após ~4 semanas (INFO-1 da auditoria).

**Opcional — como código (Terraform `sentry_metric_alert`), se preferir versionar:**

```hcl
resource "sentry_metric_alert" "error_surge_prod" {
  organization = "<SENTRY_ORG>"
  project      = "<SENTRY_PROJECT>"
  name         = "Qoro · error surge (prod)"
  dataset      = "events"
  query        = "environment:production"
  aggregate    = "count()"
  time_window  = 5
  trigger {
    label            = "critical"
    threshold_type   = 0      # above
    alert_threshold  = 20
    action { type = "email" target_type = "team" target_identifier = "<TEAM_ID>" }
  }
}
```

### A.3 — Better Stack: saved searches + log alerts

Os logs são JSON com `kind`, `event`, `level` e campos ([`metrics.ts`](../../src/lib/observability/metrics.ts)). Os nomes de evento abaixo são **reais** (extraídos do código). Crie uma *saved search* + alerta por volume para cada:

| Nome | Query | Alertar quando | Severidade |
|---|---|---|---|
| Erros top-level (catch-all) | `event:*.error` | `> 10 / 5min` | ALERTA |
| DLQ da fila (crítico) | `event:"outbox.failed"` | **qualquer `> 0`** | CRÍTICO |
| Worker travado | `event:"worker.error"` | `> 0 / 5min` | CRÍTICO |
| Webhooks | `event:"messaging.webhook.error" OR event:"billing.webhook.error"` | `> 3 / 10min` | ALERTA |
| Circuito Asaas / provider | `event:"billing.asaas.unreachable" OR event:"billing.asaas.http_5xx" OR event:"outbox.circuit.opened"` | `> 0 / 5min` | ALERTA |
| IA / jobs proativos | `event:"proactive.job.failed" OR event:"ai_agent.tool.handler_error"` | taxa `> 5% / 10min` | ALERTA |
| Auth (após Parte D.2) | `event:"auth.login.failed"` | `> 20 / 5min` (brute-force) | CRÍTICO |
| Cron não-autorizado | `event:"cron.unauthorized"` | `> 0` | ALERTA (segurança) |
| Origem de cron ausente | `event:"cron.origin_header_missing"` | `> 0` | INFO |

> **SLO de IA (Gemini < 2%, `slo.md §4`):** a fonte formal é `ia_error_rate` em `system_metrics_daily` (rollup diário). Para um sinal **em tempo real**, use a linha "IA / jobs proativos" acima. Confirme o nome exato do evento de erro do provider ao ligar (o classificador está em [`gemini.ts`](../../src/lib/ai/gemini.ts)).

### A.4 — Vercel (checklist operacional, uma vez)

- [ ] **Log Drain → Better Stack** conectado (Project → Settings → Log Drains). Sem isso, as saved searches de A.3 não têm dados. (Não é configurável no repo — por isso é checklist.)
- [ ] **Spend Management** com limite + alerta de gasto (protege contra loop de cron/erro custoso).
- [ ] **Deployment Notifications** → canal do operador (correlacionar incidente↔deploy).
- [ ] (opcional) **Vercel WAF** rate-limit nas rotas `/api/webhooks/*` e `/api/health`.

---

## Parte B — C2: `/api/health` enxergar outage externo real (P0, código)

**Arquivo:** [`src/app/api/health/route.ts`](../../src/app/api/health/route.ts)

**Ideia:** manter o check default **leve** (presença de env) para o polling de 1 min, e adicionar um **deep check** de *reachability* (com timeout curto + cache de 60s para não martelar provedores) usado quando `?deep=1` **ou** `?strict=1`/`?alert=1` (que é o que o uptime monitor usa). Dependência externa indisponível → `degraded` (nunca `down` — só o banco derruba tudo, mantendo a semântica atual).

**Patch (adicionar; substitui o bloco `checkConfig` dos externos):**

```ts
// --- Deep reachability (C2) -------------------------------------------------
// Cache por instância p/ não martelar provedores a cada poll. TTL 60s.
type Ext = { gemini: CheckStatus; meta: CheckStatus; asaas: CheckStatus };
let extCache: { at: number; val: Ext } | null = null;
const EXT_TTL_MS = 60_000;
const PING_TIMEOUT_MS = 2_000;

/** ok = alcançável e credencial aceita; degraded = ausente/inválido/indisponível. */
async function pingGemini(): Promise<CheckStatus> {
  if (!env.GEMINI_API_KEY) return 'degraded';
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`,
      { signal: AbortSignal.timeout(PING_TIMEOUT_MS) },
    );
    return res.ok ? 'ok' : 'degraded'; // 4xx = key inválida; 5xx = provider mal
  } catch {
    return 'degraded'; // timeout/rede
  }
}

async function pingMeta(): Promise<CheckStatus> {
  if (!env.META_APP_SECRET) return 'degraded';
  try {
    // Graph root: qualquer resposta HTTP prova reachability (sem vazar token).
    const res = await fetch(
      `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/`,
      { signal: AbortSignal.timeout(PING_TIMEOUT_MS) },
    );
    return res.status < 500 ? 'ok' : 'degraded';
  } catch {
    return 'degraded';
  }
}

async function pingAsaas(): Promise<CheckStatus> {
  if (!env.ASAAS_API_KEY) return 'degraded';
  try {
    const res = await fetch(`${env.ASAAS_BASE_URL}/myAccount`, {
      headers: { access_token: env.ASAAS_API_KEY },
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    return res.ok ? 'ok' : 'degraded'; // 401/403 = key inválida
  } catch {
    return 'degraded';
  }
}

async function checkExternals(deep: boolean): Promise<Ext> {
  if (!deep) {
    return {
      gemini: checkConfig(Boolean(env.GEMINI_API_KEY)),
      meta: checkConfig(Boolean(env.META_APP_SECRET)),
      asaas: checkConfig(Boolean(env.ASAAS_API_KEY)),
    };
  }
  if (extCache && Date.now() - extCache.at < EXT_TTL_MS) return extCache.val;
  const [gemini, meta, asaas] = await Promise.all([pingGemini(), pingMeta(), pingAsaas()]);
  const val = { gemini, meta, asaas };
  extCache = { at: Date.now(), val };
  return val;
}
```

**No `GET`, trocar a montagem de `checks`:**

```ts
  const qp = new URL(req.url).searchParams;
  const strict = qp.get('strict') === '1' || qp.get('alert') === '1';
  const deep = strict || qp.get('deep') === '1'; // monitor usa ?strict=1 → deep

  const db = await checkDb();
  // ...bloco de SLIs de outbox permanece igual...

  const ext = await checkExternals(deep);
  const checks: Record<'db' | 'gemini' | 'meta' | 'asaas' | 'outbox', CheckStatus> = {
    db,
    gemini: ext.gemini,
    meta: ext.meta,
    asaas: ext.asaas,
    outbox,
  };
```

> **Notas de implementação:**
> - `/myAccount` é o probe autenticado canônico do Asaas; confirme contra o que `ASAAS_BASE_URL` já inclui (versão). Alternativa: reusar o `CircuitBreaker` do provider (mas é in-memory por instância).
> - O deep check nunca marca externo como `down` — externo degradado é `degraded` (só `db` é `down`), preservando a semântica de `slo.md`.
> - Atualizar `docs/runbooks/gemini-down.md` e `meta-template-rejected.md`: `/api/health?deep=1` **agora** reflete outage real (antes só refletia env ausente).
> - Adicionar teste: mock `fetch` → timeout ⇒ `degraded`; 200 ⇒ `ok`.

---

## Parte C — C3: Exceções de background no Sentry + preservar stack (P0/P1, código)

**Passo 1 — Helper novo:** `src/lib/observability/capture.ts`

```ts
import * as Sentry from '@sentry/nextjs';

/**
 * Envia uma exceção capturada (não relançada) ao Sentry, preservando o STACK
 * real. Usar nos catches de background (webhooks, crons, worker) que hoje só
 * emitem métrica e retornam 500 — esses erros nunca chegam ao Sentry via
 * `onRequestError` porque não são relançados.
 *
 * PII: o `beforeSend`/`scrubEvent` já redige request/extra/contexts. Passe o
 * `err` cru (com stack); NÃO pré-sanitize aqui (senão perde o stack — é o bug
 * de `sanitizeFields`, que continua valendo só para o stream de métricas).
 */
export function captureBackgroundError(
  err: unknown,
  ctx: { flow: string; clinicId?: string; requestId?: string } & Record<string, unknown>,
): void {
  Sentry.captureException(err, {
    tags: {
      flow: ctx.flow,
      ...(ctx.clinicId ? { clinicId: ctx.clinicId } : {}),
      ...(ctx.requestId ? { request_id: ctx.requestId } : {}),
    },
    extra: ctx,
  });
}
```

**Passo 2 — Aplicar nos catches (padrão idêntico, um por local):**

```ts
// ANTES
} catch (err) {
  metrics.emit('billing.webhook.error', { event: parsed.event, error: err });
  return new Response('internal error', { status: 500 });
}

// DEPOIS
} catch (err) {
  captureBackgroundError(err, { flow: 'billing.webhook', event: parsed.event });
  metrics.emit('billing.webhook.error', { event: parsed.event, error: err });
  return new Response('internal error', { status: 500 });
}
```

**Apply-list (locais exatos, `flow` sugerido):**

| Arquivo:linha | Evento atual | `flow` |
|---|---|---|
| [`api/webhooks/asaas/route.ts:129`](../../src/app/api/webhooks/asaas/route.ts#L129) | `billing.webhook.error` | `billing.webhook` |
| [`api/webhooks/asaas/route.ts:61`](../../src/app/api/webhooks/asaas/route.ts#L61) | *(400 silencioso — adicionar `metrics.emit('billing.webhook.parse_error')`)* | `billing.webhook.parse` |
| [`api/webhooks/meta/route.ts:139`](../../src/app/api/webhooks/meta/route.ts#L139) | `messaging.webhook.error` | `messaging.webhook` |
| [`api/cron/outbox/route.ts:72`](../../src/app/api/cron/outbox/route.ts#L72) | `worker.error` | `cron.outbox` |
| `api/cron/financial-reconcile/route.ts` (catch `financial.reconcile.error`) | `financial.reconcile.error` | `cron.financial-reconcile` |
| `api/cron/billing-reconcile/route.ts` | `billing.reconcile.error` | `cron.billing-reconcile` |
| `api/cron/billing-dunning/route.ts` | `billing.dunning.error` | `cron.billing-dunning` |
| `api/cron/data-retention/route.ts` | `retention.error` | `cron.data-retention` |
| `api/cron/invites-cleanup/route.ts` | `invites_cleanup.error` | `cron.invites-cleanup` |
| `api/cron/cash-flow-rollup/route.ts` | `financial.cash_flow_rollup.error` | `cron.cash-flow-rollup` |
| `api/cron/metrics-rollup/route.ts` | `observability.metrics_rollup.error` | `cron.metrics-rollup` |
| `api/cron/audit-partitions/route.ts` | `cron.audit_partitions.error` | `cron.audit-partitions` |
| `api/cron/patient-hard-delete/route.ts` | `patient.hard_delete.error` | `cron.patient-hard-delete` |
| `api/cron/proactive-{reminders,followup,dunning}/route.ts` | `proactive.*.error` | `cron.proactive-*` |

> **Efeito:** o stack trace fica **no Sentry** (via `captureException(err)` com o Error cru), enquanto o stream de métricas continua com `{name, message}` — o descarte de stack em [`sanitize-fields.ts:19-23`](../../src/lib/observability/sanitize-fields.ts#L19) deixa de ser cegueira total, porque o Sentry passa a ser a fonte do stack. A Regra 1 do Sentry (A.2) então dispara nesses erros.
> **Alternativa mínima (se preferir 1 linha):** em vez do helper, `import * as Sentry` e `Sentry.captureException(err)` direto — mas o helper padroniza tags (`flow`/`clinicId`) e facilita a correlação.

---

## Parte D — A1/A2: Telemetria de auth + correlação (P1, código — template guiado)

> Estes arquivos não foram diffados linha-a-linha na auditoria; abaixo está o **catálogo de eventos e onde inseri-los**. Trate como guia, não como diff exato.

### D.1 — Correlação: `clinicId`/`userId`/`request_id` nas métricas de idempotência (A2)

**Arquivo:** [`src/lib/idempotency/mutation.ts`](../../src/lib/idempotency/mutation.ts) — `clinicId` e `userId` já estão em escopo (linhas ~166-167). Incluir nos emits:

```ts
// ANTES
metrics.emit('idempotency.conflict', { key: opts.idempotency.key });
// DEPOIS
metrics.emit('idempotency.conflict', { key: opts.idempotency.key, clinicId, userId });
```
Aplicar aos 6 emits: `lock_timeout` (`:177`), `in_flight` (`:192`,`:200`), `conflict` (`:196`), `hit` (`:203`), `completed` (`:231`). Idealmente propagar `requestContext.requestId` também (já chega via `opts.audit.requestContext`).

### D.2 — Eventos de auth/segurança (A1)

Inserir nos ramos de falha (sem PII — só motivo/flags):

| Evento | Onde (arquivo) | Campos |
|---|---|---|
| `auth.login.failed` | `src/app/(app)/login/actions.ts` (ramo de credencial inválida) | `reason`, `clinicId?` |
| `auth.ratelimit.tripped` | onde o `@upstash/ratelimit` bloqueia (login/rotas sensíveis) | `route`, `identifierHash` |
| `auth.mfa.failed` | `src/app/(app)/login/mfa/actions.ts:~30` | `reason` |
| `auth.claims.drift_logout` | `src/middleware.ts` (ramo de drift→logout) | `clinicId`, `userId` |
| *(trocar swallow)* | `login/actions.ts:88` (audit RPC falha) → `logger.error('auth.login_audit_failed', { error })` | — |

Alimenta a saved search "Auth" de A.3 (alerta de brute-force).

### D.3 — Correlação no Sentry (A3, baixo custo)

No `src/middleware.ts` (onde já carimba `x-request-id`), adicionar tag global:
```ts
import * as Sentry from '@sentry/nextjs';
Sentry.setTag('request_id', requestId);
```
Restaura a promessa do ADR-029 (correlação Sentry↔log↔audit pelo mesmo `request_id`), hoje quebrada porque o `scrubEvent` apaga os headers.

---

## Parte E — Verificação (Definition of Done)

**C1 (Parte A):**
- [ ] Forçar `Monitor 1` a falhar: chamar `/api/health?strict=1&deep=1` com uma env externa removida em *staging* → 503 → **confirmar que a notificação chegou no canal do operador** (o teste real do go-live #2).
- [ ] `outbox.failed` de teste (ou parar o worker em staging) → `Monitor 2` 503 → notificação.
- [ ] Enviar um erro de teste ao Sentry (`Sentry.captureException(new Error('drill'))` numa rota protegida) com `environment=production` → Regra 1 dispara.
- [ ] Better Stack recebendo logs (A.4) e a saved search `event:*.error` retornando linhas.

**C2 (Parte B):** teste unitário com `fetch` mockado (timeout ⇒ `degraded`; 200 ⇒ `ok`); smoke manual `/api/health?deep=1` com uma key inválida ⇒ `degraded`.

**C3 (Parte C):** disparar um erro num webhook em staging (payload malformado que passe do parse) ⇒ **aparece no Sentry com stack** + tag `flow`.

**Mapeamento go-live `#2`:** aplicar Parte A.1 + A.2 fecha literalmente *"salvar a Alert Rule com env=production + garantir o canal de notificação no Uptime"*. Atualizar `docs/c16/go-live-checklist.md` marcando #2 e anexando print do disparo de teste.

---

## Parte F — Ordem de aplicação sugerida (PRs)

1. **PR-1 (dashboard, sem código):** Parte A — uptime monitors + Sentry rules + Better Stack searches + Vercel log drain. *Destrava o go-live.* Zero risco de deploy.
2. **PR-2 (código):** Parte C — helper `capture.ts` + apply-list nos catches de background. Baixo risco, alto impacto no MTTR.
3. **PR-3 (código):** Parte B — deep health check. Testar reachability em staging antes.
4. **PR-4 (código):** Parte D — correlação (D.1/D.3) + eventos de auth (D.2).

Ao aplicar, dobrar o conteúdo relevante nos runbooks existentes (`log-search.md` ← A.3; `alert-tuning.md` ← A.2; `gemini-down.md`/`meta-template-rejected.md` ← Parte B) e reconciliar o drift do achado **M5**.
