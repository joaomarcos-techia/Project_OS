import { afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({
  init: mock.init,
  browserTracingIntegration: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('browser events identify the deployment environment', () => {
  it.each(['preview', 'production', 'development'] as const)(
    'uses public Vercel metadata for %s without exposing server configuration',
    async (target) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', target);
      await import('../../instrumentation-client');
      expect(mock.init).toHaveBeenCalledOnce();
      expect(mock.init).toHaveBeenCalledWith(
        expect.objectContaining({
          environment: target,
          sendDefaultPii: false,
          enableLogs: false,
          beforeSend: expect.any(Function),
        }),
      );
    },
  );

  it('preserves the runtime label outside Vercel', async () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', undefined);
    vi.stubEnv('NODE_ENV', 'test');
    await import('../../instrumentation-client');
    expect(mock.init).toHaveBeenCalledWith(expect.objectContaining({ environment: 'test' }));
  });
});
describe('server payment alerts keep Preview separate from Production', () => {
  it.each(['preview', 'production', 'development'] as const)(
    'labels the Vercel %s environment independently of NODE_ENV',
    async (target) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('VERCEL_ENV', target);
      await import('../../../sentry.server.config');
      await import('../../../sentry.edge.config');
      expect(mock.init).toHaveBeenCalledTimes(2);
      for (const [config] of mock.init.mock.calls)
        expect(config).toMatchObject({ environment: target, sendDefaultPii: false });
    },
  );
  it('preserves the local runtime label when not deployed on Vercel', async () => {
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('NODE_ENV', 'test');
    await import('../../../sentry.server.config');
    await import('../../../sentry.edge.config');
    for (const [config] of mock.init.mock.calls)
      expect(config).toMatchObject({ environment: 'test' });
  });
});
