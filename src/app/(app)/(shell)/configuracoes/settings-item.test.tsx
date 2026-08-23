// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, render, screen, within } from '@testing-library/react';
import { Clock, Stethoscope } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));

import { SettingsSection } from './settings-item';
import type { SettingsNavGroup } from './settings-navigation';

afterEach(cleanup);

const group: SettingsNavGroup = {
  id: 'agenda',
  label: 'Agenda',
  description: 'Disponibilidade e recursos.',
  items: [
    {
      label: 'Horários',
      description: 'Defina os horários de funcionamento.',
      href: '/configuracoes/horarios',
      icon: Clock,
    },
    {
      label: 'Procedimentos',
      description: 'Gerencie procedimentos e duração.',
      href: '/configuracoes/procedimentos',
      icon: Stethoscope,
    },
  ],
};

describe('SettingsSection', () => {
  it('entrega um único link por configuração, com rótulo e descrição no mesmo alvo', () => {
    render(<SettingsSection group={group} statuses={{}} />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute('href')).toBe('/configuracoes/horarios');
    // A linha inteira é o link: a descrição precisa estar DENTRO dele, senão o
    // alvo clicável some e sobra um texto solto ao lado.
    expect(within(links[0]!).getByText('Defina os horários de funcionamento.')).toBeTruthy();
  });

  it('ancora a seção pelo id e a rotula pelo próprio título', () => {
    const { container } = render(<SettingsSection group={group} statuses={{}} />);

    const section = container.querySelector('section');
    expect(section?.id).toBe('agenda');
    expect(section?.getAttribute('tabindex')).toBe('-1');
    const heading = screen.getByRole('heading', { name: 'Agenda' });
    expect(section?.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  it('mostra status apenas onde existe status', () => {
    render(
      <SettingsSection
        group={group}
        statuses={{ '/configuracoes/horarios': { tone: 'green', label: 'Conectado' } }}
      />,
    );

    const links = screen.getAllByRole('link');
    expect(within(links[0]!).getByText('Conectado')).toBeTruthy();
    expect(within(links[1]!).queryByText('Conectado')).toBeNull();
    expect(links[1]!.textContent).toBe('ProcedimentosGerencie procedimentos e duração.');
  });
});
