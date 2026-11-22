// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: {
    ABACATEPAY_PILOT_PROVISIONING_ENABLED: true,
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
  },
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('404');
  },
}));
// A pergunta traz o próprio `h1` e mostra a abertura recebida em `intro`.
vi.mock('../signup-questions', () => ({
  SignupQuestions: ({ intro }: { intro?: ReactNode }) => (
    <>
      <h1>Pergunta da etapa 1</h1>
      <p>{intro}</p>
    </>
  ),
}));

import PilotSignupPage from './page';

afterEach(cleanup);

describe('cadastro por convite (piloto)', () => {
  it('tem um só título principal e passa a abertura do convite para dentro da etapa', () => {
    render(<PilotSignupPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/convite individual/u)).toBeTruthy();
    expect(screen.getByText(/Nenhum pagamento é necessário/u)).toBeTruthy();
  });
});
