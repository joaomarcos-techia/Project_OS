import { env } from '@/lib/env';

import { sanitizeFields, type Fields } from './sanitize-fields';

/**
 * Structured, level-gated logger (C16). Layers on top of the same JSON-line +
 * `sanitizeFields` discipline as `metrics.emit` ([metrics.ts]) so logs and
 * metrics share one shape in the pipeline (Vercel stdout → Better Stack).
 *
 *   { ts, kind:'log', level, event, ...sanitizedFields }
 *
 * `kind:'log'` separates these from `kind:'metric'` lines. Levels are gated by
 * `LOG_LEVEL` (env, default `info`): a call below the configured level is a
 * no-op. Inject the level via `createLogger` so behavior is testable without
 * touching env; the default `logger` reads `env.LOG_LEVEL`.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export type Logger = Record<LogLevel, (event: string, fields?: Fields) => void>;

export function createLogger(minLevel: LogLevel): Logger {
  const threshold = ORDER[minLevel];

  function emit(level: LogLevel, event: string, fields: Fields = {}): void {
    if (ORDER[level] < threshold) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      kind: 'log',
      level,
      event,
      ...sanitizeFields(fields),
    });
    process.stdout.write(line + '\n');
  }

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}

/** Process-wide logger gated by `env.LOG_LEVEL`. */
export const logger = createLogger(env.LOG_LEVEL);
