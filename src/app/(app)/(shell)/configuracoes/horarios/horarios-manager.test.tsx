// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/contexts/scheduling/config-actions', () => ({
  createHoliday: vi.fn(),
  removeDoctorAvailability: vi.fn(),
  removeHoliday: vi.fn(),
  setDoctorAvailabilityWindows: vi.fn(),
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { setDoctorAvailabilityWindows } from '@/contexts/scheduling/config-actions';

import { HorariosManager } from './horarios-manager';

// O projeto não usa `globals: true`, então o auto-cleanup do Testing Library
// não roda: sem isto o DOM acumula entre os casos e o segundo render vê dois
// blocos de feriado.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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

  it('A11Y-001: Data e Motivo do feriado têm nome acessível', () => {
    // A árvore acessível expunha dois textboxes SEM nome e `getByLabel()`
    // encontrava zero — os quatro inputs de disponibilidade logo acima já
    // usavam id/htmlFor corretamente, o que isolava o defeito nestes dois.
    render(
      <HorariosManager
        doctors={[{ id: 'doctor-1', nome: 'Dra. Teste' }]}
        availability={[]}
        holidays={[]}
        canManageHolidays
      />,
    );

    expect(screen.getByLabelText('Data').getAttribute('id')).toBe('holiday-date');
    expect(screen.getByLabelText('Motivo (opcional)').getAttribute('id')).toBe('holiday-reason');
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

// ---------------------------------------------------------------------------
// DATA-006 — o expediente com pausa é UMA operação.
// ---------------------------------------------------------------------------

describe('HorariosManager — atomicidade do expediente (DATA-006)', () => {
  function renderManager() {
    render(
      <HorariosManager
        doctors={[{ id: 'doctor-1', nome: 'Dra. Teste' }]}
        availability={[]}
        holidays={[]}
        canManageHolidays
      />,
    );
  }

  it('manhã + tarde vão numa ÚNICA chamada, não em duas', async () => {
    // O achado: duas Server Actions independentes deixavam a manhã persistida
    // quando a tarde conflitava, e o operador via só a mensagem de erro.
    vi.mocked(setDoctorAvailabilityWindows).mockResolvedValue({
      ok: true,
      data: { ids: ['a', 'b'] },
    } as never);
    renderManager();

    fireEvent.change(screen.getByLabelText('Manhã — início'), { target: { value: '08:00' } });
    fireEvent.change(screen.getByLabelText('Manhã — fim'), { target: { value: '12:00' } });
    // `comPausa` já vem marcado: os campos da tarde estão visíveis.
    fireEvent.change(screen.getByLabelText('Tarde — início'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('Tarde — fim'), { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('button', { name: /adicionar expediente/i }));

    await waitFor(() => expect(setDoctorAvailabilityWindows).toHaveBeenCalledTimes(1));
    const [payload] = vi.mocked(setDoctorAvailabilityWindows).mock.calls[0]!;
    expect(payload).toMatchObject({
      doctorId: 'doctor-1',
      windows: [
        { startTime: '08:00', endTime: '12:00' },
        { startTime: '14:00', endTime: '18:00' },
      ],
    });
  });

  it('sem pausa envia uma janela só, pela mesma action', async () => {
    vi.mocked(setDoctorAvailabilityWindows).mockResolvedValue({
      ok: true,
      data: { ids: ['a'] },
    } as never);
    renderManager();

    // Desmarca a pausa: o expediente vira uma janela única, pela MESMA action.
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Início'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('Fim'), { target: { value: '17:00' } });
    fireEvent.click(screen.getByRole('button', { name: /adicionar janela/i }));

    await waitFor(() => expect(setDoctorAvailabilityWindows).toHaveBeenCalledTimes(1));
    const [payload] = vi.mocked(setDoctorAvailabilityWindows).mock.calls[0]!;
    expect(payload).toMatchObject({ windows: [{ startTime: '09:00', endTime: '17:00' }] });
  });
});
