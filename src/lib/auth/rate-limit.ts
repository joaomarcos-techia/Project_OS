/**
 * Rate limit DUAL (D15) — duas sliding windows independentes (Upstash):
 *   login : por IP 10/15min ; por email_hash 5/15min
 *   reset : por IP 10/1h    ; por email_hash 3/1h   (F-06)
 *
 * Mitiga credential stuffing distribuído (atacante varia IP, alvo único): o
 * limit por email_hash quebra mesmo se cada IP fizer 1 tentativa.
 *
 * F-08 — DISPONIBILIDADE (fail-open + fallback local): se o Upstash estiver
 * inacessível, NÃO derrubamos o login (que ainda exige senha + MFA). Emitimos
 * `auth.ratelimit.degraded` e caímos para um limiter IN-MEMORY POR INSTÂNCIA.
 *
 * **Limitação documentada (ADR):** o fallback in-memory é per-instância. Com N
 * instâncias o limite efetivo é ~N× o configurado e um atacante pode distribuir
 * requisições para multiplicá-lo. É proteção PARCIAL durante outage do Upstash,
 * degradação aceita — NÃO equivalente ao Upstash (que é global). Ver ADR-008/F-08.
 *
 * Server-only.
 */
import 'server-only';

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

type LimitResult = { ok: true } | { ok: false; reason: 'rate_limited' };

/**
 * Fallback in-memory: fixed-window counter, BOUNDED (F-08).
 *
 * Estrutura fixada: `Map<string, Entry>` aproveitando a ordem-de-inserção nativa
 * do JS — `map.keys().next().value` é a chave mais antiga → evicção FIFO O(1).
 * (NÃO usar array+shift, que degrada O(n).) Contenção de memória obrigatória:
 *   - TTL por entrada (resetAt);
 *   - limpeza automática (sweep das expiradas em evictIfNeeded);
 *   - cap de entradas (maxEntries, default 10_000) com descarte FIFO;
 *   - sem crescimento ilimitado: size <= maxEntries sempre.
 */
type WindowEntry = { count: number; resetAt: number };

export class BoundedFallbackLimiter {
  private readonly map = new Map<string, WindowEntry>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxEntries = 10_000,
  ) {}

  /** Registra um hit; retorna true se ainda DENTRO do limite (allowed). */
  hit(key: string): boolean {
    const now = Date.now();
    const existing = this.map.get(key);
    if (existing && existing.resetAt > now) {
      existing.count += 1;
      return existing.count <= this.limit;
    }
    // Nova janela ou expirada → entrada fresca movida para o fim (FIFO correto).
    if (existing) this.map.delete(key);
    this.evictIfNeeded(now);
    this.map.set(key, { count: 1, resetAt: now + this.windowMs });
    return this.limit >= 1;
  }

  /** Sweep das expiradas + cap FIFO. Mantém size <= maxEntries. */
  private evictIfNeeded(now: number): void {
    if (this.map.size < this.maxEntries) return;
    for (const [k, v] of this.map) {
      if (v.resetAt <= now) this.map.delete(k);
      if (this.map.size < this.maxEntries) return;
    }
    // Todas vivas e ainda no cap → descarta a inserida há mais tempo (FIFO).
    while (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  /** Test-only: nº de entradas retidas. */
  get size(): number {
    return this.map.size;
  }

  /** Test-only: remove as entradas expiradas em `now`. */
  sweepExpired(now: number = Date.now()): void {
    for (const [k, v] of this.map) if (v.resetAt <= now) this.map.delete(k);
  }
}

const FIFTEEN_MIN_MS = 15 * 60_000;
const ONE_HOUR_MS = 60 * 60_000;

// Fallbacks per-instância (lazy: só alocam Map quando usados).
const fallback = {
  loginIp: new BoundedFallbackLimiter(10, FIFTEEN_MIN_MS),
  loginEmail: new BoundedFallbackLimiter(5, FIFTEEN_MIN_MS),
  resetIp: new BoundedFallbackLimiter(10, ONE_HOUR_MS),
  resetEmail: new BoundedFallbackLimiter(3, ONE_HOUR_MS),
  joinIp: new BoundedFallbackLimiter(30, FIFTEEN_MIN_MS),
};

function degraded(
  kind: 'login' | 'reset',
  ipLimiter: BoundedFallbackLimiter,
  emailLimiter: BoundedFallbackLimiter,
  ip: string,
  emailHash: string,
  err: unknown,
): LimitResult {
  metrics.emit('auth.ratelimit.degraded', {
    kind,
    reason: err instanceof Error ? err.message : String(err),
  });
  // Fail-open com proteção PARCIAL (per-instância).
  const ipOk = ipLimiter.hit(ip);
  const emailOk = emailLimiter.hit(emailHash);
  return ipOk && emailOk ? { ok: true } : { ok: false, reason: 'rate_limited' };
}

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

const lazyLoginLimiters = (() => {
  let cached: { ip: Ratelimit; email: Ratelimit } | null = null;
  return () => {
    if (cached) return cached;
    const redis = lazyRedis();
    cached = {
      ip: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '15 m'), prefix: 'rl:login:ip', analytics: false }),
      email: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '15 m'), prefix: 'rl:login:email', analytics: false }),
    };
    return cached;
  };
})();

