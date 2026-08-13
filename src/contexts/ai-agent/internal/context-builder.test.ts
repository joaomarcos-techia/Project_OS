import { describe, expect, it } from 'vitest';

import { __testing__ } from './context-builder';

describe('patientRegistrationState', () => {
  it('não expõe coleta quando o telefone já identifica o paciente', () => {
    expect(__testing__.patientRegistrationState({ id: 'p1', nome: 'Maria' }, null)).toEqual({
      status: 'registered',
      missingFields: [],
      nextRequiredField: null,
    });
  });

  it('informa apenas os campos pendentes durante a coleta', () => {
    expect(
      __testing__.patientRegistrationState(null, { nome: 'Maria', telefone: '+5511999999999' }),
    ).toEqual({
      status: 'collecting',
      missingFields: ['cpf', 'motivo'],
      nextRequiredField: 'cpf',
    });
  });

  it('não inicia cadastro apenas porque o telefone ainda não identifica um paciente', () => {
    expect(__testing__.patientRegistrationState(null, null)).toEqual({
      status: 'not_started',
      missingFields: [],
      nextRequiredField: null,
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
      nextRequiredField: null,
    });
  });
});

describe('formatClinicDateTime', () => {
  it('ancora a data e hora no fuso da clínica', () => {
    expect(
      __testing__.formatClinicDateTime(
        new Date('2026-08-13T22:24:18.000Z'),
        'America/Sao_Paulo',
      ),
    ).toBe('13/08/2026 às 19:24');
  });
});
