import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  recovery: vi.fn(),
  inbox: vi.fn(),
  closures: vi.fn(),
  watch: vi.fn(),
  heartbeat: vi.fn(),
  bootHandlers: vi.fn(),
  bootCatalog: vi.fn(),
}));
vi.mock('@/lib/cron-heartbeat', () => ({ recordHeartbeat: mocks.heartbeat }));
vi.mock('@/lib/http/cron', () => ({
  withCron: (_options: unknown, handler: () => Promise<Response>) => handler,
}));
vi.mock('@/lib/outbox/worker', () => ({ runOutboxOnce: mocks.run }));
vi.mock('@/contexts/billing/internal/abacatepay-processing', () => ({
  reconcileAbacatePayRecoveryTick: mocks.recovery,
  reconcileAbacatePayInboxTick: mocks.inbox,
  reconcileAbacatePayCheckoutClosuresTick: mocks.closures,
  reconcileAbacatePayRenewalWatchTick: mocks.watch,
}));
import { GET } from './route';
const request = () => new Request('https://qoro.example/api/cron/outbox');
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.bootHandlers.mockReset();
  mocks.bootCatalog.mockReset();
  vi.doMock('./handlers', () => {
    mocks.bootHandlers();
    return {};
  });
  vi.doMock('@/lib/db/schema', () => {
    mocks.bootCatalog();
    return {};
  });
  mocks.run.mockResolvedValue({ processed: 2 });
  mocks.recovery.mockResolvedValue({ scanned: 0 });
  mocks.inbox.mockResolvedValue({ scanned: 0 });
  mocks.closures.mockResolvedValue({ scanned: 0, closed: 0 });
  mocks.watch.mockResolvedValue({ scanned: 0 });
});
describe('existing outbox minute tick', () => {
  it('preserves response shape and gives financial recovery a bounded independent budget', async () => {
    const started = Date.now();
    expect(await (await GET(request())).json()).toEqual({ ok: true, processed: 2 });
    expect(mocks.recovery).toHaveBeenCalledWith(expect.any(Number));
    expect(mocks.inbox).toHaveBeenCalledOnce();
    expect(mocks.closures).toHaveBeenCalledWith(expect.any(Number));
    expect(mocks.watch).toHaveBeenCalledOnce();
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
    await vi.waitFor(() => expect(release).toBeDefined());
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
    await vi.waitFor(() => expect(release).toBeDefined());
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
  it('reports a closure failure without marking the cron healthy', async () => {
    mocks.closures.mockRejectedValueOnce(new Error('Synthetic closure failure'));
    await expect(GET(request())).rejects.toThrow('Synthetic closure failure');
    expect(mocks.heartbeat).not.toHaveBeenCalled();
  });
  it('reports renewal coverage failure through the cron alert boundary', async () => {
    mocks.watch.mockRejectedValueOnce(new Error('Synthetic coverage failure'));
    await expect(GET(request())).rejects.toThrow('Synthetic coverage failure');
    expect(mocks.heartbeat).not.toHaveBeenCalled();
  });
  it.each(['bootHandlers', 'bootCatalog'] as const)(
    'finishes SaaS jobs and reports a %s import failure without running a partial registry',
    async (boot) => {
      const failure = new Error('Synthetic independent module boot failure');
      mocks[boot].mockImplementationOnce(() => {
        throw failure;
      });
      const completed: string[] = [];
      let finishRecovery: (() => void) | undefined;
      mocks.recovery.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishRecovery = () => {
              completed.push('recovery');
              resolve();
            };
          }),
      );
      mocks.inbox.mockImplementationOnce(async () => {
        completed.push('inbox');
      });
      mocks.closures.mockImplementationOnce(async () => {
        completed.push('closures');
      });
      mocks.watch.mockImplementationOnce(async () => {
        completed.push('watch');
      });
      const settled = vi.fn();
      const pending = GET(request());
      void pending.then(settled, settled);
      await vi.waitFor(() => expect(mocks[boot]).toHaveBeenCalledOnce());
      expect(settled).not.toHaveBeenCalled();
      expect(mocks.run).not.toHaveBeenCalled();
      expect(finishRecovery).toBeDefined();
      finishRecovery?.();
      // Vitest wraps a failing module factory; the original boot error survives
      // as its cause and must reach the existing cron failure boundary.
      await expect(pending).rejects.toMatchObject({ cause: failure });
      expect(completed.sort()).toEqual(['closures', 'inbox', 'recovery', 'watch']);
      expect(mocks.heartbeat).not.toHaveBeenCalled();
    },
  );
});
