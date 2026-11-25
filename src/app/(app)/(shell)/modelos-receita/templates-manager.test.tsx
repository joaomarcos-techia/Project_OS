// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  duplicate: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/contexts/clinical/actions-templates', () => ({
  deletePrescriptionTemplate: mocks.remove,
  updatePrescriptionTemplate: mocks.update,
}));
vi.mock('../_actions/create-limited', () => ({
  createTemplateWithTrialLimit: mocks.create,
  duplicateTemplateWithTrialLimit: mocks.duplicate,
}));
vi.mock('@/components/ui/use-toast', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import { TemplatesManager } from './templates-manager';

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

const modelo = {
  id: 't-1',
  clinicId: 'c-1',
  doctorId: 'd-1',
  nome: 'Amigdalite adulto',
  categoria: 'Antibióticos',
  kind: 'simples' as const,
  medicamentos: [{ nome: 'Amoxicilina 500mg' }],
  observacoes: null,
  createdAt: '2026-11-14T12:00:00.000Z',
  updatedAt: '2026-11-14T12:00:00.000Z',
};

// UX-019 (docs/otimização_ui_final.md)
describe('TemplatesManager', () => {
  it('cada campo do modelo tem rótulo persistente, não só placeholder', () => {
    render(<TemplatesManager initial={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Novo modelo' }));

    expect(screen.getByLabelText(/Nome do modelo/).getAttribute('aria-required')).toBe('true');
    expect(screen.getByLabelText('Categoria (opcional)')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Tipo de receita' })).toBeTruthy();
    expect(screen.getByLabelText(/Medicamento 1/)).toBeTruthy();
    expect(screen.getByLabelText('Dosagem 1')).toBeTruthy();
    expect(screen.getByLabelText('Posologia 1')).toBeTruthy();
    expect(screen.getByLabelText('Observações (opcional)')).toBeTruthy();
  });

  it('sem nome nem medicamento, o erro aparece no campo e nada é salvo', async () => {
    render(<TemplatesManager initial={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Novo modelo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(screen.getByText('Dê um nome ao modelo.')).toBeTruthy();
    expect(screen.getByText('Adicione ao menos um medicamento.')).toBeTruthy();
    expect(screen.getByLabelText(/Nome do modelo/).getAttribute('aria-invalid')).toBe('true');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement?.id).toBe('tpl-nome'));
  });

  it('salva o modelo com os campos preenchidos', async () => {
    mocks.create.mockResolvedValue({ ok: true, data: modelo });
    render(<TemplatesManager initial={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Novo modelo' }));
    fireEvent.change(screen.getByLabelText(/Nome do modelo/), {
      target: { value: 'Amigdalite adulto' },
    });
    fireEvent.change(screen.getByLabelText(/Medicamento 1/), {
      target: { value: 'Amoxicilina 500mg' },
    });
    fireEvent.change(screen.getByLabelText('Posologia 1'), {
      target: { value: '8/8h por 7 dias' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({
      nome: 'Amigdalite adulto',
      kind: 'simples',
      medicamentos: [{ nome: 'Amoxicilina 500mg', posologia: '8/8h por 7 dias' }],
    });
  });

  it('diferencia lista vazia de busca sem resultado e nomeia as ações por modelo', () => {
    const { unmount } = render(<TemplatesManager initial={[]} />);
    expect(screen.getByText(/Nenhum modelo ainda/)).toBeTruthy();
    unmount();

    render(<TemplatesManager initial={[modelo]} />);
    expect(screen.getByRole('button', { name: 'Editar: Amigdalite adulto' })).toBeTruthy();
    expect(screen.getByText('Receita simples · 1 medicamento')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Buscar modelo de receita'), {
      target: { value: 'nada disso' },
    });
    expect(screen.getByText('Nenhum modelo encontrado para essa busca.')).toBeTruthy();
  });
});
