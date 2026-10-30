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

afterEach(cleanup);

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
