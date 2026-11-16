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

  it('com sessão e sem view:convenios (só ver o financeiro não abre Convênios na matriz I.2): "Sem acesso"', async () => {
    m.getCurrentUser.mockResolvedValueOnce({ userId: 'u1', clinicId: 'c1', permissions: ['view:financial', 'manage:financial'] });
    const r = await conveniosAccess('Guia');
    expect(r.ok).toBe(false);
    expect(m.redirect).not.toHaveBeenCalled();
  });

  it('gestora: liberado, todos os direitos, clínica inteira com valores, sem aviso comercial', async () => {
    m.getCurrentUser.mockResolvedValueOnce({
      userId: 'u1',
      clinicId: 'c1',
      permissions: ['view:convenios', 'manage:convenios', 'operate:convenios', 'view:faturamento_convenio', 'manage:faturamento_convenio'],
    });
    expect(await conveniosAccess('Guia')).toMatchObject({
      ok: true,
      clinicId: 'c1',
      rights: { configure: true, operate: true, seeValues: true, bill: true, broad: true },
      scope: { kind: 'clinic' },
      guideView: { values: true },
      commercial: null,
    });
  });

  it('médica (só view:convenios): só as próprias guias, sem valores (D-4); páginas de faturamento fechadas', async () => {
    const doctor = { userId: 'doc-1', clinicId: 'c1', permissions: ['view:convenios', 'edit:agenda'] };
    m.getCurrentUser.mockResolvedValueOnce(doctor);
    expect(await conveniosAccess('Guias')).toMatchObject({
      ok: true,
      scope: { kind: 'own', professionalId: 'doc-1' },
      guideView: { values: false },
      rights: { operate: false, bill: false, seeValues: false },
    });
    m.getCurrentUser.mockResolvedValueOnce(doctor);
    expect((await conveniosAccess('Lotes', 'seeValues')).ok).toBe(false);
    m.getCurrentUser.mockResolvedValueOnce(doctor);
    expect((await conveniosAccess('Autorizações', 'broad')).ok).toBe(false);
  });

  it('recepção: clínica inteira, sem valores; abre autorizações (visão ampla), não abre lotes', async () => {
    const reception = { userId: 'r-1', clinicId: 'c1', permissions: ['view:convenios', 'operate:convenios', 'view:financial'] };
    m.getCurrentUser.mockResolvedValueOnce(reception);
    expect(await conveniosAccess('Autorizações', 'broad')).toMatchObject({ ok: true, scope: { kind: 'clinic' }, guideView: { values: false } });
    m.getCurrentUser.mockResolvedValueOnce(reception);
    expect((await conveniosAccess('Lotes', 'seeValues')).ok).toBe(false);
  });
});
