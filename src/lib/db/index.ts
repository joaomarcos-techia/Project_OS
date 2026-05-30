/**
 * Database access — the ONLY place in the codebase that imports `postgres`.
 *
 * Exports two physically-separate Drizzle clients:
 *   - `db`      : runtime, user-facing. In C2+ will run with RLS-enforcing role.
 *   - `dbAdmin` : admin path, bypasses RLS in C2+. Importable only from
 *                 scripts/, src/app/(admin)/, and src/app/api/admin/.
 *                 See eslint.config.mjs for the lint-enforced allowlist.
 *
 * Why two physically distinct pools in C1, when both URLs are identical:
 *   The semantic separation locks NOW. In C2 the only change is the URL of
 *   `adminClient` (service-role connection). Zero consumer refactor. If we
 *   had aliased `dbAdmin = db`, every import site would need re-audit when
 *   RLS arrives — and the "harmless alias" framing would have spread.
 *
 * Singleton-against-HMR:
 *   Next.js dev re-evaluates this module on hot reload. Without globalThis
 *   caching we open a new pool every save -> Supabase connection exhaustion
 *   in minutes. Disabled in production to keep Vercel cold-starts clean.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '@/lib/env';

import * as schema from './schema';

if (!env.DATABASE_URL) {
  throw new Error('[db] DATABASE_URL is required. Check .env.local.');
}

// Boot-time guard: NODE_ENV=dev pointing to a prod-like URL is almost always
// a copy-paste mistake. Heuristic is weak (Supabase hosts are random strings)
// but catches the obvious cases; explicit `SUPABASE_PROJECT_ENV=prod` is the
// hard signal — see scripts/_env.ts for prod scripts.
const looksLikeProd = (url: string): boolean => {
  try {
    const hostname = new URL(url).hostname;
    return (
      /(prod|production)/i.test(hostname) || process.env.SUPABASE_PROJECT_ENV === 'prod'
    );
  } catch {
    return false;
  }
};

if (env.NODE_ENV !== 'production' && looksLikeProd(env.DATABASE_URL)) {
  throw new Error(
    '[db] FATAL: NODE_ENV is not production but DATABASE_URL looks like prod ' +
      '(hostname contains prod/production OR SUPABASE_PROJECT_ENV=prod). ' +
      'This guard prevents localhost from writing to prod by accident. ' +
      'Fix .env.local or set NODE_ENV=production if you really mean it.',
  );
}

// Shared connection options. Defensive timeouts because serverless lambdas
// hibernate, sockets go stale, and Supabase pooler is fronted by AWS — bad
// network conditions appear early in real traffic.
//
// prepare: false  -> Transaction Pooler (port 6543) does NOT support prepared
//                    statements. With prepare:true you get cryptic protocol
//                    errors. Documented Supabase requirement.
const sharedOpts = {
  ssl: 'require' as const,
  prepare: false,
  idle_timeout: 20, // seconds — drop idle sockets fast (lambda cold-restart safety)
  connect_timeout: 10, // seconds — fail fast on bad URL/network
  max_lifetime: 60 * 30, // 30 min — recycle long-lived sockets
};

// Singleton-safe pool storage on globalThis. ONLY active in non-production.
const globalForDb = globalThis as unknown as {
  __runtimeClient?: ReturnType<typeof postgres>;
  __adminClient?: ReturnType<typeof postgres>;
  __workerClient?: ReturnType<typeof postgres>;
};

const runtimeClient =
  globalForDb.__runtimeClient ?? postgres(env.DATABASE_URL, { ...sharedOpts, max: 5 });
// dbAdmin pool max:1 mantido — é admin path sparse (healthcheck, dashboard).
// HIGH-06: worker tem seu próprio pool (dbWorker) porque é hot-loop e o pool
// max:1 saturava completamente sob rede AWS Oregon (smoke 4.6.2 mostrou ~70s
// para batch=50). Worker pool size é configurável via env.OUTBOX_DB_POOL_SIZE
// (default 5). Mesma URL (service_role bypass de RLS via mesma credencial).
const adminClient =
  globalForDb.__adminClient ?? postgres(env.DATABASE_URL, { ...sharedOpts, max: 1 });
const workerClient =
  globalForDb.__workerClient ??
  postgres(env.DATABASE_URL, { ...sharedOpts, max: env.OUTBOX_DB_POOL_SIZE });

if (env.NODE_ENV !== 'production') {
  globalForDb.__runtimeClient = runtimeClient;
  globalForDb.__adminClient = adminClient;
  globalForDb.__workerClient = workerClient;
}

// Three physically distinct Drizzle instances over three pools:
//   - db        : runtime, user-facing, RLS-enforcing (authenticated role)
//   - dbAdmin   : admin path, BYPASSRLS, MAX:1 (sparse)
//   - dbWorker  : outbox worker hot-loop, BYPASSRLS, MAX:N (env-tuned)
// Pool sizes are intentionally conservative for serverless multiplication.
// Tune up only with hard observability data (C16), not on speculation.
export const db = drizzle(runtimeClient, { schema });
export const dbAdmin = drizzle(adminClient, { schema });
export const dbWorker = drizzle(workerClient, { schema });

export type Db = typeof db;
export type DbAdmin = typeof dbAdmin;
export type DbWorker = typeof dbWorker;

/**
 * Type of the transaction handle exposed by `db.transaction(async (tx) => ...)`
 * and `dbAdmin.transaction(async (tx) => ...)`. Used in helper signatures
 * across C4+ (publishEvent, logAudit, handler ctx, etc.) so call sites can
 * pass tx around without re-deriving the type at every import.
 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
