import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

import type { AppointmentRow } from '../schema';

const mocks = vi.hoisted(() => ({ publishEvent: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: mocks.publishEvent }));

import { publishCreated } from './appointment-core';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const APPOINTMENT = '22222222-2222-4222-8222-222222222222';
const key = 'agendamento-teste';
const tx = {} as Tx;

const row = {
  id: APPOINTMENT,
  clinicId: CLINIC,
  doctorId: '33333333-3333-4333-8333-333333333333',
  patientId: '44444444-4444-4444-8444-444444444444',
  procedureId: '55555555-5555-4555-8555-555555555555',
  scheduledAt: new Date('2026-10-10T12:00:00.000Z'),
  durationMin: 30,
  valor: '180.00',
  snapshotProcedureName: 'Consulta',
  snapshotProcedureCodigo: null,
  snapshotProcedureCategoria: null,
  snapshotProcedureValor: '180.00',
  snapshotProcedureDuracaoMin: 30,
  snapshotDoctorNome: 'Profissional',
  createdVia: 'ai_agent',
  urgencia: false,
} satisfies Pick<
  AppointmentRow,
  | 'id'
  | 'clinicId'
  | 'doctorId'
  | 'patientId'
  | 'procedureId'
  | 'scheduledAt'
  | 'durationMin'
  | 'valor'
  | 'snapshotProcedureName'
  | 'snapshotProcedureCodigo'
  | 'snapshotProcedureCategoria'
  | 'snapshotProcedureValor'
  | 'snapshotProcedureDuracaoMin'
  | 'snapshotDoctorNome'
  | 'createdVia'
  | 'urgencia'
>;

beforeEach(() => mocks.publishEvent.mockReset());

describe('gatilho do sinal após agendamento pela IA', () => {
  it('publica o pedido mínimo junto ao evento de criação e com chave estável', async () => {
    await publishCreated(tx, row, key, null);
    expect(mocks.publishEvent).toHaveBeenCalledTimes(2);
    expect(mocks.publishEvent).toHaveBeenNthCalledWith(2, tx, {
      clinicId: CLINIC,
      eventType: 'scheduling.appointment.deposit_requested',
      payload: { clinicId: CLINIC, appointmentId: APPOINTMENT },
      idempotencyKey: `${key}:deposit_requested`,
      correlationId: null,
    });
  });

  it('não antecipa cobrança de agendamento feito pela recepção', async () => {
    await publishCreated(tx, { ...row, createdVia: 'attendant' }, key, null);
    expect(mocks.publishEvent).toHaveBeenCalledTimes(1);
  });
});
