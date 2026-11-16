import { describe, expect, it, vi } from 'vitest';
import {
  AbacatePayCoordinationError,
  createRedisAbacatePayRequestControl,
  providerCooldownMs,
} from './request-control';
import { createAbacatePayTransport } from './transport';

describe('AbacatePay distributed admission boundary', () => {
  it('uses the same opaque key across instances and different keys for distinct stores', async () => {
    const evaluate = vi.fn().mockResolvedValue([1, 0]);
    await createRedisAbacatePayRequestControl('store_one', evaluate).admit();
    await createRedisAbacatePayRequestControl('store_one', evaluate).admit();
    await createRedisAbacatePayRequestControl('store_two', evaluate).admit();
    expect(evaluate.mock.calls[0]?.[1]).toEqual(evaluate.mock.calls[1]?.[1]);
    expect(evaluate.mock.calls[0]?.[1]).not.toEqual(evaluate.mock.calls[2]?.[1]);
    expect(JSON.stringify(evaluate.mock.calls)).not.toContain('store_one');
  });
  it.each([{ response: [] }, { response: [1] }, { response: ['yes', 0] }, { response: [1, -1] }])(
    'rejects malformed coordination response %j',
    async ({ response }) => {
      await expect(
        createRedisAbacatePayRequestControl(
          'store_test',
          vi.fn().mockResolvedValue(response),
        ).admit(),
      ).rejects.toMatchObject({ code: 'unavailable' });
    },
  );
  it('fails closed without retaining Redis error, URL, key or patient data', async () => {
    const control = createRedisAbacatePayRequestControl(
      'store_test',
      vi.fn().mockRejectedValue(new Error('private-token')),
    );
    const error: unknown = await control.admit().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'unavailable' });
    expect(error).toBeInstanceOf(AbacatePayCoordinationError);
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toContain('private-token');
  });
  it.each([
    [{}, 60000],
    [{ 'retry-after': '8' }, 8000],
    [{ 'retry-after': '-9' }, 60000],
    [{ 'retry-after': '999999' }, 900000],
    [{ 'ratelimit-reset': '3' }, 3000],
  ])('honors bounded provider cooldown %j', (input, expected) => {
    expect(providerCooldownMs(new Headers(input))).toBe(expected);
  });
  it('accepts a Retry-After date or a future epoch reset without negative waits', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    expect(
      providerCooldownMs(new Headers({ 'retry-after': 'Thu, 12 Nov 2026 12:00:05 GMT' }), now),
    ).toBe(5000);
    expect(
      providerCooldownMs(new Headers({ 'ratelimit-reset': String(now / 1000 + 7) }), now),
    ).toBe(7000);
  });
  it.each(['GET', 'POST'] as const)(
    'does not dispatch %s while the shared store is throttled',
    async (method) => {
      const fetcher = vi.fn<typeof fetch>();
      const control = {
        admit: vi.fn().mockResolvedValue({ allowed: false, retryAfterMs: 60000 }),
        observe: vi.fn(),
        throttle: vi.fn(),
      };
      const request = createAbacatePayTransport(
        { apiKey: 'synthetic', requestControl: control },
        fetcher,
      );
      await expect(
        request(
          method === 'GET'
            ? { method, path: '/stores/get' }
            : { method, path: '/subscriptions/create', body: {} },
        ),
      ).rejects.toMatchObject({ code: 'rate_limited' });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it('records provider429 without resending a financial command', async () => {
    const control = {
      admit: vi.fn().mockResolvedValue({ allowed: true, retryAfterMs: 0 }),
      observe: vi.fn(),
      throttle: vi.fn(),
    };
    const headers = new Headers({ 'retry-after': '15' });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private', { status: 429, headers }));
    const request = createAbacatePayTransport(
      { apiKey: 'synthetic', requestControl: control },
      fetcher,
    );
    await expect(
      request({ method: 'POST', path: '/subscriptions/create', body: {} }),
    ).rejects.toMatchObject({ name: 'AbacatePayCommandError', httpStatus: 429 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(control.throttle.mock.calls[0]?.[0].get('retry-after')).toBe('15');
  });
  it('bounds admission contention instead of polling Redis indefinitely', async () => {
    const control = {
      admit: vi.fn().mockResolvedValue({ allowed: false, retryAfterMs: 1 }),
      observe: vi.fn(),
      throttle: vi.fn(),
    };
    const fetcher = vi.fn<typeof fetch>();
    const request = createAbacatePayTransport(
      { apiKey: 'synthetic', requestControl: control },
      fetcher,
    );
    await expect(request({ method: 'GET', path: '/stores/get' })).rejects.toMatchObject({
      code: 'rate_limited',
    });
    expect(control.admit).toHaveBeenCalledTimes(3);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([200, 503])(
    'preserves an unknown POST outcome if coordination fails after HTTP %s',
    async (status) => {
      const control = {
        admit: vi.fn().mockResolvedValue({ allowed: true, retryAfterMs: 0 }),
        observe: vi.fn().mockRejectedValue(new Error('private-coordination')),
        throttle: vi.fn(),
      };
      const response = Response.json({ success: true, data: {} }, { status });
      if (!response.body) throw new Error('Synthetic response body missing');
      const cancel = vi.spyOn(response.body, 'cancel');
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      const request = createAbacatePayTransport(
        { apiKey: 'synthetic', requestControl: control },
        fetcher,
      );
      await expect(
        request({ method: 'POST', path: '/subscriptions/create', body: {} }),
      ).rejects.toMatchObject({ name: 'AbacatePayCommandError', httpStatus: status });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
});
