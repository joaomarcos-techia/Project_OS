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
 * `auth.ratelimit.degraded` (métrica + `logger.warn`, com `reason_category`) e
 * caímos para um limiter IN-MEMORY POR INSTÂNCIA.
 *
 * **Limitação documentada (ADR):** o fallback in-memory é per-instância. Com N
 * instâncias o limite efetivo é ~N× o configurado e um atacante pode distribuir
 * requisições para multiplicá-lo. É proteção PARCIAL durante outage do Upstash,
 * degradação aceita — NÃO equivalente ao Upstash (que é global). Ver ADR-008/F-08.
 *
 * **R7 (auditoria Redis) — semântica na degradação:** o primário é *sliding
 * window* (suave); o fallback é *fixed-window* (`BoundedFallbackLimiter`), com a
 * janela ancorada no PRIMEIRO hit da chave (não alinhada ao relógio). Isso permite
 * um burst na borda de **2×limite − 1** num intervalo arbitrariamente curto
 * ((limite−1) no fim da janela 1 + limite no início da janela 2) — medido em
 * [rate-limit.test.ts]. Divergência pequena, ativa SÓ em degradação — ciência ao
 * ler as métricas de degradação.
 *
 * **Chaves Redis (R2/R3 da auditoria):** montadas por `redisKey.*` (ponto único,
 * espelhando o papel de `withTenant`/`defaultTenantPolicy` no RLS). Toda chave
 * carrega um discriminador de ambiente (`VERCEL_ENV ?? NODE_ENV`) para que
 * dev/preview/prod nunca colidam mesmo se compartilharem a Upstash DB. Chaves
 * globais/pré-auth (IP, email_hash) usam `redisKey.global`; qualquer uso futuro
 * de dado por clínica DEVE usar `redisKey.tenant(clinicId, …)` — ver CONVENTIONS.
 *
 * Server-only.
 */
import 'server-only';

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { env } from '@/lib/env';
import { logger } from '@/lib/observability/logger';
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
  inviteClinic: new BoundedFallbackLimiter(20, ONE_HOUR_MS),
  inviteActor: new BoundedFallbackLimiter(10, ONE_HOUR_MS),
  mfaUser: new BoundedFallbackLimiter(10, FIFTEEN_MIN_MS),
  mfaIp: new BoundedFallbackLimiter(20, FIFTEEN_MIN_MS),
  pdfUser: new BoundedFallbackLimiter(10, FIFTEEN_MIN_MS),
  pdfClinic: new BoundedFallbackLimiter(30, FIFTEEN_MIN_MS),
};

/**
 * Convenção de chaves Redis (R2/R3 da auditoria) — ponto ÚNICO de montagem.
 *
 * `envSegment` = discriminador de ambiente. `VERCEL_ENV` (auto-injetado pela
 * Vercel: production/preview/development) distingue Preview de Production; cai
 * no `NODE_ENV` fora da Vercel (dev local, CI). Assim dev/preview/prod nunca
 * colidem no Redis mesmo se apontarem para a mesma Upstash DB por engano — a
 * separação de DBs continua sendo a defesa primária; isto é cinto-e-suspensório.
 */
const envSegment = env.VERCEL_ENV ?? env.NODE_ENV;

export const redisKey = {
  /** Chave global / pré-auth (sem dado de tenant). Ex.: `redisKey.global('rl','login','ip')`. */
  global(...segments: string[]): string {
    return [envSegment, ...segments].join(':');
  },
  /**
   * Chave com dado de tenant — o `clinicId` é OBRIGATÓRIO e vem sempre primeiro
   * (`t:{clinicId}`), para nunca ser esquecido (espelha `withTenant`). Uso futuro
   * (cache/lock por clínica); hoje o rate-limit é pré-auth e usa só `global`.
   */
  tenant(clinicId: string, ...segments: string[]): string {
    return [envSegment, `t:${clinicId}`, ...segments].join(':');
  },
};

/**
 * Normaliza um IP para a chave de rate-limit (R4).
 *   - IPv4 → inalterado.
 *   - IPv6 → prefixo /64 (primeiros 4 hextets). Um /64 é a menor alocação típica
 *     por cliente; sem isto, um atacante com um bloco /64 controla 2^64 endereços
 *     e o limite por-IP vira inócuo.
 *
 * SÓ para a chave — `getClientIp` continua devolvendo o IP completo, que alimenta
 * o audit trail `login_attempts` (forense precisa do IP inteiro).
 */
