import { describe, expect, it, vi } from 'vitest';

import { withQueryDeadline, withQueryFallback } from './query-timeout';

vi.mock('@/lib/observability/metrics', () => ({
  metrics: { emit: vi.fn() },
}));

const never = new Promise<number>(() => {}); // nunca resolve — simula query pendurada
const slow = (ms: number) => new Promise<number>((r) => setTimeout(() => r(1), ms));

describe('withQueryDeadline', () => {
  it('devolve o valor quando a leitura responde a tempo', async () => {
    await expect(withQueryDeadline('ok', slow(1), 100)).resolves.toBe(1);
  });

  it('LANÇA quando a leitura estoura o deadline (nunca pendura)', async () => {
    await expect(withQueryDeadline('trava', never, 20)).rejects.toThrow(/excedeu 20ms/);
  });

  it('propaga o erro da própria query', async () => {
    await expect(
      withQueryDeadline('erro', Promise.reject(new Error('boom')), 100),
    ).rejects.toThrow('boom');
  });
});

describe('withQueryFallback', () => {
  it('devolve o valor quando responde a tempo', async () => {
    await expect(withQueryFallback('ok', slow(1), 99, 100)).resolves.toBe(1);
  });

  it('devolve o fallback no timeout (não pendura, não propaga)', async () => {
    await expect(withQueryFallback('trava', never, 42, 20)).resolves.toBe(42);
  });

  it('devolve o fallback quando a query erra', async () => {
    await expect(
      withQueryFallback('erro', Promise.reject(new Error('boom')), 7, 100),
    ).resolves.toBe(7);
  });
});
