# Inventário operacional C16

## Status

Reference — inventário verificado por `pnpm check:observability`.

## Crons (21)

| Rota | Owner funcional |
| --- | --- |
| `/api/cron/outbox` | infraestrutura |
| `/api/cron/patient-hard-delete` | patient/LGPD |
| `/api/cron/audit-partitions` | audit/AI |
| `/api/cron/cash-flow-rollup` | financial |
| `/api/cron/metrics-rollup` | observabilidade |
| `/api/cron/financial-reconcile` | financial |
| `/api/cron/payments-deposit` | payments |
| `/api/cron/payments-account-closure` | payments |
| `/api/cron/data-retention` | plataforma |
| `/api/cron/invites-cleanup` | onboarding |
| `/api/cron/signup-sessions-cleanup` | onboarding |
| `/api/cron/billing-dunning` | billing |
| `/api/cron/billing-reconcile` | billing |
| `/api/cron/whatsapp-health` | messaging |
| `/api/cron/whatsapp-messaging-health` | messaging |
| `/api/cron/proactive-reminders` | AI/messaging |
| `/api/cron/proactive-dunning` | financial/messaging |
| `/api/cron/proactive-followup` | AI/messaging |
| `/api/cron/proactive-waitlist` | scheduling/messaging |
| `/api/cron/proactive-deposit-link` | payments/messaging |
| `/api/cron/proactive-remainder-link` | payments/messaging |

Horários vivem exclusivamente em `vercel.json`. Autorização comum em `withCron`; heartbeats ficam em `cron_heartbeats`.

## Sinais

- logs estruturados e request id;
- métricas process-local/emitidas;
- `system_metrics_daily` para séries de negócio/SLIs;
- Sentry e tunnel `/monitoring`;
- health público, auth-hook e outbox admin;
- specs Better Stack em `infra/observability`.

Configuração/ativação externa permanece `REQUIRES_MANUAL_VALIDATION`.
