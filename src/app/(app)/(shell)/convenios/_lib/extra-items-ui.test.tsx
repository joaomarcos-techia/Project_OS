// @vitest-environment happy-dom
/**
 * P8.4 — painel "Itens executados adicionais" na conferência da SP/SADT: mostra os itens de cada
 * sessão e por que ainda não são faturados (decisão P8.4-r pendente); só oferece registrar e
 * cancelar com a guia em conferência; a quantidade é conferida antes de chamar o servidor.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ExtraItemsPanel, type ExtraItemsPanelSession } from './extra-items-ui';

const AP = '44444444-4444-4444-8444-444444444444';
const LINE_A = '55555555-5555-4555-8555-555555555555';
const LINE_B = '77777777-7777-4777-8777-777777777777';
const PENDING = 'Item executado sem solicitação: registrado no atendimento, ainda não faturado. A regra de faturamento desse caso aguarda decisão.';
const sessions: ExtraItemsPanelSession[] = [
  {
    appointmentId: AP,
    executedOn: '2026-11-10',
    items: [
      { id: 'i1', tableCode: '22', procedureCode: '50000586', description: 'Avaliação sintética', quantity: 2, status: 'active', cancelReason: null, billing: { bill: false, message: PENDING, blocksApproval: false } },
      { id: 'i0', tableCode: '22', procedureCode: '50000594', description: 'Item cancelado sintético', quantity: 1, status: 'cancelled', cancelReason: 'Registrado na sessão errada', billing: null },
    ],
  },
];
const options = [
  { id: LINE_A, label: '22 · 50000586 — Avaliação sintética' },
  { id: LINE_B, label: '22 · 50000616 — Orientação sintética' },
];

afterEach(cleanup);

describe('painel de itens executados adicionais (P8.4)', () => {
  it('mostra o item ativo, o motivo de não estar faturado e o cancelado no histórico', () => {
    render(<ExtraItemsPanel sessions={sessions} options={options} editable recordAction={vi.fn()} cancelAction={vi.fn()} />);
    const region = screen.getByRole('region', { name: 'Sessão de 10/11/2026' });
    const [active] = within(region).getAllByRole('listitem');
    expect(active!.textContent).toContain('22 · 50000586 — Avaliação sintética');
    expect(active!.textContent).toContain('qtd. 2');
    expect(within(region).getByText('Não faturado')).toBeTruthy();
    expect(within(region).getByText(PENDING)).toBeTruthy();
    expect(within(region).getByText('Cancelados (1)')).toBeTruthy();
    expect(within(region).getByText(/motivo: Registrado na sessão errada/u)).toBeTruthy();
  });

  it('fora da conferência não oferece registrar nem cancelar, e diz como mudar', () => {
    render(<ExtraItemsPanel sessions={sessions} options={options} editable={false} recordAction={vi.fn()} cancelAction={vi.fn()} />);
    expect(screen.queryByRole('form', { name: 'Registrar item executado' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar item' })).toBeNull();
    expect(screen.getByText(/devolva a guia para correção/u)).toBeTruthy();
  });

  it('quantidade inválida fica escrita no formulário e não chama o servidor', () => {
    const record = vi.fn();
    render(<ExtraItemsPanel sessions={sessions} options={options} editable recordAction={record} cancelAction={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Quantidade/u), { target: { value: '0' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Registrar item executado' }));
    expect(screen.getByRole('alert').textContent).toBe('A quantidade precisa ser um número inteiro de 1 a 999.');
    expect(record).not.toHaveBeenCalled();
  });

  it('registra o item escolhido com a quantidade como número inteiro', async () => {
    const record = vi.fn().mockResolvedValue({ ok: true, data: 'novo' });
    render(<ExtraItemsPanel sessions={sessions} options={options} editable recordAction={record} cancelAction={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Item do contrato/u), { target: { value: LINE_B } });
    fireEvent.change(screen.getByLabelText(/Quantidade/u), { target: { value: '3' } });
    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: 'Registrar item executado' }));
    });
    expect(record).toHaveBeenCalledWith({ appointmentId: AP, contractLineId: LINE_B, quantity: 3 });
  });

  it('sem sessão na guia, explica em vez de mostrar formulário', () => {
    render(<ExtraItemsPanel sessions={[]} options={options} editable recordAction={vi.fn()} cancelAction={vi.fn()} />);
    expect(screen.getByText('Esta guia ainda não tem sessão registrada.')).toBeTruthy();
    expect(screen.queryByRole('form')).toBeNull();
  });
});
