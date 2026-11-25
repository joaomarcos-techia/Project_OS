import 'server-only';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { logger } from '@/lib/observability/logger';

/**
 * Fallback do limite de login no BANCO quando o Upstash está degradado (S8, requisito 69 do componente de
 * segurança da ANS, 202511).
 *
 * O requisito: bloquear, ao menos temporariamente, após no máximo 5 tentativas inválidas, "por qualquer meio de
 * acesso". O fallback em memória do `rate-limit.ts` é por instância: no serverless, N instâncias dão N × 5
 * tentativas, e uma instância nova começa do zero. Aqui a contagem é a mesma para todas as instâncias, porque vem
 * da trilha `login_attempts`, que o login já grava a cada falha.
 *
 * Regra de falha segura: se o banco também não responde, o login FECHA (`unavailable`). Nunca há tentativa
 * ilimitada porque a infraestrutura caiu. A recuperação de senha tem limite próprio e não depende disto.
 *
 * Custo: só roda quando o Upstash falhou; uma consulta por login, nos índices
 * `login_attempts_email_hash_attempted_at_idx` e `login_attempts_ip_attempted_at_idx`.
 */
export const LOGIN_AUDIT_FALLBACK = {
  windowMinutes: 15,
  /** Mesmo teto do Upstash por e-mail (5 em 15 min) — o máximo que o requisito 69 admite. */
  maxFailuresPerEmail: 5,
  /** Mesmo teto do Upstash por IP (10 em 15 min). */
  maxFailuresPerIp: 10,
} as const;

export type LoginAuditDecision = 'allowed' | 'blocked' | 'unavailable';

export interface RecentFailures {
  byEmail: number;
  byIp: number;
}

/** Decisão pura: bloqueia quando a próxima tentativa passaria do teto (≥ teto falhas já registradas). */
export function decideFromRecentFailures(
  f: RecentFailures,
): Exclude<LoginAuditDecision, 'unavailable'> {
  if (!Number.isFinite(f.byEmail) || !Number.isFinite(f.byIp)) return 'blocked';
  if (f.byEmail >= LOGIN_AUDIT_FALLBACK.maxFailuresPerEmail) return 'blocked';
  if (f.byIp >= LOGIN_AUDIT_FALLBACK.maxFailuresPerIp) return 'blocked';
  return 'allowed';
}

type Query = (emailHash: string, ip: string) => Promise<RecentFailures>;

const queryRecentFailures: Query = async (emailHash, ip) => {
  const rows = (await dbAdmin.execute(sql`
    SELECT
      count(*) FILTER (WHERE email_hash = ${emailHash})::int AS by_email,
      count(*) FILTER (WHERE ip = ${ip}::inet)::int AS by_ip
    FROM public.login_attempts
    WHERE success = false
      AND attempted_at > now() - make_interval(mins => ${LOGIN_AUDIT_FALLBACK.windowMinutes})
      AND (email_hash = ${emailHash} OR ip = ${ip}::inet)
  `)) as unknown as Array<{ by_email: number; by_ip: number }>;
  const row = rows[0];
  return { byEmail: Number(row?.by_email ?? 0), byIp: Number(row?.by_ip ?? 0) };
};

/**
 * Consulta a trilha e decide. Nunca lança: erro do banco vira `unavailable`, que o login trata como FECHADO.
 * `query` é injetável para teste.
 */
export async function checkLoginByAuditTrail(
  emailHash: string,
  ip: string,
  query: Query = queryRecentFailures,
): Promise<LoginAuditDecision> {
  try {
    return decideFromRecentFailures(await query(emailHash, ip));
  } catch (err) {
    logger.warn('auth.ratelimit.audit_fallback_failed', {
      reason: err instanceof Error ? err.name : 'unknown',
    });
    return 'unavailable';
  }
}
