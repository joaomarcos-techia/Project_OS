import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isProactiveEnabled, processProactiveBatch, recordHeartbeat, emit } = vi.hoisted(() => ({
  isProactiveEnabled: vi.fn(),
  processProactiveBatch: vi.fn(),
  recordHeartbeat: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@/lib/http/cron', () => ({ withCron: (_options: unknown, handler: unknown) => handler }));
vi.mock('@/lib/platform-settings', () => ({ isProactiveEnabled }));
vi.mock('@/lib/cron-heartbeat', () => ({ recordHeartbeat }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
vi.mock('@/contexts/ai-agent/proactive-jobs/application/process', () => ({
  processProactiveBatch,
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  isProactiveEnabled.mockResolvedValue(true);
  processProactiveBatch
    .mockResolvedValueOnce({
      type: 'followup',
      scanned: 3,
      sent: 2,
      cancelled: 1,
      retried: 0,
      failed: 0,
    })
    .mockResolvedValueOnce({
      type: 'no_show_followup',
      scanned: 4,
      sent: 1,
      cancelled: 1,
      retried: 1,
      failed: 1,
    });
});

describe('proactive followup cron', () => {
  it('despacha retorno e recuperação de falta sequencialmente e agrega o heartbeat', async () => {
    const response = await GET(new Request('http://localhost/api/cron/proactive-followup'));

    expect(processProactiveBatch.mock.calls.map(([type]) => type)).toEqual([
      'followup',
      'no_show_followup',
    ]);
    expect(recordHeartbeat).toHaveBeenCalledWith('proactive-followup', 'success', {
      scanned: 7,
      sent: 3,
      cancelled: 2,
      retried: 1,
      failed: 1,
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      scanned: 7,
      sent: 3,
      cancelled: 2,
      retried: 1,
      failed: 1,
      batches: {
        followup: {
          type: 'followup',
          scanned: 3,
          sent: 2,
          cancelled: 1,
          retried: 0,
          failed: 0,
        },
        noShowFollowup: {
          type: 'no_show_followup',
          scanned: 4,
          sent: 1,
          cancelled: 1,
          retried: 1,
          failed: 1,
        },
      },
    });
  });

  it('preserva o kill-switch antes de reivindicar qualquer tipo de job', async () => {
    isProactiveEnabled.mockResolvedValue(false);

    const response = await GET(new Request('http://localhost/api/cron/proactive-followup'));

    expect(processProactiveBatch).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('proactive.followup.skipped_disabled', {});
    expect(recordHeartbeat).toHaveBeenCalledWith('proactive-followup', 'skipped', {
      reason: 'disabled',
    });
    await expect(response.json()).resolves.toEqual({ ok: true, skipped: 'disabled' });
  });
});
