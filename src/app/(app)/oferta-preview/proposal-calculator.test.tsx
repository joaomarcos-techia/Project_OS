// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProposalCalculator } from './proposal-calculator';
import OfertaPreviewPage from './page';

afterEach(cleanup);

describe('prévia da proposta comercial', () => {
  it('mostra os preços de logins adicionais sem oferecer contratação', () => {
    render(<OfertaPreviewPage />);
    expect(screen.getByText(/R\$ 147\/mês por profissional/)).toBeTruthy();
    expect(screen.getByText(/R\$ 79\/mês por login de equipe/)).toBeTruthy();
    expect(screen.getByText(/A compra de logins ainda não está disponível/)).toBeTruthy();
  });

  it('atualiza a proposta somente quando a equipe excede a cota incluída', () => {
    render(<ProposalCalculator />);
    const staff = screen.getByLabelText('Logins de equipe sem agenda própria');
    fireEvent.change(staff, { target: { value: '2' } });
    expect(screen.getByText(/R\$\s*397,00\/mês/)).toBeTruthy();
    fireEvent.change(staff, { target: { value: '3' } });
    expect(screen.getByText(/R\$\s*476,00\/mês/)).toBeTruthy();
    fireEvent.change(staff, { target: { value: '11' } });
    expect(screen.getByRole('alert').textContent).toContain('0 a 10 logins de equipe');
  });

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
