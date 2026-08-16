// @vitest-environment happy-dom
/**
 * RBAC + UI da tela de Fornecedores (C9 Fase 2). manage:financial controla a
 * gestão (criar/editar/ativar). Sem ele, a lista é só leitura.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { SupplierSummary } from '@/contexts/financial/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({
  createSupplierAction: vi.fn(),
  updateSupplierAction: vi.fn(),
  setSupplierAtivoAction: vi.fn(),
}));

import { FornecedoresView } from './fornecedores-view';

function supplier(overrides: Partial<SupplierSummary> = {}): SupplierSummary {
  return {
    id: 's1',
    razaoSocial: 'Fornecedor X',
    cnpj: '00.000.000/0001-00',
    contato: 'contato@x.com',
    condicaoPagamento: '30 dias',
    ativo: true,
    updatedAt: '2026-08-15T12:00:00.000Z',
    ...overrides,
  };
}

afterEach(cleanup);

describe('FornecedoresView — RBAC', () => {
  it('lista o fornecedor (sempre)', () => {
    render(<FornecedoresView suppliers={[supplier()]} canManage={false} />);
    expect(screen.getByText('Fornecedor X')).toBeTruthy();
  });

  it('manage:financial → mostra Novo fornecedor / Editar / Desativar', () => {
    render(<FornecedoresView suppliers={[supplier()]} canManage={true} />);
    expect(screen.getByRole('button', { name: 'Novo fornecedor' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Desativar' })).toBeTruthy();
  });

  it('sem manage:financial → lista é somente leitura (sem botões de gestão)', () => {
    render(<FornecedoresView suppliers={[supplier()]} canManage={false} />);
    expect(screen.queryByRole('button', { name: 'Novo fornecedor' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Desativar' })).toBeNull();
  });

  it('fornecedor inativo → mostra "Ativar" e badge Inativo', () => {
    render(<FornecedoresView suppliers={[supplier({ ativo: false })]} canManage={true} />);
    expect(screen.getByRole('button', { name: 'Ativar' })).toBeTruthy();
    expect(screen.getByText('Inativo')).toBeTruthy();
  });
});
