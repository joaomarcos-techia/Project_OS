// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./lancamento-actions', () => ({ createLancamentoFormAction: vi.fn() }));

import { LancamentoForm } from './lancamento-form';

describe('LancamentoForm', () => {
  it('associa cada rótulo ao controle visível do lançamento manual', () => {
    render(<LancamentoForm suppliers={[]} methods={[]} />);

    expect(screen.getByLabelText('Tipo').getAttribute('id')).toBe('lancamento-type');
    expect(screen.getByLabelText('Descrição').getAttribute('id')).toBe('lancamento-description');
    expect(screen.getByLabelText('Valor (R$)').getAttribute('id')).toBe('lancamento-value');
    expect(screen.getByLabelText('Vencimento').getAttribute('id')).toBe('lancamento-due-date');
    expect(screen.getByLabelText('Forma de pagamento').getAttribute('id')).toBe(
      'lancamento-payment-method',
    );
  });
});
