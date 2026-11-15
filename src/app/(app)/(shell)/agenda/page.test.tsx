// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getAgendaData, navigation } = vi.hoisted(() => ({
  getAgendaData: vi.fn(),
  navigation: { pathname: '/agenda', search: '' },
}));

vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('./data', () => ({ getAgendaData }));

import AgendaPage from './page';

const agendaData = {
  hasAccess: true,
  hasClinic: true,
  isPractitioner: false,
  selfDoctorId: null,
  canEditAgenda: true,
  canManageAvailability: true,
  appointments: [],
  recurrenceSeries: [],
  procedures: [],
  doctors: [],
  resources: [],
  deliveryFailures: [],
  deliveryFailuresLimited: false,
  tz: 'America/Sao_Paulo',
  view: 'week',
  ymd: '2026-08-20',
};

/** EC-32 — link do sinal recusado pela Meta, com a vaga ainda segurada. */
const depositFailure = {
  jobId: 'job-1',
  kind: 'deposit_link',
  pacienteNome: 'Maria Souza',
  appointmentId: 'appt-1',
  consultaEm: '2099-01-10T13:00:00.000Z',
  retornoEm: null,
  vagaSeguradaAte: '2099-01-09T13:00:00.000Z',
  acionavel: true,
  linkCopiavel: true,
  causa: { kind: 'meta_refused', code: '131042' },
};

afterEach(cleanup);

