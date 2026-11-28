// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from './drawer';

afterEach(cleanup);

// Sonda A-02 de 17/11/2026: em Fornecedores o diálogo abre por estado, sem Trigger, e o foco caía
// no `body` ao fechar (o Radix modal devolve o foco só ao `DialogTrigger`). WCAG 2.4.3.

function AbertoPorBotao({ gaveta = false }: { gaveta?: boolean }) {
  const [open, setOpen] = useState(false);
  const Raiz = gaveta ? Drawer : Dialog;
  const Conteudo = gaveta ? DrawerContent : DialogContent;
  const Titulo = gaveta ? DrawerTitle : DialogTitle;
  const Descricao = gaveta ? DrawerDescription : DialogDescription;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Novo fornecedor
      </button>
      <Raiz open={open} onOpenChange={setOpen}>
        <Conteudo>
          <Titulo>Novo fornecedor</Titulo>
          <Descricao>Fornecedor usado nas contas a pagar.</Descricao>
          <input aria-label="Nome" />
        </Conteudo>
      </Raiz>
    </>
  );
}

function AbertoPorItemQueSome() {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={menu} type="button">
        Ações de Ana
      </button>
      {/* Como um item de menu: some no instante em que o diálogo abre. */}
      {open ? null : (
        <button type="button" onClick={() => setOpen(true)}>
          Trocar função
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent returnFocusRef={menu}>
          <DialogTitle>Trocar função de Ana</DialogTitle>
          <DialogDescription>A nova função vale a partir do próximo acesso.</DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  );
}

async function abrirComFoco(nome: string) {
  const botao = screen.getByRole('button', { name: nome });
  botao.focus();
  await act(async () => {
    fireEvent.click(botao);
  });
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  return botao;
}

async function fecharComEsc() {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('devolução do foco ao fechar diálogo e gaveta', () => {
  it('diálogo aberto por botão comum devolve o foco ao botão', async () => {
    render(<AbertoPorBotao />);
    const botao = await abrirComFoco('Novo fornecedor');
    await fecharComEsc();
    await waitFor(() => expect(document.activeElement).toBe(botao));
  });

  it('gaveta aberta por botão comum devolve o foco ao botão', async () => {
    render(<AbertoPorBotao gaveta />);
    const botao = await abrirComFoco('Novo fornecedor');
    await fecharComEsc();
    await waitFor(() => expect(document.activeElement).toBe(botao));
  });

  it('quando quem abriu some, o foco vai ao returnFocusRef (o botão do menu)', async () => {
    render(<AbertoPorItemQueSome />);
    await abrirComFoco('Trocar função');
    await fecharComEsc();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ações de Ana' })),
    );
  });

  it('a decisão de quem chamou prevalece (onCloseAutoFocus com preventDefault)', async () => {
    function ComDecisao() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Abrir
          </button>
          <input aria-label="Busca" />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                screen.getByRole('textbox', { name: 'Busca' }).focus();
              }}
            >
              <DialogTitle>Filtro</DialogTitle>
              <DialogDescription>Escolha o filtro.</DialogDescription>
            </DialogContent>
          </Dialog>
        </>
      );
    }
    render(<ComDecisao />);
    await abrirComFoco('Abrir');
    await fecharComEsc();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Busca' })),
    );
  });
});
