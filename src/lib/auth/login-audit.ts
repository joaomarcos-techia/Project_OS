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

/**
 * Falhas recentes de login por e-mail (HMAC) e por IP, lidas da trilha `login_attempts`. Base do fallback do limite
 * de tentativas quando o Upstash está degradado (S8, requisito 69 da ANS): a contagem é a mesma para todas as
 * instâncias. LANÇA em erro de banco, de propósito: quem chama (`login-attempts-fallback.ts`) fecha o login.
 *
 * Usa os índices `login_attempts_email_hash_attempted_at_idx` e `login_attempts_ip_attempted_at_idx`.
 */
export async function countRecentLoginFailures(
  emailHash: string,
  ip: string,
  windowMinutes: number,
): Promise<{ byEmail: number; byIp: number }> {
  const rows = (await dbAdmin.execute(sql`
    SELECT
      count(*) FILTER (WHERE email_hash = ${emailHash})::int AS by_email,
      count(*) FILTER (WHERE ip = ${ip}::inet)::int AS by_ip
    FROM public.login_attempts
    WHERE success = false
      AND attempted_at > now() - make_interval(mins => ${windowMinutes})
      AND (email_hash = ${emailHash} OR ip = ${ip}::inet)
  `)) as unknown as Array<{ by_email: number; by_ip: number }>;
  const row = rows[0];
  return { byEmail: Number(row?.by_email ?? 0), byIp: Number(row?.by_ip ?? 0) };
}

/**
 * R42 (requisito 42 da ANS): depois de um login bem-sucedido, o ÚLTIMO acesso anterior (o login de sucesso antes
 * deste) e as tentativas sem sucesso desde então. Lido da trilha `login_attempts` pelo e-mail em HMAC — nunca por
 * dado vindo do navegador; nunca expõe IP. Chamar ANTES de registrar o login atual: assim o último sucesso é sempre
 * o anterior, sem depender de relógio.
 */
export async function readLastAccessSummary(
  emailHash: string,
): Promise<{ previousSuccessAt: Date | null; failuresSince: number }> {
  const rows = (await dbAdmin.execute(sql`
    WITH prev AS (
      SELECT attempted_at FROM public.login_attempts
       WHERE email_hash = ${emailHash} AND success = true
       ORDER BY attempted_at DESC LIMIT 1
    )
    SELECT (SELECT attempted_at FROM prev) AS previous_success_at,
           (SELECT count(*)::int FROM public.login_attempts
             WHERE email_hash = ${emailHash} AND success = false
              
               AND attempted_at > coalesce((SELECT attempted_at FROM prev), '-infinity'::timestamptz)) AS failures_since
  `)) as unknown as Array<{ previous_success_at: Date | string | null; failures_since: number }>;
  const r = rows[0];
  return {
    previousSuccessAt: r?.previous_success_at ? new Date(r.previous_success_at) : null,
    failuresSince: Number(r?.failures_since ?? 0),
  };
}