const lazyResetLimiters = (() => {
  let cached: { ip: Ratelimit; email: Ratelimit } | null = null;
  return () => {
    if (cached) return cached;
    const redis = lazyRedis();
    cached = {
      ip: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '1 h'), prefix: 'rl:reset:ip', analytics: false }),
      email: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, '1 h'), prefix: 'rl:reset:email', analytics: false }),
    };
    return cached;
  };
})();

/**
 * Chama AMBOS os limites (IP + email_hash). Bloqueia se QUALQUER um exceder.
 * F-08: nunca lança — falha do Upstash → degradado (fail-open + fallback local).
 */
export async function assertLoginAllowed(ip: string, emailHash: string): Promise<LimitResult> {
  try {
    const { ip: ipLimiter, email: emailLimiter } = lazyLoginLimiters();
    const [ipResult, emailResult] = await Promise.all([
      ipLimiter.limit(ip),
      emailLimiter.limit(emailHash),
    ]);
    if (!ipResult.success || !emailResult.success) {
      return { ok: false, reason: 'rate_limited' };
    }
    return { ok: true };
  } catch (err) {
    return degraded('login', fallback.loginIp, fallback.loginEmail, ip, emailHash, err);
  }
}

/**
 * F-06: rate limit do password reset (mesma defesa do login). Sempre que o
 * caller mantém `sent:true` (anti-enumeration), o resultado só decide se o email
 * de reset é REALMENTE disparado. F-08: nunca lança (fail-open + fallback).
 */
export async function assertPasswordResetAllowed(ip: string, emailHash: string): Promise<LimitResult> {
  try {
    const { ip: ipLimiter, email: emailLimiter } = lazyResetLimiters();
    const [ipResult, emailResult] = await Promise.all([
      ipLimiter.limit(ip),
      emailLimiter.limit(emailHash),
    ]);
    if (!ipResult.success || !emailResult.success) {
      return { ok: false, reason: 'rate_limited' };
    }
    return { ok: true };
  } catch (err) {
    return degraded('reset', fallback.resetIp, fallback.resetEmail, ip, emailHash, err);
  }
}

const lazyJoinLimiter = (() => {
  let cached: Ratelimit | null = null;
  return () => {
    if (cached) return cached;
    cached = new Ratelimit({
      redis: lazyRedis(),
      limiter: Ratelimit.slidingWindow(30, '15 m'),
      prefix: 'rl:join:ip',
      analytics: false,
    });
    return cached;
  };
})();

/**
 * Rate limit do /join (onboarding via convite) — anti brute-force de token, por IP
 * (30/15min). O token de 256 bits já é inviável de adivinhar; isto é defesa em
 * profundidade. F-08: nunca lança (fail-open + fallback per-instância).
 */
export async function assertJoinAllowed(ip: string): Promise<LimitResult> {
  try {
    const r = await lazyJoinLimiter().limit(ip);
    return r.success ? { ok: true } : { ok: false, reason: 'rate_limited' };
  } catch (err) {
    metrics.emit('auth.ratelimit.degraded', {
      kind: 'join',
      reason: err instanceof Error ? err.message : String(err),
    });
    return fallback.joinIp.hit(ip) ? { ok: true } : { ok: false, reason: 'rate_limited' };
  }
}

/**
 * Extrai IP do client a partir de headers Vercel. `x-forwarded-for[0]` é o
 * client real (Vercel garante). Fallback para '0.0.0.0' se ausente.
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
