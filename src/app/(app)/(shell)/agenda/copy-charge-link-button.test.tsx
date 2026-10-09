// @vitest-environment happy-dom
/**
 * EC-32 — "Copiar link" do sinal ou do saldo que a Meta não entregou.
 *
 * O link é pedido à action no clique; o texto da tela vem do desfecho: copiado,
 * indisponível (cobrança paga, cancelada ou expirada) ou, sem clipboard, um
 * campo para copiar à mão.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { copiarLinkDeCobrancaAction } = vi.hoisted(() => ({
  copiarLinkDeCobrancaAction: vi.fn(),
}));

vi.mock('./actions', () => ({ copiarLinkDeCobrancaAction }));

import { CopyChargeLinkButton } from './copy-charge-link-button';

const URL = 'https://sandbox.asaas.com/checkoutSession/show?id=abc';

function stubClipboard(clipboard: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

function click() {
  render(<CopyChargeLinkButton jobId="job-1" label="Copiar link do sinal" />);
  fireEvent.click(screen.getByRole('button', { name: 'Copiar link do sinal' }));
}

beforeEach(() => {
  copiarLinkDeCobrancaAction.mockReset();
  // Por padrão, sem ClipboardItem: o caminho `writeText`.
  vi.stubGlobal('ClipboardItem', undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CopyChargeLinkButton', () => {
  it('pede o link do JOB no clique e copia', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    copiarLinkDeCobrancaAction.mockResolvedValue({ ok: true, url: URL });

    click();

    expect(await screen.findByText('Link copiado. Cole na conversa com o paciente.')).toBeTruthy();
    expect(copiarLinkDeCobrancaAction).toHaveBeenCalledWith('job-1');
    expect(writeText).toHaveBeenCalledWith(URL);
  });

  it('com ClipboardItem, entrega a promessa do texto dentro do clique', async () => {
    const items: Array<Record<string, Promise<Blob>>> = [];
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(record: Record<string, Promise<Blob>>) {
          items.push(record);
        }
      },
    );
    const write = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ write, writeText: vi.fn() });
    copiarLinkDeCobrancaAction.mockResolvedValue({ ok: true, url: URL });

    click();

    expect(await screen.findByText('Link copiado. Cole na conversa com o paciente.')).toBeTruthy();
    expect(write).toHaveBeenCalledTimes(1);
    const blob = await items[0]!['text/plain']!;
    expect(await blob.text()).toBe(URL);
  });

  it('cobrança que não vale mais: a mensagem da action, e nada copiado', async () => {
    const writeText = vi.fn();
    stubClipboard({ writeText });
    copiarLinkDeCobrancaAction.mockResolvedValue({
      ok: false,
      message: 'Este link não está mais disponível: a cobrança foi paga, cancelada ou expirou.',
    });

    click();

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Este link não está mais disponível: a cobrança foi paga, cancelada ou expirou.',
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it('clipboard negado: o link aparece num campo para copiar à mão', async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
    copiarLinkDeCobrancaAction.mockResolvedValue({ ok: true, url: URL });

    click();

    expect(
      await screen.findByText('Não foi possível copiar automaticamente. Copie o link abaixo.'),
    ).toBeTruthy();
    expect((screen.getByLabelText('Link de pagamento') as HTMLInputElement).value).toBe(URL);
  });

  it('sem clipboard nenhum, o mesmo campo', async () => {
    stubClipboard(undefined);
    copiarLinkDeCobrancaAction.mockResolvedValue({ ok: true, url: URL });

    click();

    expect((await screen.findByLabelText('Link de pagamento')) as HTMLInputElement).toBeTruthy();
  });

  it('falha de rede na action: mensagem genérica, sem detalhe interno', async () => {
    stubClipboard({ writeText: vi.fn() });
    copiarLinkDeCobrancaAction.mockRejectedValue(new Error('fetch failed: ECONNRESET'));

    click();

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível obter o link agora. Tente de novo.',
    );
  });
});
