// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AuthScreenSkeleton } from './auth-screen-skeleton';

afterEach(cleanup);

describe('AuthScreenSkeleton', () => {
  it.each([
    ['login', 'Carregando acesso'],
    ['invite', 'Carregando convite'],
  ] as const)('anuncia o estado %s sem deixar a rota em branco', (variant, label) => {
    const { container } = render(<AuthScreenSkeleton variant={variant} />);

    expect(screen.getByLabelText(label).getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });
});
