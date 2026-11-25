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

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: nav.refresh }) }));
vi.mock('./actions', () => ({
  confirmPaymentAction: vi.fn(),
  cancelLancamentoAction: vi.fn(),
  createEstornoAction: vi.fn(),
  reviewProfessionalPayoutAction: vi.fn(),
}));

import {
  cancelLancamentoAction,
  confirmPaymentAction,
  reviewProfessionalPayoutAction,
} from './actions';
import { CaixaView, type FailedChargeItem, type ManualRefundItem } from './caixa-view';
import { PENDING_KEYS_STORAGE_KEY, resumoDoPedido } from './pending-keys';

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
    valorGlosado: 0,
    sourceHiGuideId: null,
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
    paymentEconomics: null,
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
  hoje: '7 de setembro',
  atualizadoEm: '14:02',
  pendentes: [] as CaixaItem[],
  parciais: [] as CaixaItem[],
  pagosHoje: [] as CaixaItem[],
  aPagar: [] as CaixaItem[],
  pendencias: [] as FaturamentoPendenciaDTO[],
  failedCharges: [] as FailedChargeItem[],
  manualRefundTasks: [] as ManualRefundItem[],
  excessRefundStatuses: [] as ExcessRefundStatus[],
  collectionCases: [] as CollectionCaseDTO[],
  methods: METHODS,
  paymentTransactions: [] as PaymentTransactionSummary[],
  showAdvancedFinancialDetails: false,
  canOperate: true,
  canRefund: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  // P-19: as chaves em aberto vivem na aba; cada teste começa com a aba limpa.
  sessionStorage.clear();
  vi.mocked(cancelLancamentoAction).mockResolvedValue({ ok: true, data: item() });
});

afterEach(cleanup);

