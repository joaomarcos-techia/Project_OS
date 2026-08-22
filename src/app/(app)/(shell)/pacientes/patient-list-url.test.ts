import { describe, expect, it } from 'vitest';

import { parsePatientListPage, patientListHref } from './patient-list-url';

describe('patient list URL state', () => {
  it('preserva busca, lixeira e drawer ao trocar de página', () => {
    const href = patientListHref(
      { q: 'Ana Souza', removidos: '1', novo: '1', page: '2' },
      { page: '3' },
    );
    const url = new URL(href, 'https://clinic.test');

    expect(url.pathname).toBe('/pacientes');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'Ana Souza',
      removidos: '1',
      novo: '1',
      page: '3',
    });
  });

  it('remove estado transitório e página ao mudar o filtro', () => {
    const href = patientListHref(
      { q: 'Ana', removidos: '1', novo: '1', page: '4' },
      { removidos: undefined, novo: undefined, page: undefined },
    );
    const url = new URL(href, 'https://clinic.test');

    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'Ana' });
  });

  it.each([undefined, '', '0', '-1', '1.5', 'NaN', 'Infinity'])(
    'normaliza página inválida %s para a primeira',
    (value) => {
      expect(parsePatientListPage(value)).toBe(1);
    },
  );

  it('aceita página inteira positiva', () => {
    expect(parsePatientListPage('17')).toBe(17);
  });
});
