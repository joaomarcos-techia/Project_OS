// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PatientForm } from './patient-form';

const ACTION_RENDER_TIMEOUT_MS = 5_000;

describe('PatientForm', () => {
  it('preserva o rascunho após a action devolver erro de validação', async () => {
    const action = vi.fn(async () => ({ error: 'CPF inválido' }));
    const { container } = render(<PatientForm mode="create" action={action} />);

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Paciente de teste' } });
    fireEvent.change(screen.getByPlaceholderText('000.000.000-00'), {
      target: { value: '52998224725' },
    });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'teste@example.test' } });
    fireEvent.change(screen.getByPlaceholderText('Rua das Flores, 50'), {
      target: { value: 'Rua de teste, 1' },
    });
    fireEvent.change(screen.getByPlaceholderText('São Paulo'), { target: { value: 'São Paulo' } });
    fireEvent.change(screen.getByPlaceholderText('SP'), { target: { value: 'SP' } });
    fireEvent.change(screen.getByPlaceholderText('01000-000'), { target: { value: '01001000' } });

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('CPF inválido'), {
      timeout: ACTION_RENDER_TIMEOUT_MS,
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Paciente de teste');
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('teste@example.test');
    expect((screen.getByPlaceholderText('Rua das Flores, 50') as HTMLInputElement).value).toBe(
      'Rua de teste, 1',
    );
    expect((screen.getByPlaceholderText('São Paulo') as HTMLInputElement).value).toBe('São Paulo');
    expect((screen.getByPlaceholderText('SP') as HTMLInputElement).value).toBe('SP');
    expect((screen.getByPlaceholderText('01000-000') as HTMLInputElement).value).toBe('01001000');
  });
});
