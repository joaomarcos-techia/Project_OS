// @vitest-environment happy-dom
/**
 * P8.4-r — painel "Itens executados adicionais" na conferência da SP/SADT, com a política aprovada
 * em 24/11: mostra o estado de cada item; a recepção liga a autorização; o faturamento inclui (com
 * a confirmação do contrato quando a regra da operadora é desconhecida) ou registra que não será
 * faturado, com motivo; a aprovação com item pendente pede a decisão. A quantidade é conferida
 * antes de chamar o servidor; o bloco do consultório não mostra valor nem decisão.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const srv = vi.hoisted(() => ({ load: vi.fn(), recordOwn: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// As server actions do bloco do consultório (o servidor confere a posse; aqui, só o contrato).
vi.mock('@/contexts/health-insurance/actions', () => ({
  loadSessionExtraItemsAction: srv.load,
  recordOwnSessionExtraItemAction: srv.recordOwn,
}));

import {
  ExtraItemsPanel,
  PendingExtraItemsApproval,
  type ExtraItemsPanelActions,
  type ExtraItemsPanelItem,
  type ExtraItemsPanelSession,
} from './extra-items-ui';
import { ConsultorioExtraItems, SessionExtraItemsSection } from './session-extra-items-ui';

const AP = '44444444-4444-4444-8444-444444444444';
const LINE_A = '55555555-5555-4555-8555-555555555555';
const LINE_B = '77777777-7777-4777-8777-777777777777';
const decision = (over: Partial<ExtraItemsPanelItem['decision']>): ExtraItemsPanelItem['decision'] => ({
  stage: 'ready_to_include',
  pending: true,
  canRegularize: false,
  canInclude: true,
  canExclude: true,
  canCancel: true,
  includeNeedsInsurerConfirmation: false,
  message: 'O contrato dispensa autorização. O faturamento decide: incluir na guia ou não faturar, com motivo.',
  ...over,
});
const item = (over: Partial<ExtraItemsPanelItem>): ExtraItemsPanelItem => ({
  id: 'i1',
  tableCode: '22',
  procedureCode: '50000586',
  description: 'Avaliação sintética',
  quantity: 2,
  status: 'recorded',
  exclusionReason: null,
  cancelReason: null,
  decision: decision({}),
  ...over,
});
const sessions: ExtraItemsPanelSession[] = [
  {
    appointmentId: AP,
    executedOn: '2026-11-10',
    items: [
      item({}),
      item({
        id: 'i2',
        procedureCode: '50000594',
        description: 'Com autorização',
        decision: decision({ stage: 'authorization_available', canRegularize: true, canInclude: false, message: 'Há autorização concedida.' }),
      }),
      item({ id: 'i3', procedureCode: '50000608', description: 'Não faturado', status: 'excluded', exclusionReason: 'Operadora recusou', decision: decision({ stage: 'not_billed', pending: false, canInclude: false, canExclude: false, canCancel: false }) }),
      item({ id: 'i0', procedureCode: '50000616', description: 'Cancelado', status: 'cancelled', cancelReason: 'Sessão errada', decision: decision({ stage: 'cancelled', pending: false, canInclude: false, canExclude: false, canCancel: false }) }),
    ],
  },
];
const options = [
  { id: LINE_A, label: '22 · 50000586 — Avaliação sintética' },
  { id: LINE_B, label: '22 · 50000616 — Orientação sintética' },
];
const actions = (over: Partial<ExtraItemsPanelActions> = {}): ExtraItemsPanelActions => ({
  record: vi.fn(),
  cancel: vi.fn(),
  regularize: vi.fn(),
  include: vi.fn(),
  exclude: vi.fn(),
  ...over,
});

afterEach(cleanup);

describe('painel de itens executados adicionais (P8.4-r)', () => {
  it('mostra o estado de cada item e guarda não faturados e cancelados no histórico, com o motivo', () => {
    render(<ExtraItemsPanel sessions={sessions} options={options} editable canRegularize canBill actions={actions()} />);
    const region = screen.getByRole('region', { name: 'Sessão de 10/11/2026' });
    const items = within(region).getAllByRole('listitem');
    expect(items[0]!.textContent).toContain('22 · 50000586 — Avaliação sintética');
    expect(items[0]!.textContent).toContain('qtd. 2');
    expect(within(region).getByText('Aguardando decisão do faturamento')).toBeTruthy();
    expect(within(region).getByText('Autorização disponível')).toBeTruthy();
    expect(within(region).getByText('Não faturados e cancelados (2)')).toBeTruthy();
    expect(within(region).getByText(/não faturado: Operadora recusou/u)).toBeTruthy();
    expect(within(region).getByText(/cancelado: Sessão errada/u)).toBeTruthy();
  });

  it('cada papel vê só a sua ação: a recepção liga a autorização e não inclui; o faturamento inclui e não fatura', () => {
    const { unmount } = render(<ExtraItemsPanel sessions={sessions} options={options} editable canRegularize canBill={false} actions={actions()} />);
    expect(screen.getByRole('button', { name: 'Ligar a autorização' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Incluir na guia' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Não faturar' })).toBeNull();
    unmount();
    render(<ExtraItemsPanel sessions={sessions} options={options} editable={false} canRegularize={false} canBill actions={actions()} />);
    expect(screen.queryByRole('button', { name: 'Ligar a autorização' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Incluir na guia' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Não faturar' }).length).toBe(2);
    expect(screen.queryByRole('button', { name: 'Cancelar registro' })).toBeNull();
  });

  it('incluir com a regra da operadora desconhecida só depois de confirmar o contrato, e manda a confirmação', async () => {
    const include = vi.fn().mockResolvedValue({ ok: true, data: null });
    const s = [{ ...sessions[0]!, items: [item({ decision: decision({ includeNeedsInsurerConfirmation: true }) })] }];
    render(<ExtraItemsPanel sessions={s} options={options} editable canRegularize canBill actions={actions({ include })} />);
    const btn = screen.getByRole('button', { name: 'Incluir na guia' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo que o contrato/u }));
    expect(btn.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(include).toHaveBeenCalledWith({ itemId: 'i1', insurerRuleConfirmed: true });
  });

  it('não faturar exige o motivo de pelo menos 10 caracteres antes de confirmar', () => {
    render(<ExtraItemsPanel sessions={[{ ...sessions[0]!, items: [item({})] }]} options={options} editable canRegularize canBill actions={actions()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Não faturar' }));
    const confirm = screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(/Por que este item não será faturado/u), { target: { value: 'curto' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Por que este item não será faturado/u), { target: { value: 'Operadora negou a autorização' } });
    expect(confirm.disabled).toBe(false);
  });

  it('fora da edição não oferece registrar nem cancelar, e diz como mudar', () => {
    render(<ExtraItemsPanel sessions={sessions} options={options} editable={false} canRegularize canBill={false} actions={actions()} />);
    expect(screen.queryByRole('form', { name: 'Registrar item executado' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar registro' })).toBeNull();
    expect(screen.getByText(/devolva a guia para correção/u)).toBeTruthy();
  });

  it('quantidade inválida fica escrita no formulário e não chama o servidor', () => {
    const record = vi.fn();
    render(<ExtraItemsPanel sessions={sessions} options={options} editable canRegularize canBill actions={actions({ record })} />);
    fireEvent.change(screen.getByLabelText(/Quantidade/u), { target: { value: '0' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Registrar item executado' }));
    expect(screen.getByRole('alert').textContent).toBe('A quantidade precisa ser um número inteiro de 1 a 999.');
    expect(record).not.toHaveBeenCalled();
  });

  it('registra o item escolhido com a quantidade como número inteiro', async () => {
    const record = vi.fn().mockResolvedValue({ ok: true, data: 'novo' });
    render(<ExtraItemsPanel sessions={sessions} options={options} editable canRegularize canBill actions={actions({ record })} />);
    fireEvent.change(screen.getByLabelText(/Item do contrato/u), { target: { value: LINE_B } });
    fireEvent.change(screen.getByLabelText(/Quantidade/u), { target: { value: '3' } });
    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: 'Registrar item executado' }));
    });
    expect(record).toHaveBeenCalledWith({ appointmentId: AP, contractLineId: LINE_B, quantity: 3 });
  });

  it('sem sessão na guia, explica em vez de mostrar formulário', () => {
    render(<ExtraItemsPanel sessions={[]} options={options} editable canRegularize canBill actions={actions()} />);
    expect(screen.getByText('Esta guia ainda não tem sessão registrada.')).toBeTruthy();
    expect(screen.queryByRole('form')).toBeNull();
  });
});

describe('aprovação com item pendente (P8.4-r, regra 5)', () => {
  it('sem pendente, nada aparece', () => {
    const { container } = render(<PendingExtraItemsApproval count={0} guideId="g" canBill approveWithoutAction={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  it('com pendente, avisa; só o faturamento vê "Aprovar sem os itens pendentes", com motivo obrigatório', async () => {
    const approve = vi.fn().mockResolvedValue({ ok: true, data: null });
    const { unmount } = render(<PendingExtraItemsApproval count={2} guideId="g1" canBill={false} approveWithoutAction={approve} />);
    expect(screen.getByRole('status').textContent).toContain('Há 2 itens executados adicionais sem decisão nesta guia.');
    expect(screen.queryByRole('button', { name: 'Aprovar sem os itens pendentes' })).toBeNull();
    unmount();
    render(<PendingExtraItemsApproval count={1} guideId="g1" canBill approveWithoutAction={approve} />);
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar sem os itens pendentes' }));
    fireEvent.change(screen.getByLabelText(/Por que os itens pendentes não serão faturados/u), { target: { value: 'Operadora não autorizou o procedimento' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    });
    expect(approve).toHaveBeenCalledWith({ guideId: 'g1', reason: 'Operadora não autorizou o procedimento' });
  });
});

describe('bloco do consultório (exceção do médico)', () => {
  const view = {
    available: true,
    items: [{ id: 'i1', tableCode: '22', procedureCode: '50000586', description: 'Avaliação sintética', quantity: 2, stateLabel: 'Registrado; a clínica decide o faturamento', recordedByMe: true }],
    options,
  };

  it('mostra o que foi registrado e o estado, sem valor nem decisão de faturamento, e registra pela própria sessão', async () => {
    const record = vi.fn().mockResolvedValue({ ok: true, data: 'x' });
    render(<SessionExtraItemsSection appointmentId={AP} view={view} recordAction={record} />);
    const list = screen.getByRole('list', { name: 'Itens registrados nesta sessão' });
    expect(list.textContent).toContain('Registrado; a clínica decide o faturamento');
    expect(list.textContent).not.toMatch(/R\$|Incluir|Não faturar/u);
    expect(screen.queryByRole('button', { name: 'Incluir na guia' })).toBeNull();
    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: 'Registrar item executado' }));
    });
    expect(record).toHaveBeenCalledWith({ appointmentId: AP, contractLineId: LINE_A, quantity: 1 });
  });

  it('o bloco pronto do consultório lê a própria sessão e registra pela exceção do médico, relendo depois', async () => {
    srv.load.mockResolvedValue({ ok: true, data: view });
    srv.recordOwn.mockResolvedValue({ ok: true, data: 'novo' });
    await act(async () => {
      render(<ConsultorioExtraItems appointmentId={AP} />);
    });
    expect(srv.load).toHaveBeenCalledWith({ appointmentId: AP });
    expect(screen.getByRole('list', { name: 'Itens registrados nesta sessão' })).toBeTruthy();
    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: 'Registrar item executado' }));
    });
    expect(srv.recordOwn).toHaveBeenCalledWith({ appointmentId: AP, contractLineId: LINE_A, quantity: 1 });
    expect(srv.load).toHaveBeenCalledTimes(2);
  });

  it('sessão de outra pessoa (leitura nula) ou sem a 0167: nada aparece', () => {
    const { container, unmount } = render(<SessionExtraItemsSection appointmentId={AP} view={null} recordAction={vi.fn()} />);
    expect(container.textContent).toBe('');
    unmount();
    const r = render(<SessionExtraItemsSection appointmentId={AP} view={{ available: false, items: [], options: [] }} recordAction={vi.fn()} />);
    expect(r.container.textContent).toBe('');
  });
});
