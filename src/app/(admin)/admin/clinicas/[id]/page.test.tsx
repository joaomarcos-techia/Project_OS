// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { guardAdminAccess, getDetail, notFound } = vi.hoisted(() => ({
  guardAdminAccess: vi.fn(),
  getDetail: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('../../_lib/guard', () => ({ guardAdminAccess }));
vi.mock('../../_lib/repositories/clinics.repo', () => ({
  clinicRepository: { getDetail },
}));
vi.mock('../../_components/badges', () => ({
  BillingBadge: ({ status }: { status: string | null }) => (
    <span data-billing-status={status ?? 'none'}>billing:{status ?? 'none'}</span>
  ),
  ClinicStatusBadge: ({ status }: { status: string }) => (
    <span data-clinic-status={status}>clinic:{status}</span>
  ),
}));
vi.mock('./impersonate-form', () => ({
  ImpersonateForm: ({ clinicId }: { clinicId: string }) => (
    <button type="button" data-clinic-id={clinicId}>
      Impersonar clínica
    </button>
  ),
}));
vi.mock('./export-form', () => ({
  ExportAuditForm: ({ clinicId }: { clinicId: string }) => (
    <form aria-label="Exportar auditoria" data-clinic-id={clinicId} />
  ),
}));

import ClinicDetailPage from './page';

const clinicId = '11111111-1111-4111-8111-111111111111';

const detail = {
  general: {
    id: clinicId,
    nome: 'Clínica Aurora',
    slug: 'clinica-aurora',
    status: 'active',
    cnpj: '12.345.678/0001-90',
    timezone: 'America/Sao_Paulo',
    createdAt: '2026-01-10T12:00:00.000Z',
  },
  plan: { code: 'pro', name: 'Pro', priceCents: 14_900, cycle: 'monthly' },
  billing: {
    openInvoices: 3,
    overdue: 2,
    dunningStage: 1,
    billingStatus: 'overdue',
    lastPaidAt: '2026-08-10T12:00:00.000Z',
  },
  users: [
    { id: 'user-1', nome: 'Ana Silva', role: 'owner', ativo: true },
    { id: 'user-2', nome: 'Bruno Lima', role: 'doctor', ativo: false },
  ],
  aiUsage: { conversations: 12, messages: 50, tokens: 5_000, costUsd: 0.1234 },
  integrations: { whatsapp: 'pending', asaas: 'linked' },
  recentAudit: [
    {
      id: 'audit-1',
      timestamp: '2026-08-20T12:00:00.000Z',
      userId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      action: 'clinic.update',
      clinicId,
      resourceType: 'clinic',
      resourceId: clinicId,
      ip: '127.0.0.1',
      result: 'ok',
    },
    {
      id: 'audit-2',
      timestamp: '2026-08-19T12:00:00.000Z',
      userId: null,
      action: 'invoice.refund',
      clinicId,
      resourceType: 'invoice',
      resourceId: 'invoice-1',
      ip: null,
      result: 'ok',
    },
  ],
};

async function renderDetail(id = clinicId) {
  return render(await ClinicDetailPage({ params: Promise.resolve({ id }) }));
}

function expectNoMigratedLegacyStructures(container: HTMLElement) {
  expect(
    container.querySelector(
      '.cardblock, .cardblock-head, .listrows, .listrow, .panel, .lr-main, .lr-sub, .lr-end, .kv-row, .integ-row, .integ-id, .ai-kpis, .empty-mini, .hc-dot',
    ),
  ).toBeNull();
}

