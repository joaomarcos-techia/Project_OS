/**
 * Ações da interface de Convênios: permissão antes de tudo, validação, auditoria na mesma
 * transação, e mensagens para o usuário sem detalhe técnico.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireCachedPermission: vi.fn(),
  requireClinicId: vi.fn(),
  logAudit: vi.fn(),
  execute: vi.fn(),
  createBatchInTx: vi.fn(),
  transitionGlossInTx: vi.fn(),
  recordPaymentInTx: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));
vi.mock('@/lib/auth/tenant-context', async () => {
  class AuthError extends Error {
    constructor(message: string, readonly code: string) {
      super(message);
    }
  }
  return { AuthError, requireUser: m.requireUser, requireCachedPermission: m.requireCachedPermission, requireClinicId: m.requireClinicId };
});
vi.mock('@/lib/audit/log', () => ({ logAudit: m.logAudit }));
vi.mock('@/lib/audit/request-context-from-headers', () => ({ requestContext: async () => ({ ip: null, userAgent: null, requestId: 'r1' }) }));
vi.mock('@/lib/db/tenant', () => ({ withTenant: async (_c: string, fn: (tx: unknown) => unknown) => fn({ execute: m.execute }) }));
vi.mock('@/lib/storage/tiss-files', () => ({ supabaseTissObjectStore: () => ({}), TissStorageError: class extends Error {} }));
vi.mock('./internal/batch-service', () => ({ createBatchInTx: m.createBatchInTx, BatchExportError: class extends Error {} }));
vi.mock('./internal/guide-access', () => ({ readBatchGuidesAudited: vi.fn() }));
vi.mock('./internal/guide-issuance', () => ({ approveConsultaGuide: vi.fn() }));
vi.mock('./internal/insurance-account-service', () => {
  class InsuranceAccountError extends Error {
    constructor(message: string, readonly kind: string) {
      super(message);
    }
  }
  return { InsuranceAccountError, transitionGlossInTx: m.transitionGlossInTx, recordPaymentInTx: m.recordPaymentInTx };
});
vi.mock('./tiss/xml/xsd-validator', () => ({ loadXmllintValidator: () => null }));

import { AuthError } from '@/lib/auth/tenant-context';

import { createBatchAction, decideGlossAction, recordPaymentAction, reviewGuideAction } from './actions';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const GUIDE = '22222222-2222-4222-8222-222222222222';
const INSURER = '33333333-3333-4333-8333-333333333333';

describe('ações de Convênios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.requireUser.mockResolvedValue({ userId: 'u1' });
    m.requireCachedPermission.mockResolvedValue(undefined);
    m.requireClinicId.mockResolvedValue(CLINIC);
  });

  it('exige gerenciar financeiro antes de qualquer acesso ao banco', async () => {
    m.requireCachedPermission.mockRejectedValueOnce(new (AuthError as unknown as new (msg: string, code: string) => Error)('negado', 'forbidden'));
    const r = await createBatchAction({ insurerId: INSURER, guideIds: [GUIDE], idempotencyKey: 'chave-123456' });
    expect(r).toEqual({ ok: false, error: 'Seu perfil não tem permissão para esta operação de convênios.' });
    expect(m.requireCachedPermission).toHaveBeenCalledWith('manage:financial');
    expect(m.createBatchInTx).not.toHaveBeenCalled();
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('valida a entrada (UUID, motivo) antes de chamar o serviço', async () => {
    const bad = await createBatchAction({ insurerId: 'x', guideIds: [], idempotencyKey: 'k' });
    expect(bad.ok).toBe(false);
    const noReason = await decideGlossAction({ glossId: GUIDE, version: 1, to: 'definitive' });
    expect(noReason).toEqual({ ok: false, error: 'Informe o motivo (10 a 500 caracteres).' });
    expect(m.transitionGlossInTx).not.toHaveBeenCalled();
  });

  it('cria o lote com a pessoa da sessão, chave prefixada e auditoria na mesma transação', async () => {
    m.createBatchInTx.mockResolvedValueOnce('lote-1');
    const r = await createBatchAction({ insurerId: INSURER, guideIds: [GUIDE], idempotencyKey: 'chave-123456' });
    expect(r).toEqual({ ok: true, data: 'lote-1' });
    expect(m.createBatchInTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clinicId: CLINIC, idempotencyKey: 'ui:chave-123456' }));
    expect(m.logAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clinicId: CLINIC, userId: 'u1', action: 'health_insurance.batch.created', resourceId: 'lote-1' }));
    expect(m.revalidatePath).toHaveBeenCalledWith('/financeiro/convenios', 'layout');
  });

  it('regra do banco vira a mensagem do banco; erro desconhecido vira mensagem genérica (sem detalhe técnico)', async () => {
    m.transitionGlossInTx.mockRejectedValueOnce({ cause: { code: '55000', message: 'Glosa decidida não volta.' } });
    expect(await decideGlossAction({ glossId: GUIDE, version: 1, to: 'contested' })).toEqual({ ok: false, error: 'Glosa decidida não volta.' });
    m.recordPaymentInTx.mockRejectedValueOnce(new Error('connection refused 10.0.0.1:5432'));
    const r = await recordPaymentAction({ insurerId: INSURER, paidOn: '2026-11-12', amountCents: 100, idempotencyKey: 'chave-123456' });
    expect(r).toEqual({ ok: false, error: 'Não foi possível concluir agora. Tente de novo; se persistir, fale com o suporte.' });
  });

  it('conferência com versão desatualizada é recusada (outra pessoa mexeu na guia)', async () => {
    m.execute.mockResolvedValueOnce([]);
    const r = await reviewGuideAction({ guideId: GUIDE, version: 3 });
    expect(r).toEqual({ ok: false, error: 'A guia mudou desde que a tela foi aberta. Atualize e confira de novo.' });
    expect(m.logAudit).not.toHaveBeenCalled();
  });
});
