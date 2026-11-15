/**
 * Acesso às telas de Convênios: sem sessão (expirada, revogada, acesso desativado) vai para o login
 * em vez de lançar o AuthError que virava "Algo deu errado" (achado no Preview, 15/11); sem ver o
 * financeiro, a tela de "Sem acesso".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  requireClinicId: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: m.redirect }));
vi.mock('@/lib/auth/tenant-context', () => ({
  getCurrentUser: m.getCurrentUser,
  requireClinicId: m.requireClinicId,
}));
vi.mock('@/contexts/health-insurance/queries', () => ({
  getConveniosCommercialDenial: vi.fn(async () => null),
  isInsuranceSchemaInstalled: vi.fn(async () => true),
}));

import { conveniosAccess } from './access';

describe('conveniosAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sem sessão: redireciona ao login antes de qualquer leitura', async () => {
    m.getCurrentUser.mockResolvedValueOnce(null);
    await expect(conveniosAccess('Guia')).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(m.redirect).toHaveBeenCalledWith('/login');
    expect(m.requireClinicId).not.toHaveBeenCalled();
  });

  it('com sessão e sem ver o financeiro: tela "Sem acesso", nada liberado', async () => {
    m.getCurrentUser.mockResolvedValueOnce({ userId: 'u1', clinicId: 'c1', permissions: [] });
    const r = await conveniosAccess('Guia');
    expect(r.ok).toBe(false);
    expect(m.redirect).not.toHaveBeenCalled();
  });

  it('gestora: liberado, gerencia, sem aviso comercial', async () => {
    m.getCurrentUser.mockResolvedValueOnce({
      userId: 'u1',
      clinicId: 'c1',
      permissions: ['view:financial', 'manage:financial'],
    });
    expect(await conveniosAccess('Guia')).toMatchObject({
      ok: true,
      clinicId: 'c1',
      canManage: true,
      commercial: null,
    });
  });
});
