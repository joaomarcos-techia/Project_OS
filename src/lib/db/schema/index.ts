/**
 * Schema barrel — single import surface for Drizzle.
 *
 * Convention (frozen in C1): each bounded context owns its tables in its own
 * `schema.ts`, and re-exports them here. C2 added the tenancy schema.
 *
 * Why a barrel: drizzle-kit reads `schema: './src/lib/db/schema/*'` in
 * drizzle.config.ts — every file globbed contributes to the migration diff.
 * Re-exporting here keeps `db` (drizzle client) tied to a single schema map.
 *
 * NOTE: this barrel is the one place where src/lib/db/* re-exports across
 * the context boundary. The boundaries lint rule treats lib→context as
 * forbidden; this file is purely declarative (consumed by drizzle-kit to
 * build the migration diff and by the runtime `db` for `db.<table>` typing).
 * Anything more than a re-export here violates the spirit of ADR-001.
 */
export * from './_meta';
export * from '@/contexts/tenancy/schema';
export * from '@/contexts/identity/schema';
// patient/schema.ts also side-effect-imports './events', so re-exporting it
// here populates the outbox catalog with patient.* schemas wherever the
// producer (publishEvent) transitively imports this barrel.
export * from '@/contexts/patient/schema';
// C6 — Scheduling. schema.ts side-effect-imports './events', registrando os
// schemas scheduling.* no catálogo do outbox onde quer que publishEvent rode.
export * from '@/contexts/scheduling/schema';
// C7 — Clinical. schema.ts side-effect-imports './events', registrando os
// schemas clinical.* no catálogo do outbox.
export * from '@/contexts/clinical/schema';
// C9 — Financial. schema.ts side-effect-imports './events', registrando os
// schemas financial.* no catálogo do outbox.
export * from '@/contexts/financial/schema';
// C10 — Messaging. schema.ts side-effect-imports './events', registrando
// messaging.inbound.received no catálogo do outbox.
export * from '@/contexts/messaging/schema';
// C11 — AI Agent. schema.ts side-effect-imports './events', registrando
// ai_agent.conversation.completed no catálogo do outbox.
export * from '@/contexts/ai-agent/schema';
// C14 — Proactive Jobs (sub-context de ai-agent): fila agendada ai_proactive_jobs.
// Sem eventos próprios (envios saem direto via messagingApiV1), só schema.
export * from '@/contexts/ai-agent/proactive-jobs/schema';
// C13 — Billing. schema.ts side-effect-imports './events', registrando
// billing.* no catálogo do outbox.
export * from '@/contexts/billing/schema';
export * from '@/contexts/billing/gateway-schema';
export * from '@/contexts/feedback/schema';
// ADR-049 — Payments (cobranca de PACIENTE na conta da propria clinica).
// Sem eventos proprios nesta fase: 1.1 e so a credencial.
export * from '@/contexts/payments/schema';
// C4 infra — cross-cutting tables (outbox, audit_events, super_admin_actions,
// idempotency_keys). Not a bounded context, so not under src/contexts/. The
// drizzle.config.ts glob './src/lib/db/schema/**/*' picks them up.
export * from './infra/outbox';
export * from './infra/audit';
export * from './infra/super-admin';
export * from './infra/idempotency';
// C15 — Platform Admin: sessões de impersonate (fonte autoritativa do cookie).
export * from './infra/impersonation';
// Platform globals — flags/kill-switches, heartbeats de cron e avisos globais.
// global protected (ADR-007 §10): sem clinic_id; escrita via dbAdmin/superAdminAction.
export * from './infra/platform-settings';
export * from './infra/cron-heartbeats';
export * from './infra/platform-announcements';
// C16 — observabilidade: agregados diários por clínica (system_metrics_daily).
export * from './infra/system-metrics';
// Onboarding — clinic_invites (convite mágico; global protected, entidade pré-clínica).
export * from '@/contexts/onboarding/schema';
