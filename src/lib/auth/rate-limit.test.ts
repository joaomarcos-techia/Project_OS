import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger } from '@/lib/observability/logger';
import { metrics } from '@/lib/observability/metrics';

import {
  BoundedFallbackLimiter,
  assertInviteAcceptAllowed,
  assertInviteAllowed,
  assertMfaAllowed,
  assertResendInviteAllowed,
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
    expect(ipRateLimitKey('2001:db8:aa:bb::1')).not.toBe(ipRateLimitKey('2001:db8:aa:cc::1'));
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

/**
 * M3 (auditoria de APIs) — limiters novos de convite e MFA.
 *
 * Estes testes exercitam o caminho REAL de degradação: o vitest não configura
 * `UPSTASH_REDIS_REST_URL`/`_TOKEN`, então `lazyRedis()` lança e o `assert*` cai no
 * fallback per-instância. Ou seja, é literalmente o cenário "Redis offline" — sem
 * mockar o Upstash. É a propriedade mais crítica destes helpers: um outage do Redis
 * NÃO pode derrubar convite nem login com MFA.
 */
describe('M3 — fail-open com Redis indisponível', () => {
  const spies = () => ({
    warn: vi.spyOn(logger, 'warn').mockImplementation(() => {}),
    emit: vi.spyOn(metrics, 'emit').mockImplementation(() => {}),
  });
  afterEach(() => vi.restoreAllMocks());

  it('invite: Redis fora → continua funcionando + loga + emite métrica', async () => {
    const { warn, emit } = spies();
    const res = await assertInviteAllowed('clinic-failopen-1', 'actor-failopen-1');

    expect(res).toEqual({ ok: true }); // fail-open: o convite não morre com o Redis
    expect(emit).toHaveBeenCalledWith(
      'auth.ratelimit.degraded',
      expect.objectContaining({ kind: 'invite' }),
    );
    expect(warn).toHaveBeenCalledWith(
      'auth.ratelimit.degraded',
      expect.objectContaining({ kind: 'invite' }),
    );
  });

  it('mfa: Redis fora → continua funcionando + loga + emite métrica', async () => {
    const { warn, emit } = spies();
    const res = await assertMfaAllowed('user-failopen-1', '203.0.113.9');

    expect(res).toEqual({ ok: true });
    expect(emit).toHaveBeenCalledWith(
      'auth.ratelimit.degraded',
      expect.objectContaining({ kind: 'mfa' }),
    );
    expect(warn).toHaveBeenCalledWith(
      'auth.ratelimit.degraded',
      expect.objectContaining({ kind: 'mfa' }),
    );
  });

  it('accept (I-12): Redis fora → aceite não morre, loga com kind=accept', async () => {
    const { warn, emit } = spies();
    const res = await assertInviteAcceptAllowed('198.51.100.7');

    expect(res).toEqual({ ok: true }); // fail-open: o aceite do convite não trava com o Redis fora
    expect(emit).toHaveBeenCalledWith(
      'auth.ratelimit.degraded',
      expect.objectContaining({ kind: 'accept' }),
    );
    expect(warn).toHaveBeenCalledWith(
      'auth.ratelimit.degraded',
      expect.objectContaining({ kind: 'accept' }),
    );
  });

  it('fail-open NÃO é barra-livre: o fallback ainda bloqueia acima do teto do ator (30/1h)', async () => {
    spies();
    const actor = 'actor-teto';
    // Clínica distinta por chamada isola o teto de clínica (60/1h) — queremos ver o
    // do ATOR (30/1h) disparar, que é a defesa contra a conta comprometida.
    const results = [];
    for (let i = 0; i < 32; i++) {
      results.push(await assertInviteAllowed(`clinic-teto-${i}`, actor));
    }
    expect(results.slice(0, 30).every((r) => r.ok)).toBe(true);
    expect(results[30]).toEqual({ ok: false, reason: 'rate_limited' });
    expect(results[31]).toEqual({ ok: false, reason: 'rate_limited' });
  });

  // A regressão que este teste existe para travar: o maior plano vende 10 seats
  // (`plan_limits`, migration 0039) e só owner/gestor têm manage:employees — é UM ator
  // convidando todos. A 1ª versão usou 10/1h e travava o cliente no meio do onboarding.
  // Testa 15 (não 10) de propósito: o teto tem de sobreviver a um aumento de seats.
  it('o onboarding de uma clínica cheia cabe no teto do ator, com folga', async () => {
    spies();
    const results = [];
    for (let i = 0; i < 15; i++) {
      results.push(await assertInviteAllowed('clinic-pro-onboarding', 'owner-pro'));
    }
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('o teto de clínica (60/1h) barra N atores somando no mesmo tenant', async () => {
    spies();
    const clinic = 'clinic-teto-somado';
    const results = [];
    for (let i = 0; i < 62; i++) {
      results.push(await assertInviteAllowed(clinic, `actor-distinto-${i}`));
    }
    expect(results.slice(0, 60).every((r) => r.ok)).toBe(true);
    expect(results[60]).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('atores/clínicas distintos não compartilham orçamento', async () => {
    spies();
    for (let i = 0; i < 30; i++) await assertInviteAllowed('clinic-iso-a', 'actor-iso-a');
    expect(await assertInviteAllowed('clinic-iso-a', 'actor-iso-a')).toEqual({
      ok: false,
      reason: 'rate_limited',
    });
    // Outro ator, outra clínica → janela própria.
    expect(await assertInviteAllowed('clinic-iso-b', 'actor-iso-b')).toEqual({ ok: true });
  });

  // Convite e reenvio têm economias diferentes: convite é limitado pela quota do
  // plano; reenvio não é limitado por nada (dá para reenviar ao mesmo endereço
  // infinitas vezes, gerando recovery link a cada vez). Orçamentos separados.
  it('reenvio tem teto próprio e mais apertado (10/1h por ator)', async () => {
    spies();
    const results = [];
    for (let i = 0; i < 12; i++) {
      results.push(await assertResendInviteAllowed(`clinic-resend-${i}`, 'actor-resend'));
    }
    expect(results.slice(0, 10).every((r) => r.ok)).toBe(true);
    expect(results[10]).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('estourar o reenvio NÃO trava o convite (orçamentos separados)', async () => {
    spies();
    const actor = 'actor-separado';
    for (let i = 0; i < 11; i++) await assertResendInviteAllowed('clinic-separado', actor);
    expect(await assertResendInviteAllowed('clinic-separado', actor)).toEqual({
      ok: false,
      reason: 'rate_limited',
    });
    // O onboarding segue possível mesmo com o reenvio esgotado.
    expect(await assertInviteAllowed('clinic-separado', actor)).toEqual({ ok: true });
  });

  it('mfa: IP normalizado para /64 — um bloco IPv6 não multiplica o teto', async () => {
    spies();
    // 20/15min por IP. Dois endereços do MESMO /64 devem somar no mesmo balde.
    const a = '2001:db8:1:2:aaaa::1';
    const b = '2001:db8:1:2:bbbb::2';
    expect(ipRateLimitKey(a)).toBe(ipRateLimitKey(b));
    const results = [];
    for (let i = 0; i < 21; i++) {
      results.push(await assertMfaAllowed(`user-ipv6-${i}`, i % 2 === 0 ? a : b));
    }
    expect(results[20]).toEqual({ ok: false, reason: 'rate_limited' });
  });
});

/**
 * A divergência sliding (primário) × fixed (fallback) é decisão documentada no
 * cabeçalho do módulo. O que dá para testar aqui é o NOSSO lado: o fallback é
 * fixed-window, e a assinatura disso é o reset EM BLOCO na virada da janela — não
 * a liberação gradual do sliding. Fixar isso evita que alguém "conserte" o fallback
 * achando que é bug, ou assuma semântica de sliding onde não há.
 */
describe('M3 — fallback é fixed-window (divergência aceita vs. sliding do Upstash)', () => {
  // `Date.now` mockado sem afterEach vaza para testes não relacionados se uma
  // assertion lançar antes do restore no fim do corpo.
  afterEach(() => vi.restoreAllMocks());

  it('reseta em bloco na virada da janela (sliding liberaria gradualmente)', () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const limiter = new BoundedFallbackLimiter(3, 60_000);

    expect(limiter.hit('k')).toBe(true);
    expect(limiter.hit('k')).toBe(true);
    expect(limiter.hit('k')).toBe(true);
    expect(limiter.hit('k')).toBe(false); // teto batido

    now += 30_000; // meio da janela — sliding já teria liberado algo; fixed, não
    expect(limiter.hit('k')).toBe(false);

    now += 30_001; // janela virou → orçamento inteiro de volta, de uma vez
    expect(limiter.hit('k')).toBe(true);
    expect(limiter.hit('k')).toBe(true);
    expect(limiter.hit('k')).toBe(true);
    expect(limiter.hit('k')).toBe(false);

    vi.restoreAllMocks();
  });

  it('a consequência documentada: burst na borda = 2×limite − 1 num intervalo curto', () => {
    let now = 2_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const limiter = new BoundedFallbackLimiter(3, 60_000);

    // A janela é ancorada no PRIMEIRO hit da chave (resetAt = now + windowMs), não
    // alinhada ao relógio. Então o pior caso não é 2×limite: o hit que abre a
    // janela já consome orçamento. O teto real do burst é (limite−1) no fim da
    // janela 1 + limite no início da janela 2.
    expect(limiter.hit('burst')).toBe(true); // ancora a janela em t=2_000_000

    now += 59_000; // quase no fim da janela 1
    let noBurst = 0;
    for (let i = 0; i < 2; i++) if (limiter.hit('burst')) noBurst++; // limite−1 = 2

    now += 1_001; // janela 1 expirou → janela 2 abre
    for (let i = 0; i < 3; i++) if (limiter.hit('burst')) noBurst++; // limite = 3

    // 5 = 2×3−1 permitidos em ~1s, com teto nominal de 3/60s. É a divergência que o
    // cabeçalho do módulo chama de "~2×" e aceita (F-08): vale só em degradação.
    expect(noBurst).toBe(5);
    expect(limiter.hit('burst')).toBe(false); // e o teto da janela 2 volta a valer
    vi.restoreAllMocks();
  });
});
