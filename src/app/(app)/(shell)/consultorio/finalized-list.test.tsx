// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { BoardCardDTO } from './board-types';
import { FinalizedList } from './finalized-list';

afterEach(cleanup);

const card: BoardCardDTO = {
  appointmentId: 'appointment-1',
  patientId: 'patient-1',
  pacienteNome: 'Paciente de teste',
  alergias: [],
  idade: null,
  sexo: null,
  horario: '2026-10-13T12:00:00.000Z',
  motivo: 'Consulta sintética',
  status: 'atendido',
  urgencia: false,
  checkInAt: null,
};

describe('lista de consultas finalizadas', () => {
  it('não chama a consulta de faturada sem prova de lançamento financeiro', () => {
    render(
      <FinalizedList
        timeZone="America/Sao_Paulo"
        cards={[card]}
        selectedId={null}
        onOpen={() => {}}
      />,
    );

    expect(screen.getByText('Concluída')).toBeTruthy();
    expect(screen.queryByText('Faturada')).toBeNull();
  });

  it('destaca uma pendência financeira registrada', () => {
    render(
      <FinalizedList
        timeZone="America/Sao_Paulo"
        cards={[{ ...card, cobrancaPendente: true }]}
        selectedId={null}
        onOpen={() => {}}
      />,
    );

    expect(screen.getByText('Sem cobrança')).toBeTruthy();
  });
});
