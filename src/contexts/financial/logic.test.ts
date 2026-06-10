import { describe, expect, it } from 'vitest';

import { LancamentoStateError } from './errors';
import {
  assertLancamentoTransition,
  atendimentoDescricao,
  calcStatusPagamento,
  canTransitionLancamento,
  estornoDescricao,
  estornoTipoOposto,
  isTerminalLancamento,
  round2,
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
