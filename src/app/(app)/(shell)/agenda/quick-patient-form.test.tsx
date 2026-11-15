// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ criarPacienteRapido: vi.fn() }));
vi.mock('./quick-patient-actions', () => ({ criarPacienteRapido: mocks.criarPacienteRapido }));

import { QuickPatientForm } from './quick-patient-form';

// Corpo em bloco: um `beforeEach` que DEVOLVE uma função vira rotina de limpeza no
// Vitest — devolver o mock fazia o Vitest chamá-lo depois do teste.
beforeEach(() => {
  mocks.criarPacienteRapido.mockReset();
});
afterEach(cleanup);

function renderForm() {
  const onCreated = vi.fn();
  const onCancel = vi.fn();
  render(<QuickPatientForm onCreated={onCreated} onCancel={onCancel} />);
  return { onCreated, onCancel };
}

// UX-006 (docs/otimização_ui_final.md)
describe('QuickPatientForm', () => {
  it('mostra os campos essenciais com rótulo e marca os obrigatórios', () => {
    renderForm();

    expect(screen.getByRole('group', { name: 'Novo paciente' })).toBeTruthy();
    expect(screen.getByLabelText(/Nome/).getAttribute('aria-required')).toBe('true');
    expect(screen.getByLabelText(/CPF/).getAttribute('aria-required')).toBe('true');
    expect(screen.getByLabelText('Telefone (opcional)')).toBeTruthy();
  });

  it('ao abrir, leva o foco para o campo Nome', () => {
    renderForm();

    expect(document.activeElement).toBe(screen.getByLabelText(/Nome/));
  });

  it('sem nome e CPF, mostra os erros e não chama o servidor', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar e selecionar' }));

    expect(screen.getByText('Informe o nome do paciente.')).toBeTruthy();
    expect(screen.getByText('Informe o CPF com 11 dígitos.')).toBeTruthy();
    expect(mocks.criarPacienteRapido).not.toHaveBeenCalled();
  });

  it('cadastra e devolve o paciente para o agendamento', async () => {
    mocks.criarPacienteRapido.mockResolvedValue({ ok: true, id: 'p-1', nome: 'Ana Souza' });
    const { onCreated } = renderForm();

    fireEvent.change(screen.getByLabelText(/Nome/), { target: { value: 'Ana Souza' } });
    fireEvent.change(screen.getByLabelText(/CPF/), { target: { value: '529.982.247-25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar e selecionar' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'p-1', label: 'Ana Souza' }));
    const chamada = mocks.criarPacienteRapido.mock.calls[0]?.[0];
    expect(chamada).toMatchObject({ nome: 'Ana Souza', cpf: '529.982.247-25' });
    expect(typeof chamada.idempotencyKey).toBe('string');
  });

  it('Enter num campo salva o paciente em vez de enviar o agendamento', async () => {
    mocks.criarPacienteRapido.mockResolvedValue({ ok: true, id: 'p-1', nome: 'Ana' });
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    render(
      <form onSubmit={(e) => onSubmit(e.nativeEvent)}>
        <QuickPatientForm onCreated={() => undefined} onCancel={() => undefined} />
      </form>,
    );

    fireEvent.change(screen.getByLabelText(/Nome/), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText(/CPF/), { target: { value: '52998224725' } });
    fireEvent.keyDown(screen.getByLabelText(/CPF/), { key: 'Enter' });

    await waitFor(() => expect(mocks.criarPacienteRapido).toHaveBeenCalledTimes(1));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('CPF já cadastrado aparece no campo CPF', async () => {
    mocks.criarPacienteRapido.mockResolvedValue({
      ok: false,
      fieldErrors: { cpf: 'Já existe um paciente com este CPF nesta clínica.' },
      message: null,
    });
    const { onCreated } = renderForm();

    fireEvent.change(screen.getByLabelText(/Nome/), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText(/CPF/), { target: { value: '52998224725' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar e selecionar' }));

    await waitFor(() =>
      expect(screen.getByText('Já existe um paciente com este CPF nesta clínica.')).toBeTruthy(),
    );
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('falha de conexão explica que tentar de novo não duplica', async () => {
    mocks.criarPacienteRapido.mockRejectedValue(new Error('Failed to fetch'));
    renderForm();

    fireEvent.change(screen.getByLabelText(/Nome/), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText(/CPF/), { target: { value: '52998224725' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar e selecionar' }));

    expect(await screen.findByText(/o mesmo paciente será usado/)).toBeTruthy();
  });

  it('Cancelar devolve o controle ao agendamento', () => {
    const { onCancel } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
