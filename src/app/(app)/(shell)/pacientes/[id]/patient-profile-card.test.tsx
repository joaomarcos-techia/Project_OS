// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../actions', () => ({
  updatePatientForm: vi.fn(async () => ({ error: null })),
}));

import { PatientProfileCard, type PatientProfileView } from './patient-profile-card';

const patient: PatientProfileView = {
  id: 'patient-1',
  nome: 'Ana Silva',
  cpf: '123.456.789-00',
  telefone: '(11) 99999-9999',
  email: 'ana@example.com',
  dataNascimento: '1990-01-02',
  sexo: 'F',
  updatedAt: '2026-08-20T10:00:00.000Z',
  obitoEm: null,
};

const address = {
  logradouro: 'Rua das Flores, 50',
  complemento: 'Sala 2',
  cidade: 'São Paulo',
  estado: 'SP',
  cep: '01000-000',
};

afterEach(cleanup);

describe('PatientProfileCard', () => {
  it('mantém view mode como padrão e não oferece edição sem permissão', () => {
    render(<PatientProfileCard patient={patient} address={address} canEdit={false} />);

    expect(screen.getByRole('heading', { name: 'Resumo do paciente' })).not.toBeNull();
    expect(
      screen.getByText('Rua das Flores, 50, Sala 2 · São Paulo/SP · CEP 01000-000'),
    ).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar dados' })).toBeNull();
    expect(screen.queryByLabelText('Nome')).toBeNull();
  });

  it('abre e fecha a edição inline sem modal quando autorizada', () => {
    render(<PatientProfileCard patient={patient} address={address} canEdit />);

    const edit = screen.getByRole('button', { name: 'Editar dados' });
    expect(edit.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(edit);

    expect(screen.getByRole('heading', { name: 'Editar dados cadastrais' })).not.toBeNull();
    expect(screen.getByLabelText('Nome').getAttribute('value')).toBe('Ana Silva');
    expect(screen.getByLabelText('CPF (em branco = manter)').getAttribute('value')).toBe('');
    expect(
      screen.getByRole('button', { name: 'Cancelar edição' }).getAttribute('aria-expanded'),
    ).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar edição' }));
    expect(screen.queryByLabelText('Nome')).toBeNull();
  });

  it('transforma os canais existentes em ações diretas de contato', () => {
    render(<PatientProfileCard patient={patient} address={address} canEdit={false} />);

    expect(screen.getByRole('link', { name: patient.telefone! }).getAttribute('href')).toBe(
      'tel:11999999999',
    );
    expect(screen.getByRole('link', { name: patient.email! }).getAttribute('href')).toBe(
      'mailto:ana@example.com',
    );
  });
});
