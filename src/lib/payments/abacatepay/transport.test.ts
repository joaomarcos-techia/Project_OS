import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
import { createAbacatePayTransport } from './transport';
import { AbacatePayCoordinationError } from './request-control';

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
      expect(mocks.emit).toHaveBeenCalledWith(
        'billing.abacatepay.read_attempt_failed',
        expect.objectContaining({ operation: '/stores/get', attempt: 1, willRetry: true }),
      );
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
  it('does not retry a GET when distributed coordination is unavailable', async () => {
    const control = {
      admit: vi.fn().mockRejectedValue(new AbacatePayCoordinationError()),
      observe: vi.fn(),
      throttle: vi.fn(),
    };
    const fetcher = vi.fn<typeof fetch>();
    const request = createAbacatePayTransport(
      { apiKey: 'synthetic', requestControl: control, readAttempts: 2 },
      fetcher,
    );
    await expect(request({ method: 'GET', path: '/products/get' })).rejects.toBeInstanceOf(
      AbacatePayCoordinationError,
    );
    expect(control.admit).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not retry a GET after the provider failed when Redis cannot record the failure', async () => {
    const control = {
      admit: vi.fn().mockResolvedValue({ allowed: true, retryAfterMs: 0 }),
      observe: vi.fn().mockRejectedValue(new AbacatePayCoordinationError()),
      throttle: vi.fn(),
    };
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('synthetic network'));
    const request = createAbacatePayTransport(
      { apiKey: 'synthetic', requestControl: control, readAttempts: 2 },
      fetcher,
    );
    await expect(request({ method: 'GET', path: '/products/get' })).rejects.toBeInstanceOf(
      AbacatePayCoordinationError,
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([
    ['ENOTFOUND', 'dns'],
    ['UND_ERR_CONNECT_TIMEOUT', 'connect_timeout'],
    ['ECONNRESET', 'connection_closed'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'],
  ])('classifies a GET %s without logging the raw cause', async (code, failureKind) => {
    mocks.emit.mockClear();
    const secret = 'private-fixture-token';
    const error = new TypeError(secret, { cause: Object.assign(new Error(secret), { code }) });
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(error);
    const request = createAbacatePayTransport({ apiKey: secret }, fetcher);
    await expect(request({ method: 'GET', path: '/stores/get' })).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(mocks.emit).toHaveBeenCalledWith('billing.abacatepay.read_transport_failed', {
      operation: '/stores/get',
      phase: 'fetch',
      failureKind,
    });
    expect(JSON.stringify(mocks.emit.mock.calls)).not.toContain(secret);
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
