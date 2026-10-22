import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  recordUsage: vi.fn(),
  readUsage: vi.fn(),
  publishEvent: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: mocks.publishEvent }));
vi.mock('../quota', () => ({
  currentPeriod: () => '2026-10',
  recordUsage: mocks.recordUsage,
  readUsage: mocks.readUsage,
}));

import './conversation-completed';

type Payload = { conversationId: string; outcome: string };
type Handler = (ctx: {
  tx: unknown;
  clinicId: string;
  eventId: string;
  payload: Payload;
}) => Promise<void>;

const registration = mocks.registerHandler.mock.calls[0]!;
const handler = registration[1] as Handler;
const payload: Payload = { conversationId: 'conversation-1', outcome: 'replied' };

function fakeTx(
  opts: {
    recent?: boolean;
    duplicate?: boolean;
    planCode?: string;
    doctors?: number;
    patientId?: string;
  } = {},
) {
  const selections = [
    [{ phoneHash: 'phone-hash', patientId: opts.patientId ?? null }],
    opts.recent ? [{ createdAt: new Date() }] : [],
    opts.planCode ? [{ code: opts.planCode, doctors: opts.doctors ?? 1 }] : [],
  ];
  const inserts: Array<Record<string, unknown>> = [];
  return {
    inserts,
    execute: vi.fn().mockResolvedValue([{ counted_at: new Date('2026-10-22T12:00:00Z') }]),
    select: vi.fn(() => {
      const rows = selections.shift() ?? [];
      const query = {
        from: () => query,
        innerJoin: () => query,
        where: () => query,
        orderBy: () => query,
        limit: async () => rows,
      };
      return query;
    }),
    insert: vi.fn(() => ({
      values: (value: Record<string, unknown>) => {
        inserts.push(value);
        return {
          onConflictDoNothing: () => ({
            returning: async () => (opts.duplicate ? [] : [{ dedupKey: value.dedupKey }]),
          }),
        };
      },
    })),
  };
}

beforeEach(() => {
  mocks.recordUsage.mockReset().mockResolvedValue(true);
  mocks.readUsage.mockReset().mockResolvedValue({ ai_messages: 1 });
  mocks.publishEvent.mockReset().mockResolvedValue(undefined);
});

describe('medição de conversa de IA', () => {
  it('registra o handler no evento do agente', () => {
    expect(registration[0]).toBe('ai_agent.conversation.completed');
  });

  it('registra turno e janela por hash de contato, não por conversationId', async () => {
    const tx = fakeTx({ planCode: 'clinica_2026_2', doctors: 2 });
    await handler({ tx, clinicId: 'clinic-1', eventId: 'event-1', payload });

    expect(tx.inserts[0]).toMatchObject({
      clinicId: 'clinic-1',
      metric: 'ai_turn',
      subjectId: 'phone:phone-hash',
      dedupKey: 'event-1',
    });
    expect(mocks.recordUsage).toHaveBeenCalledWith(
      tx,
      'clinic-1',
      { metric: 'ai_messages', subjectId: 'phone:phone-hash', dedupKey: 'event-1' },
      '2026-10',
    );
  });

  it('não conta outro turno do mesmo contato dentro de 24h', async () => {
    const tx = fakeTx({ recent: true });
    await handler({ tx, clinicId: 'clinic-1', eventId: 'event-2', payload });
    expect(mocks.recordUsage).not.toHaveBeenCalled();
    expect(tx.inserts).toHaveLength(1);
  });

  it('usa o paciente identificado como identidade entre números diferentes', async () => {
    const tx = fakeTx({ patientId: 'patient-1' });
    await handler({ tx, clinicId: 'clinic-1', eventId: 'event-patient', payload });
    expect(tx.inserts[0]).toMatchObject({ subjectId: 'patient:patient-1' });
    expect(mocks.recordUsage).toHaveBeenCalledWith(
      tx,
      'clinic-1',
      { metric: 'ai_messages', subjectId: 'patient:patient-1', dedupKey: 'event-patient' },
      '2026-10',
    );
    expect(tx.execute).toHaveBeenCalledTimes(3);
  });

  it('reentrega do mesmo turno não conta novamente após a janela', async () => {
    const tx = fakeTx({ duplicate: true });
    await handler({ tx, clinicId: 'clinic-1', eventId: 'event-1', payload });
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });

  it.each([
    { count: 400, threshold: 80 },
    { count: 500, threshold: 100 },
  ])('emite aviso idempotente ao cruzar $threshold%', async ({ count, threshold }) => {
    mocks.readUsage.mockResolvedValue({ ai_messages: count });
    const tx = fakeTx({ planCode: 'consultorio_2026' });
    await handler({ tx, clinicId: 'clinic-1', eventId: `event-${count}`, payload });
    expect(mocks.publishEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: 'billing.ai_usage.notice_requested',
        idempotencyKey: `ai-usage:clinic-1:2026-10:${threshold}`,
        payload: expect.objectContaining({ threshold, count, limit: 500 }),
      }),
    );
  });

  it('não avisa novamente acima do limiar e não avisa contrato legado', async () => {
    mocks.readUsage.mockResolvedValue({ ai_messages: 401 });
    await handler({
      tx: fakeTx({ planCode: 'consultorio_2026' }),
      clinicId: 'clinic-1',
      eventId: 'event-1',
      payload,
    });
    await handler({
      tx: fakeTx({ planCode: 'solo' }),
      clinicId: 'clinic-1',
      eventId: 'event-2',
      payload,
    });
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it.each(['fallback', 'quota_blocked', 'prefiltered', 'handoff', 'suppressed'])(
    'não mede outcome %s',
    async (outcome) => {
      const tx = fakeTx();
      await handler({
        tx,
        clinicId: 'clinic-1',
        eventId: 'event-1',
        payload: { ...payload, outcome },
      });
      expect(tx.select).not.toHaveBeenCalled();
      expect(mocks.recordUsage).not.toHaveBeenCalled();
    },
  );
});
