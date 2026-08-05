import type { DetachedHandler, Handler, RegisteredHandler } from './types';

/**
 * Handler registry. Consumer-side only.
 *
 * Side-effect imports of `<context>/internal/handlers/*` from the cron route
 * boot file (`src/app/api/cron/outbox/handlers.ts`) populate this map.
 *
 * The producer (publishEvent) does NOT consult this registry — it consults
 * the `catalog` (schema). That separation is what lets producer + consumer
 * deploy independently without breaking the publishing surface (see catalog.ts
 * for full reasoning).
 */
const handlers = new Map<string, RegisteredHandler<unknown>>();

function assertUnregistered(eventType: string): void {
  if (handlers.has(eventType)) {
    throw new Error(`[outbox.registry] handler já registrado: ${eventType}`);
  }
}

export function registerHandler<T>(eventType: string, handler: Handler<T>): void {
  assertUnregistered(eventType);
  handlers.set(eventType, {
    execution: 'transactional',
    handler: handler as Handler<unknown>,
  });
}

/** Registra uma saga que controla as próprias transações curtas. */
export function registerDetachedHandler<T>(eventType: string, handler: DetachedHandler<T>): void {
  assertUnregistered(eventType);
  handlers.set(eventType, {
    execution: 'detached',
    handler: handler as DetachedHandler<unknown>,
  });
}

export function getHandler(eventType: string): RegisteredHandler<unknown> | undefined {
  return handlers.get(eventType);
}

export function listRegisteredHandlers(): string[] {
  return [...handlers.keys()].sort();
}

export const __testing__ = {
  reset(): void {
    handlers.clear();
  },
};
