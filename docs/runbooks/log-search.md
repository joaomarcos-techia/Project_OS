# Runbook — Busca de Logs (Better Stack) e Uptime

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).


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

> ⚠️ **Status em 2026-07-16: o drain NÃO está criado** — o Live tail está vazio. Tudo
> abaixo (saved searches, alerta 2.b do go-live) **depende deste setup**. É o item **1.b**
> do [go-live-checklist](../c16/go-live-checklist.md). O `logger`/`metrics` já escrevem
> em stdout há tempos; o que falta é o cano até o Better Stack.

**Setup (uma vez, no dashboard — não é código):**
1. Better Stack → **Sources** → **Connect source** → tipo **Vercel** (ou HTTP/Logtail se o tipo Vercel não aparecer). Copie o token/endpoint do drain.
2. Vercel → **Settings → Log Drains** → **Add** → cole o endpoint do Better Stack → formato **JSON** → salve.
   - ⚠️ **Exige plano Vercel Pro.** Menu ausente = plano, não erro de navegação.
   - ⚠️ A Vercel alterna esse menu entre **Team Settings** e **Project Settings** conforme a versão. Não achou no projeto? Procure no time. **Alternativa mais simples:** o marketplace da Vercel tem integração oficial do Better Stack, que cria o drain sozinho.
3. Em **Sources** do drain, inclua no mínimo **Function Logs** — é de onde saem `logger`/`metrics`. `Static`/`Edge` sozinhos **não** trazem nada do app.
4. Gere tráfego e confirme que as linhas chegam **parseadas** (Better Stack reconhece o JSON automaticamente; `kind`, `event`, `level` viram campos filtráveis). Se chegarem como texto solto, o formato do drain não está em JSON.

**Teste de aceite (1 comando):**

```powershell
curl.exe -i https://app.qoro.dev/api/cron/metrics-rollup    # sem Bearer → 401
```

→ Better Stack → Live tail → `event:"cron.unauthorized"` deve aparecer em < 1 min.
Confirmado respondendo 401 em prod (2026-07-16).

Se **não aparecer**, na ordem: (1) `Sources` sem *Function Logs*; (2) formato ≠ JSON;
(3) drain apontado para outro projeto. Se aparecer como **texto solto** em vez de campos
filtráveis, é o formato.

> O host de prod é **`app.qoro.dev`** (Data Plane). `qoro.dev` é a landing.
> Ver [context-map.md](../architecture/context-map.md).

**Saved searches obrigatórias** (criar em Better Stack → Live tail → Save):

| Nome | Filtro | Por quê |
|---|---|---|
| Failed Outbox Events | `event:"outbox.failed"` | DLQ tem entradas → handler quebrando |
| LLM Failures | `event:"ai.provider.error"` OR `event:"ai.cost.unknown_model"` | Gemini indisponível / modelo fora do catálogo |
| Auth Failures | `event:"cron.unauthorized"` OR `level:"error" event:"auth_*"` | acesso negado / brute force |
| 5xx Rate | `status:>=500` OR `event:"*.error"` | erros de servidor / crons falhando |
| Cron errors | `event:"*.error" kind:"metric"` | qualquer cron com catch (retention/dunning/rollup) |
| **Webhook verify lento** (A2) | `kind:"metric" event:"billing.webhook.verify"` | p95 de `duration_ms` > 5s/5min → caminhando p/ estourar o `maxDuration` de 30s ([slo.md §3.1](../c16/slo.md)) |
| **Webhook forjado** (A2) | `kind:"metric" event:"billing.webhook.verify" outcome:"failure"` | o `payment.id` **não existe no Asaas**: corpo forjado, pagamento apagado, ou sandbox×prod trocado. **Investigar sempre** ([asaas-webhook-missing.md](./asaas-webhook-missing.md)) |
| **Divergência do reconcile** (A2) | `kind:"metric" event:"billing.reconcile.divergence"` | o reconcile achou o que o webhook não refletiu — evento perdido **ou** forjado |
| **Rate-limit degradado** (R1) | `event:"auth.ratelimit.degraded"` | Upstash fora → limite virou fail-open per-instância. Degradação **sustentada** = brute-force distribuído sem defesa ([slo.md §7](../c16/slo.md)) |

> Os nomes de evento seguem o catálogo em [observability/README.md](../../src/lib/observability/README.md).
> Eventos `*.error` são a convenção dos crons (ex.: `retention.error`,
> `observability.metrics_rollup.error`, `billing.dunning.error`).

## FASE 6 — Uptime monitoring

Monitores (Better Stack Uptime **ou** UptimeRobot), intervalo **5 min**:

| Monitor | URL | Espera | Notas |
|---|---|---|---|
| App | `https://app.qoro.dev/` | HTTP 200/307 | 307 = redirect p/ login, é o esperado sem sessão |
| Health | `https://app.qoro.dev/api/health?strict=1` | HTTP 200 | **inclua header** `Authorization: Bearer <CRON_SECRET>` — o endpoint exige (não é público). `?strict=1` → 503 quando degradado |
| Auth Hook | `https://app.qoro.dev/api/health/auth-hook` | HTTP 200 | **mesmo header Bearer** (A1 — a rota deixou de ser anônima em 2026-07-15; sem o header dá 401). Sem o hook, ninguém loga |
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
