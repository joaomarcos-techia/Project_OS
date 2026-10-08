// @vitest-environment happy-dom
/**
 * O modelo de pagamento fica claro na tela do sinal (decisão do usuário,
 * 08/10/2026): com sinal, o horário só se confirma com o sinal pago pelo link e
 * o restante pode ser pago em dinheiro; sem sinal, não há pagamento antecipado.
 * E o texto aponta para as ações que existem no Caixa.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ saveDepositPolicyAction: vi.fn() }));

import { DepositPolicyForm } from './deposit-policy-form';

const POLICY = {
  enabled: true,
  percent: 50,
  cancellationWindowHours: 24,
  appliesToFirstVisit: true,
  appliesToReturn: true,
  updatedAt: null,
};

afterEach(cleanup);

describe('DepositPolicyForm — como o paciente paga', () => {
  it('explica sinal pelo link, restante em dinheiro e o caso sem sinal', () => {
    render(<DepositPolicyForm policy={POLICY} hasAccount />);
    expect(screen.getByText('Como o paciente paga')).toBeTruthy();
    expect(
      screen.getByText(/o horário só é confirmado depois que o paciente paga o sinal pelo/),
    ).toBeTruthy();
    expect(screen.getByText(/O restante pode ser pago na clínica, inclusive em dinheiro/)).toBeTruthy();
    expect(screen.getByText(/Com o sinal desligado, o agendamento não exige pagamento antecipado/)).toBeTruthy();
  });

  it('cita as ações que existem no Caixa', () => {
    render(<DepositPolicyForm policy={{ ...POLICY, enabled: false }} hasAccount />);
    expect(screen.getByText(/Pagou o\s+restante em dinheiro/)).toBeTruthy();
    expect(screen.getByText(/“Pagou em dinheiro”/)).toBeTruthy();
  });
});
