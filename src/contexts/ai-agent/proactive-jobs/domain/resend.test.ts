/**
 * ADR-064 — quando uma recusa da Meta merece reenvio.
 *
 * Só código retentável reenvia, e só dentro das tentativas e do prazo do tipo.
 * A tabela é a da Cloud API (conferida em 08/10/2026), com as decisões do
 * usuário: 131048 e 131049 são definitivos, e o código 1 é retentável.
 */
import { describe, expect, it } from 'vitest';

import { RETRYABLE_META_CODES, decideAfterRefusal, refusalReason, resendDeadline } from './resend';

const U = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-08T14:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const reminder = {
  patientId: U,
  appointmentId: U,
  scheduledAt: '2026-10-09T13:00:00.000Z',
  doctorNome: 'Dr X',
};
const deposit = {
  patientId: U,
  chargeId: U,
  appointmentId: U,
  amount: 150,
  holdExpiresAt: '2026-10-09T14:00:00.000Z',
};
const waitlist = {
  patientId: U,
  waitlistEntryId: U,
  releasedAppointmentId: U,
  scheduledAt: '2026-10-08T18:00:00.000Z',
  doctorNome: null,
};
const dunning = {
  patientId: U,
  lancamentoId: U,
  stage: 3 as const,
  valor: 200,
  dueDate: '2026-10-01',
  procedureNome: null,
};

describe('refusalReason', () => {
  it('maps the Meta code to the failed_reason', () => {
    expect(refusalReason('131042')).toBe('meta_131042');
    expect(refusalReason(null)).toBe('meta_failed');
    expect(refusalReason(undefined)).toBe('meta_failed');
  });
});

describe('RETRYABLE_META_CODES', () => {
  it('holds exactly the transient codes of the Cloud API table', () => {
    expect([...RETRYABLE_META_CODES].sort()).toEqual(
      ['1', '2', '4', '80007', '130429', '131000', '131016', '131056', '131057', '133004'].sort(),
    );
  });

  it('treats quality, ecosystem, payment, recipient and config refusals as definitive', () => {
    for (const code of [
      '131048', // qualidade
      '131049', // a Meta manda esperar 24 h ou mais
      '131042', // pagamento da WABA
      '131026', // destinatário não alcançável
      '131050', // descadastro de marketing
      '130472', // experimento
      '132001', // template
      '190', // token
      '100', // parâmetro
      '368', // conta restrita
    ]) {
      expect(RETRYABLE_META_CODES.has(code), code).toBe(false);
    }
  });
});

describe('decideAfterRefusal', () => {
  const base = { type: 'dunning' as const, payload: dunning, now: NOW };

  it('a transient refusal on the 1st attempt resends after the outbox backoff (+30 s)', () => {
    expect(decideAfterRefusal({ ...base, attempts: 1, code: '131000' })).toEqual({
      kind: 'resend',
      nextAt: new Date(NOW.getTime() + 30_000),
      delayMs: 30_000,
    });
  });

  it('follows the outbox backoff and gives up after the 5th attempt', () => {
    expect(decideAfterRefusal({ ...base, attempts: 2, code: '130429' })).toMatchObject({
      kind: 'resend',
      delayMs: 5 * MINUTE,
    });
    expect(decideAfterRefusal({ ...base, attempts: 3, code: '130429' })).toMatchObject({
      kind: 'resend',
      delayMs: 30 * MINUTE,
    });
    expect(decideAfterRefusal({ ...base, attempts: 4, code: '130429' })).toMatchObject({
      kind: 'resend',
      delayMs: 6 * HOUR,
    });
    expect(decideAfterRefusal({ ...base, attempts: 5, code: '130429' })).toEqual({
      kind: 'fail',
      why: 'attempts_exhausted',
    });
  });

  it('a definitive or missing code never resends, whatever the attempt', () => {
    for (const code of ['131026', '131042', '131048', '131049', null, undefined]) {
      expect(decideAfterRefusal({ ...base, attempts: 1, code })).toEqual({
        kind: 'fail',
        why: 'not_retryable',
      });
    }
    expect(decideAfterRefusal({ ...base, attempts: 5, code: '131026' })).toEqual({
      kind: 'fail',
      why: 'not_retryable',
    });
  });

  it('deposit link: resends only while the hold is open', () => {
    expect(
      decideAfterRefusal({
        type: 'deposit_link',
        payload: deposit,
        attempts: 1,
        code: '131000',
        now: NOW,
      }),
    ).toMatchObject({ kind: 'resend' });

    // O hold vence em 20 s; a próxima tentativa seria em +30 s.
    const closing = { ...deposit, holdExpiresAt: new Date(NOW.getTime() + 20_000).toISOString() };
    expect(
      decideAfterRefusal({
        type: 'deposit_link',
        payload: closing,
        attempts: 1,
        code: '131000',
        now: NOW,
      }),
    ).toEqual({ kind: 'fail', why: 'past_deadline' });
  });

  it('reminder and waitlist offer: never resend for after the appointment', () => {
    // 4ª tentativa → +6 h. A consulta do lembrete é em 23 h; a vaga, em 4 h.
    expect(
      decideAfterRefusal({
        type: 'reminder',
        payload: reminder,
        attempts: 4,
        code: '131016',
        now: NOW,
      }),
    ).toMatchObject({ kind: 'resend', delayMs: 6 * HOUR });
    expect(
      decideAfterRefusal({
        type: 'waitlist_offer',
        payload: waitlist,
        attempts: 4,
        code: '131016',
        now: NOW,
      }),
    ).toEqual({ kind: 'fail', why: 'past_deadline' });
  });
});

describe('resendDeadline', () => {
  it('is the deposit hold or the appointment time; the other types have none', () => {
    expect(resendDeadline('deposit_link', deposit)).toEqual(new Date(deposit.holdExpiresAt));
    expect(resendDeadline('reminder', reminder)).toEqual(new Date(reminder.scheduledAt));
    expect(resendDeadline('waitlist_offer', waitlist)).toEqual(new Date(waitlist.scheduledAt));
    expect(resendDeadline('dunning', dunning)).toBeNull();
    expect(
      resendDeadline('followup', {
        patientId: U,
        prontuarioId: U,
        doctorNome: null,
        returnDate: '2026-11-01',
      }),
    ).toBeNull();
    expect(
      resendDeadline('no_show_followup', {
        patientId: U,
        appointmentId: U,
        noShowAt: '2026-10-07T15:00:00.000Z',
      }),
    ).toBeNull();
    expect(
      resendDeadline('remainder_link', { patientId: U, chargeId: U, appointmentId: U, amount: 80 }),
    ).toBeNull();
  });
});
