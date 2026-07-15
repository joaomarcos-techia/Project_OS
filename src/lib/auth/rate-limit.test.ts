import { describe, expect, it, vi } from 'vitest';

import { logger } from '@/lib/observability/logger';
import { metrics } from '@/lib/observability/metrics';

import {
  BoundedFallbackLimiter,
  classifyRedisError,
  ipRateLimitKey,
  redisKey,
  __testing__,
} from './rate-limit';

/**
 * F-08: prova de contenção de memória do fallback in-memory. Sem isso, o finding
 * (memory leak) pode reaparecer.
 */
describe('BoundedFallbackLimiter (F-08) — contenção de memória', () => {
  it('respeita o cap: 12.000 chaves distintas → ≤ 10.000 entradas retidas', () => {
    const limiter = new BoundedFallbackLimiter(5, 60_000, 10_000);
    for (let i = 0; i < 12_000; i++) limiter.hit(`k${i}`);
    expect(limiter.size).toBeLessThanOrEqual(10_000);
  });

  it('remove entradas expiradas no sweep (TTL)', () => {
    const limiter = new BoundedFallbackLimiter(5, 10); // janela 10ms
    limiter.hit('a');
    limiter.hit('b');
    expect(limiter.size).toBe(2);
    limiter.sweepExpired(Date.now() + 1_000); // 1s no futuro → ambas expiradas
    expect(limiter.size).toBe(0);
  });

  it('aplica o limite dentro da janela (allow até o limite, depois bloqueia)', () => {
    const limiter = new BoundedFallbackLimiter(3, 60_000);
    expect(limiter.hit('x')).toBe(true); // 1
    expect(limiter.hit('x')).toBe(true); // 2
    expect(limiter.hit('x')).toBe(true); // 3
    expect(limiter.hit('x')).toBe(false); // 4 > limite
    // chave distinta tem janela própria.
    expect(limiter.hit('y')).toBe(true);
  });

  it('mantém size <= cap mesmo com muito mais chaves que o cap', () => {
    const limiter = new BoundedFallbackLimiter(5, 60_000, 100);
    for (let i = 0; i < 500; i++) limiter.hit(`k${i}`);
    expect(limiter.size).toBeLessThanOrEqual(100);
  });
});

/**
 * R2/R3 (auditoria Redis) — convenção de chaves. Trava a barreira que a auditoria
 * pede ("sem convenção nem lint, nada barra isso"): discriminador de ambiente em
 * TODA chave + `t:{clinicId}` obrigatório e primeiro nas chaves de tenant.
 */
describe('redisKey — convenção de chaves (R2/R3)', () => {
  const seg = __testing__.envSegment;

  it('global: discriminador de ambiente primeiro, segmentos juntos por ":"', () => {
    expect(redisKey.global('rl', 'login', 'ip')).toBe(`${seg}:rl:login:ip`);
  });

  it('discriminador de ambiente é não-vazio e é sempre o primeiro segmento', () => {
    expect(seg).toBeTruthy();
    expect(redisKey.global('x').split(':')[0]).toBe(seg);
    expect(redisKey.tenant('c1', 'x').split(':')[0]).toBe(seg);
  });

  it('tenant: clinicId embutido como `t:{clinicId}` logo após o ambiente (R2)', () => {
    expect(redisKey.tenant('clinic-123', 'cache', 'agenda')).toBe(
      `${seg}:t:clinic-123:cache:agenda`,
    );
  });

  it('duas clínicas com a mesma sub-chave NÃO colidem (isolamento cross-tenant)', () => {
    expect(redisKey.tenant('A', 'cache', 'agenda')).not.toBe(
      redisKey.tenant('B', 'cache', 'agenda'),
    );
  });
});

/**
 * R4 (auditoria Redis) — IPv6 normalizado para /64 na chave de rate-limit. Foco no
 * IPv6 comprimido (`::`), onde split ingênuo por ":" costuma introduzir bug.
 */
