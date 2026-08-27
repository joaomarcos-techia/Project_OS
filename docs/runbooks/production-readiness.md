# Prontidão de produção

## Status

Canonical gate — sem afirmação de que o ambiente atual está pronto.

## Estados

Use somente `PASS`, `FAIL`, `BLOCKED` ou `NOT TESTED`, com data, commit, ambiente e evidência. Mock/local não aprova provider externo.

## Matriz mínima

| Gate | Evidência exigida |
| --- | --- |
| CI | workflow do commit completo e verde |
| Deploy | deployment do mesmo commit e health sem regressão |
| Banco | migrations/grants/RLS/role runtime verificados |
| Auth/invites | jornada real owner/membro/MFA e e-mail |
| Storage/LGPD | buckets privados, cross-tenant, URL/expiração e cleanup |
| Meta | app/WABA/subscription/template e mensagem inbound→outbound real |
| Gemini | live tool call e jornada real pelo WhatsApp |
| Asaas | customer, assinatura, webhook, settlement, reconcile e compensação |
| E-mail | entrega real de convite e notificações críticas |
| Redis | probe e degradação esperada |
| Observabilidade | logs, Sentry, monitores e canais disparados |
| Backup | execução recente e restore isolado comprovado |
| Browser E2E | roles, billing, agenda, clínico, financeiro e admin no candidato |

## Crons agendados (18)

O gate `check:observability` exige que esta lista acompanhe `vercel.json`:

- `/api/cron/outbox`
- `/api/cron/patient-hard-delete`
- `/api/cron/audit-partitions`
- `/api/cron/cash-flow-rollup`
- `/api/cron/metrics-rollup`
- `/api/cron/financial-reconcile`
- `/api/cron/payments-deposit`
- `/api/cron/data-retention`
- `/api/cron/invites-cleanup`
- `/api/cron/billing-dunning`
- `/api/cron/billing-reconcile`
- `/api/cron/whatsapp-health`
- `/api/cron/proactive-reminders`
- `/api/cron/proactive-dunning`
- `/api/cron/proactive-followup`
- `/api/cron/proactive-waitlist`
- `/api/cron/proactive-deposit-link`
- `/api/cron/proactive-remainder-link`

Confirme heartbeats/efeitos de cada grupo; presença no manifesto não prova execução.

## Decisão

Não declarar `GO-LIVE READY` com item obrigatório `FAIL`, `BLOCKED` ou `NOT TESTED`. Registre o resultado datado em evidência externa/release, não transforme este runbook em diário histórico.

O snapshot de 2026-08-18 em [evidence snapshots](../archive/evidence-snapshots.md) confirma várias bordas e três controles E2E autenticados read-only, mas não fecha settlement Asaas, alert delivery, restore nem a matriz Browser E2E completa; portanto não é uma aprovação global de release.
