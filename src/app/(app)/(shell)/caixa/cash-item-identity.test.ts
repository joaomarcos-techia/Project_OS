import { describe, expect, it } from 'vitest';

import { cashItemDetail, cashItemTitle } from './cash-item-identity';

const base = {
  tipo: 'receber' as const,
  descricao: 'Taxa de remarcação',
  pacienteNome: null,
  snapshotProcedureName: null,
};

// UX-015 (docs/otimização_ui_final.md)
describe('identidade do lançamento no Caixa', () => {
  it('sem paciente, o título é a descrição e a ausência vira complemento', () => {
    expect(cashItemTitle(base)).toBe('Taxa de remarcação');
    expect(cashItemDetail(base)).toBe('Sem paciente vinculado');
  });

  it('sem paciente e com procedimento, mostra os dois no complemento', () => {
    const item = { ...base, snapshotProcedureName: 'Consulta cardiologia' };
    expect(cashItemDetail(item)).toBe('Consulta cardiologia · Sem paciente vinculado');
  });

  it('com paciente, nada muda: nome no título e procedimento no apoio', () => {
    const item = { ...base, pacienteNome: 'Maria Silva', snapshotProcedureName: 'Consulta' };
    expect(cashItemTitle(item)).toBe('Maria Silva');
    expect(cashItemDetail(item)).toBe('Consulta');
  });

  it('conta a pagar continua com a descrição', () => {
    const item = { ...base, tipo: 'pagar' as const, descricao: 'Aluguel' };
    expect(cashItemTitle(item)).toBe('Aluguel');
    expect(cashItemDetail(item)).toBe('Conta a pagar');
  });
});
