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

describe('registrationFieldFromMessage', () => {
  it('aceita CPF válido mascarado e o normaliza sem depender do modelo', () => {
    expect(__testing__.registrationFieldFromMessage('cpf', '529.982.247-25')).toEqual({
      accepted: true,
      partial: { cpf: '52998224725' },
    });
  });

  it('mantém o pedido de CPF quando a mensagem não contém um CPF válido', () => {
    expect(__testing__.registrationFieldFromMessage('cpf', '123.456.789-00')).toMatchObject({
      accepted: false,
      patientMessage: 'O CPF informado é inválido. Envie novamente os 11 dígitos, com ou sem pontuação.',
    });
  });

  it('aceita nome completo, inclusive com apresentação natural', () => {
    expect(__testing__.registrationFieldFromMessage('nome', 'Meu nome é Jonas Duarte')).toEqual({
      accepted: true,
      partial: { nome: 'Jonas Duarte' },
    });
  });
});
