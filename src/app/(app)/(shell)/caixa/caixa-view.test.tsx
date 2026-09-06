// @vitest-environment happy-dom
/**
 * P-30 — Caixa como work queue: rótulos por direção financeira, RBAC,
 * confirmação contextual e paginação local sem corte silencioso.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type {
  CaixaItem,
  CollectionCaseDTO,
  FaturamentoPendenciaDTO,
  PaymentTransactionSummary,
} from '@/contexts/financial/types';
import type { ExcessRefundStatus } from '@/contexts/payments';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({
  confirmPaymentAction: vi.fn(),
  cancelLancamentoAction: vi.fn(),
  createEstornoAction: vi.fn(),
}));

import { cancelLancamentoAction } from './actions';
import { CaixaView } from './caixa-view';

const METHODS = [{ code: 'pix', label: 'PIX' }];
const PAYMENT: PaymentTransactionSummary = {
  id: 'pay1',
  clinicId: 'c1',
  lancamentoId: 'l1',
  kind: 'payment',
  amount: 200,
  paymentMethod: 'pix',
  occurredAt: '2026-06-06T10:00:00.000Z',
  originalPaymentId: null,
  reason: null,
  createdBy: 'u1',
  refundableAmount: 200,
};

function item(overrides: Partial<CaixaItem> = {}): CaixaItem {
  return {
    id: 'l1',
    clinicId: 'c1',
    unitId: null,
    tipo: 'receber',
    descricao: 'Atendimento - Consulta',
    valor: 200,
    valorPago: 0,
    status: 'pendente',
    dueDate: '2026-06-06',
    paidAt: null,
    patientId: 'p1',
    supplierId: null,
    appointmentId: 'a1',
    paymentMethod: null,
    createdVia: 'auto',
    reversesLancamentoId: null,
    snapshotProcedureName: 'Consulta',
    snapshotDoctorNome: 'Dra. Smoke',
    createdAt: '2026-06-06T00:00:00.000Z',
    pacienteNome: 'João Silva',
    ...overrides,
  };
}

function payable(overrides: Partial<CaixaItem> = {}): CaixaItem {
  return item({
    id: 'pg1',
    tipo: 'pagar',
    descricao: 'Aluguel da sala',
    valor: 1200,
    valorPago: 0,
    status: 'pendente',
    patientId: null,
    supplierId: 's1',
    appointmentId: null,
    pacienteNome: null,
    snapshotProcedureName: null,
    snapshotDoctorNome: null,
    ...overrides,
  });
}

const base = {
  pendentes: [] as CaixaItem[],
  parciais: [] as CaixaItem[],
  pagosHoje: [] as CaixaItem[],
  aPagar: [] as CaixaItem[],
  pendencias: [] as FaturamentoPendenciaDTO[],
  excessRefundStatuses: [] as ExcessRefundStatus[],
  collectionCases: [] as CollectionCaseDTO[],
  methods: METHODS,
  paymentTransactions: [] as PaymentTransactionSummary[],
  canOperate: true,
  canRefund: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cancelLancamentoAction).mockResolvedValue({ ok: true, data: item() });
});

afterEach(cleanup);

describe('CaixaView — work queue, rótulos e RBAC', () => {
  it('mantém paciente e procedimento como contexto principal do recebível', () => {
    render(<CaixaView {...base} pendentes={[item()]} />);

    expect(screen.getByText('João Silva')).toBeTruthy();
    expect(screen.getByText(/Consulta · Dra\. Smoke/)).toBeTruthy();
  });

  it('usa Receber para recebível e Pagar para pagável, mantendo os formulários inline', () => {
    render(<CaixaView {...base} pendentes={[item()]} aPagar={[payable()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Receber João Silva' }));
    expect(screen.getByLabelText('Valor recebido')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Receber R\$\s*200,00/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /A pagar 1/ }));
    expect(screen.getByText('Aluguel da sala')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pagar Aluguel da sala' }));
    expect(screen.getByLabelText('Valor pago')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pagar R\$\s*1\.200,00/ })).toBeTruthy();
  });

  it('operate:caixa mostra ações de receber/cancelar; sem permissão não mostra', () => {
    const { unmount } = render(<CaixaView {...base} canOperate pendentes={[item()]} />);
    expect(screen.getByRole('button', { name: 'Receber João Silva' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar João Silva' })).toBeTruthy();

    unmount();
    render(<CaixaView {...base} canOperate={false} canRefund={false} pendentes={[item()]} />);
    expect(screen.queryByRole('button', { name: 'Receber João Silva' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar João Silva' })).toBeNull();
  });

  it('cancelamento exige confirmação contextual antes da action idempotente', async () => {
    render(<CaixaView {...base} pendentes={[item()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar João Silva' }));
    expect(cancelLancamentoAction).not.toHaveBeenCalled();
    expect(
      screen.getByText(/saldo de R\$\s*200,00 deixará de aparecer em A receber/i),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sim, cancelar' }));
    await waitFor(() => expect(cancelLancamentoAction).toHaveBeenCalledTimes(1));
    const [input, idempotencyKey] = vi.mocked(cancelLancamentoAction).mock.calls[0]!;
    expect(input).toEqual({ lancamentoId: 'l1' });
    expect(idempotencyKey).toEqual(expect.any(String));
    expect(idempotencyKey.length).toBeGreaterThan(0);
  });

  it('refund:financial mostra reembolso apenas na fila recebida e com saldo reembolsável', () => {
    const pago = item({
      status: 'pago',
      paidAt: '2026-06-06T10:00:00.000Z',
      valorPago: 200,
      paymentMethod: 'pix',
    });
    const { unmount } = render(
      <CaixaView
        {...base}
        canOperate={false}
        canRefund
        pagosHoje={[pago]}
        paymentTransactions={[PAYMENT]}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Recebido hoje 1/ }));
    expect(screen.getByRole('button', { name: 'Reembolsar João Silva' })).toBeTruthy();

    unmount();
    render(
      <CaixaView
        {...base}
        canOperate={false}
        canRefund={false}
        pagosHoje={[pago]}
        paymentTransactions={[PAYMENT]}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Recebido hoje 1/ }));
    expect(screen.queryByRole('button', { name: 'Reembolsar João Silva' })).toBeNull();
  });

  it('preserva os cálculos de saldo dos três totais executivos', () => {
    const partial = item({ id: 'partial', valor: 300, valorPago: 125, status: 'parcial' });
    const paid = item({ id: 'paid', valor: 200, valorPago: 200, status: 'pago' });
    const account = payable({ valor: 1200, valorPago: 200, status: 'parcial' });

    render(
      <CaixaView
        {...base}
        pendentes={[item()]}
        parciais={[partial]}
        pagosHoje={[paid]}
        aPagar={[account]}
      />,
    );

    // Os totais saíram do `Metric` local (que combinava rótulo e valor num
    // aria-label de <div>, frágil e geralmente ignorado por leitor de tela) para
    // o StatCard, onde rótulo e valor são elementos irmãos lidos em sequência.
    // A asserção passa a ser sobre o texto visível, que é o que existe.
    const metrics = screen.getByRole('region', { name: 'Métricas principais' });
    expect(within(metrics).getByText(/R\$\s*375,00/)).toBeTruthy();
    expect(within(metrics).getByText(/R\$\s*200,00/)).toBeTruthy();
    expect(within(metrics).getByText(/R\$\s*1\.000,00/)).toBeTruthy();
  });

  it('mostra pendências de faturamento apenas quando a fila possui itens', () => {
    const pendingBilling: FaturamentoPendenciaDTO = {
      id: 'fp1',
      appointmentId: 'a9',
      motivo: 'Atendimento sem lançamento',
      valor: 150,
      createdAt: '2026-06-06T00:00:00.000Z',
    };
    const { unmount } = render(<CaixaView {...base} pendencias={[pendingBilling]} />);
    expect(screen.getByText(/Atendimentos não faturados/)).toBeTruthy();

    unmount();
    render(<CaixaView {...base} pendencias={[]} />);
    expect(screen.queryByText(/Atendimentos não faturados/)).toBeNull();
  });

  it.each([
    ['waiting', /aguardando confirmação da devolução/i],
    ['confirmed', /estorno confirmado pelo Asaas/i],
    ['cancelled', /valor não foi devolvido/i],
    ['failed', /não foi concluído/i],
  ] as const)('explica o estado de estorno %s sem expor identificadores', (state, copy) => {
    const pendingBilling: FaturamentoPendenciaDTO = {
      id: 'fp-refund',
      appointmentId: 'a-refund',
      motivo: 'Pagamento acima do saldo aguardando estorno do excedente.',
      valor: 10,
      createdAt: '2026-09-06T00:00:00.000Z',
    };
    render(
      <CaixaView
        {...base}
        pendencias={[pendingBilling]}
        excessRefundStatuses={[
          {
            appointmentId: 'a-refund',
            amount: 10,
            state,
          },
        ]}
      />,
    );

    expect(screen.getByText(copy)).toBeTruthy();
    expect(screen.queryByText(/pay_|refund id|provider/i)).toBeNull();
  });

  it('exibe fila humana de cobrança antiga com atraso e saldo residual', () => {
    render(
      <CaixaView
        {...base}
        collectionCases={[
          {
            id: 'case1',
            lancamentoId: 'lancamento-antigo',
            stage: 'd30_manual',
            daysOverdue: 45,
            residualAmount: 600,
            createdAt: '2026-06-06T00:00:00.000Z',
          },
        ]}
      />,
    );
    expect(screen.getByText(/Cobranças aguardando revisão humana/i)).toBeTruthy();
    expect(screen.getByText(/45 dias em atraso/i)).toBeTruthy();
    expect(screen.getByText(/R\$\s*600,00/i)).toBeTruthy();
  });

  it('torna todos os lançamentos acessíveis por paginação local', () => {
    const receivables = Array.from({ length: 11 }, (_, index) =>
      item({ id: `l${index + 1}`, pacienteNome: `Paciente ${index + 1}` }),
    );
    render(<CaixaView {...base} pendentes={receivables} />);

    expect(screen.queryByText('Paciente 11')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima página de A receber' }));
    expect(screen.getByText('Paciente 11')).toBeTruthy();
    expect(screen.getByText('11–11 de 11 em a receber')).toBeTruthy();
  });

  it('remove o corte de cinco pendências e oferece caminho até a página seguinte', () => {
    const pendingBilling = Array.from({ length: 11 }, (_, index) => ({
      id: `fp${index + 1}`,
      appointmentId: `a${index + 1}`,
      motivo: `Pendência ${index + 1}`,
      valor: 100 + index,
      createdAt: '2026-06-06T00:00:00.000Z',
    }));
    render(<CaixaView {...base} pendencias={pendingBilling} />);

    expect(screen.queryByText('Pendência 11')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Próxima página de atendimentos não faturados' }),
    );
    expect(screen.getByText('Pendência 11')).toBeTruthy();

    const source = readFileSync(resolve(__dirname, 'caixa-view.tsx'), 'utf8');
    expect(source).not.toContain('.slice(0, 5)');
    expect(source).not.toContain('.slice(0, 10)');
  });
});
