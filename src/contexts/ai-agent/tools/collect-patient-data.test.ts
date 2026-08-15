import { describe, expect, it } from 'vitest';

import { __testing__ } from './collect-patient-data';

/**
 * F-15 (auditoria 2026-08-14) — teclados de iOS/Android substituem a apóstrofe
 * reta (') pela tipográfica (’) sem o usuário perceber. Aceitar só a reta
 * rejeitava nomes legítimos e, com a coleta sendo um estado modal, prendia a
 * pessoa repetindo o próprio nome.
 */
describe('nome com apóstrofe (F-15)', () => {
  const aceita = (nome: string) => __testing__.registrationFieldFromMessage('nome', nome);

  it.each([
    ['apóstrofe tipográfica do teclado móvel', 'Maria D’Ávila'],
    ['apóstrofe reta', "Maria D'Ávila"],
    ['tipográfica no meio de nome composto', 'Ana D’Angelo Souza'],
    ['nome africano com apóstrofe', 'Amadou N’Doye'],
  ])('aceita %s: %s', (_caso, nome) => {
    const r = aceita(nome);
    expect(r.accepted).toBe(true);
    expect(r.accepted && r.partial.nome).toBe(nome);
  });

  it('a apóstrofe não afrouxa o resto da validação', () => {
    expect(aceita('D’Ávila').accepted).toBe(false); // continua exigindo 2 palavras
    expect(aceita('Maria D’Ávila 2').accepted).toBe(false); // dígito segue proibido
    expect(aceita('quero marcar consulta').accepted).toBe(false);
  });
});

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
