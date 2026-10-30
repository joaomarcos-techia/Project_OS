import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ limit: vi.fn(), emit: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  dbAdmin: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }) },
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('modo do agente em falha de configuração', () => {
  it('ausência da flag mantém o modo normal existente', async () => {
    mocks.limit.mockResolvedValue([]);
    const { getAiAgentMode } = await import('./index');
    expect(await getAiAgentMode()).toBe('normal');
    expect(mocks.emit).not.toHaveBeenCalled();
  });
  it.each(['normal', 'fallback_only'] as const)('respeita %s explícito', async (mode) => {
    mocks.limit.mockResolvedValue([{ value: mode }]);
    const { getAiAgentMode } = await import('./index');
    expect(await getAiAgentMode()).toBe(mode);
  });
  it('falha de leitura não reativa provider e não registra o erro sensível', async () => {
    mocks.limit.mockRejectedValue(new Error('synthetic confidential detail'));
    const { getAiAgentMode } = await import('./index');
    expect(await getAiAgentMode()).toBe('fallback_only');
    expect(mocks.emit).toHaveBeenCalledTimes(1);
    expect(mocks.emit).toHaveBeenCalledWith('ai_agent.mode.read_failed', {
      reason: 'unavailable',
    });
  });
  it('valor corrompido não habilita a IA', async () => {
    mocks.limit.mockResolvedValue([{ value: { secret: 'synthetic' } }]);
    const { getAiAgentMode } = await import('./index');
    expect(await getAiAgentMode()).toBe('fallback_only');
    expect(mocks.emit).toHaveBeenCalledTimes(1);
    expect(mocks.emit).toHaveBeenCalledWith('ai_agent.mode.read_failed', {
      reason: 'invalid_value',
    });
  });
  it('cache expira; falha não é cacheada e a recuperação relê o valor autorizado', async () => {
    mocks.limit.mockResolvedValueOnce([{ value: 'fallback_only' }]);
    const { getAiAgentMode } = await import('./index');
    expect(await getAiAgentMode()).toBe('fallback_only');
    expect(await getAiAgentMode()).toBe('fallback_only');
    expect(mocks.limit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    mocks.limit.mockRejectedValueOnce(new Error('synthetic outage'));
    expect(await getAiAgentMode()).toBe('fallback_only');
    mocks.limit.mockResolvedValueOnce([{ value: 'normal' }]);
    expect(await getAiAgentMode()).toBe('normal');
    expect(mocks.limit).toHaveBeenCalledTimes(3);
  });
  it('não muda o fallback independente dos jobs proativos', async () => {
    mocks.limit.mockRejectedValue(new Error('synthetic outage'));
    const { isProactiveEnabled } = await import('./index');
    expect(await isProactiveEnabled()).toBe(true);
  });
});
