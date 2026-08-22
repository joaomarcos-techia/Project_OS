// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Separator } from './separator';

afterEach(cleanup);

describe('Separator', () => {
  it('é decorativo por padrão e ocupa a largura horizontal', () => {
    const { container } = render(<Separator />);
    const separator = container.firstElementChild;

    expect(separator?.getAttribute('role')).toBe('none');
    expect(separator?.getAttribute('data-orientation')).toBe('horizontal');
    expect(separator?.className).toContain('h-px w-full');
  });

  it('expõe semântica e orientação quando carrega significado', () => {
    render(<Separator decorative={false} orientation="vertical" />);
    const separator = screen.getByRole('separator');

    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.className).toContain('h-full w-px');
  });
});
