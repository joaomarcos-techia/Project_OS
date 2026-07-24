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
  // Diz QUAL das duas condições disparou. Elas têm causas e correções opostas, e a
  // mensagem genérica anterior sugeria as duas coisas erradas para o caso comum:
  // `SUPABASE_PROJECT_ENV=prod` GRUDA na sessão do shell depois de um script de prod
  // (db:backup:prod etc.) e envenena todo comando de dev seguinte no mesmo terminal —
  // com o .env.local intacto e a URL de dev. Mandar "conserte o .env.local" manda
  // procurar no lugar errado; "set NODE_ENV=production" faria escrever em prod DE
  // VERDADE, que é o oposto do que o guard existe para impedir.
  const porEnvVar = process.env.SUPABASE_PROJECT_ENV === 'prod';
  throw new Error(
    '[db] FATAL: NODE_ENV não é production, mas o DATABASE_URL parece de prod. ' +
      'Este guard impede o localhost de escrever em prod por acidente.\n' +
      (porEnvVar
        ? '  CAUSA: SUPABASE_PROJECT_ENV=prod está setada nesta sessão do shell.\n' +
          '  Se você acabou de rodar um script de prod (ex.: db:backup:prod), é resíduo dele.\n' +
          '  CORREÇÃO (PowerShell):  Remove-Item Env:SUPABASE_PROJECT_ENV; Remove-Item Env:DATABASE_URL_PROD\n' +
          '  (bash/zsh):             unset SUPABASE_PROJECT_ENV DATABASE_URL_PROD\n' +
          '  Ou simplesmente abra um terminal novo. O .env.local NÃO é o problema aqui.'
        : '  CAUSA: o hostname do DATABASE_URL contém "prod"/"production".\n' +
          '  CORREÇÃO: aponte o DATABASE_URL do .env.local para o projeto de DEV.') +
      '\n  NÃO use NODE_ENV=production para silenciar isto: aí você escreve em prod de verdade.',
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
  // Fail-fast por STATEMENT (GUC por conexão). Sem isto, uma query que trava
  // (lock, agregação patológica, Supabase saturado) segura o render até o undici
  // matar a resposta em ~300s — o "loading infinito". 30s é folga enorme p/ OLTP;
  // qualquer statement que passe disso é bug e deve estourar com erro claro, não
  // pendurar a request. (Não cobre socket morto/Supabase inalcançável — isso é
  // connect_timeout + max_lifetime + restart; ver runbook.)
  connection: { statement_timeout: 30_000, lock_timeout: 15_000 },
};

// Singleton-safe pool storage on globalThis. ONLY active in non-production.
const globalForDb = globalThis as unknown as {
  __runtimeClient?: ReturnType<typeof postgres>;
  __adminClient?: ReturnType<typeof postgres>;
  __workerClient?: ReturnType<typeof postgres>;
};

// V1.3 (auditoria de segurança) — fail-closed OPT-IN: o pool RUNTIME conecta por
// DATABASE_URL_RUNTIME quando definido (role SEM BYPASSRLS → `withTenant` esquecido
// retorna 0 linhas em vez de vazar). Ausente → DATABASE_URL atual (inalterado).
// dbAdmin/dbWorker (abaixo) permanecem no DATABASE_URL (BYPASSRLS, necessário).
const runtimeClient =
  globalForDb.__runtimeClient ??
  postgres(env.DATABASE_URL_RUNTIME ?? env.DATABASE_URL, { ...sharedOpts, max: 2 });
// dbAdmin pool max:5 — C15 (Platform Admin) tornou o admin path NÃO-esparso: cada
// request do painel faz várias leituras (layout + página + pages com Promise.all),
// que o Next renderiza concorrentemente. Com max:1 essas leituras serializavam e
// uma query mais cara virava "loading infinito". 5 é folga suficiente p/ o painel
// (cron/health/webhooks também usam dbAdmin e se beneficiam). HIGH-06: o worker tem
// pool próprio (dbWorker, OUTBOX_DB_POOL_SIZE). Mesma URL (service_role bypassa RLS).
const adminClient =
  globalForDb.__adminClient ?? postgres(env.DATABASE_URL, { ...sharedOpts, max: 2 });
const workerClient =
  globalForDb.__workerClient ??
  postgres(env.DATABASE_URL, { ...sharedOpts, max: 1 });

if (env.NODE_ENV !== 'production') {
  globalForDb.__runtimeClient = runtimeClient;
  globalForDb.__adminClient = adminClient;
  globalForDb.__workerClient = workerClient;
}

// Three physically distinct Drizzle instances over three pools:
//   - db        : runtime, user-facing, RLS-enforcing (authenticated role)
//   - dbAdmin   : admin path, BYPASSRLS, MAX:5 (painel faz fan-out concorrente —
//                 ver nota no adminClient; com MAX:1 virava "loading infinito")
//   - dbWorker  : outbox worker hot-loop, BYPASSRLS, MAX:N (env-tuned)
// Pool sizes are intentionally conservative for serverless multiplication.
// Tune up only with hard observability data (C16), not on speculation.
// NOTA HMR: o pool é cacheado em globalThis (singleton anti-HMR). Mudar `max`
// aqui NÃO pega em hot-reload — exige restart completo do `pnpm dev`.
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
