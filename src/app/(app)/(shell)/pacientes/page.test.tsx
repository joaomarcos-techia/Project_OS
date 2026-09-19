import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listPatients, listPatientsPageWithBonds, pageGate, redirect } = vi.hoisted(() => ({
  listPatients: vi.fn(),
  listPatientsPageWithBonds: vi.fn(),
  pageGate: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/contexts/patient/queries', () => ({
  listPatients,
  listPatientsPageWithBonds,
}));
vi.mock('@/lib/auth/page-guard', () => ({ pageGate }));
vi.mock('next/navigation', () => ({ redirect, useRouter: vi.fn() }));

import { PERMISSIONS } from '@/lib/auth/permissions';

import PacientesPage from './page';

const emptyPage = { items: [], total: 0, page: 1, pageSize: 30, bonds: new Map() };

describe('/pacientes pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pageGate.mockResolvedValue({
      allowed: true,
      clinicId: 'clinic-a',
      user: { permissions: [PERMISSIONS.VIEW_PATIENT, PERMISSIONS.DELETE_PATIENT] },
    });
    listPatientsPageWithBonds.mockResolvedValue(emptyPage);
    listPatients.mockResolvedValue([]);
  });

  it('aplica RBAC antes de qualquer leitura', async () => {
    pageGate.mockResolvedValue({ allowed: false });

    await PacientesPage({ searchParams: Promise.resolve({}) });

    expect(listPatientsPageWithBonds).not.toHaveBeenCalled();
    expect(listPatients).not.toHaveBeenCalled();
  });

  it('lista somente a página solicitada sem pré-carregar candidatos do drawer', async () => {
    await PacientesPage({ searchParams: Promise.resolve({ page: '2' }) });

    expect(listPatientsPageWithBonds).toHaveBeenCalledWith('clinic-a', {
      page: 2,
      withBonds: true,
    });
    expect(listPatients).not.toHaveBeenCalled();
  });

  it('preserva busca e lixeira autorizada na consulta paginada', async () => {
    await PacientesPage({
      searchParams: Promise.resolve({ q: '  Ana  ', removidos: '1', page: '3' }),
    });

    // A lixeira NÃO pede vínculos: "quem responde por quem" descreve operação
    // corrente e não faz sentido sobre um cadastro removido. Antes isso ficava
    // provado por `listPatientBonds` não ser chamado; agora é a flag.
    expect(listPatientsPageWithBonds).toHaveBeenCalledWith('clinic-a', {
      page: 3,
      withBonds: false,
      onlyDeleted: true,
      search: 'Ana',
    });
  });

  it('carrega candidatos somente quando o drawer foi solicitado pela URL', async () => {
    await PacientesPage({ searchParams: Promise.resolve({ novo: '1' }) });

    expect(listPatients).toHaveBeenCalledOnce();
    expect(listPatients).toHaveBeenCalledWith('clinic-a', { limit: 200 });
  });

  it('redireciona uma página excedente para a última página válida', async () => {
    listPatientsPageWithBonds.mockResolvedValue({
      items: [],
      total: 31,
      page: 9,
      pageSize: 30,
      bonds: new Map(),
    });

    await PacientesPage({ searchParams: Promise.resolve({ page: '9' }) });

    expect(redirect).toHaveBeenCalledWith('/pacientes?page=2');
  });

  it('normaliza uma página excedente também quando a lista está vazia', async () => {
    await PacientesPage({ searchParams: Promise.resolve({ page: '2' }) });

    expect(redirect).toHaveBeenCalledWith('/pacientes');
  });
});
