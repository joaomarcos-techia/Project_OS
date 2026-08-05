import type { z } from 'zod';

/**
 * Event SCHEMA catalog. Producer-side only.
 *
 * Why separated from `registry.ts`:
 *   The producer (caller of `publishEvent`) needs to validate the payload
 *   against a Zod schema. The consumer (handler) lives somewhere else in the
 *   codebase and may not even be deployed yet. Coupling them via a single
 *   "registry" means the producer cannot publish until the consumer registers
 *   its handler — a deploy-ordering trap (producer ships first → publishEvent
 *   throws "handler not registered" → outbox accumulates failures).
 *
 *   With this split: every bounded context exports its events.ts which calls
 *   `registerEventSchema(...)` at module load. The barrel `src/lib/db/schema/index.ts`
 *   (which the producer transitively imports) re-exports all events.ts files,
 *   so the catalog is populated wherever publishEvent runs. Handlers live in
 *   `<context>/internal/handlers/*` and only the cron boot file imports them.
 *
 * Format enforcement: `<context>.<entity>.<action>` (lowercase, snake-friendly).
 * Same regex as the SQL CHECK constraint on outbox.event_type — kept in sync
 * by code-review discipline.
 */
const catalog = new Map<string, z.ZodTypeAny>();

const EVENT_TYPE_RE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

export function registerEventSchema<T>(eventType: string, schema: z.ZodType<T>): void {
  if (!EVENT_TYPE_RE.test(eventType)) {
    throw new Error(
      `[outbox.catalog] eventType inválido: ${eventType} (formato '<context>.<entity>.<action>')`,
    );
  }
  const existing = catalog.get(eventType);
  if (existing && existing !== schema) {
    // Re-importing the same module is fine (idempotent set with same schema).
    // Re-registering with a different schema is a programmer error.
    throw new Error(`[outbox.catalog] eventType já registrado com schema diferente: ${eventType}`);
  }
  catalog.set(eventType, schema);
}

export function getEventSchema(eventType: string): z.ZodTypeAny | undefined {
  return catalog.get(eventType);
}

export function listEventTypes(): string[] {
  return [...catalog.keys()].sort();
}

/**
 * Test-only helper. Lets the smoke runner reset state between sub-tests so
 * registration order between scripts does not interfere.
 */
export const __testing__ = {
  reset(): void {
    catalog.clear();
  },
};
