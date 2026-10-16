// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({
  removeProfessionalPayoutRuleAction: vi.fn(),
  saveProfessionalPayoutPolicyAction: vi.fn(),
  saveProfessionalPayoutRuleAction: vi.fn(),
}));

import { FinancialPoliciesPanel } from './financial-policies-panel';

const payout = { basis: 'gross' as const, updatedAt: null };

afterEach(cleanup);

describe('FinancialPoliciesPanel', () => {
  it('explica preço bruto, tarifa efetiva e repasse sem prometer taxa fixa', () => {
    render(
      <FinancialPoliciesPanel
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
    expect(screen.getByText(/independentemente de ele escolher Pix ou cartão/)).toBeTruthy();
    expect(screen.queryByText('Preços por meio de pagamento')).toBeNull();
  });

  it('mantém a configuração de repasse sem exigir preço por método', () => {
    render(
      <FinancialPoliciesPanel
        payoutPolicy={payout}
        payoutRules={[]}
        professionals={[]}
        procedures={[]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Salvar base de repasse' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salvar política de preço' })).toBeNull();
  });
});