export function ipRateLimitKey(ip: string): string {
  if (!ip.includes(':')) return ip; // IPv4 (ou vazio) — sem normalização
  const hextets = expandIpv6(ip);
  if (!hextets) return ip; // não parseável → fallback seguro (chave original)
  return hextets.slice(0, 4).join(':') + '::/64';
}

/**
 * Expande um IPv6 para 8 hextets, tratando corretamente a compressão `::`
 * (onde split ingênuo por `:` quebra). Retorna null se não for IPv6 válido.
 */
function expandIpv6(ip: string): string[] | null {
  let addr = ip;
  const zone = addr.indexOf('%'); // remove zona (%eth0), se houver
  if (zone !== -1) addr = addr.slice(0, zone);

  const parts = addr.split('::');
  if (parts.length > 2) return null; // `::` só pode aparecer 1×
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];

  if (parts.length === 1) {
    return head.length === 8 ? head : null; // sem `::` → exige 8 hextets
  }
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  return [...head, ...Array<string>(missing).fill('0'), ...tail];
}

/**
 * Classifica o erro do Upstash em categorias ESTRUTURADAS (nunca por parsing de
 * mensagem — R1 da auditoria). Realidade do `@upstash/redis` v1.38:
 *   - Resposta de erro do endpoint (inclui 429/cota) → `UpstashError`
 *     (`err.name === 'UpstashError'`), MAS o status HTTP é DESCARTADO pela lib —
 *     não dá p/ isolar cota de outros erros de servidor sem parsear string.
 *   - Falha de transporte (fetch falhou, timeout/`AbortError`, retries esgotados)
 *     → `Error`/`TypeError` comum, NÃO `UpstashError`.
 * Daí a divisão honesta `network | server | other` (não `quota`): operadores
 * correlacionam um pico de `server` com o painel de cota do Upstash (a
 * recomendação de ops do R1 já pede monitorar a cota).
 */
export type DegradedReason = 'network' | 'server' | 'other';

export function classifyRedisError(err: unknown): DegradedReason {
  if (!(err instanceof Error)) return 'other';
  // `.name` é propriedade oficial e estável que a lib seta explicitamente.
  if (err.name === 'UpstashError' || err.name === 'UpstashJSONParseError') return 'server';
  return 'network'; // AbortError (timeout), TypeError('fetch failed'), retries esgotados
}

/**
 * Ponto ÚNICO de emissão da degradação (R1): métrica agregável (SLI) + `logger.warn`
 * (linha de nível apropriado para a saved-search de alerta do Better Stack, no
 * MESMO pipeline stdout — sem 2ª fonte da verdade). SEM `captureException`: o
 * fail-open é by-design e o ADR-029 mantém logs fora do Sentry. `reason` (mensagem
 * crua, sanitizada nos dois emissores) fica só como diagnóstico, nunca como lógica.
 */
function degraded(
  kind: 'login' | 'reset' | 'join' | 'invite' | 'mfa' | 'pdf',
  err: unknown,
  fallbackAllowed: boolean,
): LimitResult {
  const fields = {
    kind,
    reason_category: classifyRedisError(err),
    reason: err instanceof Error ? err.message : String(err),
  };
  metrics.emit('auth.ratelimit.degraded', fields);
  logger.warn('auth.ratelimit.degraded', fields);
  return fallbackAllowed ? { ok: true } : { ok: false, reason: 'rate_limited' };
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
      ip: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '15 m'), prefix: redisKey.global('rl', 'login', 'ip'), analytics: false }),
      email: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '15 m'), prefix: redisKey.global('rl', 'login', 'email'), analytics: false }),
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
      ip: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '1 h'), prefix: redisKey.global('rl', 'reset', 'ip'), analytics: false }),
      email: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, '1 h'), prefix: redisKey.global('rl', 'reset', 'email'), analytics: false }),
    };
    return cached;
  };
})();

/**
 * Chama AMBOS os limites (IP + email_hash). Bloqueia se QUALQUER um exceder.
 * F-08: nunca lança — falha do Upstash → degradado (fail-open + fallback local).
 */
