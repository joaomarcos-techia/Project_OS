// @vitest-environment happy-dom
/**
 * B6/B1 — a metade CLIENTE da regressão do envelope.
 *
 * O envelope C16 tem `error` **booleano** (`{error: true, code, message, …}`). O form
 * lia `data.error` e punha `true` no state; o React não renderiza booleano, então a
 * caixa vermelha aparecia VAZIA e a mensagem do 422 ("reduza o intervalo e exporte em
 * partes") — o entregável central do B6 — nunca chegava ao operador.
 *
 * Os testes da rota travam o shape do SERVIDOR. Sem este arquivo, reverter uma linha
 * do form reintroduz o bug com a suíte inteira verde.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/painel/icons', () => ({ Icon: () => null }));
vi.mock('@/components/ui/button', () => ({ buttonVariants: () => 'btn' }));

import { ExportAuditForm } from './export-form';

/** Resposta no shape do envelope C16 — `error` booleano, mensagem em `message`. */
const envelope = (status: number, message: string, code = 'x') => ({
  ok: false,
  status,
  json: async () => ({
    error: true,
    code,
    message,
    trace_id: 'trace-1',
    timestamp: new Date().toISOString(),
  }),
});

function submit() {
  const [de, ate] = screen.getAllByPlaceholderText('dd/mm/aaaa');
  fireEvent.change(de!, { target: { value: '01/01/2026' } });
  fireEvent.change(ate!, { target: { value: '31/01/2026' } });
  fireEvent.click(screen.getByRole('button', { name: /exportar/i }));
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('mensagem de erro do envelope chega ao operador', () => {
  it.each([
    ['422 de span', 422, 'Período excede o limite máximo de exportação (12 meses).', 'periodo_excede_limite'],
    ['422 de truncagem', 422, 'Período gera 5000+ eventos e o export sairia incompleto.', 'audit_export_too_large'],
    ['429', 429, 'Muitos exports em pouco tempo. Aguarde alguns minutos.', 'rate_limited'],
    ['500', 500, 'Erro interno.', 'internal'],
    ['400', 400, 'A data inicial é posterior à final.', 'periodo_invertido'],
  ])('%s → exibe a mensagem, não uma caixa vazia', async (_n, status, message, code) => {
    vi.mocked(fetch).mockResolvedValue(envelope(status, message, code) as never);

    render(<ExportAuditForm clinicId="c1" />);
    submit();

    // Procurar pelo TEXTO é o que pega o bug: um `<p>` vazio passaria num
    // `toBeInTheDocument`, e era exatamente isso que o operador via.
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
  });

  it('corpo sem `message` → fallback legível (nunca vazio)', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as never);

    render(<ExportAuditForm clinicId="c1" />);
    submit();

    await waitFor(() => expect(screen.getByText('Falha ao exportar')).toBeTruthy());
  });

  it('`message` não-string (corpo inesperado) → fallback, não "[object Object]"', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: true, message: { nested: 'oops' } }),
    } as never);

    render(<ExportAuditForm clinicId="c1" />);
    submit();

    await waitFor(() => expect(screen.getByText('Falha ao exportar')).toBeTruthy());
  });

  it('sucesso → mostra o hash e nenhum erro', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        signedUrl: 'https://storage.example/x.pdf',
        sha256: 'abc123',
        rowCount: 12,
        expiresInDays: 7,
      }),
    } as never);

    render(<ExportAuditForm clinicId="c1" />);
    submit();

    await waitFor(() => expect(screen.getByText(/abc123/)).toBeTruthy());
    expect(screen.queryByText('Falha ao exportar')).toBeNull();
  });
});
