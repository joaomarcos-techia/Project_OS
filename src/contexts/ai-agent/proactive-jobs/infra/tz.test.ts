import { describe, expect, it } from 'vitest';

import {
  addCalendarDays,
  calendarDaysBetween,
  clinicLocalHour,
  clinicLocalToUtc,
  localDateYMD,
} from './tz';

const SP = 'America/Sao_Paulo'; // UTC-3, sem DST desde 2019

describe('tz helpers (ADR-2: dias-calendário no tz da clínica)', () => {
  it('clinicLocalToUtc: 18:00 local em SP = 21:00 UTC', () => {
    const utc = clinicLocalToUtc(SP, '2026-06-18', 18);
    expect(utc.toISOString()).toBe('2026-06-18T21:00:00.000Z');
  });

  it('clinicLocalHour: 21:00Z é 18h local em SP', () => {
    expect(clinicLocalHour(SP, new Date('2026-06-18T21:00:00Z'))).toBe(18);
  });

  it('localDateYMD vira o dia anterior quando o instante UTC cruza meia-noite local', () => {
    // 2026-06-19T02:00Z = 2026-06-18 23:00 em SP → ainda dia 18 local.
    expect(localDateYMD(SP, new Date('2026-06-19T02:00:00Z'))).toBe('2026-06-18');
  });

  it('addCalendarDays soma/subtrai dias de calendário (cruza mês)', () => {
    expect(addCalendarDays('2026-06-30', 1)).toBe('2026-07-01');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('calendarDaysBetween conta dias de calendário, não horas decorridas', () => {
    // Vencimento 15/06 00:30Z (= 14/06 21:30 SP), agora 18/06 02:00Z (= 17/06 23:00 SP).
    // Em UTC seriam ~3 dias; em dias-calendário SP: 17 − 14 = 3.
    const due = new Date('2026-06-15T00:30:00Z');
    const now = new Date('2026-06-18T02:00:00Z');
    expect(calendarDaysBetween(SP, due, now)).toBe(3);
  });
});
