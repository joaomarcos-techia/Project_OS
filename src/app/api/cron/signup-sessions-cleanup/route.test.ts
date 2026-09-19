import { beforeEach, describe, expect, it, vi } from 'vitest';

const { purge, heartbeat, emit, warn, capture, envState } = vi.hoisted(() => ({
  purge: vi.fn(),
  heartbeat: vi.fn(),
  emit: vi.fn(),
  warn: vi.fn(),
  capture: vi.fn(),
  envState: {
    value: {
      CRON_SECRET: 'c'.repeat(32),
      CRON_SECRET_DESTRUCTIVE: undefined as string | undefined,
      OUTBOX_CRON_ALLOW_NON_VERCEL: true,
      NODE_ENV: 'test',
    },
  },
}));

vi.mock('@/contexts/onboarding', () => ({ purgeExpiredSignupSessions: purge }));
vi.mock('@/lib/cron-heartbeat', () => ({ recordHeartbeat: heartbeat }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
vi.mock('@/lib/observability/logger', () => ({
  logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError: capture }));
vi.mock('@/lib/env', () => ({
  get env() {
    return envState.value;
  },
  assertCronRuntimeReady: vi.fn(),
}));

import { GET } from './route';

const request = (secret?: string) =>
  new Request('https://localhost/api/cron/signup-sessions-cleanup', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });

describe('signup sessions cleanup cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    heartbeat.mockResolvedValue(undefined);
  });

  it.each([undefined, 'x'.repeat(32)])(
    'denies missing or wrong bearer before deletion',
    async (secret) => {
      const res = await GET(request(secret));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
      expect(purge).not.toHaveBeenCalled();
      expect(heartbeat).not.toHaveBeenCalled();
    },
  );

  it('deletes bounded batches and records the actual result', async () => {
    purge
      .mockResolvedValueOnce({ deleted: 500, live: 800 })
      .mockResolvedValueOnce({ deleted: 7, live: 793 });
    const res = await GET(request('c'.repeat(32)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: 507, live: 793 });
    expect(purge).toHaveBeenNthCalledWith(1, 500);
    expect(purge).toHaveBeenNthCalledWith(2, 500);
    expect(emit).toHaveBeenCalledWith('signup_sessions_cleanup.done', { deleted: 507, live: 793 });
    expect(heartbeat).toHaveBeenCalledWith('signup-sessions-cleanup', 'success', {
      deleted: 507,
      live: 793,
    });
  });

  it('reports failure without returning success', async () => {
    const error = new Error('database unavailable');
    purge.mockRejectedValue(error);
    const res = await GET(request('c'.repeat(32)));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'internal' });
    expect(capture).toHaveBeenCalledWith(error, { flow: 'cron.signup-sessions-cleanup' });
    expect(heartbeat).toHaveBeenCalledWith('signup-sessions-cleanup', 'error', {
      error: 'database unavailable',
    });
  });
});
