import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  appointmentReplyFromToolResults,
  registrationReplyFromToolResults,
} from './inbound-received';

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

describe('appointmentReplyFromToolResults', () => {
  it('confirma a marcação preparada com o serviço retornado pelo servidor', () => {
    expect(
      appointmentReplyFromToolResults([
        {
          name: 'prepare_appointment',
          args: { procedure_name: 'Harmonização facial' },
          response: {
            status: 'appointment_prepared',
            summary: 'Agendar Harmonização facial para 14/08/2026 às 09:00',
          },
        },
      ]),
    ).toBe('Agendar Harmonização facial para 14/08/2026 às 09:00\nResponda SIM para confirmar.');
  });

  it('devolve orientação de disponibilidade sem encaminhar para humano', () => {
    expect(
      appointmentReplyFromToolResults([
        {
          name: 'prepare_appointment',
          args: {},
          response: {
            status: 'appointment_unavailable',
            patient_message: 'Esse horário não está disponível para esse atendimento.',
          },
        },
      ]),
    ).toBe('Esse horário não está disponível para esse atendimento.');
  });
});

describe('pergunta sobre a clínica no meio do cadastro (08/10/2026)', () => {
  // Antes: "qual o endereço de vocês?" virava o motivo da consulta; "quanto custa?" virava "CPF inválido".
  const source = readFileSync(new URL('./inbound-received.ts', import.meta.url), 'utf8');
  const turn = source.slice(
    source.indexOf('async function runRegistrationTurnServerSide'),
    source.indexOf('function registrationWasRequired'),
  );

  it('é detectada antes de interpretar a mensagem como o campo pendente', () => {
    const detect = turn.indexOf('detectInformationQuestion(args.text)');
    expect(detect).toBeGreaterThan(-1);
    expect(detect).toBeLessThan(turn.indexOf('registrationFieldFromMessage('));
  });

  it('não grava nada (merge vazio = turno sem progresso) e pede o mesmo campo', () => {
    expect(turn).toContain('mergeCollectedData(tx, args.clinicId, args.conversationId, {})');
    expect(turn).toContain('Respondo isso assim que terminarmos o cadastro.');
  });
});
