/**
 * ADR-064 — até quando um reenvio da C14 ainda serve, no fuso da clínica.
 *
 * O lembrete diz "agendado para amanhã às {{2}}": vence na meia-noite local do
 * dia da consulta, e não na hora dela. O link do sinal vence com o hold; a oferta
 * da lista de espera, no horário da vaga. Os demais tipos só têm o limite de
 * tentativas.
 */
import { describe, expect, it } from 'vitest';

import { resendDeadline } from './resend-deadline';

const U = '11111111-1111-4111-8111-111111111111';
const SP = 'America/Sao_Paulo'; // UTC−3, sem horário de verão desde 2019

describe('resendDeadline', () => {
  it('reminder: local midnight of the appointment day, not the appointment time', () => {
    const reminder = {
      patientId: U,
      appointmentId: U,
      // 16:00 em São Paulo no dia 09/10.
      scheduledAt: '2026-10-09T19:00:00.000Z',
      doctorNome: 'Dr X',
    };
    expect(resendDeadline('reminder', reminder, SP)).toEqual(new Date('2026-10-09T03:00:00.000Z'));
  });

  it('reminder: an appointment early in the UTC day still uses the clinic calendar day', () => {
    const reminder = {
      patientId: U,
      appointmentId: U,
      // 01:30 UTC do dia 10 = 22:30 do dia 09 em São Paulo.
      scheduledAt: '2026-10-10T01:30:00.000Z',
      doctorNome: 'Dr X',
    };
    expect(resendDeadline('reminder', reminder, SP)).toEqual(new Date('2026-10-09T03:00:00.000Z'));
  });

  it('deposit link: the hold; waitlist offer: the slot time', () => {
    expect(
      resendDeadline(
        'deposit_link',
        {
          patientId: U,
          chargeId: U,
          appointmentId: U,
          amount: 150,
          holdExpiresAt: '2026-10-09T14:00:00.000Z',
        },
        SP,
      ),
    ).toEqual(new Date('2026-10-09T14:00:00.000Z'));
    expect(
      resendDeadline(
        'waitlist_offer',
        {
          patientId: U,
          waitlistEntryId: U,
          releasedAppointmentId: U,
          scheduledAt: '2026-10-08T18:00:00.000Z',
          doctorNome: null,
        },
        SP,
      ),
    ).toEqual(new Date('2026-10-08T18:00:00.000Z'));
  });

  it('the other types have no deadline', () => {
    expect(
      resendDeadline(
        'dunning',
        {
          patientId: U,
          lancamentoId: U,
          stage: 3,
          valor: 200,
          dueDate: '2026-10-01',
          procedureNome: null,
        },
        SP,
      ),
    ).toBeNull();
    expect(
      resendDeadline(
        'followup',
        { patientId: U, prontuarioId: U, doctorNome: null, returnDate: '2026-11-01' },
        SP,
      ),
    ).toBeNull();
    expect(
      resendDeadline(
        'no_show_followup',
        { patientId: U, appointmentId: U, noShowAt: '2026-10-07T15:00:00.000Z' },
        SP,
      ),
    ).toBeNull();
    expect(
      resendDeadline(
        'remainder_link',
        { patientId: U, chargeId: U, appointmentId: U, amount: 80 },
        SP,
      ),
    ).toBeNull();
  });
});