export async function assertLoginAllowed(ip: string, emailHash: string): Promise<LimitResult> {
  const ipKey = ipRateLimitKey(ip);
  try {
    const { ip: ipLimiter, email: emailLimiter } = lazyLoginLimiters();
    const [ipResult, emailResult] = await Promise.all([
      ipLimiter.limit(ipKey),
      emailLimiter.limit(emailHash),
    ]);
    if (!ipResult.success || !emailResult.success) {
      return { ok: false, reason: 'rate_limited' };
    }
    return { ok: true };
  } catch (err) {
    const ipOk = fallback.loginIp.hit(ipKey);
    const emailOk = fallback.loginEmail.hit(emailHash);
    return degraded('login', err, ipOk && emailOk);
  }
}

/**
 * F-06: rate limit do password reset (mesma defesa do login). Sempre que o
 * caller mantém `sent:true` (anti-enumeration), o resultado só decide se o email
 * de reset é REALMENTE disparado. F-08: nunca lança (fail-open + fallback).
 */
export async function assertPasswordResetAllowed(ip: string, emailHash: string): Promise<LimitResult> {
  const ipKey = ipRateLimitKey(ip);
  try {
    const { ip: ipLimiter, email: emailLimiter } = lazyResetLimiters();
    const [ipResult, emailResult] = await Promise.all([
      ipLimiter.limit(ipKey),
      emailLimiter.limit(emailHash),
    ]);
    if (!ipResult.success || !emailResult.success) {
      return { ok: false, reason: 'rate_limited' };
    }
    return { ok: true };
  } catch (err) {
    const ipOk = fallback.resetIp.hit(ipKey);
    const emailOk = fallback.resetEmail.hit(emailHash);
    return degraded('reset', err, ipOk && emailOk);
  }
}

const lazyJoinLimiter = (() => {
  let cached: Ratelimit | null = null;
  return () => {
    if (cached) return cached;
    cached = new Ratelimit({
      redis: lazyRedis(),
      limiter: Ratelimit.slidingWindow(30, '15 m'),
      prefix: redisKey.global('rl', 'join', 'ip'),
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
  const ipKey = ipRateLimitKey(ip);
  try {
    const r = await lazyJoinLimiter().limit(ipKey);
    return r.success ? { ok: true } : { ok: false, reason: 'rate_limited' };
  } catch (err) {
    return degraded('join', err, fallback.joinIp.hit(ipKey));
  }
}

const lazyInviteLimiters = (() => {
  let cached: { clinic: Ratelimit; actor: Ratelimit } | null = null;
  return () => {
    if (cached) return cached;
    const redis = lazyRedis();
    cached = {
      clinic: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20, '1 h'), prefix: redisKey.global('rl', 'invite', 'clinic'), analytics: false }),
      actor: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '1 h'), prefix: redisKey.global('rl', 'invite', 'actor'), analytics: false }),
    };
    return cached;
  };
})();

/**
 * M3: rate limit de convite/reenvio, por clínica E por ator. Diferente dos demais,
 * este é PÓS-auth: o gate `requireFreshPermission(MANAGE_EMPLOYEES)` já passou. O
 * risco não é o anônimo — é o gestor autorizado-porém-malicioso (ou a conta dele
 * comprometida) em loop: cada `resendInvite` gera um recovery link REAL no Supabase
 * + e-mail. Sem teto, a marca do cliente vira fonte de spam. Por ator pega a conta
 * comprometida; por clínica impede que N gestores somem para o mesmo efeito.
 *
 * Chave: `redisKey.global('rl','invite','clinic')` + clinicId como identifier —
 * e NÃO `redisKey.tenant()`. Duas razões: (1) o Upstash monta a chave como
 * `[prefix, identifier].join(':')` com prefix ESTÁTICO, e `t:{clinicId}` teria de vir
 * antes dele; (2) a regra de CONVENTIONS protege DADO de tenant (cache/lock) contra
 * vazamento cross-tenant — um contador cujo próprio identifier é o clinicId não tem
 * o que vazar, e o clinicId é parâmetro obrigatório aqui, não pode ser esquecido.
 * Mantém a forma dos outros 5 limiters. F-08: nunca lança (fail-open + fallback).
 */
export async function assertInviteAllowed(
  clinicId: string,
  actorUserId: string,
): Promise<LimitResult> {
  try {
    const { clinic, actor } = lazyInviteLimiters();
    const [clinicResult, actorResult] = await Promise.all([
      clinic.limit(clinicId),
      actor.limit(actorUserId),
    ]);
    if (!clinicResult.success || !actorResult.success) {
      return { ok: false, reason: 'rate_limited' };
    }
    return { ok: true };
  } catch (err) {
    const clinicOk = fallback.inviteClinic.hit(clinicId);
    const actorOk = fallback.inviteActor.hit(actorUserId);
    return degraded('invite', err, clinicOk && actorOk);
  }
}

