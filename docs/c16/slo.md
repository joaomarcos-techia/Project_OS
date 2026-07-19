# C16 — SLO / SLI (níveis de serviço)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice mestre](../README.md).


> "Qual nível é aceitável?" — sem isto, olhar gráfico não diz se está ruim.
> Os alvos abaixo definem os **thresholds dos alertas** (Sentry/Better Stack) e dos
> checks de [`/api/health`](../../src/app/api/health). Começar conservador e
> **revisar após medição real** (não há histórico ainda).

## Conceitos

- **SLI** (indicador): sinal mensurável da saúde do serviço.
- **SLO** (objetivo): alvo do SLI sobre uma janela (aqui: **28 dias** rolantes).
- **Error budget**: `100% − SLO`. Disponibilidade 99.5% ⇒ orçamento de erro de **0.5%**
  ≈ **3h36 / 28 dias**. Estourou o budget → congelar mudança arriscada, priorizar
  confiabilidade.

---

## Catálogo de SLOs

### 1. Disponibilidade da aplicação
- **SLI:** % de respostas não-5xx em `/` e nas rotas `/api/**` (medido pelo uptime
  monitor + log drain `status>=500`).
- **SLO:** **99.5%** / 28 dias.
- **Fonte:** UptimeRobot/Better Stack (FASE 6) + `status` nos logs (FASE 4).

### 2. Latência de API
- **SLI:** tempo de resposta server-side das rotas `/api/**`.
- **SLO:** **P95 < 500ms** (P99 < 1s como guard-rail secundário).
- **Fonte:** **Sentry Performance** (traces a 0.1) + os `duration_ms` no log drain.
- ⚠️ **Corrigido em 2026-07-18 (achado N2).** Este item dizia que a fonte era
  `webhook_processing_p95` em `system_metrics_daily`. Essa coluna **nunca existiu** e não
  poderia existir: durações de request não são persistidas em tabela nenhuma — vivem no
  stdout (→ Better Stack) e no Sentry. Um SLO apontando para uma fonte inexistente é pior
  que um SLO ausente: dá a impressão de estar medido.

### 3. Processamento de webhook
- **SLI:** tempo entre receber o webhook (Meta/Asaas) e persistir/enfileirar o efeito.
- **SLO:** **< 30s** no P95.
- **Nota:** os webhooks já respondem rápido (persistem inbound + enfileiram via outbox);
  o trabalho pesado é assíncrono. O SLO cobre recepção→enqueue, não a entrega final.

#### 3.1 Verificação out-of-band do webhook Asaas (A2 — ADR-025 addendum)
- **SLI:** duração da chamada `getPayment()` que o webhook faz para confirmar o
  pagamento no provider antes de qualquer transição.
- **SLO / alerta:** **p95 > 5s por 5min** → alerta. Teto duro é ~10s
  (`ASAAS_HTTP_TIMEOUT_MS`, `attempts: 1`); o webhook tem `maxDuration = 30s`, então
  p95 acima de 5s indica que estamos consumindo o orçamento da invocação e caminhando
  para timeouts em massa.
- **Fonte:** `billing.webhook.verify` → `{ duration_ms, outcome: ok|timeout|failure }`.
  Complementos: `billing.webhook.error` (taxa de 500) e `billing.reconcile.divergence`
  (o reconcile achou o que o webhook não refletiu — evento perdido OU forjado).
- **Ação quando dispara:** ver `runbooks/asaas-webhook-missing.md`. Degradação aqui é
  **fail-safe** (nada é persistido, o Asaas re-entrega, o reconcile diário corrige),
  então é alerta de investigação, não pager de madrugada.
- ⚠️ **Threshold definido, disparo NÃO wired** — depende do go-live #2 (canal de
  alerta), ainda aberto. Ver `docs/achados/auditoria-monitoramento-producao.md`.

### 4. Confiabilidade da IA (Gemini)
- **SLI:** taxa de erro = `erros / total` de chamadas ao provider
  ([gemini.ts](../../src/lib/ai/gemini.ts) já classifica `AIProviderError` vs
  `AIProviderUnreachableError`).
- **SLO:** **taxa de erro < 2%** / 28 dias (excluindo bloqueios de segurança
  intencionais, que são comportamento correto).
- **Fonte:** `ia_error_rate` em `system_metrics_daily` (FASE 7).

### 5. Saúde da fila (outbox) — anti-falha-silenciosa
- **SLIs (GAP 3):**
  - `outbox_depth` = nº de eventos `pending`.
  - `outbox_oldest_age` = `oldest_pending_age_s` (idade do `pending` mais antigo).
  - `outbox_failed_rate` = `failed / processados` na janela.
- **SLOs:** `outbox_oldest_age` **< 300s**; `outbox_failed_rate` **≈ 0** (qualquer
  `failed > 0` é DLQ → investigar); `outbox_depth` sem crescimento monotônico.
- **Fonte:** já exposto em [/api/health/outbox](../../src/app/api/health/outbox/route.ts)
  (alarms `pending_age>300s`, `processing_age>600s`, `outbox_failed>0`); promover a SLI
  nomeado em `system_metrics_daily`.
