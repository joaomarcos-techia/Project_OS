import 'server-only';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { logger } from '@/lib/observability/logger';

/**
 * Registra uma tentativa de login em `login_attempts` (auditoria pré-auth + base do
 * rate-limit dual). Chama a função SECURITY DEFINER `record_login_attempt`
 * (ADR-008 D9 — INSERT em login_attempts SÓ por ela).
 *
 * ⚠️ I-11a: por que dbAdmin (service_role) e não `supabase.rpc` (anon):
 *   O login flow é uma Server Action (Node) — chamar como `anon` era ESCOLHA, não
 *   necessidade. E `record_login_attempt` estava GRANT a `anon`, o que deixava um
 *   anônimo injetar linhas forjadas via PostgREST. A migration 0042 revoga o grant
 *   de anon; a auditoria passa a rodar por este caminho privilegiado. O
 *   `email_hash` (HMAC com LOGIN_HASH_PEPPER) já protege contra targeting; isto
 *   fecha a POLUIÇÃO da auditoria por anônimo.
 *
 * Best-effort: falha de auditoria NUNCA bloqueia o login (e não o atrasa — dbAdmin
 * é conexão direta, mais rápida que o round-trip HTTP ao PostgREST que havia antes).
 */
export async function recordLoginAttempt(
  emailHash: string,
  ip: string,
  success: boolean,
): Promise<void> {
  try {
    await dbAdmin.execute(
      sql`SELECT public.record_login_attempt(${emailHash}, ${ip}::inet, ${success})`,
    );
  } catch (err) {
    // Não-fatal: preferimos perder a linha de auditoria a travar o login.
    logger.warn('login_audit.record_failed', { message: String(err) });
  }
}
