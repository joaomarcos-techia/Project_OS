/**
 * Rate limit DUAL (D15) — duas sliding windows independentes:
 *   - por IP:         10 tentativas / 15 min
 *   - por email_hash:  5 tentativas / 15 min
 *
 * Mitiga credential stuffing distribuído (atacante varia IP, alvo único):
 * o limit por email_hash quebra mesmo se cada IP fizer 1 tentativa.
 *
 * Server-only. Falha graceful: se Upstash estiver inacessível ou env ausente
 * em DEV, NÃO bloqueia (warn no log). Em prod runtime, env é obrigatório —
 * configurar no Vercel antes de fechar C3.
 */
import 'server-only';

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { env } from '@/lib/env';

type LimitResult = { ok: true } | { ok: false; reason: 'rate_limited' };

const lazyRedis = (() => {
  let cached: Redis | null = null;
  return () => {
    if (cached) return cached;
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error(
        '[auth/rate-limit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN ausentes. ' +
          'Configure antes do login flow (C3).',
      );
    }
    cached = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
    return cached;
  };
})();

const lazyLimiters = (() => {
  let cached: { ip: Ratelimit; email: Ratelimit } | null = null;
  return () => {
    if (cached) return cached;
    const redis = lazyRedis();
    cached = {
      ip: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(10, '15 m'),
        prefix: 'rl:login:ip',
        analytics: false,
      }),
      email: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(5, '15 m'),
        prefix: 'rl:login:email',
        analytics: false,
      }),
    };
    return cached;
  };
})();

/**
 * Chama AMBOS os limites. Bloqueia se QUALQUER um exceder. Mensagem genérica
 * (não revela qual limite falhou — info disclosure mínima).
 */
export async function assertLoginAllowed(
  ip: string,
  emailHash: string,
): Promise<LimitResult> {
  const { ip: ipLimiter, email: emailLimiter } = lazyLimiters();
  const [ipResult, emailResult] = await Promise.all([
    ipLimiter.limit(ip),
    emailLimiter.limit(emailHash),
  ]);
  if (!ipResult.success || !emailResult.success) {
    return { ok: false, reason: 'rate_limited' };
  }
  return { ok: true };
}

/**
 * Extrai IP do client a partir de headers Vercel. `x-forwarded-for[0]` é o
 * client real (Vercel garante). Fallback para 'unknown' se ausente (em testes
 * locais sem proxy). NUNCA retorna o IP do load balancer.
 */
export function getClientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  return '0.0.0.0';
}
