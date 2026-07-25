import { describe, expect, it } from 'vitest';

import { selectAppointmentForConfirmation } from './appointment-selection';

const appointments = [
  { id: 'a1', scheduledAt: '2026-07-25T10:00:00-03:00' },
  { id: 'a2', scheduledAt: '2026-07-26T11:00:00-03:00' },
];

describe('seleção segura da consulta a confirmar', () => {
  it('seleciona automaticamente somente quando há uma única consulta', () => {
    expect(selectAppointmentForConfirmation([appointments[0]!], {})).toEqual(appointments[0]);
    expect(selectAppointmentForConfirmation(appointments, {})).toBeNull();
  });

  it('seleciona por id pertencente à lista do paciente', () => {
    expect(selectAppointmentForConfirmation(appointments, { appointmentId: 'a2' })).toEqual(
      appointments[1],
    );
    expect(selectAppointmentForConfirmation(appointments, { appointmentId: 'terceiro' })).toBeNull();
  });

  it('seleciona por instante ISO equivalente e rejeita data inválida', () => {
    expect(
      selectAppointmentForConfirmation(appointments, {
        scheduledAt: '2026-07-26T14:00:00Z',
      }),
    ).toEqual(appointments[1]);
    expect(selectAppointmentForConfirmation(appointments, { scheduledAt: 'ontem' })).toBeNull();
  });
});
