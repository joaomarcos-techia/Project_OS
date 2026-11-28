import { describe, expect, it } from 'vitest';

import { financeiroPageHref, parseFinanceiroPage } from './pagination';

describe('paginação do financeiro', () => {
  it.each([
    [undefined, 1],
    ['', 1],
    ['0', 1],
    ['-1', 1],
    ['1.5', 1],
    ['abc', 1],
    ['2', 2],
  ])('normaliza page=%s para %i', (value, expected) => {
    expect(parseFinanceiroPage(value)).toBe(expected);
  });

  it('preserva os filtros ao navegar e omite page na primeira página', () => {
    const filters = { tipo: 'receber', status: 'pendente' };

    expect(financeiroPageHref(filters, 2)).toBe('/financeiro?tipo=receber&status=pendente&page=2');
    expect(financeiroPageHref(filters, 1)).toBe('/financeiro?tipo=receber&status=pendente');
  });

  it('P10.6: a origem (paciente × operadora) é filtro e acompanha a navegação', () => {
    expect(financeiroPageHref({ tipo: 'receber', origem: 'operadora' }, 3)).toBe(
      '/financeiro?tipo=receber&origem=operadora&page=3',
    );
    expect(financeiroPageHref({ origem: 'paciente' }, 1)).toBe('/financeiro?origem=paciente');
  });

  it('não carrega parâmetros transitórios que não são filtros', () => {
    expect(financeiroPageHref({}, 1)).toBe('/financeiro');
  });
});
