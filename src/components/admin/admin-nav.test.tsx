// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin' }));
vi.mock('next/link', () => ({
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => (
    <a {...props} data-prefetch={prefetch === false ? 'false' : 'enabled'} />
  ),
}));
vi.mock('@/components/painel/icons', () => ({ Icon: () => null }));

import { AdminNav } from './admin-nav';

afterEach(cleanup);

describe('AdminNav', () => {
  it('não dispara prefetch das oito páginas server-side do console', () => {
    render(<AdminNav />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(8);
    for (const link of links) expect(link.getAttribute('data-prefetch')).toBe('false');
  });
});
