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
  approveConsultaGuide: vi.fn(),
  updateConsultaOverridesInTx: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));
vi.mock('@/lib/auth/tenant-context', async () => {
  class AuthError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly httpStatus?: number,
      readonly reason?: string,
    ) {
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
vi.mock('./internal/guide-issuance', () => ({ approveConsultaGuide: m.approveConsultaGuide }));
vi.mock('./internal/consulta-overrides-service', () => {
  class ConsultaOverridesError extends Error {
    constructor(message: string, readonly kind: string) {
      super(message);
      this.name = 'ConsultaOverridesError';
    }
  }
  return { ConsultaOverridesError, updateConsultaOverridesInTx: m.updateConsultaOverridesInTx };
});
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

import {
  approveGuideAction,
  createBatchAction,
  decideGlossAction,
  recordPaymentAction,
  returnGuideAction,
  reviewGuideAction,
  updateConsultaFieldsAction,
} from './actions';
import { ConsultaOverridesError } from './internal/consulta-overrides-service';
import { notReviewedError } from './internal/issuance-common';

/** Erro com o mesmo nome do da emissão (a ação reconhece pelo nome, como o BatchRuleError). */
const issuanceError = (message: string, issues: Array<{ message: string }> = []) =>
  Object.assign(new Error(message), { name: 'GuideIssuanceError', issues });

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

  it('sessão terminada, acesso desativado e conta removida têm mensagens distintas e não chegam ao banco', async () => {
    type Ctor = new (msg: string, code: string, status: number, reason: string) => Error;
    const Err = AuthError as unknown as Ctor;
    const input = { guideId: GUIDE, version: 1, tipoConsulta: '4' };
    m.requireUser.mockRejectedValueOnce(new Err('Autenticação necessária', 'unauthenticated', 401, 'TOKEN_INVALID'));
    expect(await updateConsultaFieldsAction(input)).toEqual({ ok: false, error: 'Sua sessão terminou. Entre de novo para continuar.' });
    m.requireUser.mockRejectedValueOnce(new Err('Acesso desativado.', 'unauthenticated', 401, 'USER_DISABLED'));
    expect(await updateConsultaFieldsAction(input)).toEqual({
      ok: false,
      error: 'Seu acesso a esta clínica foi desativado. Fale com o administrador da clínica.',
    });
    m.requireUser.mockRejectedValueOnce(new Err('Conta removida.', 'unauthenticated', 401, 'USER_DELETED'));
    expect((await updateConsultaFieldsAction(input)).ok).toBe(false);
    expect(m.updateConsultaOverridesInTx).not.toHaveBeenCalled();
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
    expect(m.revalidatePath).toHaveBeenCalledWith('/convenios', 'layout');
  });

  it('regra do banco vira a mensagem do banco; erro desconhecido vira mensagem genérica (sem detalhe técnico)', async () => {
    m.transitionGlossInTx.mockRejectedValueOnce({ cause: { code: '55000', message: 'Glosa decidida não volta.' } });
    expect(await decideGlossAction({ glossId: GUIDE, version: 1, to: 'contested' })).toEqual({ ok: false, error: 'Glosa decidida não volta.' });
    m.recordPaymentInTx.mockRejectedValueOnce(new Error('connection refused 10.0.0.1:5432'));
    const r = await recordPaymentAction({ insurerId: INSURER, paidOn: '2026-11-12', amountCents: 100, idempotencyKey: 'chave-123456' });
    expect(r).toEqual({ ok: false, error: 'Não foi possível concluir agora. Tente de novo; se persistir, fale com o suporte.' });
  });

  it('conferência com versão desatualizada é recusada (outra pessoa mexeu na guia)', async () => {
    // 1º: decisão comercial (liberado); 2º: o UPDATE com a versão antiga não acha a linha.
    m.execute.mockResolvedValueOnce([{ denial: null }]).mockResolvedValueOnce([]);
    const r = await reviewGuideAction({ guideId: GUIDE, version: 3 });
    expect(r).toEqual({ ok: false, error: 'A guia mudou desde que a tela foi aberta. Atualize e confira de novo.' });
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('D24: conferir e devolver são recusados em trial e com a clínica suspensa, antes de tocar a guia', async () => {
    for (const denial of ['trial', 'clinic_suspended']) {
      m.execute.mockReset();
      m.execute.mockResolvedValueOnce([{ denial }]);
      const reviewed = await reviewGuideAction({ guideId: GUIDE, version: 3 });
      expect(reviewed.ok).toBe(false);
      expect(reviewed.ok ? '' : reviewed.error).toMatch(
        denial === 'trial' ? /^Convênios: este recurso está disponível para clínicas com assinatura ativa/u : /^Convênios: a assinatura da clínica não está ativa/u,
      );
      expect(m.execute).toHaveBeenCalledTimes(1);
      m.execute.mockResolvedValueOnce([{ denial }]);
      const returned = await returnGuideAction({ guideId: GUIDE, version: 3, note: 'Corrigir o tipo de consulta.' });
      expect(returned.ok).toBe(false);
      expect(m.execute).toHaveBeenCalledTimes(2);
    }
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('aprovação concorrente: quem perde lê que a guia já foi aprovada (não "registro já existe" nem erro genérico)', async () => {
    m.approveConsultaGuide.mockRejectedValueOnce(
      issuanceError(notReviewedError('approved').message),
    );
    expect(await approveGuideAction({ guideId: GUIDE })).toEqual({
      ok: false,
      error:
        'Esta guia já foi aprovada e emitida (etapa: Aprovada). Atualize a página para ver a situação mais recente',
    });
    m.approveConsultaGuide.mockRejectedValueOnce(issuanceError(notReviewedError('ready_for_review').message));
    expect(await approveGuideAction({ guideId: GUIDE })).toEqual({
      ok: false,
      error:
        'Só se emite guia conferida (etapa: Para conferir). Atualize a página para ver a situação mais recente',
    });
  });

  it('emissão reprovada no validador mostra a primeira pendência', async () => {
    m.approveConsultaGuide.mockRejectedValueOnce(
      issuanceError('a guia não passa na validação TISS', [{ message: 'Tipo de consulta fora da tabela 52 da ANS.' }]),
    );
    expect(await approveGuideAction({ guideId: GUIDE })).toEqual({
      ok: false,
      error: 'A guia não passa na validação TISS: Tipo de consulta fora da tabela 52 da ANS.',
    });
  });

  it('ajuste dos dados da Consulta (D11): permissão, campos ao serviço, auditoria e versão nova', async () => {
    m.updateConsultaOverridesInTx.mockResolvedValueOnce({ version: 5, overrides: { tipoConsulta: '4' }, changed: true });
    const r = await updateConsultaFieldsAction({ guideId: GUIDE, version: 4, tipoConsulta: '4', regimeAtendimento: '', observacao: null });
    expect(r).toEqual({ ok: true, data: 5 });
    expect(m.requireCachedPermission).toHaveBeenCalledWith('manage:financial');
    expect(m.updateConsultaOverridesInTx).toHaveBeenCalledWith(expect.anything(), {
      clinicId: CLINIC,
      guideId: GUIDE,
      version: 4,
      input: { tipoConsulta: '4', regimeAtendimento: '', observacao: null },
    });
    expect(m.logAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'health_insurance.guide.consulta_fields_updated', resourceId: GUIDE, after: { result: 5 } }),
    );
  });

  it('ajuste recusado pelo serviço chega com a mensagem do serviço; entrada fora do formato nem chega a ele', async () => {
    m.updateConsultaOverridesInTx.mockRejectedValueOnce(
      new ConsultaOverridesError('Tipo de consulta: o código 7 não está na tabela 52 da ANS (terminologia 202609).', 'invalid'),
    );
    expect(await updateConsultaFieldsAction({ guideId: GUIDE, version: 4, tipoConsulta: '7' })).toEqual({
      ok: false,
      error: 'Tipo de consulta: o código 7 não está na tabela 52 da ANS (terminologia 202609).',
    });
    const long = await updateConsultaFieldsAction({ guideId: GUIDE, version: 4, observacao: 'a'.repeat(501) });
    expect(long).toEqual({ ok: false, error: 'Observação: até 500 caracteres (padrão TISS).' });
    expect(m.updateConsultaOverridesInTx).toHaveBeenCalledTimes(1);
  });
});
