import { describe, expect, it } from 'vitest';

import {
  doctorAbsencePageHref,
  parseDoctorAbsencePage,
  parseDoctorAbsencePeriod,
} from './pagination';

describe('paginação de ausências', () => {
  it.each([
    [undefined, 1],
    ['', 1],
    ['0', 1],
    ['-2', 1],
    ['1.5', 1],
    ['NaN', 1],
    ['3', 3],
  ])('normaliza page=%s para %i', (value, expected) => {
    expect(parseDoctorAbsencePage(value)).toBe(expected);
  });

  it.each([
    [undefined, 'upcoming'],
    ['', 'upcoming'],
    ['invalid', 'upcoming'],
    ['past', 'past'],
    ['all', 'all'],
  ] as const)('normaliza periodo=%s para %s', (value, expected) => {
    expect(parseDoctorAbsencePeriod(value)).toBe(expected);
  });

  it('preserva profissional e período ao navegar', () => {
    expect(
      doctorAbsencePageHref(
        {
          doctorId: '00000000-0000-4000-8000-000000000001',
          period: 'past',
        },
        4,
      ),
    ).toBe(
      '/agenda/ausencias?profissional=00000000-0000-4000-8000-000000000001&periodo=past&page=4',
    );
  });

  it('omite defaults na URL canônica da primeira página', () => {
    expect(doctorAbsencePageHref({ period: 'upcoming' }, 1)).toBe('/agenda/ausencias');
  });
});
