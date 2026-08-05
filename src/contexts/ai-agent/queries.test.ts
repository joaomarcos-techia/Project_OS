import { beforeEach, describe, expect, it, vi } from 'vitest';

const { decryptForTenant, metrics, withTenant } = vi.hoisted(() => ({
  decryptForTenant: vi.fn(async (_clinicId: string, encrypted: string) => encrypted),
  metrics: { emit: vi.fn() },
  withTenant: vi.fn(),
}));

vi.mock('@/lib/crypto', () => ({
  decryptForTenant,
  hashForLookup: vi.fn(),
  normalizePhone: vi.fn(),
}));
vi.mock('@/lib/db/tenant', () => ({ withTenant }));
vi.mock('@/lib/observability/metrics', () => ({ metrics }));
vi.mock('@/contexts/messaging', () => ({ messagingApiV1: {} }));

import { listConversations } from './queries';

function query<T>(rows: T[]) {
  const result = Promise.resolve(rows);
  const chain = Object.assign(result, {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    offset: () => chain,
  });
  return chain;
}

describe('listConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lê pacientes por join e a última mensagem em lote, sem N+1', async () => {
    const startedAt = new Date('2026-07-01T12:00:00.000Z');
    const tx = {
      select: vi.fn(),
      selectDistinctOn: vi.fn(),
    };
    tx.select
      .mockReturnValueOnce(
        query([
          {
            id: 'conversation-1',
            patientId: 'patient-1',
            patientName: 'Ana',
            patientPhoneEncrypted: 'phone-1',
            status: 'active',
            intentAtual: null,
            startedAt,
            lastMessageAt: startedAt,
            assignedToUserId: null,
            handoffPriority: null,
            handoffDueAt: null,
          },
          {
            id: 'conversation-2',
            patientId: null,
            patientName: null,
            patientPhoneEncrypted: 'phone-2',
            status: 'closed',
            intentAtual: null,
            startedAt,
            lastMessageAt: startedAt,
            assignedToUserId: null,
            handoffPriority: null,
            handoffDueAt: null,
          },
        ]),
      )
      .mockReturnValueOnce(query([{ total: 2 }]));
    tx.selectDistinctOn.mockReturnValue(
      query([
        { conversationId: 'conversation-1', contentEncrypted: 'Última mensagem da Ana' },
        { conversationId: 'conversation-2', contentEncrypted: 'Última mensagem sem cadastro' },
      ]),
    );
    withTenant.mockImplementation(
      async (_clinicId: string, fn: (transaction: typeof tx) => unknown) => fn(tx),
    );

    const result = await listConversations('clinic-1');

    expect(result).toMatchObject({
      total: 2,
      items: [
        {
          patientDisplayName: 'Ana',
          lastMessagePreview: 'Última mensagem da Ana',
          maskedPhone: null,
        },
        {
          patientDisplayName: null,
          lastMessagePreview: 'Última mensagem sem cadastro',
          maskedPhone: '****',
        },
      ],
    });
    expect(tx.select).toHaveBeenCalledTimes(2);
    expect(tx.selectDistinctOn).toHaveBeenCalledTimes(1);
  });
});
