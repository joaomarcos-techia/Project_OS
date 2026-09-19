import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getClinicTimezoneTx: vi.fn(),
  insertJobTx: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../infra/repository', () => ({
  getClinicTimezoneTx: mocks.getClinicTimezoneTx,
  insertJobTx: mocks.insertJobTx,
}));

import { scheduleNoShowFollowup } from './appointment-no-show';

const payload = (over: Record<string, unknown> = {}) => ({
  appointmentId: '11111111-1111-1111-1111-111111111111',
  clinicId: 'clinic-INTRUSA',
  patientId: '22222222-2222-2222-2222-222222222222',
  fromStatus: 'confirmado',
  toStatus: 'faltou',
  noShowAt: '2026-09-04T15:00:00.000Z', // sexta-feira, 12h em São Paulo
  ...over,
});

const run = (over: Record<string, unknown> = {}) =>
  scheduleNoShowFollowup({
    tx: 'TX' as never,
    clinicId: '33333333-3333-3333-3333-333333333333',
    payload: payload(over) as never,
    eventId: 'evt-1',
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClinicTimezoneTx.mockResolvedValue('America/Sao_Paulo');
});

describe('ADR-057 — no_show → no_show_followup', () => {
  it('agenda uma vez na segunda-feira seguinte às 10h locais', async () => {
    await run();

    expect(mocks.insertJobTx).toHaveBeenCalledWith('TX', {
      clinicId: '33333333-3333-3333-3333-333333333333',
      type: 'no_show_followup',
      scheduledFor: new Date('2026-09-07T13:00:00.000Z'),
      payload: {
        patientId: '22222222-2222-2222-2222-222222222222',
        appointmentId: '11111111-1111-1111-1111-111111111111',
        noShowAt: '2026-09-04T15:00:00.000Z',
      },
      dedupKey: 'no_show_followup:11111111-1111-1111-1111-111111111111',
    });
  });

  it.each([
    ['evento legado sem timestamp', { noShowAt: undefined }],
    ['consulta sem paciente', { patientId: null }],
    ['transição que não representa falta', { toStatus: 'cancelado' }],
  ])('%s não gera contato retroativo ou indevido', async (_name, over) => {
    await run(over);

    expect(mocks.getClinicTimezoneTx).not.toHaveBeenCalled();
    expect(mocks.insertJobTx).not.toHaveBeenCalled();
  });
});
