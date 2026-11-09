// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PublicBlock, PublicHeading, PublicPage, SignupStage } from './signup-frame';

afterEach(cleanup);

describe('moldura pública', () => {
  it('traz os tokens do app para fora do shell', () => {
    const { container } = render(<PublicPage>conteúdo</PublicPage>);
    expect(container.querySelector('main')?.getAttribute('data-qoro-tokens')).toBe('app-v5');
  });

  it('marca a etapa atual e as concluídas', () => {
    render(<SignupStage step={2}>x</SignupStage>);
    const steps = within(screen.getByRole('list', { name: 'Etapas do cadastro' })).getAllByRole(
      'listitem',
    );
    expect(steps[0]?.textContent).toContain('concluída');
    expect(steps[1]?.getAttribute('aria-current')).toBe('step');
    expect(steps[2]?.getAttribute('aria-current')).toBeNull();
    expect(screen.getByText('Etapa 2 de 3')).toBeTruthy();
  });

  it('só oferece o login quando a tela pede', () => {
    const { rerender } = render(<SignupStage step={1}>x</SignupStage>);
    expect(screen.queryByRole('link', { name: 'Entrar' })).toBeNull();
    rerender(
      <SignupStage step={1} showLogin>
        x
      </SignupStage>,
    );
    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/login');
  });

  it('sem etapa, não desenha o progresso', () => {
    render(<SignupStage>x</SignupStage>);
    expect(screen.queryByRole('list', { name: 'Etapas do cadastro' })).toBeNull();
    expect(screen.queryByText(/Etapa \d de 3/u)).toBeNull();
  });

  it('o título é o h1 da tela e repassa atributos', () => {
    const { container } = render(
      <PublicHeading id="titulo" title="Dados da clínica" lead="Apoio" data-testid="grupo" />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Dados da clínica' }).id).toBe('titulo');
    expect(container.querySelector('[data-slot="public-heading"]')).toBe(
      screen.getByTestId('grupo'),
    );
  });

  it('o bloco repassa papel e rótulo', () => {
    render(
      <PublicBlock role="group" aria-label="Perguntas">
        x
      </PublicBlock>,
    );
    expect(screen.getByRole('group', { name: 'Perguntas' }).getAttribute('data-slot')).toBe(
      'public-block',
    );
  });
});
