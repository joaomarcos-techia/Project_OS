import { describe, expect, it } from 'vitest';

import {
  groupByDay,
  monthMatrix,
  normalizeDateParam,
  rangeFor,
  shift,
  weekDays,
  ymdInTz,
} from './range';

const SP = 'America/Sao_Paulo'; // UTC-3 (sem DST desde 2019)

describe('rangeFor (fuso da clínica)', () => {
  it('dia = [00:00, 24:00) local em UTC', () => {
    const { from, to } = rangeFor('day', '2026-07-15', SP);
    expect(from.toISOString()).toBe('2026-07-15T03:00:00.000Z'); // 00:00 SP = 03:00Z
    expect(to.toISOString()).toBe('2026-07-16T03:00:00.000Z');
  });

  it('semana começa na segunda', () => {
    // 2026-07-15 é quarta; a semana vai de seg 13 a seg 20.
    const { from, to } = rangeFor('week', '2026-07-15', SP);
    expect(from.toISOString()).toBe('2026-07-13T03:00:00.000Z');
    expect(to.toISOString()).toBe('2026-07-20T03:00:00.000Z');
  });

  it('mês = 1º ao 1º do mês seguinte', () => {
    const { from, to } = rangeFor('month', '2026-07-15', SP);
    expect(from.toISOString()).toBe('2026-07-01T03:00:00.000Z');
    expect(to.toISOString()).toBe('2026-08-01T03:00:00.000Z');
  });

  it('vira o ano em dezembro', () => {
    const { to } = rangeFor('month', '2026-12-10', SP);
    expect(to.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });
});

describe('monthMatrix — segunda-start, 6×7', () => {
  it('julho/2026 começa numa quarta → 2 dias de junho antes', () => {
    const m = monthMatrix(2026, 7);
    expect(m).toHaveLength(6);
    expect(m[0]).toHaveLength(7);
    // 2026-07-01 é quarta; seg/ter anteriores = 29,30 de junho.
    expect(m[0]![0]).toBe('2026-06-29');
    expect(m[0]![2]).toBe('2026-07-01');
  });
});

describe('weekDays', () => {
  it('devolve seg→dom da semana de 2026-07-15', () => {
    expect(weekDays('2026-07-15')).toEqual([
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
      '2026-07-19',
    ]);
  });
});

describe('shift', () => {
  it('day ±1 dia', () => {
    expect(shift('day', '2026-07-15', 1)).toBe('2026-07-16');
    expect(shift('day', '2026-07-01', -1)).toBe('2026-06-30');
  });
  it('week ±7 dias', () => {
    expect(shift('week', '2026-07-15', 1)).toBe('2026-07-22');
  });
  it('month ±1 mês (vai pro dia 1)', () => {
    expect(shift('month', '2026-07-15', 1)).toBe('2026-08-01');
    expect(shift('month', '2026-01-10', -1)).toBe('2025-12-01');
  });
});

describe('normalizeDateParam', () => {
  it('aceita YMD e YYYY-MM (→ dia 1)', () => {
    expect(normalizeDateParam('2026-07-15', SP)).toBe('2026-07-15');
    expect(normalizeDateParam('2026-07', SP)).toBe('2026-07-01');
  });
  it('lixo → hoje', () => {
    expect(normalizeDateParam('xxx', SP)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('groupByDay + ymdInTz (fuso não vaza)', () => {
  it('23h em SP fica no dia local, não no dia UTC seguinte', () => {
    // 2026-07-15T23:30 SP = 2026-07-16T02:30Z — deve agrupar em 2026-07-15.
    expect(ymdInTz('2026-07-16T02:30:00.000Z', SP)).toBe('2026-07-15');
    const g = groupByDay([{ horario: '2026-07-16T02:30:00.000Z' }], SP);
    expect(g.get('2026-07-15')).toHaveLength(1);
    expect(g.get('2026-07-16')).toBeUndefined();
  });
});
