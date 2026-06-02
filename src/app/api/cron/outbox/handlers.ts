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
// C6 — TEMP placeholder de appointment.completed (vira Financial em C9).
import '@/contexts/scheduling/internal/handlers/appointment-completed-temp';

// C7 — Clinical: appointment.started → cria prontuário rascunho (idempotente).
import '@/contexts/clinical/internal/handlers/appointment-started';

export {};
