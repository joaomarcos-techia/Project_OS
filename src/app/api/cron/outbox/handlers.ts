/**
 * Outbox handler boot file.
 *
 * Side-effect imports of every consumer module across bounded contexts.
 * Each imported module calls `registerHandler(...)` at top level, populating
 * the handler registry that the worker consults.
 *
 * Why this lives at the cron route layer (and not in `src/lib/outbox/`):
 *   ADR-001 forbids `lib → context` imports. The cron route is in the `app`
 *   layer where importing context internals is permitted, so the side-effect
 *   wiring lives here. Producer code (publishEvent) does NOT import this file
 *   — it only consults the catalog (schema), which is populated by the regular
 *   `events.ts` files re-exported via the schema barrel.
 *
 * C4 ships with NO handlers registered — no consumer exists yet. C5+ adds
 * imports here as bounded contexts grow:
 *
 *   import '@/contexts/financial/internal/handlers/appointment-completed';
 *   import '@/contexts/ai-agent/internal/handlers/patient-created';
 *   import '@/contexts/identity/internal/handlers/clinic-suspended';
 *
 * Adding an import here is the ONLY action required to activate a handler
 * in production — drove deploy-ordering safety in producer code via the
 * separate catalog/registry split (see catalog.ts).
 */

// C5 — Patient LGPD handlers (self-consumed events).
import '@/contexts/patient/internal/handlers/lgpd-export-requested';
import '@/contexts/patient/internal/handlers/lgpd-delete-requested';

// C6 — Scheduling: cancela agendamentos futuros quando paciente é removido
// (reage a patient.core.deleted + patient.lgpd.delete_requested).
import '@/contexts/scheduling/internal/handlers/patient-deleted';

// C7 — Clinical: appointment.started → cria prontuário rascunho (idempotente).
import '@/contexts/clinical/internal/handlers/appointment-started';

// C9 — Financial: appointment.completed → cria lançamento a receber (substitui
// o placeholder temp do C6). Idempotente via UNIQUE(appointment_id).
import '@/contexts/financial/internal/handlers/appointment-completed';
// C9 — Scheduling reage aos eventos de Financial para escrever a própria coluna
// appointments.faturamento_pendente (ownership físico; ver ADR-014 R11/M12).
import '@/contexts/scheduling/internal/handlers/financial-faturamento-pendente';
import '@/contexts/scheduling/internal/handlers/financial-lancamento-created';

// C11 — AI Agent: messaging.inbound.received → turno de conversa (saga
// multi-fase, LLM fora de TX — ADR-022). Idempotente via eventId checkpoints.
import '@/contexts/ai-agent/internal/handlers/inbound-received';

// C13 — Billing: metering de uso (idempotente via usage_counter_ledger).
// scheduling.appointment.created → +1 agendamentos; ai_agent.conversation.completed
// → +1 conversas_ia (outcome='replied'). NUNCA bloqueiam (ADR-024) — só contam.
import '@/contexts/billing/internal/handlers/appointment-created';
import '@/contexts/billing/internal/handlers/conversation-completed';

export {};
