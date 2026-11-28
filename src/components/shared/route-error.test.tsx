// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { ROUTE_ERROR_TITLE, RouteError } from './route-error';

afterEach(cleanup);

// UX-010 (docs/otimização_ui_final.md)
describe('RouteError', () => {
  it('diz o que aconteceu e o que fazer, sem prometer notificação', () => {
    render(
      <RouteError
        error={Object.assign(new Error('x'), { digest: '1586846154' })}
        reset={() => undefined}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(screen.getByRole('heading', { name: ROUTE_ERROR_TITLE })).toBeTruthy();
    expect(alert.textContent).toContain('Código para o suporte: 1586846154');
    expect(alert.textContent).toContain('informe o código abaixo ao suporte');
    expect(alert.textContent).not.toMatch(/Algo deu errado|equipe foi notificada/);
  });

  it('sem código, não manda informar um código que não aparece', () => {
    render(<RouteError error={new Error('x')} reset={() => undefined} />);

    expect(screen.getByRole('alert').textContent).not.toContain('código');
  });

  it('mantém título e texto próprios de quem chama e o botão de tentar de novo', () => {
    const reset = vi.fn();
    render(
      <RouteError
        error={new Error('x')}
        reset={reset}
        title="Não foi possível carregar o Dashboard."
        description="Texto próprio."
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Não foi possível carregar o Dashboard.' }),
    ).toBeTruthy();
    expect(screen.getByText('Texto próprio.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
