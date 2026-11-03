// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { guard, list } = vi.hoisted(() => ({ guard: vi.fn(), list: vi.fn() }));
vi.mock('../_lib/guard', () => ({ guardAdminAccess: guard }));
vi.mock('../_lib/repositories/signup-accounts.repo', () => ({ signupAccountRepository: { list } }));

import { SignupAccounts, SignupAccountsLoading } from './signup-accounts';

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue(undefined);
  list.mockResolvedValue({ ok: true, items: [], page: 1, hasNextPage: false });
});
afterEach(cleanup);

describe('admin signup accounts', () => {
  it('denies access before any privileged account lookup', async () => {
    guard.mockRejectedValue(new Error('not found'));
    await expect(SignupAccounts({ page: 1 })).rejects.toThrow('not found');
    expect(list).not.toHaveBeenCalled();
  });
  it('shows pending Auth identities separately from provisioned clinics, even without a live draft', async () => {
    list.mockResolvedValue({
      ok: true,
      page: 1,
      hasNextPage: false,
      items: [
        {
          id: 'synthetic',
          maskedEmail: 'pe***@example.com',
          createdAt: '2026-11-03T10:00:00Z',
          stage: 'email_pending',
          liveDraft: false,
        },
      ],
    });
    render(await SignupAccounts({ page: 1 }));
    expect(screen.getByText('Contas autônomas sem clínica')).toBeTruthy();
    expect(screen.getByText(/Elas não entram no total/u)).toBeTruthy();
    expect(screen.getByText('pe***@example.com')).toBeTruthy();
    expect(screen.getByText('Aguardando confirmar e-mail')).toBeTruthy();
    expect(screen.getByText('Indisponível; precisa retomar o cadastro')).toBeTruthy();
    expect(screen.queryByText('Clínica ativa')).toBeNull();
  });
  it('does not claim there are no accounts when the provider failed', async () => {
    list.mockResolvedValue({ ok: false });
    render(await SignupAccounts({ page: 1 }));
    expect(screen.getByText(/Não foi possível consultar as contas/u)).toBeTruthy();
    expect(screen.queryByText(/Nenhuma conta autônoma/u)).toBeNull();
  });
  it('allows traversing sparse pages without treating one empty page as the end', async () => {
    list.mockResolvedValue({ ok: true, page: 2, hasNextPage: true, items: [] });
    render(await SignupAccounts({ page: 2 }));
    expect(screen.getByRole('link', { name: 'Cadastros anteriores' }).getAttribute('href')).toBe(
      '/admin/clinicas?cadastrosPage=1#cadastros-autonomos',
    );
    expect(screen.getByRole('link', { name: 'Mais cadastros' }).getAttribute('href')).toBe(
      '/admin/clinicas?cadastrosPage=3#cadastros-autonomos',
    );
  });
  it('provides a loading status without delaying the existing clinic list', () => {
    render(<SignupAccountsLoading />);
    expect(screen.getByRole('status').textContent).toContain('Consultando contas');
  });
});
