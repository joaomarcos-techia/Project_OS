import { describe, expect, it, vi } from 'vitest';

import { createAbacatePayTransport } from './transport';

describe('AbacatePay command transport', () => {
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
