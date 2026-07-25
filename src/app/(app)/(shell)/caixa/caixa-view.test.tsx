// @vitest-environment happy-dom
/**
 * RBAC + UI da tela /caixa (C9). Testa a VISIBILIDADE por papel sem navegador:
 * - operate:caixa → "Confirmar pagamento" / "Cancelar"
 * - refund:financial → "Reembolsar" (em pagamentos com saldo)
 * - banner de pendências
 * - card patient-first (nome do paciente em destaque)
 * Server Actions e next/navigation são mockados (testamos render, não rede).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type {
  CaixaItem,
  CollectionCaseDTO,
  FaturamentoPendenciaDTO,
  PaymentTransactionSummary,
} from '@/contexts/financial/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({
  confirmPaymentAction: vi.fn(),
  cancelLancamentoAction: vi.fn(),
  createEstornoAction: vi.fn(),
}));

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

const base = {
  pendentes: [] as CaixaItem[],
  parciais: [] as CaixaItem[],
  pagosHoje: [] as CaixaItem[],
  aPagar: [] as CaixaItem[],
  pendencias: [] as FaturamentoPendenciaDTO[],
  collectionCases: [] as CollectionCaseDTO[],
  methods: METHODS,
  paymentTransactions: [] as PaymentTransactionSummary[],
  canOperate: true,
  canRefund: true,
};

afterEach(cleanup);

describe('CaixaView — RBAC e UI', () => {
  it('patient-first: mostra o nome do paciente em destaque', () => {
    render(<CaixaView {...base} pendentes={[item()]} />);
    expect(screen.getByText('João Silva')).toBeTruthy();
    expect(screen.getByText('Consulta')).toBeTruthy(); // procedimento
  });

  it('operate:caixa → mostra Confirmar pagamento e Cancelar', () => {
    render(<CaixaView {...base} canOperate={true} pendentes={[item()]} />);
    expect(screen.getByRole('button', { name: 'Confirmar pagamento' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
  });

  it('sem operate:caixa → NÃO mostra Confirmar/Cancelar', () => {
    render(<CaixaView {...base} canOperate={false} canRefund={false} pendentes={[item()]} />);
    expect(screen.queryByRole('button', { name: 'Confirmar pagamento' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  });

  it('refund:financial mostra reembolso vinculado ao pagamento; sem permissao nao mostra', () => {
    const pago = item({ status: 'pago', paidAt: '2026-06-06T10:00:00.000Z', valorPago: 200, paymentMethod: 'pix' });
    const { unmount } = render(
      <CaixaView
        {...base}
        canOperate={false}
        canRefund={true}
        pagosHoje={[pago]}
        paymentTransactions={[PAYMENT]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Reembolsar' })).toBeTruthy();
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
    expect(screen.queryByRole('button', { name: 'Reembolsar' })).toBeNull();
  });

  it('banner de pendências aparece só quando há pendência aberta', () => {
    const pend: FaturamentoPendenciaDTO = {
      id: 'fp1',
      appointmentId: 'a9',
      motivo: 'Atendimento sem lançamento',
      valor: 150,
      createdAt: '2026-06-06T00:00:00.000Z',
    };
    const { unmount } = render(<CaixaView {...base} pendencias={[pend]} />);
    expect(screen.getByText(/Existem atendimentos não faturados/i)).toBeTruthy();
    unmount();
    render(<CaixaView {...base} pendencias={[]} />);
    expect(screen.queryByText(/Existem atendimentos não faturados/i)).toBeNull();
  });

  it('exibe fila humana de cobranca antiga com saldo residual', () => {
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

  it('mostra a seção "A pagar" com conta acionável (botão pagar — item P2.3)', () => {
    const conta = item({
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
    });
    render(<CaixaView {...base} canOperate={true} aPagar={[conta]} />);
    // "A pagar" aparece 2×: total no header + título da seção.
    expect(screen.getAllByText('A pagar').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Aluguel da sala')).toBeTruthy();
    // acionável: mostra o botão de dar baixa (mesmo ItemCard dos recebíveis).
    expect(screen.getAllByText('Confirmar pagamento').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Nada a pagar')).toBeNull();
  });
});
