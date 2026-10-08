import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sweep, heartbeat, emit, capture, envState } = vi.hoisted(() => ({
  sweep: vi.fn(),
  heartbeat: vi.fn(),
  emit: vi.fn(),
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

vi.mock('@/contexts/messaging', () => ({ sweepMessagingHealth: sweep }));
vi.mock('@/lib/cron-heartbeat', () => ({ recordHeartbeat: heartbeat }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError: capture }));
vi.mock('@/lib/env', () => ({
  get env() {
    return envState.value;
  },
  assertCronRuntimeReady: vi.fn(),
}));

import { GET } from './route';

const request = (secret?: string) =>
  new Request('https://localhost/api/cron/whatsapp-messaging-health', {
    headers: secret ? { authorization: `Bearer ${secret}`, 'x-request-id': 'req-cron' } : {},
  });

const SUMMARY = { scanned: 3, available: 1, limited: 1, blocked: 1, unavailable: 0, changed: 2 };

describe('whatsapp messaging health cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    heartbeat.mockResolvedValue(undefined);
    sweep.mockResolvedValue(SUMMARY);
  });

  it.each([undefined, 'x'.repeat(32)])(
    'nega bearer ausente ou errado antes de ler a Meta',
    async (secret) => {
      const res = await GET(request(secret));
      expect(res.status).toBe(401);
      expect(sweep).not.toHaveBeenCalled();
      expect(heartbeat).not.toHaveBeenCalled();
    },
  );

  it('varre com teto por execução, como sistema, e registra o resultado', async () => {
    const res = await GET(request('c'.repeat(32)));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ...SUMMARY });
    expect(sweep).toHaveBeenCalledWith(100, expect.objectContaining({ requestId: 'req-cron' }));
    expect(emit).toHaveBeenCalledWith('messaging.whatsapp.messaging_health_sweep', SUMMARY);
    expect(heartbeat).toHaveBeenCalledWith('whatsapp-messaging-health', 'success', SUMMARY);
  });

  it('conta bloqueada dispara o alarme dedicado; sem bloqueio, não', async () => {
    await GET(request('c'.repeat(32)));
    expect(emit).toHaveBeenCalledWith('messaging.whatsapp.messaging_health_blocked', {
      blocked: 1,
      scanned: 3,
    });

    emit.mockClear();
    sweep.mockResolvedValueOnce({ ...SUMMARY, blocked: 0 });
    await GET(request('c'.repeat(32)));
    expect(emit).not.toHaveBeenCalledWith(
      'messaging.whatsapp.messaging_health_blocked',
      expect.anything(),
    );
  });

  it('falha vira 500 com Sentry e heartbeat de erro, nunca sucesso', async () => {
    const error = new Error('database unavailable');
    sweep.mockRejectedValue(error);

    const res = await GET(request('c'.repeat(32)));

    expect(res.status).toBe(500);
    expect(capture).toHaveBeenCalledWith(error, { flow: 'cron.whatsapp-messaging-health' });
    expect(emit).toHaveBeenCalledWith('messaging.messaging_health.error', { error });
    expect(heartbeat).toHaveBeenCalledWith('whatsapp-messaging-health', 'error', {
      error: 'database unavailable',
    });
    expect(heartbeat).not.toHaveBeenCalledWith(
      'whatsapp-messaging-health',
      'success',
      expect.anything(),
    );
  });
});