- **Por quê:** um SaaS de WhatsApp quebra em silêncio — tudo responde 200, mas a fila
  parada significa lembretes/IA não enviados. Este SLO é a rede contra isso.

### 6. Crons / jobs
- **SLI:** atraso do `last_run_at` vs. SLA esperado por job (`cron_heartbeats`).
- **SLO:** todo cron com heartbeat dentro de **2× o intervalo** agendado.
- **Fonte:** `cron_heartbeats` ([cron-heartbeat](../../src/lib/cron-heartbeat/index.ts)).

### 7. Rate-limit de auth — degradação (segurança)
- **SLI:** taxa de `auth.ratelimit.degraded` (fail-open do rate-limit de login/reset/join caindo
  para o limiter local per-instância — ADR-008 F-08). Emitido por
  [rate-limit.ts](../../src/lib/auth/rate-limit.ts) com `reason_category`
  (`server` | `network` | `other`). ⚠️ `other` existe no código (`classifyRedisError`) e
  estava faltando aqui (achado N5) — uma saved-search que filtrasse só `server`/`network`
  perderia essa fatia em silêncio.
- **Sinais irmãos (2026-07-18):** `auth.ratelimit.tripped` (`route: login|mfa`) = o limiter
  BLOQUEOU de verdade — é o sinal de brute-force, e não existia; e `redis` no
  [`/api/health?deep=1`](../../src/app/api/health/route.ts), que torna o outage do Upstash
  visível em vez de silencioso. Runbook: [redis-down.md](../runbooks/redis-down.md).
- **SLO:** **≈ 0** em regime normal (a degradação é excepcional, não crônica). Qualquer
  degradação **sustentada ou recorrente** deve alertar — é a proteção de brute-force distribuído
  enfraquecendo em silêncio (auditoria Redis R1).
- **Fonte / alerta:** `auth.ratelimit.degraded` (log/metric) → thresholds em
  [alert-tuning.md](../runbooks/alert-tuning.md); cota do Upstash correlacionada no painel do
  provedor (código não vê o status HTTP).

---

### 8. Saturação de conexões (A4/E4 — 2026-07-18)
- **SLI:** `total / max_connections` do Postgres, de `pg_stat_activity`
  ([pool-stats.ts](../../src/lib/db/pool-stats.ts)).
- **SLO:** **< 80%**. Acima disso alarma em `/api/health/outbox` (`db_pool_saturation`).
- **Por quê:** era a golden signal ausente (*saturation*), e o gargalo nº1 provável em
  escala. Sem ela, a degradação chega como o "infinite loading" que já conhecemos —
  sintoma para o usuário, não sinal para o operador.

---

## Tempos de resposta a incidente (M4 — definidos em 2026-07-18)

Faltavam. Sem alvo de tempo, "detectamos e resolvemos" não é avaliável.

| Métrica | Alvo | O que mede |
|---|---|---|
| **MTTD** (detecção) | **< 5 min** para SEV1, **< 30 min** para SEV2 | Do início da falha ao alerta chegar no canal. É o que o go-live #2 destrava — sem canal, MTTD é "até alguém reclamar". |
| **MTTR** (recuperação) | **< 1h** para SEV1, **< 4h** para SEV2 | Do alerta ao serviço restaurado. Alinhado ao RTO ≤ 4h. |

Medição: manual por incidente (registrar no post-mortem — [incident-response.md](../runbooks/incident-response.md) §4).
Sem histórico ainda; reavaliar após os primeiros incidentes reais.

---

## Recuperação (referência — detalhe em `docs/runbooks/disaster-recovery.md`)
- **RPO alvo ≤ 24h** (perda máxima de dados aceitável).
- **RTO alvo ≤ 4h** (tempo máximo até restaurar o serviço).

> **PITR: decidido NÃO adotar** (registrado em 2026-07-18). A auditoria de monitoramento
> recomendava "ligar PITR no 1º cliente pagante" (M4), mas essa recomendação assumia um RPO
> menor que o nosso. Com **RPO ≤ 24h**, o backup diário (Action `db-backup.yml`, ou Supabase
> Pro) já atende — PITR (~US$100/mês) compra RPO de minutos, que o negócio não exige hoje.
> Gatilho para reavaliar: o RPO alvo cair abaixo de 24h. Ver
> [go-live-checklist §4](./go-live-checklist.md).

---

## Política de alerta (resumo — detalhe em `docs/runbooks/alert-tuning.md`)
- Alertar sobre **violação de SLO / burn-rate**, nunca sobre evento isolado.
- Ex.: *não* "1 erro Gemini = alerta"; *sim* "Gemini error > 5% em 10min" ou
  "queima de error budget > 2% em 1h".
- Severidades: **CRÍTICO** (serviço down, fila parada, breach) vs **ALERTA**
  (aproximando do limite, dependência externa degradada).

> Estes números são ponto de partida (sem histórico). Reavaliar trimestralmente com os
> dados reais de `system_metrics_daily` e do uptime.
