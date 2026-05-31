import { describe, expect, it } from 'vitest';

import { BoundedFallbackLimiter } from './rate-limit';

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
