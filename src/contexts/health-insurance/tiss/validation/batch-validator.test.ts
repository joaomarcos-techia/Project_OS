import { describe, expect, it } from 'vitest';

import { consultaBatch, consultaGuide, sadtBatch, sadtGuide } from '../corpus/fixtures';

import { validateLoteGuias } from './batch-validator';

const codes = (input: Parameters<typeof validateLoteGuias>[0]): string[] =>
  validateLoteGuias(input).map((i) => i.code);

describe('validateLoteGuias', () => {
  it('lote correto de Consulta e de SP/SADT não tem pendências', () => {
    expect(codes(consultaBatch([consultaGuide(1), consultaGuide(2)]))).toEqual([]);
    expect(codes(sadtBatch([sadtGuide(1)]))).toEqual([]);
  });

  it.each<[string, Parameters<typeof validateLoteGuias>[0], string]>([
    ['vazio', consultaBatch([]), 'BATCH_EMPTY'],
    [
      '101 guias',
      consultaBatch(Array.from({ length: 101 }, (_, i) => consultaGuide(i + 1))),
      'BATCH_TOO_LARGE',
    ],
    [
      'versão antiga',
      consultaBatch([consultaGuide(1)], { padrao: '4.02.00' as '4.03.00' }),
      'BATCH_VERSION',
    ],
    [
      'destino com 5 dígitos',
      consultaBatch([consultaGuide(1)], { registroANSDestino: '12345' }),
      'ANS_REGISTRY_FORMAT',
    ],
    [
      'sequencial com 13',
      consultaBatch([consultaGuide(1)], { sequencialTransacao: '1'.repeat(13) }),
      'TRANSACTION_SEQUENCE',
    ],
    ['lote sem número', consultaBatch([consultaGuide(1)], { numeroLote: '' }), 'BATCH_NUMBER'],
    [
      'data inexistente',
      consultaBatch([consultaGuide(1)], { dataRegistro: '2026-02-30' }),
      'TRANSACTION_DATE',
    ],
    [
      'hora inválida',
      consultaBatch([consultaGuide(1)], { horaRegistro: '24:00:00' }),
      'TRANSACTION_TIME',
    ],
    [
      'guia de outra operadora',
      consultaBatch([consultaGuide(1, { registroANS: '654321' })]),
      'GUIDE_OPERATOR_MISMATCH',
    ],
    [
      'guia repetida',
      consultaBatch([consultaGuide(7), consultaGuide(7)]),
      'GUIDE_NUMBER_DUPLICATED',
    ],
  ])('%s → %s', (_label, input, expected) => {
    expect(codes(input)).toContain(expected);
  });

  it('a pendência de lote é do financeiro e aponta as posições da repetição', () => {
    const [issue] = validateLoteGuias(
      consultaBatch([consultaGuide(7), consultaGuide(8), consultaGuide(7)]),
    );
    expect(issue).toMatchObject({ owner: 'financeiro', field: 'guias[2].numeroGuiaPrestador' });
    expect(issue!.message).toMatch(/posições 1 e 3/u);
  });
});
