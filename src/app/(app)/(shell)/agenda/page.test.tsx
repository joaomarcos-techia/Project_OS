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
  tz: 'America/Sao_Paulo',
  view: 'week',
  ymd: '2026-08-20',
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
    expect(within(actions).getByRole('button', { name: 'Mais opções' })).toBeTruthy();
  });

  it('mantém a importação no menu e oferece ausências somente com manage:availability', async () => {
    render(await AgendaPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('link', { name: 'Ausências médicas' }).getAttribute('href')).toBe(
      '/agenda/ausencias',
    );

    const menuTrigger = screen.getByRole('button', { name: 'Mais opções' });
    menuTrigger.focus();
    fireEvent.keyDown(menuTrigger, { key: 'Enter' });

    expect(
      (await screen.findByRole('menuitem', { name: 'Importar histórico' })).getAttribute('href'),
    ).toBe('/agenda/importar');

    cleanup();
    getAgendaData.mockResolvedValue({
      ...agendaData,
      canEditAgenda: false,
      canManageAvailability: false,
    });
    render(await AgendaPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole('button', { name: 'Novo atendimento' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Ausências médicas' })).toBeNull();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Mais opções' }), {
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
