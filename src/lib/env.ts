/**
 * Environment validation — single source of truth for env vars.
 *
 * Variables are declared here even when not yet consumed, so the contract
 * is visible up-front. Each var carries a tag indicating the camada where
 * it became required.
 *
 * Anti-pattern guarded against: `process.env.X` scattered through the
 * codebase. Always import from this module.
 */
import { z } from 'zod';

// Empty strings from `.env.local` (e.g. `FOO=`) become `undefined` so that
// `.optional()` actually means "not set" rather than "set to empty string".
// Without this, an empty `NEXT_PUBLIC_SUPABASE_URL=` would fail `.url()` validation.
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const EnvSchema = z
  .object({
    // --- Database (C1) ---
    DATABASE_URL: z.preprocess(emptyToUndefined, z.string().url()), // C1: required everywhere
    DATABASE_URL_PROD: z.preprocess(emptyToUndefined, z.string().url().optional()), // C1: required only when NODE_ENV=production (see superRefine below)

    // --- Supabase ---
    // Naming: Supabase renamed keys in 2024. Both legacy and new keys still work.
    // Prefer the new names (publishable/secret) for new projects.
    //   anon         → publishable  (client-safe, RLS-protected)
    //   service_role → secret       (server-only, bypasses RLS)
    // C1 requires URL + at least one of publishable/anon. C3 requires the secret/service_role key.
    NEXT_PUBLIC_SUPABASE_URL: z.preprocess(emptyToUndefined, z.string().url()), // C1: required
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()), // C1: required IF anon not set (see superRefine)
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()), // legacy alias of publishable
    SUPABASE_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()), // C3: required (preferred)
    SUPABASE_SERVICE_ROLE_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()), // legacy alias of secret

    // --- Runtime ---
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'), // C16 wires logger

    // --- Operational ---
    // Explicit opt-in for prod-targeting scripts (db:migrate:prod, db:backup:prod).
    // Default unset; only set in the operator's shell session right before a prod operation.
    SUPABASE_PROJECT_ENV: z.enum(['dev', 'prod']).optional(),
  })
  .superRefine((data, ctx) => {
    // C1: at least one Supabase publishable/anon key must be present.
    // Supabase renamed keys in 2024 — accept either, require ≥1.
    if (
      !data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
      !data.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'],
        message:
          'One of NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (preferred) or NEXT_PUBLIC_SUPABASE_ANON_KEY (legacy) must be set',
      });
    }
    // Note: DATABASE_URL_PROD validation lives in scripts/_env.ts.assertProdContext().
    // It is NEVER read by app runtime (only by db:migrate:prod / db:backup:prod),
    // so validating it in env.ts would needlessly break `next build` whenever
    // qoro-prod doesn't exist yet (which is the case until C16).
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
