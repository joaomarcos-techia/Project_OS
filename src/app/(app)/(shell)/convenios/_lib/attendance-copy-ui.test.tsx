// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AttendanceCopyButton } from './attendance-copy-ui';

const GUIDE = '22222222-2222-4222-8222-222222222222';
const pdf = (status = 200, type = 'application/pdf') =>
  new Response(status === 200 ? new Blob(['%PDF-1.4']) : '', {
    status,
    headers: { 'content-type': type, 'content-disposition': 'attachment; filename="via-atendimento-consulta-1-r1.pdf"' },
  });

describe('botão da via de atendimento (D-5 fase 2)', () => {
  beforeEach(() => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:via'), revokeObjectURL: vi.fn() });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('baixa pela rota autenticada, mostra o andamento e confirma em role=status', async () => {
    let release!: (r: Response) => void;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>((r) => (release = r)));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<AttendanceCopyButton guideId={GUIDE} />);
    const button = screen.getByRole('button', { name: 'Via para assinatura' });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gerando a via…' }).hasAttribute('disabled')).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(`/financeiro/convenios/guias/${GUIDE}/via?download=1`, { cache: 'no-store', credentials: 'same-origin' });
    release(pdf());
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Via baixada'));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Via para assinatura' }).hasAttribute('disabled')).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [404, 'não está disponível'],
    [409, 'sem os dados do impresso'],
    [429, 'Muitos downloads'],
    [500, 'Não foi possível gerar a via agora'],
  ])('falha %i: mensagem em role=alert, sem download', async (status, text) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(pdf(status, 'text/plain'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<AttendanceCopyButton guideId={GUIDE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Via para assinatura' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(text));
    expect(click).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('sessão expirada (a rota devolve HTML do login com 200) e rede fora: erro, sem baixar HTML como PDF', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<AttendanceCopyButton guideId={GUIDE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Via para assinatura' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Via para assinatura' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Confira a conexão'));
    expect(click).not.toHaveBeenCalled();
  });
});
