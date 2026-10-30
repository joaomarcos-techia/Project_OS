// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProposalCalculator } from './proposal-calculator';
import OfertaPreviewPage from './page';

afterEach(cleanup);

describe('prévia da proposta comercial', () => {
  it('distingue planos de entrada no DEV de itens ainda não contratáveis', () => {
    render(<OfertaPreviewPage />);
    expect(screen.getByText(/R\$ 147.*\/mês por médico adicional/s)).toBeTruthy();
    expect(screen.getByText(/até 3 logins de equipe/)).toBeTruthy();
    expect(
      screen.getByText(/Consultório e Clínica com dois médicos estão habilitados/),
    ).toBeTruthy();
    expect(
      screen.getByText(/A vaga adicional é contratada na assinatura da clínica já ativa/),
    ).toBeTruthy();
    expect(
      screen.getByText(/desde a criação da conta, sem reiniciar após o checkout/),
    ).toBeTruthy();
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

  it('atualiza o preço mensal e não oferece contratação anual', () => {
    render(<ProposalCalculator />);
    fireEvent.change(screen.getByLabelText('Médicos que atendem em agenda clínica'), {
      target: { value: '3' },
    });
    expect(screen.getByText(/R\$\s*544,00\/mês/)).toBeTruthy();
    expect(
      screen.getByText('3 médicos + 1 acesso administrativo na simulação. As cotas são separadas.'),
    ).toBeTruthy();
    expect(screen.queryByText(/R\$\s*5\.440,00/)).toBeNull();
    expect(screen.getByText(/A modalidade anual não está disponível nesta etapa/)).toBeTruthy();
  });

  it('separa cinco logins incluídos na Clínica base de oito após comprar vagas médicas', () => {
    render(<ProposalCalculator />);
    const staff = screen.getByLabelText('Logins de equipe: recepção, gestão e financeiro');
    fireEvent.change(staff, { target: { value: '3' } });
    expect(
      screen.getByText(
        'Este preço inclui 2 médicos + até 3 administrativos: até 5 pessoas no total.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/R\$\s*397,00\/mês/)).toBeTruthy();
    expect(screen.getByText(/já está incluído nos 3 acessos administrativos/u)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Médicos que atendem em agenda clínica'), {
      target: { value: '5' },
    });
    expect(
      screen.getByText(
        'Este preço inclui 5 médicos + até 3 administrativos: até 8 pessoas no total.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/R\$\s*838,00\/mês/)).toBeTruthy();
    fireEvent.change(staff, { target: { value: '4' } });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/Este preço inclui/u)).toBeNull();
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
