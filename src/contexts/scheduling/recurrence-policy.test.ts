import { describe, expect, it } from 'vitest';

import { buildWeeklyOccurrences } from './recurrence-policy';

const actions = readFileSync(resolve(process.cwd(), 'src/contexts/scheduling/actions.ts'), 'utf8');
const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0063_waitlist_recurrence.sql'),
  'utf8',
);
const drawer = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/agenda/new-appointment-drawer.tsx'),
  'utf8',
);

describe('weekly recurrence', () => {
  it('builds deterministic weekly instants and keeps the first occurrence', () => {
    expect(
      buildWeeklyOccurrences({
        firstScheduledAt: '2026-07-30T13:00:00.000Z',
        intervalWeeks: 2,
        occurrences: 4,
      }).map((date) => date.toISOString()),
    ).toEqual([
      '2026-07-30T13:00:00.000Z',
      '2026-08-13T13:00:00.000Z',
      '2026-08-27T13:00:00.000Z',
      '2026-09-10T13:00:00.000Z',
    ]);
  });

  it('rejects invalid recurrence values', () => {
    expect(() =>
      buildWeeklyOccurrences({
        firstScheduledAt: 'invalid',
        intervalWeeks: 1,
        occurrences: 4,
      }),
    ).toThrow();
    expect(() =>
      buildWeeklyOccurrences({
        firstScheduledAt: '2026-07-30T13:00:00.000Z',
        intervalWeeks: 0,
        occurrences: 4,
      }),
    ).toThrow();
    expect(() =>
      buildWeeklyOccurrences({
        firstScheduledAt: '2026-07-30T13:00:00.000Z',
        intervalWeeks: 1,
        occurrences: 1,
      }),
    ).toThrow();
  });

  it('creates every occurrence atomically and supports cancelling future occurrences', () => {
    expect(actions).toContain('insertScheduledAppointment(tx');
    expect(actions).toContain('cancelRecurringSeries');
    expect(actions).toContain("target: 'cancelado'");
    expect(migration).toContain('appointments_recurrence_occurrence_uniq');
    expect(migration).toContain('appointment recurrence mismatch');
    expect(drawer).toContain('Repetir semanalmente');
    expect(drawer).toContain('recurrence: { intervalWeeks: interval, occurrences: count }');
  });
});
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('DATA-008 — recorrência no calendário local, não em 168 h fixas', () => {
  const iso = (input: Parameters<typeof buildWeeklyOccurrences>[0]) =>
    buildWeeklyOccurrences(input).map((d) => d.toISOString());

  /** Hora de parede de um instante, num fuso. */
  const wall = (instant: string, timeZone: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(instant));

  it('spring forward: 09:00 continua 09:00 em Nova York ao atravessar o DST', () => {
    // Caso exato do relatório: a implementação antiga devolvia 09:00, 10:00,
    // 10:00 — a série inteira derivava uma hora depois da virada de 14/03.
    const out = iso({
      firstScheduledAt: '2027-03-07T14:00:00.000Z', // 09:00 EST
      intervalWeeks: 1,
      occurrences: 3,
      timeZone: 'America/New_York',
    });
    expect(out.map((i) => wall(i, 'America/New_York'))).toEqual(['09:00', '09:00', '09:00']);
    // E o INSTANTE muda de offset, que é o ponto: 14:00Z → 13:00Z.
    expect(out[0]).toBe('2027-03-07T14:00:00.000Z');
    expect(out[1]).toBe('2027-03-14T13:00:00.000Z');
  });

  it('fall back: 09:00 continua 09:00 ao voltar do DST', () => {
    const out = iso({
      firstScheduledAt: '2027-10-31T13:00:00.000Z', // 09:00 EDT
      intervalWeeks: 1,
      occurrences: 3,
      timeZone: 'America/New_York',
    });
    expect(out.map((i) => wall(i, 'America/New_York'))).toEqual(['09:00', '09:00', '09:00']);
    expect(out[1]).toBe('2027-11-07T14:00:00.000Z'); // volta a EST
  });

  it('São Paulo (sem DST desde 2019) permanece exatamente como antes', () => {
    const out = iso({
      firstScheduledAt: '2026-07-30T13:00:00.000Z',
      intervalWeeks: 2,
      occurrences: 4,
      timeZone: 'America/Sao_Paulo',
    });
    expect(out).toEqual([
      '2026-07-30T13:00:00.000Z',
      '2026-08-13T13:00:00.000Z',
      '2026-08-27T13:00:00.000Z',
      '2026-09-10T13:00:00.000Z',
    ]);
  });

  it('a primeira ocorrência é SEMPRE o instante escolhido, sem reinterpretação', () => {
    for (const timeZone of ['UTC', 'America/Sao_Paulo', 'America/New_York', 'Asia/Kolkata']) {
      const [first] = iso({
        firstScheduledAt: '2027-03-07T14:00:00.000Z',
        intervalWeeks: 1,
        occurrences: 2,
        timeZone,
      });
      expect(first).toBe('2027-03-07T14:00:00.000Z');
    }
  });

  it('horário que NÃO EXISTE no salto: resolve depois da virada, sem derivar a série', () => {
    // 02:30 de 14/03/2027 não existe em Nova York. A série começa uma semana
    // antes, quando 02:30 ainda existe.
    const out = iso({
      firstScheduledAt: '2027-03-07T07:30:00.000Z', // 02:30 EST
      intervalWeeks: 1,
      occurrences: 3,
      timeZone: 'America/New_York',
    });
    expect(out).toHaveLength(3);
    // Ordem estritamente crescente — nenhuma ocorrência regride nem colide.
    expect(new Date(out[1]!).getTime()).toBeGreaterThan(new Date(out[0]!).getTime());
    expect(new Date(out[2]!).getTime()).toBeGreaterThan(new Date(out[1]!).getTime());
    // A semana seguinte à virada volta ao horário de parede pedido.
    expect(wall(out[2]!, 'America/New_York')).toBe('02:30');
  });

  it('ordem crescente e sem duplicatas também na virada de outono (hora ambígua)', () => {
    const out = iso({
      firstScheduledAt: '2027-10-31T05:30:00.000Z', // 01:30 — ocorre duas vezes
      intervalWeeks: 1,
      occurrences: 3,
      timeZone: 'America/New_York',
    });
    expect(new Set(out).size).toBe(3);
    expect(new Date(out[1]!).getTime()).toBeGreaterThan(new Date(out[0]!).getTime());
  });

  it('sem timeZone o comportamento é UTC — nenhum caller antigo muda', () => {
    expect(
      iso({
        firstScheduledAt: '2027-03-07T14:00:00.000Z',
        intervalWeeks: 1,
        occurrences: 3,
      }),
    ).toEqual(['2027-03-07T14:00:00.000Z', '2027-03-14T14:00:00.000Z', '2027-03-21T14:00:00.000Z']);
  });
});
