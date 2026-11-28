// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
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
// A pergunta traz o próprio `h1`; aqui ela é substituída por um marcador com o mesmo papel.
vi.mock('../signup-questions', () => ({
  SignupQuestions: () => <h1>Pergunta da etapa 1</h1>,
}));

import PilotSignupPage from './page';

afterEach(cleanup);

describe('cadastro por convite (piloto)', () => {
  it('tem um só título principal e mantém a abertura do convite como texto', () => {
    render(<PilotSignupPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/Use seu convite individual/u)).toBeTruthy();
    expect(screen.getByText(/Nenhum pagamento é necessário/u)).toBeTruthy();
  });
});
