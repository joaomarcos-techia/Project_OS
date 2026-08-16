// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/contexts/scheduling/config-actions', () => ({
  createHoliday: vi.fn(),
  removeDoctorAvailability: vi.fn(),
  removeHoliday: vi.fn(),
  setDoctorAvailability: vi.fn(),
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { HorariosManager } from './horarios-manager';

// O projeto não usa `globals: true`, então o auto-cleanup do Testing Library
// não roda: sem isto o DOM acumula entre os casos e o segundo render vê dois
// blocos de feriado.
afterEach(cleanup);

describe('HorariosManager', () => {
  it('associa os rótulos de disponibilidade aos controles nativos', () => {
    render(
      <HorariosManager
        doctors={[{ id: 'doctor-1', nome: 'Dra. Teste' }]}
        availability={[]}
        holidays={[]}
        canManageHolidays
      />,
    );

    expect(screen.getByLabelText('Dia').getAttribute('id')).toBe('availability-weekday');
    expect(screen.getByLabelText('Manhã — início').getAttribute('id')).toBe('availability-start');
    expect(screen.getByLabelText('Manhã — fim').getAttribute('id')).toBe('availability-end');
    expect(screen.getByLabelText('Tarde — início').getAttribute('id')).toBe(
      'availability-afternoon-start',
    );
    expect(screen.getByLabelText('Tarde — fim').getAttribute('id')).toBe(
      'availability-afternoon-end',
    );
  });

  it('AUTHZ-007: sem gestão de equipe, o bloco de feriados não é renderizado', () => {
    // Feriado vale para a clínica inteira. Um médico que só administra a
    // própria agenda não pode criá-lo — e a tela não deve oferecer.
    render(
      <HorariosManager
        doctors={[{ id: 'doctor-1', nome: 'Dra. Teste' }]}
        availability={[]}
        holidays={[]}
        canManageHolidays={false}
      />,
    );

    expect(screen.queryByRole('heading', { name: 'Feriados (dia inteiro)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Adicionar feriado' })).toBeNull();
  });

  it('com gestão de equipe, o bloco de feriados aparece', () => {
    render(
      <HorariosManager
        doctors={[{ id: 'doctor-1', nome: 'Dra. Teste' }]}
        availability={[]}
        holidays={[]}
        canManageHolidays
      />,
    );

    expect(screen.getByRole('heading', { name: 'Feriados (dia inteiro)' })).not.toBeNull();
  });
});
