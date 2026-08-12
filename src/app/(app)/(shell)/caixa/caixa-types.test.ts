import { describe, expect, it } from 'vitest';

import { actionErrorLogFields } from './caixa-types';

describe('actionErrorLogFields', () => {
  it('retém apenas identificadores técnicos seguros', () => {
    const error = Object.assign(new Error('dados clínicos nunca devem ir para log'), {
      name: 'PostgresError',
      code: '23503',
      constraint: 'payment_transactions_original_payment_id_fk',
      detail: 'Paciente de teste',
      query: 'insert into payment_transactions values (...)',
    });

    expect(actionErrorLogFields(error)).toEqual({
      errorName: 'PostgresError',
      errorCode: '23503',
      constraint: 'payment_transactions_original_payment_id_fk',
    });
  });

  it('descarta campos livres ou malformados', () => {
    const error = {
      name: 'Erro com texto livre',
      code: '23503; SELECT * FROM patients',
      constraint: 'constraint with spaces',
    };

    expect(actionErrorLogFields(error)).toEqual({
      errorName: 'UnknownError',
      errorCode: null,
      constraint: null,
    });
  });
});
