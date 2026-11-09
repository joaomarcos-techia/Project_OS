// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  AuthErrorMock,
  listEmployees,
  listLgpdRequestHistory,
  listLgpdRequests,
  requireClinicId,
  requireFreshPermission,
  requireUser,
} = vi.hoisted(() => {
  class AuthErrorMock extends Error {
    code: 'forbidden' | 'unauthenticated';

    constructor(code: 'forbidden' | 'unauthenticated') {
      super(code);
      this.code = code;
    }
  }

  return {
    AuthErrorMock,
    listEmployees: vi.fn(),
    listLgpdRequestHistory: vi.fn(),
    listLgpdRequests: vi.fn(),
    requireClinicId: vi.fn(),
    requireFreshPermission: vi.fn(),
    requireUser: vi.fn(),
  };
});

vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
vi.mock('@/contexts/identity/queries', () => ({ listEmployees }));
vi.mock('@/contexts/patient/queries', () => ({
  listLgpdRequestHistory,
  listLgpdRequests,
}));
vi.mock('@/contexts/tenancy/queries', () => ({
  getClinicTimezone: vi.fn(async () => 'America/Sao_Paulo'),
}));
vi.mock('@/lib/auth/tenant-context', () => ({
  AuthError: AuthErrorMock,
  requireClinicId,
  requireFreshPermission,
  requireUser,
}));
vi.mock('@/lib/ui/uuid', () => ({ uuidv4: () => 'idempotency-key' }));
vi.mock('./actions', () => ({
  assignLgpdRequestForm: vi.fn(),
  notifyLgpdRequesterForm: vi.fn(),
  processLgpdRequestForm: vi.fn(),
}));

import { getClinicTimezone } from '@/contexts/tenancy/queries';
import LgpdOperationsPage from './page';

const clinicId = '11111111-1111-1111-1111-111111111111';
const requestId = '22222222-2222-2222-2222-222222222222';

const request = {
  id: requestId,
  patientId: '33333333-3333-3333-3333-333333333333',
  patientName: 'Ana Souza',
  type: 'export',
  status: 'pending',
  requestedAt: '2026-08-18T12:00:00.000Z',
  dueAt: '2026-08-19T12:00:00.000Z',
  assignedToUserId: 'manager-1',
  statusReason: 'Documento pendente de validação.',
  requesterNotifiedAt: null,
  requesterNotificationChannel: null,
  exportSignedUrl: 'https://example.test/export',
  exportSignedUrlExpiresAt: '2099-08-20T12:00:00.000Z',
  overdue: true,
};

const employees = [
  {
    id: 'manager-1',
    nome: 'Gestora Maria',
    ativo: true,
    pending: false,
    role: 'gestor',
  },
];

const history = [
  {
    id: 'history-1',
    requestId,
    action: 'created',
    fromStatus: null,
    toStatus: 'pending',
    note: 'Solicitação recebida',
    changedByUserId: 'manager-1',
    changedAt: '2026-08-18T12:00:00.000Z',
  },
];

afterEach(cleanup);

describe('LgpdOperationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ userId: 'user-1' });
    requireFreshPermission.mockResolvedValue(undefined);
    requireClinicId.mockResolvedValue(clinicId);
    listLgpdRequests.mockResolvedValue([request]);
    listEmployees.mockResolvedValue(employees);
    listLgpdRequestHistory.mockResolvedValue(history);
  });

  it('carrega a fila inicial sem consultar histórico por solicitação', async () => {
    render(await LgpdOperationsPage({ searchParams: Promise.resolve({}) }));

    expect(listLgpdRequests).toHaveBeenCalledWith(clinicId);
    expect(listEmployees).toHaveBeenCalledWith(clinicId);
    expect(listLgpdRequestHistory).not.toHaveBeenCalled();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('Ana Souza')).toBeTruthy();
    expect(screen.getByText('SLA vencido')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Histórico de tratamento' })).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Abrir solicitação de Ana Souza' }).getAttribute('href'),
    ).toBe(`/configuracoes/lgpd?solicitacao=${requestId}`);
  });

  it('consulta somente o histórico do item selecionado e abre o detalhe operacional', async () => {
    render(
      await LgpdOperationsPage({
        searchParams: Promise.resolve({ solicitacao: requestId }),
      }),
    );

    expect(listLgpdRequestHistory).toHaveBeenCalledOnce();
    expect(listLgpdRequestHistory).toHaveBeenCalledWith(clinicId, requestId);
    expect(screen.getByRole('heading', { name: 'Ana Souza', level: 2 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Histórico de tratamento' })).toBeTruthy();
    expect(screen.getByText('Solicitação criada')).toBeTruthy();
    expect(screen.getByLabelText('Responsável')).toBeTruthy();
    expect(screen.getByLabelText('Comprovação da identidade')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Processar' })).toBeTruthy();
    expect(screen.getByRole('row', { selected: true })).toBeTruthy();
  });

  it('não consulta histórico para um ID que não pertence à fila tenant-scoped', async () => {
    render(
      await LgpdOperationsPage({
        searchParams: Promise.resolve({
          solicitacao: '99999999-9999-9999-9999-999999999999',
        }),
      }),
    );

    expect(listLgpdRequestHistory).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Histórico de tratamento' })).toBeNull();
  });

  it('mostra solicitação e prazo no fuso da clínica', async () => {
    vi.mocked(getClinicTimezone).mockResolvedValueOnce('Asia/Tokyo');

    render(await LgpdOperationsPage({ searchParams: Promise.resolve({}) }));

    // 12:00Z é 21:00 em Tóquio e 09:00 em São Paulo.
    expect(screen.getByText('Solicitada em 18/08/2026, 21:00:00')).toBeTruthy();
    expect(screen.getByText('19/08/2026, 21:00:00')).toBeTruthy();
  });

  it('mantém o gate antes de qualquer leitura tenant', async () => {
    requireFreshPermission.mockRejectedValue(new AuthErrorMock('forbidden'));

    render(await LgpdOperationsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText(/não tem permissão para operar solicitações LGPD/iu)).toBeTruthy();
    expect(requireClinicId).not.toHaveBeenCalled();
    expect(listLgpdRequests).not.toHaveBeenCalled();
    expect(getClinicTimezone).not.toHaveBeenCalled();
    expect(listEmployees).not.toHaveBeenCalled();
    expect(listLgpdRequestHistory).not.toHaveBeenCalled();
  });

  it('usa o estado vazio canônico sem disparar leitura de histórico', async () => {
    listLgpdRequests.mockResolvedValue([]);

    render(await LgpdOperationsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText('Nenhuma solicitação registrada')).toBeTruthy();
    expect(screen.getByText(/aparecerão nesta fila/iu)).toBeTruthy();
    expect(listLgpdRequestHistory).not.toHaveBeenCalled();
  });
});
