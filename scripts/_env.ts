/**
 * Shared helpers for db:* scripts.
 *
 * Why a separate module:
 *   - Scripts run via `tsx` outside Next.js; they don't get `src/lib/env.ts`
 *     auto-loaded. We load `.env.local` ourselves with dotenv.
 *   - The env-host heuristics, redaction, and prod-context assertion are used
 *     by 4 different scripts. Single source of truth for the safety bar.
 */
import { config as loadDotenv } from 'dotenv';

// MUST be the very first side effect: every script needs the .env.local values
// before reading process.env.
loadDotenv({ path: '.env.local' });

/**
 * Hostname-based heuristic: weak (Supabase hostnames are random strings) but
 * catches the common copy-paste mistake. Returns true if hostname mentions
 * prod/production OR if SUPABASE_PROJECT_ENV is set to 'prod'.
 *
 * Use as a defensive secondary check, NEVER as the sole gate for prod scripts.
 * Prod scripts must call `assertProdContext()` instead.
 */
export function looksLikeProd(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return (
      /(prod|production)/i.test(hostname) || process.env.SUPABASE_PROJECT_ENV === 'prod'
    );
  } catch {
    return false;
  }
}

/**
 * Hard gate for prod scripts. EXPLICIT opt-in via SUPABASE_PROJECT_ENV=prod
 * is mandatory — heuristic-only would let too many false negatives through
 * (Supabase project hostnames don't typically contain "prod").
 *
 * Throws with a clear message if any guard fails.
 */
export function assertProdContext(): { databaseUrl: string } {
  // As duas envs vivem na SESSÃO do shell, nunca no .env.local (que é da máquina de dev
  // e vaza para todo script). Por isso o guard ensina o comando: sem isso, a mensagem
  // diz o QUE falta mas não o COMO, e o operador perde tempo no meio de um incidente.
  const howTo =
    '\n  PowerShell:  $env:SUPABASE_PROJECT_ENV = \'prod\'; $env:DATABASE_URL_PROD = \'postgresql://...?sslmode=require\'' +
    '\n  bash/zsh:    SUPABASE_PROJECT_ENV=prod DATABASE_URL_PROD=\'postgresql://...?sslmode=require\' pnpm <script>' +
    '\n  A URI está em: Supabase → Project Settings → Database → Connection string.' +
    '\n  Feche o terminal (ou Remove-Item Env:DATABASE_URL_PROD) depois — ela tem a senha de prod.';

  const projectEnv = process.env.SUPABASE_PROJECT_ENV;
  if (projectEnv !== 'prod') {
    throw new Error(
      '[guard] SUPABASE_PROJECT_ENV must be set to "prod" before running a prod script. ' +
        'This is the EXPLICIT opt-in — heuristics alone are not enough. ' +
        `Got: ${projectEnv ?? '(unset)'}.` +
        howTo,
    );
  }

  const url = process.env.DATABASE_URL_PROD;
  if (!url) {
    throw new Error(
      '[guard] DATABASE_URL_PROD is required for prod scripts and is unset. ' +
        'Add it to your shell session (NOT to .env.local on dev machines).' +
        howTo,
    );
  }

  if (!url.includes('sslmode=require')) {
    throw new Error(
      '[guard] DATABASE_URL_PROD must contain "sslmode=require". ' +
        'Plaintext Postgres connections are not allowed. Append "?sslmode=require" to the URL.',
    );
  }

  return { databaseUrl: url };
}

/**
 * Mirror of the runtime guard in src/lib/db/index.ts, for scripts that target
 * the DEV connection (db:migrate:dev, db:studio). Refuses to proceed if any
 * prod signal is detected.
 */
export function assertDevContext(): { databaseUrl: string } {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      '[guard] DATABASE_URL is required for dev scripts and is unset. Check .env.local.',
    );
  }

  if (process.env.SUPABASE_PROJECT_ENV === 'prod') {
    throw new Error(
      '[guard] SUPABASE_PROJECT_ENV=prod detected while running a DEV script. Refusing.',
    );
  }

  if (looksLikeProd(url)) {
    throw new Error(
      '[guard] DATABASE_URL hostname looks like prod (matches /prod|production/i). ' +
        'Refusing to run a dev script against a prod-like host. ' +
        'If this is a false positive, rename the host or fix .env.local.',
    );
  }

  if (!url.includes('sslmode=require')) {
    throw new Error(
      '[guard] DATABASE_URL must contain "sslmode=require". ' +
        'Append "?sslmode=require" to your connection string in .env.local. ' +
        'Supabase Transaction Pooler enforces SSL anyway, but the URL form is part ' +
        'of the safety contract — psql/pg_dump rely on the URL string.',
    );
  }

  return { databaseUrl: url };
}

/**
 * Masks the password in a Postgres connection URL for safe logging.
 * `postgres://user:secret@host/db` -> `postgres://user:***@host/db`.
 */
export function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '[unparseable-url]';
  }
}

/**
 * ISO-8601 timestamp safe for filenames on Windows (no colons).
 *   2026-05-26T14:32:08.123Z -> 2026-05-26T14-32-08
 */
export function fsTimestamp(d: Date = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, '');
}

/**
 * Best-effort git user.email for the migrations log. Falls back to OS user
 * if git is unavailable. Never throws — logging the executor is nice-to-have,
 * not a gate.
 */
export function gitUserEmail(): string {
  try {
    // Lazy import: child_process is heavy; keep this fn cheap when unused.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    return execSync('git config user.email', { encoding: 'utf8' }).trim() || 'unknown';
  } catch {
    return process.env.USER || process.env.USERNAME || 'unknown';
  }
}
