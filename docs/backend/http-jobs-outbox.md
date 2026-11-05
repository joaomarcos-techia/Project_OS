---
title: "Backend, HTTP, crons e outbox"
description: "Backend, HTTP, crons e outbox — responsabilidades, fontes e limites da implementação."
docType: "reference"
---

## Status

Canonical — superfícies server-side e execução assíncrona.

## Source of Truth

`src/app/**/route.ts`, Server Actions em `src/app`, `src/lib/outbox`, `src/contexts/*/actions.ts` e `vercel.json`.

## Route Handlers

| Superfície | Método(s) | Autorização |
| --- | --- | --- |
| `/api/webhooks/meta` | GET, POST | verify token no handshake; HMAC no POST |
| `/api/webhooks/asaas` | POST | token Asaas comparado em tempo constante |
| `/api/health` | GET | health público sanitizado |
| `/api/health/auth-hook` | GET | prova de hook autenticada/configurada |
| `/api/health/outbox` | GET | super-admin |
| `/api/cron/*` | GET | Bearer `CRON_SECRET`; destrutivos podem usar segredo dedicado |
| `/auth/confirm` | GET | valida callback Supabase/recovery |
| `/logout` | POST | sessão autenticada |
| `/relatorios/pdf` | GET | tenant + `view:financial` |
| `/admin/feedbacks/export` | GET | super-admin AAL2 |
| `/admin/clinicas/[id]/audit/export` | POST | super-admin AAL2 |

Server Actions são a superfície principal das telas. Cada action deve autenticar, validar Zod, verificar permission, operar em transação/idempotência e retornar erro sanitizado.

## Crons

Todos os horários são UTC e a lista canônica de agendamento é `vercel.json`.

| Agenda | Rota | Função |
| --- | --- | --- |
| `* * * * *` | `/api/cron/outbox` | processa eventos |
| `0 3 * * *` | `/api/cron/patient-hard-delete` | exclusão/anônimização LGPD vencida |
| `0 4 1 * *` | `/api/cron/audit-partitions` | partições de auditoria/IA |
| `30 3 * * *` | `/api/cron/cash-flow-rollup` | agregado de caixa |
| `0 5 * * *` | `/api/cron/metrics-rollup` | métricas diárias |
| `*/15 * * * *` | `/api/cron/financial-reconcile` | recebíveis de consultas |
| `0 5 1 * *` | `/api/cron/data-retention` | retenção por tabela |
| `0 6 * * *` | `/api/cron/invites-cleanup` | expira/anonimiza convites |
| `0 8 * * *` | `/api/cron/billing-dunning` | estágios de inadimplência |
| `0 9 * * *` | `/api/cron/billing-reconcile` | reconcilia Asaas/local |
| `0 */6 * * *` | `/api/cron/whatsapp-health` | saúde dos números Meta |
| `30 10 * * *` | `/api/cron/whatsapp-messaging-health` | saúde de envio (`health_status`): bloqueio ou limite da Meta nas mensagens automáticas |
| `*/15 11-23 * * *` | `/api/cron/proactive-reminders` | lembretes em janela local |
| `*/15 11-23 * * *` | `/api/cron/proactive-dunning` | cobrança ao paciente |
| `*/15 11-23 * * *` | `/api/cron/proactive-followup` | retorno pós-atendimento |
| `*/15 11-23 * * *` | `/api/cron/proactive-waitlist` | ofertas da waitlist |

## Outbox

### Publicação

- `publishEvent` valida nome/schema, JSON seguro e limite de payload.
- Negócio e evento são gravados na mesma transação.
- `(event_type, idempotency_key)` evita duplicação; colisão de payload é erro.
- Payloads não carregam PII em claro.

### Worker

1. advisory lock evita ticks concorrentes de manutenção;
2. janitor devolve `processing` preso por mais de cinco minutos;
3. circuit breaker pausa tipo com falhas tóxicas;
4. TX1 reserva com `FOR UPDATE SKIP LOCKED`;
5. handler roda tenant-scoped ou detached conforme registro;
6. TX3 finaliza com guard de tentativa para detectar corrida.

Backoff após falha: imediato, 30 s, 5 min, 30 min e 6 h; a sexta tentativa fica `failed`. Evento catalogado sem handler fica `skipped`, situação esperada apenas quando declarada `PRODUCER_AHEAD`. Replay de `failed` é operação manual.

## Failure modes

- Provider/LLM fora: handler falha e é retentado; não engolir a exceção.
- Handler removido acidentalmente: registry/check e métrica `outbox.skipped_no_handler` detectam.
- Tick sobreposto: advisory lock devolve resumo sem duplicar manutenção.
- Handler lento + janitor: finalize guard emite `outbox.lost_race`; idempotência do handler é obrigatória.

Veja [runbook do outbox](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/runbooks/c4-validation.md) e [operações](/operations/deployment-observability).
