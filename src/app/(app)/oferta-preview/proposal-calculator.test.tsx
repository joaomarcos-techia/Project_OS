// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProposalCalculator } from './proposal-calculator';

afterEach(cleanup);

describe('prévia da proposta comercial', () => {
  it('atualiza preço e anual conforme a quantidade de profissionais', () => {
    render(<ProposalCalculator />);
    fireEvent.change(screen.getByLabelText('Profissionais com agenda própria'), {
      target: { value: '3' },
    });
    expect(screen.getByText(/R\$\s*544,00\/mês/)).toBeTruthy();
    expect(screen.getByText(/R\$\s*5\.440,00/)).toBeTruthy();
  });

  it('não apresenta preço para contagem fora do limite', () => {
    render(<ProposalCalculator />);
    fireEvent.change(screen.getByLabelText('Profissionais com agenda própria'), {
      target: { value: '11' },
    });
    expect(screen.getByRole('alert').textContent).toContain('1 a 10 profissionais');
    expect(screen.queryByText(/R\$\s*397,00\/mês/)).toBeNull();
  });
});
