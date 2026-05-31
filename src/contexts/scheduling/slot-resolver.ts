/**
 * Slot resolver (C6) — PURE. No DB, no I/O. `getAvailableSlots` (queries.ts) is
 * the thin wrapper that fetches rows and converts timezone at the boundary.
 *
 * Timezone (R10/M7): `doctor_availability` is wall-clock local (weekday +
 * start_time/end_time); `appointments.scheduled_at` is a UTC instant. Mixing
 * them without the clinic tz produces wrong slots near midnight (Sun 23:30 UTC =
 * Mon 00:30 in America/Sao_Paulo). We convert with `Intl.DateTimeFormat`
 * (built into Node's ICU — no dependency, DST-correct), so `computeSlots`
 * receives only local-naive primitives and stays trivially testable.
 *
 * CONGELADO: 1 clínica = 1 timezone (clinics.timezone) até existir override por
 * unidade (ADR-014).
 */

// --- local-naive shapes consumed by the pure core --------------------------

export interface LocalDay {
  date: string; // YYYY-MM-DD (clinic-local calendar day)
  weekday: number; // 0=domingo .. 6=sábado (matches Postgres dow + our column)
}
export interface LocalAvailability {
  doctorId: string;
  unitId: string | null;
  weekday: number;
  startMin: number; // minutes from local midnight
  endMin: number;
}
export interface LocalBusy {
  doctorId: string;
  date: string;
  startMin: number;
  endMin: number;
}
export interface LocalHoliday {
  date: string;
  unitId: string | null;
  startMin: number | null; // null = dia inteiro
  endMin: number | null;
}
export interface LocalSlot {
  doctorId: string;
  unitId: string | null;
  date: string;
  startMin: number;
  endMin: number;
}

export interface ComputeSlotsParams {
  days: LocalDay[];
  availabilities: LocalAvailability[];
  busy: LocalBusy[];
  holidays: LocalHoliday[];
  slotMinutes: number;
  doctorId?: string | undefined;
  unitId?: string | null | undefined;
}

/** Two half-open intervals [a1,a2) and [b1,b2) overlap iff a1 < b2 && b1 < a2. */
function overlaps(a1: number, a2: number, b1: number, b2: number): boolean {
  return a1 < b2 && b1 < a2;
}

/**
 * Pure slot computation: availability windows minus busy appointments minus
 * holidays, sliced into discrete `slotMinutes` blocks. Deterministic; no tz.
 */
export function computeSlots(params: ComputeSlotsParams): LocalSlot[] {
  const { days, availabilities, busy, holidays, slotMinutes } = params;
  if (slotMinutes <= 0) return [];
  const out: LocalSlot[] = [];

  for (const day of days) {
    const dayHolidays = holidays.filter((h) => h.date === day.date);

    for (const av of availabilities) {
      if (av.weekday !== day.weekday) continue;
      if (params.doctorId !== undefined && av.doctorId !== params.doctorId) continue;
      if (params.unitId !== undefined && av.unitId !== params.unitId) continue;

      // Holidays that apply to this window's unit (NULL holiday = toda a clínica).
      const applicable = dayHolidays.filter((h) => h.unitId === null || h.unitId === av.unitId);
      const fullDay = applicable.some((h) => h.startMin === null);
      if (fullDay) continue;

      const blocked: Array<[number, number]> = [];
      for (const h of applicable) {
        if (h.startMin !== null && h.endMin !== null) blocked.push([h.startMin, h.endMin]);
      }
      for (const b of busy) {
        if (b.doctorId === av.doctorId && b.date === day.date) blocked.push([b.startMin, b.endMin]);
      }

      for (let s = av.startMin; s + slotMinutes <= av.endMin; s += slotMinutes) {
        const e = s + slotMinutes;
        const collides = blocked.some(([b1, b2]) => overlaps(s, e, b1, b2));
        if (!collides) {
          out.push({ doctorId: av.doctorId, unitId: av.unitId, date: day.date, startMin: s, endMin: e });
        }
      }
    }
  }
  return out;
}

// --- timezone helpers (Intl-based; DST-correct; no dependency) -------------

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Offset (ms) of `timeZone` at `instant`: localWallClock - UTC. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instant.getTime();
}

/**
 * Convert a wall-clock time in `timeZone` to the corresponding UTC instant.
 * Two-pass to settle DST boundaries (Brazil has no DST since 2019, but kept
 * general for correctness/longevity).
 */
export function zonedWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const off1 = tzOffsetMs(new Date(guess), timeZone);
  let utc = guess - off1;
  const off2 = tzOffsetMs(new Date(utc), timeZone);
  if (off2 !== off1) utc = guess - off2;
  return new Date(utc);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** UTC instant → { date: 'YYYY-MM-DD', minutes-from-midnight } in `timeZone`. */
export function localDateMinutes(instant: Date, timeZone: string): { date: string; minutes: number } {
  const p = zonedParts(instant, timeZone);
  return {
    date: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`,
    minutes: p.hour * 60 + p.minute,
  };
}

/** 'HH:MM' or 'HH:MM:SS' → minutes from midnight. */
export function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

/** minutes → 'HH:MM:SS'. */
export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${pad2(h)}:${pad2(m)}:00`;
}

/** Day-of-week (0=Sunday..6=Saturday) of a 'YYYY-MM-DD' calendar date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

/** Enumerate clinic-local calendar days in [fromUtc, toUtc] (inclusive endpoints). */
export function eachLocalDayInRange(fromUtc: Date, toUtc: Date, timeZone: string): LocalDay[] {
  const start = localDateMinutes(fromUtc, timeZone).date;
  const end = localDateMinutes(toUtc, timeZone).date;
  const days: LocalDay[] = [];
  const [sy, sm, sd] = start.split('-').map(Number);
  // step calendar dates in UTC-naive space (pure date arithmetic)
  const cursor = new Date(Date.UTC(sy!, sm! - 1, sd!));
  const endStamp = (() => {
    const [ey, em, ed] = end.split('-').map(Number);
    return Date.UTC(ey!, em! - 1, ed!);
  })();
  while (cursor.getTime() <= endStamp) {
    const date = `${cursor.getUTCFullYear()}-${pad2(cursor.getUTCMonth() + 1)}-${pad2(cursor.getUTCDate())}`;
    days.push({ date, weekday: cursor.getUTCDay() });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
