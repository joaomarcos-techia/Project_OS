/**
 * Environment validation — single source of truth for env vars.
 *
 * Variables are declared here even when not yet consumed, so the contract
 * is visible up-front. Each var carries a TODO[Cn] tag indicating the
 * camada where it MUST become required (drop `.optional()` then).
 *
 * Anti-pattern guarded against: `process.env.X` scattered through the
 * codebase. Always import from this module.
 */
import { z } from 'zod';

const EnvSchema = z.object({
  // --- Database (C1 makes required) ---
  DATABASE_URL: z.string().url().optional(), // TODO[C1]: required
  DATABASE_URL_PROD: z.string().url().optional(), // TODO[C1]: required (only in prod runtime)

  // --- Supabase (C1 makes URL/anon required; C3 makes service role required) ---
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(), // TODO[C1]: required
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(), // TODO[C1]: required
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(), // TODO[C3]: required (server only)

  // --- Runtime ---
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'), // C16 wires logger
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `[env] Invalid environment variables:\n${issues}\n\nSee .env.example for the expected shape.`,
    );
  }
  return parsed.data;
}

export const env = loadEnv();

// Test-only helper. Exported as named import so consumers can't reach
// for a "global" mutable env in production code.
export const __internal = { loadEnv, EnvSchema };
