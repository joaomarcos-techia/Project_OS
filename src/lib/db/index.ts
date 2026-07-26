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
  // Fail-fast por STATEMENT. ⚠️ ATENÇÃO ao que isto NÃO faz: `connection.*` são
  // parâmetros de STARTUP da sessão postgres.js. O **Transaction Pooler do
  // Supabase (Supavisor, :6543)** — que é o que os três pools abaixo usam via
  // DATABASE_URL/DATABASE_URL_RUNTIME — NÃO os propaga ao backend. Comprovado:
  // `SHOW statement_timeout` volta `2min`, `SHOW lock_timeout` volta `0`. Ou
  // seja: no runtime pooled este bloco é INERTE. O fail-fast REAL do pool
  // runtime (`qoro_runtime`) vive a nível de ROLE na migration 0071
  // (`ALTER ROLE ... SET`), que o Postgres aplica no login do backend e
  // sobrevive ao `SET LOCAL ROLE authenticated` do withTenant.
  //
  // Mantido mesmo assim como defesa para conexões DIRETAS / Session Pooler
  // (:5432), onde parâmetros de startup VALEM — caso alguém aponte DATABASE_URL
  // para 5432. (Os scripts db:migrate/db:backup abrem clients próprios e não
  // herdam sharedOpts.) 30s é folga enorme p/ OLTP. Ver
  // docs/runbooks/runtime-role-nobypassrls.md §"Timeouts (pooler vs direto)".
  connection: { statement_timeout: 30_000, lock_timeout: 15_000 },
};

/**
 * Uma conexão sustenta o advisory lock do tick e a outra executa TX1/TX3.
 * O worker usa esta mesma constante para não tentar trabalho aninhado quando o
 * pool for reduzido no futuro.
 */
export const DB_WORKER_POOL_SIZE = 2;

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
// runtime pool max:6 — mesmo motivo do dbAdmin (2026-07-25): páginas tenant de
// fan-out (`caixa` ~5 leituras concorrentes, `financeiro` ~4) famintavam por conexão
// com max:2 sob pooler lento/cross-region — a mesma classe de "loading infinito" do
// dashboard admin. 6 cabe o fan-out sem serializar. Continua conservador vs o admin
// (8) porque este pool serve TODOS os tenants (mais multiplicação serverless), mas o
// Supavisor (Transaction Pooler) multiplexa, então não pressiona max_connections=60.
// Defesa em profundidade: as páginas de fan-out usam `withQueryDeadline`/`Fallback`
// (query-timeout.ts) para nunca pendurar mesmo se o pool esgotar.
const runtimeClient =
  globalForDb.__runtimeClient ??
  postgres(env.DATABASE_URL_RUNTIME ?? env.DATABASE_URL, { ...sharedOpts, max: 6 });
// dbAdmin pool max:8 — C15 (Platform Admin) tornou o admin path NÃO-esparso: cada
// request do painel faz várias leituras (layout + página com Promise.all). O
// dashboard dispara ~9 queries concorrentes (getDashboard=3, list=3, +3); com max:2
// as DUAS últimas (getStatusBreakdown, list) FAMINTAVAM por conexão e estouravam o
// timeout de 8s da página — "loading infinito"/dados parciais, PROVADO pelo log
// `admin.dash.timeout` (2026-07-25). Não é especulação: é o dado de observabilidade
// que o comentário antigo pedia. max:8 cabe o fan-out sem serializar. Admin é
// super_admin-only (concorrência baixa) e o Supavisor (Transaction Pooler)
// multiplexa em poucas conexões de backend, então não pressiona max_connections=60.
// O worker tem pool próprio (2: lock-holder + trabalho). Mesma URL (service_role
// bypassa RLS).
const adminClient =
  globalForDb.__adminClient ?? postgres(env.DATABASE_URL, { ...sharedOpts, max: 8 });
const workerClient =
  globalForDb.__workerClient ??
  postgres(env.DATABASE_URL, { ...sharedOpts, max: DB_WORKER_POOL_SIZE });

if (env.NODE_ENV !== 'production') {
  globalForDb.__runtimeClient = runtimeClient;
  globalForDb.__adminClient = adminClient;
  globalForDb.__workerClient = workerClient;
}

// Three physically distinct Drizzle instances over three pools:
//   - db        : runtime, user-facing, RLS-enforcing (authenticated role)
//   - dbAdmin   : admin path, BYPASSRLS, MAX:2 (painel faz fan-out concorrente —
//                 ver nota no adminClient; com MAX:1 virava "loading infinito")
//   - dbWorker  : outbox worker hot-loop, BYPASSRLS, MAX:2 (lock + trabalho)
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