const lazyMfaLimiters = (() => {
  let cached: { user: Ratelimit; ip: Ratelimit } | null = null;
  return () => {
    if (cached) return cached;
    const redis = lazyRedis();
    cached = {
      user: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '15 m'), prefix: redisKey.global('rl', 'mfa', 'user'), analytics: false }),
      ip: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20, '15 m'), prefix: redisKey.global('rl', 'mfa', 'ip'), analytics: false }),
    };
    return cached;
  };
})();

/**
 * M3: rate limit da superfície MFA (verify no login + enroll/unenroll). Hoje o
 * brute-force do 2º fator depende SÓ do throttle do GoTrue — defesa de terceiro,
 * sem visibilidade nossa. 10/15min por usuário deixa folga para quem erra o código
 * (o TOTP roda a cada 30s) e ainda torna os 10^6 códigos inviáveis. O limite por IP
 * (20/15min) é mais frouxo de propósito: uma clínica atrás de NAT compartilha IP.
 *
 * F-08: nunca lança (fail-open + fallback per-instância).
 */
export async function assertMfaAllowed(userId: string, ip: string): Promise<LimitResult> {
  const ipKey = ipRateLimitKey(ip);
  try {
    const { user, ip: ipLimiter } = lazyMfaLimiters();
    const [userResult, ipResult] = await Promise.all([user.limit(userId), ipLimiter.limit(ipKey)]);
    if (!userResult.success || !ipResult.success) {
      return { ok: false, reason: 'rate_limited' };
    }
    return { ok: true };
  } catch (err) {
    const userOk = fallback.mfaUser.hit(userId);
    const ipOk = fallback.mfaIp.hit(ipKey);
    return degraded('mfa', err, userOk && ipOk);
  }
}

const lazyPdfLimiters = (() => {
  let cached: { user: Ratelimit; clinic: Ratelimit } | null = null;
  return () => {
    if (cached) return cached;
    const redis = lazyRedis();
    cached = {
      user: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '15 m'), prefix: redisKey.global('rl', 'pdf', 'user'), analytics: false }),
      clinic: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, '15 m'), prefix: redisKey.global('rl', 'pdf', 'clinic'), analytics: false }),
    };
    return cached;
  };
})();

/**
 * B6: teto das rotas que rendem PDF (`/relatorios/pdf`, export de auditoria do
 * admin). O render é `@react-pdf` sobre yoga/WASM — caro em CPU e memória, e sem
 * teto um usuário AUTENTICADO degrada a instância só pedindo PDFs em sequência.
 * Não é defesa contra anônimo; é contra o custo desproporcional por request.
 *
 * F-08: nunca lança (fail-open + fallback per-instância).
 */
export async function assertPdfExportAllowed(
  clinicId: string,
  userId: string,
): Promise<LimitResult> {
  try {
    const { user, clinic } = lazyPdfLimiters();
    const [userResult, clinicResult] = await Promise.all([
      user.limit(userId),
      clinic.limit(clinicId),
    ]);
    if (!userResult.success || !clinicResult.success) {
      return { ok: false, reason: 'rate_limited' };
    }
    return { ok: true };
  } catch (err) {
    const userOk = fallback.pdfUser.hit(userId);
    const clinicOk = fallback.pdfClinic.hit(clinicId);
    return degraded('pdf', err, userOk && clinicOk);
  }
}

/**
 * Extrai o IP do client a partir de headers Vercel. Devolve o IP COMPLETO (o
 * caller usa também no audit trail `login_attempts` — a normalização /64 para
 * chave de rate-limit vive em `ipRateLimitKey`, não aqui).
 *
 * **Premissa "atrás do Vercel" (R4):** `x-forwarded-for[0]` é confiável porque a
 * plataforma sobrescreve o XFF com o IP real do client. Fora do Vercel / atrás de
 * outro proxy o XFF é SPOOFÁVEL — ao migrar de infra, derivar o client IP de um
 * header confiável da própria borda, NUNCA do XFF cru. Fallback '0.0.0.0'.
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

/** Test-only — expõe o ponto privado de emissão de degradação (padrão do repo). */
export const __testing__ = { degraded, envSegment };
