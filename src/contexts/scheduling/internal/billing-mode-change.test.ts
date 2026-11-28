/**
 * P4.3 — a troca da modalidade no Scheduling (dono do campo). A orquestração com cobertura e
 * pré-condições financeiras está em `health-insurance/modality-change.ts`; a prova com banco,
 * gatilhos e concorrência em `scripts/security/health-insurance-modality-change-db.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ publishEvent: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: mocks.publishEvent }));

import { changeBillingModeTx } from './billing-mode-change';

function stubTx(row: Record<string, unknown> | undefined) {
  const updates: unknown[] = [];
  const tx = {
    select: () => ({
      from: () => ({ where: () => ({ for: () => ({ limit: async () => (row ? [row] : []) }) }) }),
    }),
    update: () => ({
      set: (v: unknown) => {
        updates.push(v);
        return { where: async () => undefined };
      },
    }),
  };
  return { tx: tx as never, updates };
}

const appt = (over: Record<string, unknown> = {}) => ({
  id: 'apt-1',
  status: 'agendado',
  billingMode: 'particular',
  patientId: 'pat-1',
  procedureId: 'proc-1',
  doctorId: 'doc-1',
  scheduledAt: new Date('2026-11-20T13:00:00Z'),
  ...over,
});
const input = (to: 'particular' | 'convenio') => ({
  clinicId: 'clinic-1',
  appointmentId: 'apt-1',
  to,
  idempotencyKey: 'key-1',
});

beforeEach(() => mocks.publishEvent.mockReset());

describe('changeBillingModeTx (P4.3)', () => {
  it('troca até a chegada e publica o evento com a chave da troca', async () => {
    for (const status of ['agendado', 'confirmado', 'chegou']) {
      mocks.publishEvent.mockReset();
      const { tx, updates } = stubTx(appt({ status }));
      const out = await changeBillingModeTx(tx, input('convenio'));
      expect(out).toMatchObject({
        changed: true,
        from: 'particular',
        to: 'convenio',
        eventKey: 'key-1:billing-mode:convenio',
      });
      expect(updates).toHaveLength(1);
      expect(mocks.publishEvent).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          eventType: 'scheduling.appointment.billing_mode_changed',
          idempotencyKey: 'key-1:billing-mode:convenio',
          payload: expect.objectContaining({
            from: 'particular',
            to: 'convenio',
            patientId: 'pat-1',
          }),
        }),
      );
    }
  });

  it('depois da chegada recusa com orientação (o gatilho 0148 recusa de novo)', async () => {
    for (const status of ['em_atendimento', 'atendido', 'cancelado', 'faltou']) {
      const { tx, updates } = stubTx(appt({ status }));
      await expect(changeBillingModeTx(tx, input('convenio'))).rejects.toMatchObject({
        code: 'APPOINTMENT_STARTED',
      });
      expect(updates).toHaveLength(0);
    }
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('mesma modalidade: nada muda, nenhum evento', async () => {
    const { tx, updates } = stubTx(appt({ billingMode: 'convenio' }));
    expect(await changeBillingModeTx(tx, input('convenio'))).toMatchObject({ changed: false });
    expect(updates).toHaveLength(0);
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('atendimento de outra clínica (ou inexistente) e convênio sem paciente: recusa', async () => {
    await expect(
      changeBillingModeTx(stubTx(undefined).tx, input('convenio')),
    ).rejects.toMatchObject({
      code: 'APPOINTMENT_NOT_FOUND',
    });
    await expect(
      changeBillingModeTx(stubTx(appt({ patientId: null })).tx, input('convenio')),
    ).rejects.toMatchObject({ code: 'NO_PATIENT' });
  });
});