describe('ipRateLimitKey — normalização /64 (R4)', () => {
  it('IPv4 passa inalterado', () => {
    expect(ipRateLimitKey('203.0.113.7')).toBe('203.0.113.7');
    expect(ipRateLimitKey('0.0.0.0')).toBe('0.0.0.0');
  });

  it('IPv6 completo → /64 (primeiros 4 hextets)', () => {
    expect(ipRateLimitKey('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
  });

  it('IPv6 comprimido `::` → /64 estável e consistente com a forma completa', () => {
    // 2001:db8::1 e 2001:db8::2 estão no MESMO /64 → mesma chave.
    const k1 = ipRateLimitKey('2001:db8::1');
    const k2 = ipRateLimitKey('2001:db8::2');
    expect(k1).toBe(k2);
    expect(k1).toBe('2001:db8:0:0::/64');
    // `::` no fim e no começo não devem quebrar.
    expect(ipRateLimitKey('fe80::')).toBe('fe80:0:0:0::/64');
    expect(ipRateLimitKey('::1')).toBe('0:0:0:0::/64');
  });

  it('endereços do MESMO /64 colapsam; /64 diferentes não colidem', () => {
    expect(ipRateLimitKey('2001:db8:aa:bb:1:1:1:1')).toBe(
      ipRateLimitKey('2001:db8:aa:bb:ffff:ffff:ffff:ffff'),
    );
    expect(ipRateLimitKey('2001:db8:aa:bb::1')).not.toBe(
      ipRateLimitKey('2001:db8:aa:cc::1'),
    );
  });
});

/**
 * R1 (auditoria Redis) — classificação ESTRUTURADA do erro (nunca por parsing de
 * mensagem). Realidade do @upstash/redis: `UpstashError` (endpoint respondeu erro,
 * inclui 429/cota) vs erro de transporte (fetch/timeout) que NÃO é UpstashError.
 */
describe('classifyRedisError — categorias estruturadas (R1)', () => {
  it('UpstashError (endpoint respondeu erro, inclui 429/cota) → server', () => {
    const e = new Error('WRONGPASS invalid or missing auth token, command was: ...');
    e.name = 'UpstashError';
    expect(classifyRedisError(e)).toBe('server');
  });

  it('UpstashJSONParseError → server', () => {
    const e = new Error('Unable to parse response body');
    e.name = 'UpstashJSONParseError';
    expect(classifyRedisError(e)).toBe('server');
  });

  it('timeout (AbortError) → network', () => {
    const e = new Error('The operation was aborted');
    e.name = 'AbortError';
    expect(classifyRedisError(e)).toBe('network');
  });

  it('falha de fetch / retries esgotados → network', () => {
    expect(classifyRedisError(new TypeError('fetch failed'))).toBe('network');
    expect(classifyRedisError(new Error('Exhausted all retries'))).toBe('network');
  });

  it('valor não-Error → other', () => {
    expect(classifyRedisError('boom')).toBe('other');
    expect(classifyRedisError(undefined)).toBe('other');
  });
});

/**
 * R1 — a degradação é um ponto ÚNICO de emissão: métrica (SLI) + logger.warn
 * (alertável), ambos com `reason_category` estruturado. Fail-open preservado.
 */
describe('degraded — emissão de alerta na degradação (R1)', () => {
  it('emite métrica + logger.warn com reason_category e respeita o fallback', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const emit = vi.spyOn(metrics, 'emit').mockImplementation(() => {});

    const upstashErr = new Error('max daily request limit exceeded');
    upstashErr.name = 'UpstashError';

    const allowed = __testing__.degraded('login', upstashErr, true);
    expect(allowed).toEqual({ ok: true }); // fail-open: fallback permitiu

    const blocked = __testing__.degraded('join', new TypeError('fetch failed'), false);
    expect(blocked).toEqual({ ok: false, reason: 'rate_limited' }); // fallback bloqueou

    expect(warn).toHaveBeenCalledWith(
      'auth.ratelimit.degraded',
      expect.objectContaining({ kind: 'login', reason_category: 'server' }),
    );
    expect(emit).toHaveBeenCalledWith(
      'auth.ratelimit.degraded',
      expect.objectContaining({ kind: 'join', reason_category: 'network' }),
    );

    warn.mockRestore();
    emit.mockRestore();
  });
});
