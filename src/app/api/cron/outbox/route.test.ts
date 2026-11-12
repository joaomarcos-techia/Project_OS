import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  recovery: vi.fn(),
  inbox: vi.fn(),
  heartbeat: vi.fn(),
}));
vi.mock('./handlers', () => ({}));
vi.mock('@/lib/db/schema', () => ({}));
vi.mock('@/lib/cron-heartbeat', () => ({ recordHeartbeat: mocks.heartbeat }));
vi.mock('@/lib/http/cron', () => ({
  withCron: (_options: unknown, handler: () => Promise<Response>) => handler,
}));
vi.mock('@/lib/outbox/worker', () => ({ runOutboxOnce: mocks.run }));
vi.mock('@/contexts/billing/internal/abacatepay-processing', () => ({
  reconcileAbacatePayRecoveryTick: mocks.recovery,
  reconcileAbacatePayInboxTick: mocks.inbox,
}));
import { GET } from './route';
const request = () => new Request('https://qoro.example/api/cron/outbox');
beforeEach(() => {
  vi.clearAllMocks();
  mocks.run.mockResolvedValue({ processed: 2 });
  mocks.recovery.mockResolvedValue({ scanned: 0 });
  mocks.inbox.mockResolvedValue({ scanned: 0 });
});
describe('existing outbox minute tick', () => {
  it('preserves response shape and gives financial recovery a bounded independent budget', async () => {
    const started = Date.now();
    expect(await (await GET(request())).json()).toEqual({ ok: true, processed: 2 });
    expect(mocks.recovery).toHaveBeenCalledWith(expect.any(Number));
    expect(mocks.inbox).toHaveBeenCalledOnce();
    const deadline = mocks.recovery.mock.calls[0]?.[0];
    expect(deadline).toBeGreaterThanOrEqual(started + 35_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 35_000);
    expect(mocks.heartbeat).toHaveBeenCalledWith('outbox', 'success', { processed: 2 });
  });
  it('does not wait for outbox completion to start durable financial work', async () => {
    let release: (() => void) | undefined;
    mocks.run.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = GET(request());
    expect(mocks.recovery).toHaveBeenCalledOnce();
    expect(release).toBeDefined();
    release?.();
    await pending;
  });
  it('propagates financial failure to the existing cron error and alert boundary', async () => {
    mocks.recovery.mockRejectedValueOnce(new Error('Synthetic failed checkpoint'));
    await expect(GET(request())).rejects.toThrow('Synthetic failed checkpoint');
    expect(mocks.heartbeat).not.toHaveBeenCalledWith('outbox', 'success', expect.anything());
  });
  it('finishes independent outbox work before reporting a financial failure', async () => {
    let release: (() => void) | undefined;
    mocks.run.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    mocks.recovery.mockRejectedValueOnce(new Error('Synthetic financial failure'));
    const finished = vi.fn();
    const pending = GET(request());
    void pending.then(finished, finished);
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    expect(release).toBeDefined();
    release?.();
    await expect(pending).rejects.toThrow('Synthetic financial failure');
    expect(mocks.heartbeat).not.toHaveBeenCalled();
  });
  it('propagates an inbox failure without declaring a successful tick', async () => {
    mocks.inbox.mockRejectedValueOnce(new Error('Synthetic inbox failure'));
    await expect(GET(request())).rejects.toThrow('Synthetic inbox failure');
    expect(mocks.heartbeat).not.toHaveBeenCalled();
  });
});
