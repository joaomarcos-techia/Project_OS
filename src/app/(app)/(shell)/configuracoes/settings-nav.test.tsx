// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/configuracoes/whatsapp' }));
vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));

import { SettingsNav } from './settings-nav';

afterEach(cleanup);

describe('SettingsNav', () => {
  it('expõe grupos, links e estado atual por semântica nativa', () => {
    render(
      <SettingsNav
        groups={[
          {
            label: 'Canais e IA',
            items: [
              { label: 'WhatsApp', href: '/configuracoes/whatsapp' },
              { label: 'Agente de IA', href: '/configuracoes/agente' },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Configurações' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Canais e IA' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'WhatsApp' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('link', { name: 'Agente de IA' }).getAttribute('aria-current')).toBe(
      null,
    );
  });
});
