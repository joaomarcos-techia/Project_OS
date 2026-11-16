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
vi.mock('@/contexts/messaging', () => ({
  messagingApiV1: { getOutboundStatuses: vi.fn(async () => new Map()) },
}));

import { getConversationThread, listConversations } from './queries';

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
            patientPhoneEncrypted: '+5511999991234',
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
            patientPhoneEncrypted: '+5511988885678',
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
    // String, não Date: é o que o driver devolve para uma coluna calculada, e
    // um mock com Date escondia a quebra real (`.getTime is not a function`).
    const inboundRecente = String(Date.now() - 60_000);
    tx.selectDistinctOn.mockReturnValue(
      query([
        {
          conversationId: 'conversation-1',
          contentEncrypted: 'Última mensagem da Ana',
          lastInboundEpochMs: inboundRecente,
        },
        {
          conversationId: 'conversation-2',
          contentEncrypted: 'Última mensagem sem cadastro',
          // Inbound antigo: a janela de 24 h da Meta está fechada.
          lastInboundEpochMs: String(startedAt.getTime()),
        },
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
          contactPhone: '+5511999991234',
          windowOpen: true,
        },
        {
          patientDisplayName: null,
          lastMessagePreview: 'Última mensagem sem cadastro',
          maskedPhone: '+5511*****5678',
          contactPhone: '+5511988885678',
          windowOpen: false,
        },
      ],
    });
    expect(tx.select).toHaveBeenCalledTimes(2);
    // UMA varredura em lote, não uma por conversa — e não mais duas. A prévia e
    // o último INBOUND (janela de 24 h) saem da mesma passada, via window
    // function avaliada antes do DISTINCT ON. O que este teste protege é o
    // número ser CONSTANTE: com 2 conversas ou com 200, continua 1. O
    // `windowOpen` acima é o que prova que a combinação não perdeu a distinção
    // entre "última mensagem" e "última mensagem DO PACIENTE".
    expect(tx.selectDistinctOn).toHaveBeenCalledTimes(1);
    expect(decryptForTenant).toHaveBeenCalledWith('clinic-1', '+5511999991234');
    expect(decryptForTenant).toHaveBeenCalledWith('clinic-1', '+5511988885678');
  });

  it('na sessão de suporte (S-01b): não decifra a prévia e só entrega o telefone mascarado', async () => {
    const startedAt = new Date('2026-07-01T12:00:00.000Z');
    const tx = { select: vi.fn(), selectDistinctOn: vi.fn() };
    tx.select
      .mockReturnValueOnce(
        query([
          {
            id: 'conversation-1',
            patientId: 'patient-1',
            patientName: 'Ana',
            patientPhoneEncrypted: '+5511999991234',
            status: 'active',
            intentAtual: null,
            startedAt,
            lastMessageAt: startedAt,
            assignedToUserId: null,
            handoffPriority: null,
            handoffDueAt: null,
          },
        ]),
      )
      .mockReturnValueOnce(query([{ total: 1 }]));
    tx.selectDistinctOn.mockReturnValue(
      query([
        {
          conversationId: 'conversation-1',
          contentEncrypted: 'Última mensagem da Ana',
          lastInboundEpochMs: String(Date.now() - 60_000),
        },
      ]),
    );
    withTenant.mockImplementation(
      async (_clinicId: string, fn: (transaction: typeof tx) => unknown) => fn(tx),
    );

    const result = await listConversations('clinic-1', { redactForSupport: true });

    expect(result.items).toEqual([
      expect.objectContaining({
        patientDisplayName: 'Ana',
        lastMessagePreview: null,
        previewHidden: true,
        contactPhone: null,
        maskedPhone: '+5511*****1234',
        windowOpen: true,
      }),
    ]);
    // A prévia nem chega a ser decifrada.
    expect(decryptForTenant).not.toHaveBeenCalledWith('clinic-1', 'Última mensagem da Ana');
  });
});

describe('telefone no histórico', () => {
  it('decifra dentro do tenant e preserva o telefone mascarado sem publicar o contato nas métricas', async () => {
    vi.clearAllMocks();
    const startedAt = new Date('2026-09-09T12:00:00Z');
    const tx = { select: vi.fn() };
    tx.select
      .mockReturnValueOnce(
        query([
          {
            id: 'conversation-1',
            patientId: null,
            patientPhoneEncrypted: '+5511999991234',
            status: 'active',
            intentAtual: null,
            startedAt,
            lastMessageAt: startedAt,
          },
        ]),
      )
      .mockReturnValueOnce(query([]));
    withTenant.mockImplementation(
      async (_clinicId: string, fn: (transaction: typeof tx) => unknown) => fn(tx),
    );

    const thread = await getConversationThread('clinic-1', 'conversation-1');

    expect(thread).toMatchObject({ contactPhone: '+5511999991234', maskedPhone: '+5511*****1234' });
    expect(decryptForTenant).toHaveBeenCalledWith('clinic-1', '+5511999991234');
    expect(JSON.stringify(metrics.emit.mock.calls)).not.toContain('5511999991234');
  });
});
