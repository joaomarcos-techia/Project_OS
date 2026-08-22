// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from './button';
import { ConfirmDialog } from './confirm-dialog';
import { DestructiveAction } from './destructive-action';

afterEach(cleanup);

describe('confirmações destrutivas', () => {
  it('cancelar o ConfirmDialog não executa a mutação', () => {
    const action = vi.fn();
    render(
      <ConfirmDialog
        trigger={<Button type="button">Excluir</Button>}
        title="Excluir registro"
        description="Esta ação não pode ser desfeita."
        confirmLabel="Confirmar exclusão"
        action={action}
        tone="danger"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('bloqueia reenvio enquanto a mutação está pendente', async () => {
    let finish: (() => void) | undefined;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <DestructiveAction
        trigger={<Button type="button">Desativar</Button>}
        title="Desativar procedimento"
        description="Novos agendamentos deixam de oferecer este procedimento."
        confirmLabel="Desativar procedimento"
        action={action}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Desativar' }));
    const confirm = screen.getByRole('button', { name: 'Desativar procedimento' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(action).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Desativar procedimento' }).hasAttribute('disabled'),
      ).toBe(true),
    );

    finish?.();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('mantém o erro no diálogo e permite tentar novamente', async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error('Falha controlada'))
      .mockResolvedValueOnce(undefined);
    render(
      <DestructiveAction
        trigger={<Button type="button">Excluir</Button>}
        title="Excluir modelo"
        description="O modelo deixa de ficar disponível."
        confirmLabel="Excluir modelo"
        action={action}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir modelo' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Falha controlada');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir modelo' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(action).toHaveBeenCalledTimes(2);
  });
});
