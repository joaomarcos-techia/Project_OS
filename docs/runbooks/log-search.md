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

### ⚠️ O prefixo `message.` — leia antes de escrever qualquer busca

O Better Stack **embrulha** a linha do app dentro de um envelope próprio. O que chega é:

```json
{
  "dt": "1784176930112",
  "message": {                        ← o JSON do app fica AQUI DENTRO
    "ts": "2026-07-16T04:42:10.492Z",
    "kind": "metric",
    "event": "worker.tick",
    "duration_ms": 340
  },
  "platform": "Vercel",
  "vercel": {
    "environment": "production", "path": "/api/cron/outbox", "level": "info",
    "deployment_id": "dpl_…", "projectName": "project-os", "executionRegion": "iad1",
    "request_id": "xndwz-…", "source": "lambda", "type": "stdout"
  }
}
```

**Portanto: `event:"worker.tick"` NÃO ACHA NADA.** O caminho é **`message.event`**.

| Quero | Busca |
|---|---|
| Um evento | `message.event:"worker.tick"` |
| Só métricas | `message.kind:"metric"` |
| Só logs do `logger` | `message.kind:"log"` |
| Nível do **nosso** logger | `message.level:"error"` (⚠️ `vercel.level` é a classificação da Vercel para stdout — quase sempre `info`, não é a nossa) |
| Campo numérico | `message.duration_ms:>5000` |
| Só produção | `vercel.environment:"production"` |
| Uma rota | `vercel.path:"/api/cron/outbox"` |

> **Por que este bloco existe:** até 2026-07-16 este runbook listava as saved searches
> sem o prefixo (`event:"outbox.failed"`). **Nenhuma jamais funcionou** — foram escritas
> antes de o drain existir e nunca testadas contra ele. Descoberto quando o founder
> configurou o drain e concluiu, corretamente, que "não aparece nada". Aparecia; a busca
> é que procurava um campo inexistente.

## FASE 4 — Better Stack (Vercel Log Drain)

> ✅ **Drain ATIVO desde 2026-07-16** (opção B, manual). Confirmado com `worker.tick`
> chegando do `/api/cron/outbox` (deployment `dpl_2hXf1c…`, projeto `project-os`, time
> `clinic-os-v2-s-projects`). O go-live **1.b** está fechado.
>
> Se parecer que "não chega nada", **suspeite da busca antes do drain** — o prefixo
> `message.` é obrigatório (ver abaixo). Foi o que aconteceu na primeira tentativa.

**Setup (uma vez, no dashboard — não é código):**
1. Better Stack → **Sources** → **Connect source** → tipo **Vercel** (ou HTTP/Logtail se o tipo Vercel não aparecer). Copie o token/endpoint do drain.
2. Vercel → **Settings → Log Drains** → **Add** → cole o endpoint do Better Stack → formato **JSON** → salve.
   - ⚠️ **Exige plano Vercel Pro.** Menu ausente = plano, não erro de navegação.
   - ⚠️ A Vercel alterna esse menu entre **Team Settings** e **Project Settings** conforme a versão. Não achou no projeto? Procure no time. **Alternativa mais simples:** o marketplace da Vercel tem integração oficial do Better Stack, que cria o drain sozinho.
3. Em **Sources** do drain, inclua no mínimo **Function Logs** — é de onde saem `logger`/`metrics`. `Static`/`Edge` sozinhos **não** trazem nada do app.
4. Gere tráfego e confirme que as linhas chegam **parseadas** (Better Stack reconhece o JSON automaticamente; `kind`, `event`, `level` viram campos filtráveis). Se chegarem como texto solto, o formato do drain não está em JSON.

**Teste de aceite — não precisa gerar tráfego.** O cron do outbox roda **a cada minuto**,
então há ~1.440 linhas/dia sempre chegando. No Live tail:

```
message.event:"worker.tick"
```

Resultado esperado (< 1 min): a métrica do worker, no envelope do Better Stack.
**Confirmado em 2026-07-16.** Um evento pontual (ex.: forçar 401 com
`curl.exe -i https://app.qoro.dev/api/cron/metrics-rollup`) só aparece se você rodar
**enquanto** olha — não adianta procurar o de 20 min atrás sem ajustar o time range.

Se **realmente** não chegar nada: (1) `Sources` sem *Function Logs* — é a causa #1, pois
`Static`/`Edge`/`Build` não trazem log de function; (2) formato ≠ JSON; (3) drain em
outro projeto (confira `vercel.projectName` numa linha que chegue).

> O host de prod é **`app.qoro.dev`** (Data Plane). `qoro.dev` é a landing.
> Ver [context-map.md](../architecture/context-map.md).

**Saved searches obrigatórias** (criar em Better Stack → Live tail → Save):

