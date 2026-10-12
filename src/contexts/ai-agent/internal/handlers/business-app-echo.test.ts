/**
 * Coexistência — a recepção respondeu pelo app WhatsApp Business do celular.
 * I/O mockado: tenant (tx), cripto, contrato do Messaging e as funções de
 * conversa. O que se prova aqui é a decisão do handler, não o SQL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBusinessAppEchoForAgent: vi.fn(),
  findOrCreateConversation: vi.fn(),
  escalateToHuman: vi.fn(),
  emit: vi.fn(),
  existing: [] as Array<{ id: string }>,
  inserted: [] as Array<Record<string, unknown>>,
}));

const fakeTx = {
  select: () => ({
    from: () => ({ where: () => ({ limit: async () => mocks.existing }) }),
  }),
  insert: () => ({
    values: async (row: Record<string, unknown>) => {
      mocks.inserted.push(row);
    },
  }),
};

vi.mock('@/lib/db/tenant', () => ({
  withTenant: (_clinicId: string, fn: (tx: typeof fakeTx) => Promise<unknown>) => fn(fakeTx),
}));
vi.mock('@/lib/crypto', () => ({
  encryptForTenant: vi.fn(async (_clinicId: string, text: string) => `enc(${text})`),
  phoneLookupHashes: vi.fn(async (phone: string) => [`hash(${phone})`, `hash-variante(${phone})`]),
}));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: vi.fn() }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('@/contexts/messaging', () => ({
  MESSAGING_EVENTS: { BUSINESS_APP_ECHO_RECEIVED: 'messaging.business_app_echo.received' },
  messagingApiV1: { getBusinessAppEchoForAgent: mocks.getBusinessAppEchoForAgent },
}));
vi.mock('../conversation', () => ({
  findOrCreateConversation: mocks.findOrCreateConversation,
  escalateToHuman: mocks.escalateToHuman,
}));

import { PoisonPillError } from '@/lib/outbox/errors';

import {
  BUSINESS_APP_NON_TEXT,
  BUSINESS_APP_REPLY_REASON,
  recordBusinessAppEcho,
} from './business-app-echo';

const CLINIC = '11111111-1111-4111-8111-111111111111';

function ctx(overrides: Partial<{ clinicId: string }> = {}) {
  return {
    tx: fakeTx as never,
    clinicId: CLINIC,
    eventId: 'event-1',
    attempt: 1,
    payload: {
      clinicId: overrides.clinicId ?? CLINIC,
      echoId: 'echo-1',
      providerMessageId: 'wamid-echo',
      provider: 'meta' as const,
      toNumberHash: 'hash-paciente',
      hasText: true,
      sentAt: '2026-09-30T12:00:00.000Z',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.existing = [];
  mocks.inserted = [];
  mocks.getBusinessAppEchoForAgent.mockResolvedValue({
    id: 'echo-1',
    text: 'Oi, já te retorno',
    hasText: true,
    toNumberHash: 'hash-paciente',
    toNumber: '5511988887777',
    sentAt: new Date('2026-09-30T12:00:00Z'),
  });
  mocks.findOrCreateConversation.mockResolvedValue({ id: 'conv-1', status: 'active' });
});

describe('recordBusinessAppEcho', () => {
  it('conversa com a IA: grava a mensagem como do celular e pausa a IA', async () => {
    await recordBusinessAppEcho(ctx());

    // O paciente é casado em todas as grafias do número (com/sem 55 e nono dígito).
    expect(mocks.findOrCreateConversation).toHaveBeenCalledWith(
      fakeTx,
      CLINIC,
      'hash-paciente',
      'enc(5511988887777)',
      ['hash(5511988887777)', 'hash-variante(5511988887777)'],
    );
    expect(mocks.inserted).toEqual([
      {
        clinicId: CLINIC,
        conversationId: 'conv-1',
        direction: 'out',
        contentEncrypted: 'enc(Oi, já te retorno)',
        eventId: 'event-1',
        sentViaBusinessApp: true,
      },
    ]);
    expect(mocks.escalateToHuman).toHaveBeenCalledWith(
      fakeTx,
      CLINIC,
      'conv-1',
      BUSINESS_APP_REPLY_REASON,
    );
    expect(mocks.emit).toHaveBeenCalledWith('ai_agent.business_app_echo.recorded', {
      clinicId: CLINIC,
      outcome: 'paused',
    });
  });

  it('conversa já em atendimento humano: grava sem escalar de novo', async () => {
    mocks.findOrCreateConversation.mockResolvedValue({ id: 'conv-1', status: 'handoff' });

    await recordBusinessAppEcho(ctx());

    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.escalateToHuman).not.toHaveBeenCalled();
  });

  it('reenvio do outbox (mesmo eventId): não duplica nem escala', async () => {
    mocks.existing = [{ id: 'msg-ja-gravada' }];

    await recordBusinessAppEcho(ctx());

    expect(mocks.inserted).toEqual([]);
    expect(mocks.escalateToHuman).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith('ai_agent.business_app_echo.recorded', {
      clinicId: CLINIC,
      outcome: 'duplicate',
    });
  });

  it('eco sem texto (mídia) entra com o aviso no lugar do conteúdo', async () => {
    mocks.getBusinessAppEchoForAgent.mockResolvedValue({
      id: 'echo-1',
      text: '',
      hasText: false,
      toNumberHash: 'hash-paciente',
      toNumber: '5511988887777',
      sentAt: new Date(),
    });

    await recordBusinessAppEcho(ctx());

    expect(mocks.inserted[0]).toMatchObject({ contentEncrypted: `enc(${BUSINESS_APP_NON_TEXT})` });
  });

  it('eco purgado pela retenção é terminal: retry não conserta', async () => {
    mocks.getBusinessAppEchoForAgent.mockResolvedValue(null);

    await expect(recordBusinessAppEcho(ctx())).rejects.toBeInstanceOf(PoisonPillError);
    expect(mocks.inserted).toEqual([]);
  });

  it('payload de outra clínica é recusado antes de tocar o banco', async () => {
    await expect(
      recordBusinessAppEcho(ctx({ clinicId: '22222222-2222-4222-8222-222222222222' })),
    ).rejects.toBeInstanceOf(PoisonPillError);
    expect(mocks.getBusinessAppEchoForAgent).not.toHaveBeenCalled();
  });
});
