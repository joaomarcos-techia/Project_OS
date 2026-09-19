import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  questions: vi.fn(),
  // Mutável: o portão é lido a cada render, e cada caso precisa de outra
  // combinação sem reimportar a página.
  env: { SIGNUP_ENABLED: true, SIGNUP_IDENTITY_ENABLED: true },
}));

vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('./signup-questions', () => ({
  SignupQuestions: (props: { identityEnabled: boolean }) => {
    mocks.questions(props);
    return <div data-testid="signup-questions" />;
  },
}));

import CadastroPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.SIGNUP_ENABLED = true;
  mocks.env.SIGNUP_IDENTITY_ENABLED = true;
});

describe('/cadastro — portão de entrada do funil (§21.20)', () => {
  it('abre o funil quando os dois portões estão ligados', () => {
    const html = renderToStaticMarkup(<CadastroPage />);

    expect(html).toContain('data-testid="signup-questions"');
    expect(mocks.questions).toHaveBeenCalledWith({ identityEnabled: true });
    expect(html).not.toContain('Cadastro indisponível');
  });

  it.each([
    ['kill switch da operação', { SIGNUP_ENABLED: false, SIGNUP_IDENTITY_ENABLED: true }],
    // O caso de produção hoje: identidade desligada por default. Sem o portão,
    // é exatamente aqui que o visitante responderia quatro perguntas para
    // terminar em "a etapa de criação da conta não está disponível".
    ['identidade desligada', { SIGNUP_ENABLED: true, SIGNUP_IDENTITY_ENABLED: false }],
    ['os dois desligados', { SIGNUP_ENABLED: false, SIGNUP_IDENTITY_ENABLED: false }],
  ])('fecha a entrada e não monta o funil — %s', (_label, flags) => {
    Object.assign(mocks.env, flags);

    const html = renderToStaticMarkup(<CadastroPage />);

    expect(html).toContain('Cadastro indisponível no momento');
    // O que prova que nada é criado: o componente que faz o bootstrap da sessão
    // nem chega a ser montado, então não há `POST /api/signup/sessions`.
    expect(mocks.questions).not.toHaveBeenCalled();
    expect(html).not.toContain('data-testid="signup-questions"');
  });

  it('mantém o login alcançável e não revela qual portão fechou', () => {
    mocks.env.SIGNUP_IDENTITY_ENABLED = false;

    const html = renderToStaticMarkup(<CadastroPage />);

    expect(html).toContain('href="/login"');
    for (const leak of ['SIGNUP_ENABLED', 'SIGNUP_IDENTITY_ENABLED', 'env.', 'flag']) {
      expect(html).not.toContain(leak);
    }
  });
});
