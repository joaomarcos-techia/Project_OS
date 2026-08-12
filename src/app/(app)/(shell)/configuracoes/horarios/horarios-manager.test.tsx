// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/contexts/scheduling/config-actions', () => ({
  createHoliday: vi.fn(),
  removeDoctorAvailability: vi.fn(),
  removeHoliday: vi.fn(),
  setDoctorAvailability: vi.fn(),
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { HorariosManager } from './horarios-manager';

describe('HorariosManager', () => {
  it('associa os rótulos de disponibilidade aos controles nativos', () => {
    render(
      <HorariosManager
        doctors={[{ id: 'doctor-1', nome: 'Dra. Teste' }]}
        availability={[]}
        holidays={[]}
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
});
