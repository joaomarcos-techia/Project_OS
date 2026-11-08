// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as PlanChanges from '@/contexts/billing/internal/plan-changes';

const { requireUser, requireClinicId, getPlanChangeOverview, getDeferredOverview } = vi.hoisted(
  () => ({
    requireUser: vi.fn(),
    requireClinicId: vi.fn(),
    getPlanChangeOverview: vi.fn(),
    getDeferredOverview: vi.fn(),
  }),
);

vi.mock('@/lib/auth/tenant-context', () => ({ requireUser, requireClinicId }));
vi.mock('@/contexts/billing/internal/plan-changes', async (importOriginal) => {
  const actual = await importOriginal<typeof PlanChanges>();
  return { ...actual, getPlanChangeOverview };
});
vi.mock('./plan-change-form', () => ({ PlanChangeForm: () => <div>Plano carregado</div> }));
vi.mock('@/contexts/billing/internal/deferred-checkout', () => ({
  getDeferredSubscriptionOverview: getDeferredOverview,
}));

import AssinaturaPage from './page';
import { PlanChangeError } from '@/contexts/billing/internal/plan-changes';

describe('AssinaturaPage', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    requireUser.mockResolvedValue({ permissions: ['manage:settings'] });
    requireClinicId.mockResolvedValue('11111111-1111-4111-8111-111111111111');
    getPlanChangeOverview.mockReset();
    getDeferredOverview.mockReset();
    getDeferredOverview.mockResolvedValue(null);
  });

  it('renderiza a negativa de RBAC sem lançar erro de rota', async () => {
    requireUser.mockResolvedValue({ permissions: [] });

    render(await AssinaturaPage());

    expect(screen.getByText('Sem acesso')).toBeTruthy();
    expect(screen.getByText(/não tem permissão para gerenciar a assinatura/u)).toBeTruthy();
    expect(requireClinicId).not.toHaveBeenCalled();
    expect(getPlanChangeOverview).not.toHaveBeenCalled();
    expect(getDeferredOverview).not.toHaveBeenCalled();
  });

  it('mostra estado seguro quando o provisionamento ainda não criou a assinatura', async () => {
    getPlanChangeOverview.mockRejectedValue(
      new PlanChangeError('Assinatura não encontrada.', 'subscription_not_found'),
    );

    render(await AssinaturaPage());

    expect(screen.getByText(/Assinatura em configura/u)).toBeTruthy();
    expect(screen.getByText(/assinatura provisionada/u)).toBeTruthy();
    expect(screen.queryByText('Plano carregado')).toBeNull();
  });

  it('não oculta falhas diferentes de assinatura ausente', async () => {
    getPlanChangeOverview.mockRejectedValue(new Error('database unavailable'));

    await expect(AssinaturaPage()).rejects.toThrow('database unavailable');
  });
  it('uses the persisted deferred origin without rendering Asaas management', async () => {
    getDeferredOverview.mockResolvedValue({
      planName: 'Clínica',
      amountMinor: 39700,
      trialEndsAt: '2026-11-20T12:00:00Z',
      trialActive: true,
      paid: false,
      billingStatus: 'trial',
      paidPeriodActive: false,
    });
    render(await AssinaturaPage());
    expect(screen.getByText('Avaliação sem cartão')).toBeTruthy();
    expect(getPlanChangeOverview).not.toHaveBeenCalled();
  });
  it('does not fall back to Asaas when the deferred origin read fails', async () => {
    getDeferredOverview.mockRejectedValue(new Error('gateway unavailable'));
    await expect(AssinaturaPage()).rejects.toThrow('gateway unavailable');
    expect(getPlanChangeOverview).not.toHaveBeenCalled();
  });
});
