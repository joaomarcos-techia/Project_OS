import { describe, expect, it } from 'vitest';

import { __testing__ } from './collect-patient-data';

describe('patientRegistrationMessage', () => {
  it('pede somente o próximo campo obrigatório', () => {
    expect(
      __testing__.patientRegistrationMessage({
        nextRequiredField: 'cpf',
        complete: false,
        confirmed: false,
      }),
    ).toBe('Agora, informe seu CPF, com ou sem pontuação.');
  });

  it('mantém o cadastro em coleta quando o CPF é inválido', () => {
    expect(
      __testing__.patientRegistrationMessage({
        nextRequiredField: 'cpf',
        complete: false,
        confirmed: false,
        invalidCpf: true,
      }),
    ).toBe('O CPF informado é inválido. Envie novamente os 11 dígitos, com ou sem pontuação.');
  });

  it('pede confirmação sem repetir dados pessoais', () => {
    expect(
      __testing__.patientRegistrationMessage({
        nextRequiredField: null,
        complete: true,
        confirmed: false,
      }),
    ).toBe(
      'Recebi os dados necessários. Responda SIM para confirmar o cadastro ou envie a correção.',
    );
  });
});