describe('AgendaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.pathname = '/agenda';
    navigation.search = 'view=week&date=2026-08-20';
    getAgendaData.mockResolvedValue(agendaData);
  });

  it('mantém as subrotas no cabeçalho e separa os controles temporais', async () => {
    render(
      await AgendaPage({
        searchParams: Promise.resolve({ view: 'week', date: '2026-08-20' }),
      }),
    );

    expect(getAgendaData).toHaveBeenCalledWith({ view: 'week', date: '2026-08-20' });

    expect(screen.getByRole('link', { name: 'Lista de espera' }).getAttribute('href')).toBe(
      '/agenda/lista-espera',
    );

    const viewNav = screen.getByRole('navigation', { name: 'Visualização da agenda' });
    expect(within(viewNav).getByRole('link', { name: 'Semana' }).getAttribute('aria-current')).toBe(
      'page',
    );
    const dateNav = screen.getByRole('navigation', { name: 'Navegação por data' });
    expect(within(dateNav).getByRole('link', { name: 'Anterior' }).className).toContain(
      'size-(--hit-target)',
    );

    const actions = screen.getByRole('group', { name: 'Ações da agenda' });
    expect(within(actions).getAllByRole('button')).toHaveLength(2);
    expect(within(actions).getByRole('button', { name: 'Novo atendimento' }).className).toContain(
      'min-h-(--hit-target)',
    );
    expect(within(actions).getByRole('button', { name: 'Mais ações' })).toBeTruthy();
  });

  it('mantém a importação no menu e oferece ausências somente com manage:availability', async () => {
    render(await AgendaPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('link', { name: 'Ausências médicas' }).getAttribute('href')).toBe(
      '/agenda/ausencias',
    );

    const menuTrigger = screen.getByRole('button', { name: 'Mais ações' });
    menuTrigger.focus();
    fireEvent.keyDown(menuTrigger, { key: 'Enter' });

    expect(
      (await screen.findByRole('menuitem', { name: 'Importar histórico' })).getAttribute('href'),
    ).toBe('/agenda/importar');
    // UX-012: no celular os destinos do cabeçalho moram no mesmo menu (mesmo
    // href); no computador esses itens somem e os botões ao lado continuam.
    const espera = screen.getByRole('menuitem', { name: 'Lista de espera' });
    expect(espera.getAttribute('href')).toBe('/agenda/lista-espera');
    expect(espera.className).toContain('md:hidden');
    expect(screen.getByRole('menuitem', { name: 'Ausências médicas' }).className).toContain(
      'md:hidden',
    );
    expect(screen.getByRole('menuitem', { name: 'Importar histórico' }).className).not.toContain(
      'md:hidden',
    );

    cleanup();
    getAgendaData.mockResolvedValue({
      ...agendaData,
      canEditAgenda: false,
      canManageAvailability: false,
    });
    render(await AgendaPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole('button', { name: 'Novo atendimento' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Ausências médicas' })).toBeNull();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Mais ações' }), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    });
    expect(await screen.findByRole('menuitem', { name: 'Importar histórico' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Ausências médicas' })).toBeNull();
  });

  it('abre o dia por padrão e preserva mês/semana quando explícitos na URL', async () => {
    await AgendaPage({ searchParams: Promise.resolve({}) });
    expect(getAgendaData).toHaveBeenLastCalledWith({ view: 'day' });
    await AgendaPage({ searchParams: Promise.resolve({ view: 'month', date: '2026-09-09' }) });
    expect(getAgendaData).toHaveBeenLastCalledWith({ view: 'month', date: '2026-09-09' });
  });

  it('mostra a faixa das mensagens que não chegaram, em qualquer visão', async () => {
    getAgendaData.mockResolvedValue({ ...agendaData, deliveryFailures: [depositFailure] });

    render(await AgendaPage({ searchParams: Promise.resolve({ view: 'week' }) }));

    expect(
      screen.getByText(/O link do sinal não chegou a Maria Souza · vaga segurada até/u),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copiar link do sinal' })).toBeTruthy();
  });

  it('no Dia, a linha da consulta ganha o selo ao lado do "Sinal pendente"', async () => {
    navigation.search = 'view=day&date=2099-01-10';
    getAgendaData.mockResolvedValue({
      ...agendaData,
      view: 'day',
      ymd: '2099-01-10',
      appointments: [
        {
          id: 'appt-1',
          doctorId: 'doc-1',
          horario: '2099-01-10T13:00:00.000Z',
          pacienteNome: 'Maria Souza',
          pacienteIdade: 34,
          medicoNome: 'Dra. Ana',
          procedimento: 'Consulta',
          duracaoMin: 50,
          status: 'agendado',
          recoveryKinds: [],
          recurrenceSeriesId: null,
          recurrenceOccurrence: null,
          depositStatus: 'pending',
          holdExpiresAt: '2099-01-09T13:00:00.000Z',
          urgencia: false,
          createdVia: 'ai',
          criadoEm: '2099-01-08T13:00:00.000Z',
          filaDesde: null,
          atendimentoDesde: null,
        },
      ],
      deliveryFailures: [depositFailure],
    });

    render(
      await AgendaPage({ searchParams: Promise.resolve({ view: 'day', date: '2099-01-10' }) }),
    );

    const row = screen.getByText('Sinal pendente').closest('tr')!;
    const badge = within(row).getByText('Link não entregue');
    expect(badge.closest('[title]')?.getAttribute('title')).toContain('(131042)');
  });

  it('sem edit:agenda a faixa aparece, mas sem "Copiar link"', async () => {
    getAgendaData.mockResolvedValue({
      ...agendaData,
      canEditAgenda: false,
      deliveryFailures: [depositFailure],
    });

    render(await AgendaPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText(/O link do sinal não chegou a Maria Souza/u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copiar link do sinal' })).toBeNull();
  });

  it('não renderiza navegação nem ações quando view:agenda é negada', async () => {
    getAgendaData.mockResolvedValue({
      ...agendaData,
      hasAccess: false,
      canEditAgenda: false,
      canManageAvailability: false,
    });

    render(await AgendaPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText(/não tem permissão para ver a agenda/iu)).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Navegação da seção' })).toBeNull();
    expect(screen.queryByLabelText('Controles da agenda')).toBeNull();
    expect(screen.queryByLabelText('Ações da agenda')).toBeNull();
  });
});
