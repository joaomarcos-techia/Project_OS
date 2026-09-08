import { describe, expect, it } from 'vitest';

import {
  computeSlots,
  eachLocalDayInRange,
  filterSlotsFrom,
  localDateMinutes,
  minutesToTime,
  parseTimeToMinutes,
  weekdayOf,
  zonedWallToUtc,
  type LocalAvailability,
  type LocalDay,
  type LocalFloor,
} from './slot-resolver';

const TZ = 'America/Sao_Paulo'; // UTC-3, sem DST desde 2019

// 2026-06-01 is a Monday (weekday 1).
const MONDAY: LocalDay = { date: '2026-06-01', weekday: 1 };
const avail = (over: Partial<LocalAvailability> = {}): LocalAvailability => ({
  doctorId: 'd1',
  unitId: null,
  weekday: 1,
  startMin: 540, // 09:00
  endMin: 660, // 11:00
  ...over,
});

describe('computeSlots — availability slicing', () => {
  it('slices a window into discrete slots', () => {
    const slots = computeSlots({
      days: [MONDAY],
      availabilities: [avail()],
      busy: [],
      holidays: [],
      slotMinutes: 30,
    });
    expect(slots.map((s) => s.startMin)).toEqual([540, 570, 600, 630]);
  });

  it('drops a partial trailing slot that does not fit', () => {
    const slots = computeSlots({
      days: [MONDAY],
      availabilities: [avail({ endMin: 650 })], // 09:00–10:50
      busy: [],
      holidays: [],
      slotMinutes: 30,
    });
    expect(slots.map((s) => s.startMin)).toEqual([540, 570, 600]); // 630–660 would overflow
  });

  it('produces nothing when weekday does not match', () => {
    const slots = computeSlots({
      days: [{ date: '2026-06-02', weekday: 2 }],
      availabilities: [avail()], // weekday 1
      busy: [],
      holidays: [],
      slotMinutes: 30,
    });
    expect(slots).toHaveLength(0);
  });
});

describe('filterSlotsFrom (F-03 — computeSlots é cego ao relógio)', () => {
  // Agenda 08:00-11:00 em blocos de 60min, no dia da MONDAY do fixture.
  const dayFloor = (minutes: number): LocalFloor => ({ date: MONDAY.date, minutes });
  const slots = computeSlots({
    days: [MONDAY],
    availabilities: [avail({ startMin: 480, endMin: 660 })],
    busy: [],
    holidays: [],
    slotMinutes: 60,
  });

  it('o defeito que motivou a função: computeSlots devolve a manhã inteira', () => {
    expect(slots.map((s) => s.startMin)).toEqual([480, 540, 600]);
  });

  it('às 09:30 locais restam só os blocos que ainda vão começar', () => {
    expect(filterSlotsFrom(slots, dayFloor(570)).map((s) => s.startMin)).toEqual([600]);
  });

  it('a fronteira é inclusiva: um bloco que começa EXATAMENTE no piso vale', () => {
    expect(filterSlotsFrom(slots, dayFloor(540)).map((s) => s.startMin)).toEqual([540, 600]);
  });

  it('piso antes da agenda não descarta nada; depois dela descarta tudo', () => {
    expect(filterSlotsFrom(slots, dayFloor(0))).toHaveLength(3);
    expect(filterSlotsFrom(slots, dayFloor(23 * 60))).toHaveLength(0);
  });

  it('compara DIA antes de hora — o dia seguinte sobrevive a um piso tardio', () => {
    const tuesday = { date: '2026-06-02', weekday: 2 };
    const twoDays = computeSlots({
      days: [MONDAY, tuesday],
      availabilities: [
        avail({ startMin: 480, endMin: 660 }),
        avail({ weekday: 2, startMin: 480, endMin: 660 }),
      ],
      busy: [],
      holidays: [],
      slotMinutes: 60,
    });
    const kept = filterSlotsFrom(twoDays, dayFloor(23 * 60));
    expect(kept.every((s) => s.date === tuesday.date)).toBe(true);
    expect(kept).toHaveLength(3);
  });

  it('lista vazia continua vazia', () => {
    expect(filterSlotsFrom([], dayFloor(600))).toEqual([]);
  });
});

describe('computeSlots — busy subtraction (cancelamento libera, 6.6.4)', () => {
  it('removes only the overlapping slot', () => {
    const slots = computeSlots({
      days: [MONDAY],
      availabilities: [avail()],
      busy: [{ doctorId: 'd1', date: '2026-06-01', startMin: 570, endMin: 600 }],
      holidays: [],
      slotMinutes: 30,
    });
    expect(slots.map((s) => s.startMin)).toEqual([540, 600, 630]);
  });

  it("does not subtract another doctor's appointment", () => {
    const slots = computeSlots({
      days: [MONDAY],
      availabilities: [avail()],
      busy: [{ doctorId: 'OTHER', date: '2026-06-01', startMin: 570, endMin: 600 }],
      holidays: [],
      slotMinutes: 30,
    });
    expect(slots).toHaveLength(4);
  });
});