> Todas com o prefixo **`message.`** — ver o bloco acima. Sem ele, retornam vazio.
> Acrescente `AND vercel.environment:"production"` se preview/dev poluírem.

| Nome | Filtro | Por quê |
|---|---|---|
| Failed Outbox Events | `message.event:"outbox.failed"` | DLQ tem entradas → handler quebrando |
| LLM Failures | `message.event:"ai.provider.error" OR message.event:"ai.cost.unknown_model"` | Gemini indisponível / modelo fora do catálogo |
| Auth Failures | `message.event:"cron.unauthorized"` | acesso negado a cron / secret errado |
| Erros da aplicação | `message.kind:"log" AND message.level:"error"` | tudo que o `logger.error` emitiu |
| Cron errors | `message.kind:"metric" AND message.event:"*.error"` | qualquer cron com catch (retention/dunning/rollup) |
| **Webhook verify lento** (A2) | `message.kind:"metric" AND message.event:"billing.webhook.verify"` | p95 de `message.duration_ms` > 5s/5min → caminhando p/ estourar o `maxDuration` de 30s ([slo.md §3.1](../c16/slo.md)) |
| **Webhook forjado** (A2) | `message.event:"billing.webhook.verify" AND message.outcome:"failure"` | o `payment.id` **não existe no Asaas**: corpo forjado, pagamento apagado, ou sandbox×prod trocado. **Investigar sempre** ([asaas-webhook-missing.md](./asaas-webhook-missing.md)) |
| **Divergência do reconcile** (A2) | `message.event:"billing.reconcile.divergence"` | o reconcile achou o que o webhook não refletiu — evento perdido **ou** forjado |
| **Rate-limit degradado** (R1) | `message.event:"auth.ratelimit.degraded"` | Upstash fora → limite virou fail-open per-instância. Degradação **sustentada** = brute-force distribuído sem defesa ([slo.md §7](../c16/slo.md)) |

> **Antes de salvar qualquer busca nova: rode e confirme que ela retorna linha.** Uma
> saved search que devolve vazio por erro de sintaxe é indistinguível de "está tudo bem"
> — foi assim que as 5 primeiras desta tabela passaram meses erradas.

### 🪤 Comparação NUMÉRICA não funciona na busca simples — use SQL

`message.duration_ms:>5000` **parece** funcionar e **nunca dispara**. O Better Stack
traduz para uma comparação de **texto**:

```sql
JSONExtractCaseInsensitive(raw, 'message', 'duration_ms', 'Nullable(String)')  -- String!
...
toString(`message.duration_ms`) ILIKE ('%>5000%')     -- procura o TEXTO ">5000"
```

Nenhuma linha contém a string `">5000"` → **zero resultados, para sempre**. Verificado em
2026-07-16 decodificando a URL do chart. Igualdade de texto (`message.event:"..."`)
funciona; **`>` `<` `>=` em campo numérico, não.**

**Para threshold numérico, edite o SQL do chart** (Explore logs → o editor SQL):

```sql
WITH
  JSONExtractCaseInsensitive(raw, 'message', 'event', 'Nullable(String)')        AS "message.event",
  JSONExtractCaseInsensitive(raw, 'message', 'duration_ms', 'Nullable(Float64)') AS "message.duration_ms"
SELECT
  {{time}} as time,
  count(*) as value
FROM {{__source_where}} AND
  toString(`message.event`) = 'billing.webhook.verify' AND
  `message.duration_ms` > 5000 AND
  dt BETWEEN {{start_time}} AND {{end_time}}
GROUP BY time
```

O que muda: **`Nullable(Float64)`** (não `String`), comparação `> 5000` de verdade, e `=`
exato no evento em vez de `ILIKE '%...%'`.

**No alerta, use threshold ABSOLUTO, não relativo.** A URL do builder carrega
`alert_type=relative` por default → é o "increases by 10%", que com baseline zero **nunca
dispara**. Troque para o modo de valor absoluto ("is above N").

> **Regra que sai disto:** alerta cuja condição você não viu retornar linha **não é
> alerta**. Force o evento e veja disparar — senão você instalou silêncio.

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
1. Force um erro de cron (`curl.exe -i https://app.qoro.dev/api/cron/metrics-rollup`, sem
   Bearer → 401) → `message.event:"cron.unauthorized"` aparece no Better Stack < 1 min.
   **Rode enquanto olha** — evento pontual não aparece se o time range for curto.
2. Pare o worker (ou encha a fila) e confirme `/api/health?strict=1` → 503 + o monitor
   de uptime dispara.

## Limpeza / retenção
- Logs: retenção definida no plano do Better Stack (não no app).
- Long-term: `archive-old-messages` (Onda 2, baixa prio) arquiva `ai_messages` > 30d no
  Storage antes do drop de partição — independente do log drain.