describe('ClinicDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardAdminAccess.mockResolvedValue(undefined);
    getDetail.mockResolvedValue(detail);
    notFound.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND');
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('preserva dados, links, ações e filas no detalhe completo', async () => {
    const { container } = await renderDetail();

    expect(screen.getByText('Clínica Aurora')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar para Clínicas' }).getAttribute('href')).toBe(
      '/admin/clinicas',
    );
    expect(screen.getByRole('link', { name: 'Ver faturas' }).getAttribute('href')).toBe(
      '/admin/billing',
    );
    expect(
      screen.getByRole('button', { name: 'Impersonar clínica' }).getAttribute('data-clinic-id'),
    ).toBe(clinicId);

    const general = screen.getByRole('region', { name: 'Dados gerais' });
    expect(within(general).getByText('/clinica-aurora')).toBeTruthy();
    expect(within(general).getByText('12.345.678/0001-90')).toBeTruthy();
    expect(within(general).getByText('America/Sao_Paulo')).toBeTruthy();

    const plan = screen.getByRole('region', { name: 'Plano & pagamentos' });
    expect(within(plan).getByText('pro')).toBeTruthy();
    expect(within(plan).getByText(/149,00 \/ monthly/u)).toBeTruthy();
    expect(within(plan).getByText('billing:overdue')).toBeTruthy();
    expect(within(plan).getByText('3')).toBeTruthy();
    expect(within(plan).getByText('2')).toBeTruthy();

    const ai = screen.getByRole('region', { name: 'Uso de IA' });
    expect(within(ai).getByText('Conversas')).toBeTruthy();
    expect(within(ai).getByText('12')).toBeTruthy();
    expect(within(ai).getByText('Mensagens')).toBeTruthy();
    expect(within(ai).getByText('50')).toBeTruthy();
    expect(within(ai).getByText('5.000')).toBeTruthy();
    expect(within(ai).getByText(/0\.1234/u)).toBeTruthy();

    const integrations = screen.getByRole('region', { name: 'Integrações' });
    expect(within(integrations).getAllByRole('listitem')).toHaveLength(2);
    expect(within(integrations).getByText('Atenção')).toBeTruthy();
    expect(within(integrations).getByText('Conectado')).toBeTruthy();

    const users = screen.getByRole('region', { name: 'Usuários' });
    expect(within(users).getByText('2 no total')).toBeTruthy();
    expect(within(users).getByText('Ana Silva')).toBeTruthy();
    expect(within(users).getByText('Bruno Lima')).toBeTruthy();
    expect(within(users).getByText('Ativo')).toBeTruthy();
    expect(within(users).getByText('Inativo')).toBeTruthy();

    const audit = screen.getByRole('region', { name: 'Últimas auditorias' });
    expect(within(audit).getAllByRole('listitem')).toHaveLength(2);
    expect(within(audit).getByText('clinic.update')).toBeTruthy();
    expect(within(audit).getByText('invoice.refund')).toBeTruthy();
    expect(within(audit).getByText('aaaaaaaa')).toBeTruthy();
    expect(within(audit).getByText('sistema')).toBeTruthy();

    expect(
      screen.getByRole('form', { name: 'Exportar auditoria' }).getAttribute('data-clinic-id'),
    ).toBe(clinicId);
    expect(screen.getByText('Fatura em atraso')).toBeTruthy();
    expect(guardAdminAccess).toHaveBeenCalledOnce();
    expect(getDetail).toHaveBeenCalledWith(clinicId);
    expectNoMigratedLegacyStructures(container);
  });

  it('renderiza estados vazios reais sem esconder integrações ou exportação', async () => {
    getDetail.mockResolvedValue({
      ...detail,
      general: { ...detail.general, status: 'trial', cnpj: null },
      plan: null,
      billing: {
        openInvoices: 0,
        overdue: 0,
        dunningStage: 0,
        billingStatus: null,
        lastPaidAt: null,
      },
      users: [],
      aiUsage: { conversations: 0, messages: 0, tokens: 0, costUsd: 0 },
      integrations: { whatsapp: 'none', asaas: 'none' },
      recentAudit: [],
    });

    const { container } = await renderDetail();

    expect(screen.getByText('Sem atividade ainda')).toBeTruthy();
    expect(screen.getByText('Nenhum usuário.')).toBeTruthy();
    expect(screen.getByText('Sem eventos.')).toBeTruthy();
    expect(screen.getAllByText('Não conectado')).toHaveLength(2);
    expect(screen.queryByText('Fatura em atraso')).toBeNull();
    expect(screen.getByRole('form', { name: 'Exportar auditoria' })).toBeTruthy();
    expectNoMigratedLegacyStructures(container);
  });

  it('rejeita id inválido antes de consultar o repositório', async () => {
    await expect(
      ClinicDetailPage({ params: Promise.resolve({ id: 'id-invalido' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(guardAdminAccess).toHaveBeenCalledOnce();
    expect(getDetail).not.toHaveBeenCalled();
    expect(notFound).toHaveBeenCalledOnce();
  });

  it('retorna not found quando a clínica válida não existe', async () => {
    getDetail.mockResolvedValue(null);

    await expect(ClinicDetailPage({ params: Promise.resolve({ id: clinicId }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );

    expect(getDetail).toHaveBeenCalledWith(clinicId);
    expect(notFound).toHaveBeenCalledOnce();
  });

  it('não valida nem consulta a clínica quando o guard admin bloqueia a rota', async () => {
    guardAdminAccess.mockRejectedValue(new Error('forbidden'));

    await expect(
      ClinicDetailPage({ params: Promise.resolve({ id: 'id-invalido' }) }),
    ).rejects.toThrow('forbidden');

    expect(notFound).not.toHaveBeenCalled();
    expect(getDetail).not.toHaveBeenCalled();
  });
});
