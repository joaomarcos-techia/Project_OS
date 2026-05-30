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

    // --- C3: identity / auth / rate limit ---
    // Pepper for HMAC-SHA256 over emails in login_attempts. NEVER store plaintext
    // emails (privacy). Min 32 chars enforces a baseline entropy. Treated as a
    // secret — rotation requires re-issuing all in-flight rate-limit windows,
    // which is acceptable since windows are short (15 min).
    LOGIN_HASH_PEPPER: z.preprocess(emptyToUndefined, z.string().min(32).optional()), // C3: required at runtime; build-time optional so vercel build works pre-config
    // Upstash Redis REST endpoint + token for rate-limit dual (IP + email_hash).
    // C3: required at runtime; optional at parse time so build doesn't break before secrets exist.
    UPSTASH_REDIS_REST_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    UPSTASH_REDIS_REST_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // Bootstrap super_admin via scripts/seed-super-admin.ts. Optional always —
    // only set in dev/setup shell sessions. Warning emitted if set during build.
    SUPER_ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
    SUPER_ADMIN_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(12).optional()),

    // --- C4: outbox/audit/idempotency runtime ---
    // Shared secret between Vercel Cron (Authorization: Bearer header) and the
    // route handler. Optional at parse time so `next build` works before the
    // secret exists; assertCronRuntimeReady() enforces it on the route handler.
    CRON_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
    // Worker tuning — kept in env so prod can be tweaked without redeploy.
    // Defaults chosen for solo-founder operability (50 events/tick, 5 parallel).
    OUTBOX_BATCH_SIZE: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(500).optional().default(50),
    ),
    OUTBOX_PARALLELISM: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(20).optional().default(5),
    ),
    // HIGH-05: lock_timeout do idempotentMutation. 3s era curto demais para
    // Server Actions que fazem múltiplas queries + Zod parse + publishEvent.
    // 10s é o novo default; pode aumentar via env se UX em rede lenta exigir.
    // Máximo 60s (caso > 60 = arquitetura errada — usar two-step pattern).
    OUTBOX_IDEMPOTENCY_LOCK_TIMEOUT_MS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1000).max(60_000).optional().default(10_000),
    ),
    // HIGH-06: pool size do dbWorker. dbAdmin (max:1) é sparse path; worker
    // hammer com TX1+TX3 + reclaim + circuit. 5 connections por instance é OK
    // para tick com batchSize=50 em rede AWS ~200ms RTT.
    OUTBOX_DB_POOL_SIZE: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(20).optional().default(5),
    ),
    // HIGH-07: payload size cap em bytes. Default 64KB. Caps em runtime
    // mirroreiam CHECK constraints no banco (defense in depth).
    OUTBOX_MAX_PAYLOAD_BYTES: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1024).max(1024 * 1024).optional().default(64 * 1024),
    ),

    // --- C5: per-tenant encryption (AES-256-GCM + HKDF) + lookup HMAC ---
    // Master key(s) are 32-byte AES keys, base64-encoded. In dev/test they live
    // in env (EnvSecretProvider); in production they live in Google Secret
    // Manager (GcpSecretManagerProvider) and these env vars stay unset. NEVER
    // commit a real key. Optional at parse time so `next build` works before
    // secrets exist; assertCryptoRuntimeReady() enforces at runtime.
    // Versioned (V1, V2, ...) so master-key rotation can decrypt old ciphertext
    // by the `version` byte embedded in it (PlanoAção §5.5 rotation test).
    CRYPTO_MASTER_KEY_V1: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    CRYPTO_MASTER_KEY_V2: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // Which master-key version NEW ciphertext is written with. Reads pick the
    // version from the ciphertext's own version byte, not this value.
    MASTER_KEY_VERSION: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(255).optional().default(1),
    ),
    // Global salt for the deterministic lookup HMAC (cpf_hash / telefone_hash /
    // suppression contact_hash). Base64. Global (not per-tenant) so the same CPF
    // hashes identically for a UNIQUE(clinic_id, cpf_hash) check. Secret.
    CRYPTO_LOOKUP_SALT: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    // Backend selector. Defaults to 'gcp' in production, 'env' otherwise.
    CRYPTO_SECRET_BACKEND: z.preprocess(emptyToUndefined, z.enum(['env', 'gcp']).optional()),
    // GCP Secret Manager wiring (only read by GcpSecretManagerProvider in prod).
    GCP_PROJECT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    GCP_SECRET_MASTER_KEY_NAME: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    GCP_SECRET_LOOKUP_SALT_NAME: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
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
    //
    // Note: LOGIN_HASH_PEPPER / UPSTASH_* are validated at runtime via
    // assertAuthRuntimeReady() in src/lib/auth (called by login flow), not here.
    // Same reason as DATABASE_URL_PROD: keep `next build` green pre-config.
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

/**
 * Runtime guard for C4 cron routes. Fails fast when CRON_SECRET is missing
 * — same shape as assertAuthRuntimeReady() in src/lib/auth, called only by
 * the cron/healthcheck route handlers. Keeps `next build` green pre-config.
 */
export function assertCronRuntimeReady(): void {
  if (!env.CRON_SECRET) {
    throw new Error('[env] CRON_SECRET is required at runtime for /api/cron/* routes');
  }
}

/**
 * Runtime guard for C5 crypto. Fails fast when the active secret backend is
 * missing its inputs — same shape as assertCronRuntimeReady(). Called by the
 * crypto module the first time it needs a secret, NOT at import time, so
 * `next build` stays green before secrets exist.
 */
export function resolveCryptoBackend(): 'env' | 'gcp' {
  return env.CRYPTO_SECRET_BACKEND ?? (env.NODE_ENV === 'production' ? 'gcp' : 'env');
}

export function assertCryptoRuntimeReady(): void {
  const backend = resolveCryptoBackend();
  if (backend === 'env') {
    if (!env.CRYPTO_MASTER_KEY_V1) {
      throw new Error(
        '[env] CRYPTO_MASTER_KEY_V1 is required at runtime when CRYPTO_SECRET_BACKEND=env',
      );
    }
    if (!env.CRYPTO_LOOKUP_SALT) {
      throw new Error(
        '[env] CRYPTO_LOOKUP_SALT is required at runtime when CRYPTO_SECRET_BACKEND=env',
      );
    }
  } else {
    if (!env.GCP_PROJECT_ID || !env.GCP_SECRET_MASTER_KEY_NAME || !env.GCP_SECRET_LOOKUP_SALT_NAME) {
      throw new Error(
        '[env] GCP_PROJECT_ID, GCP_SECRET_MASTER_KEY_NAME and GCP_SECRET_LOOKUP_SALT_NAME are required when CRYPTO_SECRET_BACKEND=gcp',
      );
    }
  }
}
