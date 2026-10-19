// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProposalCalculator } from './proposal-calculator';
import OfertaPreviewPage from './page';

afterEach(cleanup);

describe('prévia da proposta comercial', () => {
  it('mostra a equipe incluída sem oferecer contratação', () => {
    render(<OfertaPreviewPage />);
    expect(screen.getByText(/R\$ 147.*\/mês por médico adicional/s)).toBeTruthy();
    expect(screen.getByText(/até 3 logins de equipe/)).toBeTruthy();
    expect(screen.getByText(/O cadastro atual ainda limita todos os logins juntos/)).toBeTruthy();
    expect(screen.getByText(/A contratação dessa oferta ainda não está disponível/)).toBeTruthy();
  });

  it('limita a equipe a três logins nos dois planos', () => {
    render(<ProposalCalculator />);
    const staff = screen.getByLabelText('Logins de equipe: recepção, gestão e financeiro');
    fireEvent.change(staff, { target: { value: '2' } });
    expect(screen.getByText(/R\$\s*397,00\/mês/)).toBeTruthy();
    fireEvent.change(staff, { target: { value: '3' } });
    expect(screen.getByText(/R\$\s*397,00\/mês/)).toBeTruthy();
    fireEvent.change(staff, { target: { value: '4' } });
    expect(screen.getByRole('alert').textContent).toContain('até 3 logins de equipe');
    fireEvent.change(staff, { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Médicos que atendem em agenda clínica'), {
      target: { value: '1' },
    });
    fireEvent.change(staff, { target: { value: '4' } });
    expect(screen.getByRole('alert').textContent).toContain('Consultório e Clínica incluem até 3');
  });

  it('atualiza preço e anual conforme a quantidade de profissionais', () => {
    render(<ProposalCalculator />);
    fireEvent.change(screen.getByLabelText('Médicos que atendem em agenda clínica'), {
      target: { value: '3' },
    });
    expect(screen.getByText(/R\$\s*544,00\/mês/)).toBeTruthy();
    expect(screen.getByText(/R\$\s*5\.440,00/)).toBeTruthy();
  });

  it('não apresenta preço para contagem fora do limite', () => {
    render(<ProposalCalculator />);
    fireEvent.change(screen.getByLabelText('Médicos que atendem em agenda clínica'), {
      target: { value: '6' },
    });
    expect(screen.getByRole('alert').textContent).toContain('1 a 5 médicos');
    expect(screen.queryByText(/R\$\s*397,00\/mês/)).toBeNull();
  });
});
