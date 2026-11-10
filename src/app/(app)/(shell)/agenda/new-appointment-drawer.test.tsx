// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ buscarPacientes: vi.fn(), criarAtendimento: vi.fn() }));

import { NewAppointmentDrawer } from './new-appointment-drawer';
import type { AgendaData } from './data';

const baseData: AgendaData = {
  hasAccess: true,
  hasClinic: true,
  isPractitioner: false,
  selfDoctorId: null,
  canEditAgenda: true,
  canManageAvailability: false,
  appointments: [],
  recurrenceSeries: [],
  procedures: [
    { id: '11111111-1111-4111-8111-111111111111', descricao: 'Consulta', valorPadrao: 150 },
  ],
  doctors: [{ id: '22222222-2222-4222-8222-222222222222', nome: 'Médico Teste' }],
  resources: [],
  deliveryFailures: [],
  deliveryFailuresLimited: false,
  tz: 'America/Sao_Paulo',
  view: 'day',
  ymd: '2026-10-03',
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('data padrão no fuso da clínica', () => {
  it.each([
    ['antes das 21h em Brasília', '2026-08-16T23:30:00.000Z', 'America/Sao_Paulo', '2026-08-16'],
    [
      'às 21h em Brasília (UTC já é dia 17)',
      '2026-08-17T00:00:00.000Z',
      'America/Sao_Paulo',
      '2026-08-16',
    ],
    [
      'depois das 21h, virando o ano',
      '2027-01-01T01:00:00.000Z',
      'America/Sao_Paulo',
      '2026-12-31',
    ],
    ['clínica em UTC no mesmo instante', '2026-08-17T00:00:00.000Z', 'UTC', '2026-08-17'],
  ])('%s', (_case, now, tz, expected) => {
    vi.useFakeTimers({ now: new Date(now), toFake: ['Date'] });
    render(<NewAppointmentDrawer data={{ ...baseData, tz }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Novo atendimento' }));
    const date = screen.getByLabelText('Data') as HTMLInputElement;
    expect(date.value).toBe(expected);
    expect(date.min).toBe(expected);
  });
});

describe('recorrência com preço único', () => {
  it('permite selecionar uma série sem exigir forma de pagamento', () => {
    render(<NewAppointmentDrawer data={baseData} />);
    fireEvent.click(screen.getByRole('button', { name: 'Novo atendimento' }));

    expect(
      screen.getByRole('checkbox', { name: 'Repetir semanalmente' }).hasAttribute('disabled'),
    ).toBe(false);
    expect(screen.queryByText('Forma de pagamento e preço')).toBeNull();
  });
});
