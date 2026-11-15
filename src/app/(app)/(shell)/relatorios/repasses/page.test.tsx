// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';

const mocks = vi.hoisted(() => ({
  hasAdvancedFinancialPolicies: vi.fn(),
  requireUser: vi.fn(),
  requireClinicId: vi.fn(),
  getClinicTimezone: vi.fn(),
  listCompleted: vi.fn(),
  listPayouts: vi.fn(),
  getCurrentPractitioner: vi.fn(),
}));
vi.mock('@/contexts/billing/api', () => ({
  billingApiV1: { hasAdvancedFinancialPolicies: mocks.hasAdvancedFinancialPolicies },
}));
vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));
// A página lê o usuário por `requirePageUser` (sessão morta vai para /login, OBS-001). Aqui ele
// delega ao `requireUser` simulado, para os cenários continuarem os mesmos; o redirecionamento
// tem teste próprio em `src/lib/auth/page-guard.test.ts`.
vi.mock('@/lib/auth/page-guard', () => ({
  requirePageUser: async () => (await import('@/lib/auth/tenant-context')).requireUser(),
}));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: mocks.requireUser,
  requireClinicId: mocks.requireClinicId,
}));
vi.mock('@/contexts/tenancy/queries', () => ({ getClinicTimezone: mocks.getClinicTimezone }));
vi.mock('@/contexts/scheduling/queries', () => ({
  listCompletedAppointmentsForMonth: mocks.listCompleted,
}));
vi.mock('@/contexts/financial/payout-queries', () => ({
  listMonthlyPayoutSnapshots: mocks.listPayouts,
}));
vi.mock('@/contexts/identity/internal/practitioner', () => ({
  getCurrentPractitioner: mocks.getCurrentPractitioner,
}));
vi.mock('@/lib/db/query-timeout', () => ({
  withQueryDeadline: (_name: string, promise: Promise<unknown>) => promise,
}));

import RepassesPage from './page';

afterEach(cleanup);

describe('RepassesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasAdvancedFinancialPolicies.mockResolvedValue(true);
    mocks.requireClinicId.mockResolvedValue('clinic-a');
    mocks.getCurrentPractitioner.mockResolvedValue(false);
    mocks.getClinicTimezone.mockResolvedValue('America/Sao_Paulo');
    mocks.listCompleted.mockResolvedValue([
      {
        appointmentId: 'appointment-a',
        completedAt: '2026-10-12T12:00:00Z',
        professionalName: 'Dr. A',
      },
    ]);
    mocks.listPayouts.mockResolvedValue([
      {
        appointmentId: 'appointment-a',
        professionalId: 'doctor-a',
        grossAmount: 150,
        providerFeeAmount: 5,
        netAmount: 145,
        payoutAmount: 75,
        calculationBasis: 'gross',
        status: 'calculated',
        reviewVersion: null,
      },
    ]);
  });

  it('médico recebe somente o próprio escopo, inclusive na consulta ao banco', async () => {
    mocks.requireUser.mockResolvedValue({ userId: 'doctor-a', role: 'doctor', permissions: [] });
    mocks.getCurrentPractitioner.mockResolvedValue(true);
    render(await RepassesPage({ searchParams: Promise.resolve({ mes: '2026-10' }) }));
    expect(mocks.listPayouts).toHaveBeenCalledWith('clinic-a', ['appointment-a'], 'doctor-a');
    expect(screen.getByText('R$ 75,00')).toBeTruthy();
    expect(screen.queryByText('Dr. A')).toBeNull();
    expect(screen.getByText(/não comprovantes de transferência/i)).toBeTruthy();
  });

  it('gestor autorizado recebe o consolidado', async () => {
    mocks.requireUser.mockResolvedValue({
      userId: 'manager-a',
      role: 'gestor',
      permissions: [PERMISSIONS.MANAGE_FINANCIAL],
    });
    render(await RepassesPage({ searchParams: Promise.resolve({ mes: '2026-10' }) }));
    expect(mocks.listPayouts).toHaveBeenCalledWith('clinic-a', ['appointment-a'], undefined);
    expect(screen.getByText('Dr. A')).toBeTruthy();
    expect(mocks.getCurrentPractitioner).not.toHaveBeenCalled();
  });

  it('titular com CRM e sem permissão financeira recebe apenas os próprios repasses', async () => {
    mocks.requireUser.mockResolvedValue({ userId: 'owner-a', role: 'owner', permissions: [] });
    mocks.getCurrentPractitioner.mockResolvedValue(true);
    render(await RepassesPage({ searchParams: Promise.resolve({ mes: '2026-10' }) }));
    expect(mocks.listPayouts).toHaveBeenCalledWith('clinic-a', ['appointment-a'], 'owner-a');
  });

  it('médico com permissão de leitura financeira continua vendo só seus repasses', async () => {
    mocks.requireUser.mockResolvedValue({
      userId: 'doctor-a',
      role: 'doctor',
      permissions: [PERMISSIONS.VIEW_FINANCIAL],
    });
    mocks.getCurrentPractitioner.mockResolvedValue(true);
    render(await RepassesPage({ searchParams: Promise.resolve({ mes: '2026-10' }) }));
    expect(mocks.listPayouts).toHaveBeenCalledWith('clinic-a', ['appointment-a'], 'doctor-a');
  });

  it('nega antes de consultar repasses quando a role não tem autorização', async () => {
    mocks.requireUser.mockResolvedValue({
      userId: 'staff-a',
      role: 'attendant',
      permissions: [PERMISSIONS.VIEW_FINANCIAL],
    });
    render(await RepassesPage({ searchParams: Promise.resolve({ mes: '2026-10' }) }));
    expect(screen.getByText(/não tem acesso a este relatório/i)).toBeTruthy();
    expect(mocks.getClinicTimezone).not.toHaveBeenCalled();
    expect(mocks.listCompleted).not.toHaveBeenCalled();
    expect(mocks.listPayouts).not.toHaveBeenCalled();
  });
  it('Consultório com gestor autorizado é bloqueado antes de consultar dados do relatório', async () => {
    mocks.requireUser.mockResolvedValue({
      userId: 'owner-a',
      permissions: [PERMISSIONS.MANAGE_FINANCIAL],
    });
    mocks.hasAdvancedFinancialPolicies.mockResolvedValue(false);
    render(await RepassesPage({ searchParams: Promise.resolve({ mes: '2026-10' }) }));
    expect(screen.getByText('Disponível no plano Clínica')).toBeTruthy();
    expect(mocks.getClinicTimezone).not.toHaveBeenCalled();
    expect(mocks.listCompleted).not.toHaveBeenCalled();
    expect(mocks.listPayouts).not.toHaveBeenCalled();
  });
});
