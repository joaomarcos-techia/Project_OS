// @vitest-environment happy-dom
/**
 * Button DS v2 — garante o contrato de API mantido na refatoração (ADR-031):
 * variantes históricas (primary/secondary/ghost/danger/success) continuam
 * válidas, novas variantes do DS (soft/subtle/accent) existem, e o estado
 * loading desabilita + anuncia aria-busy.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { Button, buttonVariants } from './button';

afterEach(cleanup);

describe('buttonVariants (CVA)', () => {
  it('mantém as variantes históricas e as novas do DS v2', () => {
    for (const variant of [
      'primary',
      'secondary',
      'ghost',
      'danger',
      'success',
      'soft',
      'subtle',
      'accent',
    ] as const) {
      const cls = buttonVariants({ variant });
      expect(cls).toBeTruthy();
      expect(typeof cls).toBe('string');
    }
  });

  it('primary usa o token de marca (bg-primary) e não classes legadas do ds.css', () => {
    const cls = buttonVariants({ variant: 'primary' });
    expect(cls).toContain('bg-primary');
    expect(cls.split(' ')).not.toContain('btn');
  });

  it('tamanhos dirigem a altura pelos tokens de densidade', () => {
    expect(buttonVariants({ size: 'sm' })).toContain('h-(--control-h-sm)');
    expect(buttonVariants({ size: 'lg' })).toContain('h-(--control-h-lg)');
    expect(buttonVariants({ size: 'md' })).toContain('h-(--control-h)');
  });
});

describe('<Button>', () => {
  it('loading desabilita e anuncia aria-busy', () => {
    render(<Button loading>Salvar</Button>);
    const btn = screen.getByRole('button', { name: /salvar/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('disabled explícito também desabilita', () => {
    render(<Button disabled>Ok</Button>);
    const btn = screen.getByRole('button', { name: 'Ok' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
