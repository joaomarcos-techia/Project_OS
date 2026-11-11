import { describe, expect, it, vi } from 'vitest';

import { createAbacatePayTransport } from './transport';

describe('AbacatePay command transport', () => {
  it.each([502, 503, 504, null])(
    'recovers one transient GET %s inside an explicit read budget',
    async (status) => {
      const fetcher = vi.fn<typeof fetch>();
      if (status === null)
        fetcher.mockRejectedValueOnce(new Error('secret fixture network details'));
      else fetcher.mockResolvedValueOnce(new Response('private body', { status }));
      fetcher.mockResolvedValueOnce(
        Response.json({ success: true, data: { id: 'store_fixture' } }),
      );
      const request = createAbacatePayTransport(
        { apiKey: 'fixture-key', readAttempts: 2, deadlineMs: Date.now() + 5000 },
        fetcher,
      );
      await expect(request({ method: 'GET', path: '/stores/get' })).resolves.toEqual({
        success: true,
        data: { id: 'store_fixture' },
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it.each([400, 401, 403, 404, 422, 429, 500])(
    'does not retry permanent or rate-limited GET HTTP %s',
    async (status) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private', { status }));
      const request = createAbacatePayTransport(
        { apiKey: 'fixture-key', readAttempts: 2 },
        fetcher,
      );
      await expect(request({ method: 'GET', path: '/stores/get' })).rejects.toMatchObject({
        httpStatus: status,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps read retries opt-in and bounded to two attempts', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private'));
    await expect(
      createAbacatePayTransport(
        { apiKey: 'fixture-key' },
        fetcher,
      )({ method: 'GET', path: '/stores/get' }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear();
    await expect(
      createAbacatePayTransport(
        { apiKey: 'fixture-key', readAttempts: 2 },
        fetcher,
      )({ method: 'GET', path: '/stores/get' }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not start another attempt beyond the shared deadline', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private'));
    const request = createAbacatePayTransport(
      { apiKey: 'fixture-key', readAttempts: 2, deadlineMs: Date.now() + 50 },
      fetcher,
    );
    await expect(request({ method: 'GET', path: '/stores/get' })).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear();
    const expired = createAbacatePayTransport(
      { apiKey: 'fixture-key', readAttempts: 2, deadlineMs: Date.now() - 1 },
      fetcher,
    );
    await expect(expired({ method: 'GET', path: '/stores/get' })).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('never retries a financial command even when GET recovery is enabled', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private'));
    const request = createAbacatePayTransport({ apiKey: 'fixture-key', readAttempts: 2 }, fetcher);
    await expect(
      request({ method: 'POST', path: '/subscriptions/cancel', body: {} }),
    ).rejects.toMatchObject({ name: 'AbacatePayCommandError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('uses one POST to the fixed official V2 origin, with no redirect/cache/retry', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true, data: { id: 'prod_test' } }));
    const request = createAbacatePayTransport({ apiKey: 'fixture-key' }, fetcher);
    await request({ method: 'POST', path: '/products/create', body: { price: 100 } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://api.abacatepay.com/v2/products/create', {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        Authorization: 'Bearer fixture-key',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: '{"price":100}',
      signal: expect.any(AbortSignal),
    });
  });
  it.each([400, 401, 403, 409, 422, 429, 500, 503])(
    'does not retry POST HTTP %s',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('private provider data', { status }));
      const request = createAbacatePayTransport({ apiKey: 'fixture-key' }, fetcher);
      const error: unknown = await request({
        method: 'POST',
        path: '/subscriptions/create',
        body: {},
      }).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ name: 'AbacatePayCommandError', httpStatus: status });
      expect(error).not.toHaveProperty('cause');
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('treats connection/timeout exceptions as unknown without retaining secrets', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private fixture-key'));
    const request = createAbacatePayTransport({ apiKey: 'fixture-key' }, fetcher);
    await expect(
      request({ method: 'POST', path: '/subscriptions/create', body: {} }),
    ).rejects.toMatchObject({ name: 'AbacatePayCommandError', httpStatus: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['<html>private</html>', '{"success":false,"data":null}', '{"success":true}'])(
    'treats an unreadable/unconfirmed POST response as unknown',
    async (body) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
      const request = createAbacatePayTransport({ apiKey: 'fixture-key' }, fetcher);
      await expect(
        request({ method: 'POST', path: '/products/create', body: {} }),
      ).rejects.toMatchObject({ name: 'AbacatePayCommandError' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    '/products/delete',
    '//other.example/',
    '/subscriptions/create?x=1',
    'https://other.example/',
  ])('refuses an unapproved path before sending credentials: %s', async (path) => {
    const fetcher = vi.fn<typeof fetch>();
    const request = createAbacatePayTransport({ apiKey: 'fixture-key' }, fetcher);
    await expect(request({ method: 'POST', path, body: {} })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
