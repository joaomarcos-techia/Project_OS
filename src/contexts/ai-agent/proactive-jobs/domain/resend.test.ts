/**
 * ADR-064 — quando uma recusa da Meta merece reenvio.
 *
 * Só código retentável reenvia, e só dentro das tentativas e do prazo. A tabela é
 * a da Cloud API (conferida em 08/10/2026), com as decisões do usuário: 131048 e
 * 131049 são definitivos, e o código 1 é retentável. O prazo por tipo é calculado
 * fora daqui (`application/resend-deadline.ts`).
 */
import { describe, expect, it } from 'vitest';

import { RETRYABLE_META_CODES, decideAfterRefusal, refusalReason } from './resend';

const NOW = new Date('2026-10-08T14:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

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
  const base = { deadline: null, now: NOW };

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

  it('never schedules a resend for at or after the deadline', () => {
    const resend = { attempts: 1, code: '131000', now: NOW };
    expect(
      decideAfterRefusal({ ...resend, deadline: new Date(NOW.getTime() + 31_000) }),
    ).toMatchObject({ kind: 'resend' });
    for (const ms of [30_000, 20_000, -1]) {
      expect(decideAfterRefusal({ ...resend, deadline: new Date(NOW.getTime() + ms) })).toEqual({
        kind: 'fail',
        why: 'past_deadline',
      });
    }
  });
});