describe('CaixaView — work queue, rótulos e RBAC', () => {
  it('mantém paciente e procedimento como contexto principal do recebível', () => {
    render(<CaixaView {...base} pendentes={[item()]} />);

    expect(screen.getByText('João Silva')).toBeTruthy();
    expect(screen.getByText(/Consulta · Dra\. Smoke/)).toBeTruthy();
  });

  it('usa Registrar recebimento para recebível e Registrar pagamento para pagável, mantendo os formulários inline', () => {
    render(<CaixaView {...base} pendentes={[item()]} aPagar={[payable()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Registrar recebimento' }));
    expect(screen.getByLabelText('Valor recebido')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Registrar R\$\s*200,00/ })).toBeTruthy();

    // Sem abas: as filas convivem, então o pagável já está na tela.
    expect(screen.getByRole('region', { name: 'A pagar' })).toBeTruthy();
    expect(screen.getByText('Aluguel da sala')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Registrar pagamento' }));
    expect(screen.getByLabelText('Valor pago')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Registrar R\$\s*1\.200,00/ })).toBeTruthy();
  });

  /*
    Invariante financeiro da UI (UX-015; docs/otimização_ui_final.md, 25.7): uma
    falha de transporte nunca vira um segundo registro. A chave pertence à
    operação (o pedido exato) e só o sucesso a encerra. O `servidorIdempotente`
    abaixo reproduz o contrato do `idempotentMutation`: a primeira chamada de uma
    chave grava; a repetição devolve o que ficou guardado; recusa não guarda nada.
  */
  describe('idempotência do registro (UX-015)', () => {
    const AMBIGUO = /Não conseguimos confirmar o resultado deste registro/;

    function servidorIdempotente() {
      const respostas = new Map<string, Awaited<ReturnType<typeof confirmPaymentAction>>>();
      const gravados: { chave: string; lancamentoId: string; valorPago: number }[] = [];
      return {
        gravados,
        async registrar(input: { lancamentoId: string; valorPago: number }, chave: string) {
          const guardada = respostas.get(chave);
          if (guardada) return guardada;
          gravados.push({ chave, lancamentoId: input.lancamentoId, valorPago: input.valorPago });
          const resposta = {
            ok: true as const,
            data: item({ id: input.lancamentoId, status: 'parcial', valorPago: input.valorPago }),
          };
          respostas.set(chave, resposta);
          return resposta;
        },
      };
    }

    const chavesDe = (action: typeof confirmPaymentAction | typeof cancelLancamentoAction) =>
      vi.mocked(action).mock.calls.map((call) => call[1]);

    async function registrar(valor: RegExp) {
      const botao = screen.getByRole('button', { name: valor });
      await waitFor(() => expect((botao as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(botao);
    }

    const painelFechado = () =>
      waitFor(() => expect(screen.queryByLabelText('Valor recebido')).toBeNull());

    /** Abre o painel do cartão só quando a transição anterior terminou (o botão fica desabilitado nela). */
    async function abrir(nome: string, indice = 0) {
      const botao = screen.getAllByRole('button', { name: nome })[indice]!;
      await waitFor(() => expect((botao as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(botao);
    }

    it('resposta perdida depois de o servidor gravar: repetir não duplica o recebimento parcial', async () => {
      const servidor = servidorIdempotente();
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockImplementationOnce(async (input, chave) => {
          await servidor.registrar(input, chave);
          throw new Error('Failed to fetch');
        })
        .mockImplementation((input, chave) => servidor.registrar(input, chave));
      render(<CaixaView {...base} pendentes={[item()]} />);

      await abrir('Registrar recebimento');
      fireEvent.change(screen.getByLabelText('Valor recebido'), { target: { value: '80,00' } });
      await registrar(/Registrar R\$\s*80,00/);
      expect(await screen.findByText(AMBIGUO)).toBeTruthy();
      // A tela não afirma que falhou: o resultado é desconhecido.
      expect(screen.queryByText(/Não foi possível concluir/)).toBeNull();

      await registrar(/Registrar R\$\s*80,00/);
      await painelFechado();
      expect(confirmPaymentAction).toHaveBeenCalledTimes(2);
      expect(servidor.gravados).toEqual([
        { chave: expect.any(String), lancamentoId: 'l1', valorPago: 80 },
      ]);
    });

    it('timeout antes de qualquer resposta: mesma mensagem e mesma chave na repetição', async () => {
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'))
        .mockResolvedValueOnce({ ok: true, data: item({ status: 'pago', valorPago: 200 }) });
      render(<CaixaView {...base} pendentes={[item()]} />);

      await abrir('Registrar recebimento');
      await registrar(/Registrar R\$\s*200,00/);
      expect(await screen.findByText(AMBIGUO)).toBeTruthy();
      await registrar(/Registrar R\$\s*200,00/);
      await painelFechado();
      const [primeira, segunda] = chavesDe(confirmPaymentAction);
      expect(segunda).toBe(primeira);
    });

    it('"em processamento" no servidor não encerra a operação: a chave segue até a confirmação', async () => {
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockRejectedValueOnce(new Error('Failed to fetch'))
        .mockResolvedValueOnce({
          ok: false,
          code: 'retry',
          message: 'Pagamento em processamento — aguarde um instante e tente de novo.',
        })
        .mockResolvedValueOnce({ ok: true, data: item({ status: 'parcial', valorPago: 80 }) });
      render(<CaixaView {...base} pendentes={[item()]} />);

      await abrir('Registrar recebimento');
      fireEvent.change(screen.getByLabelText('Valor recebido'), { target: { value: '80,00' } });
      await registrar(/Registrar R\$\s*80,00/);
      expect(await screen.findByText(AMBIGUO)).toBeTruthy();
      await registrar(/Registrar R\$\s*80,00/);
      expect(await screen.findByText(/Pagamento em processamento/)).toBeTruthy();
      await registrar(/Registrar R\$\s*80,00/);
      await painelFechado();

      const chaves = chavesDe(confirmPaymentAction);
      expect(chaves).toHaveLength(3);
      expect(new Set(chaves).size).toBe(1);
    });

    it('erro inesperado depois do envio não vira "falhou": avisa que o resultado é incerto e reusa a chave', async () => {
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockResolvedValueOnce({
          ok: false,
          code: 'error',
          message: 'Não foi possível concluir a ação. Tente novamente.',
        })
        .mockResolvedValueOnce({ ok: true, data: item({ status: 'pago', valorPago: 200 }) });
      render(<CaixaView {...base} pendentes={[item()]} />);

      await abrir('Registrar recebimento');
      await registrar(/Registrar R\$\s*200,00/);
      expect(await screen.findByText(AMBIGUO)).toBeTruthy();
      expect(screen.queryByText(/Não foi possível concluir/)).toBeNull();
      await registrar(/Registrar R\$\s*200,00/);
      await painelFechado();
      const [primeira, segunda] = chavesDe(confirmPaymentAction);
      expect(segunda).toBe(primeira);
    });

    it('recusa definitiva mostra o motivo; repetir só refaz a checagem e outro valor é outra operação', async () => {
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockResolvedValueOnce({ ok: false, code: 'validation', message: 'Valor acima do saldo.' })
        .mockResolvedValueOnce({ ok: false, code: 'validation', message: 'Valor acima do saldo.' })
        .mockResolvedValueOnce({ ok: true, data: item({ status: 'parcial', valorPago: 150 }) });
      render(<CaixaView {...base} pendentes={[item()]} />);

      await abrir('Registrar recebimento');
      await registrar(/Registrar R\$\s*200,00/);
      expect(await screen.findByText('Valor acima do saldo.')).toBeTruthy();
      expect(screen.queryByText(AMBIGUO)).toBeNull();
      await registrar(/Registrar R\$\s*200,00/);
      await waitFor(() => expect(confirmPaymentAction).toHaveBeenCalledTimes(2));
      fireEvent.change(screen.getByLabelText('Valor recebido'), { target: { value: '150,00' } });
      await registrar(/Registrar R\$\s*150,00/);
      await painelFechado();

      const [primeira, mesmaChecagem, outroValor] = chavesDe(confirmPaymentAction);
      expect(mesmaChecagem).toBe(primeira);
      expect(outroValor).not.toBe(primeira);
    });

    it('P-19: outra aba registrou antes (recusa de situação): fecha o painel, recarrega e descarta a chave', async () => {
      const mudou =
        'A situação deste lançamento mudou, talvez em outra aba ou aparelho. A lista foi atualizada; confira os valores antes de registrar de novo.';
      nav.refresh.mockClear();
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockResolvedValueOnce({ ok: false, code: 'state', message: mudou })
        .mockResolvedValueOnce({ ok: true, data: item({ status: 'parcial', valorPago: 200 }) });
      render(<CaixaView {...base} pendentes={[item()]} />);

      await abrir('Registrar recebimento');
      await registrar(/Registrar R\$\s*200,00/);
      expect(await screen.findByText(mudou)).toBeTruthy();
      await painelFechado();
      expect(nav.refresh).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem(PENDING_KEYS_STORAGE_KEY) ?? '').not.toContain(
        String(chavesDe(confirmPaymentAction)[0]),
      );

      // Com a lista atualizada, registrar de novo é outra operação, com chave nova.
      await abrir('Registrar recebimento');
      await registrar(/Registrar R\$\s*200,00/);
      await painelFechado();
      const [antes, depois] = chavesDe(confirmPaymentAction);
      expect(depois).not.toBe(antes);
    });

    it('P-19: conflito de chave também recarrega; recusa de validação mantém o painel e a chave', async () => {
      nav.refresh.mockClear();
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockResolvedValueOnce({
          ok: false,
          code: 'conflict',
          message: 'Requisição duplicada detectada.',
        })
        .mockResolvedValueOnce({ ok: false, code: 'validation', message: 'Valor acima do saldo.' });
      render(<CaixaView {...base} pendentes={[item()]} />);

      await abrir('Registrar recebimento');
      await registrar(/Registrar R\$\s*200,00/);
      await painelFechado();
      expect(nav.refresh).toHaveBeenCalledTimes(1);

      await abrir('Registrar recebimento');
      await registrar(/Registrar R\$\s*200,00/);
      expect(await screen.findByText('Valor acima do saldo.')).toBeTruthy();
      expect(screen.getByLabelText('Valor recebido')).toBeTruthy();
      expect(nav.refresh).toHaveBeenCalledTimes(1);
    });

    it('sucesso encerra a operação: o mesmo valor depois dele é um registro novo, com chave nova', async () => {
      const servidor = servidorIdempotente();
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockImplementation((input, chave) => servidor.registrar(input, chave));
      render(<CaixaView {...base} pendentes={[item({ status: 'parcial', valorPago: 50 })]} />);

      for (let vez = 0; vez < 2; vez += 1) {
        await abrir('Registrar o restante');
        fireEvent.change(screen.getByLabelText('Valor recebido'), { target: { value: '50,00' } });
        await registrar(/Registrar R\$\s*50,00/);
        await painelFechado();
      }

      const [primeira, segunda] = chavesDe(confirmPaymentAction);
      expect(segunda).not.toBe(primeira);
      expect(servidor.gravados).toHaveLength(2);
    });

    it('duplo clique grava uma vez: o botão fica desabilitado enquanto o servidor responde', async () => {
      let responder: (value: Awaited<ReturnType<typeof confirmPaymentAction>>) => void = () => {};
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockImplementation(
          () =>
            new Promise((resolve) => {
              responder = resolve;
            }),
        );
      render(<CaixaView {...base} pendentes={[item()]} />);

      await abrir('Registrar recebimento');
      const botao = screen.getByRole('button', { name: /Registrar R\$\s*200,00/ });
      fireEvent.click(botao);
      fireEvent.click(botao);
      await waitFor(() => expect((botao as HTMLButtonElement).disabled).toBe(true));
      fireEvent.click(botao);
      expect(confirmPaymentAction).toHaveBeenCalledTimes(1);

      responder({ ok: true, data: item({ status: 'pago', valorPago: 200 }) });
      await painelFechado();
      expect(confirmPaymentAction).toHaveBeenCalledTimes(1);
    });

    it('fechar o painel e voltar ao mesmo registro mantém a chave do que ficou sem confirmação', async () => {
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockRejectedValueOnce(new Error('Failed to fetch'))
        .mockResolvedValueOnce({ ok: true, data: item({ status: 'pago', valorPago: 200 }) });
      render(<CaixaView {...base} pendentes={[item()]} />);

      await abrir('Registrar recebimento');
      await registrar(/Registrar R\$\s*200,00/);
      expect(await screen.findByText(AMBIGUO)).toBeTruthy();
      await waitFor(() =>
        expect((screen.getByRole('button', { name: 'Voltar' }) as HTMLButtonElement).disabled).toBe(
          false,
        ),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
      expect(screen.queryByLabelText('Valor recebido')).toBeNull();

      await abrir('Registrar recebimento');
      await registrar(/Registrar R\$\s*200,00/);
      await painelFechado();
      const [primeira, depoisDeFechar] = chavesDe(confirmPaymentAction);
      expect(depoisDeFechar).toBe(primeira);
    });

    it('registrar outro lançamento no meio não perde a chave do primeiro, e cada um tem a sua', async () => {
      const servidor = servidorIdempotente();
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockImplementationOnce(async (input, chave) => {
          await servidor.registrar(input, chave);
          throw new Error('Failed to fetch');
        })
        .mockImplementation((input, chave) => servidor.registrar(input, chave));
      const outro = item({ id: 'l2', pacienteNome: 'Maria Souza', patientId: 'p2' });
      render(<CaixaView {...base} pendentes={[item(), outro]} />);

      await abrir('Registrar recebimento', 0);
      await registrar(/Registrar R\$\s*200,00/);
      expect(await screen.findByText(AMBIGUO)).toBeTruthy();
      const voltar = screen.getByRole('button', { name: 'Voltar' });
      await waitFor(() => expect((voltar as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(voltar);

      await abrir('Registrar recebimento', 1);
      await registrar(/Registrar R\$\s*200,00/);
      await painelFechado();

      await abrir('Registrar recebimento', 0);
      await registrar(/Registrar R\$\s*200,00/);
      await painelFechado();

      const [primeiro, doOutro, repeticao] = vi.mocked(confirmPaymentAction).mock.calls;
      expect(primeiro![0].lancamentoId).toBe('l1');
      expect(doOutro![0].lancamentoId).toBe('l2');
      expect(doOutro![1]).not.toBe(primeiro![1]);
      expect(repeticao![1]).toBe(primeiro![1]);
      expect(servidor.gravados.map((gravado) => gravado.lancamentoId)).toEqual(['l1', 'l2']);
    });

    it('mudar o valor é outra operação, com outra chave; voltar ao valor anterior retoma a dele', async () => {
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockRejectedValueOnce(new Error('Failed to fetch'))
        .mockRejectedValueOnce(new Error('Failed to fetch'))
        .mockResolvedValueOnce({ ok: true, data: item({ status: 'pago', valorPago: 200 }) });
      render(<CaixaView {...base} pendentes={[item()]} />);

      await abrir('Registrar recebimento');
      await registrar(/Registrar R\$\s*200,00/);
      expect(await screen.findByText(AMBIGUO)).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Valor recebido'), { target: { value: '150,00' } });
      await registrar(/Registrar R\$\s*150,00/);
      await waitFor(() => expect(confirmPaymentAction).toHaveBeenCalledTimes(2));
      fireEvent.change(screen.getByLabelText('Valor recebido'), { target: { value: '200,00' } });
      await registrar(/Registrar R\$\s*200,00/);
      await painelFechado();

      const [duzentos, centoECinquenta, duzentosDeNovo] = chavesDe(confirmPaymentAction);
      expect(centoECinquenta).not.toBe(duzentos);
      expect(duzentosDeNovo).toBe(duzentos);
    });

    it('outra clínica é outra página: a chave em aberto não atravessa a troca de clínica', async () => {
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockRejectedValueOnce(new Error('Failed to fetch'))
        .mockResolvedValueOnce({ ok: true, data: item({ clinicId: 'c2', status: 'pago' }) });
      const { unmount } = render(<CaixaView {...base} pendentes={[item()]} />);
      await abrir('Registrar recebimento');
      await registrar(/Registrar R\$\s*200,00/);
      expect(await screen.findByText(AMBIGUO)).toBeTruthy();

      // Trocar de clínica navega e remonta o Caixa; mesmo id de lançamento e mesmo
      // valor não herdam a chave da clínica anterior.
      unmount();
      render(<CaixaView {...base} pendentes={[item({ clinicId: 'c2' })]} />);
      await abrir('Registrar recebimento');
      await registrar(/Registrar R\$\s*200,00/);
      await painelFechado();
      const [daPrimeira, daSegunda] = chavesDe(confirmPaymentAction);
      expect(daSegunda).not.toBe(daPrimeira);
    });

    it('P-19: recarregar a página com o registro sem resposta mantém a chave e não duplica', async () => {
      const servidor = servidorIdempotente();
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockImplementationOnce(async (input, chave) => {
          await servidor.registrar(input, chave);
          throw new Error('Failed to fetch');
        })
        .mockImplementation((input, chave) => servidor.registrar(input, chave));
      const { unmount } = render(<CaixaView {...base} pendentes={[item()]} />);
      await abrir('Registrar recebimento');
      fireEvent.change(screen.getByLabelText('Valor recebido'), { target: { value: '80,00' } });
      await registrar(/Registrar R\$\s*80,00/);
      expect(await screen.findByText(AMBIGUO)).toBeTruthy();

      // Recarregar = a página monta de novo na mesma aba; a memória do componente some.
      unmount();
      render(<CaixaView {...base} pendentes={[item()]} />);
      await abrir('Registrar recebimento');
      fireEvent.change(screen.getByLabelText('Valor recebido'), { target: { value: '80,00' } });
      await registrar(/Registrar R\$\s*80,00/);
      await painelFechado();

      const [antes, depoisDeRecarregar] = chavesDe(confirmPaymentAction);
      expect(depoisDeRecarregar).toBe(antes);
      expect(servidor.gravados).toHaveLength(1);
    });

    it('P-19: a aba guarda só resumo e chave, e esquece a operação depois do sucesso', async () => {
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockRejectedValueOnce(new Error('Failed to fetch'))
        .mockResolvedValueOnce({ ok: true, data: item({ status: 'pago', valorPago: 200 }) });
      render(<CaixaView {...base} pendentes={[item()]} />);
      await abrir('Registrar recebimento');
      await registrar(/Registrar R\$\s*200,00/);
      expect(await screen.findByText(AMBIGUO)).toBeTruthy();

      const guardado = sessionStorage.getItem(PENDING_KEYS_STORAGE_KEY) ?? '';
      expect(guardado).not.toBe('');
      expect(guardado).not.toMatch(/l1|pix|comprovante/u);
      // Estrutura exata, e não "não contém 200": a chave (UUID aleatório) e o prazo (ms) podem conter
      // "200" por acaso (falha intermitente na composição de 25/11). Só o resumo em hexadecimal e
      // { chave UUID, ate numérico }: nenhum valor, forma de pagamento ou id da operação.
      const lido = JSON.parse(guardado) as Record<string, Record<string, unknown>>;
      expect(Object.keys(lido).length).toBeGreaterThan(0);
      for (const [resumo, valor] of Object.entries(lido)) {
        expect(resumo).toMatch(/^[0-9a-f]{20,}$/u);
        expect(Object.keys(valor).sort()).toEqual(['ate', 'chave']);
        expect(valor.chave).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
        expect(typeof valor.ate).toBe('number');
      }

      await registrar(/Registrar R\$\s*200,00/);
      await painelFechado();
      expect(sessionStorage.getItem(PENDING_KEYS_STORAGE_KEY)).toBeNull();
    });

    it('P-19: chave guardada há mais de 30 min não é reaproveitada', async () => {
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockResolvedValue({ ok: true, data: item({ status: 'pago', valorPago: 200 }) });
      // Composição com o #53: o pedido leva o valor já pago que a tela mostrou (valorPagoEsperado).
      const pedido = `confirm:c1:${JSON.stringify({ lancamentoId: 'l1', paymentMethod: 'pix', valorPago: 200, valorPagoEsperado: 0, comprovante: null })}`;
      sessionStorage.setItem(
        PENDING_KEYS_STORAGE_KEY,
        JSON.stringify({
          [resumoDoPedido(pedido)]: { chave: 'chave-vencida', ate: Date.now() - 1 },
        }),
      );
      render(<CaixaView {...base} pendentes={[item()]} />);
      await abrir('Registrar recebimento');
      await registrar(/Registrar R\$\s*200,00/);
      await painelFechado();
      expect(chavesDe(confirmPaymentAction)[0]).not.toBe('chave-vencida');
    });

    it('P-19: a mesma operação guardada e ainda no prazo é reaproveitada', async () => {
      vi.mocked(confirmPaymentAction)
        .mockReset()
        .mockResolvedValue({ ok: true, data: item({ status: 'pago', valorPago: 200 }) });
      // Composição com o #53: o pedido leva o valor já pago que a tela mostrou (valorPagoEsperado).
      const pedido = `confirm:c1:${JSON.stringify({ lancamentoId: 'l1', paymentMethod: 'pix', valorPago: 200, valorPagoEsperado: 0, comprovante: null })}`;
      sessionStorage.setItem(
        PENDING_KEYS_STORAGE_KEY,
        JSON.stringify({
          [resumoDoPedido(pedido)]: { chave: 'chave-em-aberto', ate: Date.now() + 60_000 },
        }),
      );
      render(<CaixaView {...base} pendentes={[item()]} />);
      await abrir('Registrar recebimento');
      await registrar(/Registrar R\$\s*200,00/);
      await painelFechado();
      expect(chavesDe(confirmPaymentAction)[0]).toBe('chave-em-aberto');
    });

    it('P-19: armazenamento da aba bloqueado não impede registrar (fica na memória)', async () => {
      const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      try {
        vi.mocked(confirmPaymentAction)
          .mockReset()
          .mockRejectedValueOnce(new Error('Failed to fetch'))
          .mockResolvedValueOnce({ ok: true, data: item({ status: 'pago', valorPago: 200 }) });
        render(<CaixaView {...base} pendentes={[item()]} />);
        await abrir('Registrar recebimento');
        await registrar(/Registrar R\$\s*200,00/);
        expect(await screen.findByText(AMBIGUO)).toBeTruthy();
        await registrar(/Registrar R\$\s*200,00/);
        await painelFechado();
        const [primeira, segunda] = chavesDe(confirmPaymentAction);
        expect(segunda).toBe(primeira);
      } finally {
        getItem.mockRestore();
        setItem.mockRestore();
      }
    });

    it('cancelar cobrança segue a mesma regra: queda de rede mantém a chave do cancelamento', async () => {
      vi.mocked(cancelLancamentoAction)
        .mockReset()
        .mockRejectedValueOnce(new Error('Failed to fetch'))
        .mockResolvedValueOnce({ ok: true, data: item({ status: 'cancelado' }) });
      render(<CaixaView {...base} pendentes={[item()]} />);

      await abrir('Registrar recebimento');
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar cobrança de João Silva' }));
      fireEvent.click(screen.getByRole('button', { name: 'Sim, cancelar' }));
      expect(await screen.findByText(AMBIGUO)).toBeTruthy();
      await waitFor(() =>
        expect(
          (screen.getByRole('button', { name: 'Sim, cancelar' }) as HTMLButtonElement).disabled,
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Sim, cancelar' }));
      await waitFor(() => expect(cancelLancamentoAction).toHaveBeenCalledTimes(2));
      const [primeira, segunda] = chavesDe(cancelLancamentoAction);
      expect(segunda).toBe(primeira);
    });
  });

  it('envia ao servidor o valor já pago que a tela mostrou para detectar concorrência', async () => {
    vi.mocked(confirmPaymentAction).mockResolvedValue({ ok: true, data: item() });
    render(<CaixaView {...base} parciais={[item({ status: 'parcial', valorPago: 75 })]} />);

    // Composição com o #56: o parcial abre por "Registrar o restante" e registra por "Registrar R$ …".
    fireEvent.click(screen.getByRole('button', { name: 'Registrar o restante' }));
    fireEvent.click(await screen.findByRole('button', { name: /Registrar R\$\s*125,00/ }));

    await waitFor(() => {
      expect(confirmPaymentAction).toHaveBeenCalledWith(
        expect.objectContaining({
          lancamentoId: 'l1',
          valorPago: 125,
          valorPagoEsperado: 75,
        }),
        expect.any(String),
      );
    });
  });

  it('oferece somente a forma comercial acordada no recebível do atendimento', () => {
    render(
      <CaixaView
        {...base}
        methods={[
          { code: 'pix', label: 'PIX' },
          { code: 'dinheiro', label: 'Dinheiro' },
          { code: 'cartao_credito', label: 'Cartão de crédito' },
        ]}
        pendentes={[item({ commercialPaymentMethod: 'cash' })]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Registrar recebimento' }));
    const select = screen.getByLabelText('Forma de pagamento');
    expect(within(select).getAllByRole('option')).toHaveLength(1);
    expect(within(select).getByRole('option', { name: 'Dinheiro' })).toBeTruthy();
  });

  it('dinheiro aparece ao lado da forma acordada, e só ele (08/10/2026)', () => {
    render(
      <CaixaView
        {...base}
        methods={[
          { code: 'pix', label: 'PIX' },
          { code: 'dinheiro', label: 'Dinheiro' },
          { code: 'cartao_credito', label: 'Cartão de crédito' },
        ]}
        pendentes={[item({ commercialPaymentMethod: 'pix' })]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Registrar recebimento' }));
    const select = screen.getByLabelText('Forma de pagamento');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['PIX', 'Dinheiro']);
  });

  it('Recebido em dinheiro: painel só com dinheiro e o saldo inteiro', () => {
    render(
      <CaixaView
        {...base}
        canOperate
        methods={[
          { code: 'pix', label: 'PIX' },
          { code: 'dinheiro', label: 'Dinheiro' },
          { code: 'cartao_credito', label: 'Cartão de crédito' },
        ]}
        pendentes={[item({ commercialPaymentMethod: 'pix' })]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Recebido em dinheiro' }));
    const select = screen.getByLabelText('Forma de pagamento');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Dinheiro']);
    expect((screen.getByLabelText('Valor recebido') as HTMLInputElement).value).toBe('200.00');
    expect(
      screen.getByText(/Se o link do restante já foi enviado ao paciente, ele deixa de valer/),
    ).toBeTruthy();
  });

  it('com o sinal pago, a ação vira Restante em dinheiro', () => {
    render(
      <CaixaView
        {...base}
        canOperate
        methods={[
          { code: 'pix', label: 'PIX' },
          { code: 'dinheiro', label: 'Dinheiro' },
          { code: 'cartao_credito', label: 'Cartão de crédito' },
        ]}
        pendentes={[item({ commercialPaymentMethod: 'pix', status: 'parcial', valorPago: 100 })]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Restante em dinheiro' }));
    expect((screen.getByLabelText('Valor recebido') as HTMLInputElement).value).toBe('100.00');
  });

  it('sem dinheiro no catálogo, nem conta a pagar, não há botão de dinheiro', () => {
    render(<CaixaView {...base} canOperate pendentes={[item(), payable()]} />);
    expect(screen.queryByRole('button', { name: /(Recebido|Restante) em dinheiro/ })).toBeNull();
    // Os nomes antigos também não podem voltar.
    expect(screen.queryByRole('button', { name: /Pagou (o restante )?em dinheiro/ })).toBeNull();
  });

  it('operate:caixa mostra ações de receber/cancelar; sem permissão não mostra', () => {
    // Cancelar vive DENTRO do painel de confirmação (uma ação por linha na
    // fila) — por isso o teste abre o painel antes de procurá-lo.
    const { unmount } = render(<CaixaView {...base} canOperate pendentes={[item()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar recebimento' }));
    expect(screen.getByRole('button', { name: 'Cancelar cobrança de João Silva' })).toBeTruthy();

    unmount();
    render(<CaixaView {...base} canOperate={false} canRefund={false} pendentes={[item()]} />);
    expect(screen.queryByRole('button', { name: 'Registrar recebimento' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancelar cobrança/ })).toBeNull();
  });

  it('anuncia a cobrança que falhou e nunca chegou ao paciente', () => {
    // Falha silenciosa: sem link, o paciente nao recebe lembrete e ninguem
    // reclama. Se o Caixa nao mostrar, nada mostra.
    render(
      <CaixaView
        {...base}
        failedCharges={[
          {
            chargeId: 'pc1',
            appointmentId: 'a1',
            patientId: 'p1',
            amount: 562,
            failureCode: 'checkout_response_invalid',
            failedAt: '2026-09-10T12:00:00.000Z',
            pacienteNome: 'Heitor Fontes Barreto',
          },
        ]}
      />,
    );

    expect(
      screen.getByText(
        'Falha operacional: a cobrança de Heitor Fontes Barreto não foi enviada ao paciente',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/link nunca gerado/)).toBeTruthy();
    expect(screen.getByText('checkout_response_invalid')).toBeTruthy();
  });

  it('cancelamento exige confirmação contextual antes da action idempotente', async () => {
    render(<CaixaView {...base} pendentes={[item()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Registrar recebimento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar cobrança de João Silva' }));
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
    expect(screen.getByRole('region', { name: 'Recebidos hoje' })).toBeTruthy();
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
    expect(screen.getByRole('region', { name: 'Recebidos hoje' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reembolsar' })).toBeNull();
  });

  it('expõe bruto, taxa, líquido e snapshot do repasse sem inventar antecipação', () => {
    const pago = item({
      status: 'pago',
      paidAt: '2026-06-06T10:00:00.000Z',
      valor: 250,
      valorPago: 250,
      paymentMethod: 'pix',
      paymentEconomics: {
        appointmentId: 'a1',
        providerGrossAmount: 250,
        providerFeeAmount: 5,
        earlySettlementFeeAmount: null,
        providerNetAmount: 245,
        payout: {
          id: 'payout-1',
          calculationBasis: 'gross',
          basisAmount: 250,
          payoutAmount: 125,
          status: 'calculated',
          review: null,
          reviewBounds: null,
        },
      },
    });

    render(<CaixaView {...base} showAdvancedFinancialDetails pagosHoje={[pago]} />);

    expect(screen.getByText('Composição do atendimento')).toBeTruthy();
    expect(screen.getByText('Valor do atendimento')).toBeTruthy();
    expect(screen.getByText('Valor recebido alocado')).toBeTruthy();
    expect(screen.getByText('Tarifa real alocada')).toBeTruthy();
    expect(screen.getByText('Custo de antecipação')).toBeTruthy();
    expect(screen.getByText('Não informado')).toBeTruthy();
    expect(screen.getByText('Base do repasse')).toBeTruthy();
    expect(screen.getByText('Bruto')).toBeTruthy();
    expect(screen.getByText('Repasse profissional')).toBeTruthy();
    expect(screen.getByText(/R\$\s*125,00/)).toBeTruthy();
  });

  it('identifica o repasse suspenso após reversão sem apresentar valor a pagar', () => {
    const pago = item({
      status: 'pago',
      paidAt: '2026-06-06T10:00:00.000Z',
      valor: 250,
      valorPago: 250,
      paymentEconomics: {
        appointmentId: 'a1',
        providerGrossAmount: 250,
        providerFeeAmount: 5,
        earlySettlementFeeAmount: null,
        providerNetAmount: 245,
        payout: {
          id: 'payout-1',
          calculationBasis: 'net',
          basisAmount: null,
          payoutAmount: null,
          status: 'cancelled',
          review: null,
          reviewBounds: null,
        },
      },
    });

    render(<CaixaView {...base} showAdvancedFinancialDetails pagosHoje={[pago]} />);

    expect(screen.getByText('Suspenso')).toBeTruthy();
    expect(screen.getByText(/Revise o valor devido antes de pagar o profissional/)).toBeTruthy();
  });

  describe('revisão humana do repasse suspenso', () => {
    const suspended = (
      payout: Partial<NonNullable<NonNullable<CaixaItem['paymentEconomics']>['payout']>> = {},
    ) =>
      item({
        status: 'pago',
        paidAt: '2026-06-06T10:00:00.000Z',
        valor: 150,
        valorPago: 100,
        paymentEconomics: {
          appointmentId: 'a1',
          providerGrossAmount: 100,
          providerFeeAmount: null,
          earlySettlementFeeAmount: null,
          providerNetAmount: null,
          payout: {
            id: 'payout-1',
            calculationBasis: 'gross',
            basisAmount: null,
            payoutAmount: null,
            status: 'cancelled',
            review: null,
            reviewBounds: { ceilingAmount: 75, referenceAmount: 50 },
            ...payout,
          },
        },
      });

    it('sinaliza repasse fixo acima da base sem impedir nem recalcular (decisão de 07/10)', () => {
      render(
        <CaixaView
          {...base}
          showAdvancedFinancialDetails
          pagosHoje={[
            suspended({
              status: 'calculated',
              basisAmount: 80,
              payoutAmount: 100,
              reviewBounds: null,
            }),
          ]}
        />,
      );
      expect(
        screen.getByText(
          /Repasse acima do recebido: R\$\s*100,00 para uma base de R\$\s*80,00\. A regra fixa paga o valor inteiro/u,
        ),
      ).toBeTruthy();
    });

    it('repasse dentro da base não ganha aviso', () => {
      render(
        <CaixaView
          {...base}
          showAdvancedFinancialDetails
          pagosHoje={[
            suspended({
              status: 'calculated',
              basisAmount: 150,
              payoutAmount: 75,
              reviewBounds: null,
            }),
          ]}
        />,
      );
      expect(screen.queryByText(/Repasse acima do recebido/u)).toBeNull();
    });

    it('MANAGE_FINANCIAL registra a versão 1 com teto e referência só informativa', async () => {
      vi.mocked(reviewProfessionalPayoutAction).mockResolvedValue({
        ok: true,
        data: {
          payoutId: 'payout-1',
          version: 1,
          decidedAmount: 60,
          ceilingAmount: 75,
          referenceAmount: 50,
          decidedAt: '2026-10-07T15:00:00.000Z',
        },
      });
      render(
        <CaixaView
          {...base}
          showAdvancedFinancialDetails
          canReviewPayout
          pagosHoje={[suspended()]}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Revisar repasse' }));
      expect(screen.getByText(/Teto:\s*R\$\s*75,00, o cálculo original\./)).toBeTruthy();
      expect(screen.getByText(/R\$\s*50,00 \(não é aplicada sozinha\)/)).toBeTruthy();
      const submit = screen.getByRole('button', { name: 'Registrar versão 1' });
      expect((submit as HTMLButtonElement).disabled).toBe(true);

      fireEvent.change(screen.getByLabelText('Valor devido ao profissional'), {
        target: { value: '75,01' },
      });
      expect(screen.getByText('Valor fora do limite permitido.')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Valor devido ao profissional'), {
        target: { value: '60,00' },
      });
      fireEvent.change(screen.getByLabelText('Motivo da decisão'), {
        target: { value: 'Devolução parcial acordada com o profissional.' },
      });
      expect((submit as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(submit);

      await waitFor(() =>
        expect(reviewProfessionalPayoutAction).toHaveBeenCalledWith(
          {
            payoutId: 'payout-1',
            amount: 60,
            reason: 'Devolução parcial acordada com o profissional.',
          },
          expect.any(String),
        ),
      );
    });

    it('sem MANAGE_FINANCIAL mostra a suspensão, mas não oferece revisar', () => {
      render(<CaixaView {...base} showAdvancedFinancialDetails pagosHoje={[suspended()]} />);
      expect(screen.getByText('Suspenso')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Revisar repasse' })).toBeNull();
    });

    it('exibe a versão vigente e permite registrar a seguinte', () => {
      render(
        <CaixaView
          {...base}
          showAdvancedFinancialDetails
          canReviewPayout
          pagosHoje={[
            suspended({
              status: 'reviewed',
              basisAmount: 150,
              payoutAmount: 60,
              review: { version: 1, decidedAmount: 60, decidedAt: '2026-10-07T15:00:00.000Z' },
            }),
          ]}
        />,
      );
      expect(screen.getByText(/Repasse revisado na versão 1:\s*R\$\s*60,00/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Registrar nova revisão' }));
      expect(screen.getByRole('button', { name: 'Registrar versão 2' })).toBeTruthy();
    });

    it('sem líquido original não abre formulário nem inventa teto', () => {
      render(
        <CaixaView
          {...base}
          showAdvancedFinancialDetails
          canReviewPayout
          pagosHoje={[suspended({ calculationBasis: 'net', reviewBounds: null })]}
        />,
      );
      expect(screen.getByText(/depende do líquido original informado pelo provedor/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Revisar repasse' })).toBeNull();
    });
  });

  it('mostra bruto, tarifa e líquido reais no Solo sem seção de repasse', () => {
    render(
      <CaixaView
        {...base}
        pagosHoje={[
          item({
            status: 'pago',
            paidAt: '2026-06-06T10:00:00.000Z',
            valor: 250,
            valorPago: 250,
            paymentMethod: 'pix',
            paymentEconomics: {
              appointmentId: 'a1',
              providerGrossAmount: 255,
              providerFeeAmount: 5,
              earlySettlementFeeAmount: 2,
              providerNetAmount: 250,
              payout: null,
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText('Valor recebido alocado')).toBeTruthy();
    expect(screen.getByText('Tarifa real alocada')).toBeTruthy();
    expect(screen.getByText('Líquido real alocado')).toBeTruthy();
    expect(screen.getByText(/R\$\s*255,00/)).toBeTruthy();
    expect(screen.getByText('− R$ 5,00')).toBeTruthy();
    expect(screen.queryByText('Custo de antecipação')).toBeNull();
    expect(screen.queryByText('Repasse profissional')).toBeNull();
    expect(screen.queryByText('Sem repasse separado')).toBeNull();
  });

  it('discrimina sinal e restante no Solo sem converter fato ausente em tarifa zero', () => {
    render(
      <CaixaView
        {...base}
        pagosHoje={[
          item({
            status: 'pago',
            paidAt: '2026-06-06T10:00:00.000Z',
            chargeEconomics: [
              {
                chargeId: 'c1',
                appointmentId: 'a1',
                kind: 'deposit',
                status: 'paid',
                requestedAmount: 50,
                providerGrossAmount: 50,
                providerFeeAmount: 0,
                providerNetAmount: 50,
              },
              {
                chargeId: 'c2',
                appointmentId: 'a1',
                kind: 'remainder',
                status: 'pending',
                requestedAmount: 150,
                providerGrossAmount: null,
                providerFeeAmount: null,
                providerNetAmount: null,
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByText('Cada cobrança Asaas')).toBeTruthy();
    expect(screen.getByText('Sinal')).toBeTruthy();
    expect(screen.getByText('Restante')).toBeTruthy();
    expect(screen.getByText('Pendente')).toBeTruthy();
    expect(screen.getByText('− R$ 0,00')).toBeTruthy();
    expect(screen.getAllByText('Não informado').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('Repasse profissional')).toBeNull();
  });

  it('mantém o detalhe de antecipação no premium mesmo sem repasse profissional', () => {
    render(
      <CaixaView
        {...base}
        showAdvancedFinancialDetails
        pagosHoje={[
          item({
            status: 'pago',
            paidAt: '2026-06-06T10:00:00.000Z',
            paymentMethod: 'pix',
            paymentEconomics: {
              appointmentId: 'a1',
              providerGrossAmount: 200,
              providerFeeAmount: 5,
              earlySettlementFeeAmount: 2,
              providerNetAmount: 193,
              payout: null,
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText('Custo de antecipação')).toBeTruthy();
    expect(screen.getByText('− R$ 2,00')).toBeTruthy();
    expect(screen.queryByText('Repasse profissional')).toBeNull();
  });

  it('mostra valores desconhecidos como não informados, inclusive sem linha econômica', () => {
    render(<CaixaView {...base} pendentes={[item({ paymentEconomics: null })]} />);

    expect(screen.getByText('Composição do atendimento')).toBeTruthy();
    expect(screen.getAllByText('Não informado')).toHaveLength(3);
    expect(screen.queryByText('Repasse profissional')).toBeNull();
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
    expect(screen.getByText(/ainda não foi faturado/i)).toBeTruthy();

    unmount();
    render(<CaixaView {...base} pendencias={[]} />);
    expect(screen.queryByText(/ainda não foi faturado/i)).toBeNull();
  });

  it.each([
    ['manual', /pendente de ação da clínica/i],
    ['waiting', /aguardando confirmação da devolução/i],
    ['confirmed', /estorno confirmado pelo Asaas/i],
    ['cancelled', /valor não foi devolvido/i],
    ['failed', /devolução não foi concluída/i],
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

  it('mostra ao operador a devolução manual sem afirmar que o paciente já recebeu', () => {
    render(
      <CaixaView
        {...base}
        manualRefundTasks={[
          {
            id: 'intent-1',
            appointmentId: 'apt-1',
            patientId: 'patient-1',
            providerPaymentId: 'pay_1',
            amount: 150,
            purpose: 'deposit_closeout',
            state: 'action_required',
            pacienteNome: 'Paciente de teste',
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByText(/1 devolução de paciente pendente de verificação/i));
    expect(screen.getByText(/Confira se já há estorno em andamento/i)).toBeTruthy();
    expect(screen.getByText(/Cobrança Asaas:/i)).toBeTruthy();
    expect(screen.queryByText(/estorno confirmado pelo Asaas/i)).toBeNull();
  });

  it('avisa quando o Qoro não conseguiu ler o Asaas antes da ação humana', () => {
    render(
      <CaixaView
        {...base}
        manualRefundTasks={[
          {
            id: 'intent-readback',
            appointmentId: 'apt-1',
            patientId: 'patient-1',
            providerPaymentId: 'pay_1',
            amount: 30,
            purpose: 'excess',
            state: 'readback_unavailable',
            pacienteNome: 'Paciente de teste',
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByText(/1 devolução de paciente pendente de verificação/i));
    expect(screen.getByText(/ainda não conseguiu verificar esta cobrança no Asaas/i)).toBeTruthy();
    expect(screen.queryByText(/faça a devolução na conta Asaas/i)).toBeNull();
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
    expect(screen.getByText(/aguarda revisão humana antes do envio/i)).toBeTruthy();
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
    expect(screen.getByText('11–11 de 11')).toBeTruthy();
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
