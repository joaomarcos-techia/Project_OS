// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ buscarPacientes: vi.fn(), criarAtendimento: vi.fn() }));

import { NewAppointmentDrawer, validarNovoAtendimento } from './new-appointment-drawer';
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

// UX-005 (docs/otimização_ui_final.md): todos os erros de uma vez, cada um no seu campo.
describe('erros por campo no novo atendimento', () => {
  it('envio vazio mostra todos os erros de uma vez e liga cada um ao seu campo', async () => {
    render(<NewAppointmentDrawer data={baseData} />);
    fireEvent.click(screen.getByRole('button', { name: 'Novo atendimento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agendar' }));

    expect(screen.getByText('Selecione o paciente.')).toBeTruthy();
    expect(screen.getByText('Selecione o procedimento.')).toBeTruthy();
    expect(screen.getByText('Selecione o profissional.')).toBeTruthy();

    const procedimento = screen.getByLabelText('Procedimento');
    expect(procedimento.getAttribute('aria-invalid')).toBe('true');
    expect(procedimento.getAttribute('aria-describedby')).toBe('appointment-procedure-error');

    const paciente = screen.getByRole('combobox', { name: 'Paciente' });
    expect(paciente.getAttribute('aria-describedby')).toBe('appointment-patient-error');
    expect(paciente.getAttribute('aria-invalid')).toBe('true');

    await waitFor(() => expect(document.activeElement?.id).toBe('appointment-patient'));
  });

  it('corrigir um campo apaga só o erro dele', () => {
    render(<NewAppointmentDrawer data={baseData} />);
    fireEvent.click(screen.getByRole('button', { name: 'Novo atendimento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agendar' }));

    fireEvent.change(screen.getByLabelText('Procedimento'), {
      target: { value: '11111111-1111-4111-8111-111111111111' },
    });

    expect(screen.queryByText('Selecione o procedimento.')).toBeNull();
    expect(screen.getByText('Selecione o paciente.')).toBeTruthy();
    expect(screen.getByText('Selecione o profissional.')).toBeTruthy();
  });
});

describe('validarNovoAtendimento', () => {
  const valido = {
    modo: 'agendar' as const,
    temPaciente: true,
    procedureId: 'p',
    doctorId: 'd',
    date: '2026-11-14',
    time: '09:00',
    recurring: false,
    intervalWeeks: '1',
    occurrences: '4',
  };

  it('aceita o caso completo', () => {
    expect(validarNovoAtendimento(valido)).toEqual({});
  });

  it('separa data e hora e só cobra as duas ao agendar', () => {
    expect(validarNovoAtendimento({ ...valido, date: '', time: '' })).toEqual({
      data: 'Informe a data.',
      hora: 'Informe a hora.',
    });
    expect(validarNovoAtendimento({ ...valido, modo: 'agora', date: '', time: '' })).toEqual({});
  });

  it('mantém as regras da recorrência', () => {
    expect(
      validarNovoAtendimento({ ...valido, recurring: true, intervalWeeks: '0', occurrences: '1' }),
    ).toEqual({
      intervalo: 'Informe um intervalo semanal válido.',
      quantidade: 'A recorrência precisa de ao menos duas consultas.',
    });
    expect(
      validarNovoAtendimento({ ...valido, recurring: false, intervalWeeks: '0', occurrences: '1' }),
    ).toEqual({});
  });
});

// UX-007: catálogo vazio não pode ser beco sem saída.
describe('catálogo de procedimentos vazio', () => {
  it('com permissão, oferece o atalho para cadastrar', () => {
    render(
      <NewAppointmentDrawer data={{ ...baseData, procedures: [], canManageProcedures: true }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Novo atendimento' }));

    const link = screen.getByRole('link', { name: 'Cadastrar procedimento' });
    expect(link.getAttribute('href')).toBe('/configuracoes/procedimentos');
  });

  it('sem permissão, orienta a pedir a quem administra e não mostra link', () => {
    render(<NewAppointmentDrawer data={{ ...baseData, procedures: [] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Novo atendimento' }));

    expect(screen.getByText(/Peça a quem administra a clínica/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Cadastrar procedimento' })).toBeNull();
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
