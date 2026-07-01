# Runbook — Resposta a Incidentes

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).


> C16 FASE 9. Fluxo geral: **detectar → diagnosticar → resolver → comunicar**.
> Para cenários específicos veja os runbooks dedicados (gemini-down, asaas-webhook-missing, etc.).

## 0. Severidade (decida em < 2 min)

| Sev | Critério | Resposta |
|---|---|---|
| **SEV1** | App fora / banco indisponível / breach de dados / multi-tenant vazando | Agir já, comunicar clientes afetados |
| **SEV2** | Dependência externa degradada (Gemini/Meta/Asaas), fila parada, 5xx subindo | Agir na hora útil, monitorar |
| **SEV3** | Métrica fora do SLO sem impacto direto, erro isolado | Backlog, sem acordar ninguém |

## 1. Detectar
Sinais de entrada:
- **Sentry** (alerta de crash/erro). Issue tem `trace_id` → correlaciona com logs.
- **Uptime (Better Stack)**: `/api/health?strict=1` ou `/api/health/outbox?strict=1` em 503.
- **Log drain (Better Stack)**: saved search `*.error` / `status:>=500` (ver [log-search.md](./log-search.md)).

## 2. Diagnosticar
1. Abra **`GET /api/health`** (com `Authorization: Bearer <CRON_SECRET>`) → veja qual check está `degraded`/`down`:
   - `db: down` → SEV1, ver [disaster-recovery.md](./disaster-recovery.md).
   - `gemini/meta/asaas: degraded` → runbook do provedor.
   - `outbox: degraded` → fila parada (passo 3).
2. **`GET /api/health/outbox`** (super_admin ou Bearer) → `failures_by_type`, `oldest_pending_age_s`, `audit.default_partition_rows`.
3. **Sentry** → stacktrace + `tenant_id`/`request_id` do contexto.
4. **Better Stack** → filtre por `request_id:"<id>"` para a linha do tempo daquela operação.

## 3. Resolver (padrões comuns)
- **Fila outbox parada** (`oldest_pending_age_s` alto): confirme que o cron `/api/cron/outbox` está rodando (Vercel → Crons / `cron_heartbeats`). Se um event_type está em loop de falha, o circuit breaker pausa sozinho; investigue `failures_by_type` e faça replay manual (ver [c4-validation.md](./c4-validation.md)).
- **`audit.default_partition_rows > 0`**: provisioning de partição falhou → rode `/api/cron/audit-partitions` manualmente (ver [audit-retention.md](./audit-retention.md)).
- **Provedor externo down**: runbook específico (gemini/meta/asaas). Em geral o sistema degrada, não cai (timeouts + circuit + reconcile).
- **Deploy ruim**: rollback no Vercel (Deployments → promover o anterior).

## 4. Comunicar
- SEV1/SEV2 com impacto a cliente: avise o(s) cliente(s) afetado(s) (status + ETA), sem detalhe técnico sensível.
- Registre: o que aconteceu, o `trace_id`/issue do Sentry, ação tomada, hora.

## 5. Pós-incidente
- Issue no Sentry: marque resolved só após confirmar.
- Se foi recorrente/evitável: abra um post-mortem curto (o quê, por quê, como evitar) e, se for o caso, ajuste alerta ([alert-tuning.md](./alert-tuning.md)) ou SLO ([slo.md](../c16/slo.md)).
