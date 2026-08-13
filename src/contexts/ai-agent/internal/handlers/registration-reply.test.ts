import { describe, expect, it } from 'vitest';

import { registrationReplyFromToolResults } from './inbound-received';

describe('registrationReplyFromToolResults', () => {
  it('usa a mensagem autoritativa após coletar um dado', () => {
    expect(
      registrationReplyFromToolResults([
        {
          name: 'collect_patient_data',
          args: { nome: 'Maria Silva' },
          response: {
            accepted: true,
            missing: ['cpf', 'motivo'],
            complete: false,
            confirmed: false,
            next_required_field: 'cpf',
            patient_message: 'Agora, informe seu CPF, com ou sem pontuação.',
          },
        },
      ]),
    ).toBe('Agora, informe seu CPF, com ou sem pontuação.');
  });

  it('inicia o cadastro quando a agenda exigir paciente identificado', () => {
    expect(
      registrationReplyFromToolResults([
        {
          name: 'prepare_appointment',
          args: {},
          response: {
            status: 'patient_registration_required',
            required_fields: ['nome', 'cpf', 'motivo'],
          },
        },
      ]),
    ).toBe('Para iniciar seu cadastro, informe seu nome completo.');
  });
});
