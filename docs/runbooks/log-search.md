# Runbook — Busca de Logs (Better Stack) e Uptime

> C16 FASES 4 e 6. Agregação de logs pesquisáveis + monitoramento de disponibilidade.
> Pré-requisito dos alertas (ver [`alert-tuning.md`](./alert-tuning.md)) e dos SLOs
> ([`docs/c16/slo.md`](../c16/slo.md)).

## Como os logs saem da aplicação

Tudo é **uma linha JSON por evento em stdout** (Vercel captura). Dois `kind`:

| `kind` | Origem | Campos |
|---|---|---|
| `metric` | `metrics.emit(event, fields)` ([metrics.ts](../../src/lib/observability/metrics.ts)) | `ts, kind, event, ...fields` |
| `log` | `logger.{debug,info,warn,error}` ([logger.ts](../../src/lib/observability/logger.ts)) | `ts, kind, level, event, ...fields` |

Ambos passam por `sanitizeFields` (redige Bearer/JWT/DSN/chaves sensíveis) — seguro para
um pipeline externo. Cada operação HTTP carrega `request_id`/`correlation_id`
([request-context.ts](../../src/lib/audit/request-context.ts)) para correlacionar.

## FASE 4 — Better Stack (Vercel Log Drain)

**Setup (uma vez, no dashboard — não é código):**
1. Better Stack → **Sources** → **Connect source** → tipo **Vercel** (ou HTTP/Logtail). Copie o token/endpoint do drain.
2. Vercel → projeto → **Settings → Log Drains** → **Add** → cole o endpoint do Better Stack → formato **JSON** → salve.
3. Gere tráfego e confirme que as linhas chegam parseadas (Better Stack reconhece o JSON automaticamente; `kind`, `event`, `level` viram campos filtráveis).

**Saved searches obrigatórias** (criar em Better Stack → Live tail → Save):

| Nome | Filtro | Por quê |
|---|---|---|
| Failed Outbox Events | `event:"outbox.failed"` | DLQ tem entradas → handler quebrando |
| LLM Failures | `event:"ai.provider.error"` OR `event:"ai.cost.unknown_model"` | Gemini indisponível / modelo fora do catálogo |
| Auth Failures | `event:"cron.unauthorized"` OR `level:"error" event:"auth_*"` | acesso negado / brute force |
| 5xx Rate | `status:>=500` OR `event:"*.error"` | erros de servidor / crons falhando |
| Cron errors | `event:"*.error" kind:"metric"` | qualquer cron com catch (retention/dunning/rollup) |

> Os nomes de evento seguem o catálogo em [observability/README.md](../../src/lib/observability/README.md).
> Eventos `*.error` são a convenção dos crons (ex.: `retention.error`,
> `observability.metrics_rollup.error`, `billing.dunning.error`).

## FASE 6 — Uptime monitoring

Monitores (Better Stack Uptime **ou** UptimeRobot), intervalo **5 min**:

| Monitor | URL | Espera | Notas |
|---|---|---|---|
| App | `https://<app>/` | HTTP 200 | página pública / login |
| Health | `https://<app>/api/health?strict=1` | HTTP 200 | **inclua header** `Authorization: Bearer <CRON_SECRET>` — o endpoint exige (não é público). `?strict=1` → 503 quando degradado |
| Landing | `https://qoro.dev` | HTTP 200 | site de marketing |

`/api/health` agrega db/gemini/meta/asaas/outbox + SLIs de fila
([route](../../src/app/api/health/route.ts)); `degraded` (dependência externa ou fila
acima do SLO) vira **503** com `?strict=1`, então o monitor alarma sozinho.

## Validação rápida
1. Force um erro de cron (ex.: chamar `/api/cron/metrics-rollup` sem o Bearer) → linha
   `event:"cron.unauthorized"` aparece no Better Stack < 1 min.
2. Pare o worker (ou encha a fila) e confirme `/api/health?strict=1` → 503 + o monitor
   de uptime dispara.

## Limpeza / retenção
- Logs: retenção definida no plano do Better Stack (não no app).
- Long-term: `archive-old-messages` (Onda 2, baixa prio) arquiva `ai_messages` > 30d no
  Storage antes do drop de partição — independente do log drain.
