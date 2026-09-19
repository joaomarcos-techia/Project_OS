import { describe, expect, it } from 'vitest';

import { LancamentoStateError } from './errors';
import {
  assertLancamentoTransition,
  atendimentoDescricao,
  calcStatusPagamento,
  canTransitionLancamento,
  estornoDescricao,
  estornoTipoOposto,
  isEstornoIntegral,
  isTerminalLancamento,
  round2,
  allocateCreditsTo,
  statusAoCriar,
} from './logic';
import type { LancamentoStatus } from './types';

// --- state machine ---------------------------------------------------------

describe('financial state machine — transições válidas', () => {
  const valid: Array<[LancamentoStatus, LancamentoStatus]> = [
    ['pendente', 'parcial'],
    ['pendente', 'pago'],
    ['pendente', 'cancelado'],
    ['pendente', 'estornado'],
    ['parcial', 'parcial'],
    ['parcial', 'pago'],
    ['parcial', 'cancelado'],
    ['parcial', 'estornado'],
    ['pago', 'estornado'],
  ];
  it.each(valid)('%s → %s permitido', (from, to) => {
    expect(canTransitionLancamento(from, to)).toBe(true);
    expect(() => assertLancamentoTransition(from, to)).not.toThrow();
  });
});

describe('financial state machine — transições inválidas', () => {
  const invalid: Array<[LancamentoStatus, LancamentoStatus]> = [
    ['pago', 'pago'], // pago não recebe novo pagamento
    ['pago', 'cancelado'], // nunca cancelar pago
    ['pago', 'parcial'], // não regride
    ['cancelado', 'pago'], // terminal
    ['cancelado', 'estornado'], // terminal
    ['estornado', 'pago'], // terminal
    ['estornado', 'cancelado'], // terminal
  ];
  it.each(invalid)('%s → %s bloqueado', (from, to) => {
    expect(canTransitionLancamento(from, to)).toBe(false);
    expect(() => assertLancamentoTransition(from, to)).toThrow(LancamentoStateError);
  });
});

describe('isTerminalLancamento', () => {
  it('cancelado e estornado são terminais', () => {
    expect(isTerminalLancamento('cancelado')).toBe(true);
    expect(isTerminalLancamento('estornado')).toBe(true);
    expect(isTerminalLancamento('pendente')).toBe(false);
    expect(isTerminalLancamento('parcial')).toBe(false);
    expect(isTerminalLancamento('pago')).toBe(false);
  });
});

// --- helpers de pagamento --------------------------------------------------

describe('calcStatusPagamento', () => {
  it('pago quando total >= valor', () => {
    expect(calcStatusPagamento(300, 300)).toBe('pago');
    expect(calcStatusPagamento(300, 350)).toBe('pago');
  });
  it('parcial quando total < valor', () => {
    expect(calcStatusPagamento(300, 100)).toBe('parcial');
    expect(calcStatusPagamento(300, 299.99)).toBe('parcial');
  });
  it('imune a drift de ponto flutuante', () => {
    expect(calcStatusPagamento(0.3, 0.1 + 0.2)).toBe('pago');
  });
});

describe('round2', () => {
  it('arredonda para centavos', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(100.005)).toBe(100.01);
  });
});

// --- estorno + descrições --------------------------------------------------

describe('estornoTipoOposto', () => {
  it('inverte tipo', () => {
    expect(estornoTipoOposto('receber')).toBe('pagar');
    expect(estornoTipoOposto('pagar')).toBe('receber');
  });
});

describe('builders de descrição', () => {
  it('atendimento', () => {
    expect(atendimentoDescricao('Consulta Clínica')).toBe('Atendimento - Consulta Clínica');
  });
  it('estorno', () => {
    expect(estornoDescricao('Atendimento - Consulta Clínica')).toBe(
      'Estorno - Atendimento - Consulta Clínica',
    );
  });
});

describe('isEstornoIntegral', () => {
  it('só encerra o lançamento quando todos os pagamentos foram devolvidos', () => {
    expect(isEstornoIntegral(100, 99.99)).toBe(false);
    expect(isEstornoIntegral(100, 100)).toBe(true);
    expect(isEstornoIntegral(0.3, 0.1 + 0.2)).toBe(true);
  });
});

/**
 * ADR-051 1.5b.2 — como um lançamento NASCE quando já existe dinheiro alocado.
 *
 * A armadilha que estas funções existem para evitar: `calcStatusPagamento` nunca
 * devolve `pendente` (com 0 pago ela responde `parcial`), e a esmagadora maioria
 * dos atendimentos não tem sinal nenhum.
 */
describe('statusAoCriar', () => {
  it('sem crédito nenhum é PENDENTE — o caso da maioria dos atendimentos', () => {
    expect(statusAoCriar(200, 0)).toBe('pendente');
    // Contraste explícito com a função que ele não pode substituir:
    expect(calcStatusPagamento(200, 0)).toBe('parcial');
  });

  it('crédito menor que o valor é PARCIAL', () => {
    expect(statusAoCriar(200, 100)).toBe('parcial');
  });

  it('crédito que cobre tudo é PAGO', () => {
    expect(statusAoCriar(200, 200)).toBe('pago');
    expect(statusAoCriar(200, 250)).toBe('pago');
  });

  it('centavos residuais não deixam um lançamento quitado como parcial', () => {
    expect(statusAoCriar(0.1 + 0.2, 0.3)).toBe('pago');
  });
});

describe('allocateCreditsTo', () => {
  it('sem crédito, não aloca nada', () => {
    expect(allocateCreditsTo(200, [])).toEqual({ allocations: [], total: 0 });
  });

  it('o caso do sinal de 50%: consome o crédito inteiro', () => {
    const r = allocateCreditsTo(200, [{ id: 'c1', amount: 100 }]);

    expect(r.total).toBe(100);
    expect(r.allocations).toEqual([{ id: 'c1', amount: 100 }]);
  });

  it('nunca aloca mais do que o lançamento vale (invariante 4)', () => {
    // Reajuste de valor para baixo depois do sinal pago: a sobra NÃO vira
    // `valorPago`, senão o recebível ficaria quitado sem lastro.
    const r = allocateCreditsTo(80, [{ id: 'c1', amount: 100 }]);

    expect(r.total).toBe(80);
    expect(r.allocations).toEqual([{ id: 'c1', amount: 80 }]);
  });

  it('consome na ORDEM recebida e para quando cobre o valor', () => {
    const r = allocateCreditsTo(150, [
      { id: 'c1', amount: 100 },
      { id: 'c2', amount: 100 },
      { id: 'c3', amount: 100 },
    ]);

    // O terceiro não é tocado: já estava coberto.
    expect(r.allocations).toEqual([
      { id: 'c1', amount: 100 },
      { id: 'c2', amount: 50 },
    ]);
    expect(r.total).toBe(150);
  });

  it('valor zero não aloca — não há obrigação a quitar', () => {
    expect(allocateCreditsTo(0, [{ id: 'c1', amount: 100 }])).toEqual({
      allocations: [],
      total: 0,
    });
  });

  it('crédito de valor zero é ignorado, não vira alocação vazia', () => {
    const r = allocateCreditsTo(200, [
      { id: 'c1', amount: 0 },
      { id: 'c2', amount: 50 },
    ]);

    expect(r.allocations).toEqual([{ id: 'c2', amount: 50 }]);
  });

  it('soma em centavos, sem erro de ponto flutuante', () => {
    const r = allocateCreditsTo(100, [
      { id: 'c1', amount: 0.1 },
      { id: 'c2', amount: 0.2 },
    ]);

    expect(r.total).toBe(0.3);
  });
});
