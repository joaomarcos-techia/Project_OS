import { describe, expect, it } from 'vitest';

import { __testing__ } from './context-builder';

describe('patientRegistrationState', () => {
  it('não expõe coleta quando o telefone já identifica o paciente', () => {
    expect(__testing__.patientRegistrationState({ id: 'p1', nome: 'Maria' }, null)).toEqual({
      status: 'registered',
      missingFields: [],
    });
  });

  it('informa apenas os campos pendentes durante a coleta', () => {
    expect(
      __testing__.patientRegistrationState(null, { nome: 'Maria', telefone: '+5511999999999' }),
    ).toEqual({
      status: 'collecting',
      missingFields: ['cpf', 'motivo'],
    });
  });

  it('exige confirmação depois de receber todos os dados', () => {
    expect(
      __testing__.patientRegistrationState(null, {
        nome: 'Maria',
        cpf: '52998224725',
        telefone: '+5511999999999',
        motivo: 'consulta',
      }),
    ).toEqual({
      status: 'awaiting_confirmation',
      missingFields: [],
    });
  });
});
