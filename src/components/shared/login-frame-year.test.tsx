// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoginFrame } from './login-frame';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('rodapé do login', () => {
  it('31/12 às 22h de Brasília ainda mostra o ano que termina', () => {
    vi.useFakeTimers({ now: new Date('2027-01-01T01:00:00.000Z'), toFake: ['Date'] });
    render(<LoginFrame>conteúdo</LoginFrame>);
    expect(screen.getByText('© 2026 Qoro')).toBeTruthy();
  });

  it('meia-noite de Brasília vira o ano', () => {
    vi.useFakeTimers({ now: new Date('2027-01-01T03:00:00.000Z'), toFake: ['Date'] });
    render(<LoginFrame>conteúdo</LoginFrame>);
    expect(screen.getByText('© 2027 Qoro')).toBeTruthy();
  });
});
