// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({
  removeProcedurePaymentPriceAction: vi.fn(),
  removeProfessionalPayoutRuleAction: vi.fn(),
  savePaymentPricingPolicyAction: vi.fn(),
  saveProcedurePaymentPriceAction: vi.fn(),
  saveProfessionalPayoutPolicyAction: vi.fn(),
  saveProfessionalPayoutRuleAction: vi.fn(),
}));

import { FinancialPoliciesPanel } from './financial-policies-panel';

const policy = { mode: 'absorb_fees' as const, updatedAt: null };
const payout = { basis: 'gross' as const, updatedAt: null };

afterEach(cleanup);

describe('FinancialPoliciesPanel', () => {
  it('explica preço bruto, tarifa efetiva e repasse sem prometer taxa fixa', () => {
    render(
      <FinancialPoliciesPanel
        pricingPolicy={policy}
        methodPrices={[]}
        payoutPolicy={payout}
        payoutRules={[]}
        professionals={[]}
        procedures={[]}
      />,
    );

    expect(screen.getByText('Como configurar preços, taxas e repasse')).toBeTruthy();
    expect(screen.getByText(/A tarifa não é cadastrada aqui/)).toBeTruthy();
    expect(screen.getByText(/Sem regra, não há repasse automático/)).toBeTruthy();
    expect(screen.getByText(/R\$ 72,50/)).toBeTruthy();
    expect(screen.getByText(/Cadastre um procedimento na Agenda/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Preços por meio de pagamento' }).getAttribute('href'),
    ).toBe('#precos-por-meio');
  });

  it('não oferece ativação sem qualquer preço por método', () => {
    render(
      <FinancialPoliciesPanel
        pricingPolicy={policy}
        methodPrices={[]}
        payoutPolicy={payout}
        payoutRules={[]}
        professionals={[]}
        procedures={[]}
      />,
    );

    fireEvent.click(screen.getByText('Preço por meio de pagamento', { exact: true }));
    expect(
      screen.getByRole('button', { name: 'Salvar política de preço' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByText(/Cadastre pelo menos um preço/)).toBeTruthy();
  });
});