describe('computeSlots — holidays', () => {
  it('full-day holiday blocks the whole window', () => {
    const slots = computeSlots({
      days: [MONDAY],
      availabilities: [avail()],
      busy: [],
      holidays: [{ date: '2026-06-01', unitId: null, startMin: null, endMin: null }],
      slotMinutes: 30,
    });
    expect(slots).toHaveLength(0);
  });

  it('partial holiday blocks only its window (M18)', () => {
    const slots = computeSlots({
      days: [MONDAY],
      availabilities: [avail()],
      busy: [],
      holidays: [{ date: '2026-06-01', unitId: null, startMin: 600, endMin: 1440 }],
      slotMinutes: 30,
    });
    expect(slots.map((s) => s.startMin)).toEqual([540, 570]);
  });

  it('holiday for a different unit does not block', () => {
    const slots = computeSlots({
      days: [MONDAY],
      availabilities: [avail({ unitId: 'unitA' })],
      busy: [],
      holidays: [{ date: '2026-06-01', unitId: 'unitB', startMin: null, endMin: null }],
      slotMinutes: 30,
    });
    expect(slots).toHaveLength(4);
  });
});

describe('computeSlots — filters', () => {
  it('filters by doctorId', () => {
    const slots = computeSlots({
      days: [MONDAY],
      availabilities: [avail({ doctorId: 'd1' }), avail({ doctorId: 'd2' })],
      busy: [],
      holidays: [],
      slotMinutes: 30,
      doctorId: 'd1',
    });
    expect(slots.every((s) => s.doctorId === 'd1')).toBe(true);
    expect(slots).toHaveLength(4);
  });

  it('filters by unitId (including null = default unit)', () => {
    const slots = computeSlots({
      days: [MONDAY],
      availabilities: [avail({ unitId: null }), avail({ unitId: 'unitA' })],
      busy: [],
      holidays: [],
      slotMinutes: 30,
      unitId: null,
    });
    expect(slots.every((s) => s.unitId === null)).toBe(true);
  });
});

describe('timezone helpers — the cross-midnight bug (R10)', () => {
  it('localDateMinutes maps a UTC instant to clinic-local date + minutes', () => {
    // 2026-06-01T12:00:00Z → 09:00 in São Paulo.
    expect(localDateMinutes(new Date('2026-06-01T12:00:00Z'), TZ)).toEqual({
      date: '2026-06-01',
      minutes: 540,
    });
  });

  it('a late-UTC instant rolls back to the previous local day', () => {
    // 2026-06-01T02:30:00Z → 2026-05-31 23:30 in São Paulo (the Sun-23:30 bug).
    expect(localDateMinutes(new Date('2026-06-01T02:30:00Z'), TZ)).toEqual({
      date: '2026-05-31',
      minutes: 1410,
    });
  });

  it('zonedWallToUtc converts a local wall time to the right UTC instant', () => {
    expect(zonedWallToUtc(2026, 6, 1, 9, 0, TZ).toISOString()).toBe('2026-06-01T12:00:00.000Z');
  });

  it('round-trips local → UTC → local', () => {
    const utc = zonedWallToUtc(2026, 6, 1, 14, 30, TZ);
    expect(localDateMinutes(utc, TZ)).toEqual({ date: '2026-06-01', minutes: 870 });
  });
});

describe('timezone helpers — calendar + parsing', () => {
  it('eachLocalDayInRange enumerates local days with correct weekdays', () => {
    const days = eachLocalDayInRange(
      new Date('2026-06-01T03:00:00Z'), // Mon 00:00 local
      new Date('2026-06-03T12:00:00Z'), // Wed 09:00 local
      TZ,
    );
    expect(days).toEqual([
      { date: '2026-06-01', weekday: 1 },
      { date: '2026-06-02', weekday: 2 },
      { date: '2026-06-03', weekday: 3 },
    ]);
  });

  it('weekdayOf matches Postgres dow (0=Sunday)', () => {
    expect(weekdayOf('2026-05-31')).toBe(0); // Sunday
    expect(weekdayOf('2026-06-01')).toBe(1); // Monday
    expect(weekdayOf('2026-06-06')).toBe(6); // Saturday
  });

  it('parseTimeToMinutes / minutesToTime round-trip', () => {
    expect(parseTimeToMinutes('09:30')).toBe(570);
    expect(parseTimeToMinutes('09:30:00')).toBe(570);
    expect(minutesToTime(570)).toBe('09:30:00');
  });
});
