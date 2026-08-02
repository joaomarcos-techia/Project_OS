// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updateProfessionalCredentialAction, toastSuccess } = vi.hoisted(() => ({
  updateProfessionalCredentialAction: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('./actions', () => ({ updateProfessionalCredentialAction }));
vi.mock('@/components/ui/use-toast', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

import { ProfessionalCredentialForm } from './professional-credential-form';

beforeEach(() => {
  vi.clearAllMocks();
  updateProfessionalCredentialAction.mockResolvedValue({ ok: true });
});

describe('ProfessionalCredentialForm', () => {
  it('envia CRM, UF e especialidade para a action', async () => {
    render(
      <ProfessionalCredentialForm initial={{ crm: null, crmUf: null, especialidade: null }} />,
    );

    fireEvent.change(screen.getByLabelText('CRM'), { target: { value: '12345' } });
    fireEvent.change(screen.getByLabelText('UF'), { target: { value: 'sp' } });
    fireEvent.change(screen.getByLabelText('Especialidade'), { target: { value: 'Cardiologia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar credencial' }));

    await waitFor(() =>
      expect(updateProfessionalCredentialAction).toHaveBeenCalledWith({
        crm: '12345',
        crmUf: 'SP',
        especialidade: 'Cardiologia',
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith('Credencial profissional salva.');
  });
});
