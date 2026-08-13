// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as PlanChanges from '@/contexts/billing/internal/plan-changes';

const { requireCachedPermission, requireClinicId, getPlanChangeOverview } = vi.hoisted(() => ({
  requireCachedPermission: vi.fn(),
  requireClinicId: vi.fn(),
  getPlanChangeOverview: vi.fn(),
}));

vi.mock('@/lib/auth/tenant-context', () => ({ requireCachedPermission, requireClinicId }));
vi.mock('@/contexts/billing/internal/plan-changes', async (importOriginal) => {
  const actual = await importOriginal<typeof PlanChanges>();
  return { ...actual, getPlanChangeOverview };
});
vi.mock('./plan-change-form', () => ({ PlanChangeForm: () => <div>Plano carregado</div> }));

import AssinaturaPage from './page';
import { PlanChangeError } from '@/contexts/billing/internal/plan-changes';

describe('AssinaturaPage', () => {
  beforeEach(() => {
    requireCachedPermission.mockResolvedValue(undefined);
    requireClinicId.mockResolvedValue('11111111-1111-1111-1111-111111111111');
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
});
