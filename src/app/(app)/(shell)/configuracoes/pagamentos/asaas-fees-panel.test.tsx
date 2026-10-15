// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getFees } = vi.hoisted(() => ({ getFees: vi.fn() }));
vi.mock('./actions', () => ({ getPaymentAccountFeesAction: getFees }));

import { AsaasFeesPanel } from './asaas-fees-panel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AsaasFeesPanel', () => {
  it('consulta automaticamente as condições da conta conectada', async () => {
    getFees.mockResolvedValue({
      ok: true,
      data: {
        pix: {
          regular: 1.99,
          discounted: 0.99,
          discountExpiration: '2026-11-22 00:00:00',
        },
        creditCard: {
          operationValue: 0.49,
          oneInstallmentPercentage: 2.99,
          discountedOneInstallmentPercentage: 1.99,
          hasValidDiscount: true,
          discountExpiration: '2026-11-22 00:00:00',
        },
      },
    });
    render(<AsaasFeesPanel hasApiKey />);
    await waitFor(() => expect(getFees).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/R\$\s*1,99 por recebimento/)).toBeTruthy();
    expect(screen.getByText(/2,99%/)).toBeTruthy();
    expect(screen.getAllByText(/validade informada: 22\/11\/2026/)).toHaveLength(2);
    expect(
      screen.getByRole('link', { name: /Definir preços ao paciente/ }).getAttribute('href'),
    ).toBe('#precos-por-meio');
  });

  it('sem conta conectada não chama o Asaas', () => {
    render(<AsaasFeesPanel hasApiKey={false} />);
    expect(getFees).not.toHaveBeenCalled();
  });
});
