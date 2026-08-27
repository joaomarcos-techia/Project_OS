import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  currentPeriod: vi.fn(() => '2026-08'),
  recordUsage: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/contexts/ai-agent', () => ({
  AI_AGENT_EVENTS: { CONVERSATION_COMPLETED: 'ai_agent.conversation.completed' },
}));
vi.mock('../quota', () => ({
  currentPeriod: mocks.currentPeriod,
  recordUsage: mocks.recordUsage,
}));

import './conversation-completed';

type Handler = (ctx: {
  tx: unknown;
  clinicId: string;
  payload: { conversationId: string; outcome: string };
}) => Promise<void>;

const registration = mocks.registerHandler.mock.calls[0]!;
const handler = registration[1] as Handler;

beforeEach(() => {
  mocks.currentPeriod.mockClear();
  mocks.recordUsage.mockReset().mockResolvedValue(true);
});

describe('handler de uso por conversa de IA', () => {
  it('registra-se no evento público do agente', () => {
    expect(registration[0]).toBe('ai_agent.conversation.completed');
  });

  it('conta somente a conversa que efetivamente respondeu', async () => {
    await handler({
      tx: 'TX',
      clinicId: 'clinic-1',
      payload: { conversationId: 'conversation-1', outcome: 'replied' },
    });

    expect(mocks.recordUsage).toHaveBeenCalledWith(
      'TX',
      'clinic-1',
      {
        metric: 'ai_messages',
        subjectId: 'conversation-1',
        dedupKey: 'conversation-1',
      },
      '2026-08',
    );
  });

  it.each(['fallback', 'quota_blocked', 'prefiltered'])('não mede outcome %s', async (outcome) => {
    await handler({
      tx: 'TX',
      clinicId: 'clinic-1',
      payload: { conversationId: 'conversation-1', outcome },
    });

    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });
});
