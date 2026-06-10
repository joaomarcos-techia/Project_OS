import { describe, expect, it } from 'vitest';

import { formatWait, waitMinutes, waitTone } from './priority';

const NOW = Date.parse('2026-06-02T12:00:00.000Z');

describe('waitMinutes', () => {
  it('null check-in → null', () => {
    expect(waitMinutes(null, NOW)).toBeNull();
  });
  it('computa minutos desde o check-in', () => {
    expect(waitMinutes('2026-06-02T11:50:00.000Z', NOW)).toBe(10);
  });
  it('nunca negativo (check-in no futuro → 0)', () => {
    expect(waitMinutes('2026-06-02T12:05:00.000Z', NOW)).toBe(0);
  });
  it('data inválida → null', () => {
    expect(waitMinutes('not-a-date', NOW)).toBeNull();
  });
});

describe('waitTone', () => {
  it('null → normal', () => expect(waitTone(null)).toBe('normal'));
  it('0–14 → normal', () => {
    expect(waitTone(0)).toBe('normal');
    expect(waitTone(14)).toBe('normal');
  });
  it('15–29 → attention', () => {
    expect(waitTone(15)).toBe('attention');
    expect(waitTone(29)).toBe('attention');
  });
  it('30+ → critical', () => {
    expect(waitTone(30)).toBe('critical');
    expect(waitTone(120)).toBe('critical');
  });
});

describe('formatWait', () => {
  it('minutos < 60', () => expect(formatWait(8)).toBe('8 min'));
  it('horas exatas', () => expect(formatWait(120)).toBe('2h'));
  it('horas e minutos', () => expect(formatWait(72)).toBe('1h12'));
  it('null → travessão', () => expect(formatWait(null)).toBe('—'));
});
