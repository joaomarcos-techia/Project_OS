import { describe, expect, it } from 'vitest';

import type { CaixaItem } from '@/contexts/financial/types';

import { cashActionLabel, registerActionLabel } from './cash-action-panels';

// UX-015 (docs/otimização_ui_final.md), aprovado pelo fundador em 15/11/2026: o
// rótulo diz o que o clique registra; nenhuma destas ações cobra alguém.
describe('rótulos das ações de pagamento do Caixa', () => {
  it('recebível em aberto: Registrar recebimento; parcial: Registrar o restante', () => {
    expect(registerActionLabel({ tipo: 'receber', status: 'pendente' })).toBe(
      'Registrar recebimento',
    );
    expect(registerActionLabel({ tipo: 'receber', status: 'parcial' })).toBe(
      'Registrar o restante',
    );
  });

  it('conta a pagar: Registrar pagamento (o botão não paga nada, registra)', () => {
    expect(registerActionLabel({ tipo: 'pagar', status: 'pendente' })).toBe('Registrar pagamento');
  });

  it('atalho do dinheiro: Recebido em dinheiro, ou Restante em dinheiro com parte paga', () => {
    expect(cashActionLabel({ valorPago: 0 } as CaixaItem)).toBe('Recebido em dinheiro');
    expect(cashActionLabel({ valorPago: 50 } as CaixaItem)).toBe('Restante em dinheiro');
  });
});
