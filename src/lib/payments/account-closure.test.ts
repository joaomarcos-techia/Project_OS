import { describe, expect, it } from 'vitest';

import {
  CLOSURE_INACTIVITY_DAYS,
  CLOSURE_NOTICE_DAYS,
  closureSchedule,
  hasClosureBlockers,
} from './account-closure';

const DAY = 86_400_000;
const last = new Date('2026-10-07T12:00:00.000Z');
const at = (days: number) => new Date(last.getTime() + days * DAY);

describe('hasClosureBlockers', () => {
  it('qualquer item em aberto impede o encerramento', () => {
    expect(hasClosureBlockers({ openLinks: 0, pendingRefunds: 0, openDisputes: 0 })).toBe(false);
    expect(hasClosureBlockers({ openLinks: 1, pendingRefunds: 0, openDisputes: 0 })).toBe(true);
    expect(hasClosureBlockers({ openLinks: 0, pendingRefunds: 1, openDisputes: 0 })).toBe(true);
    expect(hasClosureBlockers({ openLinks: 0, pendingRefunds: 0, openDisputes: 1 })).toBe(true);
  });
});

describe('closureSchedule — 180 dias sem movimentação, aviso 30 dias antes', () => {
  it('usa os prazos da decisão de 07/10/2026', () => {
    expect(CLOSURE_INACTIVITY_DAYS).toBe(180);
    expect(CLOSURE_NOTICE_DAYS).toBe(30);
  });

  it('antes de 150 dias não avisa nem encerra, e prevê o encerramento aos 180', () => {
    const schedule = closureSchedule({ lastActivityAt: last, noticeSentAt: null, now: at(149) });
    expect(schedule).toMatchObject({ noticeDue: false, closeDue: false, noticeValid: false });
    expect(schedule.noticeDueAt).toEqual(at(150));
    expect(schedule.closeAt).toEqual(at(180));
  });

  it('aos 150 dias o aviso é devido', () => {
    const schedule = closureSchedule({ lastActivityAt: last, noticeSentAt: null, now: at(150) });
    expect(schedule).toMatchObject({ noticeDue: true, closeDue: false });
    expect(schedule.closeAt).toEqual(at(180));
  });

  it('com aviso aos 150 dias, encerra aos 180 e não antes', () => {
    const noticeSentAt = at(150);
    expect(closureSchedule({ lastActivityAt: last, noticeSentAt, now: at(179) })).toMatchObject({
      noticeValid: true,
      noticeDue: false,
      closeDue: false,
    });
    expect(closureSchedule({ lastActivityAt: last, noticeSentAt, now: at(180) })).toMatchObject({
      closeDue: true,
    });
  });

  it('aviso atrasado empurra o encerramento para 30 dias depois dele', () => {
    // O cron falhou e o aviso só saiu aos 200 dias: ainda são 30 dias de prazo.
    const noticeSentAt = at(200);
    const before = closureSchedule({ lastActivityAt: last, noticeSentAt, now: at(229) });
    expect(before.closeDue).toBe(false);
    expect(before.closeAt).toEqual(at(230));
    expect(closureSchedule({ lastActivityAt: last, noticeSentAt, now: at(230) }).closeDue).toBe(
      true,
    );
  });

  it('sem aviso, nunca encerra — mesmo muito depois dos 180 dias', () => {
    const schedule = closureSchedule({ lastActivityAt: last, noticeSentAt: null, now: at(400) });
    expect(schedule).toMatchObject({ noticeDue: true, closeDue: false });
    expect(schedule.closeAt).toEqual(at(430));
  });

  it('movimentação depois do aviso invalida o aviso e reinicia a contagem', () => {
    const noticeSentAt = at(150);
    const movimento = at(170);
    const schedule = closureSchedule({
      lastActivityAt: movimento,
      noticeSentAt,
      now: at(185),
    });
    expect(schedule).toMatchObject({ noticeValid: false, noticeDue: false, closeDue: false });
    expect(schedule.closeAt).toEqual(new Date(movimento.getTime() + 180 * DAY));
  });
});
