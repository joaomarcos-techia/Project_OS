/**
 * Guia nova depois de cancelada (24/11): só quem fatura, com a permissão FRESCA; auditoria com o id
 * da guia nova na mesma transação; a regra do serviço volta como mensagem, sem detalhe técnico.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireCachedPermission: vi.fn(),
  requireCachedAnyPermission: vi.fn(),
  requireFreshPermission: vi.fn(),
  requireClinicId: vi.fn(),
  logAudit: vi.fn(),
  revalidatePath: vi.fn(),
  reissueGuideAfterCancellationTx: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));
vi.mock('@/lib/auth/tenant-context', async () => {
  class AuthError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  }
  return {
    AuthError,
    requireUser: m.requireUser,
    requireCachedPermission: m.requireCachedPermission,
    requireCachedAnyPermission: m.requireCachedAnyPermission,
    requireFreshPermission: m.requireFreshPermission,
    requireClinicId: m.requireClinicId,
  };
});
vi.mock('@/lib/audit/log', () => ({ logAudit: m.logAudit }));
vi.mock('@/lib/audit/request-context-from-headers', () => ({ requestContext: async () => ({ ip: null, userAgent: null, requestId: 'r1' }) }));
vi.mock('@/lib/db/tenant', () => ({ withTenant: async (_c: string, fn: (tx: unknown) => unknown) => fn({}) }));
vi.mock('@/lib/storage/tiss-files', () => ({ supabaseTissObjectStore: () => ({}), TissStorageError: class extends Error {} }));
vi.mock('./tiss/xml/xsd-validator', () => ({ loadXmllintValidator: () => null }));
vi.mock('./internal/guide-reissue', () => {
  class GuideReissueError extends Error {
    constructor(
      message: string,
      readonly kind: string,
    ) {
      super(message);
      this.name = 'GuideReissueError';
    }
  }
  return { GuideReissueError, reissueGuideAfterCancellationTx: m.reissueGuideAfterCancellationTx };
});

import { AuthError } from '@/lib/auth/tenant-context';
import { PERMISSIONS } from '@/lib/auth/permissions';

import { reissueGuideAction } from './actions';
import { GuideReissueError } from './internal/guide-reissue';
import { CONVENIOS_RULES } from './rights';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const OLD = '22222222-2222-4222-8222-222222222222';
const NEW = '33333333-3333-4333-8333-333333333333';

describe('guia nova depois de cancelada: action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.requireUser.mockResolvedValue({ userId: 'u1', isSuperAdmin: false, permissions: ['view:convenios', 'manage:faturamento_convenio'] });
    m.requireCachedAnyPermission.mockResolvedValue(undefined);
    m.requireFreshPermission.mockResolvedValue(undefined);
    m.requireClinicId.mockResolvedValue(CLINIC);
    m.reissueGuideAfterCancellationTx.mockResolvedValue({ guideId: NEW, number: 'S0000099', existing: false });
  });

  it('faturamento com permissão fresca; audita a cancelada com o id da guia nova', async () => {
    expect(await reissueGuideAction({ guideId: OLD })).toEqual({ ok: true, data: NEW });
    expect(m.requireFreshPermission).toHaveBeenCalledWith(PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO);
    expect(m.requireCachedAnyPermission).toHaveBeenCalledWith(CONVENIOS_RULES.bill);
    expect(m.reissueGuideAfterCancellationTx).toHaveBeenCalledWith(expect.anything(), { clinicId: CLINIC, cancelledGuideId: OLD, actorUserId: 'u1' });
    expect(m.logAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'health_insurance.guide.reissued', resourceType: 'hi_guide', resourceId: OLD, after: { result: NEW } }),
    );
  });

  it('sem a permissão fresca de faturar, nada é gerado nem auditado', async () => {
    m.requireFreshPermission.mockRejectedValueOnce(new (AuthError as unknown as new (msg: string, code: string) => Error)('negado', 'forbidden'));
    expect(await reissueGuideAction({ guideId: OLD })).toEqual({ ok: false, error: 'Seu perfil não tem permissão para esta operação de convênios.' });
    expect(m.reissueGuideAfterCancellationTx).not.toHaveBeenCalled();
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('a regra do serviço (guia enviada) volta como mensagem; id inválido nem chega ao serviço', async () => {
    m.reissueGuideAfterCancellationTx.mockRejectedValueOnce(
      new GuideReissueError('Guia que já chegou à operadora se corrige pela substituição (cancelamento na operadora com recibo).', 'state'),
    );
    expect(await reissueGuideAction({ guideId: OLD })).toEqual({
      ok: false,
      error: 'Guia que já chegou à operadora se corrige pela substituição (cancelamento na operadora com recibo).',
    });
    expect((await reissueGuideAction({ guideId: 'x' })).ok).toBe(false);
    expect(m.reissueGuideAfterCancellationTx).toHaveBeenCalledTimes(1);
  });
});
