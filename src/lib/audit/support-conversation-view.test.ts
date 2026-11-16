import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';
import { auditEvents } from '@/lib/db/schema/infra/audit';

import {
  recordSupportConversationView,
  SUPPORT_CONVERSATION_VIEWED,
} from './support-conversation-view';

vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));

const CLINIC = '11111111-1111-4111-8111-111111111111';
const CONV = '33333333-3333-4333-8333-333333333333';
const IMP = '44444444-4444-4444-8444-444444444444';
const ADMIN = '55555555-5555-4555-8555-555555555555';

const existing: Array<{ id: string }> = [];
const limit = vi.fn(async () => existing);
const where = vi.fn(() => ({ limit }));
const from = vi.fn(() => ({ where }));
const select = vi.fn(() => ({ from }));
const values = vi.fn(async () => undefined);
const insert = vi.fn(() => ({ values }));
const tx = { select, insert } as unknown as Tx;

const args = {
  clinicId: CLINIC,
  conversationId: CONV,
  superAdminId: ADMIN,
  impersonationId: IMP,
  sessionStartedAt: '2026-11-15T11:30:00.000Z',
  surface: 'conversas_inbox' as const,
  messageCount: 12,
  requestContext: { ip: '203.0.113.7', userAgent: 'vitest', requestId: 'req-1' },
};

beforeEach(() => {
  vi.clearAllMocks();
  existing.length = 0;
  values.mockResolvedValue(undefined);
});

describe('recordSupportConversationView — trilha da clínica (S-01b)', () => {
  it('primeira abertura na sessão: grava na trilha da clínica, com o suporte como ator e só metadado', async () => {
    const id = await recordSupportConversationView(tx, args);

    expect(id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(select).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(auditEvents);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        clinicId: CLINIC,
        userId: ADMIN,
        action: SUPPORT_CONVERSATION_VIEWED,
        resourceType: 'ai_conversation',
        resourceId: CONV,
        before: null,
        after: { surface: 'conversas_inbox', impersonationId: IMP, messageCount: 12 },
        ipAddress: '203.0.113.7',
        userAgent: 'vitest',
      }),
    );
  });

  it('a mesma sessão já registrou esta conversa: não grava de novo (refresh de 10 s)', async () => {
    existing.push({ id: 'audit-1' });

    await expect(recordSupportConversationView(tx, args)).resolves.toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it('fail-closed: INSERT que falha sobe a exceção (a leitura em volta falha junto)', async () => {
    values.mockRejectedValue(new Error('insert failed'));

    await expect(recordSupportConversationView(tx, args)).rejects.toThrow('insert failed');
  });

  it('a ação nomeia o suporte: o CSV da clínica não traz o `after`', () => {
    expect(SUPPORT_CONVERSATION_VIEWED).toBe('ai_agent.conversation.support_viewed');
  });
});
